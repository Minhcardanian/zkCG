const fs = require('node:fs');
const { Pool } = require('pg');
const { ethers } = require('ethers');
const { createApp } = require('./app.cjs');
const { deploymentFingerprint, bindDatabase } = require('./deployment.cjs');
const { loadIssuerSigner } = require('./signer.cjs');

async function main() {
  const { DATABASE_URL, RPC_URL, GATE_ADDRESS, ISSUER_WALLET_ADDRESSES } = process.env;
  if (!DATABASE_URL || !RPC_URL || !GATE_ADDRESS || !ISSUER_WALLET_ADDRESSES) throw new Error('Set DATABASE_URL, RPC_URL, GATE_ADDRESS and ISSUER_WALLET_ADDRESSES');
  const issuerAddresses=ISSUER_WALLET_ADDRESSES.split(',').map(address=>address.trim());
  if (!issuerAddresses.length || issuerAddresses.some(address=>!ethers.isAddress(address))) throw new Error('Invalid issuer wallet address configuration');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  let pool;
  try {
    const signer = await loadIssuerSigner(process.env, provider);
    const chain = await provider.getNetwork();
    if (chain.chainId !== 31337n && chain.chainId !== 11155111n) throw new Error('Only local Hardhat and Sepolia networks are supported');
    if (chain.chainId === 11155111n && !process.env.SEMAPHORE_START_BLOCK) throw new Error('Set SEMAPHORE_START_BLOCK to the group creation block');
    const artifact = require('../artifacts/contracts/ComplianceGate.sol/ComplianceGate.json');
    const gate = new ethers.Contract(GATE_ADDRESS, artifact.abi, signer);
    if ((await gate.issuer()).toLowerCase() !== signer.address.toLowerCase()) throw new Error('Signer does not match gate issuer');
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(fs.readFileSync(require.resolve('./schema.sql'), 'utf8'));
    await bindDatabase(pool, await deploymentFingerprint(gate));
    const port = Number(process.env.PORT || 3001);
    const server = createApp({ pool, gate, issuerAddresses, chainId: chain.chainId.toString(), gateAddress: ethers.getAddress(GATE_ADDRESS) }).listen(port, '127.0.0.1', () => console.log(`Issuer API listening on 127.0.0.1:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await pool.end(); provider.destroy(); }));
  } catch (error) {
    if (pool) await pool.end();
    provider.destroy();
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
