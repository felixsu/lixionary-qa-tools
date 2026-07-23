from typing import List, Optional
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

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

class AuthInjection(BaseModel):
    type: str
    key: str
    domainOrOrigin: str
    sourceField: Optional[str] = None

class ProfileCreate(BaseModel):
    name: str
    cookies: Optional[str] = ""
    localStorage: Optional[str] = ""
    authFunctionId: Optional[str] = None
    authInjections: Optional[List[AuthInjection]] = None
    defaultUrl: Optional[str] = ""
    headless: Optional[bool] = False
    viewportWidth: Optional[int] = 1280
    viewportHeight: Optional[int] = 720

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    cookies: Optional[str] = None
    localStorage: Optional[str] = None
    authFunctionId: Optional[str] = None
    authInjections: Optional[List[AuthInjection]] = None
    defaultUrl: Optional[str] = None
    headless: Optional[bool] = None
    viewportWidth: Optional[int] = None
    viewportHeight: Optional[int] = None
    expected_version: Optional[int] = None
    force: bool = False

def serialize_doc(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "ownerId" in doc:
        doc["ownerId"] = str(doc["ownerId"])
    if "authFunctionId" in doc and doc["authFunctionId"]:
        doc["authFunctionId"] = str(doc["authFunctionId"])
    # Migrate legacy singular `authInjection` docs into the `authInjections`
    # list on read, so old profiles keep working without a manual re-save.
    # Checked by key presence (not truthiness) so a profile that was
    # explicitly re-saved with zero mappings (`authInjections: []`) doesn't
    # get incorrectly resurrected from a stale legacy field.
    legacy_injection = doc.pop("authInjection", None)
    if "authInjections" not in doc or doc["authInjections"] is None:
        doc["authInjections"] = [legacy_injection] if legacy_injection else []
    return doc

@router.get("")
async def get_profiles(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    cursor = col.find({"ownerId": ObjectId(current_user["id"]), "deleted": {"$ne": True}})
    docs = await cursor.to_list(length=100)
    return [serialize_doc(d) for d in docs]

@router.get("/sync-state")
async def get_profiles_sync_state(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("browser_profiles")
    cursor = col.find({"ownerId": ObjectId(current_user["id"])})
    docs = await cursor.to_list(length=1000)
    return [sync_state_projection(d) for d in docs]

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
async def create_profile(
    payload: ProfileCreate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("browser_profiles")

    # Check if name already exists for this user
    existing = await col.find_one({"ownerId": ObjectId(current_user["id"]), "name": payload.name, "deleted": {"$ne": True}})
    if existing:
        raise HTTPException(status_code=400, detail="Profile with this name already exists")

    validate_url(payload.defaultUrl)

    doc = {
        "ownerId": ObjectId(current_user["id"]),
        "name": payload.name,
        "cookies": payload.cookies,
        "localStorage": payload.localStorage,
        "authFunctionId": ObjectId(payload.authFunctionId) if payload.authFunctionId else None,
        "authInjections": [inj.dict() for inj in payload.authInjections] if payload.authInjections else [],
        "defaultUrl": payload.defaultUrl,
        "headless": payload.headless if payload.headless is not None else False,
        "viewportWidth": payload.viewportWidth or 1280,
        "viewportHeight": payload.viewportHeight or 720,
        **new_version_fields(device_id),
    }

    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.put("/{id}")
async def update_profile(
    id: str,
    payload: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
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
    if payload.authInjections is not None:
        update_fields["authInjections"] = [inj.dict() for inj in payload.authInjections]
    if payload.defaultUrl is not None:
        validate_url(payload.defaultUrl)
        update_fields["defaultUrl"] = payload.defaultUrl
    if payload.headless is not None:
        update_fields["headless"] = payload.headless
    if payload.viewportWidth is not None:
        update_fields["viewportWidth"] = payload.viewportWidth
    if payload.viewportHeight is not None:
        update_fields["viewportHeight"] = payload.viewportHeight

    doc = await apply_versioned_update(
        col, ObjectId(id), update_fields,
        device_id=device_id,
        expected_version=payload.expected_version,
        force=payload.force,
        serialize=serialize_doc,
    )
    return serialize_doc(doc)

@router.delete("/{id}")
async def delete_profile(
    id: str,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("browser_profiles")
    existing = await col.find_one({"_id": ObjectId(id), "ownerId": ObjectId(current_user["id"])})
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")

    updated = await soft_delete(col, ObjectId(id), device_id=device_id)
    return {"message": "Profile deleted successfully", **sync_state_projection(updated)}
