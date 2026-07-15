import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0.0);
  const [referralBalance, setReferralBalance] = useState(0.0);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('wallet');

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/user/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
        setBalance(data.balance || 0.0);
        setReferralBalance(data.referralBalance || 0.0);
      } else if (response.status === 401) {
        navigate('/login');
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyReferral = () => {
    const referralLink = `https://t.me/sora_gamesbot?startapp=ref_${userInfo?.referralCode || 'C47432F'}`;
    navigator.clipboard.writeText(referralLink);
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loader"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <Navbar />
      
      {/* Navigation Tabs */}
      <div className="dashboard-header">
        <div className="dashboard-tabs">
          <button 
            className={`tab-btn ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallet')}
          >
            <span className="tab-icon">💰</span>
            Wallet
          </button>
          <button 
            className={`tab-btn ${activeTab === 'games' ? 'active' : ''}`}
            onClick={() => setActiveTab('games')}
          >
            <span className="tab-icon">🎮</span>
            Games
          </button>
          <button 
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <span className="tab-icon">👤</span>
            Profile
          </button>
        </div>
      </div>

      <div className="dashboard-container">
        {/* Wallet Tab */}
        {activeTab === 'wallet' && (
          <div className="tab-content wallet-content">
            {/* Profile Card */}
            <div className="profile-card">
              <div className="profile-header">
                <div className="profile-avatar">
                  {userInfo?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="profile-info">
                  <h2>{userInfo?.username || 'User'}</h2>
                  <p>{userInfo?.email || 'user@example.com'}</p>
                </div>
              </div>
            </div>

            {/* Balance Cards */}
            <div className="balance-grid">
              <div className="balance-card primary">
                <div className="balance-label">Available Balance</div>
                <div className="balance-amount">{balance.toFixed(2)}</div>
                <div className="balance-currency">ETB</div>
              </div>

              <div className="balance-card secondary">
                <div className="balance-label">Referral Earnings</div>
                <div className="balance-amount">{referralBalance.toFixed(2)}</div>
                <div className="balance-currency">ETB</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="action-buttons">
              <button className="btn btn-primary">Deposit Funds</button>
              <button className="btn btn-secondary">Withdraw</button>
            </div>

            {/* Referral Section */}
            <div className="referral-section">
              <h3>Referral Program</h3>
              <div className="referral-code">
                <input 
                  type="text" 
                  readOnly 
                  value={`https://t.me/sora_gamesbot?startapp=ref_${userInfo?.referralCode || 'C47432F'}`}
                  className="referral-input"
                />
                <button className="btn-copy" onClick={handleCopyReferral}>Copy</button>
              </div>
              <div className="referral-stats">
                <div className="stat-item">
                  <div className="stat-label">Referrals</div>
                  <div className="stat-value">0</div>
                </div>
                <div className="stat-item">
                  <div className="stat-label">Commission</div>
                  <div className="stat-value">{referralBalance.toFixed(2)} ETB</div>
                </div>
              </div>
              <button className="btn btn-referral">Share & Earn</button>
            </div>
          </div>
        )}

        {/* Games Tab */}
        {activeTab === 'games' && (
          <div className="tab-content games-content">
            <div className="games-grid">
              <div 
                className="game-card aviator-card"
                onClick={() => navigate('/dashboard/aviator')}
              >
                <div className="game-badge">Live</div>
                <div className="game-content">
                  <h3>Aviator</h3>
                  <p>Experience the thrill of the skies. Predict and cash out before the plane crashes.</p>
                  <div className="game-action">
                    Play Now
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="tab-content profile-content">
            <div className="profile-details">
              <div className="profile-section">
                <h3>Account Information</h3>
                <div className="info-item">
                  <label>Username</label>
                  <p>{userInfo?.username || 'N/A'}</p>
                </div>
                <div className="info-item">
                  <label>Email</label>
                  <p>{userInfo?.email || 'N/A'}</p>
                </div>
                <div className="info-item">
                  <label>Phone</label>
                  <p>{userInfo?.phone || 'N/A'}</p>
                </div>
              </div>

              <div className="profile-section">
                <h3>Account Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-title">Total Bets</div>
                    <div className="stat-number">0</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-title">Total Wins</div>
                    <div className="stat-number">0</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-title">Total Earnings</div>
                    <div className="stat-number">{(balance + referralBalance).toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="profile-section">
                <h3>Security</h3>
                <button className="btn btn-secondary" style={{ width: '100%' }}>
                  Change Password
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
