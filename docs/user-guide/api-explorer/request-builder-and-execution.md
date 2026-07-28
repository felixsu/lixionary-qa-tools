# **Request Builder & Execution**

## **Overview**

The Request Builder provides a unified header bar to construct, persist, and execute HTTP requests.

## **Action Controls**

| Element | Description | Keyboard Shortcut |
| :---- | :---- | :---- |
| **HTTP Method Selector** | Select the verb: GET, POST, PUT, PATCH, or DELETE. | — |
| **URL Input Bar** | Target address line supporting variable injection. Pasting a full cURL command here imports it (method, URL, headers, body, and auth are filled in automatically). | Enter (while focused) sends the request |
| **Save Button** | Persists changes to the current request in your collection. | CMD + S / CTRL + S |
| **cURL Button** | Opens a modal displaying the fully resolved cURL command and copies it to the clipboard (tooltip: *Copy as cURL*). | — |
| **Show Python** | Opens the **Python client** modal with generated Pydantic models and ready-to-run Python code using `requests`. | — |
| **Send Button** | Dispatches the request to the configured target endpoint. | — |

> **Note**: There is no global send shortcut — pressing Enter only sends while the URL input is focused.

## **URL Construction & Method Selection**

* Choose the appropriate HTTP method from the dropdown menu to match your API specification.
* Enter the full endpoint path or utilize environment placeholders directly in the address line.
  * Example: {{env.BASE_URL}}/{{env.SYSTEM_ID}}/order-search/search/masked
* **cURL import**: Instead of building a request by hand, paste an entire `curl …` command into the URL bar. API Explorer parses it and populates the method, URL, headers, body type/payload, and detected auth.

## **Execution & Response Panel**

* Clicking **Send** dispatches the request (a spinner replaces the button while in flight). Requests time out after 10 seconds.
* Once a response arrives, the response panel shows a **status pill** (green for status < 400, red otherwise), the **execution time in milliseconds**, and a **Copy** button that copies the currently visible response tab's content.
* The divider between the request configuration tabs and the response panel is draggable, letting you resize the two areas to fit your workflow.
