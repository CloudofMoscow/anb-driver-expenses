import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const instance = JSON.parse(readFileSync(join(import.meta.dirname,'fix-demo-instance.json'),'utf8'));
const directory = resolve(instance.directory);
if (!directory.startsWith(resolve(tmpdir()) + '\\') || !directory.includes('anb-fix-browser-')) throw new Error('Not the disposable QA database');
const db = new DatabaseSync(join(directory,'anb.sqlite'));
function clone(table, row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
}
const driver = db.prepare("SELECT * FROM users WHERE login='driver1'").get();
const assigned = db.prepare("SELECT * FROM trips WHERE driver_id=? AND status='assigned' LIMIT 1").get(driver.id);
const confirmed = db.prepare("SELECT * FROM trips WHERE status='confirmed' LIMIT 1").get();
const expense = db.prepare('SELECT * FROM expenses LIMIT 1').get();
for (let i=1;i<=4;i++) {
  clone('trips',{...assigned,id:`qa-fix-assigned-${i}`,number:`FIX-ASSIGNED-${i}`,start_client_mutation_id:null,complete_client_mutation_id:null});
  clone('trips',{...confirmed,id:`qa-fix-review-${i}`,number:`FIX-REVIEW-${i}`,status:'pending_review',start_client_mutation_id:null,complete_client_mutation_id:null});
  clone('trips',{...confirmed,id:`qa-fix-overdue-${i}`,number:`FIX-OVERDUE-${i}`,loaded_at:'2026-01-01T00:00:00.000Z',unloaded_at:'2026-01-02T00:00:00.000Z',payment_term_days:0,start_client_mutation_id:null,complete_client_mutation_id:null});
  clone('expenses',{...expense,id:`qa-fix-expense-${i}`,trip_id:`qa-fix-review-${i}`,status:'pending_review',client_mutation_id:null});
}
const notification = db.prepare('SELECT * FROM notifications WHERE recipient_user_id=? LIMIT 1').get(driver.id);
if (notification) for (let i=1;i<=23;i++) clone('notifications',{...notification,id:`qa-fix-notification-${i}`,title:`FIX сообщение ${i}`,read_at:null});
if (process.argv.includes('--touch')) db.prepare("UPDATE trips SET driver_instructions = ? WHERE id = 'qa-fix-assigned-4'").run(`QA polling ${Date.now()}`);
db.close();
console.log('Fixtures added only to the disposable browser database');
