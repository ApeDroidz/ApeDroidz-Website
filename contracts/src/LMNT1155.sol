// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @dev The single view of the ERC-6551 registry this contract needs. The registry derives an
///      account address deterministically, so it answers for droids whose account was never
///      deployed — which is every droid until its holder first moves something out.
interface IERC6551Registry {
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

/// @dev The account the registry deploys is a proxy that delegates to nothing until someone points
///      it at an implementation. Anyone may do so, once.
interface IAccountProxy {
    function initialize(address implementation) external;
}

/// @dev The one ERC-6551 accessor that lets an account state which token it belongs to. Asking it
///      directly is how this contract recognises a droid inventory without having had to write
///      anything down about it first.
interface IERC6551Account {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
}

interface IDroidOwnership {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title LMNT1155 — LMNT™ by ApeDroidz
/// @notice The item collection for ApeDroidz. Items live in the ERC-6551 token-bound account of a
///         droid, so a droid's inventory changes hands with the droid itself and needs no bookkeeping
///         of its own.
///
/// @dev Design rules this contract is built to keep:
///
///      1. Address derivation is fixed forever. `registry`, `accountImplementation` and `accountSalt`
///         are written once in {initialize} and have no setter, not even for the owner. Changing any
///         of them would move every droid's inventory to a different address and strand what is in
///         the old one, so the only way to change them is a new deployment — deliberately.
///
///      2. An item's policy is set when its id is created and can only ever be *loosened*
///         (see {loosen}). A bound item can be released, a market-only item can be set free, a
///         non-burnable item can be made burnable. None of these can be reversed by any function
///         here. Note the limit of that promise honestly: while this contract is upgradeable, the
///         rule is enforced by code its owner can replace, so a soulbound guarantee is only
///         unconditional once {freezeUpgrades} has been called.
///
///      3. Supply is counted in mints, never in balances. Burning an item does not free room under
///         `maxSupply`, so "1 of N" stays true no matter how much is consumed by crafting.
///         {sealSupply} turns an open-ended id into a permanently capped one at its current count.
///
///      4. Per-droid items are claimed once per droid, ever. {claimedForDroid} is keyed by droid id,
///         not by wallet, so reselling an upgraded droid never yields a second copy of its reward.
///
///      Upgrading this contract: the parents use ERC-7201 namespaced storage, so the variables
///      declared here start at slot zero and must only ever be *appended* to. Never reorder,
///      retype or delete one — every droid inventory address is derived from three of them.
contract LMNT1155 is ERC1155Upgradeable, ERC2981Upgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
    using Strings for uint256;

    /// @dev Gas allowed to the best-effort repair of a bare inventory proxy during a mint. A real
    ///      initialisation costs a fraction of this; the cap is there so that an account whose
    ///      holder made it expensive cannot burn the gas of the whole batch it sits in.
    uint256 private constant REPAIR_GAS_LIMIT = 200_000;

    /// @notice Everything the contract knows about one item id.
    /// @param exists         Set when the id is created. Nothing can be minted for an unknown id.
    /// @param transferable   False for an item bound to a droid's inventory: it can be minted and
    ///                       burned, but never moved. May be loosened to true, never back.
    /// @param marketOnly     True when transfers are allowed only through an approved market
    ///                       contract, which is what lets a sale carry guarantees a raw transfer
    ///                       cannot. May be loosened to false, never back. Ignored while
    ///                       `transferable` is false.
    /// @param burnable       Whether the item can be consumed — by its holder, or by an approved
    ///                       burner such as a crafting contract. May be loosened to true, never back.
    /// @param perDroid       True for a reward that exists once per droid: it may only be minted
    ///                       through {mintToDroid} and only if that droid has not claimed it before.
    ///                       Fixed at creation; this is a distribution rule, not a restriction.
    /// @param claimGroup     Ids that share a claim group are alternatives to each other: a droid
    ///                       may hold one of them, ever. Zero means the id stands alone. The two
    ///                       level-2 sneakers use this — a droid earns the standard one or the
    ///                       super one, never both, and that is now true on chain rather than only
    ///                       in whatever minted them. Fixed at creation.
    /// @param supplySealed   Set by {sealSupply}. `maxSupply` is then final and can never move again.
    /// @param maxSupply      Hard ceiling on total mints. Zero means open-ended until sealed.
    /// @param totalMinted    Mints so far. Only ever grows, including across burns.
    /// @param totalBurned    Burns so far.
    struct Item {
        bool exists;
        bool transferable;
        bool marketOnly;
        bool burnable;
        bool perDroid;
        bool supplySealed;
        uint96 claimGroup;
        uint96 maxSupply;
        uint96 totalMinted;
        uint96 totalBurned;
    }

