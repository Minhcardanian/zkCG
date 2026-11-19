# ZK Compliance Gate architecture

This document describes the target architecture from the term-project proposal. Implementation status is tracked separately; the description is not a claim that components are complete.

## Trust boundaries

1. **Participant device:** React and TypeScript UI, wallet adapter and Semaphore V4 prover. The private identity is generated and encrypted locally. Only its public commitment is submitted to the issuer. Proofs are generated on the device.
2. **Issuer environment:** a restricted REST API, synthetic age/jurisdiction/screening decisions, PostgreSQL and an authorized transaction signer. The issuer is trusted to screen, prevent duplicate applicants and re-screen; a membership proof does not prove underlying attributes.
3. **Ethereum:** ComplianceGate manages the issuer-controlled Semaphore group and enforces proof-gated registration through Semaphore and its verifier. Public data includes commitments, roots, nullifiers, proofs, senders and events, not private screening records.

## Wallet access

A wallet signs a short-lived challenge to establish a server session. The server assigns issuer access from its configured wallet-address allowlist; other authenticated wallets are participants. The issuer sign-in wallet is separate from the backend signer that submits on-chain group updates. Session tokens expire after eight hours, and the browser keeps them only in memory. The issuer can observe the participant sign-in address and application; the membership proof does not conceal that relationship from the issuer. Public audit remains accessible without sign-in. This loopback prototype is not a production identity system.

## Flows

- Enrollment: a participant creates an identity, submits the commitment and a private reference; the issuer screens synthetic data and approves or rejects. Only an approval submits a group update.
- Registration: reconstruct the current group, generate a membership proof locally, and submit it with the participant wallet. The gate checks the current root, fixed scope and caller-bound message before calling Semaphore to verify and consume the nullifier.
- Revocation: the issuer removes the commitment using its current Merkle siblings. A new root invalidates outstanding old-root proofs, but does not undo earlier registrations. If the root changes during proving, regenerate the proof.
- Audit: inspect public roots and events without exposing screening records. Membership anonymity depends on the group: a single-member group provides no membership anonymity and very small groups provide limited privacy. It does not hide wallet addresses, timing, group updates or issuer metadata.

The action scope is derived from chain ID, gate address, group ID, policy ID and action; it must not include the changing root. The message is derived from sender and scope. A failed verification must not change registration state.

## Consistency and limitations

The issuer binds a database to the chain, gate, group and group-creation block to avoid mixing records across deployments. PostgreSQL decisions and blockchain writes are separate transactions. Track pending, confirmed and failed operations and reconcile receipts before reporting a chain update as complete. Network and signer failures must remain visible. A compromised browser or identity secret permits impersonation until revocation. No identity recovery, real document collection, commercial screening, legally certified compliance, live financial product or anonymous network transport is included.

## Local and testnet environments

The target toolchain is Solidity, Semaphore V4, React/TypeScript, a local Ethereum node, a private issuer API and PostgreSQL. Pin compatible versions and record local test, proof timing and gas evidence. Sepolia deployment and verification are separate from local validation and require explicit authorization.

## Design diagrams

### 1. Component and trust boundaries

```mermaid
flowchart LR
  subgraph Participant[Participant device]
    UI[React interface] --> Prover[Semaphore prover]
    UI --> Wallet[Browser wallet]
    Secret[Encrypted local identity] --> Prover
  end
  subgraph Issuer[Issuer environment]
    API[Issuer API] --> DB[(Private PostgreSQL)]
    API --> Signer[Authorized signer]
  end
  subgraph Ethereum[Ethereum]
    Gate[ComplianceGate] --> Semaphore[Semaphore group and verifier]
  end
  UI -->|Commitment and synthetic application| API
  Signer -->|Approve or revoke| Gate
  Prover -->|Proof| Wallet
  Wallet -->|Register| Gate
```

### 2. Use cases

```mermaid
flowchart LR
  Participant --> Identity[Create or unlock identity]
  Participant --> Apply[Submit synthetic application]
  Participant --> Register[Register with membership proof]
  Issuer --> Review[Review screening decision]
  Issuer --> Approve[Approve commitment]
  Issuer --> Revoke[Revoke commitment]
  Auditor --> Inspect[Inspect public root and events]
```

### 3. Issuance

```mermaid
sequenceDiagram
  participant P as Participant
  participant I as Issuer API
  participant D as Private database
  participant G as ComplianceGate
  P->>P: Create private identity locally
  P->>I: Public commitment and synthetic application
  I->>D: Record screening decision
  alt Approved and issuer submits
    I->>D: Record preparing operation
    I->>G: Approve commitment
    I->>D: Record transaction and reconcile receipt
  else Rejected
    I-->>P: Rejected with no membership transaction
  end
```

### 4. Proof-gated registration

```mermaid
sequenceDiagram
  participant P as Participant browser
  participant S as Semaphore
  participant G as ComplianceGate
  P->>S: Read group events and current root
  P->>P: Reconstruct group and generate proof locally
  P->>G: registerWithProof from wallet
  G->>G: Check current root, fixed scope and caller message
  G->>S: Verify proof and consume nullifier
  S-->>G: Valid
  G-->>P: Registration event and receipt
```

### 5. Revocation

```mermaid
sequenceDiagram
  participant I as Issuer
  participant S as Semaphore
  participant G as ComplianceGate
  participant P as Participant
  I->>S: Reconstruct group and membership path
  I->>G: Revoke commitment with siblings
  G->>S: Remove member and update root
  P->>G: Submit proof using earlier root
  G-->>P: Reject stale root
  Note over P,G: Previously accepted registrations remain recorded.
```
