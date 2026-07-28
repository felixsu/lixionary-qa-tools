import re
from datetime import datetime, timezone
from typing import List, Literal, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError

from db.mongo import MongoDB
from routes.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/user-guides", tags=["user-guides"], dependencies=[Depends(get_current_user)])
admin_router = APIRouter(prefix="/api/admin/user-guides", tags=["user-guides-admin"], dependencies=[Depends(require_admin)])

MAX_GUIDE_DEPTH = 5
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

class GuideBlock(BaseModel):
    type: Literal["markdown", "mermaid"]
    content: str = ""

class UserGuideCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    blocks: List[GuideBlock] = []
    parentId: Optional[str] = None
    slug: Optional[str] = None

class UserGuideUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    blocks: Optional[List[GuideBlock]] = None
    parentId: Optional[str] = None
    slug: Optional[str] = None

class ReorderPayload(BaseModel):
    direction: Literal["up", "down"]

def normalize_slug(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    slug = raw.strip().lower()
    if not slug:
        return None
    if not SLUG_PATTERN.match(slug):
        raise HTTPException(
            status_code=400,
            detail="Slug may only contain lowercase letters, numbers, and hyphens (e.g. api-studio-intro)",
        )
    return slug

def compute_depth(node_id: Optional[str], parent_map: dict) -> int:
    # 1-based depth; an orphaned parentId (parent doc missing) or a cycle in
    # legacy data ends the walk so corrupt chains never block operations.
    depth = 1
    seen = {node_id}
    current = parent_map.get(node_id)
    while current is not None and current in parent_map and current not in seen:
        seen.add(current)
        depth += 1
        current = parent_map.get(current)
    return depth

def compute_subtree_height(node_id: Optional[str], children_map: dict, _seen: Optional[set] = None) -> int:
    seen = _seen if _seen is not None else set()
    if node_id in seen:
        return 0
    seen.add(node_id)
    children = children_map.get(node_id, ())
    if not children:
        return 1
    return 1 + max((compute_subtree_height(c, children_map, seen) for c in children), default=0)

def is_descendant(candidate_id: Optional[str], node_id: str, parent_map: dict) -> bool:
    # True when candidate_id is node_id itself or lives inside node_id's subtree.
    seen = set()
    current = candidate_id
    while current is not None and current not in seen:
        if current == node_id:
            return True
        seen.add(current)
        current = parent_map.get(current)
    return False

async def load_hierarchy(col):
    parent_map = {}
    async for d in col.find({}, {"parentId": 1}):
        pid = d.get("parentId")
        parent_map[str(d["_id"])] = str(pid) if pid else None
    children_map = {}
    for cid, pid in parent_map.items():
        if pid is not None:
            children_map.setdefault(pid, []).append(cid)
    return parent_map, children_map

async def validate_parent(col, parent_id: Optional[str], node_oid: Optional[ObjectId] = None) -> Optional[ObjectId]:
    """Validate a requested parent and return its ObjectId (None = top level)."""
    if not parent_id:
        return None
    try:
        parent_oid = ObjectId(parent_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Parent page not found")
    parent = await col.find_one({"_id": parent_oid}, {"_id": 1})
    if not parent:
        raise HTTPException(status_code=400, detail="Parent page not found")

    parent_map, children_map = await load_hierarchy(col)
    pid = str(parent_oid)
    nid = str(node_oid) if node_oid else None
    if nid and is_descendant(pid, nid, parent_map):
        raise HTTPException(status_code=400, detail="A guide cannot be nested under itself or its own sub-pages.")
    height = compute_subtree_height(nid, children_map) if nid else 1
    if compute_depth(pid, parent_map) + height > MAX_GUIDE_DEPTH:
        raise HTTPException(status_code=400, detail=f"Maximum nesting depth is {MAX_GUIDE_DEPTH} levels.")
    return parent_oid

async def ensure_slug_available(col, slug: str, exclude_oid: Optional[ObjectId] = None):
    query = {"slug": slug}
    if exclude_oid is not None:
        query["_id"] = {"$ne": exclude_oid}
    if await col.find_one(query, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Slug already in use")

async def next_sibling_order(col, parent_oid: Optional[ObjectId]) -> int:
    # {"parentId": None} matches both missing and null, covering legacy roots.
    doc = await col.find_one({"parentId": parent_oid}, {"order": 1}, sort=[("order", -1)])
    if not doc:
        return 0
    return doc.get("order", 0) + 1

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
    parent_id = doc.get("parentId")
    doc["parentId"] = str(parent_id) if parent_id else None
    doc["slug"] = doc.get("slug")
    doc["order"] = doc.get("order", 0)
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
    cursor = col.find({}, {"blocks.content": 0}).sort([("order", 1), ("title", 1)])
    docs = await cursor.to_list(length=500)
    results = []
    for d in docs:
        serialized = serialize_guide(d)
        serialized.pop("blocks", None)
        results.append(serialized)
    return results

@router.get("/by-slug/{slug}")
async def get_user_guide_by_slug(slug: str):
    normalized = normalize_slug(slug)
    if not normalized:
        raise HTTPException(status_code=404, detail="User guide not found")
    col = MongoDB.get_collection("user_guides")
    doc = await col.find_one({"slug": normalized})
    if not doc:
        raise HTTPException(status_code=404, detail="User guide not found")
    return serialize_guide(doc)

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
    parent_oid = await validate_parent(col, payload.parentId)
    slug = normalize_slug(payload.slug)
    if slug:
        await ensure_slug_available(col, slug)
    now = datetime.now(timezone.utc)
    doc = {
        "title": title,
        "description": (payload.description or "").strip(),
        "blocks": [b.model_dump() for b in payload.blocks],
        "parentId": parent_oid,
        "order": await next_sibling_order(col, parent_oid),
        "createdBy": ObjectId(current_user["id"]),
        "createdByName": current_user.get("name") or current_user.get("email") or "",
        "createdAt": now,
        "updatedAt": now,
    }
    if slug:
        doc["slug"] = slug
    try:
        res = await col.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Slug already in use")
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
    unset_fields = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        update_fields["title"] = title
    if payload.description is not None:
        update_fields["description"] = payload.description.strip()
    if payload.blocks is not None:
        update_fields["blocks"] = [b.model_dump() for b in payload.blocks]
    # "slug"/"parentId" absent from the payload means "leave unchanged"; an
    # explicit null means "clear it" — model_fields_set tells the two apart.
    if "slug" in payload.model_fields_set:
        slug = normalize_slug(payload.slug)
        if slug:
            await ensure_slug_available(col, slug, exclude_oid=oid)
            update_fields["slug"] = slug
        elif "slug" in existing:
            unset_fields["slug"] = ""
    if "parentId" in payload.model_fields_set:
        parent_oid = await validate_parent(col, payload.parentId, node_oid=oid)
        if (existing.get("parentId") or None) != (parent_oid or None):
            update_fields["parentId"] = parent_oid
            update_fields["order"] = await next_sibling_order(col, parent_oid)

    if update_fields or unset_fields:
        update_fields["updatedAt"] = datetime.now(timezone.utc)
        update_doc = {"$set": update_fields}
        if unset_fields:
            update_doc["$unset"] = unset_fields
        try:
            await col.update_one({"_id": oid}, update_doc)
        except DuplicateKeyError:
            raise HTTPException(status_code=400, detail="Slug already in use")

    doc = await col.find_one({"_id": oid})
    return serialize_guide(doc)

@admin_router.post("/{id}/reorder")
async def reorder_user_guide(id: str, payload: ReorderPayload):
    col = MongoDB.get_collection("user_guides")
    oid = parse_guide_id(id)
    doc = await col.find_one({"_id": oid}, {"parentId": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="User guide not found")

    siblings = await col.find(
        {"parentId": doc.get("parentId")}, {"order": 1, "title": 1}
    ).to_list(length=500)
    siblings.sort(key=lambda d: (d.get("order", 0), d.get("title", "")))
    idx = next(i for i, s in enumerate(siblings) if s["_id"] == oid)
    target = idx - 1 if payload.direction == "up" else idx + 1
    if target < 0 or target >= len(siblings):
        raise HTTPException(status_code=400, detail="Guide is already at the edge of its list")

    siblings[idx], siblings[target] = siblings[target], siblings[idx]
    # Rewrite orders positionally so legacy docs (all order 0) still move.
    for i, s in enumerate(siblings):
        if s.get("order") != i:
            await col.update_one({"_id": s["_id"]}, {"$set": {"order": i}})
    await col.update_one({"_id": oid}, {"$set": {"updatedAt": datetime.now(timezone.utc)}})
    return {"message": "ok"}

@admin_router.delete("/{id}")
async def delete_user_guide(id: str):
    col = MongoDB.get_collection("user_guides")
    oid = parse_guide_id(id)
    if await col.count_documents({"parentId": oid}) > 0:
        raise HTTPException(status_code=400, detail="This guide has sub-pages. Move or delete them first.")
    res = await col.delete_one({"_id": oid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User guide not found")
    return {"message": "User guide deleted successfully"}