    /* ------------------------------------------------------------------ storage */

    /// @notice The ERC-6551 registry used to derive every droid's inventory address. Never changes.
    IERC6551Registry public registry;
    /// @notice The account implementation the derivation is bound to. Never changes.
    /// @dev This is the account *proxy*, which is what the address derivation hashes over. It is
    ///      deliberately not the account logic — see {accountLogic}.
    address public accountImplementation;
    /// @notice The salt the derivation is bound to. Never changes.
    bytes32 public accountSalt;
    /// @notice The ApeDroidz ERC-721 collection these items belong to. Never changes.
    IDroidOwnership public collection;

    /// @notice Collection name, for marketplaces that read one off an ERC-1155.
    string public name;
    /// @notice Collection symbol, for marketplaces that read one off an ERC-1155.
    string public symbol;
    /// @notice Collection-level metadata document, read by marketplaces.
    string public contractURI;
    /// @dev Item metadata lives behind an API, so the id is appended to this prefix.
    string private _baseUri;

    /// @notice The account logic a freshly deployed inventory proxy is pointed at.
    /// @dev Not part of the address derivation, so replacing it moves nothing and strands nothing.
    ///      Each holder may point their own account somewhere else afterwards; this is only the
    ///      starting implementation used when this contract deploys an account itself.
    address public accountLogic;

    /// @notice True once {freezeUpgrades} has been called. Upgrades are then impossible forever.
    bool public upgradesFrozen;

    mapping(uint256 id => Item) private _items;
    /// @dev Claims by group rather than by id, so that alternatives exclude one another. Read it
    ///      through {claimedForDroid}, which resolves an id to its group.
    mapping(uint256 group => mapping(uint256 droidId => bool)) private _claimedForGroup;

    /// @notice Addresses allowed to mint. Meant for the upgrade backend and future drop contracts.
    mapping(address account => bool) public isMinter;
    /// @notice Addresses allowed to burn a given item id. Scoped per item on purpose: a crafting
    ///         contract should be able to consume its own recipe's inputs and nothing else.
    mapping(address account => mapping(uint256 id => bool)) public isBurnerFor;
    /// @notice The only operators anyone may approve over their items, and the only callers
    ///         through which a `marketOnly` item may move. In practice: our own marketplace.
    /// @dev This allowlist does two jobs at once, and the first one is what keeps items off
    ///      external marketplaces. See {setApprovalForAll}.
    mapping(address account => bool) public isApprovedMarket;

    /// @notice An operator approval that was granted from a droid inventory, and the state it was
    ///         granted in. Zero `droidIdPlusOne` means the approval came from an ordinary wallet.
    /// @dev An inventory's address never changes, so without this an approval granted by one holder
    ///      would keep working against the next holder's items — see {isApprovedForAll}.
    struct InventoryApproval {
        uint96 droidIdPlusOne;
        address grantedUnder;
    }

    mapping(address account => mapping(address operator => InventoryApproval)) private _inventoryApproval;

    /* ------------------------------------------------------------------- events */

    event ItemCreated(uint256 indexed id, Item item);
    event ItemLoosened(uint256 indexed id, bool transferable, bool marketOnly, bool burnable);
    event SupplySealed(uint256 indexed id, uint96 finalSupply);
    event MintedToDroid(uint256 indexed droidId, uint256 indexed id, address indexed account, uint256 amount);
    event AccountLogicSet(address indexed accountLogic);
    event AccountReady(uint256 indexed droidId, address indexed account);
    event MinterSet(address indexed account, bool allowed);
    event BurnerSet(address indexed account, uint256 indexed id, bool allowed);
    event MarketSet(address indexed account, bool approved);
    event BaseUriSet(string baseUri);
    event ContractUriSet(string contractUri);
    event UpgradesFrozen();
    /// @dev ERC-4906. Marketplaces watch these to re-read metadata instead of waiting for a crawl.
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    /* ------------------------------------------------------------------- errors */

