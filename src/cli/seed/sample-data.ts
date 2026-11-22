/**
 * Os "Dados de exemplo do Kore" (vault, Produto) na parte que a Fase 0 já
 * guarda: contas, perfis, casamentos, noivos, vínculos e convites de acesso.
 * Convidados, presentes, pagamentos e comissões entram com as suas fases.
 * Todo e-mail em @exemplo.kore.local (decisão 181): em homologação, nada vai a
 * uma caixa de verdade.
 */
import type { BrazilianState, PartnerTitle } from '@/modules/access/domain/weddings/wedding-signup';
import { addDays, addMonths } from '@/modules/billing/domain/payments/pricing';

export const SAMPLE_EMAIL_DOMAIN = 'exemplo.kore.local';

export interface SampleAccount {
  key: string;
  name: string;
  email: string;
  platformRole?: 'admin';
}

export interface SamplePartner {
  name: string;
  title: PartnerTitle | null;
  /**
   * A conta do noivo, quando ele já tem login (é dono do casamento): a chave de
   * uma conta de SAMPLE_ACCOUNTS, ou 'own' para uma conta só dele, criada com o
   * nome e o endereço do casamento (os noivos que a nota não detalha).
   */
  account?: string;
}

export interface SampleWedding {
  slug: string;
  partners: [SamplePartner, SamplePartner];
  eventDate: string;
  city: string;
  state: BrazilianState;
  status: 'awaiting_couple' | 'draft' | 'published' | 'post_event' | 'grace' | 'expired';
  /** Quem criou: o próprio casal (primeira conta dona) ou a cerimonialista. */
  createdBy: 'couple' | 'planner';
  /** Como ficou atribuído à Juliana (null: sem indicador). */
  referral: 'created_by_planner' | 'referral_link' | null;
  /** A Juliana é colaboradora (Meus casamentos). */
  plannerCollaborates: boolean;
  /** O modelo de aparência de que o casamento partiu (null: a aparência padrão). */
  appearanceTemplate?: SampleAppearanceTemplateName | null;
}

export interface SampleInvitation {
  key: string;
  weddingSlug: string;
  kind: 'couple' | 'planner';
  /** Nulo: o link do casal sem e-mail (RN14). */
  email: string | null;
  /** Token fixo do link em local e test (decisão 181); em homologação, aleatório. */
  fixedToken: string;
}

const email = (local: string) => `${local}@${SAMPLE_EMAIL_DOMAIN}`;

