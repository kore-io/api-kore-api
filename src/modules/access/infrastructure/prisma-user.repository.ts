import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { UserProfile, UserRepository } from '../application/ports/user-repository.port';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfileById({ userId }: { userId: string }): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, platformRole: true },
    });
  }
}
