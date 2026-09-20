import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration,root } from '../src/config.js';
import { database } from '../src/db.js';
import { seed } from '../src/seed.js';

if(process.env.NODE_ENV==='production')throw new Error('Local demo setup is disabled in production');
const envPath=path.join(root,'.env');
if(!existsSync(envPath)){
  const key=randomBytes(32).toString('hex');
  await writeFile(envPath,'ENCRYPTION_KEY='+key+'\nPUBLIC_ORIGIN=http://127.0.0.1:4300\nHOST=127.0.0.1\nPORT=4300\nENABLE_EMAIL=false\nENABLE_LIVE_PAYMENTS=false\n',{flag:'wx',mode:0o600});
  process.env.ENCRYPTION_KEY=key;
}
const config=configuration(),db=await database(config);
try{
  const adminPassword=randomBytes(18).toString('base64url'),ownerPassword=randomBytes(18).toString('base64url');
  const created=await seed(db,{adminPassword,ownerPassword});
  if(created){await writeFile(path.join(root,'.local-access.txt'),`LOCAL DEVELOPMENT ONLY\n\nPlatform: http://127.0.0.1:4300/platform\nEmail: admin@platform.local\nPassword: ${adminPassword}\n\nBusiness: http://127.0.0.1:4300/business\nEmail: owner@unagi.local\nPassword: ${ownerPassword}\n\nNo real integrations are enabled. Keep this file private.\n`,{flag:'wx',mode:0o600});console.log('Local database ready. Access details: backend/.local-access.txt (not tracked in Git).');}
  else console.log('Database already initialized. Existing users and passwords preserved.');
}finally{await db.close();}
