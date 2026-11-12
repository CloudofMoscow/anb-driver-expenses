// Verifies only this fix session's disposable fixtures, never production or demo-data.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const instance = JSON.parse(readFileSync(join(import.meta.dirname,'fix-demo-instance.json'),'utf8'));
const directory = resolve(instance.directory);
if (!directory.startsWith(resolve(tmpdir()) + '\\') || !directory.includes('anb-fix-browser-')) throw new Error('Not the disposable QA database');
const db = new DatabaseSync(join(directory,'anb.sqlite'),{readOnly:true});
try {
  const trip = db.prepare(`SELECT id,status,loaded_at,unloaded_at,
    (SELECT entered_value_km FROM odometer_readings WHERE trip_id=t.id AND reading_type='start') AS start_odometer_km,
    (SELECT entered_value_km FROM odometer_readings WHERE trip_id=t.id AND reading_type='end') AS end_odometer_km
    FROM trips t WHERE id='qa-fix-assigned-1'`).get();
  assert.equal(trip.start_odometer_km,123456);
  assert.equal(trip.end_odometer_km,123556);
  assert.equal(trip.status,'pending_review');
  const others = db.prepare(`SELECT id,status,
    (SELECT entered_value_km FROM odometer_readings WHERE trip_id=t.id AND reading_type='start') AS start_odometer_km
    FROM trips t WHERE id IN ('qa-fix-assigned-2','qa-fix-assigned-3','qa-fix-assigned-4') OR number='ANB-0265'`).all();
  assert.equal(others.length,4);
  assert.ok(others.every(t=>t.status==='assigned' && t.start_odometer_km===null));
  const expenses = db.prepare("SELECT id,amount_kopecks,description FROM expenses WHERE trip_id='qa-fix-assigned-1'").all();
  assert.equal(expenses.length,1); assert.equal(expenses[0].amount_kopecks,123);
  const adjustments = db.prepare("SELECT id,amount_kopecks,reason,client_mutation_id FROM trip_rate_adjustments WHERE trip_id='qa-fix-review-1'").all();
  assert.equal(adjustments.length,1); assert.equal(adjustments[0].amount_kopecks,1234);
  const transfer = db.prepare("SELECT amount_kopecks,reversed_at,reversal_reason FROM driver_transfers WHERE reversal_reason='QA сторно 100 рублей'").get();
  assert.equal(transfer.amount_kopecks,10000); assert.ok(transfer.reversed_at);
  const output={createdAt:new Date().toISOString(),source:'disposable fix-browser instance',trip,others,expenses,adjustments,transfer,passed:true};
  writeFileSync(join(import.meta.dirname,'fix-browser-workflow-results.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
} finally { db.close(); }