    error UnknownItem(uint256 id);
    error ItemAlreadyExists(uint256 id);
    error ItemIsBound(uint256 id);
    error ItemIsMarketOnly(uint256 id);
    error ItemNotBurnable(uint256 id);
    error SupplyExceeded(uint256 id, uint96 maxSupply);
    error SupplyAlreadySealed(uint256 id);
    error AmountTooLarge(uint256 amount);
    error NotPerDroid(uint256 id);
    error PerDroidItemNeedsDroid(uint256 id);
    error PerDroidItemIsSingle(uint256 id);
    error ClaimGroupNeedsPerDroid(uint256 id);
    error ClaimGroupNotAnAnchor(uint256 id);
    error ZeroAmount();
    error NothingMintedToSeal(uint256 id);
    error AccountNotReady(uint256 droidId);
    error NotContract(address account);
    error OperatorNotApproved(address operator);
    error BadRange(uint256 fromId, uint256 toId);
    error AlreadyClaimed(uint256 id, uint256 droidId);
    error NoSuchDroid(uint256 droidId);
    error PolicyCanOnlyLoosen(uint256 id);
    error NotMinter(address caller);
    error NotBurnerOrHolder(address caller);
    error UpgradesAreFrozen();
    error ZeroAddress();
    error EmptyBatch();

    /* -------------------------------------------------------------- constructor */

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Arguments for {initialize}.
    /// @param owner_ The cold address that governs the collection. Not the minting backend.
    /// @param collection_ The ApeDroidz ERC-721.
    /// @param registry_ The ERC-6551 registry.
    /// @param accountImplementation_ The account implementation the derivation is bound to.
    /// @param accountSalt_ The salt the derivation is bound to.
    struct InitParams {
        address owner_;
        address collection_;
        address registry_;
        address accountImplementation_;
        address accountLogic_;
        bytes32 accountSalt_;
        string name_;
        string symbol_;
        string baseUri_;
        string contractUri_;
        address royaltyReceiver_;
        uint96 royaltyFeeNumerator_;
    }

    /// @notice One-time setup. Everything the collection can never change is written here.
    function initialize(InitParams calldata p) external initializer {
        if (
            p.owner_ == address(0) || p.collection_ == address(0) || p.registry_ == address(0)
                || p.accountImplementation_ == address(0) || p.accountLogic_ == address(0)
        ) revert ZeroAddress();
        if (p.accountLogic_.code.length == 0) revert NotContract(p.accountLogic_);

        __ERC1155_init("");
        __ERC2981_init();
        __Ownable_init(p.owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();

        collection = IDroidOwnership(p.collection_);
        registry = IERC6551Registry(p.registry_);
        accountImplementation = p.accountImplementation_;
        accountLogic = p.accountLogic_;
        accountSalt = p.accountSalt_;

        name = p.name_;
        symbol = p.symbol_;
        _baseUri = p.baseUri_;
        contractURI = p.contractUri_;

        if (p.royaltyReceiver_ != address(0)) _setDefaultRoyalty(p.royaltyReceiver_, p.royaltyFeeNumerator_);

        emit AccountLogicSet(p.accountLogic_);
        emit BaseUriSet(p.baseUri_);
        emit ContractUriSet(p.contractUri_);
    }

    /* ------------------------------------------------------------ droid accounts */

    /// @notice The inventory address of a droid: its ERC-6551 account.
    /// @dev Deterministic, and correct whether or not the account has been deployed. Nothing needs
    ///      to be deployed for the account to receive items — an address with no code takes an
    ///      ERC-1155 transfer without a receiver callback.
    function accountOf(uint256 droidId) public view returns (address) {
        return registry.account(accountImplementation, accountSalt, block.chainid, address(collection), droidId);
    }

    /// @notice The droid an address is the inventory of, or zero if it is not one.
    /// @dev Answered by asking the account itself and checking the answer against our own
    ///      derivation, so it is correct for any deployed inventory — including one this contract
    ///      has never minted into. An inventory that has not been deployed yet has no code and
    ///      cannot answer, and also cannot originate a call, so nothing depends on it here.
    ///      {isDroidInventory} distinguishes "not an inventory" from droid id zero.
    function droidOfAccount(address account_) external view returns (uint256) {
        uint256 plusOne = _inventoryDroidId(account_);
        return plusOne == 0 ? 0 : plusOne - 1;
    }

    /// @notice Whether an address is the token-bound inventory of a droid in this collection.
    function isDroidInventory(address account_) external view returns (bool) {
        return _inventoryDroidId(account_) != 0;
    }

    /// @dev The droid id an account belongs to, plus one; zero when it is not one of our
    ///      inventories. Both directions are checked: the account must name a droid of this
    ///      collection on this chain, and that droid's derived address must be the account itself.
    function _inventoryDroidId(address account_) private view returns (uint256) {
        if (account_.code.length == 0) return 0;
        try IERC6551Account(account_).token() returns (uint256 chainId, address tokenContract, uint256 tokenId) {
            if (chainId != block.chainid || tokenContract != address(collection)) return 0;
            if (accountOf(tokenId) != account_ || tokenId >= type(uint96).max) return 0;
            return tokenId + 1;
        } catch {
            return 0;
        }
    }

    /// @notice Whether a droid's inventory is deployed and pointed at working account logic.
    /// @dev False both for an address with no code — the normal state, and perfectly fine to mint
    ///      into — and for a proxy someone deployed but never initialized, which is not.
    ///
    ///      Gated on the droid existing as well. An account's `owner()` answers with the zero
    ///      address rather than reverting when its token does not exist, so without this check a
    ///      stranger could deploy an account for an id past the end of the collection and have this
    ///      view call it live.
    function isAccountLive(uint256 droidId) external view returns (bool) {
        if (_droidHolder(droidId) == address(0)) return false;
        return _isLiveAccount(accountOf(droidId));
    }

    /// @notice Deploy a droid's inventory account and point it at {accountLogic}.
    /// @dev Permissionless and idempotent. Nothing needs this to receive items; it is needed the
    ///      first time a holder wants to act *through* the account. Also repairs an account that
    ///      someone deployed through the registry directly and left uninitialized.
    function ensureAccount(uint256 droidId) public returns (address inventory) {
        _requireDroidExists(droidId);
        inventory = accountOf(droidId);

        if (inventory.code.length == 0) {
            address created =
                registry.createAccount(accountImplementation, accountSalt, block.chainid, address(collection), droidId);
            // The registry derives the same address we do. If it ever disagreed, something far more
            // wrong has happened than a failed mint, and continuing would work on the wrong account.
            if (created != inventory) revert AccountNotReady(droidId);
        }
        if (!_isLiveAccount(inventory)) {
            // Reverts with AlreadyInitialized for an account that was set up but whose `owner()`
            // does not answer, which is a state a holder can reach on their own. Swallow it and let
            // the liveness check below give the honest error instead of a confusing one.
            try IAccountProxy(inventory).initialize{gas: REPAIR_GAS_LIMIT}(accountLogic) {} catch {}
            if (!_isLiveAccount(inventory)) revert AccountNotReady(droidId);
        }

        emit AccountReady(droidId, inventory);
    }

    /// @dev An account is live once `owner()` answers with a word. A bare proxy delegates to the
    ///      zero address, so the call succeeds with empty returndata rather than reverting — hence
    ///      checking the size and not just the success flag.
    ///
    ///      Done in assembly deliberately: the callee is an account whose logic its holder may have
    ///      overridden, and a Solidity call would forward all remaining gas and copy however much
    ///      returndata it was handed into memory. A fixed 32-byte buffer and a gas stipend keep a
    ///      hostile inventory from making this expensive for the batch it sits in.
    function _isLiveAccount(address account_) private view returns (bool live) {
        if (account_.code.length == 0) return false;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x8da5cb5b00000000000000000000000000000000000000000000000000000000) // owner()
            let ok := staticcall(100000, account_, ptr, 4, ptr, 32)
            live := and(ok, eq(returndatasize(), 32))
        }
    }

