// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LMNT1155} from "../src/LMNT1155.sol";
import {ApeChain} from "../src/ApeChain.sol";

interface IERC6551RegistryFull {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address);
}

interface ITokenboundAccount {
    function owner() external view returns (address);
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

interface IApeDroidz {
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IAccountProxy {
    function initialize(address implementation) external;
}

/// @dev Account logic a griefer would like to install on somebody else's inventory.
contract ForeignLogic {
    function owner() external view returns (address) {
        return address(this);
    }
}

/// @notice Proves the inventory model against the real ERC-6551 registry, the real Tokenbound
///         account implementation and the real ApeDroidz collection on ApeChain — not against a
///         mock of what we believe they do. The derivation parameters asserted here are the ones
///         that can never be changed after deployment, so they are worth pinning to a live chain.
contract LMNT1155ForkTest is Test {
    // Taken from the same library the deploy script uses, so this test proves the values that
    // will actually be deployed rather than a copy of them that could drift.
    address constant DROIDZ = ApeChain.DROIDZ;
    address constant REGISTRY = ApeChain.REGISTRY;
    address constant ACCOUNT_PROXY = ApeChain.ACCOUNT_PROXY;
    address constant ACCOUNT_LOGIC = ApeChain.ACCOUNT_LOGIC;
    bytes32 constant SALT = ApeChain.SALT;
    uint256 constant APECHAIN = ApeChain.CHAIN_ID;

    /// @dev Independently derived with `cast call` against the live registry before this contract
    ///      existed. If a future change to the derivation parameters ever moves an inventory, this
    ///      constant is what catches it.
    address constant DROID_1_INVENTORY = 0x08070a56Bb1FaaAb09A2DE5C50caE2A2779bf57D;

    uint256 constant ELEMENT = 1;
    uint256 constant SHARD = 11;

    IERC6551RegistryFull registry = IERC6551RegistryFull(REGISTRY);
    IApeDroidz droidz = IApeDroidz(DROIDZ);
    LMNT1155 lmnt;

    address owner = address(0x00E7);
    address minter = address(0x111117E4);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("apechain"));

        LMNT1155 implementation = new LMNT1155();
        LMNT1155.InitParams memory params = LMNT1155.InitParams({
            owner_: owner,
            collection_: DROIDZ,
            registry_: REGISTRY,
            accountImplementation_: ACCOUNT_PROXY,
            accountLogic_: ACCOUNT_LOGIC,
            accountSalt_: SALT,
            name_: unicode"LMNT™ by ApeDroidz",
            symbol_: "LMNT",
            baseUri_: "https://apedroidz.com/api/metadata/lmnt/",
            contractUri_: "https://apedroidz.com/api/metadata/lmnt/contract",
            royaltyReceiver_: owner,
            royaltyFeeNumerator_: 500
        });
        lmnt =
            LMNT1155(address(new ERC1967Proxy(address(implementation), abi.encodeCall(LMNT1155.initialize, (params)))));

        vm.startPrank(owner);
        lmnt.setMinter(minter, true);
        lmnt.createItem(ELEMENT, false, false, true, true, 0, 3333);
        lmnt.createItem(SHARD, true, false, true, false, 0, 0);
        vm.stopPrank();
    }

    function test_chainIsApeChain() public view {
        assertEq(block.chainid, APECHAIN);
    }

    function test_derivationMatchesTheLiveRegistry() public view {
        address expected = registry.account(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 1);
        assertEq(lmnt.accountOf(1), expected);
        assertEq(lmnt.accountOf(1), DROID_1_INVENTORY);
    }

    /// @dev The whole retro drop can land before a single account exists on chain.
    function test_mintsIntoAnUndeployedAccount() public {
        assertEq(lmnt.accountOf(1).code.length, 0, "account is not deployed yet");

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertEq(lmnt.balanceOf(DROID_1_INVENTORY, ELEMENT), 1);
        assertEq(lmnt.accountOf(1).code.length, 0, "and still is not");
    }

