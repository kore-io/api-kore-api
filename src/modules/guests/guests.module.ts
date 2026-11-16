import { Module } from '@nestjs/common';
import { AccessModule } from '@/modules/access/access.module';
import { CreateParty } from './application/create-party.use-case';
import { GetParty } from './application/get-party.use-case';
import { ListParties } from './application/list-parties.use-case';
import { PARTY_LINKS } from './application/ports/party-links.port';
import { PARTY_READER } from './application/ports/party-reader.port';
import { PARTY_STORE } from './application/ports/party-store.port';
import { RegeneratePartyLink } from './application/regenerate-party-link.use-case';
import { PrismaPartyReader } from './infrastructure/persistence/prisma-party.reader';
import { PrismaPartyStore } from './infrastructure/persistence/prisma-party.store';
import { RandomPartyLinks } from './infrastructure/providers/random-party-links';
import { PartiesController } from './presentation/controllers/parties.controller';
import { GuestsController } from './presentation/controllers/guests.controller';
import { TagsController } from './presentation/controllers/tags.controller';
import { TrashController } from './presentation/controllers/trash.controller';
import { GuestImportsController } from './presentation/controllers/guest-imports.controller';
import { ExportController } from './presentation/controllers/export.controller';
import { ExportGuests } from './application/export-guests.use-case';
import { EXPORT_READER, EXPORT_RENDERER } from './application/ports/export-reader.port';
import { PrismaExportReader } from './infrastructure/persistence/prisma-export.reader';
import { FileExportRenderer } from './infrastructure/providers/file-export-renderer';
import { ImportPastedList, PreviewPastedList } from './application/import-paste.use-cases';
import {
  ImportSpreadsheet,
  PreviewSpreadsheet,
  SpreadsheetCheckService,
} from './application/import-spreadsheet.use-cases';
import { SPREADSHEET_READER } from './application/ports/spreadsheet-reader.port';
import { ExceljsSpreadsheetReader } from './infrastructure/providers/exceljs-spreadsheet-reader';
import { SpreadsheetUploadGuard } from './presentation/http/guards/spreadsheet-upload.guard';
import { GuestImportRateLimitGuard } from '@/shared/rate-limit/user-rate-limit.guard';
import { TRASH_STORE } from './application/ports/trash-store.port';
import { PrismaTrashStore } from './infrastructure/persistence/prisma-trash.store';
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
import { PrismaTagStore } from './infrastructure/persistence/prisma-tag.store';
import { ApplyTag, CreateTag, ListTags, UpdateTag } from './application/tags.use-cases';
import { GROUP_STORE } from './application/ports/group-store.port';
import { PrismaGroupStore } from './infrastructure/persistence/prisma-group.store';
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
