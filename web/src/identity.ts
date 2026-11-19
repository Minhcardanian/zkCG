import { Identity } from '@semaphore-protocol/core';
const storageKey = 'zkcg.encryptedIdentity.v1';
const enc = new TextEncoder();
function bytesTo64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function from64(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export function hasIdentity(): boolean { return !!localStorage.getItem(storageKey); }
export async function createIdentity(password: string): Promise<Identity> {
  if (hasIdentity()) throw new Error('An identity already exists in this browser. Unlock it instead.');
  if (password.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const identity = new Identity();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await key(password,salt), enc.encode(identity.export()));
  localStorage.setItem(storageKey, JSON.stringify({salt:bytesTo64(salt),iv:bytesTo64(iv),ciphertext:bytesTo64(new Uint8Array(ciphertext))}));
  return identity;
}
export async function unlockIdentity(password: string): Promise<Identity> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) throw new Error('Create an identity first.');
  const data = JSON.parse(raw);
  try {
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(data.iv)}, await key(password,from64(data.salt)), from64(data.ciphertext));
    return Identity.import(new TextDecoder().decode(plaintext));
  } catch { throw new Error('Unable to unlock identity. Check your passphrase.'); }
}
