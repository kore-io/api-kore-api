import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const DEFAULT_COLUMNS = 'name,party,ageGroup,dietaryRestriction,rsvp';

/** Exportação de convidados em Excel (banco real). */
describe('Exportação de convidados (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const exportGuests = (cookie: string, weddingId: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/guests/export`)
      .query(query)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  const createParty = async (cookie: string, weddingId: string, body: object) =>
    (
      await request(app.getHttpServer())
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', cookie)
        .set('Origin', APP_ORIGIN)
        .send(body)
        .expect(201)
    ).body as { id: string; guests: { id: string }[] };

  /** As linhas da primeira aba, com o tipo de cada célula. */
  async function sheetOf(body: Buffer): Promise<{ rows: string[][]; types: ExcelJS.ValueType[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    const types: ExcelJS.ValueType[] = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(
          typeof cell.value === 'string'
            ? cell.value
            : cell.value === null
              ? ''
              : JSON.stringify(cell.value),
        );
        if (cell.value !== null) types.push(cell.type);
      });
      rows.push(values);
    });
    return { rows, types };
  }

  /**
   * Ana e Marcos: Família Moreira (Jorge, Célia confirmados; Pedro pendente,
   * com a tag Pajens), Padrinhos (Leonardo, com telefone; 1 vaga vazia) e Ávila.
   */
  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const familiaDaAna = await db.tag.create({ data: { weddingId, name: 'Família da Ana' } });
    const pajens = await db.tag.create({ data: { weddingId, name: 'Pajens' } });
    const moreira = await createParty(ana.cookie, weddingId, {
      name: 'Família Moreira',
      guests: [
        { name: 'Jorge Moreira', ageGroup: 'adult' },
        { name: 'Célia Moreira', ageGroup: 'adult' },
        { name: 'Pedro Moreira', ageGroup: 'child' },
      ],
      tagIds: [familiaDaAna.id],
    });
    await db.guest.updateMany({
      where: { id: { in: [moreira.guests[0].id, moreira.guests[1].id] } },
      data: { rsvpStatus: 'confirmed' },
    });
    await db.guest.update({
      where: { id: moreira.guests[0].id },
      data: { dietaryRestriction: 'sem glúten' },
    });
    await db.guestTag.createMany({
      data: [
        { weddingId, guestId: moreira.guests[2].id, tagId: familiaDaAna.id },
        { weddingId, guestId: moreira.guests[2].id, tagId: pajens.id },
      ],
    });
    await createParty(ana.cookie, weddingId, {
      name: 'Padrinhos',
      guests: [{ name: 'Leonardo Castro', phone: '+5519998761402' }],
      plusOneSlots: 1,
    });
    await createParty(ana.cookie, weddingId, { name: 'Ávila', guests: [{ name: '=SOMA(A1:A2)' }] });
    const { slug } = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    return { ana, juliana, weddingId, slug: slug as string, pajens, familiaDaAna };
  }

  it('RN01, RN02 e RN04 - o Excel dos confirmados com as colunas padrão, só texto, sem cache', async () => {
    const { ana, weddingId, slug } = await anaWedding();

    const response = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'confirmed',
      columns: DEFAULT_COLUMNS,
    }).expect(200);

    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(response.headers['cache-control']).toBe('no-store');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const fileName = `convidados-${slug}-${today}.xlsx`;
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
    );
    const { rows, types } = await sheetOf(response.body as Buffer);
    expect(rows).toEqual([
      ['Nome', 'Grupo', 'Faixa etária', 'Restrição alimentar', 'Resposta'],
      ['Jorge Moreira', 'Família Moreira', 'Adulto', 'sem glúten', 'Confirmado'],
      ['Célia Moreira', 'Família Moreira', 'Adulto', '', 'Confirmado'],
    ]);
    expect(types.every((type) => type === ExcelJS.ValueType.String)).toBe(true);
  });

  it('RN02 e RN03 - Todos sai na ordem dos grupos (sem acento) e do grupo, sem a vaga vazia', async () => {
    const { ana, weddingId } = await anaWedding();

    const response = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'party,name',
    }).expect(200);

    // As colunas seguem a ordem da tela (Nome, Grupo), não a do pedido.
    expect((await sheetOf(response.body as Buffer)).rows).toEqual([
      ['Nome', 'Grupo'],
      ['=SOMA(A1:A2)', 'Ávila'],
      ['Jorge Moreira', 'Família Moreira'],
      ['Célia Moreira', 'Família Moreira'],
      ['Pedro Moreira', 'Família Moreira'],
      ['Leonardo Castro', 'Padrinhos'],
    ]);
  });

  it('RN02 e RN04 - por tag: o convidado com a tag ou num grupo com a tag; a coluna Tags junta as do grupo e as dele, sem repetir', async () => {
    const { ana, weddingId, pajens, familiaDaAna } = await anaWedding();

    const byPajens = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'tag',
      tag: pajens.id,
      columns: 'name,tags',
    }).expect(200);
    expect((await sheetOf(byPajens.body as Buffer)).rows.slice(1)).toEqual([
      ['Pedro Moreira', 'Família da Ana, Pajens'],
    ]);

    const byFamilia = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'tag',
      tag: familiaDaAna.id,
      columns: 'name',
    }).expect(200);
    expect((await sheetOf(byFamilia.body as Buffer)).rows).toHaveLength(4);
  });

  it('RN04 e RN05 - o telefone só sai com a coluna marcada, inteiro, como texto; a célula com "=" é texto', async () => {
    const { ana, weddingId } = await anaWedding();

    const without = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'name',
    }).expect(200);
    expect(JSON.stringify((await sheetOf(without.body as Buffer)).rows)).not.toContain('5519');

    const withPhone = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'phone,name',
    }).expect(200);
    const { rows, types } = await sheetOf(withPhone.body as Buffer);
    expect(rows[0]).toEqual(['Nome', 'Telefone']);
    expect(rows).toContainEqual(['Leonardo Castro', '+5519998761402']);
    expect(rows).toContainEqual(['=SOMA(A1:A2)', '']);
    expect(types.every((type) => type === ExcelJS.ValueType.String)).toBe(true);
  });

  it('RN08 - o log registra a exportação sem a lista; com Restrição alimentar, o evento exportacao_buffet; sem ela, não', async () => {
    const { ana, juliana, weddingId } = await anaWedding();

    await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'confirmed',
      columns: DEFAULT_COLUMNS,
    }).expect(200);
    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'guests.exported' },
    });
    expect(log).toMatchObject({
      actorUserId: ana.userId,
      data: {
        format: 'xlsx',
        who: 'confirmed',
        columns: ['name', 'party', 'ageGroup', 'dietaryRestriction', 'rsvp'],
        guests: 2,
      },
    });
    expect(JSON.stringify(log)).not.toMatch(/Moreira|glúten/);
    const latestEvent = () =>
      db.productEvent.findFirst({
        where: { name: 'exportacao_buffet' },
        orderBy: { createdAt: 'desc' },
      });
    expect((await latestEvent())?.props).toEqual({
      formato: 'xlsx',
      quem: 'owner',
      filtro: 'confirmed',
    });

    const before = await db.productEvent.count({ where: { name: 'exportacao_buffet' } });
    await exportGuests(juliana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'name,phone',
    }).expect(200);
    expect(await db.productEvent.count({ where: { name: 'exportacao_buffet' } })).toBe(before);
    await exportGuests(juliana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'dietaryRestriction',
    }).expect(200);
    expect((await latestEvent())?.props).toEqual({
      formato: 'xlsx',
      quem: 'collaborator',
      filtro: 'all',
    });
  });

  it('RN01 e RN09 - o PDF para o cerimonial: application/pdf, o nome com .pdf, sem cache, e o evento com formato pdf', async () => {
    const { ana, weddingId, slug, pajens } = await anaWedding();

    const response = await exportGuests(ana.cookie, weddingId, {
      format: 'pdf',
      who: 'tag',
      tag: pajens.id,
      columns: DEFAULT_COLUMNS,
    }).expect(200);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(
      new RegExp(`filename="convidados-${slug}-\\d{4}-\\d{2}-\\d{2}\\.pdf"`),
    );
    const raw = (response.body as Buffer).toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toMatch(/NunitoSans/);
    const latestEvent = await db.productEvent.findFirst({
      where: { name: 'exportacao_buffet' },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestEvent?.props).toEqual({ formato: 'pdf', quem: 'owner', filtro: 'tag' });
    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'guests.exported' },
    });
    expect(log.data).toMatchObject({ format: 'pdf', who: 'tag', tagId: pajens.id, guests: 1 });
  });

  it('RN08 - o tag= da URL só vai para o log com who=tag', async () => {
    const { ana, weddingId, pajens } = await anaWedding();

    await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      tag: pajens.id,
      columns: 'name',
    }).expect(200);

    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'guests.exported' },
    });
    expect(log.data).not.toHaveProperty('tagId');
    expect(log.data).toMatchObject({ who: 'all', guests: 5 });
  });

  it('casos de borda - filtro sem ninguém dá 409 NOTHING_TO_EXPORT', async () => {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await createParty(ana.cookie, weddingId, { name: 'A', guests: [{ name: 'Ana' }] });

    const response = await exportGuests(ana.cookie, weddingId, {
      format: 'xlsx',
      who: 'confirmed',
      columns: 'name',
    }).expect(409);

    expect(JSON.parse((response.body as Buffer).toString()).error).toBe('NOTHING_TO_EXPORT');
  });

  it('RN02 e RN04 - tag na lixeira, tag ausente, coluna fora da lista e sem coluna dão 400', async () => {
    const { ana, weddingId, pajens } = await anaWedding();
    await db.tag.update({ where: { id: pajens.id }, data: { deletedAt: new Date() } });

    const queries: Record<string, string>[] = [
      { format: 'xlsx', who: 'tag', tag: pajens.id, columns: 'name' },
      { format: 'xlsx', who: 'tag', columns: 'name' },
      { format: 'xlsx', who: 'all', columns: 'name,email' },
      { format: 'xlsx', who: 'all', columns: '' },
    ];
    for (const query of queries) await exportGuests(ana.cookie, weddingId, query).expect(400);
  });

  it('RN07 - sem vínculo, o casamento não existe', async () => {
    const { weddingId } = await anaWedding();
    const stranger = await signedInUser({ app, name: 'Estranha' });

    await exportGuests(stranger.cookie, weddingId, {
      format: 'xlsx',
      who: 'all',
      columns: 'name',
    }).expect(404);
  });
});
