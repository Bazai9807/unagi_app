import { randomBytes, randomUUID, createHash, createHmac, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
export const scrypt = promisify(scryptCallback);
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const keyedHash = (value,key) => createHmac('sha256',Buffer.from(key,'hex')).update(String(value)).digest('hex');
export const equal = (a,b) => typeof a==='string' && typeof b==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function passwordHash(password) { const salt=token(); return salt+':'+(await scrypt(password,salt,64)).toString('hex'); }
export async function checkPassword(password, encoded) {
  const [salt,expected] = (encoded || 'invalid:').split(':');
  const actual=(await scrypt(password,salt,64)).toString('hex');
  return equal(actual,expected);
}
export function seal(value,key) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.');
}
export function unseal(value,key) {
  const [iv,tag,body]=value.split('.'); const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'hex'));
  decipher.setAuthTag(Buffer.from(tag,'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'hex')),decipher.final()]).toString('utf8'));
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buffer) { let bits=''; for(const byte of buffer)bits+=byte.toString(2).padStart(8,'0'); return bits.match(/.{1,5}/g).map(part=>alphabet[parseInt(part.padEnd(5,'0'),2)]).join(''); }
function decode32(str) { let bits=''; for(const c of str)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0'); return Buffer.from((bits.match(/.{8}/g)||[]).map(b=>parseInt(b,2))); }
export const totpSecret = () => base32(randomBytes(20));
export function totp(secret,step=Math.floor(Date.now()/30000)) {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step)); const digest=createHmac('sha1',decode32(secret)).update(counter).digest();
  const n=digest.readUInt32BE(digest[19]&15)&0x7fffffff; return String(n%1000000).padStart(6,'0');
}
export function verifyTotp(secret,code,lastStep=-1) {
  const now=Math.floor(Date.now()/30000);
  for(const step of [now-1,now,now+1]) if(step>Number(lastStep ?? -1) && equal(totp(secret,step),code))return step;
  return null;
}
export class Problem extends Error { constructor(status,message,code='request_error'){super(message);this.statusCode=status;this.code=code;} }
export const need = (condition,status,message,code) => { if(!condition)throw new Problem(status,message,code); };
export const phone = value => {let p=String(value).replace(/\D/g,'');if(p[0]==='8')p='7'+p.slice(1);need(/^7\d{10}$/.test(p),400,'Введите российский номер телефона');return '+'+p;};
