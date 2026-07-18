const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('./database');
const { requireAuth, requireAdmin } = require('./auth');
const logger = require('./logger');

const router = express.Router();

// Every route in this file requires a valid JWT AND the admin role.
router.use(requireAuth, requireAdmin);

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

/* ------------------------------------------------------------------ */
/*  Users                                                               */
/* ------------------------------------------------------------------ */

// GET /api/admin/users - list all users
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const [usersRes, countRes] = await Promise.all([
      query(
        `SELECT id, username, email, role, balance, is_active, created_at
         FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query('SELECT COUNT(*)::int AS count FROM users'),
    ]);

    const total = countRes.rows[0].count;

    res.json({
      users: usersRes.rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        balance: u.balance / 100,
        isActive: u.is_active,
        created_at: u.created_at,
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/status - activate/deactivate (ban/unban) a user account
router.patch(
  '/users/:id/status',
  [param('id').isUUID(), body('isActive').isBoolean()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { rows } = await query(
        'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active',
        [req.body.isActive, req.params.id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: 'User not found' });

      logger.info('Admin updated user status', {
        admin: req.user.username,
        target: user.username,
        isActive: user.is_active,
      });

      res.json({ message: 'User status updated', user: { id: user.id, isActive: user.is_active } });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  Transactions - pending queues + approve/reject                      */
/* ------------------------------------------------------------------ */

// GET /api/admin/transactions/pending?type=deposit|withdraw
router.get('/transactions/pending', async (req, res, next) => {
  try {
    let sql = `
      SELECT t.*, u.username, u.email
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      WHERE t.status = 'pending'
    `;
    const params = [];

    if (req.query.type && ['deposit', 'withdraw'].includes(req.query.type)) {
      params.push(req.query.type);
      sql += ` AND t.type = $${params.length}`;
    } else {
      sql += ` AND t.type IN ('deposit', 'withdraw')`;
    }
    sql += ' ORDER BY t.created_at ASC';

    const { rows } = await query(sql, params);

    res.json({
      transactions: rows.map((t) => ({
        id: t.id,
        user: { id: t.user_id, username: t.username, email: t.email },
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        note: t.note,
        telebirr_reference_submitted: t.telebirr_reference_submitted,
        telebirr_phone: t.telebirr_phone,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/transactions - full history, all users, with optional filters
router.get('/transactions', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`t.type = $${params.length}`);
    }
    if (req.query.userId) {
      params.push(req.query.userId);
      conditions.push(`t.user_id = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const listParams = [...params, limit, offset];
    const listSql = `
      SELECT t.*, u.username AS user_username, a.username AS approved_by_username
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN users a ON a.id = t.approved_by
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `SELECT COUNT(*)::int AS count FROM transactions t ${whereClause}`;

    const [itemsRes, countRes] = await Promise.all([
      query(listSql, listParams),
      query(countSql, params),
    ]);

    const total = countRes.rows[0].count;

    res.json({
      transactions: itemsRes.rows.map((t) => ({
        id: t.id,
        user: t.user_id ? { id: t.user_id, username: t.user_username } : null,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        approved_by: t.approved_by_username || null,
        note: t.note,
        telebirr_reference_submitted: t.telebirr_reference_submitted,
        telebirr_phone: t.telebirr_phone,
        telebirr_reference_admin: t.telebirr_reference_admin,
        created_at: t.created_at,
      })),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/transactions/:id/approve
//
// For deposits: approving means the admin has checked the submitted
// Telebirr reference against the real Telebirr business account and
// confirmed the money actually arrived. The user's balance is credited,
// and if this is the user's first-ever approved deposit and they were
// referred by someone, that referrer earns a one-time commission (see
// the referral block below) - all inside the same DB transaction, so
// either everything succeeds together or none of it does.
//
// For withdrawals: approving means the admin has ALREADY sent the money to
// the user's Telebirr phone number and is now recording proof of that
// transfer (their own Telebirr reference) before the balance is debited.
router.post(
  '/transactions/:id/approve',
  [
    param('id').isUUID(),
    body('telebirr_reference').optional().trim().isLength({ max: 100 }).withMessage('Reference is too long'),
  ],
  handleValidation,
  async (req, res, next) => {
    const client = await require('./database').pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: txRows } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      const tx = txRows[0];
      if (!tx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found' });
      }
      if (tx.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Transaction is not pending' });
      }

      const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [tx.user_id]);
      const user = userRows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Associated user not found' });
      }

      const providedRef = (req.body.telebirr_reference || '').trim();
      if (!providedRef) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error:
            tx.type === 'deposit'
              ? 'Enter the Telebirr reference you verified in the business account before approving'
              : 'Enter the Telebirr reference for the transfer you sent before approving',
        });
      }

      if (tx.type === 'deposit') {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [tx.amount, user.id]);

        // ------------------------------------------------------------
        // Referral commission: 5% (or whatever's configured) of a
        // referred user's FIRST-EVER approved deposit, paid to whoever
        // referred them. Guarded by referral_commission_paid so it can
        // never fire twice for the same referred user.
        // ------------------------------------------------------------
        const { rows: depositorRows } = await client.query(
          'SELECT referred_by, referral_commission_paid FROM users WHERE id = $1',
          [user.id]
        );
        const depositor = depositorRows[0];

        if (depositor?.referred_by && !depositor.referral_commission_paid) {
          const { rows: priorDepositsRows } = await client.query(
            `SELECT COUNT(*)::int AS count FROM transactions
             WHERE user_id = $1 AND type = 'deposit' AND status = 'approved' AND id != $2`,
            [user.id, tx.id]
          );
          const isFirstDeposit = priorDepositsRows[0].count === 0;

          if (isFirstDeposit) {
            const { rows: settingRows } = await client.query(
              `SELECT value FROM platform_settings WHERE key = 'referral_commission_percent'`
            );
            const commissionPercent = parseFloat(settingRows[0]?.value || '5');
            const commissionCents = Math.round(tx.amount * (commissionPercent / 100));

            if (commissionCents > 0) {
              await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [
                commissionCents,
                depositor.referred_by,
              ]);
              await client.query(
                `INSERT INTO transactions (user_id, type, amount, status, note)
                 VALUES ($1, 'payout', $2, 'completed', $3)`,
                [depositor.referred_by, commissionCents, `Referral commission (${commissionPercent}%)`]
              );
              await client.query('UPDATE users SET referral_commission_paid = TRUE WHERE id = $1', [user.id]);
            }
          }
        }
      } else if (tx.type === 'withdraw') {
        if (user.balance < tx.amount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'User no longer has sufficient balance for this withdrawal' });
        }
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [tx.amount, user.id]);
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only deposit/withdraw transactions can be approved here' });
      }

      const { rows: updatedTxRows } = await client.query(
        `UPDATE transactions
         SET status = 'approved', approved_by = $1, telebirr_reference_admin = $2
         WHERE id = $3 RETURNING *`,
        [req.user.id, providedRef, tx.id]
      );

      const { rows: finalUserRows } = await client.query('SELECT balance FROM users WHERE id = $1', [user.id]);

      await client.query('COMMIT');

      logger.info('Admin approved transaction', {
        admin: req.user.username,
        txId: tx.id,
        type: tx.type,
        amount: tx.amount / 100,
        user: user.username,
        telebirr_reference_admin: providedRef,
      });

      res.json({
        message: 'Transaction approved',
        transaction: updatedTxRows[0],
        newBalance: finalUserRows[0].balance / 100,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// POST /api/admin/transactions/:id/reject
router.post(
  '/transactions/:id/reject',
  [param('id').isUUID(), body('reason').optional().isString().isLength({ max: 500 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const { rows: txRows } = await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
      const tx = txRows[0];
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

      const newNote = req.body.reason
        ? `${tx.note ? tx.note + ' | ' : ''}Rejected: ${req.body.reason}`
        : tx.note;

      const { rows } = await query(
        `UPDATE transactions SET status = 'rejected', approved_by = $1, note = $2 WHERE id = $3 RETURNING *`,
        [req.user.id, newNote, tx.id]
      );

      logger.info('Admin rejected transaction', {
        admin: req.user.username,
        txId: tx.id,
        type: tx.type,
        reason: req.body.reason || null,
      });

      res.json({ message: 'Transaction rejected', transaction: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  Platform settings - game logo                                       */
/* ------------------------------------------------------------------ */

// PUT /api/admin/settings/game-logo
// Admin sets the URL of an already-hosted image to use as the Aviator
// game logo shown to players. This does NOT handle file upload itself -
// it just stores a URL string. Upload your image to any static host
// (Supabase Storage, Cloudinary, imgur, etc.) first, then paste the
// resulting URL here.
router.put(
  '/settings/game-logo',
  [body('url').isURL().withMessage('A valid image URL is required')],
  handleValidation,
  async (req, res, next) => {
    try {
      await query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ('game_logo_url', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [req.body.url]
      );

      logger.info('Admin updated game logo', { admin: req.user.username, url: req.body.url });

      res.json({ message: 'Game logo updated', url: req.body.url });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  Stats - overview + per-user                                         */
/* ------------------------------------------------------------------ */

// GET /api/admin/stats/overview
// Real aggregate numbers for the admin dashboard: total registered users,
// total deposited (approved deposits only), total withdrawn (approved
// withdrawals only), total amount users have won (sum of all 'payout'
// transactions), and total platform result (net of all bets minus all
// payouts - positive means the house is ahead, negative means users are
// net winners overall).
router.get('/stats/overview', async (req, res, next) => {
  try {
    const [usersRes, depositsRes, withdrawalsRes, betsRes, payoutsRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM users'),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'deposit' AND status = 'approved'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'withdraw' AND status = 'approved'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'bet' AND status = 'completed'`),
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM transactions WHERE type = 'payout' AND status = 'completed'`),
    ]);

    const totalBets = betsRes.rows[0].total;
    const totalPayouts = payoutsRes.rows[0].total;

    res.json({
      totalUsers: usersRes.rows[0].count,
      totalDeposited: Number(depositsRes.rows[0].total) / 100,
      totalWithdrawn: Number(withdrawalsRes.rows[0].total) / 100,
      totalUserWinnings: Number(totalPayouts) / 100,
      platformResult: (Number(totalBets) - Number(totalPayouts)) / 100,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/users
// Per-user list with registration info and their own total winnings
// (sum of their 'payout' transactions).
router.get('/stats/users', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT
         u.id,
         u.username,
         u.telegram_first_name,
         u.balance,
         u.is_active,
         u.created_at,
         COALESCE(w.total_won, 0) AS total_won
       FROM users u
       LEFT JOIN (
         SELECT user_id, SUM(amount) AS total_won
         FROM transactions
         WHERE type = 'payout' AND status = 'completed'
         GROUP BY user_id
       ) w ON w.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await query('SELECT COUNT(*)::int AS count FROM users');

    res.json({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        telegram_first_name: u.telegram_first_name,
        balance: u.balance / 100,
        totalWon: Number(u.total_won) / 100,
        isActive: u.is_active,
        created_at: u.created_at,
      })),
      page,
      totalPages: Math.ceil(countRows[0].count / limit),
      total: countRows[0].count,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
