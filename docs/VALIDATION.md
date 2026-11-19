# Validation evidence and outstanding work

This is a local development record, not a release or testnet attestation. The repository had no commit when the observations below were made; files may have changed since a run. Repeat the checks against the exact revision being reviewed.

## Local evidence observed on 2026-11-15

| Check | Evidence and scope | Limit |
| --- | --- | --- |
| Clean install and build | An isolated copy without generated artifacts completed normal `npm ci`, `npm run build` and `npm test`. The scripts compile Solidity before the frontend build. | Requires package and compiler access; dependency audit still reports unresolved advisories. |
| Contract policy boundaries | `npm test` exercised issuer-only membership changes, duplicate commitments, current-root, scope and caller checks, failure rollback and nullifier handling. | Some policy cases use `SemaphoreDouble`; they do not establish cryptographic verification. |
| Real proof | `npm test` deployed the real Semaphore verifier and gate locally. A real proof registered, a modified proof and wrong caller failed, a nonmember could not produce a group proof, a reused nullifier failed after a group update, and a proof became stale after revocation. One recent run reported 395 ms for the first proof and 315,318 gas for registration. | Timing is a single local observation, not a benchmark; environment and group size affect results. |
| Issuer persistence and recovery | `npm run test:issuer` used PostgreSQL to test screening, pending/confirmed state, uncertain submission, attachment validation, and deployment binding. `npm run test:local-chain` exercised approval and revocation against real local contracts and checked that its synthetic private reference was absent from approval and revocation calldata and receipt logs. | Synthetic inputs and disposable local keys only; a sentinel check does not prove absence of all private data in every possible path. |
| Browser journey | `npm run test:browser` exercised encrypted identity creation and unlock, synthetic application, approval, real proof, public audit without a wallet, revocation and matching-hash recovery. | The wallet was an injected local test provider, not a production wallet extension; one desktop Chromium path was exercised. |
| Architecture diagrams | Five Mermaid blocks in `ARCHITECTURE.md` rendered in Chromium with Mermaid 11.4.1 and were visually inspected. | Diagrams document the design; they do not prove deployed behavior. |

## Outstanding evidence

- Sepolia contract deployment, Sourcify verification and smoke-test evidence are recorded below. A testnet issuer API and browser journey was later run as described below.
- The browser test does not cover every wallet, mobile viewport, failed RPC call, or proof-generation interruption.
- The issuer is a loopback demonstration service using wallet-signature sessions and a server-side issuer allowlist; deployment requires appropriate transport, authentication hardening and secret management. This is not a certified compliance service.
- Current dependency audit results must be reviewed before deployment beyond disposable testing. No independent security audit has been performed.
- A single-member group reveals the only possible member; small groups limit privacy. Wallet address, event timing and issuer operations remain public.

## Sepolia evidence observed on 2026-11-15

