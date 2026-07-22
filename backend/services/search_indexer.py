import asyncio
import difflib
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from config import settings
from db import search_index
from db.local_store import LocalStore

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
EMBED_BATCH_SIZE = 100

NAME_WEIGHT = 0.45
URL_WEIGHT = 0.30
DESC_WEIGHT = 0.25
_MATCH_FLOOR = 0.55

# Missing sentinel (vs. None, which is a valid "not yet processed" payload value)
_MISSING = object()

_pending: Dict[str, Any] = {}
_queue: "asyncio.Queue[str]" = asyncio.Queue()
_status: Dict[str, Any] = {"state": "idle", "pendingCollections": 0}
_db_lock = asyncio.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash(text: str) -> Optional[str]:
    trimmed = (text or "").strip()
    if not trimmed:
        return None
    return hashlib.sha256(trimmed.encode("utf-8")).hexdigest()


def _flatten_requests(payload: Dict[str, Any]) -> Dict[str, Tuple[str, str, str]]:
    """Walks a Collection payload's requests + nested children, returning
    {request_id: (name, url, description)} for every request in the tree."""
    out: Dict[str, Tuple[str, str, str]] = {}
    for req in payload.get("requests") or []:
        req_id = req.get("id")
        if not req_id:
            continue
        out[req_id] = (req.get("name") or "", req.get("url") or "", req.get("description") or "")
    for child in payload.get("children") or []:
        out.update(_flatten_requests(child))
    return out


def _get_client():
    if not settings.GEMINI_API_KEY:
        return None
    from google import genai
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def _embed_batch_sync(texts: List[str]) -> List[List[float]]:
    client = _get_client()
    if client is None:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
        config={"output_dimensionality": EMBEDDING_DIMENSIONS},
    )
    return [list(e.values) for e in response.embeddings]


async def _embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    if not texts:
        return []
    try:
        return await asyncio.to_thread(_embed_batch_sync, texts)
    except Exception:
        logger.exception("search index: embedding call failed for %d text(s)", len(texts))
        return None


def enqueue_reindex(collection_local_id: str, payload: Optional[Dict[str, Any]]) -> None:
    """Registers the latest known payload for a collection and wakes the
    background worker. Repeated calls for the same collection before the
    worker gets to it collapse to whichever payload was enqueued last."""
    _pending[collection_local_id] = payload
    _queue.put_nowait(collection_local_id)
    _status["state"] = "indexing"
    _status["pendingCollections"] = len(_pending)


def get_status() -> Dict[str, Any]:
    conn = LocalStore.connection()
    return {
        "state": _status["state"],
        "pendingCollections": _status["pendingCollections"],
        "pendingRequestIds": search_index.list_pending_request_ids(conn),
    }


async def reindex_collection(collection_local_id: str, payload: Optional[Dict[str, Any]]) -> None:
    conn = LocalStore.connection()

    async with _db_lock:
        existing = search_index.get_rows_for_collection(conn, collection_local_id)

        if payload is None:
            with conn:
                search_index.delete_rows_for_collection(conn, collection_local_id)
            return

        current = _flatten_requests(payload)
        removed = [rid for rid in existing.keys() if rid not in current]
        to_embed: List[Tuple[str, int, str]] = []  # (request_id, surrogate_id, description)

        with conn:
            if removed:
                search_index.delete_rows(conn, removed)

            for request_id, (name, url, description) in current.items():
                new_hash = _hash(description)
                row = existing.get(request_id)
                if row and row["name"] == name and row["url"] == url and row["description_hash"] == new_hash:
                    continue  # unchanged — skip entirely, no write, no embed

                changed_description = not row or row["description_hash"] != new_hash
                status = "pending" if new_hash else "skipped"
                surrogate_id = search_index.upsert_row(
                    conn,
                    request_id=request_id,
                    collection_local_id=collection_local_id,
                    name=name,
                    url=url,
                    description=description,
                    description_hash=new_hash,
                    embedding_status=status,
                    updated_at=_now(),
                )
                if new_hash and changed_description:
                    to_embed.append((request_id, surrogate_id, description))

    # Gemini calls happen outside the transaction/lock above so a slow network
    # call never holds local.db open against other request handlers.
    for i in range(0, len(to_embed), EMBED_BATCH_SIZE):
        chunk = to_embed[i:i + EMBED_BATCH_SIZE]
        vectors = await _embed_texts([c[2] for c in chunk])
        async with _db_lock:
            with conn:
                if vectors is None:
                    for _request_id, surrogate_id, _description in chunk:
                        search_index.set_embedding_status(conn, surrogate_id, "error")
                else:
                    for (_request_id, surrogate_id, _description), vector in zip(chunk, vectors):
                        search_index.write_embedding(conn, surrogate_id, vector)


