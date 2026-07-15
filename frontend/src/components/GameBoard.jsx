import React, { useEffect, useRef, useState } from 'react';
import api, { getSocket } from '../api.js';
import { useAuth } from '../App.jsx';

// ============================================================================
// All outcomes (crash point, multiplier ticks, auto-cashout execution) are
// computed server-side in backend/src/game.js and pushed here via Socket.IO.
// This component NEVER invents or predicts the crash point - it only maps
// the server-provided multiplier to a screen position for the plane/trail,
// every render, from scratch. There is no separate client-side animation
// clock that could drift out of sync with the actual multiplier value.
// ============================================================================

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
}

// Flight path geometry, in a fixed SVG viewBox coordinate space.
const VIEW_W = 400;
const VIEW_H = 320;
const START = { x: 20, y: 300 };
const END = { x: 380, y: 20 };

function pointAt(t) {
  const eased = 1 - Math.pow(1 - t, 2.2);
  return {
    x: START.x + (END.x - START.x) * t,
    y: START.y + (END.y - START.y) * eased,
  };
}

function angleAt(t) {
  const dt = 0.01;
  const p1 = pointAt(Math.max(0, t - dt));
  const p2 = pointAt(Math.min(1, t + dt));
  return Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
}

// Maps a multiplier value directly to flight-path progress (0..1). This is
// a PURE function of the multiplier - call it every render with whatever
// the server most recently sent, and the plane is guaranteed to be exactly
// where the current multiplier says it should be, every time.
function multiplierToProgress(multiplier, referenceCeiling) {
  const ceiling = Math.max(referenceCeiling, 3);
  if (multiplier <= 1) return 0;
  return Math.min(0.96, Math.log(multiplier) / Math.log(ceiling + 1));
}

