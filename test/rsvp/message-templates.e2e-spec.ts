import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Mensagens prontas dos envios (Envios RN06; banco real). */
describe('Mensagens prontas (banco real)', () => {
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
  type Template = { kind: string; subject: string; body: string; isDefault: boolean };

  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    return { ana, juliana, weddingId };
  }
  const list = async (cookie: string, weddingId: string) =>
    (
      await http()
        .get(`/v1/weddings/${weddingId}/message-templates`)
        .set('Cookie', cookie)
        .expect(200)
    ).body.items as Template[];
  const put = (cookie: string, weddingId: string, kind: string, body: object) =>
    http()
      .put(`/v1/weddings/${weddingId}/message-templates/${kind}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  it('RN06 - sem edição, as três mensagens padrão, com a cidade e os nomes do casal', async () => {
    const { ana, weddingId } = await scenario();

    const items = await list(ana.cookie, weddingId);

    expect(items.map((item) => [item.kind, item.isDefault])).toEqual([
      ['invite', true],
      ['save_the_date', true],
      ['reminder', true],
    ]);
    expect(items[0]).toMatchObject({
      subject: 'Convite do casamento de Ana & Marcos',
      body: 'Oi, {nome_do_grupo}! Vamos nos casar no dia {data}, em Campinas, e contamos com a sua presença.\nA confirmação é por este link: {link}\n\nCom carinho, Ana & Marcos',
    });
    expect(items[2].body).toContain('A confirmação é por este link: {link}');

    // Com prazo, o lembrete padrão fala do prazo.
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date('2026-10-15T00:00:00Z') },
    });
    expect((await list(ana.cookie, weddingId))[2].body).toContain('Dá para confirmar até {prazo}');
  });

  it('RN06 - a colaboradora grava a mensagem para os próximos envios; o assunto vazio vale o padrão', async () => {
    const { ana, juliana, weddingId } = await scenario();
    const body = 'Oi, {nome_do_grupo}! Confirma aqui: {link}';

    const saved = await put(juliana.cookie, weddingId, 'invite', { body, subject: '  ' }).expect(
      200,
    );

    expect(saved.body).toEqual({
      kind: 'invite',
      subject: 'Convite do casamento de Ana & Marcos',
      body,
      isDefault: false,
    });
    expect((await list(ana.cookie, weddingId))[0]).toMatchObject({ body, isDefault: false });
    expect(await db.messageTemplate.findFirstOrThrow({ where: { weddingId } })).toMatchObject({
      kind: 'invite',
      subject: null,
      updatedByUserId: juliana.userId,
    });

    await put(ana.cookie, weddingId, 'invite', { body, subject: 'Nosso convite' }).expect(200);
    expect((await list(ana.cookie, weddingId))[0].subject).toBe('Nosso convite');
  });

  it('RN06 (D15) - o convite e o lembrete sem o {link}: 422; o save the date não precisa', async () => {
    const { ana, weddingId } = await scenario();

    for (const kind of ['invite', 'reminder']) {
      const response = await put(ana.cookie, weddingId, kind, { body: 'Oi! Responda.' }).expect(
        422,
      );
      expect(response.body.error).toBe('LINK_PLACEHOLDER_MISSING');
    }
    await put(ana.cookie, weddingId, 'save_the_date', { body: 'Guarde a data: {data}.' }).expect(
      200,
    );
    expect(await db.messageTemplate.count({ where: { weddingId } })).toBe(1);
  });

  it('RN06 - tamanhos e o assunto com quebra de linha: 400 por campo', async () => {
    const { ana, weddingId } = await scenario();
    const errors = async (payload: object, kind = 'invite') =>
      ((await put(ana.cookie, weddingId, kind, payload).expect(400)).body as { errors: unknown[] })
        .errors;

    expect(await errors({ body: `{link}${'a'.repeat(1000)}` })).toEqual([
      expect.objectContaining({ path: 'body', code: 'MAX_LENGTH', params: { max: 1000 } }),
    ]);
    expect(
      await errors({ body: '{link}', subject: 'Convite\r\nBcc: x@exemplo.kore.local' }),
    ).toEqual([expect.objectContaining({ path: 'subject', code: 'MATCHES' })]);
    expect(await errors({ body: '' })).toEqual([
      expect.objectContaining({ path: 'body', code: 'IS_NOT_EMPTY' }),
    ]);
    await put(ana.cookie, weddingId, 'aniversario', { body: '{link}' }).expect(400);
  });

  it('RN06 - Restaurar a mensagem padrão apaga a guardada', async () => {
    const { ana, weddingId } = await scenario();
    await put(ana.cookie, weddingId, 'reminder', { body: 'Falta você! {link}' }).expect(200);

    const reset = await put(ana.cookie, weddingId, 'reminder', { reset: true }).expect(200);

    expect(reset.body).toMatchObject({ kind: 'reminder', isDefault: true });
    expect(reset.body.body).toContain('Ainda não recebemos a sua resposta');
    expect(await db.messageTemplate.count({ where: { weddingId } })).toBe(0);
  });

  it('decisão 153 - outro casamento não lê nem grava as mensagens', async () => {
    const { weddingId } = await scenario();
    const estranha = await scenario();

    await http()
      .get(`/v1/weddings/${weddingId}/message-templates`)
      .set('Cookie', estranha.ana.cookie)
      .expect(404);
    await put(estranha.ana.cookie, weddingId, 'invite', { body: '{link}' }).expect(404);
  });
});
