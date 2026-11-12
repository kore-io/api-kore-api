import type { AppConfigService } from '../../../shared/config/app-config.service';
import type { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  CourtesyDisabledError,
  EventDateMissingError,
  NotDraftError,
  SiteSlugMissingError,
} from '../domain/site.errors';
import type { PublicationStore, PublicationTarget } from './ports/publication-store.port';
import { PublishWedding } from './publish-wedding.use-case';

const DRAFT: PublicationTarget = {
  status: 'draft',
  slug: 'ana-e-marcos',
  eventDate: '2026-11-14',
  timezone: 'America/Sao_Paulo',
  publishedAt: null,
};

function useCase({
  target,
  enabled = true,
}: {
  target: PublicationTarget | null;
  enabled?: boolean;
}) {
  const store: jest.Mocked<PublicationStore> = {
    lock: jest.fn().mockResolvedValue(target),
    publishByCourtesy: jest.fn().mockResolvedValue(undefined),
    notifyPublished: jest.fn().mockResolvedValue([]),
  };
  const publish = new PublishWedding(
    { require: jest.fn().mockResolvedValue(undefined) } as unknown as WeddingAuthorization,
    { get: jest.fn().mockReturnValue(enabled) } as unknown as AppConfigService,
    store,
    { record: jest.fn().mockResolvedValue(undefined) },
    { record: jest.fn().mockResolvedValue(undefined) },
    { schedule: jest.fn() },
  );
  const run = () =>
    publish.execute({
      userId: 'ana',
      weddingId: 'w1',
      endDate: '2027-02-14',
      ip: null,
      now: new Date('2026-09-01T12:00:00Z'),
    });
  return { store, run };
}

describe('PublishWedding (Publicação por Cortesia)', () => {
  it('RN01 - com a chave desligada, recusa antes de travar o casamento', async () => {
    const { store, run } = useCase({ target: DRAFT, enabled: false });
    await expect(run()).rejects.toBeInstanceOf(CourtesyDisabledError);
    expect(store.lock).not.toHaveBeenCalled();
  });

  it('RN03 - só de rascunho', async () => {
    for (const status of ['awaiting_couple', 'published', 'post_event'])
      await expect(useCase({ target: { ...DRAFT, status } }).run()).rejects.toBeInstanceOf(
        NotDraftError,
      );
  });

  it('RN03 - sem endereço: SITE_SLUG_MISSING', async () => {
    await expect(useCase({ target: { ...DRAFT, slug: null } }).run()).rejects.toBeInstanceOf(
      SiteSlugMissingError,
    );
  });

  it('RN04 - sem data ou sem fuso: EVENT_DATE_MISSING, e nada é gravado', async () => {
    for (const target of [
      { ...DRAFT, eventDate: null },
      { ...DRAFT, timezone: null },
    ]) {
      const { store, run } = useCase({ target });
      await expect(run()).rejects.toBeInstanceOf(EventDateMissingError);
      expect(store.publishByCourtesy).not.toHaveBeenCalled();
    }
  });

  it('RN05 - grava a publicação por Cortesia de quem pediu', async () => {
    const { store, run } = useCase({ target: DRAFT });
    await expect(run()).resolves.toMatchObject({
      endDate: '2027-02-14',
      publicationSource: 'courtesy',
    });
    expect(store.publishByCourtesy).toHaveBeenCalledWith(
      expect.objectContaining({ weddingId: 'w1', endDate: '2027-02-14', userId: 'ana' }),
    );
  });

  it('Notificações da cerimonialista RN03 - o aviso wedding_published só na primeira publicação', async () => {
    const first = useCase({ target: DRAFT });
    await first.run();
    expect(first.store.notifyPublished).toHaveBeenCalledTimes(1);

    const again = useCase({ target: { ...DRAFT, publishedAt: new Date('2026-08-01T00:00:00Z') } });
    await again.run();
    expect(again.store.notifyPublished).not.toHaveBeenCalled();
  });
});
