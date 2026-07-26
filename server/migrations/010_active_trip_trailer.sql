-- До этой версии старый API мог начать рейс по устаревшей сцепке и тем самым
-- оставить один прицеп сразу в нескольких активных рейсах. Сохраняем самый
-- ранний рейс активным, остальные не удаляем, а отправляем на проверку.
WITH ranked_conflicts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY trailer_id
           ORDER BY COALESCE(loaded_at, assigned_at, created_at), created_at, id
         ) AS position
  FROM trips
  WHERE status = 'in_progress'
)
INSERT OR IGNORE INTO audit_events(
  id, organization_id, actor_user_id, entity_type, entity_id, action,
  before_json, after_json, reason, created_at
)
SELECT
  'aud-migration-010-' || t.id,
  t.organization_id,
  NULL,
  'trip',
  t.id,
  'migration_active_trailer_conflict',
  '{"status":"in_progress"}',
  '{"status":"needs_explanation"}',
  'Обнаружен второй активный рейс с тем же прицепом; требуется проверка офиса',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM trips t
JOIN ranked_conflicts r ON r.id = t.id
WHERE r.position > 1;

WITH ranked_conflicts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY trailer_id
           ORDER BY COALESCE(loaded_at, assigned_at, created_at), created_at, id
         ) AS position
  FROM trips
  WHERE status = 'in_progress'
)
INSERT OR IGNORE INTO notifications(
  id, organization_id, recipient_user_id, notification_type, title,
  message, entity_type, entity_id, created_at
)
SELECT
  'ntf-migration-010-' || t.id,
  t.organization_id,
  t.driver_id,
  'trip_needs_review',
  'Рейс остановлен для проверки',
  'Офис должен проверить конфликт: один прицеп был указан в двух активных рейсах.',
  'trip',
  t.id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM trips t
JOIN ranked_conflicts r ON r.id = t.id
WHERE r.position > 1;

WITH ranked_conflicts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY trailer_id
           ORDER BY COALESCE(loaded_at, assigned_at, created_at), created_at, id
         ) AS position
  FROM trips
  WHERE status = 'in_progress'
)
UPDATE trips
SET status = 'needs_explanation',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    row_version = row_version + 1
WHERE id IN (SELECT id FROM ranked_conflicts WHERE position > 1);

CREATE UNIQUE INDEX trips_one_active_trailer
  ON trips(trailer_id) WHERE status = 'in_progress';
