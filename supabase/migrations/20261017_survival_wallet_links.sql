-- Droidz Survival — one account, several wallets (owner, 17.10.2026).
--
-- The Otherside Hub signs a player in with their Glyph wallet; the season pass was often bought
-- with MetaMask. Otherside knows the two belong together (Privy), we do not — and a list of
-- «my wallets» from the browser cannot be believed. So a link takes BOTH wallets' word: the game,
-- signed in with one wallet, makes a code (api/survival/link/code); the other wallet, signed in on
-- the site, redeems it (api/survival/link/redeem) and chooses whose progress stays.
--
-- The model: an ACCOUNT is its main wallet. A linked wallet points at it
-- (survival_wallet_links.wallet → account), and every survival call made with a linked wallet's
-- session acts as the account (lib/survivalAccount.ts, through authCaller): one save, one pass, one
-- place on the board. Choosing «whose progress stays» is choosing the main wallet; the other one's
-- save is not touched — it simply stops being read, and comes back if that wallet is unlinked.
-- The purchases (survival_entitlements) move to the main wallet at the link: the pass follows the
-- account, and stays with it after an unlink (no handing a pass from person to person).
--
-- Limits: 3 wallets per account (the main one counted); a wallet unlinked from an account may join
-- one again only after 7 days. Additive: three tables, two functions.

create table if not exists survival_wallet_links (
    wallet     text primary key check (wallet = lower(wallet)),
    account    text not null check (account = lower(account) and account <> wallet),
    linked_at  timestamptz not null default now()
);
create index if not exists survival_wallet_links_account on survival_wallet_links (account);
alter table survival_wallet_links enable row level security;

create table if not exists survival_wallet_unlinks (
    id           bigserial primary key,
    wallet       text not null,
    account      text not null,
    unlinked_at  timestamptz not null default now()
);
create index if not exists survival_wallet_unlinks_wallet on survival_wallet_unlinks (wallet, unlinked_at desc);
alter table survival_wallet_unlinks enable row level security;

-- A code lives 10 minutes and is used once. `wallet` is the session wallet that made it (as signed
-- in, not resolved — the server resolves at redeem time).
create table if not exists survival_link_codes (
    code        text primary key,
    wallet      text not null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null default now() + interval '10 minutes',
    used_at     timestamptz,
    used_by     text
);
create index if not exists survival_link_codes_wallet on survival_link_codes (wallet, created_at desc);
alter table survival_link_codes enable row level security;

/**
 * Redeem a code: the code's wallet and the redeeming wallet become one account, `p_keep` (one of
 * the two accounts' main wallets) the main one. All or nothing, under a lock on the code row.
 * Returns a state: 'ok' | 'bad_code' | 'expired' | 'used' | 'same_wallet' | 'same_account' |
 * 'both_grouped' | 'full' | 'cooldown' | 'bad_keep'.
 */
create or replace function survival_link_redeem(p_code text, p_redeemer text, p_keep text, p_max int default 3)
returns text
language plpgsql as $$
declare
    c         survival_link_codes%rowtype;
    a_wallet  text;
    b_wallet  text := lower(p_redeemer);
    acc_a     text;
    acc_b     text;
    keep      text := lower(p_keep);
    drop_acc  text;
    n_a       int;
    n_b       int;
begin
    select * into c from survival_link_codes where code = upper(p_code) for update;
    if not found then return 'bad_code'; end if;
    if c.used_at is not null then return 'used'; end if;
    if c.expires_at < now() then return 'expired'; end if;
    a_wallet := lower(c.wallet);
    if a_wallet = b_wallet then return 'same_wallet'; end if;

    acc_a := coalesce((select account from survival_wallet_links where wallet = a_wallet), a_wallet);
    acc_b := coalesce((select account from survival_wallet_links where wallet = b_wallet), b_wallet);
    if acc_a = acc_b then return 'same_account'; end if;

    n_a := 1 + (select count(*) from survival_wallet_links where account = acc_a);
    n_b := 1 + (select count(*) from survival_wallet_links where account = acc_b);
    if n_a > 1 and n_b > 1 then return 'both_grouped'; end if;
    if n_a + n_b > p_max then return 'full'; end if;
    if keep <> acc_a and keep <> acc_b then return 'bad_keep'; end if;

    -- A wallet JOINING (a side that is a single wallet — when both are, either) must not have left
    -- an account in the last 7 days.
    if exists (
        select 1 from survival_wallet_unlinks
        where ((n_a = 1 and wallet = a_wallet) or (n_b = 1 and wallet = b_wallet))
          and unlinked_at > now() - interval '7 days'
    ) then return 'cooldown'; end if;

    drop_acc := case when keep = acc_a then acc_b else acc_a end;

    -- Everyone in the dropped account (its main wallet and its links) now points at `keep`.
    update survival_wallet_links set account = keep where account = drop_acc;
    insert into survival_wallet_links (wallet, account) values (drop_acc, keep)
        on conflict (wallet) do update set account = excluded.account, linked_at = now();
    -- `keep` itself is a main wallet now, never a link.
    delete from survival_wallet_links where wallet = keep;

    -- Purchases follow the account (the FK wants a players row for `keep`; it has one if it ever played).
    insert into survival_players (wallet) values (keep) on conflict (wallet) do nothing;
    update survival_entitlements set wallet = keep
        where wallet = drop_acc or wallet in (select wallet from survival_wallet_links where account = keep);

    update survival_link_codes set used_at = now(), used_by = b_wallet where code = c.code;
    return 'ok';
end $$;

/** Unlink `p_wallet` from the account `p_account` (the caller's). Its purchases stay with the account. */
create or replace function survival_link_remove(p_account text, p_wallet text)
returns text
language plpgsql as $$
begin
    delete from survival_wallet_links where wallet = lower(p_wallet) and account = lower(p_account);
    if not found then return 'not_linked'; end if;
    insert into survival_wallet_unlinks (wallet, account) values (lower(p_wallet), lower(p_account));
    return 'ok';
end $$;

-- Server only (the service role, api/survival/link/*): through the public API key anyone could
-- otherwise unlink any wallet or redeem a code in another wallet's name.
revoke all on function survival_link_redeem(text, text, text, int) from public, anon, authenticated;
revoke all on function survival_link_remove(text, text) from public, anon, authenticated;
