const express = require('express');
const { query } = require('./database');
const { requireAuth } = require('./auth');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  GET /api/referral/stats                                            */
/*                                                                       */
/*  Returns the current user's referral link ingredients plus two       */
/*  numbers for the profile/referral pages:                             */
/*    - referred_count: how many users signed up with referred_by       */
/*      pointing at this user (regardless of whether they've deposited  */
/*      yet).                                                           */
/*    - total_commission: sum of every 'payout' transaction this user   */
/*      has received whose note starts with 'Referral commission' -     */
/*      i.e. the actual commission payouts credited by admin.js's       */
/*      deposit-approval flow, not a computed/estimated figure.         */
/* ------------------------------------------------------------------ */
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const [countRes, commissionRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [req.user.id]),
      query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
         FROM transactions
         WHERE user_id = $1 AND type = 'payout' AND status = 'completed' AND note LIKE 'Referral commission%'`,
        [req.user.id]
      ),
    ]);

    res.json({
      referred_count: countRes.rows[0].count,
      total_commission: Number(commissionRes.rows[0].total) / 100,
      referral_code: req.user.referral_code || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
