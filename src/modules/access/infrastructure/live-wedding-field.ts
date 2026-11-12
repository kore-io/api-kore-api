/**
 * Campo de casamento que só a lápide do expurgo deixa nulo (chk_weddings_tombstone).
 * Quem lê casamento vivo usa isto: nulo aqui é casamento expurgado lido por engano.
 */
export function liveWeddingField<T>({ value, field }: { value: T | null; field: string }): T {
  if (value === null) throw new Error(`Casamento expurgado lido como vivo (${field}).`);
  return value;
}
