import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Profile</h2>

        <div className="stat-row">
          <span>Username</span>
          <strong>{user?.username}</strong>
        </div>
        {user?.telegram_first_name && (
          <div className="stat-row">
            <span>Name</span>
            <strong>{user.telegram_first_name}</strong>
          </div>
        )}
        {user?.telegram_phone && (
          <div className="stat-row">
            <span>Phone</span>
            <strong>{user.telegram_phone}</strong>
          </div>
        )}
        <div className="stat-row">
          <span>Balance</span>
          <strong>{Number(user?.balance || 0).toFixed(2)} ETB</strong>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => navigate('/referral')}
          style={{ marginTop: 16, width: '100%' }}
        >
          Invite Friends & Earn
        </button>

        {user?.role === 'admin' && (
          <button
            className="btn btn-outline"
            onClick={() => navigate('/admin')}
            style={{ marginTop: 10, width: '100%' }}
          >
            Switch to Admin Panel
          </button>
        )}

        <button className="btn btn-outline" onClick={handleLogout} style={{ marginTop: 10, width: '100%' }}>
          Log out
        </button>
      </div>
    </div>
  );
}
