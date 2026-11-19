const fs = require('node:fs');
const { ethers, network } = require('hardhat');
const { Identity } = require('@semaphore-protocol/core');
const { generatePinnedProof: generateProof } = require('./lib/proving-artifacts.cjs');
const { loadGroup } = require('../server/group.cjs');

function revertData(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string') return /^0x[0-9a-fA-F]{8,}$/.test(value) ? value : '';
  if (typeof value !== 'object') return '';
  for (const key of ['data', 'error', 'info', 'cause']) {
    const data = revertData(value[key], depth + 1);
    if (data) return data;
  }
  return '';
}
async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const local = network.name === 'localhost' && chainId === 31337n && process.env.ALLOW_LOCAL_SMOKE === 'yes';
  if (!local && (network.name !== 'sepolia' || chainId !== 11155111n)) throw new Error('Smoke test requires Sepolia');
  if (!local && process.env.CONFIRM_SEPOLIA_SMOKE !== 'yes') throw new Error('Set CONFIRM_SEPOLIA_SMOKE=yes only when authorized to send test transactions');
  if (!ethers.isAddress(process.env.GATE_ADDRESS || '') || !process.env.SEMAPHORE_START_BLOCK) throw new Error('Set GATE_ADDRESS and SEMAPHORE_START_BLOCK');
  const [issuer] = await ethers.getSigners();
  if (!issuer) throw new Error('No issuer signer configured');
  const gate = await ethers.getContractAt('ComplianceGate', process.env.GATE_ADDRESS, issuer);
  if ((await gate.issuer()).toLowerCase() !== issuer.address.toLowerCase()) throw new Error('Signer is not gate issuer');
  const groupBefore = await loadGroup(gate);
  const identity = new Identity();
  const participant = ethers.Wallet.createRandom().connect(ethers.provider);
  const second = ethers.Wallet.createRandom().connect(ethers.provider);
  fs.mkdirSync('deployments', { recursive: true });
  const journalPath = local ? `deployments/local-smoke-${Date.now()}.jsonl` : 'deployments/sepolia-smoke.jsonl';
  const journal = fs.openSync(journalPath, 'wx', 0o600);
  const keyPath = journalPath.replace(/\.jsonl$/, '.participant-key');
  const record = value => fs.writeSync(journal, JSON.stringify({time:new Date().toISOString(), ...value}) + '\n');
  async function transaction(label, action) {
    record({step:label,status:'preparing'});
    const tx = await action();
    record({step:label,status:'pending',hash:tx.hash});
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed`);
    record({step:label,status:'confirmed',hash:tx.hash,block:receipt.blockNumber,gasUsed:receipt.gasUsed.toString()});
  }
  async function expectError(label, fn, signature) {
    let data = '';
    let reason = '';
    try { await fn(); } catch (error) { data = revertData(error); reason = error.shortMessage || error.message; }
    const selector = ethers.id(signature).slice(0,10);
    if (!data.toLowerCase().startsWith(selector.toLowerCase()) && !reason.includes(signature)) throw new Error(`${label} did not return expected error selector (${reason}; data ${data})`);
    record({step:label,status:'passed',errorSelector:selector});
  }
  try {
    fs.writeFileSync(keyPath, participant.privateKey, {mode:0o600,flag:'wx'});
    record({step:'smoke',status:'started',chainId:chainId.toString(),gate:await gate.getAddress(),issuer:issuer.address,participant:participant.address,initialRoot:groupBefore.root.toString(),commitment:identity.commitment.toString()});
    const fees = await ethers.provider.getFeeData();
    const price = fees.maxFeePerGas ?? fees.gasPrice;
    if (!price) throw new Error('Cannot estimate participant transaction fees');
    await transaction('fund-participant', () => issuer.sendTransaction({to:participant.address,value:price * 10_000_000n}));
    await transaction('approve', () => gate.approveIdentity(identity.commitment));
    const group = await loadGroup(gate);
    const scope = await gate.registrationScope();
    const started = Date.now();
    const proof = await generateProof(identity, group, await gate.registrationMessage(participant.address), scope);
    record({step:'proof',status:'generated',elapsedMs:Date.now()-started,root:group.root.toString()});
    const otherProof = await generateProof(identity, group, await gate.registrationMessage(second.address), scope);
    await transaction('register', () => gate.connect(participant).registerWithProof(proof));
    if (!await gate.registered(participant.address)) throw new Error('Registration state not set');
    await expectError('replay', () => gate.connect(second).registerWithProof.staticCall(otherProof), 'Semaphore__YouAreUsingTheSameNullifierTwice()');
    const siblings = group.generateMerkleProof(group.indexOf(identity.commitment)).siblings;
    await transaction('revoke', () => gate.revokeIdentity(identity.commitment, siblings));
    if (await gate.approved(identity.commitment)) throw new Error('Commitment remains approved');
    await expectError('stale-root', () => gate.connect(second).registerWithProof.staticCall(otherProof), 'StaleRoot()');
    record({step:'smoke',status:'complete'});
    console.log(`Smoke test completed; evidence: ${journalPath}`);
  } catch (error) {
    record({step:'smoke',status:'interrupted',message:'Inspect the journal and chain before any retry or cleanup.'});
    throw error;
  } finally { fs.closeSync(journal); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
