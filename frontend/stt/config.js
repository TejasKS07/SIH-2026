/**
 * @file config.js
 * @description Centralized Model Configuration for Speech-to-Text (STT) Module.
 * 
 * THIS IS THE ONLY FILE THAT SHOULD BE MODIFIED TO SWAP MODELS OR CHANGE
 * LANGUAGE SETTINGS. No downstream inference, capture, or UI layers hardcode these parameters.
 */

export const STT_CONFIG = Object.freeze({
  /**
   * Hugging Face model identifier for Transformers.js.
   * Default: English-only small Whisper model.
   * To switch to multilingual Whisper, change to 'Xenova/whisper-small' or 'Xenova/whisper-tiny'.
   */
  modelId: "Xenova/whisper-small.en",

  /**
   * Default transcription language.
   * Ignored by English-only models (.en suffix), but used directly when swapping to multilingual models.
   * Examples: 'english', 'spanish', 'french', 'hindi', 'auto' (for language auto-detection).
   */
  language: "english",

  /**
   * Use 8-bit quantized ONNX weights (q8).
   * Strongly recommended for browser client-side execution to minimize download size (~240MB vs ~960MB)
   * and optimize WASM/WebGPU inference memory footprint.
   */
  quantized: true,

  /**
   * Task type: 'transcribe' (speech-to-text in original language) or 'translate' (speech-to-English).
   */
  task: "transcribe",

  /**
   * Whisper audio chunk processing parameters (seconds).
   */
  chunkLengthS: 30,
  strideLengthS: 5,

  /**
   * Sampling rate strictly expected by Whisper models (16,000 Hz).
   */
  targetSampleRate: 16000,
});

/**
 * Helper to determine if the active modelId is an English-only variant.
 * English-only models reject explicit 'language' kwargs in Transformers.js.
 * @param {string} [modelId]
 * @returns {boolean}
 */
export function isEnglishOnlyModel(modelId = STT_CONFIG.modelId) {
  return typeof modelId === "string" && modelId.endsWith(".en");
}
