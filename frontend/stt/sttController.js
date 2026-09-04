/**
 * @file sttController.js
 * @description Central Orchestrator coordinating AudioCapture, STTInference, and OutputHandler.
 * 
 * Manages the complete STT workflow:
 * User Action -> AudioCapture -> 16kHz Float32Array -> STTInference -> OutputHandler -> Chatbot UI
 */

import { AudioCapture, AudioCaptureError } from "./audioCapture.js";
import { STTInference, InferenceError } from "./inference.js";
import { OutputHandler } from "./outputHandler.js";
import { STT_CONFIG } from "./config.js";

/**
 * @typedef {'idle' | 'recording' | 'processing_audio' | 'loading_model' | 'transcribing' | 'error'} STTState
 */

export class STTController {
  /**
   * @param {Object} [options]
   * @param {string | HTMLTextAreaElement} [options.targetElement="#prompt"]
   * @param {boolean} [options.autoSubmit=false]
   * @param {() => void} [options.onSubmit]
   */
  constructor(options = {}) {
    this.audioCapture = new AudioCapture({
      targetSampleRate: STT_CONFIG.targetSampleRate,
      enableVolumeMeter: true,
    });

    this.inference = new STTInference({ useWorker: true });

    this.outputHandler = new OutputHandler({
      targetElement: options.targetElement || "#prompt",
      mode: "append",
      autoSubmit: options.autoSubmit || false,
      onSubmit: options.onSubmit,
    });

    /** @type {STTState} */
    this.state = "idle";

    /** @type {((state: STTState, detail?: any) => void) | null} */
    this.stateChangeCallback = null;

    /** @type {((progress: Object) => void) | null} */
    this.progressCallback = null;

    /** @type {((error: { code: string, message: string }) => void) | null} */
    this.errorCallback = null;

    this._bindInternalEvents();
  }

  /**
   * Subscribe to state machine transitions.
   * @param {(state: STTState, detail?: any) => void} callback
   */
  onStateChange(callback) {
    this.stateChangeCallback = callback;
  }

  /**
   * Subscribe to model download / init progress.
   * @param {(progress: Object) => void} callback
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }

  /**
   * Subscribe to error notifications.
   * @param {(error: { code: string, message: string }) => void} callback
   */
  onError(callback) {
    this.errorCallback = callback;
  }

  /**
   * Subscribe to live audio volume updates (0.0 to 1.0).
   * @param {(volume: number) => void} callback
   */
  onVolume(callback) {
    this.audioCapture.onVolume(callback);
  }

  /**
   * Toggle recording state.
   * @returns {Promise<void>}
   */
  async toggleRecording() {
    if (this.state === "recording") {
      await this.stopRecording();
    } else if (this.state === "idle" || this.state === "error") {
      await this.startRecording();
    }
  }

  /**
   * Begin audio capture.
   * @returns {Promise<void>}
   */
  async startRecording() {
    try {
      this._setState("recording");
      await this.audioCapture.start();
    } catch (err) {
      this._handleError(err);
    }
  }

  /**
   * Stop recording, execute Whisper transcription, and inject text into the chatbot.
   * @returns {Promise<string | null>}
   */
  async stopRecording() {
    if (this.state !== "recording") {
      return null;
    }

    try {
      // 1. Process captured audio into 16kHz mono Float32Array
      this._setState("processing_audio");
      const audioData = await this.audioCapture.stop();

      // 2. Transcribe via Whisper
      if (!this.inference.isModelReady()) {
        this._setState("loading_model");
      } else {
        this._setState("transcribing");
      }

      const text = await this.inference.transcribe(audioData);

      // 3. Forward text to chatbot input flow
      if (text) {
        this.outputHandler.handleTranscription(text);
      }

      this._setState("idle", { transcribedText: text });
      return text;
    } catch (err) {
      this._handleError(err);
      return null;
    }
  }

  /**
   * Cancel and discard current recording session.
   */
  cancel() {
    this.audioCapture.cancel();
    this._setState("idle");
  }

  /**
   * Preload and cache Whisper model in the background (warm-up).
   * @returns {Promise<void>}
   */
  async preloadModel() {
    if (this.inference.isModelReady()) return;
    try {
      this._setState("loading_model");
      await this.inference.initModel();
      this._setState("idle");
    } catch (err) {
      this._handleError(err);
    }
  }

  /**
   * Current active state.
   * @returns {STTState}
   */
  getState() {
    return this.state;
  }

  /**
   * Helper to transition states and notify listeners.
   * @param {STTState} newState
   * @param {any} [detail]
   * @private
   */
  _setState(newState, detail = null) {
    this.state = newState;
    if (this.stateChangeCallback) {
      this.stateChangeCallback(newState, detail);
    }
  }

  /**
   * Handle errors from AudioCapture or Inference layers.
   * @param {Error} err
   * @private
   */
  _handleError(err) {
    console.error("[STTController] Error encountered:", err);
    this.audioCapture.cancel();

    let code = "UNKNOWN_ERROR";
    let message = err.message || "An unexpected error occurred.";

    if (err instanceof AudioCaptureError) {
      code = err.code;
    } else if (err instanceof InferenceError) {
      code = err.code;
    }

    this._setState("error", { code, message });

    if (this.errorCallback) {
      this.errorCallback({ code, message });
    }
  }

  /**
   * Bind progress and worker hooks.
   * @private
   */
  _bindInternalEvents() {
    this.inference.onProgress((progressData) => {
      if (this.progressCallback) {
        this.progressCallback(progressData);
      }
      if (progressData.status === "loading_model" && this.state !== "recording") {
        this._setState("loading_model", progressData);
      } else if (progressData.status === "model_ready" && this.state === "loading_model") {
        this._setState("transcribing");
      }
    });
  }
}
