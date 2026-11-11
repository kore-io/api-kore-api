import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  GuestFieldsInvalidError,
  TagLimitReachedError,
  TagNameTakenError,
  TagNotFoundError,
  type FieldIssue,
} from '../domain/guests.errors';
import { TAGS_PER_WEDDING_MAX, type TagColor } from '../domain/party';
import { TAG_STORE, type TagRow, type TagStore } from './ports/tag-store.port';

/** Tela Tags, escolha no Novo grupo e filtro da lista (Tags RN04, RN05). */
@Injectable()
export class ListTags {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<{ limit: number; data: TagRow[] }> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    return { limit: TAGS_PER_WEDDING_MAX, data: await this.tags.listActive({ weddingId }) };
  }
}

/**
 * Criar tag (Tags RN01 a RN03): até 10 ativas por casamento, checado na
 * transação com o lock do casamento (invariante 11); nome único entre as
 * ativas, sem diferenciar maiúsculas; nasce sem cor quando não vem cor.
 */
@Injectable()
export class CreateTag {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
    name,
    color = null,
  }: {
    userId: string;
    weddingId: string;
    name: string;
    color?: TagColor | null;
  }): Promise<TagRow> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    await this.tags.lockWeddingTags({ weddingId });
    if ((await this.tags.countActive({ weddingId })) >= TAGS_PER_WEDDING_MAX)
      throw new TagLimitReachedError();
    const id = uuidV7();
    if ((await this.tags.create({ id, weddingId, name, color })) === 'name_taken')
      throw new TagNameTakenError();
    const tag = await this.tags.findActive({ weddingId, tagId: id });
    if (!tag) throw new TagNotFoundError();
    return tag;
  }
}

/** Editar tag: renomear (RN02) e trocar a cor (RN03). Excluir é a lixeira. */
@Injectable()
export class UpdateTag {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
    tagId,
    name,
    color,
  }: {
    userId: string;
    weddingId: string;
    tagId: string;
    name?: string;
    color?: TagColor | null;
  }): Promise<TagRow> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const result = await this.tags.update({ weddingId, tagId, name, color });
    if (result === 'not_found') throw new TagNotFoundError();
    if (result === 'name_taken') throw new TagNameTakenError();
    const tag = await this.tags.findActive({ weddingId, tagId });
    if (!tag) throw new TagNotFoundError();
    return tag;
  }
}

/**
 * Seleção múltipla, Adicionar tag (Tags RN08): a tag em todos os grupos
 * marcados, numa gravação só; quem já tinha fica como está. Um id que não é de
 * grupo ativo do casamento recusa o pedido inteiro. Só grupos (186(14)).
 */
@Injectable()
export class ApplyTag {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
    tagId,
    partyIds,
  }: {
    userId: string;
    weddingId: string;
    tagId: string;
    partyIds: readonly string[];
  }): Promise<{ parties: number }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    if (!(await this.tags.findActive({ weddingId, tagId }))) throw new TagNotFoundError();

    const unique = [...new Set(partyIds)];
    const active = new Set(await this.tags.findActivePartyIds({ weddingId, partyIds: unique }));
    const issues: FieldIssue[] = [];
    partyIds.forEach((partyId, index) => {
      if (!active.has(partyId))
        issues.push({ path: `partyIds.${index}`, code: 'PARTY_NOT_FOUND', params: {} });
    });
    if (issues.length > 0) throw new GuestFieldsInvalidError({ issues });

    await this.tags.applyToParties({ weddingId, tagId, partyIds: unique });
    return { parties: unique.length };
  }
}
