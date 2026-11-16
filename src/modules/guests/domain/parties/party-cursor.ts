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

/**
 * O cursor da ordem por "Respondido em" (Central RN05; Dashboard RN04;
 * decisão 246): o instante (nulo: ainda sem resposta) e o id do último grupo
 * da página, marcado com "r" para não valer na ordem alfabética.
 */
export function encodeRespondedCursor({
  respondedAt,
  id,
}: {
  respondedAt: Date | null;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify(['r', respondedAt?.toISOString() ?? null, id]),
    'utf8',
  ).toString('base64url');
}

/** null quando o cursor não é um que a API deu nesta ordem. */
export function decodeRespondedCursor({
  cursor,
}: {
  cursor: string;
}): { respondedAt: Date | null; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value[0] === 'r' &&
      (value[1] === null ||
        (typeof value[1] === 'string' && !Number.isNaN(Date.parse(value[1])))) &&
      typeof value[2] === 'string' &&
      UUID.test(value[2])
    )
      return { respondedAt: value[1] === null ? null : new Date(value[1] as string), id: value[2] };
    return null;
  } catch {
    return null;
  }
}
