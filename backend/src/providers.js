import { createHash } from 'node:crypto';
import { need, equal, Problem } from './security.js';

export async function post(url,body,headers={}) {
  let response;
  try {response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});}
  catch {throw new Problem(502,'Провайдер не ответил. Результат операции нужно уточнить.','provider_unknown');}
  need(response.ok,502,'Провайдер вернул ошибку','provider_error');
  try{return await response.json();}catch{throw new Problem(502,'Некорректный ответ провайдера','provider_error');}
}
// T-Bank's Token signs only root scalar fields plus Password, sorted by key.
export function tbankToken(body,password) {
  const scalars={...body,Password:password}; delete scalars.Token;
  const string=Object.keys(scalars).filter(k=>scalars[k]!==null&&typeof scalars[k]!=='object').sort().map(k=>String(scalars[k])).join('');
  return createHash('sha256').update(string).digest('hex');
}
export function verifyTbank(body,password){return typeof body.Token==='string'&&equal(body.Token.toLowerCase(),tbankToken(body,password));}
export async function tbank(method,body,credentials) {
  need(['Init','GetState','GetQr','Cancel'].includes(method),400,'Метод оплаты не разрешён');
  const request={...body,TerminalKey:credentials.terminalKey};request.Token=tbankToken(request,credentials.password);
  const result=await post('https://securepay.tinkoff.ru/v2/'+method,request);
  need(result.Success===true,502,'Т-Банк отклонил запрос','payment_provider_error');return result;
}
export async function callcheck(method,body,key) {
  need(key,503,'Провайдер авторизации звонком ещё не настроен','call_not_configured');
  need(['add','status'].includes(method),400,'Неверный метод');
  const payload=new URLSearchParams({...body,api_id:key,json:'1'});
  let response;
  try{response=await fetch('https://sms.ru/callcheck/'+method,{method:'POST',body:payload,signal:AbortSignal.timeout(15000),redirect:'error'});}
  catch{throw new Problem(502,'Сервис проверки звонка недоступен');}
  need(response.ok,502,'Ошибка проверки звонка');const result=await response.json();
  need(result.status==='OK'&&Number(result.status_code)===100,502,'Провайдер не создал или не нашёл проверку');return result;
}
export async function iikoRead(method,body,credentials) {
  // Read-only adapter. Creating production orders is separately gated until tenant mappings are verified.
  need(['/api/1/organizations','/api/1/terminal_groups','/api/2/menu','/api/2/menu/by_id','/api/1/payment_types'].includes(method),400,'Метод не разрешён');
  const auth=await post('https://api-ru.iiko.services/api/1/access_token',{apiLogin:credentials.apiLogin});
  need(auth.token,502,'iiko не вернула токен');
  return post('https://api-ru.iiko.services'+method,body,{Authorization:'Bearer '+auth.token});
}
