const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { ethers } = require('ethers');

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('A terminal is required to enter the passphrase privately');
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const wasRaw = input.isRaw;
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write(prompt);
    function finish(error) {
      input.removeListener('keypress', onKey);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onKey(str, key) {
      if (key.ctrl && key.name === 'c') return finish(new Error('Cancelled'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (!key.ctrl && !key.meta && str && !/[\x00-\x1f\x7f]/.test(str)) value += str;
    }
    input.on('keypress', onKey);
  });
}

async function main() {
  const filename = process.argv[2];
  if (process.argv.length !== 3 || !filename || !filename.endsWith('.keystore.json')) throw new Error('Usage: npm run keystore:create -- <path ending in .keystore.json>');
  if (!process.env.ISSUER_PRIVATE_KEY) throw new Error('Set ISSUER_PRIVATE_KEY in the environment before running');
  let wallet;
  try { wallet = new ethers.Wallet(process.env.ISSUER_PRIVATE_KEY); }
  catch { throw new Error('Invalid issuer private key'); }
  const first = await readSecret('New keystore passphrase (at least 12 characters): ');
  if (first.length < 12) throw new Error('Passphrase must be at least 12 characters');
  const second = await readSecret('Confirm passphrase: ');
  if (first !== second) throw new Error('Passphrases do not match');
  const json = await wallet.encrypt(first);
  const file = await fs.open(path.resolve(filename), 'wx', 0o600);
  try { await file.writeFile(json, 'utf8'); }
  finally { await file.close(); }
  console.log(`Encrypted keystore created for ${wallet.address}. Keep its passphrase separate and secure.`);
}
main().catch(error => { console.error(error.code === 'EEXIST' ? 'Keystore already exists; it was not overwritten.' : error.message); process.exitCode = 1; });
