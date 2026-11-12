import type { AppConfigService } from '../../../shared/config/app-config.service';
import type { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { SiteSlugMissingError } from '../domain/site.errors';
import type { SitePreviewStore } from './ports/site-preview-store.port';
import { CreateSitePreview } from './site-preview.use-cases';

/**
 * O casamento sem endereço (Pré-visualização RN01). No banco, o endereço só é
 * nulo num casamento expurgado (chk_weddings_tombstone), que não tem vínculo e
 * dá 404 antes; a regra fica provada aqui.
 */
describe('CreateSitePreview (Pré-visualização do site RN01)', () => {
  it('RN01 - sem endereço: 409 SITE_SLUG_MISSING, sem gravar token', async () => {
    const store = {
      slugOf: jest.fn(() => Promise.resolve(null)),
      activeParty: jest.fn(),
      createToken: jest.fn(),
    } as unknown as SitePreviewStore;
    const authorization = {
      require: jest.fn(() => Promise.resolve('owner')),
    } as unknown as WeddingAuthorization;
    const config = { get: () => 'http://localhost:5174' } as unknown as AppConfigService;
    const preview = new CreateSitePreview(authorization, store, config);

    await expect(
      preview.execute({
        userId: 'ana',
        weddingId: 'w1',
        mode: 'visitor',
        partyId: null,
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(SiteSlugMissingError);
    expect(store.createToken).not.toHaveBeenCalled();
  });
});
