from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets
import httpx
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from pydantic import BaseModel
from bson import ObjectId

from config import settings
from db.mongo import MongoDB

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer()

class GoogleLoginRequest(BaseModel):
    idToken: str

class TokenResponse(BaseModel):
    token: str
    user: dict
    # Optional so a client older than the refresh rollout, which ignores this
    # field entirely, keeps working unchanged.
    refresh_token: Optional[str] = None

class OAuthExchangeRequest(BaseModel):
    code: str
    redirect_uri: str

class OAuthRefreshRequest(BaseModel):
    refresh_token: str

class OAuthRevokeRequest(BaseModel):
    refresh_token: str

class DevLoginRequest(BaseModel):
    email: str
    role: Optional[str] = None
    name: Optional[str] = None

def create_jwt_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def _hash_refresh_token(raw: str) -> str:
    """
    Refresh tokens are stored hashed, never in the clear: they are long-lived
    bearer credentials, so a dump of the collection must not be enough to
    resume anyone's session. Plain SHA-256 is the right tool here (unlike for
    passwords) — the token is 256 bits of CSPRNG output, so there is no
    guessable input space for a brute-force to chew through.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


async def issue_refresh_token(user_id: str, email: str) -> str:
    """
    Mints an opaque refresh token for a freshly issued session and records it.

    Opaque rather than a JWT so it is revocable: /revoke and the rotation in
    consume_refresh_token both need a server-side record to invalidate, which
    a self-contained JWT could not offer.
    """
    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await MongoDB.get_collection("refresh_tokens").insert_one({
        "tokenHash": _hash_refresh_token(raw),
        "userId": user_id,
        "email": email,
        "createdAt": now,
        "expiresAt": now + timedelta(days=settings.REFRESH_TOKEN_EXPIRY_DAYS),
        "revokedAt": None,
    })
    return raw


async def consume_refresh_token(raw: str) -> Optional[dict]:
    """
    Validates a refresh token and rotates it: the presented token is revoked
    and a replacement returned, so a token stolen in transit is usable at most
    once and the legitimate client's next refresh fails loudly rather than the
    theft going unnoticed.

    Returns None when the token is unknown, already used, revoked or expired.
    Callers that need to tell "not ours at all" (an IAM token, to be forwarded)
    from "ours but spent" pair this with is_local_refresh_token.
    """
    col = MongoDB.get_collection("refresh_tokens")
    now = datetime.now(timezone.utc)

    # Atomic find-and-revoke: two concurrent refreshes with the same token must
    # not both succeed, or rotation would hand out two live chains.
    record = await col.find_one_and_update(
        {"tokenHash": _hash_refresh_token(raw), "revokedAt": None,
         "expiresAt": {"$gt": now}},
        {"$set": {"revokedAt": now}},
    )
    if not record:
        return None

    user = await MongoDB.get_collection("users").find_one(
        {"_id": ObjectId(record["userId"])})
    if not user or user.get("disabled", False):
        return None

    email = user.get("email", record.get("email", ""))
    return {
        "access_token": create_jwt_token(record["userId"], email),
        "refresh_token": await issue_refresh_token(record["userId"], email),
        "user_id": record["userId"],
        "email": email,
    }


async def is_local_refresh_token(raw: str) -> bool:
    """
    True if we ever issued this token, spent/revoked/expired or not.

    Lets /refresh answer a dead local token itself instead of forwarding it to
    IAM, which would both return IAM's unrelated error and hand an external
    service every failed refresh attempt.
    """
    return await MongoDB.get_collection("refresh_tokens").find_one(
        {"tokenHash": _hash_refresh_token(raw)}) is not None


async def revoke_refresh_token(raw: str) -> bool:
    """Revokes a local refresh token. True if one was actually live."""
    res = await MongoDB.get_collection("refresh_tokens").update_one(
        {"tokenHash": _hash_refresh_token(raw), "revokedAt": None},
        {"$set": {"revokedAt": datetime.now(timezone.utc)}},
    )
    return res.modified_count > 0


_cached_public_key = None
_cached_key_expiry = None

async def decode_iam_token(token: str) -> dict:
    """
    Decodes and verifies a JWT — either a token this backend issued itself
    (HS256, from /google, /google/exchange or /dev-login — the common case,
    including in production) or, for backward compatibility with sessions
    issued before the move to direct Google SSO, an RS256 token from
    Lixionary IAM's JWKS endpoint.
    """
    global _cached_public_key, _cached_key_expiry

    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        # Reaching this means the signature DID verify against our secret and
        # only `exp` failed, so the token is definitively one of ours and there
        # is nothing for the IAM path below to try. Report it as expiry rather
        # than falling through to a misleading "invalid signature" — that
        # conflation is exactly what made an ordinary expired session look like
        # a forged token.
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception:
        pass

    try:
        now = datetime.now(timezone.utc)
        if _cached_public_key is None or _cached_key_expiry is None or now > _cached_key_expiry:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{settings.IAM_URL}/oauth/jwks")
                if res.status_code == 200:
                    jwks = res.json()
                    if jwks.get("keys"):
                        from jwt import PyJWK
                        # Fallback: if JWT has no kid or kid is not in JWKS, use the first key in the set
                        header = jwt.get_unverified_header(token)
                        kid = header.get("kid")

                        target_key = None
                        if kid:
                            for key in jwks["keys"]:
                                if key.get("kid") == kid:
                                    target_key = key
                                    break

                        if not target_key:
                            target_key = jwks["keys"][0]

                        jwk = PyJWK(target_key)
                        _cached_public_key = jwk.key
                        _cached_key_expiry = now + timedelta(hours=1)
                else:
                    print(f"Failed to fetch JWKS from IAM (Status {res.status_code})")

        if _cached_public_key is None:
            raise Exception("No public key resolved from JWKS")

        payload = jwt.decode(
            token,
            _cached_public_key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        return payload
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as e:
        print(f"IAM JWT verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token signature")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    FastAPI dependency to secure routes and retrieve the logged-in user.
    Supports local HS256 tokens and RS256 tokens from Lixionary IAM.
    """
    token = credentials.credentials
    try:
        payload = await decode_iam_token(token)

        email = payload.get("email")
        if not email:
            raise HTTPException(status_code=401, detail="Token is missing email claim")

        users_col = MongoDB.get_collection("users")

        # Check if user exists by email, and sync user role/name from token claims
        user = await users_col.find_one({"email": email})

        if not user:
            # Check if this is the first user in the database
            is_db_empty = await users_col.count_documents({}) == 0
            user = {
                "googleId": payload.get("sub", ""),
                "email": email,
                "name": payload.get("name", email.split("@")[0].capitalize()),
                "avatarUrl": "",
                "role": "admin" if is_db_empty else "member",
                "disabled": False,
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc)
            }
            res = await users_col.insert_one(user)
            user["_id"] = res.inserted_id
        else:
            # Sync name if changed (do NOT sync roles — local database is the source of truth for roles)
            updates = {}
            if payload.get("name") and user.get("name") != payload.get("name"):
                updates["name"] = payload.get("name")

            if updates:
                updates["updatedAt"] = datetime.now(timezone.utc)
                await users_col.update_one({"_id": user["_id"]}, {"$set": updates})
                user.update(updates)

        if user.get("disabled", False):
            raise HTTPException(status_code=403, detail="User account is disabled")

        user["id"] = str(user["_id"])
        return user
    except HTTPException:
        raise
    except Exception as e:
        print(f"Auth validation error: {e}")
        raise HTTPException(status_code=401, detail="Could not validate credentials")

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI dependency to restrict routes to admin users only.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


