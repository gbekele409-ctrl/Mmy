import React, { useState, useEffect, useCallback, useRef } from 'react';
import { requestDeposit, requestWithdraw, getMyTransactions, getBalance } from '../api.js';
import { useAuth } from '../App.jsx';

// Operator payment details shown to users on the deposit tab. Update these
// if the account details ever change - they're plain constants, not
// something that needs a database round-trip.
const OPERATOR_ACCOUNTS = [
  { label: 'Telebirr', number: '0992000962', name: 'Gutu' },
  { label: 'CBE Birr', number: '0992000962', name: 'Gutu' },
];

function CopyableAccountRow({ label, number, name }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some in-app webviews (e.g. certain
      // Telegram Mini App contexts) - fall back to a manual select prompt
      // rather than leaving the button silently broken.
      window.prompt('Copy this number:', number);
    }
  };

  return (
    <div className="operator-account-row">
      <div className="operator-account-info">
        <span className="operator-account-label">{label}</span>
        <span className="operator-account-number">{number}</span>
        <span className="operator-account-name">{name}</span>
      </div>
      <button type="button" className="btn btn-outline operator-copy-btn" onClick={handleCopy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

export default function Wallet() {
  const { user, updateBalance } = useAuth();
  const [tab, setTab] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [telebirrValue, setTelebirrValue] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);

  const [displayBalance, setDisplayBalance] = useState(user?.balance ?? 0);
  const [balanceUpdating, setBalanceUpdating] = useState(false);
  const balanceRef = useRef(displayBalance);

  const refreshBalance = useCallback(async () => {
    try {
      const res = await getBalance();
      const fresh = res.data.balance;
      if (fresh !== balanceRef.current) {
        setBalanceUpdating(true);
        setDisplayBalance(fresh);
        balanceRef.current = fresh;
        updateBalance(fresh);
        setTimeout(() => setBalanceUpdating(false), 350);
      }
    } catch {
      // Non-fatal - keep showing the last known value.
    }
  }, [updateBalance]);

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const res = await getMyTransactions();
      setTransactions(res.data.transactions);
    } catch {
      // Non-fatal.
    } finally {
      setLoadingTx(false);
    }
  }, []);

  useEffect(() => {
    refreshBalance();
    loadTransactions();
    const interval = setInterval(refreshBalance, 10000);
    return () => clearInterval(interval);
  }, [refreshBalance, loadTransactions]);

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
          ? 'Enter the transaction reference from your payment'
          : 'Enter the Telebirr phone number to receive your withdrawal'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (tab === 'deposit') {
        await requestDeposit(numericAmount, telebirrValue.trim(), note);
        setMessage('Deposit request submitted. An admin will verify your payment shortly.');
      } else {
        await requestWithdraw(numericAmount, telebirrValue.trim(), note);
        setMessage('Withdrawal request submitted. An admin will send the funds shortly.');
      }
      setAmount('');
      setTelebirrValue('');
      setNote('');
      loadTransactions();
      refreshBalance();
    } catch (err) {
      // The backend rejects a reference that's already been used for a
      // pending/approved deposit (see wallet.js's duplicate check) - this
      // surfaces that specific error clearly rather than a generic one.
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
        <strong className={balanceUpdating ? 'balance-pulse' : ''}>
          {Number(displayBalance || 0).toFixed(2)} ETB
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
        <>
          <div className="operator-accounts-block">
            <p className="operator-accounts-title">Send payment to one of these accounts:</p>
            {OPERATOR_ACCOUNTS.map((acc) => (
              <CopyableAccountRow key={acc.label} {...acc} />
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#9aa0b4', marginTop: 10 }}>
            After sending payment, submit the amount and the transaction reference below. An
            admin will verify it against the account before approving.
          </p>
          <p style={{ fontSize: 12, color: '#f7b955', marginTop: 4 }}>
            Each transaction reference can only be used once - submitting the same reference
            twice will be rejected.
          </p>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <input
          className="input"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Amount (Birr)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="input"
          type="text"
          placeholder={tab === 'deposit' ? 'Transaction reference (required)' : 'Telebirr phone number to receive funds (required)'}
          value={telebirrValue}
          onChange={(e) => setTelebirrValue(e.target.value)}
        />
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
                <th>Reference</th>
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
