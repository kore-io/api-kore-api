import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { inbox, waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

describe('Convites de acesso: envio e cancelamento (banco real, Mailpit)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let worker: TestingModule;

  beforeAll(async () => {
    app = await createTestApp();
    // Os e-mails de convite saem pela fila comum: o worker é quem envia.
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const email = (name: string) => `${name}.${randomUUID()}@kore.local`;
  const send = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const cancel = (cookie: string, weddingId: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/v1/weddings/${weddingId}/access-invitations/${id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);

  async function coupleWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    return { ana, weddingId };
  }

  async function plannerWedding(kind: 'planner' | 'seller' = 'planner') {
    const { userId } = await seedReferrer({
      db,
      kind,
      name: kind === 'planner' ? 'Juliana Prado' : 'Lucas Lima',
    });
    if (kind === 'planner')
      await db.planner.update({
        where: { referrerId: (await db.referrer.findUniqueOrThrow({ where: { userId } })).id },
        data: { creditName: 'Prado Assessoria' },
      });
    const cookie = await openSession({ app, userId });
    const { weddingId } = await seedReferrerWedding({
      db,
      referrerUserId: userId,
      referrerKind: kind,
    });
    return { userId, cookie, weddingId };
  }

  it('RN01 a RN03 - o dono convida o parceiro: 201, 30 dias, só o hash no banco e o e-mail 2 na caixa', async () => {
    const { ana, weddingId } = await coupleWedding();
    const marcos = email('marcos');

    const response = await send(ana.cookie, weddingId, {
      kind: 'partner',
      emails: [marcos.toUpperCase()],
      message: 'Vem montar comigo!',
    }).expect(201);

    const [sent] = response.body.invitations;
    expect(sent).toEqual({
      id: expect.any(String),
      email: marcos,
      kind: 'partner',
      expiresAt: expect.any(String),
      resent: false,
    });
    expect(new Date(sent.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      29.9 * 24 * 3600 * 1000,
    );
    const stored = await db.accessInvitation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(stored).toMatchObject({ role: 'owner', invitedByUserId: ana.userId });
    const [message] = await waitForInbox({ to: marcos });
    expect(message?.Subject).toBe('Ana convidou você para o casamento no Kore');
    const body = (await (
      await fetch(
        `${process.env.MAILPIT_API_URL ?? 'http://localhost:8025'}/api/v1/message/${message?.ID}`,
      )
    ).json()) as { Text: string };
    const token = /\/convite\/([\w-]+)/.exec(body.Text)?.[1] ?? '';
    expect(createHash('sha256').update(token).digest('base64url')).toBe(stored.tokenHash);
    expect(body.Text).toContain('“Vem montar comigo!”');
  });

  it('RN04 - reenviar ao mesmo e-mail substitui o pendente: um só pendente, resent true', async () => {
    const { ana, weddingId } = await coupleWedding();
    const marcos = email('marcos');
    const first = await send(ana.cookie, weddingId, { kind: 'partner', emails: [marcos] }).expect(
      201,
    );

    const second = await send(ana.cookie, weddingId, { kind: 'partner', emails: [marcos] }).expect(
      201,
    );

    expect(second.body.invitations[0].resent).toBe(true);
    const old = await db.accessInvitation.findUniqueOrThrow({
      where: { id: first.body.invitations[0].id },
    });
    expect(old.supersededAt).toBeInstanceOf(Date);
    expect(
      await db.accessInvitation.count({
        where: { weddingId, supersededAt: null, revokedAt: null },
      }),
    ).toBe(1);
    await waitForInbox({ to: marcos, count: 2 });
  });

  it('RN02 - casamento com 2 donos: 409 OWNERS_FULL', async () => {
    const { ana, weddingId } = await coupleWedding();
    const marcos = await signedInUser({ app });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });

    const response = await send(ana.cookie, weddingId, {
      kind: 'partner',
      emails: [email('x')],
    }).expect(409);

    expect(response.body.error).toBe('OWNERS_FULL');
  });

  it('RN02 - casamento que já tem cerimonialista: 409 PLANNER_ALREADY; sem cerimonialista, o e-mail 4 sai', async () => {
    const { ana, weddingId } = await coupleWedding();
    const juliana = email('juliana');
    await send(ana.cookie, weddingId, { kind: 'planner', emails: [juliana] }).expect(201);
    expect((await waitForInbox({ to: juliana }))[0]?.Subject).toBe(
      'Ana e Marcos convidaram você como cerimonialista',
    );
    const planner = await signedInUser({ app });
    await db.membership.create({
      data: { weddingId, userId: planner.userId, role: 'collaborator' },
    });

    const response = await send(ana.cookie, weddingId, {
      kind: 'planner',
      emails: [email('outra')],
    }).expect(409);

    expect(response.body.error).toBe('PLANNER_ALREADY');
  });

  it('RN02 - o colaborador não convida o parceiro (403 ACTION_NOT_ALLOWED), e quem não tem vínculo vê 404', async () => {
    const { weddingId } = await coupleWedding();
    const planner = await signedInUser({ app });
    await db.membership.create({
      data: { weddingId, userId: planner.userId, role: 'collaborator' },
    });
    const stranger = await signedInUser({ app });

    expect(
      (await send(planner.cookie, weddingId, { kind: 'partner', emails: [email('x')] }).expect(403))
        .body.error,
    ).toBe('ACTION_NOT_ALLOWED');
    expect(
      (
        await send(stranger.cookie, weddingId, { kind: 'partner', emails: [email('x')] }).expect(
          404,
        )
      ).body.error,
    ).toBe('WEDDING_NOT_FOUND');
  });

  it.each([
    ['dois e-mails no parceiro', { kind: 'partner', emails: ['a@kore.local', 'b@kore.local'] }],
    ['nenhum e-mail no cerimonialista', { kind: 'planner', emails: [] }],
    ['e-mail inválido', { kind: 'partner', emails: ['nao-e-email'] }],
    ['três e-mails no casal', { kind: 'couple', emails: ['a@k.local', 'b@k.local', 'c@k.local'] }],
  ])('RN01 - %s dá 400', async (_, body) => {
    const { ana, weddingId } = await coupleWedding();

    await send(ana.cookie, weddingId, body).expect(400);
  });

  it('RN02 e RN04 (decisão 170) - o cerimonialista convida o casal (e-mail 3) e o casamento fica aguardando; reenviar a um e-mail mantém o outro, e Convidar outro e-mail é cancelar e enviar (limite de 2, decisão 170(4))', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const [fernanda, joao, outra] = [email('fernanda'), email('joao'), email('outra')];

    const first = await send(cookie, weddingId, {
      kind: 'couple',
      emails: [fernanda, joao],
    }).expect(201);

    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'awaiting_couple',
    );
    const [message] = await waitForInbox({ to: fernanda });
    expect(message?.Subject).toBe('Prado Assessoria preparou o site do casamento de vocês');
    await waitForInbox({ to: joao });

    const resent = await send(cookie, weddingId, { kind: 'couple', emails: [fernanda] }).expect(
      201,
    );
    expect(resent.body.invitations[0].resent).toBe(true);
    const pendingEmails = async () =>
      (
        await db.accessInvitation.findMany({
          where: { weddingId, supersededAt: null, revokedAt: null },
          orderBy: { email: 'asc' },
        })
      ).map((invitation) => invitation.email);
    expect(await pendingEmails()).toEqual([fernanda, joao].sort());

    // Decisão 170(4): com 2 pendentes não vencidos, um terceiro e-mail espera um cancelamento.
    const full = await send(cookie, weddingId, { kind: 'couple', emails: [outra] }).expect(409);
    expect(full.body.error).toBe('COUPLE_INVITATIONS_FULL');

    const joaoInvitation = (first.body.invitations as { id: string; email: string }[]).find(
      (invitation) => invitation.email === joao,
    );
    await cancel(cookie, weddingId, joaoInvitation?.id ?? '').expect(204);
    await send(cookie, weddingId, { kind: 'couple', emails: [outra] }).expect(201);

    expect(await pendingEmails()).toEqual([fernanda, outra].sort());
  });

  it('RN14 - o link do casal sem e-mail: URL só na resposta, Gerar novo link invalida o anterior, e registra cerim_link_gerado', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const eventsBefore = await db.productEvent.count({ where: { name: 'cerim_link_gerado' } });

    const first = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    const second = await send(cookie, weddingId, { kind: 'couple', emails: [] }).expect(201);

    expect(first.body.invitations[0]).toMatchObject({ email: null, kind: 'couple', resent: false });
    expect(first.body.invitations[0].url).toMatch(/^http:\/\/localhost:5173\/convite\/[\w-]{43}$/);
    expect(second.body.invitations[0].resent).toBe(true);
    const links = await db.accessInvitation.findMany({ where: { weddingId, email: null } });
    expect(links.filter((link) => !link.supersededAt)).toHaveLength(1);
    expect(await db.productEvent.count({ where: { name: 'cerim_link_gerado' } })).toBe(
      eventsBefore + 2,
    );
  });

  it('RN02 - o vendedor que criou convida o casal com "{nome}, do Kore,"', async () => {
    const { cookie, weddingId } = await plannerWedding('seller');
    const fernanda = email('fernanda');

    await send(cookie, weddingId, { kind: 'couple', emails: [fernanda] }).expect(201);

    expect((await waitForInbox({ to: fernanda }))[0]?.Subject).toBe(
      'Lucas, do Kore, preparou o site do casamento de vocês',
    );
  });

  it('RN02 - o dono não envia o convite do casal (403)', async () => {
    const { ana, weddingId } = await coupleWedding();

    await send(ana.cookie, weddingId, { kind: 'couple', emails: [email('x')] }).expect(403);
  });

  it('RN05 e RN13 - quem enviou cancela; o link cai, a atividade é registrada, e cancelar de novo dá 409 NOT_PENDING', async () => {
    const { cookie, weddingId } = await plannerWedding();
    await db.wedding.update({
      where: { id: weddingId },
      data: { lastActivityAt: new Date('2026-01-01') },
    });
    const sent = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    const id = sent.body.invitations[0].id as string;

    await cancel(cookie, weddingId, id).expect(204);

    expect(
      (await db.accessInvitation.findUniqueOrThrow({ where: { id } })).revokedAt,
    ).toBeInstanceOf(Date);
    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(wedding.lastActivityAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await cancel(cookie, weddingId, id).expect(409)).body.error).toBe('NOT_PENDING');
  });

  it('RN05 - um dono cancela o convite enviado pelo outro dono; um colaborador que não enviou, não (403)', async () => {
    const { ana, weddingId } = await coupleWedding();
    const marcos = await signedInUser({ app });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
    const planner = await signedInUser({ app });
    await db.membership.create({
      data: { weddingId, userId: planner.userId, role: 'collaborator' },
    });
    // Convite enviado por Ana (gravado direto: com colaborador, o envio daria PLANNER_ALREADY).
    const invitation = await db.accessInvitation.create({
      data: {
        weddingId,
        kind: 'planner',
        email: email('k'),
        role: 'collaborator',
        tokenHash: randomUUID(),
        invitedByUserId: ana.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    expect((await cancel(planner.cookie, weddingId, invitation.id).expect(403)).body.error).toBe(
      'ACTION_NOT_ALLOWED',
    );
    await cancel(marcos.cookie, weddingId, invitation.id).expect(204);
  });

  it('convite de outro casamento: 404 INVITATION_NOT_FOUND', async () => {
    const a = await coupleWedding();
    const b = await coupleWedding();
    const sent = await send(b.ana.cookie, b.weddingId, {
      kind: 'partner',
      emails: [email('m')],
    }).expect(201);

    const response = await cancel(a.ana.cookie, a.weddingId, sent.body.invitations[0].id).expect(
      404,
    );

    expect(response.body.error).toBe('INVITATION_NOT_FOUND');
  });

  it('o link sem e-mail não manda e-mail a ninguém', async () => {
    const { cookie, weddingId, userId } = await plannerWedding();
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

    await send(cookie, weddingId, { kind: 'couple' }).expect(201);

    expect(await inbox({ to: user.email })).toHaveLength(0);
  });
});
