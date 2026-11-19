// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract SemaphoreDouble {
    uint256 public root;
    mapping(uint256 => bool) public used;
    bool public rejectProof;
    function createGroup() external pure returns (uint256) { return 0; }
    function addMember(uint256, uint256) external { root++; }
    function removeMember(uint256, uint256, uint256[] calldata) external { root++; }
    function getMerkleTreeRoot(uint256) external view returns (uint256) { return root; }
    function setRejectProof(bool value) external { rejectProof = value; }
    function validateProof(uint256, ISemaphore.SemaphoreProof calldata proof) external {
        require(!rejectProof && !used[proof.nullifier], "invalid proof");
        used[proof.nullifier] = true;
    }
}
