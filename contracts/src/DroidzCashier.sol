// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Droidz Survival cashier
/// @notice Takes APE for Droidz Survival (runs, run packs, continues) and splits every payment on
///         the spot: `poolBps` of it to the prize-pool vault of the mode the purchase is for (solo
///         or co-op — each mode builds its own season pool), the rest to the team wallet.
///
/// @dev Deliberately the smallest thing that can do the job. The whole attack surface is `pay`:
///      - it HOLDS NOTHING — `pay` forwards exactly `msg.value` in the same call; there is no
///        balance to steal, sweep or strand, and no function that moves anything else;
///      - it has NO OWNER, no setters, no upgrade path, no storage — the vaults, the team wallet
///        and the split are immutables fixed at deploy. Nobody's key can ever redirect players'
///        money; changing anything means deploying a new cashier and pointing the site at it;
///      - it names the player explicitly. In Otherside the Hub routes paid calls through its own
///        FeeSplitter (a platform fee), and a gas-sponsored call arrives from an ERC-4337 account
///        — `msg.sender` is not the player in either case. The server credits the `player` in
///        the event, and only for an order it created for that player, that mode and at least
///        that price, so paying on someone else's behalf is possible but never pays the payer;
///      - `order` is the server's order id: it ties one payment to one purchase, so a transaction
///        can never be claimed twice or for another item;
///      - a bare transfer (no player, no order, no mode) is refused rather than kept unaccounted.
contract DroidzCashier {
    uint8 public constant SOLO = 0;
    uint8 public constant COOP = 1;

    /// @notice The solo season pool's vault.
    address payable public immutable soloVault;
    /// @notice The co-op season pool's vault.
    address payable public immutable coopVault;
    /// @notice Where the rest of every payment goes.
    address payable public immutable team;
    /// @notice The pool's share of every payment, in basis points (5000 = 50%).
    uint16 public immutable poolBps;

    event Paid(
        address indexed player,
        bytes32 indexed order,
        address indexed payer,
        uint8 mode,
        uint256 amount,
        uint256 toPool
    );

    error BadConfig();
    error NoValue();
    error NoPlayer();
    error NoOrder();
    error BadMode(uint8 mode);
    error TransferFailed(address to);
    error NamePlayer();

    constructor(address payable soloVault_, address payable coopVault_, address payable team_, uint16 poolBps_) {
        if (
            soloVault_ == address(0) || coopVault_ == address(0) || team_ == address(0) || soloVault_ == coopVault_
                || soloVault_ == team_ || coopVault_ == team_ || poolBps_ > 10_000
        ) revert BadConfig();
        soloVault = soloVault_;
        coopVault = coopVault_;
        team = team_;
        poolBps = poolBps_;
    }

    /// @notice Pay for `order` on behalf of `player`, for game `mode` (SOLO or COOP). The whole
    ///         `msg.value` is split and forwarded in this call.
    function pay(address player, bytes32 order, uint8 mode) external payable {
        if (msg.value == 0) revert NoValue();
        if (player == address(0)) revert NoPlayer();
        if (order == bytes32(0)) revert NoOrder();
        address payable vault = _vault(mode);
        uint256 toPool = msg.value * poolBps / 10_000;
        emit Paid(player, order, msg.sender, mode, msg.value, toPool);
        _send(vault, toPool);
        _send(team, msg.value - toPool);
    }

    /// @dev A bare transfer could never be credited to anyone. Refuse it.
    receive() external payable {
        revert NamePlayer();
    }

    /// @dev Anything but `pay` — refuse, never keep.
    fallback() external payable {
        revert NamePlayer();
    }

    /// @dev The pool vault for a mode; any other mode is refused.
    function _vault(uint8 mode) private view returns (address payable) {
        if (mode == SOLO) return soloVault;
        if (mode == COOP) return coopVault;
        revert BadMode(mode);
    }

    function _send(address payable to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to);
    }
}
