import React from 'react';
import ReactDOM from 'react-dom/client';
import './App.css';
import App from './App';

// Global error boundary — catches any component crash and shows a
// readable message instead of a blank/black screen.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '1rem',
          background: '#0a0a0f', color: '#ff6b6b', fontFamily: 'monospace',
          padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '3rem' }}>⚠️</div>
          <h2 style={{ color: '#ff6b6b' }}>App crashed — check the browser console (F12)</h2>
          <pre style={{
            background: '#1a0a0a', padding: '1rem', borderRadius: '8px',
            color: '#ffaaaa', fontSize: '0.8rem', maxWidth: '700px',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#6c63ff', color: '#fff', border: 'none',
              padding: '0.6rem 1.5rem', borderRadius: '8px', cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            🔄 Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  // NOTE: StrictMode removed — it causes effects to run twice in dev mode
  // which can trigger double camera permission prompts and mask real errors.
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
