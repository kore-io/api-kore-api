import type { SiteState } from '../../domain/public-site';
import type { SectionContent, SiteSectionType } from '../../domain/site-sections';

export interface PublicSiteImage {
  id: string;
  storageKey: string;
  thumbKey: string;
  ogKey: string;
  width: number;
  height: number;
}

/**
 * O que a função site_public_by_slug devolve: só o status, fora do ar; as
 * colunas públicas, no ar. Da Cerimônia, só `venueCount` (o recorte do
 * visitante é feito no banco).
 */
export type PublicSiteRow =
  | { status: string; live: false; siteState: SiteState }
  | {
      status: string;
      live: true;
      weddingId: string;
      slug: string;
      eventDate: string | null;
      city: string;
      state: string;
      timezone: string;
      fontPairKey: string;
      primaryColor: string;
      accentColor: string;
      backgroundMode: string;
      coverImageId: string | null;
      partners: string[];
      sections: { type: SiteSectionType; title: string | null; content: SectionContent }[];
      images: PublicSiteImage[];
      /** A assinatura da assessoria, pela wedding_planner_credit (Assinatura RN02). */
      plannerCredit: string | null;
    };

export interface PartyByToken {
  weddingId: string;
  slug: string | null;
  status: string;
  /** Pela wedding_site_state (Data de saída do ar RN08). */
  siteState: SiteState;
  partyId: string;
  partyName: string;
  linkVersion: number;
}

/** O que só o grupo identificado vê (RN05), lido depois de conferir o grupo do cookie. */
export interface PartySiteView {
  partyName: string;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  venues: Record<string, unknown>[];
}

/** A leitura pública pelo endereço, sem sessão (Site público RN05 e RN06). */
export interface PublicSiteReader {
  bySlug({ slug }: { slug: string }): Promise<PublicSiteRow | null>;

  /**
   * A assinatura da assessoria do casamento da transação (a prévia), pela
   * mesma regra das outras leituras (Assinatura RN02 e RN04). Sem parâmetro de
   * id: só o casamento da sessão, com vínculo ativo.
   */
  plannerCredit(): Promise<string | null>;

  /** O grupo do token do link, fora da lixeira (RN06). */
  partyByToken({ token }: { token: string }): Promise<PartyByToken | null>;

  /**
   * O que é só do grupo, se o grupo do cookie ainda vale: do casamento, fora da
   * lixeira, com a mesma versão do link e o casamento no ar (ADR-36, item 2).
   */
  partyView({
    weddingId,
    partyId,
    linkVersion,
  }: {
    weddingId: string;
    partyId: string;
    linkVersion: number;
  }): Promise<PartySiteView | null>;
}

export const PUBLIC_SITE_READER = Symbol('PublicSiteReader');
