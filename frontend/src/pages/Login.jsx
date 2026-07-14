import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { telegramLogin } from '../api.js';
import { useAuth } from '../App.jsx';

// This app is designed to run inside Telegram as a Mini App. On load, the
// Telegram Web App SDK (loaded via index.html) gives us a signed
// `initData` string containing the user's Telegram identity. We send that
// straight to the backend, which verifies the signature and issues our
// own JWT - the user never types a password.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking');
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg || !tg.initData) {
      setStatus('not-telegram');
      return;
    }

    tg.ready();
    tg.expand();

    telegramLogin(tg.initData)
      .then((res) => {
        login(res.data.user, res.data.token);
        setStatus('success');
        navigate('/dashboard');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err.response?.data?.error || 'Could not verify your Telegram account. Please try again.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '15vh', textAlign: 'center' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>✈ Aviator</h2>

        {status === 'checking' && <p style={{ color: '#9aa0b4' }}>Signing you in with Telegram...</p>}

        {status === 'not-telegram' && (
          <>
            <p style={{ color: '#9aa0b4' }}>
              This app only works inside Telegram. Please open it through your Telegram bot.
            </p>
            <p style={{ fontSize: 13, color: '#5b6178' }}>
              If you're testing outside Telegram, use Telegram Desktop or the Telegram app and
              open the Mini App from your bot's menu button.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="error-text">{errorMsg}</div>
            <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>
              Try Again
            </button>
          </>
        )}

        {status === 'success' && <p className="success-text">Signed in! Redirecting...</p>}
      </div>
    </div>
  );
}
