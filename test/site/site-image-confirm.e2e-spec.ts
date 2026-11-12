import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Confirmação e processamento das imagens do site (S4 RN05; banco, MinIO e sharp reais). */
describe('Imagens do site: confirmação e processamento (banco e MinIO reais)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let storage: ObjectStorage;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    storage = app.get(OBJECT_STORAGE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (cookie: string, url: string, body: object) =>
    request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const confirm = (cookie: string, weddingId: string, imageId: string) =>
    post(cookie, `/v1/weddings/${weddingId}/site-images`, { imageId });

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    return { ana, weddingId };
  }

  /** Pede a autorização e envia o arquivo como o app (S4 RN04). */
  async function upload({
    cookie,
    weddingId,
    file,
    send = true,
  }: {
    cookie: string;
    weddingId: string;
    file: Buffer;
    send?: boolean;
  }): Promise<string> {
    const authorization = await post(
      cookie,
      `/v1/weddings/${weddingId}/site-images/upload-authorizations`,
      { contentType: 'image/jpeg', sizeBytes: file.length },
    ).expect(201);
    const { imageId, uploadUrl } = authorization.body as { imageId: string; uploadUrl: string };
    if (send) {
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: new Uint8Array(file),
        headers: { 'Content-Type': 'image/jpeg' },
      });
      expect(put.status).toBe(200);
    }
    return imageId;
  }

  const photo = ({ width = 3000, height = 2000 }: { width?: number; height?: number } = {}) =>
    sharp({
      create: { width, height, channels: 3, background: { r: 169, g: 79, b: 55 } },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#7A8B69"/></svg>`,
          ),
        },
      ])
      .jpeg({ quality: 90 });

  /** O token das chaves (decisão 229(f)): a chave não leva o id da imagem. */
  const tokenOf = async (imageId: string) =>
    (await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).keyToken;
  const publicObject = async (imageId: string, version: string) =>
    fetch(storage.publicUrl({ key: `site/${await tokenOf(imageId)}/${version}` }));

  async function served(imageId: string, version: string) {
    const response = await publicObject(imageId, version);
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  }

  it('RN05 - confirma, gera as três versões no CDN e deixa "ready" com unusedSince = readyAt', async () => {
    const { ana, weddingId } = await anaWedding();
    const imageId = await upload({
      cookie: ana.cookie,
      weddingId,
      file: await photo().toBuffer(),
    });

    const response = await confirm(ana.cookie, weddingId, imageId).expect(201);

    // Decisão 229(f): a URL pública não leva o id (UUIDv7, que revela a hora do envio).
    const { url, thumbUrl } = response.body as { url: string; thumbUrl: string };
    expect(url).not.toContain(imageId);
    expect(thumbUrl).not.toContain(imageId);
    expect(await tokenOf(imageId)).not.toBe(imageId);
    expect(response.body).toEqual({
      id: imageId,
      status: 'ready',
      url: storage.publicUrl({ key: `site/${await tokenOf(imageId)}/display.jpg` }),
      thumbUrl: storage.publicUrl({ key: `site/${await tokenOf(imageId)}/thumb.jpg` }),
      width: 2560,
      height: 1707,
    });
    const image = await db.siteImage.findUniqueOrThrow({ where: { id: imageId } });
    expect(image).toMatchObject({
      status: 'ready',
      thumbKey: `site/${await tokenOf(imageId)}/thumb.jpg`,
      ogKey: `site/${await tokenOf(imageId)}/og.jpg`,
      width: 2560,
      height: 1707,
    });
    expect(image.readyAt).not.toBeNull();
    expect(image.unusedSince).toEqual(image.readyAt);

    const display = await publicObject(imageId, 'display.jpg');
    expect(display.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(image.sizeBytes).toBe(Number(display.headers.get('content-length')));
    expect(await sharp(await served(imageId, 'thumb.jpg')).metadata()).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 427,
    });
    const og = await served(imageId, 'og.jpg');
    expect(og.length).toBeLessThanOrEqual(300 * 1024);
    expect(await sharp(og).metadata()).toMatchObject({ format: 'jpeg', width: 1200, height: 630 });
    // O original sai do bucket privado.
    expect(
      await storage.head({ bucket: 'private', key: `site/${await tokenOf(imageId)}/original` }),
    ).toBeNull();
  });

  it('RN05 - o servidor tira EXIF, XMP e GPS e aplica a orientação antes', async () => {
    const { ana, weddingId } = await anaWedding();
    const file = await photo({ width: 800, height: 400 })
      .withExif({
        IFD0: { Make: 'Kore', Model: 'Teste' },
        IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '22/1 54/1 0/1' },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="22,54.0S"/></rdf:RDF></x:xmpmeta>',
      )
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const source = await sharp(file).metadata();
    expect(source.exif).toBeDefined();
    expect(source.xmp).toBeDefined();
    expect(source.orientation).toBe(6);
    const imageId = await upload({ cookie: ana.cookie, weddingId, file });

    const response = await confirm(ana.cookie, weddingId, imageId).expect(201);

    // Deitada pelo EXIF (orientação 6): a versão servida sai de pé.
    expect(response.body).toMatchObject({ width: 400, height: 800 });
    for (const version of ['display.jpg', 'thumb.jpg', 'og.jpg']) {
      const metadata = await sharp(await served(imageId, version)).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('RN05 - PNG com transparência vira JPEG com fundo branco', async () => {
    const { ana, weddingId } = await anaWedding();
    const file = await sharp({
      create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const imageId = await upload({ cookie: ana.cookie, weddingId, file });

    await confirm(ana.cookie, weddingId, imageId).expect(201);

    const { data } = await sharp(await served(imageId, 'display.jpg'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)].every((channel) => channel > 250)).toBe(true);
  });

  it('RN05 - foto em Display P3 é convertida para sRGB, sem o perfil na saída', async () => {
    const { ana, weddingId } = await anaWedding();
    // A cor sRGB (200, 60, 40) gravada em Display P3: os números do arquivo mudam.
    const file = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 40 } },
    })
      .withIccProfile('p3')
      .jpeg({ quality: 100 })
      .toBuffer();
    const firstPixel = async (image: sharp.Sharp) => [
      ...(await image.raw().toBuffer()).subarray(0, 3),
    ];
    const stored = await firstPixel(sharp(file, { ignoreIcc: true }));
    expect(stored[0]).toBeLessThan(190);
    const imageId = await upload({ cookie: ana.cookie, weddingId, file });

    await confirm(ana.cookie, weddingId, imageId).expect(201);

    // Lido sem o perfil, o P3 sairia desbotado; convertido, volta à cor de origem.
    const display = await served(imageId, 'display.jpg');
    const [r, g, b] = await firstPixel(sharp(display));
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(4);
    expect(Math.abs(g - 60)).toBeLessThanOrEqual(4);
    expect(Math.abs(b - 40)).toBeLessThanOrEqual(4);
    expect((await sharp(display).metadata()).icc).toBeUndefined();
  });

  it('RN05 - confirmar de novo devolve a mesma imagem pronta (200), sem processar de novo', async () => {
    const { ana, weddingId } = await anaWedding();
    const imageId = await upload({
      cookie: ana.cookie,
      weddingId,
      file: await photo({ width: 800, height: 600 }).toBuffer(),
    });
    const first = await confirm(ana.cookie, weddingId, imageId).expect(201);
    const before = await db.siteImage.findUniqueOrThrow({ where: { id: imageId } });
    const get = jest.spyOn(storage, 'get');

    const again = await confirm(ana.cookie, weddingId, imageId).expect(200);

    expect(again.body).toEqual(first.body);
    expect(get).not.toHaveBeenCalled();
    expect(await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).toEqual(before);
  });

  it('RN05 - outra confirmação já está processando: 409 IMAGE_PROCESSING', async () => {
    const { ana, weddingId } = await anaWedding();
    const imageId = await upload({
      cookie: ana.cookie,
      weddingId,
      file: await photo({ width: 400, height: 300 }).toBuffer(),
    });
    await db.siteImage.update({ where: { id: imageId }, data: { status: 'processing' } });

    const response = await confirm(ana.cookie, weddingId, imageId).expect(409);

    expect(response.body.error).toBe('IMAGE_PROCESSING');
  });

  it('RN05 - o original não chegou: 409 UPLOAD_MISSING, e a imagem volta a "uploading" para enviar de novo', async () => {
    const { ana, weddingId } = await anaWedding();
    const file = await photo({ width: 400, height: 300 }).toBuffer();
    const imageId = await upload({ cookie: ana.cookie, weddingId, file, send: false });

    const missing = await confirm(ana.cookie, weddingId, imageId).expect(409);

    expect(missing.body.error).toBe('UPLOAD_MISSING');
    expect((await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).status).toBe(
      'uploading',
    );
    await storage.put({
      bucket: 'private',
      key: `site/${await tokenOf(imageId)}/original`,
      body: file,
      contentType: 'image/jpeg',
    });
    await confirm(ana.cookie, weddingId, imageId).expect(201);
  });

  it('RN05 - objeto de 6 MB no armazenamento: recusa sem baixar, "failed" e o objeto apagado', async () => {
    const { ana, weddingId } = await anaWedding();
    const imageId = await upload({
      cookie: ana.cookie,
      weddingId,
      file: Buffer.alloc(10),
      send: false,
    });
    // O R2 pode não impor o tamanho assinado: o objeto maior chega por fora da URL.
    await storage.put({
      bucket: 'private',
      key: `site/${await tokenOf(imageId)}/original`,
      body: Buffer.alloc(6 * 1024 * 1024, 1),
      contentType: 'image/jpeg',
    });
    const get = jest.spyOn(storage, 'get');

    const response = await confirm(ana.cookie, weddingId, imageId).expect(422);

    expect(response.body.error).toBe('IMAGE_INVALID');
    expect(get).not.toHaveBeenCalled();
    expect((await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).status).toBe(
      'failed',
    );
    expect(
      await storage.head({ bucket: 'private', key: `site/${await tokenOf(imageId)}/original` }),
    ).toBeNull();
  });

  it('RN05 - o tipo vale pelo conteúdo: um PDF enviado como image/jpeg fica "failed"', async () => {
    const { ana, weddingId } = await anaWedding();
    const imageId = await upload({
      cookie: ana.cookie,
      weddingId,
      file: Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'),
    });

    const response = await confirm(ana.cookie, weddingId, imageId).expect(422);

    expect(response.body).toEqual({
      statusCode: 422,
      error: 'IMAGE_INVALID',
      message: expect.any(String),
    });
    expect((await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).status).toBe(
      'failed',
    );
    expect(
      await storage.head({ bucket: 'private', key: `site/${await tokenOf(imageId)}/original` }),
    ).toBeNull();
    // Depois de "failed", a imagem não existe para o app.
    expect((await confirm(ana.cookie, weddingId, imageId).expect(404)).body.error).toBe(
      'IMAGE_NOT_FOUND',
    );
  });

  it('RN05 - PNG pequeno que declara mais de 40 MP fica "failed" (limitInputPixels)', async () => {
    const { ana, weddingId } = await anaWedding();
    const file = await sharp({
      create: { width: 6400, height: 6400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(file.length).toBeLessThan(4 * 1024 * 1024);
    const imageId = await upload({ cookie: ana.cookie, weddingId, file });

    await confirm(ana.cookie, weddingId, imageId).expect(422);

    expect((await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).status).toBe(
      'failed',
    );
  });

  it('RN10 - imagem de outro casamento: 404 IMAGE_NOT_FOUND, sem tocar nela', async () => {
    const { ana, weddingId } = await anaWedding();
    const bruno = await signedInUser({ app, name: 'Bruno' });
    const other = await seedWedding({ db, ownerId: bruno.userId });
    const imageId = await upload({
      cookie: bruno.cookie,
      weddingId: other.weddingId,
      file: await photo({ width: 400, height: 300 }).toBuffer(),
    });

    const response = await confirm(ana.cookie, weddingId, imageId).expect(404);

    expect(response.body.error).toBe('IMAGE_NOT_FOUND');
    expect((await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).status).toBe(
      'uploading',
    );
    expect((await confirm(ana.cookie, weddingId, randomUUID()).expect(404)).body.error).toBe(
      'IMAGE_NOT_FOUND',
    );
  });
});
