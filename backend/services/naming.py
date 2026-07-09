import asyncio
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from config import settings

# Method-name prefix per scan action; radio inputs use select_ so the name reads
# naturally ("select_plan_basic") even though the Playwright call is still .check()
_ACTION_PREFIXES = {
    "click": "click_",
    "fill": "fill_",
    "check": "check_",
    "type": "type_",
    "getText": "get_",
    "select_option": "select_",
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


_FIX_ALLOWED_STRATEGIES = (
    "get_by_test_id", "get_by_label", "get_by_role", "get_by_text",
    "locator (CSS)", "locator (XPath)",
)


def _build_fix_request(element: Dict[str, Any], failed_attempts: List[Dict[str, str]]) -> Tuple[str, str]:
    def snip(value: Any) -> str:
        return str(value or "")[:200]

    payload = {
        "element": {
            "tagName": element.get("tagName", ""),
            "text": snip(element.get("text")),
            "testId": snip(element.get("testId")),
            "label": snip(element.get("label")),
            "placeholder": snip(element.get("placeholder")),
            "role": snip(element.get("role")),
            "cssSelector": snip(element.get("cssSelector")),
            "xpath": snip(element.get("xpath")),
        },
        "failedAttempts": [
            {"strategy": a.get("strategy", ""), "selector": snip(a.get("selector")), "error": snip(a.get("error"))}
            for a in failed_attempts
        ],
    }

    system_instruction = (
        "You are fixing a broken Playwright locator. Every candidate locator already "
        "tried for this element has failed (see failedAttempts, each with the error "
        "it raised). Given the element's metadata, propose 1-2 alternative locators "
        "that are likely to match the SAME element.\n"
        "Rules:\n"
        "1. Return ONLY a raw JSON array of 1-2 objects: {\"strategy\": ..., \"selector\": ...}.\n"
        f"2. \"strategy\" must be exactly one of: {', '.join(_FIX_ALLOWED_STRATEGIES)}.\n"
        "3. For \"get_by_role\", \"selector\" must be formatted as role[name=\"...\"] "
        "(e.g. button[name=\"Submit\"]).\n"
        "4. Do not repeat any (strategy, selector) pair already present in failedAttempts.\n"
        "5. No markdown, no code fences, no commentary — raw JSON only."
    )
    return json.dumps(payload), system_instruction


async def propose_locator_fix(
    element: Dict[str, Any], failed_attempts: List[Dict[str, str]]
) -> Tuple[List[Dict[str, str]], str]:
    """
    Asks Gemini for alternative locator candidates after every ranked candidate
    has failed live verification. Fails open: returns ([], "heuristic") on any
    error, timeout, or missing API key. The returned candidates are RAW and
    UNVALIDATED — the caller must re-validate strategy/selector shape (see
    services/browser.py's _validate_locator_fixes) before trying any of them.
    """
    if not failed_attempts or not settings.GEMINI_API_KEY:
        return [], "heuristic"

    contents, system_instruction = _build_fix_request(element, failed_attempts)

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
        if not isinstance(parsed, list):
            raise ValueError("LLM response shape mismatch")
        return parsed, "llm"
    except Exception as e:
        print(f"LLM locator-fix proposal failed, no fix available: {e}")
        return [], "heuristic"


_EXPLORE_ALLOWED_ACTIONS = ("click", "fill", "type", "hover", "check", "select_option", "finish")

_FINISH_DECISION = {"action": "finish", "elementIndex": None, "value": None, "reasoning": "", "finishReason": ""}


def _build_explore_request(
    url: str, candidates: List[Dict[str, Any]], history: List[Dict[str, Any]], goal_prompt: Optional[str]
) -> Tuple[str, str]:
    def snip(value: Any) -> str:
        return str(value or "")[:80]

    candidate_rows = []
    for idx, (_frame, item, _chain) in enumerate(candidates):
        row = {
            "index": idx,
            "tag": item.get("tagName", ""),
            "action": item.get("action", ""),
            "text": snip(item.get("text") or item.get("value")),
            "label": snip(item.get("label") or item.get("placeholder") or item.get("associatedLabel")),
            "disabled": bool(item.get("disabled")),
        }
        if item.get("options"):
            row["options"] = item["options"][:20]
        candidate_rows.append(row)

    payload = {
        "url": url,
        "goal": goal_prompt.strip() if goal_prompt and goal_prompt.strip() else "Discover and interact with as much of this page's UI as possible.",
        "candidates": candidate_rows,
        "recentHistory": history[-15:],
    }

    system_instruction = (
        "You are autonomously exploring a web page through Playwright, one action at a time, "
        "to discover as much of its interactive UI as possible.\n"
        "You will be given the current URL, your goal, a list of candidate elements (each with an "
        "index, tag, suggested action, visible text/label, and whether it's disabled), and a log of "
        "your recent actions so far.\n"
        "Rules:\n"
        "1. Pick exactly ONE candidate by its index and ONE action to perform on it.\n"
        f"2. \"action\" must be exactly one of: {', '.join(_EXPLORE_ALLOWED_ACTIONS)}.\n"
        "3. You CANNOT click/check/select_option a disabled element directly — if you want to enable "
        "one, first find and fill nearby fields that look required (e.g. empty text/email inputs).\n"
        "4. For \"fill\" or \"type\", supply a plausible, realistic \"value\" (e.g. a real-looking email, "
        "name, or number matching the field's apparent purpose).\n"
        "5. For \"select_option\", set \"value\" to one of the candidate's \"options\" values.\n"
        "6. Prefer candidates you haven't already tried (see recentHistory) and actions likely to reveal "
        "new UI (expanding sections, opening menus, filling forms to unlock buttons).\n"
        "7. If you believe you've reasonably explored what's available, or no candidate looks useful, "
        "set \"action\" to \"finish\".\n"
        "8. Return ONLY a raw JSON object: {\"reasoning\": \"...\", \"elementIndex\": <int or null>, "
        "\"action\": \"...\", \"value\": \"...\" or null, \"finishReason\": \"...\" or null}. "
        "No markdown, no code fences, no commentary."
    )
    return json.dumps(payload), system_instruction


async def decide_next_exploration_step(
    url: str, candidates: List[Any], history: List[Dict[str, Any]], goal_prompt: Optional[str]
) -> Dict[str, Any]:
    """
    Asks Gemini which single action to take next during autonomous page
    exploration. Fails open: any error, timeout, missing API key, or malformed/
    out-of-range response returns an implicit {"action": "finish"} decision so
    the exploration loop ends gracefully instead of crashing or hanging.
    """
    if not candidates or not settings.GEMINI_API_KEY:
        return dict(_FINISH_DECISION)

    contents, system_instruction = _build_explore_request(url, candidates, history, goal_prompt)

    def _call() -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.2,
            ),
        )
        return response.text

    try:
        raw = await asyncio.wait_for(asyncio.to_thread(_call), timeout=20)
        parsed = json.loads(_strip_code_fences(raw))
        if not isinstance(parsed, dict):
            raise ValueError("LLM response shape mismatch")

        action = parsed.get("action")
        if action not in _EXPLORE_ALLOWED_ACTIONS:
            raise ValueError(f"Unknown action: {action}")

        if action == "finish":
            return {
                "action": "finish", "elementIndex": None, "value": None,
                "reasoning": str(parsed.get("reasoning") or ""),
                "finishReason": str(parsed.get("finishReason") or ""),
            }

        element_index = parsed.get("elementIndex")
        if not isinstance(element_index, int) or element_index < 0 or element_index >= len(candidates):
            raise ValueError(f"elementIndex out of range: {element_index}")

        value = parsed.get("value")
        if value is not None and not isinstance(value, str):
            value = str(value)

        return {
            "action": action,
            "elementIndex": element_index,
            "value": value,
            "reasoning": str(parsed.get("reasoning") or ""),
            "finishReason": None,
        }
    except Exception as e:
        print(f"LLM exploration-step decision failed, stopping exploration: {e}")
        return dict(_FINISH_DECISION)