function buildPathD(t, steps = 40) {
  let d = `M ${START.x} ${START.y}`;
  for (let i = 1; i <= steps; i++) {
    const p = pointAt((t * i) / steps);
    d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

function buildFillD(t, steps = 40) {
  let d = buildPathD(t, steps);
  const last = pointAt(t);
  d += ` L ${last.x.toFixed(1)} ${VIEW_H} L ${START.x} ${VIEW_H} Z`;
  return d;
}

// The real traced plane silhouette (brand red, no emoji), tight-cropped
// viewBox matching its actual bounding box.
function PlaneIcon() {
  return (
    <svg viewBox="4593 1189 1400 2721" width="56" height="56" style={{ overflow: 'visible' }}>
      <path
        fill="#ff3b4e"
        stroke="none"
        d="M4660 3836 c-17 -34 -3 -222 20 -251 4 -5 15 -44 25 -85 17 -68 29 -101 70 -195 32 -74 45 -101 54 -115 5 -8 20 -37 33 -65 48 -101 100 -195 107 -195 4 0 21 -24 36 -52 16 -29 51 -88 78 -131 34 -53 46 -81 39 -86 -8 -5 -2 -25 19 -67 18 -32 50 -95 73 -139 23 -44 49 -93 58 -110 9 -16 33 -84 53 -150 20 -66 46 -145 57 -175 65 -179 81 -220 104 -268 14 -29 36 -65 48 -80 12 -15 39 -53 60 -86 21 -32 58 -80 82 -107 24 -27 44 -53 44 -58 0 -5 34 -43 75 -85 91 -92 113 -97 132 -26 16 64 15 133 -3 198 -30 110 -86 265 -100 279 -8 8 -14 20 -14 27 0 33 -207 415 -310 572 -77 117 -76 113 -41 170 30 46 55 113 47 122 -9 8 -83 22 -123 22 -44 0 -90 30 -78 50 3 5 -1 34 -9 65 -8 30 -12 55 -10 55 2 0 -7 17 -20 39 -14 21 -37 89 -52 152 -15 63 -38 137 -51 166 -12 28 -23 55 -23 59 0 4 -9 22 -20 38 -11 17 -37 59 -58 93 -20 34 -52 79 -69 100 -18 21 -68 83 -111 138 -88 112 -177 205 -196 205 -7 0 -18 -11 -26 -24z m110 -73 c8 -10 26 -34 40 -53 13 -19 34 -44 46 -55 11 -11 40 -48 63 -82 23 -35 45 -63 49 -63 13 0 126 -180 160 -256 29 -64 63 -174 82 -266 4 -20 17 -56 30 -80 13 -23 28 -68 35 -98 7 -30 16 -67 19 -81 7 -25 7 -26 -40 -23 -26 1 -59 -2 -73 -8 -22 -8 -29 -5 -53 24 -20 24 -26 40 -23 58 4 17 3 21 -3 12 -11 -16 -34 13 -70 84 -12 23 -32 54 -45 70 -22 26 -51 78 -96 174 -9 19 -19 37 -23 38 -5 2 -8 9 -8 16 0 7 -20 52 -45 102 -24 49 -45 97 -45 107 0 9 -4 17 -10 17 -5 0 -10 15 -10 34 0 19 -4 37 -9 40 -5 3 -12 22 -15 41 -4 20 -16 63 -27 97 -23 73 -37 214 -20 204 6 -4 11 -2 11 4 0 12 55 -27 80 -57z m708 -1092 c7 -3 0 -51 -8 -51 -5 0 -9 -3 -8 -7 2 -12 -14 -46 -34 -72 -18 -24 -25 -81 -10 -81 11 0 155 -225 189 -296 15 -32 30 -61 33 -64 9 -9 41 -65 68 -120 15 -30 30 -57 33 -60 10 -9 22 -44 20 -57 -1 -7 2 -13 7 -13 4 0 17 -24 27 -52 10 -29 25 -59 32 -67 8 -7 11 -22 8 -32 -4 -11 -2 -19 4 -19 6 0 11 -11 11 -25 0 -14 5 -25 11 -25 6 0 9 -7 5 -15 -3 -8 -1 -15 4 -15 6 0 10 -11 10 -24 0 -14 4 -27 9 -30 10 -6 21 -60 27 -127 2 -33 -1 -51 -11 -59 -8 -7 -15 -18 -15 -24 0 -6 4 -4 10 4 15 24 21 6 7 -23 -6 -15 -17 -27 -23 -27 -11 0 -39 28 -39 39 0 3 -3 5 -6 4 -9 -3 -78 74 -113 125 -16 23 -32 42 -36 42 -4 0 -23 24 -41 53 -19 28 -55 80 -81 114 -50 67 -75 117 -113 228 -13 39 -38 108 -55 155 -17 47 -36 101 -41 120 -6 19 -14 44 -18 55 -5 11 -14 40 -21 64 -6 23 -14 50 -17 59 -4 10 -2 13 5 8 6 -3 13 -2 17 4 3 5 -3 10 -14 10 -21 0 -64 47 -55 61 3 5 0 9 -6 9 -8 0 -10 10 -6 28 4 17 3 22 -2 14 -7 -10 -12 -8 -24 10 -33 50 -59 111 -54 124 3 8 -1 14 -10 14 -11 0 -14 6 -10 16 3 9 6 19 6 23 0 5 37 9 82 10 45 1 83 3 85 4 1 2 151 -9 161 -12z"
      />
    </svg>
  );
}

function FlightStage({ phase, multiplier, crashPoint }) {
  // Progress is recomputed fresh from `multiplier` on every render - this
  // IS the sync fix. There's no separate timer driving the plane; it can
  // never drift from what the server just told us.
  const progress =
    phase === 'flying' || phase === 'ended'
      ? multiplierToProgress(multiplier, crashPoint || multiplier)
      : 0;

  const pos = pointAt(progress);
  const angle = angleAt(progress) * 0.4; // reduced multiplier: trace's natural rest angle is already diagonal
  const leftPct = (pos.x / VIEW_W) * 100;
  const topPct = (pos.y / VIEW_H) * 100;

  const displayColor = phase === 'ended' ? '#ff3b4e' : phase === 'flying' ? '#3ddc73' : '#f2f2f4';

  return (
    <div className="flight-stage">
      <div className="phase-pill">
        {phase === 'betting' && 'Betting open'}
        {phase === 'flying' && 'Flying'}
        {phase === 'ended' && 'Crashed'}
      </div>

      <div className="rays" />
      <div className="floor-line" />

      <svg className="flight-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trailGradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff3b4e" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#ff3b4e" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="fillGradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff3b4e" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff3b4e" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        {progress > 0 && (
          <>
            <path d={buildFillD(progress)} fill="url(#fillGradient)" opacity="0.9" />
            <path
              d={buildPathD(progress)}
              fill="none"
              stroke="url(#trailGradient)"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>

      {progress > 0 && phase !== 'ended' && (
        <div
          className="plane-wrap"
          style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
        >
          <PlaneIcon />
        </div>
      )}

      <div className="multiplier-display" style={{ color: displayColor }}>
        {multiplier.toFixed(2)}x
      </div>
    </div>
  );
}

function ConnectingOverlay() {
  return (
    <div className="connecting-overlay">
      <div className="connecting-spinner" />
      <p>Connecting to live game...</p>
    </div>
  );
}

export default function GameBoard() {
  const { user, updateBalance } = useAuth();
  const socketRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState('betting');
  const [multiplier, setMultiplier] = useState(1.0);
  const [lastCrashPoint, setLastCrashPoint] = useState(2.0);
  const [serverSeedHash, setServerSeedHash] = useState(null);
  const [history, setHistory] = useState([]);

  const [betAmount, setBetAmount] = useState('1.00');
  const [betPlaced, setBetPlaced] = useState(false);
  const [cashedOutAt, setCashedOutAt] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('round:betting', (data) => {
      setPhase('betting');
      setServerSeedHash(data.server_seed_hash);
      setMultiplier(1.0);
      setBetPlaced(false);
      setCashedOutAt(null);
      setActionError(null);
      setActionMessage(null);
    });

    socket.on('round:flying', () => setPhase('flying'));

    socket.on('round:tick', (data) => setMultiplier(data.multiplier));

    socket.on('round:crashed', (data) => {
      setPhase('ended');
      setMultiplier(data.crash_point);
      setLastCrashPoint(data.crash_point);
      setHistory((prev) => [{ round_id: data.round_id, crash_point: data.crash_point }, ...prev].slice(0, 20));
    });

    api
      .get('/game/history')
      .then((res) => setHistory(res.data.rounds))
      .catch(() => {});

    return () => socket.disconnect();
  }, []);

  const handleBet = async () => {
    setActionError(null);
    setActionMessage(null);
    const amt = parseFloat(betAmount);
    if (!amt || amt <= 0) {
      setActionError('Enter a valid bet amount');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/game/bet', { amount: amt, slot: 1 });
      setBetPlaced(true);
      updateBalance(res.data.balance);
      setActionMessage('Bet placed! Watch the multiplier rise.');
    } catch (err) {
      setActionError(err.response?.data?.error || 'Could not place bet');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCashOut = async () => {
    setActionError(null);
    setActionMessage(null);
    setSubmitting(true);
    try {
      const res = await api.post('/game/cashout', { slot: 1 });
      setCashedOutAt(res.data.multiplier);
      updateBalance(res.data.balance);
      setActionMessage(`Cashed out at ${res.data.multiplier}x for $${res.data.payout.toFixed(2)}!`);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Could not cash out');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
      {!connected && <ConnectingOverlay />}

      <div style={{ padding: 16 }}>
        <FlightStage phase={phase} multiplier={multiplier} crashPoint={phase === 'ended' ? multiplier : lastCrashPoint} />

        {serverSeedHash && (
          <p style={{ fontSize: 12, color: '#5b6178', textAlign: 'center', wordBreak: 'break-all', marginTop: 8 }}>
            Provably fair seed hash: {serverSeedHash.slice(0, 24)}...
          </p>
        )}

        <div className="history-strip">
          {history.map((r, i) => (
            <div key={r.round_id || i} className={`history-chip ${chipClass(r.crash_point)}`}>
              {r.crash_point.toFixed(2)}x
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0.01"
            style={{ flex: 1, minWidth: 120, marginBottom: 0 }}
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            disabled={phase !== 'betting' || betPlaced}
          />
          {phase === 'flying' && betPlaced && !cashedOutAt ? (
            <button className="btn btn-success" onClick={handleCashOut} disabled={submitting}>
              Cash Out
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleBet}
              disabled={submitting || phase !== 'betting' || betPlaced}
            >
              {betPlaced ? 'Bet Placed' : 'Place Bet'}
            </button>
          )}
        </div>

        {actionError && <div className="error-text" style={{ marginTop: 10 }}>{actionError}</div>}
        {actionMessage && <div className="success-text" style={{ marginTop: 10 }}>{actionMessage}</div>}
      </div>
    </div>
  );
}
