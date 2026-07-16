import React, { useEffect, useRef, useState } from 'react';
import api, { getSocket } from '../api.js';
import { useAuth } from '../App.jsx';
import FlightStage from './FlightStage.jsx';
import BetPanel from './BetPanel.jsx';

// ============================================================================
// All outcomes (crash point, multiplier ticks, auto-cashout execution) are
// computed server-side in backend/src/game.js and pushed here via Socket.IO.
// This component never invents or predicts the crash point - FlightStage
// only maps whatever multiplier the server sends to a screen position,
// fresh every render.
// ============================================================================

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
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
    // NOTE: no inline `overflow: hidden` here anymore - it risked clipping
    // the bet-panel grid on narrow screens if any child computed wider
    // than the card. Card-level overflow control now lives in CSS
    // (.aviator-card in index.css) with a safer, explicit rule.
    <div className="card aviator-card">
      {!connected && <ConnectingOverlay />}

      <TopBar balance={user?.balance} />
      <HistoryStrip history={history} />

      <FlightStage
        phase={phase}
        multiplier={multiplier}
        crashPoint={phase === 'ended' ? multiplier : lastCrashPoint}
      />

      <div className="aviator-body">
        {serverSeedHash && (
          <p className="seed-hash-note">
            Provably fair seed hash: {serverSeedHash.slice(0, 24)}...
          </p>
        )}

        {/* Real CSS grid class instead of an inline style object - inline
            styles can silently fail to apply if a later stylesheet or a
            parent's own layout rules take precedence; a named class in
            index.css is easier to debug and override deliberately. */}
        <div className="bet-panels-grid">
          <BetPanel slot={1} phase={phase} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
          <BetPanel slot={2} phase={phase} socket={socketRef.current} onBalanceChange={handleBalanceChange} />
        </div>
      </div>
    </div>
  );
}
