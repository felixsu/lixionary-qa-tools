# **Lixionary API Automation Explorer**

## **Product Specifications (PRD) & Technical Design Document (TDD)**

## **Part 1: Product Specifications (PRD)**

### **1\. Product Vision & Core Value Proposition**

Lixionary Automation Explorer is an collaborative API automation and exploration engine designed specifically for engineering teams to build, execute, chain, and automate HTTP requests cleanly. It eliminates manual environment setups, automates response variable binding via AI Agents, and streamlines protected API validation through self-refreshing **Auth Functions**.

### **2\. User Roles & Key Workflows**

#### **Roles**

* **Workspace Admin/Creator:** Can create collections, environments, global credentials, and share collection IDs with team members.  
* **QA / Automation Engineer:** Core user who builds requests, executes test suites, uses the AI Parser to map dynamic variables, and configures Auth Functions.  
* **Developer / Team Member:** Pulls shared collections to test local/dev changes, runs automated test flows.

#### **Core User Flows**

1. **Onboarding:** A user logs in via Google SSO. They are automatically assigned a default personal workspace with a clean, unified dashboard featuring the Lixionary brand.  
2. **Environment Setup:** User creates standard environments (e.g., Staging, Production) and assigns Base URLs.  
3. **Auth Function Setup:** User writes a quick JS function that retrieves an access token from an authentication endpoint and caches it.  
4. **Request Composition & Chaining:**  
   * Creates a GET request to retrieve user profiles.  
   * Adds an Authorization Hook pointing to the newly created Auth Function.  
   * Uses a template variable {{BASE\_URL}}/api/users.  
5. **AI Response Parsing:**  
   * User sends the request and receives a complex JSON payload.  
   * The user clicks the **AI Agent** button and prompts: *"Extract the user ID of the first user and save it to user\_id"*.  
   * The AI translates this into a JavaScript parser script automatically.  
6. **Collaborative Sharing:**  
   * User copies the unique Collection ID and shares it with a colleague.  
   * The colleague imports the ID and instantly gains real-time read/write access to run tests.

### **3\. Detailed Functional Requirements**

#### **Module 1: Authentication & Google SSO**

* **Google SSO Integration:** Users must log in via a Google-managed OAuth screen. Secure token exchange occurs on the backend, generating a local JWT session.  
* **Branded Landing Screen:** Sleek minimalist login interface showcasing the **Lixionary** logo and design language.

#### **Module 2: Environment Context Selector**

* **Variable Scope Hierarchy:** Support Global variables and Environment-level variables.  
* **Active Context Switching:** A global drop-down selector allows users to switch between environments (e.g., Dev, Staging, Prod). When switched, all instances of {{BASE\_URL}} or other keys within active requests are immediately substituted with the current environment's properties.

#### **Module 3: Request Workspace & Interface**

* **URL Input:** Fully interactive URL bar with autocomplete support matching environment variables.  
* **HTTP Methods:** GET, POST, PUT, DELETE, PATCH.  
* **Configuration Tabs:**  
  * **Headers:** Key-value table supporting variable interpolation.  
  * **Query Params:** Key-value table mapping parameters instantly into the URL string.  
  * **Body:** Supports None, JSON, Form Data, Raw, and Text.  
  * **Authorization:**  
    * None  
    * Bearer Token  
    * API Key  
    * Auth Function Hook (Dynamic option linking to custom written auth routines).  
* **Response Dashboard:**  
  * Response status code, execution duration, and payload size.  
  * Tabbed view for: **Pretty Print JSON**, **Raw Response**, **Response Headers**.  
  * Visual error-state messages without using system-blocking browser alerts().

#### **Module 4: Auth Manager (Advanced Hook System)**

* **Script Interface:** Editor supporting JavaScript execution.  
* **Automated Invocation:** When a request is marked with the "Auth Function" authentication type, the system checks the corresponding Auth Function.  
* **Caching & Refresh Logic:**  
  * Checks if a valid, unexpired token exists in the cache for that Auth Function.  
  * If missing or expired, executes the auth script contextually *before* resolving the main HTTP request.  
  * Caches the response based on the function's calculated expiresIn config.

#### **Module 5: AI Agent Parse Engine**

* **One-Click Prompting:** When active response data exists, clicking "AI Agent" presents a prompt dialog.  
* **Code Generation:** The prompt takes the current JSON response structure and writes an extraction script (e.g., vars.set('userId', response.body.data\[0\].id)).  
* **Live Simulation:** Users can test the AI-generated script immediately on the active response to verify output before saving.

