from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, Dict
from google import genai
from google.genai import types

from config import settings
from routes.auth import get_current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])

class GenerateParserPayload(BaseModel):
    responseBodySample: Any
    prompt: str

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

    formatted_prompt = f"""
    Response Payload Sample:
    {payload.responseBodySample}

    Goal instructions:
    {payload.prompt}
    """

    system_instruction = (
        "You are an expert API testing automation developer. Your task is to output a raw, "
        "executable, and safe JavaScript parsing function based on the user's prompt and a given JSON response block.\n"
        "Rules:\n"
        "1. Do not output any markdown formatting, code block markers, backticks, or comments. Output ONLY executable JavaScript.\n"
        "2. The JSON response is available inside a local variable named 'response'.\n"
        "3. You have access to a custom SDK object named 'vars' to set values: vars.set('variable_name', value).\n"
        "4. Extract properties safely (e.g. check for array lengths or null boundaries).\n\n"
        "Example Output:\n"
        "if(response && response.body && response.body.data && response.body.data.users && response.body.data.users.length > 0) {\n"
        "  vars.set('user_email', response.body.data.users[0].email);\n"
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
