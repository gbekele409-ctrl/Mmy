import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import {
  getAllUsers,
  setUserActive,
  adjustUserBalance,
  getPendingTransactions,
  getAllTransactions,
  approveTransaction,
  rejectTransaction,
  getStatsOverview,
  getStatsUsers,
  setGameLogo,
  getGameLogo,
  sendBroadcast,
  getBroadcastHistory,
  uploadBroadcastImage,
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
          Set the image URL shown as the Buna Games logo. Upload your image to any image host
          first, then paste the resulting URL here.
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

function BalanceEditForm({ user, onDone, onCancel }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount === 0) {
      setError('Enter a non-zero amount (negative to deduct)');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }
    setSaving(true);
    try {
      await adjustUserBalance(user.id, numericAmount, reason.trim());
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <input
        className="input"
        type="number"
        step="0.01"
        placeholder="+50 or -50"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ width: 110, marginBottom: 0 }}
        autoFocus
      />
      <input
        className="input"
        type="text"
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: 160, marginBottom: 0 }}
      />
      <button className="btn btn-success" type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button className="btn btn-outline" type="button" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      {error && <div className="error-text" style={{ width: '100%' }}>{error}</div>}
    </form>
  );
}

function UsersTab() {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { data, loading, error, reload } = useAsyncList(() => getStatsUsers(1, search), [search]);
  const [editingId, setEditingId] = useState(null);

  const toggleActive = async (user) => {
    try {
      await setUserActive(user.id, !user.isActive);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user');
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  if (loading) return <p style={{ color: '#9aa0b4' }}>Loading users...</p>;
  if (error) return <div className="error-text">{error}</div>;

  return (
    <div>
      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          className="input"
          type="text"
          placeholder="Search by username or name"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
        />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
        {search && (
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
            }}
          >
            Clear
          </button>
        )}
      </form>

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
            {(data.users || []).length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: '#9aa0b4', textAlign: 'center' }}>
                  No users found.
                </td>
              </tr>
            ) : (
              data.users.map((u) => (
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
                  <td style={{ minWidth: editingId === u.id ? 320 : undefined }}>
                    {editingId === u.id ? (
                      <BalanceEditForm
                        user={u}
                        onDone={() => {
                          setEditingId(null);
                          reload();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-outline" onClick={() => toggleActive(u)}>
                          {u.isActive ? 'Ban' : 'Unban'}
                        </button>
                        <button className="btn btn-outline" onClick={() => setEditingId(u.id)}>
                          Edit Balance
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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

  if (items.length === 0) return <p style={{ color: '#9aa0b4' }}>No pending requests.</p>;

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

function BroadcastTab() {
  const { data, loading, error, reload } = useAsyncList(() => getBroadcastHistory(), []);
  const [message, setMessage] = useState('');
  const [buttonText, setButtonText] = useState('Play Buna Games');
  const [buttonUrl, setButtonUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setResult({ error: 'Image must be under 5MB' });
      return;
    }

    setImageFile(file);
    setUploadedImageUrl(null);
    setResult(null);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrl(null);
  };

  const handleSend = async () => {
    setResult(null);
    if (!message.trim()) {
      setResult({ error: 'Enter a message to send' });
      return;
    }

    setSending(true);
    try {
      let imageUrl = uploadedImageUrl;

      if (imageFile && !imageUrl) {
        setUploading(true);
        const uploadRes = await uploadBroadcastImage(imageFile);
        imageUrl = uploadRes.data.url;
        setUploadedImageUrl(imageUrl);
        setUploading(false);
      }

      const res = await sendBroadcast(message.trim(), buttonText.trim() || null, buttonUrl.trim() || null, imageUrl);
      setResult({
        success: `Broadcast started - sending to ${res.data.totalRecipients} users. Check history below shortly for results.`,
      });
      setMessage('');
      removeImage();
      setConfirmOpen(false);
      setTimeout(reload, 3000);
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Failed to send broadcast' });
      setUploading(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Compose Broadcast</h4>
        <p style={{ fontSize: 13, color: '#9aa0b4' }}>
          This sends a message to every active user who has started the bot. This cannot be
          undone once sent - double-check before confirming.
        </p>

        <textarea
          className="input"
          rows={4}
          placeholder={imagePreview ? 'Caption for the image...' : 'Message text...'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div style={{ marginBottom: 12 }}>
          {imagePreview ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imagePreview}
                alt="Broadcast preview"
                style={{ maxHeight: 160, borderRadius: 8, display: 'block' }}
              />
              <button
                type="button"
                onClick={removeImage}
                className="btn btn-danger"
                style={{ position: 'absolute', top: 6, right: 6, padding: '2px 8px', fontSize: 12 }}
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="btn btn-outline" style={{ display: 'inline-block', cursor: 'pointer' }}>
              Attach Image (optional)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="text"
            placeholder="Button text (optional)"
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
            style={{ flex: 1, minWidth: 150 }}
          />
          <input
            className="input"
            type="url"
            placeholder="Button link / Mini App URL (optional)"
            value={buttonUrl}
            onChange={(e) => setButtonUrl(e.target.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
        </div>

        {result?.error && <div className="error-text">{result.error}</div>}
        {result?.success && <div className="success-text">{result.success}</div>}

        {!confirmOpen ? (
          <button
            className="btn btn-primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!message.trim()}
            style={{ width: '100%' }}
          >
            Review & Send
          </button>
        ) : (
          <div style={{ background: '#1a1d29', border: '1px solid #3a3f52', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <p style={{ fontSize: 13, color: '#fbbf24', marginTop: 0 }}>
              Send this {imagePreview ? 'image + message' : 'message'} to ALL active users now? This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-success" onClick={handleSend} disabled={sending} style={{ flex: 1 }}>
                {uploading ? 'Uploading image...' : sending ? 'Sending...' : 'Confirm & Send'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmOpen(false)} disabled={sending} style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <h4>Recent Broadcasts</h4>
      {loading ? (
        <p style={{ color: '#9aa0b4' }}>Loading...</p>
      ) : error ? (
        <div className="error-text">{error}</div>
      ) : (data.broadcasts || []).length === 0 ? (
        <p style={{ color: '#9aa0b4' }}>No broadcasts sent yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Message</th>
                <th>Recipients</th>
                <th>Sent / Failed</th>
                <th>By</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.imageUrl && (
                      <img src={b.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                    )}
                  </td>
                  <td style={{ maxWidth: 240, whiteSpace: 'normal' }}>{b.message}</td>
                  <td>{b.totalRecipients}</td>
                  <td>
                    <span style={{ color: '#4ade80' }}>{b.successfulSends}</span>
                    {' / '}
                    <span style={{ color: b.failedSends > 0 ? '#f87171' : '#7a7a85' }}>{b.failedSends}</span>
                  </td>
                  <td>{b.sentBy || '—'}</td>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
            <div className={`tab ${tab === 'broadcast' ? 'active' : ''}`} onClick={() => setTab('broadcast')}>
              Broadcast
            </div>
          </div>

          {tab === 'overview' && <OverviewTab />}
          {tab === 'pending' && <PendingTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'broadcast' && <BroadcastTab />}
        </div>
      </div>
    </div>
  );
}
