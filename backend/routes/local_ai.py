"""Sidecar AI endpoints — run entirely on-device against the user's own LLM key.

These were previously cloud endpoints (routes/ai.py) backed by a centralized
Gemini key. Under bring-your-own-key they live on the sidecar so API keys never
leave this machine. Like every other sidecar route there is no auth — the
server binds localhost and is trusted.
"""

import asyncio
import json
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import llm_provider
from services.ai_prompts import DEFAULT_DESCRIPTION_BASE_PROMPT, STUDIO_ASSISTANT_SYSTEM_PROMPT

router = APIRouter(prefix="/api/ai", tags=["local-ai"])


class GenerateParserPayload(BaseModel):
    responseBodySample: Any
    prompt: str
    outputs: Optional[List[str]] = None


@router.post("/generate-parser")
async def generate_parser(payload: GenerateParserPayload):
    """
    Converts natural language instructions into a JavaScript parser code block
    using the user's active LLM provider.
    """
    declared_outputs = [o for o in (payload.outputs or []) if o]
    outputs_section = ""
    if declared_outputs:
        outputs_section = f"""
    Declared outputs (each MUST be assigned via output.<name> = value):
    {", ".join(declared_outputs)}
    """

    formatted_prompt = f"""
    Response Payload Sample:
    {payload.responseBodySample}
    {outputs_section}
    Goal instructions:
    {payload.prompt}
    """

    system_instruction = (
        "You are an expert API testing automation developer. Your task is to output a raw, "
        "executable, and safe JavaScript parsing function based on the user's prompt and a given JSON response block.\n"
        "Rules:\n"
        "1. Do not output any markdown formatting, code block markers, backticks, or comments. Output ONLY executable JavaScript.\n"
        "2. The JSON response is available inside a local variable named 'response'.\n"
        "3. For EVERY declared output name the user lists, set it on BOTH the 'output' object "
        "(output.order_id = value) AND as an environment variable via env.set('order_id', value), "
        "using the exact same name for both.\n"
        "4. Only call env.set for variables that are NOT declared outputs when the user's prompt "
        "explicitly asks for an additional environment variable.\n"
        "5. Existing environment variables can be read with env.get('name') (returns undefined "
        "when the variable is not set) — use it when the prompt needs a current environment value.\n"
        "6. Extract properties safely (e.g. check for array lengths or null boundaries).\n\n"
        "Example Output (user_email is a declared output):\n"
        "if(response && response.body && response.body.data && response.body.data.users && response.body.data.users.length > 0) {\n"
        "  const user_email = response.body.data.users[0].email;\n"
        "  output.user_email = user_email;\n"
        "  env.set('user_email', user_email);\n"
        "}"
    )

    try:
        raw = await llm_provider.generate(
            system_instruction, formatted_prompt,
            temperature=0.1, top_p=0.95, timeout=60,
        )
    except llm_provider.LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI parser generation timed out. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    # Clean up code output just in case (removing any leading/trailing backticks or markdown block indicators)
    generated_script = raw.strip()
    if generated_script.startswith("```javascript"):
        generated_script = generated_script[13:]
    elif generated_script.startswith("```js"):
        generated_script = generated_script[5:]
    if generated_script.endswith("```"):
        generated_script = generated_script[:-3]

    return {"generatedScript": generated_script.strip()}


MAX_BODY_CHARS = 4000


class ImproveDescriptionPayload(BaseModel):
    draft: Optional[str] = ""
    name: Optional[str] = ""
    method: str
    url: str
    bodyType: Optional[str] = "NONE"
    body: Optional[str] = ""
    inputs: Optional[List[Dict[str, Any]]] = None
    outputs: Optional[List[str]] = None
    outputDescriptions: Optional[Dict[str, str]] = None
    # Admin-configured base prompt fetched from the cloud by the frontend;
    # falls back to the built-in default when absent (e.g. cloud unreachable).
    basePrompt: Optional[str] = None


def _strip_markdown_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


