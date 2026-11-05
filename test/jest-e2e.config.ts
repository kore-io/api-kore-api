import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  // O client gerado do Prisma importa com extensão .js (padrão ESM).
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  // Banco real em container (docker compose): prepara o kore_test antes da suíte.
  globalSetup: '<rootDir>/setup/global-setup.ts',
  setupFiles: ['<rootDir>/setup/load-test-env.ts'],
};

export default config;
