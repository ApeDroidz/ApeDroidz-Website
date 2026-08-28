# ApeDroidz — Lifetime Lock

Permanent, self-service locking for the ApeDroidz collection on ApeChain. A holder gives up the
right to ever move a droid again; the droid stays in their wallet, and they qualify for the
freemint on the next collection.

## Why it works this way

ApeDroidz (`0x4e0EDC9bE4d47d414DaF8eD9a6471F41e99577F3`) is an **EIP-1167 minimal proxy** —
a non-upgradeable clone of `BleverErc721C` v1.0.4 at `0x314531A63bc309E819E83DbDd8FB1ea2E511D425`.
The implementation address is baked into the clone's 45 bytes of bytecode and the EIP-1967 slots are
empty, so the token contract itself can never be changed or extended.

What it *does* give us is **ERC721-C**. On every transfer, `_beforeTokenTransfer` reaches
`CreatorTokenBase._preValidateTransfer`, which calls out to an external transfer validator:

```solidity
ITransferValidator(validator).validateTransfer(caller, from, to, tokenId);
```

`setTransferValidator(address)` is owner-gated and accepts any contract with code — the interface is
never checked. So the extension point is the validator, not the token. Reverting inside
`validateTransfer` blocks the transfer at the token level, for the owner, for approved operators and
for every marketplace alike, while `ownerOf` never changes and the droid never leaves the wallet.

Future staking tiers (timed locks, levels) extend this same layer: deploy a new validator, point the
collection at it. The lock registry below is deliberately excluded from that flexibility.

## The two contracts

**`DroidLockRegistry`** — the permanent record. No owner, no admin, no unlock function, no upgrade
path. `lockForever(tokenId, ack)` and `lockForeverBatch(tokenIds, ack)` can only be called by the
current holder, and `ack` must equal `keccak256("I UNDERSTAND THIS LOCK IS PERMANENT AND CAN NEVER BE UNDONE")`
so a lock can never be a stray click. It never takes custody of anything.

**`DroidzTransferValidator`** — the enforcement. Reverts `TokenPermanentlyLocked` for any locked
droid. For everything else it reproduces the collection's live policy on Limit Break's validator
(`transferSecurityLevel = 2`, `listId = 1`): owner-to-owner transfers always pass, any other caller
passes unless its address or code hash is blacklisted. It reads that blacklist from
`0x721C00D4FB075b22a5469e9CF2440697F729aA13` using the `…ByCollection` accessors, which take the
collection as an argument and therefore resolve the real ApeDroidz lists. Stateless, ownerless.

Two details exist purely so no marketplace breaks when we take over the validator slot:

- *Authorized-transfer hooks.* OpenSea's `SignedZoneV16Royalty` reads a registry address out of a
  signed order's `extraData` and calls `beforeAuthorizedTransfer` / `afterAuthorizedTransfer` on it
  around a sale. Once we hold the validator slot that address is us, so those functions must exist
  or every royalty-enforced OpenSea sale would revert. They waive nothing; where the hook carries a
  token id, a locked droid is rejected right there, so the order fails during validation rather than
  at settlement.
- *A read-forwarding fallback.* Integrators query a validator for more than `ITransferValidator`, and
  a revert on some policy read can make a venue treat the collection as unsupported. Anything not
  implemented is forwarded to the canonical validator by staticcall, so unknown reads answer exactly
  as they do today. It cannot affect enforcement — every function that decides a transfer is
  implemented directly and matched before the fallback.

Cost of all this: **~1,600 gas** more per transfer than the canonical validator, measured on
independent forks.

Separating them matters: if the validator is ever replaced, the registry's record of who locked what
survives untouched, and any future validator reads the same registry.

## Runbook

```bash
cd contracts
git clone --depth 1 --branch v1.9.6 https://github.com/foundry-rs/forge-std lib/forge-std
forge test                    # 25 tests, 12 of them forked against live ApeChain

# Step 1 — deploy. Harmless: nothing is wired to the collection yet.
forge script script/Deploy.s.sol --rpc-url apechain --broadcast --verify

# Step 2 — go live. Needs the collection owner key. Changes transfer behaviour for all 3333 droids.
VALIDATOR=0x... forge script script/SetValidator.s.sol --rpc-url apechain --broadcast
```

Do step 2 **before** announcing locking. A lock recorded while the old validator is still installed
is not enforced, and the droid could still be sold.

Snapshot for the freemint, straight from the registry, no indexer involved:

```bash
LOCK_REGISTRY=0x... node scripts/export-locked-droidz.mjs   # → lock-snapshot.csv / .json
```

The CSV is `wallet,locked_count,token_ids`. Locks whose droid is no longer held by the locking wallet
are reported and excluded.

## Known limits — read before launching

**The collection owner can undo enforcement.** `setTransferValidator` stays owner-gated forever, so
whoever holds `0x3C4E3fDb4a8820561a450430f590EA30E1A04954` can swap in a permissive validator and
unlock every droid. For the holder the lock is irreversible; for the project it is not. The only
technical fix is `renounceOwnership()`, which also permanently gives up `setBaseURI`, royalties,
`setSupply`, `setSigner` and any future staking tier. A multisig is the middle ground. Whatever is
chosen, say it plainly to holders rather than claiming an immutability that does not exist.

