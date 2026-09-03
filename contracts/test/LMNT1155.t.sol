// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC1155Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LMNT1155} from "../src/LMNT1155.sol";

/// @dev Stands in for the ERC-6551 registry: the only thing the token needs from it is a
///      deterministic address per droid, which this reproduces without deploying anything.
contract MockRegistry {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encode(implementation, salt, chainId, tokenContract, tokenId)))));
    }
}

/// @dev Stands in for the account logic an inventory proxy is pointed at. Only needs to be a
///      contract — the token never calls it, it only refuses an address with no code.
contract MockAccountLogic {
    function owner() external view returns (address) {
        return address(this);
    }
}

/// @dev A token-bound account as far as this contract is concerned: something with code that can
///      say which droid it belongs to. Its fields are immutable so the whole thing survives being
///      etched onto the derived inventory address, which is where a real one would live.
contract MockInventory {
    uint256 immutable chainId;
    address immutable collection;
    uint256 immutable tokenId;

    constructor(uint256 chainId_, address collection_, uint256 tokenId_) {
        chainId = chainId_;
        collection = collection_;
        tokenId = tokenId_;
    }

    function token() external view returns (uint256, address, uint256) {
        return (chainId, collection, tokenId);
    }

    function owner() external view returns (address) {
        return address(this);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract MockDroidz {
    mapping(uint256 => address) private _owners;

    function mint(address to, uint256 tokenId) external {
        _owners[tokenId] = to;
    }

    function transfer(address to, uint256 tokenId) external {
        _owners[tokenId] = to;
    }

    /// @dev Reverts for a token that was never minted, exactly like a real ERC-721.
    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }
}

/// @dev An inventory whose holder replaced its account logic with something that calls back into
///      the token mid-mint. Its fields are immutable so the whole thing survives a `vm.etch` onto
///      the derived inventory address.
contract ReenteringInventory {
    LMNT1155 immutable lmnt;
    uint256 immutable droidId;
    uint256 immutable itemId;

    bytes public innerRevert;
    bool public reentered;

    /// @dev Present so the token reads this address as a live account and leaves it alone.
    function owner() external view returns (address) {
        return address(this);
    }

    constructor(LMNT1155 lmnt_, uint256 droidId_, uint256 itemId_) {
        lmnt = lmnt_;
        droidId = droidId_;
        itemId = itemId_;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (!reentered) {
            reentered = true;
            try lmnt.mintToDroid(droidId, itemId, 1) {}
            catch (bytes memory reason) {
                innerRevert = reason;
            }
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

/// @dev An inventory whose holder swapped in logic that takes ERC-1155 but exposes neither
///      `owner()` nor `initialize` — the shape that made the repair path fatal before it was made
///      best-effort.
contract PlainReceiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

/// @dev A second implementation, used only to prove the proxy upgrades and keeps its state.
contract LMNT1155V2 is LMNT1155 {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract LMNT1155Test is Test {
    LMNT1155 lmnt;
    MockRegistry registry;
    MockDroidz droidz;
    address accountLogic;

    address owner = address(0x00E7);
    address minter = address(0x111117E4);
    address burner = address(0xB0E4E4);
    address market = address(0x0A4E7);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    // Item ids used across the tests, in the shape the first drop will use them.
    uint256 constant ELEMENT = 1; // level-2 sneaker: bound to the droid, one per droid, open supply
    uint256 constant ELEMENT_SUPER = 2; // level-2 super sneaker: same policy
    uint256 constant CAPSULE = 10; // a tradable drop, market-only, capped
    uint256 constant SHARD = 11; // a freely tradable crafting material

    function setUp() public {
        registry = new MockRegistry();
        droidz = new MockDroidz();
        accountLogic = address(new MockAccountLogic());

        LMNT1155 implementation = new LMNT1155();
        LMNT1155.InitParams memory params = LMNT1155.InitParams({
            owner_: owner,
            collection_: address(droidz),
            registry_: address(registry),
            accountImplementation_: address(0x5526),
            accountLogic_: accountLogic,
            accountSalt_: bytes32(0),
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
        lmnt.setBurner(burner, CAPSULE, true);
        lmnt.setBurner(burner, SHARD, true);
        lmnt.setBurner(burner, ELEMENT, true);
        lmnt.setApprovedMarket(market, true);
        lmnt.createItem(ELEMENT, false, false, true, true, 0, 3333);
        lmnt.createItem(ELEMENT_SUPER, false, false, true, true, uint96(ELEMENT), 3333);
        lmnt.createItem(CAPSULE, true, true, true, false, 0, 100);
        lmnt.createItem(SHARD, true, false, true, false, 0, 0);
        vm.stopPrank();

        droidz.mint(alice, 1);
        droidz.mint(alice, 2);
        droidz.mint(bob, 3);
    }

    function _inventory(uint256 droidId) internal view returns (address) {
        return lmnt.accountOf(droidId);
    }

    /// @dev Put a working account at the droid's derived address, the way the registry would.
    function _deployInventory(uint256 droidId) internal returns (address inventory) {
        inventory = _inventory(droidId);
        MockInventory logic = new MockInventory(block.chainid, address(droidz), droidId);
        vm.etch(inventory, address(logic).code);
    }

    /* ------------------------------------------------------------------- setup */

    function test_initializeWritesTheDerivationParameters() public view {
        assertEq(address(lmnt.registry()), address(registry));
        assertEq(lmnt.accountImplementation(), address(0x5526));
        assertEq(lmnt.accountSalt(), bytes32(0));
        assertEq(address(lmnt.collection()), address(droidz));
        assertEq(lmnt.owner(), owner);
        assertEq(lmnt.name(), unicode"LMNT™ by ApeDroidz");
    }

    function test_cannotInitializeTwice() public {
        LMNT1155.InitParams memory params;
        params.owner_ = alice;
        params.collection_ = address(droidz);
        params.registry_ = address(registry);
        params.accountImplementation_ = address(0x5526);

        vm.expectRevert();
        lmnt.initialize(params);
    }

    function test_uriAppendsTheItemId() public view {
        assertEq(lmnt.uri(ELEMENT), "https://apedroidz.com/api/metadata/lmnt/1");
    }

    function test_royaltyIsReported() public view {
        (address receiver, uint256 amount) = lmnt.royaltyInfo(CAPSULE, 10_000);
        assertEq(receiver, owner);
        assertEq(amount, 500);
    }

    /* ------------------------------------------------------------ item creation */

    function test_itemCannotBeCreatedTwice() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemAlreadyExists.selector, ELEMENT));
        lmnt.createItem(ELEMENT, true, false, true, false, 0, 0);
    }

    function test_onlyOwnerCreatesItems() public {
        vm.prank(minter);
        vm.expectRevert();
        lmnt.createItem(99, true, false, true, false, 0, 0);
    }

    /* ----------------------------------------------------------------- minting */

    function test_mintLandsInTheDroidInventory() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertEq(lmnt.balanceOf(_inventory(1), ELEMENT), 1);
        assertEq(lmnt.balanceOf(alice, ELEMENT), 0, "the holder's own wallet stays empty");
        assertTrue(lmnt.claimedForDroid(ELEMENT, 1));
        assertEq(lmnt.totalSupply(ELEMENT), 1);
    }

    /// @dev An inventory is recognised by asking it, so it answers for a deployed account this
    ///      contract has never minted into — and says nothing about an address that only looks
    ///      like one.
    function test_inventoryIsRecognisedByAskingIt() public {
        address inventory = _deployInventory(1);

        assertTrue(lmnt.isDroidInventory(inventory));
        assertEq(lmnt.droidOfAccount(inventory), 1);

        assertFalse(lmnt.isDroidInventory(_inventory(2)), "not deployed, cannot answer");
        assertFalse(lmnt.isDroidInventory(alice), "a plain wallet is not an inventory");
    }

    /// @dev An account that claims a droid whose derived address is not itself is not an inventory.
    function test_anImpostorAccountIsNotRecognised() public {
        MockInventory impostor = new MockInventory(block.chainid, address(droidz), 1);
        assertFalse(lmnt.isDroidInventory(address(impostor)), "right droid, wrong address");
    }

    function test_batchMintCoversTheRetroDrop() public {
        uint256[] memory droidIds = new uint256[](3);
        droidIds[0] = 1;
        droidIds[1] = 2;
        droidIds[2] = 3;

        vm.prank(minter);
        lmnt.mintToDroidBatch(droidIds, ELEMENT);

        assertEq(lmnt.balanceOf(_inventory(1), ELEMENT), 1);
        assertEq(lmnt.balanceOf(_inventory(2), ELEMENT), 1);
        assertEq(lmnt.balanceOf(_inventory(3), ELEMENT), 1);
        assertEq(lmnt.totalSupply(ELEMENT), 3);
    }

    function test_perDroidItemCannotBeClaimedTwice() public {
        vm.startPrank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT, 1));
        lmnt.mintToDroid(1, ELEMENT, 1);
        vm.stopPrank();
    }

    /// @dev The claim is keyed by droid, so reselling an upgraded droid yields no second sneaker.
    function test_resaleDoesNotYieldASecondClaim() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        droidz.transfer(bob, 1);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT, 1));
        lmnt.mintToDroid(1, ELEMENT, 1);
    }

    function test_mintToUnknownDroidReverts() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, 9999));
        lmnt.mintToDroid(9999, ELEMENT, 1);
    }

    function test_mintOfUnknownItemReverts() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.UnknownItem.selector, 77));
        lmnt.mintToDroid(1, 77, 1);
    }

    function test_onlyMinterCanMint() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotMinter.selector, alice));
        lmnt.mintToDroid(1, ELEMENT, 1);
    }

    function test_ownerCanMintWithoutHoldingTheMinterRole() public {
        vm.prank(owner);
        lmnt.mintToDroid(1, ELEMENT, 1);
        assertEq(lmnt.balanceOf(_inventory(1), ELEMENT), 1);
    }

    function test_revokedMinterCannotMint() public {
        vm.prank(owner);
        lmnt.setMinter(minter, false);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotMinter.selector, minter));
        lmnt.mintToDroid(1, ELEMENT, 1);
    }

    function test_mintToWalletRejectsBoundAndPerDroidItems() public {
        vm.startPrank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsBound.selector, ELEMENT));
        lmnt.mintTo(alice, ELEMENT, 1);
        vm.stopPrank();
    }

    function test_mintToWalletWorksForAFreeItem() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 5);
        assertEq(lmnt.balanceOf(alice, SHARD), 5);
    }

    /* --------------------------------------------------------- transfer policy */

    function test_boundItemCannotLeaveTheInventory() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address inventory = _inventory(1);
        vm.prank(inventory);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsBound.selector, ELEMENT));
        lmnt.safeTransferFrom(inventory, alice, ELEMENT, 1, "");
    }

    function test_boundItemCannotLeaveThroughAMarketEither() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address inventory = _inventory(1);
        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);

        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsBound.selector, ELEMENT));
        lmnt.safeTransferFrom(inventory, alice, ELEMENT, 1, "");
    }

    function test_marketOnlyItemRejectsADirectTransfer() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, CAPSULE, 1);

        address inventory = _inventory(1);
        vm.prank(inventory);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsMarketOnly.selector, CAPSULE));
        lmnt.safeTransferFrom(inventory, alice, CAPSULE, 1, "");
    }

    function test_marketOnlyItemMovesThroughAnApprovedMarket() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, CAPSULE, 1);

        address inventory = _inventory(1);
        address destination = _inventory(3);
        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);

        vm.prank(market);
        lmnt.safeTransferFrom(inventory, destination, CAPSULE, 1, "");

        assertEq(lmnt.balanceOf(_inventory(1), CAPSULE), 0);
        assertEq(lmnt.balanceOf(_inventory(3), CAPSULE), 1);
    }

    function test_revokedMarketCanNoLongerMove() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, CAPSULE, 1);

        address inventory = _inventory(1);
        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);

        vm.prank(owner);
        lmnt.setApprovedMarket(market, false);

        // Delisting takes back the power the market already held, not just its right to be granted
        // more: the approval itself stops counting, so the transfer fails before the item policy is
        // even reached.
        assertFalse(lmnt.isApprovedForAll(inventory, market));
        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155MissingApprovalForAll.selector, market, inventory));
        lmnt.safeTransferFrom(inventory, alice, CAPSULE, 1, "");
    }

    /// @dev And the same for a free item, which the policy check in _update would never have caught.
    function test_delistingAMarketRevokesItsPowerOverFreeItemsToo() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 10);

        vm.prank(alice);
        lmnt.setApprovalForAll(market, true);

        vm.prank(owner);
        lmnt.setApprovedMarket(market, false);

        assertFalse(lmnt.isApprovedForAll(alice, market));
        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155MissingApprovalForAll.selector, market, alice));
        lmnt.safeTransferFrom(alice, bob, SHARD, 10, "");

        // Re-listing restores what was already granted, so a delisting is reversible.
        vm.prank(owner);
        lmnt.setApprovedMarket(market, true);
        assertTrue(lmnt.isApprovedForAll(alice, market));
    }

    function test_freeItemTransfersPeerToPeer() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 3);

        vm.prank(alice);
        lmnt.safeTransferFrom(alice, bob, SHARD, 2, "");

        assertEq(lmnt.balanceOf(alice, SHARD), 1);
        assertEq(lmnt.balanceOf(bob, SHARD), 2);
    }

    /* ------------------------------------------------------------------ policy */

    function test_policyCanBeLoosened() public {
        vm.prank(owner);
        lmnt.loosen(ELEMENT, true, false, true);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address inventory = _inventory(1);
        vm.prank(inventory);
        lmnt.safeTransferFrom(inventory, alice, ELEMENT, 1, "");
        assertEq(lmnt.balanceOf(alice, ELEMENT), 1);
    }

    function test_policyCannotBeTightenedBack() public {
        vm.startPrank(owner);
        lmnt.loosen(ELEMENT, true, false, true);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PolicyCanOnlyLoosen.selector, ELEMENT));
        lmnt.loosen(ELEMENT, false, false, true);
        vm.stopPrank();
    }

    function test_marketOnlyCannotBeAddedLater() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PolicyCanOnlyLoosen.selector, SHARD));
        lmnt.loosen(SHARD, true, true, true);
    }

    function test_burnableCannotBeRemoved() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PolicyCanOnlyLoosen.selector, SHARD));
        lmnt.loosen(SHARD, true, false, false);
    }

    /* ------------------------------------------------------------------ supply */

    function test_maxSupplyIsEnforced() public {
        vm.startPrank(minter);
        lmnt.mintTo(alice, CAPSULE, 100);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.SupplyExceeded.selector, CAPSULE, uint96(100)));
        lmnt.mintTo(alice, CAPSULE, 1);
        vm.stopPrank();
    }

    /// @dev Supply is counted in mints, so crafting cannot inflate a capped drop.
    function test_burningDoesNotFreeSupply() public {
        vm.prank(minter);
        lmnt.mintTo(alice, CAPSULE, 100);

        vm.prank(burner);
        lmnt.burn(alice, CAPSULE, 40);

        assertEq(lmnt.totalSupply(CAPSULE), 60);
        assertEq(lmnt.remainingSupply(CAPSULE), 0);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.SupplyExceeded.selector, CAPSULE, uint96(100)));
        lmnt.mintTo(alice, CAPSULE, 1);
    }

    function test_openSupplyIsUnbounded() public view {
        assertEq(lmnt.remainingSupply(SHARD), type(uint256).max);
    }

    function test_sealSupplyFixesTheFinalCount() public {
        uint256[] memory droidIds = new uint256[](2);
        droidIds[0] = 1;
        droidIds[1] = 2;

        vm.prank(minter);
        lmnt.mintToDroidBatch(droidIds, ELEMENT_SUPER);

        vm.prank(owner);
        lmnt.sealSupply(ELEMENT_SUPER);

        LMNT1155.Item memory item = lmnt.itemOf(ELEMENT_SUPER);
        assertTrue(item.supplySealed);
        assertEq(item.maxSupply, 2);
        assertEq(lmnt.remainingSupply(ELEMENT_SUPER), 0);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.SupplyExceeded.selector, ELEMENT_SUPER, uint96(2)));
        lmnt.mintToDroid(3, ELEMENT_SUPER, 1);
    }

    function test_supplyCannotBeSealedTwice() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 3);

        vm.startPrank(owner);
        lmnt.sealSupply(SHARD);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.SupplyAlreadySealed.selector, SHARD));
        lmnt.sealSupply(SHARD);
        vm.stopPrank();
    }

    /// @dev Zero is the sentinel for "open-ended", so sealing an id nobody has minted would write a
    ///      cap of zero and remove the cap entirely — permanently, since it can only be sealed once.
    function test_sealingAnUnmintedItemIsRefused() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NothingMintedToSeal.selector, ELEMENT_SUPER));
        lmnt.sealSupply(ELEMENT_SUPER);

        assertEq(lmnt.itemOf(ELEMENT_SUPER).maxSupply, 3333, "cap untouched");
        assertFalse(lmnt.itemOf(ELEMENT_SUPER).supplySealed);
    }

    /* ------------------------------------------------------------------ burning */

    function test_burnerCanConsumeABoundItem() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        address inventory = _inventory(1);
        vm.prank(burner);
        lmnt.burn(inventory, ELEMENT, 1);

        assertEq(lmnt.balanceOf(inventory, ELEMENT), 0);
        assertEq(lmnt.totalSupply(ELEMENT), 0);
        assertTrue(lmnt.claimedForDroid(ELEMENT, 1), "the claim stands even after the item is consumed");
    }

    function test_holderCanBurnItsOwnItem() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 2);

        vm.prank(alice);
        lmnt.burn(alice, SHARD, 1);
        assertEq(lmnt.balanceOf(alice, SHARD), 1);
    }

    function test_strangerCannotBurn() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotBurnerOrHolder.selector, bob));
        lmnt.burn(alice, SHARD, 1);
    }

    /// @dev A burner authorised for one item must not be able to consume another.
    function test_burnerIsScopedToOneItem() public {
        vm.prank(owner);
        lmnt.createItem(21, true, false, true, false, 0, 0);

        vm.prank(minter);
        lmnt.mintTo(alice, 21, 1);

        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotBurnerOrHolder.selector, burner));
        lmnt.burn(alice, 21, 1);
    }

    function test_burnBatchIsScopedPerItem() public {
        vm.prank(owner);
        lmnt.createItem(22, true, false, true, false, 0, 0);

        vm.startPrank(minter);
        lmnt.mintTo(alice, SHARD, 2);
        lmnt.mintTo(alice, 22, 2);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = SHARD;
        ids[1] = 22;
        amounts[0] = 1;
        amounts[1] = 1;

        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotBurnerOrHolder.selector, burner));
        lmnt.burnBatch(alice, ids, amounts);
    }

    function test_nonBurnableItemCannotBeBurned() public {
        vm.prank(owner);
        lmnt.createItem(20, true, false, false, false, 0, 0);

        vm.prank(minter);
        lmnt.mintTo(alice, 20, 1);

        vm.prank(owner);
        lmnt.setBurner(burner, 20, true);

        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemNotBurnable.selector, uint256(20)));
        lmnt.burn(alice, 20, 1);
    }

    function test_burnBatchConsumesARecipe() public {
        vm.startPrank(minter);
        lmnt.mintTo(alice, SHARD, 5);
        lmnt.mintTo(alice, CAPSULE, 2);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = SHARD;
        ids[1] = CAPSULE;
        amounts[0] = 3;
        amounts[1] = 1;

        vm.prank(burner);
        lmnt.burnBatch(alice, ids, amounts);

        assertEq(lmnt.balanceOf(alice, SHARD), 2);
        assertEq(lmnt.balanceOf(alice, CAPSULE), 1);
    }

    /* ----------------------------------------------------------------- reading */

    function test_balanceOfDroidsReadsAWholeWallet() public {
        vm.startPrank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);
        lmnt.mintToDroid(3, ELEMENT, 1);
        vm.stopPrank();

        uint256[] memory droidIds = new uint256[](3);
        droidIds[0] = 1;
        droidIds[1] = 2;
        droidIds[2] = 3;

        uint256[] memory balances = lmnt.balanceOfDroids(droidIds, ELEMENT);
        assertEq(balances[0], 1);
        assertEq(balances[1], 0);
        assertEq(balances[2], 1);
    }

    /* ---------------------------------------------------------------- upgrades */

    function test_ownerCanUpgrade() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        LMNT1155V2 v2 = new LMNT1155V2();
        vm.prank(owner);
        lmnt.upgradeToAndCall(address(v2), "");

        assertEq(LMNT1155V2(address(lmnt)).version(), "v2");
        assertEq(lmnt.balanceOf(_inventory(1), ELEMENT), 1, "state survives the upgrade");
        assertEq(lmnt.accountImplementation(), address(0x5526), "derivation survives the upgrade");
    }

    function test_strangerCannotUpgrade() public {
        LMNT1155V2 v2 = new LMNT1155V2();
        vm.prank(alice);
        vm.expectRevert();
        lmnt.upgradeToAndCall(address(v2), "");
    }

    function test_freezeUpgradesIsFinal() public {
        LMNT1155V2 v2 = new LMNT1155V2();

        vm.startPrank(owner);
        lmnt.freezeUpgrades();

        vm.expectRevert(LMNT1155.UpgradesAreFrozen.selector);
        lmnt.upgradeToAndCall(address(v2), "");
        vm.stopPrank();

        assertTrue(lmnt.upgradesFrozen());
    }

    /* --------------------------------------------------------------- ownership */

    function test_ownershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert("LMNT: ownership cannot be renounced");
        lmnt.renounceOwnership();
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        lmnt.transferOwnership(alice);
        assertEq(lmnt.owner(), owner, "not yet");

        vm.prank(alice);
        lmnt.acceptOwnership();
        assertEq(lmnt.owner(), alice);
    }

    /* -------------------------------------------------- policy ladder, in detail */

    /// @dev Bound is the strictest state, so a reward may later be released *part* of the way —
    ///      sellable through our own market and nowhere else.
    function test_boundItemCanBeReleasedToMarketOnly() public {
        vm.prank(owner);
        lmnt.loosen(ELEMENT, true, true, true);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);
        address inventory = _inventory(1);

        vm.prank(inventory);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ItemIsMarketOnly.selector, ELEMENT));
        lmnt.safeTransferFrom(inventory, alice, ELEMENT, 1, "");

        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);
        vm.prank(market);
        lmnt.safeTransferFrom(inventory, alice, ELEMENT, 1, "");
        assertEq(lmnt.balanceOf(alice, ELEMENT), 1);
    }

    function test_marketOnlyItemCanBeReleasedToFree() public {
        vm.prank(owner);
        lmnt.loosen(CAPSULE, true, false, true);

        vm.prank(minter);
        lmnt.mintTo(alice, CAPSULE, 1);

        vm.prank(alice);
        lmnt.safeTransferFrom(alice, bob, CAPSULE, 1, "");
        assertEq(lmnt.balanceOf(bob, CAPSULE), 1);
    }

    function test_marketOnlyItemCannotBeReBound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PolicyCanOnlyLoosen.selector, CAPSULE));
        lmnt.loosen(CAPSULE, false, true, true);
    }

    function test_freeItemCannotBeReBound() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PolicyCanOnlyLoosen.selector, SHARD));
        lmnt.loosen(SHARD, false, false, true);
    }

    /* --------------------------------------------------------- per-droid rewards */

    /// @dev "One per droid" is not the minter's to interpret: a fat-fingered amount reverts rather
    ///      than handing one droid five sneakers.
    function test_perDroidItemMintsExactlyOne() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.PerDroidItemIsSingle.selector, ELEMENT));
        lmnt.mintToDroid(1, ELEMENT, 5);
    }

    function test_perDroidClaimIsNotMarkedWhenTheDroidIsUnknown() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NoSuchDroid.selector, uint256(4000)));
        lmnt.mintToDroid(4000, ELEMENT, 1);

        assertFalse(lmnt.claimedForDroid(ELEMENT, 4000));
    }

    /* ------------------------------------------------------------- guard rails */

    function test_remainingSupplyOfAnUnknownItemIsZero() public view {
        assertEq(lmnt.remainingSupply(404), 0);
    }

    function test_initializeRejectsZeroAccountLogic() public {
        LMNT1155 fresh = new LMNT1155();
        LMNT1155.InitParams memory params;
        params.owner_ = owner;
        params.collection_ = address(droidz);
        params.registry_ = address(registry);
        params.accountImplementation_ = address(0x5526);
        params.accountLogic_ = address(0);

        vm.expectRevert(LMNT1155.ZeroAddress.selector);
        new ERC1967Proxy(address(fresh), abi.encodeCall(LMNT1155.initialize, (params)));
    }

    function test_rolesCannotBeGrantedToTheZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(LMNT1155.ZeroAddress.selector);
        lmnt.setMinter(address(0), true);

        vm.expectRevert(LMNT1155.ZeroAddress.selector);
        lmnt.setBurner(address(0), SHARD, true);

        vm.expectRevert(LMNT1155.ZeroAddress.selector);
        lmnt.setApprovedMarket(address(0), true);

        vm.expectRevert(LMNT1155.ZeroAddress.selector);
        lmnt.setAccountLogic(address(0));

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotContract.selector, address(0xBEEF)));
        lmnt.setAccountLogic(address(0xBEEF));
        vm.stopPrank();
    }

    function test_unknownItemCannotBeTransferredIntoExistence() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.UnknownItem.selector, uint256(404)));
        lmnt.safeTransferFrom(alice, bob, 404, 0, "");
    }

    /// @dev The implementation behind the proxy must not be initializable on its own.
    function test_implementationCannotBeInitialized() public {
        LMNT1155 implementation = new LMNT1155();
        LMNT1155.InitParams memory params;
        params.owner_ = alice;
        params.collection_ = address(droidz);
        params.registry_ = address(registry);
        params.accountImplementation_ = address(0x5526);
        params.accountLogic_ = accountLogic;

        vm.expectRevert();
        implementation.initialize(params);
    }

    function test_supplyAccountingSurvivesAnUpgrade() public {
        vm.startPrank(minter);
        lmnt.mintTo(alice, CAPSULE, 10);
        vm.stopPrank();

        vm.prank(burner);
        lmnt.burn(alice, CAPSULE, 4);

        LMNT1155V2 v2 = new LMNT1155V2();
        vm.prank(owner);
        lmnt.upgradeToAndCall(address(v2), "");

        LMNT1155.Item memory item = lmnt.itemOf(CAPSULE);
        assertEq(item.totalMinted, 10);
        assertEq(item.totalBurned, 4);
        assertEq(lmnt.totalSupply(CAPSULE), 6);
        assertEq(lmnt.remainingSupply(CAPSULE), 90);
    }

    /* ------------------------------------------------------------- reentrancy */

    /// @dev A holder may point their own account at anything, so the receiver callback is hostile
    ///      ground. Everything that guards the drop — the claim flag and the supply counter — must
    ///      already be written by the time it fires. The re-entrant claim proves it: it comes back
    ///      as AlreadyClaimed, not as a second sneaker.
    function test_receiverCannotReenterIntoASecondClaim() public {
        address inventory = _inventory(1);
        ReenteringInventory hostile = new ReenteringInventory(lmnt, 1, ELEMENT);
        vm.etch(inventory, address(hostile).code);

        vm.prank(owner);
        lmnt.setMinter(inventory, true);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertTrue(ReenteringInventory(inventory).reentered(), "the callback did fire");
        assertEq(
            ReenteringInventory(inventory).innerRevert(),
            abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT, 1)
        );
        assertEq(lmnt.balanceOf(inventory, ELEMENT), 1, "exactly one");
        assertEq(lmnt.totalSupply(ELEMENT), 1);
    }

    /* ------------------------------------------------------------ batch hygiene */

    /// @dev A duplicated id in a drop list must fail the whole batch rather than quietly hand one
    ///      droid two rewards or silently skip it.
    function test_duplicateDroidInABatchRevertsTheWholeBatch() public {
        uint256[] memory droidIds = new uint256[](3);
        droidIds[0] = 1;
        droidIds[1] = 2;
        droidIds[2] = 1;

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT, 1));
        lmnt.mintToDroidBatch(droidIds, ELEMENT);

        assertEq(lmnt.totalSupply(ELEMENT), 0, "nothing landed");
        assertFalse(lmnt.claimedForDroid(ELEMENT, 2));
    }

    function test_emptyBatchReverts() public {
        uint256[] memory none = new uint256[](0);
        vm.prank(minter);
        vm.expectRevert(LMNT1155.EmptyBatch.selector);
        lmnt.mintToDroidBatch(none, ELEMENT);
    }

    /// @dev The repair is a courtesy, not a precondition. An account that cannot be repaired but
    ///      can still take the item must get it, rather than have the drop die on its doorstep.
    function test_mintSucceedsIntoAnAccountThatCannotBeRepaired() public {
        address inventory = _inventory(1);
        PlainReceiver plain = new PlainReceiver();
        vm.etch(inventory, address(plain).code);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertEq(lmnt.balanceOf(inventory, ELEMENT), 1);
    }

    /* ------------------------------------------------- approvals across a resale */

    /// @dev An inventory address never changes, so a plain ERC-1155 approval granted from it would
    ///      outlive the sale of the droid. It must not.
    function test_approvalFromAnInventoryLapsesWhenTheDroidIsSold() public {
        address inventory = _deployInventory(1);

        // Arrives by mintTo, never through mintToDroid — the path that used to leave the guard off.
        vm.prank(minter);
        lmnt.mintTo(inventory, SHARD, 500);

        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);
        assertTrue(lmnt.isApprovedForAll(inventory, market), "valid while alice holds the droid");

        droidz.transfer(bob, 1);

        assertFalse(lmnt.isApprovedForAll(inventory, market), "lapsed on sale");
        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155MissingApprovalForAll.selector, market, inventory));
        lmnt.safeTransferFrom(inventory, alice, SHARD, 500, "");
    }

    /// @dev The version that matters most for the first drop: the seller must not be able to destroy
    ///      the bound reward of the droid they just sold, since the claim can never be reissued.
    function test_sellerCannotBurnTheBuyersBoundReward() public {
        address inventory = _deployInventory(1);

        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);

        droidz.transfer(bob, 1);

        vm.prank(market);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.NotBurnerOrHolder.selector, market));
        lmnt.burn(inventory, ELEMENT, 1);

        assertEq(lmnt.balanceOf(inventory, ELEMENT), 1, "the buyer still has it");
    }

    function test_approvalFromAnInventoryWorksWhileTheHolderKeepsTheDroid() public {
        address inventory = _deployInventory(1);
        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 5);

        vm.prank(inventory);
        lmnt.setApprovalForAll(market, true);

        vm.prank(market);
        lmnt.safeTransferFrom(inventory, alice, SHARD, 5, "");
        assertEq(lmnt.balanceOf(alice, SHARD), 5);
    }

    function test_approvalFromAPlainWalletIsUnaffected() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 4);

        vm.prank(alice);
        lmnt.setApprovalForAll(market, true);
        assertTrue(lmnt.isApprovedForAll(alice, market));

        vm.prank(market);
        lmnt.safeTransferFrom(alice, bob, SHARD, 4, "");
        assertEq(lmnt.balanceOf(bob, SHARD), 4);
    }

    /* --------------------------------------------------- keeping items off OpenSea */

    /// @dev The listing is refused where it starts. A marketplace we have not allowlisted cannot be
    ///      approved at all, so the "approve collection" step fails and no listing is ever created.
    function test_anUnapprovedMarketplaceCannotBeApproved() public {
        address openSea = address(0x09E45EA);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.OperatorNotApproved.selector, openSea));
        lmnt.setApprovalForAll(openSea, true);

        assertFalse(lmnt.isApprovedForAll(alice, openSea));
    }

    /// @dev And from a droid inventory too, which is where items actually live.
    function test_anInventoryCannotApproveAnOutsideMarketplace() public {
        address inventory = _deployInventory(1);
        address openSea = address(0x09E45EA);

        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 1);

        vm.prank(inventory);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.OperatorNotApproved.selector, openSea));
        lmnt.setApprovalForAll(openSea, true);
    }

    /// @dev A holder must always be able to take a right back, even from an operator we removed.
    function test_revokingWorksEvenAfterTheMarketIsDelisted() public {
        vm.prank(alice);
        lmnt.setApprovalForAll(market, true);

        vm.prank(owner);
        lmnt.setApprovedMarket(market, false);

        vm.prank(alice);
        lmnt.setApprovalForAll(market, false);
        assertFalse(lmnt.isApprovedForAll(alice, market));
    }

    /// @dev The allowlist restricts operators, not owners: your own items remain yours to move.
    function test_holderCanStillMoveAFreeItemThemselves() public {
        vm.prank(minter);
        lmnt.mintTo(alice, SHARD, 2);

        vm.prank(alice);
        lmnt.safeTransferFrom(alice, bob, SHARD, 2, "");
        assertEq(lmnt.balanceOf(bob, SHARD), 2);
    }

    function test_revokingAnInventoryApprovalStillWorks() public {
        address inventory = _deployInventory(1);
        vm.prank(minter);
        lmnt.mintToDroid(1, SHARD, 1);

        vm.startPrank(inventory);
        lmnt.setApprovalForAll(market, true);
        assertTrue(lmnt.isApprovedForAll(inventory, market));
        lmnt.setApprovalForAll(market, false);
        vm.stopPrank();

        assertFalse(lmnt.isApprovedForAll(inventory, market));
    }

    /* ------------------------------------------------------------- zero amounts */

    function test_zeroAmountMintsAreRefused() public {
        vm.startPrank(minter);
        vm.expectRevert(LMNT1155.ZeroAmount.selector);
        lmnt.mintToDroid(1, SHARD, 0);

        vm.expectRevert(LMNT1155.ZeroAmount.selector);
        lmnt.mintTo(alice, SHARD, 0);
        vm.stopPrank();
    }

    /* ------------------------------------------------------------- claim groups */

    /// @dev The two sneakers are alternatives, not two rewards. A droid earns one of them, ever —
    ///      and that has to hold on chain, because the backend decides which one from a battery
    ///      type it reads out of a database that can fail closed to the wrong answer.
    function test_aDroidCannotEarnBothSneakers() public {
        vm.startPrank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT_SUPER, 1));
        lmnt.mintToDroid(1, ELEMENT_SUPER, 1);
        vm.stopPrank();

        assertEq(lmnt.balanceOf(_inventory(1), ELEMENT_SUPER), 0);
    }

    function test_theExclusionWorksInEitherOrder() public {
        vm.startPrank(minter);
        lmnt.mintToDroid(2, ELEMENT_SUPER, 1);

        vm.expectRevert(abi.encodeWithSelector(LMNT1155.AlreadyClaimed.selector, ELEMENT, 2));
        lmnt.mintToDroid(2, ELEMENT, 1);
        vm.stopPrank();
    }

    /// @dev And the view says so, so the backend can check before it spends a transaction finding out.
    function test_claimedForDroidReportsTheWholeGroup() public {
        vm.prank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);

        assertTrue(lmnt.claimedForDroid(ELEMENT, 1));
        assertTrue(lmnt.claimedForDroid(ELEMENT_SUPER, 1), "the alternative counts as claimed too");
        assertFalse(lmnt.claimedForDroid(ELEMENT, 3), "and says nothing about another droid");
    }

    /// @dev Items outside the group are unaffected — a droid can still hold other rewards.
    function test_otherPerDroidItemsAreNotAffected() public {
        vm.prank(owner);
        lmnt.createItem(30, false, false, false, true, 0, 3333);

        vm.startPrank(minter);
        lmnt.mintToDroid(1, ELEMENT, 1);
        lmnt.mintToDroid(1, 30, 1);
        vm.stopPrank();

        assertEq(lmnt.balanceOf(_inventory(1), 30), 1);
    }

    function test_aClaimGroupMustPointAtAnExistingAnchor() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.UnknownItem.selector, uint256(404)));
        lmnt.createItem(31, false, false, false, true, 404, 0);

        // And the anchor must be one, not a member of someone else's group.
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ClaimGroupNotAnAnchor.selector, ELEMENT_SUPER));
        lmnt.createItem(32, false, false, false, true, uint96(ELEMENT_SUPER), 0);

        // A group is meaningless for an item that is not once-per-droid.
        vm.expectRevert(abi.encodeWithSelector(LMNT1155.ClaimGroupNeedsPerDroid.selector, uint256(33)));
        lmnt.createItem(33, true, false, true, false, uint96(ELEMENT), 0);
        vm.stopPrank();
    }

    /* ---------------------------------------------------------- account liveness */

    /// @dev `owner()` on a real account answers with the zero address instead of reverting when the
    ///      token does not exist, so this view has to check the droid itself.
    function test_accountLiveIsFalseForADroidThatDoesNotExist() public {
        assertFalse(lmnt.isAccountLive(9999));
    }
}
