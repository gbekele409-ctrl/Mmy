const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { query } = require('./database');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiting (brute-force / credential-stuffing protection)        */
/* ------------------------------------------------------------------ */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

/* ------------------------------------------------------------------ */
/*  Token helpers                                                       */
/* ------------------------------------------------------------------ */

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/* ------------------------------------------------------------------ */
/*  Middleware (exported for use by other route files)                  */
/* ------------------------------------------------------------------ */

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { rows } = await query(
      'SELECT id, username, email, role, balance, is_active FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Validation chains                                                    */
/* ------------------------------------------------------------------ */

const registerValidation = [
  body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, underscores'),
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
];

const loginValidation = [
  body('identifier').trim().notEmpty().withMessage('Username or email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

// POST /api/auth/register
router.post('/register', authLimiter, registerValidation, handleValidation, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    const existing = await query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
    const password_hash = await bcrypt.hash(password, saltRounds);

    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, role, balance)
       VALUES ($1, $2, $3, 'user', 0)
       RETURNING id, username, email, role, balance`,
      [username, email, password_hash]
    );
    const user = rows[0];

    const token = signToken(user);

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, balance: user.balance },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, loginValidation, handleValidation, async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    const { rows } = await query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [identifier, identifier.toLowerCase()]
    );
    const user = rows[0];

    // Generic error message to avoid leaking whether the account exists.
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, balance: user.balance },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      balance: req.user.balance,
    },
  });
});

module.exports = { router, requireAuth, requireAdmin, signToken, verifyToken };
