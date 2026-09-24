// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";

/// @dev Stands in for the Otherside Hub's FeeSplitter: takes 1.5% and forwards the rest + calldata.
contract FakeFeeSplitter {
    address payable immutable feeTo;

    constructor(address payable feeTo_) {
        feeTo = feeTo_;
    }

    function forward(address target, bytes calldata data) external payable {
        uint256 fee = msg.value * 150 / 10_000;
        (bool a,) = feeTo.call{value: fee}("");
        require(a);
        (bool b,) = target.call{value: msg.value - fee}(data);
        require(b, "forward failed");
    }
}

contract Refuses {
    receive() external payable {
        revert("no");
    }
}

/// @dev Tries to pay again from inside the payout — there is no state to corrupt, so all it can
///      do is spend its own money.
contract Reenters {
    DroidzCashier cashier;
    uint256 public hits;

    function set(DroidzCashier c) external {
        cashier = c;
    }

    receive() external payable {
        hits++;
        if (hits == 1 && address(this).balance >= 1) cashier.pay{value: 1}(address(this), bytes32("again"));
    }
}

contract DroidzCashierTest is Test {
    DroidzCashier cashier;
    address payable pool = payable(makeAddr("pool"));
    address payable treasury = payable(makeAddr("treasury"));
    address player = makeAddr("player");
    bytes32 constant ORDER = bytes32(uint256(0xabc));

    event Paid(address indexed player, bytes32 indexed order, address indexed payer, uint256 amount, uint256 toPool);

    function setUp() public {
        cashier = new DroidzCashier(pool, treasury, 5000);
        vm.deal(player, 100 ether);
    }

    function test_splitsHalfAndHalf_andHoldsNothing() public {
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, player, 1 ether, 0.5 ether);
        vm.prank(player);
        cashier.pay{value: 1 ether}(player, ORDER);
        assertEq(pool.balance, 0.5 ether);
        assertEq(treasury.balance, 0.5 ether);
        assertEq(address(cashier).balance, 0);
    }

    function test_oddWei_roundingGoesToTreasury_nothingLost() public {
        vm.prank(player);
        cashier.pay{value: 3}(player, ORDER);
        assertEq(pool.balance, 1);
        assertEq(treasury.balance, 2);
        assertEq(address(cashier).balance, 0);
    }

    function testFuzz_everyWeiForwarded(uint96 value, uint16 bps) public {
        vm.assume(value > 0);
        bps = uint16(bound(bps, 0, 10_000));
        DroidzCashier c = new DroidzCashier(pool, treasury, bps);
        uint256 p0 = pool.balance;
        uint256 t0 = treasury.balance;
        vm.deal(player, value);
        vm.prank(player);
        c.pay{value: value}(player, ORDER);
        assertEq(pool.balance - p0 + treasury.balance - t0, value);
        assertEq(pool.balance - p0, uint256(value) * bps / 10_000);
        assertEq(address(c).balance, 0);
    }

    function test_throughTheHubFeeSplitter_playerIsTheNamedOne() public {
        address payable hubTreasury = payable(makeAddr("hubTreasury"));
        FakeFeeSplitter hub = new FakeFeeSplitter(hubTreasury);
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, address(hub), 0.985 ether, 0.4925 ether);
        vm.prank(player);
        hub.forward{value: 1 ether}(address(cashier), abi.encodeCall(DroidzCashier.pay, (player, ORDER)));
        assertEq(hubTreasury.balance, 0.015 ether);
        assertEq(pool.balance, 0.4925 ether);
        assertEq(treasury.balance, 0.4925 ether);
    }

    function test_refusesZeroValue() public {
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoValue.selector);
        cashier.pay(player, ORDER);
    }

    function test_refusesMissingPlayer() public {
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoPlayer.selector);
        cashier.pay{value: 1 ether}(address(0), ORDER);
    }

    function test_refusesBareTransfer() public {
        vm.prank(player);
        (bool ok,) = address(cashier).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(cashier).balance, 0);
    }

    function test_aRecipientThatRefuses_revertsTheWholePayment() public {
        Refuses r = new Refuses();
        DroidzCashier c = new DroidzCashier(payable(address(r)), treasury, 5000);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(DroidzCashier.TransferFailed.selector, address(r)));
        c.pay{value: 1 ether}(player, ORDER);
        assertEq(player.balance, 100 ether);
    }

    function test_reentryOnlySpendsTheReenterersOwnMoney() public {
        Reenters r = new Reenters();
        vm.deal(address(r), 1);
        DroidzCashier c = new DroidzCashier(payable(address(r)), treasury, 5000);
        r.set(c);
        vm.prank(player);
        c.pay{value: 1 ether}(player, ORDER);
        assertEq(address(c).balance, 0);
        assertEq(treasury.balance, 0.5 ether + 1); // the re-entered 1 wei: 0 to pool (rounded), 1 to treasury
    }

    function test_badConfigRefused() public {
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(payable(address(0)), treasury, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(pool, pool, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(pool, treasury, 10_001);
    }

    function test_immutableConfig() public view {
        assertEq(cashier.pool(), pool);
        assertEq(cashier.treasury(), treasury);
        assertEq(cashier.poolBps(), 5000);
    }
}
