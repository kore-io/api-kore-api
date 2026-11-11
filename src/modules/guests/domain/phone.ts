import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Código do erro do telefone (Grupos RN04; decisão 186). */
export type PhoneErrorCode = 'PHONE_TOO_SHORT' | 'PHONE_TOO_LONG' | 'PHONE_INVALID';

export type PhoneParseResult =
  { ok: true; e164: string } | { ok: false; code: PhoneErrorCode; params: { n: number } };

const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

/**
 * O parser único do telefone (Grupos RN04; decisão 189, item 4), para o
 * formulário e a planilha (célula texto ou número). Contam só os dígitos:
 * 1. com "+" no começo, de 8 a 15 dígitos é internacional, com o código do
 *    país conferido pelo libphonenumber-js; fora disso, PHONE_INVALID;
 * 2. sem "+", sai um zero do começo (o zero de tronco);
 * 3. 12 ou 13 dígitos começando com 55 perdem o 55 (são do Brasil);
 * 4. depois, 10 ou 11 dígitos são do Brasil; menos é PHONE_TOO_SHORT, mais é
 *    PHONE_TOO_LONG.
 * O {n} do erro conta os dígitos como vieram, antes de tirar o zero ou o 55.
 */
export function parsePhone({ raw }: { raw: string | number }): PhoneParseResult {
  const text = String(raw).trim();
  let digits = text.replace(/\D/g, '');
  const n = digits.length;

  if (text.startsWith('+')) {
    if (n < E164_MIN_DIGITS || n > E164_MAX_DIGITS) return invalid({ n });
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (!parsed) return invalid({ n });
    return { ok: true, e164: parsed.number };
  }

  if (digits.startsWith('0')) digits = digits.slice(1);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))
    digits = digits.slice(2);
  if (digits.length < 10) return { ok: false, code: 'PHONE_TOO_SHORT', params: { n } };
  if (digits.length > 11) return { ok: false, code: 'PHONE_TOO_LONG', params: { n } };
  return { ok: true, e164: `+55${digits}` };
}

function invalid({ n }: { n: number }): PhoneParseResult {
  return { ok: false, code: 'PHONE_INVALID', params: { n } };
}

/**
 * O telefone mascarado da lista (Grupos RN13; decisão 186, item 11), para o
 * número inteiro não sair da rota. Brasil: DDD, o primeiro dígito e os 4
 * últimos ("(19) 9****-3310"; fixo "(19) 3***-3310"). Internacional: o código
 * do país, o primeiro dígito e os 3 últimos, o resto com `*`, em blocos de 3
 * contados da direita ("+351 9** *** 678").
 */
export function maskPhone({ e164 }: { e164: string }): string {
  const parsed = parsePhoneNumberFromString(e164);
  const countryCode = parsed?.countryCallingCode ?? '';
  const national = parsed?.nationalNumber ?? e164.replace(/\D/g, '');

  if (countryCode === '55') {
    const ddd = national.slice(0, 2);
    const local = national.slice(2);
    const last4 = local.slice(-4);
    const hidden = '*'.repeat(Math.max(local.length - 5, 0));
    return `(${ddd}) ${local[0]}${hidden}-${last4}`;
  }

  const masked =
    national.length <= 4
      ? national
      : national[0] + '*'.repeat(national.length - 4) + national.slice(-3);
  const blocks: string[] = [];
  for (let end = masked.length; end > 0; end -= 3)
    blocks.unshift(masked.slice(Math.max(end - 3, 0), end));
  return `+${countryCode} ${blocks.join(' ')}`;
}
