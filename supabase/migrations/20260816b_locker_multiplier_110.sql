-- Level 2 multiplier changed from 1.20x to 1.10x before launch.
--
-- `locker_locks.multiplier_x100` is guarded by a check constraint listing the multipliers we
-- actually issue, so that a typo can never write a value nobody agreed to. Changing the rate means
-- changing that list.
--
-- Safe to run as-is: no droid has been locked yet, so no stored row carries the old 120. Were any
-- to exist, they would have to stay valid — a holder's credit is frozen at lock time and must not
-- be rewritten by a later rate change — and the constraint would need to allow both values.

do $$
declare
  legacy_rows integer;
begin
  select count(*) into legacy_rows from locker_locks where multiplier_x100 = 120;
  if legacy_rows > 0 then
    raise exception
      'Refusing to drop 120 from the allowed multipliers: % lock(s) were issued at 1.20x. Add 120 back to the constraint so historical credit stays valid.',
      legacy_rows;
  end if;
end $$;

alter table locker_locks drop constraint if exists locker_locks_multiplier_known;

alter table locker_locks
  add constraint locker_locks_multiplier_known
  check (multiplier_x100 in (100, 110, 150));
