-- Optional: automatische Löschung täglich um 03:15 UTC.
-- In Supabase muss die pg_cron/Cron-Funktion für das Projekt verfügbar/aktiv sein.
create extension if not exists pg_cron;

select cron.schedule(
  'fragenraum-cleanup-expired-rooms',
  '15 3 * * *',
  $$select public.fr_cleanup_expired_rooms();$$
);
