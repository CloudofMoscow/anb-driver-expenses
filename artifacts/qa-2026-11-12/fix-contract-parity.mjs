// Compare complete DTOs and reports with the pinned original on one disposable database.
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createApplication } from '../../server/app.js';
import { openDatabase } from '../../server/database.js';
import { createSessionToken, hashSessionToken } from '../../server/security.js';
const root=resolve(import.meta.dirname,'../..');
const dir=mkdtempSync(join(tmpdir(),'anb-fix-parity-'));
const baselinePath=join(root,'server',`.qa-parity-app-${process.pid}.mjs`);
let db,server;
const results=[];
try {
  writeFileSync(baselinePath,execFileSync('git',['show','c0443fe:server/app.js'],{cwd:root,maxBuffer:4*1024*1024}));
  const original=await import(pathToFileURL(baselinePath).href);
  const source=new DatabaseSync(join(root,'demo-data/anb.sqlite'),{readOnly:true});
  await backup(source,join(dir,'parity.sqlite')); source.close();
  db=openDatabase(join(dir,'parity.sqlite'));
  const office=db.prepare("SELECT * FROM users WHERE login='owner'").get(),driver=db.prepare("SELECT * FROM users WHERE login='driver1'").get();
  const cookie=(user)=>{const token=createSessionToken();db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(hashSessionToken(token),user.id,'2099-01-01T00:00:00.000Z',new Date().toISOString());return `anb_session=${token}`;};
  const officeCookie=cookie(office),driverCookie=cookie(driver);
  const opts={database:db,publicDirectory:root,uploadsDirectory:join(dir,'uploads')};
  const old=original.createApplication(opts),current=createApplication(opts);
  const oldVisible=original.createApplication({...opts,driverCompensationVisible:true}),currentVisible=createApplication({...opts,driverCompensationVisible:true});
  server=createServer((req,res)=> (req.headers['x-qa-original'] ? req.headers['x-qa-visible'] ? oldVisible : old : req.headers['x-qa-visible'] ? currentVisible : current)(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [path,cookieValue,visible] of [['/api/office/bootstrap',officeCookie,false],['/api/driver/bootstrap',driverCookie,false],['/api/driver/bootstrap',driverCookie,true],['/api/office/report?from=2026-01-01&to=2026-12-31',officeCookie,false]]) {
    const headers={cookie:cookieValue,...(visible?{'x-qa-visible':'1'}:{})};
    const a=await fetch(base+path,{headers:{...headers,'x-qa-original':'1'}}),b=await fetch(base+path,{headers});
    assert.equal(a.status,200);assert.equal(b.status,200);
    const originalData=await a.json(),currentData=await b.json();
    assert.deepEqual(currentData,originalData);
    results.push({path,compensationVisible:visible,exactDeepEquality:true,trips:currentData.trips?.length,adjustments:currentData.trips?.reduce((n,t)=>n+(t.adjustments?.length||0),0),payments:currentData.trips?.reduce((n,t)=>n+(t.payments?.length||0),0)});
  }
  const first=await fetch(base+'/api/office/bootstrap',{headers:{cookie:officeCookie}}),etag=first.headers.get('etag'); await first.arrayBuffer();
  const external=new DatabaseSync(join(dir,'parity.sqlite')); external.prepare('UPDATE organizations SET name=?').run('QA external connection');external.close();
  const changed=await fetch(base+'/api/office/bootstrap',{headers:{cookie:officeCookie,'if-none-match':etag}});
  assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),etag);
  assert.equal((await changed.json()).organization.name,'QA external connection');
  results.push({externalConnectionInvalidatesRevision:true});
  writeFileSync(join(import.meta.dirname,'fix-contract-parity-results.json'),JSON.stringify({createdAt:new Date().toISOString(),results,passed:true},null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
  db?.close();rmSync(dir,{recursive:true,force:true});rmSync(baselinePath,{force:true});
}
