// Repeatable audit probes. Writes only inside a temporary database cloned from demo-data.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createApplication } from '../../server/app.js';
import { openDatabase } from '../../server/database.js';
import { createSessionToken, hashSessionToken } from '../../server/security.js';

const root = resolve(import.meta.dirname, '../..');
const temporary = mkdtempSync(join(tmpdir(), 'anb-qa-audit-'));
let db, server;
const output = { createdAt: new Date().toISOString(), node: process.version, source: 'demo-data/anb.sqlite (SQLite backup into disposable temp directory)', checks: [], metrics: [], assets: [] };
let prepareCount = 0;
try {
  const source = new DatabaseSync(join(root, 'demo-data/anb.sqlite'), { readOnly: true });
  await backup(source, join(temporary, 'audit.sqlite'));
  source.close();
  db = openDatabase(join(temporary, 'audit.sqlite'));
  const owner = db.prepare("SELECT * FROM users WHERE login='owner'").get();
  const driver = db.prepare("SELECT * FROM users WHERE login='driver1'").get();
  function session(user) {
    const token = createSessionToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(hashSessionToken(token), user.id, '2099-01-01T00:00:00.000Z', new Date().toISOString());
    return `anb_session=${token}`;
  }
  const ownerCookie = session(owner), driverCookie = session(driver);
  const counted = new Proxy(db, { get(target, key) { if (key === 'prepare') return (...args) => { prepareCount++; return target.prepare(...args); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  server = createServer(createApplication({ database: counted, publicDirectory: root, uploadsDirectory: join(temporary, 'uploads') }));
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { cookie = ownerCookie, method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(base + path, { method, headers: { cookie, ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, bytes: Buffer.byteLength(text), headers: Object.fromEntries(res.headers) };
  }
  async function check(name, path, options, expected) {
    const result = await request(path, options);
    const passed = typeof expected === 'function' ? expected(result) : result.status === expected;
    output.checks.push({ name, passed, status: result.status, code: result.data?.code, ...(passed ? {} : { result: result.data }) });
  }
  await check('driver cannot read office bootstrap', '/api/office/bootstrap', { cookie: driverCookie }, 403);
  await check('office cannot read driver bootstrap', '/api/driver/bootstrap', {}, 403);
  await check('no session cannot read private file', '/api/files/not-found', { cookie: '' }, 401);
  await check('legacy application is excluded', '/app.js', {}, 404);
  await check('source tree is excluded', '/server/app.js', {}, 404);
  await check('database is excluded', '/demo-data/anb.sqlite', {}, 404);
  await check('malformed JSON returns 400', '/api/office/trips', { method: 'POST', body: '{' }, 400);
  await check('null JSON returns validation error, not 500', '/api/office/trips', { method: 'POST', body: 'null' }, 400);
  await check('malformed cookie returns client error, not 500', '/api/me', { cookie: 'anb_session=%ZZ' }, r => r.status >= 400 && r.status < 500);
  await check('malformed percent URL returns client error, not 500', '/%ZZ', {}, r => r.status >= 400 && r.status < 500);
  await check('driver DTO does not expose compensation, customer rate or contracts', '/api/driver/bootstrap', { cookie: driverCookie }, r => r.status === 200 && !r.data.trips.some(t => 'agreed_rate_kopecks' in t || 'customer_name' in t || 'salary_rate_override_kopecks_per_km' in t || 'payments' in t));
  const knownTrip = db.prepare("SELECT * FROM trips WHERE driver_id = ? AND status='assigned' LIMIT 1").get(driver.id);
  const tripBody = { customerId: knownTrip.customer_id, rigId: knownTrip.rig_id, loadingAddress: 'QA test A', unloadingAddress: 'QA test B', plannedLoadingDate: '2026-11-12', agreedRateKopecks: 10000, vatMode: 'without_vat', paymentMethod: 'bank', paymentTermDays: 0 };
  for (const amount of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1]) await check(`trip rejects invalid integer money ${amount}`, '/api/office/trips', { method: 'POST', body: { ...tripBody, agreedRateKopecks: amount } }, 400);
  await check('trip rejects invalid date', '/api/office/trips', { method: 'POST', body: { ...tripBody, plannedLoadingDate: '2026-02-30' } }, 400);
  await check('trip rejects 11 extra stops', '/api/office/trips', { method: 'POST', body: { ...tripBody, additionalUnloadingStops: Array(11).fill('QA stop') } }, 400);
  await check('SQL-looking search parameters do not break report', '/api/office/report?from=2026-11-01%27%20OR%201%3D1--&to=2026-11-30', {}, 400);
  const staticResult = await request('/office.js?v=75', { headers: { 'accept-encoding': 'gzip, br', 'if-none-match': 'qa' } });
  output.staticDelivery = { status: staticResult.status, cacheControl: staticResult.headers['cache-control'], etag: staticResult.headers.etag || null, contentEncoding: staticResult.headers['content-encoding'] || null };
  for (const name of ['login.html','driver.html','office.html','styles.css','office.js','driver.js','driver-outbox.js','api-client.js','financial-mutation.js','push-notifications.js','theme.js','login.js','sw.js']) {
    const bytes = readFileSync(join(root,name));
    output.assets.push({ name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, brotliBytes: brotliCompressSync(bytes).length });
  }
  const templateTrip = db.prepare("SELECT * FROM trips WHERE status='confirmed' LIMIT 1").get();
  const templateExpense = db.prepare('SELECT * FROM expenses WHERE trip_id=? LIMIT 1').get(templateTrip.id);
  function insertClone(table, record) { const columns = Object.keys(record); db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(record)); }
  let cloned = 0;
  for (const size of [Number(db.prepare('SELECT COUNT(*) AS n FROM trips').get().n), 100, 1000, 5000]) {
    db.exec('BEGIN');
    while (Number(db.prepare('SELECT COUNT(*) AS n FROM trips').get().n) < size) {
      const n = ++cloned, id = `qa-scale-trip-${n}`;
      insertClone('trips', { ...templateTrip, id, number: `QA-SCALE-${n}`, start_client_mutation_id: null, complete_client_mutation_id: null });
      if (templateExpense) insertClone('expenses', { ...templateExpense, id:`qa-scale-expense-${n}`,trip_id:id,client_mutation_id:null });
    }
    db.exec('COMMIT');
    for (const path of ['/api/office/bootstrap', '/api/office/report?from=2026-01-01&to=2026-12-31', '/api/driver/bootstrap']) {
      await request(path, { cookie: path.includes('/driver/') ? driverCookie : ownerCookie });
      const samples=[];
      let response;
      let counts=[];
      for (let repeat=0;repeat<3;repeat++) {
        prepareCount=0;
        const start=performance.now();
        response = await request(path, { cookie: path.includes('/driver/') ? driverCookie : ownerCookie });
        samples.push(Number((performance.now()-start).toFixed(2))); counts.push(prepareCount);
      }
      samples.sort((a,b)=>a-b);
      output.metrics.push({ trips:size, expenses:Number(db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n), path, status:response.status, bytes:response.bytes, wireBytes:Number(response.headers['content-length']), contentEncoding:response.headers['content-encoding'], ms:samples, medianMs:samples[1], prepareCalls:counts, note:'Local loopback, no network throttling; synthetic historical trips, one expense each; server+response consumption, excludes DOM rendering.' });
      console.log(JSON.stringify(output.metrics.at(-1)));
      if (path.endsWith('/bootstrap')) {
        prepareCount=0;
        const start=performance.now();
        const conditional=await request(path,{cookie:path.includes('/driver/') ? driverCookie : ownerCookie,headers:{'if-none-match':response.headers.etag}});
        output.metrics.push({trips:size,path,conditional:true,status:conditional.status,bytes:conditional.bytes,wireBytes:Number(conditional.headers['content-length'] || 0),prepareCalls:prepareCount,ms:Number((performance.now()-start).toFixed(2))});
        console.log(JSON.stringify(output.metrics.at(-1)));
      }
    }
  }
} finally {
  if (server?.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  db?.close();
  rmSync(temporary,{recursive:true,force:true});
  writeFileSync(join(import.meta.dirname,'fix-optimized-probe-results.json'),JSON.stringify(output,null,2));
}
console.log(`Additional probes: ${output.checks.filter(x=>x.passed).length}/${output.checks.length} passed. See probe-results.json.`);
