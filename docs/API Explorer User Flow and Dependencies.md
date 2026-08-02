# **API Explorer Documentation Hierarchy**

Below is the complete user guide structure for **API Explorer**, organized into a high-level **Parent Page** (Overview & Fundamentals) and focused **Child Pages** for detailed functional reference.

# ** API Explorer Overview**

## **Introduction**

**API Explorer** is an integrated workspace within Lixionary designed for designing, testing, and executing HTTP API requests against backend services. Similar to tools like Postman, it allows QA engineers, developers, and automation specialists to interactive call endpoints, manage environment-aware collections, write assertion tests, and export execution scripts or models directly into automation frameworks.

┌────────────────────────────────────────────────────────────────────────────────────────┐  
│                                   API Explorer Workspace                               │  
├────────────────────────────────┬───────────────────────────────────────────────────────┤  
│ Sidebar (Collections)          │ Main Workspace (Request / Response Pane)               │  
│ \- Connected Collections (Sync) │ \- Top Bar: Method, Environment URL, Save, cURL, Python│  
│ \- Local / Imported Collections │ \- Request Tabs: Headers, Params, Auth, Input, Output...│  
│ \- Search & Navigation          │ \- Response View: Pretty, Headers, Raw, Extracted, Tests│  
└────────────────────────────────┴───────────────────────────────────────────────────────┘

## **Core Capabilities**

1. **Shared & Isolated Collections**: Collaborative, real-time synced collections for teams or isolated local JSON clones for individual experimentation.  
2. **Environment & Input Dynamic Injection**: Native template string parsing using {{env.VARIABLE\_NAME}} for infrastructure variables and {{ input\_name }} for dynamic test parameters.  
3. **API Studio Interoperability**: Input and Output parameter definitions allow API Explorer requests to serve as modular components in multi-step API workflows.  
4. **Automated Testing & Interceptors**: Write custom JavaScript pre-request interceptors and post-execution assertions using standard test helpers.  
5. **Code & Model Generation**: Instantly generate resolved cURL commands or auto-generate Pydantic models and ready-to-run Python code snippet wrappers.

## **Workspace Layout At a Glance**

The API Explorer interface is split into two primary areas:

### **1\. Left Sidebar (Collections Navigation)**

* **Search Bar**: Quick-filter requests across collections by name, endpoint path, or description text.  
* **Connect Collection**: Join a shared collection via ID to enable real-time collaboration.  
* **Import/Export**: Drag-and-drop or load JSON collection blueprints.  
* **Tree View**: Hierarchical organization of collections, folders, and individual endpoint operations (GET, POST, PUT, DELETE).

### **2\. Main Workbench (Request & Response Inspector)**

* **Header Bar**: Displays HTTP Method selection, request target URL with variable interpolation, Save action, cURL generator, Show Python code window, and the Send execution trigger.  
* **Request Configuration Tabs**: Customize headers, params, security context, runtime inputs, declared outputs, validation scripts, interceptors, and documentation.  
* **Response View Area**: Rendered output, raw payloads, HTTP headers, extracted variables, test execution outcomes, and historical execution stats.

## **User Guide Navigation (Child Pages)**

* Child Page 1: Collections Management  
* Child Page 2: Request Builder & Execution  
* Child Page 3: Parameterization & Variable Scope (Env & Inputs)  
* Child Page 4: Interceptors & Test Scripting  
* Child Page 5: Outputs & API Studio Integration  
* Child Page 6: Code Export (cURL & Python / Pydantic)

# **\[Child Page 1\] Collections Management**

## **Overview**

Collections organize related API requests into structured groups. API Explorer supports two distinct collection modes: **Connected (Shared) Collections** and **Local / Cloned Collections**.

## **Collection Types**

### **1\. Connected Collections (Real-time Sync)**

* **Purpose**: Best suited for team environments where endpoint definitions, standard payloads, and environment configurations must remain synchronized across all team members.  
* **How it works**: Connecting to a collection using its unique **Collection ID** creates a live link. Any addition, edit, or deletion of a request within a connected collection is immediately pushed to all subscribers.  
* **Best Practice**: Use environment variables (e.g., {{env.BASE\_URL}}) within connected collections so team members can run identical requests against different target environments (QA, Staging, Local) without modifying endpoint definitions.

