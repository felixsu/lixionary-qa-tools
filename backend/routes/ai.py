import asyncio

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from google import genai
from google.genai import types

from config import settings
from routes.auth import get_current_user
from routes.app_settings import get_setting_value, DESCRIPTION_BASE_PROMPT_KEY, DEFAULT_DESCRIPTION_BASE_PROMPT

router = APIRouter(prefix="/api/ai", tags=["ai"])

class GenerateParserPayload(BaseModel):
    responseBodySample: Any
    prompt: str
    outputs: Optional[List[str]] = None

@router.post("/generate-parser")
async def generate_parser(payload: GenerateParserPayload, current_user: dict = Depends(get_current_user)):
    """
    Leverages Gemini to convert natural language instructions into JavaScript parser code blocks.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=400, 
            detail="GEMINI_API_KEY is not configured on the server. Please set it in your environment."
        )

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
        # Use new Google GenAI Client
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=formatted_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
                top_p=0.95
            )
        )
        
        # Clean up code output just in case (removing any leading/trailing backticks or markdown block indicators)
        generated_script = response.text.strip()
        if generated_script.startswith("```javascript"):
            generated_script = generated_script[13:]
        elif generated_script.startswith("```js"):
            generated_script = generated_script[5:]
        if generated_script.endswith("```"):
            generated_script = generated_script[:-3]
            
        generated_script = generated_script.strip()
        
        return {"generatedScript": generated_script}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini AI generation failed: {str(e)}")


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
async def improve_description(payload: ImproveDescriptionPayload, current_user: dict = Depends(get_current_user)):
    """
    Improves a user's draft request description into polished Markdown using
    the admin-configurable base prompt plus the full request definition as context.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="GEMINI_API_KEY is not configured on the server. Please set it in your environment."
        )

    base_prompt = await get_setting_value(DESCRIPTION_BASE_PROMPT_KEY, DEFAULT_DESCRIPTION_BASE_PROMPT)
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
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=formatted_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.4,
                        top_p=0.95
                    )
                )
            ),
            timeout=30,
        )
        improved = _strip_markdown_fence(response.text or "")
        if not improved:
            raise HTTPException(status_code=500, detail="AI returned an empty description.")
        return {"improvedDescription": improved}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI description generation timed out. Please try again.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini AI generation failed: {str(e)}")
