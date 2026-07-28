# **Outputs & API Studio Integration**

## **Overview**

The **Output** tab bridges individual API requests with **API Studio**, allowing users to transform raw API responses into reusable variables across automation pipelines.

## **Configuring Output Variables**

1. Open the **Output** tab in the Request Editor.
2. Type a variable identifier (e.g., extracted_order_id) into the **add output…** field and press Enter. Each declared output gets an optional description field.
3. Write the request's **parser script** (one shared JavaScript script for all outputs) that assigns a value to `output.<name>` for each declared output:

   ```javascript
   output.extracted_order_id = response.body.data.order.id;
   env.set("order_id", output.extracted_order_id); // optional: also write to an environment variable
   ```

   Inside the parser script, `response.body` is the parsed response payload (for JSON object responses, top-level keys are also accessible directly on `response`), and `env.set(key, value)` writes to the active environment.

4. Alternatively, click **AI agent parser** to auto-generate the parser script from a real response — the button is enabled once the request has been executed successfully at least once.
5. Executed requests display the extracted values under the **Extracted** tab in the response pane, with a note next to any output that was not also written to an env var.

### **Behavior Notes**

* The parser script is **skipped when the response status is 400 or higher** (a "Parser skipped" notice appears in the Extracted tab).
* If a declared output is not assigned by the script, the Extracted tab shows a missing-outputs warning with a **Fix missing outputs** AI action that revises the script for you.

## **Integration with API Studio**

When this request is used inside an **API Studio** node:

* Declared **Inputs** appear in the node's **Input mappings** panel, where each can be set to *Request default*, a *Static* value, or a *Reference* to an upstream node's output.
* Declared **Outputs** are published under the node's name; downstream nodes consume them via references of the form `nodeName.outputName`.
* Node connections express execution order — if a run finishes without producing all declared outputs, the node fails with a "Missing declared outputs" error.
