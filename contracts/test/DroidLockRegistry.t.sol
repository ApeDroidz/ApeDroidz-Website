// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidLockRegistry} from "../src/DroidLockRegistry.sol";

contract MockDroidz {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }

    function forceTransfer(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }
}

contract DroidLockRegistryTest is Test {
    MockDroidz droidz;
    DroidLockRegistry registry;
    bytes32 ack;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        droidz = new MockDroidz();
        registry = new DroidLockRegistry(address(droidz));
        ack = registry.ACKNOWLEDGEMENT();

        droidz.mint(alice, 1);
        droidz.mint(alice, 2);
        droidz.mint(bob, 3);
    }

    function test_acknowledgementPreimageIsAuditable() public view {
        assertEq(ack, keccak256("I UNDERSTAND THIS LOCK IS PERMANENT AND CAN NEVER BE UNDONE"));
    }

    function test_ownerCanLock() public {
        vm.prank(alice);
        registry.lockForever(1, ack);

        assertTrue(registry.isLocked(1));
        assertTrue(registry.locked(1));
        assertEq(registry.lockOwnerOf(1), alice);
        assertEq(registry.lockedAt(1), uint64(block.timestamp));
        assertEq(registry.totalLocked(), 1);
    }

    function test_lockEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit DroidLockRegistry.DroidLockedForever(1, alice, uint64(block.timestamp));

        vm.prank(alice);
        registry.lockForever(1, ack);
    }

    function test_wrongAcknowledgementReverts() public {
        vm.prank(alice);
        vm.expectRevert(DroidLockRegistry.BadAcknowledgement.selector);
        registry.lockForever(1, keccak256("oops"));
    }

    function test_cannotLockSomeoneElsesDroid() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DroidLockRegistry.NotTokenOwner.selector, 1, bob, alice));
        registry.lockForever(1, ack);
    }

    function test_cannotLockTwice() public {
        vm.startPrank(alice);
        registry.lockForever(1, ack);
        vm.expectRevert(abi.encodeWithSelector(DroidLockRegistry.AlreadyLocked.selector, 1));
        registry.lockForever(1, ack);
        vm.stopPrank();
    }

    /// @notice The registry exposes no way to undo a lock. This asserts the ABI itself is clean,
    ///         so a future edit that adds an unlock path breaks the test suite.
    function test_registryExposesNoUnlockFunction() public view {
        string[7] memory forbidden = [
            "unlock(uint256)",
            "unlockForever(uint256)",
            "setLocked(uint256,bool)",
            "clearLock(uint256)",
            "owner()",
            "transferOwnership(address)",
            "upgradeTo(address)"
        ];

        for (uint256 i = 0; i < forbidden.length; ++i) {
            bytes4 selector = bytes4(keccak256(bytes(forbidden[i])));
            (bool ok,) = address(registry).staticcall(abi.encodeWithSelector(selector, 1));
            assertFalse(ok, forbidden[i]);
        }
    }

    function test_batchLock() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.prank(alice);
        registry.lockForeverBatch(ids, ack);

        assertEq(registry.lockCountOf(alice), 2);
        assertEq(registry.totalLocked(), 2);
        assertEq(registry.lockedTokensOf(alice).length, 2);
    }

    function test_batchLockIsAllOrNothing() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 3; // bob's

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DroidLockRegistry.NotTokenOwner.selector, 3, alice, bob));
        registry.lockForeverBatch(ids, ack);

        assertFalse(registry.isLocked(1), "the whole batch must roll back");
    }

    function test_emptyBatchReverts() public {
        uint256[] memory ids = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert(DroidLockRegistry.EmptyBatch.selector);
        registry.lockForeverBatch(ids, ack);
    }

    function test_isStillHeldGoesFalseIfEnforcementEverFails() public {
        vm.prank(alice);
        registry.lockForever(1, ack);
        assertTrue(registry.isStillHeld(1));

        droidz.forceTransfer(bob, 1);

        assertTrue(registry.isLocked(1), "the record is permanent");
        assertFalse(registry.isStillHeld(1), "but the reward claim must no longer count");
    }

    function test_paginationCoversEveryLock() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        vm.prank(alice);
        registry.lockForeverBatch(ids, ack);
        vm.prank(bob);
        registry.lockForever(3, ack);

        uint256[] memory page = registry.lockedTokens(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0], 1);
        assertEq(page[1], 2);

        page = registry.lockedTokens(2, 50);
        assertEq(page.length, 1, "count must clamp to the end of the list");
        assertEq(page[0], 3);

        page = registry.lockedTokens(99, 10);
        assertEq(page.length, 0);
    }

    function testFuzz_onlyTheHolderCanLock(address caller) public {
        vm.assume(caller != alice);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(DroidLockRegistry.NotTokenOwner.selector, 1, caller, alice));
        registry.lockForever(1, ack);
    }
}
