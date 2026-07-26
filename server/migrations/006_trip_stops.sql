CREATE TABLE trip_stops (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  stop_order INTEGER NOT NULL CHECK (stop_order > 0),
  stop_type TEXT NOT NULL DEFAULT 'unloading'
    CHECK (stop_type IN ('unloading')),
  address TEXT NOT NULL,
  is_approximate INTEGER NOT NULL DEFAULT 0 CHECK (is_approximate IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (trip_id, stop_order)
);

CREATE INDEX trip_stops_by_trip ON trip_stops(trip_id, stop_order);
