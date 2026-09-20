import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { id,passwordHash } from './security.js';
import { one,insert } from './db.js';
import { brand,branch,paymentMethod,theme } from './schemas.js';

export async function seed(db,{adminPassword,ownerPassword}){
  if(await one(db,'SELECT id FROM users LIMIT 1'))return false;
  const sandbox={globalThis:{}};vm.runInNewContext(await readFile(new URL('../../shared/www/menu.js',import.meta.url),'utf8'),sandbox);
  const menu=await sandbox.globalThis.UnagiMenu.load();
  await db.transaction(async tx=>{
    await tx.query("INSERT INTO tenants(id,name,email) VALUES('unagi','UNAGI','owner@example.invalid')");
    await tx.query('INSERT INTO users(id,email,name,role,password) VALUES($1,$2,$3,$4,$5)',[id(),'admin@platform.local','Оператор платформы','platform',await passwordHash(adminPassword)]);
    await tx.query('INSERT INTO users(id,email,name,role,password,tenant_id) VALUES($1,$2,$3,$4,$5,$6)',[id(),'owner@unagi.local','Владелец UNAGI','owner',await passwordHash(ownerPassword),'unagi']);
    for(let i=1;i<=3;i++){
      const brandId='unagi-'+i,branchId='point-'+i;
      await insert(tx,'unagi','brand',brandId,brand.parse({name:'UNAGI · бренд '+i,description:'Тестовое название. Укажите реальный бренд перед подключением.'}));
      await insert(tx,'unagi','branch',branchId,branch.parse({name:'Точка '+i+' · демо',brandId}));
      await insert(tx,'unagi','theme',brandId,{draft:theme.parse({}),published:null,history:[]});
      for(const [type,name] of [['cash','Наличные'],['card','Картой онлайн'],['sbp','СБП'],['qr','QR-код'],['manual','При получении']])await insert(tx,'unagi','paymentMethod',brandId+'-'+type,paymentMethod.parse({name,brandId,type,enabled:type==='cash'}));
      for(const p of menu)await insert(tx,'unagi','product',branchId+'-'+p.id,{branchId,brandId,name:p.name,category:p.category,price:p.price*100,available:p.available,source:'demo',requiresModifiers:false,art:p.art});
    }
  });return true;
}
