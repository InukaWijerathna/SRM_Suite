import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

import { backend } from './auth-harness.mjs';

test('public handshake requires auth protocol 2',()=>{const b=backend();assert.deepEqual(b.get({action:'ping'}),{ok:true,loginRequired:true,authVersion:2});});
test('all data routes reject unauthenticated requests before reading or writing',()=>{
  const b=backend();
  for(const action of ['roster','appendAttendance','updateStudent','session']) assert.equal(b.post({action}).code,'AUTH_REQUIRED');
  assert.equal(b.get({action:'roster'}).code,'AUTH_REQUIRED');
  assert.deepEqual(b.counts(),{reads:0,writes:0});
});
test('successful login issues an expiring token; password is not in the response',()=>{const b=backend();const s=b.login();assert.equal(s.ok,true);assert.match(s.token,/^[a-f0-9]{64}$/);assert.equal(s.role,'editor');assert.ok(s.expiresAt>Date.now());assert.equal(s.password,undefined);assert.equal(s.passwordHash,undefined);assert.equal(b.post({action:'roster',token:s.token}).ok,true);});
test('wrong password and missing users cannot authenticate',()=>{const b=backend();assert.equal(b.post({action:'login',username:'tester',password:'wrong'}).ok,false);b.users.length=1;assert.equal(b.login().ok,false);});
test('viewer can read but cannot forge editor access',()=>{const b=backend('viewer');const s=b.login();assert.equal(b.post({action:'roster',token:s.token}).ok,true);for(const action of ['appendAttendance','updateStudent'])assert.equal(b.post({action,token:s.token,role:'editor'}).code,'FORBIDDEN');assert.equal(b.counts().writes,0);});
test('changing role takes effect on existing sessions',()=>{const b=backend();const s=b.login();b.users[1][3]='viewer';assert.equal(b.post({action:'appendAttendance',token:s.token}).code,'FORBIDDEN');assert.equal(b.post({action:'session',token:s.token}).role,'viewer');});
test('disabled accounts and password changes invalidate sessions',()=>{for(const change of [b=>b.users[1][2]='inactive',b=>b.users[1][1]='changed']){const b=backend();const s=b.login();change(b);assert.equal(b.post({action:'roster',token:s.token}).code,'AUTH_REQUIRED');}});
test('expired, fabricated, and evicted tokens are rejected',()=>{const b=backend();const s=b.login();b.expire();assert.equal(b.post({action:'roster',token:s.token}).code,'AUTH_REQUIRED');assert.equal(b.post({action:'roster',token:'a'.repeat(64)}).code,'AUTH_REQUIRED');b.cache.clear();assert.equal(b.post({action:'roster',token:s.token}).code,'AUTH_REQUIRED');});
test('logout revokes server session',()=>{const b=backend();const s=b.login();assert.equal(b.post({action:'logout',token:s.token}).ok,true);assert.equal(b.post({action:'roster',token:s.token}).code,'AUTH_REQUIRED');});
test('editor can submit attendance and edit records',()=>{const b=backend();const s=b.login();for(const action of ['appendAttendance','updateStudent'])assert.equal(b.post({action,token:s.token}).ok,true);assert.equal(b.counts().writes,2);});

const config={scriptUrl:'https://example.test/exec',apiKey:'test-key'};
const apiSource = fs.readFileSync(new URL('../src/services/api.ts',import.meta.url),'utf8');
let js = ts.transpileModule(apiSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
js=js.replace(/import \{ loadSession \} from '.\/storage';/, 'const loadSession = () => globalThis.__authTestSession;');
const api=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const validSession=()=>({username:'tester',token:'a'.repeat(64),role:'editor',expiresAt:Date.now()+3600000,scriptUrl:config.scriptUrl});
globalThis.window=new EventTarget();
test('client sends session token in POST body for roster',async()=>{globalThis.__authTestSession=validSession();let captured;globalThis.fetch=async(url,init)=>{captured={url,...init};return Response.json({ok:true,master:[],health:[]})};await api.fetchRoster(config);assert.equal(captured.method,'POST');assert.equal(captured.url,config.scriptUrl);assert.equal(JSON.parse(captured.body).token,globalThis.__authTestSession.token);});
test('client rejects old backend handshake',async()=>{globalThis.fetch=async()=>Response.json({ok:true});await assert.rejects(api.checkLoginRequired(config),/Update the Apps Script/);});
test('client rejects failed handshake instead of allowing access',async()=>{globalThis.fetch=async()=>{throw new Error('network failure')};await assert.rejects(api.checkLoginRequired(config),/Could not reach/);});
test('client refuses legacy login response without server token',async()=>{globalThis.fetch=async()=>Response.json({ok:true,role:'editor'});await assert.rejects(api.login('tester','test-password',config),/Update the Apps Script/);});
test('expired or other-sheet sessions cannot issue requests',async()=>{for(const modify of [s=>s.expiresAt=1,s=>s.scriptUrl='https://other.test/exec']){const s=validSession();modify(s);globalThis.__authTestSession=s;globalThis.fetch=async()=>{throw new Error('must not fetch')};await assert.rejects(api.fetchRoster(config),/session has expired/);}});
test('server authentication failure notifies UI to lock',async()=>{globalThis.__authTestSession=validSession();let expired=false;window.addEventListener('srm:session-expired',()=>expired=true,{once:true});globalThis.fetch=async()=>Response.json({ok:false,code:'AUTH_REQUIRED',error:'Sign in again'});await assert.rejects(api.fetchRoster(config),e=>e.kind==='auth');assert.equal(expired,true);});


test('late authentication failure cannot invalidate a newer login',async()=>{
  globalThis.__authTestSession=validSession();
  let reply;
  globalThis.fetch=()=>new Promise(resolve=>reply=resolve);
  let expired=false;
  const listener=()=>expired=true;
  window.addEventListener('srm:session-expired',listener);
  const request=api.fetchRoster(config);
  globalThis.__authTestSession={...validSession(),token:'b'.repeat(64)};
  reply(Response.json({ok:false,code:'AUTH_REQUIRED',error:'Old session expired'}));
  await assert.rejects(request,e=>e.kind==='auth');
  assert.equal(expired,false);
  window.removeEventListener('srm:session-expired',listener);
});
test('ambiguous server responses never count as saved attendance',async()=>{
  globalThis.__authTestSession=validSession();
  for(const body of [{}, {appended:1}, {ok:false,error:'Not saved'}]){
    globalThis.fetch=async()=>Response.json(body);
    await assert.rejects(api.submitAttendance([],config));
  }
});
test('malformed session verification cannot unlock the client',async()=>{
  globalThis.__authTestSession=validSession();
  for(const body of [{ok:true}, {ok:true,username:'other',role:'editor',expiresAt:Date.now()+10000}, {ok:true,username:'tester',role:'admin',expiresAt:Date.now()+10000}]){
    globalThis.fetch=async()=>Response.json(body);
    await assert.rejects(api.validateSession(config),e=>e.kind==='auth');
  }
});
