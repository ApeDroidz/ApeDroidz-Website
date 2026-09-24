// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";

/// @dev Stands in for the Otherside Hub's FeeSplitter: takes `bps` and forwards the rest + calldata.
contract FakeFeeSplitter {
    address payable immutable feeTo;

    constructor(address payable feeTo_) {
        feeTo = feeTo_;
    }

    function execute(address target, bytes calldata data, uint256 bps) external payable {
        uint256 fee = msg.value * bps / 10_000;
        (bool a,) = feeTo.call{value: fee}("");
        require(a);
        (bool b, bytes memory r) = target.call{value: msg.value - fee}(data);
        if (!b) {
            assembly {
                revert(add(r, 0x20), mload(r))
            }
        }
    }
}

contract Refuses {
    receive() external payable {
        revert("no");
    }
}

/// @dev A recipient that tries to pay again from inside its payout — there is no state to corrupt.
contract Reenters {
    DroidzCashier public cashier;
    uint256 public hits;

    function set(DroidzCashier c) external {
        cashier = c;
    }

    receive() external payable {
        hits++;
        if (hits == 1 && address(this).balance >= 2) cashier.pay{value: 2}(address(this), bytes32("again"), 0);
    }
}

/// @dev Burns all gas it is given — the cashier forwards all gas, so this only hurts its caller.
contract GasHog {
    receive() external payable {
        while (true) {}
    }
}

