import { isValidCpf } from '../../billing/domain/tax-id';
import { maskPhone, parsePhone } from '../../guests/domain/phone';

export type TaxIdType = 'cpf' | 'cnpj';
export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

/** O valor de um caractere do CNPJ alfanumérico (código ASCII − 48). */
const cnpjValue = (char: string): number => char.charCodeAt(0) - 48;

/**
 * CNPJ válido, numérico ou alfanumérico (12 posições com dígitos ou letras
 * maiúsculas e os 2 dígitos verificadores, módulo 11). Aceita com ou sem
 * pontuação.
 */
export function isValidCnpj({ value }: { value: string }): boolean {
  const cnpj = normalizeCnpj({ value });
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const checkDigit = (length: number): number => {
    let weight = 2;
    let sum = 0;
    for (let index = length - 1; index >= 0; index--) {
      sum += cnpjValue(cnpj[index]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13]);
}

const normalizeCnpj = ({ value }: { value: string }): string =>
  value.replace(/[.\-/\s]/g, '').toUpperCase();

/** Só os dígitos do CPF; o CNPJ sem pontuação e em maiúsculas. Nulo se inválido. */
export function normalizeTaxId({ type, value }: { type: TaxIdType; value: string }): string | null {
  if (type === 'cpf') return isValidCpf({ value }) ? value.replace(/\D/g, '') : null;
  return isValidCnpj({ value }) ? normalizeCnpj({ value }) : null;
}

/**
 * A máscara do CPF ou do CNPJ (decisão 244(2)): CPF "***.456.789-**", CNPJ
 * "**.345.678/0001-**". Recebe o valor já normalizado.
 */
export function maskTaxId({ type, value }: { type: TaxIdType; value: string }): string {
  if (type === 'cpf') return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`;
  return `**.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-**`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RANDOM_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A chave Pix no formato do DICT: CPF e CNPJ só com os dígitos (o CNPJ
 * alfanumérico em maiúsculas), e-mail em minúsculas (até 77 caracteres),
 * telefone em E.164 e a aleatória (EVP) como UUID em minúsculas. Nulo se
 * inválida.
 */
export function normalizePixKey({
  type,
  value,
}: {
  type: PixKeyType;
  value: string;
}): string | null {
  const raw = value.trim();
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return normalizeTaxId({ type, value: raw });
    case 'email': {
      const email = raw.toLowerCase();
      return email.length <= 77 && EMAIL.test(email) ? email : null;
    }
    case 'phone': {
      const parsed = parsePhone({ raw });
      return parsed.ok ? parsed.e164 : null;
    }
    case 'random': {
      const key = raw.toLowerCase();
      return RANDOM_KEY.test(key) ? key : null;
    }
  }
}

/**
 * A máscara da chave (decisão 244(2)): CPF e CNPJ como no `maskTaxId`, e-mail
 * com as 3 primeiras letras e o domínio ("jul***@pradoassessoria.com.br"),
 * telefone como na lista de convidados ("(19) 9****-3310") e a aleatória com
 * os 4 primeiros e os 4 últimos ("a1b2…c3d4").
 */
export function maskPixKey({ type, value }: { type: PixKeyType; value: string }): string {
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return maskTaxId({ type, value });
    case 'email': {
      const at = value.lastIndexOf('@');
      return `${[...value.slice(0, at)].slice(0, 3).join('')}***${value.slice(at)}`;
    }
    case 'phone':
      return maskPhone({ e164: value });
    case 'random':
      return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
}
