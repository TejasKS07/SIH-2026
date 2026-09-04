/**
 * @file inference.js
 * @description Speech-to-Text inference layer wrapping Transformers.js and Whisper.
 * 
 * Responsibilities:
 * - Reads modelId, language, and quantization from config.js (NO hardcoded parameters).
 * - Implements lazy loading and pipeline caching (singleton pattern).
 * - Supports background Web Worker execution with seamless main-thread fallback.
 * - Emits granular download and initialization progress events.
 * - Exposes a clean `transcribe(audioData) -> Promise<string>` interface.
 * 
 * Decoupling:
 * - Has no awareness of mic hardware, audio capture devices, or chat UI DOM elements.
 */

import { STT_CONFIG, isEnglishOnlyModel } from "./config.js";

// Suppress benign ONNX graph cleanup warnings
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

export class InferenceError extends Error {
  /**
   * @param {string} message
   * @param {'MODEL_LOAD_FAILED' | 'INFERENCE_FAILED' | 'WORKER_ERROR' | 'INVALID_AUDIO'} code
   * @param {Error} [originalError]
   */
  constructor(message, code, originalError = null) {
    super(message);
    this.name = "InferenceError";
    this.code = code;
    this.originalError = originalError;
  }
}

export class STTInference {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.useWorker=true] - Run inference in a dedicated Web Worker to prevent UI thread lag
   */
  constructor(options = {}) {
    this.useWorker = options.useWorker !== false && typeof Worker !== "undefined";

    // Direct main-thread pipeline cache
    this.pipelineInstance = null;
    this.isLoading = false;
    this.isReady = false;

    // Web Worker state
    this.worker = null;
    this.pendingWorkerRequests = new Map();
    this.requestIdCounter = 0;

    /** @type {((progress: Object) => void) | null} */
    this.progressCallback = null;

    if (this.useWorker) {
      this._initWorker();
    }
  }

  /**
   * Register or update the model download/initialization progress callback.
   * @param {(progress: { status: string, file?: string, progress?: number, loaded?: number, total?: number }) => void} callback
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }

  /**
   * Initialize and pre-warm the Whisper model.
   * Downloads ONNX weights on first run and caches them in browser IndexedDB.
   * @param {((progress: Object) => void)} [onProgress]
   * @returns {Promise<void>}
   */
  async initModel(onProgress = null) {
    if (onProgress) {
      this.progressCallback = onProgress;
    }

    if (this.isReady) {
      return;
    }

    if (this.useWorker && this.worker) {
      return this._sendWorkerMessage("init", {});
    } else {
      return this._initDirectPipeline();
    }
  }

  /**
   * Transcribe 16kHz mono Float32Array audio samples into text.
   * @param {Float32Array} audioData - 16kHz mono audio samples in range [-1.0, 1.0]
   * @returns {Promise<string>} Transcribed text string
   */
  async transcribe(audioData) {
    if (!audioData || !(audioData instanceof Float32Array) || audioData.length === 0) {
      throw new InferenceError(
        "Invalid audio data provided. Expected a non-empty Float32Array.",
        "INVALID_AUDIO"
      );
    }

    // Ensure model is ready before transcribing
    if (!this.isReady) {
      await this.initModel();
    }

    if (this.useWorker && this.worker) {
      try {
        const response = await this._sendWorkerMessage("transcribe", { audio: audioData });
        return response.text || "";
      } catch (err) {
        console.warn("[STTInference] Worker transcription failed, attempting main-thread fallback...", err);
        return this._transcribeDirect(audioData);
      }
    } else {
      return this._transcribeDirect(audioData);
    }
  }

  /**
   * Check if the Whisper model is currently loaded and ready for inference.
   * @returns {boolean}
   */
  isModelReady() {
    return this.isReady;
  }

  /**
   * Returns a copy of the active STT configuration.
   * @returns {Readonly<typeof STT_CONFIG>}
   */
  getConfig() {
    return { ...STT_CONFIG };
  }

  /**
   * Initialize Web Worker bridge.
   * @private
   */
  _initWorker() {
    try {
      const workerUrl = new URL("./sttWorker.js", import.meta.url).href;
      this.worker = new Worker(workerUrl, { type: "module" });

      this.worker.onmessage = (event) => {
        const { id, type, text, error, data, status, modelId } = event.data;

        // Progress events
        if (type === "progress" && this.progressCallback) {
          this.progressCallback(data);
          return;
        }

        // Status events
        if (type === "status") {
          if (status === "model_ready") {
            this.isReady = true;
          }
          if (this.progressCallback) {
            this.progressCallback({ status, modelId, error });
          }
          return;
        }

        // Response to pending requests
        if (id !== undefined && this.pendingWorkerRequests.has(id)) {
          const { resolve, reject } = this.pendingWorkerRequests.get(id);
          this.pendingWorkerRequests.delete(id);

          if (type === "init_success") {
            this.isReady = true;
            resolve();
          } else if (type === "transcribe_success") {
            resolve({ text });
          } else if (type === "init_error" || type === "transcribe_error") {
            reject(new InferenceError(error || "Worker operation failed", "WORKER_ERROR"));
          }
        }
      };

      this.worker.onerror = (err) => {
        console.error("[STTInference] Worker encountered an unhandled error:", err);
        this.useWorker = false;
        this.worker = null;
      };
    } catch (err) {
      console.warn("[STTInference] Failed to instantiate Web Worker. Defaulting to main-thread execution:", err);
      this.useWorker = false;
      this.worker = null;
    }
  }

  /**
   * Send a request to the background Web Worker.
   * @param {string} type
   * @param {Object} payload
   * @returns {Promise<any>}
   * @private
   */
  _sendWorkerMessage(type, payload) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new InferenceError("Web Worker is not active", "WORKER_ERROR"));
        return;
      }
      const id = ++this.requestIdCounter;
      this.pendingWorkerRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  /**
   * Direct main-thread pipeline initialization (fallback).
   * @private
   */
  async _initDirectPipeline() {
    if (this.pipelineInstance) {
      this.isReady = true;
      return;
    }

    this.isLoading = true;
    try {
      if (this.progressCallback) {
        this.progressCallback({ status: "loading_model", modelId: STT_CONFIG.modelId });
      }

      const { pipeline, env } = await import(LOCAL_TRANSFORMERS);

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
            numThreads: 1,
            simd: true,
            wasmPaths: {
              "ort-wasm-simd.wasm": new URL("./ort-wasm-simd.wasm", import.meta.url).href,
              "ort-wasm.wasm": new URL("./ort-wasm.wasm", import.meta.url).href,
            },
          };
        }
      }

      this.pipelineInstance = await pipeline(
        "automatic-speech-recognition",
        STT_CONFIG.modelId,
        {
          quantized: STT_CONFIG.quantized,
          progress_callback: (progressData) => {
            if (this.progressCallback) {
              this.progressCallback(progressData);
            }
          },
        }
      );

      this.isReady = true;
      if (this.progressCallback) {
        this.progressCallback({ status: "model_ready", modelId: STT_CONFIG.modelId });
      }
    } catch (err) {
      this.isReady = false;
      throw new InferenceError(
        `Failed to load Whisper model '${STT_CONFIG.modelId}': ${err.message}`,
        "MODEL_LOAD_FAILED",
        err
      );
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Direct main-thread transcription execution.
   * @param {Float32Array} audioData
   * @returns {Promise<string>}
   * @private
   */
  async _transcribeDirect(audioData) {
    if (!this.pipelineInstance) {
      await this._initDirectPipeline();
    }

    try {
      const options = {
        chunk_length_s: STT_CONFIG.chunkLengthS,
        stride_length_s: STT_CONFIG.strideLengthS,
        return_timestamps: false,
      };

      if (!isEnglishOnlyModel(STT_CONFIG.modelId)) {
        if (STT_CONFIG.language && STT_CONFIG.language !== "auto") {
          options.language = STT_CONFIG.language;
        }
        if (STT_CONFIG.task) {
          options.task = STT_CONFIG.task;
        }
      }

      const output = await this.pipelineInstance(audioData, options);
      return (output && typeof output.text === "string") ? output.text.trim() : "";
    } catch (err) {
      throw new InferenceError(
        `Whisper transcription failed: ${err.message}`,
        "INFERENCE_FAILED",
        err
      );
    }
  }
}
