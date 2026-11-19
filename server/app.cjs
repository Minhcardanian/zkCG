const express = require('express');
const crypto = require('node:crypto');
const { z } = require('zod');
const { loadGroup } = require('./group.cjs');
const { createAuth } = require('./auth.cjs');

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const input = z.object({ commitment: z.string().regex(/^[0-9]{1,77}$/), reference: z.string().trim().min(1).max(100), age: z.number().int().min(0).max(130), jurisdiction: z.string().trim().min(2).max(2).transform(v => v.toUpperCase()), screeningClear: z.boolean() }).strict();

function createApp({ pool, gate, issuerAddresses, chainId, gateAddress }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const auth=createAuth({pool,issuerAddresses,chainId,gateAddress});
  const admin=[auth.authenticate,auth.requireRole('issuer')];
  app.get('/api/auth/config',auth.config);
  app.post('/api/auth/challenge',auth.challenge);
  app.post('/api/auth/verify',auth.verify);
  app.post('/api/auth/logout',auth.authenticate,auth.logout);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/applications', auth.authenticate, auth.requireRole('participant'), async (req, res, next) => {
    try {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid synthetic application' });
      const { commitment, reference, age, jurisdiction, screeningClear } = parsed.data;
      const c = BigInt(commitment);
      if (c <= 0n || c >= FIELD) return res.status(400).json({ error: 'Invalid commitment' });
      const decision = age >= 18 && jurisdiction === 'VN' && screeningClear ? 'approved' : 'rejected';
      const id = crypto.randomUUID();
      await pool.query('INSERT INTO applications (id, commitment, reference, synthetic_age, synthetic_jurisdiction, synthetic_screening_clear, decision) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, c.toString(), reference, age, jurisdiction, screeningClear, decision]);
      res.status(201).json({ id, decision });
    } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Commitment already submitted' }); next(error); }
  });
  app.get('/api/admin/applications', admin, async (_req, res, next) => {
    try { const { rows } = await pool.query('SELECT id, commitment, reference, synthetic_age, synthetic_jurisdiction, synthetic_screening_clear, decision, created_at FROM applications ORDER BY created_at DESC'); res.json(rows); } catch (e) { next(e); }
  });
  app.get('/api/admin/operations', admin, async (_req, res, next) => {
    try { const { rows } = await pool.query('SELECT o.*, a.reference FROM operations o JOIN applications a ON a.id=o.application_id ORDER BY o.created_at DESC'); res.json(rows); } catch (e) { next(e); }
  });
  app.post('/api/admin/applications/:id/:action(approve|revoke)', admin, async (req, res, next) => {
    let operationId;
    try {
      const result = await pool.query('SELECT id, commitment, decision FROM applications WHERE id = $1', [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Application not found' });
      const application = result.rows[0];
      if (application.decision !== 'approved') return res.status(409).json({ error: 'Screening rejected' });
      const revoking = req.params.action === 'revoke';
      const isApproved = await gate.approved(application.commitment);
      if (isApproved !== revoking) return res.status(409).json({ error: revoking ? 'Identity is not currently approved' : 'Identity is already approved' });
      let siblings;
      if (revoking) {
        const group = await loadGroup(gate);
        const index = group.indexOf(application.commitment);
        if (index < 0) return res.status(409).json({ error: 'Commitment missing from current group' });
        siblings = group.generateMerkleProof(index).siblings;
      }
      operationId = crypto.randomUUID();
      await pool.query("INSERT INTO operations (id, application_id, kind, status, actor_wallet) VALUES ($1,$2,$3,'preparing',$4)", [operationId, application.id, revoking ? 'revocation' : 'approval',req.user.address]);
      try {
        const tx = revoking ? await gate.revokeIdentity(application.commitment, siblings) : await gate.approveIdentity(application.commitment);
        await pool.query("UPDATE operations SET status='pending', tx_hash=$2, updated_at=now() WHERE id=$1", [operationId, tx.hash]);
        res.status(202).json({ operationId, status: 'pending', txHash: tx.hash });
      } catch (error) {
        // A send failure can occur after broadcast; require manual reconciliation before retry.
        await pool.query("UPDATE operations SET status='unknown', error=$2, updated_at=now() WHERE id=$1", [operationId, 'Transaction submission outcome uncertain']);
        res.status(503).json({ operationId, status: 'unknown', error: 'Submission outcome uncertain; reconcile before retry' });
      }
    } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'An unresolved operation already exists' }); next(error); }
  });
  app.post('/api/admin/operations/:id/attach', admin, async (req, res, next) => {
    try {
      const parsed = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid transaction hash' });
      const { rows } = await pool.query('SELECT o.*, a.commitment FROM operations o JOIN applications a ON a.id=o.application_id WHERE o.id=$1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Operation not found' });
      const op = rows[0];
      if (!['unknown', 'preparing'].includes(op.status) || op.tx_hash) return res.status(409).json({ error: 'Operation cannot accept a transaction hash' });
      const tx = await gate.runner.provider.getTransaction(parsed.data.txHash);
      if (!tx) return res.status(404).json({ error: 'Transaction not found on this chain' });
      let call;
      try { call = gate.interface.parseTransaction({ data: tx.data, value: tx.value }); } catch { return res.status(400).json({ error: 'Transaction does not match the operation' }); }
      const expectedMethod = op.kind === 'approval' ? 'approveIdentity' : 'revokeIdentity';
      if (!tx.to || tx.to.toLowerCase() !== (await gate.getAddress()).toLowerCase() || tx.from.toLowerCase() !== (await gate.issuer()).toLowerCase() || !call || call.name !== expectedMethod || call.args[0].toString() !== op.commitment) return res.status(400).json({ error: 'Transaction does not match the operation' });
      const updated = await pool.query("UPDATE operations SET tx_hash=$2, status='pending', updated_at=now() WHERE id=$1 AND status IN ('unknown','preparing') AND tx_hash IS NULL RETURNING id", [op.id, tx.hash]);
      if (!updated.rows.length) return res.status(409).json({ error: 'Operation changed; refresh before retrying' });
      res.json({ status: 'pending', txHash: tx.hash });
    } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Transaction is already attached' }); next(error); }
  });
  app.post('/api/admin/operations/:id/reconcile', admin, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM operations WHERE id=$1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Operation not found' });
      const op = rows[0];
      if (!op.tx_hash) return res.status(409).json({ error: 'No transaction hash; manual chain investigation required' });
      const receipt = await gate.runner.provider.getTransactionReceipt(op.tx_hash);
      if (!receipt) return res.json({ status: op.status });
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      await pool.query('UPDATE operations SET status=$2, updated_at=now() WHERE id=$1', [op.id, status]);
      res.json({ status, txHash: op.tx_hash });
    } catch (e) { next(e); }
  });
  app.use((error, _req, res, _next) => { console.error('Request failed:', error.code || error.name); res.status(500).json({ error: 'Internal error' }); });
  return app;
}
module.exports = { createApp };
