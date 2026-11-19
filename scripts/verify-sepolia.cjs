const fs = require('node:fs');
const hre = require('hardhat');
const { ethers } = hre;
const api = 'https://sourcify.dev/server/v2';
const headers = { 'Content-Type':'application/json', 'User-Agent':'zkcg-prototype/1.0 (https://github.com/Minhcardanian/zkCG)' };
async function main() {
  if (hre.network.name !== 'sepolia' || (await ethers.provider.getNetwork()).chainId !== 11155111n) throw new Error('Verification requires Sepolia');
  const deploymentPath = 'deployments/sepolia.jsonl';
  const ticketPath = 'deployments/sourcify.jsonl';
  const records = fs.readFileSync(deploymentPath, 'utf8').trim().split('\n').map(JSON.parse);
  const deployment = records.find(row => row.step === 'deployment' && row.status === 'complete');
  if (!deployment) throw new Error('Completed deployment journal not found');
  const gate = await ethers.getContractAt('ComplianceGate', deployment.gate);
  const semaphore = await ethers.getContractAt('Semaphore', deployment.semaphore);
  if ((await gate.semaphore()).toLowerCase() !== deployment.semaphore.toLowerCase() || (await gate.issuer()).toLowerCase() !== deployment.issuer.toLowerCase() || (await semaphore.verifier()).toLowerCase() !== deployment.verifier.toLowerCase()) throw new Error('On-chain relationships differ from deployment journal');
  const contracts = [
    ['PoseidonT3',deployment.poseidon,'poseidon-solidity/PoseidonT3.sol:PoseidonT3'],
    ['SemaphoreVerifier',deployment.verifier,'@semaphore-protocol/contracts/base/SemaphoreVerifier.sol:SemaphoreVerifier'],
    ['Semaphore',deployment.semaphore,'@semaphore-protocol/contracts/Semaphore.sol:Semaphore'],
    ['ComplianceGate',deployment.gate,'contracts/ComplianceGate.sol:ComplianceGate'],
  ];
  let tickets = fs.existsSync(ticketPath) ? fs.readFileSync(ticketPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  for (const [name,address,fqn] of contracts) {
    const lookup = await fetch(`${api}/contract/11155111/${address}`, {headers});
    if (lookup.ok) {
      const result = await lookup.json();
      if (result.match === 'exact_match') { console.log(`${name}: exact match`); continue; }
      throw new Error(`${name} is already listed without an exact match; inspect before retrying`);
    }
    if (lookup.status !== 404) throw new Error(`${name} lookup failed: ${lookup.status}`);
    let ticket = tickets.find(row => row.contract === name);
    if (!ticket) {
      const build = await hre.artifacts.getBuildInfo(fqn);
      const creation = records.find(row => row.step === name && row.status === 'confirmed');
      if (!build || !creation) throw new Error(`Missing build input or creation transaction for ${name}`);
      const response = await fetch(`${api}/verify/11155111/${address}`, {method:'POST',headers,body:JSON.stringify({stdJsonInput:build.input,compilerVersion:build.solcLongVersion,contractIdentifier:fqn,creationTransactionHash:creation.hash})});
      const result = await response.json();
      if (!response.ok || !result.verificationId) throw new Error(`${name} submission failed: ${JSON.stringify(result)}`);
      ticket = {contract:name,verificationId:result.verificationId};
      fs.appendFileSync(ticketPath, JSON.stringify(ticket)+'\n', {mode:0o600});
      tickets.push(ticket);
    }
    const response = await fetch(`${api}/verify/${ticket.verificationId}`, {headers});
    const result = await response.json();
    if (!response.ok || !result.isJobCompleted) throw new Error(`${name} verification pending or unavailable; rerun to poll ticket ${ticket.verificationId}`);
    if (result.contract?.match !== 'exact_match') throw new Error(`${name} verification did not return an exact match: ${JSON.stringify(result)}`);
    console.log(`${name}: exact match`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
