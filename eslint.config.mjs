// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'src/generated/', 'eslint.config.mjs', 'commitlint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // A conexão com BYPASSRLS só pode ser usada pelo backoffice e pelas rotinas
    // (ADR de multi-tenant, item 5); em rota de produto vale o PrismaService.
    files: ['src/**/*.ts'],
    ignores: [
      'src/shared/database/**',
      'src/**/infrastructure/backoffice/**',
      'src/**/*-worker.module.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/backoffice-prisma.service'],
              message:
                'BackofficePrismaService (BYPASSRLS) só em infrastructure/backoffice/ e nos módulos do worker.',
            },
          ],
        },
      ],
    },
  },
  {
    // supertest devolve `body` como any; nos testes isso é aceitável.
    files: ['test/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
