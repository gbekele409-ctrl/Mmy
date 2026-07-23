const { verifyToken } = require('./auth');
const { query } = require('./database');

/* ==================================================================== */
/*  Wallet realtime balance push                                         */
/*                                                                        */
/*  Every place balance/bonus_balance changes today already re-queries   */
/*  the fresh value after commit (admin approve, game.js bet/cashout,    */
/*  bingo.js stake/payout, cashback.js claim). This module lets any of   */
/*  those call pushBalanceUpdate(userId) right after their own commit to */
/*  push the new numbers straight to that user's wallet page - no        */
/*  polling wait. It does not change what any of those routes compute;   */
/*  it only adds a notification on top.                                  */
/*                                                                        */
/*  Sockets identify themselves by emitting 'wallet:authenticate' with   */
/*  the same JWT the app already stores after login, and are placed in a */
/*  private per-user room ("user:<id>") that only that user's socket(s)  */
/*  are in - the balance push is never broadcast to everyone.            */
/* ==================================================================== */

/* ==================================================================== */
/*  Wallet realtime balance push                                         */
/*                                                                        */
/*  Every place balance/bonus_balance changes today already re-queries   */
/*  the fresh value after commit (admin approve, game.js bet/cashout,    */
/*  bingo.js stake/payout, cashback.js claim). This module lets any of   */
/*  those call pushBalanceUpdate(userId) right after their own commit to */
/*  push the new numbers straight to that user's wallet page - no        */
/*  polling wait. It does not change what any of those routes compute;   */
/*  it only adds a notification on top.                                  */
/*                                                                        */
/*  The frontend's getSocket() (api.js) already sends the user's JWT in  */
/*  the connection handshake (auth: { token }) for every socket it       */
/*  opens - this module reads that same token to identify the connecting */
/*  user and place them in a private room ("user:<id>") that only their  */
/*  own socket(s) are in, so a balance push is never broadcast to        */
/*  everyone.                                                            */
/* ==================================================================== */

let ioRef = null;

function attachWalletSocket(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (!token || typeof token !== 'string') return;
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.join(`user:${payload.sub}`);
    } catch {
      // Invalid/expired token - the socket just won't receive pushes;
      // the wallet page still has its normal poll as a fallback.
    }
  });
}

// Fetches the latest balance fields for a user and pushes them to that
// user's private room. Safe to call from anywhere after a balance-changing
// commit - if the socket server isn't attached yet or the user has no
// open socket, this is a no-op.
async function pushBalanceUpdate(userId) {
  if (!ioRef || !userId) return;
  try {
    const { rows } = await query(
      'SELECT balance, bonus_balance, wagering_required, wagering_target_total FROM users WHERE id = $1',
      [userId]
    );
    const user = rows[0];
    if (!user) return;

    ioRef.to(`user:${userId}`).emit('wallet:balance_updated', {
      balance: user.balance / 100,
      bonus_balance: (user.bonus_balance || 0) / 100,
      wagering_required: (user.wagering_required || 0) / 100,
      wagering_target_total: (user.wagering_target_total || 0) / 100,
    });
  } catch (err) {
    console.error('[wallet] Failed to push balance update', { userId, error: err.message });
  }
}

module.exports = { attachWalletSocket, pushBalanceUpdate };
