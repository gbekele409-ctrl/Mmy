import React, { useState, useEffect } from 'react';
import { useAuth } from '../App.jsx';
import { verifyChannels, markBotLinkClicked } from '../api.js';

const CHANNEL_URL = 'https://t.me/buna_games_best';
const GROUP_URL = 'https://t.me/buna_gamesgroup';
const SUPPORT_URL = 'https://t.me/buna_gamessupport';
const BOT_URL = 'https://t.me/Habesha_farmerbot?start=6861373986';

const MISSING_LABELS = {
  channel: 'channel',
  group: 'group',
  bot_link: 'bot task step',
};

export default function ChannelGate() {
  const { user, updateUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(null);
  const [error, setError] = useState(null);

  // User MUST click the bot link in this session to proceed
  const [downloadClicked, setDownloadClicked] = useState(false);

  // Timer state (10 seconds wait after clicking link)
  const [timer, setTimer] = useState(0);

  const needsChannels = !user?.channels_verified;

  // Handle countdown timer decrement
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const handleBotClick = async () => {
    setDownloadClicked(true);
    setTimer(10); // Start 10 second countdown requirement

    try {
      await markBotLinkClicked();
      updateUser({ bot_link_clicked: true });
    } catch {
      // Non-fatal API backup
    }
  };

  const handleVerify = async () => {
    // Extra safety guard: return early if they haven't clicked the bot link
    if (!downloadClicked) {
      setError('Please tap "Start Habesha Farmer Bot" link first!');
      return;
    }

    setChecking(true);
    setError(null);
    setMissing(null);

    try {
      const res = await verifyChannels();
      if (res.data?.verified) {
        updateUser({ channels_verified: true, bot_link_clicked: true });
      } else {
        setMissing(res.data?.missing || []);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not verify right now. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  // Enable verify button ONLY if:
  // 1. Bot link HAS been clicked in this session
  // 2. The 10s wait timer completed
  // 3. Not currently checking status with backend
  const canVerify = downloadClicked && timer === 0 && !checking;

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '10vh' }}>
      <div className="card channel-gate-card">
        <span className="channel-gate-icon">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
            <path
              d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h2 className="channel-gate-title">
          {needsChannels ? 'Join & Complete Task to Continue' : 'One More Step'}
        </h2>

        <p className="channel-gate-text">
          {needsChannels
            ? 'To use Buna Games, please join our official Telegram channel and group, and complete our partner bot task.'
            : 'Please complete our partner bot task to continue.'}
        </p>

        {/* 🎁 20 Birr Bonus Banner */}
        <div
          style={{
            background: 'rgba(255, 193, 7, 0.15)',
            border: '1px solid rgba(255, 193, 7, 0.4)',
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '16px',
            fontSize: '0.88rem',
            textAlign: 'center',
            color: '#ffd54f',
          }}
        >
          🎁 <strong>Get 20 Birr Bonus:</strong> Start the bot and create one Gmail account! Send proof to our{' '}
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#fff', textDecoration: 'underline', fontWeight: 'bold' }}
          >
            Support Team
          </a>{' '}
          to claim <strong>20 Birr</strong>!
        </div>

        {/* Channels & Groups */}
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

        {/* Mandatory Partner Bot Link */}
        <a
          href={BOT_URL}
          target="_blank"
          rel="noreferrer"
          className={`channel-gate-link ${downloadClicked ? 'clicked' : ''}`}
          onClick={handleBotClick}
          style={{ marginBottom: 12 }}
        >
          <span>Start Habesha Farmer Bot</span>
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

        {/* Missing Task Hints */}
        {missing && missing.length > 0 && (
          <div className="error-text" style={{ marginTop: 12 }}>
            {missing.includes('bot_link') && missing.length === 1
              ? 'Please tap "Start Habesha Farmer Bot" above, then tap Verify again.'
              : `You still need to complete ${missing.map((m) => MISSING_LABELS[m] || m).join(' and ')}. Please complete them, then tap Verify again.`}
          </div>
        )}

        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        {/* Verify Button */}
        <button
          className="btn btn-primary"
          onClick={handleVerify}
          disabled={!canVerify}
          style={{ width: '100%', marginTop: 16 }}
        >
          {checking
            ? 'Checking...'
            : !downloadClicked
            ? 'Click Bot Link First to Verify'
            : timer > 0
            ? `Please wait (${timer}s)...`
            : 'Verify'}
        </button>
      </div>
    </div>
  );
}
