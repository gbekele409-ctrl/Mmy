const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { User, Transaction } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiting for financial requests                                */
/* ------------------------------------------------------------------ */

const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many financial requests. Please try again later.' },
});

/* ------------------------------------------------------------------ */
/*  Validation                                                          */
/* ------------------------------------------------------------------ */

// Amounts arrive from the client in whole currency units (e.g. dollars) and
// are converted to integer cents server-side to avoid float issues.
const amountValidation = [
  body('amount')
    .isFloat({ gt: 0, max: 1000000 })
    .withMessage('Amount must be a positive number'),
];

// Deposits: user must supply the Telebirr transaction reference they paid
// with, so the admin can cross-check it against the actual Telebirr
// business account before crediting the balance.
const depositValidation = [
  ...amountValidation,
  body('telebirr_reference')
    .trim()
    .notEmpty()
    .withMessage('Telebirr transaction reference is required')
    .isLength({ max: 100 })
    .withMessage('Reference is too long'),
];

// Withdrawals: user must supply the Telebirr phone number funds should be
// sent to.
const withdrawValidation = [
  ...amountValidation,
  body('telebirr_phone')
    .trim()
    .notEmpty()
    .withMessage('Telebirr phone number is required')
    .matches(/^\+?\d{9,15}$/)
    .withMessage('Enter a valid Telebirr phone number (digits only, optional leading +)'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/* ------------------------------------------------------------------ */
/*  Routes (all require authentication)                                 */
/* ------------------------------------------------------------------ */

// GET /api/wallet/balance
router.get('/balance', requireAuth, async (req, res) => {
  res.json({ balance: req.user.balance / 100 });
});

// POST /api/wallet/deposit  -> creates a PENDING deposit request for admin review
// The user has already sent money via Telebirr to the operator's Telebirr
// account outside this app; here they log the amount and the Telebirr
// transaction reference so an admin can verify and approve it.
router.post('/deposit', requireAuth, financialLimiter, depositValidation, handleValidation, async (req, res, next) => {
  try {
    const amountCents = toCents(req.body.amount);

    // Prevent the exact same Telebirr reference being submitted twice
    // (accidental double-submit, or an attempt to reuse one real payment
    // to claim multiple deposits).
    const duplicate = await Transaction.findOne({
      type: 'deposit',
      telebirr_reference_submitted: req.body.telebirr_reference.trim(),
      status: { $in: ['pending', 'approved'] },
    });
    if (duplicate) {
      return res.status(409).json({ error: 'This Telebirr reference has already been submitted' });
    }

    const tx = await Transaction.create({
      user_id: req.user._id,
      type: 'deposit',
      amount: amountCents,
      status: 'pending',
      note: (req.body.note || '').slice(0, 500),
      telebirr_reference_submitted: req.body.telebirr_reference.trim(),
    });

    res.status(201).json({
      message: 'Deposit request submitted. An admin will verify your Telebirr payment and approve it shortly.',
      transaction: tx,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/wallet/withdraw -> creates a PENDING withdrawal request for admin review
// Balance is NOT deducted until an admin approves, to avoid locking funds on rejected requests.
// We do, however, check that the user currently has sufficient balance to cover the request.
router.post('/withdraw', requireAuth, financialLimiter, withdrawValidation, handleValidation, async (req, res, next) => {
  try {
    const amountCents = toCents(req.body.amount);

    const freshUser = await User.findById(req.user._id);
    if (freshUser.balance < amountCents) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const tx = await Transaction.create({
      user_id: req.user._id,
      type: 'withdraw',
      amount: amountCents,
      status: 'pending',
      note: (req.body.note || '').slice(0, 500),
      telebirr_phone: req.body.telebirr_phone.trim(),
    });

    res.status(201).json({
      message: 'Withdrawal request submitted. An admin will send the funds via Telebirr and approve it shortly.',
      transaction: tx,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/wallet/transactions -> the current user's own transaction history
router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

    const [items, total] = await Promise.all([
      Transaction.find({ user_id: req.user._id })
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Transaction.countDocuments({ user_id: req.user._id }),
    ]);

    res.json({
      transactions: items.map((t) => ({
        id: t._id,
        type: t.type,
        amount: t.amount / 100,
        status: t.status,
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

module.exports = router;
