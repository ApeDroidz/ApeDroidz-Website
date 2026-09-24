-- A timed sale on the price list (owner, 25.09.2026: «скидка на покупку первые 24 часа от поста —
-- на все игры и сундуки сейл 50%»). The list price stays as it is; while now() < sale_until the
-- server charges price × (1 − sale_pct/100) and shows the list price struck through. It ends by
-- itself — nobody has to remember to put the prices back.
alter table survival_catalog add column if not exists sale_pct numeric(5,2) not null default 0
    check (sale_pct >= 0 and sale_pct <= 90);
alter table survival_catalog add column if not exists sale_until timestamptz;
