from datetime import datetime, timedelta, timezone

import jwt
import pytest
from bson import ObjectId
from fastapi import HTTPException

import routes.auth as auth
from config import settings


class _FakeCollection:
    """
    Enough of the motor API for the refresh-token flow: the handful of
    operators those three functions actually issue, nothing more.
    """

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    def _match(self, query):
        for doc in self.docs:
            ok = True
            for key, cond in query.items():
                val = doc.get(key)
                if isinstance(cond, dict) and "$gt" in cond:
                    if val is None or not val > cond["$gt"]:
                        ok = False
                elif val != cond:
                    ok = False
                if not ok:
                    break
            if ok:
                return doc
        return None

    async def find_one(self, query):
        return self._match(query)

    async def find_one_and_update(self, query, update):
        doc = self._match(query)
        if doc is None:
            return None
        before = dict(doc)
        doc.update(update["$set"])
        return before

    async def update_one(self, query, update):
        doc = self._match(query)
        if doc is None:
            return type("R", (), {"modified_count": 0})()
        doc.update(update["$set"])
        return type("R", (), {"modified_count": 1})()


def _install_fake_db(monkeypatch_target, user_doc):
    """Points auth's MongoDB.get_collection at in-memory fakes."""
    cols = {
        "refresh_tokens": _FakeCollection(),
        "users": _FakeCollection([user_doc]),
    }
    auth.MongoDB.get_collection = staticmethod(lambda name: cols[name])
    return cols


async def test_expired_token_reports_expiry_not_bad_signature():
    """
    An expired token used to surface as "Invalid token signature", which made
    an ordinary day-old session look like a forgery. Expiry must be reported
    as expiry.
    """
    now = datetime.now(timezone.utc)
    expired = jwt.encode(
        {"sub": "u1", "email": "a@b.c", "exp": now - timedelta(days=2)},
        settings.JWT_SECRET, algorithm="HS256")

    try:
        await auth.decode_session_token(expired)
        assert False, "expected the expired token to be rejected"
    except HTTPException as e:
        assert e.status_code == 401
        assert e.detail == "Token has expired"

    # A live token still decodes.
    good = jwt.encode(
        {"sub": "u1", "email": "a@b.c", "exp": now + timedelta(hours=1)},
        settings.JWT_SECRET, algorithm="HS256")
    assert (await auth.decode_session_token(good))["email"] == "a@b.c"


async def test_refresh_token_rotates_and_rejects_replay():
    user_id = str(ObjectId())
    cols = _install_fake_db(auth, {"_id": ObjectId(user_id), "email": "a@b.c",
                                   "disabled": False})

    raw = await auth.issue_refresh_token(user_id, "a@b.c")

    # Stored hashed, never in the clear.
    stored = cols["refresh_tokens"].docs[0]
    assert stored["tokenHash"] != raw
    assert raw not in str(stored)

    first = await auth.consume_refresh_token(raw)
    assert first is not None
    assert first["refresh_token"] != raw, "refresh token must rotate on use"

    # Replaying the spent token fails — that is what makes rotation worth
    # having, since a token stolen in transit is good at most once.
    assert await auth.consume_refresh_token(raw) is None

    # The replacement works exactly once too.
    assert await auth.consume_refresh_token(first["refresh_token"]) is not None
    assert await auth.consume_refresh_token(first["refresh_token"]) is None


async def test_refresh_token_rejected_when_expired_or_user_disabled():
    user_id = str(ObjectId())
    cols = _install_fake_db(auth, {"_id": ObjectId(user_id), "email": "a@b.c",
                                   "disabled": False})

    raw = await auth.issue_refresh_token(user_id, "a@b.c")
    cols["refresh_tokens"].docs[0]["expiresAt"] = (
        datetime.now(timezone.utc) - timedelta(seconds=1))
    assert await auth.consume_refresh_token(raw) is None

    # A live token belonging to a since-disabled user is refused too, so
    # disabling an account actually ends its sessions.
    cols["refresh_tokens"] = _FakeCollection()
    cols["users"].docs[0]["disabled"] = True
    raw2 = await auth.issue_refresh_token(user_id, "a@b.c")
    assert await auth.consume_refresh_token(raw2) is None


async def test_revoke_is_idempotent():
    user_id = str(ObjectId())
    _install_fake_db(auth, {"_id": ObjectId(user_id), "email": "a@b.c",
                            "disabled": False})

    raw = await auth.issue_refresh_token(user_id, "a@b.c")
    assert await auth.revoke_refresh_token(raw) is True
    # Second logout must not fail — nothing to revoke is not an error.
    assert await auth.revoke_refresh_token(raw) is False
    assert await auth.consume_refresh_token(raw) is None
