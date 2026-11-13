import {
  SiteDraftError,
  SiteExpiredError,
  SiteNotFoundError,
  SiteUnavailableError,
} from './site.errors';

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

/**
 * O estado do site pela função única wedding_site_state (Data de saída do ar
 * RN08): `live` mostra; `expired` é a página "Este site não está mais
 * disponível." (410); `unavailable`, a do bloqueio (423); `not_found`, 404 (ou a
 * do rascunho).
 */
export type SiteState = 'live' | 'expired' | 'unavailable' | 'not_found';
/** Rascunho: a página "Este site ainda não foi publicado.", sem dado nenhum (RN04). */
export const DRAFT_SITE_STATUSES: readonly string[] = ['awaiting_couple', 'draft'];

/** A pergunta de música padrão (Música RN01; decisão 91 a); o texto nulo vale ela. */
export const DEFAULT_SONG_QUESTION = 'Que música não pode faltar na festa?';
/** A pergunta e a sugestão vão até 120 caracteres (Música RN01 e RN04; decisão 217(14)). */
export const SONG_TEXT_MAX = 120;

/**
 * O site que não está no ar vira o erro da página certa (Site público RN04;
 * Data de saída do ar RN08): rascunho, expirado, bloqueado ou não existe.
 */
export function requireLiveSite<
  T extends { live: true } | { live: false; status: string; siteState: SiteState },
>(site: T | null): asserts site is Extract<T, { live: true }> {
  if (site?.live) return;
  if (!site) throw new SiteNotFoundError();
  const { status, siteState } = site as { status: string; siteState: SiteState };
  if (DRAFT_SITE_STATUSES.includes(status)) throw new SiteDraftError();
  if (siteState === 'expired') throw new SiteExpiredError();
  if (siteState === 'unavailable') throw new SiteUnavailableError();
  throw new SiteNotFoundError();
}