    /// @dev Deploying the account later must find the items already sitting there.
    function test_accountDeployedLaterKeepsTheBalance() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address created = lmnt.ensureAccount(1);
        assertEq(created, DROID_1_INVENTORY);
        assertGt(created.code.length, 0);
        assertEq(lmnt.balanceOf(created, ELEMENT), 1);
    }

    /// @dev The point of the whole design: the inventory answers to whoever holds the droid.
    function test_accountOwnerIsTheDroidHolder() public {
        address account = lmnt.ensureAccount(1);
        assertEq(ITokenboundAccount(account).owner(), droidz.ownerOf(1));

        (uint256 chainId, address tokenContract, uint256 tokenId) = ITokenboundAccount(account).token();
        assertEq(chainId, APECHAIN);
        assertEq(tokenContract, DROIDZ);
        assertEq(tokenId, 1);
    }

    /// @dev End to end through a real account: the droid's holder can move a free item out.
    function test_holderCanMoveAFreeItemOutOfTheInventory() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 3);

        address account = lmnt.ensureAccount(1);
        address holder = droidz.ownerOf(1);

        vm.prank(holder);
        ITokenboundAccount(account)
            .execute(
                address(lmnt), 0, abi.encodeCall(lmnt.safeTransferFrom, (account, address(0xDEAD1), SHARD, 2, "")), 0
            );

        assertEq(lmnt.balanceOf(account, SHARD), 1);
        assertEq(lmnt.balanceOf(address(0xDEAD1), SHARD), 2);
    }

    /// @dev And cannot move a bound one, even holding the droid and acting through its own account.
    function test_holderCannotMoveABoundItemOutOfTheInventory() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address account = lmnt.ensureAccount(1);
        address holder = droidz.ownerOf(1);

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsBound.selector, ELEMENT));
        ITokenboundAccount(account)
            .execute(
                address(lmnt), 0, abi.encodeCall(lmnt.safeTransferFrom, (account, address(0xDEAD1), ELEMENT, 1, "")), 0
            );
    }

    /// @dev A real account is a contract, so the ERC-1155 receiver hook is live once it exists.
    ///      Minting into it must keep working after deployment.
    function test_mintIntoADeployedAccountStillWorks() public {
        lmnt.ensureAccount(2);
        assertTrue(lmnt.isAccountLive(2));

        vm.prank(minter);
        lmnt.mintToDroid(2, ELEMENT, 1);

        assertEq(lmnt.balanceOf(lmnt.accountOf(2), ELEMENT), 1);
    }

    /* ------------------------------------------------------------ account setup */

    function test_ensureAccountIsIdempotent() public {
        address first = lmnt.ensureAccount(1);
        address second = lmnt.ensureAccount(1);
        assertEq(first, second);
        assertEq(first, DROID_1_INVENTORY);
    }

    function test_ensureAccountIsPermissionless() public {
        vm.prank(address(0xBEEF));
        lmnt.ensureAccount(1);
        assertTrue(lmnt.isAccountLive(1));
    }

    function test_ensureAccountRejectsANonExistentDroid() public {
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, uint256(4000)));
        lmnt.ensureAccount(4000);
    }

    /// @dev An account that exists but was never pointed at any logic is the one shape that has
    ///      code and answers nothing. Straight off the registry, that is exactly what you get.
    function test_bareProxyIsNotLive() public {
        registry.createAccount(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 1);
        assertGt(DROID_1_INVENTORY.code.length, 0);
        assertFalse(lmnt.isAccountLive(1), "code, but nothing behind it");
    }

    /// @dev Anyone can deploy a bare proxy for someone else's droid through the registry. Left
    ///      alone it would reject the incoming ERC-1155 and cost that droid its reward, so the mint
    ///      repairs it on the way past rather than reverting.
    function test_mintRepairsABareProxyLeftByAStranger() public {
        vm.prank(address(0xBEEF));
        registry.createAccount(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 1);
        assertFalse(lmnt.isAccountLive(1));

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertTrue(lmnt.isAccountLive(1), "repaired in passing");
        assertEq(lmnt.balanceOf(DROID_1_INVENTORY, ELEMENT), 1);
        assertEq(ITokenboundAccount(DROID_1_INVENTORY).owner(), droidz.ownerOf(1));
    }

    /// @dev And the same for a whole batch: one griefed droid must not take the drop down with it.
    function test_batchSurvivesABareProxyInTheMiddle() public {
        registry.createAccount(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 2);

        uint256[] memory droidIds = new uint256[](3);
        droidIds[0] = 1;
        droidIds[1] = 2;
        droidIds[2] = 3;

        vm.prank(minter);
        lmnt.mintToDroidBatch(droidIds, ELEMENT);

        assertEq(lmnt.balanceOf(lmnt.accountOf(1), ELEMENT), 1);
        assertEq(lmnt.balanceOf(lmnt.accountOf(2), ELEMENT), 1);
        assertEq(lmnt.balanceOf(lmnt.accountOf(3), ELEMENT), 1);
    }

    /// @dev A droid id outside the collection has a derivable address but no holder, so a typo in a
    ///      drop list cannot strand items at an address nobody controls.
    function test_mintToANonExistentDroidReverts() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, uint256(4000)));
        lmnt.mintToDroid(4000, ELEMENT, 1);
    }

    /* ------------------------------------------------------------------ security */

    /// @dev The inventory proxy is initialisable by anyone, which is what lets the drop repair a
    ///      griefed account. That would be worth nothing if a stranger could install their own
    ///      logic and drain the inventory — so the proxy's guardian must refuse untrusted code.
    ///      This is the single assumption the repair path rests on, so it is asserted against the
    ///      live proxy rather than reasoned about.
    function test_strangerCannotPointAnInventoryAtForeignLogic() public {
        registry.createAccount(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 1);
        ForeignLogic foreign = new ForeignLogic();

        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes4(0x68155f9a)); // InvalidImplementation()
        IAccountProxy(DROID_1_INVENTORY).initialize(address(foreign));

        assertFalse(lmnt.isAccountLive(1), "still bare, and still harmless");
    }

    /// @dev And once the drop has repaired it, the account answers to the droid holder — not to
    ///      whoever happened to deploy it.
    function test_repairedAccountAnswersToTheHolderNotTheDeployer() public {
        vm.prank(address(0xBEEF));
        registry.createAccount(ACCOUNT_PROXY, SALT, APECHAIN, DROIDZ, 1);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertEq(ITokenboundAccount(DROID_1_INVENTORY).owner(), droidz.ownerOf(1));
        assertTrue(ITokenboundAccount(DROID_1_INVENTORY).owner() != address(0xBEEF));
    }

    /// @dev The drop is bounded by the collection: 3333 minted, nothing above it.
    function test_collectionIsFullyMintedAndBounded() public {
        assertEq(droidz.totalSupply(), 3333);
        assertEq(lmnt.accountOf(3333).code.length, 0);

        vm.prank(minter);
        lmnt.mintToDroid(3333, ELEMENT, 1);
        assertEq(lmnt.balanceOf(lmnt.accountOf(3333), ELEMENT), 1);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, uint256(3334)));
        lmnt.mintToDroid(3334, ELEMENT, 1);
    }

    /// @dev Droid ids start at 1, so the plus-one bookkeeping behind {droidOfAccount} has no
    ///      ambiguous case in this collection — but the accessor is still checked here.
    function test_droidZeroIsNotInTheCollection() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, uint256(0)));
        lmnt.mintToDroid(0, ELEMENT, 1);
    }

    /* -------------------------------------------------- approvals across a resale */

    /// @dev The end-to-end version, against a real account and a real droid transfer: an approval
    ///      the seller granted from the inventory must not survive the sale of the droid. Without
    ///      this the seller keeps operator rights over what the buyer just paid for.
    function test_approvalFromARealInventoryLapsesWhenTheDroidIsSold() public {
        address ourMarket = address(0x0A4E7);

        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 500);
        address account = lmnt.ensureAccount(1);
        address seller = droidz.ownerOf(1);

        vm.prank(owner);
        lmnt.setApprovedMarket(ourMarket, true);

        vm.prank(seller);
        ITokenboundAccount(account)
            .execute(address(lmnt), 0, abi.encodeCall(lmnt.setApprovalForAll, (ourMarket, true)), 0);
        assertTrue(lmnt.isApprovedForAll(account, ourMarket), "valid while the seller holds the droid");

        vm.prank(seller);
        droidz.transferFrom(seller, address(0xB0B), 1);

        assertFalse(lmnt.isApprovedForAll(account, ourMarket), "lapsed on sale");

        vm.prank(ourMarket);
        vm.expectRevert();
        lmnt.safeTransferFrom(account, address(0xDEAD1), SHARD, 500, "");
        assertEq(lmnt.balanceOf(account, SHARD), 500, "the buyer keeps the inventory");
    }

    /* ------------------------------------------------------------- account logic */

    /// @dev The live account proxy accepts only its own built-in implementation or one its guardian
    ///      trusts, and that guardian is Tokenbound's, not ours. So a wrong `accountLogic` does not
    ///      misdirect anything — it simply stops accounts being deployable. Pinned here because the
    ///      failure would otherwise show up first in production.
    function test_wrongAccountLogicBlocksAccountDeployment() public {
        vm.prank(owner);
        lmnt.setAccountLogic(address(lmnt)); // a contract, but not one the guardian trusts

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AccountNotReady.selector, uint256(2)));
        lmnt.ensureAccount(2);

        vm.prank(owner);
        lmnt.setAccountLogic(ACCOUNT_LOGIC);
        assertEq(lmnt.ensureAccount(2), lmnt.accountOf(2), "one owner call puts it right");
    }

    /// @dev The same refusal, proven from a real token-bound account: a marketplace we have not
    ///      allowlisted cannot be approved, so no listing of an LMNT item can ever be created there.
    function test_realInventoryCannotApproveAnOutsideMarketplace() public {
        address openSea = address(0x09E45EA);

        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 1);
        address account = lmnt.ensureAccount(1);
        address holder = droidz.ownerOf(1);

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.OperatorNotApproved.selector, openSea));
        ITokenboundAccount(account)
            .execute(address(lmnt), 0, abi.encodeCall(lmnt.setApprovalForAll, (openSea, true)), 0);

        assertFalse(lmnt.isApprovedForAll(account, openSea));
    }
}
