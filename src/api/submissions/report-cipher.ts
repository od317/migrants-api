import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'enc:v1';

export function encryptionKey(): Buffer {
  const raw = process.env.REPORT_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error('REPORT_ENCRYPTION_KEY is not configured');
  }
  const key = decodeKey(raw);
  if (key.length !== 32) {
    throw new Error('REPORT_ENCRYPTION_KEY must be 32 bytes');
  }
  return key;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptField(stored: string): string {
  const parts = stored.split(':');
  const [scheme, version, ivText, tagText, dataText] = parts;
  if (parts.length !== 5 || `${scheme}:${version}` !== PREFIX || !ivText || !tagText || !dataText) {
    throw new Error('Reporter field is not encrypted');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return Buffer.from(raw, 'base64');
}

export function hashesMatch(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}
