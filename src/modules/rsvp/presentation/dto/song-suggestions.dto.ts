import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SongSuggestionsQuery {
  /** O `nextCursor` da página anterior. */
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class SongSuggestionResponse {
  guestId: string;
  /** Como o convidado escreveu. */
  song: string;
  /** Quem sugeriu. */
  @ApiProperty({ type: String, nullable: true }) guestName: string | null;
  partyName: string;
  @ApiProperty({ format: 'date-time' }) suggestedAt: string;
}

export class SongSuggestionsResponse {
  /** Da mais antiga para a mais nova, 50 por vez, sem juntar repetidas (Música RN05). */
  @ApiProperty({ type: [SongSuggestionResponse] }) items: SongSuggestionResponse[];
  total: number;
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

/** A pergunta de música está desligada: o app leva ao Editor (Música RN03). */
export class SongQuestionDisabledErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['SONG_QUESTION_DISABLED'] }) error: 'SONG_QUESTION_DISABLED';
  @ApiProperty() message: string;
}
