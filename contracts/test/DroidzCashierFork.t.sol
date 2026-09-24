// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
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
