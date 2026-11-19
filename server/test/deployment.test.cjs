const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const fs = require('node:fs');
const { bindDatabase } = require('../deployment.cjs');

test('database binding rejects a different deployment and unbound legacy data', async () => {
  const connectionString = process.env.TEST_DATABASE_URL || 'postgres://zkcg:local-dev-only@127.0.0.1:55432/zkcg';
  const schema = 'zkcg_test_' + randomBytes(6).toString('hex');
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  try {
    await pool.query(fs.readFileSync('server/schema.sql','utf8'));
    await bindDatabase(pool,'chain:deployment-A');
    await bindDatabase(pool,'chain:deployment-A');
    await assert.rejects(bindDatabase(pool,'chain:deployment-B'), /another chain deployment/);
    await pool.query('DELETE FROM deployment_binding');
    await pool.query("INSERT INTO applications(id,commitment,reference,synthetic_age,synthetic_jurisdiction,synthetic_screening_clear,decision) VALUES ('00000000-0000-4000-8000-000000000001','1','test',20,'VN',true,'approved')");
    await assert.rejects(bindDatabase(pool,'chain:deployment-A'), /existing records/);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test('log scan includes a newly mined event even if the provider has a cached height', async () => {
  const { readLogs } = require('../logs.cjs');
  const event = { blockNumber: 5 };
  const provider = {
    getBlockNumber: async () => 4,
    send: async method => { assert.equal(method, 'eth_blockNumber'); return '0x5'; },
    getLogs: async filter => filter.fromBlock <= event.blockNumber && filter.toBlock >= event.blockNumber ? [event] : [],
  };
  assert.deepEqual(await readLogs(provider, {}), [event]);
});

test('issuer signer supports encrypted keystores and rejects ambiguous or invalid credentials', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const { ethers } = require('ethers');
  const { loadIssuerSigner } = require('../signer.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zkcg-keystore-'));
  const filename = path.join(dir, 'issuer.keystore.json');
  const wallet = ethers.Wallet.createRandom();
  try {
    const json = await wallet.encrypt('test-only-password');
    fs.writeFileSync(filename, json, {mode: 0o600});
    const signer = await loadIssuerSigner({ISSUER_KEYSTORE_PATH: filename, ISSUER_KEYSTORE_PASSWORD: 'test-only-password'}, null);
    assert.equal(signer.address, wallet.address);
    await assert.rejects(loadIssuerSigner({ISSUER_KEYSTORE_PATH: filename, ISSUER_KEYSTORE_PASSWORD: 'wrong'}, null), /Unable to read or decrypt/);
    await assert.rejects(loadIssuerSigner({ISSUER_PRIVATE_KEY: 'sensitive-invalid-value'}, null), error => error.message === 'Invalid issuer private key');
    await assert.rejects(loadIssuerSigner({ISSUER_PRIVATE_KEY: wallet.privateKey, ISSUER_KEYSTORE_PATH: filename, ISSUER_KEYSTORE_PASSWORD: 'test-only-password'}, null), /not both/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