@router.post("/improve-description")
async def improve_description(payload: ImproveDescriptionPayload):
    """
    Improves a user's draft request description into polished Markdown using
    the admin-configurable base prompt plus the full request definition as context.
    """
    base_prompt = (payload.basePrompt or "").strip() or DEFAULT_DESCRIPTION_BASE_PROMPT
    system_instruction = (
        base_prompt
        + "\n\nHard rules:\n"
        "- Output ONLY the improved Markdown description document.\n"
        "- Do not wrap the document in ``` fences.\n"
        "- No preamble, commentary, or explanation of your changes."
    )

    body_text = (payload.body or "").strip()
    if len(body_text) > MAX_BODY_CHARS:
        body_text = body_text[:MAX_BODY_CHARS] + "\n... (truncated)"

    inputs_lines = []
    for inp in payload.inputs or []:
        name = inp.get("name")
        if not name:
            continue
        inputs_lines.append(f"- {name} (source: {inp.get('source', 'literal')}): {inp.get('value', '')}")

    output_descriptions = payload.outputDescriptions or {}
    outputs_lines = []
    for out in payload.outputs or []:
        if not out:
            continue
        desc = output_descriptions.get(out, "")
        outputs_lines.append(f"- {out}: {desc}" if desc else f"- {out}")

    formatted_prompt = f"""Request definition:
Name: {payload.name or "(unnamed)"}
{payload.method} {payload.url}
Body type: {payload.bodyType or "NONE"}
Body:
{body_text or "(empty)"}

Declared inputs:
{chr(10).join(inputs_lines) or "(none)"}

Declared outputs:
{chr(10).join(outputs_lines) or "(none)"}

User draft description:
{(payload.draft or "").strip() or "(empty — write the description from scratch)"}
"""

    try:
        raw = await llm_provider.generate(
            system_instruction, formatted_prompt,
            temperature=0.4, top_p=0.95, timeout=60,
        )
    except llm_provider.LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI description generation timed out. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    improved = _strip_markdown_fence(raw or "")
    if not improved:
        raise HTTPException(status_code=500, detail="AI returned an empty description.")
    return {"improvedDescription": improved}


# ---- API Studio canvas assistant --------------------------------------------

_ASSISTANT_ACTION_TYPES = ("create_flow", "add_node", "update_node", "connect")
_ASSISTANT_NODE_TYPES = ("request", "looper", "delay", "verifier")
_MAPPING_SOURCES = ("static", "reference")
_COMPARISON_OPERATORS = ("equals", "not_equals", "contains", "exists", "greater_than", "less_than")


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class StudioAssistantPayload(BaseModel):
    # Oldest → newest; the last user turn is the new question. The client caps
    # the transcript length; the server is stateless.
    messages: List[AssistantChatMessage]
    # {"catalog": [...], "catalogTruncated": bool, "canvas": {...}} — opaque
    # here, serialized into the final user turn for the model.
    context: Dict[str, Any]


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _valid_mapping(m: Any) -> bool:
    return (
        isinstance(m, dict)
        and _is_nonempty_str(m.get("inputName"))
        and m.get("source") in _MAPPING_SOURCES
        and isinstance(m.get("value"), str)
    )


def _valid_request_config(cfg: Any) -> bool:
    if not isinstance(cfg, dict) or not _is_nonempty_str(cfg.get("requestName")):
        return False
    mappings = cfg.get("mappings", [])
    return isinstance(mappings, list) and all(_valid_mapping(m) for m in mappings)


def _valid_comparison(c: Any) -> bool:
    return (
        isinstance(c, dict)
        and _is_nonempty_str(c.get("field"))
        and c.get("operator") in _COMPARISON_OPERATORS
        and c.get("expectedSource", "static") in _MAPPING_SOURCES
        and isinstance(c.get("expected", ""), str)
    )


def _valid_node_config(node_type: str, cfg: Any) -> bool:
    if not isinstance(cfg, dict):
        return False
    if node_type == "request":
        return _valid_request_config(cfg)
    if node_type == "delay":
        return isinstance(cfg.get("ms"), (int, float)) and cfg["ms"] >= 0
    if node_type == "looper":
        return (
            cfg.get("itemsSource") in _MAPPING_SOURCES
            and isinstance(cfg.get("itemsValue"), str)
            and _valid_request_config(cfg.get("request"))
        )
    if node_type == "verifier":
        comparisons = cfg.get("comparisons", [])
        return (
            _valid_request_config(cfg.get("request"))
            and isinstance(comparisons, list)
            and all(_valid_comparison(c) for c in comparisons)
            and isinstance(cfg.get("maxAttempts", 1), int)
            and isinstance(cfg.get("intervalMs", 0), (int, float))
        )
    return False


