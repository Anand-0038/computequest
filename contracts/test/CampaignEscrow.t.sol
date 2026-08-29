// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";

contract CampaignEscrowTest is Test {
    uint256 internal verifierKey = 0xA11CE;
    address internal verifier;
    address internal sponsor = makeAddr("sponsor");
    address payable internal treasury = payable(makeAddr("treasury"));
    CampaignEscrow internal escrow;
    uint256 internal campaignId;

    function setUp() public {
        verifier = vm.addr(verifierKey);
        escrow = new CampaignEscrow(verifier);
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        campaignId = escrow.createCampaign{value: 2 ether}(treasury, 0.2 ether, 10);
    }

    function testSettlesValidReceiptAndRejectsReplay() public {
        CampaignEscrow.CompletionReceipt memory receipt = _receipt(bytes32("session-1"));
        bytes memory signature = _sign(receipt);

        uint256 beforeBalance = treasury.balance;
        escrow.settleVerifiedCompletion(receipt, signature);

        assertEq(treasury.balance, beforeBalance + 0.2 ether);
        assertTrue(escrow.consumedSessionHash(receipt.sessionHash));
        (,, uint256 remaining,,, uint64 count,) = escrow.campaigns(campaignId);
        assertEq(remaining, 1.8 ether);
        assertEq(count, 1);

        vm.expectRevert(CampaignEscrow.SessionAlreadyConsumed.selector);
        escrow.settleVerifiedCompletion(receipt, signature);
    }

    function testRejectsWrongVerifier() public {
        CampaignEscrow.CompletionReceipt memory receipt = _receipt(bytes32("session-2"));
        bytes32 digest = escrow.receiptDigest(receipt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);

        vm.expectRevert(CampaignEscrow.UnauthorizedVerifier.selector);
        escrow.settleVerifiedCompletion(receipt, abi.encodePacked(r, s, v));
    }

    function testRejectsExpiredReceipt() public {
        CampaignEscrow.CompletionReceipt memory receipt = _receipt(bytes32("session-3"));
        receipt.expiresAt = uint64(block.timestamp - 1);
        bytes memory signature = _sign(receipt);

        vm.expectRevert(CampaignEscrow.ExpiredReceipt.selector);
        escrow.settleVerifiedCompletion(receipt, signature);
    }

    function testSponsorCanPauseAndWithdraw() public {
        vm.prank(sponsor);
        escrow.pauseCampaign(campaignId);
        uint256 beforeBalance = sponsor.balance;
        vm.prank(sponsor);
        escrow.withdrawRemainingFunds(campaignId);
        assertEq(sponsor.balance, beforeBalance + 2 ether);
    }

    function _receipt(bytes32 sessionHash) internal view returns (CampaignEscrow.CompletionReceipt memory) {
        return CampaignEscrow.CompletionReceipt({
            campaignId: campaignId,
            sessionHash: sessionHash,
            viewerIdHash: keccak256("demo-viewer"),
            reward: 0.2 ether,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 10 minutes),
            nonce: 1
        });
    }

    function _sign(CampaignEscrow.CompletionReceipt memory receipt) internal view returns (bytes memory) {
        bytes32 digest = escrow.receiptDigest(receipt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function testReceiptDigestMatchesViemGoldenVector() public {
        vm.chainId(10143);
        address vectorAddress = address(0x1111111111111111111111111111111111111111);
        vm.etch(vectorAddress, address(escrow).code);
        CampaignEscrow vectorContract = CampaignEscrow(vectorAddress);
        CampaignEscrow.CompletionReceipt memory receipt = CampaignEscrow.CompletionReceipt({
            campaignId: 7,
            sessionHash: bytes32(uint256(type(uint256).max / 0xff * 0x22)),
            viewerIdHash: bytes32(uint256(type(uint256).max / 0xff * 0x33)),
            reward: 1_000_000_000_000_000,
            issuedAt: 1_700_000_000,
            expiresAt: 1_700_000_600,
            nonce: 42
        });

        assertEq(
            vectorContract.receiptDigest(receipt), 0x06d262bf3df82ff48c0d210e7e1155a0d17748b3fa5e88499fd682a50dfa6209
        );
    }
}
