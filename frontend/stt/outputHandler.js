/**
 * @file outputHandler.js
 * @description Output handling layer for Speech-to-Text transcription results.
 * 
 * Responsibilities:
 * - Ingests transcribed plain text strings.
 * - Injects text into the chatbot input textarea or custom input element.
 * - Handles cursor positioning, auto-resizing, and DOM event dispatching.
 * - Supports optional auto-submit or append modes.
 * 
 * Decoupling:
 * - Has ZERO knowledge of Whisper, Transformers.js, model config, or audio capture.
 */

export class OutputHandler {
  /**
   * @param {Object} [options]
   * @param {string | HTMLTextAreaElement | HTMLInputElement} [options.targetElement="#prompt"] - Target input selector or element
   * @param {'append' | 'replace' | 'insert'} [options.mode='append'] - How to insert transcribed text
   * @param {boolean} [options.autoSubmit=false] - Whether to trigger chat send immediately after transcription
   * @param {() => void} [options.onSubmit] - Callback triggered if autoSubmit is enabled
   */
  constructor(options = {}) {
    this.targetSelectorOrElement = options.targetElement || "#prompt";
    this.mode = options.mode || "append";
    this.autoSubmit = options.autoSubmit || false;
    this.onSubmit = options.onSubmit || null;

    /** @type {((text: string) => void) | null} */
    this.onTextHandledCallback = null;
  }

  /**
   * Register a listener for processed transcription text.
   * @param {(text: string) => void} callback
   */
  onText(callback) {
    this.onTextHandledCallback = callback;
  }

  /**
   * Resolve target input element from DOM.
   * @returns {HTMLTextAreaElement | HTMLInputElement | null}
   */
  getTargetElement() {
    if (typeof this.targetSelectorOrElement === "string") {
      return document.querySelector(this.targetSelectorOrElement);
    } else if (this.targetSelectorOrElement instanceof HTMLElement) {
      return this.targetSelectorOrElement;
    }
    return null;
  }

  /**
   * Main entry point: Process and deliver transcribed text to the chatbot UI.
   * @param {string} text - Clean transcribed text
   * @param {Object} [overrides] - Per-call override options
   * @param {'append' | 'replace' | 'insert'} [overrides.mode]
   * @param {boolean} [overrides.autoSubmit]
   * @returns {boolean} True if successfully delivered to target element
   */
  handleTranscription(text, overrides = {}) {
    const trimmedText = typeof text === "string" ? text.trim() : "";
    if (!trimmedText) {
      return false;
    }

    const targetEl = this.getTargetElement();
    const mode = overrides.mode || this.mode;
    const shouldSubmit = overrides.autoSubmit !== undefined ? overrides.autoSubmit : this.autoSubmit;

    if (targetEl) {
      this._insertTextIntoElement(targetEl, trimmedText, mode);
    }

    if (this.onTextHandledCallback) {
      this.onTextHandledCallback(trimmedText);
    }

    if (shouldSubmit && typeof this.onSubmit === "function") {
      this.onSubmit();
    }

    return true;
  }

  /**
   * Inserts text into standard HTML input/textarea with proper cursor and event handling.
   * @param {HTMLTextAreaElement | HTMLInputElement} element
   * @param {string} text
   * @param {'append' | 'replace' | 'insert'} mode
   * @private
   */
  _insertTextIntoElement(element, text, mode) {
    const currentValue = element.value || "";

    if (mode === "replace" || currentValue.trim().length === 0) {
      element.value = text;
      element.selectionStart = element.selectionEnd = text.length;
    } else if (mode === "insert" && element.selectionStart !== undefined) {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const before = currentValue.substring(0, start);
      const after = currentValue.substring(end);
      
      const spacerBefore = (before.length > 0 && !before.endsWith(" ")) ? " " : "";
      const spacerAfter = (after.length > 0 && !after.startsWith(" ")) ? " " : "";
      
      const inserted = `${spacerBefore}${text}${spacerAfter}`;
      element.value = before + inserted + after;
      element.selectionStart = element.selectionEnd = start + inserted.length;
    } else {
      // Default: append mode
      const spacer = currentValue.endsWith(" ") || currentValue.length === 0 ? "" : " ";
      element.value = `${currentValue}${spacer}${text}`;
      element.selectionStart = element.selectionEnd = element.value.length;
    }

    // Dispatch input and change events so framework listeners/character counters fire
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    // Focus target element
    element.focus();

    // Auto-adjust textarea height if scrollable
    if (element.tagName === "TEXTAREA") {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
    }
  }
}
