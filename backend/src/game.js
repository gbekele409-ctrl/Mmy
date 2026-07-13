const express = require('express');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const { query, pool } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

/* ==================================================================== */
/*  PROVABLY-FAIR CRASH POINT GENERATION                                 */
/*  (unchanged from before - seed hash published before round starts,    */
/*  raw seed revealed after round ends for independent verification)     */
/* ==================================================================== */

const HOUSE_EDGE = 0.97;

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function seedToCrashPoint(seed) {
  const hash = sha256(seed);
  const int = parseInt(hash.slice(0, 13), 16);
  const maxInt = Math.pow(2, 52);
  const f = int / maxInt;
  if (f === 0) return 1.0;
  const raw = HOUSE_EDGE / (1 - f);
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

function generateRoundId() {
  return `RND-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/* ==================================================================== */
/*  ROUND STATE MACHINE                                                  */
/* ==================================================================== */

const BETTING_PHASE_MS = 8000;
const POST_ROUND_MS = 4000;
const TICK_MS = 100;
const MAX_SLOTS = 2; // dual bet slots per user per round

let currentRound = null;
let ioRef = null;
let roundTimer = null;

function currentMultiplier() {
  if (!currentRound || currentRound.phase !== 'flying') return 1.0;
  const elapsedSec = (Date.now() - currentRound.startedFlyingAt) / 1000;
  const m = 1 + 0.05 * elapsedSec + 0.02 * elapsedSec * elapsedSec;
  return Math.round(m * 100) / 100;
}

async function startBettingPhase() {
  const server_seed = crypto.randomBytes(32).toString('hex');
  const server_seed_hash = sha256(server_seed);
  const crash_point = seedToCrashPoint(server_seed);
  const round_id = generateRoundId();

  currentRound = { round_id, server_seed, server_seed_hash, crash_point, phase: 'betting', startedFlyingAt: null };

  await query(
    `INSERT INTO game_rounds (round_id, server_seed_hash, crash_point, started_at) VALUES ($1, $2, $3, now())`,
    [round_id, server_seed_hash, crash_point]
  );

  broadcast('round:betting', {
    round_id,
    server_seed_hash,
    betting_duration_ms: BETTING_PHASE_MS,
  });

  // Place auto-bets for anyone with auto-bet enabled on either slot.
  await placeAutoBets(round_id);

  roundTimer = setTimeout(startFlyingPhase, BETTING_PHASE_MS);
}

/**
 * Reads everyone's auto_bet_settings and places matching bets for this new
 * round, deducting balances the same way a manual bet would. Runs once at
 * the start of each betting phase, entirely server-side.
 */
async function placeAutoBets(round_id) {
  const { rows: settings } = await query('SELECT * FROM auto_bet_settings WHERE enabled = TRUE');

  for (const setting of settings) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [
        setting.user_id,
      ]);
      const user = userRows[0];
      if (!user || user.balance < setting.amount) {
        // Not enough balance - skip this slot silently, don't crash the round loop.
        await client.query('ROLLBACK');
        continue;
      }

      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [setting.amount, setting.user_id]);
      await client.query(
        `INSERT INTO bets (round_id, user_id, slot, amount, auto_cashout_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (round_id, user_id, slot) DO NOTHING`,
        [round_id, setting.user_id, setting.slot, setting.amount, setting.auto_cashout_at]
      );
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, round_id) VALUES ($1, 'bet', $2, 'completed', $3)`,
        [setting.user_id, setting.amount, round_id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[game] Failed to place auto-bet', { user_id: setting.user_id, error: err.message });
    } finally {
      client.release();
    }
  }
}

function startFlyingPhase() {
  currentRound.phase = 'flying';
  currentRound.startedFlyingAt = Date.now();

  broadcast('round:flying', { round_id: currentRound.round_id });

  const tick = setInterval(async () => {
    const m = currentMultiplier();

    if (m >= currentRound.crash_point) {
      clearInterval(tick);
      await endRound();
      return;
    }

    // Server-side auto-cashout: check every placed bet with an
    // auto_cashout_at target that the current multiplier has now reached.
    // This runs on the server's own tick, never trusting client timing.
    await processAutoCashouts(m);

    broadcast('round:tick', { round_id: currentRound.round_id, multiplier: m });
  }, TICK_MS);
}

/**
 * Finds bets in the current round that are still 'placed', have a
 * non-null auto_cashout_at, and whose target the current multiplier has
 * reached or passed - then cashes them out exactly as a manual cashout
 * would, crediting balance and recording the transaction.
 */
async function processAutoCashouts(multiplier) {
  const { rows: dueBets } = await query(
    `SELECT * FROM bets
     WHERE round_id = $1 AND status = 'placed' AND auto_cashout_at IS NOT NULL AND auto_cashout_at <= $2`,
    [currentRound.round_id, multiplier]
  );

  for (const bet of dueBets) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Re-check status under lock in case of a race with a manual cashout.
      const { rows: lockedBetRows } = await client.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [bet.id]);
      const lockedBet = lockedBetRows[0];
      if (!lockedBet || lockedBet.status !== 'placed') {
        await client.query('ROLLBACK');
        continue;
      }

      const cashoutMultiplier = Number(lockedBet.auto_cashout_at);
      const payoutCents = Math.round(lockedBet.amount * cashoutMultiplier);

      await client.query(
        `UPDATE bets SET status = 'cashed_out', cashed_out_at = $1, payout = $2 WHERE id = $3`,
        [cashoutMultiplier, payoutCents, lockedBet.id]
      );
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payoutCents, lockedBet.user_id]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status, round_id) VALUES ($1, 'payout', $2, 'completed', $3)`,
        [lockedBet.user_id, payoutCents, currentRound.round_id]
      );

      await client.query('COMMIT');

      broadcast('bet:auto_cashed_out', {
        round_id: currentRound.round_id,
        user_id: lockedBet.user_id,
        slot: lockedBet.slot,
        multiplier: cashoutMultiplier,
        payout: payoutCents / 100,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[game] Auto-cashout failed', { betId: bet.id, error: err.message });
    } finally {
      client.release();
    }
  }
}

async function endRound() {
  currentRound.phase = 'ended';

  await query(`UPDATE bets SET status = 'lost', payout = 0 WHERE round_id = $1 AND status = 'placed'`, [
    currentRound.round_id,
  ]);

  await query(`UPDATE game_rounds SET server_seed = $1, ended_at = now() WHERE round_id = $2`, [
    currentRound.server_seed,
    currentRound.round_id,
  ]);

  broadcast('round:crashed', {
    round_id: currentRound.round_id,
    crash_point: currentRound.crash_point,
    server_seed: currentRound.server_seed,
    server_seed_hash: currentRound.server_seed_hash,
  });

  roundTimer = setTimeout(startBettingPhase, POST_ROUND_MS);
}

function broadcast(event, payload) {
  if (ioRef) ioRef.emit(event, payload);
}

function attachSocket(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    if (currentRound) {
      socket.emit(`round:${currentRound.phase}`, {
        round_id: currentRound.round_id,
        server_seed_hash: currentRound.server_seed_hash,
        ...(currentRound.phase === 'flying' ? { multiplier: currentMultiplier() } : {}),
      });
    }
  });

  if (!currentRound) startBettingPhase();
}

/* ==================================================================== */
/*  HTTP ROUTES                                                          */
/* ==================================================================== */

const betValidation = [
  body('amount').isFloat({ gt: 0, max: 1000000 }).withMessage('Amount must be a positive number'),
  body('slot').isInt({ min: 1, max: MAX_SLOTS }).withMessage(`Slot must be 1 or ${MAX_SLOTS}`),
  body('auto_cashout_at')
    .optional({ nullable: true })
    .isFloat({ gt: 1.0, max: 10000 })
    .withMessage('Auto-cashout target must be greater than 1.00x'),
];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

// POST /api/game/bet - place a bet in a given slot (1 or 2) during betting phase
router.post('/bet', requireAuth, betValidation, handleValidation, async (req, res, next) => {
  try {
    if (!currentRound || currentRound.phase !== 'betting') {
      return res.status(400).json({ error: 'Betting is closed for this round' });
    }

    const amountCents = Math.round(Number(req.body.amount) * 100);
    const slot = parseInt(req.body.slot, 10);
    const autoCashoutAt = req.body.auto_cashout_at ? Number(req.body.auto_cashout_at) : null;

    const { rows: userRows } = await query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (!userRows[0] || userRows[0].balance < amountCents) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const existing = await query('SELECT id FROM bets WHERE round_id = $1 AND user_id = $2 AND slot = $3', [
      currentRound.round_id,
      req.user.id,
      slot,
    ]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `You already placed a bet in slot ${slot} this round` });
    }

    const { rows: updatedRows } = await query('UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance', [
      amountCents,
      req.user.id,
    ]);

    await query(
      `INSERT INTO bets (round_id, user_id, slot, amount, auto_cashout_at) VALUES ($1, $2, $3, $4, $5)`,
      [currentRound.round_id, req.user.id, slot, amountCents, autoCashoutAt]
    );
    await query(
      `INSERT INTO transactions (user_id, type, amount, status, round_id) VALUES ($1, 'bet', $2, 'completed', $3)`,
      [req.user.id, amountCents, currentRound.round_id]
    );

    res.status(201).json({
      message: 'Bet placed',
      round_id: currentRound.round_id,
      slot,
      balance: updatedRows[0].balance / 100,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/game/cashout - manually cash out a specific slot during flying phase
const cashoutValidation = [body('slot').isInt({ min: 1, max: MAX_SLOTS }).withMessage(`Slot must be 1 or ${MAX_SLOTS}`)];

router.post('/cashout', requireAuth, cashoutValidation, handleValidation, async (req, res, next) => {
  try {
    if (!currentRound || currentRound.phase !== 'flying') {
      return res.status(400).json({ error: 'No active round to cash out from' });
    }

    const slot = parseInt(req.body.slot, 10);

    const { rows: betRows } = await query('SELECT * FROM bets WHERE round_id = $1 AND user_id = $2 AND slot = $3', [
      currentRound.round_id,
      req.user.id,
      slot,
    ]);
    const bet = betRows[0];
    if (!bet || bet.status !== 'placed') {
      return res.status(400).json({ error: 'No active bet in that slot to cash out' });
    }

    const multiplier = currentMultiplier();
    if (multiplier >= currentRound.crash_point) {
      return res.status(400).json({ error: 'Too late - round already crashed' });
    }

    const payoutCents = Math.round(bet.amount * multiplier);

    await query(`UPDATE bets SET status = 'cashed_out', cashed_out_at = $1, payout = $2 WHERE id = $3`, [
      multiplier,
      payoutCents,
      bet.id,
    ]);

    const { rows: updatedRows } = await query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [
      payoutCents,
      req.user.id,
    ]);

    await query(
      `INSERT INTO transactions (user_id, type, amount, status, round_id) VALUES ($1, 'payout', $2, 'completed', $3)`,
      [req.user.id, payoutCents, currentRound.round_id]
    );

    res.json({
      message: 'Cashed out',
      slot,
      multiplier,
      payout: payoutCents / 100,
      balance: updatedRows[0].balance / 100,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/my-bets - the current user's bets for the active round (both slots)
router.get('/my-bets', requireAuth, async (req, res, next) => {
  try {
    if (!currentRound) return res.json({ round_id: null, bets: [] });

    const { rows } = await query('SELECT * FROM bets WHERE round_id = $1 AND user_id = $2 ORDER BY slot', [
      currentRound.round_id,
      req.user.id,
    ]);

    res.json({
      round_id: currentRound.round_id,
      bets: rows.map((b) => ({
        slot: b.slot,
        amount: b.amount / 100,
        status: b.status,
        auto_cashout_at: b.auto_cashout_at ? Number(b.auto_cashout_at) : null,
        cashed_out_at: b.cashed_out_at ? Number(b.cashed_out_at) : null,
        payout: b.payout / 100,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Auto-bet-next-round settings (per slot)                             */
/* ------------------------------------------------------------------ */

const autoBetValidation = [
  param('slot').isInt({ min: 1, max: MAX_SLOTS }),
  body('enabled').isBoolean(),
  body('amount').isFloat({ gt: 0, max: 1000000 }).withMessage('Amount must be a positive number'),
  body('auto_cashout_at')
    .optional({ nullable: true })
    .isFloat({ gt: 1.0, max: 10000 })
    .withMessage('Auto-cashout target must be greater than 1.00x'),
];

// PUT /api/game/auto-bet/:slot - enable/disable and configure auto-bet-next-round for a slot
router.put('/auto-bet/:slot', requireAuth, autoBetValidation, handleValidation, async (req, res, next) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    const amountCents = Math.round(Number(req.body.amount) * 100);
    const autoCashoutAt = req.body.auto_cashout_at ? Number(req.body.auto_cashout_at) : null;

    await query(
      `INSERT INTO auto_bet_settings (user_id, slot, enabled, amount, auto_cashout_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, slot)
       DO UPDATE SET enabled = $3, amount = $4, auto_cashout_at = $5`,
      [req.user.id, slot, req.body.enabled, amountCents, autoCashoutAt]
    );

    res.json({ message: 'Auto-bet settings saved', slot, enabled: req.body.enabled });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/auto-bet - fetch the user's current auto-bet settings for both slots
router.get('/auto-bet', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM auto_bet_settings WHERE user_id = $1 ORDER BY slot', [req.user.id]);
    res.json({
      settings: rows.map((s) => ({
        slot: s.slot,
        enabled: s.enabled,
        amount: s.amount / 100,
        auto_cashout_at: s.auto_cashout_at ? Number(s.auto_cashout_at) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/history
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT round_id, crash_point, ended_at FROM game_rounds WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 20`
    );
    res.json({ rounds: rows.map((r) => ({ ...r, crash_point: Number(r.crash_point) })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/verify/:round_id
router.get('/verify/:round_id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM game_rounds WHERE round_id = $1', [req.params.round_id]);
    const round = rows[0];
    if (!round || !round.server_seed) {
      return res.status(404).json({ error: 'Round not found or not yet completed' });
    }
    const recomputedHash = sha256(round.server_seed);
    const recomputedCrash = seedToCrashPoint(round.server_seed);
    const storedCrash = Number(round.crash_point);

    res.json({
      round_id: round.round_id,
      server_seed: round.server_seed,
      server_seed_hash: round.server_seed_hash,
      crash_point: storedCrash,
      hash_matches: recomputedHash === round.server_seed_hash,
      crash_point_matches: recomputedCrash === storedCrash,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, attachSocket };
