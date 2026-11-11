import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_URL = 'http://localhost:5173';

/** Grupos e convidados: criar, ler, listar e regenerar o link (banco real). */
describe('Grupos e convidados (banco real)', () => {
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
  const create = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const list = (cookie: string, weddingId: string, query: Record<string, string> = {}) =>
    http().get(`/v1/weddings/${weddingId}/parties`).query(query).set('Cookie', cookie);
  const get = (cookie: string, weddingId: string, partyId: string) =>
    http().get(`/v1/weddings/${weddingId}/parties/${partyId}`).set('Cookie', cookie);
  const regenerate = (cookie: string, weddingId: string, partyId: string) =>
    http()
      .post(`/v1/weddings/${weddingId}/parties/${partyId}/regenerate-link`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const { slug } = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    return { ana, juliana, weddingId, slug };
  }

  const guest = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });
  const stats = (weddingId: string) => db.weddingStats.findUniqueOrThrow({ where: { weddingId } });

  describe('Criar (RN03, RN04, RN06, RN07, RN11, RN16)', () => {
    it('RN03, RN11 e RN16 - cria o grupo com dois convidados pendentes, o link e os números na mesma gravação', async () => {
      const { ana, weddingId, slug } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: '  Beatriz e Leonardo ',
        guests: [
          guest('Beatriz Lima', {
            ageGroup: 'adult',
            phone: '(19) 99876-1402',
            email: 'Bia.Lima@Gmail.com',
          }),
          guest('Leonardo Castro', { ageGroup: 'adult' }),
        ],
      }).expect(201);

      expect(response.body).toMatchObject({
        name: 'Beatriz e Leonardo',
        plusOneSlots: 0,
        internalNote: null,
        deliveryStatus: 'not_sent',
        history: [],
        guests: [
          {
            name: 'Beatriz Lima',
            phone: '+5519998761402',
            email: 'bia.lima@gmail.com',
            rsvpStatus: 'pending',
            isPlusOne: false,
          },
          { name: 'Leonardo Castro', phone: null, rsvpStatus: 'pending' },
        ],
      });
      expect(response.body.contactGuestId).toBe(response.body.guests[0].id);
      expect(response.body.link.url).toMatch(
        new RegExp(`^${SITE_URL}/${slug}/grupo/[A-Za-z0-9_-]{22}$`),
      );
      expect(response.body.link.regeneratedAt).toBeNull();
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: 2,
        pending: 2,
        partiesPending: 1,
      });
      const party = await db.party.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(party).toMatchObject({ linkVersion: 1, weddingId });
    });

    it('RN11 - o token tem 128 bits e é diferente do de qualquer outro grupo', async () => {
      const { ana, weddingId } = await anaWedding();
      const a = await create(ana.cookie, weddingId, { name: 'A', guests: [guest('Ana')] }).expect(
        201,
      );
      const b = await create(ana.cookie, weddingId, { name: 'B', guests: [guest('Bia')] }).expect(
        201,
      );

      expect(a.body.link.url).not.toBe(b.body.link.url);
      const tokens = await db.party.findMany({ where: { weddingId }, select: { linkToken: true } });
      for (const { linkToken } of tokens)
        expect(Buffer.from(linkToken, 'base64url')).toHaveLength(16);
    });

    it('RN03 - sem convidado não salva, e nada é gravado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: 'Família Rocha',
        guests: [],
      }).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'guests', code: 'ARRAY_MIN_SIZE', params: { min: 1 } },
      ]);
      expect(await db.party.count({ where: { weddingId } })).toBe(0);
    });

    it('RN04 - o nome do grupo repetido é aceito', async () => {
      const { ana, weddingId } = await anaWedding();
      await create(ana.cookie, weddingId, {
        name: 'Família Silva',
        guests: [guest('Ana Silva')],
      }).expect(201);
      await create(ana.cookie, weddingId, {
        name: 'Família Silva',
        guests: [guest('Bia Silva')],
      }).expect(201);

      expect(await db.party.count({ where: { weddingId, name: 'Família Silva' } })).toBe(2);
    });

    it.each([
      ['sem DDD', '9876-1402', 'PHONE_TOO_SHORT', 8],
      ['com "+" curto demais', '+1234567', 'PHONE_INVALID', 7],
      ['longo demais sem "+"', '351912345678', 'PHONE_TOO_LONG', 12],
    ])(
      'RN04 - telefone %s é recusado, e o erro aponta o convidado certo',
      async (_, phone, code, n) => {
        const { ana, weddingId } = await anaWedding();

        const response = await create(ana.cookie, weddingId, {
          name: 'Beatriz e Leonardo',
          guests: [guest('Beatriz Lima'), guest('Leonardo Castro', { phone })],
        }).expect(400);

        expect(response.body).toMatchObject({
          statusCode: 400,
          error: 'Bad Request',
          message: [`guests.1.phone: ${code}`],
          errors: [{ path: 'guests.1.phone', code, params: { n } }],
        });
        expect(await db.party.count({ where: { weddingId } })).toBe(0);
      },
    );

    it.each([
      ['com 55 e zero de tronco', '055 19 99876-1402', '+5519998761402'],
      ['internacional', '+351 912 345 678', '+351912345678'],
    ])('RN04 - o formulário aceita o telefone %s, como a planilha', async (_, phone, e164) => {
      const { ana, weddingId } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: 'Beatriz e Leonardo',
        guests: [guest('Beatriz Lima', { phone })],
      }).expect(201);

      expect(response.body.guests[0].phone).toBe(e164);
    });

    it('RN04 - e-mail inválido é recusado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: 'Beatriz e Leonardo',
        guests: [guest('Beatriz Lima', { email: 'nao-e-email' })],
      }).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'guests.0.email', code: 'IS_EMAIL', params: {} },
      ]);
    });

    it('RN04 - nome com 80 caracteres é aceito e com 81 é recusado; observação acima de 500 também', async () => {
      const { ana, weddingId } = await anaWedding();
      await create(ana.cookie, weddingId, {
        name: 'a'.repeat(80),
        guests: [guest('b'.repeat(80))],
      }).expect(201);

      const response = await create(ana.cookie, weddingId, {
        name: 'a'.repeat(81),
        guests: [guest('b'.repeat(81))],
        internalNote: 'c'.repeat(501),
      }).expect(400);

      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { path: 'name', code: 'MAX_LENGTH', params: { max: 80 } },
          { path: 'guests.0.name', code: 'MAX_LENGTH', params: { max: 80 } },
          { path: 'internalNote', code: 'MAX_LENGTH', params: { max: 500 } },
        ]),
      );
    });

    it('RN06 - o primeiro com contato é o padrão; sem telefone nem e-mail, o grupo fica sem contato', async () => {
      const { ana, weddingId } = await anaWedding();

      const moreira = await create(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [guest('Luiz Moreira'), guest('Célia Moreira', { phone: '19998763310' })],
      }).expect(201);
      const helena = await create(ana.cookie, weddingId, {
        name: 'Vó Helena',
        guests: [guest('Helena Moreira')],
      }).expect(201);

      expect(moreira.body.contactGuestId).toBe(moreira.body.guests[1].id);
      expect(helena.body.contactGuestId).toBeNull();
    });

    it('RN06 - contato escolhido sem telefone nem e-mail é recusado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [guest('Luiz Moreira'), guest('Célia Moreira', { phone: '19998763310' })],
        contactIndex: 0,
      }).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'contactIndex', code: 'CONTACT_WITHOUT_PHONE_OR_EMAIL', params: {} },
      ]);
    });

    it('RN07 - duas vagas criam dois acompanhantes pendentes, sem nome, no fim; mais de 5 é recusado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await create(ana.cookie, weddingId, {
        name: 'Carla e Rafael',
        guests: [guest('Carla Nunes')],
        plusOneSlots: 2,
      }).expect(201);

      expect(response.body.plusOneSlots).toBe(2);
      expect(response.body.guests).toMatchObject([
        { name: 'Carla Nunes', isPlusOne: false },
        { name: null, isPlusOne: true, rsvpStatus: 'pending' },
        { name: null, isPlusOne: true, rsvpStatus: 'pending' },
      ]);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: 3,
        pending: 3,
        partiesPending: 1,
      });

      const tooMany = await create(ana.cookie, weddingId, {
        name: 'Carla e Rafael',
        guests: [guest('Carla Nunes')],
        plusOneSlots: 6,
      }).expect(400);
      expect(tooMany.body.errors).toEqual([
        { path: 'plusOneSlots', code: 'MAX', params: { max: 5 } },
      ]);
    });

    it('Tags - aplica as tags ativas do grupo e recusa a que não existe ou está na lixeira', async () => {
      const { ana, weddingId } = await anaWedding();
      const padrinhos = await db.tag.create({ data: { weddingId, name: 'Padrinhos' } });
      const vizinhos = await db.tag.create({
        data: { weddingId, name: 'Vizinhos', deletedAt: new Date() },
      });

      const ok = await create(ana.cookie, weddingId, {
        name: 'Padrinhos da Ana',
        guests: [guest('Bruno Lima')],
        tagIds: [padrinhos.id],
      }).expect(201);
      expect(ok.body.tags).toEqual([{ id: padrinhos.id, name: 'Padrinhos', color: null }]);

      const refused = await create(ana.cookie, weddingId, {
        name: 'Vizinhos',
        guests: [guest('Bruno Lima')],
        tagIds: [padrinhos.id, vizinhos.id],
      }).expect(400);
      expect(refused.body.errors).toEqual([
        { path: 'tagIds.1', code: 'TAG_NOT_FOUND', params: {} },
      ]);
    });
  });

  describe('Quem pode (RN02)', () => {
    it('RN02 - a cerimonialista monta a lista, e o grupo aparece para o casal', async () => {
      const { ana, juliana, weddingId } = await anaWedding();

      await create(juliana.cookie, weddingId, {
        name: 'Família Prado',
        guests: [guest('Rita Prado')],
      }).expect(201);

      expect((await list(ana.cookie, weddingId).expect(200)).body.data).toMatchObject([
        { name: 'Família Prado' },
      ]);
    });

    it('RN02 - o vendedor monta a lista antes do aceite', async () => {
      const { userId } = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
      const cookie = await openSession({ app, userId });
      const { weddingId } = await seedReferrerWedding({
        db,
        referrerUserId: userId,
        referrerKind: 'seller',
        status: 'awaiting_couple',
      });

      await create(cookie, weddingId, {
        name: 'Família Castro',
        guests: [guest('Heitor Castro')],
      }).expect(201);
    });

    it('RN02 - sem vínculo, o casamento não existe', async () => {
      const { ana, weddingId } = await anaWedding();
      const party = await create(ana.cookie, weddingId, {
        name: 'A',
        guests: [guest('Ana')],
      }).expect(201);
      const stranger = await signedInUser({ app, name: 'Estranha' });

      for (const response of [
        await list(stranger.cookie, weddingId),
        await create(stranger.cookie, weddingId, { name: 'X', guests: [guest('X')] }),
        await get(stranger.cookie, weddingId, party.body.id),
        await regenerate(stranger.cookie, weddingId, party.body.id),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('WEDDING_NOT_FOUND');
      }
    });
  });

  describe('Painel e link (RN11, RN12, RN14)', () => {
    it('RN14 - o painel mostra o grupo inteiro, na ordem do grupo, com a restrição alimentar', async () => {
      const { ana, weddingId } = await anaWedding();
      const familia = await db.tag.create({ data: { weddingId, name: 'Família da Ana' } });
      const pajens = await db.tag.create({ data: { weddingId, name: 'Pajens', color: 'green' } });
      const created = await create(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [
          guest('Célia Moreira', { ageGroup: 'adult', phone: '19998763310' }),
          guest('Luiz Moreira', { ageGroup: 'adult' }),
          guest('Pedro Moreira', { ageGroup: 'child' }),
        ],
        plusOneSlots: 1,
        tagIds: [familia.id],
        internalNote: 'Pedro tem 7 anos e vai de pajem.',
      }).expect(201);
      const pedro = created.body.guests[2].id;
      // Restrição e tag do convidado entram pela planilha na F1 (RN05; decisão 185(3)).
      await db.guest.update({ where: { id: pedro }, data: { dietaryRestriction: 'sem glúten' } });
      await db.guestTag.create({ data: { weddingId, guestId: pedro, tagId: pajens.id } });

      const response = await get(ana.cookie, weddingId, created.body.id).expect(200);

      expect(response.body).toMatchObject({
        name: 'Família Moreira',
        internalNote: 'Pedro tem 7 anos e vai de pajem.',
        tags: [{ name: 'Família da Ana' }],
        guests: [
          { name: 'Célia Moreira', phone: '+5519998763310', phoneMasked: '(19) 9****-3310' },
          { name: 'Luiz Moreira', phone: null, phoneMasked: null, emailMasked: null },
          {
            name: 'Pedro Moreira',
            ageGroup: 'child',
            dietaryRestriction: 'sem glúten',
            tags: [{ id: pajens.id, name: 'Pajens', color: 'green' }],
          },
          { name: null, isPlusOne: true },
        ],
      });
    });

    it('decisão 202(3) - o painel traz o telefone e o e-mail mascarados, além dos inteiros do Editar grupo', async () => {
      const { ana, weddingId } = await anaWedding();
      const created = await create(ana.cookie, weddingId, {
        name: 'Beatriz e Leonardo',
        guests: [
          guest('Beatriz Lima', { phone: '(19) 99876-1402', email: 'bia.lima@gmail.com' }),
          guest('Leonardo Castro', { phone: '+351 912 345 678', email: 'lc@exemplo.kore.local' }),
        ],
      }).expect(201);

      const response = await get(ana.cookie, weddingId, created.body.id).expect(200);

      expect(response.body.guests).toMatchObject([
        {
          phone: '+5519998761402',
          phoneMasked: '(19) 9****-1402',
          email: 'bia.lima@gmail.com',
          emailMasked: 'bi***@gmail.com',
        },
        {
          phone: '+351912345678',
          phoneMasked: '+351 9** *** 678',
          email: 'lc@exemplo.kore.local',
          emailMasked: 'l***@exemplo.kore.local',
        },
      ]);
    });

    it('RN14 - grupo de outro casamento, na lixeira ou com id inválido: 404 PARTY_NOT_FOUND', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();
      const foreign = await create(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [guest('Outra')],
      }).expect(201);
      const trashed = await create(ana.cookie, weddingId, {
        name: 'T',
        guests: [guest('T')],
      }).expect(201);
      await db.party.update({ where: { id: trashed.body.id }, data: { deletedAt: new Date() } });

      for (const partyId of [foreign.body.id, trashed.body.id, 'nao-e-uuid']) {
        const response = await get(ana.cookie, weddingId, partyId).expect(404);
        expect(response.body.error).toBe('PARTY_NOT_FOUND');
      }
    });

    it('RN12 - a colaboradora regenera o link: token novo, versão acima, o antigo para e o log leva só o id do grupo', async () => {
      const { ana, juliana, weddingId } = await anaWedding();
      const created = await create(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [guest('Célia Moreira')],
      }).expect(201);
      const oldUrl: string = created.body.link.url;

      const response = await regenerate(juliana.cookie, weddingId, created.body.id).expect(200);

      expect(response.body.url).not.toBe(oldUrl);
      expect(response.body.url).toMatch(/\/grupo\/[A-Za-z0-9_-]{22}$/);
      const party = await db.party.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(party.linkVersion).toBe(2);
      expect(party.linkRegeneratedAt?.toISOString()).toBe(response.body.regeneratedAt);
      expect(oldUrl.endsWith(party.linkToken)).toBe(false);
      const [log] = await db.applicationLog.findMany({
        where: { weddingId, action: 'party.link_regenerated' },
      });
      expect(log).toMatchObject({
        actorKind: 'user',
        actorUserId: juliana.userId,
        entityType: 'party',
        entityId: created.body.id,
        data: null,
      });
      expect((await get(ana.cookie, weddingId, created.body.id)).body.link).toEqual(response.body);
    });
  });

  describe('Lista (RN13)', () => {
    async function moreiraWedding() {
      const wedding = await anaWedding();
      const { ana, weddingId } = wedding;
      const pajens = await db.tag.create({ data: { weddingId, name: 'Pajens' } });
      const moreira = await create(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [
          guest('Célia Moreira', { phone: '+5519998763310' }),
          guest('Pedro Moreira', { ageGroup: 'child' }),
        ],
      }).expect(201);
      await db.guestTag.create({
        data: { weddingId, guestId: moreira.body.guests[1].id, tagId: pajens.id },
      });
      const padrinhos = await create(ana.cookie, weddingId, {
        name: 'Padrinhos',
        guests: [guest('Leonardo Castro', { phone: '+351912345678' })],
        plusOneSlots: 2,
      }).expect(201);
      const amigos = await create(ana.cookie, weddingId, {
        name: 'Amigos do vôlei',
        guests: [guest('Bruno Lima', { email: 'bruno@exemplo.kore.local' })],
      }).expect(201);
      return {
        ...wedding,
        pajens,
        moreira: moreira.body,
        padrinhos: padrinhos.body,
        amigos: amigos.body,
      };
    }

    const names = (body: { data: { name: string }[] }) => body.data.map((party) => party.name);

    it('RN13 - em ordem alfabética sem acento, com o resumo do casamento e o contato mascarado', async () => {
      const { ana, weddingId } = await moreiraWedding();

      const response = await list(ana.cookie, weddingId).expect(200);

      expect(names(response.body)).toEqual(['Amigos do vôlei', 'Família Moreira', 'Padrinhos']);
      expect(response.body.summary).toEqual({
        guests: 6,
        namedGuests: 4,
        parties: 3,
        confirmed: 0,
        declined: 0,
        pending: 6,
      });
      expect(response.body.total).toBe(3);
      expect(response.body.nextCursor).toBeNull();
      expect(response.body.data[1]).toMatchObject({
        contact: { name: 'Célia Moreira', phoneMasked: '(19) 9****-3310' },
        firstGuestName: 'Célia Moreira',
        people: 2,
        counts: { confirmed: 0, declined: 0, pending: 2, pendingPlusOnes: 0 },
        respondedAt: null,
        respondedBy: null,
      });
      expect(response.body.data[2]).toMatchObject({
        contact: { name: 'Leonardo Castro', phoneMasked: '+351 9** *** 678' },
        people: 3,
        counts: { pending: 3, pendingPlusOnes: 2 },
      });
      expect(response.body.data[0].contact).toMatchObject({
        name: 'Bruno Lima',
        phoneMasked: null,
      });
      // O número inteiro e o e-mail não saem na lista (decisão 186, item 11).
      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain('998763310');
      expect(raw).not.toContain('912345678');
      expect(raw).not.toContain('bruno@');
    });

    it.each([
      ['celia', ['Família Moreira']],
      ['PADRINHOS', ['Padrinhos']],
      ['volei', ['Amigos do vôlei']],
      ['%', []],
    ])('RN13 - busca "%s" sem diferenciar maiúsculas nem acentos', async (q, expected) => {
      const { ana, weddingId } = await moreiraWedding();

      const response = await list(ana.cookie, weddingId, { q }).expect(200);

      expect(names(response.body)).toEqual(expected);
      expect(response.body.total).toBe(expected.length);
      expect(response.body.summary.parties).toBe(3);
    });

    it('RN13 - filtra pela tag de um convidado, por pendentes e por envio', async () => {
      const { ana, weddingId, pajens, padrinhos } = await moreiraWedding();
      await db.party.update({ where: { id: padrinhos.id }, data: { deliveryStatus: 'sent' } });
      await db.guest.updateMany({
        where: { partyId: padrinhos.id },
        data: { rsvpStatus: 'confirmed' },
      });

      expect(names((await list(ana.cookie, weddingId, { tag: pajens.id })).body)).toEqual([
        'Família Moreira',
      ]);
      expect(names((await list(ana.cookie, weddingId, { rsvp: 'pending' })).body)).toEqual([
        'Amigos do vôlei',
        'Família Moreira',
      ]);
      expect(names((await list(ana.cookie, weddingId, { rsvp: 'confirmed' })).body)).toEqual([
        'Padrinhos',
      ]);
      expect(names((await list(ana.cookie, weddingId, { sent: 'not_sent' })).body)).toEqual([
        'Amigos do vôlei',
        'Família Moreira',
      ]);
    });

    it('RN13 - dois grupos de nome igual na divisa da página aparecem uma vez cada', async () => {
      const { ana, weddingId } = await anaWedding();
      for (const name of ['Família Silva', 'Família Silva', 'Família Souza'])
        await create(ana.cookie, weddingId, { name, guests: [guest('Alguém')] }).expect(201);

      const first = await list(ana.cookie, weddingId, { limit: '1' }).expect(200);
      const second = await list(ana.cookie, weddingId, {
        limit: '1',
        cursor: first.body.nextCursor,
      }).expect(200);
      const third = await list(ana.cookie, weddingId, {
        limit: '1',
        cursor: second.body.nextCursor,
      }).expect(200);

      expect(
        [first, second, third].map(
          (page) => (page.body as { data: { name: string }[] }).data[0].name,
        ),
      ).toEqual(['Família Silva', 'Família Silva', 'Família Souza']);
      expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
      expect(first.body.total).toBe(3);
      expect(third.body.nextCursor).toBeNull();
    });

    it('RN13 - parâmetro desconhecido, cursor inválido ou tag que não é ativa dão 400', async () => {
      const { ana, weddingId } = await anaWedding();
      const trashed = await db.tag.create({
        data: { weddingId, name: 'Velha', deletedAt: new Date() },
      });

      expect((await list(ana.cookie, weddingId, { cursor: 'x' }).expect(400)).body.errors).toEqual([
        { path: 'cursor', code: 'INVALID_CURSOR', params: {} },
      ]);
      expect(
        (await list(ana.cookie, weddingId, { tag: trashed.id }).expect(400)).body.errors,
      ).toEqual([{ path: 'tag', code: 'TAG_NOT_FOUND', params: {} }]);
      await list(ana.cookie, weddingId, { foo: 'bar' }).expect(400);
      await list(ana.cookie, weddingId, { limit: '101' }).expect(400);
    });

    it('RN13 - grupos e convidados na lixeira ficam fora da lista e do resumo', async () => {
      const { ana, weddingId, amigos } = await moreiraWedding();
      await db.guest.updateMany({ where: { partyId: amigos.id }, data: { deletedAt: new Date() } });
      await db.party.update({ where: { id: amigos.id }, data: { deletedAt: new Date() } });

      const response = await list(ana.cookie, weddingId).expect(200);

      expect(names(response.body)).toEqual(['Família Moreira', 'Padrinhos']);
      expect(response.body.summary).toMatchObject({ guests: 5, parties: 2 });
    });
  });
});
