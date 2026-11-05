import { validateEnv } from './env.schema';

const validConfig = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://kore_api:kore_api@localhost:5433/kore',
  REDIS_URL: 'redis://localhost:6380',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Kore <nao-responda@kore.local>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
};

describe('validateEnv', () => {
  it('dada a configuração mínima, quando valida, então aplica os padrões', () => {
    expect(validateEnv({ config: validConfig })).toEqual({
      ...validConfig,
      PORT: 3000,
      SMTP_PORT: 1025,
    });
  });

  it('dado um APP_ENV fora da lista, quando valida, então recusa subir', () => {
    expect(() => validateEnv({ config: { ...validConfig, APP_ENV: 'staging' } })).toThrow(
      /APP_ENV/,
    );
  });

  it('dada uma variável obrigatória ausente, quando valida, então diz qual falta', () => {
    expect(() => validateEnv({ config: { APP_ENV: 'local' } })).toThrow(/DATABASE_URL/);
  });

  it('dada uma URL de banco inválida, quando valida, então recusa sem mostrar o valor', () => {
    const run = () =>
      validateEnv({ config: { ...validConfig, DATABASE_URL: 'mysql://segredo@host/db' } });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).not.toThrow(/segredo/);
  });

  it('dada uma porta não numérica, quando valida, então recusa', () => {
    expect(() => validateEnv({ config: { ...validConfig, PORT: 'abc' } })).toThrow(/PORT/);
  });
});
