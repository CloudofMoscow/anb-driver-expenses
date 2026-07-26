ALTER TABLE driver_accruals ADD COLUMN client_mutation_id TEXT;
ALTER TABLE trip_rate_adjustments ADD COLUMN client_mutation_id TEXT;
ALTER TABLE incoming_payments ADD COLUMN client_mutation_id TEXT;
ALTER TABLE recurring_costs ADD COLUMN client_mutation_id TEXT;

CREATE UNIQUE INDEX driver_accruals_unique_mutation
  ON driver_accruals(organization_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE UNIQUE INDEX trip_rate_adjustments_unique_mutation
  ON trip_rate_adjustments(organization_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE UNIQUE INDEX incoming_payments_unique_mutation
  ON incoming_payments(organization_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
CREATE UNIQUE INDEX recurring_costs_unique_mutation
  ON recurring_costs(organization_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