contract DroidzCashierTest is Test {
    DroidzCashier cashier;
    address payable solo = payable(makeAddr("soloVault"));
    address payable coop = payable(makeAddr("coopVault"));
    address payable team = payable(makeAddr("team"));
    address player = makeAddr("player");
    bytes32 constant ORDER = bytes32(uint256(0xabc));

    event Paid(address indexed player, bytes32 indexed order, address indexed payer, uint8 mode, uint256 amount, uint256 toPool);

    function setUp() public {
        cashier = new DroidzCashier(solo, coop, team, 5000);
        vm.deal(player, 1000 ether);
    }

    // ── the happy paths ──────────────────────────────────────────────────────

    function test_solo_halfToSoloVault_halfToTeam() public {
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, player, 0, 2 ether, 1 ether);
        vm.prank(player);
        cashier.pay{value: 2 ether}(player, ORDER, 0);
        assertEq(solo.balance, 1 ether);
        assertEq(coop.balance, 0);
        assertEq(team.balance, 1 ether);
        assertEq(address(cashier).balance, 0);
    }

    function test_coop_halfToCoopVault_halfToTeam() public {
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, player, 1, 2 ether, 1 ether);
        vm.prank(player);
        cashier.pay{value: 2 ether}(player, ORDER, 1);
        assertEq(coop.balance, 1 ether);
        assertEq(solo.balance, 0);
        assertEq(team.balance, 1 ether);
    }

    function test_oddWei_roundingGoesToTeam_nothingLost() public {
        vm.prank(player);
        cashier.pay{value: 3}(player, ORDER, 0);
        assertEq(solo.balance, 1);
        assertEq(team.balance, 2);
        assertEq(address(cashier).balance, 0);
    }

    function test_oneWei_allToTeam() public {
        vm.prank(player);
        cashier.pay{value: 1}(player, ORDER, 1);
        assertEq(coop.balance, 0);
        assertEq(team.balance, 1);
    }

    function test_someoneElsePays_eventNamesThePlayer_notThePayer() public {
        address friend = makeAddr("friend");
        vm.deal(friend, 5 ether);
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, friend, 0, 2 ether, 1 ether);
        vm.prank(friend);
        cashier.pay{value: 2 ether}(player, ORDER, 0);
    }

    function test_throughAHubFeeSplitter_payerIsTheSplitter_playerStaysNamed() public {
        address payable hubTreasury = payable(makeAddr("hubTreasury"));
        FakeFeeSplitter hub = new FakeFeeSplitter(hubTreasury);
        vm.expectEmit(address(cashier));
        emit Paid(player, ORDER, address(hub), 0, 1.97 ether, 0.985 ether);
        vm.prank(player);
        hub.execute{value: 2 ether}(address(cashier), abi.encodeCall(DroidzCashier.pay, (player, ORDER, 0)), 150);
        assertEq(hubTreasury.balance, 0.03 ether);
        assertEq(solo.balance, 0.985 ether);
        assertEq(team.balance, 0.985 ether);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_everyWeiForwarded_toTheRightVault(uint128 value, uint16 bps, uint8 mode, address who, bytes32 order)
        public
    {
        vm.assume(value > 0 && who != address(0) && order != bytes32(0));
        mode = mode % 2;
        bps = uint16(bound(bps, 0, 10_000));
        DroidzCashier c = new DroidzCashier(solo, coop, team, bps);
        uint256 s0 = solo.balance;
        uint256 c0 = coop.balance;
        uint256 t0 = team.balance;
        vm.deal(address(this), value);
        c.pay{value: value}(who, order, mode);
        uint256 pool = uint256(value) * bps / 10_000;
        assertEq(mode == 0 ? solo.balance - s0 : coop.balance - c0, pool, "pool share to the mode's vault");
        assertEq(mode == 0 ? coop.balance - c0 : solo.balance - s0, 0, "nothing to the other vault");
        assertEq(team.balance - t0, uint256(value) - pool, "the rest to the team");
        assertEq(address(c).balance, 0, "nothing kept");
    }

    // ── refusals ─────────────────────────────────────────────────────────────

    function test_refusesZeroValue() public {
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoValue.selector);
        cashier.pay(player, ORDER, 0);
    }

    function test_refusesMissingPlayer() public {
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoPlayer.selector);
        cashier.pay{value: 1 ether}(address(0), ORDER, 0);
    }

    function test_refusesMissingOrder() public {
        vm.prank(player);
        vm.expectRevert(DroidzCashier.NoOrder.selector);
        cashier.pay{value: 1 ether}(player, bytes32(0), 0);
    }

    function testFuzz_refusesUnknownMode(uint8 mode) public {
        vm.assume(mode > 1);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(DroidzCashier.BadMode.selector, mode));
        cashier.pay{value: 1 ether}(player, ORDER, mode);
    }

    function test_refusesBareTransfer_andUnknownCalls() public {
        vm.startPrank(player);
        (bool a,) = address(cashier).call{value: 1 ether}("");
        (bool b,) = address(cashier).call{value: 1 ether}(abi.encodeWithSignature("withdraw()"));
        (bool c,) = address(cashier).call{value: 1 ether}(abi.encodeWithSignature("pay(address,bytes32)", player, ORDER));
        vm.stopPrank();
        assertFalse(a);
        assertFalse(b);
        assertFalse(c, "the v1 two-argument pay must not land anywhere");
        assertEq(address(cashier).balance, 0);
        assertEq(player.balance, 1000 ether);
    }

    function test_aRecipientThatRefuses_revertsTheWholePayment() public {
        Refuses r = new Refuses();
        DroidzCashier c = new DroidzCashier(payable(address(r)), coop, team, 5000);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(DroidzCashier.TransferFailed.selector, address(r)));
        c.pay{value: 1 ether}(player, ORDER, 0);
        assertEq(player.balance, 1000 ether);
    }

    function test_aGasHogRecipient_onlyRevertsThePayment() public {
        GasHog h = new GasHog();
        DroidzCashier c = new DroidzCashier(solo, coop, payable(address(h)), 5000);
        vm.prank(player);
        vm.expectRevert();
        c.pay{value: 1 ether, gas: 1_000_000}(player, ORDER, 0);
        assertEq(address(c).balance, 0);
    }

    function test_reentryOnlySpendsTheReenterersOwnMoney() public {
        Reenters r = new Reenters();
        vm.deal(address(r), 2);
        DroidzCashier c = new DroidzCashier(payable(address(r)), coop, team, 5000);
        r.set(c);
        vm.prank(player);
        c.pay{value: 1 ether}(player, ORDER, 0);
        assertEq(address(c).balance, 0);
        assertEq(team.balance, 0.5 ether + 1, "the re-entered 2 wei split 1/1");
        assertEq(r.hits(), 2);
    }

    function test_forcedEther_isNeverMovedByPay() public {
        vm.deal(address(cashier), 7 ether); // as if force-sent; pay must only ever move msg.value
        vm.prank(player);
        cashier.pay{value: 2 ether}(player, ORDER, 0);
        assertEq(address(cashier).balance, 7 ether);
        assertEq(solo.balance + team.balance, 2 ether);
    }

    function test_badConfigRefused() public {
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(payable(address(0)), coop, team, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, payable(address(0)), team, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, coop, payable(address(0)), 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, solo, team, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, coop, solo, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, coop, coop, 5000);
        vm.expectRevert(DroidzCashier.BadConfig.selector);
        new DroidzCashier(solo, coop, team, 10_001);
    }

    function test_noOwner_noStorage_noSetters() public view {
        assertEq(cashier.soloVault(), solo);
        assertEq(cashier.coopVault(), coop);
        assertEq(cashier.team(), team);
        assertEq(cashier.poolBps(), 5000);
        // Every immutable lives in the bytecode; not one storage slot is ever written.
        for (uint256 i; i < 8; i++) {
            assertEq(vm.load(address(cashier), bytes32(i)), bytes32(0));
        }
    }
}

