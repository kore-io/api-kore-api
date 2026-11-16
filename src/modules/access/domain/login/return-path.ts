const MAX_RETURN_PATH_LENGTH = 512;

/**
 * Página de volta depois do login (RN10 de Login). Só vale caminho relativo do
 * próprio app: começa com uma barra, sem `//`, sem barra invertida e sem
 * esquema. Inválido é ignorado, sem erro, para não abrir redirecionamento
 * aberto (decisão 136, item 7).
 */
export function safeReturnPath({ next }: { next: string | undefined }): string | null {
  if (!next || next.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  if (next.includes('\\') || hasControlCharacter({ text: next })) return null;
  // A URL resolvida contra uma base qualquer tem de continuar na mesma origem.
  const resolved = new URL(next, 'https://app.invalid');
  return resolved.origin === 'https://app.invalid' ? next : null;
}

function hasControlCharacter({ text }: { text: string }): boolean {
  return [...text].some((character) => character.charCodeAt(0) < 0x20);
}
