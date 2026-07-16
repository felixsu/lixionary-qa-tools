import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.local_store import LocalStore, ENTITY_TYPES

router = APIRouter(prefix="/api/local-store", tags=["local-store"])


def _validate_entity_type(entity_type: str) -> None:
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown entity type: {entity_type}")


def _present(record: Dict[str, Any]) -> Dict[str, Any]:
    """Deserializes the stored JSON payload back into the record shape the
    frontend expects: the entity's own fields merged with sync bookkeeping."""
    out = dict(json.loads(record["payload"]))
    out["localId"] = record["localId"]
    out["cloudId"] = record["cloudId"]
    out["version"] = record["version"]
    out["baseVersion"] = record["baseVersion"]
    out["dirty"] = record["dirty"]
    return out


class CreatePayload(BaseModel):
    payload: Dict[str, Any]


class UpdatePayload(BaseModel):
    payload: Dict[str, Any]


class MarkSyncedEntry(BaseModel):
    localId: str
    cloudId: Optional[str] = None
    newBaseVersion: int
    resolvedPayload: Optional[Dict[str, Any]] = None
    deleted: bool = False


class MarkSyncedRequest(BaseModel):
    entries: List[MarkSyncedEntry]


class PullEntry(BaseModel):
    cloudId: str
    version: int
    payload: Dict[str, Any]


class PullRequest(BaseModel):
    entries: List[PullEntry]


class SetActiveUserRequest(BaseModel):
    userId: str


@router.get("/device-id")
async def get_device_id():
    return {"deviceId": LocalStore.device_id()}


@router.post("/active-user")
async def set_active_user(body: SetActiveUserRequest):
    """Called right after login, before any sync pass — wipes the local
    cache if a different cloud user than last time is now signed in."""
    switched = LocalStore.set_active_user(body.userId)
    return {"switched": switched}


@router.get("/{entity_type}")
async def list_entities(entity_type: str):
    _validate_entity_type(entity_type)
    return [_present(r) for r in LocalStore.list(entity_type)]


@router.get("/{entity_type}/sync-state")
async def get_sync_state(entity_type: str):
    _validate_entity_type(entity_type)
    return LocalStore.sync_state(entity_type)


@router.post("/{entity_type}")
async def create_entity(entity_type: str, body: CreatePayload):
    _validate_entity_type(entity_type)
    record = LocalStore.create(entity_type, json.dumps(body.payload))
    return _present(record)


@router.put("/{entity_type}/{local_id}")
async def update_entity(entity_type: str, local_id: str, body: UpdatePayload):
    _validate_entity_type(entity_type)
    record = LocalStore.update(entity_type, local_id, json.dumps(body.payload))
    if not record:
        raise HTTPException(status_code=404, detail="Not found")
    return _present(record)


@router.delete("/{entity_type}/{local_id}")
async def delete_entity(entity_type: str, local_id: str):
    _validate_entity_type(entity_type)
    ok = LocalStore.delete(entity_type, local_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.post("/{entity_type}/pull")
async def pull_entities(entity_type: str, body: PullRequest):
    """Inserts records that exist on the cloud but have never been seen on this
    device — as already-synced (not dirty), unlike a normal local create."""
    _validate_entity_type(entity_type)
    results = []
    for entry in body.entries:
        record = LocalStore.create_synced(
            entity_type, json.dumps(entry.payload),
            cloud_id=entry.cloudId, version=entry.version,
        )
        results.append(_present(record))
    return results


@router.post("/{entity_type}/mark-synced")
async def mark_synced(entity_type: str, body: MarkSyncedRequest):
    _validate_entity_type(entity_type)
    results = []
    for entry in body.entries:
        record = LocalStore.mark_synced(
            entity_type,
            entry.localId,
            cloud_id=entry.cloudId,
            new_base_version=entry.newBaseVersion,
            resolved_payload_json=json.dumps(entry.resolvedPayload) if entry.resolvedPayload is not None else None,
            deleted=entry.deleted,
        )
        if record:
            results.append(_present(record))
    return results
