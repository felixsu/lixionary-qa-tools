"""Prompt text shared between the cloud backend and the local sidecar.

The description base prompt is admin-configurable in the cloud (Mongo
app_settings); this default is the fallback used both by the cloud settings
endpoints and by the sidecar's improve-description route when the frontend
couldn't fetch the configured value.
"""

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
