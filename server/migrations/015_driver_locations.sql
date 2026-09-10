CREATE TABLE driver_location_updates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  tractor_id TEXT NOT NULL REFERENCES tractors(id),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_driver_location_trip_captured
  ON driver_location_updates(trip_id, captured_at DESC);

CREATE INDEX idx_driver_location_driver_captured
  ON driver_location_updates(driver_id, captured_at DESC);
