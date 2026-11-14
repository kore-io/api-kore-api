export type PlatformRole = 'none' | 'admin' | 'support';
export type ProfileKind = 'couple' | 'planner' | 'seller';
export type AuthMethod = 'email' | 'google';

/** Quem está conectado nesta requisição, já validado pela sessão. */
export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  authenticatedAt: Date;
  /** Como foi o login: o backoffice exige o Google do domínio (RN12). */
  authMethod: AuthMethod;
  activeProfile: ProfileKind | null;
  /** O hd verificado do Google no login (Backoffice - acesso RN01); nulo no login por código. */
  staffDomain: string | null;
}
