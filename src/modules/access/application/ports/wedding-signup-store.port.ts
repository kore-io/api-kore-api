import type { PartnerTitle, SignupSource } from '../../domain/wedding-signup';

export interface NewWedding {
  weddingId: string;
  userId: string;
  /** A sessão de quem cria: passa ao perfil de casal (decisão 171). */
  sessionId: string;
  myName: string;
  myTitle: PartnerTitle;
  partnerName: string;
  slug: string;
  eventDate: Date | null;
  city: string;
  state: string;
  timezone: string;
  referrerId: string | null;
  signupSource: SignupSource;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  termsVersion: string;
  /** A aparência do simulador (Simule RN10), já conferida; null nasce com o padrão. */
  appearance: {
    fontPairKey: string;
    starterPaletteKey: string | null;
    primaryColor: string;
    accentColor: string;
    backgroundMode: string;
  } | null;
  now: Date;
}

/** Gravação do cadastro na transação da requisição (RN06, RN07, RN11). */
export interface WeddingSignupStore {
  /** Serializa os cadastros da mesma pessoa até o fim da transação (RN06). */
  lockOwner({ userId }: { userId: string }): Promise<void>;
  /** Casamento ativo (não expurgado) de que a pessoa é dona, se houver (RN06). */
  findActiveOwnedWeddingId({ userId }: { userId: string }): Promise<string | null>;
  /** 'slug_taken' quando outro cadastro levou o endereço no meio do caminho. */
  create({ wedding }: { wedding: NewWedding }): Promise<'created' | 'slug_taken'>;
}

export const WEDDING_SIGNUP_STORE = Symbol('WeddingSignupStore');
