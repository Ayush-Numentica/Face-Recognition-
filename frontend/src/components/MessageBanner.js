/**
 * MessageBanner.js
 * ────────────────
 * Displays recognition result below the camera feed.
 *
 * • Green card  → known person
 * • Red card    → unknown / no face
 * Shows name, custom message, and confidence percentage.
 */

import React from 'react';

export default function MessageBanner({ result }) {
  if (!result || !result.detected) return null;

  const isKnown    = result.name !== 'Unknown';
  const confidence = Math.round((result.confidence ?? 0) * 100);

  return (
    <div className={`message-banner ${isKnown ? 'known' : 'unknown'}`}>
      <div className="banner-icon">{isKnown ? '✅' : '❓'}</div>

      <div className="banner-content">
        <div className="banner-name">{result.name}</div>

        <div className="banner-message">
          {result.message ?? (isKnown ? `Welcome ${result.name}!` : 'Unknown person detected')}
        </div>

        {isKnown && (
          <div className="banner-confidence">
            Confidence: {confidence}%
            &nbsp;
            {'█'.repeat(Math.round(confidence / 10))}{'░'.repeat(10 - Math.round(confidence / 10))}
          </div>
        )}
      </div>
    </div>
  );
}
