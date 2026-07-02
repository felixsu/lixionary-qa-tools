import asyncio
import json
import re
from typing import Any, Dict, List, Tuple

from config import settings

# Method-name prefix per scan action; radio inputs use select_ so the name reads
# naturally ("select_plan_basic") even though the Playwright call is still .check()
_ACTION_PREFIXES = {
    "click": "click_",
    "fill": "fill_",
    "check": "check_",
}


def sanitize_method_name(name: str) -> str:
    method_name = re.sub(r"[^a-zA-Z0-9_]", "", name.lower())
    if not method_name or method_name[0].isdigit():
        method_name = f"action_{method_name}"
    return method_name


def _prefix_for(item: Dict[str, Any]) -> str:
    if item.get("action") == "check" and item.get("subtype") == "radio":
        return "select_"
    return _ACTION_PREFIXES.get(item.get("action", ""), "action_")


def _normalize_base(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    base = re.sub(r"_+", "_", base)
    if len(base) > 30:
        cut = base[:30]
        if "_" in cut:
            cut = cut.rsplit("_", 1)[0]
        base = cut
    return base


def heuristic_method_name(item: Dict[str, Any], positional_counters: Dict[str, int]) -> Tuple[str, bool]:
    """
    Derive an intuitive snake_case method name from an element's labels/text.
    Returns (name, weak) — weak names are candidates for LLM cleanup.
    """
    prefix = _prefix_for(item)

    sources = [
        item.get("text") or item.get("value") or "",
        item.get("label") or "",
        item.get("placeholder") or "",
        item.get("associatedLabel") or "",
        item.get("nameAttr") or "",
        item.get("title") or "",
    ]
    base = ""
    for source in sources:
        base = _normalize_base(source.strip())
        if base:
            break

    weak = False
    if not base:
        base = _normalize_base((item.get("nearbyText") or "").strip())
        weak = True

    if not base:
        tag = item.get("tagName", "element")
        counter_key = f"{prefix}{tag}"
        positional_counters[counter_key] = positional_counters.get(counter_key, 0) + 1
        base = f"{tag}_{positional_counters[counter_key]}"
        weak = True

    return sanitize_method_name(f"{prefix}{base}"), weak


def dedupe_names(names: List[str]) -> List[str]:
    seen: Dict[str, int] = {}
    result = []
    for name in names:
        if name not in seen:
            seen[name] = 1
            result.append(name)
            continue
        candidate = name
        while candidate in seen:
            seen[name] += 1
            candidate = f"{name}_{seen[name]}"
        seen[candidate] = 1
        result.append(candidate)
    return result


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _build_polish_request(items: List[Dict[str, Any]], heuristic_names: List[str]) -> Tuple[str, str]:
    def snip(value: Any) -> str:
        return str(value or "")[:60]

    rows = [
        {
            "i": idx,
            "action": item.get("action", ""),
            "tag": item.get("tagName", ""),
            "heuristicName": heuristic_names[idx],
            "text": snip(item.get("text") or item.get("value")),
            "label": snip(item.get("label")),
            "placeholder": snip(item.get("placeholder")),
            "associatedLabel": snip(item.get("associatedLabel")),
            "nearbyText": snip(item.get("nearbyText")),
        }
        for idx, item in enumerate(items)
    ]

    system_instruction = (
        "You are naming Playwright page-object methods. Given a JSON array of interactive "
        "elements, each with a proposed snake_case method name, return ONLY a raw JSON array "
        "of strings of the same length and order: the final method name for each element.\n"
        "Rules:\n"
        "1. Keep the action prefix (click_/fill_/check_/select_) of each name exactly as given.\n"
        "2. Keep names that are already clear unchanged.\n"
        "3. For unclear names (e.g. click_button_2, icon-only buttons) derive a short intuitive "
        "snake_case name from the context fields.\n"
        "4. Use only lowercase letters, digits and underscores; max 40 characters per name.\n"
        "5. Names must not duplicate each other.\n"
        "6. Output ONLY the raw JSON array — no markdown, no code fences, no commentary."
    )
    return json.dumps(rows), system_instruction


async def polish_method_names(
    items: List[Dict[str, Any]], heuristic_names: List[str]
) -> Tuple[List[str], str]:
    """
    Polish heuristic method names with one batched Gemini call.
    Fails open: any error at any layer keeps the heuristic names.
    Returns (final_names, source) where source is "llm" or "heuristic".
    """
    if not items or not settings.GEMINI_API_KEY:
        return heuristic_names, "heuristic"

    contents, system_instruction = _build_polish_request(items, heuristic_names)

    def _call() -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
            ),
        )
        return response.text

    try:
        raw = await asyncio.wait_for(asyncio.to_thread(_call), timeout=20)
        parsed = json.loads(_strip_code_fences(raw))
        if not isinstance(parsed, list) or len(parsed) != len(heuristic_names):
            raise ValueError("LLM response shape mismatch")

        final_names = []
        for idx, candidate in enumerate(parsed):
            fallback = heuristic_names[idx]
            expected_prefix = fallback.split("_", 1)[0] + "_"
            if not isinstance(candidate, str):
                final_names.append(fallback)
                continue
            name = sanitize_method_name(candidate)
            if not name or len(name) > 50 or not name.startswith(expected_prefix):
                final_names.append(fallback)
            else:
                final_names.append(name)

        return dedupe_names(final_names), "llm"
    except Exception as e:
        print(f"LLM method-name polish failed, keeping heuristic names: {e}")
        return heuristic_names, "heuristic"
