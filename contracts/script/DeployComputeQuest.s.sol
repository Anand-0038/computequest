// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {SafeCast} from "openzeppelin-contracts/contracts/utils/math/SafeCast.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";

contract DeployComputeQuest is Script {
    using SafeCast for uint256;

    function run() external returns (CampaignEscrow escrow, uint256 campaignId) {
        uint256 sponsorPrivateKey = vm.envUint("SPONSOR_PRIVATE_KEY");
        uint256 verifierPrivateKey = vm.envUint("VERIFIER_PRIVATE_KEY");
        uint256 relayerPrivateKey = vm.envUint("RELAYER_PRIVATE_KEY");
        uint256 rewardWei = vm.envUint("DEMO_ONCHAIN_REWARD_WEI");
        uint64 maxCompletions = vm.envUint("DEMO_MAX_COMPLETIONS").toUint64();

        address verifier = vm.addr(verifierPrivateKey);
        address payable serviceTreasury = payable(vm.addr(relayerPrivateKey));
        uint256 campaignBudget = rewardWei * maxCompletions;

        vm.startBroadcast(sponsorPrivateKey);
        escrow = new CampaignEscrow(verifier);
        campaignId = escrow.createCampaign{value: campaignBudget}(serviceTreasury, rewardWei, maxCompletions);
        vm.stopBroadcast();

        console2.log("CAMPAIGN_ESCROW_ADDRESS", address(escrow));
        console2.log("DEMO_ONCHAIN_CAMPAIGN_ID", campaignId);
        console2.log("SERVICE_TREASURY_ADDRESS", serviceTreasury);
        console2.log("INITIAL_CAMPAIGN_BUDGET_WEI", campaignBudget);
    }
}
