import { AdminInsights, OVERVIEW_CACHE_MS } from './admin-insights.use-cases';
import type { AdminInsightsReader, AdminOverview } from './ports/admin-insights.reader.port';

const overview = (weddingsCreated: number): AdminOverview => ({
  month: '2026-11',
  weddingsCreated,
  weddingsPublished: 0,
  activationPercent: null,
  plannersActive: 0,
  plannersNew: 0,
  rsvpAveragePercent: null,
  openAlerts: 0,
  charts: { created: [], published: [] },
});

describe('AdminInsights (Backoffice - acesso RN04 e RN12)', () => {
  it('RN04 - a Visão geral fica guardada 5 minutos, por papel', async () => {
    const reader = {
      overview: jest.fn().mockResolvedValueOnce(overview(1)).mockResolvedValue(overview(2)),
    } as unknown as jest.Mocked<AdminInsightsReader>;
    const insights = new AdminInsights(reader, { record: jest.fn() }, { hash: jest.fn() });
    const admin = { userId: 'a', role: 'admin' as const };
    const now = new Date('2026-11-14T12:00:00Z');

    expect((await insights.overview({ staff: admin, now })).weddingsCreated).toBe(1);
    const later = new Date(now.getTime() + OVERVIEW_CACHE_MS - 1);
    expect((await insights.overview({ staff: admin, now: later })).weddingsCreated).toBe(1);
    const expired = new Date(now.getTime() + OVERVIEW_CACHE_MS);
    expect((await insights.overview({ staff: admin, now: expired })).weddingsCreated).toBe(2);
    // O suporte tem a sua entrada (a dele não traz o dinheiro).
    await insights.overview({ staff: { userId: 's', role: 'support' }, now });
    expect(reader.overview).toHaveBeenLastCalledWith({ role: 'support', now });
  });

  it('RN12 e RN02 - o suporte lista e resolve só os alertas que não são de dinheiro', async () => {
    const reader = {
      alerts: jest
        .fn()
        .mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0, openCount: 0 }),
    } as unknown as jest.Mocked<AdminInsightsReader>;
    const insights = new AdminInsights(reader, { record: jest.fn() }, { hash: jest.fn() });
    await insights.alerts({ staff: { userId: 's', role: 'support' }, status: 'open', page: 1 });
    expect(reader.alerts).toHaveBeenCalledWith({
      status: 'open',
      page: 1,
      types: ['login_abuse', 'photo_flood', 'purge_failed', 'access_email_changed'],
    });
  });
});
