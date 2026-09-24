// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";

/// @notice Deploys the Droidz Survival cashier. It has no owner and no setters: what is passed here
///         is final. A wrong address means a new deploy, not a fix — the script refuses to run
///         unless every address matches the ones agreed with the owner (24.09.2026).
///
///      SURVIVAL_SOLO_VAULT=0x84B7… SURVIVAL_COOP_VAULT=0xA7E5… SURVIVAL_TEAM=0xE794… SURVIVAL_POOL_BPS=5000 \
///        forge script script/DeployCashier.s.sol --rpc-url apechain --account <deployer> --broadcast --verify
///
///      Then set SURVIVAL_CASHIER and NEXT_PUBLIC_SURVIVAL_CASHIER to the printed address on Vercel.
contract DeployCashier is Script {
    address constant AGREED_SOLO = 0x84B732Da60a0955e890c58C344a8E9ED4C2aB8f2;
    address constant AGREED_COOP = 0xA7E56FC068dfc0Dd1F2799d8c3826Cd27631203c;
    address constant AGREED_TEAM = 0xE7946895522ed49D8DB161E126622De6e07C8Faa;

    function run() external returns (DroidzCashier cashier) {
        address payable solo = payable(vm.envAddress("SURVIVAL_SOLO_VAULT"));
        address payable coop = payable(vm.envAddress("SURVIVAL_COOP_VAULT"));
        address payable team = payable(vm.envAddress("SURVIVAL_TEAM"));
        uint256 bps = vm.envOr("SURVIVAL_POOL_BPS", uint256(5000));
        require(solo == AGREED_SOLO && coop == AGREED_COOP && team == AGREED_TEAM, "addresses differ from the agreed ones");
        require(bps == 5000, "the agreed split is 50/50");
        console.log("solo vault", solo);
        console.log("coop vault", coop);
        console.log("team      ", team);
        console.log("pool bps  ", bps);
        vm.startBroadcast();
        cashier = new DroidzCashier(solo, coop, team, uint16(bps));
        vm.stopBroadcast();
        console.log("DroidzCashier", address(cashier));
    }
}
