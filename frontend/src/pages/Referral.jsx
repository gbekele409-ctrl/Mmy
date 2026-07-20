import React, { useState } from 'react';
import { useAuth } from '../App.jsx';

// Shows the user's own referral link (built from their referral_code) and
// a copy button. The bot's deep-link start parameter carries the code so
// a new user opening the bot via this link gets linked to the referrer at
// registration time (see auth.js's /telegram route).
export default function Referral() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'your_bot';
  const referralLink = user?.referral_code
    ? `https://t.me/${botUsername}?start=${user.referral_code}`
    : null;

  const handleCopy = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy your referral link:', referralLink);
    }
  };

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Invite Friends</h2>
        <p style={{ color: '#9aa0b4', fontSize: 14 }}>
          Share your link. When a friend you invite makes their first deposit, you earn a 50%
          commission automatically.
        </p>

        {referralLink ? (
          <>
            <div className="input" style={{ wordBreak: 'break-all', userSelect: 'all' }}>
              {referralLink}
            </div>
            <button className="btn btn-primary" onClick={handleCopy} style={{ width: '100%', marginTop: 8 }}>
              {copied ? 'Copied ✓' : 'Copy Referral Link'}
            </button>
          </>
        ) : (
          <p style={{ color: '#9aa0b4' }}>Your referral link is being set up. Please check back shortly.</p>
        )}
      </div>
    </div>
  );
}
