import { loadSettings, loadManagementSettings } from './settings.js';
import { readBoundedJson } from '../src/core.js';
import { errorText, statusView } from './diagnostics.js';

async function main() {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !['status', 'start', 'stop', 'retry'].includes(action)) {
    console.error('使い方: npm run control -- status|start|stop|retry');
    process.exitCode = 1; return;
  }
  const load = action === 'status' || action === 'stop' ? loadManagementSettings : loadSettings;
  const settings = await load(process.cwd());
  const response = await fetch(settings.origin + '/api/' + action, { method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + settings.secrets.ADMIN_TOKEN }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const value = await readBoundedJson(response);
  if (!response.ok) {
    console.error(errorText(value?.error));
    process.exitCode = 1; return;
  }
  // Print only the documented status fields, never an arbitrary response body.
  const result = statusView(value);
  console.log(JSON.stringify(result, null, 2));
  const codes = new Set([result.last_error, result.last_notification_sync_error, ...Object.keys(result.post_errors ?? {}), ...Object.keys(result.job_errors ?? {})].filter(Boolean));
  for (const code of codes) console.error(errorText(code));
}
main().catch(error => { console.error(errorText(error?.code ?? error?.message)); process.exitCode = 1; });
