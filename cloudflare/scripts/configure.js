import { createInterface } from 'node:readline/promises';
import { createSettings, saveSettings } from './settings.js';

async function question(label) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(label + ': ')).trim(); }
  finally { terminal.close(); }
}

async function secret(label) {
  return new Promise((resolve, reject) => {
    const previous = process.stdin.isRaw;
    let value = '';
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(previous ?? false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(new Error('input_cancelled')); else resolve(value.trim());
    };
    const onData = data => {
      const text = data.toString('utf8');
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\x03' || char === '\x04') return finish(true);
        if (char === '\r' || char === '\n') return finish(text.slice(i + 1).trim() !== '');
        if (char === '\x7f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char <= '~') value += char;
        else return finish(true);
        if (value.length > 2048) return finish(true);
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
    process.stdout.write(label + '（入力は表示しません）: ');
  });
}

async function main() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) throw new Error('terminal_required');
  console.log('PostRelayの接続設定を、このフォルダーの .postrelay/settings.json に保存します。');
  console.log('この操作ではCloudflare・X・Discordへ接続しません。既存ファイルは上書きしません。');
  const origin = await question('デプロイ後に表示されたWorker URL（https://…workers.dev）');
  const handle = (await question('通知するXユーザー名（@なし）')).replace(/^@/, '');
  console.log('通知の種類は判定できないため、返信・リポストを含めて種類で絞り込まずに扱います。');
  if (!['yes', 'はい'].includes((await question('この設定で作成しますか（yes / はい）')).toLowerCase())) throw new Error('input_cancelled');
  const webhook = await secret('Discord Webhook URL');
  const auth = await secret('通知を受け取るXアカウントの auth_token');
  const csrf = await secret('同じXアカウントの ct0');
  await saveSettings(process.cwd(), createSettings({ origin, handle, webhook, auth, csrf }));
  console.log('設定を保存しました。Cloudflareへ登録するには npm run secrets を実行してください。');
}

main().catch(error => {
  if (error.message === 'terminal_required') console.error('対話できる端末から npm run configure を実行してください。接続情報を引数やパイプへ渡さないでください。');
  else if (error.message === 'input_cancelled') console.error('設定を中止しました。');
  else if (error.code === 'EEXIST') console.error('設定ファイルが既にあります。更新は .postrelay/settings.json を編集してください。暗号鍵は変更しないでください。');
  else console.error('設定を保存できませんでした。入力形式、ファイルの所有者と権限を確認してください。');
  process.exitCode = 1;
});
