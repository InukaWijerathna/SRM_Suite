import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
export function backend(role = 'editor') {
  const cache = new Map();
  const passwordHash = crypto.createHash('sha256').update('test-password').digest('hex');
  const users = [['Username', 'Password_Hash', 'Status', 'Role'], ['tester', passwordHash, 'active', role]];
  let clock = Date.now();
  class TestDate extends Date { static now() { return clock; } }
  const sheet = { getLastRow: () => users.length, getLastColumn: () => users[0].length,
    getRange: (r,c,n,m) => ({getValues: () => users.slice(r-1,r-1+n).map(row => row.slice(c-1,c-1+m))}) };
  const ctx = vm.createContext({ Date: TestDate, console,
    CacheService: { getScriptCache: () => ({get: k => cache.get(k), put: (k,v) => cache.set(k,v), remove: k => cache.delete(k)}) },
    Utilities: { DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'}, getUuid: crypto.randomUUID,
      computeDigest: (_,text) => [...crypto.createHash('sha256').update(text).digest()] },
    PropertiesService: {getScriptProperties: () => ({getProperty: () => null})},
    ContentService: {MimeType:{JSON:'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
  });
  vm.runInContext(source, ctx);
  ctx.getSpreadsheet_ = () => ({getSheetByName: () => sheet});
  let reads = 0, writes = 0;
  ctx.readRows_ = () => { reads++; return []; };
  ctx.appendAttendance_ = () => { writes++; return {ok:true}; };
  ctx.updateStudent_ = () => { writes++; return {ok:true}; };
  const post = body => ctx.doPost({postData:{contents:JSON.stringify(body)}});
  const get = parameter => ctx.doGet({parameter});
  const login = () => post({action:'login',username:'TESTER',password:'test-password'});
  return {ctx,users,post,get,login,cache,counts: () => ({reads,writes}),expire: () => {clock += 21600001;}};
}

