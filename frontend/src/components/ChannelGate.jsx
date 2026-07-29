import React, { useState } from 'react';
import { useAuth } from '../App.jsx';
import { verifyChannels, markBotLinkClicked } from '../api.js';

const CHANNEL_URL = 'https://t.me/buna_games_best';
const GROUP_URL = 'https://t.me/buna_gamesgroup';

// NEW partner bot link
const BOT_URL = 'https://t.me/mysearch?start=gWnQHZbiJJgBNrUlJQmwEMisxxYVG6GF4tBMm7L_ov4';

const MISSING_LABELS = {
  channel: 'channel',
  group: 'group',
  bot_link: 'new partner bot link',
};

export default function ChannelGate() {
  const { user, updateUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(null);
  const [error, setError] = useState(null);

  // Use localStorage to ensure active sessions are forced to click the NEW bot link
  const HAS_CLICKED_NEW_BOT = localStorage.getItem('clicked_new_partner_bot_v2') === 'true';
  const [botLinkClicked, setBotLinkClicked] = useState(HAS_CLICKED_NEW_BOT);

  const needsChannels = !user?.channels_verified;
  // User needs to click if they haven't clicked the NEW bot link yet
  const needsBotLink = !botLinkClicked;

  const handleBotLinkClick = async () => {
    setBotLinkClicked(true);
    localStorage.setItem('clicked_new_partner_bot_v2', 'true');
    try {
      await markBotLinkClicked();
      updateUser({ bot_link_clicked: true });
    } catch {
      // Non-fatal
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

  const canVerify = botLinkClicked && !checking;

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '10vh' }}>
      <div className="card channel-gate-card">
        <span className="channel-gate-icon">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
            <path d="M21 5 3 12l6 2m12-9-4 15-8-6m12-9L9 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <h2 className="channel-gate-title">
          {!needsChannels && needsBotLink ? 'One More Step' : 'Join to Continue'}
        </h2>
        <p className="channel-gate-text">
          {!needsChannels && needsBotLink
            ? 'Please start our new partner bot below to continue.'
            : 'To use Buna Games, please join our official Telegram channel and group, and start our partner bot below.'}
        </p>

        {/* Channels/Groups - Only show if channels aren't verified yet */}
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

        {/* New Bot Link */}
        {needsBotLink && (
          <a
            href={BOT_URL}
            target="_blank"
            rel="noreferrer"
            className={`channel-gate-link ${botLinkClicked ? 'clicked' : ''}`}
            onClick={handleBotLinkClick}
          >
            <span>Start our Partner Bot</span>
            {botLinkClicked ? (
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </a>
        )}

        {missing && missing.length > 0 && (
          <div className="error-text" style={{ marginTop: 12 }}>
            {missing.includes('bot_link') && missing.length === 1
              ? 'Please tap "Start our Partner Bot" above, then tap Verify again.'
              : `You still need to join the ${missing.map((m) => MISSING_LABELS[m] || m).join(' and ')}. Please join, then tap Verify again.`}
          </div>
        )}
        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        <button
          className="btn btn-primary"
          onClick={handleVerify}
          disabled={!canVerify}
          style={{ width: '100%', marginTop: 16 }}
        >
          {checking ? 'Checking...' : 'Verify'}
        </button>
      </div>
    </div>
  );
}
