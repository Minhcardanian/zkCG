# ZK Compliance Gate: A Privacy-Preserving Eligibility Gateway for Ethereum dApps

**Working draft — final IEEE formatting pending**

## Abstract

This project investigates whether an on-chain gate can enforce issuer-approved eligibility without revealing which member of an approved group supplied a proof. A participant creates a private Semaphore V4 identity locally, while a separate issuer screens synthetic inputs and maintains a group of public identity commitments. A Solidity gate accepts a registration only when the proof uses the current group root, a fixed action scope, a caller-bound message and an unused nullifier. The prototype comprises a React client, issuer API, PostgreSQL operation records and Ethereum contracts. Local tests exercise real proofs and adversarial cases. A Sepolia contract deployment and smoke test have been recorded; this prototype is not a certified identity or compliance service.

## I. Introduction

Public blockchains make shared enforcement auditable across applications, but publishing personal identity and eligibility records would expose them indefinitely. This prototype separates the issuer's private eligibility decision from the public authorization rule. The research question is whether an issuer-managed group can authorize an approved participant without revealing the selected group member, while enforcing revocation and one registration per credential. A centralized service is generally simpler for a single operator and does not incur proof-generation or blockchain transaction costs.

## II. System and Trust Model

The participant browser creates an identity and stores it encrypted locally with a passphrase. Only the public commitment and synthetic application are sent to the issuer. The issuer applies simulated age, jurisdiction and screening rules, stores application and operation data in PostgreSQL, and sends authorized membership transactions. The participant reconstructs the group from public events and produces a proof locally. ComplianceGate checks the policy before calling the Semaphore verifier and consuming the nullifier. The issuer is responsible for screening correctness, duplicate-applicant detection and rescreening; the proof establishes membership, not the truth of underlying attributes.

The three execution boundaries and detailed enrollment, registration and revocation sequences are documented in `ARCHITECTURE.md`. Database writes and Ethereum transactions are not atomic together. The issuer service tracks preparing, pending, confirmed, failed and unknown operations, and verifies a discovered transaction before attaching it to an uncertain operation.

## III. Protocol and Security Properties

For chain identifier `c`, gate `g`, group identifier `i`, policy identifier `p` and action `REGISTER`, the gate computes `scope = H(c, g, i, p, REGISTER)` and `message = H(sender, scope)`, using the implementation's Keccak-to-field encoding. The scope excludes the changing Merkle root so a group update does not give an existing identity a new nullifier. The current root is checked separately: an update or revocation rejects outstanding proofs against previous roots. Caller binding prevents a different sender from copying a proof. Semaphore validates the proof and rejects a nullifier already used in the group. Failed contract calls revert atomically.

Public observations include commitments, roots, transaction senders, timing, nullifiers and events. A proof does not hide the sending wallet. A group with a single member provides no anonymity, and very small groups offer limited privacy. Revocation prevents future acceptance against old roots but cannot undo an earlier accepted action. Browser compromise or theft of the identity permits impersonation until revocation. Identity recovery and anonymous network transport are outside scope.

## IV. Local Evaluation

A local Hardhat network deployed the actual Semaphore verifier, group and gate. Contract tests cover authorized and unauthorized membership changes, duplicate commitments, stale roots, wrong scope or caller, modified proof points, nonmembership and replay. Tests also check that failed validation leaves registration state unchanged. A PostgreSQL-backed issuer test covers the distinction between pending and confirmed chain operations, uncertain submissions and matching-hash recovery. A Chromium test with a local injected wallet exercised identity creation and unlock, synthetic application, approval, real proof registration, public audit, revocation and recovery.

One local test run reported 395 ms for its first proof and 315,318 gas for the registration transaction. These values are observations from a single environment and input, not a performance benchmark or Sepolia fee estimate. Some boundary tests use a verifier double; the real proof test separately exercises the actual verifier. The browser test does not establish compatibility with all wallet extensions, browsers or network failures. See `docs/VALIDATION.md` for the evidence record and limits.

## V. Limitations and Remaining Work

A Sepolia deployment and contract smoke test were recorded on 2026-11-15: approval, registration and revocation transactions confirmed, while replay and stale-root calls were rejected. The gate is at `0xF4C449Bc9da8BBa02b0Bc8D9aD6d2f05E3271BAa`; Sourcify reported exact creation and runtime matches for all four contracts. The registration used 486,234 gas and the script measured one proof at 2,311 ms. These are single observations. A later local Chromium and issuer-service journey connected to Sepolia confirmed application approval, proof registration and revocation; it used a test-wallet bridge rather than a wallet extension. Several dependency advisories remain unresolved, and the issuer's shared-token, loopback-only configuration is intended for local demonstration rather than public operation. No independent security audit has been performed. Further evaluation with wallet extensions and an independent security review is needed.

## References

[1] Semaphore, “Documentation and Concepts,” https://docs.semaphore.pse.dev/.

[2] Semaphore, “Groups,” https://docs.semaphore.pse.dev/guides/groups.

[3] Semaphore, “Proofs,” https://docs.semaphore.pse.dev/guides/proofs.

[4] Semaphore, “Solidity contracts,” https://github.com/semaphore-protocol/semaphore.
