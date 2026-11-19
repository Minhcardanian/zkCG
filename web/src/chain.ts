import { BrowserProvider, JsonRpcProvider, Contract, zeroPadValue, toBeHex, type Eip1193Provider } from 'ethers';
import { Group, generateProof, type Identity } from '@semaphore-protocol/core';
import { withProvingArtifacts } from './proving-artifacts';
import { confirmRegistration } from './transaction';
import gateArtifact from '../../artifacts/contracts/ComplianceGate.sol/ComplianceGate.json';
import semaphoreArtifact from '../../artifacts/@semaphore-protocol/contracts/Semaphore.sol/Semaphore.json';

async function readLogs(provider: BrowserProvider | JsonRpcProvider, address: string, topics: (string | null)[]) {
  const start = Number(import.meta.env.VITE_START_BLOCK || '0');
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid configured start block.');
  const latest = Number(BigInt(await provider.send('eth_blockNumber', [])));
  const logs: Awaited<ReturnType<typeof provider.getLogs>> = [];
  for (let from = start; from <= latest; from += 5000) logs.push(...await provider.getLogs({ address, topics, fromBlock: from, toBlock: Math.min(from + 4999, latest) }));
  return logs;
}
declare global { interface Window { ethereum?: Eip1193Provider } }
function configuredChain(): bigint {
  const expected = BigInt(import.meta.env.VITE_CHAIN_ID || '31337');
  if (expected !== 31337n && expected !== 11155111n) throw new Error('Only the local network and Sepolia are supported.');
  if (expected === 11155111n && !import.meta.env.VITE_START_BLOCK) throw new Error('Configure the deployment start block for Sepolia.');
  return expected;
}
async function contracts(address: string, provider: BrowserProvider | JsonRpcProvider) {
  if ((await provider.getNetwork()).chainId !== configuredChain()) throw new Error(`Switch to chain ${configuredChain()}.`);
  const gate = new Contract(address, gateArtifact.abi, provider);
  const semaphore = new Contract(await gate.semaphore(), semaphoreArtifact.abi, provider);
  return { gate, semaphore };
}
export async function connect(address: string) {
  if (!window.ethereum) throw new Error('Install a compatible browser wallet.');
  const provider = new BrowserProvider(window.ethereum);
  let signer;
  try { signer = await provider.getSigner(); }
  catch { throw new Error('Wallet connection failed. Check your wallet and network, then try again.'); }
  const read = await contracts(address, provider);
  return { provider, signer, gate: read.gate.connect(signer) as Contract, semaphore: read.semaphore, account: await signer.getAddress() };
}
export async function connectAudit(address: string) {
  const rpcUrl = import.meta.env.VITE_RPC_URL || new URL('/rpc', window.location.origin).href;
  const provider = new JsonRpcProvider(rpcUrl);
  return contracts(address, provider);
}
export async function reconstruct(semaphore: Contract, groupId: bigint): Promise<Group> {
  const group = new Group();
  const provider = semaphore.runner?.provider;
  if (!provider) throw new Error('Wallet provider unavailable.');
  const events = await readLogs(provider as BrowserProvider | JsonRpcProvider, await semaphore.getAddress(), [null, zeroPadValue(toBeHex(groupId), 32)]);
  for (const event of events) {
    const parsed = semaphore.interface.parseLog(event);
    if (!parsed) continue;
    if (parsed.name === 'MemberAdded') group.addMember(parsed.args.identityCommitment);
    else if (parsed.name === 'MembersAdded') group.addMembers(parsed.args.identityCommitments);
    else if (parsed.name === 'MemberRemoved') group.removeMember(Number(parsed.args.index));
    else if (parsed.name === 'MemberUpdated') group.updateMember(Number(parsed.args.index), parsed.args.newIdentityCommitment);
  }
  if (group.root !== await semaphore.getMerkleTreeRoot(groupId)) throw new Error('Group state is out of date. Retry with a complete RPC history.');
  return group;
}
export async function register(gate: Contract, semaphore: Contract, identity: Identity, account: string, progress: (message: string) => void) {
  const group = await reconstruct(semaphore, await gate.groupId());
  if (group.indexOf(identity.commitment) < 0) throw new Error('This identity is not currently approved.');
  progress('Checking proving artifacts and generating the proof locally; this may take a moment…');
  const merkleProof = group.generateMerkleProof(group.indexOf(identity.commitment));
  const depth = merkleProof.siblings.length || 1;
  const message = await gate.registrationMessage(account);
  const scope = await gate.registrationScope();
  const proof = await withProvingArtifacts(depth, artifacts => generateProof(identity, merkleProof, message, scope, depth, artifacts));
  progress('Confirm the transaction in your wallet.');
  let tx;
  try { tx = await gate.registerWithProof(proof); }
  catch (error) {
    const e = error as {code?: string | number; error?: {code?: number}; info?: {error?: {code?: number}}};
    const code = e.info?.error?.code ?? e.error?.code ?? e.code;
    if (code === 4001 || code === 'ACTION_REJECTED') throw new Error('Transaction rejected in your wallet.');
    if (code === 4100) throw new Error('Wallet authorization failed. Reconnect the account and check its permissions.');
    throw new Error('Transaction submission outcome is uncertain. Check wallet activity before retrying.');
  }
  progress(`Transaction pending: ${tx.hash}`);
  return confirmRegistration(tx);
}
export async function audit(gate: Contract, semaphore: Contract) {
  const groupId = await gate.groupId();
  const group = await reconstruct(semaphore, groupId);
  const provider = gate.runner?.provider;
  if (!provider) throw new Error('Wallet provider unavailable.');
  const logs = await readLogs(provider as BrowserProvider | JsonRpcProvider, await gate.getAddress(), []);
  const events = logs.map(log => {
    const event = gate.interface.parseLog(log);
    if (!event) return null;
    const description = event.name === 'Registered' ? `Wallet ${event.args.participant}; nullifier ${event.args.nullifier}` : `Commitment ${event.args.commitment}`;
    return {id: `${log.transactionHash}:${log.index}`, name:event.name, block:log.blockNumber, tx:log.transactionHash, description};
  }).filter(event => event !== null).reverse();
  return {root:group.root.toString(), size:group.size, active:group.members.filter(m=>m!==0n).length, events};
}
