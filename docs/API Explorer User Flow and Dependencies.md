# API Explorer: User Flow & Dependency Guide

This document explains the **API Automation Explorer** module, its core dependencies (**Environments** and **Auth Hook Functions**), and the step-by-step user flow for executing requests and chaining variables.

---

## 1. Core Mental Model & Dependency Hierarchy

To effectively use the API Explorer, it is essential to understand the four key entities and how they relate:

```mermaid
graph TD
    classDef main fill:#312e81,stroke:#4338ca,stroke-width:2px,color:#fff;
    classDef config fill:#1e293b,stroke:#475569,stroke-width:1px,color:#fff;
    classDef runtime fill:#064e3b,stroke:#059669,stroke-width:1px,color:#fff;

    Env["Environments <br>(Variables Context)"]:::config
    AuthFunc["Auth Hook Functions <br>(JS Sandboxed Scripts)"]:::config
    Collection["Collections & Requests <br>(API Definitions)"]:::main
    Sandbox["QuickJS Sandbox <br>(Backend Execution)"]:::runtime
    Executor["API Proxy Executor <br>(FastAPI Backend)"]:::runtime

    Env -->|Provides variables to| AuthFunc
    Env -->|Interpolates values in| Collection
    AuthFunc -->|Executes in| Sandbox
    Sandbox -->|Returns Cached Token| Executor
    Executor -->|Injects Bearer Token| Collection
    Collection -->|Runs Response Parser in| Sandbox
    Sandbox -->|Updates variable values| Env
```

1. **Environments**: The global context containing key-value variable sets (e.g., `BASE_URL`, `CLIENT_SECRET`). These variables are referenced with an explicit prefix: `{{env.VARIABLE_NAME}}`.
2. **Auth Hook Functions**: Programmatic JavaScript scripts executed inside a secure backend sandbox (QuickJS). They access Environment variables, make an HTTP call to retrieve an authentication token, and cache it according to a TTL (expires-in config) or the JWT's `exp` claim.
3. **Collections & Requests**: Stored HTTP request definitions (URL, Method, Headers, Query Params, Payload) grouped by folder/collection. They can reference Environment variables and designate an **Auth Hook Function** for dynamic authentication. Each request additionally carries **Inputs** and **Outputs** (see below).
4. **Request Inputs**: Any bare `{{name}}` token (no `env.` prefix, no `$`) in the URL, headers, params, body, or auth fields is an input of the request. The **Input** tab lists detected inputs and binds each to either a free-typed literal value or a built-in generator (date with offset/format, random int, random email/name). Bindings are resolved once per run, so a generator used in several places yields one consistent value. Inline `{{$date:...}}`-style tokens still work and re-roll per occurrence.
5. **Request Outputs (Response Parser)**: A request declares its output names on the **Output** tab (e.g. `order_id`). The post-execution parser script must assign each one onto the injected `output` object (`output.order_id = ...`); results appear in the **Extracted** response tab, with warnings for declared outputs the script did not set. The script can also call `env.set(key, value)` to write into the active Environment — those are env writes, not outputs.

**Token grammar summary:**

| Token | Meaning |
| :--- | :--- |
| `{{env.NAME}}` | Environment variable `NAME` |
| `{{name}}` | Request input, bound in the Input tab (unbound tokens are sent literally) |
| `{{$date:+1d:YYYY-MM-DD}}`, `{{$randomInt:4}}`, `{{$randomEmail}}`, … | Inline dynamic token, generated fresh at each occurrence |

---

## 2. Request Execution Lifecycle (Sequence Flow)

When you click the **Send** button on a request in the API Explorer, the backend goes through a structured execution loop:

```mermaid
sequenceDiagram
    autonumber
    actor User as QA Engineer
    participant FE as Frontend Client
    participant BE as Backend Proxy (FastAPI)
    participant DB as MongoDB
    participant JS as QuickJS Sandbox
    participant API as Target Host API

    User->>FE: Click "Send" Request
    FE->>BE: POST /api/executor/run (requestData, environmentId)
    
    rect rgb(30, 41, 59)
        note right of BE: Step 1: Interpolation
        BE->>DB: Fetch Environment variables
        DB-->>BE: Environment Variables
        BE->>BE: Resolve input bindings once (literals & generators)
        BE->>BE: Interpolate {{env.key}}, {{input}} and {{$generator}} tokens<br>in URL, Headers, Params, Body and Auth
    end

    rect rgb(49, 46, 129)
        note right of BE: Step 2: Resolve Authentication
        BE->>DB: Fetch associated Auth Hook details
        DB-->>BE: Auth Hook Script & cachedToken
        
        alt Cached Token is Missing or Expired
            BE->>JS: Execute Auth script with Env Context
            note over JS: Runs fetchToken() helper
            JS-->>BE: Returns newly fetched token string
            BE->>DB: Cache new token & expiresAt (TTL / JWT exp)
        else Token is Cached & Valid
            note over BE: Use cachedToken directly
        end
        BE->>BE: Inject header: 'Authorization: Bearer <token>'
    end

    rect rgb(6, 78, 59)
        note right of BE: Step 3: HTTP Dispatch
        BE->>API: Send HTTP Request (Method, URL, Headers, Body)
        API-->>BE: Return HTTP Response (Status, Headers, Body)
    end

    rect rgb(30, 41, 59)
        note right of BE: Step 4: Outputs & Chaining (Response Parser)
        alt Response Parser Script exists AND Status < 400
            BE->>JS: Execute Response Parser script
            note over JS: Injects 'response', 'output' & 'env'<br>Script assigns output.<name> and may call env.set()
            JS-->>BE: Returns outputs + env writes
            BE->>DB: Upsert env writes into Active Environment
            BE->>DB: Persist last outputs per request (request_outputs)
        end
    end

    BE-->>FE: Return Execution Stats, Body, Headers, Outputs & Missing Outputs
    FE->>User: Display Response & Extracted outputs
```

