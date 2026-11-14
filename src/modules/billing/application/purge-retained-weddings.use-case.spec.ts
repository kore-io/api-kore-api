import type { BillingMailer } from './ports/billing-mailer.port';
import type { RetentionCandidate, WeddingRetentionStore } from './ports/wedding-retention.port';
import { PurgeRetainedWeddings } from './purge-retained-weddings.use-case';

const now = new Date('2027-08-23T15:00:00Z');
const candidate = (weddingId: string, timezone: string | null): RetentionCandidate => ({
  weddingId,
  status: 'expired',
  timezone,
  purgeAt: '2027-08-22',
  expiredAt: '2027-02-22',
  deletionScheduledFor: null,
  purgeNoticeSentAt: new Date('2027-07-23T15:00:00Z'),
  blocked: false,
});

function setup(candidates: RetentionCandidate[]) {
  const store = {
    listCandidates: jest.fn().mockResolvedValue(candidates),
    markNotice: jest.fn(),
    clearNotice: jest.fn().mockResolvedValue(true),
    purge: jest.fn().mockResolvedValue(true),
    openPurgeFailedAlert: jest.fn().mockResolvedValue(undefined),
  } satisfies WeddingRetentionStore;
  const mailer = { purgeSoon: jest.fn() } as unknown as jest.Mocked<BillingMailer>;
  return { store, mailer, useCase: new PurgeRetainedWeddings(store, mailer) };
}

describe('PurgeRetainedWeddings (Retenção e expurgo RN02 a RN04)', () => {
  it('RN04 - um fuso inválido pula o casamento com o Alert purge_failed, e o outro é expurgado', async () => {
    const { store, useCase } = setup([candidate('a', 'Mars/Olympus'), candidate('b', null)]);
    expect(await useCase.execute({ now })).toEqual({ notices: 0, purged: 1, failed: 1 });
    expect(store.openPurgeFailedAlert).toHaveBeenCalledWith({
      weddingId: 'a',
      error: 'RangeError',
    });
    expect(store.purge).toHaveBeenCalledWith({
      weddingId: 'b',
      reason: 'retention',
      seenDeletionScheduledFor: null,
      now,
    });
  });

  it('RN02 - o e-mail do aviso não entra na fila: a marca é desfeita e o aviso não conta', async () => {
    const { store, mailer, useCase } = setup([
      { ...candidate('a', 'America/Sao_Paulo'), purgeNoticeSentAt: null },
    ]);
    store.markNotice.mockResolvedValue({
      recipients: [{ userId: 'u', email: 'ana@example.com', firstName: 'Ana' }],
      partnerNames: ['Ana', 'Marcos'],
    });
    mailer.purgeSoon.mockRejectedValue(new Error('fila fora'));
    // O aviso atrasado (23/08, purgeAt 22/08) promete 30 dias depois do aviso.
    store.markNotice.mockImplementation((input) => {
      expect(input).toMatchObject({ purgeAt: '2027-08-22', promisedDay: '2027-09-22' });
      return Promise.resolve({
        recipients: [{ userId: 'u', email: 'ana@example.com', firstName: 'Ana' }],
        partnerNames: ['Ana', 'Marcos'] as [string, string],
      });
    });
    expect(await useCase.execute({ now })).toEqual({ notices: 0, purged: 0, failed: 0 });
    expect(store.clearNotice).toHaveBeenCalledWith({ weddingId: 'a', noticeSentAt: now, now });
    expect(store.openPurgeFailedAlert).not.toHaveBeenCalled();
  });
});
