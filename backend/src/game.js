const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { query } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

/* ==================================================================== */
/*  PROVABLY-FAIR CRASH POINT GENERATION                                 */
/*                                                                        */
/*  1. Server generates a random seed BEFORE the round starts and         */
/*     publishes only its SHA-256 hash (server_seed_hash) to clients.     */
/*  2. The crash multiplier is derived deterministically from that seed.  */
/*  3. After the round ends, the raw seed is revealed so anyone can       */
/*     recompute the multiplier and verify it matches what was played.    */
/*                                                                        */
/*  ALL game logic lives here, server-side. The client only ever          */
/*  displays state pushed to it - it cannot influence or predict the      */
/*  crash point before it happens.                                        */
/* ==================================================================== */

const HOUSE_EDGE = 0.97; // 3% house edge, tune as needed

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function seedToCrashPoint(seed) {
  const hash = sha256(seed);
  const int = parseInt(hash.slice(0, 13), 16); // first 52 bits
  const maxInt = Math.pow(2, 52);
  const f = int / maxInt; // uniform float in [0, 1)

  if (f === 0) return 1.0;

  const raw = HOUSE_EDGE / (1 - f);
  const crash = Math.max(1.0, Math.floor(raw * 100) / 100);
  return crash;
}

function generateRoundId() {
  return `RND-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/* ==================================================================== */
/*  ROUND STATE MACHINE                                                  */
/*  Phases: betting (8s) -> flying (until crash) -> ended (4s) -> repeat  */
/*  Round state itself stays in-memory (single-process); only completed   */
/*  round/bet records are persisted to Postgres.                          */
/* ==================================================================== */

const BETTING_PHASE_MS = 8000;
const POST_ROUND_MS = 4000;
const TICK_MS = 100;

let currentRound = null; // { round_id, server_seed, server_seed_hash, crash_point, phase, startedFlyingAt }
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
    `INSERT INTO game_rounds (round_id, server_seed_hash, crash_point, started_at)
     VALUES ($1, $2, $3, now())`,
    [round_id, server_seed_hash, crash_point]
  );

  broadcast('round:betting', {
    round_id,
    server_seed_hash, // published up front so it can be verified after reveal
    betting_duration_ms: BETTING_PHASE_MS,
  });

  roundTimer = setTimeout(startFlyingPhase, BETTING_PHASE_MS);
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

    broadcast('round:tick', { round_id: currentRound.round_id, multiplier: m });
  }, TICK_MS);
}

async function endRound() {
  currentRound.phase = 'ended';

  // Anyone who didn't cash out before the crash loses their bet.
  await query(
    `UPDATE bets SET status = 'lost', payout = 0 WHERE round_id = $1 AND status = 'placed'`,
    [currentRound.round_id]
  );

  await query(
    `UPDATE game_rounds SET server_seed = $1, ended_at = now() WHERE round_id = $2`,
    [currentRound.server_seed, currentRound.round_id]
  );

  broadcast('round:crashed', {
    round_id: currentRound.round_id,
    crash_point: currentRound.crash_point,
    server_seed: currentRound.server_seed, // reveal seed now for public verification
    server_seed_hash: currentRound.server_seed_hash,
  });

  roundTimer = setTimeout(startBettingPhase, POST_ROUND_MS);
}

function broadcast(event, payload) {
  if (ioRef) ioRef.emit(event, payload);
}

/**
 * Wires up the Socket.IO server instance and kicks off the round loop.
 * Called once from server.js after the HTTP server is created.
 */
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
/*  HTTP ROUTES - placing bets & cashing out                             */
/*  The client only ever sends "place bet" / "cash out now" - it never   */
/*  sends a multiplier or outcome. All results are resolved against      */
/*  server-held state (currentRound), never trusting the client.         */
/* ==================================================================== */

const betValidation = [body('amount').isFloat({ gt: 0, max: 1000000 }).withMessage('Amount must be a positive number')];

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

// POST /api/game/bet - place a bet during the betting phase
router.post('/bet', requireAuth, betValidation, handleValidation, async (req, res, next) => {
  try {
    if (!currentRound || currentRound.phase !== 'betting') {
      return res.status(400).json({ error: 'Betting is closed for this round' });
    }

    const amountCents = Math.round(Number(req.body.amount) * 100);

    const { rows: userRows } = await query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (!userRows[0] || userRows[0].balance < amountCents) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const existing = await query(
      'SELECT id FROM bets WHERE round_id = $1 AND user_id = $2',
      [currentRound.round_id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already placed a bet this round' });
    }

    const { rows: updatedRows } = await query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [amountCents, req.user.id]
    );

    await query(
      'INSERT INTO bets (round_id, user_id, amount) VALUES ($1, $2, $3)',
      [currentRound.round_id, req.user.id, amountCents]
    );
    await query(
      `INSERT INTO transactions (user_id, type, amount, status, round_id)
       VALUES ($1, 'bet', $2, 'completed', $3)`,
      [req.user.id, amountCents, currentRound.round_id]
    );

    res.status(201).json({
      message: 'Bet placed',
      round_id: currentRound.round_id,
      balance: updatedRows[0].balance / 100,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/game/cashout - cash out during the flying phase
router.post('/cashout', requireAuth, async (req, res, next) => {
  try {
    if (!currentRound || currentRound.phase !== 'flying') {
      return res.status(400).json({ error: 'No active round to cash out from' });
    }

    const { rows: betRows } = await query(
      'SELECT * FROM bets WHERE round_id = $1 AND user_id = $2',
      [currentRound.round_id, req.user.id]
    );
    const bet = betRows[0];
    if (!bet || bet.status !== 'placed') {
      return res.status(400).json({ error: 'No active bet to cash out' });
    }

    const multiplier = currentMultiplier();
    // If our computed multiplier has already reached the (not-yet-revealed)
    // crash point, the round crashed a tick before this request arrived.
    if (multiplier >= currentRound.crash_point) {
      return res.status(400).json({ error: 'Too late - round already crashed' });
    }

    const payoutCents = Math.round(bet.amount * multiplier);

    await query(
      `UPDATE bets SET status = 'cashed_out', cashed_out_at = $1, payout = $2 WHERE id = $3`,
      [multiplier, payoutCents, bet.id]
    );

    const { rows: updatedRows } = await query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [payoutCents, req.user.id]
    );

    await query(
      `INSERT INTO transactions (user_id, type, amount, status, round_id)
       VALUES ($1, 'payout', $2, 'completed', $3)`,
      [req.user.id, payoutCents, currentRound.round_id]
    );

    res.json({
      message: 'Cashed out',
      multiplier,
      payout: payoutCents / 100,
      balance: updatedRows[0].balance / 100,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/history - recent completed rounds (for the multiplier history strip)
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT round_id, crash_point, ended_at FROM game_rounds
       WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 20`
    );
    res.json({ rounds: rows.map((r) => ({ ...r, crash_point: Number(r.crash_point) })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/verify/:round_id - lets anyone verify a past round's fairness
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
