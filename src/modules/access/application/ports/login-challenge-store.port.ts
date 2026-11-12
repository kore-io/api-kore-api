import type { LoginOrigin } from '../../domain/login-next-step';

export interface LoginChallengeRecord {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  origin: LoginOrigin;
  originRef: string | null;
}

export interface NewLoginChallenge {
  email: string;
  tokenHash: string;
  codeHash: string;
  expiresAt: Date;
  origin: LoginOrigin;
  originRef: string | null;
  requestIp: string | null;
}

/** Operações feitas com o e-mail travado: pedidos simultâneos não se atropelam. */
export interface LoginChallengeTransaction {
  listRequestTimesSince({ email, since }: { email: string; since: Date }): Promise<Date[]>;
  invalidateActive({ email, now }: { email: string; now: Date }): Promise<void>;
  create({ challenge }: { challenge: NewLoginChallenge }): Promise<void>;
  /** O pedido mais recente ainda não usado nem invalidado (pode estar vencido). */
  findLatestOpen({ email }: { email: string }): Promise<LoginChallengeRecord | null>;
  /** Soma uma tentativa errada e devolve o total. */
  registerFailedAttempt({ id }: { id: string }): Promise<number>;
  invalidate({ id, now }: { id: string; now: Date }): Promise<void>;
  /** Marca como usado se ainda estiver aberto; false se outro uso chegou antes. */
  consume({ id, now }: { id: string; now: Date }): Promise<boolean>;
}

export interface LoginChallengeStore {
  exclusiveForEmail<T>({
    email,
    work,
  }: {
    email: string;
    work: (transaction: LoginChallengeTransaction) => Promise<T>;
  }): Promise<T>;
  findByTokenHash({ tokenHash }: { tokenHash: string }): Promise<LoginChallengeRecord | null>;
}

export const LOGIN_CHALLENGE_STORE = Symbol('LoginChallengeStore');
