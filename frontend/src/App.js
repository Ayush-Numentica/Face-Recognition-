/**
 * App.js
 * ──────
 * Root component.  Serves two modes via the URL query string:
 *
 *   http://localhost:3000/           → Main control panel
 *   http://localhost:3000/?mode=display → Full-screen second-monitor display
 *
 * The two windows communicate through the BroadcastChannel API (same-origin,
 * no server required).  Channel name: "face-recognition-display".
 *
 * Second screen flow
 * ──────────────────
 * 1. User clicks "Pop Out Display" in the main window.
 * 2. A new browser window opens at /?mode=display.
 * 3. User drags that window to their second monitor and maximises it (F11).
 * 4. Recognition results are broadcast via BroadcastChannel in real-time.
 *
 * On browsers that support the Window Management API (Chrome 100+) the popup
 * is placed on the second screen automatically.
 */

import React, {
  useState, useEffect, useCallback, useRef,
} from 'react';
import axios from 'axios';

import Camera        from './components/Camera';
import MessageBanner from './components/MessageBanner';
import AddPerson     from './components/AddPerson';
import FaceLog       from './components/FaceLog';
import DisplayWindow from './components/DisplayWindow';
import { saveVideoBlob, saveVideoUrl, loadVideoSrc, clearVideo } from './videoStore';

// ── Config ────────────────────────────────────────────────────────────────────
const API_URL        = process.env.REACT_APP_API_URL || 'http://13.203.80.165:8080';
const SPEAK_COOLDOWN = 10_000;           // ms between voice announcements
const BROADCAST_CH   = 'face-recognition-display';

const DEFAULT_RTSP_URL = 'rtsp://admin:L2BC212E@192.168.50.239:554/cam/realmonitor?channel=1&subtype=0'; // leave '' to disable auto-connect
// const AUTO_OPEN_DISPLAY = true;

// ── Mode detection ────────────────────────────────────────────────────────────
const QUERY_MODE = new URLSearchParams(window.location.search).get('mode');
const IS_DISPLAY  = QUERY_MODE === 'display';
const IS_DISPLAY2 = QUERY_MODE === 'display2';

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Both display modes render the same component — they receive results
  // from the main window via BroadcastChannel, so any number of subscribers works.
  if (IS_DISPLAY)  return <DisplayWindow channelName={BROADCAST_CH} />;
  if (IS_DISPLAY2) return <DisplayWindow channelName={BROADCAST_CH} showBack />;

  return <MainApp />;
}

