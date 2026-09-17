-- Droidz Survival — a clan is added by its NFT contract (18.09.2026).
-- The panel takes a contract address (ApeChain, chain id 33139, or Ethereum) and resolves the
-- collection's OpenSea slug, name and PFP from it; the address and chain are kept on the row so
-- a refresh can re-read OpenSea without the slug. Both columns are nullable: the seeded rows
-- already carry them, a clan added by slug alone may not. Not unique on purpose — OpenSea's
-- shared storefront contract hosts several collections (koda, trenchers).
alter table survival_clans
    add column if not exists contract text,
    add column if not exists chain    text;
comment on column survival_clans.contract is 'NFT contract, lowercase 0x… — the key the panel adds a clan by';
comment on column survival_clans.chain    is 'OpenSea chain name: ape_chain (33139) or ethereum (1)';
create index if not exists survival_clans_contract on survival_clans (chain, contract) where contract is not null;
