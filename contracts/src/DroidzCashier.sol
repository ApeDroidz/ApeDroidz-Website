// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Droidz Survival cashier
/// @notice Takes APE for Droidz Survival (runs, continues, run packs) and splits every payment on
///         the spot: `poolBps` of it to the season prize-pool wallet, the rest to the treasury.
///
/// @dev Deliberately the smallest thing that can do the job:
///      - it HOLDS NOTHING — each payment is forwarded in the same call, so there is no balance to
///        steal, sweep or strand;
///      - it has NO OWNER and no setters — recipients and the split are fixed at deploy; changing
///        them means deploying a new cashier and pointing the site at it. Nobody's key can ever
///        redirect players' money, so there is no key-custody question to answer;
///      - it names the player explicitly. In Otherside the Hub routes paid calls through its own
///        FeeSplitter (a 1.5% platform fee), and a gas-sponsored call arrives from an ERC-4337
///        account — `msg.sender` is not the player in either case. The server credits the
///        `player` in the event, and only for an order it created for that same player, so paying
///        on someone else's behalf is possible but never pays the payer.
///      - `order` is the server's order id: it ties the payment to exactly one purchase (what,
///        how much, for whom), so one transaction can never be claimed twice or for another item.
contract DroidzCashier {
    /// @notice Where the prize-pool share goes. Distributed to the season's leaderboard.
    address payable public immutable pool;
    /// @notice Where the rest goes.
    address payable public immutable treasury;
    /// @notice The pool's share of every payment, in basis points (5000 = 50%).
    uint16 public immutable poolBps;

    event Paid(
        address indexed player, bytes32 indexed order, address indexed payer, uint256 amount, uint256 toPool
    );

    error BadConfig();
    error NoValue();
    error NoPlayer();
    error TransferFailed(address to);
    error NamePlayer();

    constructor(address payable pool_, address payable treasury_, uint16 poolBps_) {
        if (pool_ == address(0) || treasury_ == address(0) || pool_ == treasury_ || poolBps_ > 10_000) {
            revert BadConfig();
        }
        pool = pool_;
        treasury = treasury_;
        poolBps = poolBps_;
    }

    /// @notice Pay for `order` on behalf of `player`. The whole `msg.value` is split and forwarded.
    function pay(address player, bytes32 order) external payable {
        if (msg.value == 0) revert NoValue();
        if (player == address(0)) revert NoPlayer();
        uint256 toPool = msg.value * poolBps / 10_000;
        emit Paid(player, order, msg.sender, msg.value, toPool);
        _send(pool, toPool);
        _send(treasury, msg.value - toPool);
    }

    /// @dev A bare transfer has no player and no order — it could never be credited. Refuse it
    ///      rather than keep money nobody can account for.
    receive() external payable {
        revert NamePlayer();
    }

    function _send(address payable to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed(to);
    }
}
