/**
 * FaceLog.js
 * ──────────
 * Shows the last 100 recognition events fetched from GET /face-log.
 * Auto-refreshes every 10 seconds while the tab is visible.
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export default function FaceLog({ apiUrl }) {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiUrl}/face-log`);
      setLogs(data);
    } catch (e) {
      console.error('fetchLogs:', e.message);
    }
    setLoading(false);
  }, [apiUrl]);

  // Fetch on mount and every 10 s
  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 10_000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  const fmt = (ts) => {
    try { return new Date(ts).toLocaleString(); }
    catch { return ts; }
  };

  return (
    <div className="log-tab">
      <div className="tab-header">
        <h2>Recognition Log</h2>
        <button className="btn-outline" onClick={fetchLogs} disabled={loading}>
          {loading ? <><span className="spinner" /> Loading…</> : '↻ Refresh'}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state">
          <p className="empty-icon">📋</p>
          <p>No events logged yet.</p>
          <p>Start the camera and recognise some faces!</p>
        </div>
      ) : (
        <div className="log-table-wrapper">
          <table className="log-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th>Confidence</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry, i) => {
                const pct = Math.round((entry.confidence ?? 0) * 100);
                return (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                      {logs.length - i}
                    </td>
                    <td>
                      <span className="log-name">
                        {entry.name !== 'Unknown' ? '✅' : '❓'}
                        &nbsp;{entry.name}
                      </span>
                    </td>
                    <td>
                      <div className="confidence-bar-wrapper">
                        <div
                          className="confidence-bar"
                          style={{ width: `${pct}%` }}
                        />
                        <span style={{ fontSize: '0.8rem' }}>{pct}%</span>
                      </div>
                    </td>
                    <td className="log-time">{fmt(entry.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
