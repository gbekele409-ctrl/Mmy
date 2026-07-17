import React, { useState, useEffect, useCallback } from 'react';
import { requestDeposit, requestWithdraw, getMyTransactions, getBalance } from '../api.js';
import { useAuth } from '../App.jsx';

const OPERATOR_PHONE = '0992000962';
const OPERATOR_NAME = 'Gutu';

export default function Wallet() {
  const { user, updateBalance } = useAuth();
  const [tab, setTab] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [telebirrValue, setTelebirrValue] = useState(''); // reference (deposit) or phone (withdraw)
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const res = await getMyTransactions();
      setTransactions(res.data.transactions);
    } catch (err) {
      // Non-fatal - just leave the list empty with an inline note.
    } finally {
      setLoadingTx(false);
    }
  }, []);

  // Pulls the latest balance straight from the database (via the dedicated
  // /wallet/balance endpoint) and pushes it into the shared auth context, so
  // the balance shown here (and anywhere else that reads `user.balance`)
  // stays in sync instead of relying on the stale copy cached in
  // localStorage at login.
  const refreshBalance = useCallback(async () => {
    setRefreshingBalance(true);
    try {
      const res = await getBalance();
      const freshBalance = res.data.balance !== undefined ? res.data.balance : res.data;
      updateBalance(freshBalance);
    } catch (err) {
      // Non-fatal - keep showing the last known balance.
    } finally {
      setRefreshingBalance(false);
    }
  }, [updateBalance]);

  useEffect(() => {
    loadTransactions();
    refreshBalance();
  }, [loadTransactions, refreshBalance]);

  const handleCopy = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1800);
    } catch (err) {
      // Clipboard API unavailable/blocked - fail silently, button stays as-is.
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount greater than 0');
      return;
    }

    if (!telebirrValue.trim()) {
      setError(
        tab === 'deposit'
          ? 'Enter the Telebirr transaction reference for your payment'
          : 'Enter the Telebirr phone number to receive your withdrawal'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (tab === 'deposit') {
        await requestDeposit(numericAmount, telebirrValue.trim(), note);
        setMessage('Deposit request submitted. An admin will verify your Telebirr payment shortly.');
      } else {
        await requestWithdraw(numericAmount, telebirrValue.trim(), note);
        setMessage('Withdrawal request submitted. An admin will send the funds via Telebirr shortly.');
      }
      setAmount('');
      setTelebirrValue('');
      setNote('');
      loadTransactions();
      refreshBalance();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Wallet</h3>
      <div className="stat-row">
        <span>Current balance</span>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Number(user?.balance || 0).toFixed(2)} ETB
          {refreshingBalance && (
            <span style={{ fontSize: 11, fontWeight: 400, color: '#9aa0b4' }}>syncing…</span>
          )}
        </strong>
      </div>

      <div className="tabs" style={{ marginTop: 16 }}>
        <div
          className={`tab ${tab === 'deposit' ? 'active' : ''}`}
          onClick={() => {
            setTab('deposit');
            setTelebirrValue('');
            setError(null);
            setMessage(null);
          }}
        >
          Deposit
        </div>
        <div
          className={`tab ${tab === 'withdraw' ? 'active' : ''}`}
          onClick={() => {
            setTab('withdraw');
            setTelebirrValue('');
            setError(null);
            setMessage(null);
          }}
        >
          Withdraw
        </div>
      </div>

      {tab === 'deposit' && (
        <div
          style={{
            marginTop: 12,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(124,92,255,0.14), rgba(124,92,255,0.05))',
            border: '1px solid rgba(124,92,255,0.35)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#9aa0b4', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Telebirr Operator
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{OPERATOR_NAME}</div>
              <div style={{ fontSize: 15, fontFamily: 'monospace', letterSpacing: 0.5, marginTop: 4 }}>
                {OPERATOR_PHONE}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(OPERATOR_PHONE, 'operator')}
              className="btn"
              style={{
                flexShrink: 0,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: '1px solid rgba(124,92,255,0.5)',
                background: copiedField === 'operator' ? 'rgba(76,217,123,0.15)' : 'rgba(124,92,255,0.12)',
                color: copiedField === 'operator' ? '#4cd97b' : '#7c5cff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {copiedField === 'operator' ? '✓ Copied' : 'Copy number'}
            </button>
          </div>
          <p style={{ fontSize: 13, color: '#9aa0b4', margin: '10px 0 0' }}>
            Send payment via Telebirr to the operator's number above first, then submit the amount
            and the Telebirr transaction reference below for admin verification.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
        <input
          className="input"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Amount (Birr)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            type="text"
            placeholder={tab === 'deposit' ? 'Telebirr transaction reference (required)' : 'Telebirr phone number to receive funds (required)'}
            value={telebirrValue}
            onChange={(e) => setTelebirrValue(e.target.value)}
            style={tab === 'withdraw' ? { paddingRight: 84 } : undefined}
          />
          {tab === 'withdraw' && telebirrValue.trim() && (
            <button
              type="button"
              onClick={() => handleCopy(telebirrValue.trim(), 'withdrawPhone')}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid rgba(124,92,255,0.4)',
                background: copiedField === 'withdrawPhone' ? 'rgba(76,217,123,0.15)' : 'rgba(124,92,255,0.1)',
                color: copiedField === 'withdrawPhone' ? '#4cd97b' : '#7c5cff',
                cursor: 'pointer',
              }}
            >
              {copiedField === 'withdrawPhone' ? '✓' : 'Copy'}
            </button>
          )}
        </div>
        <input
          className="input"
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <div className="error-text">{error}</div>}
        {message && <div className="success-text">{message}</div>}
        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Submitting...' : tab === 'deposit' ? 'Request Deposit' : 'Request Withdrawal'}
        </button>
      </form>

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Transaction history</h4>
      {loadingTx ? (
        <p style={{ color: '#9aa0b4' }}>Loading...</p>
      ) : transactions.length === 0 ? (
        <p style={{ color: '#9aa0b4' }}>No transactions yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Telebirr</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
                  <td>{t.amount.toFixed(2)} ETB</td>
                  <td>
                    <span className={`badge badge-${t.status}`}>{t.status}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {t.type === 'deposit' && t.telebirr_reference_submitted && (
                      <div>Ref: {t.telebirr_reference_submitted}</div>
                    )}
                    {t.type === 'withdraw' && t.telebirr_phone && <div>To: {t.telebirr_phone}</div>}
                    {t.telebirr_reference_admin && <div style={{ color: '#9aa0b4' }}>Sent ref: {t.telebirr_reference_admin}</div>}
                  </td>
                  <td>{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
