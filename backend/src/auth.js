const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
// FIXED: Added 'pool' to the destructured import so Claudia's code can access it
const { query, pool } = require('./database');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiting                                                       */
/* ------------------------------------------------------------------ */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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
/*  Telegram Web App initData verification                              */
/* ------------------------------------------------------------------ */

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false, data: null };

  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const valid = computedHash === hash;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const isFresh = authDate > 0 && Date.now() / 1000 - authDate < 60 * 60 * 24;

  if (!valid || !isFresh) return { valid: false, data: null };

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }

  return { valid: true, data: { user, authDate } };
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
      'SELECT id, username, role, balance, is_active, telegram_id, telegram_first_name, telegram_photo_url, telegram_phone FROM users WHERE id = $1',
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
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

const telegramAuthValidation = [
  body('initData').isString().notEmpty().withMessage('Telegram initData is required'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

// POST /api/auth/telegram - the only login/registration path.
router.post('/telegram', authLimiter, telegramAuthValidation, handleValidation, async (req, res, next) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'Server is not configured for Telegram auth' });
    }

    const { valid, data } = verifyTelegramInitData(req.body.initData, botToken);
    if (!valid || !data?.user?.id) {
      return res.status(401).json({ error: 'Invalid or expired Telegram authentication data' });
    }

    const tgUser = data.user;
    const telegramId = tgUser.id;

    let { rows } = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    let user = rows[0];

    if (!user) {
      // First time we've seen this Telegram user - create an account.
      const baseUsername = tgUser.username || `${tgUser.first_name || 'player'}${telegramId}`.replace(/\s+/g, '');
      let username = baseUsername.slice(0, 30);

      const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.length > 0) {
        username = `${username}_${telegramId}`.slice(0, 30);
      }

      const insertRes = await query(
        `INSERT INTO users (username, role, balance, telegram_id, telegram_username, telegram_first_name, telegram_photo_url)
         VALUES ($1, 'user', 0, $2, $3, $4, $5)
         RETURNING *`,
        [username, telegramId, tgUser.username || null, tgUser.first_name || null, tgUser.photo_url || null]
      );
      user = insertRes.rows[0];

      // ============================================================================
      // ADDITION to backend/src/auth.js (FIXED: Correctly nested inside an async route)
      // ============================================================================
      try {
        const { rows: settingRows } = await query(
          `SELECT value FROM platform_settings WHERE key = 'signup_bonus_birr'`
        );
        const bonusBirr = parseFloat(settingRows[0]?.value || '10');
        const bonusCents = Math.round(bonusBirr * 100);

        if (bonusCents > 0) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            const { rows: lockedUserRows } = await client.query(
              'SELECT signup_bonus_granted FROM users WHERE id = $1 FOR UPDATE',
              [user.id]
            );
            const alreadyGranted = lockedUserRows[0]?.signup_bonus_granted;

            if (!alreadyGranted) {
              await client.query(
                'UPDATE users SET balance = balance + $1, signup_bonus_granted = TRUE WHERE id = $2',
                [bonusCents, user.id]
              );
              await client.query(
                `INSERT INTO transactions (user_id, type, amount, status, note)
                 VALUES ($1, 'payout', $2, 'completed', 'Registration bonus')`,
                [user.id, bonusCents]
              );
              user.balance = (user.balance || 0) + bonusCents;
            }

            await client.query('COMMIT');
          } catch (bonusErr) {
            await client.query('ROLLBACK');
            console.error('[auth] Failed to grant signup bonus', { userId: user.id, error: bonusErr.message });
          } finally {
            client.release();
          }
        }
      } catch (err) {
        console.error('[auth] Signup bonus lookup failed', { error: err.message });
      }
      // ============================================================================

      // If they shared their phone number with the bot before opening the
      // Mini App (via the /start flow), attach it now and clean up the
      // staging row.
      const { rows: pendingPhone } = await query(
        'SELECT phone FROM pending_telegram_phones WHERE telegram_id = $1',
        [telegramId]
      );
      if (pendingPhone.length > 0) {
        await query('UPDATE users SET telegram_phone = $1 WHERE id = $2', [pendingPhone[0].phone, user.id]);
        await query('DELETE FROM pending_telegram_phones WHERE telegram_id = $1', [telegramId]);
        user.telegram_phone = pendingPhone[0].phone;
      }
    } else {
      // Existing user - refresh their cached Telegram profile info
      await query(
        `UPDATE users SET telegram_username = $1, telegram_first_name = $2, telegram_photo_url = $3 WHERE id = $4`,
        [tgUser.username || null, tgUser.first_name || null, tgUser.photo_url || null, user.id]
      );
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        balance: user.balance,
        telegram_first_name: tgUser.first_name || user.telegram_first_name,
        telegram_photo_url: tgUser.photo_url || user.telegram_photo_url,
        telegram_phone: user.telegram_phone || null,
      },
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
      role: req.user.role,
      balance: req.user.balance,
      telegram_first_name: req.user.telegram_first_name,
      telegram_photo_url: req.user.telegram_photo_url,
      telegram_phone: req.user.telegram_phone,
    },
  });
});

module.exports = { router, requireAuth, requireAdmin, signToken, verifyToken };
  
