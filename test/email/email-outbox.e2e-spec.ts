import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../src/shared/email/application/email-outbox.port';
import {
  DEFAULT_EMAIL_QUEUE,
  LOGIN_EMAIL_QUEUE,
} from '../../src/shared/email/infrastructure/email-queues';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';

const message = (to: string) => ({ to, subject: 'Teste da fila', text: 'Corpo' });

describe('Fila de e-mails (ADR do SES; decisão 139)', () => {
  describe('com o worker no ar', () => {
    let app: INestApplication;
    let worker: TestingModule;

    beforeAll(async () => {
      app = await createTestApp();
      worker = await createTestWorker();
    });

    afterAll(async () => {
      await worker?.close();
      await app?.close();
    });

    it.each(['login', 'default'] as const)(
      'dado um e-mail na fila %s, quando o worker processa, então o Mailpit recebe',
      async (priority) => {
        const to = `fila.${randomUUID()}@kore.local`;

        await app.get<EmailOutbox>(EMAIL_OUTBOX).enqueue({ message: message(to), priority });

        const [received] = await waitForInbox({ to });
        expect(received.Subject).toBe('Teste da fila');
      },
    );
  });

  describe('conexão produtora da API', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    it.each([LOGIN_EMAIL_QUEUE, DEFAULT_EMAIL_QUEUE])(
      'dada a fila %s na API, quando o Redis cai, então o add não fica guardado para sair depois (código vencido)',
      (name) => {
        const queue = app.get<Queue>(getQueueToken(name));

        expect(queue.opts.connection).toMatchObject({ enableOfflineQueue: false });
      },
    );
  });

  describe('com o Redis fora do ar', () => {
    let app: INestApplication;
    const refused = () => Promise.reject(new Error('Connection is closed.'));
    const offlineQueue = { add: refused, close: () => Promise.resolve(), on: () => undefined };

    beforeAll(async () => {
      app = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(getQueueToken(LOGIN_EMAIL_QUEUE))
            .useValue(offlineQueue)
            .overrideProvider(getQueueToken(DEFAULT_EMAIL_QUEUE))
            .useValue(offlineQueue),
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('dado o Redis fora, quando enfileira o código de login, então envia direto e o e-mail chega', async () => {
      const to = `direto.${randomUUID()}@kore.local`;

      await app.get<EmailOutbox>(EMAIL_OUTBOX).enqueue({ message: message(to), priority: 'login' });

      expect(await waitForInbox({ to })).toHaveLength(1);
    });
  });
});
