import React, { useState, useEffect } from 'react';
import api from '../api.js';

// Faithful port of the bet-panel design from the uploaded reference file
// (mode tabs, stepper, quick-amount grid, state-driven action button),
// rewired so every action calls the REAL backend instead of a local
// simulation. The server (backend/src/game.js) is the only place that
// decides bet outcomes, auto-cashout timing, or payouts - this component
// only sends intents ("place bet", "cash out", "save auto-bet") and
// renders whatever state comes back.

const QUICK_AMOUNTS = [16, 40, 80, 400];

export default function BetPanel({ slot, phase, socket, onBalanceChange, showRemove, onRemove }) {
  const [mode, setMode] = useState('bet'); // 'bet' | 'auto'
  const [amount, setAmount] = useState(16);
  const [autoCashoutValue, setAutoCashoutValue] = useState(2.0);
  const [autoBetNextRound, setAutoBetNextRound] = useState(false);

  // status: 'idle' | 'placed' | 'cashout' (flying, can cash out) | 'won' | 'lost'
  const [status, setStatus] = useState('idle');
  const [betAmount, setBetAmount] = useState(null);
  const [cashoutMultiplier, setCashoutMultiplier] = useState(null);
  const [payout, setPayout] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const amountEditLocked = phase !== 'betting';

  // Reset per-round display state when a new betting phase begins, and
  // fire an auto-bet if the toggle is on.
  useEffect(() => {
    if (phase === 'betting') {
      setStatus('idle');
      setCashoutMultiplier(null);
      setPayout(null);
      setError(null);
      if (autoBetNextRound) placeBet(true);
    } else if (phase === 'flying' && status === 'placed') {
      setStatus('cashout');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Listen for server-driven auto-cashout results for this slot.
  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      if (data.slot !== slot) return;
      setStatus('won');
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
    if (!amount || amount <= 0) {
      if (!isAuto) setError('Enter a valid amount');
      return;
    }
    const payload = { amount, slot };
    if (mode === 'auto') {
      if (!autoCashoutValue || autoCashoutValue <= 1) {
        if (!isAuto) setError('Auto-cashout must be greater than 1.00x');
        return;
      }
      payload.auto_cashout_at = autoCashoutValue;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/game/bet', payload);
      setStatus('placed');
      setBetAmount(amount);
      onBalanceChange(res.data.balance);
    } catch (err) {
      if (!isAuto) setError(err.response?.data?.error || 'Could not place bet');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBet = async () => {
    // No cancel endpoint exists server-side by design (a placed bet is
    // committed); this simply resets the local intent before betting
    // closes. If you want real cancellation, it needs a backend route.
    setStatus('idle');
  };

  const cashOut = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post('/game/cashout', { slot });
      setStatus('won');
      setCashoutMultiplier(res.data.multiplier);
      setPayout(res.data.payout);
      onBalanceChange(res.data.balance);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cash out');
      setStatus('lost');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAutoBetNextRound = async (checked) => {
    setAutoBetNextRound(checked);
    try {
      await api.put(`/game/auto-bet/${slot}`, {
        enabled: checked,
        amount,
        auto_cashout_at: mode === 'auto' ? autoCashoutValue : null,
      });
    } catch {
      setAutoBetNextRound(!checked);
    }
  };

  const step = (delta) => {
    if (amountEditLocked) return;
    setAmount((prev) => Math.max(1, Math.round((prev + delta) * 100) / 100));
  };

  return (
    <div className="bet-panel" data-mode={mode}>
      <div className="bet-panel-topline">
        <div className="mode-tabs">
          <div
            className={`mode-tab ${mode === 'bet' ? 'active' : ''}`}
            onClick={() => !amountEditLocked && setMode('bet')}
          >
            Bet
          </div>
          <div
            className={`mode-tab ${mode === 'auto' ? 'active' : ''}`}
            onClick={() => !amountEditLocked && setMode('auto')}
          >
            Auto
          </div>
        </div>
        {showRemove && (
          <button className="panel-remove-btn" onClick={onRemove} title="Remove panel">
            &minus;
          </button>
        )}
      </div>

      {mode === 'auto' && (
        <div className="auto-row" style={{ display: 'flex' }}>
          <span className="auto-label">Auto cash out at</span>
          <input
            type="number"
            step="0.1"
            min="1.01"
            value={autoCashoutValue}
            disabled={amountEditLocked}
            onChange={(e) => setAutoCashoutValue(parseFloat(e.target.value) || 0)}
          />
        </div>
      )}

      <div className="bet-panel-body">
        <div className="bet-amount-block">
          <div className="stepper-row">
            <button className="stepper-btn" disabled={amountEditLocked} onClick={() => step(-1)}>
              &minus;
            </button>
            <input
              className="stepper-input"
              type="number"
              step="1"
              min="1"
              value={amount}
              disabled={amountEditLocked}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            />
            <button className="stepper-btn" disabled={amountEditLocked} onClick={() => step(1)}>
              +
            </button>
          </div>
          <div className="quick-amount-grid">
            {QUICK_AMOUNTS.map((v) => (
              <button
                key={v}
                className={`quick-amount-btn ${Math.abs(amount - v) < 0.001 ? 'selected' : ''}`}
                disabled={amountEditLocked}
                onClick={() => setAmount(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="bet-action-block">
          <ActionButton
            phase={phase}
            status={status}
            amount={amount}
            betAmount={betAmount}
            cashoutMultiplier={cashoutMultiplier}
            payout={payout}
            submitting={submitting}
            onPlace={() => placeBet(false)}
            onCancel={cancelBet}
            onCashOut={cashOut}
          />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
        <input type="checkbox" checked={autoBetNextRound} onChange={(e) => toggleAutoBetNextRound(e.target.checked)} />
        Auto-bet next round
      </label>

      {error && <div className="error-text" style={{ marginTop: 8, fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function ActionButton({ phase, status, amount, betAmount, cashoutMultiplier, payout, submitting, onPlace, onCancel, onCashOut }) {
  if (phase === 'betting') {
    if (status === 'placed') {
      return (
        <button className="bet-btn state-placed" onClick={onCancel} disabled={submitting}>
          <span className="bet-btn-top">Cancel</span>
          <span className="bet-btn-sub">{betAmount?.toFixed(2)} ETB</span>
        </button>
      );
    }
    return (
      <button className="bet-btn state-idle" onClick={onPlace} disabled={submitting}>
        <span className="bet-btn-top">Bet</span>
        <span className="bet-btn-sub">
          {amount?.toFixed(2)}
          <span className="cur-tag">ETB</span>
        </span>
      </button>
    );
  }

  if (phase === 'flying') {
    if (status === 'won') {
      return (
        <button className="bet-btn state-won" disabled>
          <span className="bet-btn-top">Cashed Out {cashoutMultiplier}x</span>
          <span className="bet-btn-sub">+{payout?.toFixed(2)} ETB</span>
        </button>
      );
    }
    if (status === 'cashout' || status === 'placed') {
      return (
        <button className="bet-btn state-cashout" onClick={onCashOut} disabled={submitting}>
          <span className="bet-btn-top">Cash Out</span>
          <span className="bet-btn-sub">{amount?.toFixed(2)} ETB</span>
        </button>
      );
    }
  }

  if (status === 'lost') {
    return (
      <button className="bet-btn state-lost" disabled>
        <span className="bet-btn-top">Lost</span>
        <span className="bet-btn-sub">{amount?.toFixed(2)} ETB</span>
      </button>
    );
  }

  return (
    <button className="bet-btn state-idle" disabled>
      <span className="bet-btn-top">Bet</span>
      <span className="bet-btn-sub">
        {amount?.toFixed(2)}
        <span className="cur-tag">ETB</span>
      </span>
    </button>
  );
}