    /// @dev Whoever holds a droid right now, or the zero address if the token does not exist.
    function _droidHolder(uint256 droidId) private view returns (address) {
        try collection.ownerOf(droidId) returns (address holder) {
            return holder;
        } catch {
            return address(0);
        }
    }

    /* --------------------------------------------------------------- item admin */

    /// @notice Create an item id and fix its policy. The policy can afterwards only be loosened.
    /// @param maxSupply Hard ceiling on mints, or zero for an open-ended id to be sealed later.
    function createItem(
        uint256 id,
        bool transferable,
        bool marketOnly,
        bool burnable,
        bool perDroid,
        uint96 claimGroup,
        uint96 maxSupply
    ) external onlyOwner {
        if (_items[id].exists) revert ItemAlreadyExists(id);
        // A group only means anything for a once-per-droid reward, and pointing at an id that does
        // not exist yet would silently create a group of one under a name that later changes hands.
        if (claimGroup != 0) {
            if (!perDroid) revert ClaimGroupNeedsPerDroid(id);
            if (!_items[claimGroup].exists) revert UnknownItem(claimGroup);
            if (_items[claimGroup].claimGroup != 0) revert ClaimGroupNotAnAnchor(claimGroup);
        }

        Item memory item = Item({
            exists: true,
            transferable: transferable,
            marketOnly: marketOnly,
            burnable: burnable,
            perDroid: perDroid,
            supplySealed: false,
            claimGroup: claimGroup,
            maxSupply: maxSupply,
            totalMinted: 0,
            totalBurned: 0
        });
        _items[id] = item;

        emit ItemCreated(id, item);
    }

