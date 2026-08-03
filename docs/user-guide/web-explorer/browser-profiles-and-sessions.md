# **Browser Profiles & Sessions**

## **Overview**

Sessions are seeded by **Browser profiles** — reusable presets of cookies, localStorage, launch settings, and auth hooks managed on the **Browser profiles** page. Web Explorer itself has no cookie/localStorage inputs; everything is configured on the profile. For a deeper walkthrough of the profile wizard and auth hook mappings, see the dedicated **Browser Profiles** guide.

## **Browser Profiles**

Open **Browser profiles** (in the Configuration section of the nav) and click **Create browser profile**. A step-by-step wizard walks through:

### **1. Setup method**

* **Manual setup** — add localStorage entries via the raw-value helper and paste a cookies JSON array yourself.
* **Use Chrome Extension Helper** — fetch cookies & localStorage from an open Chrome tab and pick which items to import. The card shows a live **Connected** / **Not connected** badge.

### **2. Local storage** (manual path)

* Add entries with the raw-value helper: **Origin** (e.g. `https://example.com`), **Key name**, and the **Raw value** exactly as it should appear — quotes and backslashes are escaped for you automatically.

### **3. Cookies** (manual path)

* Paste a cookies **JSON array** (the placeholder shows the expected shape). Optional — leave empty if the profile only needs localStorage.

### **4. Import from Chrome** (extension path)

* Install the **Automation Explorer Helper** extension (download the zip from this step, unzip, then `chrome://extensions` → enable **Developer mode** → **Load unpacked**; reload the target tab after installing).
* Select an open tab, click **Fetch Cookies & LocalStorage**, tick the cookies/keys you want, and **Apply selected values to profile**. You can fetch multiple tabs to combine origins.

### **5. Details & save**

* **Profile name** and optional **Default URL** — the URL the session navigates to on start.
* **Session launch settings**: a **Headless** checkbox (*no visible browser window opens — the screen preview and click actions still work*) and a **Resolution** dropdown (1280×720 up to 1920×1080, or **Custom…** width/height).
* **Auth hook integration (optional)**: link one of your **Auth functions** and map its result into the session — per mapping choose **Cookie** or **Local storage** injection, the target key, the domain/origin, and (when the hook returns an object) the source field. Tokens are resolved fresh at session start, against the **Active env** selected in the top navbar.

Profile cards support **Edit**, **Duplicate**, and **Delete**. Profiles sync across your devices like other configuration data.

## **Starting a Session**

1. On the Web Explorer page, pick a profile from the dropdown (**No profile (clean session)** is also available; by default the first profile is pre-selected).
2. Click **New Session** (it shows **Starting…** while the browser launches).
3. The session opens the profile's default URL with its cookies, localStorage, and auth-hook values already injected, and the live preview starts streaming (*"Session started. Streaming native browser window..."*).

If a linked auth function misbehaves, a descriptive toast explains what went wrong (e.g. *"Profile «name»'s auth function did not return a token — check the auth function's script."*) — the session still starts, just without that injection.

## **Navigating & Tabs**

* Use the URL bar and **Go** (or Enter) to navigate. URLs must start with `http://` or `https://`. The bar follows navigations that happen in the page itself.
* There are no back/forward/reload buttons in the app — use the real Chrome window for those (raise it from your OS taskbar/dock).
* When the page opens extra tabs, a tab strip appears above the preview; click a tab to switch the stream to it, or close it with its ✕ (the first tab can't be closed from the app).

## **Session Lifecycle**

* Sessions are named automatically (`sess_…`); there is no manual naming.
* The tool runs locally with a single session, so there is no session list — the connected control bar simply offers **End Session**, which terminates the browser session. Start a **New Session** to continue working.
* Only one session is attached to the app at a time; starting a new one replaces the current attachment.
* If the session breaks (e.g. you close the real Chrome window), the next action surfaces *"Browser session error: …"* and the app returns to the disconnected state.

> **Headless note**: In a headless session there is no visible Chromium window to interact with — disable **Headless** in the browser profile if you want one.
