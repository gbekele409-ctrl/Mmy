import React, { useState, useEffect, useCallback, useRef } from 'react';
import { requestDeposit, requestWithdraw, getMyTransactions, getBalance } from '../api.js';
import { useAuth } from '../App.jsx';

const MIN_DEPOSIT = 50;
const MIN_WITHDRAW = 200;

const AGENT = {
  name: 'Gutu',
  accounts: [
    { label: 'Telebirr', number: '0992000962' },
    { label: 'CBE Birr', number: '0992000962' },
  ],
};

function CopyableNumber({ label, number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this number:', number);
    }
  };

  return (
    <div className="operator-account-row">
      <div className="operator-account-info">
        <span className="operator-account-label">{label}</span>
        <span className="operator-account-number">{number}</span>
        <span className="operator-account-name">{AGENT.name}</span>
      </div>
      <button type="button" className="btn btn-outline operator-copy-btn" onClick={handleCopy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

// Multi-step deposit flow: 1) enter amount  2) view agent payment details
// 3) submit the transaction reference for admin verification.
function DepositWizard({ onSubmitted }) {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const goToAgentStep = (e) => {
    e.preventDefault();
    setError(null);
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (numericAmount < MIN_DEPOSIT) {
      setError(`Minimum deposit is ${MIN_DEPOSIT} ETB`);
      return;
    }
    setStep(2);
  };

  const goToReferenceStep = () => setStep(3);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!reference.trim()) {
      setError('Enter the transaction reference for your payment');
      return;
    }
    setSubmitting(true);
    try {
      await requestDeposit(parseFloat(amount), reference.trim(), note);
      setStep(1);
      setAmount('');
      setReference('');
      setNote('');
      onSubmitted('Deposit request submitted. An admin will verify your payment shortly.');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="wizard-steps">
        <div className={`wizard-step-dot ${step >= 1 ? 'active' : ''}`}>1</div>
        <div className={`wizard-step-line ${step >= 2 ? 'active' : ''}`} />
        <div className={`wizard-step-dot ${step >= 2 ? 'active' : ''}`}>2</div>
        <div className={`wizard-step-line ${step >= 3 ? 'active' : ''}`} />
        <div className={`wizard-step-dot ${step >= 3 ? 'active' : ''}`}>3</div>
      </div>

      {step === 1 && (
        <form onSubmit={goToAgentStep}>
          <p style={{ fontSize: 13, color: '#9aa0b4' }}>Step 1 of 3 — Enter the amount you want to deposit.</p>
          <input
            className="input"
            type="number"
            step="0.01"
            min={MIN_DEPOSIT}
            placeholder={`Amount (min ${MIN_DEPOSIT} ETB)`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
        <div>
          <p style={{ fontSize: 13, color: '#9aa0b4' }}>
            Step 2 of 3 — Send <strong>{parseFloat(amount).toFixed(2)} ETB</strong> to one of these
            accounts.
          </p>
          <div className="operator-accounts-block">
            {AGENT.accounts.map((acc) => (
              <CopyableNumber key={acc.label} label={acc.label} number={acc.number} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)} style={{ flex: 1 }}>
              Back
            </button>
            <button className="btn btn-primary" onClick={goToReferenceStep} style={{ flex: 1 }}>
              I've Sent the Payment
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <form onSubmit={handleSubmit}>
          <p style={{ fontSize: 13, color: '#9aa0b4' }}>
            Step 3 of 3 — Enter the transaction reference from your payment.
          </p>
          <input
            className="input"
            type="text"
            placeholder="Transaction reference (required)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p style={{ fontSize: 12, color: '#f7b955' }}>
            Each transaction reference can only be used once.
          </p>
          {error && <div className="error-text">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setStep(2)} style={{ flex: 1 }} disabled={submitting}>
              Back
            </button>
            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ flex: 1 }}>
              {submitting ? 'Submitting...' : 'Submit Deposit'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function WithdrawForm({ onSubmitted }) {
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (numericAmount < MIN_WITHDRAW) {
      setError(`Minimum withdrawal is ${MIN_WITHDRAW} ETB`);
      return;
    }
    if (!phone.trim()) {
      setError('Enter the Telebirr phone number to receive your withdrawal');
      return;
    }

    setSubmitting(true);
    try {
      await requestWithdraw(numericAmount, phone.trim(), note);
      setAmount('');
      setPhone('');
      setNote('');
      onSubmitted('Withdrawal request submitted. An admin will send the funds shortly.');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        className="input"
        type="number"
        step="0.01"
        min={MIN_WITHDRAW}
        placeholder={`Amount (min ${MIN_WITHDRAW} ETB)`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        className="input"
        type="text"
        placeholder="Telebirr phone number to receive funds (required)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        className="input"
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Submitting...' : 'Request Withdrawal'}
      </button>
    </form>
  );
}

export default function Wallet() {
  const { user, updateBalance } = useAuth();
  const [tab, setTab] = useState('deposit');
  const [message, setMessage] = useState(null);
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

  const handleSubmitted = (successMessage) => {
    setMessage(successMessage);
    loadTransactions();
    refreshBalance();
  };

  const switchTab = (next) => {
    setTab(next);
    setMessage(null);
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
        <div className={`tab ${tab === 'deposit' ? 'active' : ''}`} onClick={() => switchTab('deposit')}>
          Deposit
        </div>
        <div className={`tab ${tab === 'withdraw' ? 'active' : ''}`} onClick={() => switchTab('withdraw')}>
          Withdraw
        </div>
      </div>

      {message && <div className="success-text" style={{ marginTop: 8 }}>{message}</div>}

      <div style={{ marginTop: 12 }}>
        {tab === 'deposit' ? (
          <DepositWizard onSubmitted={handleSubmitted} />
        ) : (
          <WithdrawForm onSubmitted={handleSubmitted} />
        )}
      </div>

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
