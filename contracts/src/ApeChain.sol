// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ApeChain
/// @notice The live addresses LMNT is bound to, in one place.
///
/// @dev Three of these — the registry, the account proxy and the salt — decide where every droid's
///      inventory lives, and they are written into the token once at deployment and never again.
///      They are kept here rather than copied into the deploy script and the fork test separately,
///      so that the test which proves the derivation against the live chain is provably checking
///      the same values the deployment will use. Editing one without the other is the mistake this
///      library exists to make impossible.
library ApeChain {
    uint256 internal constant CHAIN_ID = 33139;

    /// @notice The ApeDroidz ERC-721 collection.
    address internal constant DROIDZ = 0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3;

    /// @notice The canonical ERC-6551 registry.
    address internal constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    /// @notice Tokenbound's account proxy. The address derivation hashes over this, so it is the
    ///         one value here that can never change after deployment.
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;

    /// @notice The account logic a freshly deployed inventory proxy is pointed at. Not part of the
    ///         derivation, and the only implementation the proxy's guardian accepts today.
    address internal constant ACCOUNT_LOGIC = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;

    /// @notice The salt the derivation is bound to.
    bytes32 internal constant SALT = bytes32(0);
}
