import { z } from 'zod';
import { one,rows,list,record } from './db.js';
import { id,hash,need } from './security.js';
import { orderInput } from './schemas.js';
import { calculate,canTransition } from './domain.js';
import { audit,event } from './audit.js';

export async function quote(db,tenant,input){
  const [t,b,branch,method,products]=await Promise.all([one(db,'SELECT * FROM tenants WHERE id=$1',[tenant]),record(db,tenant,'brand',input.brandId),record(db,tenant,'branch',input.branchId),record(db,tenant,'paymentMethod',input.methodId),list(db,tenant,'product')]);
  need(t&&t.accepting_orders,409,'Приём новых заказов временно остановлен');need(b&&branch&&method,400,'Бренд, точка или оплата не найдены');
  return {...calculate(input,b.data,branch.data,method.data,products.map(p=>({id:p.id,...p.data}))),brandName:b.data.name,branchName:branch.data.name,methodName:method.data.name,methodType:method.data.type};
}
export async function createSandbox(db,tenant,input,key,actor){
  need(typeof key==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(key),400,'Нужен Idempotency-Key от 8 до 100 символов');
  const fingerprint=hash(JSON.stringify(input));
  return db.transaction(async tx=>{
    // Tenant row lock serializes order creation with restriction changes and retry checks.
    await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant]);
    const existing=await one(tx,'SELECT * FROM orders WHERE tenant_id=$1 AND idempotency_key=$2',[tenant,key]);
    if(existing){need(existing.request_hash===fingerprint,409,'Ключ уже использован для другого заказа');return existing;}
    const result=await quote(tx,tenant,input),orderId=id();
    const data={...result,fulfillment:input.mode,scheduledAt:input.scheduledAt||null,table:input.table,comment:input.comment,
      // Sandbox stores no delivery address or phone. Live checkout requires a separate encrypted PII model.
      externalStatus:null,externalId:null,refunded:0};
    const order=await one(tx,`INSERT INTO orders(id,tenant_id,brand_id,branch_id,idempotency_key,request_hash,status,payment_status,mode,data,total)
      VALUES($1,$2,$3,$4,$5,$6,'new','unpaid','sandbox',$7::jsonb,$8) RETURNING *`,[orderId,tenant,input.brandId,input.branchId,key,fingerprint,JSON.stringify(data),result.total]);
    await event(tx,tenant,orderId,'sandbox.created');await audit(tx,tenant,actor,'order.sandbox-created',orderId);return order;
  });
}
export function registerOrders(app,db,config){
  app.get('/api/public/:tenant/config',async req=>{
    const tenant=await one(db,'SELECT id,name,accepting_orders FROM tenants WHERE id=$1',[req.params.tenant]);need(tenant,404,'Бизнес не найден');
    const brands=await list(db,tenant.id,'brand'),branches=await list(db,tenant.id,'branch'),themes=await list(db,tenant.id,'theme');
    return {business:tenant,mode:'sandbox',liveOrdersAvailable:config.liveOrders,brands:brands.filter(b=>b.data.active).map(b=>({id:b.id,name:b.data.name,description:b.data.description,theme:themes.find(t=>t.id===b.id)?.data.published||null})),
      branches:branches.filter(b=>b.data.active).map(b=>({id:b.id,brandId:b.data.brandId,name:b.data.name,address:b.data.address,modes:b.data.modes,acceptingOrders:b.data.acceptingOrders}))};
  });
  app.get('/api/public/:tenant/menu/:branch',async req=>{
    const b=await record(db,req.params.tenant,'branch',req.params.branch);need(b&&b.data.active,404,'Точка не найдена');
    return {mode:'sandbox',source:'demo',branchId:b.id,products:(await list(db,req.params.tenant,'product')).filter(p=>p.data.branchId===b.id).map(p=>({id:p.id,...p.data}))};
  });
  app.post('/api/public/:tenant/quote',async req=>{const input=orderInput.parse(req.body);return {mode:'sandbox',...await quote(db,req.params.tenant,input),liveOrdersAvailable:false};});
  app.post('/api/public/:tenant/orders',{preHandler:app.customer},async()=>{need(false,503,'Реальная отправка заказов ещё не подключена. Заказ не создан и деньги не списаны.','live_orders_not_ready');});
  app.get('/api/public/:tenant/orders',{preHandler:app.customer},async req=>rows(db,'SELECT id,status,payment_status,data,total,created_at FROM orders WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 100',[req.params.tenant,req.customer.customer_id]));
  app.get('/api/public/:tenant/loyalty',{preHandler:app.customer},async()=>({source:'iikoCard',available:false,balance:null,message:'Баланс недоступен до подключения iikoCard. Это не нулевой баланс.'}));
  app.get('/api/admin/:tenant/orders',async req=>{
    const tenant=await app.scope(req);const mode=z.enum(['sandbox','live']).default('sandbox').parse(req.query.mode);
    return rows(db,'SELECT * FROM orders WHERE tenant_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 300',[tenant,mode]);
  });
  app.get('/api/admin/:tenant/orders/:id',async req=>{const tenant=await app.scope(req),order=await one(db,'SELECT * FROM orders WHERE tenant_id=$1 AND id=$2',[tenant,req.params.id]);need(order,404,'Заказ не найден');return {...order,events:await rows(db,'SELECT type,details,created_at FROM events WHERE tenant_id=$1 AND order_id=$2 ORDER BY id',[tenant,order.id])};});
  app.post('/api/admin/:tenant/orders/sandbox',async req=>{const tenant=await app.scope(req,['owner','manager','operator']);return createSandbox(db,tenant,orderInput.parse(req.body),req.headers['idempotency-key'],req.user.id);});
  app.post('/api/admin/:tenant/orders/:id/action',async req=>{
    const tenant=await app.scope(req,['owner','manager','operator']),body=z.object({action:z.enum(['accepted','preparing','ready','delivering','completed','cancelled','mark_paid','refund']),revision:z.number().int().positive(),reason:z.string().trim().min(3).max(300)}).strict().parse(req.body);
    return db.transaction(async tx=>{
      const order=await one(tx,'SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,req.params.id]);need(order,404,'Заказ не найден');need(order.revision===body.revision,409,'Заказ уже изменился');need(order.mode==='sandbox',409,'Для реального заказа требуется подтверждение операции от iiko/банка');
      let status=order.status,payment=order.payment_status,data=order.data;
      if(body.action==='mark_paid'){need(payment==='unpaid'&&status!=='cancelled',409,'Оплата уже отмечена или заказ отменён');payment='paid';}
      else if(body.action==='refund'){need(['owner','manager','platform'].includes(req.user.role),403,'Нет права на возврат');need(payment==='paid',409,'Нет оплаченной суммы для возврата');payment='refunded';data={...data,refunded:order.total};}
      else {need(canTransition(status,body.action),409,'Недопустимая смена статуса');if(body.action==='completed')need(payment==='paid',409,'Сначала отметьте тестовую оплату');status=body.action;}
      const changed=await one(tx,'UPDATE orders SET status=$3,payment_status=$4,data=$5::jsonb,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenant,order.id,status,payment,JSON.stringify(data)]);
      await event(tx,tenant,order.id,'sandbox.'+body.action,{reason:body.reason,actor:req.user.id});await audit(tx,tenant,req.user.id,'order.'+body.action,order.id,{mode:'sandbox',reason:body.reason});return changed;
    });
  });
}
