# **Network Capture & API Integration**

## **The Network Activity View**

Switch the view mode to **Network Activity** to see every request the session's pages make (documents, XHR/fetch, images, scripts — everything is captured, continuously, whenever a session is active). The view is split in two: the request list on the left, details on the right (*"Select a request to inspect details."*).

Each row shows the method badge, the status code (amber **Pending** until the response arrives, green for success, red for errors), and the URL, plus two icon actions:

* **Show Python client code** (code icon) — generate Python for this call.
* **Save to API Explorer collection** (save icon) — turn the call into a saved request.

**Reset** (*Clear network log*) empties the list. Note it clears the app's view only — navigating again reloads the session's full capture history.

## **Filtering**

* The **Show all** / **API** pills give a quick cut — **API** keeps rows whose URL contains "api".
* The filter box (*Filter by URL or method…*) does a case-insensitive substring match on the URL or method. (No regex support.)

## **Request Details**

Click a row to load its details pane: **Request URL**, **Method**, **Status**, **Request Payload** and **Response Payload** (pretty-printed when JSON, each with a copy button), and **Request/Response Headers**.

> **Limitation**: Response bodies are only captured for successful responses (status below 400) — error responses show headers and status but no body. Non-text bodies display as `[Binary/Non-Text Payload]`.

## **Python Client Generation**

**Show Python client code** opens the **Python client** modal: code *"generated from the captured request and response — uses `requests` and `pydantic`"*. It builds Pydantic models for the request and response bodies (nested objects and arrays included) and a ready-to-run `call_api()` function, with a **Copy** button.

> **Heads-up**: The generated code inlines **all captured headers verbatim** — including `Authorization` tokens and cookies. Scrub secrets before committing it anywhere.

## **Saving a Call to API Explorer**

**Save to API Explorer collection** opens the **Save to collection** modal:

1. Pick a target **Collection** (top-level collections only) or choose **+ Create new collection…** and name one.
2. Adjust the **Request name** (pre-filled from the URL's last path segment).
3. Click **Save**. If a request with the same method and URL already exists anywhere, an amber **Duplicate request detected** notice lists where — submit again (**Save anyway**) to save regardless.

The saved request carries over the method, URL, headers, query parameters (split into the Params tab), and body (JSON/Text auto-detected). Auth arrives as a literal `Authorization` header rather than a configured Auth type — switch it to a Bearer token or auth hook in API Explorer if you want it environment-aware.

## **Persistence**

Captured traffic lives in memory for the duration of the session on your machine — it is not synced or saved to disk, and there is no HAR/JSON export. Capture what you need via the Python client modal or by saving requests into a collection before closing the session.
