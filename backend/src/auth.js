const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
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
/*  Referral code generation                                            */
/*  Generates a short, URL-safe referral code and retries on the rare   */
/*  collision (checked against the database) rather than trusting       */
/*  randomness alone to be unique.                                      */
/* ------------------------------------------------------------------ */

async function generateUniqueReferralCode(queryFn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    const { rows } = await queryFn('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  // Extremely unlikely to ever reach here, but fail safe with a
  // timestamp-based fallback that's guaranteed unique.
  return `t${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/*  Telegram Web App initData verification                              */
/*                                                                        */
/*  Telegram signs the data it hands to your Mini App using an HMAC       */
/*  derived from your bot token. We MUST verify this signature server-    */
/*  side before trusting any user info in it - otherwise anyone could     */
/*  forge a fake Telegram identity and register/log in as anyone.         */
/*  Reference: https://core.telegram.org/bots/webapps#validating-data-    */
/*  received-via-the-mini-app                                             */
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
      'SELECT id, username, role, balance, bonus_balance, wagering_required, wagering_target_total, is_active, telegram_id, telegram_first_name, telegram_photo_url, telegram_phone, referral_code FROM users WHERE id = $1',
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
// The frontend, running inside Telegram's Mini App webview, sends the raw
// initData string it received from the Telegram Web App SDK, plus
// (optionally) a referral_code if the bot was opened via a referral deep
// link. We verify initData's signature server-side, then find-or-create
// the matching user and issue our own JWT.
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

      // ------------------------------------------------------------
      // Signup bonus: credit a one-time bonus (default 10 birr, or
      // whatever's configured in platform_settings), guarded so it can
      // never be granted twice even under a retried/duplicate request.
      //
      // The bonus is credited to bonus_balance (NOT balance) and is
      // locked behind a wagering requirement (100x the bonus amount,
      // i.e. wagering_required starts at bonusCents * 100). It only
      // becomes withdrawable once wagering_required reaches 0 - see
      // the WAGERING_MULTIPLIER TODO below and wallet.js's withdraw
      // route, which blocks withdrawal while wagering_required > 0.
      // ------------------------------------------------------------
      const WAGERING_MULTIPLIER = 100;
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
              const wageringRequiredCents = bonusCents * WAGERING_MULTIPLIER;
              await client.query(
                `UPDATE users
                 SET bonus_balance = bonus_balance + $1,
                     wagering_required = wagering_required + $2,
                     wagering_target_total = wagering_target_total + $2,
                     signup_bonus_granted = TRUE
                 WHERE id = $3`,
                [bonusCents, wageringRequiredCents, user.id]
              );
              await client.query(
                `INSERT INTO transactions (user_id, type, amount, status, note)
                 VALUES ($1, 'payout', $2, 'completed', 'Registration bonus (locked - wagering required)')`,
                [user.id, bonusCents]
              );
              user.bonus_balance = (user.bonus_balance || 0) + bonusCents;
              user.wagering_required = (user.wagering_required || 0) + wageringRequiredCents;
              user.wagering_target_total = (user.wagering_target_total || 0) + wageringRequiredCents;
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

      // ------------------------------------------------------------
      // Referral: generate this new user's own referral code, then (if
      // they arrived via someone else's referral link) link them to
      // that referrer. Referral tracking never blocks login - any
      // failure here is logged and swallowed, not surfaced as an error.
      // ------------------------------------------------------------
      try {
        const referralCode = await generateUniqueReferralCode(query);
        await query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, user.id]);
        user.referral_code = referralCode;

        const referralCodeUsed = req.body.referral_code;

        // TEMPORARY DEBUG LOG - remove once referral tracking is
        // confirmed working. Shows exactly what code (if any) arrived
        // in this signup request, before we even try to match it.
        console.log('[auth] New signup referral code received', {
          newUserId: user.id,
          referralCodeUsed: referralCodeUsed || null,
        });

        if (referralCodeUsed && typeof referralCodeUsed === 'string') {
          const { rows: referrerRows } = await query(
            'SELECT id FROM users WHERE referral_code = $1',
            [referralCodeUsed.trim()]
          );

          // TEMPORARY DEBUG LOG - remove once referral tracking is
          // confirmed working.
          console.log('[auth] Referral code lookup result', {
            referralCodeUsed: referralCodeUsed.trim(),
            matchFound: referrerRows.length > 0,
            referrerId: referrerRows[0]?.id || null,
          });

          if (referrerRows.length > 0 && referrerRows[0].id !== user.id) {
            await query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrerRows[0].id, user.id]);
          }
        }
      } catch (err) {
        console.error('[auth] Referral setup failed', { userId: user.id, error: err.message });
      }

      // If they shared their phone number with the bot before opening the
      // Mini App (via the /start flow), attach it - and their chat ID -
      // now and clean up the staging row. telegram_chat_id is ONLY ever
      // available from a real bot conversation (bot.js's contact
      // handler), never from the Mini App's initData, so this is one of
      // the two places (the other being an existing user's contact
      // share) it ever gets set.
      const { rows: pendingPhone } = await query(
        'SELECT phone, chat_id FROM pending_telegram_phones WHERE telegram_id = $1',
        [telegramId]
      );
      if (pendingPhone.length > 0) {
        await query('UPDATE users SET telegram_phone = $1, telegram_chat_id = $2 WHERE id = $3', [
          pendingPhone[0].phone,
          pendingPhone[0].chat_id,
          user.id,
        ]);
        await query('DELETE FROM pending_telegram_phones WHERE telegram_id = $1', [telegramId]);
        user.telegram_phone = pendingPhone[0].phone;
        user.telegram_chat_id = pendingPhone[0].chat_id;
      }
    } else {
      // Existing user - refresh their cached Telegram profile info in case
      // they changed their username/name/photo since last login.
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
        // Converted from cents to ETB here, same as wallet.js's
        // GET /api/wallet/balance - the frontend always displays ETB,
        // never raw cents, so every response that carries these fields
        // must divide by 100 before sending.
        balance: (user.balance || 0) / 100,
        bonus_balance: (user.bonus_balance || 0) / 100,
        wagering_required: (user.wagering_required || 0) / 100,
        wagering_target_total: (user.wagering_target_total || 0) / 100,
        telegram_first_name: tgUser.first_name || user.telegram_first_name,
        telegram_photo_url: tgUser.photo_url || user.telegram_photo_url,
        telegram_phone: user.telegram_phone || null,
        referral_code: user.referral_code || null,
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
      // Same cents -> ETB conversion as the login response above and as
      // wallet.js's GET /api/wallet/balance.
      balance: (req.user.balance || 0) / 100,
      bonus_balance: (req.user.bonus_balance || 0) / 100,
      wagering_required: (req.user.wagering_required || 0) / 100,
      wagering_target_total: (req.user.wagering_target_total || 0) / 100,
      telegram_first_name: req.user.telegram_first_name,
      telegram_photo_url: req.user.telegram_photo_url,
      telegram_phone: req.user.telegram_phone,
      referral_code: req.user.referral_code,
    },
  });
});

module.exports = { router, requireAuth, requireAdmin, signToken, verifyToken };
