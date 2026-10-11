-- Droidz Survival, 11.10.2026 — a run's ACTIVE time (owner: «когда игра в паузе, мы не считаем его
-- плейтайм — плейтайм только активной игры»).
--
-- The game sends `activeMs` (its own clock, which stands in the pause, a level-up pick and a hidden
-- tab) with every pulse and the finish; the site stores it here, capped by the server's own wall
-- clock since the run opened. The board's TIME and the panel's playtime read it; runs from before
-- have none and keep showing server_duration_ms (wall time, pauses included).
alter table public.survival_runs add column if not exists active_ms integer;
comment on column public.survival_runs.active_ms is
    'Active play time, ms (the game clock; pauses, picks and hidden tabs excluded), capped by the server wall clock. Null before 11.10.2026.';
