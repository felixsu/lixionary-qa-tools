# **Parameterization & Variable Scope**

## **Overview**

API Explorer supports dynamic substitution across three scopes: **Environment Variables** (env), **Runtime Input Variables** (input), and **Dynamic Value Generators** ($).

## **Variable Types & Syntax**

### **1. Environment Variables ({{env.VARIABLE_NAME}})**

* **Syntax**: {{env.KEY_NAME}}
* **Scope**: Global / Workspace level, toggled via the **Active env** dropdown in the global top navbar (defaults to *No environment*).
* **Management**: Environments are created and edited on the separate **Environments** page — create, edit, duplicate, and delete environments; each variable can be flagged as **secret** (its value renders masked); the active environment shows an *Active* pill.
* **Usage**: Ideal for infrastructure and system parameters such as BASE_URL, SYSTEM_ID, API_KEY, or AUTH_TOKEN.
* **Example**:
  POST {{env.BASE_URL}}/{{env.SYSTEM_ID}}/v1/orders

### **2. Input Variables ({{ input_name }})**

* **Syntax**: {{ input_name }} inside URLs, header values, query-param values, body payloads, or auth fields.
* **Scope**: Request-specific input parameters.
* **Detection**: Any string matching the double curly-brace pattern {{ name }} — without the env. prefix or a leading $ — is automatically recognized and exposed in the **Input** tab. Header/param *keys* and scripts are not scanned.
* **API Studio Linking**: Input variables declared here appear as configurable input mappings when this request is used inside **API Studio** workflows.

### **3. Dynamic Value Generators ({{$...}})**

* Generator tokens produce a fresh value at execution time: {{$date:+1d:YYYY-MM-DD}} (date with offset and format), {{$randomInt:4}} (random number with N digits), {{$randomEmail}}, {{$randomFirstName}}, {{$randomLastName}}, {{$randomFullName}}.
* They can be typed manually or inserted via the **Insert value** popover available in the Body editor and the Input tab.

## **Request Configuration Tabs**

### **1. Headers**

* Define custom HTTP header key-value pairs (e.g., Content-Type: application/json, X-Tracking-ID: {{env.TRACKING_ID}}) via **Add header**.
* Rows with an empty header name are ignored at send time. To exclude a header, delete its row with the trash icon (there are no per-row enable/disable toggles).

### **2. Params (Query Parameters)**

* Add key-value query parameters via **Add param**; they are appended to the URL with standard URL encoding when the request executes.
* Example: Key page = 1, Key limit = 20 appends ?page=1&limit=20 to the request URL.
* **Note**: Params are independent of the URL bar — a query string typed directly into the URL stays there and does not populate this tab (and vice versa).

### **3. Auth**

Configure the request's authorization via the **Auth type** dropdown. Four options are available:

* **No auth**: No authentication is applied.
* **Bearer token**: A single Token field (supports {{env.VARIABLE}} and {{input}}) sent as `Authorization: Bearer <token>`.
* **Header API key**: A custom header key/value pair for API-key style auth.
* **Dynamic auth hook**: Select one of your **Auth functions** to compute credentials or auto-refresh OAuth tokens just before dispatch. If the hook returns an object, fill the **Token field** input (e.g. `access_token`) to pick which property to use; leave it blank for hooks returning a plain string. Auth functions are managed on the dedicated **Auth functions** page, which includes ready-made Ninja Van presets (**Operator V2** client-credentials OAuth and **PUDO** login).

### **4. Input**

* Review and assign values to all detected {{ input_name }} placeholders present in the URL, headers, params, body, or auth fields.
* Each input's source is either **Literal** (a fixed value, which may itself contain {{env.X}} and {{$...}} tokens) or **Generator** (pick a dynamic value from the **Choose generator…** popover).
* An unbound literal input is sent as the raw `{{name}}` text.
* Inputs are resolved **once per run** — a generator referenced in several places yields the same value everywhere.
* Saved bindings whose token no longer appears in the request render struck-through as stale and are removed on the next save.

### **5. Description**

* Markdown editor with **Write** / **Preview** modes to describe the endpoint business logic, payload requirements, and context.
* **Improve with AI**: Click the button to have AI polish your draft; a review modal lets you compare and either **Keep my draft** or **Use this version** (the result is not auto-saved — press Save afterwards).
* **Search & AI Integration**: The description is semantically indexed, powering the sidebar search's description matching, and provides context to the AI parser generator.

### **6. Body**

* Main request payload editor supporting three types: **None**, **JSON**, and **Text**.
* For JSON bodies, **Pretty** and **Minify** buttons reformat the payload (invalid JSON shows an error toast); a **Copy** button copies the body.
* The **Insert value** button opens the generator popover to insert dynamic tokens (dates with offsets, random numbers, random emails/names) at the cursor.
