// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC721Ownership {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title DroidLockRegistry
/// @notice Permanent, self-service lock registry for the ApeDroidz collection.
///
/// @dev This contract is deliberately minimal and final:
///      - it has no owner, no admin role and no privileged caller of any kind;
///      - it has no unlock function, and no function that can ever clear a lock;
///      - it is not a proxy and holds no upgrade path;
///      - it never takes custody of a droid. The token stays in the holder's wallet.
///
///      A lock is a permanent, on-chain record that the holder gave up the right to
///      move token `tokenId` ever again. Enforcement lives in the transfer validator
///      (see DroidzTransferValidator); this registry is the record of truth, and the
///      record survives any future change of validator.
contract DroidLockRegistry {
    struct Lock {
        address owner; // holder at the moment of locking; zero when never locked
        uint64 lockedAt; // block timestamp of the lock
    }

    /// @notice The ApeDroidz ERC-721 collection this registry is bound to.
    IERC721Ownership public immutable collection;

    /// @notice Must be passed to every locking call as an explicit, deliberate acknowledgement.
    /// @dev Computed at compile time so the preimage is always auditable from the source.
    bytes32 public constant ACKNOWLEDGEMENT = keccak256("I UNDERSTAND THIS LOCK IS PERMANENT AND CAN NEVER BE UNDONE");

    /// @dev Locks by token id.
    mapping(uint256 tokenId => Lock) private _locks;
    /// @dev Token ids locked by a given wallet, in locking order. Append-only.
    mapping(address owner => uint256[] tokenIds) private _lockedTokensOf;
    /// @dev Every locked token id, in locking order. Append-only.
    uint256[] private _allLocked;

    error BadAcknowledgement();
    error NotTokenOwner(uint256 tokenId, address caller, address actualOwner);
    error AlreadyLocked(uint256 tokenId);
    error EmptyBatch();

    /// @notice Emitted once per token, the first and only time it is locked.
    event DroidLockedForever(uint256 indexed tokenId, address indexed owner, uint64 lockedAt);

    constructor(address collection_) {
        require(collection_ != address(0), "collection is zero");
        require(collection_.code.length > 0, "collection has no code");
        collection = IERC721Ownership(collection_);
    }

    /// @notice Permanently lock a single droid you own. This can never be undone.
    /// @param tokenId The droid to lock forever.
    /// @param acknowledgement Must equal {ACKNOWLEDGEMENT}.
    function lockForever(uint256 tokenId, bytes32 acknowledgement) external {
        if (acknowledgement != ACKNOWLEDGEMENT) revert BadAcknowledgement();
        _lock(tokenId);
    }

    /// @notice Permanently lock several droids you own in one transaction. This can never be undone.
    /// @param tokenIds The droids to lock forever.
    /// @param acknowledgement Must equal {ACKNOWLEDGEMENT}.
    function lockForeverBatch(uint256[] calldata tokenIds, bytes32 acknowledgement) external {
        if (acknowledgement != ACKNOWLEDGEMENT) revert BadAcknowledgement();
        if (tokenIds.length == 0) revert EmptyBatch();
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            _lock(tokenIds[i]);
        }
    }

    function _lock(uint256 tokenId) private {
        if (_locks[tokenId].owner != address(0)) revert AlreadyLocked(tokenId);

        address holder = collection.ownerOf(tokenId);
        if (holder != msg.sender) revert NotTokenOwner(tokenId, msg.sender, holder);

        uint64 timestamp = uint64(block.timestamp);
        _locks[tokenId] = Lock({owner: holder, lockedAt: timestamp});
        _lockedTokensOf[holder].push(tokenId);
        _allLocked.push(tokenId);

        emit DroidLockedForever(tokenId, holder, timestamp);
    }

    /// @notice Whether a droid has been permanently locked.
    function isLocked(uint256 tokenId) public view returns (bool) {
        return _locks[tokenId].owner != address(0);
    }

    /// @notice Alias of {isLocked}, matching the ERC-5192 accessor name.
    /// @dev The ApeDroidz contract itself is a non-upgradeable EIP-1167 clone and can never
    ///      implement ERC-5192, so this registry cannot make the collection formally soulbound
    ///      in the eyes of a marketplace. This alias exists for integrators that expect the name.
    function locked(uint256 tokenId) external view returns (bool) {
        return isLocked(tokenId);
    }

    /// @notice The wallet that locked a droid, or the zero address if it was never locked.
    function lockOwnerOf(uint256 tokenId) external view returns (address) {
        return _locks[tokenId].owner;
    }

    /// @notice The timestamp a droid was locked at, or zero if it was never locked.
    function lockedAt(uint256 tokenId) external view returns (uint64) {
        return _locks[tokenId].lockedAt;
    }

    /// @notice Full lock record for a droid.
    function lockOf(uint256 tokenId) external view returns (Lock memory) {
        return _locks[tokenId];
    }

    /// @notice Whether the locking wallet still holds the droid.
    /// @dev Should always be true while the transfer validator is enforcing locks. Reading false
    ///      means the droid moved or was burned anyway; downstream reward logic should treat such
    ///      a lock as void. Never reverts, including for a burned token whose `ownerOf` throws.
    function isStillHeld(uint256 tokenId) external view returns (bool) {
        address lockedOwner = _locks[tokenId].owner;
        if (lockedOwner == address(0)) return false;

        try collection.ownerOf(tokenId) returns (address currentOwner) {
            return currentOwner == lockedOwner;
        } catch {
            return false; // burned, or otherwise no longer a live token
        }
    }

    /// @notice How many droids a wallet has permanently locked.
    function lockCountOf(address owner) external view returns (uint256) {
        return _lockedTokensOf[owner].length;
    }

    /// @notice Every droid a wallet has permanently locked, in locking order.
    function lockedTokensOf(address owner) external view returns (uint256[] memory) {
        return _lockedTokensOf[owner];
    }

    /// @notice Total number of permanently locked droids.
    function totalLocked() external view returns (uint256) {
        return _allLocked.length;
    }

    /// @notice Paginated view over every locked droid, in locking order.
    /// @param start Index to start from.
    /// @param count Maximum number of ids to return; the result is clamped to the end of the list.
    function lockedTokens(uint256 start, uint256 count) external view returns (uint256[] memory ids) {
        uint256 total = _allLocked.length;
        if (start >= total) return new uint256[](0);
        uint256 end = start + count;
        if (end > total) end = total;
        ids = new uint256[](end - start);
        for (uint256 i = 0; i < ids.length; ++i) {
            ids[i] = _allLocked[start + i];
        }
    }
}
