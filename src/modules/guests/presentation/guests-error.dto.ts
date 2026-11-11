import { ApiProperty } from '@nestjs/swagger';

/** Erros de regra do contexto Convidados, no formato nativo (decisão 99). */
export class PartyNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PARTY_NOT_FOUND'] }) error: 'PARTY_NOT_FOUND';
  @ApiProperty() message: string;
}