// ── Main application (control panel) ─────────────────────────────────────────
function MainApp() {
  const [activeTab,      setActiveTab]      = useState('camera');
  const [isRunning,      setIsRunning]      = useState(false);
  const [currentResult,  setCurrentResult]  = useState(null);
  const [knownPersons,   setKnownPersons]   = useState([]);
  const [customMessages, setCustomMessages] = useState({});
  const [apiStatus,      setApiStatus]      = useState('checking');
  const [showAddPerson,  setShowAddPerson]  = useState(false);
  const [displayOpen,    setDisplayOpen]    = useState(false);
  const [soundEnabled,   setSoundEnabled]   = useState(false);
  const [popOutMsg,      setPopOutMsg]      = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [sizePreset,     setSizePreset]     = useState('fullscreen');
  const [customW,        setCustomW]        = useState(1280);
  const [customH,        setCustomH]        = useState(720);
  const [showVideoPicker,setShowVideoPicker]= useState(false);
  const [idleVideoSrc,   setIdleVideoSrc]   = useState('');
  const [videoUrlInput,  setVideoUrlInput]  = useState('');
  const [videoLoading,   setVideoLoading]   = useState(false);
  const [camMode,        setCamMode]        = useState('wireless');   // 'local' | 'wireless'
  const [wirelessUrl,    setWirelessUrl]    = useState(DEFAULT_RTSP_URL);
  const [wirelessActive, setWirelessActive] = useState(false);
  const [wirelessError,  setWirelessError]  = useState('');
  const wirelessPollRef = useRef(null);

  const lastSpokenRef  = useRef({ name: null, time: 0 });
  const channelRef     = useRef(null);
  const videoFileRef   = useRef(null);
  const displayWinRef  = useRef(null);  // reference to the pop-out window

  // ── BroadcastChannel setup ───────────────────────────────────────────
  useEffect(() => {
    channelRef.current = new BroadcastChannel(BROADCAST_CH);
    return () => channelRef.current?.close();
  }, []);

  // ── On mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    checkApi();
    fetchPersons();
    fetchMessages();
    loadVideoSrc().then(src => { if (src) setIdleVideoSrc(src); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── API helpers ──────────────────────────────────────────────────────
  const checkApi = async () => {
    try {
      await axios.get(`${API_URL}/health`, { timeout: 3000 });
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    }
  };

  const fetchPersons = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/persons`);
      setKnownPersons(data.persons || []);
    } catch (e) { console.error('fetchPersons:', e.message); }
  };

  // ── Auto-connect to wireless camera on mount ─────────────────────────
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (!DEFAULT_RTSP_URL || autoConnectedRef.current) return;
    if (camMode !== 'wireless') return;
    autoConnectedRef.current = true;
    // small delay so /health check runs first and backend is ready
    const t = setTimeout(() => { startWireless(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-route to display2 on render ──────────────────────────────────
  // Same-tab navigation — no popup, no new window. Skips when any `mode`
  // param is already present so the "Back" button on display2 can land
  // on /?mode=control without being redirected again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('mode')) return;
    window.location.replace(`${window.location.origin}/?mode=display2`);
  }, []);

  const fetchMessages = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/custom-messages`);
      setCustomMessages(data);
    } catch (e) { console.error('fetchMessages:', e.message); }
  };

  // ── Speech synthesis ─────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.rate   = 0.95;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    window.speechSynthesis.speak(utt);
  }, []);

  // ── Recognition result callback (from Camera) ─────────────────────────
  const handleResult = useCallback((faces) => {
    // faces is now an array or null
    const arr = Array.isArray(faces) ? faces : (faces ? [faces] : []);

    if (!arr.length) {
      setCurrentResult(null);
      channelRef.current?.postMessage({ type: 'clear' });
      return;
    }

    // Enrich every face with its greeting message
    const enriched = arr.map(f => ({
      ...f,
      message: customMessages[f.name] ??
        (f.name !== 'Unknown' ? `Welcome ${f.name}!` : 'Unknown person detected'),
    }));

    // Banner/pop-out shows top result (highest confidence)
    setCurrentResult(enriched[0]);

    // Broadcast all known faces to display window; if none known → clear
    const knownFaces = enriched.filter(f => f.name !== 'Unknown');
    if (knownFaces.length) {
      channelRef.current?.postMessage({ type: 'results', payload: knownFaces });
    } else {
      channelRef.current?.postMessage({ type: 'clear' });
    }

    // Voice — speak the top known person (cooldown applies)
    if (soundEnabled) {
      const top = knownFaces[0];
      if (top) {
        const { name: ln, time: lt } = lastSpokenRef.current;
        const now = Date.now();
        if (top.name !== ln || now - lt > SPEAK_COOLDOWN) {
          speak(top.message);
          lastSpokenRef.current = { name: top.name, time: now };
        }
      }
    }
  }, [customMessages, speak, soundEnabled]);

  // ── Screen size presets ───────────────────────────────────────────────
  const SIZE_PRESETS = [
    { id: 'fullscreen', label: '⛶  Fullscreen'       },
    { id: '16:9',       label: '16:9  (1920×1080)'   , w: 1920, h: 1080 },
    { id: '16:9-hd',    label: '16:9  (1280×720)'    , w: 1280, h:  720 },
    { id: '4:3',        label: '4:3   (1024×768)'    , w: 1024, h:  768 },
    { id: '2:5',        label: '2:5   (480×1200)'    , w:  480, h: 1200 },
    { id: '9:16',       label: '9:16  (1080×1920)'   , w: 1080, h: 1920 },
    { id: '1:1',        label: '1:1   (800×800)'     , w:  800, h:  800 },
    { id: 'custom',     label: '✏  Custom size'      },
  ];

  // ── Pop-out display window ────────────────────────────────────────────
  const openDisplayWindow = async () => {
    const url      = `${window.location.origin}/?mode=display`;
    const features = 'menubar=no,toolbar=no,location=no,status=no';
    const preset   = SIZE_PRESETS.find(p => p.id === sizePreset);

    // Fullscreen — try Window Management API first, then fallback
    if (sizePreset === 'fullscreen') {
      if ('getScreenDetails' in window) {
        try {
          const details      = await window.getScreenDetails();
          const secondScreen = details.screens.find(s => !s.isPrimary) ?? details.currentScreen;
          const w = window.open(url, 'FaceRecognitionDisplay', [
            `left=${secondScreen.availLeft}`,
            `top=${secondScreen.availTop}`,
            `width=${secondScreen.availWidth}`,
            `height=${secondScreen.availHeight}`,
            features,
          ].join(','));
          displayWinRef.current = w;
          setDisplayOpen(true);
          return;
        } catch (e) {
          console.warn('Window Management API denied, falling back.', e);
        }
      }
      const w = window.open(url, 'FaceRecognitionDisplay',
        `width=${window.screen.availWidth},height=${window.screen.availHeight},${features}`);
      displayWinRef.current = w;
      setDisplayOpen(true);
      return;
    }

    // Custom size
    const winW = sizePreset === 'custom' ? customW : preset.w;
    const winH = sizePreset === 'custom' ? customH : preset.h;
    const w = window.open(url, 'FaceRecognitionDisplay',
      `width=${winW},height=${winH},${features}`);
    displayWinRef.current = w;
    setDisplayOpen(true);
  };

  const closeDisplayWindow = () => {
    displayWinRef.current?.close();
    displayWinRef.current = null;
    setDisplayOpen(false);
  };

  // ── Wireless camera handlers ──────────────────────────────────────────
  const startWireless = async () => {
    if (!wirelessUrl.trim()) { setWirelessError('Enter a camera URL first.'); return; }
    setWirelessError('');
    try {
      await axios.post(`${API_URL}/ip-camera/start`, { url: wirelessUrl.trim() });
      setWirelessActive(true);
      setIsRunning(true);
      // Poll /ip-camera/result every 200 ms and feed into handleResult
      wirelessPollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get(`${API_URL}/ip-camera/result`, { timeout: 2000 });
          handleResult(Array.isArray(data) && data.length ? data : null);
        } catch { /* ignore poll errors */ }
      }, 200);
    } catch (e) {
      setWirelessError(e.response?.data?.error ?? e.message);
    }
  };

  const stopWireless = async () => {
    clearInterval(wirelessPollRef.current);
    setWirelessActive(false);
    setIsRunning(false);
    setCurrentResult(null);
    channelRef.current?.postMessage({ type: 'clear' });
    try { await axios.post(`${API_URL}/ip-camera/stop`); } catch { /* ignore */ }
  };

  // Stop wireless stream if user switches back to local mode
  const handleCamModeSwitch = (mode) => {
    if (mode === 'local' && wirelessActive) stopWireless();
    setCamMode(mode);
  };

  // ── Misc handlers ─────────────────────────────────────────────────────
  const handlePersonAdded = () => { fetchPersons(); fetchMessages(); setShowAddPerson(false); };
  const handleToggle = () => {
    setIsRunning(prev => !prev);
    if (isRunning) { setCurrentResult(null); channelRef.current?.postMessage({ type: 'clear' }); }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">🎭</span>
          <span className="brand-name">NumenScan</span>
        </div>

        <nav className="tab-nav">
          {[
            { id: 'camera',   label: '📷 Camera' },
            { id: 'persons',  label: `👥 Persons (${knownPersons.length})` },
            { id: 'log',      label: '📋 Log' },
            { id: 'messages', label: '💬 Messages' },
          ].map(t => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="header-right">
          {/* Second-screen pop-out + size picker */}
          <div className="display-btn-group">
            <button
              className={`btn-display-toggle ${displayOpen ? 'display-active' : ''}`}
              onClick={displayOpen ? closeDisplayWindow : openDisplayWindow}
              title={displayOpen ? 'Close display window' : 'Open display on second monitor'}
            >
              {displayOpen ? '✕ Close Display' : '🖥 Pop Out Display'}
            </button>
            {!displayOpen && (
              <button
                className={`btn-size-pick ${showSizePicker ? 'active' : ''}`}
                onClick={() => { setShowSizePicker(p => !p); setShowVideoPicker(false); }}
                title="Choose screen size"
              >⚙</button>
            )}
            {/* Video picker button */}
            <button
              className={`btn-size-pick ${showVideoPicker ? 'active' : ''} ${idleVideoSrc ? 'video-set' : ''}`}
              onClick={() => { setShowVideoPicker(p => !p); setShowSizePicker(false); }}
              title={idleVideoSrc ? 'Idle video is set — click to change/remove' : 'Set idle background video'}
            >🎬</button>

            {/* Size picker panel */}
            {showSizePicker && !displayOpen && (
              <div className="size-picker-panel">
                <div className="size-picker-title">Screen Size</div>
                {SIZE_PRESETS.map(p => (
                  <label key={p.id} className={`size-option ${sizePreset === p.id ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="sizePreset"
                      value={p.id}
                      checked={sizePreset === p.id}
                      onChange={() => setSizePreset(p.id)}
                    />
                    {p.label}
                  </label>
                ))}
                {sizePreset === 'custom' && (
                  <div className="size-custom-inputs">
                    <input
                      type="number"
                      value={customW}
                      min={320} max={7680}
                      onChange={e => setCustomW(+e.target.value)}
                      placeholder="Width"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      value={customH}
                      min={240} max={4320}
                      onChange={e => setCustomH(+e.target.value)}
                      placeholder="Height"
                    />
                    <span className="size-custom-unit">px</span>
                  </div>
                )}
                <button
                  className="btn-primary size-apply-btn"
                  onClick={() => { setShowSizePicker(false); openDisplayWindow(); }}
                >
                  Open Display
                </button>
              </div>
            )}

            {/* Video picker panel */}
            {showVideoPicker && (
              <div className="size-picker-panel video-picker-panel">
                <div className="size-picker-title">Idle Background Video</div>
                <p className="video-picker-desc">
                  Plays on the display window while no face is detected.<br />
                  Leave unset to show the scanning animation.
                </p>

                {/* File upload */}
                <input
                  ref={videoFileRef}
                  type="file"
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setVideoLoading(true);
                    // Store the raw Blob in IndexedDB — no size limit
                    saveVideoBlob(file).then(() => {
                      const src = URL.createObjectURL(file);
                      setIdleVideoSrc(src);
                      setVideoLoading(false);
                      setShowVideoPicker(false);
                      channelRef.current?.postMessage({ type: 'set-video', src });
                    }).catch(() => setVideoLoading(false));
                  }}
                />
                <button
                  className="btn-outline"
                  style={{ width: '100%' }}
                  onClick={() => videoFileRef.current?.click()}
                  disabled={videoLoading}
                >
                  {videoLoading ? '⏳ Loading…' : '📂 Choose video file'}
                </button>

                {/* URL input */}
                <div className="video-url-row">
                  <input
                    className="form-input"
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                    placeholder="Or paste a video URL…"
                    value={videoUrlInput}
                    onChange={e => setVideoUrlInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && videoUrlInput.trim()) {
                        const src = videoUrlInput.trim();
                        saveVideoUrl(src).catch(() => {});
                        setIdleVideoSrc(src);
                        channelRef.current?.postMessage({ type: 'set-video', src });
                        setVideoUrlInput('');
                        setShowVideoPicker(false);
                      }
                    }}
                  />
                  <button
                    className="btn-primary"
                    style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                    disabled={!videoUrlInput.trim()}
                    onClick={() => {
                      const src = videoUrlInput.trim();
                      saveVideoUrl(src).catch(() => {});
                      setIdleVideoSrc(src);
                      channelRef.current?.postMessage({ type: 'set-video', src });
                      setVideoUrlInput('');
                      setShowVideoPicker(false);
                    }}
                  >Set</button>
                </div>

                {/* Current video preview + remove */}
                {idleVideoSrc && (
                  <div className="video-current">
                    <video
                      src={idleVideoSrc}
                      muted
                      style={{ width: '100%', borderRadius: '6px', maxHeight: '90px', objectFit: 'cover' }}
                    />
                    <button
                      className="btn-danger-sm"
                      style={{ width: '100%', marginTop: '0.3rem' }}
                      onClick={() => {
                        clearVideo().catch(() => {});
                        setIdleVideoSrc('');
                        channelRef.current?.postMessage({ type: 'set-video', src: '' });
                        setShowVideoPicker(false);
                      }}
                    >🗑 Remove video</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`api-badge api-${apiStatus}`}>
            <span className="api-dot" />
            API {apiStatus}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="app-main">

        {activeTab === 'camera' && (
          <div className="camera-tab">

            {/* ── Camera mode toggle ── */}
            <div className="cam-mode-bar">
              <button
                className={`cam-mode-btn ${camMode === 'local' ? 'cam-mode-active' : ''}`}
                onClick={() => handleCamModeSwitch('local')}
              >📷 Local / USB Camera</button>
              <button
                className={`cam-mode-btn ${camMode === 'wireless' ? 'cam-mode-active' : ''}`}
                onClick={() => handleCamModeSwitch('wireless')}
              >📡 Wireless Camera</button>
            </div>

            {/* ── Wireless camera panel ── */}
            {camMode === 'wireless' && (
              <div className="wireless-panel">
                <p className="wireless-desc">
                  Enter the stream URL of your wireless camera.<br />
                  <span className="wireless-example">
                    IP Webcam app: <code>http://192.168.x.x:8080/video</code><br />
                    RTSP camera: <code>rtsp://user:pass@192.168.x.x:554/stream</code>
                  </span>
                </p>
                <div className="wireless-input-row">
                  <input
                    className="form-input"
                    placeholder="http://192.168.x.x:8080/video"
                    value={wirelessUrl}
                    onChange={e => setWirelessUrl(e.target.value)}
                    disabled={wirelessActive}
                  />
                  {!wirelessActive ? (
                    <button className="btn-start btn-lg" onClick={startWireless}>▶ Connect</button>
                  ) : (
                    <button className="btn-stop btn-lg" onClick={stopWireless}>⏹ Disconnect</button>
                  )}
                </div>
                {wirelessError && <p className="wireless-error">⚠️ {wirelessError}</p>}
                {wirelessActive && (
                  <>
                    <p className="wireless-status">🟢 Connected — results updating every 200 ms</p>
                    {/* Live MJPEG preview with bounding boxes from backend */}
                    <div className="wireless-preview">
                      <img
                        key={wirelessUrl}
                        src={`${API_URL}/ip-camera/stream?t=${Date.now()}`}
                        alt="Wireless camera feed"
                        className="wireless-feed"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Local camera feed (hidden in wireless mode) ── */}
            {camMode === 'local' && (
              <Camera isRunning={isRunning} apiUrl={API_URL} onResult={handleResult} />
            )}

            <div className="controls-row">
              {camMode === 'local' && (
              <button
                className={`btn-lg ${isRunning ? 'btn-stop' : 'btn-start'}`}
                onClick={handleToggle}
              >
                {isRunning ? '⏹  Stop Recognition' : '▶  Start Recognition'}
              </button>
              )}
              <button
                className={`btn-sound ${soundEnabled ? 'sound-on' : 'sound-off'}`}
                onClick={() => {
                  if (soundEnabled) window.speechSynthesis?.cancel();
                  setSoundEnabled(p => !p);
                }}
                title={soundEnabled ? 'Mute voice announcements' : 'Unmute voice announcements'}
              >
                {soundEnabled ? '🔊' : '🔇'}
              </button>
              <button
                className={`btn-popout-msg ${popOutMsg ? 'popout-active' : ''}`}
                onClick={() => setPopOutMsg(p => !p)}
                title={popOutMsg ? 'Switch back to inline message' : 'Pop out message as floating card'}
              >
                {popOutMsg ? '📌 Pop Out: On' : '📤 Pop Out: Off'}
              </button>
            </div>

            {/* Inline banner — shown only when pop-out is OFF */}
            {!popOutMsg && currentResult && <MessageBanner result={currentResult} />}

            {/* Floating pop-out card — shown only when pop-out is ON */}
            {popOutMsg && currentResult && currentResult.name !== 'Unknown' && (
              <PopOutMessageCard result={currentResult} />
            )}

            {/* Display window hint when open */}
            {displayOpen && (
              <div className="display-hint">
                🖥 Display window is open — drag it to your second monitor and press F11 to
                maximise.  Recognition results appear there in real-time.
              </div>
            )}
          </div>
        )}

        {activeTab === 'persons' && (
          <PersonsTab
            persons={knownPersons}
            messages={customMessages}
            apiUrl={API_URL}
            onAdd={() => setShowAddPerson(true)}
            onRefresh={fetchPersons}
          />
        )}

        {activeTab === 'log'      && <FaceLog apiUrl={API_URL} />}
        {activeTab === 'messages' && (
          <MessagesTab messages={customMessages} apiUrl={API_URL} onSaved={fetchMessages} />
        )}
      </main>

      {showAddPerson && (
        <AddPerson
          apiUrl={API_URL}
          onClose={() => setShowAddPerson(false)}
          onSuccess={handlePersonAdded}
        />
      )}
    </div>
  );
}

// ── PersonsTab ────────────────────────────────────────────────────────────────
function PersonsTab({ persons, messages, apiUrl, onAdd, onRefresh }) {
  const [deleting, setDeleting] = useState(null);

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete "${name}" from the system?`)) return;
    setDeleting(name);
    try {
      await axios.delete(`${apiUrl}/delete-person/${encodeURIComponent(name)}`);
      onRefresh();
    } catch (e) {
      alert(`Could not delete: ${e.response?.data?.error ?? e.message}`);
    }
    setDeleting(null);
  };

  const handleRebuild = async () => {
    if (!window.confirm('Rebuild ALL embeddings from the dataset folder? This may take a while.')) return;
    try {
      const { data } = await axios.post(`${apiUrl}/rebuild-embeddings`);
      alert(data.message);
      onRefresh();
    } catch (e) {
      alert(`Error: ${e.response?.data?.error ?? e.message}`);
    }
  };

  return (
    <div className="persons-tab">
      <div className="tab-header">
        <h2>Registered Persons</h2>
        <div className="tab-actions">
          <button className="btn-outline" onClick={handleRebuild}>⟳ Rebuild All</button>
          <button className="btn-primary" onClick={onAdd}>+ Add Person</button>
        </div>
      </div>

      {persons.length === 0 ? (
        <div className="empty-state">
          <p className="empty-icon">👤</p>
          <p>No persons registered yet.</p>
          <button className="btn-primary" onClick={onAdd}>Add Your First Person</button>
        </div>
      ) : (
        <div className="persons-grid">
          {persons.map(p => (
            <div key={p.name} className="person-card">
              <div className="person-avatar">{p.name.charAt(0).toUpperCase()}</div>
              <div className="person-info">
                <h3 className="person-name">{p.name}</h3>
                <span className="person-meta">{p.images_count} photo{p.images_count !== 1 ? 's' : ''}</span>
                <span className="person-meta">{p.embeddings_count} embedding{p.embeddings_count !== 1 ? 's' : ''}</span>
              </div>
              <p className="person-message">"{messages[p.name] ?? `Welcome ${p.name}!`}"</p>
              <button
                className="btn-danger-sm"
                onClick={() => handleDelete(p.name)}
                disabled={deleting === p.name}
              >
                {deleting === p.name ? '…' : '🗑'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MessagesTab ───────────────────────────────────────────────────────────────
function MessagesTab({ messages, apiUrl, onSaved }) {
  const [local,  setLocal]  = useState({});
  const [saving, setSaving] = useState(false);
  const [flash,  setFlash]  = useState('');

  useEffect(() => { setLocal(messages); }, [messages]);

  const save = async () => {
    setSaving(true);
    try {
      await axios.post(`${apiUrl}/custom-messages`, local);
      setFlash('✅ Saved!');
      setTimeout(() => setFlash(''), 2500);
      onSaved();
    } catch (e) {
      setFlash(`❌ ${e.response?.data?.error ?? e.message}`);
    }
    setSaving(false);
  };

  const addRow = () => {
    const name = prompt('Enter person name:');
    if (name?.trim()) setLocal(prev => ({ ...prev, [name.trim()]: `Welcome ${name.trim()}!` }));
  };

  return (
    <div className="messages-tab">
      <div className="tab-header">
        <h2>Custom Greeting Messages</h2>
        <div className="tab-actions">
          <button className="btn-outline" onClick={addRow}>+ Add Row</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : flash || 'Save Changes'}
          </button>
        </div>
      </div>
      <p className="tab-desc">These messages are spoken aloud (and shown on the display window) when a person is recognised.</p>

      {Object.keys(local).length === 0 ? (
        <div className="empty-state"><p>No messages yet. Add a person first.</p></div>
      ) : (
        <div className="messages-list">
          {Object.entries(local).map(([name, msg]) => (
            <div key={name} className="message-row">
              <span className="msg-name">{name}</span>
              <input
                className="msg-input"
                value={msg}
                onChange={e => setLocal(prev => ({ ...prev, [name]: e.target.value }))}
                placeholder={`Message for ${name}`}
              />
              <button
                className="btn-icon"
                onClick={() => setLocal(prev => { const n = { ...prev }; delete n[name]; return n; })}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PopOutMessageCard ─────────────────────────────────────────────────────────
// Floating card that appears in the bottom-right corner of the viewport
// when "Pop Out Message" is turned on.
function PopOutMessageCard({ result }) {
  if (!result || !result.detected) return null;

  const isKnown    = result.name !== 'Unknown';
  const confidence = Math.round((result.confidence ?? 0) * 100);

  return (
    <div className={`popout-card ${isKnown ? 'popout-known' : 'popout-unknown'}`}>
      <div className="popout-icon">{isKnown ? '✅' : '❓'}</div>
      <div className="popout-name">{result.name}</div>
      <div className="popout-message">
        {result.message ?? (isKnown ? `Welcome ${result.name}!` : 'Unknown person detected')}
      </div>
      {isKnown && (
        <div className="popout-confidence">
          CONFIDENCE &nbsp;{confidence}% &nbsp;
          {'█'.repeat(Math.round(confidence / 10))}{'░'.repeat(10 - Math.round(confidence / 10))}
        </div>
      )}
    </div>
  );
}
