from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import get_current_user

router = APIRouter(prefix="/api/auth-functions", tags=["auth-functions"])

class AuthFunctionCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    script: str

class AuthFunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    script: Optional[str] = None

def serialize_doc(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "ownerId" in doc:
        doc["ownerId"] = str(doc["ownerId"])
    if "expiresAt" in doc and doc["expiresAt"]:
        doc["expiresAt"] = doc["expiresAt"].isoformat()
    return doc

@router.get("")
async def get_auth_functions(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("auth_functions")
    cursor = col.find({"ownerId": ObjectId(current_user["id"])})
    docs = await cursor.to_list(length=100)
    return [serialize_doc(d) for d in docs]

@router.post("")
async def create_auth_function(payload: AuthFunctionCreate, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("auth_functions")
    doc = {
        "ownerId": ObjectId(current_user["id"]),
        "name": payload.name,
        "description": payload.description,
        "script": payload.script,
        "cachedToken": None,
        "expiresAt": None,
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc)
    }
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.put("/{id}")
async def update_auth_function(id: str, payload: AuthFunctionUpdate, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("auth_functions")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Auth function not found")

    update_fields = {}
    if payload.name is not None:
        update_fields["name"] = payload.name
    if payload.description is not None:
        update_fields["description"] = payload.description
    if payload.script is not None:
        update_fields["script"] = payload.script
        # Invalidate cache if script is updated
        update_fields["cachedToken"] = None
        update_fields["expiresAt"] = None

    if update_fields:
        update_fields["updatedAt"] = datetime.now(timezone.utc)
        await col.update_one({"_id": ObjectId(id)}, {"$set": update_fields})
        
    doc = await col.find_one({"_id": ObjectId(id)})
    return serialize_doc(doc)

@router.delete("/{id}")
async def delete_auth_function(id: str, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("auth_functions")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Auth function not found")

    await col.delete_one({"_id": ObjectId(id)})
    return {"message": "Auth function deleted successfully"}
