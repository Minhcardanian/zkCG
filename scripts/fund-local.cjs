const { ethers } = require('ethers');

async function main() {
  const address = process.argv[2];
  if (process.argv.length !== 3 || !ethers.isAddress(address) || address === ethers.ZeroAddress) {
    throw new Error('Usage: npm run fund:local -- <wallet-address>');
  }
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  try {
    if ((await provider.getNetwork()).chainId !== 31337n) throw new Error('Expected the local chain ID 31337');
    const sender = await provider.getSigner(0);
    const tx = await sender.sendTransaction({to: address, value: ethers.parseEther('1')});
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`Funding was not confirmed: ${tx.hash}`);
    console.log(`Sent 1 local test ETH to ${address}; transaction ${tx.hash}`);
  } finally { provider.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
