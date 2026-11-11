import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CreateParty } from './application/create-party.use-case';
import { GetParty } from './application/get-party.use-case';
import { ListParties } from './application/list-parties.use-case';
import { PARTY_LINKS } from './application/ports/party-links.port';
import { PARTY_READER } from './application/ports/party-reader.port';
import { PARTY_STORE } from './application/ports/party-store.port';
import { RegeneratePartyLink } from './application/regenerate-party-link.use-case';
import { PrismaPartyReader } from './infrastructure/prisma-party.reader';
import { PrismaPartyStore } from './infrastructure/prisma-party.store';
import { RandomPartyLinks } from './infrastructure/random-party-links';
import { PartiesController } from './presentation/parties.controller';
import { GuestsController } from './presentation/guests.controller';
import { GROUP_STORE } from './application/ports/group-store.port';
import { PrismaGroupStore } from './infrastructure/prisma-group.store';
import { UpdateParty } from './application/update-party.use-case';
import { MoveGuest } from './application/move-guest.use-case';

/** Contexto Convidados: grupos, convidados, tags, lixeira, importação e exportação. */
@Module({
  imports: [AccessModule],
  controllers: [PartiesController, GuestsController],
  providers: [
    { provide: PARTY_STORE, useClass: PrismaPartyStore },
    { provide: PARTY_READER, useClass: PrismaPartyReader },
    { provide: PARTY_LINKS, useClass: RandomPartyLinks },
    CreateParty,
    GetParty,
    ListParties,
    RegeneratePartyLink,
    { provide: GROUP_STORE, useClass: PrismaGroupStore },
    UpdateParty,
    MoveGuest,
  ],
})
export class GuestsModule {}
