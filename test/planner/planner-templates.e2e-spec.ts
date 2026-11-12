import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * Modelos do cerimonialista (F6, C6), com o banco real: o CRUD de
 * /v1/me/planner-templates, a validação por tipo com os limites das seções, o
 * guarda-corpo da Aparência, o teto técnico e o isolamento pela RLS de
 * planner_templates (revisão C6-2).
 */
describe('Modelos do cerimonialista (banco real; decisões 223 e 224)', () => {
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
  const create = (cookie: string, body: Record<string, unknown>) =>
    http()
      .post('/v1/me/planner-templates')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const update = (cookie: string, id: string, body: Record<string, unknown>) =>
    http()
      .patch(`/v1/me/planner-templates/${id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const remove = (cookie: string, id: string) =>
    http().delete(`/v1/me/planner-templates/${id}`).set('Cookie', cookie).set('Origin', APP_ORIGIN);
  const list = (cookie: string, query = '') =>
    http().get(`/v1/me/planner-templates${query}`).set('Cookie', cookie);

  async function planner(name = 'Juliana Prado') {
    const { userId } = await seedReferrer({ db, kind: 'planner', name });
    return { userId, cookie: await openSession({ app, userId }) };
  }

  const story = (extra: Record<string, unknown> = {}) => ({
    kind: 'section_content',
    sectionType: 'story',
    name: 'Nossa história clássica',
    content: { text: '  Conheceram-se em {cidade}.\r\nCasam em {data}.  ' },
    ...extra,
  });
  const faq = {
    kind: 'faq',
    name: 'Perguntas de sempre',
    content: { questions: [{ question: 'Pode levar criança?', answer: 'Pode.' }] },
  };
  const appearance = {
    kind: 'appearance',
    name: 'Romântico, sálvia e creme',
    content: {
      fontPairKey: 'romantico',
      primaryColor: '#3d5a4c',
      accentColor: '#a94f37',
      backgroundMode: 'cream',
    },
  };

  it('RN01 e RN04 - cria os três tipos, com o texto limpo e as cores em maiúsculas; a lista vem do mais novo para o mais antigo e filtra', async () => {
    const juliana = await planner();

    const text = await create(juliana.cookie, story()).expect(201);
    await create(juliana.cookie, faq).expect(201);
    const look = await create(juliana.cookie, appearance).expect(201);

    expect(text.body).toEqual({
      id: expect.any(String),
      kind: 'section_content',
      sectionType: 'story',
      name: 'Nossa história clássica',
      locale: 'pt-BR',
      content: { text: 'Conheceram-se em {cidade}.\nCasam em {data}.' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(look.body.content).toEqual({
      fontPairKey: 'romantico',
      starterPaletteKey: null,
      primaryColor: '#3D5A4C',
      accentColor: '#A94F37',
      backgroundMode: 'cream',
    });
    const all = await list(juliana.cookie).expect(200);
    expect((all.body as { kind: string }[]).map(({ kind }) => kind)).toEqual([
      'appearance',
      'faq',
      'section_content',
    ]);
    const stories = await list(juliana.cookie, '?kind=section_content&sectionType=story').expect(
      200,
    );
    expect(stories.body).toHaveLength(1);
  });

  it('RN04 - a Aparência com o contraste baixo: 422 CONTRAST_TOO_LOW, o mesmo da Aparência', async () => {
    const juliana = await planner();

    const response = await create(juliana.cookie, {
      ...appearance,
      content: { ...appearance.content, primaryColor: '#FFFFFF', backgroundMode: 'light' },
    }).expect(422);

    expect(response.body).toMatchObject({ error: 'CONTRAST_TOO_LOW', check: expect.any(String) });
  });

  it.each([
    ['sem nome', story({ name: '  ' }), 'name'],
    ['texto vazio', story({ content: { text: '   ' } }), 'content.text'],
    [
      'Nossa história acima de 5.000',
      story({ content: { text: 'a'.repeat(5001) } }),
      'content.text',
    ],
    [
      'Dress code acima de 2.000',
      story({ sectionType: 'dress_code', content: { text: 'a'.repeat(2001) } }),
      'content.text',
    ],
    ['FAQ sem pergunta', { ...faq, content: { questions: [] } }, 'content.questions'],
    [
      'FAQ com 31 perguntas',
      {
        ...faq,
        content: {
          questions: Array.from({ length: 31 }, () => ({ question: 'P?', answer: 'R.' })),
        },
      },
      'content.questions',
    ],
    [
      'pergunta sem resposta',
      { ...faq, content: { questions: [{ question: 'P?', answer: ' ' }] } },
      'content.questions.0.answer',
    ],
    ['Textos sem seção', story({ sectionType: undefined }), 'sectionType'],
    ['seção num FAQ', { ...faq, sectionType: 'story' }, 'sectionType'],
    ['seção fora das três', story({ sectionType: 'gifts' }), 'sectionType'],
    ['foto no texto (RN01)', story({ content: { text: 'Oi', imageIds: [] } }), 'content.imageIds'],
    ['campo do casamento (RN03)', story({ weddingId: uuidV7() }), 'weddingId'],
  ])('RN03 e RN04 - %s: 400 em %s', async (_, body, path) => {
    const juliana = await planner();

    const response = await create(juliana.cookie, body).expect(400);

    expect((response.body.errors as { path: string }[]).map((error) => error.path)).toContain(path);
  });

  it('PATCH - o nome e o conteúdo mudam; o tipo não muda (400)', async () => {
    const juliana = await planner();
    const { body } = await create(juliana.cookie, story()).expect(201);

    const changed = await update(juliana.cookie, body.id as string, {
      name: 'Nossa história nova',
      content: { text: 'Texto novo.' },
    }).expect(200);

    expect(changed.body).toMatchObject({
      name: 'Nossa história nova',
      content: { text: 'Texto novo.' },
    });
    await update(juliana.cookie, body.id as string, { kind: 'faq' }).expect(400);
    // null no nome não é "não muda": 400, não 500 (revisão do Crivo).
    const nullName = await update(juliana.cookie, body.id as string, { name: null }).expect(400);
    expect(nullName.body.errors).toContainEqual(expect.objectContaining({ path: 'name' }));
    // A validação do conteúdo segue o tipo e a seção gravados.
    await update(juliana.cookie, body.id as string, { content: { questions: [] } }).expect(400);
  });

  it('RN02 - o modelo de outra pessoa não aparece, e o PATCH e o DELETE dão 404; o DELETE dela tira o modelo', async () => {
    const juliana = await planner();
    const clara = await planner('Clara Dias');
    const { body } = await create(juliana.cookie, story()).expect(201);
    const id = body.id as string;

    expect((await list(clara.cookie).expect(200)).body).toEqual([]);
    expect((await update(clara.cookie, id, { name: 'X' }).expect(404)).body.error).toBe(
      'TEMPLATE_NOT_FOUND',
    );
    await remove(clara.cookie, id).expect(404);
    await remove(juliana.cookie, 'nao-e-uuid').expect(404);

    await remove(juliana.cookie, id).expect(204);
    await remove(juliana.cookie, id).expect(404);
    expect(await db.plannerTemplate.count({ where: { id } })).toBe(0);
  });

  it('RN02 - sem o perfil de cerimonialista (casal ou indicador inativo): 403 PROFILE_NOT_OWNED', async () => {
    const ana = await signedInUser({ app });
    const inactive = await seedReferrer({
      db,
      kind: 'planner',
      name: 'Juliana Prado',
      status: 'inactive',
    });

    expect((await list(ana.cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    const cookie = await openSession({ app, userId: inactive.userId });
    expect((await create(cookie, story()).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
  });

  it('RN04 - com 500 modelos, o próximo recebe 409 TEMPLATES_LIMIT', async () => {
    const juliana = await planner();
    const { id: plannerId } = await db.planner.findFirstOrThrow({
      where: { referrer: { userId: juliana.userId } },
    });
    await db.plannerTemplate.createMany({
      data: Array.from({ length: 500 }, (_, index) => ({
        id: uuidV7(),
        plannerId,
        kind: 'faq' as const,
        name: `Modelo ${index}`,
        content: { questions: [{ question: 'P?', answer: 'R.' }] },
      })),
    });

    expect((await create(juliana.cookie, faq).expect(409)).body.error).toBe('TEMPLATES_LIMIT');
  });
});
