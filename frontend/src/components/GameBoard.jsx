import React, { useEffect, useRef, useState } from 'react';
import { getSocket } from '../api.js';
import { placeBet, cashOut, getRoundHistory } from '../api.js';
import { useAuth } from '../App.jsx';

// All outcomes (crash point, multiplier ticks) are computed server-side in
// backend/src/game.js and pushed here via Socket.IO. This component never
// invents or predicts a multiplier - it only renders what the server sends
// and forwards the user's "place bet" / "cash out" intent back to the API.

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
}

export default function GameBoard() {
  const { user, updateBalance } = useAuth();
  const socketRef = useRef(null);

  const [phase, setPhase] = useState('connecting'); // connecting | betting | flying | ended
  const [multiplier, setMultiplier] = useState(1.0);
  const [roundId, setRoundId] = useState(null);
  const [serverSeedHash, setServerSeedHash] = useState(null);
  const [lastCrash, setLastCrash] = useState(null);
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

    socket.on('round:betting', (data) => {
      setPhase('betting');
      setRoundId(data.round_id);
      setServerSeedHash(data.server_seed_hash);
      setMultiplier(1.0);
      setBetPlaced(false);
      setCashedOutAt(null);
      setActionError(null);
      setActionMessage(null);
    });

    socket.on('round:flying', (data) => {
      setPhase('flying');
      setRoundId(data.round_id);
    });

    socket.on('round:tick', (data) => {
      setMultiplier(data.multiplier);
    });

    socket.on('round:crashed', (data) => {
      setPhase('ended');
      setLastCrash(data.crash_point);
      setMultiplier(data.crash_point);
      setHistory((prev) => [{ round_id: data.round_id, crash_point: data.crash_point }, ...prev].slice(0, 20));
    });

    getRoundHistory()
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
      const res = await placeBet(amt);
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
      const res = await cashOut();
      setCashedOutAt(res.data.multiplier);
      updateBalance(res.data.balance);
      setActionMessage(`Cashed out at ${res.data.multiplier}x for $${res.data.payout.toFixed(2)}!`);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Could not cash out');
    } finally {
      setSubmitting(false);
    }
  };

  const displayColor = phase === 'ended' ? '#f87171' : phase === 'flying' ? '#4ade80' : '#e8e8ea';

  return (
    <div className="card">
      <div className="phase-label">
        {phase === 'betting' && 'Betting open'}
        {phase === 'flying' && 'Flying'}
        {phase === 'ended' && 'Crashed'}
        {phase === 'connecting' && 'Connecting...'}
      </div>
      <div className="multiplier-display" style={{ color: displayColor }}>
        {multiplier.toFixed(2)}x
      </div>

      {serverSeedHash && (
        <p style={{ fontSize: 12, color: '#5b6178', textAlign: 'center', wordBreak: 'break-all' }}>
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
  );
}
