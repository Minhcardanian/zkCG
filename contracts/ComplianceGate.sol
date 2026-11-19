// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";

contract ComplianceGate {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    bytes32 public constant ACTION = keccak256("REGISTER");
    ISemaphore public immutable semaphore;
    uint256 public immutable groupId;
    address public immutable issuer;
    bytes32 public immutable policyId;
    mapping(uint256 => bool) public approved;
    mapping(address => bool) public registered;

    error Unauthorized();
    error InvalidCommitment();
    error AlreadyApproved();
    error NotApproved();
    error AlreadyRegistered();
    error StaleRoot();
    error WrongScope();
    error WrongMessage();

    event IdentityApproved(uint256 indexed commitment);
    event IdentityRevoked(uint256 indexed commitment);
    event Registered(address indexed participant, uint256 indexed nullifier);

    constructor(ISemaphore semaphore_, address issuer_, bytes32 policyId_) {
        if (address(semaphore_) == address(0) || issuer_ == address(0)) revert InvalidCommitment();
        semaphore = semaphore_;
        issuer = issuer_;
        policyId = policyId_;
        groupId = semaphore_.createGroup();
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert Unauthorized();
        _;
    }

    function approveIdentity(uint256 commitment) external onlyIssuer {
        if (commitment == 0 || commitment >= FIELD) revert InvalidCommitment();
        if (approved[commitment]) revert AlreadyApproved();
        approved[commitment] = true;
        semaphore.addMember(groupId, commitment);
        emit IdentityApproved(commitment);
    }

    function revokeIdentity(uint256 commitment, uint256[] calldata siblings) external onlyIssuer {
        if (!approved[commitment]) revert NotApproved();
        approved[commitment] = false;
        semaphore.removeMember(groupId, commitment, siblings);
        emit IdentityRevoked(commitment);
    }

    function registrationScope() public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), groupId, policyId, ACTION))) % FIELD;
    }

    function registrationMessage(address sender) public view returns (uint256) {
        return uint256(keccak256(abi.encode(sender, registrationScope()))) % FIELD;
    }

    function registerWithProof(ISemaphore.SemaphoreProof calldata proof) external {
        if (registered[msg.sender]) revert AlreadyRegistered();
        if (proof.merkleTreeRoot != ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId)) revert StaleRoot();
        if (proof.scope != registrationScope()) revert WrongScope();
        if (proof.message != registrationMessage(msg.sender)) revert WrongMessage();
        semaphore.validateProof(groupId, proof);
        registered[msg.sender] = true;
        emit Registered(msg.sender, proof.nullifier);
    }
}
