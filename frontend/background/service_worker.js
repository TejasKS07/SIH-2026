/**
 * Background Service Worker
 * Fully compatible with Chrome, Microsoft Edge, Mozilla Firefox, and Apple Safari
 */

const browserAPI = typeof globalThis.browser !== "undefined"
  ? globalThis.browser
  : globalThis.chrome;

// 1. Enable Side Panel to open on action icon click (Chrome & Microsoft Edge)
function initSidePanelBehavior() {
  if (browserAPI.sidePanel?.setPanelBehavior) {
    browserAPI.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn("Side panel setPanelBehavior warning:", err));
  }
}

initSidePanelBehavior();

if (browserAPI.runtime?.onInstalled) {
  browserAPI.runtime.onInstalled.addListener(() => {
    initSidePanelBehavior();
  });
}

// 2. Action Click Fallback for Firefox (Sidebar) & Safari (Companion Window)
const actionAPI = browserAPI.action || browserAPI.browserAction;
if (actionAPI?.onClicked) {
  actionAPI.onClicked.addListener(async (tab) => {
    // If Chrome/Edge sidePanel is supported with setPanelBehavior, openPanelOnActionClick handled it.
    // If sidePanel.open is manually supported:
    if (browserAPI.sidePanel?.open && tab?.windowId) {
      try {
        await browserAPI.sidePanel.open({ windowId: tab.windowId });
        return;
      } catch {
        // Fall through to other strategies
      }
    }

    // Firefox Sidebar Support
    if (browserAPI.sidebarAction) {
      try {
        if (typeof browserAPI.sidebarAction.open === "function") {
          await browserAPI.sidebarAction.open();
          return;
        } else if (typeof browserAPI.sidebarAction.toggle === "function") {
          await browserAPI.sidebarAction.toggle();
          return;
        }
      } catch (err) {
        console.warn("Firefox sidebarAction open warning:", err);
      }
    }

    // Safari & Standalone popup window fallback
    try {
      const sidepanelUrl = browserAPI.runtime.getURL("sidepanel/sidepanel.html");
      const windows = await (browserAPI.windows.getAll
        ? new Promise((resolve) => browserAPI.windows.getAll({ populate: true }, resolve))
        : Promise.resolve([]));

      const existingWindow = windows?.find((win) =>
        win.tabs?.some((t) => t.url && t.url.includes("sidepanel/sidepanel.html"))
      );

      if (existingWindow?.id && browserAPI.windows?.update) {
        browserAPI.windows.update(existingWindow.id, { focused: true });
      } else if (browserAPI.windows?.create) {
        browserAPI.windows.create({
          url: sidepanelUrl,
          type: "popup",
          width: 440,
          height: 750,
        });
      } else if (browserAPI.tabs?.create) {
        browserAPI.tabs.create({ url: sidepanelUrl });
      }
    } catch (err) {
      console.error("Failed to open fallback sidepanel window:", err);
    }
  });
}

// 3. Helper to check if a URL is an internal restricted browser page
function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("devtools://") ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("safari-extension://") ||
    url.startsWith("safari-resource://") ||
    url.startsWith("view-source:")
  );
}

// 4. Capture visible tab helper with callback / promise cross-engine support
function executeCapture(windowId) {
  return new Promise((resolve, reject) => {
    const options = { format: "png" };
    const captureCallback = (image) => {
      const lastErr = browserAPI.runtime?.lastError;
      if (lastErr) {
        reject(new Error(lastErr.message || String(lastErr)));
      } else if (!image) {
        reject(new Error("Failed to capture screenshot (empty image data returned)."));
      } else {
        resolve(image);
      }
    };

    try {
      if (windowId !== undefined && windowId !== null) {
        const res = browserAPI.tabs.captureVisibleTab(windowId, options, captureCallback);
        if (res && typeof res.then === "function") {
          res.then(resolve).catch(reject);
        }
      } else {
        const res = browserAPI.tabs.captureVisibleTab(options, captureCallback);
        if (res && typeof res.then === "function") {
          res.then(resolve).catch(reject);
        }
      }
    } catch (err) {
      try {
        const res2 = browserAPI.tabs.captureVisibleTab(options, captureCallback);
        if (res2 && typeof res2.then === "function") {
          res2.then(resolve).catch(reject);
        }
      } catch (fallbackErr) {
        reject(fallbackErr);
      }
    }
  });
}

// 5. Message listener for screenshot capture
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CAPTURE_SCREENSHOT") {
    return false;
  }

  (async () => {
    try {
      const currentWindow = await new Promise((resolve) => {
        if (browserAPI.windows?.getLastFocused) {
          browserAPI.windows.getLastFocused({ populate: true }, (win) => {
            if (browserAPI.runtime?.lastError || !win) {
              resolve(null);
            } else {
              resolve(win);
            }
          });
        } else {
          resolve(null);
        }
      });

      const activeTab = currentWindow?.tabs?.find((t) => t.active);
      if (activeTab && isRestrictedUrl(activeTab.url)) {
        sendResponse({
          success: false,
          error:
            "Cannot capture internal browser pages (" +
            activeTab.url +
            "). Please open and switch to a regular web page (e.g., https://google.com) and try again.",
        });
        return;
      }

      const image = await executeCapture(currentWindow?.id);
      sendResponse({
        success: true,
        image: image,
      });
    } catch (err) {
      sendResponse({
        success: false,
        error: err.message || "Failed to capture screenshot.",
      });
    }
  })();

  return true;
});