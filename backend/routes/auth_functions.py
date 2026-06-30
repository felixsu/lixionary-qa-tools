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
    expires_in: Optional[int] = None

class AuthFunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    script: Optional[str] = None
    expires_in: Optional[int] = None

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
        "expires_in": payload.expires_in,
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
    if payload.expires_in is not None:
        update_fields["expires_in"] = payload.expires_in
        # Invalidate cache if expires_in config changes
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

class AuthFunctionTest(BaseModel):
    script: str
    environment_id: Optional[str] = None

@router.post("/test")
async def test_auth_function(payload: AuthFunctionTest, current_user: dict = Depends(get_current_user)):
    """
    Dry-runs the auth function script in the sandbox using the provided environment variables.
    """
    from services.auth_sandbox import run_unsafe_auth_script
    
    variables = {}
    if payload.environment_id:
        env_col = MongoDB.get_collection("environments")
        env = await env_col.find_one({"_id": ObjectId(payload.environment_id)})
        if env:
            for var in env.get("variables", []):
                variables[var["key"]] = var["value"]

    try:
        token_res = await run_unsafe_auth_script(payload.script, variables)
        if token_res.startswith("ERROR:"):
            return {
                "success": False,
                "error": token_res
            }
        return {
            "success": True,
            "token": token_res
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Execution failed: {str(e)}"
        }