#### **Module 6: Request Collection & Collaborative Sharing**

* **Workspace Synchronization:** Collections serve as logical parent containers for requests.  
* **Sharing Paradigm:**  
  * Every collection has a copyable ID string.  
  * Other users can "Add Shared Collection" by pasting the collection ID.  
  * Permissions default to collaborative Read/Write to allow seamless joint debugging.

## **Part 2: Technical Design Document (TDD)**

### **1\. High-Level Architecture Block Diagram**

       ┌────────────────────────────────────────────────────────┐  
       │                       NEXT.JS UI                       │  
       │  (Workspace, HTTP Editor, Coll. Sharing, AI Console)  │  
       └───────────┬────────────────────────────────┬───────────┘  
                   │                                │  
        HTTP Requests/SSO Token             Websocket / Realtime updates  
                   │                                │  
                   ▼                                ▼  
       ┌────────────────────────────────────────────────────────┐  
       │                    NODE.JS BACKEND                     │  
       │   (Express, Auth Middleware, Routing, Event Handling)  │  
       └─────┬──────────────────┬─────────────────┬───────────┬─┘  
             │                  │                 │           │  
             ▼                  ▼                 ▼           ▼  
      ┌─────────────┐    ┌─────────────┐   ┌─────────────┐ ┌─────────────┐  
      │ SECURE VM   │    │  GEMINI AI  │   │  HTTP PROXY │ │   MONGODB   │  
      │ (Auth Hooks │    │   PARSER    │   │  DISPATCHER │ │  DATABASE   │  
      │   Sandbox)  │    │  (Gen API)  │   │ (Axios/Fetch│ │ (Collections│  
      └─────────────┘    └─────────────┘   └─────────────┘ └─────────────┘

#### **Architecture Flow**

1. **UI Level:** Next.js provides a single-page reactive application structure. Components utilize context states to manage variables and current active environments.  
2. **API Proxy Dispatcher:** To prevent CORS blockages during local developer usage, all testing requests initiated by the browser are proxied through the Node.js backend.  
3. **Secure VM Engine:** When a request demands an "Auth Function Hook", the backend orchestrates sandbox execution of the custom JS code to retrieve the token cleanly without exposing host memory.

### **2\. MongoDB Schema Design (Mongoose)**

#### **User Collection (users)**

{  
  "\_id": "ObjectId",  
  "googleId": "String",  
  "email": "String",  
  "name": "String",  
  "avatarUrl": "String",  
  "createdAt": "Date",  
  "updatedAt": "Date"  
}

#### **Workspace & Environment Collection (environments)**

{  
  "\_id": "ObjectId",  
  "ownerId": "ObjectId",  
  "name": "String",  
  "variables": \[  
    {  
      "key": "String",  
      "value": "String",  
      "isSecret": "Boolean"  
    }  
  \],  
  "createdAt": "Date"  
}

#### **Auth Function Schema (auth\_functions)**

{  
  "\_id": "ObjectId",  
  "ownerId": "ObjectId",  
  "name": "String",  
  "description": "String",  
  "script": "String", // JavaScript code executable in sandbox  
  "cachedToken": "String",  
  "expiresAt": "Date",  
  "createdAt": "Date",  
  "updatedAt": "Date"  
}

#### **Collection Schema (collections)**

{  
  "\_id": "ObjectId",  
  "name": "String",  
  "description": "String",  
  "ownerId": "ObjectId",  
  "collaboratorIds": \["ObjectId"\], // List of user IDs with shared access  
  "requests": \[  
    {  
      "id": "String", // Client-side unique UUID  
      "name": "String",  
      "method": "String", // GET, POST, etc.  
      "url": "String", // e.g., "{{BASE\_URL}}/users"  
      "headers": \[  
        {"key": "String", "value": "String"}  
      \],  
      "queryParams": \[  
        {"key": "String", "value": "String"}  
      \],  
      "bodyType": "String", // JSON, FORM, RAW, NONE  
      "body": "String",  
      "authType": "String", // NONE, BASIC, BEARER, API\_KEY, HOOK  
      "authConfig": {  
        "token": "String",  
        "key": "String",  
        "value": "String",  
        "authFunctionId": "ObjectId" // Ref to auth\_functions  
      },  
      "responseParserScript": "String", // Generated by AI agent or manual  
      "extractedVariables": \[  
        {  
          "variableName": "String",  
          "jsonPath": "String" // Path or evaluation rule used by parser  
        }  
      \]  
    }  
  \],  
  "createdAt": "Date",  
  "updatedAt": "Date"  
}

### **3\. API Route Design & Contract Interface**

#### **Authentication REST Endpoints**

* POST /api/auth/google  
  * **Description:** Verification of Google token client-side and session instantiation.  
  * **Payload:** { idToken: "String" }  
  * **Response:** { token: "String", user: { id: "String", email: "String", name: "String" } }

#### **Collection Management REST Endpoints**

* GET /api/collections \-\> Returns collections owned or shared with the authenticated user.  
* POST /api/collections \-\> Create a new request collection.  
* PUT /api/collections/:id \-\> Update structure or append new HTTP request definitions.  
* POST /api/collections/:id/collaborators  
  * **Payload:** { userId: "String" } or { email: "String" }  
  * **Description:** Share a collection with another team member using their unique identifiers.

#### **Execution Proxy REST Endpoints**

* POST /api/executor/run  
  * **Payload:**  
    {  
      "requestId": "String",  
      "method": "String",  
      "url": "String",  
      "headers": \[{"key": "String", "value": "String"}\],  
      "queryParams": \[{"key": "String", "value": "String"}\],  
      "bodyType": "String",  
      "body": "String",  
      "authType": "String",  
      "authConfig": {  
        "authFunctionId": "String",  
        "token": "String"  
      },  
      "environmentId": "String"  
    }

  * **Response:**  
    {  
      "status": 200,  
      "statusText": "OK",  
      "headers": {},  
      "body": {},  
      "executionTimeMs": 142,  
      "parsedVariables": {  
        "user\_id": "90210"  
      }  
    }

#### **AI Parser Gen Agent REST Endpoints**

* POST /api/ai/generate-parser  
  * **Payload:**  
    {  
      "responseBodySample": {},  
      "prompt": "Extract token parameter and assign it to access\_token"  
    }

  * **Response:**  
    {  
      "generatedScript": "const data \= JSON.parse(response.body);\\nvars.set('access\_token', data.token);"  
    }

### **4\. Core Algorithmic Sequences**

#### **Sequence A: The Request Execution Loop with Auto-Auth Hooks & Variable Swapping**

   User UI                  Node.js Executor API              Secure Sandboxed VM        Remote API Server  
      │                              │                                 │                         │  
      │ 1\. Click "Run Request"       │                                 │                         │  
      ├─────────────────────────────\>│                                 │                         │  
      │                              │ 2\. Read Active Env Variables    │                         │  
      │                              │    & replace {{vars}} in request│                         │  
      │                              │                                 │                         │  
      │                              │ 3\. \[If AuthHook active\]         │                         │  
      │                              │    Is cached token expired?     │                         │  
      │                              │    Yes ────────────────────────\>│                         │  
      │                              │                                 │ 4\. Run JS Script inside │  
      │                              │                                 │    untrusted VM context │  
      │                              │                                 ├────────────────────────\>│ (Calls Auth endpoint)  
      │                              │                                 │\<────────────────────────┤ (Returns token payload)  
      │                              │                                 │                         │  
      │                              │    Token cache updated \<────────┤                         │  
      │                              │                                 │                         │  
      │                              │ 5\. Apply Token as authorization │                         │  
      │                              │    header to pending request    │                         │  
      │                              │                                 │                         │  
      │                              │ 6\. Send outgoing Request ────────────────────────────────\>│  
      │                              │                                 │                         │ (Executes actual payload)  
      │                              │\<──────────────────────────────────────────────────────────┤ (Returns response)  
      │                              │                                 │                         │  
      │                              │ 7\. Run Response Parser Script   │                         │  
      │                              │    inside sandbox to extract vars│                         │  
      │                              │ ───────────────────────────────\>│                         │  
      │                              │ \<───────────────────────────────┤                         │  
      │                              │                                 │                         │  
      │ 8\. Render JSON response &    │                                 │                         │  
      │    updated runtime variables │                                 │                         │  
      │\<─────────────────────────────┤                                 │                         │

### **5\. Secure Auth Function Execution Sandbox Architecture**

Executing dynamic, user-written JavaScript functions safely is a critical challenge. Standard eval() or deprecated VM sandboxes (like older versions of vm2) can lead to Remote Code Execution (RCE) vulnerabilities on your server.

#### **Proposed Sandbox Pattern: Using node-vm with isolated-vm**

To prevent security breaches, custom Javascript scripts must be executed in an environment completely segregated from Node’s native context.

* **V8 Isolates Execution (isolated-vm):** Each run triggers a brand-new V8 Isolate, which has absolutely no access to the process, Node APIs, files, or require commands.  
* **Context Passing:** We pass limited dependencies securely. We only inject an configured axios/fetch proxy wrapper so the script can make outbound network calls to request tokens.

**Conceptual Execution Code Block:**

const ivm \= require('isolated-vm');

async function runUnsafeAuthScript(userScript, contextEnv) {  
  const isolate \= new ivm.Isolate({ memoryLimit: 16 }); // Max 16MB heap limits resource abuse  
  const context \= await isolate.createContext();  
  const jail \= context.global;

  // Setup basic global placeholders  
  await jail.set('global', jail.derefInto());  
    
  // Inject variables and standard safe helpers  
  await jail.set('env', new ivm.ExternalCopy(contextEnv).copyInto());  
    
  // Create simple network fetch helper  
  const fetchCallback \= async (url, options) \=\> {  
    // Resolved on the main node loop safely using a pre-checked fetch instance  
    return await secureFetchWrapper(url, options);  
  };  
  await context.evalClosure(\`  
    global.fetchToken \= async function(url, opts) {  
      return await $0.apply(undefined, \[url, opts\], { arguments: { copy: true }, result: { promise: true, copy: true } });  
    }  
  \`, \[fetchCallback\], { arguments: { reference: true } });

  const script \= await isolate.compileScript(\`  
    async function run() {  
      ${userScript}  
    }  
    run();  
  \`);

  return await script.run(context, { timeout: 2000 }); // strict 2-second timeout boundary  
}

### **6\. AI Agent Gemini Integration Design**

The Lixionary AI Agent will utilize the structured capabilities of **Gemini 2.5** to convert natural language prompts into working Javascript response-parsers.

#### **System Prompt Structure**

System: You are an expert API testing automation developer. Your task is to output a raw, executable, and safe JavaScript parsing function based on the user's prompt and a given JSON response block.  
Rules:  
1\. Do not output any markdown formatting, code block markers, backticks, or comments. Output ONLY executable JavaScript.  
2\. The JSON response is available inside a local variable named 'response'.  
3\. You have access to a custom SDK object named 'vars' to set values: vars.set('variable\_name', value).  
4\. Extract properties safely (e.g. check for array lengths or null boundaries).

Example Input Payload:  
{  
  "status": "success",  
  "data": {  
    "users": \[  
       {"id": "usr\_99", "email": "dev@lixionary.com"}  
    \]  
  }  
}  
Example Prompt: "Get email of the first user to var client\_email"  
Example Output:  
if(response && response.data && response.data.users && response.data.users.length \> 0\) {  
  vars.set('client\_email', response.data.users\[0\].email);  
}

#### **API Integration Script**

const { GoogleGenAI } \= require("@google/genai");

async function generateResponseParser(responseJson, userPrompt) {  
  const ai \= new GoogleGenAI({ apiKey: process.env.GEMINI\_API\_KEY });  
    
  const formattedPrompt \= \`  
    Response Payload Sample:  
    ${JSON.stringify(responseJson, null, 2)}

    Goal instructions:  
    ${userPrompt}  
  \`;

  try {  
    const response \= await ai.models.generateContent({  
      model: "gemini-2.5-flash-preview-09-2025",  
      contents: formattedPrompt,  
      systemInstruction: "You are an expert API automation developer. Convert the extraction instructions into clean JS code according to the rules.",  
      // Ensure the model produces a direct code block cleanly  
      generationConfig: {  
        temperature: 0.1,  
        topP: 0.95  
      }  
    });

    return response.text; // Output code body string directly  
  } catch (error) {  
    console.error("Gemini AI agent generation failed:", error);  
    throw error;  
  }  
}

### **7\. Scalable Collaboration & Variable Cascading**

* **Caching Framework:** Extracted variables are maintained in local memory/cache for execution flow pipelines, but are saved back to the Workspace context so they persist across requests.  
* **Realtime Sockets for Sharing:** To prevent race conditions inside shared collections, any update on a request's headers/URL will broadcast a message via Socket.io/Websockets to all active clients viewing that collection, triggering an immediate UI state sync.