/// @dev Drives random payments for the invariant run.
contract CashierHandler is Test {
    DroidzCashier public cashier;
    uint256 public paidIn;
    uint256 public expectSolo;
    uint256 public expectCoop;
    uint256 public expectTeam;

    constructor(DroidzCashier c) {
        cashier = c;
    }

    function pay(uint96 value, uint8 mode, address player, bytes32 order) external {
        value = uint96(bound(value, 1, 1_000_000 ether));
        mode = mode % 2;
        if (player == address(0)) player = address(1);
        if (order == bytes32(0)) order = bytes32(uint256(1));
        vm.deal(address(this), value);
        cashier.pay{value: value}(player, order, mode);
        uint256 pool = uint256(value) * cashier.poolBps() / 10_000;
        paidIn += value;
        if (mode == 0) expectSolo += pool;
        else expectCoop += pool;
        expectTeam += value - pool;
    }

    function junk(uint96 value, bytes calldata data) external {
        value = uint96(bound(value, 1, 1000 ether));
        vm.deal(address(this), value);
        (bool ok,) = address(cashier).call{value: value}(data);
        // Only a well-formed pay may ever succeed — count it if it did.
        if (ok) {
            (address player, bytes32 order, uint8 mode) = abi.decode(data[4:], (address, bytes32, uint8));
            uint256 pool = uint256(value) * cashier.poolBps() / 10_000;
            paidIn += value;
            if (mode == 0) expectSolo += pool;
            else expectCoop += pool;
            expectTeam += value - pool;
            player;
            order;
        }
    }
}

contract DroidzCashierInvariantTest is Test {
    DroidzCashier cashier;
    CashierHandler handler;
    address payable solo = payable(makeAddr("inv.solo"));
    address payable coop = payable(makeAddr("inv.coop"));
    address payable team = payable(makeAddr("inv.team"));

    function setUp() public {
        cashier = new DroidzCashier(solo, coop, team, 5000);
        handler = new CashierHandler(cashier);
        targetContract(address(handler));
    }

    /// Whatever sequence of payments and junk calls happened: the cashier kept nothing.
    function invariant_holdsNothing() public view {
        assertEq(address(cashier).balance, 0);
    }

    /// Every wei paid in reached exactly the vault/team it was meant for.
    function invariant_everyWeiAccounted() public view {
        assertEq(solo.balance, handler.expectSolo(), "solo vault");
        assertEq(coop.balance, handler.expectCoop(), "coop vault");
        assertEq(team.balance, handler.expectTeam(), "team");
        assertEq(solo.balance + coop.balance + team.balance, handler.paidIn(), "sum");
    }
}
