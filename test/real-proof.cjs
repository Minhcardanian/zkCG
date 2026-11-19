const { expect } = require("chai");
const { ethers } = require("hardhat");
const { Identity, Group } = require("@semaphore-protocol/core");
const { generatePinnedProof: generateProof } = require("../scripts/lib/proving-artifacts.cjs");

describe("Semaphore real proof integration", function () {
  this.timeout(240000);
  it("verifies a member and prevents reuse across wallets and group changes", async function () {
    const expectRevert = async (fn, reason) => {
      try { await fn(); expect.fail('expected revert'); } catch (error) { expect(String(error)).to.include(reason); }
    };
    const [issuer, alice, bob, charlie] = await ethers.getSigners();
    const poseidon = await (await ethers.getContractFactory("PoseidonT3")).deploy();
    const verifier = await (await ethers.getContractFactory("SemaphoreVerifier")).deploy();
    const semaphore = await (await ethers.getContractFactory("Semaphore", { libraries: { PoseidonT3: await poseidon.getAddress() } })).deploy(await verifier.getAddress());
    const gate = await (await ethers.getContractFactory("ComplianceGate")).deploy(await semaphore.getAddress(), issuer.address, ethers.id("policy"));
    const identity = new Identity();
    const group = new Group([identity.commitment]);
    await gate.approveIdentity(identity.commitment);
    const start = Date.now();
    const proof = await generateProof(identity, group, await gate.registrationMessage(alice.address), await gate.registrationScope());
    console.log(`    Real proof generated in ${Date.now() - start} ms`);
    await gate.approveIdentity(new Identity().commitment);
    await expectRevert(() => gate.connect(alice).registerWithProof(proof), 'StaleRoot');
    expect(await gate.registered(alice.address)).to.equal(false);
    // Rebuild from the actual additional commitment before proving against the current root.
    const added = await semaphore.queryFilter(semaphore.filters.MemberAdded(await gate.groupId()));
    const currentGroup = new Group(added.map(event => event.args.identityCommitment));
    const currentProof = await generateProof(identity, currentGroup, await gate.registrationMessage(alice.address), await gate.registrationScope());
    await expectRevert(() => gate.connect(bob).registerWithProof(currentProof), 'WrongMessage');
    const altered = { ...currentProof, points: [...currentProof.points] };
    altered.points[0] = (BigInt(altered.points[0]) + 1n).toString();
    await expectRevert(() => gate.connect(alice).registerWithProof(altered), 'Semaphore__InvalidProof');
    expect(await gate.registered(alice.address)).to.equal(false);
    let nonmemberRejected = false;
    try { await generateProof(new Identity(), currentGroup, await gate.registrationMessage(bob.address), await gate.registrationScope()); } catch { nonmemberRejected = true; }
    expect(nonmemberRejected).to.equal(true);
    const receipt = await (await gate.connect(alice).registerWithProof(currentProof)).wait();
    console.log(`    Registration gas: ${receipt.gasUsed}`);
    expect(await gate.registered(alice.address)).to.equal(true);
    const another = new Identity();
    await gate.approveIdentity(another.commitment);
    currentGroup.addMember(another.commitment);
    const second = await generateProof(identity, currentGroup, await gate.registrationMessage(bob.address), await gate.registrationScope());
    await expectRevert(() => gate.connect(bob).registerWithProof(second), 'Semaphore__YouAreUsingTheSameNullifierTwice');
    expect(await gate.registered(bob.address)).to.equal(false);
    const siblings = currentGroup.generateMerkleProof(currentGroup.indexOf(identity.commitment)).siblings;
    await gate.revokeIdentity(identity.commitment, siblings);
    expect(await gate.approved(identity.commitment)).to.equal(false);
    await expectRevert(() => gate.connect(bob).registerWithProof(second), 'StaleRoot');

    // Race a fresh, unused proof against revocation before the participant registers.
    currentGroup.removeMember(currentGroup.indexOf(identity.commitment));
    const candidate = new Identity();
    await gate.approveIdentity(candidate.commitment);
    currentGroup.addMember(candidate.commitment);
    const pendingProof = await generateProof(candidate, currentGroup, await gate.registrationMessage(charlie.address), await gate.registrationScope());
    const candidateSiblings = currentGroup.generateMerkleProof(currentGroup.indexOf(candidate.commitment)).siblings;
    await gate.revokeIdentity(candidate.commitment, candidateSiblings);
    await expectRevert(() => gate.connect(charlie).registerWithProof(pendingProof), 'StaleRoot');
    expect(await gate.registered(charlie.address)).to.equal(false);
  });
});
