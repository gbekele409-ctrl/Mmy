import React from 'react';
import Navbar from '../components/Navbar.jsx';
import GameBoard from '../components/GameBoard.jsx';
import Wallet from '../components/Wallet.jsx';

export default function Dashboard() {
  return (
    <div>
      <Navbar />
      <div className="container">
        <div className="grid-2">
          <GameBoard />
          <Wallet />
        </div>
      </div>
    </div>
  );
}
