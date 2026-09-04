/**
 * @file test_stt_pipeline.js
 * @description Automated Unit and Contract Tests for the STT module.
 */

import { STT_CONFIG, isEnglishOnlyModel } from "./config.js";
import { OutputHandler } from "./outputHandler.js";
import { AudioCaptureError } from "./audioCapture.js";
import { InferenceError } from "./inference.js";

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("\n🧪 Running STT Pipeline Verification Suite...\n");

// --- TEST 1: Config Module Contract ---
console.log("🔹 Test Group 1: Configuration Layer");
assert(typeof STT_CONFIG.modelId === "string", "STT_CONFIG has modelId");
assert(STT_CONFIG.modelId === "Xenova/whisper-small.en", "Default model is Xenova/whisper-small.en");
assert(STT_CONFIG.language === "english", "Default language is 'english'");
assert(STT_CONFIG.quantized === true, "Quantization is enabled by default");
assert(STT_CONFIG.targetSampleRate === 16000, "Target sample rate is strictly 16000Hz");
assert(isEnglishOnlyModel("Xenova/whisper-small.en") === true, "isEnglishOnlyModel detects .en suffix");
assert(isEnglishOnlyModel("Xenova/whisper-small") === false, "isEnglishOnlyModel detects multilingual models");
assert(isEnglishOnlyModel("openai/whisper-tiny") === false, "isEnglishOnlyModel detects non-.en models");

// Object immutability check
try {
  STT_CONFIG.modelId = "modified";
} catch {}
assert(STT_CONFIG.modelId === "Xenova/whisper-small.en", "STT_CONFIG is immutable (Object.freeze)");

// --- TEST 2: OutputHandler Module ---
console.log("\n🔹 Test Group 2: Output Handling Layer");

// Mock DOM Textarea element
class MockTextarea {
  constructor(initialValue = "") {
    this.value = initialValue;
    this.tagName = "TEXTAREA";
    this.style = {};
    this.selectionStart = initialValue.length;
    this.selectionEnd = initialValue.length;
    this.dispatchedEvents = [];
  }
  dispatchEvent(event) {
    this.dispatchedEvents.push(event.type);
  }
  focus() {
    this.focused = true;
  }
}

const mockInput = new MockTextarea("");
let submitted = false;

const handler = new OutputHandler({
  targetElement: mockInput,
  mode: "append",
  autoSubmit: true,
  onSubmit: () => { submitted = true; }
});

// Test Append Mode (Empty Initial)
handler.handleTranscription("Hello world");
assert(mockInput.value === "Hello world", "Empty input receives clean text in append mode");
assert(mockInput.dispatchedEvents.includes("input"), "Dispatches 'input' DOM event");
assert(mockInput.dispatchedEvents.includes("change"), "Dispatches 'change' DOM event");
assert(submitted === true, "Auto-submit triggers onSubmit callback");

// Test Append Mode (Subsequent Append)
submitted = false;
handler.handleTranscription("find the button", { autoSubmit: false });
assert(mockInput.value === "Hello world find the button", "Appends with smart spacing separator");
assert(submitted === false, "autoSubmit override is respected");

// Test Replace Mode
handler.handleTranscription("brand new query", { mode: "replace" });
assert(mockInput.value === "brand new query", "Replace mode overwrites previous content");

// Test Text Insertion at cursor
mockInput.value = "Click the now";
mockInput.selectionStart = 10;
mockInput.selectionEnd = 10;
handler.handleTranscription("blue button", { mode: "insert" });
assert(mockInput.value === "Click the blue button now", "Insert mode inserts at cursor position with spacing");

// --- TEST 3: Error Taxonomy Contracts ---
console.log("\n🔹 Test Group 3: Error Handling Taxonomy");
const audioErr = new AudioCaptureError("User denied mic", "PERMISSION_DENIED");
assert(audioErr.name === "AudioCaptureError", "AudioCaptureError name property");
assert(audioErr.code === "PERMISSION_DENIED", "AudioCaptureError typed error code");

const inferErr = new InferenceError("Failed to fetch ONNX", "MODEL_LOAD_FAILED");
assert(inferErr.name === "InferenceError", "InferenceError name property");
assert(inferErr.code === "MODEL_LOAD_FAILED", "InferenceError typed error code");

// --- Summary ---
console.log(`\n========================================`);
console.log(`✨ All ${passedTests}/${totalTests} Tests Passed Successfully!`);
console.log(`========================================\n`);
