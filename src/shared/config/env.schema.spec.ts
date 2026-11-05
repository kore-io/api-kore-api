import { validateEnv } from './env.schema';

const validConfig = {
  APP_ENV: 'local',
};

describe('validateEnv', () => {
  it('dada a configuração mínima, quando valida, então aplica os padrões', () => {
    expect(validateEnv({ config: validConfig })).toEqual({ ...validConfig, PORT: 3000 });
  });

  it('dado um APP_ENV fora da lista, quando valida, então recusa subir', () => {
    expect(() => validateEnv({ config: { ...validConfig, APP_ENV: 'staging' } })).toThrow(
      /APP_ENV/,
    );
  });

  it('dada uma variável obrigatória ausente, quando valida, então diz qual falta', () => {
    expect(() => validateEnv({ config: {} })).toThrow(/APP_ENV/);
  });

  it('dada uma porta não numérica, quando valida, então recusa', () => {
    expect(() => validateEnv({ config: { ...validConfig, PORT: 'abc' } })).toThrow(/PORT/);
  });
});
