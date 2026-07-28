# **Code Export (cURL & Python / Pydantic)**

## **Overview**

API Explorer allows seamless transition from manual testing to automated codebases via built-in code generators.

## **1. cURL Export**

Clicking the **cURL** button in the header bar opens a modal displaying the exact shell-ready cURL command and copies it to the clipboard automatically.

* All {{env.VARIABLE_NAME}}, {{ input_name }}, and {{$...}} generator placeholders are fully evaluated and resolved to their active dynamic values; the auth hook (if configured) is executed and its Authorization header included, and the Interceptor script runs.
* Includes all headers, query parameters, and body payloads.
* An input that has no bound value is left as the literal {{name}} text in the command rather than raising an error.

## **2. Python & Pydantic Code Generation**

Clicking **Show Python** opens the **Python client** modal with production-ready Python code utilizing pydantic data structures and the requests library.

### **Features**

1. **Request Code**: Generates boilerplate Python code (request body model, headers, and a `call_api()` function) ready to copy into automated test suites or framework scripts. Tokens are resolved to real values just like the cURL export; if resolution fails, the code is still generated with the raw template values and a warning banner.
2. **Pydantic Response Models**:
   * *Requirement*: The request must have recorded at least one **successful response** (HTTP status below 400) — the generator uses the last successful response saved on the request (also visible in the **Last Response** tab).
   * The generator parses the JSON structure of that response payload and automatically creates matching Pydantic class definitions for type-safe data parsing.
   * Without a recorded successful response, the button still works — the generated `call_api()` simply returns `response.json()` as a plain dict, with no response models.

### **Workflow Example**

1. Configure and dispatch your request via **Send**.
2. Verify a successful response in the response panel.
3. Click **Show Python**.
4. Copy the generated Pydantic response models and request invocation code directly into your Python automation repository.
