import { WeddingActionForbiddenError, WeddingHasOwnerError } from '../domain/access.errors';
import { DeleteWeddingByCreator } from './delete-wedding-by-creator.use-case';
import type {
  CreatorWeddingDeleter,
  CreatorWeddingDeletion,
} from './ports/creator-wedding-deletion.port';
import type { WeddingScope } from './wedding-scope.service';

const now = new Date('2026-11-12T15:00:00Z');

function setup({ deletion }: { deletion: CreatorWeddingDeletion }) {
  const calls: string[] = [];
  const scope = {
    run: jest.fn(() => {
      calls.push('scope');
      return Promise.resolve();
    }),
  } as unknown as WeddingScope;
  const deleter = {
    deleteByCreator: jest.fn(() => {
      calls.push('delete');
      return Promise.resolve(deletion);
    }),
    deleteImageObjects: jest.fn(() => {
      calls.push('images');
      return Promise.resolve();
    }),
  } satisfies CreatorWeddingDeleter;
  return { useCase: new DeleteWeddingByCreator(scope, deleter), deleter, calls };
}

describe('DeleteWeddingByCreator (DELETE /v1/weddings/{weddingId})', () => {
  it('RN11 - autoriza sob a RLS, exclui pelo backoffice e só depois apaga os arquivos', async () => {
    const { useCase, deleter, calls } = setup({
      deletion: { result: 'deleted', status: 'draft', imageKeyTokens: ['img'] },
    });

    await useCase.execute({ userId: 'u-j', weddingId: 'w1', now });

    expect(calls).toEqual(['scope', 'delete', 'images']);
    expect(deleter.deleteImageObjects).toHaveBeenCalledWith({ imageKeyTokens: ['img'] });
  });

  it('RN11 - com dono: WEDDING_HAS_OWNER; quem não criou: ACTION_NOT_ALLOWED; nenhum arquivo sai', async () => {
    const hasOwner = setup({ deletion: { result: 'has_owner' } });
    await expect(hasOwner.useCase.execute({ userId: 'u-j', weddingId: 'w1', now })).rejects.toThrow(
      WeddingHasOwnerError,
    );
    const notAllowed = setup({ deletion: { result: 'not_allowed' } });
    await expect(
      notAllowed.useCase.execute({ userId: 'u-j', weddingId: 'w1', now }),
    ).rejects.toThrow(WeddingActionForbiddenError);
    expect(hasOwner.deleter.deleteImageObjects).not.toHaveBeenCalled();
    expect(notAllowed.deleter.deleteImageObjects).not.toHaveBeenCalled();
  });
});
