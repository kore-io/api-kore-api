import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
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
        data: { weddingId, name: 'Família Rocha', linkToken: 'A'.repeat(22) },
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
        data: { weddingId, name: 'FAMILIA MOREIRA', linkToken: 'B'.repeat(22) },
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
