// Content script to extract DOM elements and accessibility labels for privacy grounding
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_PAGE_DATA") {
    try {
      const elements = [];
      const formFields = document.querySelectorAll("input, textarea, select, button, [contenteditable='true'], [role='textbox']");

      formFields.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          let labelText = "";
          if (el.labels && el.labels.length > 0) {
            labelText = el.labels[0].innerText;
          } else if (el.getAttribute("aria-label")) {
            labelText = el.getAttribute("aria-label");
          } else if (el.placeholder) {
            labelText = el.placeholder;
          } else if (el.name) {
            labelText = el.name;
          }

          elements.push({
            element_type: el.tagName.toLowerCase(),
            input_type: el.type || "text",
            label: labelText.trim(),
            bbox: [
              Math.round(rect.left + window.scrollX),
              Math.round(rect.top + window.scrollY),
              Math.round(rect.right + window.scrollX),
              Math.round(rect.bottom + window.scrollY),
            ],
          });
        }
      });

      sendResponse({ success: true, dom_elements: elements, url: window.location.href });
    } catch (err) {
      sendResponse({ success: false, error: err.message, dom_elements: [] });
    }
  }
  return true;
});