    /// @notice Loosen an item's policy. It may move towards freedom and never back.
    /// @dev Transfer freedom is a ladder, not two independent flags — see {_freedom}. A bound item
    ///      may therefore be released either all the way to free or only as far as market-only,
    ///      which is what lets a reward become sellable through our own market and nowhere else.
    ///      `burnable` may go false to true, never back. Passing the current values is a no-op.
    function loosen(uint256 id, bool transferable, bool marketOnly, bool burnable) external onlyOwner {
        Item storage item = _items[id];
        if (!item.exists) revert UnknownItem(id);

        if (_freedom(transferable, marketOnly) < _freedom(item.transferable, item.marketOnly)) {
            revert PolicyCanOnlyLoosen(id);
        }
        if (item.burnable && !burnable) revert PolicyCanOnlyLoosen(id);

        item.transferable = transferable;
        item.marketOnly = marketOnly;
        item.burnable = burnable;

        emit ItemLoosened(id, transferable, marketOnly, burnable);
    }

    /// @notice Freeze an item's supply at whatever has been minted so far. Permanent.
    /// @dev This is how an open-ended reward — the level-2 sneakers, whose final count is only known
    ///      once upgrading ends — becomes a provable "1 of N".
    function sealSupply(uint256 id) external onlyOwner {
        Item storage item = _items[id];
        if (!item.exists) revert UnknownItem(id);
        if (item.supplySealed) revert SupplyAlreadySealed(id);
        // Zero is the sentinel for "open-ended", so sealing an id nobody has minted would write a
        // cap of zero and thereby remove the cap entirely — the exact opposite of the intent, and
        // unrepeatable. An id that should exist but never issue is one nobody ever mints.
        if (item.totalMinted == 0) revert NothingMintedToSeal(id);

        item.maxSupply = item.totalMinted;
        item.supplySealed = true;

        emit SupplySealed(id, item.totalMinted);
    }

    /* -------------------------------------------------------------------- roles */

    function setMinter(address account_, bool allowed) external onlyOwner {
        if (account_ == address(0)) revert ZeroAddress();
        isMinter[account_] = allowed;
        emit MinterSet(account_, allowed);
    }

    /// @notice Allow an address to consume one specific item id out of any holder's balance.
    /// @dev Scoped per id so that approving a crafting contract for its own recipe inputs does not
    ///      hand it the whole collection. Grant it to nothing until such a contract exists.
    function setBurner(address account_, uint256 id, bool allowed) external onlyOwner {
        if (account_ == address(0)) revert ZeroAddress();
        isBurnerFor[account_][id] = allowed;
        emit BurnerSet(account_, id, allowed);
    }

    /// @notice Point future account deployments at different account logic.
    /// @dev Changing this moves no inventory and touches nothing already deployed — the address is
    ///      not part of the derivation. It is still not a casual setting: the account proxy accepts
    ///      only its own built-in default or an implementation its guardian trusts, and that
    ///      guardian belongs to Tokenbound, not to us. A value it rejects makes {ensureAccount}
    ///      revert for every droid whose inventory is not yet deployed. Change it only to an
    ///      implementation verified to be accepted on chain, and verify by calling
    ///      {ensureAccount} for one droid straight afterwards.
    function setAccountLogic(address accountLogic_) external onlyOwner {
        if (accountLogic_ == address(0)) revert ZeroAddress();
        if (accountLogic_.code.length == 0) revert NotContract(accountLogic_);
        accountLogic = accountLogic_;
        emit AccountLogicSet(accountLogic_);
    }

    function setApprovedMarket(address account_, bool approved) external onlyOwner {
        if (account_ == address(0)) revert ZeroAddress();
        isApprovedMarket[account_] = approved;
        emit MarketSet(account_, approved);
    }

    /* ------------------------------------------------------------------ minting */

    /// @notice Mint an item into a droid's inventory.
    /// @dev The only way to mint a bound or per-droid item. Works for a droid whose account has
    ///      never been deployed.
    function mintToDroid(uint256 droidId, uint256 id, uint256 amount) external {
        _requireMinter();
        _mintToDroid(droidId, id, amount);
    }

    /// @notice Mint one of an item into each of several droid inventories.
    /// @dev The retroactive drop path: one call covers a batch of already-upgraded droids.
    function mintToDroidBatch(uint256[] calldata droidIds, uint256 id) external {
        _requireMinter();
        if (droidIds.length == 0) revert EmptyBatch();
        for (uint256 i = 0; i < droidIds.length; ++i) {
            _mintToDroid(droidIds[i], id, 1);
        }
    }