### **2\. Local / Cloned Collections**

* **Purpose**: Ideal for isolated testing, experimental payload modifications, or offline work without risking shared team configurations.  
* **How it works**: Importing a collection via JSON creates a local clone completely detached from the origin collection.

## **Operations**

### **Connecting to a Collection**

1. Locate the **Connect collection by ID...** input in the left sidebar.  
2. Paste the target Collection ID.  
3. Click **Connect**. The collection and its folder hierarchy will appear in your tree view.

### **Importing a Collection**

1. Click the **Import from JSON file** button.  
2. Select a valid API Explorer collection JSON file.  
3. A isolated clone will be instantiated in your collection tree.

### **Exporting a Collection**

1. Hover over or right-click the target collection in the sidebar.  
2. Select **Export**.  
3. Download the JSON definition file for backups or sharing offline.

# **\[Child Page 2\] Request Builder & Execution**

## **Overview**

The Request Builder provides a unified header bar to construct, persist, and execute HTTP requests.

## **Action Controls**

| Element | Description | Keyboard Shortcut |
| :---- | :---- | :---- |
| **HTTP Method Selector** | Select standard verbs (GET, POST, PUT, DELETE, etc.). | — |
| **URL Input Bar** | Target address line supporting variable injection. | — |
| **Save Button** | Persists changes to the current request in your collection. | CMD \+ S / CTRL \+ S |
| **cURL Button** | Opens a modal displaying the fully resolved cURL command. | — |
| **Show Python** | Generates Pydantic models and ready-to-run Python HTTP code. | — |
| **Send Button** | Dispatches the request to the configured target endpoint. | CTRL \+ Enter |

## **URL Construction & Method Selection**

* Choose the appropriate HTTP method from the dropdown menu to match your API specification.  
* Enter the full endpoint path or utilize environment placeholders directly in the address line.  
  * Example: {{env.BASE\_URL}}/{{env.SYSTEM\_ID}}/order-search/search/masked

# **\[Child Page 3\] Parameterization & Variable Scope**

## **Overview**

API Explorer supports dynamic substitution across two distinct scopes: **Environment Variables** (env) and **Runtime Input Variables** (input).

## **Variable Types & Syntax**

### **1\. Environment Variables ({{env.VARIABLE\_NAME}})**

* **Syntax**: {{env.KEY\_NAME}}  
* **Scope**: Global / Workspace level, toggled via the active environment selector (e.g., QA SG) in the top navbar.  
* **Usage**: Ideal for infrastructure and system parameters such as BASE\_URL, SYSTEM\_ID, API\_KEY, or AUTH\_TOKEN.  
* **Example**:  
  POST {{env.BASE\_URL}}/{{env.SYSTEM\_ID}}/v1/orders

### **2\. Input Variables ({{ input\_name }})**

* **Syntax**: {{ input\_name }} or {{ input\_name }} inside URLs, headers, or body payloads.  
* **Scope**: Request-specific input parameters.  
* **Detection**: Any string matching the double curly-brace pattern {{ name }} (without the env. prefix) is automatically recognized by the engine and exposed in the **Input Tab**.  
* **API Studio Linking**: Input variables declared here populate automatically as configurable input fields when this request is imported into **API Studio** workflows.

## **Request Configuration Tabs**

### **1\. Headers**

* Define custom HTTP header key-value pairs (e.g., Content-Type: application/json, X-Tracking-ID: {{env.TRACKING\_ID}}).  
* Toggle individual headers on or off using checkboxes.

### **2\. Params (Query Parameters)**

* Add key-value query parameters that automatically append to the end of the URL using standard URL encoding.  
* Example: Key page \= 1, Key limit \= 20 appends ?page=1\&limit=20 to the request URL.

### **3\. Auth**

* Configure authorization mechanics for the request.  
* **Dynamic Auth Hook**: For specialized backend ecosystems (such as Ninja Van requests), select the Dynamic Auth hook provider to compute signatures or auto-refresh OAuth tokens prior to dispatch.

### **4\. Input**

* Review and assign values to all detected {{ input\_name }} placeholders present in the URL, headers, or request body.

### **5\. Description**

