// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DroidzTransferValidator} from "../src/DroidzTransferValidator.sol";

interface IApeDroidz {
    function owner() external view returns (address);
    function getTransferValidator() external view returns (address);
    function setTransferValidator(address validator) external;
    function burnEnabled() external view returns (bool);
}

/// @notice Step 2 of 2. Points the ApeDroidz collection at our validator. Requires the owner key.
///
/// @dev This is the switch that makes locking real. It is reversible by the collection owner
///      (that is the known trade-off), but it changes live transfer behaviour for all 3333 droids,
///      so it checks its inputs before broadcasting.
///
///      VALIDATOR=0x... forge script script/SetValidator.s.sol --rpc-url apechain --broadcast
contract SetValidator is Script {
    address constant DROIDZ = 0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3;

    function run() external {
        address validatorAddress = vm.envAddress("VALIDATOR");
        DroidzTransferValidator validator = DroidzTransferValidator(validatorAddress);
        IApeDroidz droidz = IApeDroidz(DROIDZ);

        require(validator.collection() == DROIDZ, "validator is bound to a different collection");
        require(address(validator.lockRegistry()) != address(0), "validator has no lock registry");
        require(droidz.burnEnabled() == false, "burn is enabled: locked droids would be destroyable");

        address currentOwner = droidz.owner();
        console.log("Collection owner:  ", currentOwner);
        console.log("Current validator: ", droidz.getTransferValidator());
        console.log("New validator:     ", validatorAddress);
        console.log("Lock registry:     ", address(validator.lockRegistry()));

        vm.startBroadcast();
        droidz.setTransferValidator(validatorAddress);
        vm.stopBroadcast();

        require(droidz.getTransferValidator() == validatorAddress, "validator was not applied");
        console.log("");
        console.log("Live. Permanent locking is now enforced on ApeDroidz.");
    }
}
