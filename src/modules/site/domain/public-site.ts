/**
 * Os nomes do casal no site (Site público RN05; decisão 182): os primeiros
 * nomes ("Ana & Marcos"); se forem iguais, os nomes completos.
 */
export function coupleNames({ partners }: { partners: readonly string[] }): string {
  const full = partners.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const first = full.map((name) => name.split(' ')[0]);
  const same = first.length === 2 && first[0].toLowerCase() === first[1].toLowerCase();
  return (same ? full : first).join(' & ');
}

/** Status em que o site aparece; as páginas de expirado e bloqueado chegam na F3 (RN04). */
export const LIVE_SITE_STATUSES: readonly string[] = ['published', 'post_event', 'grace'];
/** Rascunho: a página "Este site ainda não foi publicado.", sem dado nenhum (RN04). */
export const DRAFT_SITE_STATUSES: readonly string[] = ['awaiting_couple', 'draft'];

/** A pergunta de música padrão (Música RN01; decisão 91 a); o texto nulo vale ela. */
export const DEFAULT_SONG_QUESTION = 'Que música não pode faltar na festa?';
/** A pergunta e a sugestão vão até 120 caracteres (Música RN01 e RN04; decisão 217(14)). */
export const SONG_TEXT_MAX = 120;
