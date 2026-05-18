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

const API_URL        = process.env.REACT_APP_API_URL || 'https://face.recog.nui-apps.click' || 'http://localhost:5000';
const RESULT_TIMEOUT = 5_000;  // hold detection card 5s after last detection
const DEBOUNCE_MS    = 1_000;  // a new face set must persist this long before the card switches

// Default wireless camera — also defined in App.js (DEFAULT_RTSP_URL).
// Display2 polls this directly so it doesn't need MainApp to be open.
const DEFAULT_RTSP_URL = 'rtsp://admin:L2BC212E@192.168.50.239:554/cam/realmonitor?channel=1&subtype=1';
const POLL_INTERVAL_MS = 200;

// Idle background video — bundled with the frontend so every device gets
// the same default without needing IndexedDB. User uploads override this.
const DEFAULT_VIDEO_SRC = '/idle.mp4';

// Module-level avatar cache: name → base64 data-URL (or '' if no photo).
// Persists across re-mounts so the same person is never re-fetched.
const avatarCache = new Map();

// ── PersonAvatar ──────────────────────────────────────────────────────────────
function PersonAvatar({ name }) {
  // Lazy initial state: synchronously read from cache if already loaded.
  const [src, setSrc] = useState(() =>
    avatarCache.has(name) ? avatarCache.get(name) : null,
  );

  useEffect(() => {
    if (avatarCache.has(name)) {
      setSrc(avatarCache.get(name));
      return;
    }
    setSrc(null);
    fetch(`${API_URL}/person-image/${encodeURIComponent(name)}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => {
        const img = d.image || '';
        avatarCache.set(name, img);
        setSrc(img);
      })
      .catch(() => {
        avatarCache.set(name, '');
        setSrc('');
      });
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

      {/* Avatars row — CSS scales avatar size per count (see App.css) */}
      <div className={`dw-avatars-row ${
        faces.length === 1 ? 'count-1' :
        faces.length === 2 ? 'count-2' : 'count-many'
      }`}>
        {faces.map((face, i) => {
          const isKnown = face.name !== 'Unknown';
          return (
            <div key={face.name + i} className="dw-avatar-slot">
              <div className={`dw-avatar ${isKnown ? 'avatar-known' : 'avatar-unknown'}`}>
                {isKnown
                  ? <PersonAvatar key={face.name} name={face.name} />
                  : '?'}
              </div>
              {/* <div className="dw-avatar-name">{face.name}</div> */}
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

  const clearTimerRef    = useRef(null);
  const channelRef       = useRef(null);
  const currentFacesKey  = useRef('');   // sorted "name1|name2|…" of card shown now
  const pendingKeyRef    = useRef('');   // candidate set awaiting debounce
  const pendingSinceRef  = useRef(0);    // timestamp the candidate first appeared

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

  // ── Load idle video — IndexedDB upload wins, falls back to bundled default ──
  useEffect(() => {
    loadVideoSrc()
      .then(src => setIdleVideo(src || DEFAULT_VIDEO_SRC))
      .catch(() => setIdleVideo(DEFAULT_VIDEO_SRC));
  }, []);

  // ── Pre-load all known avatars into the cache ─────────────────────────
  // Warms the cache before any face is detected so the first detection
  // shows the photo instantly — no network round-trip on render.
  useEffect(() => {
    fetch(`${API_URL}/persons`)
      .then(r => r.json())
      .then(({ persons }) => {
        if (!Array.isArray(persons)) return;
        persons.forEach(p => {
          if (avatarCache.has(p.name)) return;
          fetch(`${API_URL}/person-image/${encodeURIComponent(p.name)}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => avatarCache.set(p.name, d?.image || ''))
            .catch(() => avatarCache.set(p.name, ''));
        });
      })
      .catch(() => { /* ignore — on-demand fetch still works */ });
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

  // ── Shared result-handling helper ─────────────────────────────────────
  // Used by both the BroadcastChannel listener (manual pop-out) and the
  // direct polling loop below (self-sufficient display2 mode).
  //
  // Behaviour:
  //   • Same set still in view        → keep card as is, just reset fade timer.
  //   • Card empty → first detection  → show immediately (no debounce).
  //   • Different set                 → only switch once it has persisted for
  //                                     DEBOUNCE_MS, so 1-2 frame detection
  //                                     blips don't make the card flicker.
  //   • No detection for RESULT_TIMEOUT → card fades out.
  const applyResults = useCallback((payload) => {
    if (!Array.isArray(payload) || !payload.length) return;

    const key = payload.map(f => f.name).sort().join('|');
    clearTimeout(clearTimerRef.current);

    const commit = () => {
      currentFacesKey.current = key;
      pendingKeyRef.current   = '';
      setShow(false);
      setTimeout(() => { setFaces(payload); setShow(true); }, 50);
    };

    if (key === currentFacesKey.current) {
      // Same people still in view — drop any pending change, keep card as is.
      pendingKeyRef.current = '';
    } else if (currentFacesKey.current === '') {
      // Nothing on screen yet — show the first detection instantly.
      commit();
    } else if (key === pendingKeyRef.current) {
      // A different set we've been tracking — switch only once it has been
      // seen continuously for DEBOUNCE_MS (ignores momentary blips).
      if (Date.now() - pendingSinceRef.current >= DEBOUNCE_MS) {
        commit();
      }
    } else {
      // First sighting of a new candidate set — start its debounce clock.
      pendingKeyRef.current   = key;
      pendingSinceRef.current = Date.now();
    }

    clearTimerRef.current = setTimeout(() => {
      setShow(false);
      setTimeout(() => {
        setFaces([]);
        currentFacesKey.current = '';
        pendingKeyRef.current   = '';
      }, 400);
    }, RESULT_TIMEOUT);
  }, []);

  // ── BroadcastChannel ─────────────────────────────────────────────────
  useEffect(() => {
    channelRef.current = new BroadcastChannel(channelName);

    channelRef.current.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'results')   applyResults(payload);
      if (type === 'set-video') setIdleVideo(event.data.src || DEFAULT_VIDEO_SRC);
      // 'clear' messages are intentionally ignored — the 15s auto-timer
      // inside applyResults handles card disappearance.
    };

    return () => { channelRef.current?.close(); clearTimeout(clearTimerRef.current); };
  }, [channelName, applyResults]);

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
          // else: no face this tick — the 15s timer set by the last
          // detection will fade the card naturally.
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
  }, [showBack, applyResults]);

  const hasResult = faces.length > 0;

  return (
    <div className="dw-root">
      <div className="dw-grid" />

      {/* Invisible hotspot — top-left corner. Click to return to the control
          panel. Only in display2 (showBack); replaces the visible header
          back-button so it never covers the video. */}
      {showBack && (
        <div
          onClick={() => { window.location.href = `${window.location.origin}/?mode=control`; }}
          title="Back to control panel"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '120px',
            height: '120px',
            zIndex: 9999,
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
      )}

      {!hasResult && !idleVideo && (
        <div className="dw-scan-line" style={{ top: `${scanLine}%` }} />
      )}

      {/* Header */}
      {/* <div className="dw-header">
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
      </div> */}

      {/* Settings panel */}
      {/* {showSettings && (
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
      )} */}

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
      {/* <div className="dw-footer">
        <span>POWERED BY FACENET + MTCNN</span>
        <span className={`dw-live ${hasResult ? 'dw-live-active' : ''}`}>
          <span className="dw-live-dot" /> LIVE
        </span>
      </div> */}
    </div>
  );
}
