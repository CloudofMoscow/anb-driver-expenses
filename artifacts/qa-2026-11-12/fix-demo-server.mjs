// Disposable browser-regression server. Never opens the production database.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, cpSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { openDatabase } from '../../server/database.js';
import { createApplication } from '../../server/app.js';
const root = resolve(import.meta.dirname, '../..');
const dir = process.env.ANB_QA_REUSE_INSTANCE === '1'
  ? JSON.parse(readFileSync(join(import.meta.dirname,'fix-demo-instance.json'),'utf8')).directory
  : mkdtempSync(join(tmpdir(), 'anb-fix-browser-'));
if (!resolve(dir).startsWith(resolve(tmpdir()) + '\\') || !dir.includes('anb-fix-browser-')) throw new Error('Not a disposable QA directory');
if (process.env.ANB_QA_REUSE_INSTANCE !== '1') {
  const source = new DatabaseSync(join(root, 'demo-data/anb.sqlite'), {readOnly:true});
  await backup(source, join(dir, 'anb.sqlite')); source.close();
  cpSync(join(root, 'demo-data/uploads'), join(dir, 'uploads'), {recursive:true});
}
const database = openDatabase(join(dir, 'anb.sqlite'));
const application = createApplication({database,publicDirectory:root,uploadsDirectory:join(dir,'uploads')});
const faultFile = join(import.meta.dirname,'fix-demo-fault.json');
const server = createServer((request,response) => {
  if (existsSync(faultFile)) {
    const fault = JSON.parse(readFileSync(faultFile,'utf8'));
    if (request.url === fault.path && request.method === 'POST') {
      unlinkSync(faultFile);
      if (fault.mode === 'lost-response') response.end = () => response.destroy();
      else { response.writeHead(fault.status || 503, {'Content-Type':'application/json'}); response.end(JSON.stringify({error:'Тестовый отказ сервера',code:'QA_FAILURE'})); return; }
    }
  }
  application(request,response);
});
server.listen(8797, '127.0.0.1', () => {
  writeFileSync(join(import.meta.dirname,'fix-demo-instance.json'), JSON.stringify({directory:dir,port:8797}));
  console.log('Disposable browser demo: http://127.0.0.1:8797');
});
process.on('SIGINT', () => server.close(() => {database.close(); process.exit(0);}));
