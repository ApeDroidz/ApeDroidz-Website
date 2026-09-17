-- Droidz Survival — the player's clan (17.09.2026). Cosmetic: a community flag the player
-- picks in the game's PLAY screen; it rides with every run ticket so a season board can be
-- cut by community. Free text, validated by the route against the game's list; nothing that
-- counts money reads it.
alter table survival_players add column if not exists clan text;
