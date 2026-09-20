import { z } from 'zod';
import { rows } from './db.js';
import { csv } from './domain.js';
import { need } from './security.js';
const query=z.object({from:z.string().date().optional(),to:z.string().date().optional(),mode:z.enum(['live','sandbox']).default('sandbox'),brandId:z.string().max(80).optional(),format:z.enum(['json','csv']).default('json')});
export function reports(orders){
  const group=(key,value=()=>1)=>{const map=new Map();for(const o of orders){const k=key(o);map.set(k,(map.get(k)||0)+value(o));}return [...map].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);};
  const completed=orders.filter(o=>o.status==='completed'),paid=orders.filter(o=>o.payment_status==='paid');
  const sum=arr=>arr.reduce((n,o)=>n+o.total,0),refunds=orders.reduce((n,o)=>n+(o.data.refunded||0),0);
  const items=new Map();for(const o of completed)for(const line of o.data.lines){const row=items.get(line.productId)||{label:line.name,quantity:0,value:0};row.quantity+=line.quantity;row.value+=line.sum;items.set(line.productId,row);}
  const date=o=>new Date(o.created_at).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
  return {summary:{orders:orders.length,completed:completed.length,cancelled:orders.filter(o=>o.status==='cancelled').length,orderValue:sum(orders),paid:sum(paid),refunds,average:completed.length?Math.round(sum(completed)/completed.length):0,delivery:completed.reduce((n,o)=>n+o.data.delivery,0)},
    byDay:group(date,o=>o.total).sort((a,b)=>a.label.localeCompare(b.label)),byHour:group(o=>new Date(o.created_at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit'})),
    byBrand:group(o=>o.data.brandName,o=>o.total),byBranch:group(o=>o.data.branchName,o=>o.total),byStatus:group(o=>o.status),byPayment:group(o=>o.data.methodName),byFulfillment:group(o=>o.data.fulfillment),
    products:[...items.values()].sort((a,b)=>b.value-a.value),coverage:'Только заказы этой платформы, не вся выручка iiko',timezone:'Europe/Moscow',
    unavailable:['Себестоимость и прибыль: нет данных iiko','Воронка и брошенные корзины: события мобильного приложения ещё не подключены','Лояльность: нет данных iikoCard']};
}
export function registerReports(app,db){
  app.get('/api/admin/:tenant/reports',async(req,reply)=>{
    const tenant=await app.scope(req,['owner','manager','analyst']),q=query.parse(req.query);
    const from=q.from||'2020-01-01',to=q.to||new Date().toISOString().slice(0,10);need(from<=to,400,'Начало периода позже окончания');
    const result=await rows(db,`SELECT * FROM orders WHERE tenant_id=$1 AND mode=$2 AND created_at>=($3::date::timestamp AT TIME ZONE 'Europe/Moscow')
      AND created_at<(($4::date+1)::timestamp AT TIME ZONE 'Europe/Moscow') AND ($5::text IS NULL OR brand_id=$5) ORDER BY created_at`,[tenant,q.mode,from,to,q.brandId||null]);
    if(q.format==='csv'){reply.header('content-type','text/csv; charset=utf-8').header('content-disposition','attachment; filename="orders.csv"');return csv(['ID','Дата','Бренд','Точка','Статус','Оплата','Сумма ₽','Режим'],result.map(o=>[o.id,new Date(o.created_at).toISOString(),o.data.brandName,o.data.branchName,o.status,o.payment_status,(o.total/100).toFixed(2),o.mode]));}
    return {from,to,mode:q.mode,...reports(result)};
  });
}
