import { Inject, Injectable } from '@nestjs/common';
import { GuestNotFoundForErasureError } from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';
import { GUEST_ERASURE, type GuestErasure, type RequestChannel } from './ports/guest-erasure.port';

/** Remover a pedido do titular (Backoffice - acesso RN10): Admin e suporte, também no bloqueado. */
@Injectable()
export class EraseGuestOnRequest {
  constructor(@Inject(GUEST_ERASURE) private readonly erasure: GuestErasure) {}

  async execute({
    staff,
    weddingId,
    guestId,
    requestChannel,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    guestId: string;
    requestChannel: RequestChannel;
    now: Date;
  }): Promise<void> {
    const result = await this.erasure.erase({
      weddingId,
      guestId,
      byUserId: staff.userId,
      requestChannel,
      now,
    });
    if (result === 'not_found') throw new GuestNotFoundForErasureError();
  }
}
