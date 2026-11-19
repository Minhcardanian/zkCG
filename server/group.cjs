const { Group } = require('@semaphore-protocol/core');
const { ethers } = require('ethers');
const { readLogs } = require('./logs.cjs');
const semaphoreAbi = require('../artifacts/@semaphore-protocol/contracts/Semaphore.sol/Semaphore.json').abi;

async function loadGroup(gate) {
  const provider = gate.runner.provider;
  const groupId = await gate.groupId();
  const semaphore = new ethers.Contract(await gate.semaphore(), semaphoreAbi, provider);
  const events = await readLogs(provider, { address: await semaphore.getAddress(), topics: [null, ethers.zeroPadValue(ethers.toBeHex(groupId), 32)] });
  const group = new Group();
  for (const event of events) {
    const parsed = semaphore.interface.parseLog(event);
    if (!parsed) continue;
    if (parsed.name === 'MemberAdded') group.addMember(parsed.args.identityCommitment);
    else if (parsed.name === 'MembersAdded') group.addMembers(parsed.args.identityCommitments);
    else if (parsed.name === 'MemberRemoved') group.removeMember(Number(parsed.args.index));
    else if (parsed.name === 'MemberUpdated') group.updateMember(Number(parsed.args.index), parsed.args.newIdentityCommitment);
  }
  if (group.root !== await semaphore.getMerkleTreeRoot(groupId)) throw new Error('Group changed or RPC history is incomplete');
  return group;
}
module.exports = { loadGroup };
