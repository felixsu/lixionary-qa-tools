# Automation Explorer Helper Chrome Extension

This extension enables the **Lixionary Automation Explorer** web app to query the list of open Chrome tabs, fetch their active cookies, and inspect their `localStorage` variables to import them into Browser Profiles.

## How to Install (Unpacked Extension)

To load this extension in Google Chrome:

1. Open a new tab in Chrome and navigate to **`chrome://extensions/`**.
2. In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.
3. In the top-left corner, click the **Load unpacked** button.
4. Select the `chrome-extension` directory located in the root of this project repository:
   `/Users/felix/workspace/nv/random/nv-automation-explorer/chrome-extension`
5. The extension "Automation Explorer Helper" will appear in your installed extension list and is active immediately!

## How it Works

1. The content script (`content.js`) injects only on localhost and authorized app domains.
2. It sets up a message listener that detects requests coming from the web app (`window.postMessage`).
3. The background service worker (`background.js`) executes the Chrome extension API calls (such as `chrome.cookies.getAll` or `chrome.scripting.executeScript`) to fetch data from target tabs and sends it back to the page.
4. No external network requests are made; all operations are fully local.
