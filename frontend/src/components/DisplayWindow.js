/**
 * DisplayWindow.js
 * ────────────────
 * Full-screen recognition display designed for a SECOND MONITOR.
 *
 * Layout rules
 * ────────────
 *   1 person  → single card centred
 *   2 persons → side by side
 *   3 persons → centre card in middle, left card overlaps upper-left,
 *               right card overlaps upper-right
 *   4+ persons → 2-column grid, rows as needed
 *
 * Message protocol (from App.js)
 * ──────────────────────────────
 *   { type: 'results', payload: [ {name, message, confidence, detected}, … ] }
 *   { type: 'clear' }
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadVideoSrc } from '../videoStore';

const API_URL        = process.env.REACT_APP_API_URL || 'https://13.203.80.165:8080';
const RESULT_TIMEOUT = 3_000;  // clear result 3s after last detection

// Default wireless camera — also defined in App.js (DEFAULT_RTSP_URL).
// Display2 polls this directly so it doesn't need MainApp to be open.
const DEFAULT_RTSP_URL = 'rtsp://admin:L2BC212E@192.168.50.239:554/cam/realmonitor?channel=1&subtype=0';
const POLL_INTERVAL_MS = 200;
  
// ── PersonAvatar ──────────────────────────────────────────────────────────────
function PersonAvatar({ name }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    setSrc(null);
    fetch(`${API_URL}/person-image/${encodeURIComponent(name)}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setSrc(d.image || ''))
      .catch(() => setSrc(''));
  }, [name]);

  if (src === null) return null;
  if (src === '')   return <>{name.charAt(0).toUpperCase()}</>;
  return (
    <img
      src={src}
      alt={name}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
    />
  );
}

// ── Unified face layout — avatars side by side, single merged message ─────────
function FaceLayout({ faces, show }) {
  const animClass = show ? 'dw-result-enter' : 'dw-result-exit';
  const allKnown  = faces.every(f => f.name !== 'Unknown');

  // Build merged message: "Welcome Alice, Bob & Charlie!"
  const knownNames = faces.filter(f => f.name !== 'Unknown').map(f => f.name);
  let mergedMessage = '';
  if (knownNames.length === 0) {
    mergedMessage = 'Unknown person detected';
  } else if (knownNames.length === 1) {
    mergedMessage = faces[0].message;
  } else {
    const last = knownNames[knownNames.length - 1];
    const rest = knownNames.slice(0, -1).join(', ');
    mergedMessage = `Welcome ${rest} & ${last}!`;
  }

  return (
    <div className={`dw-unified-card ${allKnown ? 'dw-known' : 'dw-unknown'} ${animClass}`}>

      {/* Glow behind the whole card */}
      <div className={`dw-glow-orb ${allKnown ? 'glow-green' : 'glow-red'}`} />

      {/* Avatars row */}
      <div className="dw-avatars-row">
        {faces.map((face, i) => {
          const isKnown = face.name !== 'Unknown';
          return (
            <div key={face.name + i} className="dw-avatar-slot">
              <div className={`dw-avatar ${isKnown ? 'avatar-known' : 'avatar-unknown'}`}>
                {isKnown
                  ? <PersonAvatar key={face.name} name={face.name} />
                  : '?'}
              </div>
              <div className="dw-avatar-name">{face.name}</div>
            </div>
          );
        })}
      </div>

      {/* Single merged message */}
      <div className={`dw-message ${allKnown ? 'msg-known' : 'msg-unknown'}`}>
        {mergedMessage}
      </div>

      {/* Corner brackets */}
      <div className="dw-bracket dw-bracket-tl" />
      <div className="dw-bracket dw-bracket-tr" />
      <div className="dw-bracket dw-bracket-bl" />
      <div className="dw-bracket dw-bracket-br" />
    </div>
  );
}

