const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { generateProof } = require('@semaphore-protocol/core');
const manifest = require('../../web/src/proving-artifacts.json');

async function verifiedFile(depth, kind) {
  const expected = manifest.sha256[`${depth}.${kind}`];
  if (!expected) throw new Error(`Unsupported proof depth ${depth}`);
  const base = process.env.ZKCG_PROOF_CACHE || path.join(__dirname, '..', '..', 'cache', 'zkcg-proving');
  const directory = path.join(base, manifest.version);
  const file = path.join(directory, `semaphore-${depth}.${kind}`);
  const matches = bytes => createHash('sha256').update(bytes).digest('hex') === expected;
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (bytes) {
    if (!matches(bytes)) throw new Error(`Cached proving artifact failed integrity check: ${file}`);
    return file;
  }
  const response = await fetch(`${manifest.source}semaphore-${depth}.${kind}`);
  if (!response.ok) throw new Error(`Proving artifact download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error(`Downloaded proving artifact failed integrity check: ${depth}.${kind}`);
  await fs.mkdir(directory, { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
  return file;
}

async function generatePinnedProof(identity, group, message, scope) {
  const index = group.indexOf(identity.commitment);
  if (index < 0) throw new Error('Identity is not a group member');
  const membership = group.generateMerkleProof(index);
  const depth = membership.siblings.length || 1;
  const [wasm, zkey] = await Promise.all([verifiedFile(depth, 'wasm'), verifiedFile(depth, 'zkey')]);
  return generateProof(identity, membership, message, scope, depth, {wasm, zkey});
}
module.exports = { generatePinnedProof, verifiedFile };
