import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ACCESS_IP_LOG_WRITER,
  type AccessIpLogWriter,
} from '../../src/modules/logs/application/ports/access-ip-log-writer.port';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../src/modules/logs/application/ports/application-log-writer.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';

describe('Log da aplicação e log de IP real (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let backoffice: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    backoffice = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('log da aplicação', () => {
    it('dado um registro com IP, quando grava, então guarda só o hash do IP', async () => {
      const entityId = randomUUID();

      await app.get<ApplicationLogWriter>(APPLICATION_LOG_WRITER).record({
        entry: {
          action: 'membership.removed',
          actorKind: 'user',
          actorUserId: randomUUID(),
          weddingId: randomUUID(),
          entityType: 'membership',
          entityId,
          data: { reason: 'teste' },
          ip: '200.1.2.3',
        },
      });

      const [row] = await backoffice.applicationLog.findMany({ where: { entityId } });
      expect(row).toMatchObject({ action: 'membership.removed', data: { reason: 'teste' } });
      expect(row.ipHash).toEqual(expect.any(String));
      expect(row.ipHash).not.toContain('200.1.2.3');
    });

    it('dado o mesmo IP duas vezes, quando grava, então o hash é igual (permite limitar abuso)', async () => {
      const writer = app.get<ApplicationLogWriter>(APPLICATION_LOG_WRITER);
      const ids = [randomUUID(), randomUUID()];
      for (const entityId of ids) {
        await writer.record({
          entry: { action: 'teste.hash', actorKind: 'system', entityId, ip: '200.1.2.3' },
        });
      }

      const rows = await backoffice.applicationLog.findMany({ where: { entityId: { in: ids } } });
      expect(new Set(rows.map((row) => row.ipHash)).size).toBe(1);
    });

    it('dado um ator user sem actorUserId, quando grava, então o banco recusa', async () => {
      await expect(
        app.get<ApplicationLogWriter>(APPLICATION_LOG_WRITER).record({
          entry: { action: 'teste.sem_ator', actorKind: 'user' },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['ler', () => prisma.$queryRaw`SELECT * FROM application_logs LIMIT 1`],
      ['alterar', () => prisma.$executeRaw`UPDATE application_logs SET action = 'x'`],
      ['apagar', () => prisma.$executeRaw`DELETE FROM application_logs`],
    ])(
      'dada a API, quando tenta %s o log da aplicação, então o banco nega (só inserção)',
      async (_, run) => {
        await expect(run()).rejects.toThrow(/permission denied/);
      },
    );
  });

  describe('log de IP real (decisão 116)', () => {
    it('dado um acesso, quando grava, então guarda o IP real', async () => {
      const actorUserId = randomUUID();

      await app.get<AccessIpLogWriter>(ACCESS_IP_LOG_WRITER).record({
        entry: {
          action: 'login',
          ip: '200.1.2.3',
          occurredAt: new Date(),
          actorKind: 'user',
          actorUserId,
        },
      });

      const [row] = await backoffice.accessIpLog.findMany({ where: { actorUserId } });
      expect(row).toMatchObject({ action: 'login', ip: '200.1.2.3', actorKind: 'user' });
    });

    it('dado um acesso de grupo sem partyId, quando grava, então o banco recusa', async () => {
      await expect(
        app.get<AccessIpLogWriter>(ACCESS_IP_LOG_WRITER).record({
          entry: {
            action: 'rsvp.answered',
            ip: '200.1.2.3',
            occurredAt: new Date(),
            actorKind: 'party',
          },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['ler', () => prisma.$queryRaw`SELECT * FROM access_ip_logs LIMIT 1`],
      ['alterar', () => prisma.$executeRaw`UPDATE access_ip_logs SET action = 'x'`],
      ['apagar', () => prisma.$executeRaw`DELETE FROM access_ip_logs`],
    ])(
      'dada a API, quando tenta %s o log de IP real, então o banco nega (só inserção)',
      async (_, run) => {
        await expect(run()).rejects.toThrow(/permission denied/);
      },
    );
  });
});
