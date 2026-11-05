export type PlatformRole = 'none' | 'admin' | 'support';
export type ProfileKind = 'couple' | 'planner' | 'seller';

/** Quem está conectado nesta requisição, já validado pela sessão. */
export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  authenticatedAt: Date;
  activeProfile: ProfileKind | null;
}
