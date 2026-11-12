import { Inject, Injectable } from '@nestjs/common';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';
import type { MyWeddingStatus } from '../domain/my-weddings';
import {
  REFERRED_WEDDINGS_READER,
  type ReferredWeddingsReader,
} from './ports/referred-weddings-reader.port';

export interface ReferredWeddingView {
  /** Nulo quando a linha não é clicável: a API não expõe o id de um casamento em que ela não entra (RN05). */
  weddingId: string | null;
  partnerNames: [string, string];
  status: MyWeddingStatus;
  createdAt: Date;
  clickable: boolean;
}

/**
 * Casais que vieram pelo seu link (GET /v1/me/referrer/weddings; Link de
 * indicação RN03 a RN05): só nomes e status, do mais recente para o mais
 * antigo. Sem convidados, contatos, endereço nem data (decisões 15 e 116), e
 * sem comissão até a F3.
 */
@Injectable()
export class ListReferredWeddings {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(REFERRED_WEDDINGS_READER) private readonly reader: ReferredWeddingsReader,
  ) {}

  async execute({ userId }: { userId: string }): Promise<ReferredWeddingView[]> {
    if (!(await this.profiles.findOwn({ userId }))) throw new ProfileNotOwnedError();
    return (await this.reader.list()).map((row) => ({
      weddingId: row.clickable ? row.weddingId : null,
      partnerNames: row.partnerNames,
      status: row.status,
      createdAt: row.createdAt,
      clickable: row.clickable,
    }));
  }
}
