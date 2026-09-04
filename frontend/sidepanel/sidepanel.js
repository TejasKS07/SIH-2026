import {
  captureScreenshot,
  extractDOMData,
  checkBackendHealth,
  callBackendLocate,
  callBackendDetectPII,
} from "../utils/messaging.js";
import { browserAPI } from "../utils/browser-polyfill.js";
import { STTController } from "../stt/index.js";

// DOM Elements
const chat = document.getElementById("chat");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const captureBtn = document.getElementById("captureBtn");
const detectPiiBtn = document.getElementById("detectPiiBtn");
const previewContainer = document.getElementById("previewContainer");
const previewImage = document.getElementById("previewImage");
const overlayCanvas = document.getElementById("overlayCanvas");
const clearPreviewBtn = document.getElementById("clearPreview");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const popoutBtn = document.getElementById("popoutBtn");

// STT DOM Elements
const sttStatusContainer = document.getElementById("sttStatusContainer");
const sttStatusText = document.getElementById("sttStatusText");
const sttVisualizer = document.getElementById("sttVisualizer");
const sttCancelBtn = document.getElementById("sttCancelBtn");
const sttProgressBarWrapper = document.getElementById("sttProgressBarWrapper");
const sttProgressBar = document.getElementById("sttProgressBar");

let currentScreenshot = null;
let currentAnnotations = [];

// Initialize Backend Health Check
async function updateStatus() {
  const isHealthy = await checkBackendHealth();
  if (isHealthy) {
    statusBadge.className = "status-badge online";
    statusText.textContent = "Backend Online";
  } else {
    statusBadge.className = "status-badge offline";
    statusText.textContent = "Backend Offline (localhost:8000)";
  }
}

updateStatus();
setInterval(updateStatus, 8000);

// Pop-out / Standalone window handler (Great for Safari, detached desktop screens)
if (popoutBtn) {
  popoutBtn.addEventListener("click", async () => {
    try {
      const sidepanelUrl = browserAPI.runtime.getURL("sidepanel/sidepanel.html");
      if (browserAPI.windows?.create) {
        await browserAPI.windows.create({
          url: sidepanelUrl,
          type: "popup",
          width: 440,
          height: 750,
        });
      } else if (browserAPI.tabs?.create) {
        await browserAPI.tabs.create({ url: sidepanelUrl });
      } else {
        window.open(sidepanelUrl, "_blank", "width=440,height=750");
      }
    } catch (err) {
      console.warn("Popout window error:", err);
      window.open(window.location.href, "_blank", "width=440,height=750");
    }
  });
}

// Capture Screenshot Handler
captureBtn.addEventListener("click", async () => {
  try {
    captureBtn.disabled = true;
    captureBtn.textContent = "Capturing...";
    const image = await captureScreenshot();
    setScreenshot(image);
    addMessage("Screenshot captured from active tab.", "assistant");
  } catch (err) {
    addMessage(`Capture error: ${err.message}`, "assistant");
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = "📸 Capture";
  }
});

// Clear Screenshot
clearPreviewBtn.addEventListener("click", () => {
  currentScreenshot = null;
  currentAnnotations = [];
  previewContainer.style.display = "none";
  clearCanvas();
});

function setScreenshot(imageSrc) {
  currentScreenshot = imageSrc;
  currentAnnotations = [];
  previewImage.src = imageSrc;
  previewContainer.style.display = "block";
  clearCanvas();

  previewImage.onload = () => {
    redrawAnnotations();
  };
}

function syncCanvasSize() {
  const rect = previewImage.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    overlayCanvas.width = rect.width;
    overlayCanvas.height = rect.height;
  }
}

function clearCanvas() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function redrawAnnotations() {
  syncCanvasSize();
  clearCanvas();
  for (const ann of currentAnnotations) {
    if (ann.type === "box") {
      renderBoundingBox(ann.bbox, ann.label, ann.color);
    } else if (ann.type === "point") {
      renderPoint(ann.point, ann.label, ann.color);
    }
  }
}

window.addEventListener("resize", () => {
  if (currentScreenshot) {
    redrawAnnotations();
  }
});

