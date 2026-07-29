from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import require_admin, get_current_user
from services.ai_prompts import DESCRIPTION_BASE_PROMPT_KEY, DEFAULT_DESCRIPTION_BASE_PROMPT

admin_router = APIRouter(prefix="/api/admin/settings", tags=["settings-admin"], dependencies=[Depends(require_admin)])

# Non-admin reads: the sidecar's improve-description feature needs the
# configured base prompt, and the frontend fetches it here to pass along.
user_router = APIRouter(prefix="/api/app-settings", tags=["settings"], dependencies=[Depends(get_current_user)])


async def get_setting_value(key: str, default: str) -> str:
    """Server-side helper: read a setting value, falling back to the given default."""
    doc = await MongoDB.get_collection("app_settings").find_one({"key": key})
    return (doc or {}).get("value") or default


class SettingUpdate(BaseModel):
    value: str = ""


def serialize_setting(doc, default: str) -> dict:
    if not doc:
        return {"value": default, "isDefault": True, "updatedAt": None, "updatedByName": None}
    return {
        "value": doc.get("value") or default,
        "isDefault": not doc.get("value"),
        "updatedAt": doc["updatedAt"].isoformat() if doc.get("updatedAt") else None,
        "updatedByName": doc.get("updatedByName"),
    }


@admin_router.get("/description-base-prompt")
async def get_description_base_prompt():
    col = MongoDB.get_collection("app_settings")
    doc = await col.find_one({"key": DESCRIPTION_BASE_PROMPT_KEY})
    return serialize_setting(doc, DEFAULT_DESCRIPTION_BASE_PROMPT)


@admin_router.put("/description-base-prompt")
async def update_description_base_prompt(payload: SettingUpdate, current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("app_settings")
    value = (payload.value or "").strip()
    if not value:
        # Empty value reverts to the built-in default prompt.
        await col.delete_one({"key": DESCRIPTION_BASE_PROMPT_KEY})
        return serialize_setting(None, DEFAULT_DESCRIPTION_BASE_PROMPT)

    now = datetime.now(timezone.utc)
    await col.update_one(
        {"key": DESCRIPTION_BASE_PROMPT_KEY},
        {"$set": {
            "value": value,
            "updatedAt": now,
            "updatedBy": ObjectId(current_user["id"]),
            "updatedByName": current_user.get("name") or current_user.get("email") or "",
        }},
        upsert=True,
    )
    doc = await col.find_one({"key": DESCRIPTION_BASE_PROMPT_KEY})
    return serialize_setting(doc, DEFAULT_DESCRIPTION_BASE_PROMPT)


@user_router.get("/description-base-prompt")
async def get_description_base_prompt_value():
    """Resolved base prompt for any authenticated user (admin or member)."""
    value = await get_setting_value(DESCRIPTION_BASE_PROMPT_KEY, DEFAULT_DESCRIPTION_BASE_PROMPT)
    return {"value": value}
