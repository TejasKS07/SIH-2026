/**
 * @file suppress-warnings.js
 * @description Filters out benign WebAssembly compiler and ONNX Runtime graph optimization notices
 * so Chrome Extension DevTools does not capture them as extension warnings.
 */

(function () {
  const originalWarn = console.warn;
  console.warn = function (...args) {
    if (args.length > 0 && typeof args[0] === "string") {
      const msg = args[0];
      // Suppress ONNX Runtime WebAssembly internal graph optimization and dead-node cleanup notices
      if (
        msg.includes("[W:onnxruntime:") ||
        msg.includes("CleanUnusedInitializersAndNodeArgs") ||
        msg.includes("Removing initializer")
      ) {
        return;
      }
    }
    originalWarn.apply(console, args);
  };
})();
