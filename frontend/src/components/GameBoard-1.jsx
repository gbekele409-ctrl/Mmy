import React, { useEffect, useRef, useState } from 'react';
import api, { getSocket } from '../api.js';
import { useAuth } from '../App.jsx';
import BetPanel from './BetPanel.jsx';

// ============================================================================
// All outcomes (crash point, multiplier ticks, auto-cashout execution) are
// computed server-side in backend/src/game.js and pushed here via Socket.IO.
// This component never invents or predicts the crash point - it only maps
// the server-provided multiplier to a screen position for the plane/trail,
// fresh on every render, so the plane can never drift out of sync.
//
// NOTE: this file intentionally does NOT show a "live players online"
// count. That requires a real backend broadcast (a `presence:count` event
// from server.js/game.js tracking actual Socket.IO connections) which
// does not exist yet. Do not add a fake/static number here - build the
// backend piece first, then wire it in for real.
// ============================================================================

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
}

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

// Simple, verified-safe plane icon built from basic SVG polygons in a
// small viewBox - renders reliably everywhere, unlike a large traced path.
function PlaneIcon() {
  return (
    <svg viewBox="0 0 100 100" width="40" height="40" style={{ overflow: 'visible', display: 'block' }}>
      <g>
        <polygon points="10,70 85,25 90,32 80,42 55,55 30,68 15,78" fill="#ff3b4e" stroke="#a80d22" strokeWidth="2" />
        <polygon points="15,78 5,92 22,80" fill="#a80d22" />
        <polygon points="45,58 50,35 56,37 52,60" fill="#ffffff" opacity="0.85" />
        <ellipse cx="14" cy="76" rx="7" ry="4" fill="#ffb930" opacity="0.9" />
      </g>
    </svg>
  );
}

function TopBar({ balance }) {
  return (
    <div className="aviator-topbar">
      <div className="aviator-brand">Aviator</div>
      <div className="aviator-topbar-right">
        <span className="aviator-balance">{Number(balance || 0).toFixed(2)} ETB</span>
        <div className="icon-btn">☰</div>
      </div>
    </div>
  );
}

function HistoryStrip({ history }) {
  return (
    <div className="history-strip">
      {history.map((r, i) => (
        <div key={r.round_id || i} className={`history-chip ${chipClass(r.crash_point)}`}>
          {r.crash_point.toFixed(2)}x
        </div>
      ))}
    </div>
  );
}

function FlightStage({ phase, multiplier, crashPoint }) {
  const progress =
    phase === 'flying' || phase === 'ended'
      ? multiplierToProgress(multiplier, crashPoint || multiplier)
      : 0;

  const pos = pointAt(progress);
  const angle = angleAt(progress) * 0.4;
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
            <path d={buildPathD(progress)} fill="none" stroke="url(#trailGradient)" strokeWidth="5" strokeLinecap="round" />
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

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('round:betting', (data) => {
      setPhase('betting');
      setServerSeedHash(data.server_seed_hash);
      setMultiplier(1.0);
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

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('round:betting');
      socket.off('round:flying');
      socket.off('round:tick');
      socket.off('round:crashed');
      socket.disconnect();
    };
  }, []);

  const handleBalanceChange = (newBalance) => {
    if (typeof newBalance === 'number') {
      updateBalance(newBalance);
    } else {
      api.get('/wallet/balance').then((res) => updateBalance(res.data.balance));
    }
  };

  return (
    <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
      {!connected && <ConnectingOverlay />}

      <TopBar balance={user?.balance} />
      <HistoryStrip history={history} />

      <div style={{ padding: '0 16px 16px' }}>
        <FlightStage phase={phase} multiplier={multiplier} crashPoint={phase === 'ended' ? multiplier : lastCrashPoint} />

        {serverSeedHash && (
          <p style={{ fontSize: 12, color: '#5b6178', textAlign: 'center', wordBreak: 'break-all', marginTop: 8 }}>
            Provably fair seed hash: {serverSeedHash.slice(0, 24)}...
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <BetPanel slot={1} phase={phase} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
          <BetPanel slot={2} phase={phase} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
        </div>
      </div>
    </div>
  );
}
