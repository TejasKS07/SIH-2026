/**
 * @file index.js
 * @description Barrel export for the Speech-to-Text (STT) module.
 */

export { STT_CONFIG, isEnglishOnlyModel } from "./config.js";
export { AudioCapture, AudioCaptureError } from "./audioCapture.js";
export { STTInference, InferenceError } from "./inference.js";
export { OutputHandler } from "./outputHandler.js";
export { STTController } from "./sttController.js";