/** Minúsculas e sem acento, para endereço e e-mail ("Natália" → "natalia"). */
function plain(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** "Natália", "Vinícius" → "natalia-e-vinicius" (RN04 de Cadastro). */
export function slugOfCouple({ a, b }: { a: string; b: string }): string {
  return `${plain(a)}-e-${plain(b)}`;
}

/** A conta 'own' de um noivo: o primeiro nome e o endereço do casamento. */
export function ownAccountEmail({ name, slug }: { name: string; slug: string }): string {
  return email(`${plain(name)}.${slug}`);
}

export const SAMPLE_ACCOUNTS: SampleAccount[] = [
  { key: 'ana', name: 'Ana Beatriz Moreira', email: email('ana.moreira') },
  { key: 'marcos', name: 'Marcos Vinícius Rocha', email: email('marcos.rocha') },
  { key: 'juliana', name: 'Juliana Prado', email: email('juliana.prado') },
  { key: 'camila', name: 'Camila Souza', email: email('camila.souza') },
  { key: 'lucas', name: 'Lucas Andrade', email: email('lucas.andrade') },
  { key: 'renata', name: 'Renata Lima', email: email('renata.lima'), platformRole: 'admin' },
  { key: 'bianca', name: 'Bianca Lopes', email: email('bianca.lopes') },
  { key: 'henrique', name: 'Henrique Matos', email: email('henrique.matos') },
];

/**
 * A cerimonialista: perfil Prado Assessoria, link juliana-prado. Com o perfil
 * completo (cidades e Termos), porque em homologação o cadastro fica fechado e
 * a Área do cerimonialista se testa com ela (Cadastro e perfil RN02; decisão 224(8)).
 */
export const SAMPLE_PLANNER = {
  account: 'juliana',
  referralCode: 'juliana-prado',
  creditName: 'Prado Assessoria',
  phone: '1933334444',
  whatsapp: '19999998888',
  cities: ['Campinas (SP)', 'Valinhos (SP)', 'Vinhedo (SP)'],
} as const;

/**
 * Os três modelos da Prado Assessoria, um de cada aba (Dados de exemplo do
 * Kore, Modelos de Juliana Prado; Modelos do cerimonialista RN01), e o
 * "Padrão Prado Assessoria", o modelo de aparência de que partem Gabriela e
 * Rafael e Isabela e André (decisão 312(2)). Chave natural: tipo e nome.
 */
export const SAMPLE_PLANNER_TEMPLATES = [
  {
    kind: 'section_content',
    sectionType: 'story',
    name: 'Nossa história: tom acolhedor',
    content: {
      text: 'Tudo começou com um café e uma conversa que não acabava mais. Hoje, {casal} querem dividir com quem amam o dia em que dizem sim. Que bom ter vocês com a gente.',
    },
    createdAt: '2026-06-12T12:00:00Z',
  },
  {
    kind: 'faq',
    sectionType: null,
    name: 'FAQ: cerimônia ao ar livre',
    content: {
      questions: [
        {
          question: 'E se chover?',
          answer:
            'Temos uma área coberta ao lado do jardim, e avisamos todos os grupos pelo WhatsApp.',
        },
        {
          question: 'Qual é o traje?',
          answer: 'Passeio completo. Sugerimos sapatos baixos por causa do gramado.',
        },
        {
          question: 'Tem estacionamento?',
          answer: 'Sim, com manobrista no local, sem custo para os convidados.',
        },
      ],
    },
    createdAt: '2026-07-03T12:00:00Z',
  },
  {
    kind: 'appearance',
    sectionType: null,
    name: 'Romântico · Sálvia · Creme',
    content: {
      fontPairKey: 'romantico',
      starterPaletteKey: 'salvia',
      primaryColor: '#566C4B',
      accentColor: '#C9A66B',
      backgroundMode: 'cream',
    },
    createdAt: '2026-08-21T12:00:00Z',
  },
  {
    kind: 'appearance',
    sectionType: null,
    name: 'Padrão Prado Assessoria',
    content: {
      fontPairKey: 'classico',
      starterPaletteKey: 'salvia',
      primaryColor: '#566C4B',
      accentColor: '#C9A66B',
      backgroundMode: 'light',
    },
    createdAt: '2026-09-01T12:00:00Z',
  },
] as const;

/** Os modelos de aparência de exemplo, pelo nome. */
export type SampleAppearanceTemplateName = Extract<
  (typeof SAMPLE_PLANNER_TEMPLATES)[number],
  { kind: 'appearance' }
>['name'];

/**
 * Gabriela e Rafael e Isabela e André partem do "Padrão Prado Assessoria"
 * (Dados de exemplo do Kore, linhas 144 e 145; decisão 312(2)).
 */
const PRADO_APPEARANCE_SLUGS: readonly string[] = ['gabriela-e-rafael', 'isabela-e-andre'];

/** O vendedor (Vendas · Kore), cadastrado pela Admin Renata Lima. */
export const SAMPLE_SELLER = {
  account: 'lucas',
  referralCode: 'lucas-andrade',
  createdByAdmin: 'renata',
} as const;

/** Casal que já aceitou: os dois noivos são donos, cada um com a sua conta. */
const owners = (a: string, b: string): [SamplePartner, SamplePartner] => [
  { name: a, title: null, account: 'own' },
  { name: b, title: null, account: 'own' },
];
/** Casamento criado pela cerimonialista e ainda sem aceite: noivos sem login. */
const unaccepted = (a: string, b: string): [SamplePartner, SamplePartner] => [
  { name: a, title: null },
  { name: b, title: null },
];

export const SAMPLE_WEDDINGS: SampleWedding[] = [
  {
    slug: 'ana-e-marcos',
    partners: [
      { name: 'Ana Beatriz Moreira', title: 'bride', account: 'ana' },
      { name: 'Marcos Vinícius Rocha', title: 'groom', account: 'marcos' },
    ],
    eventDate: '2026-11-14',
    city: 'Campinas',
    state: 'SP',
    status: 'published',
    createdBy: 'couple',
    referral: 'referral_link',
    plannerCollaborates: true,
  },
  {
    // Juliana se casa com Tiago: perfil de casal, sem atribuição a ela mesma.
    slug: 'juliana-e-tiago',
    partners: [
      { name: 'Juliana Prado', title: null, account: 'juliana' },
      { name: 'Tiago Mendes', title: null },
    ],
    eventDate: '2027-03-20',
    city: 'Valinhos',
    state: 'SP',
    status: 'draft',
    createdBy: 'couple',
    referral: null,
    plannerCollaborates: false,
  },
  {
    // Casal do link da Juliana, sem cerimonialista: convida a Clara (decisão 181).
    slug: 'bianca-e-henrique',
    partners: [
      { name: 'Bianca Lopes', title: null, account: 'bianca' },
      { name: 'Henrique Matos', title: null, account: 'henrique' },
    ],
    eventDate: '2026-11-28',
    city: 'Vinhedo',
    state: 'SP',
    status: 'published',
    createdBy: 'couple',
    referral: 'referral_link',
    plannerCollaborates: false,
  },
  // Os 12 de Meus casamentos da Juliana (todos com ela colaboradora).
  ...(
    [
      ['Natália', 'Vinícius', '2026-03-15', 'Campinas', 'expired', 'planner', true],
      ['Paula', 'Diego', '2026-07-12', 'Campinas', 'post_event', 'planner', true],
      ['Sofia', 'Matheus', '2026-08-29', 'Jundiaí', 'grace', 'planner', true],
      ['Mariana', 'Lucas', '2026-10-10', 'Indaiatuba', 'published', 'couple', true],
      ['Larissa', 'Pedro', '2026-11-21', 'Valinhos', 'published', 'couple', true],
      ['Bruna', 'Thiago', '2026-12-05', 'Campinas', 'published', 'couple', true],
      ['Fernanda', 'João', '2027-01-30', 'Vinhedo', 'awaiting_couple', 'planner', false],
      // Aguardando pagamento: o casal aceitou e ainda não pagou (rascunho).
      ['Camila', 'Letícia', '2027-03-20', 'Campinas', 'draft', 'planner', true],
      ['Gabriela', 'Rafael', '2027-04-17', 'Sumaré', 'draft', 'planner', false],
      ['Isabela', 'André', '2027-05-08', 'Americana', 'awaiting_couple', 'planner', false],
      ['Beatriz', 'Henrique', '2027-06-26', 'Paulínia', 'draft', 'planner', false],
    ] as const
  ).map(([a, b, eventDate, city, status, createdBy, accepted]): SampleWedding => ({
    slug: slugOfCouple({ a, b }),
    partners: accepted ? owners(a, b) : unaccepted(a, b),
    eventDate,
    city,
    state: 'SP',
    status,
    createdBy,
    referral: createdBy === 'planner' ? 'created_by_planner' : null,
    plannerCollaborates: true,
    appearanceTemplate: PRADO_APPEARANCE_SLUGS.includes(slugOfCouple({ a, b }))
      ? 'Padrão Prado Assessoria'
      : null,
  })),
];

export const SAMPLE_INVITATIONS: SampleInvitation[] = [
  {
    key: 'convite do casal: Fernanda e João',
    weddingSlug: 'fernanda-e-joao',
    kind: 'couple',
    email: email('fernanda.alves'),
    fixedToken: 'seed-convite-casal-fernanda-e-joao',
  },
  {
    key: 'convite do casal: Isabela',
    weddingSlug: 'isabela-e-andre',
    kind: 'couple',
    email: email('isabela.costa'),
    fixedToken: 'seed-convite-casal-isabela',
  },
  {
    key: 'convite do casal: André',
    weddingSlug: 'isabela-e-andre',
    kind: 'couple',
    email: email('andre.figueiredo'),
    fixedToken: 'seed-convite-casal-andre',
  },
  {
    key: 'link do casal sem e-mail: Isabela e André',
    weddingSlug: 'isabela-e-andre',
    kind: 'couple',
    email: null,
    fixedToken: 'seed-link-casal-isabela-e-andre',
  },
  {
    key: 'convite de cerimonialista: Bianca e Henrique → Clara Dias',
    weddingSlug: 'bianca-e-henrique',
    kind: 'planner',
    email: email('clara.dias'),
    fixedToken: 'seed-convite-cerimonialista-bianca-e-henrique',
  },
];

export interface SampleLifecycle {
  publishedAt: Date | null;
  endDate: string | null;
  paidThrough: string | null;
  graceUntil: string | null;
  expiredAt: string | null;
  purgeAt: string | null;
}

/**
 * As datas de vida do casamento de exemplo, a partir de hoje (sugestão do
 * Crivo no DoD da F3; decisão 290): o front da F3 tem dado para "Vence em N
 * dias", a carência e a faixa do expirado. Publicado e pós-evento saem do ar
 * 3 meses depois do casamento, nunca antes de 20 dias; a carência começou há 3
 * dias (graceUntil = endDate + 7); o expirado saiu do ar há 20 dias (expiredAt
 * = graceUntil + 1, purgeAt 6 meses depois), como a rotina da Data de saída do
 * ar grava. Os outros status ficam sem datas.
 */
export function sampleLifecycle({
  status,
  eventDate,
  today,
  now,
}: {
  status: SampleWedding['status'];
  eventDate: string;
  today: string;
  now: Date;
}): SampleLifecycle {
  const none = {
    publishedAt: null,
    endDate: null,
    paidThrough: null,
    graceUntil: null,
    expiredAt: null,
    purgeAt: null,
  };
  const publishedAt = new Date(now.getTime() - 60 * 86_400_000);
  if (status === 'published' || status === 'post_event') {
    const afterEvent = addMonths({ day: eventDate, months: 3 });
    const soonest = addDays({ day: today, days: 20 });
    const endDate = afterEvent > soonest ? afterEvent : soonest;
    return { ...none, publishedAt, endDate, paidThrough: endDate };
  }
  if (status === 'grace') {
    const endDate = addDays({ day: today, days: -3 });
    return {
      ...none,
      publishedAt,
      endDate,
      paidThrough: endDate,
      graceUntil: addDays({ day: endDate, days: 7 }),
    };
  }
  if (status === 'expired') {
    const endDate = addDays({ day: today, days: -20 });
    const graceUntil = addDays({ day: endDate, days: 7 });
    const expiredAt = addDays({ day: graceUntil, days: 1 });
    return {
      publishedAt,
      endDate,
      paidThrough: endDate,
      graceUntil,
      expiredAt,
      purgeAt: addMonths({ day: expiredAt, months: 6 }),
    };
  }
  return none;
}
