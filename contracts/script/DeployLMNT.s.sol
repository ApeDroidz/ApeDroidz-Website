// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LMNT1155} from "../src/LMNT1155.sol";
import {ApeChain} from "../src/ApeChain.sol";

/// @notice Deploys LMNT™ by ApeDroidz: the implementation and its proxy, nothing else.
///
/// @dev The collection comes up empty and inert — no items exist, no minter is authorised — so this
///      step drops nothing and gives nobody any power beyond the owner it is handed. Creating the
///      item ids and authorising the backend are owner calls, and the owner is meant to be a cold
///      address that is not the deployer, so they are deliberately not part of this script.
///
///      The three derivation parameters below can never be changed after this runs. They are
///      asserted against the live registry in test/LMNT1155Fork.t.sol.
///
///      LMNT_OWNER=0x... forge script script/DeployLMNT.s.sol --rpc-url apechain --broadcast --verify
contract DeployLMNT is Script {
    string constant BASE_URI = "https://apedroidz.com/api/metadata/lmnt/";
    // The metadata API keys collection-level documents off the literal segment "collection" — see
    // src/app/api/metadata/[type]/[id]/route.ts. It has no handler for the "lmnt" type yet; both
    // that branch and this URL must answer before the drop is announced, or every marketplace and
    // indexer reads a 404 for the whole collection.
    string constant CONTRACT_URI = "https://apedroidz.com/api/metadata/lmnt/collection";
    uint96 constant ROYALTY_BPS = 500;

    function run() external returns (LMNT1155 lmnt) {
        address owner = vm.envAddress("LMNT_OWNER");

        vm.startBroadcast();

        LMNT1155 implementation = new LMNT1155();
        LMNT1155.InitParams memory params = LMNT1155.InitParams({
            owner_: owner,
            collection_: ApeChain.DROIDZ,
            registry_: ApeChain.REGISTRY,
            accountImplementation_: ApeChain.ACCOUNT_PROXY,
            accountLogic_: ApeChain.ACCOUNT_LOGIC,
            accountSalt_: ApeChain.SALT,
            name_: unicode"LMNT™ by ApeDroidz",
            symbol_: "LMNT",
            baseUri_: BASE_URI,
            contractUri_: CONTRACT_URI,
            royaltyReceiver_: owner,
            royaltyFeeNumerator_: ROYALTY_BPS
        });
        lmnt =
            LMNT1155(address(new ERC1967Proxy(address(implementation), abi.encodeCall(LMNT1155.initialize, (params)))));

        vm.stopBroadcast();

        console.log("LMNT1155 implementation:", address(implementation));
        console.log("LMNT1155 (use this one):", address(lmnt));
        console.log("owner:                  ", owner);
        console.log("");
        console.log("Nothing has been dropped. No item exists and no address can mint.");
        console.log("Next, from the owner wallet:");
        console.log("  setMinter(<backend wallet>, true)");
        console.log("  createItem(1, false, false, false, true, 0, 3333)     // ELEMENT       bound, per droid");
        console.log("  createItem(2, false, false, false, true, 1, 3333)     // ELEMENT SUPER same claim group as 1");
        console.log("");
        console.log("Item 2 joins item 1's claim group: a droid earns one sneaker or the other,");
        console.log("never both, and that is enforced on chain rather than by whatever mints them.");
        console.log("");
        console.log("Note both sneakers start NON-burnable. Nothing consumes them yet, and loosen()");
        console.log("can turn burning on when the crafting contract ships. Granting it up front only");
        console.log("widens what an approved operator could destroy.");
    }
}
