# ZK Compliance Gate

ZK Compliance Gate is a research prototype that combines synthetic compliance screening with Semaphore zero-knowledge membership proofs. An issuer approves or revokes members, and participants can prove membership to register with the gate without publishing their identity secret.

This project is a demonstration, not a production service or certified KYC/AML solution. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and its privacy boundaries.

## Requirements

- Node.js 22 and npm
- Docker and Docker Compose for PostgreSQL
- A browser wallet configured for a local Hardhat network

## Run locally

1. Install dependencies and start PostgreSQL:

   ```sh
   npm ci
   docker compose -p zkcg-local up -d --wait postgres
   ```

2. In a separate terminal, start the local chain and deploy the contracts:

   ```sh
   npm run node
   ```

   ```sh
   npm run deploy:local
   ```

3. Copy `.env.example` to a local environment file. Set `GATE_ADDRESS`, a disposable local `ISSUER_PRIVATE_KEY`, and `ISSUER_WALLET_ADDRESSES` to the comma-separated addresses allowed to sign in as issuers. Load the variables into your shell, then start the issuer service:

   ```sh
   npm run server
   ```

4. Start the frontend with `npm run dev` and open the displayed URL. Configure your browser wallet for the local RPC and chain ID `31337`. Enter the deployed gate address in the app, or set `VITE_GATE_ADDRESS` before starting Vite.

To fund a local browser wallet with test ETH, run `npm run fund:local -- <wallet-address>`. Use disposable accounts only; never use the publicly known Hardhat keys on a public network. Keep populated environment files, wallet keys and keystores out of source control.

The issuer database is bound to a specific chain and deployment. When restarting a temporary Hardhat chain, use a new empty database or schema instead of reusing records from the previous deployment.

## Checks

```sh
npm test              # Contract tests, including a real Semaphore proof
npm run test:issuer   # Issuer API tests; requires local PostgreSQL
npm run build         # Type check and frontend build
```

Additional local-chain and browser checks are available as `npm run test:local-chain` and `npm run test:browser`; they require a running local deployment and service. Browser tests also require Playwright Chromium. The local-chain test changes the membership group.

Proof generation downloads Semaphore proving artifacts and verifies them against the checked-in hash manifest before caching them. The manifest hashes were observed from the upstream host and are not an independently signed provenance statement.

## Issuer operations

Chain writes can be preparing, pending, confirmed, failed or unknown. Reconcile a pending operation through the issuer console or `POST /api/admin/operations/:id/reconcile`. Investigate an operation without a transaction hash before retrying; if its original hash is found, attach it through the console or `POST /api/admin/operations/:id/attach` and reconcile the receipt.

The issuer can use an encrypted keystore instead of a plaintext key. Create one with `npm run keystore:create -- deployments/issuer.keystore.json`, then configure `ISSUER_KEYSTORE_PATH` and `ISSUER_KEYSTORE_PASSWORD` instead of `ISSUER_PRIVATE_KEY`. The decrypted signer remains in process memory.

## Sepolia

The repository includes deployment, verification and smoke-test scripts for Sepolia. These scripts can submit transactions and require a funded testnet account and explicit authorization. Review `.env.example` and the scripts before running them, keep private credentials out of frontend variables, and inspect deployment journals and chain state before retrying an interrupted operation.
