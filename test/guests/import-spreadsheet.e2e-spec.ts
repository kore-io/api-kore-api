import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const HEADER = [
  'Grupo',
  'Nome',
  'Telefone',
  'E-mail',
  'Faixa etária',
  'Restrição alimentar',
  'Tags',
];

async function xlsx(rows: unknown[][], header: unknown[] = HEADER): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Convidados');
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Um zip de uma entrada só, com `realBytes` de zeros comprimidos (deflate) e o
 * tamanho descompactado declarado como `declaredBytes` nos dois cabeçalhos: o
 * zip bomb que mente no diretório (ADR-39).
 */
function lyingZip({
  realBytes,
  declaredBytes,
}: {
  realBytes: number;
  declaredBytes: number;
}): Buffer {
  const content = Buffer.alloc(realBytes);
  const data = deflateRawSync(content);
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredBytes, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredBytes, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

/** Importação de convidados: a planilha (banco real). */
describe('Importação: planilha (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const upload = (cookie: string, url: string, file: Buffer, fileName = 'convidados.xlsx') =>
    request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .attach('file', file, fileName);
  const preview = (cookie: string, weddingId: string, file: Buffer, fileName?: string) =>
    upload(cookie, `/v1/weddings/${weddingId}/guest-imports/spreadsheet/preview`, file, fileName);
  const importSheet = (cookie: string, weddingId: string, file: Buffer) =>
    upload(cookie, `/v1/weddings/${weddingId}/guest-imports/spreadsheet`, file);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    return { ana, weddingId };
  }

  /** A planilha das telas: grupos, erros, uma duplicada e as tags. */
  const sample = () =>
    xlsx([
      ['Família Moreira', 'Luiz Moreira', null, null, 'Adulto', null, 'Família da Ana'],
      ['família moreira', 'Célia Moreira', 19998763310, 'Celia@Gmail.com', 'adulta', null, null],
      ['Família Moreira', 'Pedro Moreira', null, null, 'Criança', 'sem glúten', 'Pajens, pajens'],
      ['Família Rocha', 'Rosa Almeida', '9876-1402', null, null, null, null],
      [null, null, null, null, null, null, null],
      ['Família Moreira', 'Pedro Moreira', null, null, null, null, null],
      ['Amigos', null, null, null, 'Idoso', null, null],
    ]);

  describe('Prévia (RN03 a RN09)', () => {
    it('RN05, RN06, RN07 e RN09 - devolve as contagens, as linhas que ficam de fora e os avisos, sem gravar nada', async () => {
      const { ana, weddingId } = await anaWedding();
      await db.party.create({
        data: {
          weddingId,
          name: 'Família Rocha',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });

      const response = await preview(ana.cookie, weddingId, await sample(), 'lista.xlsx').expect(
        200,
      );

      expect(response.body).toEqual({
        fileName: 'lista.xlsx',
        parties: 1,
        guests: 3,
        counts: { valid: 3, errors: 2, duplicates: 1 },
        skipped: [
          {
            row: 5,
            name: 'Rosa Almeida',
            kind: 'error',
            code: 'PHONE_TOO_SHORT',
            field: 'phone',
            params: { n: 8 },
          },
          {
            row: 7,
            name: 'Pedro Moreira',
            kind: 'duplicate',
            code: 'DUPLICATE',
            duplicateOf: { row: 4, party: 'Família Moreira' },
            params: {},
          },
          { row: 8, name: null, kind: 'error', code: 'NAME_MISSING', field: 'name', params: {} },
          {
            row: 8,
            name: null,
            kind: 'error',
            code: 'AGE_GROUP_INVALID',
            field: 'ageGroup',
            params: {},
          },
        ],
        warnings: [],
      });
      expect(await db.party.count({ where: { weddingId } })).toBe(1);
      expect(await db.tag.count({ where: { weddingId } })).toBe(0);
    });

    it('RN07 e RN08 - avisa o grupo que já existe e a tag que passaria de 10', async () => {
      const { ana, weddingId } = await anaWedding();
      await db.party.create({
        data: {
          weddingId,
          name: 'FAMILIA MOREIRA',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      await db.tag.createMany({
        data: Array.from({ length: 9 }, (_, i) => ({ weddingId, name: `Tag ${i}` })),
      });

      const response = await preview(ana.cookie, weddingId, await sample()).expect(200);

      expect(response.body.warnings).toEqual([
        { code: 'PARTY_NAME_EXISTS', party: 'Família Moreira' },
        { code: 'TAG_LIMIT', tag: 'Pajens', rows: [4] },
      ]);
    });

    it('RN01 e RN03 - não é .xlsx, fora do modelo ou acima de 1.000 linhas: 422 com o código', async () => {
      const { ana, weddingId } = await anaWedding();
      const tooMany = await xlsx(Array.from({ length: 1001 }, (_, i) => ['Grupo', `Pessoa ${i}`]));

      for (const [file, code] of [
        [Buffer.from('Grupo;Nome\nFamília;Ana\n'), 'NOT_XLSX'],
        [
          await xlsx([['Família', 'Ana']], ['Nome', 'Grupo', ...HEADER.slice(2)]),
          'TEMPLATE_MISMATCH',
        ],
        [tooMany, 'TOO_MANY_ROWS'],
      ] as const)
        expect((await preview(ana.cookie, weddingId, file).expect(422)).body.error).toBe(code);
    });

    it('RN03 - arquivo acima de 5 MB: 413 FILE_TOO_LARGE; sem arquivo: 400 em file', async () => {
      const { ana, weddingId } = await anaWedding();

      const big = await preview(ana.cookie, weddingId, Buffer.alloc(5 * 1024 * 1024 + 1)).expect(
        413,
      );
      expect(big.body).toMatchObject({ statusCode: 413, error: 'FILE_TOO_LARGE' });

      const missing = await request(app.getHttpServer())
        .post(`/v1/weddings/${weddingId}/guest-imports/spreadsheet/preview`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .field('outro', 'x')
        .expect(400);
      expect(missing.body.errors).toEqual([{ path: 'file', code: 'IS_NOT_EMPTY', params: {} }]);
    });

    it('RN03 e ADR-39 - zip que mente o tamanho (diz 100 bytes, descompacta 51 MB): 413 pela rota', async () => {
      const { ana, weddingId } = await anaWedding();
      const file = lyingZip({ realBytes: 51 * 1024 * 1024, declaredBytes: 100 });
      expect(file.length).toBeLessThan(5 * 1024 * 1024);

      const response = await preview(ana.cookie, weddingId, file).expect(413);

      expect(response.body).toMatchObject({
        statusCode: 413,
        error: 'FILE_TOO_LARGE',
        unzippedMaxBytes: 50 * 1024 * 1024,
      });
    });
  });

  describe('Importar (RN01, RN04, RN08, RN14)', () => {
    it('RN04, RN08 e RN14 - grava só as linhas válidas: grupos com contato, tags novas, restrição, números e evento', async () => {
      const { ana, weddingId } = await anaWedding();
      const familiaDaAna = await db.tag.create({ data: { weddingId, name: 'família da ana' } });

      const response = await importSheet(ana.cookie, weddingId, await sample()).expect(201);

      expect(response.body).toEqual({ parties: 1, guests: 3, skipped: 3, tagsCreated: ['Pajens'] });
      const party = await db.party.findFirstOrThrow({
        where: { weddingId },
        include: {
          guests: {
            orderBy: [{ joinedPartyAt: 'asc' }, { id: 'asc' }],
            include: { tags: { include: { tag: true } } },
          },
        },
      });
      expect(party.name).toBe('Família Moreira');
      expect(party.guests.map((guest) => guest.name)).toEqual([
        'Luiz Moreira',
        'Célia Moreira',
        'Pedro Moreira',
      ]);
      expect(party.contactGuestId).toBe(party.guests[1].id);
      expect(party.guests[1]).toMatchObject({ phone: '+5519998763310', email: 'celia@gmail.com' });
      expect(party.guests[2]).toMatchObject({
        ageGroup: 'child',
        dietaryRestriction: 'sem glúten',
      });
      expect(party.guests[0].tags.map(({ tagId }) => tagId)).toEqual([familiaDaAna.id]);
      expect(party.guests[2].tags.map(({ tag }) => tag.name)).toEqual(['Pajens']);
      // Tags RN07: a tag da coluna é do convidado; o grupo de Pedro não recebe "Pajens".
      const partyTags = await db.partyTag.findMany({
        where: { partyId: party.id },
        include: { tag: true },
      });
      expect(partyTags.map(({ tag }) => tag.name)).not.toContain('Pajens');
      expect(await db.weddingStats.findUniqueOrThrow({ where: { weddingId } })).toMatchObject({
        guestsTotal: 3,
        pending: 3,
        partiesPending: 1,
      });
      const event = await db.productEvent.findFirst({
        where: { name: 'importacao' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event?.props).toEqual({ metodo: 'planilha', linhas_erro: 3 });
    });

    it('RN07 - importar um grupo com o nome de um grupo ativo: ficam dois, e o antigo não muda', async () => {
      const { ana, weddingId } = await anaWedding();
      const old = await db.party.create({
        data: {
          weddingId,
          name: 'Família Rocha',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      await db.guest.create({ data: { weddingId, partyId: old.id, name: 'Antônio Rocha' } });
      const before = await db.party.findUniqueOrThrow({ where: { id: old.id } });

      await importSheet(
        ana.cookie,
        weddingId,
        await xlsx([['Família Rocha', 'Rosa Almeida', null, null, null, null, null]]),
      ).expect(201);

      const rochas = await db.party.findMany({
        where: { weddingId, name: 'Família Rocha' },
        include: { guests: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(rochas).toHaveLength(2);
      expect(rochas[0]).toMatchObject({ id: old.id, updatedAt: before.updatedAt });
      expect(rochas[0].guests.map((guest) => guest.name)).toEqual(['Antônio Rocha']);
      expect(rochas[1].guests.map((guest) => guest.name)).toEqual(['Rosa Almeida']);
    });

    it('RN01 e RN08 - a confirmação valida de novo: a 10ª tag criada depois da prévia deixa "Vizinhos" de fora, e as linhas entram', async () => {
      const { ana, weddingId } = await anaWedding();
      await db.tag.createMany({
        data: Array.from({ length: 9 }, (_, i) => ({ weddingId, name: `Tag ${i}` })),
      });
      const file = await xlsx([
        ['Família Moreira', 'Luiz Moreira', null, null, null, null, 'Vizinhos'],
      ]);
      const before = await preview(ana.cookie, weddingId, file).expect(200);
      expect(before.body.warnings ?? []).toEqual([]);
      // Entre a prévia e a confirmação, alguém cria a 10ª tag.
      await db.tag.create({ data: { weddingId, name: 'Padrinhos' } });

      const response = await importSheet(ana.cookie, weddingId, file).expect(201);

      expect(response.body).toMatchObject({ parties: 1, guests: 1, tagsCreated: [] });
      expect(await db.tag.count({ where: { weddingId, name: 'Vizinhos' } })).toBe(0);
      const luiz = await db.guest.findFirstOrThrow({
        where: { weddingId, name: 'Luiz Moreira' },
        include: { tags: true },
      });
      expect(luiz.tags).toEqual([]);
    });

    it('RN08 - a tag na lixeira não é reaproveitada: a importação cria uma nova', async () => {
      const { ana, weddingId } = await anaWedding();
      const trashed = await db.tag.create({
        data: { weddingId, name: 'Vizinhos', deletedAt: new Date() },
      });

      const response = await importSheet(
        ana.cookie,
        weddingId,
        await xlsx([['Família Moreira', 'Luiz Moreira', null, null, null, null, 'Vizinhos']]),
      ).expect(201);

      expect(response.body.tagsCreated).toEqual(['Vizinhos']);
      const tags = await db.tag.findMany({ where: { weddingId, name: 'Vizinhos' } });
      expect(tags).toHaveLength(2);
      const fresh = tags.find((tag) => tag.id !== trashed.id);
      expect(fresh?.deletedAt).toBeNull();
      const luiz = await db.guest.findFirstOrThrow({
        where: { weddingId, name: 'Luiz Moreira' },
        include: { tags: true },
      });
      expect(luiz.tags.map(({ tagId }) => tagId)).toEqual([fresh?.id]);
    });

    it('RN09 - nenhuma linha válida: 409 NOTHING_TO_IMPORT, e nada é gravado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await importSheet(
        ana.cookie,
        weddingId,
        await xlsx([
          ['Família', null],
          [null, 'Ana'],
        ]),
      ).expect(409);

      expect(response.body.error).toBe('NOTHING_TO_IMPORT');
      expect(await db.party.count({ where: { weddingId } })).toBe(0);
    });

    it('RN13 - sem vínculo, o casamento não existe', async () => {
      const { weddingId } = await anaWedding();
      const stranger = await signedInUser({ app, name: 'Estranha' });

      expect(
        (await preview(stranger.cookie, weddingId, await sample()).expect(404)).body.error,
      ).toBe('WEDDING_NOT_FOUND');
    });
  });
});
