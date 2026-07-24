-- ============================================================================
-- Per-token display preference for the marketplace previewer (PFP chooser).
--
-- `display_pref` stores which visual variant the holder saved as default on
-- the site dashboard. NULL means "no explicit choice" and the metadata API
-- falls back to the level-based default:
--   level >= 2  -> 'animated'
--   level 1     -> 'pixel'
--
-- Allowed values:
--   'pixel'    - static pixel art (level1 png / level2|super webp)
--   'animated' - animated pixel GIF (level2-gif / super-gif)
--   'pfp3d'    - 3D-rendered PFP (locked until 3D assets ship)
--   'fullbody' - full-body 3D model (locked until 3D assets ship)
-- ============================================================================

ALTER TABLE droidz
    ADD COLUMN IF NOT EXISTS display_pref text
    CHECK (display_pref IN ('pixel', 'animated', 'pfp3d', 'fullbody'));

ALTER TABLE droidz
    ADD COLUMN IF NOT EXISTS display_pref_updated_at timestamptz;

COMMENT ON COLUMN droidz.display_pref IS
    'Holder-saved default view for marketplace previewer; NULL = level-based default (L2+ animated, L1 pixel)';
