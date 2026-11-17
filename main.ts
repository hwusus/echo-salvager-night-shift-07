// Build the game artifact for the make.fun best-game-01 scorer.
// Run locally with MAKEFUN_OUTPUT_DIR=out node main.ts; Node.js 22.18+ is required.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const project = dirname(fileURLToPath(import.meta.url));
const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(output, { recursive: true });
for (const directory of ['game', 'screenshots']) {
  cpSync(join(project, directory), join(output, directory), { recursive: true });
}
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};
writeFileSync(join(output, 'dossier.json'), buildDossier(output, caps));
console.log('Echo Salvager artifact written to', output);
