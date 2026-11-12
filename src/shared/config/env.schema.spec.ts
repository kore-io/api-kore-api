import { simulatorEnabled, validateEnv } from './env.schema';

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
  PAYMENT_GATEWAY_PROVIDER: 'local',
  PAYMENT_WEBHOOK_SECRET: 'local-webhook-secret-only-for-dev-and-tests-0001',
  TAX_ID_HASH_KEY_ENCRYPTED:
    'CltkHGWe/+yKMJl8JI1nIOa/jb2HMmHMZ8EJeYchSE+Mcv+nN82KPDW+1CyvIFV9twm0oj0U2+ij7fwI',
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
      SIMULATOR_ENABLED: true,
      COURTESY_PUBLICATION_ENABLED: false,
      PLANNER_SIGNUP_ENABLED: false,
      REFERRAL_LINK_URL: 'https://kore.com.br/i',
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

  it('Simule RN01 - sem a variável, o simulador fica ligado em local e test e desligado nos outros', () => {
    expect(validateEnv({ config: validConfig }).SIMULATOR_ENABLED).toBe(true);
    expect(
      validateEnv({ config: { ...validConfig, SIMULATOR_ENABLED: 'false' } }).SIMULATOR_ENABLED,
    ).toBe(false);
    // Fora de local e test o ambiente inteiro não valida aqui (a chave KMS local); o padrão sim.
    expect(simulatorEnabled({ appEnv: 'test', value: undefined })).toBe(true);
    expect(simulatorEnabled({ appEnv: 'homolog', value: undefined })).toBe(false);
    expect(simulatorEnabled({ appEnv: 'production', value: undefined })).toBe(false);
    expect(simulatorEnabled({ appEnv: 'homolog', value: 'true' })).toBe(true);
  });

  it('Publicação RN01 - a Cortesia vem desligada sem valor e liga em local e test', () => {
    expect(validateEnv({ config: validConfig }).COURTESY_PUBLICATION_ENABLED).toBe(false);
    expect(
      validateEnv({ config: { ...validConfig, COURTESY_PUBLICATION_ENABLED: 'true' } })
        .COURTESY_PUBLICATION_ENABLED,
    ).toBe(true);
  });

  it('Publicação RN01 e decisão 217(11) - dado APP_ENV production ou homolog com a Cortesia ligada, a API não sobe', () => {
    for (const appEnv of ['production', 'homolog'])
      expect(() =>
        validateEnv({
          config: { ...validConfig, APP_ENV: appEnv, COURTESY_PUBLICATION_ENABLED: 'true' },
        }),
      ).toThrow(/COURTESY_PUBLICATION_ENABLED: a Cortesia só pode ser ligada/);
    // Desligada, a variável não é motivo de recusa nesses ambientes.
    expect(() =>
      validateEnv({
        config: { ...validConfig, APP_ENV: 'production', COURTESY_PUBLICATION_ENABLED: 'false' },
      }),
    ).not.toThrow(/COURTESY_PUBLICATION_ENABLED/);
  });

  it.each([
    ['local', true],
    ['test', true],
    ['homolog', false],
    ['production', false],
  ])(
    'Cadastro e perfil RN02 - com APP_ENV %s e PLANNER_SIGNUP_ENABLED=true, aceita: %s',
    (appEnv, accepted) => {
      const config = { ...validConfig, APP_ENV: appEnv, PLANNER_SIGNUP_ENABLED: 'true' };
      if (accepted) expect(validateEnv({ config }).PLANNER_SIGNUP_ENABLED).toBe(true);
      else
        expect(() => validateEnv({ config })).toThrow(
          /PLANNER_SIGNUP_ENABLED: o cadastro de cerimonialista só pode ser ligado/,
        );
    },
  );

  it('Cadastro e perfil RN02 - sem valor, o cadastro de cerimonialista vem desligado', () => {
    expect(validateEnv({ config: validConfig }).PLANNER_SIGNUP_ENABLED).toBe(false);
  });

  it('E-mail e push RN07 - as chaves VAPID são opcionais em local e test e obrigatórias em homolog e production', () => {
    expect(() => validateEnv({ config: validConfig })).not.toThrow();
    expect(() => validateEnv({ config: { ...validConfig, APP_ENV: 'homolog' } })).toThrow(
      /VAPID_PUBLIC_KEY: obrigatória/,
    );
    expect(() =>
      validateEnv({ config: { ...validConfig, VAPID_SUBJECT: 'kore@kore.com.br' } }),
    ).toThrow(/VAPID_SUBJECT/);
  });

  it.each(['homolog', 'production'])(
    'Publicar e pagar RN16 - dado APP_ENV %s e PAYMENT_GATEWAY_PROVIDER local, a validação falha e a API não sobe',
    (appEnv) => {
      expect(() => validateEnv({ config: { ...validConfig, APP_ENV: appEnv } })).toThrow(
        /PAYMENT_GATEWAY_PROVIDER: o gateway local só é aceito com APP_ENV local ou test/,
      );
    },
  );

  it('Publicar e pagar RN14 - o gateway, o segredo do webhook e a chave do HMAC são obrigatórios', () => {
    for (const key of [
      'PAYMENT_GATEWAY_PROVIDER',
      'PAYMENT_WEBHOOK_SECRET',
      'TAX_ID_HASH_KEY_ENCRYPTED',
    ] as const) {
      const config: Record<string, unknown> = { ...validConfig };
      delete config[key];
      expect(() => validateEnv({ config })).toThrow(new RegExp(key));
    }
    expect(() =>
      validateEnv({ config: { ...validConfig, PAYMENT_WEBHOOK_SECRET: 'curto' } }),
    ).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    expect(() =>
      validateEnv({ config: { ...validConfig, PAYMENT_GATEWAY_PROVIDER: 'asaas' } }),
    ).toThrow(/PAYMENT_GATEWAY_PROVIDER/);
  });
});
