/**
 * Content script to extract DOM elements and accessibility labels for privacy grounding
 * Compatible across Chrome, Edge, Firefox, and Safari
 */

(function () {
  const browserAPI = typeof globalThis.browser !== "undefined"
    ? globalThis.browser
    : globalThis.chrome;

  if (!browserAPI?.runtime?.onMessage) {
    return;
  }

  // Prevent multiple registrations if content script is injected multiple times
  if (window.__VISION_CHAT_CONTENT_SCRIPT_LOADED__) {
    return;
  }
  window.__VISION_CHAT_CONTENT_SCRIPT_LOADED__ = true;

  function getElementLabel(el) {
    // 1. Associated <label> elements
    if (el.labels && el.labels.length > 0 && el.labels[0].innerText) {
      return el.labels[0].innerText;
    }

    // 2. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;

    // 3. aria-labelledby
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl && labelEl.innerText) return labelEl.innerText;
    }

    // 4. placeholder
    if (el.placeholder) return el.placeholder;

    // 5. name attribute
    if (el.name) return el.name;

    // 6. title attribute
    if (el.title) return el.title;

    // 7. Inner text for buttons / clickable elements
    if ((el.tagName === "BUTTON" || el.getAttribute("role") === "button") && el.innerText) {
      return el.innerText.slice(0, 50);
    }

    return "";
  }

  function extractPageInteractiveElements() {
    const elements = [];
    const selector =
      "input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='button'], [role='searchbox'], [role='combobox']";

    const matchedElements = document.querySelectorAll(selector);
    const scrollX = window.scrollX ?? window.pageXOffset ?? document.documentElement.scrollLeft ?? 0;
    const scrollY = window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop ?? 0;

    matchedElements.forEach((el) => {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return;
        }

        const rawLabel = getElementLabel(el);

        elements.push({
          element_type: el.tagName.toLowerCase(),
          input_type: el.type || (el.getAttribute("role") ?? "text"),
          label: (rawLabel || "").trim(),
          bbox: [
            Math.round(rect.left + scrollX),
            Math.round(rect.top + scrollY),
            Math.round(rect.right + scrollX),
            Math.round(rect.bottom + scrollY),
          ],
        });
      } catch {
        // Ignore single element evaluation error
      }
    });

    return elements;
  }

  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "EXTRACT_PAGE_DATA") {
      try {
        const elements = extractPageInteractiveElements();
        sendResponse({
          success: true,
          dom_elements: elements,
          url: window.location.href,
        });
      } catch (err) {
        sendResponse({
          success: false,
          error: err.message,
          dom_elements: [],
        });
      }
    }
    return true;
  });
})();
