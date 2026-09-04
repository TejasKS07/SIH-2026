/**
 * @file audioCapture.js
 * @description Audio capture and preprocessing module for browser extension context.
 * 
 * Responsibilities:
 * - Requests and verifies microphone permissions.
 * - Captures raw microphone audio using Web Audio API / MediaRecorder.
 * - Resamples and downmixes audio strictly to 16,000 Hz single-channel (mono) Float32Array.
 * - Emits volume levels for UI audio visualization.
 * 
 * Decoupling:
 * - Contains ZERO knowledge of Whisper, Transformers.js, or model configuration.
 */

export class AudioCaptureError extends Error {
  /**
   * @param {string} message
   * @param {'PERMISSION_DENIED' | 'DEVICE_NOT_FOUND' | 'DEVICE_BUSY' | 'RECORDING_FAILED' | 'EMPTY_AUDIO' | 'UNSUPPORTED'} code
   * @param {Error} [originalError]
   */
  constructor(message, code, originalError = null) {
    super(message);
    this.name = "AudioCaptureError";
    this.code = code;
    this.originalError = originalError;
  }
}

export class AudioCapture {
  /**
   * @param {Object} [options]
   * @param {number} [options.targetSampleRate=16000] - Sample rate required by downstream consumer (default: 16kHz)
   * @param {boolean} [options.enableVolumeMeter=true] - Whether to compute live volume levels
   */
  constructor(options = {}) {
    this.targetSampleRate = options.targetSampleRate || 16000;
    this.enableVolumeMeter = options.enableVolumeMeter !== false;

    /** @type {MediaStream | null} */
    this.mediaStream = null;

    /** @type {MediaRecorder | null} */
    this.mediaRecorder = null;

    /** @type {Blob[]} */
    this.recordedChunks = [];

    /** @type {AudioContext | null} */
    this.audioContext = null;

    /** @type {AnalyserNode | null} */
    this.analyserNode = null;

    /** @type {number | null} */
    this.volumeInterval = null;

    /** @type {((volume: number) => void) | null} */
    this.volumeCallback = null;

    this.recordingState = "idle"; // 'idle' | 'recording' | 'processing'
  }

