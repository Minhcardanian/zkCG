const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { ethers } = require('ethers');
const { Identity } = require('@semaphore-protocol/core');
const request = require('supertest');
const { createApp } = require('../app.cjs');
const artifact = require('../../artifacts/contracts/ComplianceGate.sol/ComplianceGate.json');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://zkcg:local-dev-only@127.0.0.1:55432/zkcg' });
after(() => pool.end());
test('approval and revocation reconcile against real local contracts', { timeout: 120000 }, async () => {
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const gate = new ethers.Contract(process.env.TEST_GATE_ADDRESS, artifact.abi, await provider.getSigner(0));
  const issuerWallet=ethers.Wallet.createRandom(), participantWallet=ethers.Wallet.createRandom();
  const app = createApp({ pool, gate, issuerAddresses:[issuerWallet.address], chainId:'31337', gateAddress:await gate.getAddress() });
  async function login(wallet) { const c=await request(app).post('/api/auth/challenge').set('Host','localhost:3000').send({address:wallet.address}).expect(200);const r=await request(app).post('/api/auth/verify').set('Host','localhost:3000').send({id:c.body.id,signature:await wallet.signMessage(c.body.message)}).expect(200);return {Authorization:`Bearer ${r.body.token}`}; }
  const auth=await login(issuerWallet),userAuth=await login(participantWallet);
  const identity = new Identity();
  const reference = `synthetic-${randomUUID()}`;
  const response = await request(app).post('/api/applications').set(userAuth).send({ commitment: identity.commitment.toString(), reference, age: 22, jurisdiction: 'VN', screeningClear: true }).expect(201);
  const id = response.body.id;
  let completed = false;
  try {
    const approve = await request(app).post(`/api/admin/applications/${id}/approve`).set(auth).expect(202);
    await request(app).post(`/api/admin/operations/${approve.body.operationId}/reconcile`).set(auth).expect(200).expect(({body}) => assert.equal(body.status,'confirmed'));
    const assertNoReference = async (txHash) => {
      const tx = await provider.getTransaction(txHash);
      const receipt = await provider.getTransactionReceipt(txHash);
      const rawReference = Buffer.from(reference, 'utf8').toString('hex').toLowerCase();
      const publicData = [tx.data, ...receipt.logs.flatMap(log => [log.data, ...log.topics])].join('').toLowerCase();
      assert.equal(publicData.includes(rawReference), false, 'private reference must not appear in calldata or logs');
    };
    await assertNoReference(approve.body.txHash);
    const revoke = await request(app).post(`/api/admin/applications/${id}/revoke`).set(auth).expect(202);
    await request(app).post(`/api/admin/operations/${revoke.body.operationId}/reconcile`).set(auth).expect(200).expect(({body}) => assert.equal(body.status,'confirmed'));
    await assertNoReference(revoke.body.txHash);
    assert.equal(await gate.approved(identity.commitment), false);
    completed = true;
  } finally {
    const addresses=[issuerWallet.address.toLowerCase(),participantWallet.address.toLowerCase()];
    await pool.query('DELETE FROM auth_sessions WHERE wallet_address=ANY($1::text[])',[addresses]);
    await pool.query('DELETE FROM auth_challenges WHERE wallet_address=ANY($1::text[])',[addresses]);
    if (!completed) {
      console.error(`Local-chain run incomplete; preserved synthetic records for reference ${reference}.`);
    } else {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM operations WHERE application_id=$1',[id]);
        await client.query('DELETE FROM applications WHERE id=$1',[id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  }
});
