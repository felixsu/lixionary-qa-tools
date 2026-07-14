console.log("[Automation Explorer Helper] Content script loaded and active.");

// Handle incoming messages from the React web app page
window.addEventListener("message", (event) => {
  // Ensure the message is from our own page and target source is correct
  if (!event.data || event.data.source !== "ae-web-app") {
    return;
  }

  const { type, payload, requestId } = event.data;
  console.log(`[Automation Explorer Helper] Received request from webpage: ${type}`, payload);

  // Forward message to background service worker
  chrome.runtime.sendMessage({ type, payload }, (response) => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      console.error(`[Automation Explorer Helper] Error from background:`, lastError);
      window.postMessage({
        source: "ae-chrome-extension",
        type: `${type}_RESPONSE`,
        requestId,
        success: false,
        error: lastError.message
      }, "*");
    } else {
      console.log(`[Automation Explorer Helper] Response from background:`, response);
      window.postMessage({
        source: "ae-chrome-extension",
        type: `${type}_RESPONSE`,
        requestId,
        success: response?.success ?? false,
        payload: response?.payload,
        error: response?.error
      }, "*");
    }
  });
});

// Broadcast extension readiness when the DOM is loaded
const notifyReadiness = () => {
  console.log("[Automation Explorer Helper] Broadcasting readiness to webpage...");
  window.postMessage({
    source: "ae-chrome-extension",
    type: "EXTENSION_READY"
  }, "*");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", notifyReadiness);
} else {
  notifyReadiness();
}

// In case the web app page is loaded after this content script,
// we also listen for a ping request and reply to it immediately.
window.addEventListener("message", (event) => {
  if (event.data && event.data.source === "ae-web-app" && event.data.type === "PING_EXTENSION") {
    console.log("[Automation Explorer Helper] Received PING from webpage, responding...");
    notifyReadiness();
  }
});
