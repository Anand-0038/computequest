// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

contract CampaignEscrow is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    struct Campaign {
        address sponsor;
        address payable payoutRecipient;
        uint256 remainingBudget;
        uint256 rewardPerCompletion;
        uint64 maxCompletions;
        uint64 completionCount;
        bool active;
    }

    struct CompletionReceipt {
        uint256 campaignId;
        bytes32 sessionHash;
        bytes32 viewerIdHash;
        uint256 reward;
        uint64 issuedAt;
        uint64 expiresAt;
        uint256 nonce;
    }

    bytes32 public constant COMPLETION_RECEIPT_TYPEHASH = keccak256(
        "CompletionReceipt(uint256 campaignId,bytes32 sessionHash,bytes32 viewerIdHash,uint256 reward,uint64 issuedAt,uint64 expiresAt,uint256 nonce)"
    );

    address public immutable verifier;
    uint256 public nextCampaignId = 1;
    mapping(uint256 => Campaign) public campaigns;
    mapping(bytes32 => bool) public consumedSessionHash;

    error UnauthorizedVerifier();
    error InvalidCampaign();
    error CampaignInactive();
    error InvalidReward();
    error InvalidCapacity();
    error ExpiredReceipt();
    error ReceiptNotYetValid();
    error SessionAlreadyConsumed();
    error InsufficientBudget();
    error SponsorOnly();
    error CampaignMustBePaused();
    error TransferFailed();
    error ZeroAddress();

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed sponsor,
        address indexed payoutRecipient,
        uint256 rewardPerCompletion,
        uint64 maxCompletions,
        uint256 initialBudget
    );
    event CampaignFunded(uint256 indexed campaignId, address indexed funder, uint256 amount);
    event CompletionSettled(
        uint256 indexed campaignId,
        bytes32 indexed sessionHash,
        bytes32 indexed viewerIdHash,
        uint256 amount,
        address payoutRecipient
    );
    event CampaignPaused(uint256 indexed campaignId);
    event CampaignWithdrawn(uint256 indexed campaignId, address indexed sponsor, uint256 amount);

    constructor(address verifier_) EIP712("ComputeQuest CampaignEscrow", "1") {
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
    }

    function createCampaign(address payable payoutRecipient, uint256 rewardPerCompletion, uint64 maxCompletions)
        external
        payable
        returns (uint256 campaignId)
    {
        if (payoutRecipient == address(0)) revert ZeroAddress();
        if (rewardPerCompletion == 0) revert InvalidReward();
        if (maxCompletions == 0) revert InvalidCapacity();
        if (msg.value < rewardPerCompletion) revert InsufficientBudget();

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            sponsor: msg.sender,
            payoutRecipient: payoutRecipient,
            remainingBudget: msg.value,
            rewardPerCompletion: rewardPerCompletion,
            maxCompletions: maxCompletions,
            completionCount: 0,
            active: true
        });

        emit CampaignCreated(campaignId, msg.sender, payoutRecipient, rewardPerCompletion, maxCompletions, msg.value);
    }

    function fundCampaign(uint256 campaignId) external payable {
        Campaign storage campaign = _campaign(campaignId);
        if (msg.value == 0) revert InsufficientBudget();
        campaign.remainingBudget += msg.value;
        emit CampaignFunded(campaignId, msg.sender, msg.value);
    }

    function settleVerifiedCompletion(CompletionReceipt calldata receipt, bytes calldata signature)
        external
        nonReentrant
    {
        Campaign storage campaign = _campaign(receipt.campaignId);
        if (!campaign.active) revert CampaignInactive();
        if (block.timestamp < receipt.issuedAt) revert ReceiptNotYetValid();
        if (block.timestamp > receipt.expiresAt) revert ExpiredReceipt();
        if (receipt.reward != campaign.rewardPerCompletion) revert InvalidReward();
        if (consumedSessionHash[receipt.sessionHash]) revert SessionAlreadyConsumed();
        if (campaign.completionCount >= campaign.maxCompletions) revert InvalidCapacity();
        if (campaign.remainingBudget < receipt.reward) revert InsufficientBudget();

        bytes32 structHash = keccak256(
            abi.encode(
                COMPLETION_RECEIPT_TYPEHASH,
                receipt.campaignId,
                receipt.sessionHash,
                receipt.viewerIdHash,
                receipt.reward,
                receipt.issuedAt,
                receipt.expiresAt,
                receipt.nonce
            )
        );
        address recovered = _hashTypedDataV4(structHash).recover(signature);
        if (recovered != verifier) revert UnauthorizedVerifier();

        consumedSessionHash[receipt.sessionHash] = true;
        campaign.remainingBudget -= receipt.reward;
        campaign.completionCount += 1;

        (bool success,) = campaign.payoutRecipient.call{value: receipt.reward}("");
        if (!success) revert TransferFailed();

        emit CompletionSettled(
            receipt.campaignId, receipt.sessionHash, receipt.viewerIdHash, receipt.reward, campaign.payoutRecipient
        );
    }

    function pauseCampaign(uint256 campaignId) external {
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.sponsor) revert SponsorOnly();
        campaign.active = false;
        emit CampaignPaused(campaignId);
    }

    function withdrawRemainingFunds(uint256 campaignId) external nonReentrant {
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.sponsor) revert SponsorOnly();
        if (campaign.active) revert CampaignMustBePaused();

        uint256 amount = campaign.remainingBudget;
        campaign.remainingBudget = 0;
        (bool success,) = payable(campaign.sponsor).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit CampaignWithdrawn(campaignId, campaign.sponsor, amount);
    }

    function receiptDigest(CompletionReceipt calldata receipt) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    COMPLETION_RECEIPT_TYPEHASH,
                    receipt.campaignId,
                    receipt.sessionHash,
                    receipt.viewerIdHash,
                    receipt.reward,
                    receipt.issuedAt,
                    receipt.expiresAt,
                    receipt.nonce
                )
            )
        );
    }

    function _campaign(uint256 campaignId) private view returns (Campaign storage campaign) {
        campaign = campaigns[campaignId];
        if (campaign.sponsor == address(0)) revert InvalidCampaign();
    }
}
