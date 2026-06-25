import re
import json
from typing import Dict, Any, List
from jinja2 import Template

POM_TEMPLATE = """from playwright.sync_api import Page

class {{ class_name }}:
    \"\"\"Page object for {{ url if url else 'web page' }}.\"\"\"

    def __init__(self, page: Page):
        self.page = page
        {% if parent_locator %}self._frame = self.page.frame_locator('{{ parent_locator }}'){% endif %}

    {% for method in methods %}
    def {{ method.name }}(self, {% if method.action == 'fill' %}value: str{% endif %}) -> None:
        \"\"\"{{ method.docstring if method.docstring else 'Perform action on element.' }}\"\"\"
        {% set target = "self._frame" if parent_locator else "self.page" %}
        {{ target }}{{ method.frame_chain }}.{{ method.strategy }}({% if method.strategy_args %}{{ method.strategy_args }}{% else %}"{{ method.selector }}"{% endif %}).{{ method.action }}({% if method.action == 'fill' %}value{% endif %})

    {% endfor %}
"""

def generate_pom_class(class_name: str, url: str, parent_locator: str, elements: List[Dict[str, Any]]) -> str:
    """
    Renders a Python Playwright Page Object Model class using the Jinja2 template.
    """
    methods = []
    for idx, el in enumerate(elements):
        # Format a clean method name
        element_id = el.get("element_id", f"element_{idx}")
        action = el.get("action", "click")
        method_name = el.get("method_name", f"{action}_{element_id}")
        
        # Clean method name to be valid python variable
        method_name = re.sub(r"[^a-zA-Z0-9_]", "", method_name.lower())
        if not method_name or method_name[0].isdigit():
            method_name = f"action_{method_name}"

        strategy = el.get("strategy", "locator")
        if strategy.startswith("locator"):
            strategy = "locator"
        selector = el.get("selector", "")
        
        # Format the strategy arguments.
        # e.g. for get_by_role, we need page.get_by_role("button", name="...")
        strategy_args = ""
        if strategy == "get_by_role":
            # Selector is role[name="xxx"]
            match = re.match(r'([^\[]+)\[name="([^"]+)"\]', selector)
            if match:
                role_type = match.group(1)
                role_name = match.group(2).replace('"', '\\"')
                strategy_args = f'"{role_type}", name="{role_name}"'
            else:
                escaped_selector = selector.replace('"', '\\"')
                strategy_args = f'"{escaped_selector}"'
        else:
            escaped_selector = selector.replace('"', '\\"')
            strategy_args = f'"{escaped_selector}"'

        # Resolve iframe locators chain
        frame_locators = el.get("frame_locators", el.get("frameLocators", []))
        frame_chain = ""
        if frame_locators:
            for fl in frame_locators:
                frame_chain += f".frame_locator('{fl}')"

        docstring = f"Perform {action} on {strategy}: {selector}"
        if frame_locators:
            docstring += f" (inside iframe: {' -> '.join(frame_locators)})"

        methods.append({
            "name": method_name,
            "action": action,
            "strategy": strategy,
            "selector": selector,
            "strategy_args": strategy_args,
            "frame_chain": frame_chain,
            "docstring": docstring
        })

    t = Template(POM_TEMPLATE)
    return t.render(
        class_name=class_name,
        url=url,
        parent_locator=parent_locator,
        methods=methods
    )

def json_to_pydantic_code(schema_name: str, json_data: Any, generated_models: Dict[str, str] = None) -> tuple:
    """
    Recursively analyzes a JSON payload and generates Pydantic model definitions.
    Returns (root_model_class_name, dictionary_of_all_pydantic_classes_code).
    """
    if generated_models is None:
        generated_models = {}

    if json_data is None:
        return "Any", generated_models

    if isinstance(json_data, dict):
        fields = []
        for key, val in json_data.items():
            # Create a safe Python field name
            field_name = re.sub(r"[^a-zA-Z0-9_]", "", key)
            if not field_name or field_name[0].isdigit():
                field_name = f"field_{field_name}"

            # Compute field type
            if isinstance(val, dict):
                sub_model_name = "".join(x.capitalize() for x in key.split("_")) + "Model"
                sub_type, _ = json_to_pydantic_code(sub_model_name, val, generated_models)
                fields.append(f"    {field_name}: Optional[{sub_type}] = None")
            elif isinstance(val, list):
                if val:
                    first_item = val[0]
                    if isinstance(first_item, dict):
                        sub_model_name = "".join(x.capitalize() for x in key.split("_")) + "Item"
                        sub_type, _ = json_to_pydantic_code(sub_model_name, first_item, generated_models)
                        fields.append(f"    {field_name}: List[{sub_type}] = []")
                    else:
                        py_type = type(first_item).__name__
                        fields.append(f"    {field_name}: List[{py_type}] = []")
                else:
                    fields.append(f"    {field_name}: List[Any] = []")
            else:
                py_type = type(val).__name__ if val is not None else "Any"
                fields.append(f"    {field_name}: Optional[{py_type}] = None")

        fields_code = "\n".join(fields) if fields else "    pass"
        model_code = f"class {schema_name}(BaseModel):\n{fields_code}\n"
        generated_models[schema_name] = model_code
        return schema_name, generated_models

    elif isinstance(json_data, list):
        if json_data:
            first_item = json_data[0]
            if isinstance(first_item, dict):
                item_model_name = schema_name + "Item" if not schema_name.endswith("Item") else schema_name
                sub_type, _ = json_to_pydantic_code(item_model_name, first_item, generated_models)
                return f"List[{sub_type}]", generated_models
            else:
                py_type = type(first_item).__name__
                return f"List[{py_type}]", generated_models
        return "List[Any]", generated_models

    return type(json_data).__name__, generated_models

