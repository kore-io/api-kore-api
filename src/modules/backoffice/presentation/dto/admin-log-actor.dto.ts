import { ApiProperty } from '@nestjs/swagger';
import {
  ADMIN_LOG_ACTOR_ROLES,
  type AdminLogActorRole,
} from '@/modules/backoffice/application/ports/admin-insights.reader.port';

/** Quem agiu: o nome e o papel (a coluna "Quem (nome e papel)"; decisão 316(11)(c)). */
export class AdminLogActorResponse {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  /**
   * O staff (`admin`, `support`), o papel no casamento da linha (`owner`,
   * `collaborator`) ou, sem vínculo, o do indicador (`planner`, `seller`);
   * nulo se nada disso. O app escolhe o rótulo.
   */
  @ApiProperty({ enum: ADMIN_LOG_ACTOR_ROLES, nullable: true }) role: AdminLogActorRole | null;
}