function renderBoundingBox(bbox, label, color = "#10b981") {
  if (!bbox || bbox.length < 4) return;
  const ctx = overlayCanvas.getContext("2d");
  const imgW = previewImage.naturalWidth || previewImage.width;
  const imgH = previewImage.naturalHeight || previewImage.height;
  if (!imgW || !imgH) return;

  const scaleX = overlayCanvas.width / imgW;
  const scaleY = overlayCanvas.height / imgH;

  const [x1, y1, x2, y2] = bbox;
  const rx = x1 * scaleX;
  const ry = y1 * scaleY;
  const rw = (x2 - x1) * scaleX;
  const rh = (y2 - y1) * scaleY;

  // Box border
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(rx, ry, rw, rh);

  // Background tint
  ctx.fillStyle = color.startsWith("#") ? `${color}22` : "rgba(16, 185, 129, 0.15)";
  ctx.fillRect(rx, ry, rw, rh);

  // Label tag
  if (label) {
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
    const textMetrics = ctx.measureText(label);
    const tagHeight = 16;
    const tagWidth = textMetrics.width + 8;
    const tagY = Math.max(0, ry - tagHeight);

    ctx.fillStyle = color;
    ctx.fillRect(rx, tagY, tagWidth, tagHeight);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, rx + 4, tagY + 12);
  }
}

function renderPoint(point, label, color = "#ef4444") {
  if (!point || point.length < 2) return;
  const ctx = overlayCanvas.getContext("2d");
  const imgW = previewImage.naturalWidth || previewImage.width;
  const imgH = previewImage.naturalHeight || previewImage.height;
  if (!imgW || !imgH) return;

  const px = point[0] * (overlayCanvas.width / imgW);
  const py = point[1] * (overlayCanvas.height / imgH);

  // Target pulse / ring
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 12, 0, 2 * Math.PI);
  ctx.stroke();

  // Solid center dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, 2 * Math.PI);
  ctx.fill();

  // Label
  if (label) {
    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(px + 10, py - 10, textWidth + 8, 18);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, px + 14, py + 3);
  }
}

function addBoundingBox(bbox, label, color) {
  currentAnnotations.push({ type: "box", bbox, label, color });
  renderBoundingBox(bbox, label, color);
}

function addPoint(point, label, color) {
  currentAnnotations.push({ type: "point", point, label, color });
  renderPoint(point, label, color);
}

// Send / Locate Action
async function handleSend() {
  const query = promptInput.value.trim();
  if (!query) return;

  addMessage(query, "user");
  promptInput.value = "";

  try {
    sendBtn.disabled = true;

    if (!currentScreenshot) {
      addMessage("Capturing screenshot of active page...", "assistant");
      try {
        const img = await captureScreenshot();
        setScreenshot(img);
      } catch (captureErr) {
        addMessage(`⚠️ Screenshot error: ${captureErr.message}`, "assistant");
        return;
      }
    }

    addMessage(`Searching for "${query}" with GoClick...`, "assistant");
    const res = await callBackendLocate(currentScreenshot, query);

    if (res.found_coordinates) {
      currentAnnotations = [];
      syncCanvasSize();
      clearCanvas();
      addPoint(res.point, query, "#ef4444");
      addMessage(
        `🎯 Located target at (${res.point[0]}, ${res.point[1]}) with confidence ${(res.confidence * 100).toFixed(1)}%.`,
        "assistant"
      );
    } else {
      addMessage("❌ Could not ground coordinates for this description.", "assistant");
    }
  } catch (err) {
    addMessage(
      `⚠️ Backend error: ${err.message}. Make sure the backend server is running on http://localhost:8000.`,
      "assistant"
    );
  } finally {
    sendBtn.disabled = false;
  }
}

// Scan PII Action
detectPiiBtn.addEventListener("click", async () => {
  try {
    detectPiiBtn.disabled = true;
    detectPiiBtn.textContent = "Scanning...";

    if (!currentScreenshot) {
      try {
        const img = await captureScreenshot();
        setScreenshot(img);
      } catch (captureErr) {
        addMessage(`⚠️ Screenshot error: ${captureErr.message}`, "assistant");
        return;
      }
    }

    addMessage("Extracting live page signals and scanning for sensitive PII regions...", "assistant");
    const pageData = await extractDOMData();
    const result = await callBackendDetectPII(currentScreenshot, pageData.dom_elements || []);

    currentAnnotations = [];
    syncCanvasSize();
    clearCanvas();

    const accepted = result.regions || [];
    const uncertain = result.uncertain_regions || [];

    if (accepted.length === 0 && uncertain.length === 0) {
      addMessage("✅ No sensitive PII or credential fields detected on this page.", "assistant");
    } else {
      let msg = `🔒 Detected ${accepted.length} protected region(s):<br>`;
      accepted.forEach((reg) => {
        msg += `<span class="region-tag">${reg.type}</span> (bbox: [${reg.bbox.join(", ")}])<br>`;
        addBoundingBox(reg.bbox, reg.type, "#10b981");
      });

      if (uncertain.length > 0) {
        msg += `<br>⚠️ ${uncertain.length} uncertain region(s) routed for secondary verification.`;
        uncertain.forEach((reg) => {
          if (reg.bbox) addBoundingBox(reg.bbox, `? ${reg.type}`, "#f59e0b");
        });
      }

      addMessage(msg, "assistant");
    }
  } catch (err) {
    addMessage(`PII Scan Error: ${err.message}`, "assistant");
  } finally {
    detectPiiBtn.disabled = false;
    detectPiiBtn.textContent = "🔒 Scan PII";
  }
});

