-- Dismissed health alerts.
--
-- The Resolve button on an alert has been posting to a table that was never
-- created, so every click returned 500 and no alert could be cleared.
--
-- A dismissal is keyed by alert kind and stamped with the fingerprint the
-- alert had when it was cleared. /api/admin/health recomputes that
-- fingerprint from the alert's payload, so when the underlying facts change
-- — a new error, another wallet — it stops matching and the alert comes back
-- rather than staying silently hidden.

create table if not exists public.health_alert_dismissals (
    kind          text primary key,
    fingerprint   text not null,
    dismissed_at  timestamptz not null default now()
);

comment on table public.health_alert_dismissals is
    'Health alerts an operator marked as resolved. Re-surfaces automatically once the alert fingerprint changes.';

alter table public.health_alert_dismissals enable row level security;
