/**
 * Cross-Browser WebExtension API Adapter
 * Unifies differences between Chrome, Edge (chrome.*), Firefox (browser.*), and Safari (browser.* / chrome.*)
 */

// Detect the global browser/chrome namespace
const globalObject = typeof globalThis !== "undefined"
  ? globalThis
  : typeof window !== "undefined"
    ? window
    : typeof self !== "undefined"
      ? self
      : this;

export const rawBrowser = globalObject.browser || globalObject.chrome || {};

/**
 * Wraps a callback-style or promise-style API function into a standardized Promise.
 */
function promisify(apiContext, method, ...args) {
  if (!apiContext || typeof apiContext[method] !== "function") {
    return Promise.reject(new Error(`API method ${method} is not supported in this browser context.`));
  }

  try {
    const result = apiContext[method](...args);
    // If the browser natively returned a Promise (Firefox, Safari MV3, modern Chrome)
    if (result && typeof result.then === "function") {
      return result;
    }
  } catch (err) {
    // If calling without callback threw because this browser requires a callback
  }

  // Fallback to callback pattern (older Chrome, Safari callback style)
  return new Promise((resolve, reject) => {
    try {
      apiContext[method](...args, (response) => {
        const lastErr = rawBrowser.runtime?.lastError || globalObject.chrome?.runtime?.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message || String(lastErr)));
        } else {
          resolve(response);
        }
      });
    } catch (callErr) {
      reject(callErr);
    }
  });
}

export const browserAPI = {
  get raw() {
    return rawBrowser;
  },

  runtime: {
    get lastError() {
      return rawBrowser.runtime?.lastError || globalObject.chrome?.runtime?.lastError || null;
    },

    getURL(path) {
      if (rawBrowser.runtime?.getURL) {
        return rawBrowser.runtime.getURL(path);
      }
      return path;
    },

    sendMessage(message) {
      return promisify(rawBrowser.runtime, "sendMessage", message);
    },

    onMessage: {
      addListener(callback) {
        if (rawBrowser.runtime?.onMessage?.addListener) {
          rawBrowser.runtime.onMessage.addListener(callback);
        }
      },
      removeListener(callback) {
        if (rawBrowser.runtime?.onMessage?.removeListener) {
          rawBrowser.runtime.onMessage.removeListener(callback);
        }
      },
      hasListener(callback) {
        if (rawBrowser.runtime?.onMessage?.hasListener) {
          return rawBrowser.runtime.onMessage.hasListener(callback);
        }
        return false;
      },
    },

    onInstalled: {
      addListener(callback) {
        if (rawBrowser.runtime?.onInstalled?.addListener) {
          rawBrowser.runtime.onInstalled.addListener(callback);
        }
      },
    },
  },

  tabs: {
    query(queryInfo) {
      return promisify(rawBrowser.tabs, "query", queryInfo);
    },

    sendMessage(tabId, message, options = {}) {
      if (Object.keys(options).length > 0) {
        return promisify(rawBrowser.tabs, "sendMessage", tabId, message, options);
      }
      return promisify(rawBrowser.tabs, "sendMessage", tabId, message);
    },

    captureVisibleTab(windowId, options = { format: "png" }) {
      if (windowId !== null && windowId !== undefined) {
        return promisify(rawBrowser.tabs, "captureVisibleTab", windowId, options);
      }
      return promisify(rawBrowser.tabs, "captureVisibleTab", options);
    },

    create(createProperties) {
      return promisify(rawBrowser.tabs, "create", createProperties);
    },
  },

  windows: {
    getLastFocused(getInfo = { populate: true }) {
      return promisify(rawBrowser.windows, "getLastFocused", getInfo);
    },

    getCurrent(getInfo = { populate: true }) {
      return promisify(rawBrowser.windows, "getCurrent", getInfo);
    },

    create(createData) {
      return promisify(rawBrowser.windows, "create", createData);
    },

    getAll(getInfo = {}) {
      return promisify(rawBrowser.windows, "getAll", getInfo);
    },

    update(windowId, updateInfo) {
      return promisify(rawBrowser.windows, "update", windowId, updateInfo);
    },
  },

  // Side Panel (Chrome & Edge)
  sidePanel: rawBrowser.sidePanel || null,

  // Sidebar Action (Firefox & Edge)
  sidebarAction: rawBrowser.sidebarAction || null,

  // Action / BrowserAction (Chrome, Edge, Firefox, Safari)
  action: rawBrowser.action || rawBrowser.browserAction || null,

  // Scripting (Dynamic content script injection)
  scripting: rawBrowser.scripting || null,

  // Storage
  storage: {
    local: {
      get(keys) {
        return promisify(rawBrowser.storage?.local, "get", keys);
      },
      set(items) {
        return promisify(rawBrowser.storage?.local, "set", items);
      },
      remove(keys) {
        return promisify(rawBrowser.storage?.local, "remove", keys);
      },
    },
  },
};

export default browserAPI;