    /// @notice Mint an item to a plain address.
    /// @dev Available only for items that are neither bound to a droid nor per-droid — a capsule
    ///      drop bought by a wallet, for instance.
    function mintTo(address to, uint256 id, uint256 amount) external {
        _requireMinter();
        Item storage item = _items[id];
        if (!item.exists) revert UnknownItem(id);
        if (!item.transferable) revert ItemIsBound(id);
        if (item.perDroid) revert PerDroidItemNeedsDroid(id);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _mint(to, id, amount, "");
    }

    function _mintToDroid(uint256 droidId, uint256 id, uint256 amount) private {
        Item storage item = _items[id];
        if (!item.exists) revert UnknownItem(id);
        if (amount == 0) revert ZeroAmount();
        _requireDroidExists(droidId);

        if (item.perDroid) {
            if (amount != 1) revert PerDroidItemIsSingle(id);
            uint256 group = item.claimGroup == 0 ? id : item.claimGroup;
            if (_claimedForGroup[group][droidId]) revert AlreadyClaimed(id, droidId);
            _claimedForGroup[group][droidId] = true;
        }

        address inventory = accountOf(droidId);

        // An address with no code takes an ERC-1155 without a receiver callback, which is why the
        // drop can land before any account is deployed. A proxy that someone deployed through the
        // registry and left uninitialized is the one case in between: it has code, so the callback
        // fires, and it answers nothing. Anyone may initialize such a proxy, so we do it here rather
        // than let a stranger's transaction block a droid's reward.
        if (inventory.code.length != 0 && !_isLiveAccount(inventory)) {
            // Best effort on purpose. Repairing a bare proxy is the case worth handling, and it
            // succeeds. Anything else with code at that address is an account whose holder replaced
            // its logic themselves; if that logic refuses to be reinitialised, the mint below is
            // still the right thing to attempt, and its own receiver check gives the honest error.
            // The gas cap matters here specifically: this runs once per droid inside a batch.
            try IAccountProxy(inventory).initialize{gas: REPAIR_GAS_LIMIT}(accountLogic) {} catch {}
        }

        _mint(inventory, id, amount, "");

        emit MintedToDroid(droidId, id, inventory, amount);
    }

    /* ------------------------------------------------------------------ burning */

    /// @notice Consume an item. Callable by an approved burner — a crafting contract — or by the
    ///         holder itself, which for an inventory item means the droid's owner acting through
    ///         its token-bound account.
    function burn(address from, uint256 id, uint256 amount) external {
        Item storage item = _items[id];
        if (!item.exists) revert UnknownItem(id);
        if (!item.burnable) revert ItemNotBurnable(id);
        if (!_mayBurn(item, from, id)) revert NotBurnerOrHolder(msg.sender);

        _burn(from, id, amount);
    }

    /// @notice Batch form of {burn}, for crafting recipes that consume several items at once.
    function burnBatch(address from, uint256[] calldata ids, uint256[] calldata amounts) external {
        if (ids.length == 0) revert EmptyBatch();
        for (uint256 i = 0; i < ids.length; ++i) {
            Item storage item = _items[ids[i]];
            if (!item.exists) revert UnknownItem(ids[i]);
            if (!item.burnable) revert ItemNotBurnable(ids[i]);
            // Per id: a burner authorised for one input of a recipe may not consume the rest.
            if (!_mayBurn(item, from, ids[i])) revert NotBurnerOrHolder(msg.sender);
        }

        _burnBatch(from, ids, amounts);
    }

    /* ---------------------------------------------------------------- approvals */

