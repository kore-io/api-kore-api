import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  // O client gerado do Prisma importa com extensão .js (padrão ESM).
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  // Um caso pode esperar o Mailpit mais de uma vez (cada espera tem o próprio
  // prazo de 5 s, em test/support/mailpit.ts); com o padrão de 5 s do Jest, um
  // CI lento estourava o caso inteiro antes de a espera do e-mail responder.
  testTimeout: 20_000,
  // Banco real em container (docker compose): prepara o kore_test antes da suíte.
  globalSetup: '<rootDir>/setup/global-setup.ts',
  setupFiles: ['<rootDir>/setup/load-test-env.ts'],
  // Um arquivo por vez (o banco é um só), num worker que é trocado quando passa
  // de 1 GB: no --runInBand, cada arquivo recarrega a API inteira (e o SDK do
  // S3) no mesmo processo, e a memória acumulada estourava o heap de 2 GB.
  maxWorkers: 1,
  workerIdleMemoryLimit: '1GB',
};

export default config;
