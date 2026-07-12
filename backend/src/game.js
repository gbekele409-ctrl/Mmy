const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { User, Transaction, GameRound, Bet } = require('./database');
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
/*     Because the hash was published up front, the server cannot change  */
/*     the seed after seeing bets ("nothing up my sleeve").               */
/*                                                                        */
/*  ALL game logic lives here, server-side. The client only ever          */
/*  displays state pushed to it - it cannot influence or predict the      */
/*  crash point before it happens.                                        */
/* ==================================================================== */

const HOUSE_EDGE = 0.97; // 3% house edge, tune as needed

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Converts a hex seed into a crash multiplier >= 1.00.
// Standard "provably fair crash game" formula: derive a uniform float from
// the seed, then map it through 1 / (1 - f), scaled by the house edge.
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

  await GameRound.create({
    round_id,
    server_seed_hash,
    crash_point, // stored now, but never sent to clients until round ends
    started_at: new Date(),
  });

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
  await Bet.updateMany(
    { round_id: currentRound.round_id, status: 'placed' },
    { $set: { status: 'lost', payout: 0 } }
  );

  await GameRound.updateOne(
    { round_id: currentRound.round_id },
    { $set: { server_seed: currentRound.server_seed, ended_at: new Date() } }
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

    const user = await User.findById(req.user._id);
    if (user.balance < amountCents) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const existingBet = await Bet.findOne({ round_id: currentRound.round_id, user_id: user._id });
    if (existingBet) {
      return res.status(400).json({ error: 'You already placed a bet this round' });
    }

    user.balance -= amountCents;
    await user.save();

    await Bet.create({ round_id: currentRound.round_id, user_id: user._id, amount: amountCents });
    await Transaction.create({
      user_id: user._id,
      type: 'bet',
      amount: amountCents,
      status: 'completed',
      round_id: currentRound.round_id,
    });

    res.status(201).json({ message: 'Bet placed', round_id: currentRound.round_id, balance: user.balance / 100 });
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

    const bet = await Bet.findOne({ round_id: currentRound.round_id, user_id: req.user._id });
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

    bet.status = 'cashed_out';
    bet.cashed_out_at = multiplier;
    bet.payout = payoutCents;
    await bet.save();

    const user = await User.findById(req.user._id);
    user.balance += payoutCents;
    await user.save();

    await Transaction.create({
      user_id: user._id,
      type: 'payout',
      amount: payoutCents,
      status: 'completed',
      round_id: currentRound.round_id,
    });

    res.json({ message: 'Cashed out', multiplier, payout: payoutCents / 100, balance: user.balance / 100 });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/history - recent completed rounds (for the multiplier history strip)
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const rounds = await GameRound.find({ ended_at: { $ne: null } })
      .sort({ ended_at: -1 })
      .limit(20)
      .select('round_id crash_point ended_at -_id');
    res.json({ rounds });
  } catch (err) {
    next(err);
  }
});

// GET /api/game/verify/:round_id - lets anyone verify a past round's fairness
router.get('/verify/:round_id', requireAuth, async (req, res, next) => {
  try {
    const round = await GameRound.findOne({ round_id: req.params.round_id });
    if (!round || !round.server_seed) {
      return res.status(404).json({ error: 'Round not found or not yet completed' });
    }
    const recomputedHash = sha256(round.server_seed);
    const recomputedCrash = seedToCrashPoint(round.server_seed);

    res.json({
      round_id: round.round_id,
      server_seed: round.server_seed,
      server_seed_hash: round.server_seed_hash,
      crash_point: round.crash_point,
      hash_matches: recomputedHash === round.server_seed_hash,
      crash_point_matches: recomputedCrash === round.crash_point,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, attachSocket };
