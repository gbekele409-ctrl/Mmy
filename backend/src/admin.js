const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { User, Transaction } = require('./database');
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

    const [users, total] = await Promise.all([
      User.find().select('-password_hash').sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(),
    ]);

    res.json({
      users: users.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        role: u.role,
        balance: u.balance / 100,
        isActive: u.isActive,
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

// PATCH /api/admin/users/:id/status - activate/deactivate a user account
router.patch(
  '/users/:id/status',
  [param('id').isMongoId(), body('isActive').isBoolean()],
  handleValidation,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      user.isActive = req.body.isActive;
      await user.save();

      logger.info('Admin updated user status', {
        admin: req.user.username,
        target: user.username,
        isActive: user.isActive,
      });

      res.json({ message: 'User status updated', user: { id: user._id, isActive: user.isActive } });
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
    const filter = { status: 'pending' };
    if (req.query.type && ['deposit', 'withdraw'].includes(req.query.type)) {
      filter.type = req.query.type;
    } else {
      filter.type = { $in: ['deposit', 'withdraw'] };
    }

    const items = await Transaction.find(filter)
      .sort({ created_at: 1 })
      .populate('user_id', 'username email');

    res.json({
      transactions: items.map((t) => ({
        id: t._id,
        user: t.user_id ? { id: t.user_id._id, username: t.user_id.username, email: t.user_id.email } : null,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        note: t.note,
        // For deposits: what the user claims they paid with - verify this
        // against the real Telebirr business account before approving.
        telebirr_reference_submitted: t.telebirr_reference_submitted,
        // For withdrawals: where the admin needs to send the money.
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

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.userId) filter.user_id = req.query.userId;

    const [items, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user_id', 'username email')
        .populate('approved_by', 'username'),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      transactions: items.map((t) => ({
        id: t._id,
        user: t.user_id ? { id: t.user_id._id, username: t.user_id.username } : null,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
        approved_by: t.approved_by ? t.approved_by.username : null,
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
// confirmed the money actually arrived. The user's balance is credited.
//
// For withdrawals: approving means the admin has ALREADY sent the money to
// the user's Telebirr phone number and is now recording proof of that
// transfer (their own Telebirr reference) before the balance is debited.
// This makes "approved" mean "money has actually moved", not just "ok'd".
router.post(
  '/transactions/:id/approve',
  [
    param('id').isMongoId(),
    body('telebirr_reference')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Reference is too long'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const tx = await Transaction.findById(req.params.id);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

      const user = await User.findById(tx.user_id);
      if (!user) return res.status(404).json({ error: 'Associated user not found' });

      if (tx.type === 'deposit') {
        // Require the admin to confirm they checked the real Telebirr
        // account, by re-entering/confirming the reference they verified.
        const providedRef = (req.body.telebirr_reference || '').trim();
        if (!providedRef) {
          return res.status(400).json({
            error: 'Enter the Telebirr reference you verified in the business account before approving',
          });
        }
        user.balance += tx.amount;
        tx.telebirr_reference_admin = providedRef;
      } else if (tx.type === 'withdraw') {
        // Require proof the admin actually sent the money before the
        // balance is debited - this is the real-transfer record.
        const providedRef = (req.body.telebirr_reference || '').trim();
        if (!providedRef) {
          return res.status(400).json({
            error: 'Enter the Telebirr reference for the transfer you sent before approving',
          });
        }
        if (user.balance < tx.amount) {
          return res.status(400).json({ error: 'User no longer has sufficient balance for this withdrawal' });
        }
        user.balance -= tx.amount;
        tx.telebirr_reference_admin = providedRef;
      } else {
        return res.status(400).json({ error: 'Only deposit/withdraw transactions can be approved here' });
      }

      await user.save();

      tx.status = 'approved';
      tx.approved_by = req.user._id;
      await tx.save();

      logger.info('Admin approved transaction', {
        admin: req.user.username,
        txId: tx._id.toString(),
        type: tx.type,
        amount: tx.amount / 100,
        user: user.username,
        telebirr_reference_admin: tx.telebirr_reference_admin,
      });

      res.json({ message: 'Transaction approved', transaction: tx, newBalance: user.balance / 100 });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/transactions/:id/reject
router.post(
  '/transactions/:id/reject',
  [param('id').isMongoId(), body('reason').optional().isString().isLength({ max: 500 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const tx = await Transaction.findById(req.params.id);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction is not pending' });

      tx.status = 'rejected';
      tx.approved_by = req.user._id;
      if (req.body.reason) tx.note = `${tx.note ? tx.note + ' | ' : ''}Rejected: ${req.body.reason}`;
      await tx.save();

      logger.info('Admin rejected transaction', {
        admin: req.user.username,
        txId: tx._id.toString(),
        type: tx.type,
        reason: req.body.reason || null,
      });

      res.json({ message: 'Transaction rejected', transaction: tx });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