**Burning bypasses the validator entirely.** `TransferValidation._validateBeforeTransfer` routes
`to == address(0)` to `_preValidateBurn`, which Limit Break leaves empty — the validator is never
consulted. `burnEnabled` is `false` on chain today and `burn()` requires it, so locked droids cannot
be destroyed. Never call `setBurnEnabled(true)`. `SetValidator.s.sol` refuses to run if burning is
enabled, and `test_KNOWN_RISK_enablingBurnLetsALockedDroidBeDestroyed` pins the behaviour.

**Listings are off-chain and cannot be blocked on-chain.** A listing is a signed Seaport order in a
marketplace's database, not state on the token. Nothing in this design can stop one being created:
`approve` and `setApprovalForAll` on `BleverErc721C` are gated only by `tradingEnabledOnly` and never
reach the validator, and only the order's maker can cancel it. What is guaranteed is that the sale
can never settle — and, thanks to the authorized-transfer hooks below, that OpenSea sees the order
fail during validation rather than only at settlement.

The listing hygiene story is therefore off-chain, in three parts:

1. *Gate the lock button.* Query OpenSea's API v2 and Magic Eden's Reservoir-powered v4 `asks`
   endpoint for active listings of the token id. If any exist, refuse to lock and offer a
   one-click cancel that submits `Seaport.cancel(OrderComponents[])` built from the order data the
   APIs return, then re-check before unlocking the button.
2. *Make a locked droid unmistakable in its metadata — without touching `attributes`.*
   `/api/metadata/droidz/` is ours, so a locked droid can be renamed (`ApeDroid #123 — Locked
   Forever`) and say so in `description`. `refreshMetadata()` is public and emits
   `BatchMetadataUpdate`, prompting marketplaces to re-index. Do **not** add a `Lifetime Staked`
   trait: marketplace rarity engines score the `attributes` array, so a trait held by only part of
   the collection would rewrite every droid's rarity rank. `name` and `description` are not scored.
3. *Let order validation do the rest.* Marketplaces periodically re-simulate orders and mark failing
   ones invalid. Ours reverts, so listings should drop out of the feeds — expected, but worth
   confirming against a real locked droid after launch rather than assuming.

**A lost wallet is a lost droid, permanently.** There is no recovery path and no self-transfer
escape hatch — that is the requested behaviour, and the UI has to make it unmistakable.

**One deliberate divergence from Limit Break.** Their validator lets a registered authorizer
pre-authorise a single transfer that the blacklist would otherwise block. That authorisation is
transient internal state and is not externally readable, so it is not mirrored. It only ever permits
a blocked transfer, and the ApeDroidz blacklist is empty, so today this changes nothing — it would
only matter if blacklist entries were added later.

## Which marketplaces this was checked against

OpenSea is not the only venue, so the venues were found rather than assumed. Scanning ~700k blocks of
the collection's `Transfer` logs turned up exactly three contracts moving droids on ApeChain:

| Contract | Address | Role |
|---|---|---|
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` | settlement for OpenSea, Magic Eden and every Reservoir-powered front end |
| RelayRouterV3 | `0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f` | relay.link cross-chain buys |
| RelayApprovalProxyV3 | `0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE` | entry point in front of the above |

Receipts show the Relay pair calling straight through to Seaport
(`RelayApprovalProxyV3 → RelayRouterV3 → Seaport`), so the NFT leg of every known venue is a Seaport
transfer. `test/MarketplaceCompatibility.t.sol` drives each of these addresses — plus the OpenSea
conduit — as the actual caller of `transferFrom` and asserts an unlocked droid still moves and a
locked one does not.

OSWiki launched an ApeChain marketplace in June 2026 but has no ApeDroidz sales yet, so it does not
appear in the logs and its trading contract could not be identified (the contracts deployed by its
badge deployer are treasury and burn splitters, not an exchange).

**That does not weaken the guarantee, because the guarantee is not per-marketplace.** Ownership of an
ERC-721 can only change through the token's own transfer functions, and in `BleverErc721C` every one
of them routes through `_beforeTokenTransfer` into the validator. The venue list above only shows we
did not *break* anyone; `testFuzz_noCallerAnywhereCanMoveALockedDroid` is what shows a locked droid
resists an arbitrary caller holding full operator approval — including venues that do not exist yet.
Burning remains the sole exception, and it is disabled.

## Test coverage

`test/DroidLockRegistry.t.sol` covers the registry against a mock, including a test asserting the ABI
exposes no unlock, owner or upgrade function, so a future edit adding one breaks the suite.

`test/ApeDroidzFork.t.sol` forks ApeChain and runs against the real token, the real owner and the real
Limit Break validator state: that locked droids resist owner transfers, safe transfers, single-token
approvals and operator approvals granted *before* the lock; that unlocked droids still transfer
normally both directly and through an operator; that the OpenSea hooks behave; and that burning is
disabled.

`test/MarketplaceCompatibility.t.sol` covers the venues above, the fallback forwarding, and the
per-transfer gas overhead.

**A method note worth keeping.** An earlier version of the marketplace test replayed historical sale
transactions with `vm.transact`. That approach is invalid: `vm.transact` executes against the original
forked state and silently discards the test's own `setTransferValidator` call, so those sales were
replaying against the canonical validator and proved nothing — they passed for the wrong reason. If
you reach for transaction replay here again, assert that `getTransferValidator()` still points at your
validator *after* the replay before believing any result.
