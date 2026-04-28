-- ── Health alert dismissals ──────────────────────────────────────────────────
-- Lets the admin mark a health alert as "Resolved" so it stops showing on the
-- panel. Re-shows automatically when the alert's fingerprint changes (e.g. a
-- new error arrives, or a new wallet joins a multi-account flag).
--
-- Schema:
--   kind         — alert kind (e.g. "cards_errors_recent")
--   fingerprint  — sha256 of the alert detail at dismiss time. The health
--                  endpoint recomputes the fingerprint on each load and shows
--                  the alert again if it differs.
--   dismissed_at — when the dismissal happened
--   dismissed_by — free-text marker (admin username if available)
--
-- Primary key is (kind) — only one active dismissal per kind. New dismissal
-- replaces the previous one. To "un-dismiss", simply delete the row.

CREATE TABLE IF NOT EXISTS health_alert_dismissals (
    kind          text PRIMARY KEY,
    fingerprint   text NOT NULL,
    dismissed_at  timestamptz NOT NULL DEFAULT now(),
    dismissed_by  text
);

REVOKE ALL ON TABLE health_alert_dismissals FROM public;
GRANT  ALL ON TABLE health_alert_dismissals TO service_role;
