"""Bring-your-own-key LLM provider abstraction for the local sidecar.

API keys live in the device-local `local_prefs` SQLite table (never synced to
the cloud) under a single JSON pref:

    llm_settings = {
        "activeProvider": "claude" | "minimax" | "gemini" | null,
        "keys": {"claude": "...", "minimax": "...", "gemini": "..."},
        "models": {"claude": "...", ...},  # optional per-provider model override
        "minimaxBaseUrl": "..."   # optional override, e.g. mainland endpoint
    }

Every generation feature goes through generate()/generate_sync() on whichever
provider is active. Settings are re-read from SQLite on each call (a local
point-read), so a Settings save takes effect immediately.
"""

import asyncio
import json
import re
from typing import Any, Dict, Optional, Tuple

from db.local_store import LocalStore

PROVIDERS = ("claude", "minimax", "gemini")

LLM_SETTINGS_PREF_KEY = "llm_settings"

# Used when the user hasn't picked a model for a provider in Settings.
DEFAULT_MODELS = {
    "claude": "claude-opus-5",
    "minimax": "MiniMax-M2.5",
    "gemini": "gemini-3.5-flash",
}
# International endpoint; mainland accounts use https://api.minimaxi.com/v1/chat/completions
# (overridable via the optional "minimaxBaseUrl" pref field).
MINIMAX_CHAT_URL = "https://api.minimax.io/v1/chat/completions"

NOT_CONFIGURED_MESSAGE = (
    "No AI provider configured. Add an API key in Settings and choose an active provider."
)

# MiniMax-M2 is a reasoning model that may emit <think>...</think> blocks in
# message content; they must be stripped or downstream JSON parsing breaks.
_THINK_TAG_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMNotConfiguredError(Exception):
    def __init__(self, message: str = NOT_CONFIGURED_MESSAGE):
        super().__init__(message)


def get_llm_settings() -> Dict[str, Any]:
    raw = LocalStore.get_pref(LLM_SETTINGS_PREF_KEY)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def active_provider_key() -> Optional[Tuple[str, str]]:
    """Returns (provider, api_key) for the active provider, or None."""
    settings = get_llm_settings()
    provider = settings.get("activeProvider")
    if provider not in PROVIDERS:
        return None
    keys = settings.get("keys")
    key = (keys or {}).get(provider) if isinstance(keys, dict) else None
    if not isinstance(key, str) or not key.strip():
        return None
    return provider, key.strip()


def is_configured() -> bool:
    return active_provider_key() is not None


def model_for(provider: str) -> str:
    """The user's chosen model for a provider, or the built-in default."""
    models = get_llm_settings().get("models")
    chosen = (models or {}).get(provider) if isinstance(models, dict) else None
    if isinstance(chosen, str) and chosen.strip():
        return chosen.strip()
    return DEFAULT_MODELS[provider]


def _generate_claude(
    key: str,
    model: str,
    system_instruction: str,
    prompt: str,
    max_output_tokens: int,
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=key)
    # Current Claude models reject temperature/top_p (400) — never forward them.
    # Thinking is on by default; effort "low" keeps these small JSON tasks fast.
    # Haiku-tier models don't accept the effort parameter, so skip it there.
    kwargs = {} if "haiku" in model.lower() else {"output_config": {"effort": "low"}}
    response = client.messages.create(
        model=model,
        max_tokens=max_output_tokens,
        system=system_instruction,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined this request (stop_reason: refusal).")
    return "".join(block.text for block in response.content if block.type == "text")


def _generate_gemini(
    key: str,
    model: str,
    system_instruction: str,
    prompt: str,
    temperature: Optional[float],
    top_p: Optional[float],
    max_output_tokens: int,
) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    config_kwargs: Dict[str, Any] = {
        "system_instruction": system_instruction,
        "max_output_tokens": max_output_tokens,
    }
    if temperature is not None:
        config_kwargs["temperature"] = temperature
    if top_p is not None:
        config_kwargs["top_p"] = top_p
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    return response.text or ""


def _generate_minimax(
    key: str,
    model: str,
    system_instruction: str,
    prompt: str,
    temperature: Optional[float],
    top_p: Optional[float],
    max_output_tokens: int,
) -> str:
    import httpx

    base_url = get_llm_settings().get("minimaxBaseUrl") or MINIMAX_CHAT_URL
    body: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_output_tokens,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
    }
    if temperature is not None:
        body["temperature"] = temperature
    if top_p is not None:
        body["top_p"] = top_p
    response = httpx.post(
        base_url,
        json=body,
        headers={"Authorization": f"Bearer {key}"},
        timeout=55.0,
    )
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        # MiniMax reports some errors as 200 with a base_resp status block.
        base_resp = data.get("base_resp") or {}
        detail = base_resp.get("status_msg") or "empty choices in response"
        raise RuntimeError(f"MiniMax returned no completion: {detail}")
    content = (choices[0].get("message") or {}).get("content") or ""
    return _THINK_TAG_RE.sub("", content).strip()


def generate_sync(
    system_instruction: str,
    prompt: str,
    *,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    max_output_tokens: int = 4096,
) -> str:
    """Blocking single-shot text generation on the active provider.

    temperature/top_p are advisory — the Claude branch drops them (the API
    rejects them). Raises LLMNotConfiguredError when no provider is set up.
    """
    active = active_provider_key()
    if active is None:
        raise LLMNotConfiguredError()
    provider, key = active
    model = model_for(provider)
    if provider == "claude":
        return _generate_claude(key, model, system_instruction, prompt, max_output_tokens)
    if provider == "minimax":
        return _generate_minimax(key, model, system_instruction, prompt, temperature, top_p, max_output_tokens)
    return _generate_gemini(key, model, system_instruction, prompt, temperature, top_p, max_output_tokens)


async def generate(
    system_instruction: str,
    prompt: str,
    *,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    max_output_tokens: int = 4096,
    timeout: float = 60.0,
) -> str:
    return await asyncio.wait_for(
        asyncio.to_thread(
            generate_sync,
            system_instruction,
            prompt,
            temperature=temperature,
            top_p=top_p,
            max_output_tokens=max_output_tokens,
        ),
        timeout=timeout,
    )


def verify_key_sync(provider: str, key: str, model: Optional[str] = None) -> Tuple[bool, str]:
    """Minimal round trip to validate a key against the model that generation
    will actually use. Returns (ok, human-readable message)."""
    if provider not in PROVIDERS:
        return False, f"Unknown provider: {provider}"
    key = (key or "").strip()
    if not key:
        return False, "API key is empty."
    model = (model or "").strip() or model_for(provider)
    system = "You are a connectivity check."
    prompt = "Reply with OK"
    try:
        if provider == "claude":
            # max_tokens caps thinking + text on current Claude models — leave headroom.
            _generate_claude(key, model, system, prompt, max_output_tokens=256)
        elif provider == "minimax":
            _generate_minimax(key, model, system, prompt, None, None, max_output_tokens=64)
        else:
            _generate_gemini(key, model, system, prompt, None, None, max_output_tokens=16)
        return True, f"Key verified with {model}."
    except Exception as e:
        return False, f"Verification failed: {e}"
