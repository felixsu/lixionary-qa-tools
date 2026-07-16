from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
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

router = APIRouter(prefix="/api/environments", tags=["environments"])

class VariableSchema(BaseModel):
    key: str
    value: str
    isSecret: bool = False

class EnvironmentCreate(BaseModel):
    name: str
    variables: List[VariableSchema] = []

class EnvironmentUpdate(BaseModel):
    name: Optional[str] = None
    variables: Optional[List[VariableSchema]] = None
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
async def get_environments(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("environments")
    cursor = col.find({"ownerId": ObjectId(current_user["id"]), "deleted": {"$ne": True}})
    docs = await cursor.to_list(length=100)
    return [serialize_doc(d) for d in docs]

@router.get("/sync-state")
async def get_environments_sync_state(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("environments")
    cursor = col.find({"ownerId": ObjectId(current_user["id"])})
    docs = await cursor.to_list(length=1000)
    return [sync_state_projection(d) for d in docs]

@router.post("")
async def create_environment(
    payload: EnvironmentCreate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("environments")

    # Check if name already exists for this user
    existing = await col.find_one({"ownerId": ObjectId(current_user["id"]), "name": payload.name, "deleted": {"$ne": True}})
    if existing:
        raise HTTPException(status_code=400, detail="Environment with this name already exists")

    doc = {
        "ownerId": ObjectId(current_user["id"]),
        "name": payload.name,
        "variables": [v.model_dump() for v in payload.variables],
        **new_version_fields(device_id),
    }

    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.put("/{id}")
async def update_environment(
    id: str,
    payload: EnvironmentUpdate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("environments")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Environment not found")

    update_fields = {}
    if payload.name is not None:
        update_fields["name"] = payload.name
    if payload.variables is not None:
        update_fields["variables"] = [v.model_dump() for v in payload.variables]

    doc = await apply_versioned_update(
        col, ObjectId(id), update_fields,
        device_id=device_id,
        expected_version=payload.expected_version,
        force=payload.force,
        serialize=serialize_doc,
    )
    return serialize_doc(doc)

@router.delete("/{id}")
async def delete_environment(
    id: str,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("environments")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Environment not found")

    updated = await soft_delete(col, ObjectId(id), device_id=device_id)
    return {"message": "Environment deleted successfully", **sync_state_projection(updated)}
