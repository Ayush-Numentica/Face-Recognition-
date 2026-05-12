/**
 * AddPerson.js
 * ─────────────
 * Modal dialog for registering a new person.
 *
 * Two ways to supply photos:
 *   1. File picker  — upload existing images from disk
 *   2. Live camera  — capture snapshots directly in the browser
 *
 * On submit, files are POSTed to /add-person as multipart/form-data.
 * The backend runs MTCNN + FaceNet on every image and builds embeddings.
 *
 * Tips:
 *   • Add 3-5 diverse photos (different angles, lighting) for best accuracy.
 */

import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

export default function AddPerson({ apiUrl, onClose, onSuccess }) {
  const [name,           setName]           = useState('');
  const [files,          setFiles]          = useState([]);       // File objects
  const [previews,       setPreviews]       = useState([]);       // { url, file }
  const [cameraActive,   setCameraActive]   = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [error,          setError]          = useState('');
  const [successMsg,     setSuccessMsg]     = useState('');
  const [customMessage,  setCustomMessage]  = useState('');

  const fileInputRef = useRef(null);
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const streamRef    = useRef(null);

  // Pre-fill custom message as user types the name
  useEffect(() => {
    if (name.trim()) setCustomMessage(`Welcome ${name.trim()}!`);
  }, [name]);

  // ── Camera helpers ────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
      setError('');
    } catch (err) {
      setError(`Camera access failed: ${err.message}`);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const captureSnapshot = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `snapshot_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const url  = URL.createObjectURL(blob);
      setFiles(prev  => [...prev, file]);
      setPreviews(prev => [...prev, { url, file }]);
    }, 'image/jpeg', 0.85);
  };

  // ── File picker ───────────────────────────────────────────────────────
  const handleFilePick = (e) => {
    const picked = Array.from(e.target.files);
    const newPreviews = picked.map(f => ({ url: URL.createObjectURL(f), file: f }));
    setFiles(prev    => [...prev, ...picked]);
    setPreviews(prev => [...prev, ...newPreviews]);
    // Reset input so the same file can be re-selected if removed
    e.target.value = '';
  };

  const removePreview = (idx) => {
    URL.revokeObjectURL(previews[idx].url);
    setFiles(prev    => prev.filter((_, i) => i !== idx));
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim())    { setError('Please enter a name.'); return; }
    if (files.length === 0) { setError('Please add at least one photo.'); return; }

    setUploading(true);
    setError('');
    setSuccessMsg('');

    const formData = new FormData();
    formData.append('name', name.trim());
    files.forEach(f => formData.append('images', f));

    try {
      const { data } = await axios.post(`${apiUrl}/add-person`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,   // face detection + embedding can take a moment
      });

      // Optionally update the custom message right away
      if (customMessage.trim()) {
        try {
          const { data: msgs } = await axios.get(`${apiUrl}/custom-messages`);
          msgs[name.trim()] = customMessage.trim();
          await axios.post(`${apiUrl}/custom-messages`, msgs);
        } catch { /* non-fatal */ }
      }

      setSuccessMsg(data.message ?? `${name} added successfully!`);
      stopCamera();
      setTimeout(() => onSuccess(), 1800);

    } catch (err) {
      setError(err.response?.data?.error ?? `Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Cleanup object URLs and camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      previews.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) { stopCamera(); onClose(); }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <h2>➕ Add New Person</h2>
          <button className="modal-close" onClick={() => { stopCamera(); onClose(); }}>×</button>
        </div>

        {/* Body */}
        <div className="modal-body">

          {/* Name */}
          <div className="form-group">
            <label htmlFor="person-name">Person's Name *</label>
            <input
              id="person-name"
              className="form-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Ayush"
              disabled={uploading}
            />
          </div>

          {/* Custom greeting message */}
          <div className="form-group">
            <label htmlFor="person-msg">Custom Greeting Message</label>
            <input
              id="person-msg"
              className="form-input"
              type="text"
              value={customMessage}
              onChange={e => setCustomMessage(e.target.value)}
              placeholder={`e.g. Welcome ${name || 'Person'}!`}
              disabled={uploading}
            />
          </div>

          {/* Photo source buttons */}
          <div className="image-sources">
            <button
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              📁 Upload Photos
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFilePick}
            />

            {!cameraActive ? (
              <button
                className="btn-secondary"
                onClick={startCamera}
                disabled={uploading}
              >
                📷 Use Camera
              </button>
            ) : (
              <div className="camera-capture">
                <button className="btn-secondary" onClick={captureSnapshot}>
                  📸 Capture ({previews.length} taken)
                </button>
                <button className="btn-danger-sm" onClick={stopCamera}>
                  ✕ Stop Camera
                </button>
              </div>
            )}
          </div>

          {/* Live camera preview */}
          {cameraActive && (
            <div className="capture-preview">
              <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
            </div>
          )}
          {/* Hidden snapshot canvas */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Photo thumbnails */}
          {previews.length > 0 && (
            <div className="preview-grid">
              {previews.map((p, i) => (
                <div key={i} className="preview-item">
                  <img src={p.url} alt={`preview ${i + 1}`} />
                  <button className="remove-btn" onClick={() => removePreview(i)}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Tips */}
          <div className="tips">
            <strong>Tips for best accuracy:</strong>
            <ul>
              <li>Add 3–5 different photos per person</li>
              <li>Vary lighting (bright, dim, natural)</li>
              <li>Include slight angle variations</li>
              <li>Ensure the face is clearly visible and unobstructed</li>
            </ul>
          </div>

          {error      && <div className="error-msg">⚠️ {error}</div>}
          {successMsg && <div className="success-msg">✅ {successMsg}</div>}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={() => { stopCamera(); onClose(); }}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={uploading || !name.trim() || files.length === 0}
          >
            {uploading ? (
              <><span className="spinner-sm" />Processing…</>
            ) : (
              `Register ${name || 'Person'} (${files.length} photo${files.length !== 1 ? 's' : ''})`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
