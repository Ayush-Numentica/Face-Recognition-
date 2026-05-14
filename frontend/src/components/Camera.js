/**
 * Camera.js — USB-aware camera component with hot-plug detection.
 *
 * Key fixes in this version
 * ─────────────────────────
 * • null-guards everywhere navigator.mediaDevices is accessed
 *   (some browsers set it to undefined on non-HTTPS or first load)
 * • catch (e) {} instead of catch {} for wider Babel compatibility
 * • Single setCameras call (removed duplicate)
 * • readyState >= 2 guard before sending frames
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import axios from 'axios';

const CAPTURE_INTERVAL = 200;   // capture every 200ms
const COLOR_KNOWN      = '#00e676';
const COLOR_UNKNOWN    = '#ff1744';

export default function Camera({ isRunning, onResult, apiUrl }) {
  const videoRef   = useRef(null);
  const captureRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef  = useRef(null);
  const timerRef    = useRef(null);
  const abortRef    = useRef(null);   // AbortController for in-flight request
  const pendingRef  = useRef(false);  // true while a request is in-flight

  const [cameras,        setCameras]        = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [error,          setError]          = useState(null);
  const [flipped,        setFlipped]        = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────
  const mediaDevices = () => navigator.mediaDevices ?? null;

  // ── Enumerate available cameras ───────────────────────────────────────
  const fetchCameras = useCallback(async () => {
    const md = mediaDevices();
    if (!md) return;   // browser doesn't expose mediaDevices (rare edge case)

    // Brief getUserMedia unlocks device labels in Chrome
    try {
      const tmp = await md.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach(t => t.stop());
    } catch (e) {
      // Permission denied or no camera — labels may be empty but list still works
    }

    try {
      const all  = await md.enumerateDevices();
      const cams = all.filter(d => d.kind === 'videoinput');
      setCameras(cams);
      setSelectedCamera(prev =>
        cams.some(c => c.deviceId === prev)
          ? prev
          : (cams[0]?.deviceId ?? ''),
      );
    } catch (e) {
      console.warn('[Camera] enumerateDevices failed:', e.message);
    }
  }, []);

  // Enumerate on mount
  useEffect(() => { fetchCameras(); }, [fetchCameras]);

  // Hot-plug: update list automatically when a USB camera is connected/disconnected
  useEffect(() => {
    const md = mediaDevices();
    if (!md) return;
    const handler = () => fetchCameras();
    md.addEventListener('devicechange', handler);
    return () => md.removeEventListener('devicechange', handler);
  }, [fetchCameras]);

  // ── Start stream ──────────────────────────────────────────────────────
  const startCamera = useCallback(async (deviceId) => {
    const md = mediaDevices();
    if (!md) { setError('Camera API not available in this browser.'); return; }

    streamRef.current?.getTracks().forEach(t => t.stop());

    const tryStart = async (constraints) => {
      const stream = await md.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setError(null);
    };

    try {
      await tryStart({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') {
        // USB cameras sometimes reject resolution hints — retry without them
        try {
          await tryStart({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true });
        } catch (e2) {
          setError(`Camera failed: ${e2.message}`);
        }
      } else {
        setError(`Camera access denied: ${e.message}`);
      }
    }
  }, []);

  // ── Stop stream ───────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // ── Capture a JPEG frame (downscaled for speed) ───────────────────────
  const captureFrame = useCallback(() => {
    const video  = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas) return null;
    if (video.readyState < 2) return null;   // stream not ready yet

    // Downscale to max 480px wide — fast enough for gate detection at distance
    const srcW = video.videoWidth  || 640;
    const srcH = video.videoHeight || 480;
    const scale = Math.min(1, 480 / srcW);
    canvas.width  = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  // ── Clear overlay canvas ──────────────────────────────────────────────
  const clearOverlay = useCallback(() => {
    const oc = overlayRef.current;
    if (!oc) return;
    oc.getContext('2d').clearRect(0, 0, oc.width, oc.height);
  }, []);

  // ── Draw bounding boxes for ALL detected faces ───────────────────────
  const drawBoxes = useCallback((results) => {
    const video         = videoRef.current;
    const canvas        = overlayRef.current;
    const captureCanvas = captureRef.current;
    if (!video || !canvas) return;

    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw; canvas.height = vh;
    }

    const scaleX = captureCanvas?.width ? vw / captureCanvas.width : 1;
    const scaleY = captureCanvas?.height ? vh / captureCanvas.height : 1;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, vw, vh);
    if (!results?.length) return;

    results.forEach((result) => {
      if (!result?.box) return;
      const [rawBx, rawBy, rawBw, rawBh] = result.box;
      const bx = rawBx * scaleX;
      const by = rawBy * scaleY;
      const bw = rawBw * scaleX;
      const bh = rawBh * scaleY;
      const isKnown = result.detected && result.name !== 'Unknown';
      const color   = isKnown ? COLOR_KNOWN : COLOR_UNKNOWN;

      // Main rect
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Corner brackets
      const C = 18; ctx.lineWidth = 3;
      const corners = [
        [bx,      by,      bx+C,    by,      bx,      by+C    ],
        [bx+bw,   by,      bx+bw-C, by,      bx+bw,   by+C    ],
        [bx,      by+bh,   bx+C,    by+bh,   bx,      by+bh-C ],
        [bx+bw,   by+bh,   bx+bw-C, by+bh,   bx+bw,   by+bh-C ],
      ];
      corners.forEach(([x0,y0,x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x0,y0); ctx.lineTo(x2,y2); ctx.stroke();
      });

      // Label
      const label    = `${result.name}  ${Math.round((result.confidence ?? 0) * 100)}%`;
      const fontSize = Math.max(14, Math.round(bh * 0.07));
      ctx.font = `bold ${fontSize}px 'Segoe UI', Arial`;
      const pad = 6; const tw = ctx.measureText(label).width;
      const lh  = fontSize + pad * 2; const ly = Math.max(0, by - lh - 2);
      ctx.fillStyle   = isKnown ? 'rgba(0,230,118,.25)' : 'rgba(255,23,68,.25)';
      ctx.fillRect(bx, ly, tw + pad * 2, lh);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.strokeRect(bx, ly, tw + pad * 2, lh);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, bx + pad, ly + fontSize + pad - 2);
    });
  }, []);

  // ── Send frame to backend ─────────────────────────────────────────────
  // pendingRef prevents stacking requests — if backend is still processing,
  // cancel the old request and immediately send the newest frame instead.
  const sendFrame = useCallback(async () => {
    const imageData = captureFrame();
    if (!imageData) return;

    // Cancel previous in-flight request so newest frame always wins
    if (pendingRef.current && abortRef.current) {
      abortRef.current.abort();
    }

    abortRef.current  = new AbortController();
    pendingRef.current = true;
    setIsProcessing(true);

    try {
      const { data } = await axios.post(
        `${apiUrl}/recognize`,
        { image: imageData },
        { timeout: 8000, signal: abortRef.current.signal },
      );
      const faces = Array.isArray(data) ? data : [];
      drawBoxes(faces);
      // Immediately clear overlay and result when no face in frame
      if (faces.length === 0) clearOverlay();
      onResult(faces.length ? faces : null);
    } catch (e) {
      if (axios.isCancel(e) || e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[Camera] Recognition request failed:', e.message);
      clearOverlay();
      onResult(null);
    } finally {
      pendingRef.current = false;
      setIsProcessing(false);
    }
  }, [captureFrame, apiUrl, drawBoxes, clearOverlay, onResult]);

  // ── Recognition loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      startCamera(selectedCamera);
      timerRef.current = setInterval(sendFrame, CAPTURE_INTERVAL);
    } else {
      clearInterval(timerRef.current);
      stopCamera();
      clearOverlay();
      onResult(null);
    }
    return () => clearInterval(timerRef.current);
  }, [isRunning, selectedCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep sendFrame fresh inside the interval
  useEffect(() => {
    if (!isRunning) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(sendFrame, CAPTURE_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [sendFrame, isRunning]);

  // ── Camera switch ─────────────────────────────────────────────────────
  const handleCameraChange = (e) => {
    setSelectedCamera(e.target.value);
    if (isRunning) startCamera(e.target.value);
  };

  const isUsbCamera = (label = '') =>
    /usb|external|logitech|webcam|c\d{3}|c\d{4}|hd pro|brio|streamcam/i.test(label);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="camera-container">

      {/* Camera selector */}
      <div className="camera-selector">
        <label htmlFor="cam-select">Camera</label>
        <div className="cam-select-row">
          <select
            id="cam-select"
            value={selectedCamera}
            onChange={handleCameraChange}
          >
            {cameras.length === 0 && <option value="">No cameras found — click ⟳</option>}
            {cameras.map((cam, i) => {
              const label = cam.label || `Camera ${i + 1}`;
              return (
                <option key={cam.deviceId || i} value={cam.deviceId}>
                  {isUsbCamera(label) ? '🔌 ' : '📷 '}{label}
                </option>
              );
            })}
          </select>
          <button className="btn-icon-sm" onClick={fetchCameras} title="Refresh camera list">⟳</button>
          <button
            className={`btn-icon-sm btn-flip ${flipped ? 'flipped' : ''}`}
            onClick={() => setFlipped(p => !p)}
            title="Flip camera horizontally"
          >⇄</button>
        </div>
        {cameras.length > 0 && (
          <span className="cam-count">
            {cameras.length} camera{cameras.length !== 1 ? 's' : ''} detected
            {cameras.some(c => isUsbCamera(c.label)) && ' · 🔌 USB'}
          </span>
        )}
      </div>

      {/* Video + overlay */}
      <div className="video-wrapper">
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className="video-feed"
          style={flipped ? { transform: 'scaleX(-1)' } : undefined}
        />
        <canvas
          ref={overlayRef}
          className="overlay-canvas"
          style={flipped ? { transform: 'scaleX(-1)' } : undefined}
        />

        {!isRunning && (
          <div className="camera-placeholder">
            <div className="placeholder-icon">📷</div>
            <p>Press <strong>Start Recognition</strong> to begin</p>
            {cameras.length === 0 && (
              <p style={{ color: '#ff6b6b', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                No camera detected — plug in a USB camera and click ⟳
              </p>
            )}
          </div>
        )}

        {isRunning && isProcessing && (
          <div className="processing-indicator">
            <span className="spinner" /> Analysing…
          </div>
        )}
      </div>

      {/* Hidden capture canvas */}
      <canvas ref={captureRef} style={{ display: 'none' }} />

      {error && (
        <div className="error-banner">
          ⚠️ {error}
          <button
            onClick={() => startCamera(selectedCamera)}
            style={{ marginLeft: '1rem', background: 'transparent', border: '1px solid', color: 'inherit', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
