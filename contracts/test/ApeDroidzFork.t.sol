// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidLockRegistry} from "../src/DroidLockRegistry.sol";
import {DroidzTransferValidator} from "../src/DroidzTransferValidator.sol";

interface IApeDroidz {
    function owner() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
    function burnEnabled() external view returns (bool);
    function getTransferValidator() external view returns (address);
    function setTransferValidator(address validator) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function burn(uint256 tokenId) external;
    function setBurnEnabled(bool enabled) external;
}

/// @notice Proves the lock behaviour against the real ApeDroidz contract and the real Limit Break
///         validator state on ApeChain, rather than against a mock of what we think they do.
contract ApeDroidzForkTest is Test {
    address constant DROIDZ = 0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3;
    address constant COLLECTION_OWNER = 0x3C4E3fDb4a8820561a450430f590EA30E1A04954;
    address constant LIMIT_BREAK_VALIDATOR = 0x721C00D4FB075b22a5469e9CF2440697F729aA13;

    IApeDroidz droidz = IApeDroidz(DROIDZ);
    DroidLockRegistry registry;
    DroidzTransferValidator validator;

    bytes32 ack;

    address holderA;
    uint256 tokenA;
    address holderB;
    uint256 tokenB;

    address constant RECIPIENT = address(0xDEAD1);
    address constant MARKETPLACE = address(0xBEEF1);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("apechain"));

        registry = new DroidLockRegistry(DROIDZ);
        validator = new DroidzTransferValidator(DROIDZ, address(registry), LIMIT_BREAK_VALIDATOR);
        ack = registry.ACKNOWLEDGEMENT();

        vm.prank(COLLECTION_OWNER);
        droidz.setTransferValidator(address(validator));

        (holderA, tokenA, holderB, tokenB) = _findTwoDistinctHolders();
    }

    // --- the collection is wired to our validator, and still works ---------------------------

    function test_validatorIsInstalled() public view {
        assertEq(droidz.getTransferValidator(), address(validator));
    }

    function test_unlockedDroidStillTransfersNormally() public {
        vm.prank(holderB);
        droidz.transferFrom(holderB, RECIPIENT, tokenB);

        assertEq(droidz.ownerOf(tokenB), RECIPIENT);
    }

    function test_unlockedDroidStillTransfersViaOperator() public {
        vm.prank(holderB);
        droidz.setApprovalForAll(MARKETPLACE, true);

        vm.prank(MARKETPLACE);
        droidz.transferFrom(holderB, RECIPIENT, tokenB);

        assertEq(droidz.ownerOf(tokenB), RECIPIENT);
    }

    // --- a locked droid cannot move, by any route ---------------------------------------------

    function test_lockedDroidCannotBeTransferredByOwner() public {
        _lock(holderA, tokenA);

        vm.prank(holderA);
        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        droidz.transferFrom(holderA, RECIPIENT, tokenA);

        assertEq(droidz.ownerOf(tokenA), holderA, "droid must stay in the holder's wallet");
    }

    function test_lockedDroidCannotBeSafeTransferred() public {
        _lock(holderA, tokenA);

        vm.prank(holderA);
        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        droidz.safeTransferFrom(holderA, RECIPIENT, tokenA);
    }

    function test_lockedDroidCannotBeMovedByAnApprovedOperator() public {
        // approval granted *before* the lock, as it would be for a live marketplace listing
        vm.prank(holderA);
        droidz.setApprovalForAll(MARKETPLACE, true);

        _lock(holderA, tokenA);

        vm.prank(MARKETPLACE);
        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        droidz.transferFrom(holderA, RECIPIENT, tokenA);
    }

    function test_lockedDroidCannotBeMovedBySingleTokenApproval() public {
        _lock(holderA, tokenA);

        vm.prank(holderA);
        droidz.approve(MARKETPLACE, tokenA);

        vm.prank(MARKETPLACE);
        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        droidz.transferFrom(holderA, RECIPIENT, tokenA);
    }

    function test_lockedDroidCannotBeSentToTheZeroAddressPath() public {
        _lock(holderA, tokenA);

        // ERC721 rejects the zero address before the validator is ever consulted; asserting it
        // here documents that there is no "transfer to burn address" escape hatch.
        vm.prank(holderA);
        vm.expectRevert();
        droidz.transferFrom(holderA, address(0), tokenA);
    }

    /// @notice The guarantee is not per-marketplace, and this is the test that says so.
    ///
    /// @dev Ownership of an ERC-721 can only change through the token's own transfer functions, and
    ///      in `BleverErc721C` every one of them routes through `_beforeTokenTransfer` into the
    ///      validator. So a locked droid resists an *arbitrary* caller holding operator approval —
    ///      OpenSea, Magic Eden, OSWiki, relay.link, a venue that does not exist yet, or a contract
    ///      written specifically to try. Enumerating marketplaces shows we did not *break* them;
    ///      this shows none of them can move a locked droid.
    function testFuzz_noCallerAnywhereCanMoveALockedDroid(address caller, address recipient) public {
        vm.assume(recipient != address(0) && recipient != holderA);
        vm.assume(caller != address(0));
        // ERC-721 rejects approving yourself as operator; the owner's own path is covered by
        // test_lockedDroidCannotBeTransferredByOwner.
        vm.assume(caller != holderA);
        // `CreatorTokenBase._preValidateTransfer` skips validation when the validator itself is the
        // caller. Pranking as the validator fakes a call it can never actually make: this contract
        // has no function that calls the token, and its fallback only staticcalls a fixed address.
        vm.assume(caller != address(validator));

        _lock(holderA, tokenA);

        // hand the caller the strongest privilege a marketplace could ever hold
        vm.prank(holderA);
        droidz.setApprovalForAll(caller, true);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        droidz.transferFrom(holderA, recipient, tokenA);

        assertEq(droidz.ownerOf(tokenA), holderA);
    }

    // --- burn is the one path that bypasses the validator entirely ---------------------------

    function test_burnIsDisabledOnChain() public view {
        assertFalse(droidz.burnEnabled(), "burnEnabled must stay false or locked droids become destroyable");
    }

    function test_burnCannotDestroyALockedDroidWhileBurnStaysDisabled() public {
        _lock(holderA, tokenA);

        vm.prank(holderA);
        vm.expectRevert("Burn disabled");
        droidz.burn(tokenA);
    }

    /// @notice Documents the known escape hatch: burning is routed to `_preValidateBurn`, which the
    ///         Limit Break base leaves empty, so the validator is never consulted. If the collection
    ///         owner ever enables burning, a locked droid can be destroyed. This test asserts that
    ///         risk explicitly so it cannot be forgotten.
    function test_KNOWN_RISK_enablingBurnLetsALockedDroidBeDestroyed() public {
        _lock(holderA, tokenA);

        vm.prank(COLLECTION_OWNER);
        droidz.setBurnEnabled(true);

        vm.prank(holderA);
        droidz.burn(tokenA);

        vm.expectRevert();
        droidz.ownerOf(tokenA);

        assertTrue(registry.isLocked(tokenA), "the registry record survives");
        assertFalse(registry.isStillHeld(tokenA), "but the lock is void, and reward logic must see that");
    }

    // --- OpenSea's authorized-transfer hooks must not break -----------------------------------

    /// @dev SignedZoneV16Royalty calls these on whatever validator a signed order names. If they
    ///      were missing, every royalty-enforced OpenSea sale would revert once we are the validator.
    function test_openSeaAuthorizedTransferHooksExistAndSucceedForUnlockedDroids() public view {
        validator.beforeAuthorizedTransfer(MARKETPLACE, DROIDZ);
        validator.afterAuthorizedTransfer(DROIDZ);
        validator.beforeAuthorizedTransfer(DROIDZ, tokenB);
        validator.afterAuthorizedTransfer(DROIDZ, tokenB);
        validator.beforeAuthorizedTransfer(MARKETPLACE, DROIDZ, tokenB);
        validator.beforeAuthorizedTransferWithAmount(DROIDZ, tokenB, 1);
        validator.afterAuthorizedTransferWithAmount(DROIDZ, tokenB);
    }

    function test_openSeaAuthorizedTransferHookRejectsALockedDroid() public {
        _lock(holderA, tokenA);

        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        validator.beforeAuthorizedTransfer(DROIDZ, tokenA);

        vm.expectRevert(abi.encodeWithSelector(DroidzTransferValidator.TokenPermanentlyLocked.selector, tokenA));
        validator.beforeAuthorizedTransfer(MARKETPLACE, DROIDZ, tokenA);
    }

    function test_authorizedTransferHooksIgnoreOtherCollections() public {
        _lock(holderA, tokenA);

        // same token id, different collection — must not be rejected
        validator.beforeAuthorizedTransfer(address(0xC0FFEE), tokenA);
    }

    // --- registry bookkeeping -----------------------------------------------------------------

    function test_registryRecordsTheLock() public {
        _lock(holderA, tokenA);

        assertTrue(registry.isLocked(tokenA));
        assertTrue(registry.isStillHeld(tokenA));
        assertEq(registry.lockOwnerOf(tokenA), holderA);
        assertEq(registry.lockCountOf(holderA), 1);
        assertEq(registry.totalLocked(), 1);
        assertEq(registry.lockedTokensOf(holderA)[0], tokenA);
    }

    function _lock(address holder, uint256 tokenId) private {
        vm.prank(holder);
        registry.lockForever(tokenId, ack);
    }

    /// @dev Walks real token ids until it finds two held by different wallets.
    function _findTwoDistinctHolders() private view returns (address a, uint256 idA, address b, uint256 idB) {
        uint256 supply = droidz.totalSupply();
        for (uint256 tokenId = 1; tokenId <= supply; ++tokenId) {
            address holder = droidz.ownerOf(tokenId);
            if (holder.code.length > 0) continue; // keep to EOAs so transfers behave plainly
            if (a == address(0)) {
                a = holder;
                idA = tokenId;
            } else if (holder != a) {
                return (a, idA, holder, tokenId);
            }
        }
        revert("could not find two distinct EOA holders");
    }
}
