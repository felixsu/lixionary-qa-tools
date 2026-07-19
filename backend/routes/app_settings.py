from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from bson import ObjectId

from db.mongo import MongoDB
from routes.auth import require_admin, get_current_user

admin_router = APIRouter(prefix="/api/admin/settings", tags=["settings-admin"], dependencies=[Depends(require_admin)])

DESCRIPTION_BASE_PROMPT_KEY = "description_base_prompt"

DEFAULT_DESCRIPTION_BASE_PROMPT = (
    "You are a senior API technical writer. Given an HTTP request definition "
    "(method, URL, body, declared inputs, declared outputs) and the user's draft description, "
    "produce a clear, concise Markdown description of the request.\n\n"
    "Structure the description with:\n"
    "- A short opening paragraph explaining the purpose of the request and when to use it.\n"
    "- An Inputs section (table of declared inputs, their sources and values) when inputs exist.\n"
    "- An Outputs section (table of declared outputs and what they contain) when outputs exist.\n"
    "- Notable behavior, caveats, or side effects worth calling out.\n\n"
    "Preserve factual content from the user's draft; improve structure, clarity, and wording. "
    "Do not invent facts that are not supported by the draft or the request definition."
)


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
