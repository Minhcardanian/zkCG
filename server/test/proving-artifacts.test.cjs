const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Identity, Group, verifyProof } = require('@semaphore-protocol/core');
const { verifiedFile, generatePinnedProof } = require('../../scripts/lib/proving-artifacts.cjs');

test('Node proof cache rejects tampering and produces a real proof without a download', {timeout:120000}, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'zkcg-proof-test-'));
  const originalCache = process.env.ZKCG_PROOF_CACHE;
  const originalFetch = global.fetch;
  try {
    const sources = await Promise.all([verifiedFile(1,'wasm'), verifiedFile(1,'zkey')]);
    process.env.ZKCG_PROOF_CACHE = temp;
    await fs.mkdir(path.join(temp,'4.13.0'));
    await Promise.all(sources.map(file => fs.copyFile(file,path.join(temp,'4.13.0',path.basename(file)))));
    global.fetch = async () => { throw new Error('Network unavailable'); };
    const identity = new Identity();
    const proof = await generatePinnedProof(identity,new Group([identity.commitment]),1n,2n);
    assert.equal(await verifyProof(proof),true);
    await fs.appendFile(path.join(temp,'4.13.0','semaphore-1.wasm'),'tamper');
    await assert.rejects(verifiedFile(1,'wasm'),/integrity check/);
  } finally {
    global.fetch = originalFetch;
    if (originalCache === undefined) delete process.env.ZKCG_PROOF_CACHE; else process.env.ZKCG_PROOF_CACHE = originalCache;
    await fs.rm(temp,{recursive:true,force:true});
  }
});
