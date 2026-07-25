import React, { useState } from 'react';
import { useAuth } from '../App.jsx';
import { verifyChannels } from '../api.js';

const CHANNEL_URL = 'https://t.me/buna_games_best';
const GROUP_URL = 'https://t.me/buna_gamesgroup';

export default function ChannelGate() {
  const { updateUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(null);
  const [error, setError] = useState(null);

  const handleVerify = async () => {
    setChecking(true);
    setError(null);
    setMissing(null);
    try {
      const res = await verifyChannels();
      if (res.data.verified) {
        updateUser({ channels_verified: true });
      } else {
        setMissing(res.data.missing);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not verify right now. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '10vh' }}>
      <div className="card channel-gate-card">
        <span className="channel-gate-icon">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
            <path d="M21 5 3 12l6 2m12-9-4 15-8-6m12-9L9 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <h2 className="channel-gate-title">Join to Continue</h2>
        <p className="channel-gate-text">
          To use Buna Games, please join our official Telegram channel and group first.
        </p>

        <a href={CHANNEL_URL} target="_blank" rel="noreferrer" className="channel-gate-link">
          <span>Join our Channel</span>
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <a href={GROUP_URL} target="_blank" rel="noreferrer" className="channel-gate-link">
          <span>Join our Group</span>
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>

        {missing && missing.length > 0 && (
          <div className="error-text" style={{ marginTop: 12 }}>
            You still need to join the {missing.join(' and ')}. Please join, then tap Verify again.
          </div>
        )}
        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        <button className="btn btn-primary" onClick={handleVerify} disabled={checking} style={{ width: '100%', marginTop: 16 }}>
          {checking ? 'Checking...' : 'Verify'}
        </button>
      </div>
    </div>
  );
}
