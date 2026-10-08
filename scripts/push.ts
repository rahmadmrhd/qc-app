import { $ } from 'bun';
import { GAS_DIR } from './paths';

await $`clasp push --force`.cwd(GAS_DIR);
console.log('clasp push selesai');