def _valid_action(action: Any) -> bool:
    if not isinstance(action, dict):
        return False
    action_type = action.get("type")
    if action_type == "create_flow":
        return _is_nonempty_str(action.get("name"))
    if action_type == "add_node":
        return (
            action.get("nodeType") in _ASSISTANT_NODE_TYPES
            and _is_nonempty_str(action.get("name"))
            and _valid_node_config(action["nodeType"], action.get("config"))
        )
    if action_type == "update_node":
        # Partial config: field presence varies, so only require the envelope;
        # the client's validateAndPlan checks the merged result field by field.
        return _is_nonempty_str(action.get("name")) and isinstance(action.get("config"), dict)
    if action_type == "connect":
        return _is_nonempty_str(action.get("from")) and _is_nonempty_str(action.get("to"))
    return False


def _validate_assistant_response(raw: str) -> Dict[str, Any]:
    """Parse and shape-check one assistant turn.

    Never raises for model misbehavior — degraded turns come back as
    action-less messages with parseError set, so the conversation continues.
    """
    stripped = _strip_markdown_fence(raw or "")
    try:
        parsed = json.loads(stripped)
    except (ValueError, TypeError):
        # The model chatted in plain text — acceptable for a clarification turn.
        return {"message": (raw or "").strip(), "actions": [], "parseError": True}

    if not isinstance(parsed, dict) or not isinstance(parsed.get("message"), str):
        return {"message": stripped, "actions": [], "parseError": True}

    actions = parsed.get("actions", [])
    if not isinstance(actions, list):
        actions = []
    if actions and any(not _valid_action(a) for a in actions):
        # Atomic trust: one malformed action invalidates the whole list.
        return {
            "message": parsed["message"]
            + "\n\n_(I proposed actions in an invalid format — please ask me to try again.)_",
            "actions": [],
            "parseError": True,
        }
    create_flow_positions = [i for i, a in enumerate(actions) if a.get("type") == "create_flow"]
    if create_flow_positions and create_flow_positions != [0]:
        return {
            "message": parsed["message"]
            + "\n\n_(I proposed actions in an invalid format — please ask me to try again.)_",
            "actions": [],
            "parseError": True,
        }
    return {"message": parsed["message"], "actions": actions, "parseError": False}


@router.post("/studio-assistant")
async def studio_assistant(payload: StudioAssistantPayload):
    """One turn of the API Studio canvas assistant.

    Stateless: the client sends the transcript plus the request catalog and
    current canvas every call; the model returns {message, actions} which the
    frontend validates again and applies only on user confirmation.
    """
    if not payload.messages:
        raise HTTPException(status_code=422, detail="messages must not be empty")

    messages = [{"role": m.role, "content": m.content} for m in payload.messages]
    # Structured context rides in the final user turn (same convention as the
    # web-explorer exploration prompts) so history turns stay compact.
    last = messages[-1]
    if last["role"] == "user":
        last["content"] = json.dumps({"context": payload.context, "request": last["content"]})

    try:
        raw = await llm_provider.chat(
            STUDIO_ASSISTANT_SYSTEM_PROMPT, messages,
            temperature=0.2, timeout=60,
        )
    except llm_provider.LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="The assistant timed out. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

    return _validate_assistant_response(raw)


class VerifyKeyPayload(BaseModel):
    provider: str
    key: str
    model: Optional[str] = None


@router.post("/verify-key")
async def verify_key(payload: VerifyKeyPayload):
    """Makes a minimal round trip against the given provider/key/model."""
    try:
        ok, message = await asyncio.wait_for(
            asyncio.to_thread(llm_provider.verify_key_sync, payload.provider, payload.key, payload.model),
            timeout=30,
        )
    except asyncio.TimeoutError:
        return {"ok": False, "message": "Verification timed out. Check your network and try again."}
    return {"ok": ok, "message": message}
