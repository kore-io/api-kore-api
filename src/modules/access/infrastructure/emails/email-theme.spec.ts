import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';
import { EMAIL_THEME } from './email-theme';

// O repositório do Design System, ao lado deste (decisão 142). Os tokens são
// lidos do homolog dele (git show), e não da árvore de trabalho, para o
// resultado não depender da branch aberta lá. No CI, onde o repositório não
// existe, o teste é pulado até o pacote @kore-io/design ser publicado.
const DESIGN_REPO =
  process.env.KORE_DESIGN_REPO ?? resolve(__dirname, '../../../../../../lib-kore-design');
const DESIGN_REF = process.env.KORE_DESIGN_REF ?? 'origin/homolog';

type Tokens = Record<string, unknown>;

function loadTokens({ file }: { file: string }): Tokens {
  const source = execFileSync(
    'git',
    ['-C', DESIGN_REPO, 'show', `${DESIGN_REF}:src/tokens/${file}`],
    {
      encoding: 'utf8',
    },
  );
  const { outputText } = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS },
  });
  const module = { exports: {} as Tokens };
  // Só o core é lido de fato; o semântico importa o core por './core'.
  const require = (path: string) => (path === './core' ? loadTokens({ file: 'core.ts' }) : {});
  runInNewContext(outputText, { module, exports: module.exports, require });
  return module.exports;
}

function colorAt({ colors, path }: { colors: Tokens; path: string }): string {
  return path.split('.').reduce<unknown>((node, key) => (node as Tokens)[key], colors) as string;
}

const describeIfTokens = existsSync(resolve(DESIGN_REPO, '.git')) ? describe : describe.skip;

describeIfTokens('EMAIL_THEME × tokens do lib-kore-design (decisão 142)', () => {
  // Lido dentro do teste: com o describe.skip, o corpo do describe ainda roda.
  const semantic = (name: string) => {
    const { coreColors } = loadTokens({ file: 'core.ts' }) as { coreColors: Tokens };
    const { semanticColorRefs } = loadTokens({ file: 'semantic.ts' }) as {
      semanticColorRefs: Record<string, string>;
    };
    return colorAt({ colors: coreColors, path: semanticColorRefs[name] });
  };

  it.each([
    ['pageBackground', () => semantic('background')],
    ['cardBackground', () => semantic('card')],
    ['text', () => semantic('foreground')],
    ['mutedText', () => semantic('muted-foreground')],
    ['buttonBackground', () => semantic('primary')],
    ['buttonText', () => semantic('primary-foreground')],
  ] as const)(
    'dado o token de %s, quando compara, então a cor do e-mail é a mesma',
    (key, token) => {
      expect(EMAIL_THEME[key].toUpperCase()).toBe(token().toUpperCase());
    },
  );
});
