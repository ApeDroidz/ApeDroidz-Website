-- Себестоимость призовых NFT.
--
-- Цена, по которой NFT достался нам: последняя продажа перед переездом в
-- призовой волт, либо прямая покупка. По ней считается, во что обошлась
-- выдача приза, и уже от этого — профит Glitch Cards.
--
-- Батарейки и шарды мы выпускаем сами, у них себестоимости в этом смысле
-- нет — там колонка так и остаётся NULL, и в расчёт они не попадают.

alter table public.nft_inventory
    add column if not exists acquisition_ape numeric(20, 4);

comment on column public.nft_inventory.acquisition_ape is
    'Во сколько APE обошёлся нам этот NFT. NULL для самостоятельно выпущенных (батарейки, шарды) и для позиций, где цена ещё не проставлена.';

-- Профит считается выборкой по выданным позициям, поэтому индекс по статусу
-- и категории: без него это full scan по всей таблице инвентаря.
create index if not exists nft_inventory_status_prize_idx
    on public.nft_inventory (status, prize_type_id);
