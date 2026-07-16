from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import get_current_user
from services.sync_versioning import (
    get_device_id,
    new_version_fields,
    apply_versioned_update,
    soft_delete,
    sync_state_projection,
)

router = APIRouter(prefix="/api/flows", tags=["flows"])

# Nodes/edges are opaque blobs owned by the frontend (like collection request
# trees) — the server only versions and syncs them.
class FlowCreate(BaseModel):
    name: str
    description: str = ""
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

class FlowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    expected_version: Optional[int] = None
    force: bool = False

def serialize_doc(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "ownerId" in doc:
        doc["ownerId"] = str(doc["ownerId"])
    return doc

@router.get("")
async def get_flows(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("flows")
    cursor = col.find({"ownerId": ObjectId(current_user["id"]), "deleted": {"$ne": True}})
    docs = await cursor.to_list(length=1000)
    return [serialize_doc(d) for d in docs]

@router.get("/sync-state")
async def get_flows_sync_state(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("flows")
    cursor = col.find({"ownerId": ObjectId(current_user["id"])})
    docs = await cursor.to_list(length=1000)
    return [sync_state_projection(d) for d in docs]

@router.post("")
async def create_flow(
    payload: FlowCreate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("flows")

    # No name-uniqueness check (flows behave like collections: duplicates allowed,
    # which also keeps the sync engine's name-collision fallback path unused).
    doc = {
        "ownerId": ObjectId(current_user["id"]),
        "name": payload.name,
        "description": payload.description,
        "nodes": payload.nodes,
        "edges": payload.edges,
        **new_version_fields(device_id),
    }

    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.put("/{id}")
async def update_flow(
    id: str,
    payload: FlowUpdate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("flows")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Flow not found")

    update_fields = {}
    if payload.name is not None:
        update_fields["name"] = payload.name
    if payload.description is not None:
        update_fields["description"] = payload.description
    if payload.nodes is not None:
        update_fields["nodes"] = payload.nodes
    if payload.edges is not None:
        update_fields["edges"] = payload.edges

    doc = await apply_versioned_update(
        col, ObjectId(id), update_fields,
        device_id=device_id,
        expected_version=payload.expected_version,
        force=payload.force,
        serialize=serialize_doc,
    )
    return serialize_doc(doc)

@router.delete("/{id}")
async def delete_flow(
    id: str,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("flows")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Flow not found")

    updated = await soft_delete(col, ObjectId(id), device_id=device_id)
    return {"message": "Flow deleted successfully", **sync_state_projection(updated)}
