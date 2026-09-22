import nodemailer from 'nodemailer';
import { z } from 'zod';
import { list,one,rows } from './db.js';
import { id,need } from './security.js';
import { audit } from './audit.js';

export async function generateInvoice(db,tenant,period){
  need(/^\d{4}-(0[1-9]|1[0-2])$/.test(period),400,'Неверный период');
  return db.transaction(async tx=>{
    await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant]);
    const existing=await one(tx,'SELECT * FROM invoices WHERE tenant_id=$1 AND period=$2',[tenant,period]);if(existing)return existing;
    const start=period+'-01',end=new Date(start+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);
    const plans=(await list(tx,tenant,'tariff')).map(r=>r.data).filter(p=>p.effectiveFrom<=start).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));need(plans.length,409,'Нет тарифа на начало периода');const plan=plans[0];
    // Commission invoices only close completed periods; refunded orders contribute their net remaining amount.
    need(plan.type!=='commission'||end<=new Date(),409,'Процент рассчитывается после окончания месяца');
    const orders=await rows(tx,`SELECT total,data FROM orders WHERE tenant_id=$1 AND mode='live' AND status='completed' AND created_at>=($2::date::timestamp AT TIME ZONE 'Europe/Moscow') AND created_at<($3::date::timestamp AT TIME ZONE 'Europe/Moscow')`,[tenant,start,end.toISOString().slice(0,10)]);
    const base=orders.reduce((sum,o)=>sum+Math.max(0,o.total-(o.data.refunded||0)-(plan.includeDelivery?0:o.data.delivery)),0);
    const amount=plan.type==='subscription'?plan.monthly:Math.round(base*plan.commissionBps/10000);
    const due=new Date((plan.type==='subscription'?start:end.toISOString().slice(0,10))+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+7);
    return one(tx,'INSERT INTO invoices(id,tenant_id,period,amount,due_at,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',[id(),tenant,period,amount,due.toISOString(),JSON.stringify({plan,base,orderCount:orders.length})]);
  });
}
export async function queueReminders(db,now=new Date()){
  const overdue=await rows(db,'SELECT i.*,t.email,t.name FROM invoices i JOIN tenants t ON t.id=i.tenant_id WHERE i.status=\'unpaid\' AND i.due_at<$1',[now.toISOString()]);
  const day=now.toISOString().slice(0,10);let count=0;
  for(const invoice of overdue){const result=await db.query(`INSERT INTO outbox(id,tenant_id,dedup_key,recipient,subject,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedup_key) DO NOTHING RETURNING id`,[id(),invoice.tenant_id,'invoice:'+invoice.id+':'+day,invoice.email,'Напоминание об оплате платформы за '+invoice.period,`${invoice.name}, напоминаем об оплате услуг за ${invoice.period}. Сумма: ${(invoice.amount/100).toFixed(2)} ₽. Номер счёта: ${invoice.id}. Автоматическое отключение приложения не производится. Реквизиты и детали оплаты — в вашем договоре с оператором платформы.`]);count+=result.rows.length;}
  return count;
}
export async function deliverOne(db,config){
  if(!config.sendEmail||!config.smtpHost||!config.mailFrom)return false;
  const job=await db.transaction(async tx=>{const row=await one(tx,"SELECT * FROM outbox WHERE status='pending' AND next_attempt<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");if(row)await tx.query("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=$1",[row.id]);return row;});if(!job)return false;
  const smtp=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,requireTLS:config.smtpPort!==465,auth:config.smtpUser?{user:config.smtpUser,pass:config.smtpPassword}:undefined,connectionTimeout:10000,socketTimeout:15000});
  try{await smtp.sendMail({from:config.mailFrom,to:job.recipient,subject:job.subject,text:job.body,messageId:job.id+'@'+new URL(config.origin).hostname});await db.query("UPDATE outbox SET status='sent',last_error=NULL WHERE id=$1",[job.id]);}
  catch{await db.query("UPDATE outbox SET status='unknown',last_error='SMTP result unknown: inspect before retry' WHERE id=$1",[job.id]);}
  finally{smtp.close();}return true;
}
export function registerBilling(app,db){
  app.get('/api/admin/:tenant/invoices',async req=>{const tenant=await app.scope(req,['owner']);return rows(db,'SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC',[tenant]);});
  app.post('/api/admin/:tenant/invoices',async req=>{await app.platform(req);const b=z.object({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).parse(req.body);const invoice=await generateInvoice(db,req.params.tenant,b.period);await audit(db,req.params.tenant,req.user.id,'invoice.generated',invoice.id);return invoice;});
  app.post('/api/admin/:tenant/invoices/:id/paid',async req=>{await app.platform(req);const b=z.object({reference:z.string().trim().min(3).max(200)}).parse(req.body);
    return db.transaction(async tx=>{const result=await one(tx,"UPDATE invoices SET status='paid',data=data||$3::jsonb WHERE tenant_id=$1 AND id=$2 AND status='unpaid' RETURNING *",[req.params.tenant,req.params.id,JSON.stringify({paymentReference:b.reference})]);need(result,409,'Счёт не найден или уже оплачен');await tx.query("UPDATE outbox SET status='cancelled' WHERE tenant_id=$1 AND dedup_key LIKE $2 AND status='pending'",[req.params.tenant,'invoice:'+req.params.id+':%']);await audit(tx,req.params.tenant,req.user.id,'invoice.paid',req.params.id);return result;});});
  app.get('/api/platform/mail',{preHandler:app.platform},async()=>rows(db,'SELECT id,tenant_id,recipient,subject,body,status,attempts,last_error,created_at FROM outbox ORDER BY created_at DESC LIMIT 100'));
  app.post('/api/platform/mail/reminders',{preHandler:app.platform},async req=>{const count=await queueReminders(db);await audit(db,null,req.user.id,'mail.reminders-queued','platform',{count});return {queued:count};});
}
