from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import require_admin
from services.browser import BrowserSessionManager

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

# Request Schemas
class AddCollaboratorPayload(BaseModel):
    email: Optional[str] = None
    userId: Optional[str] = None

class UpdateUserRolePayload(BaseModel):
    role: str  # "admin" or "member"

class UpdateUserStatusPayload(BaseModel):
    disabled: bool

# Helpers
def serialize_user(doc) -> dict:
    if not doc:
        return doc
    doc_copy = dict(doc)
    doc_copy["id"] = str(doc_copy["_id"])
    del doc_copy["_id"]
    # Provide defaults for fields that might be missing in legacy records
    doc_copy["role"] = doc_copy.get("role", "member")
    doc_copy["disabled"] = doc_copy.get("disabled", False)
    if isinstance(doc_copy.get("createdAt"), datetime):
        doc_copy["createdAt"] = doc_copy["createdAt"].isoformat()
    if isinstance(doc_copy.get("updatedAt"), datetime):
        doc_copy["updatedAt"] = doc_copy["updatedAt"].isoformat()
    return doc_copy

def serialize_collection(doc) -> dict:
    if not doc:
        return doc
    doc_copy = dict(doc)
    doc_copy["id"] = str(doc_copy["_id"])
    del doc_copy["_id"]
    if "ownerId" in doc_copy:
        doc_copy["ownerId"] = str(doc_copy["ownerId"])
    if "collaboratorIds" in doc_copy:
        doc_copy["collaboratorIds"] = [str(uid) for uid in doc_copy["collaboratorIds"]]
        
    for req in doc_copy.get("requests", []):
        if req.get("authConfig") and req["authConfig"].get("authFunctionId"):
            req["authConfig"]["authFunctionId"] = str(req["authConfig"]["authFunctionId"])
            
    return doc_copy


# --- BROWSER SESSIONS MANAGEMENT ---

@router.get("/sessions")
async def list_active_sessions():
    """
    List all active browser sessions across all users.
    """
    sessions_col = MongoDB.get_collection("browser_sessions")
    users_col = MongoDB.get_collection("users")
    
    sessions = await sessions_col.find(
        {"status": {"$ne": "closed"}}
    ).sort("created_at", -1).to_list(None)
    
    # Retrieve all users to associate their details
    users = await users_col.find({}).to_list(None)
    user_map = {str(u["_id"]): serialize_user(u) for u in users}
    
    result = []
    for s in sessions:
        uid = s.get("user_id")
        result.append({
            "session_id": s["session_id"],
            "status": s["status"],
            "created_at": s["created_at"].isoformat() if isinstance(s.get("created_at"), datetime) else s.get("created_at", ""),
            "profile_id": s.get("profile_id"),
            "user": user_map.get(uid, {"id": uid, "email": "unknown@lixionary.com", "name": "Unknown User"})
        })
    return result

@router.delete("/sessions/{session_id}")
async def force_close_session(session_id: str):
    """
    Force close any active browser session in the system.
    """
    sessions_col = MongoDB.get_collection("browser_sessions")
    session = await sessions_col.find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    await BrowserSessionManager.close_session(session_id)
    await sessions_col.delete_one({"session_id": session_id})
    return {"message": f"Session {session_id} successfully closed by admin"}


# --- COLLECTIONS COLLABORATION MANAGEMENT ---

@router.get("/collections")
async def list_all_collections():
    """
    List all collections across the database, mapping owners and collaborators.
    """
    col = MongoDB.get_collection("collections")
    users_col = MongoDB.get_collection("users")
    
    collections = await col.find({}).to_list(None)
    users = await users_col.find({}).to_list(None)
    user_map = {str(u["_id"]): serialize_user(u) for u in users}
    
    result = []
    for c in collections:
        serialized = serialize_collection(c)
        owner_id = serialized.get("ownerId")
        collab_ids = serialized.get("collaboratorIds", [])
        
        serialized["owner"] = user_map.get(owner_id, {"id": owner_id, "email": "unknown@lixionary.com", "name": "Unknown User"})
        serialized["collaborators"] = [
            user_map.get(cid, {"id": cid, "email": "unknown@lixionary.com", "name": "Unknown User"})
            for cid in collab_ids
        ]
        result.append(serialized)
        
    return result