    /// @notice Approve an operator over the caller's items. Only allowlisted operators qualify.
    ///
    /// @dev This is the mechanism that keeps LMNT items off external marketplaces, and it is worth
    ///      being precise about why it lives here rather than only in {_update}. A marketplace
    ///      cannot sell what it cannot move, and the way it gets the right to move is exactly this
    ///      call. Refusing it means OpenSea's "approve collection" step fails outright and the
    ///      listing is never created — the holder learns immediately. Enforcing only at transfer
    ///      time would instead let a listing be created, sit there looking live, and revert on the
    ///      buyer's purchase: the same end state, reached through a bad experience and a wasted fee.
    ///
    ///      Revoking is always allowed, whatever the operator. A holder can always take a right
    ///      back, including from an operator we have since removed from the allowlist.
    ///
    ///      This restricts operators, not owners: anyone may still move their own transferable
    ///      items directly, and a crafting contract burns through {isBurnerFor} without needing any
    ///      approval at all.
    ///
    ///      Removing an operator from the allowlist later revokes what it already holds, because
    ///      {isApprovedForAll} reads the allowlist too. Re-adding it restores every approval that
    ///      was live before, so a delisting is a real kill switch rather than a rule that applies
    ///      only to grants made after it.
    function setApprovalForAll(address operator, bool approved) public virtual override {
        if (approved && !isApprovedMarket[operator]) revert OperatorNotApproved(operator);

        super.setApprovalForAll(operator, approved);

        // Ask the caller whether it is a droid inventory rather than looking it up in anything we
        // wrote earlier: an inventory can hold items it received by transfer or by a mint to its
        // address, neither of which this contract would have recorded, and those are exactly the
        // items a departing holder would otherwise keep rights over.
        uint256 plusOne = _inventoryDroidId(_msgSender());
        if (approved && plusOne != 0) {
            // casting to 'uint96' is safe because _inventoryDroidId rejects any token id at or above
            // type(uint96).max, and this collection's ids only ever reach 3333.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint96 droidIdPlusOne = uint96(plusOne);
            _inventoryApproval[_msgSender()][operator] =
                InventoryApproval({droidIdPlusOne: droidIdPlusOne, grantedUnder: _droidHolder(plusOne - 1)});
        } else if (!approved) {
            delete _inventoryApproval[_msgSender()][operator];
        }
    }

    /// @notice Whether `operator` may act over `account_`'s items.
    ///
    /// @dev A droid's inventory keeps its address forever, which is the whole point — but it means a
    ///      plain ERC-1155 approval granted from it would outlive the sale of the droid. The seller
    ///      would keep operator rights over the buyer's inventory: able to move its tradable items
    ///      out, and to burn even the bound ones, which for a once-per-droid reward can never be
    ///      reissued. So an approval given from an inventory is valid only while the droid is still
    ///      held by whoever granted it, and lapses the moment the droid changes hands.
    ///
    ///      Approvals from ordinary wallets are untouched and behave exactly as ERC-1155 says.
    function isApprovedForAll(address account_, address operator) public view virtual override returns (bool) {
        if (!super.isApprovedForAll(account_, operator)) return false;
        // Read here and not only at grant time, so that removing a market from the allowlist
        // actually takes back the power it already holds.
        if (!isApprovedMarket[operator]) return false;

        // An approval granted from an inventory revives if the droid ever returns to the wallet
        // that granted it. That is the same person getting their own delegation back, so it stands.
        InventoryApproval memory granted = _inventoryApproval[account_][operator];
        if (granted.droidIdPlusOne == 0) return true; // granted by an ordinary wallet

        return
            granted.grantedUnder != address(0)
                && granted.grantedUnder == _droidHolder(uint256(granted.droidIdPlusOne) - 1);
    }

    /* ------------------------------------------------------------ transfer rules */

    /// @dev The one place every balance change passes through: supply accounting on mint and burn,
    ///      policy enforcement on transfer.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        bool minting = from == address(0);
        bool burning = to == address(0);

        for (uint256 i = 0; i < ids.length; ++i) {
            uint256 id = ids[i];
            Item storage item = _items[id];
            if (!item.exists) revert UnknownItem(id);
            if (values[i] > type(uint96).max) revert AmountTooLarge(values[i]);

            if (minting) {
                uint96 minted = item.totalMinted + uint96(values[i]);
                if (item.maxSupply != 0 && minted > item.maxSupply) revert SupplyExceeded(id, item.maxSupply);
                item.totalMinted = minted;
            } else if (burning) {
                item.totalBurned += uint96(values[i]);
            } else {
                if (!item.transferable) revert ItemIsBound(id);
                if (item.marketOnly && !isApprovedMarket[msg.sender]) revert ItemIsMarketOnly(id);
            }
        }

