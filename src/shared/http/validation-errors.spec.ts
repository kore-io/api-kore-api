import { plainToInstance, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { toErrorCode, validationError, validationExceptionFactory } from './validation-errors';

class GuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class PartyDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsIn(['adult', 'child'])
  ageGroup: string;

  @ValidateNested({ each: true })
  @Type(() => GuestDto)
  guests: GuestDto[];
}

function bodyOf(plain: object): Record<string, unknown> {
  const errors = validateSync(plainToInstance(PartyDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return validationExceptionFactory(errors).getResponse() as Record<string, unknown>;
}

describe('validationExceptionFactory (decisão 190)', () => {
  const valid = { name: 'Família Moreira', ageGroup: 'adult', guests: [{ name: 'Célia' }] };

  it('dado um campo de convidado inválido, quando valida, então o path aponta o campo pelo índice (decisão 186, item 8)', () => {
    const body = bodyOf({ ...valid, guests: [{ name: 'Célia' }, { name: 'Ana', email: 'x' }] });

    expect(body.errors).toEqual([{ path: 'guests.1.email', code: 'IS_EMAIL', params: {} }]);
  });

  it('dado um texto acima do limite, quando valida, então o code é a regra em maiúsculas e o limite vai em params', () => {
    const body = bodyOf({ ...valid, guests: [{ name: 'a'.repeat(81) }] });

    expect(body.errors).toEqual([
      { path: 'guests.0.name', code: 'MAX_LENGTH', params: { max: 80 } },
    ]);
  });

  it('dada uma regra com dois limites, quando valida, então params traz os dois pelo nome', () => {
    const body = bodyOf({ ...valid, name: 'a' });

    expect(body.errors).toEqual([{ path: 'name', code: 'IS_LENGTH', params: { min: 2, max: 80 } }]);
  });

  it('dado um valor fora da lista, quando valida, então params traz os valores aceitos', () => {
    const body = bodyOf({ ...valid, ageGroup: 'elder' });

    expect(body.errors).toEqual([
      { path: 'ageGroup', code: 'IS_IN', params: { values: ['adult', 'child'] } },
    ]);
  });

  it('dado um campo com várias falhas, quando valida, então todas aparecem', () => {
    const body = bodyOf({ ...valid, guests: [{ name: '' }] });

    expect(body.errors).toEqual([{ path: 'guests.0.name', code: 'IS_NOT_EMPTY', params: {} }]);

    const many = bodyOf({ ...valid, guests: [{ name: 42 }] });
    expect((many.errors as { code: string }[]).map((error) => error.code).sort()).toEqual([
      'IS_STRING',
      'MAX_LENGTH',
    ]);
  });

  it('dado um campo inesperado, quando valida, então o code é WHITELIST_VALIDATION e o formato nativo continua', () => {
    const body = bodyOf({ ...valid, admin: true });

    expect(body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['property admin should not exist'],
      errors: [{ path: 'admin', code: 'WHITELIST_VALIDATION', params: {} }],
    });
  });
});

describe('validationError', () => {
  it('dada uma falha do domínio, quando monta o 400, então o message é o caminho e o código (contrato do POST parties)', () => {
    const body = validationError({
      errors: [{ path: 'guests.1.phone', code: 'PHONE_TOO_SHORT', params: { n: 8 } }],
    }).getResponse();

    expect(body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['guests.1.phone: PHONE_TOO_SHORT'],
      errors: [{ path: 'guests.1.phone', code: 'PHONE_TOO_SHORT', params: { n: 8 } }],
    });
  });
});

describe('toErrorCode', () => {
  it.each([
    ['isEmail', 'IS_EMAIL'],
    ['maxLength', 'MAX_LENGTH'],
    ['isNotEmpty', 'IS_NOT_EMPTY'],
    ['arrayMaxSize', 'ARRAY_MAX_SIZE'],
    ['whitelistValidation', 'WHITELIST_VALIDATION'],
    ['isUUID', 'IS_UUID'],
  ])('%s vira %s', (rule, code) => {
    expect(toErrorCode(rule)).toBe(code);
  });
});
