// Run once on a new server with its own PostgreSQL database and encryption key.
// Generates unique credentials; never copies development accounts or sessions.
import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration,root } from '../src/config.js';
import { database,one } from '../src/db.js';
import { seed } from '../src/seed.js';

const config=configuration();
if(!config.production)throw new Error('Server bootstrap requires NODE_ENV=production');
const db=await database(config);
try{
  if(await one(db,'SELECT id FROM users LIMIT 1'))throw new Error('Database already has users; bootstrap refuses to overwrite them');
  const adminPassword=randomBytes(24).toString('base64url'),ownerPassword=randomBytes(24).toString('base64url');
  const adminEmail='platform@unagi.invalid',ownerEmail='owner@unagi.invalid';
  await mkdir(path.join(root,'.data'),{recursive:true,mode:0o700});
  // Persist before transaction so a disk error cannot strand unrecorded credentials.
  const access=path.join(root,'.data','server-access.txt');
  await writeFile(access,`SERVER PREVIEW — KEEP PRIVATE\n\n${config.origin}/platform\nLogin: ${adminEmail}\nPassword: ${adminPassword}\n\n${config.origin}/business\nLogin: ${ownerEmail}\nPassword: ${ownerPassword}\n\nFirst login requires setting up an authenticator (2FA).\nThese identifiers do not receive email. No live payments/orders.\n`,{flag:'wx',mode:0o600});
  await seed(db,{adminPassword,ownerPassword,adminEmail,ownerEmail});
  console.log('Server initialized; access details saved privately in backend/.data/server-access.txt');
}finally{await db.close();}
