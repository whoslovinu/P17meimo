INSERT INTO public.boss_status (boss_id, max_hp, current_hp, version)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 100000, 100000, 1)
ON CONFLICT (boss_id) DO UPDATE SET
  max_hp = EXCLUDED.max_hp,
  current_hp = EXCLUDED.current_hp,
  version = EXCLUDED.version,
  last_updated_at = timezone('utc'::text, now());

INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
VALUES (
  999999,
  '__banner_global__',
  'LIVE2D',
  '2026-01-01T00:00:00Z'::timestamptz,
  '2099-12-31T23:59:59Z'::timestamptz,
  'DISABLED',
  '{"isGlobalEnabled": false, "isCarouselEnabled": true, "carouselInterval": 5}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  config = EXCLUDED.config;
