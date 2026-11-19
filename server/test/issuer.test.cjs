const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../app.cjs');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://zkcg:local-dev-only@127.0.0.1:55432/zkcg' });
const { ethers } = require('ethers');
const issuerWallet = ethers.Wallet.createRandom();
const participantWallet = ethers.Wallet.createRandom();
const config = {issuerAddresses:[issuerWallet.address],chainId:'31337',gateAddress:ethers.ZeroAddress};
async function login(app,wallet) {
  const c=await request(app).post('/api/auth/challenge').set('Host','localhost:3000').send({address:wallet.address}).expect(200);
  const r=await request(app).post('/api/auth/verify').set('Host','localhost:3000').send({id:c.body.id,signature:await wallet.signMessage(c.body.message)}).expect(200);
  return {Authorization:`Bearer ${r.body.token}`};
}
after(async () => {
  const addresses=[issuerWallet.address.toLowerCase(),participantWallet.address.toLowerCase()];
  await pool.query('DELETE FROM auth_sessions WHERE wallet_address=ANY($1::text[])',[addresses]);
  await pool.query('DELETE FROM auth_challenges WHERE wallet_address=ANY($1::text[])',[addresses]);
  await pool.end();
});
test('issuer workflow keeps screening and chain confirmation distinct', async () => {
  await pool.query(fs.readFileSync('server/schema.sql', 'utf8'));
  const hash = `0x${'ab'.repeat(32)}`;
  let calls = 0;
  const gate = { approved: async () => false, approveIdentity: async () => { calls++; return { hash }; }, runner: { provider: { getTransactionReceipt: async () => ({ status: 1 }) } } };
  const app = createApp({ pool, gate, ...config });
  const auth = await login(app,issuerWallet);
  const userAuth = await login(app,participantWallet);
  const reference = randomUUID();
  const commitment = BigInt('0x' + require('node:crypto').randomBytes(20).toString('hex')).toString();
  const submitted = await request(app).post('/api/applications').set(userAuth).send({ commitment, reference, age: 20, jurisdiction: 'VN', screeningClear: true }).expect(201);
  assert.equal(submitted.body.decision, 'approved');
  await request(app).get('/api/admin/applications').expect(401);
  await request(app).get('/api/admin/operations').expect(401);
  await request(app).post(`/api/admin/applications/${submitted.body.id}/approve`).expect(401);
  await request(app).post(`/api/admin/applications/${submitted.body.id}/revoke`).expect(401);
  assert.equal(calls, 0, 'unauthenticated requests must not submit chain operations');
  const pending = await request(app).post(`/api/admin/applications/${submitted.body.id}/approve`).set(auth).expect(202);
  assert.equal(pending.body.status, 'pending');
  await request(app).post(`/api/admin/applications/${submitted.body.id}/approve`).set(auth).expect(409);
  assert.equal(calls, 1);
  const confirmed = await request(app).post(`/api/admin/operations/${pending.body.operationId}/reconcile`).set(auth).expect(200);
  assert.equal(confirmed.body.status, 'confirmed');
  const history=await request(app).get('/api/admin/operations').set(auth).expect(200);
  assert.equal(history.body.find(op=>op.id===pending.body.operationId).actor_wallet,issuerWallet.address.toLowerCase());
  const rejected = await request(app).post('/api/applications').set(userAuth).send({ commitment: (BigInt(commitment) + 1n).toString(), reference, age: 17, jurisdiction: 'VN', screeningClear: true }).expect(201);
  assert.equal(rejected.body.decision, 'rejected');
  await request(app).post(`/api/admin/applications/${rejected.body.id}/approve`).set(auth).expect(409);
  assert.equal(calls, 1);
  await pool.query('DELETE FROM operations WHERE application_id=$1', [submitted.body.id]);
  await pool.query('DELETE FROM applications WHERE id=ANY($1::uuid[])', [[submitted.body.id, rejected.body.id]]);
});

