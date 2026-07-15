import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';

export default function Dashboard() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0.0);
  const [referralBalance, setReferralBalance] = useState(0.0);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#0a0d12', minHeight: '100vh', color: '#fff' }}>
      <Navbar />
      <div style={{ padding: '20px', maxWidth: '100%' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '30px',
          paddingTop: '10px'
        }}>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            background: 'linear-gradient(90deg, #ffb930 0%, #00d4ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: 0
          }}>
            Your Wallet
          </h1>
          <div style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center'
          }}>
            <button style={{
              backgroundColor: '#ffb930',
              color: '#000',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '12px'
            }}>
              አማ
            </button>
            <button style={{
              backgroundColor: 'transparent',
              color: '#999',
              border: '1px solid #444',
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '12px'
            }}>
              EN
            </button>
          </div>
        </div>

        {/* Main Wallet Card */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(255, 185, 48, 0.1) 100%)',
          border: '1px solid rgba(255, 185, 48, 0.3)',
          borderRadius: '20px',
          padding: '25px',
          marginBottom: '20px',
          backdropFilter: 'blur(10px)'
        }}>
          {/* User Profile Section */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '20px',
            paddingBottom: '20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: '#00d4ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#000',
              marginRight: '15px'
            }}>
              {userInfo?.username?.charAt(0).toUpperCase() || 'G'}
            </div>
            <div>
              <h3 style={{
                margin: '0 0 5px 0',
                fontSize: '18px',
                fontWeight: 'bold'
              }}>
                {userInfo?.username || 'Gutu'}
              </h3>
              <p style={{
                margin: 0,
                fontSize: '12px',
                color: '#999'
              }}>
                {userInfo?.phone || 'የተለያዩ ተመዝጋቢ'} • +251 {userInfo?.phone?.slice(-9) || '9085559033'}
              </p>
            </div>
          </div>

          {/* Balance Display */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '15px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{
              fontSize: '13px',
              color: '#999',
              marginBottom: '8px',
              fontWeight: '600'
            }}>
              የአጠቃላይ ሚዛን
            </div>
            <div style={{
              fontSize: '48px',
              fontWeight: '700',
              color: '#fff',
              marginBottom: '15px'
            }}>
              {balance.toFixed(2)}
            </div>
            <button style={{
              backgroundColor: '#ffb930',
              color: '#000',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '20px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '13px'
            }}>
              ሪ ለመክፈል
            </button>
          </div>

          {/* Stats Row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '15px',
            marginBottom: '20px'
          }}>
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '15px',
              padding: '15px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#00d4ff',
                marginBottom: '5px'
              }}>
                0
              </div>
              <div style={{
                fontSize: '11px',
                color: '#999',
                fontWeight: '600'
              }}>
                የተጠጋጋ ጕዝበኞች
              </div>
            </div>
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '15px',
              padding: '15px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#ffb930',
                marginBottom: '5px'
              }}>
                {referralBalance.toFixed(2)}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#999',
                fontWeight: '600'
              }}>
                ክፍያ (ETB)
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '15px'
          }}>
            <button style={{
              backgroundColor: '#ffb930',
              color: '#000',
              border: 'none',
              padding: '15px',
              borderRadius: '15px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              ➕ ገንዘብ አክል
            </button>
            <button style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: '#00d4ff',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              padding: '15px',
              borderRadius: '15px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              ➜ ገንዘብ ውጣ
            </button>
          </div>
        </div>

        {/* Referral Link Section */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          borderRadius: '15px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{
            fontSize: '12px',
            color: '#999',
            marginBottom: '10px',
            fontWeight: '600'
          }}>
            የተጠጋጋ ሊንክ
          </div>
          <div style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center'
          }}>
            <input
              type="text"
              value="t.me/sora_gamesbot?startapp=ref_C47432F"
              readOnly
              style={{
                flex: 1,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#999',
                padding: '12px 15px',
                borderRadius: '10px',
                fontSize: '12px',
                outline: 'none'
              }}
            />
            <button style={{
              backgroundColor: '#ffb930',
              color: '#000',
              border: 'none',
              padding: '12px 15px',
              borderRadius: '10px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              📋
            </button>
          </div>
        </div>

        {/* Referral Button */}
        <button style={{
          width: '100%',
          backgroundColor: '#ffb930',
          color: '#000',
          border: 'none',
          padding: '15px',
          borderRadius: '15px',
          fontWeight: 'bold',
          cursor: 'pointer',
          fontSize: '14px',
          marginBottom: '20px'
        }}>
          🔗 ጕዝበኞችን በመጋበዥ ገንዘብ ይስሩ {'>'} 
        </button>

        {/* Game Tile */}
        <div
          style={{
            cursor: 'pointer',
            padding: 0,
            overflow: 'hidden',
            position: 'relative',
            minHeight: 220,
            display: 'flex',
            alignItems: 'flex-end',
            backgroundImage:
              'linear-gradient(180deg, rgba(15,17,23,0) 40%, rgba(15,17,23,0.9) 100%), radial-gradient(120% 90% at 15% 15%, rgba(255,59,78,0.25), transparent 60%)',
            backgroundColor: '#121016',
            borderRadius: '15px',
            marginTop: '20px'
          }}
          onClick={() => navigate('/dashboard/aviator')}
        >
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              fontSize: 28,
              fontWeight: 800,
              color: '#ff3b4e',
              letterSpacing: '-0.5px',
              textShadow: '0 0 18px rgba(255,59,78,0.45)',
            }}
          >
            Aviator
          </div>
          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: '#ffb930',
              background: 'rgba(0,0,0,0.4)',
              padding: '4px 10px',
              borderRadius: 999,
            }}
          >
            Live
          </div>
          <div style={{ padding: 20, width: '100%' }}>
            <div style={{ fontSize: 14, color: '#e8e8ea', fontWeight: 600, marginBottom: 4 }}>
              Watch it climb. Cash out before it crashes.
            </div>
            <div style={{ fontSize: 12, color: '#9aa0b4' }}>Tap to play</div>
          </div>
        </div>
      </div>
    </div>
  );
}
