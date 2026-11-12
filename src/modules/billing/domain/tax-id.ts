/**
 * CPF válido (Publicar e pagar RN02): 11 dígitos, não repetidos, com os dois
 * dígitos verificadores. Aceita com ou sem máscara.
 */
export function isValidCpf({ value }: { value: string }): boolean {
  if (!/^[\d.\-\s]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const numbers = [...digits].map(Number);
  const checkDigit = (length: number): number => {
    const sum = numbers
      .slice(0, length)
      .reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return checkDigit(9) === numbers[9] && checkDigit(10) === numbers[10];
}
