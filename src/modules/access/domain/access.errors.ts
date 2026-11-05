/** Sessão vencida, encerrada ou inexistente (RN08 a RN11 de Login). */
export class SessionExpiredError extends Error {
  override name = 'SessionExpiredError';
}
