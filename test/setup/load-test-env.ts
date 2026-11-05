import { config } from 'dotenv';
import { resolve } from 'node:path';

// override: o .env.test vence o ambiente do shell, para o teste nunca apontar
// para o banco de desenvolvimento por engano.
config({ path: resolve(__dirname, '../../.env.test'), override: true, quiet: true });
