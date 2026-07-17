from typing import List, Optional, Dict, Any
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

router = APIRouter(prefix="/api/collections", tags=["collections"])

class KeyValueSchema(BaseModel):
    key: str
    value: str

class AuthConfigSchema(BaseModel):
    token: Optional[str] = ""
    key: Optional[str] = ""
    value: Optional[str] = ""
    authFunctionId: Optional[str] = None

class ExtractedVariableSchema(BaseModel):
    variableName: str
    jsonPath: str

class RequestDefinitionSchema(BaseModel):
    id: str  # Client-side unique UUID
    name: str
    method: str
    url: str
    headers: List[KeyValueSchema] = []
    queryParams: List[KeyValueSchema] = []
    bodyType: str = "NONE"
    body: Optional[str] = ""
    authType: str = "NONE"
    authConfig: Optional[AuthConfigSchema] = None
    responseParserScript: Optional[str] = ""
    extractedVariables: List[ExtractedVariableSchema] = []
    lastResponse: Optional[Dict[str, Any]] = None

class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = ""

class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    requests: Optional[List[RequestDefinitionSchema]] = None
    children: Optional[List[Dict[str, Any]]] = None
    expected_version: Optional[int] = None
    force: bool = False

class AddCollaboratorPayload(BaseModel):
    email: Optional[str] = None
    userId: Optional[str] = None

def process_collection_tree(node: Dict[str, Any], current_depth: int) -> Dict[str, Any]:
    if current_depth > 5:
        raise HTTPException(status_code=400, detail="Maximum collection nesting depth of 5 exceeded")
        
    # Process requests in this node
    processed_requests = []
    for req in node.get("requests", []):
        if req.get("authConfig") and req["authConfig"].get("authFunctionId"):
            req["authConfig"]["authFunctionId"] = ObjectId(req["authConfig"]["authFunctionId"])
        processed_requests.append(req)
    node["requests"] = processed_requests
    
    # Process children nodes recursively
    processed_children = []
    for child in node.get("children", []):
        processed_children.append(process_collection_tree(child, current_depth + 1))
    node["children"] = processed_children
    
    return node

def serialize_collection_node(node: Dict[str, Any]) -> Dict[str, Any]:
    for req in node.get("requests", []):
        if req.get("authConfig") and req["authConfig"].get("authFunctionId"):
            req["authConfig"]["authFunctionId"] = str(req["authConfig"]["authFunctionId"])
            
    if "children" in node:
        node["children"] = [serialize_collection_node(c) for c in node["children"]]
        
    return node

def serialize_doc(doc) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if "ownerId" in doc:
        doc["ownerId"] = str(doc["ownerId"])
    if "collaboratorIds" in doc:
        doc["collaboratorIds"] = [str(uid) for uid in doc["collaboratorIds"]]
        
    return serialize_collection_node(doc)

@router.get("")
async def get_collections(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("collections")
    uid = ObjectId(current_user["id"])
    # Return collections owned by OR shared with the user
    cursor = col.find({
        "$or": [
            {"ownerId": uid},
            {"collaboratorIds": uid}
        ],
        "deleted": {"$ne": True}
    })
    docs = await cursor.to_list(length=100)
    return [serialize_doc(d) for d in docs]

@router.get("/sync-state")
async def get_collections_sync_state(current_user: dict = Depends(get_current_user)):
    # Must be registered before GET /{id}, or FastAPI would match "sync-state" as an id.
    col = MongoDB.get_collection("collections")
    uid = ObjectId(current_user["id"])
    cursor = col.find({
        "$or": [
            {"ownerId": uid},
            {"collaboratorIds": uid}
        ]
    })
    docs = await cursor.to_list(length=1000)
    return [sync_state_projection(d) for d in docs]

@router.post("")
async def create_collection(
    payload: CollectionCreate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("collections")
    doc = {
        "name": payload.name,
        "description": payload.description,
        "ownerId": ObjectId(current_user["id"]),
        "collaboratorIds": [],
        "requests": [],
        "children": [],
        **new_version_fields(device_id),
    }
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@router.get("/{id}")
async def get_collection_by_id(id: str, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    return serialize_doc(doc)

@router.put("/{id}")
async def update_collection(
    id: str,
    payload: CollectionUpdate,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")

    uid = ObjectId(current_user["id"])
    if doc["ownerId"] != uid and uid not in doc.get("collaboratorIds", []):
        raise HTTPException(status_code=403, detail="Access denied to modify this collection")

    update_fields = {}
    if payload.name is not None:
        update_fields["name"] = payload.name
    if payload.description is not None:
        update_fields["description"] = payload.description
    if payload.requests is not None:
        serialized_requests = []
        for req in payload.requests:
            req_dict = req.model_dump()
            # Convert authConfig authFunctionId back to ObjectId
            if req_dict.get("authConfig") and req_dict["authConfig"].get("authFunctionId"):
                req_dict["authConfig"]["authFunctionId"] = ObjectId(req_dict["authConfig"]["authFunctionId"])
            serialized_requests.append(req_dict)

        update_fields["requests"] = serialized_requests
    if payload.children is not None:
        processed_children = []
        for child in payload.children:
            processed_children.append(process_collection_tree(child, 2))
        update_fields["children"] = processed_children

    updated_doc = await apply_versioned_update(
        col, ObjectId(id), update_fields,
        device_id=device_id,
        expected_version=payload.expected_version,
        force=payload.force,
        serialize=serialize_doc,
    )

    # In a full production app, you would broadcast this update over WebSockets
    # to all active collaborator client sessions.

    return serialize_doc(updated_doc)

@router.post("/{id}/collaborators")
async def add_collaborator(id: str, payload: AddCollaboratorPayload, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")

    uid = ObjectId(current_user["id"])

    users_col = MongoDB.get_collection("users")
    collab_user = None

    if payload.email:
        collab_user = await users_col.find_one({"email": payload.email})
    elif payload.userId:
        collab_user = await users_col.find_one({"_id": ObjectId(payload.userId)})

    if not collab_user:
        raise HTTPException(status_code=404, detail="Target collaborator user not found")

    collab_uid = collab_user["_id"]

    # Self-add (import flow): any authenticated user can add themselves.
    # Adding another user: only the owner can do that.
    if collab_uid != uid and doc["ownerId"] != uid:
        raise HTTPException(status_code=403, detail="Only the owner can add other collaborators")

    if collab_uid == doc["ownerId"]:
        raise HTTPException(status_code=400, detail="Cannot add the owner as a collaborator")

    if collab_uid in doc.get("collaboratorIds", []):
        return {"message": "User is already a collaborator", "collection": serialize_doc(doc)}

    await col.update_one(
        {"_id": ObjectId(id)},
        {"$addToSet": {"collaboratorIds": collab_uid}}
    )
    
    updated_doc = await col.find_one({"_id": ObjectId(id)})
    return {"message": "Collaborator added successfully", "collection": serialize_doc(updated_doc)}

@router.delete("/{id}")
async def delete_collection(
    id: str,
    current_user: dict = Depends(get_current_user),
    device_id: str = Depends(get_device_id),
):
    col = MongoDB.get_collection("collections")
    doc = await col.find_one({"_id": ObjectId(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")

    uid = ObjectId(current_user["id"])
    if doc["ownerId"] != uid:
        raise HTTPException(status_code=403, detail="Only the owner can delete this collection")

    updated = await soft_delete(col, ObjectId(id), device_id=device_id)
    return {"message": "Collection deleted successfully", **sync_state_projection(updated)}
