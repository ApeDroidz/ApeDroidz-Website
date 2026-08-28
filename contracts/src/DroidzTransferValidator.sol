// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DroidLockRegistry} from "./DroidLockRegistry.sol";

/// @dev The subset of Limit Break's CreatorTokenTransferValidator (V3) this validator reads.
///      Both accessors take the collection as an explicit argument, so they resolve the real
///      ApeDroidz policy correctly even though the caller is this contract rather than the token.
interface ILimitBreakBlacklist {
    function isAccountBlacklistedByCollection(address collection, address account) external view returns (bool);
    function isCodeHashBlacklistedByCollection(address collection, bytes32 codehash) external view returns (bool);
}

/// @title DroidzTransferValidator
/// @notice The ERC721-C transfer validator for ApeDroidz. It enforces permanent locks recorded in
///         {DroidLockRegistry} and otherwise reproduces the collection's existing transfer policy.
///
/// @dev The ApeDroidz token contract (an EIP-1167 clone of BleverErc721C) calls
///      `validateTransfer(caller, from, to, tokenId)` from `_beforeTokenTransfer` on every transfer.
///      Reverting here blocks the transfer at the token contract level, so a locked droid cannot be
///      moved by its owner, by an approved operator, or by any marketplace.
///
///      Policy reproduced for unlocked droids, matching ApeDroidz's live configuration on the
///      canonical Limit Break validator (transferSecurityLevel = 2, listId = 1):
///        - caller == from (a direct owner-to-owner transfer) is always allowed;
///        - any other caller is allowed unless its address or its code hash is blacklisted.
///      Receiver constraints, whitelist constraints and account freezing are all inactive at
///      level 2 and are therefore not reproduced.
///
///      One deliberate divergence: Limit Break lets a registered authorizer pre-authorise a single
///      transfer that would otherwise be blocked. That authorisation is transient state inside the
///      Limit Break validator and is not externally readable, so it is not mirrored here. It only
///      ever *permits* a transfer the blacklist would block, and the ApeDroidz blacklist is empty,
///      so today this changes nothing. Adding blacklist entries later would forgo the bypass.
///
///      This contract holds no state, has no owner and no admin functions. Replacing it is done by
///      the collection owner calling `setTransferValidator` on the token contract.
contract DroidzTransferValidator {
    /// @notice The ApeDroidz collection this validator serves.
    address public immutable collection;
    /// @notice The permanent lock registry consulted on every transfer.
    DroidLockRegistry public immutable lockRegistry;
    /// @notice Limit Break's CreatorTokenTransferValidator, read for blacklist state.
    ILimitBreakBlacklist public immutable limitBreakValidator;

    error TokenPermanentlyLocked(uint256 tokenId);
    error OperatorIsBlacklisted(address operator);

    constructor(address collection_, address lockRegistry_, address limitBreakValidator_) {
        require(collection_ != address(0), "collection is zero");
        require(lockRegistry_ != address(0), "registry is zero");
        require(limitBreakValidator_ != address(0), "limit break validator is zero");
        require(
            address(DroidLockRegistry(lockRegistry_).collection()) == collection_,
            "registry bound to another collection"
        );

        collection = collection_;
        lockRegistry = DroidLockRegistry(lockRegistry_);
        limitBreakValidator = ILimitBreakBlacklist(limitBreakValidator_);
    }

    /// @notice The validation entry point used by ApeDroidz on every ERC-721 transfer.
    /// @dev Reverts when the droid is permanently locked, or when the operator is blacklisted.
    function validateTransfer(address caller, address from, address to, uint256 tokenId) public view {
        if (lockRegistry.isLocked(tokenId)) revert TokenPermanentlyLocked(tokenId);
        _applyCallerPolicy(caller, from);
        to; // receiver constraints are inactive at transfer security level 2
    }

    /// @notice ERC-1155 style overload, present for interface completeness.
    function validateTransfer(address caller, address from, address to, uint256 tokenId, uint256 amount) external view {
        amount;
        validateTransfer(caller, from, to, tokenId);
    }

    /// @notice ERC-20 style overload, present for interface completeness.
    function validateTransfer(address caller, address from, address to) public view {
        _applyCallerPolicy(caller, from);
        to;
    }

    /// @notice Legacy Limit Break entry point, present for interface completeness.
    function applyCollectionTransferPolicy(address caller, address from, address to) external view {
        validateTransfer(caller, from, to);
    }

    /// @notice Advertises the validation function for marketplace transaction simulation.
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        functionSignature = bytes4(keccak256("validateTransfer(address,address,address,uint256)"));
        isViewFunction = true;
    }

    /// @notice Accepted as a no-op so the token's `_registerTokenType` call succeeds silently.
    /// @dev The token wraps this call in try/catch, but accepting it keeps the trace clean.
    function setTokenTypeOfCollection(address collection_, uint16 tokenType) external pure {
        collection_;
        tokenType;
    }

    /* ------------------------------------------------------------------------------------------
     * Authorized transfer hooks
     *
     * OpenSea's SignedZone reads a registry address out of a signed order's extraData and calls
     * these on it around a sale (see SignedZoneV16Royalty, `extraData[126:146]`). Once this contract
     * is the collection's validator, that address is this contract, so these must exist or every
     * royalty-enforced OpenSea sale of an ApeDroid would revert.
     *
     * On the canonical validator these set transient state that lets an authorizer waive the
     * operator policy. This validator has no such state and waives nothing: a permanently locked
     * droid must stay unsellable even through an authorised marketplace flow. Where the hook carries
     * a token id we reject a locked droid right here, so the marketplace sees the order fail during
     * validation rather than only at settlement.
     * ---------------------------------------------------------------------------------------- */

    function beforeAuthorizedTransfer(address, address) external pure {}

    function afterAuthorizedTransfer(address) external pure {}

    function beforeAuthorizedTransfer(address token, uint256 tokenId) external view {
        _rejectLocked(token, tokenId);
    }

    function afterAuthorizedTransfer(address, uint256) external pure {}

    function beforeAuthorizedTransfer(address, address token, uint256 tokenId) external view {
        _rejectLocked(token, tokenId);
    }

    function beforeAuthorizedTransferWithAmount(address token, uint256 tokenId, uint256) external view {
        _rejectLocked(token, tokenId);
    }

    function afterAuthorizedTransferWithAmount(address, uint256) external pure {}

    function _rejectLocked(address token, uint256 tokenId) private view {
        if (token != collection) return; // the zone is generic; ignore other collections
        if (lockRegistry.isLocked(tokenId)) revert TokenPermanentlyLocked(tokenId);
    }

    /// @notice Answers any unrecognised call by asking the canonical Limit Break validator.
    ///
    /// @dev Marketplaces query a validator for more than ITransferValidator — security policy, list
    ///      membership, interface support — and the exact surface differs per integrator. A revert
    ///      on one of those reads can make a venue treat the collection as unsupported. Rather than
    ///      guess which ones matter, anything not implemented above is forwarded to the canonical
    ///      validator, which still holds ApeDroidz's real policy (level 2, list 1).
    ///
    ///      The forward is a staticcall, so it can never mutate state, and it can never affect
    ///      enforcement: every function that decides a transfer is implemented above and is matched
    ///      before the fallback is ever reached.
    fallback(bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = address(limitBreakValidator).staticcall(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }

    /// @dev Reproduces CALLER_CONSTRAINTS_OPERATOR_BLACKLIST_ENABLE_OTC.
    function _applyCallerPolicy(address caller, address from) private view {
        if (caller == from) return; // owner-to-owner transfers bypass operator constraints

        if (limitBreakValidator.isAccountBlacklistedByCollection(collection, caller)) {
            revert OperatorIsBlacklisted(caller);
        }

        if (caller.code.length > 0) {
            if (limitBreakValidator.isCodeHashBlacklistedByCollection(collection, caller.codehash)) {
                revert OperatorIsBlacklisted(caller);
            }
        }
    }
}
