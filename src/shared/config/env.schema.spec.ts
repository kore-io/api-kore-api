import { validateEnv } from './env.schema';

const validConfig = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://kore_api:kore_api@localhost:5433/kore',
  DATABASE_BACKOFFICE_URL: 'postgresql://kore_backoffice_login:x@localhost:5433/kore',
  REDIS_URL: 'redis://localhost:6380',
  ALLOWED_ORIGINS: 'http://localhost:5173, https://app.kore.com.br',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Kore <nao-responda@kore.local>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  KMS_PROVIDER: 'local',
  IP_HASH_KEY: 'y23SHU7SsFQYQZEEX9Pdr9F/FoCILgoWhQHBAAS44gc=',
  PRODUCT_EVENT_KEY: 'XzCeByXDR3XJNoRpPJNl4XyRC7WMhdK1MF7T2llEXOk=',
  LOGIN_CODE_KEY: 'AMUIAxq32RpneQW5IM0YNjUxG4zz+Z+GxGdUeEj0Rmc=',
  GOOGLE_PROVIDER: 'dev',
  OAUTH_STATE_KEY: 'nKTxWhY4lzQ+sR037TnEfHcScVZXA1kcFbG/ODTNFik=',
  APP_URL: 'http://localhost:5173',
  SITE_URL: 'http://localhost:5174',
  KMS_LOCAL_MASTER_KEY: '258+JWcuRfDrsS0xeKuTKgRV7p+kFlSMaIu3PErymmo=',
  PARTY_COOKIE_KEY: 'Qk7j0cX6vJ2m3nL9pR5tW8yZ1aB4dE7gH0kM3nP6qS8=',
  PREVIEW_COOKIE_KEY: 'gGXUHiAkgObPVjMgOTTQoB8bQ2x3bAQZFsTsRZ2mT0E=',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'kore',
  STORAGE_SECRET_ACCESS_KEY: 'kore-minio-local',
  STORAGE_PRIVATE_BUCKET: 'kore-private',
  STORAGE_PUBLIC_BUCKET: 'kore-public',
  STORAGE_PUBLIC_URL: 'http://localhost:9000/kore-public',
};

describe('validateEnv', () => {
  it('dada a configuração mínima, quando valida, então aplica os padrões', () => {
    expect(validateEnv({ config: validConfig })).toEqual({
      ...validConfig,
      ALLOWED_ORIGINS: ['http://localhost:5173', 'https://app.kore.com.br'],
      RATE_LIMIT_GENERAL_PER_MINUTE: 100,
      RATE_LIMIT_AUTH_PER_MINUTE: 10,
      TRUST_PROXY_HOPS: 0,
      PORT: 3000,
      SMTP_PORT: 1025,
      OTEL_EXPORTER: 'none',
      LOG_LEVEL: 'info',
      TERMS_VERSION: '2026-09',
      STORAGE_REGION: 'auto',
      STORAGE_FORCE_PATH_STYLE: false,
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

  it('dada uma origem com caminho, quando valida, então recusa', () => {
    expect(() =>
      validateEnv({ config: { ...validConfig, ALLOWED_ORIGINS: 'https://app.kore.com.br/app' } }),
    ).toThrow(/ALLOWED_ORIGINS/);
  });

  it('dada a lista de origens vazia, quando valida, então recusa subir', () => {
    expect(() => validateEnv({ config: { ...validConfig, ALLOWED_ORIGINS: ' , ' } })).toThrow(
      /ALLOWED_ORIGINS: informe pelo menos uma origem/,
    );
  });

  it('dado o Google de desenvolvimento fora de local ou test, quando valida, então recusa subir (decisão 147)', () => {
    expect(() =>
      validateEnv({ config: { ...validConfig, APP_ENV: 'production', KMS_PROVIDER: 'local' } }),
    ).toThrow(/GOOGLE_PROVIDER: o Google de desenvolvimento/);
  });

  it('dado o Google real sem o cliente, quando valida, então diz o que falta', () => {
    expect(() => validateEnv({ config: { ...validConfig, GOOGLE_PROVIDER: 'google' } })).toThrow(
      /GOOGLE_CLIENT_ID: obrigatória com GOOGLE_PROVIDER=google/,
    );
  });

  it('dado o path-style do MinIO ligado, quando valida, então vira booleano', () => {
    expect(
      validateEnv({ config: { ...validConfig, STORAGE_FORCE_PATH_STYLE: 'true' } })
        .STORAGE_FORCE_PATH_STYLE,
    ).toBe(true);
  });

  it('dada a origem do site na lista do app, quando valida, então recusa subir (Site público RN07)', () => {
    expect(() =>
      validateEnv({
        config: { ...validConfig, ALLOWED_ORIGINS: 'http://localhost:5173, http://localhost:5174' },
      }),
    ).toThrow(/ALLOWED_ORIGINS: não pode ter a origem do SITE_URL/);
  });
});
