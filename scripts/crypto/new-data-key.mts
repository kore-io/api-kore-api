// Gera uma chave de dados de 32 bytes cifrada pela chave mestra do KMS local
// (KMS_LOCAL_MASTER_KEY), em base64, no formato do adaptador local
// (iv | tag | texto cifrado). Serve às chaves guardadas cifradas, como a do
// HMAC do CPF (TAX_ID_HASH_KEY_ENCRYPTED). Só para local e test: nos outros
// ambientes a chave sai do AWS KMS.
import 'dotenv/config';
import { createCipheriv, randomBytes } from 'node:crypto';

const appEnv = process.env.APP_ENV ?? '';
if (!['local', 'test'].includes(appEnv)) {
  throw new Error(`crypto:new-data-key só roda com APP_ENV local ou test (atual: "${appEnv}").`);
}
const masterKey = Buffer.from(process.env.KMS_LOCAL_MASTER_KEY ?? '', 'base64');
if (masterKey.length !== 32)
  throw new Error('KMS_LOCAL_MASTER_KEY precisa ter 32 bytes em base64.');

const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
const ciphertext = Buffer.concat([cipher.update(randomBytes(32)), cipher.final()]);
console.log(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64'));
