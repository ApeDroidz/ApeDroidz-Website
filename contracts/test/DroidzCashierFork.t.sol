// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";

/// @dev The live Otherside Hub FeeSplitter on ApeChain (proxy, verified implementation
///      0x65737286d1720FA1e0e871Bb3E21A295284641Ee). The Hub sends every paid partner call through
///      `execute(target, data, feeBps)`.
interface IFeeSplitter {
    function execute(address target, bytes calldata data, uint256 feeBps) external payable returns (bytes memory);
    function treasury() external view returns (address);
}

/// @notice A payment for Droidz Survival made exactly the way the Otherside Hub makes it — through
///         the real FeeSplitter, on a fork of ApeChain mainnet.
///         forge test --match-contract DroidzCashierFork --fork-url apechain
contract DroidzCashierForkTest is Test {
    IFeeSplitter constant HUB = IFeeSplitter(0x8E756CA736Da338d78C436C47A41aC18CE72Cf63);

    event Paid(address indexed player, bytes32 indexed order, address indexed payer, uint256 amount, uint256 toPool);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("apechain"));
    }

    function test_paidThroughTheRealHubFeeSplitter() public {
        address payable pool = payable(makeAddr("pool"));
        address payable treasury = payable(makeAddr("treasury"));
        DroidzCashier cashier = new DroidzCashier(pool, treasury, 5000);
        address player = makeAddr("glyphPlayer");
        vm.deal(player, 10 ether);
        bytes32 order = keccak256("order-1");
        address hubTreasury = HUB.treasury();
        uint256 hubBefore = hubTreasury.balance;
        // On a fork the fresh test address may already hold mainnet dust — measure the change.
        uint256 cashierBefore = address(cashier).balance;

        vm.expectEmit(address(cashier));
        emit Paid(player, order, address(HUB), 0.985 ether, 0.4925 ether);
        vm.prank(player);
        HUB.execute{value: 1 ether}(address(cashier), abi.encodeCall(DroidzCashier.pay, (player, order)), 150);

        assertEq(hubTreasury.balance - hubBefore, 0.015 ether, "Hub fee 1.5%");
        assertEq(pool.balance, 0.4925 ether, "half of the net to the pool");
        assertEq(treasury.balance, 0.4925 ether, "half of the net to the treasury");
        assertEq(address(cashier).balance, cashierBefore, "the cashier keeps nothing");
    }

    function test_aRevertInsideTheCashierRevertsTheWholeHubCall() public {
        DroidzCashier cashier = new DroidzCashier(payable(makeAddr("pool")), payable(makeAddr("treasury")), 5000);
        address player = makeAddr("glyphPlayer");
        vm.deal(player, 10 ether);
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoPlayer.selector);
        HUB.execute{value: 1 ether}(address(cashier), abi.encodeCall(DroidzCashier.pay, (address(0), bytes32(0))), 150);
        assertEq(player.balance, 10 ether, "nothing left the player's wallet");
    }
}
