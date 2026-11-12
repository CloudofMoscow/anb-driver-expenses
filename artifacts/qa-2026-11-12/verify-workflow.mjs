import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const db = new DatabaseSync(resolve(import.meta.dirname, '../../demo-data/anb.sqlite'), { readOnly: true });
try {
  const trip = db.prepare("SELECT id,number,status,agreed_rate_kopecks FROM trips WHERE number='QA-20261112'").get();
  assert.ok(trip, 'The browser-created QA trip must exist');
  const expenses = db.prepare('SELECT amount_kopecks,status,description FROM expenses WHERE trip_id=? ORDER BY amount_kopecks').all(trip.id);
  const accruals = db.prepare('SELECT accrual_type,balance_effect_kopecks FROM driver_accruals WHERE trip_id=? AND reversed_at IS NULL').all(trip.id);
  const adjustments = db.prepare('SELECT amount_kopecks,reason FROM trip_rate_adjustments WHERE trip_id=? AND reversed_at IS NULL').all(trip.id);
  const payments = db.prepare('SELECT pa.amount_kopecks FROM payment_allocations pa JOIN incoming_payments p ON p.id=pa.payment_id WHERE pa.trip_id=? AND p.reversed_at IS NULL').all(trip.id);
  const rows = db.prepare('SELECT reading_type,entered_value_km FROM odometer_readings WHERE trip_id=? ORDER BY reading_type').all(trip.id);
  assert.equal(trip.status,'confirmed');
  assert.deepEqual(expenses.map(x=>x.amount_kopecks),[5100,25050]);
  assert.ok(expenses.every(x=>x.status==='confirmed'));
  assert.equal(expenses.filter(x=>x.description==='QA queued while demo server unavailable').length,1,'The recovered queued expense must be delivered exactly once');
  const sum = list => list.reduce((n,x)=>n+Number(x.amount_kopecks),0);
  const finalRate = trip.agreed_rate_kopecks+sum(adjustments);
  const compensation = accruals.reduce((n,x)=>n+Number(x.balance_effect_kopecks),0);
  assert.equal(finalRate,1010000);
  assert.equal(compensation,270000);
  assert.equal(finalRate-sum(payments),910000);
  assert.equal(finalRate-sum(expenses)-compensation,709850);
  const result = { passed:true, trip,expenses,accruals,adjustments,payments,odometer:rows,totalsKopecks:{finalRate,expenses:sum(expenses),compensation,receivable:finalRate-sum(payments),grossProfit:finalRate-sum(expenses)-compensation}, note:'Read-only verification of the demo browser workflow; no production database opened.' };
  writeFileSync(resolve(import.meta.dirname,'workflow-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { db.close(); }