- Chain ID 11155111; gate [`0xF4C449Bc9da8BBa02b0Bc8D9aD6d2f05E3271BAa`](https://repo.sourcify.dev/11155111/0xF4C449Bc9da8BBa02b0Bc8D9aD6d2f05E3271BAa), creation block 12139213, group 0. The gate is the Semaphore group administrator; its issuer is the dedicated deployer.
- Four deployment receipts and four smoke-test receipts were independently re-read from the RPC with successful status. The smoke test funded a separate participant, approved a synthetic commitment, registered with a real proof, rejected a reused nullifier via `eth_call`, revoked the commitment, and rejected the stale-root proof via `eth_call`. The participant remains registered; the test commitment is no longer approved and the current root is zero. The issuer wallet was not registered.
- The registration transaction [`0xb47f310a6771d58298fe62b0016d1bc2adeb232830cbe0fb6c2ae41471e70425`](https://sepolia.etherscan.io/tx/0xb47f310a6771d58298fe62b0016d1bc2adeb232830cbe0fb6c2ae41471e70425) used 486,234 gas. The script reported 2,311 ms for proof generation; this is one run, not a benchmark.
- Sourcify API v2 reported exact creation and runtime bytecode matches for PoseidonT3, SemaphoreVerifier, Semaphore and ComplianceGate. Its Etherscan forwarding reported a daily submission limit; independent Etherscan verification was not established. The build was not committed at deployment time.
- The local ignored `deployments/` directory contains deployment and smoke journals, plus a restricted test participant key. Those files are operational records and should be protected. The subsequent application journey is documented separately below.

### Sepolia application journey

On 2026-11-15 the local React application and loopback issuer API were configured for the deployed Sepolia gate and a dedicated PostgreSQL schema. A Chromium run with an injected test-wallet bridge submitted a synthetic application, approved and reconciled it, generated and submitted a real membership proof, loaded public audit evidence without a wallet, then revoked and reconciled the commitment. Independently re-read receipts:

- [Approval](https://sepolia.etherscan.io/tx/0x061defbd682b6092ff817eba935abf50e4ef4ce35970fba940f8f88b6de60a6d): block 12139248, 625,748 gas.
- [Registration](https://sepolia.etherscan.io/tx/0x7b9a89141f00d388f5a2288ce095eaedea8b08122d5615bf9eff7a1c82e91b74): block 12139250, 486,270 gas.
- [Revocation](https://sepolia.etherscan.io/tx/0x516eafc5910f93a8f9c4ec25bebd0102b07a7c47d035585301d5db1ff577198e): block 12139251, 224,529 gas.

Afterward the participant's registration remained true and the test commitment was no longer approved. This was a local browser and issuer service connected to Sepolia, using an automated test-wallet bridge; it is not evidence of a hosted application or an actual wallet-extension session. The dedicated PostgreSQL schema and ignored `deployments/sepolia-browser.jsonl` journal preserve the synthetic run. The browser participant key is in a separate restricted ignored file.

- The technical report was built from `TECHNICAL-REPORT-IEEE.tex` with IEEEtran conference class and Tectonic 0.17.0. The generated PDF has two pages and its extracted sections and page images were checked. Tectonic reported font-path reproducibility and underfull-line warnings; the academic content has not received independent review.

The pinned `@semaphore-protocol/proof` 4.14.2 package selects Semaphore artifact version 4.13.0. The browser checks SHA-256 hashes for depths 1–32 against `web/src/proving-artifacts.json`, records the source URL, and caches validated files; cached bytes are rechecked. Chromium tests rejected a tampered download and corrupted cache, and generated and verified a proof with the artifact host blocked after caching. This is artifact-offline proving, not an offline application: group and transaction RPC access are still needed. Hashes were recorded from the same upstream host on 2026-11-15, not authenticated against an independent signed release. The external host can observe the requester's network address; no witness is intentionally sent to it. Contract tests and the Sepolia smoke script also check the manifest and cache files in Node. A Node test generated and verified a proof with downloads disabled and rejected a modified cached file.

## UI redesign verification on 2026-11-15

After the typography and layout changes, the browser journey passed again against an isolated local Hardhat chain and PostgreSQL instance using a different disposable test account. It covered identity creation and unlock, synthetic application, approval and receipt reconciliation, real proof registration, wallet-free public audit, revocation and transaction-hash recovery. The first attempt encountered a test locator that assumed only one historical registration event; the locator was corrected and the subsequent journey passed. A test wallet bridge was used, not a browser wallet extension. No Sepolia transactions were made during this check.

A subsequent local integration run exposed a stale cached block height immediately after approval. The issuer and browser log scans now request the current RPC height directly. The issuer regression test covers a newly mined event with a stale cached height; the local approval/revocation integration and complete injected-wallet browser journey passed afterward. This does not rule out RPC reorganization or incomplete-history failures, which remain fail-closed checks.

The real-verifier contract test also covers a revocation race using a fresh, unused proof: after the issuer revokes that identity and changes the root, its pending registration reverts and the participant remains unregistered. This exercises one transaction ordering on a local chain; it does not model every network or mempool ordering.

An isolated Chromium profile was also used with the official MetaMask 13.57.0 extension and a disposable wallet. The app reached the real extension's connection approval, reported the wrong-chain condition, and connected successfully after configuring the local Hardhat network. This establishes extension connection and chain selection only; proof registration and transaction confirmation with the extension remain unverified. No public-chain transaction or user wallet was used.

The isolated MetaMask registration attempt generated a real proof, but the extension returned error 4100 on `eth_sendTransaction`; no registration transaction was confirmed. The cause remains under investigation. The UI now gives a concise wallet-authorization message rather than displaying the raw RPC payload, and that message was observed with the same extension. The synthetic application and confirmed local approval remain in the disposable local database for investigation.

The same isolated MetaMask profile returned 4100 for a separate zero-value local self-transfer requested directly through its EIP-1193 provider. This reproduces the authorization problem without the compliance contract or proof transaction; it narrows the issue to the test wallet/provider setup but does not identify the exact cause or establish that the application works with other wallets.

The same disposable extension profile also returned 4100 for a direct `personal_sign` request after exposing the connected account. This affects more than transaction submission in that profile; the extension's permission and network responses alone do not establish why signing is rejected. The original Sepolia data and user's wallet were not involved.

A fresh connection to `localhost:5174` in the same isolated MetaMask profile presented signing requests normally. The previously approved synthetic identity then generated a real proof, the MetaMask confirmation was accepted, and local transaction `0x50819c83ecd8c56c520cd129a55dd761fe12cf1cc5153cedc80cb5652be8066a` succeeded in block 29. The test identity was subsequently revoked and its receipt reconciled. The failure was specific to the earlier site connection in this test, but its precise underlying cause is unconfirmed. This was a local Hardhat chain, not Sepolia, and does not cover all wallets or wallet settings.

Registration confirmation handling was checked in the browser for successful receipt, failed receipt, missing receipt and RPC error. An uncertain result retains the transaction hash and directs the participant to check wallet or explorer activity before retrying. The full injected-wallet local browser journey also passed after the change. Transaction replacement and all wallet-specific failure modes have not been exhaustively tested.

The local browser journey now checks on-chain approval before issuance, after confirmed approval, and after confirmed revocation. Separate browser checks verified that a prior approval result clears after an RPC failure or contract-address change. These are point-in-time reads and do not guarantee that membership remains unchanged afterward.

The local browser journey also checks the registration transaction's calldata and receipt logs for its synthetic private reference, complementing the approval and revocation checks. These are targeted sentinel checks, not proof that arbitrary private information cannot be encoded into public inputs or observed through other channels.

The issuer API test also reconciles a simulated reverted receipt and verifies that the operation is returned and listed as failed. Confirmed and uncertain submission paths are covered separately; the failed receipt in this check was simulated, not a reverted Sepolia transaction.

The issuer supports an encrypted JSON keystore as an alternative to a plaintext private-key environment variable. A disposable local keystore loaded successfully in the issuer service; tests reject an incorrect password and simultaneous plaintext/keystore configuration. The passphrase remains an environment secret and the decrypted signer exists in process memory; this is not hardware custody or a public-service security review. The current Sepolia preview was not migrated to a keystore.

A fresh temporary source copy on 2026-11-15, excluding generated artifacts, dependency directories, deployment journals and environment files, completed `npm ci`, `npm run build` and `npm test` after the signer and funding changes. The clean contract run passed four tests, including the real proof and unused-proof revocation race. The install reported 34 dependency advisories across all dependencies; `npm audit --omit=dev` reported 14 (5 moderate, 9 high), with no automatic fix offered for the direct Semaphore and ethers dependency paths in that run. Advisory counts and fixes can change and are not an independent security review.

A subsequent dependency trial pinned the transitive `underscore` 1.13.6 dependency to patched 1.13.8 via an npm override. In an isolated clean install, the production audit count fell from 14 to 11 (5 moderate, 6 high), `npm ls underscore --omit=dev --all`, the build, contract tests and issuer tests passed. The working directory's already-installed modules and running previews were not reinstalled; `npm ci` is needed to use the updated lockfile there. The remaining audit includes `ws` 8.17.1 pinned by ethers and `snarkjs` 0.5.0 nested under `circom_tester`; proof generation also uses snarkjs 0.7.5. A trial forcing `ws` 8.23.0 produced an invalid dependency tree under an exact ethers dependency, so that override was not applied. This does not establish exploitability or rule it out.

After installing the updated lockfile, the local and Sepolia preview services restarted with their existing databases and chain state. Both issuer health endpoints responded, and the installed underscore version was 1.13.8. The first local browser run was interrupted by Vite's initial dependency-optimization reload before it created an application; a retry passed the complete injected-wallet journey. The browser test now waits for network idle on its initial navigation to reduce that startup race.

The interactive keystore-creation command was checked with a disposable local key: successful creation produced a decryptable mode-0600 file, an existing file was not overwritten, mismatched passphrases produced no file, non-terminal input was rejected, and invalid key errors did not echo the supplied value. These checks do not replace secure passphrase storage or managed custody.

## Wallet roles on 2026-11-15

The issuer API tests passed role authorization, challenge origin and expiry, signature replay prevention and logout. A local Chromium journey with an injected test wallet passed participant sign-in, issuer sign-in, application, approval, real proof registration, audit, revocation and recovery. These checks use a disposable local chain; earlier Sepolia journey evidence predates wallet roles and does not establish the new role flow on Sepolia. The issuer sees participant sign-in addresses and applications.
