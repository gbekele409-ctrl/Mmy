import React from 'react';
import { useNavigate } from 'react-router-dom';

// Landing page after login (the "Games" tab). Shows the Aviator game tile.
// Wallet, Support, and Profile now live on their own routes, reachable via
// the persistent bottom navigation.
export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <div
        className="card"
        onClick={() => navigate('/dashboard/aviator')}
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
        }}
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
  );
}