@router.post("/collections/{collection_id}/collaborators")
async def add_collection_collaborator(collection_id: str, payload: AddCollaboratorPayload):
    """
    Share a collection with another user.
    """
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(collection_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    users_col = MongoDB.get_collection("users")
    collab_user = None
    if payload.email:
        collab_user = await users_col.find_one({"email": payload.email})
    elif payload.userId:
        collab_user = await users_col.find_one({"_id": ObjectId(payload.userId)})
        
    if not collab_user:
        raise HTTPException(status_code=404, detail="Target collaborator user not found")
        
    collab_uid = collab_user["_id"]
    if collab_uid == doc["ownerId"]:
        raise HTTPException(status_code=400, detail="Cannot share collection with the owner")
        
    await col.update_one(
        {"_id": ObjectId(collection_id)},
        {"$addToSet": {"collaboratorIds": collab_uid}}
    )
    
    updated_doc = await col.find_one({"_id": ObjectId(collection_id)})
    return {"message": "Collaborator added successfully", "collection": serialize_collection(updated_doc)}

@router.delete("/collections/{collection_id}/collaborators/{user_id}")
async def remove_collection_collaborator(collection_id: str, user_id: str):
    """
    Revoke a user's sharing access to a collection.
    """
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(collection_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    await col.update_one(
        {"_id": ObjectId(collection_id)},
        {"$pull": {"collaboratorIds": ObjectId(user_id)}}
    )
    
    updated_doc = await col.find_one({"_id": ObjectId(collection_id)})
    return {"message": "Collaborator removed successfully", "collection": serialize_collection(updated_doc)}


# --- USER DIRECTORY CRUD ---

@router.get("/users")
async def list_users():
    """
    List all registered users in Lixionary.
    """
    users_col = MongoDB.get_collection("users")
    users = await users_col.find({}).to_list(None)
    return [serialize_user(u) for u in users]

@router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, payload: UpdateUserRolePayload, current_user: dict = Depends(require_admin)):
    """
    Update a user's role (admin vs member).
    An admin cannot demote themselves to avoid locking themselves out.
    """
    if str(current_user["id"]) == user_id:
        raise HTTPException(status_code=400, detail="Admins cannot change their own role to prevent lockout")
        
    if payload.role not in ["admin", "member"]:
        raise HTTPException(status_code=400, detail="Invalid role value. Must be 'admin' or 'member'")
        
    users_col = MongoDB.get_collection("users")
    res = await users_col.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": payload.role, "updatedAt": datetime.now(timezone.utc)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
        
    return {"message": f"User role updated to {payload.role}"}

@router.put("/users/{user_id}/status")
async def update_user_status(user_id: str, payload: UpdateUserStatusPayload, current_user: dict = Depends(require_admin)):
    """
    Disable or enable a user.
    An admin cannot disable themselves.
    If disabled, terminates all their active browser sessions immediately.
    """
    if str(current_user["id"]) == user_id:
        raise HTTPException(status_code=400, detail="Admins cannot disable their own account to prevent lockout")
        
    users_col = MongoDB.get_collection("users")
    res = await users_col.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"disabled": payload.disabled, "updatedAt": datetime.now(timezone.utc)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
        
    # If deactivating, terminate active sessions
    if payload.disabled:
        sessions_col = MongoDB.get_collection("browser_sessions")
        sessions = await sessions_col.find({"user_id": user_id, "status": {"$ne": "closed"}}).to_list(None)
        for s in sessions:
            await BrowserSessionManager.close_session(s["session_id"])
            await sessions_col.delete_one({"session_id": s["session_id"]})
            
    status_str = "disabled" if payload.disabled else "enabled"
    return {"message": f"User account has been {status_str}"}

@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(require_admin)):
    """
    Delete a user account.
    An admin cannot delete themselves.
    Terminates any active browser sessions immediately.
    """
    if str(current_user["id"]) == user_id:
        raise HTTPException(status_code=400, detail="Admins cannot delete their own account to prevent lockout")
        
    users_col = MongoDB.get_collection("users")
    
    # Check existence
    user = await users_col.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Delete user profile
    await users_col.delete_one({"_id": ObjectId(user_id)})
    
    # Close running browser sessions
    sessions_col = MongoDB.get_collection("browser_sessions")
    sessions = await sessions_col.find({"user_id": user_id, "status": {"$ne": "closed"}}).to_list(None)
    for s in sessions:
        await BrowserSessionManager.close_session(s["session_id"])
        await sessions_col.delete_one({"session_id": s["session_id"]})
        
    return {"message": "User successfully deleted"}
