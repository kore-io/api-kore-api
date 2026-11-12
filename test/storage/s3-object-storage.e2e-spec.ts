import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from '../../src/shared/config/app-config.module';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { StorageModule } from '../../src/shared/storage/storage.module';

const minute = 60 * 1000;

/** Armazenamento pelo MinIO real (Imagens do site, RN04 e RN06; ADR do upload direto). */
describe('Armazenamento S3 (Imagens do site RN04 e RN06; MinIO real)', () => {
  let moduleRef: TestingModule;
  let storage: ObjectStorage;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, StorageModule],
    }).compile();
    storage = moduleRef.get(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const key = () => `site/${randomUUID()}/original`;
  const photo = Buffer.from('conteúdo de teste de uma foto');

  async function presign({
    objectKey,
    now = new Date(),
    sizeBytes = photo.length,
  }: {
    objectKey: string;
    now?: Date;
    sizeBytes?: number;
  }) {
    return storage.presignPut({
      bucket: 'private',
      key: objectKey,
      contentType: 'image/jpeg',
      sizeBytes,
      now,
      expiresInSeconds: 300,
    });
  }

  function upload({
    url,
    body = photo,
    contentType = 'image/jpeg',
  }: {
    url: string;
    body?: Buffer;
    contentType?: string;
  }) {
    return fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType },
    });
  }

  it('RN04 - o PUT pré-assinado aceita o arquivo pedido, e o HEAD lê o tamanho sem o corpo', async () => {
    const objectKey = key();
    const now = new Date();
    const authorization = await presign({ objectKey, now });

    expect(authorization.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(photo.length),
    });
    expect(authorization.expiresAt).toEqual(new Date(now.getTime() + 5 * minute));
    expect((await upload({ url: authorization.url })).status).toBe(200);
    expect(await storage.head({ bucket: 'private', key: objectKey })).toEqual({
      sizeBytes: photo.length,
    });
    expect(await storage.get({ bucket: 'private', key: objectKey })).toEqual(photo);

    await storage.delete({ bucket: 'private', keys: [objectKey] });
    expect(await storage.head({ bucket: 'private', key: objectKey })).toBeNull();
  });

  it('RN04 - a URL é presa ao tipo: outro Content-Type é recusado', async () => {
    const objectKey = key();
    const { url } = await presign({ objectKey });

    expect((await upload({ url, contentType: 'image/png' })).status).toBe(403);
    expect(await storage.head({ bucket: 'private', key: objectKey })).toBeNull();
  });

  it('RN04 - a URL é presa ao tamanho: um arquivo maior que o pedido é recusado', async () => {
    const objectKey = key();
    const { url } = await presign({ objectKey });

    const bigger = Buffer.concat([photo, Buffer.from('mais bytes')]);
    expect((await upload({ url, body: bigger })).status).toBe(403);
    expect(await storage.head({ bucket: 'private', key: objectKey })).toBeNull();
  });

  it('RN04 - autorização assinada há 6 minutos (relógio do assinador) é recusada', async () => {
    const objectKey = key();
    const { url } = await presign({ objectKey, now: new Date(Date.now() - 6 * minute) });

    expect((await upload({ url })).status).toBe(403);
    expect(await storage.head({ bucket: 'private', key: objectKey })).toBeNull();
  });

  it('RN06 - o original nunca é público; a versão servida é, com o Cache-Control de 1 dia', async () => {
    const original = key();
    const { url } = await presign({ objectKey: original });
    await upload({ url });
    const privateUrl = `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_PRIVATE_BUCKET}/${original}`;
    expect((await fetch(privateUrl)).status).toBe(403);

    const display = `site/${randomUUID()}/display.jpg`;
    await storage.put({
      bucket: 'public',
      key: display,
      body: photo,
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=86400',
    });
    const served = await fetch(storage.publicUrl({ key: display }));
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(photo);

    await storage.delete({ bucket: 'private', keys: [original] });
    await storage.delete({ bucket: 'public', keys: [display] });
    expect((await fetch(storage.publicUrl({ key: display }))).status).toBe(404);
  });

  it('apagar uma chave que não existe não é erro', async () => {
    await expect(storage.delete({ bucket: 'public', keys: [key()] })).resolves.toBeUndefined();
    await expect(storage.delete({ bucket: 'public', keys: [] })).resolves.toBeUndefined();
  });
});
