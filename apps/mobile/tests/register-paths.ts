/**
 * Register tsconfig paths for vitest transitive imports.
 *
 * This ensures that `@/` aliases work not only in test files but also in
 * source files that are transitively imported by test files.
 */
import { register } from 'tsconfig-paths';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

register({
  baseUrl: projectRoot,
  paths: {
    '@/*': ['src/*'],
  },
});
