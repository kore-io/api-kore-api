import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM; o resultado é iv | tag | texto cifrado. `aad` é autenticado, não cifrado. */
export function aesGcmEncrypt({
  key,
  plaintext,
  aad,
}: {
  key: Buffer;
  plaintext: Buffer;
  aad?: Buffer;
}): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Inverso de aesGcmEncrypt; falha se o dado ou o aad foram alterados. */
export function aesGcmDecrypt({
  key,
  payload,
  aad,
}: {
  key: Buffer;
  payload: Buffer;
  aad?: Buffer;
}): Buffer {
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
