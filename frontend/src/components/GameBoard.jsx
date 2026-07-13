import React, { useEffect, useRef, useState } from 'react';
import api, { getSocket } from '../api.js';
import { useAuth } from '../App.jsx';

// All outcomes (crash point, multiplier ticks, auto-cashout execution) are
// computed server-side in backend/src/game.js and pushed here via
// Socket.IO. This component never invents or predicts the crash point or
// decides an auto-cashout itself - it only renders server state and sends
// "place bet" / "cash out" / "set auto-bet" intents back to the API.

function chipClass(crash) {
  if (crash < 1.5) return 'low';
  if (crash < 3) return 'mid';
  return 'high';
}

const QUICK_AMOUNTS = [1, 2, 5, 10];

function BetSlot({ slot, phase, balance, onBalanceChange, socket }) {
  const [amount, setAmount] = useState('1.00');
  const [autoCashoutAt, setAutoCashoutAt] = useState('');
  const [useAutoCashout, setUseAutoCashout] = useState(false);
  const [autoBetNextRound, setAutoBetNextRound] = useState(false);

  const [betState, setBetState] = useState(null); // null | 'placed' | 'cashed_out' | 'lost'
  const [cashoutMultiplier, setCashoutMultiplier] = useState(null);
  const [payout, setPayout] = useState(null);

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset per-round display state whenever a new betting phase starts.
  useEffect(() => {
    if (phase === 'betting') {
      setBetState(null);
      setCashoutMultiplier(null);
      setPayout(null);
      setError(null);

      if (autoBetNextRound) {
        placeBet(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Listen for server-driven auto-cashout events for this slot.
  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      if (data.slot !== slot) return;
      setBetState('cashed_out');
      setCashoutMultiplier(data.multiplier);
      setPayout(data.payout);
      onBalanceChange();
    };
    socket.on('bet:auto_cashed_out', handler);
    return () => socket.off('bet:auto_cashed_out', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, slot]);

  const placeBet = async (isAuto = false) => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      if (!isAuto) setError('Enter a valid bet amount');
      return;
    }

    const payload = { amount: amt, slot };
    if (useAutoCashout) {
      const target = parseFloat(autoCashoutAt);
      if (!target || target <= 1) {
        if (!isAuto) setError('Auto-cashout target must be greater than 1.00x');
        return;
      }
      payload.auto_cashout_at = target;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/game/bet', payload);
      setBetState('placed');
      onBalanceChange(res.data.balance);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place bet');
    } finally {
      setSubmitting(false);
    }
  };

  const cashOut = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post('/game/cashout', { slot });
      setBetState('cashed_out');
      setCashoutMultiplier(res.data.multiplier);
      setPayout(res.data.payout);
      onBalanceChange(res.data.balance);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cash out');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAutoBetNextRound = async (checked) => {
    setAutoBetNextRound(checked);
    try {
      await api.put(`/game/auto-bet/${slot}`, {
        enabled: checked,
        amount: parseFloat(amount) || 1,
        auto_cashout_at: useAutoCashout ? parseFloat(autoCashoutAt) || null : null,
      });
    } catch (err) {
      setError('Could not save auto-bet preference');
      setAutoBetNextRound(!checked);
    }
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 13, color: '#9aa0b4', marginBottom: 8 }}>Bet {slot}</div>

      <input
        className="input"
        type="number"
        step="0.01"
        min="0.01"
        style={{ marginBottom: 8 }}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={phase !== 'betting' || betState === 'placed'}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {QUICK_AMOUNTS.map((v) => (
          <button
            key={v}
            className="btn btn-outline"
            style={{ padding: '4px 10px', fontSize: 13 }}
            onClick={() => setAmount(v.toFixed(2))}
            disabled={phase !== 'betting' || betState === 'placed'}
          >
            {v}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={useAutoCashout}
          onChange={(e) => setUseAutoCashout(e.target.checked)}
          disabled={phase !== 'betting' || betState === 'placed'}
        />
        Auto cash out at
      </label>
      {useAutoCashout && (
        <input
          className="input"
          type="number"
          step="0.01"
          min="1.01"
          placeholder="e.g. 2.00"
          style={{ marginBottom: 8 }}
          value={autoCashoutAt}
          onChange={(e) => setAutoCashoutAt(e.target.value)}
          disabled={phase !== 'betting' || betState === 'placed'}
        />
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={autoBetNextRound}
          onChange={(e) => toggleAutoBetNextRound(e.target.checked)}
        />
        Auto-bet next round
      </label>

      {phase === 'flying' && betState === 'placed' ? (
        <button className="btn btn-success" style={{ width: '100%' }} onClick={cashOut} disabled={submitting}>
          Cash Out
        </button>
      ) : (
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={() => placeBet(false)}
          disabled={submitting || phase !== 'betting' || betState === 'placed'}
        >
          {betState === 'placed' ? 'Bet Placed' : 'Place Bet'}
        </button>
      )}

      {betState === 'cashed_out' && (
        <div className="success-text" style={{ marginTop: 8 }}>
          Cashed out at {cashoutMultiplier}x for ${payout?.toFixed(2)}
        </div>
      )}
      {betState === 'lost' && <div className="error-text" style={{ marginTop: 8 }}>Lost this round</div>}
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function GameBoard() {
  const { user, updateBalance } = useAuth();
  const socketRef = useRef(null);

  const [phase, setPhase] = useState('connecting');
  const [multiplier, setMultiplier] = useState(1.0);
  const [serverSeedHash, setServerSeedHash] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

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
      setHistory((prev) => [{ round_id: data.round_id, crash_point: data.crash_point }, ...prev].slice(0, 20));
    });

    api
      .get('/game/history')
      .then((res) => setHistory(res.data.rounds))
      .catch(() => {});

    return () => socket.disconnect();
  }, []);

  const handleBalanceChange = (newBalance) => {
    if (typeof newBalance === 'number') {
      updateBalance(newBalance);
    } else {
      // Auto-cashout events don't carry the caller's balance directly in
      // every path - refetch to stay accurate.
      api.get('/wallet/balance').then((res) => updateBalance(res.data.balance));
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <BetSlot slot={1} phase={phase} balance={user?.balance} onBalanceChange={handleBalanceChange} socket={socketRef.current} />
        <BetSlot slot={2} phase={phase} balance={user?.balance} onBalanceChange={handleBalanceChange} socket={socketRef.current} />
      </div>
    </div>
  );
}
