// Open the side panel when the extension action icon is clicked
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    }).catch((err) => console.error("Side panel setup error:", err));
  }
});

// Helper to check if a URL is an internal restricted browser page
function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("devtools://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:")
  );
}

// Listen for messages from the side panel or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CAPTURE_SCREENSHOT") {
    return false;
  }

  // Query the currently focused window and active tab
  chrome.windows.getLastFocused({ populate: true }, (currentWindow) => {
    if (chrome.runtime.lastError || !currentWindow) {
      sendResponse({
        success: false,
        error: chrome.runtime.lastError?.message || "No active browser window found.",
      });
      return;
    }

    const activeTab = currentWindow.tabs?.find((t) => t.active);
    if (activeTab && isRestrictedUrl(activeTab.url)) {
      sendResponse({
        success: false,
        error:
          "Cannot capture internal browser pages (" +
          activeTab.url.split("/")[2] +
          "). Please open and switch to a regular web page (e.g. https://google.com or https://stackoverflow.com) and try again.",
      });
      return;
    }

    // Capture visible tab in the active window
    chrome.tabs.captureVisibleTab(
      currentWindow.id,
      { format: "png" },
      (image) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        if (!image) {
          sendResponse({
            success: false,
            error: "Failed to capture screenshot (empty image data returned).",
          });
          return;
        }

        sendResponse({
          success: true,
          image: image,
        });
      }
    );
  });

  // Required for asynchronous sendResponse
  return true;
});