async def _worker_loop() -> None:
    while True:
        collection_local_id = await _queue.get()
        payload = _pending.pop(collection_local_id, _MISSING)
        _queue.task_done()
        if payload is not _MISSING:
            try:
                await reindex_collection(collection_local_id, payload)
            except Exception:
                logger.exception("search index: failed reindexing collection %s", collection_local_id)
        _status["pendingCollections"] = len(_pending)
        if not _pending and _queue.empty():
            _status["state"] = "idle"


async def start_background_worker() -> None:
    asyncio.create_task(_worker_loop())
    for record in LocalStore.list("collection"):
        enqueue_reindex(record["localId"], json.loads(record["payload"]))


def _name_score(query: str, name: str) -> float:
    query_l, name_l = query.lower(), name.lower()
    if not query_l or not name_l:
        return 0.0
    if query_l == name_l:
        return 1.0
    ratio = difflib.SequenceMatcher(None, query_l, name_l).ratio()
    if query_l in name_l:
        return max(ratio, 0.9)
    return ratio


async def search(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    conn = LocalStore.connection()
    query = (query or "").strip()
    if not query:
        return []

    rows = search_index.all_rows(conn)
    scores: Dict[str, Dict[str, Any]] = {}

    # A whole-string difflib ratio is only meaningful for name-shaped queries
    # (typo tolerance against a comparably short string) — over a long,
    # sentence-length query it produces moderate "similarity" from pure
    # character overlap with any unrelated short name, which would otherwise
    # drown out the description leg's actual semantic signal. Require a
    # fairly high ratio before treating it as a real name match at all.
    for row in rows:
        name_score = _name_score(query, row["name"])
        url_score = 1.0 if query.lower() in row["url"].lower() else 0.0
        if name_score < _MATCH_FLOOR and url_score < 1.0:
            continue
        scores[row["request_id"]] = {
            "collectionLocalId": row["collection_local_id"],
            "requestId": row["request_id"],
            "nameScore": name_score if name_score >= _MATCH_FLOOR else 0.0,
            "urlScore": url_score,
            "descScore": 0.0,
            "matchedFields": [f for f, s in (("name", name_score >= _MATCH_FLOOR), ("url", url_score == 1.0)) if s],
        }

    vector = None
    if settings.GEMINI_API_KEY:
        embedded = await _embed_texts([query])
        vector = embedded[0] if embedded else None

    if vector is not None:
        vec_rows = search_index.search_vector(conn, vector, k=min(limit * 3, 100))
        # This embedding model's cosine distances sit in a narrow, compressed
        # band (unrelated text still often lands around 0.6-0.9 similarity),
        # so an absolute cutoff doesn't discriminate well. Min-max normalize
        # distances *within this query's own candidate set* instead — the
        # closest match becomes 1.0 and the weakest of the returned
        # candidates becomes 0.0, which is what actually drives ranking.
        if vec_rows:
            distances = [r["distance"] for r in vec_rows]
            best, worst = min(distances), max(distances)
            spread = worst - best
            for row in vec_rows:
                desc_score = 1.0 if spread <= 1e-9 else (worst - row["distance"]) / spread
                entry = scores.get(row["request_id"])
                if entry is None:
                    entry = {
                        "collectionLocalId": row["collection_local_id"],
                        "requestId": row["request_id"],
                        "nameScore": 0.0,
                        "urlScore": 0.0,
                        "descScore": 0.0,
                        "matchedFields": [],
                    }
                    scores[row["request_id"]] = entry
                entry["descScore"] = desc_score
                if desc_score >= 0.5 and "description" not in entry["matchedFields"]:
                    entry["matchedFields"].append("description")

    results = []
    for entry in scores.values():
        combined = (
            NAME_WEIGHT * entry["nameScore"]
            + URL_WEIGHT * entry["urlScore"]
            + DESC_WEIGHT * entry["descScore"]
        )
        if not entry["matchedFields"]:
            continue
        results.append({
            "collectionLocalId": entry["collectionLocalId"],
            "requestId": entry["requestId"],
            "score": combined,
            "matchedFields": entry["matchedFields"],
        })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]
