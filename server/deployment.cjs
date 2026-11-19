const { ethers } = require('ethers');
const { readLogs } = require('./logs.cjs');
const semaphoreAbi = require('../artifacts/@semaphore-protocol/contracts/Semaphore.sol/Semaphore.json').abi;

async function deploymentFingerprint(gate) {
  const provider = gate.runner.provider;
  const network = await provider.getNetwork();
  const semaphore = new ethers.Contract(await gate.semaphore(), semaphoreAbi, provider);
  const groupId = await gate.groupId();
  const events = await readLogs(provider, { address: await semaphore.getAddress(), topics: [semaphore.interface.getEvent('GroupCreated').topicHash, ethers.zeroPadValue(ethers.toBeHex(groupId), 32)] });
  if (events.length !== 1) throw new Error('Cannot identify the Semaphore group creation event');
  const groupAdmin = await semaphore.getGroupAdmin(groupId);
  if (groupAdmin.toLowerCase() !== (await gate.getAddress()).toLowerCase()) throw new Error('Gate is not the group administrator');
  const block = await provider.getBlock(events[0].blockNumber);
  if (!block || !block.hash) throw new Error('Cannot identify the group creation block');
  return [network.chainId.toString(), (await gate.getAddress()).toLowerCase(), (await semaphore.getAddress()).toLowerCase(), groupId.toString(), block.hash].join(':');
}

async function bindDatabase(pool, fingerprint) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zkcg-deployment-binding'))");
    const existing = await client.query('SELECT fingerprint FROM deployment_binding WHERE singleton = true');
    if (existing.rows.length) {
      if (existing.rows[0].fingerprint !== fingerprint) throw new Error('Database belongs to another chain deployment; use a separate database');
    } else {
      const populated = await client.query('SELECT EXISTS(SELECT 1 FROM applications) OR EXISTS(SELECT 1 FROM operations) AS populated');
      if (populated.rows[0].populated) throw new Error('Unbound database has existing records; use a separate empty database');
      await client.query('INSERT INTO deployment_binding(singleton, fingerprint) VALUES (true, $1)', [fingerprint]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { deploymentFingerprint, bindDatabase };
