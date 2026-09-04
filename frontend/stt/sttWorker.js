/**
 * @file sttWorker.js
 * @description Dedicated Web Worker for running Transformers.js Whisper inference in the background.
 * Prevents the extension UI thread from freezing during model loading and ASR computation.
 */

import { STT_CONFIG, isEnglishOnlyModel } from "./config.js";

// Suppress benign ONNX graph cleanup warnings in Worker
if (typeof console !== "undefined" && console.warn) {
  const origWarn = console.warn;
  console.warn = function (...args) {
    if (
      args.length > 0 &&
      typeof args[0] === "string" &&
      (args[0].includes("[W:onnxruntime:") ||
       args[0].includes("CleanUnusedInitializersAndNodeArgs") ||
       args[0].includes("Removing initializer"))
    ) {
      return;
    }
    origWarn.apply(console, args);
  };
}

// Import Transformers.js locally from extension bundle (strictly complies with MV3 CSP)
const LOCAL_TRANSFORMERS = "./transformers.min.js";

let pipeline = null;
let env = null;
let transcriberInstance = null;
let isInitializing = false;

/**
 * Lazily load Transformers.js library from local bundle.
 */
async function loadTransformers() {
  if (pipeline && env) return;

  try {
    const module = await import(LOCAL_TRANSFORMERS);
    pipeline = module.pipeline;
    env = module.env;

    // Configure local models support (loads instantly if stored in extension models/ folder, falls back to remote)
    if (env) {
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      env.localModelPath = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
        ? chrome.runtime.getURL("models/")
        : new URL("../models/", import.meta.url).href;

      if (env.backends && env.backends.onnx) {
        env.backends.onnx.logLevel = "error"; // Suppress benign ONNX graph cleanup warnings
        env.backends.onnx.wasm = {
          numThreads: 1, // Safe single thread default for extension workers
          simd: true,
          wasmPaths: {
            "ort-wasm-simd.wasm": new URL("./ort-wasm-simd.wasm", import.meta.url).href,
            "ort-wasm.wasm": new URL("./ort-wasm.wasm", import.meta.url).href,
          },
        };
      }
    }
  } catch (err) {
    throw new Error(`Failed to load Transformers.js runtime: ${err.message}`);
  }
}

/**
 * Initializes or returns the cached pipeline singleton.
 */
async function getTranscriber() {
  if (transcriberInstance) {
    return transcriberInstance;
  }

  if (isInitializing) {
    // Wait for existing initialization to finish
    while (isInitializing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (transcriberInstance) return transcriberInstance;
  }

  isInitializing = true;
  await loadTransformers();

  try {
    self.postMessage({
      type: "status",
      status: "loading_model",
      modelId: STT_CONFIG.modelId,
    });

    transcriberInstance = await pipeline("automatic-speech-recognition", STT_CONFIG.modelId, {
      quantized: STT_CONFIG.quantized,
      progress_callback: (progressData) => {
        // Forward download / initialization progress to main thread
        self.postMessage({
          type: "progress",
          data: progressData,
        });
      },
    });

    self.postMessage({
      type: "status",
      status: "model_ready",
      modelId: STT_CONFIG.modelId,
    });

    return transcriberInstance;
  } catch (err) {
    self.postMessage({
      type: "status",
      status: "model_error",
      error: err.message,
    });
    throw err;
  } finally {
    isInitializing = false;
  }
}

// Handle incoming messages from the inference module
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  if (type === "init") {
    try {
      await getTranscriber();
      self.postMessage({ id, type: "init_success" });
    } catch (err) {
      self.postMessage({ id, type: "init_error", error: err.message });
    }
    return;
  }

  if (type === "transcribe") {
    try {
      const transcriber = await getTranscriber();
      const audioData = payload.audio; // Float32Array

      if (!audioData || audioData.length === 0) {
        throw new Error("Empty audio buffer received for transcription.");
      }

      // Build generation options strictly derived from STT_CONFIG
      const options = {
        chunk_length_s: STT_CONFIG.chunkLengthS,
        stride_length_s: STT_CONFIG.strideLengthS,
        return_timestamps: false,
      };

      // Only pass language and task if model is multilingual (English-only models do not accept them)
      if (!isEnglishOnlyModel(STT_CONFIG.modelId)) {
        if (STT_CONFIG.language && STT_CONFIG.language !== "auto") {
          options.language = STT_CONFIG.language;
        }
        if (STT_CONFIG.task) {
          options.task = STT_CONFIG.task;
        }
      }

      const output = await transcriber(audioData, options);

      const text = (output && typeof output.text === "string") ? output.text.trim() : "";

      self.postMessage({
        id,
        type: "transcribe_success",
        text,
      });
    } catch (err) {
      self.postMessage({
        id,
        type: "transcribe_error",
        error: err.message,
      });
    }
  }
};
