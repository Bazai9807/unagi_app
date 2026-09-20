export async function audit(db,tenant,actor,action,target,details={}) {
  // Only explicitly selected non-secret metadata is passed by callers; never request bodies or provider payloads.
  await db.query('INSERT INTO audit(tenant_id,actor,action,target,details) VALUES ($1,$2,$3,$4,$5::jsonb)',[tenant,actor,action,target,JSON.stringify(details)]);
}
export async function event(db,tenant,order,type,details={}){
  await db.query('INSERT INTO events(tenant_id,order_id,type,details) VALUES ($1,$2,$3,$4::jsonb)',[tenant,order,type,JSON.stringify(details)]);
}