// ── Main DisplayWindow ────────────────────────────────────────────────────────
export default function DisplayWindow({ channelName, showBack = false }) {
  const [faces,       setFaces]       = useState([]);
  const [time,        setTime]        = useState('');
  const [date,        setDate]        = useState('');
  const [scanLine,    setScanLine]    = useState(0);
  const [show,        setShow]        = useState(false);
  const [idleVideo,   setIdleVideo]   = useState('');
  const [showSettings,setShowSettings]= useState(false);
  const [inputW,      setInputW]      = useState('');
  const [inputH,      setInputH]      = useState('');

  const clearTimerRef = useRef(null);
  const channelRef    = useRef(null);

  // Populate inputs with current window size when panel opens
  const openSettings = () => {
    setInputW(String(window.outerWidth));
    setInputH(String(window.outerHeight));
    setShowSettings(true);
  };

  const applySize = () => {
    const w = parseInt(inputW, 10);
    const h = parseInt(inputH, 10);
    if (w > 0 && h > 0) window.resizeTo(w, h);
    setShowSettings(false);
  };

  // ── Load idle video from IndexedDB on mount ───────────────────────────
  useEffect(() => {
    loadVideoSrc().then(src => { if (src) setIdleVideo(src); }).catch(() => {});
  }, []);

  // ── Clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Scanner animation ─────────────────────────────────────────────────
  useEffect(() => {
    let pos = 0;
    const id = setInterval(() => { pos = (pos + 1) % 100; setScanLine(pos); }, 20);
    return () => clearInterval(id);
  }, []);

  // ── Shared result-handling helpers ────────────────────────────────────
  // Used by both the BroadcastChannel listener (manual pop-out) and the
  // direct polling loop below (self-sufficient display2 mode).
  const applyResults = useCallback((payload) => {
    if (!Array.isArray(payload) || !payload.length) return;
    clearTimeout(clearTimerRef.current);
    setShow(false);
    setTimeout(() => { setFaces(payload); setShow(true); }, 50);
    clearTimerRef.current = setTimeout(() => {
      setShow(false);
      setTimeout(() => setFaces([]), 400);
    }, RESULT_TIMEOUT);
  }, []);

  const applyClear = useCallback(() => {
    clearTimeout(clearTimerRef.current);
    setShow(false);
    setTimeout(() => setFaces([]), 400);
  }, []);

  // ── BroadcastChannel ─────────────────────────────────────────────────
  useEffect(() => {
    channelRef.current = new BroadcastChannel(channelName);

    channelRef.current.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'results')   applyResults(payload);
      if (type === 'clear')     applyClear();
      if (type === 'set-video') setIdleVideo(event.data.src || '');
    };

    return () => { channelRef.current?.close(); clearTimeout(clearTimerRef.current); };
  }, [channelName, applyResults, applyClear]);

  // ── Self-sufficient polling (display2 mode only) ──────────────────────
  // Starts the wireless camera on the backend, then polls /ip-camera/result
  // every 200 ms — same cadence MainApp uses. Cleanly stops the stream on
  // unmount so leaving the page doesn't leave the backend churning.
  useEffect(() => {
    if (!showBack) return;
    let pollId  = null;
    let active  = true;

    const poll = () => {
      fetch(`${API_URL}/ip-camera/result`)
        .then(r => r.json())
        .then(data => {
          if (!active) return;
          const known = Array.isArray(data) ? data.filter(f => f.name !== 'Unknown') : [];
          if (known.length) applyResults(known);
          else              applyClear();
        })
        .catch(() => { /* transient network errors ignored */ });
    };

    fetch(`${API_URL}/ip-camera/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: DEFAULT_RTSP_URL }),
    })
    .then(() => {
      if (!active) return;
      pollId = setInterval(poll, POLL_INTERVAL_MS);
    })
    .catch(err => console.error('display2: could not start IP camera —', err?.message));

    return () => {
      active = false;
      if (pollId) clearInterval(pollId);
      fetch(`${API_URL}/ip-camera/stop`, { method: 'POST' }).catch(() => {});
    };
  }, [showBack, applyResults, applyClear]);

  const hasResult = faces.length > 0;

  return (
    <div className="dw-root">
      <div className="dw-grid" />

      {!hasResult && !idleVideo && (
        <div className="dw-scan-line" style={{ top: `${scanLine}%` }} />
      )}

      {/* Header */}
      <div className="dw-header">
        <div className="dw-header-left">
          {showBack && (
            <button
              className="dw-settings-btn"
              onClick={() => { window.location.href = `${window.location.origin}/?mode=control`; }}
              title="Back to main control panel"
              style={{ marginRight: '0.75rem' }}
            >← Back</button>
          )}
          <span className="dw-brand-icon">🎭</span>
          <span className="dw-brand-name">NumenScan</span>
        </div>
        <div className="dw-clock">
          <div className="dw-time">{time}</div>
          <div className="dw-date">{date}</div>
        </div>
        <button className="dw-settings-btn" onClick={openSettings} title="Resize window">⚙</button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="dw-settings-panel">
          <div className="dw-settings-title">Resize Window</div>
          <div className="dw-settings-row">
            <label>Width (px)</label>
            <input
              type="number"
              value={inputW}
              onChange={e => setInputW(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySize()}
              min={200} max={7680}
            />
          </div>
          <div className="dw-settings-row">
            <label>Height (px)</label>
            <input
              type="number"
              value={inputH}
              onChange={e => setInputH(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySize()}
              min={200} max={4320}
            />
          </div>
          <div className="dw-settings-actions">
            <button className="dw-btn-apply" onClick={applySize}>Apply</button>
            <button className="dw-btn-cancel" onClick={() => setShowSettings(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Background video — always plays when set, behind everything */}
      {idleVideo && (
        <video
          key={idleVideo}
          className="dw-idle-video"
          src={idleVideo}
          autoPlay
          loop
          muted
          playsInline
        />
      )}

      {/* Body */}
      <div className="dw-body">
        {!hasResult && !idleVideo && (
          <div className="dw-idle">
            <div className="dw-idle-ring">
              <div className="dw-idle-inner">
                <span className="dw-idle-icon">👁</span>
              </div>
            </div>
            <p className="dw-idle-text">SCANNING</p>
            <p className="dw-idle-sub">Waiting for face detection…</p>
            <div className="dw-idle-dots"><span /><span /><span /></div>
          </div>
        )}

        {hasResult && <FaceLayout faces={faces} show={show} />}
      </div>

      {/* Footer */}
      <div className="dw-footer">
        <span>POWERED BY FACENET + MTCNN</span>
        <span className={`dw-live ${hasResult ? 'dw-live-active' : ''}`}>
          <span className="dw-live-dot" /> LIVE
        </span>
      </div>
    </div>
  );
}
