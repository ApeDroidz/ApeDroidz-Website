-- The tank hero was `giza` in the game's code until 19.09.2026; the owner: «везде используем
-- имя Geez». The client now sends `geez` (and migrates its own saves); this brings the rows the
-- old client wrote in line, so the admin panel and the board read one name. Apply together with
-- the game build that sends `geez` — before it, new runs would still arrive as `giza`.
update survival_runs      set hero          = 'geez' where hero          = 'giza';
update survival_profiles  set selected_hero = 'geez' where selected_hero = 'giza';
