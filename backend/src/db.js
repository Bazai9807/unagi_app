import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile,mkdir } from 'node:fs/promises';

export async function database(config) {
  let adapter;
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
    adapter = {
      query: (sql, params = []) => pool.query(sql, params),
      exec: sql => pool.query(sql),
      async transaction(fn) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    if(config.dataDir&&config.dataDir!=='memory://')await mkdir(config.dataDir,{recursive:true});
    const local = await PGlite.create(config.dataDir);
    adapter = { query: (sql, params = []) => local.query(sql, params), exec: sql => local.exec(sql), transaction: fn => local.transaction(fn), close: () => local.close() };
  }
  await adapter.exec(await readFile(new URL('../sql/001-schema.sql', import.meta.url), 'utf8'));
  return adapter;
}

export const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;
export const one = async (db, sql, params = []) => (await rows(db, sql, params))[0];

export async function list(db, tenant, kind) {
  return rows(db, 'SELECT id, data, revision, updated_at FROM records WHERE tenant_id=$1 AND kind=$2 ORDER BY created_at, id', [tenant, kind]);
}
export async function record(db, tenant, kind, id) {
  return one(db, 'SELECT id, data, revision, updated_at FROM records WHERE tenant_id=$1 AND kind=$2 AND id=$3', [tenant, kind, id]);
}
export async function insert(db, tenant, kind, id, data) {
  return one(db, 'INSERT INTO records (tenant_id,kind,id,data) VALUES ($1,$2,$3,$4::jsonb) RETURNING id,data,revision', [tenant, kind, id, JSON.stringify(data)]);
}
export async function update(db, tenant, kind, id, data, revision) {
  return one(db, 'UPDATE records SET data=$4::jsonb, revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND kind=$2 AND id=$3 AND revision=$5 RETURNING id,data,revision', [tenant, kind, id, JSON.stringify(data), revision]);
}
