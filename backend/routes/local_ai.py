"""Sidecar AI endpoints — run entirely on-device against the user's own LLM key.

These were previously cloud endpoints (routes/ai.py) backed by a centralized
Gemini key. Under bring-your-own-key they live on the sidecar so API keys never
leave this machine. Like every other sidecar route there is no auth — the
server binds localhost and is trusted.
"""

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import llm_provider
from services.ai_prompts import DEFAULT_DESCRIPTION_BASE_PROMPT

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
        "5. Extract properties safely (e.g. check for array lengths or null boundaries).\n\n"
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


class VerifyKeyPayload(BaseModel):
    provider: str
    key: str


@router.post("/verify-key")
async def verify_key(payload: VerifyKeyPayload):
    """Makes a minimal round trip against the given provider/key pair."""
    try:
        ok, message = await asyncio.wait_for(
            asyncio.to_thread(llm_provider.verify_key_sync, payload.provider, payload.key),
            timeout=30,
        )
    except asyncio.TimeoutError:
        return {"ok": False, "message": "Verification timed out. Check your network and try again."}
    return {"ok": ok, "message": message}
