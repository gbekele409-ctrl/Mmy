import React, { useState, useEffect } from 'react';
import { useAuth } from '../App.jsx';
import { verifyChannels, markBotLinkClicked } from '../api.js';

const CHANNEL_URL = 'https://t.me/buna_games_best';
const GROUP_URL = 'https://t.me/buna_gamesgroup';
const SUPPORT_URL = 'https://t.me/buna_gamessupport'; // Replace with your support bot/user link

// Your Google Play Store Referral Link
const DOWNLOAD_URL = 'https://play.google.com/store/apps/details?id=com.jokerx.airewards&referrer=utm_source%3Dref%26utm_medium%3DgKkegSjHdPelvLERaYxtC9rO0eh2%26anid%3Dadmob';

const MISSING_LABELS = {
  channel: 'channel',
  group: 'group',
  bot_link: 'download step',
};

export default function ChannelGate() {
  const { user, updateUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(null);
  const [error, setError] = useState(null);

  // Checks if user already completed the click requirement
  const HAS_DOWNLOADED = localStorage.getItem('downloaded_partner_app_v2') === 'true';
  const [downloadClicked, setDownloadClicked] = useState(HAS_DOWNLOADED);

  // Timer state (10 seconds wait after clicking link)
  const [timer, setTimer] = useState(0);

  const needsChannels = !user?.channels_verified;
  const needsDownload = !downloadClicked;

  // Handle countdown timer decrement
  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleDownloadClick = async () => {
    setDownloadClicked(true);
    setTimer(10); // Start 10 second wait timer
    localStorage.setItem('downloaded_partner_app_v2', 'true');
    try {
      await markBotLinkClicked();
      updateUser({ bot_link_clicked: true });
    } catch {
      // Non-fatal - local state allows user to attempt Verify
    }
  };

  const handleVerify = async () => {
    setChecking(true);
    setError(null);
    setMissing(null);
    try {
      const res = await verifyChannels();
      if (res.data.verified) {
        updateUser({ channels_verified: true, bot_link_clicked: true });
      } else {
        setMissing(res.data.missing);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not verify right now. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  // Enable verify only if they clicked download, timer finished (0), and not checking
  const canVerify = downloadClicked && timer === 0 && !checking;

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '10vh' }}>
      <div className="card channel-gate-card">
        <span className="channel-gate-icon">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
            <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <h2 className="channel-gate-title">
          {!needsChannels && needsDownload ? 'One More Step' : 'Join & Download to Continue'}
        </h2>
        <p className="channel-gate-text">
          {!needsChannels && needsDownload
            ? 'Please download our partner application on Google Play to continue.'
            : 'To use Buna Games, please join our official Telegram channel and group, and download our partner application.'}
        </p>

        {/* 🎁 Updated Bonus Offer Banner */}
        <div 
          style={{
            background: 'rgba(255, 193, 7, 0.15)',
            border: '1px solid rgba(255, 193, 7, 0.4)',
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '16px',
            fontSize: '0.88rem',
            textAlign: 'center',
            color: '#ffd54f'
          }}
        >
          🎁 <strong>Get 10 Birr Bonus:</strong> Download the app, create an account, and send proof to our{' '}
          <a 
            href={SUPPORT_URL} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: '#fff', textDecoration: 'underline', fontWeight: 'bold' }}
          >
            Support Team
          </a>{' '}
          to claim your reward!
        </div>

        {/* Channels & Groups - Only show if not verified */}
        {needsChannels && (
          <>
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
          </>
        )}

        {/* Partner Download Link (Google Play) */}
        {needsDownload && (
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className={`channel-gate-link ${downloadClicked ? 'clicked' : ''}`}
            onClick={handleDownloadClick}
          >
            <span>Download AI Rewards App</span>
            {downloadClicked ? (
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </a>
        )}

        {missing && missing.length > 0 && (
          <div className="error-text" style={{ marginTop: 12 }}>
            {missing.includes('bot_link') && missing.length === 1
              ? 'Please tap "Download AI Rewards App" above, then tap Verify again.'
              : `You still need to complete ${missing.map((m) => MISSING_LABELS[m] || m).join(' and ')}. Please complete them, then tap Verify again.`}
          </div>
        )}
        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        {/* Verify Button with 10s Countdown */}
        <button
          className="btn btn-primary"
          onClick={handleVerify}
          disabled={!canVerify}
          style={{ width: '100%', marginTop: 16 }}
        >
          {checking
            ? 'Checking...'
            : timer > 0
            ? `Please wait (${timer}s)...`
            : 'Verify'}
        </button>
      </div>
    </div>
  );
}
