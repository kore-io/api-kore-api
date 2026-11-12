import type { SectionContent, SiteSectionType } from '../../domain/site-sections';

export interface SiteSnapshot {
  status: string;
  publishedAt: Date | null;
  /** A data de saída do ar (Publicação RN04); nula antes de publicar. */
  endDate: Date | null;
  siteUpdatedAt: Date | null;
  partners: { id: string; name: string; title: 'bride' | 'groom' | null }[];
  eventDate: Date | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  slug: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  coverImageId: string | null;
  /** A pergunta de música (Música RN01); o texto nulo vale o padrão. */
  songQuestion: { enabled: boolean; text: string | null };
  /** A escolha do casal sobre a assinatura da assessoria (Assinatura RN05). */
  showPlannerCredit: boolean;
  appearance: {
    fontPairKey: string;
    starterPaletteKey: string | null;
    primaryColor: string;
    accentColor: string;
    backgroundMode: string;
  };
  /** As 6 da F2, na ordem fixa, com o conteúdo `pt-BR`. */
  sections: {
    type: SiteSectionType;
    enabled: boolean;
    title: string | null;
    content: SectionContent;
  }[];
}

export interface ReadySiteImage {
  id: string;
  storageKey: string;
  thumbKey: string;
  ogKey: string;
  width: number;
  height: number;
}

/** O site do casamento, na transação da requisição (RLS). */
/** A cerimonialista colaboradora, pela wedding_planner_collaborator (Assinatura RN02 e RN05). */
export interface PlannerCollaboratorCredit {
  /** Nulo quando o nome não passa no predicado (RN03). */
  name: string | null;
  hiddenByKore: boolean;
}

export interface SiteReader {
  read({ weddingId }: { weddingId: string }): Promise<SiteSnapshot | null>;

  /**
   * A cerimonialista do casamento da transação; sem ela (ou com o vendedor),
   * nulo. Sem parâmetro de id: só o casamento da sessão, com vínculo ativo.
   */
  plannerCollaborator(): Promise<PlannerCollaboratorCredit | null>;

  /** As imagens `ready` do casamento entre os ids pedidos (as outras somem da leitura). */
  readyImages({
    weddingId,
    ids,
  }: {
    weddingId: string;
    ids: readonly string[];
  }): Promise<ReadySiteImage[]>;
}

export const SITE_READER = Symbol('SiteReader');
