import React from 'react';
import GameBoard from '../components/GameBoard.jsx';

// Standalone page wrapper around the game board, in case it's linked to
// directly (e.g. /dashboard renders it inline, but this page exists for a
// dedicated full-screen game route or future expansion).
export default function Aviator() {
  return (
    <div className="container">
      <GameBoard />
    </div>
  );
}
