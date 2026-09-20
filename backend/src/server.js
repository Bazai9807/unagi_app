import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration,root } from './config.js';
import { database,one } from './db.js';
import { registerAuth } from './auth.js';
import { registerAdmin } from './admin.js';
import { registerOrders } from './orders.js';
import { registerReports } from './reports.js';
import { registerBilling,queueReminders,deliverOne } from './billing.js';
import { ZodError } from 'zod';

export async function createApp(config,db){
  const app=Fastify({logger:false,bodyLimit:256*1024,trustProxy:config.trustProxy||false});
  await app.register(cookie);
  await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('x-content-type-options','nosniff').header('referrer-policy','no-referrer').header('x-frame-options','DENY');
    reply.header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(req.url.startsWith('/api/'))reply.header('cache-control','no-store');
    if(config.production)reply.header('strict-transport-security','max-age=31536000');
  });
  app.setErrorHandler((error,req,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:'validation',message:'Проверьте заполнение полей',fields:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
    if(error.code==='23505')return reply.code(409).send({error:'conflict',message:'Такая запись уже существует'});
    if(error.code==='23503')return reply.code(400).send({error:'reference',message:'Связанная запись не найдена'});
    const status=error.statusCode||500;
    // Never echo SQL, provider bodies, credentials, or personal data into logs/client responses.
    if(status>=500)process.stderr.write(JSON.stringify({time:new Date().toISOString(),event:'request_failed',requestId:req.id,route:req.routeOptions.url,code:error.code||'internal'})+'\n');
    reply.code(status).send({error:error.code||'internal',message:status===500?'Внутренняя ошибка. Код: '+req.id:error.message,requestId:req.id});
  });
  registerAuth(app,db,config);registerAdmin(app,db,config);registerOrders(app,db,config);registerReports(app,db);registerBilling(app,db);
  app.get('/health',async()=>{await one(db,'SELECT 1 AS healthy');return {status:'ok'};});
  await app.register(staticFiles,{root:path.join(root,'public'),prefix:'/assets/',index:false,dotfiles:'deny'});
  for(const route of ['/','/platform','/business'])app.get(route,async(req,reply)=>reply.sendFile('index.html'));
  return app;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const config=configuration(),db=await database(config),app=await createApp(config,db);
  await app.listen({host:config.host,port:config.port});
  console.log('UNAGI platform: '+config.origin+' — live orders disabled pending integration verification');
  let busy=false;
  const worker=setInterval(async()=>{if(busy)return;busy=true;try{await queueReminders(db);await deliverOne(db,config);await db.query('DELETE FROM rate_buckets WHERE expires_at<now()');await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query('DELETE FROM customer_sessions WHERE expires_at<now()');await db.query('DELETE FROM call_challenges WHERE expires_at<now()');}catch{console.error('Background worker failed; inspect configuration');}finally{busy=false;}},60000);
  const shutdown=async()=>{clearInterval(worker);await app.close();while(busy)await new Promise(r=>setTimeout(r,25));await db.close();};
  process.once('SIGINT',()=>shutdown().then(()=>process.exit(0)));process.once('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
}
