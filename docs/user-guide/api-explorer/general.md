# **API Explorer Overview**

## **Introduction**

**API Explorer** is an integrated workspace within Lixionary designed for designing, testing, and executing HTTP API requests against backend services. Similar to tools like Postman, it allows QA engineers, developers, and automation specialists to interactively call endpoints, manage environment-aware collections, write assertion tests, and export execution scripts or models directly into automation frameworks.

┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   API Explorer Workspace                               │
├────────────────────────────────┬───────────────────────────────────────────────────────┤
│ Sidebar (Collections)          │ Main Workspace (Request / Response Pane)              │
│ - Connected Collections (Sync) │ - Top Bar: Method, URL, Save, cURL, Show Python, Send │
│ - Local / Imported Collections │ - Request Tabs: Headers, Params, Auth, Input, Output… │
│ - Search & Navigation          │ - Response View: Pretty, Headers, Raw, Extracted,     │
│                                │   Tests, Last Response                                │
└────────────────────────────────┴───────────────────────────────────────────────────────┘

## **Core Capabilities**

1. **Shared & Isolated Collections**: Collaborative collections synced in the background across team members (on app load, on window focus, every 5 minutes, or on demand via the **Sync now** control in the left navigation rail), or isolated local JSON clones for individual experimentation.
2. **Environment & Input Dynamic Injection**: Native template string parsing using {{env.VARIABLE_NAME}} for infrastructure variables and {{ input_name }} for dynamic test parameters.
3. **API Studio Interoperability**: Input and Output parameter definitions allow API Explorer requests to serve as modular components in multi-step API workflows.
4. **Automated Testing & Interceptors**: Write custom JavaScript pre-request interceptors and post-execution assertions using standard test helpers.
5. **Code & Model Generation**: Instantly generate resolved cURL commands or auto-generate Pydantic models and ready-to-run Python code snippet wrappers.

## **Workspace Layout At a Glance**

The API Explorer interface is split into two primary areas:

### **1. Collections Navigation**

* **Search Bar**: Quick-filter requests across collections by name, endpoint path, or description text.
* **Connect Collection**: Join a shared collection via ID to enable collaboration.
* **Import/Export**: Load and download JSON collection blueprints.
* **Tree View**: Hierarchical organization of collections, sub-collections, and individual endpoint operations (GET, POST, PUT, PATCH, DELETE).

### **2. Main Workbench (Request & Response Inspector)**

* **Header Bar**: Displays HTTP Method selection (GET, POST, PUT, PATCH, DELETE), request target URL with variable interpolation, Save action, cURL generator, Show Python code window, and the Send execution trigger.
* **Request Configuration Tabs**: Customize headers, params, security context, runtime inputs, declared outputs, validation scripts, interceptors, documentation, and body payload.
* **Response View Area**: Rendered output (**Pretty**), HTTP **Headers**, **Raw** payloads, **Extracted** output variables, **Tests** execution outcomes, and the **Last Response** recorded from the most recent successful run.

> **Note**: The active environment is selected via the **Active env** dropdown in the global top navbar (shared with API Studio and Web Explorer), not inside the API Explorer page itself.

## **User Guide Navigation (Child Pages)**

* [Child Page 1: Collections Management](collection.md)
* [Child Page 2: Request Builder & Execution](request-builder-and-execution.md)
* [Child Page 3: Parameterization & Variable Scope (Env & Inputs)](parameterization-and-variable-scope.md)
* [Child Page 4: Interceptors & Test Scripting](scripting-and-automated-testing.md)
* [Child Page 5: Outputs & API Studio Integration](output-and-api-studio-integration.md)
* [Child Page 6: Code Export (cURL & Python / Pydantic)](code-export.md)
