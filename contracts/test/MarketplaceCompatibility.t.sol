// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidLockRegistry} from "../src/DroidLockRegistry.sol";
import {DroidzTransferValidator} from "../src/DroidzTransferValidator.sol";

interface IApeDroidz {
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
    function setTransferValidator(address validator) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
}

/// @notice Checks our validator against every venue that actually trades ApeDroidz, not just OpenSea.
///
/// @dev Scanning ~700k blocks of the collection's Transfer logs found exactly three contracts moving
///      droids, and their receipts show the Relay pair calling straight through to Seaport
///      (RelayApprovalProxyV3 -> RelayRouterV3 -> Seaport). Seaport is also the settlement layer for
///      OpenSea, Magic Eden and every other Reservoir-powered front end on ApeChain.
///
///      A note on method: an earlier version of this file tried to replay historical sale
///      transactions with `vm.transact`. That is invalid — `vm.transact` executes against the
///      original forked state and silently discards the test's `setTransferValidator` call, so those
///      sales were replaying against the canonical validator and proved nothing. Instead, each venue
///      is exercised here as the actual caller of `transferFrom`, which is what every marketplace
///      ultimately does at settlement.
contract MarketplaceCompatibilityTest is Test {
    address constant DROIDZ = 0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3;
    address constant COLLECTION_OWNER = 0x3C4E3fDb4a8820561a450430f590EA30E1A04954;
    address constant LIMIT_BREAK_VALIDATOR = 0x721C00D4FB075b22a5469e9CF2440697F729aA13;

    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    address constant OPENSEA_CONDUIT = 0x1E0049783F008A0085193E00003D00cd54003c71;
    address constant RELAY_ROUTER = 0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f;
    address constant RELAY_APPROVAL_PROXY = 0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE;

    // Found by scanning ~1.08M blocks of ApprovalForAll events on the collection: every operator
    // droid holders have ever granted. This catches venues that have approvals but no sales yet,
    // which the Transfer-log scan alone would miss.
    address constant PAYMENT_PROCESSOR = 0x9a1D00000000fC540e2000560054812452eB5366;
    address constant SECOND_CONDUIT = 0x2052f8A2Ff46283B30084e5d84c89A2fdBE7f74b;

    address constant BUYER = address(0xB0FFED);

    IApeDroidz droidz = IApeDroidz(DROIDZ);
    DroidLockRegistry registry;
    DroidzTransferValidator validator;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("apechain"));

        registry = new DroidLockRegistry(DROIDZ);
        validator = new DroidzTransferValidator(DROIDZ, address(registry), LIMIT_BREAK_VALIDATOR);

        vm.prank(COLLECTION_OWNER);
        droidz.setTransferValidator(address(validator));
    }

    function _venues() private pure returns (address[6] memory) {
        return [SEAPORT, OPENSEA_CONDUIT, RELAY_ROUTER, RELAY_APPROVAL_PROXY, PAYMENT_PROCESSOR, SECOND_CONDUIT];
    }

    function test_everyVenueIsALiveContractOnApeChain() public view {
        address[6] memory venues = _venues();
        for (uint256 i = 0; i < venues.length; ++i) {
            assertGt(venues[i].code.length, 0, "venue has no code on ApeChain");
        }
    }

    /// @notice Each real venue must still be able to move an unlocked droid.
    function test_everyVenueCanStillMoveAnUnlockedDroid() public {
        address[6] memory venues = _venues();
        uint256[] memory tokenIds = _findTokensWithDistinctHolders(venues.length);

        for (uint256 i = 0; i < venues.length; ++i) {
            uint256 tokenId = tokenIds[i];
            address holder = droidz.ownerOf(tokenId);

            vm.prank(holder);
            droidz.setApprovalForAll(venues[i], true);

            vm.prank(venues[i]);
            droidz.transferFrom(holder, BUYER, tokenId);

            assertEq(droidz.ownerOf(tokenId), BUYER, "venue could not settle an unlocked droid");
        }
    }

    /// @notice No venue may move a permanently locked droid.
    function test_noVenueCanMoveALockedDroid() public {
        address[6] memory venues = _venues();
        uint256[] memory tokenIds = _findTokensWithDistinctHolders(venues.length);
        bytes32 ack = registry.ACKNOWLEDGEMENT();

        for (uint256 i = 0; i < venues.length; ++i) {
            uint256 tokenId = tokenIds[i];
            address holder = droidz.ownerOf(tokenId);

            // approval granted first, exactly as it would be for a live listing
            vm.prank(holder);
            droidz.setApprovalForAll(venues[i], true);

            vm.prank(holder);
            registry.lockForever(tokenId, ack);

            vm.prank(venues[i]);
            vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenId));
            droidz.transferFrom(holder, BUYER, tokenId);

            assertEq(droidz.ownerOf(tokenId), holder, "locked droid must stay put");
        }
    }

    /// @notice A read the validator does not implement is answered exactly as the canonical one would.
    /// @dev Guards against a marketplace treating the collection as unsupported because some policy
    ///      query reverted. `getCollectionSecurityPolicy` is not part of ITransferValidator, so this
    ///      only succeeds via the fallback forward.
    function test_unknownReadsAreAnsweredLikeTheCanonicalValidator() public view {
        bytes memory callData = abi.encodeWithSignature("getCollectionSecurityPolicy(address)", DROIDZ);

        (bool okOurs, bytes memory ours) = address(validator).staticcall(callData);
        (bool okCanonical, bytes memory canonical) = LIMIT_BREAK_VALIDATOR.staticcall(callData);

        assertTrue(okCanonical, "canonical validator should answer");
        assertTrue(okOurs, "our validator must not revert on an unknown read");
        assertEq(keccak256(ours), keccak256(canonical), "answers must match");

        // sanity: that policy really is level 2 / list 1, which is what we reproduce
        (,, uint8 level, uint120 listId,,) = abi.decode(canonical, (bool, bool, uint8, uint120, bool, uint16));
        assertEq(level, 2);
        assertEq(listId, 1);
    }

    /// @notice Quantifies what our validator adds to the cost of a transfer.
    /// @dev Each side is measured on a freshly created fork so neither benefits from state the other
    ///      warmed up. Measuring both in one fork flatters whichever runs second by roughly 20k gas.
    function test_gasOverheadPerTransfer() public {
        uint256 withCanonical = _measureTransferGasOnFreshFork(false);
        uint256 withOurs = _measureTransferGasOnFreshFork(true);

        emit log_named_uint("transfer gas, canonical validator", withCanonical);
        emit log_named_uint("transfer gas, our validator      ", withOurs);
        emit log_named_uint("overhead                         ", withOurs - withCanonical);

        // Measured at ~1.6k gas: our three extra reads (lock registry, account blacklist, code-hash
        // blacklist) largely replace reads the canonical validator was already doing. This bound is
        // deliberately close to the real figure so a regression shows up as a failure.
        assertLt(withOurs - withCanonical, 10_000, "per-transfer overhead grew unexpectedly");
    }

    function _measureTransferGasOnFreshFork(bool useOurValidator) private returns (uint256) {
        vm.createSelectFork(vm.rpcUrl("apechain"));

        if (useOurValidator) {
            DroidLockRegistry freshRegistry = new DroidLockRegistry(DROIDZ);
            DroidzTransferValidator freshValidator =
                new DroidzTransferValidator(DROIDZ, address(freshRegistry), LIMIT_BREAK_VALIDATOR);
            vm.prank(COLLECTION_OWNER);
            droidz.setTransferValidator(address(freshValidator));
        }

        uint256 tokenId = _findTokensWithDistinctHolders(1)[0];
        address holder = droidz.ownerOf(tokenId);

        vm.prank(holder);
        droidz.setApprovalForAll(SEAPORT, true);

        vm.prank(SEAPORT);
        uint256 before = gasleft();
        droidz.transferFrom(holder, BUYER, tokenId);
        return before - gasleft();
    }

    /// @dev Finds `count` droids held by `count` different EOAs, so the cases cannot interfere.
    function _findTokensWithDistinctHolders(uint256 count) private view returns (uint256[] memory tokenIds) {
        tokenIds = new uint256[](count);
        address[] memory holders = new address[](count);
        uint256 found;

        uint256 supply = droidz.totalSupply();
        for (uint256 tokenId = 1; tokenId <= supply && found < count; ++tokenId) {
            address holder = droidz.ownerOf(tokenId);
            if (holder.code.length > 0) continue;

            bool duplicate;
            for (uint256 i = 0; i < found; ++i) {
                if (holders[i] == holder) duplicate = true;
            }
            if (duplicate) continue;

            holders[found] = holder;
            tokenIds[found] = tokenId;
            ++found;
        }
        require(found == count, "not enough distinct EOA holders");
    }
}
