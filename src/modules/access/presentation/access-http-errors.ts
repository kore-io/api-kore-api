import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InvalidLoginCodeError,
  LoginChallengeExpiredError,
  LoginChallengeLockedError,
  LoginRequestLimitError,
  LoginRequestTooSoonError,
  ReferralNotFoundError,
  OwnersFullError,
  InvitationInvalidError,
  EmailMismatchError,
  AlreadyMemberError,
  ProfileNotOwnedError,
  CannotRemoveOwnerError,
  LastOwnerError,
  MembershipNotFoundError,
  SellerCannotBePlannerError,
  InvitationNotDeclinableError,
  AcceptanceDetailsMissingError,
  CoupleInvitationsFullError,
  PlannerAlreadyError,
  InvalidInvitationRecipientsError,
  InvitationNotPendingError,
  InvitationNotFoundError,
  AlreadyOwnerError,
  SlugUnavailableError,
  TermsVersionOutdatedError,
  SessionExpiredError,
  UserBlockedError,
  WeddingActionForbiddenError,
  WeddingNotFoundError,
} from '../domain/access.errors';

/** Erros de regra no formato nativo, com o código no campo error (decisão 99). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof SessionExpiredError) {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'SESSION_EXPIRED',
      message: 'Session expired or ended.',
    });
  }
  if (error instanceof LoginRequestTooSoonError) {
    return new HttpException(
      {
        statusCode: 429,
        error: 'TOO_SOON',
        message: 'Wait before requesting another code.',
        resendAvailableAt: error.resendAvailableAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof LoginRequestLimitError) {
    return new HttpException(
      {
        statusCode: 429,
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many codes requested.',
        retryAfterMinutes: error.retryAfterMinutes,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof InvalidLoginCodeError) {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'INVALID_CODE',
      message: 'Wrong code.',
      attemptsLeft: error.attemptsLeft,
    });
  }
  if (error instanceof LoginChallengeExpiredError) {
    return new GoneException({
      statusCode: 410,
      error: 'CHALLENGE_EXPIRED',
      message: 'Login code expired, used or replaced.',
    });
  }
  if (error instanceof LoginChallengeLockedError) {
    return new GoneException({
      statusCode: 410,
      error: 'CHALLENGE_LOCKED',
      message: 'Too many wrong codes.',
      newCodeSent: error.newCodeSent,
      ...(error.retryAfterMinutes !== undefined && { retryAfterMinutes: error.retryAfterMinutes }),
    });
  }
  if (error instanceof WeddingNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'WEDDING_NOT_FOUND',
      message: 'Wedding not found.',
    });
  }
  if (error instanceof WeddingActionForbiddenError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'ACTION_NOT_ALLOWED',
      message: 'Your role in this wedding does not allow this action.',
    });
  }
  if (error instanceof ReferralNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'REFERRAL_NOT_FOUND',
      message: 'Referral not found.',
    });
  }
  if (error instanceof SlugUnavailableError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SLUG_UNAVAILABLE',
      message: 'Wedding address taken or reserved.',
      suggestion: error.suggestion,
    });
  }
  if (error instanceof AlreadyOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_OWNER',
      message: 'You already own an active wedding.',
      weddingId: error.weddingId,
    });
  }
  if (error instanceof TermsVersionOutdatedError) {
    return new ConflictException({
      statusCode: 409,
      error: 'TERMS_VERSION_OUTDATED',
      message: 'The terms changed; accept the current version.',
    });
  }
  if (error instanceof OwnersFullError) {
    return new ConflictException({
      statusCode: 409,
      error: 'OWNERS_FULL',
      message: 'The wedding already has two owners.',
    });
  }
  if (error instanceof PlannerAlreadyError) {
    return new ConflictException({
      statusCode: 409,
      error: 'PLANNER_ALREADY',
      message: 'The wedding already has a planner.',
    });
  }
  if (error instanceof CoupleInvitationsFullError) {
    return new ConflictException({
      statusCode: 409,
      error: 'COUPLE_INVITATIONS_FULL',
      message: 'The couple already has two pending invitations; cancel one first.',
    });
  }
  if (error instanceof InvitationNotPendingError) {
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_PENDING',
      message: 'The invitation is no longer pending.',
    });
  }
  if (error instanceof InvitationNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'INVITATION_NOT_FOUND',
      message: 'Invitation not found.',
    });
  }
  if (error instanceof InvalidInvitationRecipientsError) {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: ['emails must have one address, or up to two (or none) only for kind couple'],
    });
  }
  if (error instanceof InvitationInvalidError) {
    return new GoneException({
      statusCode: 410,
      error: 'INVITATION_INVALID',
      message: 'Invitation is no longer valid.',
      reason: error.reason,
    });
  }
  if (error instanceof EmailMismatchError) {
    return new ConflictException({
      statusCode: 409,
      error: 'EMAIL_MISMATCH',
      message: 'The invitation was sent to another e-mail.',
    });
  }
  if (error instanceof AlreadyMemberError) {
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_MEMBER',
      message: 'You are already in this wedding.',
    });
  }
  if (error instanceof SellerCannotBePlannerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SELLER_CANNOT_BE_PLANNER',
      message: 'A seller account cannot accept a planner invitation.',
    });
  }
  if (error instanceof InvitationNotDeclinableError) {
    return new ConflictException({
      statusCode: 409,
      error: 'INVITATION_NOT_DECLINABLE',
      message: 'A link without e-mail cannot be declined.',
    });
  }
  if (error instanceof AcceptanceDetailsMissingError) {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: [`${error.field} is required to accept this invitation`],
    });
  }
  if (error instanceof CannotRemoveOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'CANNOT_REMOVE_OWNER',
      message: 'An owner cannot remove the other owner.',
    });
  }
  if (error instanceof LastOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'LAST_OWNER',
      message: 'The last owner cannot leave the wedding.',
    });
  }
  if (error instanceof MembershipNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'MEMBERSHIP_NOT_FOUND',
      message: 'Membership not found.',
    });
  }
  if (error instanceof ProfileNotOwnedError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'PROFILE_NOT_OWNED',
      message: 'This account does not have that profile.',
    });
  }
  if (error instanceof UserBlockedError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'USER_BLOCKED',
      message: 'User is blocked.',
    });
  }
  return error;
}

/** Corpo do verify sem um dos dois jeitos válidos: 400 nativo (decisão 99). */
export function invalidVerifyBody(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: ['send either email and code, or token'],
  });
}
