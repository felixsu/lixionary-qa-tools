from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import get_current_user

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

class AuthInjection(BaseModel):
    type: str
    key: str
    domainOrOrigin: str

class ProfileCreate(BaseModel):
    name: str
    cookies: Optional[str] = ""
    localStorage: Optional[str] = ""
    authFunctionId: Optional[str] = None
    authInjection: Optional[AuthInjection] = None
    defaultUrl: Optional[str] = ""

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    cookies: Optional[str] = None
    localStorage: Optional[str] = None
    authFunctionId: Optional[str] = None
    authInjection: Optional[AuthInjection] = None
    defaultUrl: Optional[str] = None

def serialize_doc(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "ownerId" in doc:
        doc["ownerId"] = str(doc["ownerId"])
    if "authFunctionId" in doc and doc["authFunctionId"]:
        doc["authFunctionId"] = str(doc["authFunctionId"])
    return doc

@router.get("")
async def get_profiles(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    cursor = col.find({"ownerId": ObjectId(current_user["id"])})
    docs = await cursor.to_list(length=100)
    return [serialize_doc(d) for d in docs]

def validate_url(url: str):
    if not url:
        return
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    try:
        import urllib.parse
        parsed = urllib.parse.urlparse(url)
        if not parsed.netloc:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL format")

@router.post("")
async def create_profile(payload: ProfileCreate, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    
    # Check if name already exists for this user
    existing = await col.find_one({"ownerId": ObjectId(current_user["id"]), "name": payload.name})
    if existing:
        raise HTTPException(status_code=400, detail="Profile with this name already exists")

    validate_url(payload.defaultUrl)

    doc = {
        "ownerId": ObjectId(current_user["id"]),
        "name": payload.name,
        "cookies": payload.cookies,
        "localStorage": payload.localStorage,
        "authFunctionId": ObjectId(payload.authFunctionId) if payload.authFunctionId else None,
        "authInjection": payload.authInjection.dict() if payload.authInjection else None,
        "defaultUrl": payload.defaultUrl,
        "createdAt": datetime.now(timezone.utc)
    }
    
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.put("/{id}")
async def update_profile(id: str, payload: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")

    update_fields = {}
    if payload.name is not None:
        update_fields["name"] = payload.name
    if payload.cookies is not None:
        update_fields["cookies"] = payload.cookies
    if payload.localStorage is not None:
        update_fields["localStorage"] = payload.localStorage
    if payload.authFunctionId is not None:
        update_fields["authFunctionId"] = ObjectId(payload.authFunctionId) if payload.authFunctionId else None
    if payload.authInjection is not None:
        update_fields["authInjection"] = payload.authInjection.dict() if payload.authInjection else None
    if payload.defaultUrl is not None:
        validate_url(payload.defaultUrl)
        update_fields["defaultUrl"] = payload.defaultUrl

    if update_fields:
        await col.update_one({"_id": ObjectId(id)}, {"$set": update_fields})
        
    doc = await col.find_one({"_id": ObjectId(id)})
    return serialize_doc(doc)

@router.delete("/{id}")
async def delete_profile(id: str, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")

    await col.delete_one({"_id": ObjectId(id)})
    return {"message": "Profile deleted successfully"}
