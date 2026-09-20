import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const key = env.ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Run npm run setup: ENCRYPTION_KEY must be 32 random bytes in hex');
  const origin = env.PUBLIC_ORIGIN || 'http://127.0.0.1:4300';
  if (production && (!origin.startsWith('https://') || !env.DATABASE_URL)) throw new Error('Production requires HTTPS PUBLIC_ORIGIN and DATABASE_URL');
  return {
    production, key, origin, trustProxy: env.TRUST_LOOPBACK_PROXY === 'true' ? ['127.0.0.1','::1'] : false, port: Number(env.PORT || 4300), host: env.HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL, dataDir: env.DATA_DIR || path.join(root, '.data', 'postgres'),
    smsruKey: env.SMSRU_API_KEY || '', smtpHost: env.SMTP_HOST || '', smtpPort: Number(env.SMTP_PORT || 465),
    smtpUser: env.SMTP_USER || '', smtpPassword: env.SMTP_PASSWORD || '', mailFrom: env.MAIL_FROM || '',
    sendEmail: env.ENABLE_EMAIL === 'true', livePayments: env.ENABLE_LIVE_PAYMENTS === 'true',
    // Orders remain sandbox-only until verified iiko order and loyalty mapping is installed.
    liveOrders: false,
  };
}
