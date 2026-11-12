import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * Migration das F4 e F5 direto no SQL, com o usuário real da API (kore_api):
 * os padrões das colunas novas, o GRANT por coluna (T3), a RLS por vínculo do
 * histórico, dos envios e das mensagens, a notificação e a preferência só da
 * própria pessoa, o estado do e-mail só do worker, a assinatura de push só do
 * dono e as FKs do assinante. Cada caso numa transação desfeita.
 */
describe('Migration das F4 e F5 (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string; // dona
  let juliana: string; // cerimonialista (colaboradora)
  let estranha: string; // dona de outro casamento
  let weddingId: string;
  let partyId: string;
  let celia: string;
  let luiz: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, juliana, estranha] = [await user(), await user(), await user()];
    weddingId = (await seedWedding({ db, ownerId: ana, collaboratorIds: [juliana] })).weddingId;
    await seedWedding({ db, ownerId: estranha });
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    partyId = party.id;
    celia = (await db.guest.create({ data: { weddingId, partyId, name: 'Célia Moreira' } })).id;
    luiz = (await db.guest.create({ data: { weddingId, partyId, name: 'Luiz Moreira' } })).id;
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function as<T>(userId: string, work: () => Promise<T>): Promise<T> {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  /** Erro esperado sem perder a transação do caso. */
  async function rejects(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await api.query('SAVEPOINT s');
    await expect(api.query(sql, params)).rejects.toThrow(pattern);
    await api.query('ROLLBACK TO SAVEPOINT s');
  }

  async function insertSubmission(): Promise<string> {
    const id = uuidV7();
    await api.query(
      `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, signed_by_guest_id,
         confirmed_count, declined_count)
       VALUES ($1, $2, $3, 'party', $4, 1, 0)`,
      [id, weddingId, partyId, celia],
    );
    return id;
  }

  it('Modelo - as colunas novas nascem nos padrões: versão 1, música desligada, sem publicação nem prazo', async () => {
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      endDate: null,
      paidThrough: null,
      publicationSource: null,
      publishedByUserId: null,
      rsvpDeadline: null,
      songQuestionEnabled: false,
      songQuestionText: null,
    });
    expect(await db.party.findUniqueOrThrow({ where: { id: partyId } })).toMatchObject({
      version: 1,
      lastChannel: null,
      saveTheDateSentAt: null,
      lastReminderAt: null,
      lastResponseActor: null,
      lastSignedByGuestId: null,
      lastResponseUserId: null,
    });
    expect(await db.guest.findUniqueOrThrow({ where: { id: celia } })).toMatchObject({
      songSuggestion: null,
      songSuggestedAt: null,
    });
  });

  it('T3 e decisão 217(4) - a API grava as colunas novas por GRANT; o paidThrough, não', async () => {
    await as(ana, async () => {
      const wedding = await api.query(
        `UPDATE weddings SET status = 'published', published_at = now(), event_date = '2026-11-14',
           end_date = '2027-02-14', publication_source = 'courtesy', published_by_user_id = $2,
           rsvp_deadline = '2026-10-15', song_question_enabled = true,
           song_question_text = 'Qual música não pode faltar?'
         WHERE id = $1`,
        [weddingId, ana],
      );
      expect(wedding.rowCount).toBe(1);
      await rejects(
        `UPDATE weddings SET paid_through = '2027-02-14' WHERE id = $1`,
        [weddingId],
        /permission denied/,
      );
      const party = await api.query(
        `UPDATE parties SET version = version + 1, sent_at = now(), first_viewed_at = now(),
           last_channel = 'whatsapp', save_the_date_sent_at = now(), last_reminder_at = now(),
           last_response_actor = 'party', last_signed_by_guest_id = $2, last_response_user_id = NULL
         WHERE id = $1`,
        [partyId, celia],
      );
      expect(party.rowCount).toBe(1);
      const guest = await api.query(
        `UPDATE guests SET rsvp_status = 'confirmed', song_suggestion = 'Evidências',
           song_suggested_at = now()
         WHERE id = $1`,
        [celia],
      );
      expect(guest.rowCount).toBe(1);
    });
  });

  it('Publicação RN04 e RN05, Música RN04 - os CHECKs das colunas novas', async () => {
    await as(ana, async () => {
      await api.query(`UPDATE weddings SET event_date = '2026-11-14' WHERE id = $1`, [weddingId]);
      await rejects(
        `UPDATE weddings SET end_date = '2026-11-14' WHERE id = $1`,
        [weddingId],
        /chk_weddings_end_date/,
      );
      await rejects(
        `UPDATE weddings SET publication_source = 'courtesy' WHERE id = $1`,
        [weddingId],
        /chk_weddings_publication_source/,
      );
      await rejects(
        `UPDATE weddings SET song_question_text = $2 WHERE id = $1`,
        [weddingId, 'a'.repeat(121)],
        /chk_weddings_song_question_text/,
      );
      await rejects(
        'UPDATE parties SET version = 0 WHERE id = $1',
        [partyId],
        /chk_parties_version/,
      );
      // Sugestão só de quem confirmou, e sempre com a data.
      await rejects(
        `UPDATE guests SET song_suggestion = 'Evidências', song_suggested_at = now() WHERE id = $1`,
        [luiz],
        /chk_guests_song_suggestion/,
      );
      await rejects(
        `UPDATE guests SET rsvp_status = 'confirmed', song_suggestion = 'Evidências' WHERE id = $1`,
        [luiz],
        /chk_guests_song_suggested_at/,
      );
      await rejects(
        `UPDATE guests SET rsvp_status = 'confirmed', song_suggestion = $2, song_suggested_at = now()
         WHERE id = $1`,
        [luiz, 'a'.repeat(121)],
        /chk_guests_song_suggestion/,
      );
    });
  });

  it('RSVP RN07 e decisão 153 - o histórico e os envios: o casamento insere e lê; ninguém muda nem apaga', async () => {
    for (const userId of [ana, juliana]) {
      await as(userId, async () => {
        const submissionId = await insertSubmission();
        await api.query(
          `INSERT INTO guest_responses (id, wedding_id, guest_id, party_id, submission_id, status,
             signed_by_guest_id, actor)
           VALUES ($1, $2, $3, $4, $5, 'confirmed', $3, 'party')`,
          [uuidV7(), weddingId, celia, partyId, submissionId],
        );
        await api.query(
          `INSERT INTO party_deliveries (id, wedding_id, party_id, kind, channel, user_id)
           VALUES ($1, $2, $3, 'invite', 'whatsapp', $4)`,
          [uuidV7(), weddingId, partyId, userId],
        );
        for (const table of ['rsvp_submissions', 'guest_responses', 'party_deliveries']) {
          const { rows } = await api.query(`SELECT id FROM ${table} WHERE wedding_id = $1`, [
            weddingId,
          ]);
          expect(rows).toHaveLength(1);
          await rejects(
            `UPDATE ${table} SET created_at = now() WHERE wedding_id = $1`,
            [weddingId],
            /permission denied/,
          );
          await rejects(
            `DELETE FROM ${table} WHERE wedding_id = $1`,
            [weddingId],
            /permission denied/,
          );
        }
      });
    }
    await as(estranha, async () => {
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'party', 0, 0)`,
        [uuidV7(), weddingId, partyId],
        /row-level security/,
      );
    });
  });

  it('RSVP RN04 e Prazo RN04 - quem assina é do grupo; a alteração do casal leva quem alterou', async () => {
    await as(ana, async () => {
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, signed_by_guest_id,
           actor_user_id, confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'couple', $4, $5, 0, 0)`,
        [uuidV7(), weddingId, partyId, celia, ana],
        /chk_rsvp_submissions_actor/,
      );
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, actor_user_id,
           confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'party', $4, 0, 0)`,
        [uuidV7(), weddingId, partyId, ana],
        /chk_rsvp_submissions_actor/,
      );
      // O assinante tem de ser convidado do mesmo casamento (invariante 1).
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, signed_by_guest_id,
           confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'party', $4, 0, 0)`,
        [uuidV7(), weddingId, partyId, uuidV7()],
        /rsvp_submissions_signed_by_guest_fkey/,
      );
    });
  });

  it('RSVP R2-10 - expurgar quem assinou deixa o histórico "pelo grupo"; expurgar o convidado leva o histórico dele', async () => {
    const pedro = await db.guest.create({ data: { weddingId, partyId, name: 'Pedro Moreira' } });
    const submission = await db.rsvpSubmission.create({
      data: {
        weddingId,
        partyId,
        actor: 'party',
        signedByGuestId: pedro.id,
        confirmedCount: 1,
        declinedCount: 0,
      },
    });
    await db.guestResponse.create({
      data: {
        weddingId,
        guestId: luiz,
        partyId,
        submissionId: submission.id,
        status: 'confirmed',
        signedByGuestId: pedro.id,
        actor: 'party',
      },
    });
    const pedroResponse = await db.guestResponse.create({
      data: {
        weddingId,
        guestId: pedro.id,
        partyId,
        submissionId: submission.id,
        status: 'confirmed',
        signedByGuestId: pedro.id,
        actor: 'party',
      },
    });
    await db.party.update({ where: { id: partyId }, data: { lastSignedByGuestId: pedro.id } });

    await db.guest.delete({ where: { id: pedro.id } });

    expect(
      (await db.rsvpSubmission.findUniqueOrThrow({ where: { id: submission.id } })).signedByGuestId,
    ).toBeNull();
    expect(await db.guestResponse.findUnique({ where: { id: pedroResponse.id } })).toBeNull();
    expect(
      await db.guestResponse.findMany({
        where: { submissionId: submission.id },
        select: { guestId: true, signedByGuestId: true },
      }),
    ).toEqual([{ guestId: luiz, signedByGuestId: null }]);
    const party = await db.party.findUniqueOrThrow({ where: { id: partyId } });
    expect(party).toMatchObject({ lastSignedByGuestId: null, weddingId });
    await db.rsvpSubmission.delete({ where: { id: submission.id } });
  });

  it('Envios RN06 - a mensagem pronta: o casamento edita e restaura; tamanho e assunto conferidos', async () => {
    await as(juliana, async () => {
      const id = uuidV7();
      await api.query(
        `INSERT INTO message_templates (id, wedding_id, kind, subject, body, updated_by_user_id, updated_at)
         VALUES ($1, $2, 'invite', 'Convite', 'Oi, {nome_do_grupo}! {link}', $3, now())`,
        [id, weddingId, juliana],
      );
      const updated = await api.query(
        `UPDATE message_templates SET body = 'Oi! {link}', updated_at = now() WHERE id = $1`,
        [id],
      );
      expect(updated.rowCount).toBe(1);
      await rejects(
        `UPDATE message_templates SET kind = 'reminder' WHERE id = $1`,
        [id],
        /permission denied/,
      );
      await rejects(
        `UPDATE message_templates SET body = $2 WHERE id = $1`,
        [id, 'a'.repeat(1001)],
        /chk_message_templates_body/,
      );
      await rejects(
        `UPDATE message_templates SET subject = $2 WHERE id = $1`,
        [id, 'Convite\r\nBcc: x@y.z'],
        /chk_message_templates_subject/,
      );
      const deleted = await api.query('DELETE FROM message_templates WHERE id = $1', [id]);
      expect(deleted.rowCount).toBe(1);
    });
  });

  it('Central RN09 - a notificação: só a própria pessoa lê e marca como lida; a API não inclui', async () => {
    const notification = await db.notification.create({
      data: {
        userId: ana,
        weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${weddingId}`,
        payload: [{ partyId, name: 'Família Moreira', confirmed: 2, declined: 1, at: '' }],
      },
    });
    try {
      await as(ana, async () => {
        const { rows } = await api.query('SELECT id FROM notifications WHERE user_id = $1', [ana]);
        expect(rows).toEqual([{ id: notification.id }]);
        const read = await api.query('UPDATE notifications SET read_at = now() WHERE id = $1', [
          notification.id,
        ]);
        expect(read.rowCount).toBe(1);
        for (const column of ['payload', 'count', 'updated_at', 'user_id'])
          await rejects(
            `UPDATE notifications SET ${column} = ${column} WHERE id = $1`,
            [notification.id],
            /permission denied/,
          );
        await rejects(
          `INSERT INTO notifications (id, user_id, wedding_id, type, group_key, payload)
           VALUES ($1, $2, $3, 'rsvp', 'x', '[]')`,
          [uuidV7(), ana, weddingId],
          /permission denied/,
        );
        await rejects(
          'DELETE FROM notifications WHERE id = $1',
          [notification.id],
          /permission denied/,
        );
      });
      // A cerimonialista do mesmo casamento não vê a notificação da dona.
      await as(juliana, async () => {
        const { rows } = await api.query('SELECT id FROM notifications');
        expect(rows).toEqual([]);
      });
      // Perder o vínculo esconde as notificações daquele casamento.
      await db.membership.updateMany({
        where: { weddingId, userId: ana },
        data: { removedAt: new Date() },
      });
      await as(ana, async () => {
        const { rows } = await api.query('SELECT id FROM notifications');
        expect(rows).toEqual([]);
      });
    } finally {
      await db.membership.updateMany({
        where: { weddingId, userId: ana },
        data: { removedAt: null },
      });
      await db.notification.delete({ where: { id: notification.id } });
    }
  });

  it('Central RN04 - uma só não lida por grupo de eventos; depois de lida, abre outra', async () => {
    const groupKey = `rsvp:${weddingId}`;
    const payload = [{ partyId, name: 'Família Moreira', confirmed: 1, declined: 0, at: '' }];
    const first = await db.notification.create({
      data: { userId: ana, weddingId, type: 'rsvp', groupKey, payload },
    });
    try {
      await expect(
        db.notification.create({
          data: { userId: ana, weddingId, type: 'rsvp', groupKey, payload },
        }),
      ).rejects.toThrow(/uq_notifications_user_id_group_key_unread|Unique constraint/);
      await db.notification.update({ where: { id: first.id }, data: { readAt: new Date() } });
      const second = await db.notification.create({
        data: { userId: ana, weddingId, type: 'rsvp', groupKey, payload },
      });
      await db.notification.delete({ where: { id: second.id } });
    } finally {
      await db.notification.delete({ where: { id: first.id } });
    }
  });

  it('Central RN07 - a preferência: cada pessoa, só as suas, dos casamentos em que tem vínculo', async () => {
    await as(ana, async () => {
      const id = uuidV7();
      await api.query(
        `INSERT INTO notification_preferences (id, user_id, wedding_id, type, email, updated_at)
         VALUES ($1, $2, $3, 'rsvp', 'immediate', now())`,
        [id, ana, weddingId],
      );
      const updated = await api.query(
        `UPDATE notification_preferences SET email = 'off', push = true, updated_at = now() WHERE id = $1`,
        [id],
      );
      expect(updated.rowCount).toBe(1);
      await rejects(
        'UPDATE notification_preferences SET in_app = false WHERE id = $1',
        [id],
        /permission denied/,
      );
      await rejects(
        `INSERT INTO notification_preferences (id, user_id, wedding_id, type, updated_at)
         VALUES ($1, $2, $3, 'rsvp', now())`,
        [uuidV7(), juliana, weddingId],
        /row-level security/,
      );
    });
    await as(estranha, async () => {
      await rejects(
        `INSERT INTO notification_preferences (id, user_id, wedding_id, type, updated_at)
         VALUES ($1, $2, $3, 'rsvp', now())`,
        [uuidV7(), estranha, weddingId],
        /row-level security/,
      );
    });
  });

  it('E-mail e push RN02 - o estado do e-mail é só do worker', async () => {
    await as(ana, async () => {
      await rejects('SELECT * FROM notification_email_states', [], /permission denied/);
    });
  });

  it('E-mail e push RN07 e RN08 - a assinatura de push é só da própria pessoa; o worker grava o sucesso', async () => {
    const session = await db.session.create({
      data: {
        userId: ana,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastSeenAt: new Date(),
        authenticatedAt: new Date(),
        authMethod: 'email',
      },
    });
    try {
      await as(ana, async () => {
        const id = uuidV7();
        await api.query(
          `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, updated_at)
           VALUES ($1, $2, $3, 'https://fcm.googleapis.com/fcm/send/abc', 'p', 'a', now())`,
          [id, ana, session.id],
        );
        await rejects(
          'UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1',
          [id],
          /permission denied/,
        );
        const deleted = await api.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
        expect(deleted.rowCount).toBe(1);
      });
      await as(juliana, async () => {
        await rejects(
          `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, updated_at)
           VALUES ($1, $2, $3, 'https://fcm.googleapis.com/fcm/send/def', 'p', 'a', now())`,
          [uuidV7(), ana, session.id],
          /row-level security/,
        );
      });
    } finally {
      await db.session.delete({ where: { id: session.id } });
    }
  });
});
