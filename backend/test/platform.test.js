import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { configuration } from '../src/config.js';
import { database,one,insert,record } from '../src/db.js';
import { createApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { id,passwordHash,seal,unseal,totp,verifyTotp } from '../src/security.js';
import { maxBonus,csvCell } from '../src/domain.js';
import { tbankToken,verifyTbank } from '../src/providers.js';
import { generateInvoice,queueReminders } from '../src/billing.js';

let db,app,platform,owner,operator,other;
const origin='http://127.0.0.1:4300',password='test-password-never-for-production';
const config=configuration({ENCRYPTION_KEY:randomBytes(32).toString('hex'),PUBLIC_ORIGIN:origin,DATA_DIR:'memory://'});
async function login(email){const r=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{email,password}});assert.equal(r.statusCode,200,r.body);const cookie=r.cookies[0].name+'='+r.cookies[0].value;const me=await app.inject({url:'/api/auth/me',headers:{cookie}});return {cookie,origin,'x-csrf-token':me.json().csrf};}
const req=(headers,method,url,body,extra={})=>app.inject({method,url,headers:{...headers,...extra},...(body?{payload:body}:{})});
const input=()=>({brandId:'unagi-1',branchId:'point-1',methodId:'unagi-1-cash',mode:'pickup',items:[{productId:'point-1-philadelphia',quantity:2}]});
before(async()=>{
  db=await database(config);await seed(db,{adminPassword:password,ownerPassword:password});
  await db.query("INSERT INTO tenants(id,name,email) VALUES('other','Other business','other@example.invalid')");
  for(const [email,role,tenant]of[['operator@unagi.local','operator','unagi'],['other@local.invalid','owner','other']])await db.query('INSERT INTO users(id,email,name,role,password,tenant_id) VALUES($1,$2,$3,$4,$5,$6)',[id(),email,email,role,await passwordHash(password),tenant]);
  app=await createApp(config,db);await app.ready();platform=await login('admin@platform.local');owner=await login('owner@unagi.local');operator=await login('operator@unagi.local');other=await login('other@local.invalid');
});
after(async()=>{await app?.close();await db?.close();});

