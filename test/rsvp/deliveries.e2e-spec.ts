import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WeddingPseudonymizer } from '../../src/modules/product-events/infrastructure/wedding-pseudonymizer';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_URL = 'http://localhost:5174';
const DAY_MS = 86_400_000;

type QueueItem = {
  id: string;
  name: string;
  deliveryStatus: string;
  sentAt: string | null;
  lastChannel: string | null;
  contact: { name: string; phoneMasked: string | null; emailMasked: string | null } | null;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  copyText: string;
};

/** Envios de convite, save the date e lembrete (Envios RN01 a RN11; banco real). */
describe('Envios (banco real)', () => {
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
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

  /** Ana & Marcos publicado em kore.com.br/<slug>, com a Família Moreira (Célia contato, com telefone). */
  async function scenario({ status = 'published' }: { status?: 'published' | 'draft' } = {}) {
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
      data: {
        slug,
        status,
        eventDate: new Date('2026-11-14T00:00:00Z'),
        ...(status === 'published'
          ? {
              publishedAt: new Date(),
              endDate: new Date('2027-02-14T00:00:00Z'),
              publicationSource: 'courtesy' as const,
            }
          : {}),
      },
    });
    const createParty = async (body: Record<string, unknown>) => {
      const created = await http()
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send(body)
        .expect(201);
      return db.party.findUniqueOrThrow({ where: { id: created.body.id as string } });
    };
    const moreira = await createParty({
      name: 'Família Moreira',
      guests: [
        { name: 'Célia Moreira', phone: '19998763310', email: 'celia.moreira@gmail.com' },
        { name: 'Luiz Moreira' },
      ],
    });
    return { ana, juliana, weddingId, slug, createParty, moreira };
  }

  const queue = (cookie: string, weddingId: string, kind: string, partyIds: string[]) =>
    http()
      .get(`/v1/weddings/${weddingId}/deliveries/queue`)
      .query({ kind, partyIds: partyIds.join(',') })
      .set('Cookie', cookie);
  const mark = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/weddings/${weddingId}/deliveries`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  it('RN06, RN07 e RN11 - a fila traz o contato mascarado e as URLs prontas com o número inteiro e a mensagem', async () => {
    const { ana, weddingId, slug, moreira } = await scenario();

    const response = await queue(ana.cookie, weddingId, 'invite', [moreira.id]).expect(200);

    expect(response.headers['cache-control']).toBe('private, no-store');
    const [item] = response.body.items as QueueItem[];
    const link = `${SITE_URL}/${slug}/grupo/${moreira.linkToken}`;
    const text = `Oi, Família Moreira! Vamos nos casar no dia 14 de novembro, em Campinas, e contamos com a sua presença.\nA confirmação é por este link: ${link}\n\nCom carinho, Ana & Marcos`;
    expect(item).toMatchObject({
      id: moreira.id,
      deliveryStatus: 'not_sent',
      contact: {
        name: 'Célia Moreira',
        phoneMasked: '(19) 9****-3310',
        emailMasked: 'ce***@gmail.com',
      },
      copyText: text,
      whatsappUrl: `https://wa.me/5519998763310?text=${encodeURIComponent(text)}`,
      mailtoUrl: `mailto:celia.moreira@gmail.com?subject=${encodeURIComponent('Convite do casamento de Ana & Marcos')}&body=${encodeURIComponent(text)}`,
    });
    expect(response.body).toMatchObject({
      kind: 'invite',
      subject: 'Convite do casamento de Ana & Marcos',
      skippedPartyIds: [],
    });
  });

  it('RN07, RN08 e D29 - marcar o convite: o grupo fica enviado, o 1º envio fica guardado e o evento sai uma vez', async () => {
    const { ana, juliana, weddingId, moreira } = await scenario();
    const weddingRef = app.get(WeddingPseudonymizer).weddingRef({ weddingId });

    // A colaboradora também envia (RN02).
    const first = await mark(juliana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(200);
    expect(first.body.parties).toEqual([
      expect.objectContaining({ id: moreira.id, deliveryStatus: 'sent', lastChannel: 'whatsapp' }),
    ]);
    const sentAt = first.body.parties[0].sentAt as string;

    // Enviar de novo por e-mail: o 1º envio fica; o histórico ganha a linha.
    const again = await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'email',
    }).expect(200);
    expect(again.body.parties[0]).toMatchObject({ sentAt, lastChannel: 'email' });
    expect(
      (
        await db.partyDelivery.findMany({
          where: { partyId: moreira.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => [row.kind, row.channel, row.userId]),
    ).toEqual([
      ['invite', 'whatsapp', juliana.userId],
      ['invite', 'email', ana.userId],
    ]);
    const events = await db.productEvent.findMany({ where: { weddingRef, name: 'grupo_enviado' } });
    expect(events).toEqual([
      expect.objectContaining({ props: { canal: 'whatsapp', grupos_total: 1 } }),
    ]);
  });

  it('RN08 - visualizado e respondido não voltam a enviado', async () => {
    const { ana, weddingId, moreira } = await scenario();
    await db.party.update({ where: { id: moreira.id }, data: { deliveryStatus: 'viewed' } });

    await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'link',
    }).expect(200);

    expect(await db.party.findUniqueOrThrow({ where: { id: moreira.id } })).toMatchObject({
      deliveryStatus: 'viewed',
      lastChannel: 'link',
    });
  });

  it('RN03 - o save the date leva o endereço do site, sem o link do grupo, e não muda o status', async () => {
    const { ana, weddingId, slug, moreira } = await scenario();

    const [item] = (await queue(ana.cookie, weddingId, 'save_the_date', [moreira.id]).expect(200))
      .body.items as QueueItem[];
    expect(item.copyText).toContain(`localhost:5174/${slug}`);
    expect(item.copyText).not.toContain(moreira.linkToken);

    await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'save_the_date',
      channel: 'whatsapp',
    }).expect(200);
    const stored = await db.party.findUniqueOrThrow({ where: { id: moreira.id } });
    expect(stored.deliveryStatus).toBe('not_sent');
    expect(stored.saveTheDateSentAt).not.toBeNull();
    expect(stored.sentAt).toBeNull();

    const list = await http()
      .get(`/v1/weddings/${weddingId}/parties`)
      .query({ saveTheDate: 'sent' })
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('RN03 e RN04 - o lembrete só para quem já recebeu e não respondeu; os outros ficam de fora', async () => {
    const { ana, weddingId, moreira, createParty } = await scenario();
    const duarte = await createParty({
      name: 'Família Duarte',
      guests: [{ name: 'Carla Duarte' }],
    });
    const igreja = await createParty({ name: 'Igreja', guests: [{ name: 'Pastor Jair' }] });
    await db.party.updateMany({
      where: { id: { in: [moreira.id, duarte.id] } },
      data: { deliveryStatus: 'sent', sentAt: new Date() },
    });
    await db.guest.updateMany({
      where: { partyId: duarte.id },
      data: { rsvpStatus: 'confirmed', respondedAt: new Date() },
    });
    await db.party.update({ where: { id: duarte.id }, data: { deliveryStatus: 'responded' } });
    const ids = [moreira.id, duarte.id, igreja.id];

    const response = await queue(ana.cookie, weddingId, 'reminder', ids).expect(200);
    expect((response.body.items as QueueItem[]).map((item) => item.name)).toEqual([
      'Família Moreira',
    ]);
    expect([...(response.body.skippedPartyIds as string[])].sort()).toEqual(
      [duarte.id, igreja.id].sort(),
    );

    const outside = await mark(ana.cookie, weddingId, {
      partyIds: ids,
      kind: 'reminder',
      channel: 'whatsapp',
    }).expect(422);
    expect(outside.body).toMatchObject({ error: 'PARTY_NOT_REMINDABLE' });
    await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'reminder',
      channel: 'whatsapp',
    }).expect(200);
    const stored = await db.party.findUniqueOrThrow({ where: { id: moreira.id } });
    expect(stored.lastReminderAt).not.toBeNull();
    expect(stored.deliveryStatus).toBe('sent');
  });

  it('RN01 - antes de publicar, depois do prazo (lembrete) e no pós-evento: DELIVERIES_CLOSED com o motivo', async () => {
    const draft = await scenario({ status: 'draft' });
    const notPublished = await mark(draft.ana.cookie, draft.weddingId, {
      partyIds: [draft.moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(409);
    expect(notPublished.body).toMatchObject({
      error: 'DELIVERIES_CLOSED',
      reason: 'not_published',
    });
    await queue(draft.ana.cookie, draft.weddingId, 'invite', [draft.moreira.id]).expect(409);

    const { ana, weddingId, moreira } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date(`${day(-1)}T00:00:00Z`) },
    });
    const late = await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'reminder',
      channel: 'whatsapp',
    }).expect(409);
    expect(late.body.reason).toBe('deadline_passed');
    // O convite segue valendo depois do prazo.
    await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(200);

    await db.wedding.update({ where: { id: weddingId }, data: { status: 'post_event' } });
    const after = await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(409);
    expect(after.body.reason).toBe('post_event');
  });

  it('RN06 (R4-4) - marcadores numa passada só: o grupo chamado "{link}" não vira o link', async () => {
    const { ana, weddingId, slug, createParty } = await scenario();
    const odd = await createParty({ name: '{link}', guests: [{ name: 'Alguém' }] });

    const [item] = (await queue(ana.cookie, weddingId, 'invite', [odd.id]).expect(200)).body
      .items as QueueItem[];

    expect(item.copyText.startsWith('Oi, {link}! ')).toBe(true);
    expect(item.copyText.split(`${SITE_URL}/${slug}/grupo/`)).toHaveLength(2);
    // Sem telefone nem e-mail: sem as URLs (o app mostra o aviso e o Editar grupo).
    expect(item).toMatchObject({ contact: null, whatsappUrl: null, mailtoUrl: null });
  });

  it('RN09 e RN10 - o QR só no convite; mais de 200 grupos e grupo na lixeira são recusados', async () => {
    const { ana, weddingId, moreira } = await scenario();

    const qr = await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'reminder',
      channel: 'qr',
    }).expect(422);
    expect(qr.body.error).toBe('QR_ONLY_FOR_INVITE');

    const many = Array.from({ length: 201 }, () => randomUUID());
    const tooMany = await mark(ana.cookie, weddingId, {
      partyIds: many,
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(400);
    expect(tooMany.body.errors).toEqual([
      expect.objectContaining({ path: 'partyIds', code: 'ARRAY_MAX_SIZE', params: { max: 200 } }),
    ]);
    await queue(ana.cookie, weddingId, 'invite', many).expect(400);

    await db.party.update({ where: { id: moreira.id }, data: { deletedAt: new Date() } });
    const gone = await mark(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(404);
    expect(gone.body).toMatchObject({ error: 'PARTY_NOT_FOUND', partyIds: [moreira.id] });
  });

  it('decisão 153 - outro casamento não lê a fila nem marca os grupos', async () => {
    const { weddingId, moreira } = await scenario();
    const other = await scenario();

    await queue(other.ana.cookie, weddingId, 'invite', [moreira.id]).expect(404);
    // Pelo próprio casamento, o grupo alheio não existe.
    const foreign = await mark(other.ana.cookie, other.weddingId, {
      partyIds: [moreira.id],
      kind: 'invite',
      channel: 'whatsapp',
    }).expect(404);
    expect(foreign.body.error).toBe('PARTY_NOT_FOUND');
  });
});
