// backend/src/wallet.js

import { Router } from 'express'
import { db } from './database.js'
import { requireAuth, requireRole } from './auth-middleware.js'

const router = Router()

function isPositiveNumber(n) {
  return typeof n === 'number' && isFinite(n) && n > 0
}

// GET /api/wallet/balance — the caller's own wallet
router.get('/balance', requireAuth, async (req, res) => {
  const { data, error } = await db
    .from('wallets')
    .select('balance, currency')
    .eq('user_id', req.user.id)
    .single()

  if (error || !data) {
    return res.status(500).json({ error: 'Could not load wallet' })
  }

  res.json(data)
})

// GET /api/wallet/transactions — the caller's own transaction history
router.get('/transactions', requireAuth, async (req, res) => {
  const { data, error } = await db
    .from('transactions')
    .select('id, type, amount, balance_after, note, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return res.status(500).json({ error: 'Could not load transactions' })
  }

  res.json(data)
})

// POST /api/wallet/deposit-request
router.post('/deposit-request', requireAuth, async (req, res) => {
  const { amount, paymentReference, proofUrl } = req.body

  if (!isPositiveNumber(amount)) {
    return res.status(400).json({ error: 'A valid positive amount is required' })
  }

  const { data, error } = await db
    .from('deposit_requests')
    .insert({
      user_id: req.user.id,
      amount,
      payment_reference: paymentReference ?? null,
      proof_url: proofUrl ?? null,
    })
    .select()
    .single()

  if (error) {
    return res.status(500).json({ error: 'Could not create deposit request' })
  }

  res.status(201).json(data)
})

// POST /api/wallet/withdrawal-request
router.post('/withdrawal-request', requireAuth, async (req, res) => {
  const { amount, payoutDetails } = req.body

  if (!isPositiveNumber(amount)) {
    return res.status(400).json({ error: 'A valid positive amount is required' })
  }
  if (!payoutDetails || typeof payoutDetails !== 'string' || payoutDetails.trim().length < 3) {
    return res.status(400).json({ error: 'Payout details are required' })
  }

  // Check balance up front for a fast, friendly error — approve_withdrawal
  // re-checks atomically at approval time regardless.
  const { data: wallet } = await db
    .from('wallets')
    .select('balance')
    .eq('user_id', req.user.id)
    .single()

  if (!wallet || wallet.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' })
  }

  const { data, error } = await db
    .from('withdrawal_requests')
    .insert({
      user_id: req.user.id,
      amount,
      payout_details: payoutDetails.trim(),
    })
    .select()
    .single()

  if (error) {
    return res.status(500).json({ error: 'Could not create withdrawal request' })
  }

  res.status(201).json(data)
})

// ---- Agent / Admin endpoints ----

// GET /api/wallet/pending-requests — agents see only their assigned users' requests
router.get('/pending-requests', requireAuth, requireRole('agent', 'admin'), async (req, res) => {
  let depositQuery = db
    .from('deposit_requests')
    .select('id, user_id, amount, payment_reference, proof_url, status, created_at, profiles!inner(agent_id, full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  let withdrawalQuery = db
    .from('withdrawal_requests')
    .select('id, user_id, amount, payout_details, status, created_at, profiles!inner(agent_id, full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (req.user.role === 'agent') {
    depositQuery = depositQuery.eq('profiles.agent_id', req.user.id)
    withdrawalQuery = withdrawalQuery.eq('profiles.agent_id', req.user.id)
  }

  const [{ data: deposits, error: depErr }, { data: withdrawals, error: witErr }] = await Promise.all([
    depositQuery,
    withdrawalQuery,
  ])

  if (depErr || witErr) {
    return res.status(500).json({ error: 'Could not load pending requests' })
  }

  res.json({ deposits, withdrawals })
})

// POST /api/wallet/deposit-request/:id/approve
router.post('/deposit-request/:id/approve', requireAuth, requireRole('agent', 'admin'), async (req, res) => {
  const { error } = await db.rpc('approve_deposit', {
    p_request_id: req.params.id,
    p_reviewer_id: req.user.id,
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  res.json({ message: 'Deposit approved' })
})

// POST /api/wallet/deposit-request/:id/reject
router.post('/deposit-request/:id/reject', requireAuth, requireRole('agent', 'admin'), async (req, res) => {
  const { reason } = req.body

  // Agents may only act on their own assigned users — verify before rejecting
  // since there's no RPC guard here (rejection doesn't move money, but we
  // still don't want agents touching requests outside their scope).
  const { data: request } = await db
    .from('deposit_requests')
    .select('id, status, user_id, profiles!inner(agent_id)')
    .eq('id', req.params.id)
    .single()

  if (!request) return res.status(404).json({ error: 'Request not found' })
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' })

  if (req.user.role === 'agent' && request.profiles.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized for this user' })
  }

  const { error } = await db
    .from('deposit_requests')
    .update({
      status: 'rejected',
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason ?? null,
    })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'Could not reject request' })

  res.json({ message: 'Deposit rejected' })
})

// POST /api/wallet/withdrawal-request/:id/approve
router.post('/withdrawal-request/:id/approve', requireAuth, requireRole('agent', 'admin'), async (req, res) => {
  const { error } = await db.rpc('approve_withdrawal', {
    p_request_id: req.params.id,
    p_reviewer_id: req.user.id,
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  res.json({ message: 'Withdrawal approved' })
})

// POST /api/wallet/withdrawal-request/:id/reject
router.post('/withdrawal-request/:id/reject', requireAuth, requireRole('agent', 'admin'), async (req, res) => {
  const { reason } = req.body

  const { data: request } = await db
    .from('withdrawal_requests')
    .select('id, status, user_id, profiles!inner(agent_id)')
    .eq('id', req.params.id)
    .single()

  if (!request) return res.status(404).json({ error: 'Request not found' })
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' })

  if (req.user.role === 'agent' && request.profiles.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized for this user' })
  }

  const { error } = await db
    .from('withdrawal_requests')
    .update({
      status: 'rejected',
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason ?? null,
    })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'Could not reject request' })

  res.json({ message: 'Withdrawal rejected' })
})

export default router
