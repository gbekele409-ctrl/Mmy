import React, { useState, useEffect, useCallback } from 'react';
import { requestDeposit, requestWithdraw, getMyTransactions } from '../api.js';
import { useAuth } from '../App.jsx';

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

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

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
        <strong>${Number(user?.balance || 0).toFixed(2)}</strong>
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
        <p style={{ fontSize: 13, color: '#9aa0b4', marginTop: 8 }}>
          <li>operator telebirr: 0992000962</li>
              li>operator telebirr name: Gutu</li>
          Send payment via Telebirr to the operator's Telebirr account first, then submit the
          amount and the Telebirr transaction reference below for admin verification.
        </p>
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
          placeholder={tab === 'deposit' ? 'Telebirr transaction reference (required)' : 'Telebirr phone number to receive funds (required)'}
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
                <th>Telebirr</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
                  <td>${t.amount.toFixed(2)}</td>
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
