import {
  captureScreenshot,
  extractDOMData,
  checkBackendHealth,
  callBackendLocate,
  callBackendDetectPII,
} from "../utils/messaging.js";

// DOM Elements
const chat = document.getElementById("chat");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const captureBtn = document.getElementById("captureBtn");
const detectPiiBtn = document.getElementById("detectPiiBtn");
const previewContainer = document.getElementById("previewContainer");
const previewImage = document.getElementById("previewImage");
const overlayCanvas = document.getElementById("overlayCanvas");
const clearPreviewBtn = document.getElementById("clearPreview");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");

let currentScreenshot = null;

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
  previewContainer.style.display = "none";
  clearCanvas();
});

function setScreenshot(imageSrc) {
  currentScreenshot = imageSrc;
  previewImage.src = imageSrc;
  previewContainer.style.display = "block";
  clearCanvas();
}

function clearCanvas() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawBoundingBox(bbox, label, color = "#10a37f") {
  if (!bbox || bbox.length < 4) return;
  const ctx = overlayCanvas.getContext("2d");
  const imgW = previewImage.naturalWidth || previewImage.width;
  const imgH = previewImage.naturalHeight || previewImage.height;

  overlayCanvas.width = previewImage.clientWidth;
  overlayCanvas.height = previewImage.clientHeight;

  const scaleX = overlayCanvas.width / imgW;
  const scaleY = overlayCanvas.height / imgH;

  const [x1, y1, x2, y2] = bbox;
  const rx = x1 * scaleX;
  const ry = y1 * scaleY;
  const rw = (x2 - x1) * scaleX;
  const rh = (y2 - y1) * scaleY;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(rx, ry, rw, rh);

  ctx.fillStyle = color;
  ctx.font = "bold 11px sans-serif";
  ctx.fillText(label, rx + 4, Math.max(14, ry - 4));
}

function drawPoint(point, label, color = "#ef4444") {
  if (!point || point.length < 2) return;
  const ctx = overlayCanvas.getContext("2d");
  const imgW = previewImage.naturalWidth || previewImage.width;
  const imgH = previewImage.naturalHeight || previewImage.height;

  overlayCanvas.width = previewImage.clientWidth;
  overlayCanvas.height = previewImage.clientHeight;

  const px = point[0] * (overlayCanvas.width / imgW);
  const py = point[1] * (overlayCanvas.height / imgH);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText(label, px + 10, py + 4);
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
      clearCanvas();
      drawPoint(res.point, query);
      addMessage(
        `🎯 Located target at (${res.point[0]}, ${res.point[1]}) with confidence ${(res.confidence * 100).toFixed(1)}%.`,
        "assistant"
      );
    } else {
      addMessage("❌ Could not ground coordinates for this description.", "assistant");
    }
  } catch (err) {
    addMessage(`⚠️ Backend error: ${err.message}. Make sure 'python server.py --mock' is running on localhost:8000.`, "assistant");
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

    clearCanvas();

    const accepted = result.regions || [];
    const uncertain = result.uncertain_regions || [];

    if (accepted.length === 0 && uncertain.length === 0) {
      addMessage("✅ No sensitive PII or credential fields detected on this page.", "assistant");
    } else {
      let msg = `🔒 Detected ${accepted.length} protected region(s):<br>`;
      accepted.forEach((reg) => {
        msg += `<span class="region-tag">${reg.type}</span> (bbox: [${reg.bbox.join(", ")}])<br>`;
        drawBoundingBox(reg.bbox, reg.type, "#10b981");
      });

      if (uncertain.length > 0) {
        msg += `<br>⚠️ ${uncertain.length} uncertain region(s) routed for secondary verification.`;
        uncertain.forEach((reg) => {
          if (reg.bbox) drawBoundingBox(reg.bbox, `? ${reg.type}`, "#f59e0b");
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