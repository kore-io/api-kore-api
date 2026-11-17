/**
 * O código de login errado conta para o alerta `login_abuse` (Backoffice -
 * acesso RN12; decisão 275): mais de 10 em 1 h para o mesmo e-mail ou IP.
 */
export interface LoginAbuseMonitor {
  recordFailure(input: { email: string; ip: string | null; now: Date }): Promise<void>;
}

export const LOGIN_ABUSE_MONITOR = Symbol('LoginAbuseMonitor');
