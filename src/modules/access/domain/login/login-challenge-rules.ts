/** RN02 de Login: o botão e o código valem 15 minutos. */
export const LOGIN_CHALLENGE_TTL_MS = 15 * 60 * 1000;
/** RN05: 5 códigos errados invalidam o pedido. */
export const LOGIN_CHALLENGE_MAX_ATTEMPTS = 5;
/** RN04: 60 segundos entre pedidos e no máximo 5 pedidos por hora, por e-mail. */
export const LOGIN_REQUEST_INTERVAL_MS = 60 * 1000;
export const LOGIN_REQUESTS_PER_HOUR = 5;
export const LOGIN_REQUEST_WINDOW_MS = 60 * 60 * 1000;

export type LoginRequestQuota =
  | { allowed: true }
  | { allowed: false; reason: 'too_soon'; resendAvailableAt: Date }
  | { allowed: false; reason: 'too_many'; retryAfterMinutes: number };

/**
 * Pode pedir um código agora? `recentRequests` são os pedidos do e-mail na
 * última hora (RN04).
 */
export function evaluateLoginRequestQuota({
  recentRequests,
  now,
}: {
  recentRequests: readonly Date[];
  now: Date;
}): LoginRequestQuota {
  const inWindow = recentRequests
    .filter((createdAt) => now.getTime() - createdAt.getTime() < LOGIN_REQUEST_WINDOW_MS)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length >= LOGIN_REQUESTS_PER_HOUR) {
    const oldest = inWindow[inWindow.length - LOGIN_REQUESTS_PER_HOUR];
    const freesAt = oldest.getTime() + LOGIN_REQUEST_WINDOW_MS;
    return {
      allowed: false,
      reason: 'too_many',
      retryAfterMinutes: Math.max(1, Math.ceil((freesAt - now.getTime()) / 60_000)),
    };
  }

  const latest = inWindow[inWindow.length - 1];
  if (latest && now.getTime() - latest.getTime() < LOGIN_REQUEST_INTERVAL_MS) {
    return {
      allowed: false,
      reason: 'too_soon',
      resendAvailableAt: new Date(latest.getTime() + LOGIN_REQUEST_INTERVAL_MS),
    };
  }

  return { allowed: true };
}

export interface LoginChallengeState {
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

/** RN02 e RN04: vale enquanto não venceu, não foi usado nem substituído. */
export function isLoginChallengeUsable({
  challenge,
  now,
}: {
  challenge: LoginChallengeState;
  now: Date;
}): boolean {
  return (
    challenge.consumedAt === null &&
    challenge.invalidatedAt === null &&
    challenge.expiresAt.getTime() > now.getTime()
  );
}
