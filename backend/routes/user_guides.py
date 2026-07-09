from datetime import datetime, timezone
from typing import List, Literal, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId
from bson.errors import InvalidId

from db.mongo import MongoDB
from routes.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/user-guides", tags=["user-guides"], dependencies=[Depends(get_current_user)])
admin_router = APIRouter(prefix="/api/admin/user-guides", tags=["user-guides-admin"], dependencies=[Depends(require_admin)])

class GuideBlock(BaseModel):
    type: Literal["markdown", "mermaid"]
    content: str = ""

class UserGuideCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    blocks: List[GuideBlock] = []

class UserGuideUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    blocks: Optional[List[GuideBlock]] = None

def serialize_guide(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "createdBy" in doc:
        doc["createdBy"] = str(doc["createdBy"])
    for field in ("createdAt", "updatedAt"):
        if doc.get(field):
            doc[field] = doc[field].isoformat()
    if "blocks" in doc:
        doc["blockCount"] = len(doc["blocks"])
    return doc

def parse_guide_id(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="User guide not found")

@router.get("")
async def list_user_guides():
    col = MongoDB.get_collection("user_guides")
    # Exclude block content (the heavy part) but keep block types so blockCount works.
    cursor = col.find({}, {"blocks.content": 0}).sort("title", 1)
    docs = await cursor.to_list(length=500)
    results = []
    for d in docs:
        serialized = serialize_guide(d)
        serialized.pop("blocks", None)
        results.append(serialized)
    return results

@router.get("/{id}")
async def get_user_guide(id: str):
    col = MongoDB.get_collection("user_guides")
    doc = await col.find_one({"_id": parse_guide_id(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="User guide not found")
    return serialize_guide(doc)

@admin_router.post("")
async def create_user_guide(payload: UserGuideCreate, current_user: dict = Depends(get_current_user)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    col = MongoDB.get_collection("user_guides")
    now = datetime.now(timezone.utc)
    doc = {
        "title": title,
        "description": (payload.description or "").strip(),
        "blocks": [b.model_dump() for b in payload.blocks],
        "createdBy": ObjectId(current_user["id"]),
        "createdByName": current_user.get("name") or current_user.get("email") or "",
        "createdAt": now,
        "updatedAt": now,
    }
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_guide(doc)

@admin_router.put("/{id}")
async def update_user_guide(id: str, payload: UserGuideUpdate):
    col = MongoDB.get_collection("user_guides")
    oid = parse_guide_id(id)
    existing = await col.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="User guide not found")

    update_fields = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        update_fields["title"] = title
    if payload.description is not None:
        update_fields["description"] = payload.description.strip()
    if payload.blocks is not None:
        update_fields["blocks"] = [b.model_dump() for b in payload.blocks]

    if update_fields:
        update_fields["updatedAt"] = datetime.now(timezone.utc)
        await col.update_one({"_id": oid}, {"$set": update_fields})

    doc = await col.find_one({"_id": oid})
    return serialize_guide(doc)

@admin_router.delete("/{id}")
async def delete_user_guide(id: str):
    col = MongoDB.get_collection("user_guides")
    res = await col.delete_one({"_id": parse_guide_id(id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User guide not found")
    return {"message": "User guide deleted successfully"}
