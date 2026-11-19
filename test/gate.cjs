const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ComplianceGate policy boundaries (verifier double)", function () {
  let gate, sem, issuer, alice, bob;
  async function rejects(action, reason) {
    try { await action(); expect.fail("expected revert"); }
    catch (error) { expect(String(error)).to.include(reason); }
  }
  beforeEach(async function () {
    [issuer, alice, bob] = await ethers.getSigners();
    sem = await (await ethers.getContractFactory("SemaphoreDouble")).deploy();
    gate = await (await ethers.getContractFactory("ComplianceGate")).deploy(await sem.getAddress(), issuer.address, ethers.id("policy"));
  });
  async function proof(sender, nullifier = 42n) {
    return { merkleTreeDepth: 1, merkleTreeRoot: await sem.root(), nullifier,
      message: await gate.registrationMessage(sender.address), scope: await gate.registrationScope(), points: Array(8).fill(0) };
  }
  it("restricts membership changes, rejects duplicates, and revokes", async function () {
    await rejects(() => gate.connect(alice).approveIdentity(11), "Unauthorized");
    await gate.approveIdentity(11);
    await rejects(() => gate.approveIdentity(11), "AlreadyApproved");
    await rejects(() => gate.connect(alice).revokeIdentity(11, []), "Unauthorized");
    await gate.revokeIdentity(11, []);
    expect(await gate.approved(11)).to.equal(false);
  });
  it("rejects stale roots, wrong scope and copied caller messages without registering", async function () {
    await gate.approveIdentity(11);
    const p = await proof(alice);
    await rejects(() => gate.connect(bob).registerWithProof(p), "WrongMessage");
    await rejects(() => gate.connect(alice).registerWithProof({...p, scope: p.scope + 1n}), "WrongScope");
    const scope = await gate.registrationScope();
    await gate.approveIdentity(12);
    expect(await gate.registrationScope()).to.equal(scope);
    await rejects(() => gate.connect(alice).registerWithProof(p), "StaleRoot");
    expect(await gate.registered(alice.address)).to.equal(false);
  });
  it("rolls back rejected proofs and consumes a nullifier once", async function () {
    await gate.approveIdentity(11);
    const p = await proof(alice);
    await sem.setRejectProof(true);
    await rejects(() => gate.connect(alice).registerWithProof(p), "invalid proof");
    expect(await gate.registered(alice.address)).to.equal(false);
    expect(await sem.used(p.nullifier)).to.equal(false);
    await sem.setRejectProof(false);
    await gate.connect(alice).registerWithProof(p);
    expect(await gate.registered(alice.address)).to.equal(true);
    const copiedNullifier = await proof(bob);
    await rejects(() => gate.connect(bob).registerWithProof(copiedNullifier), "invalid proof");
    expect(await gate.registered(bob.address)).to.equal(false);
  });
});
