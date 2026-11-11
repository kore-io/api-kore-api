/**
 * Cursor da lista de grupos (Grupos RN13; decisão 186, item 2): opaco para o
 * app, guarda (nome normalizado, id) do último grupo da página, porque o nome
 * do grupo não é único.
 */
export function encodePartyCursor({ name, id }: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null quando o cursor não é um que a API deu. */
export function decodePartyCursor({
  cursor,
}: {
  cursor: string;
}): { name: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      UUID.test(value[1])
    )
      return { name: value[0], id: value[1] };
    return null;
  } catch {
    return null;
  }
}
