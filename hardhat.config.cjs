require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-verify');

const networks = {};
if (process.env.SEPOLIA_RPC_URL) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    chainId: 11155111,
    accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
  };
}
module.exports = {
  solidity: { version: '0.8.23', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks,
  etherscan: { enabled: !!process.env.ETHERSCAN_API_KEY, apiKey: process.env.ETHERSCAN_API_KEY || '' },
};
