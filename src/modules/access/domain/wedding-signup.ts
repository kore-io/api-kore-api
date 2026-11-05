/** Noivo ou noiva (decisão 135, item 9). */
export const PARTNER_TITLES = ['bride', 'groom'] as const;
export type PartnerTitle = (typeof PARTNER_TITLES)[number];

/** O que o cliente informa; referral_link é derivado no servidor (decisão 135). */
export const CLIENT_SIGNUP_SOURCES = ['direct', 'simulator', 'made_with_kore'] as const;
export type ClientSignupSource = (typeof CLIENT_SIGNUP_SOURCES)[number];
export type SignupSource = ClientSignupSource | 'referral_link';

/** RN03 de Cadastro: a UF define o fuso do casamento (decisão 166). */
export const TIMEZONE_BY_STATE = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  RR: 'America/Boa_Vista',
  RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  PA: 'America/Belem',
  AP: 'America/Belem',
  TO: 'America/Araguaina',
  MA: 'America/Fortaleza',
  PI: 'America/Fortaleza',
  CE: 'America/Fortaleza',
  RN: 'America/Fortaleza',
  PB: 'America/Fortaleza',
  PE: 'America/Recife',
  AL: 'America/Maceio',
  SE: 'America/Maceio',
  BA: 'America/Bahia',
  GO: 'America/Sao_Paulo',
  DF: 'America/Sao_Paulo',
  MG: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  RJ: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  PR: 'America/Sao_Paulo',
  SC: 'America/Sao_Paulo',
  RS: 'America/Sao_Paulo',
} as const;

export type BrazilianState = keyof typeof TIMEZONE_BY_STATE;
export const BRAZILIAN_STATES = Object.keys(TIMEZONE_BY_STATE) as BrazilianState[];

export function timezoneForState({ state }: { state: BrazilianState }): string {
  return TIMEZONE_BY_STATE[state];
}

/** Modelo de Dados, Slugs reservados: são rotas do Kore. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'grupo',
  'convite',
  'evento',
  'app',
  'admin',
  'api',
  'cerimonialista',
  'login',
  'entrar',
  'ajuda',
  'termos',
  'privacidade',
  'kore',
  'www',
]);

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** RN04: a-z, 0-9 e hífen, sem hífen no começo, no fim ou repetido. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlugFormat({ slug }: { slug: string }): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug)
  );
}

export type SlugUnavailableReason = 'taken' | 'reserved' | 'invalid_format';

/**
 * RN05 (decisão 166): alternativas em ordem: com o ano da data, se houver; depois
 * -2, -3… A base é cortada para o sufixo caber nos 40 caracteres.
 */
export function* slugAlternatives({
  slug,
  eventDate,
}: {
  slug: string;
  eventDate: Date | null;
}): Generator<string> {
  const withSuffix = (suffix: string) =>
    `${slug.slice(0, SLUG_MAX_LENGTH - suffix.length - 1).replace(/-+$/, '')}-${suffix}`;
  if (eventDate) yield withSuffix(String(eventDate.getUTCFullYear()));
  for (let n = 2; ; n++) yield withSuffix(String(n));
}

/** Nomes e cidade chegam com espaços sobrando; o que vale é o texto aparado (decisão 166). */
export function cleanText({ value }: { value: string }): string {
  return value.trim().replace(/\s+/g, ' ');
}
