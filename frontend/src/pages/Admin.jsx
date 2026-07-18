import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import {
  getAllUsers,
  setUserActive,
  getPendingTransactions,
  getAllTransactions,
  approveTransaction,
  rejectTransaction,
  getStatsOverview,
  getStatsUsers,
  setGameLogo,
  getGameLogo,
} from '../api.js';

function useAsyncList(fetcher, deps) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

function StatCard({ label, value, accent }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data, loading, error, reload } = useAsyncList(() => getStatsOverview(), []);
  const [logoUrl, setLogoUrl] = useState('');
  const [currentLogo, setCurrentLogo] = useState(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoMessage, setLogoMessage] = useState(null);

  useEffect(() => {
    getGameLogo()
      .then((res) => setCurrentLogo(res.data.url))
      .catch(() => {});
  }, []);

  const handleSaveLogo = async (e) => {
    e.preventDefault();
    setLogoMessage(null);
    if (!logoUrl.trim()) return;
    setLogoSaving(true);
    try {
      await setGameLogo(logoUrl.trim());
      setCurrentLogo(logoUrl.trim());
      setLogoUrl('');
      setLogoMessage('Game logo updated.');
    } catch (err) {
      setLogoMessage(err.response?.data?.error || 'Could not update logo');
    } finally {
      setLogoSaving(false);
    }
  };

  if (loading) return <p style={{ color: '#9aa0b4' }}>Loading overview...</p>;
  if (error) return <div className="error-text">{error}</div>;

  return (
    <div>
      <div className="admin-stats-grid">
        <StatCard label="Total Users" value={data.totalUsers ?? 0} />
        <StatCard label="Total Deposited" value={`${(data.totalDeposited ?? 0).toFixed(2)} ETB`} accent="#4ade80" />
        <StatCard label="Total Withdrawn" value={`${(data.totalWithdrawn ?? 0).toFixed(2)} ETB`} accent="#f87171" />
        <StatCard label="Total User Winnings" value={`${(data.totalUserWinnings ?? 0).toFixed(2)} ETB`} accent="#fbbf24" />
        <StatCard
          label="Platform Result"
          value={`${(data.platformResult ?? 0) >= 0 ? '+' : ''}${(data.platformResult ?? 0).toFixed(2)} ETB`}
          accent={(data.platformResult ?? 0) >= 0 ? '#4ade80' : '#f87171'}
        />
      </div>
      <button className="btn btn-outline" onClick={reload} style={{ marginTop: 12 }}>
        Refresh
      </button>

      <div className="card" style={{ marginTop: 20 }}>
        <h4 style={{ marginTop: 0 }}>Game Logo</h4>
        <p style={{ fontSize: 13, color: '#9aa0b4' }}>
          Set the image URL shown as the Aviator game logo. Upload your image to any image host
          (Supabase Storage, Cloudinary, imgur, etc.) first, then paste the resulting URL here.
        </p>
        {currentLogo && (
          <div style={{ marginBottom: 12 }}>
            <img src={currentLogo} alt="Current game logo" style={{ maxHeight: 60, borderRadius: 6 }} />
          </div>
        )}
        <form onSubmit={handleSaveLogo} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="url"
            placeholder="https://example.com/logo.png"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
          />
          <button className="btn btn-primary" type="submit" disabled={logoSaving}>
            {logoSaving ? 'Saving...' : 'Save Logo'}
          </button>
        </form>
        {logoMessage && <p style={{ fontSize: 13, marginTop: 8, color: '#9aa0b4' }}>{logoMessage}</p>}
      </div>
    </div>
  );
}