async def _issue_session_for_google_user(google_id: str, email: str, name: str, avatar_url: str) -> dict:
    """
    Finds or creates the local user record for a verified Google identity and
    issues a local JWT session token. Shared by both the direct ID-token
    login (browser GIS) and the authorization-code exchange (desktop relay).
    """
    users_col = MongoDB.get_collection("users")
    is_db_empty = await users_col.count_documents({}) == 0
    user = await users_col.find_one({"googleId": google_id})

    if not user:
        new_user = {
            "googleId": google_id,
            "email": email,
            "name": name,
            "avatarUrl": avatar_url,
            "role": "admin" if is_db_empty else "member",
            "disabled": False,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        res = await users_col.insert_one(new_user)
        user_id = str(res.inserted_id)
        user = new_user
    else:
        user_id = str(user["_id"])

    if user.get("disabled", False):
        raise HTTPException(status_code=403, detail="User account is disabled")

    jwt_token = create_jwt_token(user_id, email)

    return {
        "token": jwt_token,
        "refresh_token": await issue_refresh_token(user_id, email),
        "user": {
            "id": user_id,
            "email": email,
            "name": name,
            "avatarUrl": avatar_url,
            "role": user.get("role", "member"),
            "disabled": user.get("disabled", False)
        }
    }

@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleLoginRequest):
    """
    Exchanges a Google OAuth ID token for a local JWT session token.
    In DEV_MODE, bypasses signature checks for mock development.
    """
    email = "developer@lixionary.com"
    name = "Developer User"
    google_id = "google-dev-12345"
    avatar_url = ""

    # Real verification if Client ID is configured and not in dev mode bypass
    if settings.GOOGLE_CLIENT_ID and not settings.DEV_MODE:
        try:
            from google.oauth2 import id_token
            from google.auth.transport import requests
            idinfo = id_token.verify_oauth2_token(payload.idToken, requests.Request(), settings.GOOGLE_CLIENT_ID)
            google_id = idinfo['sub']
            email = idinfo.get('email', '')
            name = idinfo.get('name', 'Google User')
            avatar_url = idinfo.get('picture', '')
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Google SSO validation failed: {str(e)}")
    else:
        # Debug/Dev mode mock verification
        # Parse email or info from mock ID token if provided
        if payload.idToken != "mock-token" and "@" in payload.idToken:
            email = payload.idToken
            name = email.split("@")[0].capitalize()

    return await _issue_session_for_google_user(google_id, email, name, avatar_url)

