const fs = require('node:fs');
const { ethers, network } = require('hardhat');
async function main() {
  if (network.name !== 'sepolia' || (await ethers.provider.getNetwork()).chainId !== 11155111n || process.env.CONFIRM_SEPOLIA_BROWSER !== 'yes') throw new Error('Explicit Sepolia browser-test authorization is required');
  const [issuer] = await ethers.getSigners();
  if (!issuer) throw new Error('Issuer signer missing');
  const deployment = fs.readFileSync('deployments/sepolia.jsonl','utf8').trim().split('\n').map(JSON.parse).find(x=>x.step==='deployment' && x.status==='complete');
  if (!deployment || deployment.issuer.toLowerCase() !== issuer.address.toLowerCase()) throw new Error('Issuer does not match deployment');
  const participant = ethers.Wallet.createRandom();
  const journal = fs.openSync('deployments/sepolia-browser.jsonl','wx',0o600);
  const write = x => fs.writeSync(journal, JSON.stringify({time:new Date().toISOString(),...x})+'\n');
  try {
    fs.writeFileSync('deployments/sepolia-browser.participant-key',participant.privateKey,{mode:0o600,flag:'wx'});
    const fee = await ethers.provider.getFeeData();
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    if (!price) throw new Error('Fee data unavailable');
    write({step:'fund-participant',status:'preparing',participant:participant.address,gate:deployment.gate});
    const tx = await issuer.sendTransaction({to:participant.address,value:price*10_000_000n});
    write({step:'fund-participant',status:'pending',hash:tx.hash});
    const receipt = await tx.wait();
    if (!receipt || receipt.status!==1) throw new Error('Funding failed');
    write({step:'fund-participant',status:'confirmed',hash:tx.hash,block:receipt.blockNumber});
    console.log(`Test participant funded: ${participant.address}`);
  } catch(error) { write({step:'setup',status:'interrupted',message:'Inspect journal and chain before any retry'}); throw error; }
  finally { fs.closeSync(journal); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
