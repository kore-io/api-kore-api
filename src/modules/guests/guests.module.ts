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
import { TagsController } from './presentation/tags.controller';
import { TrashController } from './presentation/trash.controller';
import { GuestImportsController } from './presentation/guest-imports.controller';
import { ExportController } from './presentation/export.controller';
import { ExportGuests } from './application/export-guests.use-case';
import { EXPORT_READER, EXPORT_RENDERER } from './application/ports/export-reader.port';
import { PrismaExportReader } from './infrastructure/prisma-export.reader';
import { FileExportRenderer } from './infrastructure/file-export-renderer';
import { ImportPastedList, PreviewPastedList } from './application/import-paste.use-cases';
import {
  ImportSpreadsheet,
  PreviewSpreadsheet,
  SpreadsheetCheckService,
} from './application/import-spreadsheet.use-cases';
import { SPREADSHEET_READER } from './application/ports/spreadsheet-reader.port';
import { ExceljsSpreadsheetReader } from './infrastructure/exceljs-spreadsheet-reader';
import { SpreadsheetUploadGuard } from './presentation/spreadsheet-upload.guard';
import { GuestImportRateLimitGuard } from '../../shared/rate-limit/guest-import-rate-limit.guard';
import { TRASH_STORE } from './application/ports/trash-store.port';
import { PrismaTrashStore } from './infrastructure/prisma-trash.store';
import {
  ListTrash,
  RestoreTrashItem,
  TrashGuest,
  TrashParties,
  TrashParty,
  TrashSupport,
  TrashTag,
} from './application/trash.use-cases';
import { TAG_STORE } from './application/ports/tag-store.port';
import { PrismaTagStore } from './infrastructure/prisma-tag.store';
import { ApplyTag, CreateTag, ListTags, UpdateTag } from './application/tags.use-cases';
import { GROUP_STORE } from './application/ports/group-store.port';
import { PrismaGroupStore } from './infrastructure/prisma-group.store';
import { UpdateParty } from './application/update-party.use-case';
import { MoveGuest } from './application/move-guest.use-case';

/** Contexto Convidados: grupos, convidados, tags, lixeira, importação e exportação. */
@Module({
  imports: [AccessModule],
  controllers: [
    PartiesController,
    GuestsController,
    TagsController,
    TrashController,
    GuestImportsController,
    ExportController,
  ],
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
    { provide: TAG_STORE, useClass: PrismaTagStore },
    ListTags,
    CreateTag,
    UpdateTag,
    ApplyTag,
    { provide: TRASH_STORE, useClass: PrismaTrashStore },
    TrashSupport,
    TrashParty,
    TrashParties,
    TrashGuest,
    TrashTag,
    ListTrash,
    RestoreTrashItem,
    PreviewPastedList,
    ImportPastedList,
    GuestImportRateLimitGuard,
    { provide: SPREADSHEET_READER, useClass: ExceljsSpreadsheetReader },
    SpreadsheetCheckService,
    PreviewSpreadsheet,
    ImportSpreadsheet,
    SpreadsheetUploadGuard,
    { provide: EXPORT_READER, useClass: PrismaExportReader },
    { provide: EXPORT_RENDERER, useClass: FileExportRenderer },
    ExportGuests,
  ],
})
export class GuestsModule {}
