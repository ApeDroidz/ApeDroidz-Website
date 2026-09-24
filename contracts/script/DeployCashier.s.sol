// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";

/// @notice Deploys the Droidz Survival cashier. It has no owner and no setters: what is passed here
///         is final. A wrong address means a new deploy, not a fix — check both twice.
///
///      SURVIVAL_POOL=0x... SURVIVAL_TREASURY=0x... SURVIVAL_POOL_BPS=5000 \
///        forge script script/DeployCashier.s.sol --rpc-url apechain --broadcast --verify
///
///      Then set NEXT_PUBLIC_SURVIVAL_CASHIER and SURVIVAL_CASHIER to the printed address on Vercel.
contract DeployCashier is Script {
    function run() external returns (DroidzCashier cashier) {
        address payable pool = payable(vm.envAddress("SURVIVAL_POOL"));
        address payable treasury = payable(vm.envAddress("SURVIVAL_TREASURY"));
        uint16 bps = uint16(vm.envOr("SURVIVAL_POOL_BPS", uint256(5000)));
        console.log("pool     ", pool);
        console.log("treasury ", treasury);
        console.log("pool bps ", bps);
        vm.startBroadcast();
        cashier = new DroidzCashier(pool, treasury, bps);
        vm.stopBroadcast();
        console.log("DroidzCashier", address(cashier));
    }
}
