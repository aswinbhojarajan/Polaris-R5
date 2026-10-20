-- Disable (never delete) every project NOT created by this migration.
-- User decision: only backup projects remain usable; active flags come verbatim from the backup.
BEGIN;
UPDATE public.clients c
SET is_active = false, updated_at = now()
WHERE c.id NOT IN (SELECT new_id FROM migration_map.id_map WHERE entity='client')
  AND c.is_active;
COMMIT;
SELECT 'active non-backup projects (must be 0)' what, count(*) FROM public.clients c
WHERE c.id NOT IN (SELECT new_id FROM migration_map.id_map WHERE entity='client') AND c.is_active;
SELECT 'active backup projects' what, count(*) FROM public.clients c
JOIN migration_map.id_map m ON m.entity='client' AND m.new_id=c.id WHERE c.is_active;
