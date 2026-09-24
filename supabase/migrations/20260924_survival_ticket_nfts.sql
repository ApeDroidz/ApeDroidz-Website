-- Droidz Survival — NFT prizes in the lucky ticket, added by link like Glitch Cards (24.09.2026,
-- owner: «добавление призов как в глитч кардс, когда вбиваю ссылкой; дроида и другие NFT выдавать ок»).
--
-- Each row is one token sitting in the prize vault (the same vault Glitch Cards pays from,
-- PRIZE_VAULT_PRIVATE_KEY). A ticket prize of kind 'nft' drops only while it has an available token;
-- the draw reserves one for the winner and the server sends it from the vault (lib/survivalTicketNft.ts).
-- A token can never be a prize in both games at once: a trigger refuses it here while Glitch Cards
-- holds it as available/reserved, and the Glitch Cards import skips tokens held here.

create table if not exists survival_ticket_nfts (
    id           bigserial primary key,
    prize_id     text not null references survival_ticket_prizes (id),
    contract     text not null check (contract ~ '^0x[0-9a-f]{40}$'),
    token_id     text not null check (token_id ~ '^[0-9]+$'),
    standard     text not null default 'erc721' check (standard in ('erc721','erc1155')),
    name         text,
    image_url    text,
    status       text not null default 'available' check (status in ('available','reserved','sending','sent','failed','removed')),
    winner       text,
    entitlement_id uuid references survival_entitlements (id),
    tx_hash      text,
    error        text,
    added_at     timestamptz not null default now(),
    sent_at      timestamptz
);
create index if not exists survival_ticket_nfts_pool on survival_ticket_nfts (prize_id) where status = 'available';
-- One ERC-721 token, one live row.
create unique index if not exists survival_ticket_nfts_one_721 on survival_ticket_nfts (contract, token_id)
    where standard = 'erc721' and status in ('available','reserved','sending');
alter table survival_ticket_nfts enable row level security;

create or replace function survival_ticket_nft_not_in_glitch() returns trigger
language plpgsql as $$
begin
    if exists (select 1 from nft_inventory
               where lower(contract_address) = new.contract and token_id = new.token_id and status in ('available','reserved')) then
        raise exception 'token %/% is already a Glitch Cards prize', new.contract, new.token_id;
    end if;
    return new;
end $$;
drop trigger if exists survival_ticket_nft_not_in_glitch on survival_ticket_nfts;
create trigger survival_ticket_nft_not_in_glitch before insert on survival_ticket_nfts
    for each row execute function survival_ticket_nft_not_in_glitch();

-- NFT prizes drop by their pool, not a stock number.
update survival_ticket_prizes set stock = null where kind = 'nft';

create or replace function survival_ticket_draw() returns survival_ticket_prizes
language plpgsql as $$
declare
    total int;
    pick  int;
    p     survival_ticket_prizes%rowtype;
begin
    select coalesce(sum(t.weight), 0) into total from survival_ticket_prizes t
        where t.active and t.weight > 0 and (t.stock is null or t.stock > 0)
          and (t.kind <> 'nft' or exists (select 1 from survival_ticket_nfts n where n.prize_id = t.id and n.status = 'available'));
    if total = 0 then return null; end if;
    pick := floor(random() * total)::int;
    for p in select t.* from survival_ticket_prizes t
             where t.active and t.weight > 0 and (t.stock is null or t.stock > 0)
               and (t.kind <> 'nft' or exists (select 1 from survival_ticket_nfts n where n.prize_id = t.id and n.status = 'available'))
             order by t.sort, t.id for update of t loop
        pick := pick - p.weight;
        if pick < 0 then
            if p.stock is not null then update survival_ticket_prizes set stock = stock - 1 where id = p.id; end if;
            return p;
        end if;
    end loop;
    return null;
end $$;
revoke all on function survival_ticket_draw() from public, anon, authenticated;

-- Booking v5: as v4; an NFT prize reserves one token from its pool for the winner, and the
-- entitlement carries which one.
create or replace function survival_settle_order(
    p_order uuid, p_wallet text, p_tx text, p_paid_wei numeric, p_to_pool_wei numeric, p_block bigint,
    p_platform text, p_mode text, p_payer text, p_via_hub boolean
) returns text
language plpgsql as $$
declare
    o survival_orders%rowtype;
    pay_id uuid;
    floor_wei numeric;
    prize survival_ticket_prizes%rowtype;
    runs int;
    nft survival_ticket_nfts%rowtype;
    ent_id uuid;
    prize_json jsonb;
