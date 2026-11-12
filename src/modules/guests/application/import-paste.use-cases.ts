import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { DuplicateGuestError, TooManyGuestsError } from '../domain/guests.errors';
import {
  comparableName,
  findDuplicateGuest,
  IMPORT_GUESTS_MAX,
  parsePastedList,
  pastedGuestCount,
  type PastedList,
} from '../domain/paste-list';
import { guestsDelta } from '../domain/wedding-stats';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_STORE, type NewParty, type PartyStore } from './ports/party-store.port';

/** A prévia da lista colada (Importação RN11): contagens, grupos e linhas que saíram. */
export interface PastePreview extends PastedList {
  parties: number;
  guests: number;
  /** As pessoas sem nome que o app pede ("Faltam nomes"). */
  missingNames: number;
}

/**
 * Colar a lista, prévia (Importação RN10 e RN11): lê o texto e devolve os
 * grupos, sem gravar nada e sem guardar o texto (decisão 184, item 8). O aviso
 * PARTY_NAME_EXISTS compara com os grupos ativos (um grupo na lixeira não conta).
 */
@Injectable()
export class PreviewPastedList {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
  ) {}

  async execute({
    userId,
    weddingId,
    text,
  }: {
    userId: string;
    weddingId: string;
    text: string;
  }): Promise<PastePreview> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const list = parsePastedList({ text });
    const guests = pastedGuestCount(list);
    if (guests > IMPORT_GUESTS_MAX) throw new TooManyGuestsError();

    const existing = new Set(
      (await this.parties.activePartyNames({ weddingId })).map((name) => comparableName(name)),
    );
    for (const group of list.groups)
      if (group.name && existing.has(comparableName(group.name)))
        group.warnings.push('PARTY_NAME_EXISTS');

    return {
      ...list,
      parties: list.groups.length,
      guests,
      missingNames: list.groups.reduce(
        (total, group) => total + group.guests.filter((guest) => guest.name === null).length,
        0,
      ),
    };
  }
}

/**
 * Colar a lista, importar (Importação RN12 e RN14): recebe os grupos como
 * ficaram na prévia, valida de novo e cria tudo numa transação só (todos ou
 * nenhum): grupos novos, convidados pendentes sem telefone, e-mail, faixa
 * etária, tags nem contato, e sem vagas. Atualiza os números do casamento e,
 * depois do commit, grava o evento importacao{metodo: lista}.
 */
@Injectable()
export class ImportPastedList {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async execute({
    userId,
    weddingId,
    groups,
    removedInPreview,
    now,
  }: {
    userId: string;
    weddingId: string;
    groups: readonly { name: string; guests: readonly string[] }[];
    removedInPreview: number;
    now: Date;
  }): Promise<{ parties: number; guests: number }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const guests = groups.reduce((total, group) => total + group.guests.length, 0);
    if (guests > IMPORT_GUESTS_MAX) throw new TooManyGuestsError();
    const duplicate = findDuplicateGuest({ groups });
    if (duplicate)
      throw new DuplicateGuestError({
        path: `groups.${duplicate.group}.guests.${duplicate.guest}`,
      });

    await this.parties.lockStats({ weddingId });
    // Um milissegundo por pessoa: os uuid v7 seguem a ordem do pedido, e a
    // ordem do grupo é joinedPartyAt e id (Grupos RN17).
    let tick = now.getTime();
    const parties: NewParty[] = groups.map((group) => ({
      id: uuidV7({ now: tick++ }),
      weddingId,
      name: group.name,
      internalNote: null,
      linkToken: this.links.newToken(),
      contactGuestId: null,
      guests: group.guests.map((name) => ({
        id: uuidV7({ now: tick++ }),
        name,
        ageGroup: null,
        phone: null,
        email: null,
        isPlusOne: false,
      })),
      tagIds: [],
      now,
    }));
    await this.parties.createMany({ parties });
    await this.parties.applyStats({
      weddingId,
      delta: {
        ...guestsDelta({
          guests: Array.from({ length: guests }, () => ({
            rsvpStatus: 'pending' as const,
            ageGroup: null,
          })),
          sign: 1,
        }),
        partiesPending: parties.length,
      },
    });
    this.afterCommit.schedule(() =>
      this.productEvents.record({
        event: {
          name: 'importacao',
          weddingId,
          props: { metodo: 'lista', linhas_erro: removedInPreview },
        },
        occurredAt: now,
      }),
    );
    return { parties: parties.length, guests };
  }
}
