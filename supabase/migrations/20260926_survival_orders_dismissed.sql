-- Droidz Survival — «Close» for stuck orders in the panel (26.09.2026).
--
-- An order left pending (the player opened the wallet dialog and walked away) used to sit in
-- Payments → Stuck orders and raise the «Orders pending for over 30 minutes» alert until it aged
-- out of the week. The operator can now close it. Closing does NOT touch the status: the order
-- stays 'pending', so if its Paid event does turn up later it is still booked — by the player's
-- next credits check (settlePending) or by «Recheck tx». Money is never refused because of this.
--
-- Additive only.
alter table survival_orders add column if not exists dismissed_at timestamptz;
