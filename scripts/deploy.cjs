const { ethers, network } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const chain = await ethers.provider.getNetwork();
  const expected = network.name === 'sepolia' ? 11155111n : 31337n;
  if (!['localhost', 'hardhat', 'sepolia'].includes(network.name) || chain.chainId !== expected) throw new Error('Unexpected deployment network');
  if (network.name === 'sepolia' && process.env.CONFIRM_SEPOLIA_DEPLOYMENT !== 'yes') throw new Error('Set CONFIRM_SEPOLIA_DEPLOYMENT=yes only when authorized to deploy');
  const [issuer] = await ethers.getSigners();
  if (!issuer) throw new Error('No deployer account configured');
  let journal;
  if (network.name === 'sepolia') {
    const balance = await ethers.provider.getBalance(issuer.address);
    const fee = await ethers.provider.getFeeData();
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (!price) throw new Error('Cannot estimate the current Sepolia fee');
    const reserve = 100_000_000n * price;
    if (balance < reserve) throw new Error(`Sepolia deployer balance is below the conservative 100 million gas fee reserve (${ethers.formatEther(reserve)} SepETH)`);
    fs.mkdirSync('deployments', { recursive: true });
    const journalPath = path.join('deployments', 'sepolia.jsonl');
    journal = fs.openSync(journalPath, 'wx', 0o600);
    console.log(`Deployment journal: ${journalPath}`);
  }
  function record(value) {
    if (journal !== undefined) fs.writeSync(journal, `${JSON.stringify({time: new Date().toISOString(), ...value})}\n`);
  }
  async function deploy(name, factory, args) {
    record({step:name, status:'preparing'});
    const contract = await factory.deploy(...args);
    const tx = contract.deploymentTransaction();
    record({step:name, status:'pending', hash:tx.hash, address:await contract.getAddress()});
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${name} deployment did not succeed`);
    record({step:name, status:'confirmed', hash:tx.hash, address:await contract.getAddress(), block:receipt.blockNumber, gasUsed:receipt.gasUsed.toString()});
    return { contract, receipt };
  }
  try {
    record({step:'deployment', status:'started', chainId:chain.chainId.toString(), issuer:issuer.address});
    const poseidon = await deploy('PoseidonT3', await ethers.getContractFactory('PoseidonT3'), []);
    const verifier = await deploy('SemaphoreVerifier', await ethers.getContractFactory('SemaphoreVerifier'), []);
    const semaphore = await deploy('Semaphore', await ethers.getContractFactory('Semaphore', { libraries: { PoseidonT3: await poseidon.contract.getAddress() } }), [await verifier.contract.getAddress()]);
    const gate = await deploy('ComplianceGate', await ethers.getContractFactory('ComplianceGate'), [await semaphore.contract.getAddress(), issuer.address, ethers.id('zkcg-registration-v1')]);
    const result = { creationBlock: gate.receipt.blockNumber, chainId:chain.chainId.toString(), issuer:issuer.address, poseidon:await poseidon.contract.getAddress(), verifier:await verifier.contract.getAddress(), semaphore:await semaphore.contract.getAddress(), gate:await gate.contract.getAddress(), groupId:(await gate.contract.groupId()).toString() };
    record({step:'deployment', status:'complete', ...result});
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    record({step:'deployment', status:'interrupted', message:'Investigate the journal and chain before any retry.'});
    throw error;
  } finally { if (journal !== undefined) fs.closeSync(journal); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