begin
    select * into o from survival_orders where id = p_order for update;
    if not found or o.wallet <> p_wallet then return 'no_order'; end if;
    if o.status = 'paid' then
        return case when o.tx_hash = p_tx then 'paid' else 'used' end;
    end if;
    if o.mode <> p_mode then return 'wrong_mode'; end if;
    floor_wei := case when p_via_hub then trunc(o.min_wei * 9000 / 10000) else o.min_wei end;
    if p_paid_wei < floor_wei then return 'underpaid'; end if;
    if exists (select 1 from survival_payments where tx_hash = p_tx) then return 'used'; end if;

    update survival_orders set status = 'paid', tx_hash = p_tx, paid_wei = p_paid_wei, paid_at = now() where id = p_order;
    insert into survival_payments (tx_hash, wallet, season_id, amount_ape, block_number, confirmed_at, credits_granted,
                                   order_id, to_pool_ape, platform, mode, payer)
        values (p_tx, p_wallet, o.season_id, round(p_paid_wei / 1e18, 6), p_block, now(), o.credits,
                o.id, round(p_to_pool_wei / 1e18, 6), p_platform, o.mode, p_payer)
        returning id into pay_id;
    if o.kind = 'runs' then
        for i in 1..o.credits loop
            insert into survival_credits (wallet, season_id, payment_id, source, mode)
                values (p_wallet, o.season_id, pay_id, case when p_platform = 'otherside' then 'arcade' else 'purchase' end, o.mode);
        end loop;
    elsif o.kind = 'ticket' then
        prize := survival_ticket_draw();
        if prize.id is null then
            prize.id := 'fallback'; prize.label := '500 Ape Mini'; prize.kind := 'coins'; prize.spec := '{"coins":500}';
        end if;
        prize_json := jsonb_build_object('id', prize.id, 'label', prize.label, 'kind', prize.kind, 'spec', prize.spec);
        if prize.kind = 'runs' then
            runs := greatest(1, least(10, coalesce((prize.spec->>'runs')::int, 1)));
            for i in 1..runs loop
                insert into survival_credits (wallet, season_id, payment_id, source, mode)
                    values (p_wallet, o.season_id, pay_id, 'grant', 'solo');
            end loop;
        elsif prize.kind = 'nft' then
            select * into nft from survival_ticket_nfts where prize_id = prize.id and status = 'available'
                order by added_at, id limit 1 for update skip locked;
            if nft.id is null then
                -- The pool emptied between the draw and here (two tickets at once): the Ape Mini floor.
                prize_json := jsonb_build_object('id', 'fallback', 'label', '500 Ape Mini', 'kind', 'coins', 'spec', '{"coins":500}'::jsonb);
            else
                prize_json := prize_json || jsonb_build_object('nft', jsonb_build_object(
                    'id', nft.id, 'contract', nft.contract, 'tokenId', nft.token_id, 'name', nft.name, 'image', nft.image_url));
                if nft.name is not null then prize_json := jsonb_set(prize_json, '{label}', to_jsonb(nft.name)); end if;
            end if;
        end if;
        insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
            values (p_wallet, o.id, o.sku, 'ticket', jsonb_build_object('prize', prize_json), o.season_id)
            returning id into ent_id;
        if nft.id is not null then
            update survival_ticket_nfts set status = 'reserved', winner = p_wallet, entitlement_id = ent_id where id = nft.id;
        end if;
    else
        insert into survival_entitlements (wallet, order_id, sku, kind, grant_spec, season_id)
            values (p_wallet, o.id, o.sku, o.kind, o.grant_spec, o.season_id);
    end if;
    if p_to_pool_wei > 0 then
        insert into survival_pool_ledger (season_id, bucket, source, amount_ape, ref)
            values (o.season_id, o.mode || '_pool', 'entry', round(p_to_pool_wei / 1e18, 6), p_tx);
    end if;
    return 'paid';
end $$;
revoke all on function survival_settle_order(uuid, text, text, numeric, numeric, bigint, text, text, text, boolean) from public, anon, authenticated;
