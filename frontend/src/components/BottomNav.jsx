import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Persistent bottom navigation bar. Highlights the active tab based on the
// current route. Renders on every authenticated page via App.jsx's layout.
const TABS = [
  { key: 'games', label: 'Games', path: '/dashboard', icon: '🎮' },
  { key: 'wallet', label: 'Wallet', path: '/wallet', icon: '💳' },
  { key: 'support', label: 'Support', path: '/support', icon: '🎧' },
  { key: 'profile', label: 'Profile', path: '/profile', icon: '👤' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/dashboard') {
      // Games tab stays highlighted for the dashboard AND the live game
      // screen, since both are part of the "Games" section.
      return location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/');
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`bottom-nav-item ${isActive(tab.path) ? 'active' : ''}`}
          onClick={() => navigate(tab.path)}
        >
          <span className="bottom-nav-icon">{tab.icon}</span>
          <span className="bottom-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
