import { ReauthRequiredError } from '../domain/recent-session';
import { ContrastTooLowError } from '../../site/domain/site.errors';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
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
  WeddingHasNoOwnerError,
  SelfReferralError,
  SelfInvitationError,
  OwnerlessWeddingsLimitError,
  WeddingHasOwnerError,
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
  PlannerSignupDisabledError,
  PlannerProfileExistsError,
  PlannerNotFoundError,
  PlannerProfileInvalidError,
  SessionExpiredError,
  UserBlockedError,
  WeddingActionForbiddenError,
  WeddingBlockedError,
  WeddingDeletionScheduledError,
  WeddingNotFoundError,
} from '../domain/access.errors';
import { validationError } from '../../../shared/http/validation-errors';

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
  if (error instanceof WeddingBlockedError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'WEDDING_BLOCKED',
      message: 'The wedding is blocked.',
    });
  }
  if (error instanceof WeddingDeletionScheduledError) {
    return new ConflictException({
      statusCode: 409,
      error: 'WEDDING_DELETION_SCHEDULED',
      message: 'The wedding deletion is scheduled.',
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
  // A aparência do simulador no cadastro (Simule RN10): o mesmo 422 do Editor.
  if (error instanceof ContrastTooLowError) {
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'CONTRAST_TOO_LOW',
      message: 'The color does not reach the minimum contrast.',
      check: error.check,
      ratio: error.ratio,
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
  if (error instanceof PlannerSignupDisabledError) {
    return new ConflictException({
      statusCode: 409,
      error: 'PLANNER_SIGNUP_DISABLED',
      message: 'The planner signup is not open yet.',
    });
  }
  if (error instanceof PlannerProfileExistsError) {
    return new ConflictException({
      statusCode: 409,
      error: 'PLANNER_PROFILE_EXISTS',
      message: 'This account already has the planner profile.',
    });
  }
  if (error instanceof PlannerNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'PLANNER_NOT_FOUND',
      message: 'This account has no planner profile.',
    });
  }
  if (error instanceof PlannerProfileInvalidError) {
    return validationError({ errors: error.issues });
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
    // Mais de um e-mail fora do tipo couple: o mesmo código que o
    // @ArrayMaxSize daria (decisão 190).
    return validationError({
      errors: [{ path: 'emails', code: 'ARRAY_MAX_SIZE', params: { max: 1 } }],
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
    return validationError({
      errors: [{ path: error.field, code: 'IS_NOT_EMPTY', params: {} }],
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
  if (error instanceof WeddingHasNoOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'WEDDING_HAS_NO_OWNER',
      message: 'The wedding has no owner yet; delete it instead of leaving.',
    });
  }
  if (error instanceof WeddingHasOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'WEDDING_HAS_OWNER',
      message: 'The couple has already accepted; the wedding cannot be deleted.',
    });
  }
  if (error instanceof OwnerlessWeddingsLimitError) {
    return new ConflictException({
      statusCode: 409,
      error: 'OWNERLESS_WEDDINGS_LIMIT',
      message: 'Too many weddings still without the couple.',
    });
  }
  if (error instanceof SelfInvitationError) {
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'SELF_INVITATION',
      message: 'This is the e-mail of your account; use the couple e-mail.',
    });
  }
  if (error instanceof SelfReferralError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SELF_REFERRAL',
      message: 'The referrer of this wedding cannot accept its couple invitation.',
    });
  }
  if (error instanceof MembershipNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'MEMBERSHIP_NOT_FOUND',
      message: 'Membership not found.',
    });
  }
  if (error instanceof ReauthRequiredError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'REAUTH_REQUIRED',
      message: 'Sign in again to continue.',
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
  // A falha é do corpo inteiro, não de um campo: path vazio (decisão 190).
  return validationError({
    errors: [{ path: '', code: 'EMAIL_AND_CODE_OR_TOKEN', params: {} }],
    message: ['send either email and code, or token'],
  });
}
