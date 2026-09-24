-- Droidz Survival — acknowledgements for the panel's «needs a fix» alerts (24.09.2026).
-- An alert is computed from the journal and the tables (api/admin/survival/alerts); marking it
-- done stores its fingerprint here. It comes back by itself if it happens again after the mark.
create table if not exists survival_alert_acks (
    fingerprint text primary key,
    acked_at    timestamptz not null default now(),
    snooze_until timestamptz,
    note        text
);
alter table survival_alert_acks enable row level security; -- service role only
