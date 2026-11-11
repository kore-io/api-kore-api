/** O token da prévia vale 5 minutos e uma vez só (Pré-visualização RN02). */
export const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
/** O cookie da prévia vale 30 minutos fixos, sem estender (RN03 e RN08; decisão 207, item 8). */
export const PREVIEW_COOKIE_TTL_MS = 30 * 60 * 1000;
/** Os tokens saem da tabela depois de 1 dia (Pré-visualização, modelo). */
export const PREVIEW_TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;
/** O Select da barra da prévia mostra até 100 grupos (RN06; decisão 203). */
export const PREVIEW_PARTIES_LIMIT = 100;

export const PREVIEW_MODES = ['visitor', 'party'] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
