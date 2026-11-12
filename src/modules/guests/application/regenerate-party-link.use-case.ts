import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { PartyNotFoundError } from '../domain/guests.errors';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_READER, type PartyReader } from './ports/party-reader.port';
import { PARTY_STORE, type PartyStore } from './ports/party-store.port';

/**
 * Regenerar link (Grupos RN12): token novo, versão acima e linkRegeneratedAt,
 * para o link antigo parar na hora. O log vai na mesma transação, só com o id
 * do grupo (decisões 179 e 186, item 6). Qualquer vínculo (manage_guests).
 */
@Injectable()
export class RegeneratePartyLink {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_STORE) private readonly store: PartyStore,
    @Inject(PARTY_READER) private readonly reader: PartyReader,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async execute({
    userId,
    weddingId,
    partyId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyId: string;
    ip: string | null;
    now: Date;
  }): Promise<{ url: string | null; regeneratedAt: Date }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const regenerated = await this.store.regenerateLink({
      weddingId,
      partyId,
      linkToken: this.links.newToken(),
      now,
    });
    if (!regenerated) throw new PartyNotFoundError();

    await this.log.record({
      entry: {
        action: 'party.link_regenerated',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'party',
        entityId: partyId,
        ...(ip ? { ip } : {}),
      },
    });
    const slug = await this.reader.weddingSlug({ weddingId });
    return {
      url: this.links.url({ slug, token: regenerated.linkToken }),
      regeneratedAt: regenerated.regeneratedAt,
    };
  }
}
