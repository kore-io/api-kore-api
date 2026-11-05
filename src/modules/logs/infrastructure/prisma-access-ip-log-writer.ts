import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { AccessIpLogWriter } from '../application/ports/access-ip-log-writer.port';
import type { AccessIpLogEntry } from '../domain/log-entries';

@Injectable()
export class PrismaAccessIpLogWriter implements AccessIpLogWriter {
  constructor(private readonly prisma: PrismaService) {}

  async record({ entry }: { entry: AccessIpLogEntry }): Promise<void> {
    // createMany não usa RETURNING: a API só tem INSERT nesta tabela (só inserção).
    await this.prisma.accessIpLog.createMany({ data: [entry] });
  }
}
