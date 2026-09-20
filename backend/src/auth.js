import { z } from 'zod';
import { one } from './db.js';
import { id,token,hash,keyedHash,seal,unseal,checkPassword,verifyTotp,totpSecret,need,phone } from './security.js';
import { callcheck } from './providers.js';
import { audit } from './audit.js';

export async function throttle(db,key,maximum=10,seconds=900){
  const bucket=await one(db,`INSERT INTO rate_buckets(key,count,expires_at) VALUES($1,1,now()+($2*interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_buckets.expires_at<now() THEN 1 ELSE rate_buckets.count+1 END,
    expires_at=CASE WHEN rate_buckets.expires_at<now() THEN now()+($2*interval '1 second') ELSE rate_buckets.expires_at END RETURNING count`,[key,seconds]);
  need(bucket.count<=maximum,429,'Слишком много попыток. Попробуйте позже.');
}
export function registerAuth(app,db,config){
  app.decorate('admin',async request=>{
    const raw=request.cookies.unagi_session;need(raw,401,'Войдите в кабинет');
    const user=await one(db,`SELECT u.id,u.email,u.name,u.role,u.tenant_id,u.totp_secret,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[hash(raw)]);
    need(user,401,'Сессия истекла');
    if(!['GET','HEAD'].includes(request.method))need(request.headers.origin===config.origin&&request.headers['x-csrf-token']===user.csrf,403,'Проверка запроса не пройдена');
    request.user=user;
    if(config.production&&!user.totp_secret&&!request.url.startsWith('/api/auth/'))need(false,403,'Включите двухфакторную защиту');
  });
  app.decorate('scope',async(request,roles=['owner','manager','operator','analyst'])=>{
    await app.admin(request);const tenant=request.params.tenant;
    need(request.user.role==='platform'||(roles.includes(request.user.role)&&request.user.tenant_id===tenant),403,'Нет доступа к этому бизнесу');
    need(await one(db,'SELECT id FROM tenants WHERE id=$1',[tenant]),404,'Бизнес не найден');
    return tenant;
  });
  app.decorate('platform',async request=>{await app.admin(request);need(request.user.role==='platform',403,'Доступ только оператору платформы');});
  app.decorate('customer',async request=>{
    const raw=(request.headers.authorization||'').replace(/^Bearer /,'');need(raw,401,'Войдите по номеру телефона');
    const session=await one(db,'SELECT tenant_id,customer_id FROM customer_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(raw)]);
    need(session&&session.tenant_id===request.params.tenant,401,'Сессия покупателя недействительна');request.customer=session;
  });
  app.post('/api/auth/login',async(req,reply)=>{
    need(req.headers.origin===config.origin,403,'Неверный источник входа');
    const body=z.object({email:z.string().email().max(200),password:z.string().min(1).max(200),code:z.string().regex(/^\d{6}$/).optional()}).parse(req.body);
    await throttle(db,'login-ip:'+hash(req.ip),30);await throttle(db,'login-email:'+hash(body.email.toLowerCase()),10);
    const user=await one(db,'SELECT * FROM users WHERE email=$1',[body.email.toLowerCase()]);
    const valid=await checkPassword(body.password,user?.password);need(valid&&user?.active,401,'Неверные данные входа');
    if(user.totp_secret){const step=verifyTotp(unseal(user.totp_secret,config.key),body.code||'',user.totp_step);need(step!==null,401,'Требуется действующий код двухфакторной защиты');
      const result=await one(db,'UPDATE users SET totp_step=$2 WHERE id=$1 AND (totp_step IS NULL OR totp_step<$2) RETURNING id',[user.id,step]);need(result,401,'Код уже использован');}
    const raw=token(),csrf=token();await db.query('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[hash(raw),user.id,csrf]);
    await audit(db,user.tenant_id,user.id,'auth.login',user.id);
    reply.setCookie('unagi_session',raw,{httpOnly:true,sameSite:'strict',secure:config.production,path:'/',maxAge:28800});return {ok:true};
  });
  app.get('/api/auth/me',{preHandler:app.admin},async req=>({id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role,tenantId:req.user.tenant_id,csrf:req.user.csrf,totpEnabled:!!req.user.totp_secret}));
  app.post('/api/auth/logout',{preHandler:app.admin},async(req,reply)=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.unagi_session)]);reply.clearCookie('unagi_session',{path:'/'});return {ok:true};});
  app.post('/api/auth/totp/start',{preHandler:app.admin},async req=>{
    need(!req.user.totp_secret,409,'Двухфакторная защита уже включена');const secret=totpSecret();await db.query('UPDATE users SET totp_pending=$2 WHERE id=$1',[req.user.id,seal(secret,config.key)]);
    return {secret,uri:'otpauth://totp/Unagi:'+encodeURIComponent(req.user.email)+'?secret='+secret+'&issuer=Unagi'};
  });
  app.post('/api/auth/totp/confirm',{preHandler:app.admin},async req=>{
    const body=z.object({code:z.string().regex(/^\d{6}$/)}).parse(req.body);await throttle(db,'totp:'+req.user.id,10);
    const u=await one(db,'SELECT totp_pending,totp_secret FROM users WHERE id=$1',[req.user.id]);need(u.totp_pending&&!u.totp_secret,409,'Сначала начните подключение');
    const step=verifyTotp(unseal(u.totp_pending,config.key),body.code);need(step!==null,400,'Неверный код');
    await db.query('UPDATE users SET totp_secret=totp_pending,totp_pending=NULL,totp_step=$2 WHERE id=$1',[req.user.id,step]);
    await db.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2',[req.user.id,hash(req.cookies.unagi_session)]);
    await audit(db,req.user.tenant_id,req.user.id,'auth.totp.enabled',req.user.id);return {ok:true};
  });
  app.post('/api/public/:tenant/auth/call',async req=>{
    const tenant=req.params.tenant;need(await one(db,'SELECT id FROM tenants WHERE id=$1',[tenant]),404,'Бизнес не найден');
    const p=phone(z.object({phone:z.string().max(30)}).parse(req.body).phone);
    await throttle(db,'call-ip:'+hash(req.ip),10);await throttle(db,'call-phone:'+keyedHash(p,config.key),4);
    return db.transaction(async tx=>{
      // Serialize challenges for this phone across businesses to avoid ambiguous simultaneous verifications.
      await tx.query('SELECT key FROM rate_buckets WHERE key=$1 FOR UPDATE',['call-phone:'+keyedHash(p,config.key)]);
      const active=await one(tx,'SELECT id FROM call_challenges WHERE phone_hash=$1 AND expires_at>now() AND consumed=false',[keyedHash(p,config.key)]);
      need(!active,409,'Для номера уже ожидается звонок. Завершите текущую проверку или дождитесь её окончания.');
      const result=await callcheck('add',{phone:p.slice(1),ip:req.ip},config.smsruKey);
      need(typeof result.check_id==='string'&&/^\d{10,15}$/.test(String(result.call_phone)),502,'Некорректный ответ сервиса звонков');
      const challenge=id(),proof=token();await tx.query(`INSERT INTO call_challenges(id,tenant_id,proof_hash,phone_hash,phone_encrypted,provider_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')`,[challenge,tenant,hash(proof),keyedHash(p,config.key),seal(p,config.key),result.check_id]);
      return {challengeId:challenge,proof,callTo:'+'+result.call_phone,expiresIn:300};
    });
  });
  app.post('/api/public/:tenant/auth/call/status',async req=>{
    const body=z.object({challengeId:z.string().uuid(),proof:z.string().length(64)}).parse(req.body);
    await throttle(db,'call-poll:'+hash(req.ip),120,300);
    const challenge=await one(db,'SELECT * FROM call_challenges WHERE id=$1 AND tenant_id=$2 AND proof_hash=$3 AND expires_at>now() AND consumed=false',[body.challengeId,req.params.tenant,hash(body.proof)]);
    need(challenge,401,'Проверка истекла или уже использована');
    const result=await callcheck('status',{check_id:challenge.provider_id},config.smsruKey);
    if(Number(result.check_status)!==401)return {status:'waiting'};
    return db.transaction(async tx=>{
      const consumed=await one(tx,'UPDATE call_challenges SET consumed=true WHERE id=$1 AND consumed=false AND expires_at>now() RETURNING id',[challenge.id]);need(consumed,401,'Проверка уже использована');
      const customer=await one(tx,`INSERT INTO customers(id,tenant_id,phone_hash,phone_encrypted) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id,phone_hash) DO UPDATE SET phone_encrypted=EXCLUDED.phone_encrypted RETURNING id`,[id(),challenge.tenant_id,challenge.phone_hash,challenge.phone_encrypted]);
      const bearer=token();await tx.query(`INSERT INTO customer_sessions(token_hash,tenant_id,customer_id,expires_at) VALUES($1,$2,$3,now()+interval '30 days')`,[hash(bearer),challenge.tenant_id,customer.id]);
      return {status:'authenticated',token:bearer,expiresIn:2592000};
    });
  });
  app.post('/api/public/:tenant/auth/logout',{preHandler:app.customer},async req=>{await db.query('DELETE FROM customer_sessions WHERE token_hash=$1',[hash(req.headers.authorization.replace(/^Bearer /,''))]);return {ok:true};});
}