function UsersTab() {
  const { data, loading, error, reload } = useAsyncList(() => getStatsUsers(), []);

  const toggleActive = async (user) => {
    try {
      await setUserActive(user.id, !user.isActive);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user');
    }
  };

  if (loading) return <p style={{ color: '#9aa0b4' }}>Loading users...</p>;
  if (error) return <div className="error-text">{error}</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Balance</th>
            <th>Total Won</th>
            <th>Status</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(data.users || []).map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.telegram_first_name || '—'}</td>
              <td>{u.balance.toFixed(2)} ETB</td>
              <td style={{ color: '#4ade80' }}>{u.totalWon.toFixed(2)} ETB</td>
              <td>
                <span className={`badge ${u.isActive ? 'badge-approved' : 'badge-rejected'}`}>
                  {u.isActive ? 'active' : 'banned'}
                </span>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td>
                <button className="btn btn-outline" onClick={() => toggleActive(u)}>
                  {u.isActive ? 'Ban' : 'Unban'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingTab() {
  const { data, loading, error, reload } = useAsyncList(() => getPendingTransactions(), []);
  const [busyId, setBusyId] = useState(null);

  const handleApprove = async (tx) => {
    const isDeposit = tx.type === 'deposit';
    const promptText = isDeposit
      ? `Confirm the Telebirr reference you verified in the business account for this deposit:\n(User submitted: ${tx.telebirr_reference_submitted || 'none'})`
      : `Enter the Telebirr reference for the transfer you just sent to ${tx.telebirr_phone || 'the user'}:`;

    const reference = window.prompt(promptText, isDeposit ? tx.telebirr_reference_submitted || '' : '');
    if (reference === null) return;
    if (!reference.trim()) {
      alert('A Telebirr reference is required to approve this transaction.');
      return;
    }

    setBusyId(tx.id);
    try {
      await approveTransaction(tx.id, reference.trim());
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id) => {
    const reason = window.prompt('Reason for rejection (optional):') || '';
    setBusyId(id);
    try {
      await rejectTransaction(id, reason);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p style={{ color: '#9aa0b4' }}>Loading pending requests...</p>;
  if (error) return <div className="error-text">{error}</div>;

  const items = data.transactions || [];

  if (items.length === 0) return <p style={{ color: '#9aa0b4' }}>No pending requests. 🎉</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ fontSize: 13, color: '#fbbf24', marginBottom: 12 }}>
        Deposits: verify the Telebirr reference against the real Telebirr business account before
        approving. Withdrawals: send the money via Telebirr <strong>first</strong>, then approve using
        the reference from that transfer as proof.
      </p>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Telebirr</th>
            <th>Note</th>
            <th>Requested</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.user ? `${t.user.username} (${t.user.email})` : 'Unknown'}</td>
              <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
              <td>{t.amount.toFixed(2)} ETB</td>
              <td style={{ fontSize: 13 }}>
                {t.type === 'deposit'
                  ? `Ref: ${t.telebirr_reference_submitted || '—'}`
                  : `To: ${t.telebirr_phone || '—'}`}
              </td>
              <td>{t.note || '—'}</td>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-success"
                  disabled={busyId === t.id}
                  onClick={() => handleApprove(t)}
                >
                  Approve
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busyId === t.id}
                  onClick={() => handleReject(t.id)}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab() {
  const { data, loading, error } = useAsyncList(() => getAllTransactions(), []);

  if (loading) return <p style={{ color: '#9aa0b4' }}>Loading history...</p>;
  if (error) return <div className="error-text">{error}</div>;

  const items = data.transactions || [];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Telebirr ref (sent/verified)</th>
            <th>Handled by</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.user ? t.user.username : 'Unknown'}</td>
              <td style={{ textTransform: 'capitalize' }}>{t.type}</td>
              <td>{t.amount.toFixed(2)} ETB</td>
              <td>
                <span className={`badge badge-${t.status}`}>{t.status}</span>
              </td>
              <td style={{ fontSize: 12 }}>{t.telebirr_reference_admin || '—'}</td>
              <td>{t.approved_by || '—'}</td>
              <td>{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const navigate = useNavigate();

  return (
    <div>
      <Navbar />
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>Admin Panel</h2>
          <button className="btn btn-outline" onClick={() => navigate('/dashboard')}>
            ← Back to User View
          </button>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tabs">
            <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
              Overview
            </div>
            <div className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
              Pending Requests
            </div>
            <div className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
              Users
            </div>
            <div className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
              Transaction History
            </div>
          </div>

          {tab === 'overview' && <OverviewTab />}
          {tab === 'pending' && <PendingTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'history' && <HistoryTab />}
        </div>
      </div>
    </div>
  );
}