def generate_http_client(base_url: str, requests_logs: List[Dict[str, Any]]) -> str:
    """
    Groups recorded HTTP requests, generates Pydantic schemas for requests & responses,
    and returns a clean httpx-based Python API client script.
    """
    models_code_map = {}
    client_methods = []
    
    # Imports
    code_lines = [
        "import httpx",
        "from pydantic import BaseModel",
        "from typing import List, Optional, Any",
        ""
    ]

    for idx, log in enumerate(requests_logs):
        url_path = log.get("url", "").replace(base_url, "")
        if not url_path.startswith("/"):
            url_path = "/" + url_path
            
        method = log.get("method", "GET").upper()
        
        # Determine method name
        clean_path = re.sub(r"[^a-zA-Z0-9_]", "_", url_path)
        method_name = f"{method.lower()}{clean_path}".strip("_")
        method_name = re.sub(r"_+", "_", method_name)

        # Parse request body for Pydantic request payload
        req_payload_class = None
        req_body = log.get("postData", None)
        if req_body and method in ["POST", "PUT", "PATCH"]:
            try:
                body_json = json.loads(req_body) if isinstance(req_body, str) else req_body
                model_name = "".join(x.capitalize() for x in method_name.split("_")) + "Request"
                req_payload_class, _ = json_to_pydantic_code(model_name, body_json, models_code_map)
            except Exception:
                pass

        # Parse response body for Pydantic response payload
        resp_payload_class = None
        resp_body = log.get("responseBody", None)
        if resp_body:
            try:
                body_json = json.loads(resp_body) if isinstance(resp_body, str) else resp_body
                model_name = "".join(x.capitalize() for x in method_name.split("_")) + "Response"
                resp_payload_class, _ = json_to_pydantic_code(model_name, body_json, models_code_map)
            except Exception:
                pass

        # Build method code block
        params = ["self"]
        if req_payload_class:
            params.append(f"payload: {req_payload_class}")
        
        params_str = ", ".join(params)
        return_type = resp_payload_class if resp_payload_class else "Any"
        
        method_body = [
            f"    def {method_name}({params_str}) -> {return_type}:",
            f'        """{method} {url_path}"""'
        ]

        # Call URL format
        caller_args = [f'"{url_path}"']
        if req_payload_class:
            caller_args.append("json=payload.model_dump()")

        caller_args_str = ", ".join(caller_args)
        method_body.append(f'        response = self.client.{method.lower()}({caller_args_str})')
        method_body.append("        response.raise_for_status()")
        
        if resp_payload_class:
            if resp_payload_class.startswith("List["):
                item_model = resp_payload_class[5:-1]
                method_body.append(f'        return [{item_model}.model_validate(item) for item in response.json()]')
            else:
                method_body.append(f'        return {resp_payload_class}.model_validate(response.json())')
        else:
            method_body.append("        return response.json()")
        
        client_methods.append("\n".join(method_body))

    # Append all generated models code block
    for model_name, model_code in models_code_map.items():
        code_lines.append(model_code)
        code_lines.append("")

    # Generate the class code
    class_name = "".join(x.capitalize() for x in re.sub(r"[^a-zA-Z0-9]", " ", base_url).split()) + "Client"
    if not class_name:
        class_name = "ApiClient"

    client_code = [
        f"class {class_name}:",
        f'    def __init__(self, base_url: str = "{base_url}", token: str = None):',
        f'        self.client = httpx.Client(base_url=base_url)',
        f'        if token:',
        f'            self.client.headers.update({{"Authorization": f"Bearer {{token}}"}})',
        ""
    ]

    for m in client_methods:
        client_code.append(m)
        client_code.append("")

    code_lines.extend(client_code)
    return "\n".join(code_lines)
