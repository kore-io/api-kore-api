import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

const binary = (response: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

/** Pergunta de música e Músicas (Música RN01 a RN07; banco real). */
describe('Pergunta de música e Músicas (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  async function scenario({ enabled = true }: { enabled?: boolean } = {}) {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: { slug, songQuestionEnabled: enabled },
    });
    const party = async (name: string) =>
      db.party.create({
        data: { weddingId, name, linkToken: randomBytes(16).toString('base64url') },
      });
    const suggest = async ({
      partyId,
      name,
      song,
      at,
      deletedAt = null,
    }: {
      partyId: string;
      name: string;
      song: string;
      at: string;
      deletedAt?: Date | null;
    }) =>
      db.guest.create({
        data: {
          weddingId,
          partyId,
          name,
          rsvpStatus: 'confirmed',
          songSuggestion: song,
          songSuggestedAt: new Date(at),
          deletedAt,
        },
      });
    return { ana, juliana, weddingId, slug, party, suggest };
  }

  const songQuestion = (cookie: string, weddingId: string, body: object) =>
    http()
      .put(`/v1/weddings/${weddingId}/site/song-question`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const list = (cookie: string, weddingId: string, cursor?: string) =>
    http()
      .get(`/v1/weddings/${weddingId}/song-suggestions`)
      .query(cursor ? { cursor } : {})
      .set('Cookie', cookie);
  const exportFile = (cookie: string, weddingId: string) =>
    http()
      .get(`/v1/weddings/${weddingId}/song-suggestions/export`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse(binary);

  it('RN01 - a pergunta no Editor: liga com o texto, vazio volta ao padrão, até 120; qualquer vínculo', async () => {
    const { ana, juliana, weddingId } = await scenario({ enabled: false });

    await songQuestion(juliana.cookie, weddingId, {
      enabled: true,
      text: '  Qual música te faz dançar?  ',
    })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ enabled: true, text: 'Qual música te faz dançar?' }),
      );
    const editor = await http()
      .get(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(editor.body.songQuestion).toEqual({ enabled: true, text: 'Qual música te faz dançar?' });

    await songQuestion(ana.cookie, weddingId, { enabled: true, text: '' })
      .expect(200)
      .expect(({ body }) => expect(body.text).toBe('Que música não pode faltar na festa?'));
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).songQuestionText,
    ).toBeNull();

    const tooLong = await songQuestion(ana.cookie, weddingId, {
      enabled: true,
      text: 'a'.repeat(121),
    }).expect(400);
    expect(tooLong.body.errors).toEqual([{ path: 'text', code: 'TOO_LONG', params: { max: 120 } }]);
  });

  it('RN05 - a lista: da mais antiga para a mais nova, sem juntar repetidas, só fora da lixeira, 50 por vez', async () => {
    const { ana, weddingId, party, suggest } = await scenario();
    const moreira = await party('Família Moreira');
    const trashed = await party('Amigos do vôlei');
    await db.party.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    for (let index = 0; index < 52; index++)
      await suggest({
        partyId: moreira.id,
        name: `Convidado ${String(index).padStart(2, '0')}`,
        song: index < 2 ? 'Evidências' : `Música ${index}`,
        at: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
      });
    await suggest({
      partyId: moreira.id,
      name: 'Na lixeira',
      song: 'Fora',
      at: '2026-08-01T00:00:00Z',
      deletedAt: new Date(),
    });
    await suggest({
      partyId: trashed.id,
      name: 'Grupo na lixeira',
      song: 'Fora',
      at: '2026-08-01T00:00:00Z',
    });

    const first = await list(ana.cookie, weddingId).expect(200);
    expect(first.body.total).toBe(52);
    expect(first.body.items).toHaveLength(50);
    expect((first.body.items as unknown[]).slice(0, 2)).toEqual([
      expect.objectContaining({
        song: 'Evidências',
        guestName: 'Convidado 00',
        partyName: 'Família Moreira',
      }),
      expect.objectContaining({ song: 'Evidências', guestName: 'Convidado 01' }),
    ]);
    const second = await list(ana.cookie, weddingId, first.body.nextCursor as string).expect(200);
    expect((second.body.items as { guestName: string }[]).map((item) => item.guestName)).toEqual([
      'Convidado 50',
      'Convidado 51',
    ]);
    expect(second.body.nextCursor).toBeNull();
    await list(ana.cookie, weddingId, 'nao-e-cursor').expect(400);
  });

  it('RN02 e RN03 - desligada, a lista e a exportação dão SONG_QUESTION_DISABLED; religar mostra as que já chegaram', async () => {
    const { ana, weddingId, party, suggest } = await scenario();
    const moreira = await party('Família Moreira');
    await suggest({
      partyId: moreira.id,
      name: 'Célia',
      song: 'Evidências',
      at: '2026-09-12T23:14:00Z',
    });

    await songQuestion(ana.cookie, weddingId, { enabled: false, text: null }).expect(200);
    const disabled = await list(ana.cookie, weddingId).expect(404);
    expect(disabled.body.error).toBe('SONG_QUESTION_DISABLED');
    await exportFile(ana.cookie, weddingId).expect(404);

    await songQuestion(ana.cookie, weddingId, { enabled: true, text: null }).expect(200);
    expect((await list(ana.cookie, weddingId).expect(200)).body.total).toBe(1);
  });

  it('RN06 - exportar para o DJ: o .xlsx com as colunas, a data no fuso do casamento (hora da Voz) e tudo como texto', async () => {
    const { juliana, weddingId, slug, party, suggest } = await scenario();
    const moreira = await party('Família Moreira');
    await suggest({
      partyId: moreira.id,
      name: 'Célia Moreira',
      song: 'Evidências',
      at: '2026-09-12T23:14:00Z',
    });
    await suggest({
      partyId: moreira.id,
      name: 'Luiz Moreira',
      song: '=SOMA(A1:A2)',
      at: '2026-09-13T10:05:00Z',
    });
    // Hora cheia: "9h", sem os minutos (decisão 246; a regra da Voz para listas).
    await suggest({
      partyId: moreira.id,
      name: 'Rita Moreira',
      song: 'Garota de Ipanema',
      at: '2026-09-14T12:00:00Z',
    });

    const response = await exportFile(juliana.cookie, weddingId).expect(200);

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="musicas-${slug}.xlsx"; filename*=UTF-8''musicas-${slug}.xlsx`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const workbook = new ExcelJS.Workbook();
    const file = response.body as Buffer;
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const rows = [1, 2, 3, 4].map((row) =>
      (sheet.getRow(row).values as unknown[]).slice(1).map((value) => value),
    );
    expect(rows).toEqual([
      ['Música', 'Quem sugeriu', 'Grupo', 'Data da sugestão'],
      ['Evidências', 'Célia Moreira', 'Família Moreira', '12/09 às 20h14'],
      ['=SOMA(A1:A2)', 'Luiz Moreira', 'Família Moreira', '13/09 às 7h05'],
      ['Garota de Ipanema', 'Rita Moreira', 'Família Moreira', '14/09 às 9h'],
    ]);
    expect(sheet.getCell('A3').formula).toBeUndefined();
  });

  it('RN06 - sem sugestões, NOTHING_TO_EXPORT; outro casamento não lê', async () => {
    const { ana, weddingId } = await scenario();
    const other = await scenario();

    const empty = await exportFile(ana.cookie, weddingId).expect(409);
    expect(JSON.parse((empty.body as Buffer).toString()).error).toBe('NOTHING_TO_EXPORT');
    await list(other.ana.cookie, weddingId).expect(404);
  });
});
