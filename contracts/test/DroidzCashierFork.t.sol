// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {DroidzCashier} from "../src/DroidzCashier.sol";
import {DeployCashier} from "../script/DeployCashier.s.sol";

/// @dev The live Otherside Hub FeeSplitter on ApeChain (EIP-1967 proxy; verified implementation
///      0x65737286d1720FA1e0e871Bb3E21A295284641Ee). The Hub sends every paid partner call through
///      `execute(target, data, feeBps)`, feeBps chosen per partner (default 150, max 1000).
interface IFeeSplitter {
    function execute(address target, bytes calldata data, uint256 feeBps) external payable returns (bytes memory);
    function treasury() external view returns (address);
}

/// @notice Payments made exactly the way the Otherside Hub makes them — through the real
///         FeeSplitter, on a fork of ApeChain mainnet — and the production deploy rehearsed with
///         the real addresses.
///         forge test --match-contract DroidzCashierFork
contract DroidzCashierForkTest is Test {
    IFeeSplitter constant HUB = IFeeSplitter(0x8E756CA736Da338d78C436C47A41aC18CE72Cf63);
    address payable constant SOLO = payable(0x84B732Da60a0955e890c58C344a8E9ED4C2aB8f2);
    address payable constant COOP = payable(0xA7E56FC068dfc0Dd1F2799d8c3826Cd27631203c);
    address payable constant TEAM = payable(0xE7946895522ed49D8DB161E126622De6e07C8Faa);
    address constant DEPLOYER = 0xDD6f262383a71f90E713Dd890ecA1e656F366D95;

    event Paid(address indexed player, bytes32 indexed order, address indexed payer, uint8 mode, uint256 amount, uint256 toPool);

    DroidzCashier cashier;
    address player = makeAddr("glyphPlayer");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("apechain"));
        cashier = new DroidzCashier(SOLO, COOP, TEAM, 5000);
        vm.deal(player, 100 ether);
    }

    function _viaHub(uint256 value, uint8 mode, bytes32 order, uint256 bps) internal {
        vm.prank(player);
        HUB.execute{value: value}(address(cashier), abi.encodeCall(DroidzCashier.pay, (player, order, mode)), bps);
    }

    function test_soloRun_throughTheRealHub() public {
        uint256 s0 = SOLO.balance;
        uint256 t0 = TEAM.balance;
        uint256 h0 = HUB.treasury().balance;
        uint256 k0 = address(cashier).balance; // a fresh address on a fork may hold mainnet dust
        vm.expectEmit(address(cashier));
        emit Paid(player, keccak256("o1"), address(HUB), 0, 1.97 ether, 0.985 ether);
        _viaHub(2 ether, 0, keccak256("o1"), 150);
        assertEq(HUB.treasury().balance - h0, 0.03 ether, "Otherside: 1.5% of 2 APE");
        assertEq(SOLO.balance - s0, 0.985 ether, "solo vault: half of the net");
        assertEq(TEAM.balance - t0, 0.985 ether, "team: the other half");
        assertEq(address(cashier).balance, k0, "cashier keeps nothing");
    }

    function test_coopRun_throughTheRealHub_goesToTheCoopVault() public {
        uint256 c0 = COOP.balance;
        uint256 s0 = SOLO.balance;
        _viaHub(2 ether, 1, keccak256("o2"), 150);
        assertEq(COOP.balance - c0, 0.985 ether);
        assertEq(SOLO.balance - s0, 0, "solo untouched");
    }

    function test_theHubsMaximumFee_stillSplitsCleanly() public {
        uint256 s0 = SOLO.balance;
        _viaHub(2 ether, 0, keccak256("o3"), 1000);
        assertEq(SOLO.balance - s0, 0.9 ether, "10% fee: 1.8 net, 0.9 to the pool");
    }

    bytes32 constant FEE_COLLECTED = keccak256("FeeCollected(address,address,uint256,uint256)");

    /// @dev The FeeCollected the Hub emitted for a call to the cashier, after the Paid event:
    ///      (found, fee, amount the cashier got, log order was Paid → FeeCollected).
    function _hubFee(Vm.Log[] memory logs) internal view returns (bool found, uint256 fee, uint256 paidAmount, bool paidFirst) {
        bool paidSeen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(cashier) && logs[i].topics[0] == Paid.selector) {
                (, paidAmount,) = abi.decode(logs[i].data, (uint8, uint256, uint256));
                paidSeen = true;
            }
            if (logs[i].emitter == address(HUB) && logs[i].topics[0] == FEE_COLLECTED
                && logs[i].topics.length > 2 && logs[i].topics[2] == bytes32(uint256(uint160(address(cashier))))) {
                (fee,) = abi.decode(logs[i].data, (uint256, uint256));
                return (true, fee, paidAmount, paidSeen);
            }
        }
    }

    /// @notice The FeeSplitter takes calls from ANYONE with ANY fee, 0 included — which is why the
    ///         server does not trust «the payer is the Hub» alone (lib/survivalShop.ts hubFeeFor):
    ///         it reads this FeeCollected and requires cashier amount + fee = the full price.
    function test_anyoneCanCallTheHubWithZeroFee_andItsFeeCollectedSaysSo() public {
        vm.recordLogs();
        _viaHub(0.9 ether, 0, keccak256("zero"), 0);
        (bool found, uint256 fee, uint256 amount, bool paidFirst) = _hubFee(vm.getRecordedLogs());
        assertTrue(found, "FeeCollected names the cashier as its target");
        assertTrue(paidFirst, "Paid comes before the Hub's FeeCollected");
        assertEq(fee, 0, "fee 0 is accepted by the Hub");
        assertEq(amount, 0.9 ether, "the cashier got 90%: the server must see 0.9 + 0 < price, underpaid");
    }

    function test_theHubsFeeCollected_plusTheCashiersAmount_isWhatThePlayerSent() public {
        vm.recordLogs();
        _viaHub(2 ether, 0, keccak256("fee150"), 150);
        (bool found, uint256 fee, uint256 amount,) = _hubFee(vm.getRecordedLogs());
        assertTrue(found);
        assertEq(fee, 0.03 ether);
        assertEq(amount + fee, 2 ether, "150 bps on the full price: paid");
        vm.recordLogs();
        _viaHub(2 ether, 0, keccak256("fee1000"), 1000);
        (, fee, amount,) = _hubFee(vm.getRecordedLogs());
        assertEq(amount + fee, 2 ether, "1000 bps on the full price: paid");
    }

    function test_aRevertInsideTheCashier_revertsTheWholeHubCall_playerKeepsTheMoney() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(DroidzCashier.BadMode.selector, 7));
        HUB.execute{value: 2 ether}(address(cashier), abi.encodeCall(DroidzCashier.pay, (player, keccak256("x"), 7)), 150);
        assertEq(player.balance, 100 ether);
    }

    function test_productionDeployRehearsal_withTheRealAddresses() public {
        vm.setEnv("SURVIVAL_SOLO_VAULT", vm.toString(SOLO));
        vm.setEnv("SURVIVAL_COOP_VAULT", vm.toString(COOP));
        vm.setEnv("SURVIVAL_TEAM", vm.toString(TEAM));
        vm.setEnv("SURVIVAL_POOL_BPS", "5000");
        DeployCashier script = new DeployCashier();
        DroidzCashier live = script.run();
        assertEq(live.soloVault(), SOLO);
        assertEq(live.coopVault(), COOP);
        assertEq(live.team(), TEAM);
        assertEq(live.poolBps(), 5000);
        // And it works against the live Hub right after deploy.
        cashier = live;
        uint256 s0 = SOLO.balance;
        _viaHub(2 ether, 0, keccak256("first"), 150);
        assertEq(SOLO.balance - s0, 0.985 ether);
    }
}
