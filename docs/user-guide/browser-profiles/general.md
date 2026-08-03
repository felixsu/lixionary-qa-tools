# **Browser Profiles**

## **Overview**

A **Browser profile** is a reusable preset that seeds a Web Explorer session with everything it needs to start already authenticated: **cookies**, **localStorage** entries, **launch settings** (headless mode and resolution), an optional **default URL**, and optional **auth hook** mappings that inject a freshly fetched token at launch.

Instead of logging in by hand every time a session starts, you capture or describe the authenticated state once, save it as a profile, and every new session begins where you left off.

┌──────────────────────────────────────────────────────────────────────┐
│                           Browser profile                            │
├──────────────────────────────────────────────────────────────────────┤
│ Cookies (JSON array)        │ localStorage entries (per origin)      │
├─────────────────────────────┴────────────────────────────────────────┤
│ Launch settings: Headless · Resolution · Default URL                 │
├──────────────────────────────────────────────────────────────────────┤
│ Auth hook (optional): token → cookie / localStorage mappings         │
└──────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼  injected at session start
                     Web Explorer Chromium session

> **Note**: A profile is a *launch-time injection*, not a persistent browser storage folder. The cookies and localStorage are pushed into the session when it starts; nothing the session does afterwards is written back to the profile. To refresh a profile with newer state, edit it (or re-import from Chrome).

Profiles are managed on the **Browser profiles** page (Configuration section of the nav) and sync across your devices like other configuration data.

## **Creating a Profile**

Click **Create browser profile** to open a step-by-step wizard. The steps depend on the setup method you pick first.

### **1. Setup method**

Two paths:

* **Manual setup** — type or paste the cookies and localStorage yourself. Best when you already have the values (e.g. a token from an API call or another tool).
* **Use Chrome Extension Helper** — pull cookies and localStorage straight out of a tab in your own Chrome, then pick which items to keep. Best when you are already logged in to the target site in Chrome. The card shows a live **Connected** / **Not connected** badge so you know whether the helper extension is reachable before committing to this path.

### **2. Local storage** *(manual path)*

Add entries with the raw-value helper:

* **Origin** — the site the entry belongs to, e.g. `https://example.com`.
* **Key name** — the localStorage key.
* **Raw value** — the value exactly as the site stores it. Quotes and backslashes are escaped for you automatically, so you can paste JSON blobs or JWTs as-is.

Click **Add entry** for each item. Entries are listed grouped by origin with a per-entry delete, and a raw JSON preview shows the underlying structure. This step is optional — skip it if the profile only needs cookies.

### **3. Cookies** *(manual path)*

Paste a cookies **JSON array**; the placeholder in the textarea shows the expected shape (`name`, `value`, `domain`, `path`, `secure`, `sameSite`). This step is also optional — leave it empty if the profile only needs localStorage.

### **4. Import from Chrome** *(extension path)*

If the helper isn't connected yet, this step walks you through installing it:

1. Click **Download helper extension (.zip)** and unzip it.
2. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**, pointing at the unzipped folder.
3. **Reload the tab** you want to capture from (the extension only sees tabs loaded after it was installed), then click **Check connection again**.

Once connected (**Extension Active**):

1. Pick the tab to capture from in the dropdown (**Refresh** re-lists open tabs).
2. Click **Fetch Cookies & LocalStorage**.
3. Tick the cookies and localStorage keys you want (**Select All** / **Select None** helpers on each list) and click **Apply selected values to profile**. A green banner summarises what was imported.
4. Repeat with other tabs if the profile should combine state from several origins — imports merge instead of replacing.

> **Note**: You can't leave this step until some data has been imported — **Next** stays disabled on an empty import.

### **5. Details & save**

* **Profile name** *(required)* — e.g. "Authenticated admin session".
* **Default URL** *(optional)* — where the session navigates on start, e.g. `https://admin.example.com/orders`. Must start with `http://` or `https://`.
* **Session launch settings**:
  * **Headless** — no visible browser window opens; the in-app screen preview and click actions still work.
  * **Resolution** — 1280×720 (HD), 1366×768, 1440×900, 1920×1080 (Full HD), or **Custom...** with explicit width/height in pixels.
* **Auth hook integration** *(optional)* — see the next section.

Click **Save profile** (or **Update profile** when editing) to finish.

## **Auth Hook Integration**

Cookies and localStorage captured today expire eventually. Linking an **Auth function** keeps a profile evergreen: at every session start the hook runs (or serves its cached token) and the fresh token is injected into the session.

1. In the **Link auth hook** dropdown, pick one of your Auth functions (its TTL is shown next to the name).
2. Add one or more **mappings** describing where the token goes:
   * **Injection type** — **Cookie** or **Local storage**.
   * **Target key / name** — the cookie name or localStorage key to write.
   * **Domain** (cookie) or **Origin** (local storage) — where to write it.
   * **Source field** — leave blank when the hook returns a plain token string; set it (e.g. `access_token` or `refresh_token`) when the hook returns an object.

Tokens are resolved against the **Active env** selected in the top navbar, so the same profile works across environments. If the hook fails at session start, a descriptive toast explains what went wrong and the session still starts — just without that injection.

> **Tip**: The **Auth functions** page has its own helper dialog (the ? icon) explaining how to write a token-fetching script, with ready-made presets.

## **Managing Profiles**

Each profile card shows its name, ID, default URL, and whether an auth hook is linked. Cards support:

* **Edit** — reopens the wizard with the saved values.
* **Duplicate** — copies the profile as a starting point for a variant (e.g. same site, different role).
* **Delete** — removes it after confirmation.

## **Using a Profile**

Profiles come to life on the **Web Explorer** page: pick one from the profile dropdown in the control bar and click **New Session** — the browser launches with the profile's cookies, localStorage, and auth-hook values already injected, then opens the default URL. See the **Web Explorer → Browser Profiles & Sessions** guide for session behaviour, navigation, and lifecycle.