  /**
   * Check if microphone permission is currently granted without triggering a prompt if possible.
   * @returns {Promise<'granted' | 'denied' | 'prompt' | 'unknown'>}
   */
  async checkPermissionStatus() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: "microphone" });
        return result.state;
      }
    } catch {
      // Permissions query for microphone might not be supported in some extension contexts
    }
    return "unknown";
  }

  /**
   * Register a callback to receive live volume levels (0.0 to 1.0) while recording.
   * @param {(volume: number) => void} callback
   */
  onVolume(callback) {
    this.volumeCallback = callback;
  }

  /**
   * Returns current recording state.
   * @returns {boolean}
   */
  isRecording() {
    return this.recordingState === "recording";
  }

  /**
   * Request microphone stream and start recording audio.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.recordingState === "recording") {
      console.warn("[AudioCapture] start() called while already recording.");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new AudioCaptureError(
        "Microphone audio capture is not supported in this browser context.",
        "UNSUPPORTED"
      );
    }

    try {
      // 1. Request microphone access with optimal constraints for speech recognition
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        throw new AudioCaptureError(
          "Microphone access was denied. Please allow microphone permissions in extension settings.",
          "PERMISSION_DENIED",
          err
        );
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        throw new AudioCaptureError(
          "No microphone device was detected on your system.",
          "DEVICE_NOT_FOUND",
          err
        );
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        throw new AudioCaptureError(
          "Microphone is currently in use by another application.",
          "DEVICE_BUSY",
          err
        );
      } else {
        throw new AudioCaptureError(
          `Failed to access microphone: ${err.message}`,
          "RECORDING_FAILED",
          err
        );
      }
    }

    // 2. Setup live volume analyzer if requested
    if (this.enableVolumeMeter && this.volumeCallback) {
      this._setupVolumeMeter(this.mediaStream);
    }

    // 3. Initialize MediaRecorder with standard supported MIME type
    this.recordedChunks = [];
    const mimeType = this._getOptimalMimeType();

    try {
      this.mediaRecorder = new MediaRecorder(this.mediaStream, mimeType ? { mimeType } : {});
    } catch (recorderErr) {
      console.warn("[AudioCapture] Preferred mimeType failed, falling back to default MediaRecorder", recorderErr);
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    // Request data slice every 250ms
    this.mediaRecorder.start(250);
    this.recordingState = "recording";
  }

  /**
   * Stop recording, process, and resample the captured audio.
   * @returns {Promise<Float32Array>} 16,000 Hz single-channel Float32Array in range [-1.0, 1.0].
   */
  async stop() {
    if (this.recordingState !== "recording" || !this.mediaRecorder) {
      throw new AudioCaptureError(
        "Cannot stop recording because capture is not currently active.",
        "RECORDING_FAILED"
      );
    }

    this.recordingState = "processing";
    this._stopVolumeMeter();

    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = async () => {
        try {
          this._cleanupTracks();

          if (this.recordedChunks.length === 0) {
            throw new AudioCaptureError("No audio data was captured.", "EMPTY_AUDIO");
          }

          const rawBlob = new Blob(this.recordedChunks, {
            type: this.mediaRecorder?.mimeType || "audio/webm",
          });

          // Convert blob to 16kHz mono Float32Array
          const float32Audio = await this._processBlobToFloat32(rawBlob, this.targetSampleRate);

          if (!float32Audio || float32Audio.length === 0) {
            throw new AudioCaptureError("Audio processing produced empty samples.", "EMPTY_AUDIO");
          }

          this.recordingState = "idle";
          resolve(float32Audio);
        } catch (err) {
          this.recordingState = "idle";
          if (err instanceof AudioCaptureError) {
            reject(err);
          } else {
            reject(
              new AudioCaptureError(
                `Failed to process captured audio: ${err.message}`,
                "RECORDING_FAILED",
                err
              )
            );
          }
        }
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel and discard current recording session without processing.
   */
  cancel() {
    this._stopVolumeMeter();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this._cleanupTracks();
    this.recordedChunks = [];
    this.recordingState = "idle";
  }

  /**
   * Find supported MIME type for MediaRecorder.
   * @private
   */
  _getOptimalMimeType() {
    const candidateTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const type of candidateTypes) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  /**
   * Convert an audio Blob to a 16kHz mono Float32Array using Web Audio API.
   * @param {Blob} blob
   * @param {number} targetSampleRate
   * @returns {Promise<Float32Array>}
   * @private
   */
  async _processBlobToFloat32(blob, targetSampleRate) {
    const arrayBuffer = await blob.arrayBuffer();
    
    // Create an AudioContext to decode compressed audio
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const decodeCtx = new AudioCtx();

    let audioBuffer;
    try {
      audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      if (decodeCtx.state !== "closed") {
        await decodeCtx.close().catch(() => {});
      }
    }

    // Downmix to mono and resample to targetSampleRate (16kHz)
    return this._resampleAudioBufferToMono(audioBuffer, targetSampleRate);
  }

  /**
   * Resamples an AudioBuffer to targetSampleRate and mono Float32Array using OfflineAudioContext.
   * @param {AudioBuffer} audioBuffer
   * @param {number} targetSampleRate
   * @returns {Promise<Float32Array>}
   * @private
   */
  async _resampleAudioBufferToMono(audioBuffer, targetSampleRate) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const duration = audioBuffer.duration;
    const totalTargetSamples = Math.round(duration * targetSampleRate);

    if (totalTargetSamples <= 0) {
      return new Float32Array(0);
    }

    // Use OfflineAudioContext for browser hardware-accelerated, high-quality audio resampling
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtx(1, totalTargetSamples, targetSampleRate);

    // Create buffer source
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;

    if (numberOfChannels > 1) {
      // Merge all channels down to mono with equal weighting
      const merger = offlineCtx.createChannelMerger(numberOfChannels);
      bufferSource.connect(merger);
      merger.connect(offlineCtx.destination);
    } else {
      bufferSource.connect(offlineCtx.destination);
    }

    bufferSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const monoChannelData = renderedBuffer.getChannelData(0);

    // Create a standalone Float32Array copy to avoid keeping large buffers in memory
    const outputData = new Float32Array(monoChannelData.length);
    outputData.set(monoChannelData);

    return outputData;
  }

  /**
   * Setup live volume calculation from MediaStream.
   * @param {MediaStream} stream
   * @private
   */
  _setupVolumeMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.volumeInterval = window.setInterval(() => {
        if (!this.analyserNode || !this.volumeCallback) return;
        this.analyserNode.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedVolume = Math.min(1.0, average / 128.0);
        this.volumeCallback(normalizedVolume);
      }, 50);
    } catch (err) {
      console.warn("[AudioCapture] Volume meter initialization failed:", err);
    }
  }

  /**
   * Stop volume meter polling and close AudioContext.
   * @private
   */
  _stopVolumeMeter() {
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyserNode = null;
    if (this.volumeCallback) {
      this.volumeCallback(0);
    }
  }

  /**
   * Stop all MediaStreamTracks.
   * @private
   */
  _cleanupTracks() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}
