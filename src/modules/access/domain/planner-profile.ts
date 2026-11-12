import type { FieldError } from '../../../shared/http/validation-errors';
import { BRAZILIAN_STATES, cleanText } from './wedding-signup';

/** Limites dos Dados profissionais (Cadastro e perfil RN04). */
export const CREDIT_NAME_MIN = 2;
export const CREDIT_NAME_MAX = 80;
export const PERSON_NAME_MAX = 80;
export const CITY_MAX = 80;
/** Teto técnico do DTO, que não aparece na tela (decisão 224(9)). */
export const CITIES_MAX = 50;

const ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N} &'.,\-()]+$/u;
/** Controle, formato (largura zero e direção) e separadores fora do espaço. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const DOMAIN =
  /[\p{L}\p{N}]\.(?:com|net|org|br|io|app|me|info|biz|co|online|site|store|shop|art|blog|dev|xyz|us|pt|tv)(?![\p{L}\p{N}])/iu;
const MAX_DIGITS = 7;

/** NFKC, sem espaços nas pontas e com os espaços seguidos juntados. */
export function normalizeCreditName({ value }: { value: string }): string {
  return cleanText({ value: value.normalize('NFKC') });
}

/**
 * O predicado único do Nome da assessoria (Cadastro e perfil RN04; decisão
 * 224(13)): só o nome, sem link, e-mail nem telefone. Vale no cadastro, no Meu
 * perfil, no perfil mínimo do aceite e na leitura da assinatura.
 */
export function isValidCreditName({ value }: { value: string }): boolean {
  // Controle e invisíveis antes de juntar os espaços: a quebra de linha também conta.
  if (INVISIBLE.test(value.normalize('NFKC'))) return false;
  const name = normalizeCreditName({ value });
  if (name.length < CREDIT_NAME_MIN || name.length > CREDIT_NAME_MAX) return false;
  if (!ALLOWED_CHARACTERS.test(name)) return false;
  if ((name.match(/\p{Nd}/gu) ?? []).length > MAX_DIGITS) return false;
  const lower = name.toLowerCase();
  if (lower.includes('http') || lower.includes('www.')) return false;
  return !DOMAIN.test(name);
}

/**
 * Telefone e WhatsApp (RN04): DDD e número, 10 ou 11 dígitos, guardados só com
 * os dígitos. Nulo quando o campo vem vazio.
 */
export function phoneDigits({
  value,
}: {
  value: string;
}): { ok: true; digits: string | null } | { ok: false } {
  const digits = value.replace(/\D/g, '');
  if (!value.trim()) return { ok: true, digits: null };
  if (!/^[1-9][1-9]\d{8,9}$/.test(digits)) return { ok: false };
  return { ok: true, digits };
}

const CITY_FORMAT = /^.{1,74} \(([A-Z]{2})\)$/u;

/** O que a pessoa informa nos Dados profissionais; ausente = não muda (PATCH). */
export interface PlannerProfileInput {
  creditName?: string;
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  cities?: string[];
}

export interface PlannerProfileChanges {
  creditName?: string;
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  cities?: string[];
}

/**
 * Valida e normaliza os Dados profissionais (RN04), no formato da decisão 190.
 * `required` lista o que o pedido precisa trazer (no cadastro, o nome da
 * assessoria, as cidades e, sem nome na conta, o nome da pessoa).
 */
export function checkPlannerProfile({
  input,
  required,
}: {
  input: PlannerProfileInput;
  required: readonly ('creditName' | 'name' | 'cities')[];
}): { changes: PlannerProfileChanges; issues: FieldError[] } {
  const issues: FieldError[] = [];
  const changes: PlannerProfileChanges = {};
  const issue = (path: string, code: string, params: Record<string, unknown> = {}) =>
    issues.push({ path, code, params });

  if (input.creditName === undefined || !input.creditName.trim()) {
    if (input.creditName !== undefined || required.includes('creditName'))
      issue('creditName', 'REQUIRED');
  } else {
    const creditName = normalizeCreditName({ value: input.creditName });
    if (creditName.length > CREDIT_NAME_MAX)
      issue('creditName', 'TOO_LONG', { max: CREDIT_NAME_MAX });
    else if (creditName.length < CREDIT_NAME_MIN)
      issue('creditName', 'TOO_SHORT', { min: CREDIT_NAME_MIN });
    else if (!isValidCreditName({ value: input.creditName }))
      issue('creditName', 'CREDIT_NAME_INVALID');
    else changes.creditName = creditName;
  }

  if (input.name === undefined || !input.name.trim()) {
    if (input.name !== undefined || required.includes('name')) issue('name', 'REQUIRED');
  } else {
    const name = cleanText({ value: input.name });
    if (name.length > PERSON_NAME_MAX) issue('name', 'TOO_LONG', { max: PERSON_NAME_MAX });
    else changes.name = name;
  }

  for (const field of ['phone', 'whatsapp'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    const parsed = value === null ? { ok: true as const, digits: null } : phoneDigits({ value });
    if (!parsed.ok) issue(field, 'PHONE_INVALID');
    else changes[field] = parsed.digits;
  }

  if (input.cities === undefined) {
    if (required.includes('cities')) issue('cities', 'REQUIRED');
  } else {
    const cities = input.cities.map((value) => cleanText({ value }));
    if (cities.length === 0) issue('cities', 'REQUIRED');
    else if (cities.length > CITIES_MAX) issue('cities', 'TOO_MANY', { max: CITIES_MAX });
    else {
      const seen = new Set<string>();
      cities.forEach((city, index) => {
        const path = `cities.${index}`;
        const key = city.toLocaleLowerCase('pt-BR');
        const state = CITY_FORMAT.exec(city)?.[1];
        if (city.length > CITY_MAX) issue(path, 'TOO_LONG', { max: CITY_MAX });
        else if (!state || !(BRAZILIAN_STATES as readonly string[]).includes(state))
          issue(path, 'INVALID');
        else if (seen.has(key)) issue(path, 'DUPLICATE');
        seen.add(key);
      });
      if (!issues.some((item) => item.path.startsWith('cities'))) changes.cities = cities;
    }
  }

  return { changes, issues };
}

/**
 * RN10: o perfil está completo com pelo menos uma cidade, os Termos vigentes e
 * o nome da assessoria que passa no predicado. É a regra única do Alert.
 */
export function isProfileComplete({
  creditName,
  cities,
  termsAccepted,
}: {
  creditName: string;
  cities: readonly string[];
  termsAccepted: boolean;
}): boolean {
  return cities.length > 0 && termsAccepted && isValidCreditName({ value: creditName });
}

/**
 * Códigos que parecem do Kore (RN05; revisão C1-7): valem como repetidos, e
 * quem se chama assim ganha o sufixo.
 */
export const RESERVED_REFERRAL_CODES: ReadonlySet<string> = new Set([
  'kore',
  'suporte',
  'admin',
  'administrador',
  'equipe',
  'contato',
  'ajuda',
  'atendimento',
  'oficial',
  'sac',
]);