---

## 3. Step-by-Step User Flow

### Step 1: Setup Workspace Environments
Before running requests, define your environment variables. 
1. Navigate to **Environments** (`/environments`) in the sidebar.
2. Click **Create Environment** and name it (e.g., `Staging`).
3. Add key-value variables:
   - Mark secrets (like passwords or client secrets) by checking the **Secret** box to mask them in the UI.
4. Set your active environment in the top header's **"Active Env"** dropdown.

### Step 2: Write an Auth Hook Function
If your APIs require bearer token authorization that expires frequently, define a dynamic hook:
1. Navigate to **Auth Hook Functions** (`/auth-functions`).
2. Click **Create Auth Function** and configure:
   - **Name**: e.g., `OAuth Client Credentials`
   - **Expires-In**: Set the cache lifetime in seconds (leave empty to parse from JWT expiration).
3. Write the JavaScript retrieval logic inside the Monaco editor.
4. Click **Create** to save.

*Example Auth Script:*
```javascript
// Access variables from the active environment using `env.<variable>`
const clientId = env.AUTH_CLIENT_ID;
const clientSecret = env.AUTH_CLIENT_SECRET;
const tokenUrl = env.AUTH_URL || "https://auth.staging.ninjavan.co/token";

// Use the fetchToken(url, options) helper to call the authentication server
const responseText = fetchToken(tokenUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  })
});

const res = JSON.parse(responseText);

if (res.error) {
  throw new Error("Auth request failed: " + res.error_description);
}

// Return only the string token to be cached
return res.access_token;
```

> [!TIP]
> Use the **Dry-run (Test)** feature inside the edit form to verify that your script executes successfully and outputs the expected token structure.

### Step 3: Build the Request in API Explorer
1. Navigate to **API Automation Explorer** (`/api-explorer`).
2. Create or select a Collection, and add a request.
3. Define the HTTP Method and URL (e.g., `{{env.BASE_URL}}/sg/order-search/search/masked`).
4. In the request builder's **Authentication** tab:
   - Select **Dynamic Auth Hook** as the authentication type.
   - Choose the Auth Function created in Step 2 from the dropdown.

### Step 4: Bind Request Inputs
Any bare `{{name}}` token you type (e.g. a body of `{"ref": "{{order_ref}}"}`) appears live in the **Input** tab:
1. Open the **Input** tab — each detected input shows one row.
2. Choose the source per input:
   - **Literal**: free-type a value; it may itself contain `{{env.X}}` or `{{$...}}` tokens.
   - **Generator**: pick a date (with offset and format), random int, or random email/name from the menu.
3. Unbound inputs are sent literally as `{{name}}`. Bindings are saved with the request and synced with the collection.

### Step 5: Declare Outputs and the Parser Script
To extract fields from the response (for verification or downstream use):
1. Open the **Output** tab and declare output names as chips (e.g. `last_searched_order_id`).
2. Write a JavaScript snippet that assigns each declared output onto the injected `output` object. Use `env.set(key, value)` only when you explicitly want to write an environment variable.

*Example Parser Script:*
```javascript
// The backend injects 'response' (parsed JSON body + headers), 'output' and 'env'
if (response.body && response.body.data && response.body.data.length > 0) {
  // Declared output — shows up in the Extracted tab
  output.last_searched_order_id = response.body.data[0].id;

  // Optional: also persist into the active environment for other requests
  env.set("last_searched_order_id", response.body.data[0].id);
}
```

> [!NOTE]
> You can click the **AI Agent Parser** button to open an AI assist window. Type in plain English what you want to extract (e.g., *"extract the order ID from the first element"*), and Gemini will generate the QuickJS-compliant script for you, targeting your declared outputs.

> [!WARNING]
> Legacy scripts using `vars.set(...)` keep working as environment writes, but their values no longer appear in the Extracted tab — declare outputs and assign `output.<name>` instead.

### Step 6: Execute and Verify
1. Click **Send**.
2. The response appears in the bottom panel. The **Extracted** tab lists every declared output — extracted values as rows, and a warning for any output the parser script did not set (the request still succeeds).
3. To chain requests through the environment: `env.set(...)` in this request, then reference `{{env.last_searched_order_id}}` in the next request's URL (e.g. `{{env.BASE_URL}}/orders/{{env.last_searched_order_id}}`).

---

## 4. Key Differences: API Explorer vs. Web Explorer Auth Integration

While both modules share the same **Auth Hook Functions**, they inject the tokens differently depending on the execution context:

| Feature | API Explorer Request | Web Explorer Browser Session |
| :--- | :--- | :--- |
| **Execution Layer** | Headless backend `httpx` proxy | Remote Chromium browser (via VNC) |
| **Trigger Point** | Every time the **Send** button is clicked | Once upon establishing the VNC socket connection |
| **Token Injection** | Injected directly into the request headers (`Authorization: Bearer <token>`) | Pre-injected into the browser state (Cookies or LocalStorage) prior to navigating to the `defaultUrl` |
| **Caching Scope** | Cached in MongoDB per-user session | Resolved once at launch (renewed inside profile cookies/localStorage if expired) |
| **Setup Config** | Auth Function selected directly on the request | Auth Function linked to a **Browser Profile**, mapped with target keys and domains |
