-- Droidz Survival, 29.09.2026 — the journal does not grow forever.
--
-- survival_events had no delete of any kind (only the QA scripts removed their own lines), and
-- /api/survival/log takes lines from the game. The log route now caps a wallet at 120 lines an
-- hour and anonymous callers at 200 an hour across all instances, with small bodies — this is the
-- other half: old low-value lines leave on their own.
--
-- Kept for good: every pay.* line (the payment audit) and every error. Debug/info go after 30
-- days, warnings after 60 — the owner reads the telemetry for balance, so agree the numbers
-- with him before applying. APPLY ONLY WITH THE OWNER'S WORD (pg_cron runs a delete on prod).

create extension if not exists pg_cron;

select cron.schedule(
    'survival_events_retention',
    '17 3 * * *',
    $$delete from public.survival_events
      where kind not like 'pay.%'
        and ((level in ('debug', 'info') and at < now() - interval '30 days')
          or (level = 'warn' and at < now() - interval '60 days'))$$
);
