-- Pool NFT prizes: an awarded prize names a real wallet, a sent one keeps its transfer (29.09.2026).
-- The admin API (/api/admin/survival/pool-prizes) already refuses anything else; these checks hold the
-- table to it even for a hand edit. The table is empty at the time of writing, so adding them is safe;
-- if a row ever breaks them, the ALTER fails and nothing changes.
alter table survival_pool_prizes drop constraint if exists survival_pool_prizes_awarded_has_winner;
alter table survival_pool_prizes add constraint survival_pool_prizes_awarded_has_winner
    check (status <> 'awarded' or winner ~ '^0x[0-9a-f]{40}$');

alter table survival_pool_prizes drop constraint if exists survival_pool_prizes_sent_has_tx;
alter table survival_pool_prizes add constraint survival_pool_prizes_sent_has_tx
    check (status <> 'sent' or (winner ~ '^0x[0-9a-f]{40}$' and tx_hash ~ '^0x[0-9a-f]{64}$' and sent_at is not null));
