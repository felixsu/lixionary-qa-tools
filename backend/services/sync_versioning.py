from datetime import datetime, timezone
from typing import Any, Callable, Optional

from bson import ObjectId
from fastapi import Header, HTTPException
from fastapi.encoders import jsonable_encoder
from pymongo import ReturnDocument


async def get_device_id(x_device_id: Optional[str] = Header(default=None)) -> str:
    """FastAPI dependency: the writing device's id, sent by the client on every
    mutating request. Cross-cutting metadata, not part of any resource's shape."""
    return x_device_id or "unknown"


def new_version_fields(device_id: str) -> dict:
    """Fields to merge into a document on create."""
    now = datetime.now(timezone.utc)
    return {
        "version": 1,
        "createdAt": now,
        "updatedAt": now,
        "lastModifiedDevice": device_id,
        "deleted": False,
    }


async def apply_versioned_update(
    col,
    doc_id: ObjectId,
    update_fields: dict,
    *,
    device_id: str,
    expected_version: Optional[int] = None,
    force: bool = False,
    serialize: Callable[[dict], dict],
) -> dict:
    """
    Applies `update_fields` to the document, bumping its version.

    Raises HTTPException(404) if the document doesn't exist.
    Raises HTTPException(409) with `{"message": ..., "current": <serialized doc>}`
    if `expected_version` is given, doesn't match, and `force` is not set.
    """
    existing = await col.find_one({"_id": doc_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    if not force and expected_version is not None and existing.get("version", 0) != expected_version:
        # HTTPException.detail bypasses FastAPI's normal response encoding (which
        # is what turns datetimes/ObjectIds into JSON-safe values on success
        # paths), so it must be jsonable_encoder'd explicitly here or this crashes
        # JSON serialization on any doc containing a raw datetime.
        raise HTTPException(status_code=409, detail={
            "message": "Version conflict",
            "current": jsonable_encoder(serialize(dict(existing))),
        })

    next_version = existing.get("version", 0) + 1
    set_fields = {
        **update_fields,
        "version": next_version,
        "updatedAt": datetime.now(timezone.utc),
        "lastModifiedDevice": device_id,
    }
    updated = await col.find_one_and_update(
        {"_id": doc_id},
        {"$set": set_fields},
        return_document=ReturnDocument.AFTER,
    )
    return updated


async def soft_delete(
    col,
    doc_id: ObjectId,
    *,
    device_id: str,
) -> dict:
    """Marks a document deleted instead of removing it, so the tombstone can
    propagate through the same version-diff sync logic as any other write."""
    existing = await col.find_one({"_id": doc_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    next_version = existing.get("version", 0) + 1
    updated = await col.find_one_and_update(
        {"_id": doc_id},
        {"$set": {
            "deleted": True,
            "version": next_version,
            "updatedAt": datetime.now(timezone.utc),
            "lastModifiedDevice": device_id,
        }},
        return_document=ReturnDocument.AFTER,
    )
    return updated


def sync_state_projection(doc: dict) -> dict:
    """Lightweight row for cheap client-side diffing — no payload."""
    updated_at = doc.get("updatedAt")
    return {
        "id": str(doc["_id"]),
        "version": doc.get("version", 0),
        "updatedAt": updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at,
        "lastModifiedDevice": doc.get("lastModifiedDevice"),
        "deleted": doc.get("deleted", False),
    }
