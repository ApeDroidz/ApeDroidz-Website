// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DroidLockRegistry} from "../src/DroidLockRegistry.sol";
import {DroidzTransferValidator} from "../src/DroidzTransferValidator.sol";

/// @notice Step 1 of 2. Deploys the lock registry and the transfer validator.
///
/// @dev This step is harmless on its own: nothing is wired to the collection yet, so the
///      collection keeps behaving exactly as it does today. Run Step 2 (SetValidator) only once
///      these addresses are verified on the explorer and you are ready to go live.
///
///      forge script script/Deploy.s.sol --rpc-url apechain --broadcast --verify
contract Deploy is Script {
    address constant DROIDZ = 0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3;
    address constant LIMIT_BREAK_VALIDATOR = 0x721C00D4FB075b22a5469e9CF2440697F729aA13;

    function run() external returns (DroidLockRegistry registry, DroidzTransferValidator validator) {
        vm.startBroadcast();

        registry = new DroidLockRegistry(DROIDZ);
        validator = new DroidzTransferValidator(DROIDZ, address(registry), LIMIT_BREAK_VALIDATOR);

        vm.stopBroadcast();

        console.log("DroidLockRegistry:      ", address(registry));
        console.log("DroidzTransferValidator:", address(validator));
        console.log("");
        console.log("Nothing is live yet. The collection still uses its current validator.");
        console.log("Next: verify both on apescan.io, then run script/SetValidator.s.sol.");
    }
}
