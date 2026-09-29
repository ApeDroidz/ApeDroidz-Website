-- Droidz Survival — NFT prizes of the season's PRIZE POOL (28.09.2026, owner: «в прайз пул разместить
-- окошки, куда я добавлю ещё другие NFT, и в сплитпанели — возможность добавлять призы именно сюда, по
-- принципу, как в лаки тикет»).
--
-- Each row is one token in the prize vault (the vault Glitch Cards and the lucky ticket pay from),
-- promised to a PLACE on the season's board (among the pass holders who share the pool). An optional
-- `unlock_level` ties it to the pool's level (config/season.ts milestones): the prize shows locked
-- until the pool reaches that level — the levels open prizes, not only count APE. Null = from the start.
-- The season pays them at its end: `awarded` names the winner, `sent` carries the transfer.
-- A token is never promised twice: not while Glitch Cards or the lucky ticket holds it (a trigger
-- here), and the ticket side refuses a token listed here (its trigger, redefined below).

create table if not exists survival_pool_prizes (
    id           bigserial primary key,
    season_id    text not null,
    place        int not null check (place between 1 and 1000),
    unlock_level int check (unlock_level between 1 and 100),
    contract     text not null check (contract ~ '^0x[0-9a-f]{40}$'),
    token_id     text not null check (token_id ~ '^[0-9]+$'),
    standard     text not null default 'erc721' check (standard in ('erc721','erc1155')),
    name         text,
    image_url    text,
    status       text not null default 'listed' check (status in ('listed','awarded','sent','removed')),
    winner       text,
    tx_hash      text,
    note         text,
    added_at     timestamptz not null default now(),
    sent_at      timestamptz
);
create index if not exists survival_pool_prizes_season on survival_pool_prizes (season_id, place) where status <> 'removed';
-- One ERC-721 token, one live row.
create unique index if not exists survival_pool_prizes_one_721 on survival_pool_prizes (contract, token_id)
    where standard = 'erc721' and status in ('listed','awarded');
alter table survival_pool_prizes enable row level security;

create or replace function survival_pool_prize_not_elsewhere() returns trigger
language plpgsql as $$
begin
    if exists (select 1 from nft_inventory
               where lower(contract_address) = new.contract and token_id = new.token_id and status in ('available','reserved')) then
        raise exception 'token %/% is already a Glitch Cards prize', new.contract, new.token_id;
    end if;
    if exists (select 1 from survival_ticket_nfts
               where contract = new.contract and token_id = new.token_id and status in ('available','reserved','sending')) then
        raise exception 'token %/% is already a lucky ticket prize', new.contract, new.token_id;
    end if;
    return new;
end $$;
drop trigger if exists survival_pool_prize_not_elsewhere on survival_pool_prizes;
create trigger survival_pool_prize_not_elsewhere before insert on survival_pool_prizes
    for each row execute function survival_pool_prize_not_elsewhere();

-- The lucky ticket's guard, now also against the pool's prizes.
create or replace function survival_ticket_nft_not_in_glitch() returns trigger
language plpgsql as $$
begin
    if exists (select 1 from nft_inventory
               where lower(contract_address) = new.contract and token_id = new.token_id and status in ('available','reserved')) then
        raise exception 'token %/% is already a Glitch Cards prize', new.contract, new.token_id;
    end if;
    if exists (select 1 from survival_pool_prizes
               where contract = new.contract and token_id = new.token_id and status in ('listed','awarded')) then
        raise exception 'token %/% is already a prize pool prize', new.contract, new.token_id;
    end if;
    return new;
end $$;
