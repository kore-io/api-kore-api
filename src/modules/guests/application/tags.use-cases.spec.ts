import type { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { TagLimitReachedError, TagNameTakenError } from '../domain/guests.errors';
import type { TagStore } from './ports/tag-store.port';
import { CreateTag } from './tags.use-cases';

function setup({
  active,
  create = 'created',
}: {
  active: number;
  create?: 'created' | 'name_taken';
}) {
  const calls: string[] = [];
  const store = {
    lockWeddingTags: jest.fn(() => (calls.push('lock'), Promise.resolve())),
    countActive: jest.fn(() => (calls.push('count'), Promise.resolve(active))),
    create: jest.fn(() => (calls.push('create'), Promise.resolve(create))),
    findActive: jest.fn(({ tagId }: { tagId: string }) =>
      Promise.resolve({ id: tagId, name: 'Vizinhos', color: null, guests: 0 }),
    ),
  } as unknown as TagStore;
  const authorization = {
    require: jest.fn().mockResolvedValue('owner'),
  } as unknown as WeddingAuthorization;
  return { useCase: new CreateTag(authorization, store), calls };
}

const input = { userId: 'u', weddingId: 'w', name: 'Vizinhos' };

describe('Criar tag (Tags RN01 e RN02)', () => {
  it('RN01 - o lock do casamento vem antes da contagem: duas criações nunca contam juntas', async () => {
    const { useCase, calls } = setup({ active: 9 });

    await useCase.execute(input);

    expect(calls).toEqual(['lock', 'count', 'create']);
  });

  it('RN01 - com 10 tags ativas, recusa sem gravar', async () => {
    const { useCase, calls } = setup({ active: 10 });

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(TagLimitReachedError);
    expect(calls).toEqual(['lock', 'count']);
  });

  it('RN02 - nome que bate no índice único é TAG_NAME_TAKEN', async () => {
    const { useCase } = setup({ active: 3, create: 'name_taken' });

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(TagNameTakenError);
  });
});
