import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function key(secret: string) { return createHash('sha256').update(`kopes.source.credentials\0${secret}`).digest(); }
export function seal(token: string, secret: string, identity: string) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), nonce); cipher.setAAD(Buffer.from(identity));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function unseal(value: string, secret: string, identity: string) {
  const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(identity)); cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