test('uncertain submission is recorded and cannot be retried automatically', async () => {
  await pool.query(fs.readFileSync('server/schema.sql', 'utf8'));
  let calls = 0;
  const iface = new ethers.Interface(require('../../artifacts/contracts/ComplianceGate.sol/ComplianceGate.json').abi);
  const gateAddress = '0x0000000000000000000000000000000000000011';
  const issuer = '0x0000000000000000000000000000000000000022';
  let transaction;
  const gate = { approved: async () => false, approveIdentity: async () => { calls++; throw new Error('connection lost after possible broadcast'); }, interface: iface, getAddress: async () => gateAddress, issuer: async () => issuer, runner: { provider: { getTransaction: async () => transaction, getTransactionReceipt: async () => ({status:1}) } } };
  const app = createApp({ pool, gate, ...config });
  const auth = await login(app,issuerWallet);
  const userAuth = await login(app,participantWallet);
  const commitment = BigInt('0x' + require('node:crypto').randomBytes(20).toString('hex')).toString();
  const created = await request(app).post('/api/applications').set(userAuth).send({ commitment, reference: randomUUID(), age: 30, jurisdiction: 'VN', screeningClear: true }).expect(201);
  const id = created.body.id;
  try {
    const unknown = await request(app).post(`/api/admin/applications/${id}/approve`).set(auth).expect(503);
    assert.equal(unknown.body.status, 'unknown');
    const operation = await pool.query('SELECT status, tx_hash FROM operations WHERE id=$1', [unknown.body.operationId]);
    assert.equal(operation.rows[0].status, 'unknown');
    assert.equal(operation.rows[0].tx_hash, null);
    await request(app).post(`/api/admin/applications/${id}/approve`).set(auth).expect(409);
    await request(app).post(`/api/admin/operations/${unknown.body.operationId}/reconcile`).set(auth).expect(409);
    assert.equal(calls, 1);
    const txHash = `0x${'cd'.repeat(32)}`;
    transaction = { hash: txHash, to: gateAddress, from: issuer, value: 0n, data: iface.encodeFunctionData('approveIdentity', [BigInt(commitment) + 1n]) };
    await request(app).post(`/api/admin/operations/${unknown.body.operationId}/attach`).set(auth).send({ txHash }).expect(400);
    transaction.data = iface.encodeFunctionData('approveIdentity', [commitment]);
    await request(app).post(`/api/admin/operations/${unknown.body.operationId}/attach`).set(auth).send({ txHash }).expect(200);
    await request(app).post(`/api/admin/operations/${unknown.body.operationId}/reconcile`).set(auth).expect(200).expect(({body}) => assert.equal(body.status, 'confirmed'));
  } finally {
    await pool.query('DELETE FROM operations WHERE application_id=$1', [id]);
    await pool.query('DELETE FROM applications WHERE id=$1', [id]);
  }
});

test('a reverted issuer transaction is recorded as failed', async () => {
  await pool.query(fs.readFileSync('server/schema.sql', 'utf8'));
  const gate = {
    approved: async () => false,
    approveIdentity: async () => ({hash: `0x${'ef'.repeat(32)}`}),
    runner: {provider: {getTransactionReceipt: async () => ({status: 0})}},
  };
  const app = createApp({pool, gate, ...config});
  const auth = await login(app,issuerWallet);
  const userAuth = await login(app,participantWallet);
  const commitment = BigInt('0x' + require('node:crypto').randomBytes(20).toString('hex')).toString();
  const created = await request(app).post('/api/applications').set(userAuth).send({commitment, reference: randomUUID(), age: 20, jurisdiction: 'VN', screeningClear: true}).expect(201);
  try {
    const pending = await request(app).post(`/api/admin/applications/${created.body.id}/approve`).set(auth).expect(202);
    const result = await request(app).post(`/api/admin/operations/${pending.body.operationId}/reconcile`).set(auth).expect(200);
    assert.equal(result.body.status, 'failed');
    const operations = await request(app).get('/api/admin/operations').set(auth).expect(200);
    assert.equal(operations.body.find(op => op.id === pending.body.operationId).status, 'failed');
  } finally {
    await pool.query('DELETE FROM operations WHERE application_id=$1', [created.body.id]);
    await pool.query('DELETE FROM applications WHERE id=$1', [created.body.id]);
  }
});

test('wallet sessions enforce roles, origin, expiry, replay and logout', async () => {
  await pool.query(fs.readFileSync('server/schema.sql', 'utf8'));
  const app=createApp({pool,gate:{},...config});
  const host={'Host':'localhost:3000'};
  const c=await request(app).post('/api/auth/challenge').set(host).send({address:participantWallet.address}).expect(200);
  const signature=await participantWallet.signMessage(c.body.message);
  await request(app).post('/api/auth/verify').set('Host','other.local:3000').send({id:c.body.id,signature}).expect(401);
  await request(app).post('/api/auth/verify').set(host).send({id:c.body.id,signature:await issuerWallet.signMessage(c.body.message)}).expect(401);
  const session=await request(app).post('/api/auth/verify').set(host).send({id:c.body.id,signature}).expect(200);
  assert.equal(session.body.role,'participant');
  await request(app).post('/api/auth/verify').set(host).send({id:c.body.id,signature}).expect(401);
  const userAuth={Authorization:`Bearer ${session.body.token}`};
  await request(app).get('/api/admin/applications').set(userAuth).expect(403);
  await request(app).post('/api/admin/applications/00000000-0000-4000-8000-000000000001/approve').set(userAuth).expect(403);
  await request(app).post('/api/applications').send({}).expect(401);
  const issuerAuth=await login(app,issuerWallet);
  await request(app).post('/api/applications').set(issuerAuth).send({}).expect(403);
  await request(app).post('/api/auth/logout').set(userAuth).expect(200);
  await request(app).get('/api/admin/applications').set(userAuth).expect(401);
  const expired=await request(app).post('/api/auth/challenge').set(host).send({address:participantWallet.address}).expect(200);
  await pool.query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.body.id]);
  await request(app).post('/api/auth/verify').set(host).send({id:expired.body.id,signature:await participantWallet.signMessage(expired.body.message)}).expect(401);
});
