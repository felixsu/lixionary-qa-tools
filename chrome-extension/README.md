# Automation Explorer Helper Chrome Extension

This extension enables the **Lixionary Automation Explorer** web app to query the list of open Chrome tabs, fetch their active cookies, and inspect their `localStorage` variables to import them into Browser Profiles.

## How to Install (Unpacked Extension)

To load this extension in Google Chrome:

1. Get the extension source:
   - **From the app** (recommended for teammates): open *Browser profiles* → *Create browser profile* → *Use Chrome Extension Helper* and click **Download helper extension (.zip)**, then unzip it somewhere permanent (Chrome loads the folder in place — don't delete it afterwards).
   - **From the repo**: use the `chrome-extension` directory at the project root directly.
2. Open a new tab in Chrome and navigate to **`chrome://extensions/`**.
3. In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.
4. In the top-left corner, click the **Load unpacked** button and select the extension folder.
5. The extension "Automation Explorer Helper" will appear in your installed extension list and is active immediately!

## How it Works

1. The content script (`content.js`) injects only on localhost and authorized app domains.
2. It sets up a message listener that detects requests coming from the web app (`window.postMessage`).
3. The background service worker (`background.js`) executes the Chrome extension API calls (such as `chrome.cookies.getAll` or `chrome.scripting.executeScript`) to fetch data from target tabs and sends it back to the page.
4. No external network requests are made; all operations are fully local.
