import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSettings, secretBindings } from './settings.js';
import { errorText } from './diagnostics.js';

async function main() {
  if (process.argv.length !== 2) throw new Error('unexpected_arguments');
  const settings = await loadSettings(process.cwd());
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const child = spawn(process.execPath, [wrangler, 'secret', 'bulk'], { stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(secretBindings(settings)));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  process.exitCode = code ?? 1;
}
main().catch(error => { console.error(errorText(error?.code ?? error?.message)); process.exitCode = 1; });
