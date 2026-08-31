const BACKEND_URL = "http://localhost:8000";

export async function captureScreenshot() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!response || !response.success) {
        reject(new Error(response?.error || "Failed to capture screenshot"));
        return;
      }
      resolve(response.image);
    });
  });
}

export async function extractDOMData() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        resolve({ dom_elements: [] });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "EXTRACT_PAGE_DATA" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          resolve({ dom_elements: [] });
          return;
        }
        resolve(response);
      });
    });
  });
}

export async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

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
    throw new Error(`Backend error (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

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
    throw new Error(`Backend error (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}