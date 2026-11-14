import { Inject, Injectable } from '@nestjs/common';
import { IpHasher } from '../../logs/infrastructure/ip-hasher';
import { GuestNotFoundForErasureError } from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';
import { GUEST_ERASURE, type GuestErasure, type RequestChannel } from './ports/guest-erasure.port';

/** Remover a pedido do titular (Backoffice - acesso RN10): Admin e suporte, também no bloqueado. */
@Injectable()
export class EraseGuestOnRequest {
  constructor(
    @Inject(GUEST_ERASURE) private readonly erasure: GuestErasure,
    private readonly ipHasher: IpHasher,
  ) {}

  async execute({
    staff,
    weddingId,
    guestId,
    requestChannel,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    guestId: string;
    requestChannel: RequestChannel;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const result = await this.erasure.erase({
      weddingId,
      guestId,
      byUserId: staff.userId,
      requestChannel,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    if (result === 'not_found') throw new GuestNotFoundForErasureError();
  }
}