* Free-text / Markdown editor to describe the endpoint business logic, payload requirements, and context.  
* **LLM Assistant Integration**: The written description is utilized by AI assistants and LLMs to understand the semantic context of the endpoint, enabling automatic sequencing of consecutive requests in automated flows.

### **6\. Body**

* Main request payload editor supporting JSON, Text, Form-Data, and x-www-form-urlencoded formats.

# **\[Child Page 4\] Scripting & Automated Testing**

## **Overview**

API Explorer provides JavaScript-based pre-request processing (**Interceptor**) and post-request verification (**Test**) capabilities.

## **1\. Interceptor (Pre-Request Scripts)**

The **Interceptor** tab executes custom JavaScript logic *before* the request payload is transmitted across the network.

* **Use Cases**:  
  * Calculating cryptographic signatures or HMAC hashes on the fly.  
  * Generating dynamic timestamps or UUIDs.  
  * Modifying request headers or transforming payload structure dynamically before dispatch.  
* **Behavior**: Works similarly to Postman's pre-request scripts.

## **2\. Test (Post-Request Assertions)**

The **Test** tab runs JavaScript assertion logic immediately after receiving an API response.

### **Predefined Global Objects**

* request: Read-only representation of the transmitted request details (URL, headers, body).  
* response: The server response context, containing:  
  * response.status (number)  
  * response.headers (object)  
  * response.body (parsed JSON object or raw string)  
* test(description: string, condition: boolean): Assertion helper function.

### **Code Example**

if (response && response.body) {  
  var body \= response.body;  
  var order\_id \= body.id;  
  var transactions \= body.transactions;  
  var last\_transaction \= transactions\[transactions.length \- 1\];  
  var waypoint\_id \= last\_transaction.waypointId;

  // Execute test assertions  
  test("Order ID exists", order\_id \!= null);  
  test("Waypoint ID is not null", waypoint\_id \!= null);  
}

# **\[Child Page 5\] Outputs & API Studio Integration**

## **Overview**

The **Output** tab bridges individual API requests with **API Studio**, allowing users to transform raw API responses into reusable variables across automation pipelines.

## **Configuring Output Variables**

1. Open the **Output** tab in the Request Editor.  
2. Click **Add** (or **Manage**) and declare output names (e.g., extracted\_order\_id) — they appear as chips.  
3. Write one JavaScript **parser script** that runs after the response and assigns each declared output onto the injected output object (env.get(key) reads and env.set(key, value) writes environment variables):  
   output.extracted\_order\_id \= response.body.data.order.id;

4. Use **Debug** to re-run the script against the last recorded response (no request is sent; console.log output is captured), or the AI assist to generate the script from a plain-English description.  
5. Executed requests will display extracted outputs under the **Extracted** tab in the response pane, with warnings for declared outputs the script did not set.

## **Integration with API Studio**

When this request node is used inside **API Studio**:

* Declared **Inputs** become node input ports.  
* Declared **Outputs** become node output ports, allowing downstream nodes to ingest values produced by this API request.

# **\[Child Page 6\] Code Export (cURL & Python / Pydantic)**

## **Overview**

API Explorer allows seamless transition from manual testing to automated codebases via built-in code generators.

## **1\. cURL Export**

Clicking the **cURL** button in the header bar opens a modal displaying the exact shell-ready cURL command.

* All {{env.VARIABLE\_NAME}} and {{ input\_name }} placeholders are fully evaluated and resolved to their active dynamic values.  
* Includes all enabled headers, query parameters, and body payloads.

## **2\. Python & Pydantic Code Generation**

Clicking **Show Python** generates production-ready Python code utilizing pydantic data structures and httpx/requests libraries.

### **Features**

1. **Request Code**: Generates boilerplate Python code ready to copy into automated test suites or framework scripts.  
2. **Pydantic Response Models**:  
   * *Requirement*: You must execute the request at least **once with a successful (2xx) response**.  
   * The generator parses the JSON structure of the latest response payload and automatically creates matching Pydantic class definitions for type-safe data parsing.

### **Workflow Example**

1. Configure and dispatch your request via **Send**.  
2. Verify a successful response in the response panel.  
3. Click **Show Python**.  
4. Copy the generated Pydantic response models and request invocation code directly into your Python automation repository.