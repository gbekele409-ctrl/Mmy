const mongoose = require('mongoose');

/* ------------------------------------------------------------------ */
/*  Connection                                                         */
/* ------------------------------------------------------------------ */

async function connectDatabase() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set in environment variables');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);

  console.log(`[database] Connected to MongoDB: ${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => {
    console.error('[database] MongoDB connection error:', err);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[database] MongoDB disconnected');
  });
}

/* ------------------------------------------------------------------ */
/*  Schemas                                                             */
/* ------------------------------------------------------------------ */

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Stored in cents to avoid floating point rounding issues.
    balance: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const transactionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['deposit', 'withdraw', 'bet', 'payout'], required: true },
    amount: { type: Number, required: true, min: 0 }, // cents
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'], default: 'pending' },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, maxlength: 500, default: '' },
    round_id: { type: String, default: null },

    // --- Telebirr manual-transfer audit trail (deposit/withdraw only) ---
    // For deposits: the Telebirr transaction reference the USER says they
    // paid with, entered when submitting the request. Admin cross-checks
    // this against the actual Telebirr business account before approving.
    telebirr_reference_submitted: { type: String, trim: true, maxlength: 100, default: null },
    // For withdrawals: the Telebirr phone number the ADMIN should send
    // funds to, entered by the user when requesting a withdrawal.
    telebirr_phone: { type: String, trim: true, maxlength: 20, default: null },
    // For withdrawals: the Telebirr transaction reference the ADMIN used
    // when actually sending the money, entered at approval time. This is
    // the record that proves a real transfer occurred.
    telebirr_reference_admin: { type: String, trim: true, maxlength: 100, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const gameRoundSchema = new mongoose.Schema(
  {
    round_id: { type: String, required: true, unique: true },
    server_seed_hash: { type: String, required: true }, // published before round starts
    server_seed: { type: String, default: null }, // revealed after round ends (provably fair)
    crash_point: { type: Number, required: true }, // e.g. 2.35x
    started_at: { type: Date, default: Date.now },
    ended_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const betSchema = new mongoose.Schema(
  {
    round_id: { type: String, required: true, index: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 }, // cents
    cashed_out_at: { type: Number, default: null }, // multiplier at cashout
    payout: { type: Number, default: 0 }, // cents
    status: { type: String, enum: ['placed', 'cashed_out', 'lost'], default: 'placed' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
betSchema.index({ round_id: 1, user_id: 1 }, { unique: true });

/* ------------------------------------------------------------------ */
/*  Models                                                              */
/* ------------------------------------------------------------------ */

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const GameRound = mongoose.model('GameRound', gameRoundSchema);
const Bet = mongoose.model('Bet', betSchema);

module.exports = { connectDatabase, User, Transaction, GameRound, Bet, mongoose };