sendBtn.addEventListener("click", handleSend);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.innerHTML = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ----------------------------------------------------
// Speech-to-Text (STT) Integration
// ----------------------------------------------------
if (micBtn) {
  const stt = new STTController({
    targetElement: promptInput,
    autoSubmit: false,
    onSubmit: handleSend,
  });

  // Handle STT State Transitions
  stt.onStateChange((state, detail) => {
    switch (state) {
      case "recording":
        micBtn.classList.add("recording");
        micBtn.classList.remove("loading");
        micBtn.title = "Click to stop recording";
        micBtn.innerHTML = '<span class="mic-icon">⏹️</span>';
        sttStatusContainer.style.display = "flex";
        sttStatusText.textContent = "Listening... (Click ⏹️ to transcribe)";
        sttVisualizer.style.display = "flex";
        sttVisualizer.classList.add("active");
        sttProgressBarWrapper.style.display = "none";
        break;

      case "processing_audio":
        micBtn.classList.remove("recording");
        micBtn.classList.add("loading");
        sttStatusText.textContent = "Processing audio...";
        sttVisualizer.classList.remove("active");
        break;

      case "loading_model":
        micBtn.classList.remove("recording");
        micBtn.classList.add("loading");
        sttStatusContainer.style.display = "flex";
        sttStatusText.textContent = "Loading Whisper AI model (first run may download ONNX weights)...";
        sttVisualizer.style.display = "none";
        sttProgressBarWrapper.style.display = "block";
        break;

      case "transcribing":
        micBtn.classList.remove("recording");
        micBtn.classList.add("loading");
        sttStatusContainer.style.display = "flex";
        sttStatusText.textContent = "Transcribing speech on-device...";
        sttVisualizer.style.display = "none";
        sttProgressBarWrapper.style.display = "none";
        break;

      case "idle":
        micBtn.classList.remove("recording", "loading");
        micBtn.title = "Click to speak (Whisper STT)";
        micBtn.innerHTML = '<span class="mic-icon">🎙️</span>';
        sttStatusContainer.style.display = "none";
        sttVisualizer.classList.remove("active");
        sttProgressBarWrapper.style.display = "none";
        if (detail && detail.transcribedText) {
          console.log("[STT] Transcription complete:", detail.transcribedText);
        }
        break;

      case "error":
        micBtn.classList.remove("recording", "loading");
        micBtn.title = "Click to speak (Whisper STT)";
        micBtn.innerHTML = '<span class="mic-icon">🎙️</span>';
        sttStatusContainer.style.display = "none";
        sttVisualizer.classList.remove("active");
        sttProgressBarWrapper.style.display = "none";
        break;
    }
  });

  // Handle Model Download & Initialization Progress
  stt.onProgress((progress) => {
    if (!progress) return;
    if (progress.status === "progress" && progress.total) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      sttProgressBar.style.width = `${pct}%`;
      const fileLabel = progress.file ? ` (${progress.file})` : "";
      sttStatusText.textContent = `Downloading Whisper model${fileLabel}: ${pct}%`;
    } else if (progress.status === "done") {
      sttProgressBar.style.width = "100%";
      sttStatusText.textContent = "Model weights downloaded. Initializing pipeline...";
    }
  });

  // Handle Errors Gracefully
  stt.onError(({ code, message }) => {
    console.warn(`[STT Error: ${code}]`, message);
    if (code === "PERMISSION_DENIED") {
      addMessage(
        "🎤 <strong>Microphone Permission Denied:</strong> Please click the extension icon or browser settings to allow microphone access.",
        "assistant"
      );
    } else if (code === "DEVICE_NOT_FOUND") {
      addMessage("🎤 <strong>No Microphone Found:</strong> Please connect a microphone and try again.", "assistant");
    } else {
      addMessage(`⚠️ <strong>Speech-to-Text Error:</strong> ${message}`, "assistant");
    }
  });

  // Dynamic Volume Visualizer
  stt.onVolume((volume) => {
    const bars = sttVisualizer.querySelectorAll(".bar");
    bars.forEach((bar, idx) => {
      const height = Math.max(3, Math.min(14, Math.round(volume * 18 * (1 + idx * 0.2))));
      bar.style.height = `${height}px`;
    });
  });

  // User Action Bindings
  micBtn.addEventListener("click", () => {
    stt.toggleRecording();
  });

  if (sttCancelBtn) {
    sttCancelBtn.addEventListener("click", () => {
      stt.cancel();
    });
  }
}