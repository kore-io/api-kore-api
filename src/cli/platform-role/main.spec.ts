/**
 * O `staff:role` roda na imagem de produção (Backoffice - acesso RN01; revisão
 * do Crivo no PR (A)): lá o `pnpm prune --prod` tira as devDependencies. O
 * script e tudo o que ele importa não podem depender de nenhuma delas. O
 * `dotenv` em si fica (o @nestjs/config, de produção, traz o dele); o que não
 * pode é o `dotenv/config` do nosso código.
 */
const RUNTIME_DEV_DEPENDENCIES = [
  'dotenv/config',
  'pino-pretty',
  'jsqr',
  'prisma',
  'supertest',
  'tsconfig-paths',
  'ts-node',
  'typescript',
  '@nestjs/testing',
  '@opentelemetry/context-async-hooks',
];

describe('staff:role na imagem de produção (Backoffice - acesso RN01)', () => {
  const argv = process.argv;
  const exitCode = process.exitCode;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    jest.restoreAllMocks();
  });

  it('RN01 - o script sobe sem as devDependencies (sem o dotenv) e responde com o uso', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = ['node', 'dist/cli/platform-role/main'];
    jest.isolateModules(() => {
      for (const name of RUNTIME_DEV_DEPENDENCIES)
        jest.doMock(
          name,
          () => {
            throw new Error(`devDependency na imagem de produção: ${name}`);
          },
          { virtual: true },
        );
      // O main roda ao ser carregado; o require é síncrono dentro do registro isolado.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./main');
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^Uso: pnpm staff:role/));
    expect(process.exitCode).toBe(1);
  });
});
