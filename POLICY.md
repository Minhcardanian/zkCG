# Project policy

## Coding conventions

Keep application, issuer service and contract responsibilities separate. Use TypeScript's strict mode for application code, explicit validation at trust boundaries, pinned dependencies and reproducible scripts. Prefer small domain-focused modules and shared types over duplicated business rules. Treat addresses, proof inputs and monetary or field values as typed data; do not silently coerce unsafe numbers. Keep configuration and keys out of source control.

Contracts must make authorization and state transitions explicit. Any proof validation must use Semaphore's real verifier, bind the caller and fixed action scope, reject stale roots, and leave no state change on failure. Never place private screening records or identity secrets in calldata, events or contract storage.

## Comments

Name code clearly. Add comments for non-obvious security invariants, protocol constraints and decisions that cannot be inferred from the code; avoid narrating statements or duplicating documentation. Update or remove stale comments when behavior changes.

## Testing

Run relevant local tests, build and type checks before proposing a push. Test observable behavior and critical trust boundaries, including adversarial paths; avoid redundant tests that repeat implementation details or assertions already covered at the same boundary. Prefer one meaningful integration test to several duplicate mocks. Record actual proof time, gas and results rather than estimates. Never treat mocked proof verification as evidence of real cryptographic verification.

## Privacy and operations

Use synthetic screening inputs only. Never commit secrets, wallet keys, personal records, generated credentials or local environment files. Distinguish database decisions from confirmed chain state; surface pending and failed transactions and reconcile receipts. This is a research prototype, not certified KYC/AML.
