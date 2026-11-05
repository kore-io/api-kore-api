import { CheckSlugAvailability } from './check-slug-availability.use-case';
import type { SlugRegistry } from './ports/slug-registry.port';
import { SuggestSlug } from './suggest-slug.service';

function checkWith({ taken }: { taken: string[] }) {
  const registry: SlugRegistry = { isTaken: ({ slug }) => Promise.resolve(taken.includes(slug)) };
  return new CheckSlugAvailability(registry, new SuggestSlug(registry));
}

const eventDate = new Date('2026-11-14T00:00:00Z');

describe('CheckSlugAvailability (GET /v1/weddings/slug-availability)', () => {
  it('RN05 - dado um endereço livre, então está disponível', async () => {
    await expect(
      checkWith({ taken: [] }).execute({ slug: 'ana-e-marcos', eventDate }),
    ).resolves.toEqual({
      slug: 'ana-e-marcos',
      available: true,
      reason: null,
      suggestion: null,
    });
  });

  it('RN05 - dado um endereço em uso, então sugere com o ano da data', async () => {
    await expect(
      checkWith({ taken: ['ana-e-marcos'] }).execute({ slug: 'ana-e-marcos', eventDate }),
    ).resolves.toEqual({
      slug: 'ana-e-marcos',
      available: false,
      reason: 'taken',
      suggestion: 'ana-e-marcos-2026',
    });
  });

  it('RN05 - dado o endereço com o ano também em uso, então sugere com número', async () => {
    const result = await checkWith({ taken: ['ana-e-marcos', 'ana-e-marcos-2026'] }).execute({
      slug: 'ana-e-marcos',
      eventDate,
    });

    expect(result.suggestion).toBe('ana-e-marcos-2');
  });

  it('RN05 - dada uma palavra reservada, então reason reserved, com sugestão', async () => {
    const result = await checkWith({ taken: [] }).execute({ slug: 'entrar', eventDate: null });

    expect(result).toEqual({
      slug: 'entrar',
      available: false,
      reason: 'reserved',
      suggestion: 'entrar-2',
    });
  });

  it('RN04 - dado um formato inválido, então invalid_format, sem sugestão', async () => {
    const result = await checkWith({ taken: [] }).execute({ slug: '-ana--e-marcos', eventDate });

    expect(result).toEqual({
      slug: '-ana--e-marcos',
      available: false,
      reason: 'invalid_format',
      suggestion: null,
    });
  });
});