test('tenant isolation is enforced server-side for reads and writes',async()=>{
  for(const url of ['/api/admin/unagi/orders','/api/admin/unagi/catalog','/api/admin/unagi/reports','/api/admin/unagi/audit','/api/admin/unagi/overview'])assert.equal((await req(other,'GET',url)).statusCode,403,url);
  assert.equal((await req(other,'POST','/api/admin/unagi/brand',{name:'Intrusion'})).statusCode,403);
  assert.equal((await req(owner,'GET','/api/platform/tenants')).statusCode,403);
});
test('role restrictions and CSRF are independent of the UI',async()=>{
  assert.equal((await req(operator,'POST','/api/admin/unagi/brand',{name:'No'})).statusCode,403);
  assert.equal((await req(operator,'GET','/api/admin/unagi/users')).statusCode,403);
  assert.equal((await req({...owner,'x-csrf-token':'bad'},'POST','/api/admin/unagi/brand',{name:'No'})).statusCode,403);
  assert.equal((await req({...owner,origin:'https://attacker.invalid'},'POST','/api/admin/unagi/brand',{name:'No'})).statusCode,403);
});
test('order totals use catalog prices and reject unknown fields',async()=>{
  const result=await req(owner,'POST','/api/admin/unagi/orders/sandbox',input(),{'idempotency-key':'test-create-01'});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().total,118000);assert.equal(result.json().mode,'sandbox');assert.equal(result.json().payment_status,'unpaid');
  const tampered={...input(),total:1};assert.equal((await req(owner,'POST','/api/admin/unagi/orders/sandbox',tampered,{'idempotency-key':'test-tamper-01'})).statusCode,400);
});
test('concurrent retry creates one order; a changed payload cannot reuse its key',async()=>{
  const responses=await Promise.all([1,2].map(()=>req(owner,'POST','/api/admin/unagi/orders/sandbox',input(),{'idempotency-key':'test-repeat-01'})));responses.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.equal(responses[0].json().id,responses[1].json().id);
  const different=input();different.items[0].quantity=3;assert.equal((await req(owner,'POST','/api/admin/unagi/orders/sandbox',different,{'idempotency-key':'test-repeat-01'})).statusCode,409);
});
test('cross-brand items and bonus calculation without iikoCard fail closed',async()=>{
  const b=input();b.items[0].productId='point-2-philadelphia';assert.equal((await req(owner,'POST','/api/admin/unagi/orders/sandbox',b,{'idempotency-key':'test-brand-01'})).statusCode,409);
  assert.equal((await req(owner,'POST','/api/admin/unagi/orders/sandbox',{...input(),requestedBonus:10},{'idempotency-key':'test-bonus-01'})).statusCode,409);
});
test('status transitions require revision and valid sequence',async()=>{
  let o=(await req(owner,'POST','/api/admin/unagi/orders/sandbox',input(),{'idempotency-key':'test-state-01'})).json();
  const act=(action,revision)=>req(owner,'POST','/api/admin/unagi/orders/'+o.id+'/action',{action,revision,reason:'Test scenario'});
  assert.equal((await act('completed',o.revision)).statusCode,409);
  let r=await act('accepted',o.revision);assert.equal(r.statusCode,200,r.body);o=r.json();
  assert.equal((await act('preparing',o.revision-1)).statusCode,409);
  for(const action of ['mark_paid','preparing','ready','completed','refund']){r=await act(action,o.revision);assert.equal(r.statusCode,200,r.body);o=r.json();}
  assert.equal(o.payment_status,'refunded');assert.equal(o.data.refunded,o.total);
});
test('manual pause blocks new orders without hiding past orders',async()=>{
  await req(platform,'PATCH','/api/platform/tenants/unagi',{acceptingOrders:false,disabledFeatures:[],reason:'Manual maintenance'});
  assert.equal((await req(owner,'POST','/api/admin/unagi/orders/sandbox',input(),{'idempotency-key':'test-paused-01'})).statusCode,409);
  assert.equal((await req(owner,'GET','/api/admin/unagi/orders')).statusCode,200);
  await req(platform,'PATCH','/api/platform/tenants/unagi',{acceptingOrders:true,disabledFeatures:[],reason:'Resume orders'});
});
test('theme draft is not public until published; revision conflicts cannot overwrite changes',async()=>{
  const old=await record(db,'unagi','theme','unagi-1');const draft={...old.data.draft,primary:'#112233'};
  const saved=await req(owner,'PUT','/api/admin/unagi/themes/unagi-1',{revision:old.revision,data:draft});assert.equal(saved.statusCode,200,saved.body);
  assert.equal((await req(owner,'PUT','/api/admin/unagi/themes/unagi-1',{revision:old.revision,data:draft})).statusCode,409);
  let pub=(await app.inject('/api/public/unagi/config')).json();assert.equal(pub.brands[0].theme,null);
  const published=await req(owner,'POST','/api/admin/unagi/themes/unagi-1/publish',{revision:saved.json().revision});assert.equal(published.statusCode,200,published.body);
  pub=(await app.inject('/api/public/unagi/config')).json();assert.equal(pub.brands[0].theme.primary,'#112233');
});
test('secrets stay encrypted and never appear in overview or audit',async()=>{
  const secret='test-provider-secret';const r=await req(owner,'POST','/api/admin/unagi/integrations',{provider:'iiko',brandId:'unagi-1',apiLogin:secret});assert.equal(r.statusCode,200,r.body);
  const row=await record(db,'unagi','integration','iiko_unagi-1');assert.ok(!JSON.stringify(row).includes(secret));
  assert.equal(unseal(row.data.secret,config.key).apiLogin,secret);
  assert.ok(!(await req(owner,'GET','/api/admin/unagi/overview')).body.includes(secret));
  assert.ok(!(await req(owner,'GET','/api/admin/unagi/audit')).body.includes(secret));
});
test('subscription invoice and reminders deduplicate; no automatic restriction',async()=>{
  await insert(db,'unagi','tariff',id(),{type:'subscription',monthly:500000,implementation:2000000,effectiveFrom:'2025-01-01',commissionBps:0,includeDelivery:false});
  const first=await generateInvoice(db,'unagi','2025-02'),second=await generateInvoice(db,'unagi','2025-02');assert.equal(first.id,second.id);assert.equal(first.amount,500000);
  assert.equal(await queueReminders(db,new Date('2025-03-01T12:00:00Z')),1);assert.equal(await queueReminders(db,new Date('2025-03-01T12:00:00Z')),0);
  assert.equal((await one(db,"SELECT accepting_orders FROM tenants WHERE id='unagi'")).accepting_orders,true);
});
test('reports separate sandbox/live and escape spreadsheet formulas',async()=>{
  const live=(await req(owner,'GET','/api/admin/unagi/reports?mode=live')).json();assert.equal(live.summary.orders,0);
  const demo=(await req(owner,'GET','/api/admin/unagi/reports?mode=sandbox')).json();assert.ok(demo.summary.orders>0);assert.ok(demo.summary.refunds>0);
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
});
test('live ordering and phone login never silently fall back to test authorization',async()=>{
  assert.equal((await app.inject({method:'POST',url:'/api/public/unagi/orders',payload:input()})).statusCode,401);
  const call=await app.inject({method:'POST',url:'/api/public/unagi/auth/call',payload:{phone:'+79000000000'}});assert.equal(call.statusCode,503);
});
test('bonus cap is the minimum of balance, iiko permission and business limit',()=>{
  assert.equal(maxBonus({balance:500,allowedByIiko:400,subtotal:100000,limitType:'percent',limit:30}),300);
  assert.equal(maxBonus({balance:100,allowedByIiko:90,subtotal:100000,limitType:'amount',limit:200}),90);
});
test('T-Bank token matches official example; tampered amount fails',()=>{
  const b={TerminalKey:'MerchantTerminalKey',Amount:19200,OrderId:'00000',Description:'Подарочная карта на 1000 рублей',DATA:{Phone:'do-not-sign'}};
  assert.equal(tbankToken(b,'11111111111111'),'72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2');
  b.Token=tbankToken(b,'password');assert.equal(verifyTbank(b,'password'),true);b.Amount=1;assert.equal(verifyTbank(b,'password'),false);
});
test('AES-GCM rejects modified ciphertext and TOTP prevents replay',()=>{
  const encrypted=seal({key:'value'},config.key);assert.deepEqual(unseal(encrypted,config.key),{key:'value'});const parts=encrypted.split('.');parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);assert.throws(()=>unseal(parts.join('.'),config.key));
  const secret='JBSWY3DPEHPK3PXP',step=Math.floor(Date.now()/30000),code=totp(secret,step);assert.equal(verifyTotp(secret,code),step);assert.equal(verifyTotp(secret,code,step),null);
});
test('call verification is bound to tenant and proof, and is consumed exactly once',async()=>{
  const realFetch=globalThis.fetch;config.smsruKey='test-key-only';let status='400';
  globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/add')?{status:'OK',status_code:100,check_id:'test-call-id',call_phone:'78000000000'}:{status:'OK',status_code:100,check_status:status}),{status:200,headers:{'content-type':'application/json'}});
  try{
    const start=await app.inject({method:'POST',url:'/api/public/unagi/auth/call',payload:{phone:'+79000000001'}});assert.equal(start.statusCode,200,start.body);const {challengeId,proof}=start.json();
    const check=(tenant,p=proof)=>app.inject({method:'POST',url:'/api/public/'+tenant+'/auth/call/status',payload:{challengeId,proof:p}});
    assert.equal((await check('other')).statusCode,401);assert.equal((await check('unagi','0'.repeat(64))).statusCode,401);assert.equal((await check('unagi')).json().status,'waiting');
    status='401';const result=await check('unagi');assert.equal(result.json().status,'authenticated');assert.equal((await check('unagi')).statusCode,401);
    const bearer={authorization:'Bearer '+result.json().token};
    assert.equal((await app.inject({url:'/api/public/other/orders',headers:bearer})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/api/public/unagi/orders',headers:bearer,payload:input()})).statusCode,503);
    const customer=await one(db,"SELECT * FROM customers WHERE tenant_id='unagi'");assert.ok(!JSON.stringify(customer).includes('+79000000001'));
  }finally{globalThis.fetch=realFetch;config.smsruKey='';}
});
test('logout revokes server session immediately',async()=>{
  const headers=await login('operator@unagi.local');assert.equal((await req(headers,'POST','/api/auth/logout')).statusCode,200);assert.equal((await req(headers,'GET','/api/auth/me')).statusCode,401);
});

test('server first login can enroll 2FA while business endpoints stay protected',async()=>{
  const secureOrigin='https://example.invalid';
  const secure=await createApp({...config,production:true,origin:secureOrigin,trustProxy:['127.0.0.1']},db);
  try{
    const signed=await secure.inject({method:'POST',url:'/api/auth/login',headers:{origin:secureOrigin},payload:{email:'owner@unagi.local',password}});
    assert.equal(signed.statusCode,200);assert.equal(signed.cookies[0].secure,true);
    const cookie=signed.cookies[0].name+'='+signed.cookies[0].value;
    const me=await secure.inject({url:'/api/auth/me',headers:{cookie}});assert.equal(me.json().totpRequired,true);
    const headers={cookie,origin:secureOrigin,'x-csrf-token':me.json().csrf};
    assert.equal((await secure.inject({url:'/api/admin/unagi/overview',headers})).statusCode,403);
    const start=await secure.inject({method:'POST',url:'/api/auth/totp/start',headers});assert.equal(start.statusCode,200);
    const confirm=await secure.inject({method:'POST',url:'/api/auth/totp/confirm',headers,payload:{code:totp(start.json().secret)}});assert.equal(confirm.statusCode,200);
    assert.equal((await secure.inject({url:'/api/auth/me',headers})).json().totpRequired,false);
    assert.equal((await secure.inject({url:'/api/admin/unagi/overview',headers})).statusCode,200);
  }finally{await secure.close();}
});
