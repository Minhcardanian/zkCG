const fs = require('node:fs/promises');
const { ethers } = require('ethers');

async function loadIssuerSigner(config, provider) {
  const { ISSUER_PRIVATE_KEY: key, ISSUER_KEYSTORE_PATH: path, ISSUER_KEYSTORE_PASSWORD: password } = config;
  if (key && (path || password)) throw new Error('Configure either ISSUER_PRIVATE_KEY or an issuer keystore, not both');
  if (key) {
    try { return new ethers.Wallet(key, provider); }
    catch { throw new Error('Invalid issuer private key'); }
  }
  if (!path || !password) throw new Error('Set ISSUER_PRIVATE_KEY or both ISSUER_KEYSTORE_PATH and ISSUER_KEYSTORE_PASSWORD');
  try {
    const json = await fs.readFile(path, 'utf8');
    return (await ethers.Wallet.fromEncryptedJson(json, password)).connect(provider);
  } catch {
    throw new Error('Unable to read or decrypt the issuer keystore');
  }
}
module.exports = { loadIssuerSigner };
