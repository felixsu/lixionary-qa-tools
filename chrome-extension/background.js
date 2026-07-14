chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TABS") {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ windowType: "normal" });
        const result = tabs
          .map(t => ({
            id: t.id,
            title: t.title || t.url,
            url: t.url,
            favIconUrl: t.favIconUrl
          }))
          .filter(t => t.url && t.url.startsWith("http"));
        sendResponse({ success: true, payload: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.type === "GET_DATA") {
    (async () => {
      const { tabId, url } = message.payload;
      if (!tabId || !url) {
        sendResponse({ success: false, error: "Missing tabId or url" });
        return;
      }

      try {
        const cookies = await chrome.cookies.getAll({ url });
        let localStorageData = {};
        try {
          const scriptResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const items = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                items[key] = localStorage.getItem(key);
              }
              return items;
            }
          });
          if (scriptResults && scriptResults[0]) {
            localStorageData = scriptResults[0].result;
          }
        } catch (scriptErr) {
          console.warn("Failed to inject script for localStorage: ", scriptErr);
        }

        sendResponse({
          success: true,
          payload: {
            url,
            cookies,
            localStorage: localStorageData
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});

// --- Local Sidecar WebSocket Bridge ---
let sidecarWs = null;
let keepaliveInterval = null;

// MV3 service workers are terminated after ~30s without activity, which closes
// the WebSocket and kills any pending reconnect timers. WebSocket message
// traffic resets that idle timer (Chrome 116+), so ping the sidecar every 20s
// while connected to keep the worker alive.
const stopKeepalive = () => {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
};

const startKeepalive = () => {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    if (sidecarWs && sidecarWs.readyState === WebSocket.OPEN) {
      sidecarWs.send(JSON.stringify({ type: "PING" }));
    }
  }, 20000);
};

const connectSidecarWS = () => {
  if (sidecarWs && (sidecarWs.readyState === WebSocket.CONNECTING || sidecarWs.readyState === WebSocket.OPEN)) {
    return;
  }

  console.log("[Automation Explorer Helper] Connecting to local sidecar WS...");
  sidecarWs = new WebSocket("ws://localhost:8484/api/browser-helper/ws");

  sidecarWs.onopen = () => {
    console.log("[Automation Explorer Helper] Connected to local sidecar WebSocket successfully!");
    startKeepalive();
  };

  sidecarWs.onmessage = async (event) => {
    try {
      const request = JSON.parse(event.data);
      const { type, payload, requestId } = request;
      console.log(`[Automation Explorer Helper] Sidecar Request: ${type}`, payload);

      if (type === "GET_TABS") {
        try {
          const tabs = await chrome.tabs.query({ windowType: "normal" });
          const result = tabs
            .map(t => ({
              id: t.id,
              title: t.title || t.url,
              url: t.url,
              favIconUrl: t.favIconUrl
            }))
            .filter(t => t.url && t.url.startsWith("http"));
          
          sidecarWs.send(JSON.stringify({
            requestId,
            success: true,
            payload: result
          }));
        } catch (err) {
          sidecarWs.send(JSON.stringify({
            requestId,
            success: false,
            error: err.message
          }));
        }
      } else if (type === "GET_DATA") {
        try {
          const { tabId, url } = payload;
          const cookies = await chrome.cookies.getAll({ url });
          let localStorageData = {};
          
          try {
            const scriptResults = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                const items = {};
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  items[key] = localStorage.getItem(key);
                }
                return items;
              }
            });
            if (scriptResults && scriptResults[0]) {
              localStorageData = scriptResults[0].result;
            }
          } catch (scriptErr) {
            console.warn("Failed to inject script for localStorage: ", scriptErr);
          }

          sidecarWs.send(JSON.stringify({
            requestId,
            success: true,
            payload: {
              url,
              cookies,
              localStorage: localStorageData
            }
          }));
        } catch (err) {
          sidecarWs.send(JSON.stringify({
            requestId,
            success: false,
            error: err.message
          }));
        }
      }
    } catch (err) {
      console.error("[Automation Explorer Helper] Error handling sidecar message:", err);
    }
  };

  sidecarWs.onclose = (event) => {
    console.log("[Automation Explorer Helper] Sidecar WebSocket disconnected. Retrying in 5 seconds...", event.reason);
    stopKeepalive();
    sidecarWs = null;
    setTimeout(connectSidecarWS, 5000);
  };

  sidecarWs.onerror = (err) => {
    console.error("[Automation Explorer Helper] Sidecar WebSocket error:", err);
    sidecarWs.close();
  };
};

// Establish connection immediately
connectSidecarWS();

// Listen for service worker wakes to ensure WebSocket is alive
chrome.runtime.onStartup.addListener(() => {
  connectSidecarWS();
});
chrome.runtime.onInstalled.addListener(() => {
  connectSidecarWS();
});

// Alarms fire even after the service worker has been terminated (unlike
// setTimeout/setInterval), waking it so the connection can be re-established —
// e.g. after the sidecar restarts, the machine sleeps, or Chrome kills the
// worker despite the keepalive. connectSidecarWS() no-ops while connected.
// 0.5 minutes is the minimum period Chrome allows.
chrome.alarms.create("sidecar-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sidecar-reconnect") {
    connectSidecarWS();
  }
});
