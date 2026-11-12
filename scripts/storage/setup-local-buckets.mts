// Cria os dois buckets do armazenamento no MinIO local (Imagens do site, RN06):
// o privado dos originais, sem nenhuma política (nunca público), e o público
// das versões servidas, com leitura anônima, no papel do CDN. Idempotente.
// Só para local e test: no R2, os buckets vêm do Terraform (ADR do MinIO).
//
// O CORS do PUT pré-assinado fica no próprio MinIO (MINIO_API_CORS_ALLOW_ORIGIN
// no docker-compose.yml), porque o MinIO não implementa o CORS por bucket.
import 'dotenv/config';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ALLOWED_ENVS = ['local', 'test'];

async function main(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? '';
  if (!ALLOWED_ENVS.includes(appEnv)) {
    throw new Error(`storage:setup só roda com APP_ENV local ou test (atual: "${appEnv}").`);
  }
  const client = new S3Client({
    endpoint: requireEnv({ name: 'STORAGE_ENDPOINT' }),
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv({ name: 'STORAGE_ACCESS_KEY_ID' }),
      secretAccessKey: requireEnv({ name: 'STORAGE_SECRET_ACCESS_KEY' }),
    },
  });
  try {
    await ensureBucket({ client, bucket: requireEnv({ name: 'STORAGE_PRIVATE_BUCKET' }) });
    const publicBucket = requireEnv({ name: 'STORAGE_PUBLIC_BUCKET' });
    await ensureBucket({ client, bucket: publicBucket });
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: publicBucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${publicBucket}/*`],
            },
          ],
        }),
      }),
    );
  } catch (error) {
    throw new Error(
      `MinIO fora do ar em ${process.env.STORAGE_ENDPOINT}? Rode "docker compose up -d".`,
      { cause: error },
    );
  } finally {
    client.destroy();
  }
}

async function ensureBucket({ client, bucket }: { client: S3Client; bucket: string }) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    // Não existe: cria abaixo.
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
  }
}

function requireEnv({ name }: { name: string }): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} ausente.`);
  return value;
}

await main();
