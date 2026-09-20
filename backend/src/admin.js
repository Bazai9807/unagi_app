import { z } from 'zod';
import { rows,one,list,record,insert,update } from './db.js';
import { schemas,theme,revisionBody,resourceId } from './schemas.js';
import { id,need,seal,unseal,passwordHash } from './security.js';
import { audit } from './audit.js';
import { iikoRead } from './providers.js';

export function registerAdmin(app,db,config){
  app.get('/api/platform/tenants',{preHandler:app.platform},async()=>rows(db,'SELECT * FROM tenants ORDER BY created_at'));
  app.post('/api/platform/tenants',{preHandler:app.platform},async req=>{
    const b=z.object({id:resourceId,name:z.string().trim().min(1).max(120),email:z.string().email().max(200)}).strict().parse(req.body);
    return db.transaction(async tx=>{const tenant=await one(tx,'INSERT INTO tenants(id,name,email) VALUES($1,$2,$3) RETURNING *',[b.id,b.name,b.email]);await audit(tx,b.id,req.user.id,'tenant.created',b.id);return tenant;});
  });
  app.patch('/api/platform/tenants/:tenant',{preHandler:app.platform},async req=>{
    const b=z.object({acceptingOrders:z.boolean(),disabledFeatures:z.array(z.enum(['promotions','theme'])).max(2),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body);
    return db.transaction(async tx=>{const tenant=await one(tx,'UPDATE tenants SET accepting_orders=$2, disabled_features=$3::jsonb,restriction_reason=$4 WHERE id=$1 RETURNING *',[req.params.tenant,b.acceptingOrders,JSON.stringify(b.disabledFeatures),b.reason]);need(tenant,404,'Бизнес не найден');await audit(tx,req.params.tenant,req.user.id,'tenant.restrictions',req.params.tenant,{acceptingOrders:b.acceptingOrders,disabledFeatures:b.disabledFeatures,reason:b.reason});return tenant;});
  });
  app.get('/api/admin/:tenant/overview',async req=>{
    const tenant=await app.scope(req);const tenantData=await one(db,'SELECT * FROM tenants WHERE id=$1',[tenant]);
    const [brands,branches,methods,integrations]=await Promise.all([list(db,tenant,'brand'),list(db,tenant,'branch'),list(db,tenant,'paymentMethod'),list(db,tenant,'integration')]);
    return {tenant:tenantData,brands,branches,methods,integrations:integrations.map(r=>({id:r.id,provider:r.data.provider,brandId:r.data.brandId,configured:true,verified:false})),
      capabilities:{orders:'sandbox',payments:'not_verified',loyalty:'not_connected',call:config.smsruKey?'configured_not_verified':'not_configured',email:config.sendEmail&&config.smtpHost?'configured':'preview'},
      release:'0.2.0-local',production:config.production};
  });
  const writeRoles=['owner','manager'];
  for(const [kind,schema] of Object.entries(schemas)){
    app.get('/api/admin/:tenant/'+kind,async req=>{const tenant=await app.scope(req);return list(db,tenant,kind);});
    app.post('/api/admin/:tenant/'+kind,async req=>{
      const tenant=await app.scope(req,writeRoles);if(kind==='tariff')need(req.user.role==='platform',403,'Тариф назначает оператор платформы');
      const data=schema.parse(req.body);const recordId=id();
      return db.transaction(async tx=>{
        if(data.brandId)need(await record(tx,tenant,'brand',data.brandId),400,'Бренд не найден');
          if(kind==='tariff'){
            await one(tx,'SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant]);
            const plans=await list(tx,tenant,'tariff');
          need(!plans.some(p=>p.data.effectiveFrom===data.effectiveFrom),409,'На эту дату уже назначен тариф');
        }
        const tenantRow=await one(tx,'SELECT disabled_features FROM tenants WHERE id=$1',[tenant]);if(kind==='promo')need(!tenantRow.disabled_features.includes('promotions'),403,'Управление акциями ограничено оператором');
        const created=await insert(tx,tenant,kind,recordId,data);await audit(tx,tenant,req.user.id,kind+'.created',recordId);
        if(kind==='brand'){await insert(tx,tenant,'theme',recordId,{draft:theme.parse({}),published:null,history:[]});}
        return created;
      });
    });
    app.put('/api/admin/:tenant/'+kind+'/:id',async req=>{
      const tenant=await app.scope(req,writeRoles);need(kind!=='tariff',409,'Создайте новый тариф с датой вступления; история тарифов неизменяема');
      const b=revisionBody(schema).parse(req.body);
      return db.transaction(async tx=>{
        const existing=await record(tx,tenant,kind,req.params.id);need(existing,404,'Запись не найдена');
        if(b.data.brandId)need(existing.data.brandId===b.data.brandId,400,'Перенос между брендами запрещён; создайте новую запись');
        const tenantRow=await one(tx,'SELECT disabled_features FROM tenants WHERE id=$1',[tenant]);if(kind==='promo')need(!tenantRow.disabled_features.includes('promotions'),403,'Управление акциями ограничено');
        const result=await update(tx,tenant,kind,req.params.id,b.data,b.revision);need(result,409,'Данные изменились. Обновите страницу.');
        await audit(tx,tenant,req.user.id,kind+'.updated',req.params.id,{revision:result.revision});return result;
      });
    });
  }
  app.get('/api/admin/:tenant/themes/:brand',async req=>{const tenant=await app.scope(req);const result=await record(db,tenant,'theme',req.params.brand);need(result,404,'Бренд не найден');return result;});
  app.put('/api/admin/:tenant/themes/:brand',async req=>{
    const tenant=await app.scope(req,writeRoles),b=revisionBody(theme).parse(req.body);
    return db.transaction(async tx=>{const t=await one(tx,'SELECT disabled_features FROM tenants WHERE id=$1',[tenant]);need(!t.disabled_features.includes('theme'),403,'Оформление ограничено');
      const old=await record(tx,tenant,'theme',req.params.brand);need(old,404,'Бренд не найден');const result=await update(tx,tenant,'theme',old.id,{...old.data,draft:b.data},b.revision);need(result,409,'Данные изменились');await audit(tx,tenant,req.user.id,'theme.draft',old.id);return result;});
  });
  app.post('/api/admin/:tenant/themes/:brand/publish',async req=>{
    const tenant=await app.scope(req,writeRoles),b=z.object({revision:z.number().int().positive(),restoreVersion:z.number().int().positive().optional()}).parse(req.body);
    return db.transaction(async tx=>{const t=await one(tx,'SELECT disabled_features FROM tenants WHERE id=$1',[tenant]);need(!t.disabled_features.includes('theme'),403,'Оформление ограничено');
      const old=await record(tx,tenant,'theme',req.params.brand);need(old,404,'Бренд не найден');
      const selected=b.restoreVersion?old.data.history.find(h=>h.version===b.restoreVersion)?.theme:old.data.draft;need(selected,404,'Версия не найдена');
      const version=(old.data.history.at(-1)?.version||0)+1;const history=[...old.data.history,{version,theme:selected,at:new Date().toISOString(),actor:req.user.id}].slice(-30);
      const result=await update(tx,tenant,'theme',old.id,{draft:selected,published:selected,version,history},b.revision);need(result,409,'Данные изменились');await audit(tx,tenant,req.user.id,b.restoreVersion?'theme.restored':'theme.published',old.id,{version});return result;
    });
  });
  app.get('/api/admin/:tenant/audit',async req=>{const tenant=await app.scope(req,['owner','manager']);return rows(db,'SELECT * FROM audit WHERE tenant_id=$1 ORDER BY id DESC LIMIT 200',[tenant]);});
  app.get('/api/platform/audit',{preHandler:app.platform},async()=>rows(db,'SELECT * FROM audit ORDER BY id DESC LIMIT 200'));
  app.get('/api/admin/:tenant/users',async req=>{const tenant=await app.scope(req,['owner']);return rows(db,'SELECT id,name,email,role,active,created_at FROM users WHERE tenant_id=$1 ORDER BY created_at',[tenant]);});
  app.post('/api/admin/:tenant/users',async req=>{
    const tenant=await app.scope(req,['owner']);const b=z.object({name:z.string().min(1).max(100),email:z.string().email().max(200),role:z.enum(['owner','manager','operator','analyst']),password:z.string().min(14).max(200)}).strict().parse(req.body);
    const password=await passwordHash(b.password),userId=id();
    return db.transaction(async tx=>{await tx.query('INSERT INTO users(id,name,email,role,password,tenant_id) VALUES($1,$2,$3,$4,$5,$6)',[userId,b.name,b.email.toLowerCase(),b.role,password,tenant]);await audit(tx,tenant,req.user.id,'user.created',userId,{role:b.role});return {id:userId};});
  });
  app.patch('/api/admin/:tenant/users/:id',async req=>{
    const tenant=await app.scope(req,['owner']),b=z.object({active:z.boolean()}).strict().parse(req.body);need(req.params.id!==req.user.id,400,'Нельзя отключить свою учётную запись');
    return db.transaction(async tx=>{const target=await one(tx,'SELECT role FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[req.params.id,tenant]);need(target,404,'Пользователь не найден');
      need(target.role!=='owner'||req.user.role==='platform',403,'Учётную запись владельца меняет оператор платформы');
      await tx.query('UPDATE users SET active=$3 WHERE id=$1 AND tenant_id=$2',[req.params.id,tenant,b.active]);await tx.query('DELETE FROM sessions WHERE user_id=$1',[req.params.id]);await audit(tx,tenant,req.user.id,'user.active',req.params.id,{active:b.active});return {ok:true};});
  });
  app.post('/api/admin/:tenant/integrations',async req=>{
    const tenant=await app.scope(req,['owner']),b=z.discriminatedUnion('provider',[
      z.object({provider:z.literal('iiko'),brandId:resourceId,apiLogin:z.string().min(1).max(1000)}).strict(),
      z.object({provider:z.literal('tbank'),brandId:resourceId,terminalKey:z.string().min(1).max(100),password:z.string().min(1).max(1000)}).strict(),
    ]).parse(req.body);need(await record(db,tenant,'brand',b.brandId),404,'Бренд не найден');
    const key=b.provider+'_'+b.brandId;const data={provider:b.provider,brandId:b.brandId,secret:seal(b,config.key)};
    return db.transaction(async tx=>{const old=await record(tx,tenant,'integration',key);if(old){need(await update(tx,tenant,'integration',key,data,old.revision),409,'Настройки изменились');}else await insert(tx,tenant,'integration',key,data);await audit(tx,tenant,req.user.id,'integration.credentials',key);return {configured:true,verified:false};});
  });
  app.post('/api/admin/:tenant/integrations/:brand/check-iiko',async req=>{
    const tenant=await app.scope(req,['owner']),r=await record(db,tenant,'integration','iiko_'+req.params.brand);need(r,409,'Укажите API-ключ iiko');
    const response=await iikoRead('/api/1/organizations',{},unseal(r.data.secret,config.key));
    await audit(db,tenant,req.user.id,'integration.iiko.read-check',req.params.brand);
    return {organizations:(response.organizations||[]).map(o=>({id:o.id,name:o.name})),orderIntegrationVerified:false};
  });
  app.get('/api/admin/:tenant/catalog',async req=>{const tenant=await app.scope(req);return list(db,tenant,'product');});
  app.post('/api/admin/:tenant/integrations/:brand/menu-preview',async req=>{
    const tenant=await app.scope(req,['owner','manager']),brand=await record(db,tenant,'brand',req.params.brand),r=await record(db,tenant,'integration','iiko_'+req.params.brand);
    need(brand&&r&&brand.data.menuId&&brand.data.organizationId,409,'Заполните ключ, организацию и внешнее меню iiko');
    const result=await iikoRead('/api/2/menu/by_id',{externalMenuId:brand.data.menuId,organizationIds:[brand.data.organizationId],...(brand.data.priceCategoryId?{priceCategoryId:brand.data.priceCategoryId}:{})},unseal(r.data.secret,config.key));
    const snapshotId=id();await insert(db,tenant,'menuSnapshot',snapshotId,{brandId:brand.id,receivedAt:new Date().toISOString(),source:'iiko',payload:result});await audit(db,tenant,req.user.id,'menu.snapshot',snapshotId);
    return {id:snapshotId,message:'Снимок получен. Публикация требует проверки размеров, модификаторов и привязки цен к точке.',categories:(result.itemCategories||[]).map(c=>({id:c.id,name:c.name,items:(c.items||[]).length}))};
  });
}
