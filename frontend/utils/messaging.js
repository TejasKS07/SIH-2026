/**
 * Unified Messaging & Backend Communication Utility
 * Fully compatible with Chrome, Edge, Firefox, and Safari
 */

import { browserAPI } from "./browser-polyfill.js";

const BACKEND_URL = "http://localhost:8000";

/**
 * Capture a screenshot of the active browser tab via background script
 */
export async function captureScreenshot() {
  const response = await browserAPI.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
  if (!response || !response.success) {
    throw new Error(response?.error || "Failed to capture screenshot");
  }
  return response.image;
}

/**
 * Finds the user's active webpage tab across different window contexts
 * (Handles Firefox Sidebar, Safari popup window, and Chrome sidepanel)
 */
export async function getActiveWebPageTab() {
  try {
    // 1. First try last focused window (most accurate for sidebars/popups)
    const tabs1 = await browserAPI.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs1 && tabs1.length > 0 && !isExtensionUrl(tabs1[0].url)) {
      return tabs1[0];
    }

    // 2. Try current window
    const tabs2 = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tabs2 && tabs2.length > 0 && !isExtensionUrl(tabs2[0].url)) {
      return tabs2[0];
    }

    // 3. Fallback: all active tabs, finding the first non-extension URL
    const allActive = await browserAPI.tabs.query({ active: true });
    if (allActive && allActive.length > 0) {
      const webTab = allActive.find((t) => !isExtensionUrl(t.url));
      if (webTab) return webTab;
      return allActive[0];
    }
  } catch (err) {
    console.warn("Tab query warning:", err);
  }
  return null;
}

function isExtensionUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("safari-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  );
}

/**
 * Extract live DOM and form interactive element labels from the active page
 */
export async function extractDOMData() {
  try {
    const tab = await getActiveWebPageTab();
    if (!tab || !tab.id) {
      return { dom_elements: [] };
    }

    try {
      const response = await browserAPI.tabs.sendMessage(tab.id, { type: "EXTRACT_PAGE_DATA" });
      if (response && response.success) {
        return response;
      }
    } catch (msgErr) {
      // Content script may not be loaded on this tab yet, attempt injection if scripting API is available
      if (browserAPI.scripting?.executeScript) {
        try {
          await browserAPI.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content/content.js"],
          });
          const retryResponse = await browserAPI.tabs.sendMessage(tab.id, { type: "EXTRACT_PAGE_DATA" });
          if (retryResponse && retryResponse.success) {
            return retryResponse;
          }
        } catch {
          // Injection failed (e.g. restricted page), return empty
        }
      }
    }
  } catch (err) {
    console.warn("DOM extraction error:", err);
  }
  return { dom_elements: [] };
}

/**
 * Backend health check with timeout
 */
export async function checkBackendHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Call GoClick coordinate location endpoint
 */
export async function callBackendLocate(imageBase64, goalInfo, mode = "intent") {
  const res = await fetch(`${BACKEND_URL}/api/locate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBase64,
      goal_info: goalInfo,
      mode: mode,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Backend error (${res.status}): ${errorText || res.statusText}`);
  }

  return await res.json();
}

/**
 * Call multimodal PII detection endpoint
 */
export async function callBackendDetectPII(imageBase64, domElements = [], ocrSpans = []) {
  const res = await fetch(`${BACKEND_URL}/api/detect_pii`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBase64,
      dom_elements: domElements,
      ocr_spans: ocrSpans,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Backend error (${res.status}): ${errorText || res.statusText}`);
  }

  return await res.json();
}