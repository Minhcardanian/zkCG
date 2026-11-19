import manifest from './proving-artifacts.json';

type ArtifactKind = 'wasm' | 'zkey';
const checksums: Record<string, string> = manifest.sha256;
const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');

async function verifiedBytes(depth: number, kind: ArtifactKind): Promise<Uint8Array> {
  const expected = checksums[`${depth}.${kind}`];
  if (!expected) throw new Error(`Unsupported proof depth ${depth}.`);
  const url = `${manifest.source}semaphore-${depth}.${kind}`;
  let cache: Cache | undefined;
  try { cache = await globalThis.caches?.open(`zkcg-proving-${manifest.version}`); } catch { /* Storage may be unavailable. */ }
  let response: Response | undefined;
  try { response = await cache?.match(url); } catch { /* Fetch directly when cache access fails. */ }
  let bytes: Uint8Array | undefined;
  if (response) {
    const cached = new Uint8Array(await response.arrayBuffer());
    if (toHex(await crypto.subtle.digest('SHA-256', cached)) === expected) bytes = cached;
    else { try { await cache?.delete(url); } catch { /* A failed cache delete must not skip validation. */ } }
  }
  if (!bytes) {
    const fetched = await fetch(url);
    if (!fetched.ok) throw new Error(`Unable to download proving artifact (${fetched.status}).`);
    bytes = new Uint8Array(await fetched.arrayBuffer());
    if (toHex(await crypto.subtle.digest('SHA-256', bytes)) !== expected) throw new Error('Proving artifact integrity check failed.');
    try { await cache?.put(url, new Response(bytes)); } catch { /* A full or disabled cache does not prevent proving. */ }
  }
  return bytes;
}

export async function withProvingArtifacts<T>(depth: number, use: (artifacts: {wasm: string; zkey: string}) => Promise<T>): Promise<T> {
  const [wasm, zkey] = await Promise.all([verifiedBytes(depth,'wasm'), verifiedBytes(depth,'zkey')]);
  const urls = { wasm: URL.createObjectURL(new Blob([wasm])), zkey: URL.createObjectURL(new Blob([zkey])) };
  try { return await use(urls); }
  finally { URL.revokeObjectURL(urls.wasm); URL.revokeObjectURL(urls.zkey); }
}