        super._update(from, to, ids, values);
    }

    /* -------------------------------------------------------------------- views */

    function itemOf(uint256 id) external view returns (Item memory) {
        return _items[id];
    }

    /// @notice Whether a droid has already claimed this item, or any alternative sharing its group.
    /// @dev The backend must read this before minting: for the sneakers, a droid that already has
    ///      the standard one reads true for the super one too, because it may only ever hold one.
    function claimedForDroid(uint256 id, uint256 droidId) public view returns (bool) {
        Item storage item = _items[id];
        uint256 group = item.claimGroup == 0 ? id : item.claimGroup;
        return _claimedForGroup[group][droidId];
    }

    /// @notice Whether an item id has been created.
    function exists(uint256 id) external view returns (bool) {
        return _items[id].exists;
    }

    /// @notice Items of `id` currently in circulation: everything minted, less everything burned.
    function totalSupply(uint256 id) external view returns (uint256) {
        Item storage item = _items[id];
        return item.totalMinted - item.totalBurned;
    }

    /// @notice How many of `id` can still be minted. Type maximum while the id is open-ended.
    function remainingSupply(uint256 id) external view returns (uint256) {
        Item storage item = _items[id];
        if (!item.exists) return 0;
        if (item.maxSupply == 0) return type(uint256).max;
        return item.maxSupply - item.totalMinted;
    }

    /// @notice Balances of one item across many droid inventories, for the collection UI.
    function balanceOfDroids(uint256[] calldata droidIds, uint256 id)
        external
        view
        returns (uint256[] memory balances)
    {
        balances = new uint256[](droidIds.length);
        for (uint256 i = 0; i < droidIds.length; ++i) {
            balances[i] = balanceOf(accountOf(droidIds[i]), id);
        }
    }

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(_baseUri, id.toString());
    }

    function baseURI() external view returns (string memory) {
        return _baseUri;
    }

    /* ---------------------------------------------------------------- metadata */

    function setBaseURI(string calldata baseUri_) external onlyOwner {
        _baseUri = baseUri_;
        emit BaseUriSet(baseUri_);
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    /// @notice Ask marketplaces and indexers to re-read metadata for a range of ids.
    /// @dev The art and traits behind {uri} are served by an API and change without any on-chain
    ///      write — after an upgrade of a droid, for instance. Without a signal, a marketplace shows
    ///      what it cached until its next crawl. Pass the same id twice to refresh a single item.
    function refreshMetadata(uint256 fromId, uint256 toId) external onlyOwner {
        if (fromId > toId) revert BadRange(fromId, toId);
        if (fromId == toId) {
            emit MetadataUpdate(fromId);
        } else {
            emit BatchMetadataUpdate(fromId, toId);
        }
    }

    function setContractURI(string calldata contractUri_) external onlyOwner {
        contractURI = contractUri_;
        emit ContractUriSet(contractUri_);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 id, address receiver, uint96 feeNumerator) external onlyOwner {
        _setTokenRoyalty(id, receiver, feeNumerator);
    }

    /* ---------------------------------------------------------------- upgrades */

    /// @notice Give up the ability to upgrade this contract, forever.
    /// @dev Meant for the day the design has settled. Nothing here can undo it.
    function freezeUpgrades() external onlyOwner {
        upgradesFrozen = true;
        emit UpgradesFrozen();
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (upgradesFrozen) revert UpgradesAreFrozen();
    }

    /* -------------------------------------------------------------- interfaces */

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155Upgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        // ERC-4906. Advertised by hand because it defines events only, so there is no OZ base to
        // inherit it from — and an indexer that does not see it advertised filters the events out.
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }

    /* --------------------------------------------------------------- internals */

    /// @dev How free an item is to move, as one ordered value rather than two flags:
    ///        0 — bound: it cannot leave the inventory at all;
    ///        1 — market-only: it moves only through an approved market;
    ///        2 — free: it moves anywhere.
    ///      {loosen} may raise this number and never lower it.
    function _freedom(bool transferable, bool marketOnly) private pure returns (uint8) {
        if (!transferable) return 0;
        return marketOnly ? 1 : 2;
    }

    /// @dev Who may destroy someone's item. An operator approval is a licence to *move* things, so
    ///      it extends to burning only what could have been moved anyway. For a bound item it does
    ///      not: destroying a once-per-droid reward can never be undone, and an approval granted for
    ///      a marketplace listing should not be a way to do it.
    function _mayBurn(Item storage item, address from, uint256 id) private view returns (bool) {
        if (isBurnerFor[msg.sender][id]) return true;
        if (msg.sender == from) return true;
        return item.transferable && isApprovedForAll(from, msg.sender);
    }

    function _requireMinter() private view {
        if (!isMinter[msg.sender] && msg.sender != owner()) revert NotMinter(msg.sender);
    }

    /// @dev Guards against a mint to a droid id that does not exist — a typo in a drop list would
    ///      otherwise send items to a derived address nobody controls.
    function _requireDroidExists(uint256 droidId) private view {
        if (_droidHolder(droidId) == address(0)) revert NoSuchDroid(droidId);
    }

    /// @dev Renouncing ownership would leave the collection with no one able to create items, seal
    ///      supplies or upgrade. {freezeUpgrades} is the deliberate way to give up power here.
    function renounceOwnership() public pure override(OwnableUpgradeable) {
        revert("LMNT: ownership cannot be renounced");
    }
}
