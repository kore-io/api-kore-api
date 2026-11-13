import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// override: o .env.test vence o ambiente do shell, para o teste nunca apontar
// para o banco de desenvolvimento por engano.
config({ path: resolve(__dirname, '../../.env.test'), override: true, quiet: true });

// Um prefixo de filas por arquivo de teste: com dois arquivos ao mesmo tempo
// (ou a rodada de outra pessoa no mesmo Redis), o worker de um pegava os jobs
// do outro, e o close() do afterAll esperava esses jobs alheios terminarem.
// test/setup/queue-cleanup.ts apaga as chaves do prefixo no fim do arquivo.
process.env.QUEUE_PREFIX = `kore:test:${randomBytes(6).toString('hex')}`;