@router.post("/google/exchange", response_model=TokenResponse)
async def google_oauth_exchange(payload: OAuthExchangeRequest):
    """
    Exchanges a Google OAuth authorization code (from the redirect-based
    consent flow used by both the browser tab and the desktop system-browser
    relay) for tokens, verifies the resulting ID token, and issues a local
    JWT session — the direct-Google-SSO replacement for the old
    Lixionary-IAM-mediated /oauth-token flow.
    """
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "code": payload.code,
                    "redirect_uri": payload.redirect_uri,
                },
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to exchange authorization code")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to exchange authorization code (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)

            tokens = res.json()
            id_token_str = tokens.get("id_token")
            if not id_token_str:
                raise HTTPException(status_code=400, detail="Google token response is missing an ID token")

            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests
            idinfo = google_id_token.verify_oauth2_token(id_token_str, google_requests.Request(), settings.GOOGLE_CLIENT_ID)

            email = idinfo.get("email", "")
            if not email:
                raise HTTPException(status_code=400, detail="Google ID token is missing an email claim")

            return await _issue_session_for_google_user(
                idinfo["sub"], email, idinfo.get("name", email.split("@")[0].capitalize()), idinfo.get("picture", "")
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Google OAuth connection error: {exc}")

@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(payload: DevLoginRequest):
    """
    Dev-only backdoor: mints a session for ANY email/role without going
    through Google or Lixionary IAM at all. Exists purely to simplify QA
    testing of role-gated flows (e.g. confirming an admin-only route rejects
    a "member", or reproducing a bug reported by a specific test user)
    without needing that person's real Google login.

    Hard-gated behind DEV_MODE: returns 404 rather than 403 when DEV_MODE is
    not explicitly true, so the route doesn't even reveal it exists in a
    deployment that forgot to unset DEV_MODE. Never expose this in
    production — DEV_MODE defaults to true (see config.py / docker-compose),
    so a real deployment MUST set DEV_MODE=false explicitly.

    Replaces the old fixed-identity /guest endpoint (removed) — this covers
    the same "skip real login for local testing" need but lets QA pick any
    email/role instead of always landing on the same shared guest account.
    """
    if not settings.DEV_MODE:
        raise HTTPException(status_code=404, detail="Not found")

    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")

    if payload.role and payload.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'member'")

    name = payload.name or email.split("@")[0].capitalize()

    users_col = MongoDB.get_collection("users")
    user = await users_col.find_one({"email": email})

    if not user:
        is_db_empty = await users_col.count_documents({}) == 0
        new_user = {
            "googleId": f"dev-backdoor-{email}",
            "email": email,
            "name": name,
            "avatarUrl": "",
            "role": payload.role or ("admin" if is_db_empty else "member"),
            "disabled": False,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
        res = await users_col.insert_one(new_user)
        user_id = str(res.inserted_id)
        user = new_user
    else:
        user_id = str(user["_id"])
        # Explicit role override lets QA flip an existing test user between
        # admin/member on the fly, without touching Mongo by hand.
        if payload.role and user.get("role") != payload.role:
            await users_col.update_one(
                {"_id": user["_id"]},
                {"$set": {"role": payload.role, "updatedAt": datetime.now(timezone.utc)}},
            )
            user["role"] = payload.role

    if user.get("disabled", False):
        raise HTTPException(status_code=403, detail="User account is disabled")

    jwt_token = create_jwt_token(user_id, email)

    return {
        "token": jwt_token,
        "refresh_token": await issue_refresh_token(user_id, email),
        "user": {
            "id": user_id,
            "email": email,
            "name": user.get("name", name),
            "avatarUrl": user.get("avatarUrl", ""),
            "role": user.get("role", "member"),
            "disabled": user.get("disabled", False)
        }
    }

@router.post("/oauth-token")
async def oauth_token_exchange(payload: OAuthExchangeRequest):
    """
    Exchanges OAuth auth code for tokens by calling the IAM token endpoint.
    """
    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "grant_type": "authorization_code",
                "client_id": settings.IAM_CLIENT_ID,
                "client_secret": settings.IAM_CLIENT_SECRET,
                "code": payload.code,
                "redirect_uri": payload.redirect_uri
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/token",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to exchange authorization code")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to exchange authorization code (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)

            tokens = res.json()

            # Decode the access token to get user info and provision/upsert locally
            access_token = tokens["access_token"]
            claims = await decode_iam_token(access_token)

            email = claims.get("email")
            if not email:
                raise HTTPException(status_code=400, detail="IAM access token is missing email claim")

            users_col = MongoDB.get_collection("users")
            user = await users_col.find_one({"email": email})

            if not user:
                # Check if this is the first user in the database
                is_db_empty = await users_col.count_documents({}) == 0
                user = {
                    "googleId": claims.get("sub", ""),
                    "email": email,
                    "name": claims.get("name", email.split("@")[0].capitalize()),
                    "avatarUrl": "",
                    "role": "admin" if is_db_empty else "member",
                    "disabled": False,
                    "createdAt": datetime.now(timezone.utc),
                    "updatedAt": datetime.now(timezone.utc)
                }
                insert_res = await users_col.insert_one(user)
                user_id = str(insert_res.inserted_id)
            else:
                user_id = str(user["_id"])
                # Sync name if changed (do NOT sync roles — local database is the source of truth for roles)
                updates = {}
                if claims.get("name") and user.get("name") != claims.get("name"):
                    updates["name"] = claims.get("name")
                if updates:
                    updates["updatedAt"] = datetime.now(timezone.utc)
                    await users_col.update_one({"_id": user["_id"]}, {"$set": updates})
                    user.update(updates)

            if user.get("disabled", False):
                raise HTTPException(status_code=403, detail="User account is disabled")

            return {
                "access_token": access_token,
                "refresh_token": tokens.get("refresh_token"),
                "expires_in": tokens.get("expires_in", 900),
                "user": {
                    "id": user_id,
                    "email": email,
                    "name": user.get("name", ""),
                    "avatarUrl": "",
                    "role": user.get("role", "member"),
                    "disabled": False
                }
            }
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")

@router.post("/refresh")
async def oauth_token_refresh(payload: OAuthRefreshRequest):
    """
    Renews a session from a refresh token.

    Local tokens (issued by the Google SSO / dev-login paths) are checked
    first and rotated on use; anything unrecognised falls through to the IAM
    token endpoint, which is where refresh tokens from sessions predating
    direct Google SSO still live. Same local-first-then-IAM shape as
    decode_iam_token.
    """
    local = await consume_refresh_token(payload.refresh_token)
    if local:
        return {
            "access_token": local["access_token"],
            "refresh_token": local["refresh_token"],
            "token_type": "bearer",
            "expires_in": settings.JWT_EXPIRY_MINUTES * 60,
        }

    if await is_local_refresh_token(payload.refresh_token) or not settings.IAM_URL:
        raise HTTPException(status_code=401,
                            detail="Refresh token is invalid or expired")

    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "grant_type": "refresh_token",
                "client_id": settings.IAM_CLIENT_ID,
                "client_secret": settings.IAM_CLIENT_SECRET,
                "refresh_token": payload.refresh_token
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/token",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to refresh token")
                    if "error_description" in err_data:
                        detail += f": {err_data['error_description']}"
                except Exception:
                    detail = f"Failed to refresh token (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)

            return res.json()
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")

@router.post("/revoke")
async def oauth_token_revoke(payload: OAuthRevokeRequest):
    """
    Revokes a refresh token — local first, then IAM, mirroring /refresh.
    """
    if await revoke_refresh_token(payload.refresh_token):
        return {"success": True}

    if await is_local_refresh_token(payload.refresh_token) or not settings.IAM_URL:
        # Nothing to revoke is not an error: logout must not fail because the
        # session was already gone.
        return {"success": True}

    async with httpx.AsyncClient() as client:
        try:
            req_body = {
                "token": payload.refresh_token
            }
            res = await client.post(
                f"{settings.IAM_URL}/oauth/revoke",
                json=req_body,
                headers={"Content-Type": "application/json"}
            )
            if res.status_code != 200:
                try:
                    err_data = res.json()
                    detail = err_data.get("error", "Failed to revoke token")
                except Exception:
                    detail = f"Failed to revoke token (Status: {res.status_code}): {res.text[:200]}"
                raise HTTPException(status_code=res.status_code, detail=detail)

            return {"success": True}
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"IAM service connection error: {exc}")
