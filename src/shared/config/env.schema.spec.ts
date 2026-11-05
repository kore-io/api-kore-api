import { validateEnv } from './env.schema';

const validConfig = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://kore_api:kore_api@localhost:5433/kore',
  REDIS_URL: 'redis://localhost:6380',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Kore <nao-responda@kore.local>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  KMS_PROVIDER: 'local',
  KMS_LOCAL_MASTER_KEY: '258+JWcuRfDrsS0xeKuTKgRV7p+kFlSMaIu3PErymmo=',
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

  it('dada a chave KMS local fora de local ou test, quando valida, então recusa subir (decisão 97)', () => {
    expect(() => validateEnv({ config: { ...validConfig, APP_ENV: 'homolog' } })).toThrow(
      /KMS_PROVIDER: a chave local só é aceita com APP_ENV local ou test/,
    );
    expect(() => validateEnv({ config: { ...validConfig, APP_ENV: 'production' } })).toThrow(
      /KMS_PROVIDER/,
    );
  });

  it('dada a chave KMS local com tamanho errado, quando valida, então recusa', () => {
    expect(() => validateEnv({ config: { ...validConfig, KMS_LOCAL_MASTER_KEY: 'YWJj' } })).toThrow(
      /KMS_LOCAL_MASTER_KEY/,
    );
  });

  it('dado KMS_PROVIDER local sem a chave, quando valida, então diz que ela falta', () => {
    expect(() =>
      validateEnv({ config: { ...validConfig, KMS_LOCAL_MASTER_KEY: undefined } }),
    ).toThrow(/KMS_LOCAL_MASTER_KEY: obrigatória/);
  });
});
