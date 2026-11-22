import { createHash } from 'node:crypto';

/**
 * Os segredos que a API lê do ambiente (decisão 265(4)). Fora daqui fica a
 * configuração que pode coincidir com o exemplo de propósito (versões,
 * endereços, buckets, o VAPID_SUBJECT).
 */
export const SECRET_ENV_KEYS = [
  'KMS_LOCAL_MASTER_KEY',
  'IP_HASH_KEY',
  'PRODUCT_EVENT_KEY',
  'LOGIN_CODE_KEY',
  'OAUTH_STATE_KEY',
  'PARTY_COOKIE_KEY',
  'PREVIEW_COOKIE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'VAPID_PRIVATE_KEY',
  'STORAGE_SECRET_ACCESS_KEY',
  'PAYMENT_WEBHOOK_SECRET',
  'TAX_ID_HASH_KEY_ENCRYPTED',
] as const;

/** As URLs com a senha embutida: a senha é conferida como os segredos acima. */
export const SECRET_URL_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_BACKOFFICE_URL',
  'REDIS_URL',
] as const;

/**
 * O SHA-256 dos valores dessas variáveis no .env.example e no .env.test, que
 * são públicos (os repositórios são públicos; decisão 265(4)). Só o hash fica
 * no código, para a chave não se repetir. O env.schema.spec confere que a
 * lista bate com os dois arquivos.
 */
export const PUBLIC_EXAMPLE_SECRET_HASHES: ReadonlySet<string> = new Set([
  '08f8e4b92a8fe8e7faa394b169fdacb7c587e3ff01b4bd38cec1f74b29a6dc3e',
  '19dbd4a83bbe556e8e004ca6eb8d65a4e11cbdc9da6ccdc6bf7dc066c05c6565',
  '204df1d7ae677fe0965f4414c5003354c37348b1ee5679a52fe44d8576322fa7',
  '2900d377c38b202562a67471e6d1642b316302f8eda24bc8bc6d19057e2beace',
  '2c4cc2191d12913acead19f423f768b9659545d867645d6424bc5a8beffbb658',
  '39a10ccac970c9bcf0efc13fd19be6a2588b339c1d64fd2c1749db48df000f01',
  '5345b4d3cdd0f7961acd800395d97afca6aff9a0f42b61621bf240401275375a',
  '55c9cca3d1fdb7d31dbe68e6382618a0fc3249455e27de82cd42d180d4cfb15b',
  '873e9c5a8c91fc413fcc8306d9ba95627e34c247e88598efcbfa4ebdfd1c3da7',
  '98f346f21e08460d02d6f8df4bcd67d93796ad0efaada4c68ddeced54023b34c',
  '99a55803f0e7bb0118c423653592daa05c610e796ee0c4155ac9ec2991e39d76',
  'a1f135c37a987a333f1d589003352ff52f29f5957313a8171a915e5306f6be98',
  'a5646c5ec4c6adaa840eae35b8da46d28af98d1247a3c3a18597f461de74cb20',
  'ab42003776b2ec4632cec4cd3bfb2e140458d8da100874e422446334a412cca9',
  'aca18956ec55c02ecb32fc551f31c6187ccfec010f41f86946acd9fbc0b10823',
  'b34b7b25e7f3cbf20ae21bf5d38484231861eb05bc66c05574668302a70da377',
  'b843e29fee00ec758530964a685a8291a314a201703de0df1183ddf1205d1567',
  'bc8c1c17143dccb4e525451f43446ff1d88e92a44a1bbefb92a461435188a0f8',
  'd6d83b09f00cc251fca3899129c90a4117ef692ebb593c64a1b871a8b151cea9',
  'd7f8759e3d3f4618e06b2b6dfe9e215a42ccb737db5e383098dbf338ba9014a0',
  'e7b06319b79585c373dca1d9b8cbcdff2083a765053d502deb3c4be0e858b48d',
  'f8a9a0e089f3e5033c80699077ba8a296d6db24ae3218d88a8059cc8138c0056',
]);

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** A senha de uma URL (vazia sem senha ou com a URL inválida). */
export function urlPassword(value: string): string {
  try {
    return decodeURIComponent(new URL(value).password);
  } catch {
    return '';
  }
}

/** Se o valor é um dos públicos do .env.example ou do .env.test. */
export const isPublicExampleSecret = (value: string): boolean =>
  value.length > 0 && PUBLIC_EXAMPLE_SECRET_HASHES.has(sha256Hex(value));
