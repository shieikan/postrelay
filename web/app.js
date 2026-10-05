'use strict';
const app = document.querySelector('#app');
const editor = document.querySelector('#feed-editor');
const form = document.querySelector('#feed-form');
const sourceDialog = document.querySelector('#source-dialog');
const icons = {"home":"<path d=\"M5 12l-2 0l9 -9l9 9l-2 0\" /><path d=\"M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7\" /><path d=\"M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6\" />","adjustments-horizontal":"<path d=\"M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /><path d=\"M4 6l8 0\" /><path d=\"M16 6l4 0\" /><path d=\"M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /><path d=\"M4 12l2 0\" /><path d=\"M10 12l10 0\" /><path d=\"M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\" /><path d=\"M4 18l11 0\" /><path d=\"M19 18l1 0\" />","history":"<path d=\"M12 8l0 4l2 2\" /><path d=\"M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5\" />","plug":"<path d=\"M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054\" /><path d=\"M4 20l3.5 -3.5\" /><path d=\"M15 4l-3.5 3.5\" /><path d=\"M20 9l-3.5 3.5\" />","search":"<path d=\"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" /><path d=\"M21 21l-6 -6\" />","plus":"<path d=\"M12 5l0 14\" /><path d=\"M5 12l14 0\" />","arrow-right":"<path d=\"M5 12l14 0\" /><path d=\"M13 18l6 -6\" /><path d=\"M13 6l6 6\" />","arrow-up-right":"<path d=\"M17 7l-10 10\" /><path d=\"M8 7l9 0l0 9\" />","chevron-down":"<path d=\"M6 9l6 6l6 -6\" />","logout":"<path d=\"M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2\" /><path d=\"M9 12h12l-3 -3\" /><path d=\"M18 15l3 -3\" />","x":"<path d=\"M18 6l-12 12\" /><path d=\"M6 6l12 12\" />","check":"<path d=\"M5 12l5 5l10 -10\" />","player-pause":"<path d=\"M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12\" /><path d=\"M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12\" />","player-play":"<path d=\"M7 4v16l13 -8l-13 -8\" />","circle-check":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /><path d=\"M9 12l2 2l4 -4\" />","alert-circle":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /><path d=\"M12 8v4\" /><path d=\"M12 16h.01\" />","bell":"<path d=\"M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6\" /><path d=\"M9 17v1a3 3 0 0 0 6 0v-1\" />","copy":"<path d=\"M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666\" /><path d=\"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1\" />","refresh":"<path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" /><path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />","brand-discord":"<path d=\"M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\" /><path d=\"M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\" /><path d=\"M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-.972 1.923a11.913 11.913 0 0 0 -4.053 0l-.975 -1.923c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3\" /><path d=\"M7 16.5c3.5 1 6.5 1 10 0\" />","external-link":"<path d=\"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6\" /><path d=\"M11 13l9 -9\" /><path d=\"M15 4h5v5\" />","filter":"<path d=\"M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227\" />","chevron-right":"<path d=\"M9 6l6 6l-6 6\" />","info-circle":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /><path d=\"M12 9h.01\" /><path d=\"M11 12h1v4h1\" />","arrow-narrow-right":"<path d=\"M5 12l14 0\" /><path d=\"M15 16l4 -4\" /><path d=\"M15 8l4 4\" />"};
const icon = name => `<svg class='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>${icons[name] || ''}</svg>`;

const titles = {feeds:'Discordへの通知', editor:'通知するアカウントを追加', history:'送信履歴', source:'設定'};
const labels = {simulated:'送信なし（動作確認）', delivered:'送信済み', queued:'送信待ち', sending:'送信中', retry:'再試行待ち', failed:'送信失敗'};
let state, bootstrap, current='feeds', search='', historyFilter='all', historyFeed='', editing=null, receiverUrl='', timer, settingsSection='', editorReturn='feeds', feedOpener='[data-add]';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const words = value => String(value || '').split(/[,、\n]/).map(x => x.trim()).filter(Boolean);
const brand = () => state ? `<button class='brand' data-go='feeds' aria-label='PostRelay 通知一覧へ'>PostRelay</button>` : `<span class='brand'>PostRelay</span>`;
const button = (text, attributes='', style='primary', symbol='') => `<button class='button ${style}' ${attributes}>${symbol ? icon(symbol) : ''}<span>${text}</span></button>`;
const routeArrow = () => `<span class='route-arrow' aria-hidden='true'>${icon('arrow-narrow-right')}</span>`;
function toast(message) {
  const el=document.querySelector('#toast'); el.textContent=message; el.classList.add('visible');
  clearTimeout(timer); timer=setTimeout(()=>el.classList.remove('visible'),4000);
}
async function api(path,data) {
  const options={headers:{'X-PostRelay':'1'},credentials:'same-origin'};
  if(data!==undefined) {options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  let response, result;
  try {response=await fetch(path,options);result=await response.json();}
  catch {throw new Error(data===undefined ? '画面の情報を取得できませんでした。接続を確認して、再読み込みしてください。' : '操作の結果を確認できませんでした。再読み込みして、変更が反映されているか確認してください。');}
  if(!response.ok) throw new Error(result.error || '操作を完了できませんでした。もう一度お試しください。');
  return result;
}
function readRoute() {
  const [view,query='']=location.hash.slice(1).split('?');
  const params=new URLSearchParams(query);
  current=Object.hasOwn ? (Object.hasOwn(titles,view) ? view : 'feeds') : (Object.prototype.hasOwnProperty.call(titles,view) ? view : 'feeds');
  if(current!==view) history.replaceState(null,'','#'+current);
  historyFeed=params.get('feed') || ''; settingsSection=params.get('section') || '';
  editing=current==='editor' ? state?.feeds.find(f=>f.id===params.get('id')) || null : null;
}
function navigate(route='feeds',selector='',replace=false) {
  if(location.hash !== '#'+route) history[replace ? 'replaceState' : 'pushState'](null,'','#'+route);
  search='';historyFilter='all';readRoute();renderApp();focusTarget(selector);
}
function focusTarget(selector='') {
  const target=selector && document.querySelector(selector);
  (target && !target.disabled ? target : document.querySelector('.page-heading h1'))?.focus({preventScroll:true});
}
function focusSelector(el) {
  if(el.id) return '#'+CSS.escape(el.id);
  for(const key of ['data-edit','data-toggle','data-retry','data-history','data-filter','data-go']) {
    if(el.hasAttribute(key)) return `[${key}='${CSS.escape(el.getAttribute(key))}']`;
  }
  return '.page-heading h1';
}
async function refresh(render=true) {
  state=await api('/api/state');
  if(render) {readRoute();renderApp();}
}
async function updateAfterAction(message,selector='',render=true) {
  try {await refresh(render);if(render) focusTarget(selector);toast(message);}
  catch {toast(message+' 画面を更新できませんでした。再読み込みしてください。');}
}
function heading(title,description='',actions='') {
  return `<header class='page-heading'><div><h1 tabindex='-1'>${title}</h1>${description ? `<p>${description}</p>` : ''}</div><div class='page-actions'>${actions}</div></header>`;
}
function modeNotice() {
  if(state.mode==='demo') return `<div class='mode-banner'>${icon('info-circle')}<span><strong>デモ</strong>・Discordへの送信なし</span></div>`;
  if(!state.live) return `<div class='mode-banner'>${icon('info-circle')}<span>動作確認モード・Discordへの送信なし</span></div>`;
  return '';
}
function parkEditor() {editor.hidden=true;document.body.append(editor);}
function shell() {
  parkEditor();
  const back=current==='editor' ? editorReturn : 'feeds';
  const backLabel=back.startsWith('history') ? '送信履歴' : back.startsWith('source') ? '設定' : '通知一覧';
  app.innerHTML=`<div class='layout'><header class='site-header'>${brand()}<div class='header-actions'>${current==='feeds' ? `<button class='text-button' data-go='source'>${icon('adjustments-horizontal')}設定</button>` : `<button class='text-button' data-go='${esc(back)}'>← ${backLabel}</button>`}</div></header><main class='main'><div class='content'>${modeNotice()}<div id='view'></div></div></main></div>`;
}
function emptyState(title,description='',action='') {
  return `<div class='empty-state'><span class='empty-icon'>${icon(search ? 'search' : 'bell')}</span><h3>${title}</h3>${description ? `<p>${description}</p>` : ''}${action}</div>`;
}
function searchBox(placeholder) {
  return `<div class='search-box'>${icon('search')}<input id='search' type='search' aria-label='${placeholder}' placeholder='${placeholder}' value='${esc(search)}' autocomplete='off'><button id='clear-search' class='icon-button' aria-label='検索をクリア' ${search ? '' : 'hidden'}>${icon('x')}</button></div>`;
}
function noResults() {return emptyState('検索結果がありません','別のキーワードで検索してください。',button('検索をクリア','data-clear-search','secondary'));}
function filteredFeeds() {
  const text=search.toLocaleLowerCase();
  return state.feeds.filter(feed=>`${feed.handle} ${feed.channel}`.toLocaleLowerCase().includes(text));
}
function ruleRow(feed) {
  const missing=state.mode!=='demo' && !feed.webhook_configured;
  const failed=state.jobs.some(j=>j.feed_id===feed.id && j.state==='failed');
  const status=!feed.enabled ? '停止中' : missing ? '送信先未設定' : 'オン';
  return `<article class='rule-row'><div class='rule-account'><h2>@${esc(feed.handle)}</h2>${failed ? `<span class='rule-note error'>${icon('alert-circle')}送信に失敗した通知があります</span>` : ''}</div>${routeArrow()}<div class='rule-destination'>#${esc(feed.channel)}</div><div class='rule-state'><span class='status ${feed.enabled && !missing ? 'enabled' : 'paused'}' aria-label='通知の設定：${status}'>${status}</span></div><div class='rule-actions'><button class='text-button' data-history='${feed.id}' aria-label='@${esc(feed.handle)} → #${esc(feed.channel)}の送信履歴を確認'>送信履歴</button>${button('編集',`data-edit='${feed.id}' aria-label='@${esc(feed.handle)} → #${esc(feed.channel)}の通知設定を編集'`,'secondary small-button')}${button(feed.enabled ? '通知を停止' : '通知を再開',`data-toggle='${feed.id}' aria-label='@${esc(feed.handle)} → #${esc(feed.channel)}の通知を${feed.enabled ? '停止' : '再開'}'`,`${feed.enabled ? 'danger' : 'outline-primary'} small-button`)}</div></article>`;
}
function ruleResults() {
  const feeds=filteredFeeds();
  return feeds.length ? feeds.map(ruleRow).join('') : search ? noResults() : emptyState('通知するアカウントを追加しましょう','Xアカウントと、届けるDiscordチャンネルを設定します。',button('通知するアカウントを追加','data-add','primary','plus'));
}
function feedsView() {
  const needsSource=state.mode!=='demo' && !state.stats.events;
  return heading('Discordへの通知','どのXアカウントの投稿通知を、どのチャンネルへ届けるかを設定します。',button('通知するアカウントを追加','data-add','primary','plus'))+`${needsSource ? `<div class='action-notice'>${icon('info-circle')}<span>Xの投稿通知をまだ受け取っていません。</span><button class='text-button' data-go='source'>接続方法を確認</button></div>` : ''}<section class='rules-panel' aria-label='Discordへの通知一覧'>${state.feeds.length>=8 ? `<div class='rules-toolbar'>${searchBox('アカウント名・チャンネル名で検索')}<span id='result-count' class='result-count'>${filteredFeeds().length}件</span></div>` : ''}<div class='rules-columns' aria-hidden='true'><span>Xアカウント</span><span></span><span>届けるチャンネル</span><span>通知</span><span></span></div><div id='rule-results'>${ruleResults()}</div></section>`;
}
function editorView() {
  if(new URLSearchParams(location.hash.split('?')[1]).has('id') && !editing) return heading('この通知設定が見つかりません')+emptyState('一覧から選び直してください','',button('通知一覧に戻る',"data-go='feeds'"));
  return heading(editing ? '通知先と条件を編集' : '通知するアカウントを追加')+`<section id='editor-slot' class='editor-panel' aria-label='通知するアカウント・通知先・条件'></section>`;
}
function hydrateEditor() {
  const slot=document.querySelector('#editor-slot');if(!slot) return;
  form.reset();document.querySelector('#form-error').textContent='';
  document.querySelector('#save-feed').textContent=editing ? '変更を保存' : '追加する';
  if(editing) {
    for(const key of ['handle','channel','role_id']) form.elements[key].value=editing[key] || '';
    for(const key of ['include','exclude']) form.elements[key].value=editing[key].join(', ');
    for(const key of ['include_replies','include_reposts']) form.elements[key].checked=editing[key];
  }
  document.querySelector('#channel-options').innerHTML=[...new Set(state.feeds.map(f=>f.channel))].map(ch=>`<option value='${esc(ch)}'></option>`).join('');
  document.querySelector('#advanced-details').open=false;
  const destination=document.querySelector('#destination-details');destination.hidden=state.mode==='demo';destination.open=state.mode!=='demo' && !editing?.webhook_configured;
  document.querySelector('#channel-help').textContent=state.mode==='demo' ? '一覧に表示する名前です。デモでは実際のチャンネルには接続しません。' : '一覧に表示する名前です。送信先は下のURLで指定します。';
  document.querySelector('.editor-description').textContent=state.mode==='demo' ? 'デモではサンプル通知で試せます。Discordへの送信はありません。' : '接続したツールから届く、このアカウントの投稿通知をDiscordへ届けます。';
  document.querySelector('#webhook-help').textContent=editing?.webhook_configured ? '送信先URLは設定済みです。変更する場合だけ入力してください。' : 'Discordへ送信するには、このURLの設定が必要です。';
  const limit=state.limits.keywords;
  document.querySelector('#keyword-limit').textContent=`処理量を抑えるため、2つの欄を合わせて${limit}個まで設定できます。複数の言葉はカンマで区切ってください。`;
  slot.append(editor);editor.hidden=false;
}
function openFeed(feed=null) {
  editorReturn=location.hash.slice(1) || 'feeds';
  feedOpener=document.activeElement ? focusSelector(document.activeElement) : '[data-add]';
  navigate('editor'+(feed ? '?id='+encodeURIComponent(feed.id) : ''));
  form.elements.handle.focus();
}
function filteredJobs() {
  const text=search.toLocaleLowerCase();
  return state.jobs.filter(job=>(!historyFeed || job.feed_id===historyFeed) && (historyFilter==='all' || (historyFilter==='pending' ? ['queued','retry','sending'].includes(job.state) : job.state===historyFilter)) && `${job.post.author} ${job.post.text} ${job.channel}`.toLocaleLowerCase().includes(text));
}
function postRow(job) {
  const date=new Date(job.received*1000), display=`${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;
  const sourceFeed=state.feeds.find(f=>f.id===job.feed_id);
  return `<article class='notification'><time class='delivery-time' datetime='${date.toISOString()}'><span class='delivery-time-label'>受信日時</span>${display}</time><div class='post-content'><div class='post-top'><strong>@${esc(job.post.author)}</strong>${!historyFeed ? `<span class='post-destination'>現在の通知先：#${esc(job.channel)}</span>` : ''}</div><p class='post-text'>${esc(job.post.text)}</p>${job.state==='failed' ? `<p class='delivery-error'>${esc(job.error || 'Discordへ送信できませんでした。時間をおいて、もう一度送信してください。')}</p>` : ''}<div class='post-bottom'>${state.mode!=='demo' ? `<a id='post-link-${esc(job.id)}' class='post-link' href='${esc(job.post.url)}' target='_blank' rel='noopener noreferrer'>Xで投稿を見る${icon('external-link')}</a>` : ''}${job.error && job.state!=='failed' ? `<details class='error-details'><summary>エラーの詳細</summary><p>${esc(job.error)}</p></details>` : ''}</div></div><div class='delivery-result'><span class='status ${job.state}'>${job.state==='failed' ? icon('alert-circle') : ''}${esc(labels[job.state] || '状態を確認中')}</span>${job.state==='retry' ? `<small>自動でもう一度送信します。</small>` : ''}${job.state==='failed' ? `${sourceFeed ? button(sourceFeed.webhook_configured ? 'Discordの送信先を確認' : 'Discordの送信先を設定',`id='destination-${job.id}' data-edit='${sourceFeed.id}' data-destination`,'outline-primary small-button') : ''}${button('もう一度送信',`data-retry='${job.id}'`,'secondary small-button')}` : ''}</div></article>`;
}
function notificationResults() {
  const jobs=filteredJobs();
  if(jobs.length) return jobs.map(postRow).join('');
  return search ? noResults() : emptyState(historyFilter==='all' ? '送信履歴はまだありません' : 'この条件の送信履歴はありません',historyFilter==='all' ? '送信対象の通知が届くと、結果がここに表示されます。' : '絞り込みを変更すると、ほかの送信履歴を確認できます。');
}
function historyView() {
  const feed=state.feeds.find(f=>f.id===historyFeed);
  const filters=[['all','すべて'],['delivered','送信済み'],['pending','処理中'],['failed','失敗']];
  if(state.mode==='demo' || state.stats.simulated) filters.splice(1,0,['simulated','送信なし']);
  return heading('送信履歴')+`${feed ? `<div class='history-route'><span>@${esc(feed.handle)}</span>${routeArrow()}<span><small class='route-label'>現在の通知先</small>#${esc(feed.channel)}</span>${button('通知設定を編集',`data-edit='${feed.id}'`,'secondary small-button')}</div>` : ''}<div class='history-tools'><div class='filter-tabs' aria-label='送信結果で絞り込み'>${filters.map(([key,label])=>`<button data-filter='${key}' aria-pressed='${historyFilter===key}' class='${historyFilter===key ? 'active' : ''}'>${label}</button>`).join('')}</div>${searchBox('送信履歴を検索')}</div><section class='history-panel' aria-label='送信結果'><div id='notification-results'>${notificationResults()}</div></section><p class='history-caption'>全アカウントの最新100件から表示・検索しています（受信日時の順）。</p>${state.mode==='demo' ? button('サンプル通知で試す',"id='sample-notification'",'text-button','plus') : ''}`;
}
function sourceView() {
  const map=state.user.mapping;
  const received=state.mode!=='demo' && state.stats.events>0;
  const configured=state.feeds.filter(f=>f.webhook_configured).length;
  return heading('設定','Xの投稿通知を受け取る方法と、Discordへの送信先を設定します。')+`
    <section class='connection-list' aria-label='X・Discordとの接続'>
      <div class='connection-row'><h2 class='service-name'>X</h2><p class='service-copy'>Xの投稿通知を受け取る</p><span class='service-state status ${received ? 'enabled' : 'paused'}'>${received ? '通知が届いたことがあります' : 'まだ通知が届いていません'}</span>${button('投稿通知の受け取り方',"data-expand='x-connection'",'primary')}</div>
      <details class='connection-detail' id='x-connection'><summary>投稿通知の受け取り設定</summary><div class='details-body'>
        <p>投稿通知を送るツールに、下のPostRelayの受け取りURLを設定してください。</p>
        <div class='receiver-row'>${receiverUrl ? `<code id='receiver-url'>${esc(receiverUrl)}</code>${button('URLをコピー',"id='copy-source'",'secondary','copy')}` : '<p class=receiver-placeholder>受け取りURLを作成すると、ここに表示されます。</p>'}</div>
        ${button(receiverUrl ? '受け取りURLを作り直す' : '受け取りURLを作成',"id='rotate-source'",receiverUrl ? 'secondary' : 'primary')}
        <p class='field-help'>このURLは第三者に共有しないでください。作り直すと、以前のURLでは通知を受け取れなくなります。</p>
        <details class='simple-details compact'><summary>Angelic-Angelの設定方法</summary><p>Docker構成では、サーバーで接続設定を開き、この受け取りURLを入力します。手順はリポジトリのサーバー起動ガイドを確認してください。通知するXアカウントは、接続元のXアカウントでフォローし、投稿通知をオンにする必要があります。</p></details>
      </div></details>
      <div class='connection-row'><h2 class='service-name'>Discord</h2><p class='service-copy'>Discordに送信する</p><span class='service-state status paused'>${configured ? `送信先URLを${configured}件設定済み` : '送信先URLが未設定'}</span>${button('Discordの送信先を設定',"data-expand='discord-connection'",'primary')}</div>
      <details class='connection-detail' id='discord-connection'><summary>アカウントごとの送信先</summary><div class='details-body'>
        <p>${state.mode==='demo' ? 'デモでは実際の送信先を設定せず、サンプル通知で試せます。Discordへの送信はありません。' : '各通知設定の「Discordに送信するための設定」に、チャンネルの送信先URL（Webhook）を入力してください。'}</p>
        ${state.feeds.length ? `<div class='destination-list'>${state.feeds.map(f=>`<div><span>@${esc(f.handle)} → #${esc(f.channel)}</span>${button(state.mode==='demo' ? 'デモの設定を編集' : '送信先を設定',`data-edit='${f.id}' data-destination aria-label='@${esc(f.handle)} → #${esc(f.channel)}の${state.mode==='demo' ? 'デモの設定を編集' : '送信先を設定'}'`,'outline-primary small-button')}</div>`).join('')}</div>` : button('通知するアカウントを追加','data-add','primary','plus')}
      </div></details>
    </section>
    <details class='form-details advanced-connection' id='mapping-details'><summary>連携ツールの詳細設定</summary><div class='details-body'><p>接続したツールの説明に従い、通知データの項目名を指定してください。</p><form id='mapping-form'><div class='mapping-grid'>${[['id','投稿ID'],['author','Xのユーザー名'],['text','通知本文'],['url','投稿URL'],['kind','投稿種別（任意）'],['visibility','公開範囲（任意）']].map(([key,label])=>`<label>${label}<input name='${key}' value='${esc(map[key] || (key==='kind' || key==='visibility' ? '' : key))}' ${['id','author','text','url'].includes(key) ? 'required' : ''}></label>`).join('')}</div><p class='field-help'>入れ子の項目はnotification.bodyのように指定します。投稿種別はpost / reply / repost、公開範囲はpublicです。</p>${button('連携設定を保存',"type='submit'")}</form></div></details>
    <details class='simple-details'><summary>届けられる通知の範囲</summary><p>接続したツールから届いた公開投稿の通知を扱います。ツールから届かない投稿や、通知に含まれない本文・画像は届けられません。</p></details>
    <div class='settings-links'><button class='text-button' data-go='history'>すべての送信履歴</button><button class='text-button' data-logout>ログアウト</button></div>`;
}
function renderApp() {
  shell();renderView();
}
function renderView() {
  document.title=`${current==='editor' && editing ? '通知先と条件を編集' : titles[current]} — PostRelay`;
  const view=document.querySelector('#view');
  view.innerHTML=({feeds:feedsView,editor:editorView,history:historyView,source:sourceView})[current]();
  if(current==='editor') hydrateEditor();
  if(current==='source' && ['x','discord'].includes(settingsSection)) document.querySelector('#'+settingsSection+'-connection').open=true;
  bindView();
}
function renderResults() {
  if(current==='feeds') {
    document.querySelector('#rule-results').innerHTML=ruleResults();
    const count=document.querySelector('#result-count');if(count) count.textContent=`${filteredFeeds().length}件`;
  } else document.querySelector('#notification-results').innerHTML=notificationResults();
  const clear=document.querySelector('#clear-search');if(clear) clear.hidden=!search;
  bindResults();
}
function clearSearch() {search='';const input=document.querySelector('#search');if(input) input.value='';renderResults();input?.focus();}
function bindResults() {
  document.querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>openFeed());
  document.querySelectorAll('[data-clear-search]').forEach(el=>el.onclick=clearSearch);
  document.querySelectorAll('[data-history]').forEach(el=>el.onclick=()=>navigate('history?feed='+encodeURIComponent(el.dataset.history)));
  document.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{
    openFeed(state.feeds.find(f=>f.id===el.dataset.edit));
    if(el.hasAttribute('data-destination') && state.mode!=='demo') {document.querySelector('#destination-details').open=true;form.elements.webhook_url.focus();}
  });
  document.querySelectorAll('[data-toggle]').forEach(el=>el.onclick=async()=>{
    const feed=state.feeds.find(f=>f.id===el.dataset.toggle);el.disabled=true;
    try {await api('/api/feeds/'+feed.id,{enabled:!feed.enabled});await updateAfterAction(`@${feed.handle} → #${feed.channel} の通知を${feed.enabled ? '停止' : '再開'}しました。`,`[data-toggle='${CSS.escape(feed.id)}']`);}
    catch(error) {toast(error.message);}finally {el.disabled=false;}
  });
  document.querySelectorAll('[data-retry]').forEach(el=>el.onclick=async()=>{
    el.disabled=true;
    try {await api('/api/jobs/'+el.dataset.retry+'/retry',{});await updateAfterAction('もう一度送信する依頼を受け付けました。結果は送信履歴で確認できます。');}
    catch(error) {toast(error.message);}finally {el.disabled=false;}
  });
}
function bindView() {
  bindResults();
  document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>navigate(el.dataset.go,'',current==='editor' && el.dataset.go===editorReturn));
  document.querySelectorAll('[data-logout]').forEach(el=>el.onclick=async()=>{
    try {await api('/api/logout',{});parkEditor();state=null;receiverUrl='';history.replaceState(null,'','#feeds');loginScreen();}
    catch(error) {toast(error.message);}
  });
  document.querySelector('#search')?.addEventListener('input',event=>{search=event.target.value;renderResults();});
  document.querySelector('#clear-search')?.addEventListener('click',clearSearch);
  document.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>{
    historyFilter=el.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item=>{item.classList.toggle('active',item===el);item.setAttribute('aria-pressed',String(item===el));});
    renderResults();
  });
  document.querySelectorAll('[data-expand]').forEach(el=>el.onclick=()=>{
    const details=document.getElementById(el.dataset.expand);details.open=true;
    details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  document.querySelector('#sample-notification')?.addEventListener('click',async event=>{
    const el=event.currentTarget;el.disabled=true;
    const feed=state.feeds.find(f=>f.id===historyFeed);
    try {await api('/api/demo/notification',feed ? {handle:feed.handle,text:feed.include[0] || '新しい機能を公開しました。'} : {});await updateAfterAction('サンプル通知を作成しました。','#sample-notification');}
    catch(error) {toast(error.message);}finally {el.disabled=false;}
  });
  document.querySelector('#rotate-source')?.addEventListener('click',()=>{
    document.querySelector('#source-title').textContent=receiverUrl ? '受け取りURLを作り直しますか？' : '受け取りURLを作成しますか？';
    document.querySelector('#source-description').textContent=(receiverUrl ? '作り直すと以前のURLは使えなくなります。' : 'すでにURLを作成している場合、以前のURLは使えなくなります。')+'接続したツールに設定したURLも、新しいものに変更してください。';
    document.querySelector('#issue-source').textContent=receiverUrl ? 'URLを作り直す' : 'URLを作成';
    document.querySelector('#source-error').textContent='';sourceDialog.showModal();document.querySelector('#cancel-source').focus();
  });
  document.querySelector('#copy-source')?.addEventListener('click',async()=>{
    try {await navigator.clipboard.writeText(receiverUrl);toast('受け取りURLをコピーしました。');}
    catch {toast('URLを選択してコピーしてください。');}
  });
  document.querySelector('#mapping-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const el=event.currentTarget.querySelector('[type=submit]');el.disabled=true;
    const mapping=Object.fromEntries([...new FormData(event.currentTarget)].filter(([,v])=>v));
    try {await api('/api/source/mapping',{mapping});await updateAfterAction('連携設定を保存しました。','',false);}
    catch(error) {toast(error.message);}finally {el.disabled=false;}
  });
}
form.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details) details.open=true;},true);
document.querySelector('#cancel-editor').addEventListener('click',()=>navigate(editorReturn,feedOpener,true));
form.addEventListener('submit',async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(form));
  for(const key of ['include','exclude']) data[key]=words(data[key]);
  for(const key of ['include_replies','include_reposts']) data[key]=form.elements[key].checked;
  if(editing && !data.webhook_url) delete data.webhook_url;
  const el=document.querySelector('#save-feed'),original=el.textContent,id=editing?.id;el.disabled=true;el.textContent='保存中…';
  try {
    await api(id ? '/api/feeds/'+id : '/api/feeds',data);
    try {await refresh(false);navigate(editorReturn,feedOpener,true);toast('通知設定を保存しました。');}
    catch {navigate(editorReturn,'',true);toast('保存しました。画面を更新できなかったため、再読み込みしてください。');}
  } catch(error) {const message=document.querySelector('#form-error');message.textContent=error.message;message.focus();}
  finally {el.disabled=false;el.textContent=original;}
});
document.querySelector('#cancel-source').addEventListener('click',()=>sourceDialog.close());
document.querySelector('#issue-source').addEventListener('click',async event=>{
  const el=event.currentTarget;el.disabled=true;
  try {
    receiverUrl=(await api('/api/source/rotate',{})).url;sourceDialog.close();settingsSection='x';renderView();focusTarget('#copy-source');toast('受け取りURLを作成しました。投稿通知を送るツールに設定してください。');
  } catch(error) {document.querySelector('#source-error').textContent=error.message;}
  finally {el.disabled=false;}
});
window.addEventListener('hashchange',()=>{if(state) {search='';historyFilter='all';readRoute();renderApp();focusTarget();}});
async function boot() {
  try {bootstrap=await api('/api/bootstrap');if(bootstrap.user) await refresh();else loginScreen();}
  catch {app.innerHTML=emptyState('ページを読み込めませんでした','接続を確認して、もう一度お試しください。',button('再読み込み',"id='reload-app'",'primary','refresh'));document.querySelector('#reload-app').onclick=()=>location.reload();}
}
setInterval(async()=>{
  if(!state || document.hidden || sourceDialog.open || current!=='history') return;
  try {
    await refresh(false);if(sourceDialog.open || current!=='history') return;
    const view=document.querySelector('#view'),focused=document.activeElement,inside=view?.contains(focused);
    if(inside && focused.matches('input,textarea,select,summary')) return;
    const selector=inside ? focusSelector(focused) : '';
    renderView();if(inside) focusTarget(selector);
  } catch {}
},5000);
boot();

function loginScreen(register=false) {
  document.title = 'PostRelay — 投稿通知をDiscordへ';
  app.innerHTML = `<main class='login-layout'><section class='login-intro'>${brand()}<div class='login-intro-copy'><span class='intro-line'>X → Discord</span><h1>新着を、<br>いつもの場所へ。</h1><p>Xの投稿通知を、<br>いつものDiscordチャンネルへ。</p><div class='login-route'><span>@account</span>${icon('arrow-narrow-right')}<span>${icon('brand-discord')} #channel</span></div></div><span class='login-footnote'>PostRelay</span></section><section class='login-main'><div class='login-card'><h2>${bootstrap.mode==='demo' ? 'PostRelayを試す' : register ? 'アカウントを作成' : 'ログイン'}</h2><p class='muted'>${bootstrap.mode==='demo' ? 'サンプル通知で、設定と送信履歴を試せます。' : register ? '通知先や条件を保存して使えます。' : 'メールアドレスとパスワードを入力してください。'}</p>${bootstrap.mode==='demo' ? `${button('デモを試す', "id='demo-login'", 'primary', 'arrow-right')}<div class='login-demo-note'>${icon('info-circle')} X・Discordに接続せずに試せます。Discordへの送信はありません。</div>` : `<form id='login-form'><label>メールアドレス<input name='email' type='email' required autocomplete='username' placeholder='you@example.com'></label><label>パスワード<input name='password' type='password' minlength='12' required autocomplete='${register ? 'new-password' : 'current-password'}'>${register ? '<small>12文字以上で設定してください。</small>' : ''}</label>${register ? "<label>登録キー<span class='optional'>管理者から案内された場合</span><input name='signup_key' type='password' autocomplete='off'></label>" : ''}<p id='login-error' class='error' role='alert'></p>${button(register ? 'アカウントを作成' : 'ログイン', "type='submit'")}</form><button id='switch-login' class='text-button'>${register ? 'ログインに戻る' : 'アカウントを作成する'}</button>`}</div></section></main>`;
  document.querySelector('#demo-login')?.addEventListener('click', async event => {
    const target=event.currentTarget; target.disabled=true;
    try {await api('/api/demo', {}); await refresh();} catch(error) {toast(error.message); target.disabled=false;}
  });
  document.querySelector('#switch-login')?.addEventListener('click', () => loginScreen(!register));
  document.querySelector('#login-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const target=event.currentTarget.querySelector('[type=submit]'); target.disabled=true;
    try {await api(register ? '/api/register' : '/api/login', Object.fromEntries(new FormData(event.currentTarget))); await refresh();}
    catch(error) {document.querySelector('#login-error').textContent=error.message;} finally {target.disabled=false;}
  });
}

// Presentation enhancements are kept separate from route and form state.
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const disclosures = new WeakMap();
  const moving = new Set();
  let roomLayout = null;
  let roomFrame = 0;
  const pages = [
    ['feeds', '通知一覧', '一覧', 'bell'],
    ['editor', '通知設定を追加', '追加', 'plus'],
    ['history', '送信履歴', '履歴', 'history'],
    ['source', '設定', '設定', 'plug'],
  ];

  function releaseViewportRoom() {
    app.classList.remove('disclosure-scroll-room');
    app.style.removeProperty('--disclosure-min-height');
    roomLayout = null;
  }

  function retainViewportRoom() {
    roomLayout = app.querySelector('.layout');
    if (!roomLayout) return;
    // Page shortening must not clamp the reader's current scroll position.
    const appTop = app.getBoundingClientRect().top + window.scrollY;
    app.style.setProperty('--disclosure-min-height', `${Math.ceil(window.scrollY + window.innerHeight - appTop)}px`);
    app.classList.add('disclosure-scroll-room');
  }

  function reconcileViewportRoom() {
    if (!roomLayout) return;
    const naturalBottom = roomLayout.getBoundingClientRect().bottom + window.scrollY;
    if (!moving.size && naturalBottom >= window.scrollY + window.innerHeight - 1) releaseViewportRoom();
    else retainViewportRoom();
  }

  function settleViewportMotion() {
    if (!moving.size) app.classList.remove('disclosure-motion');
    reconcileViewportRoom();
  }

  function closedHeight(details) {
    if (details.classList.contains('connection-detail')) return 0;
    const style = getComputedStyle(details);
    return details.querySelector(':scope > summary').getBoundingClientRect().height
      + ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
  }

  function showExpandedState(details, expanded) {
    details.dataset.expanded = String(expanded);
    details.querySelector(':scope > summary').setAttribute('aria-expanded', String(expanded));
    if (details.id) document.querySelectorAll(`[data-expand='${CSS.escape(details.id)}']`).forEach(trigger => {
      trigger.setAttribute('aria-controls', details.id);
      trigger.setAttribute('aria-expanded', String(expanded));
    });
  }

  function setDisclosure(details, expanded, fromHeight) {
    const record = disclosures.get(details);
    const startHeight = fromHeight ?? details.getBoundingClientRect().height;
    if (app.contains(details)) {
      retainViewportRoom();
      app.classList.add('disclosure-motion');
    }
    record.animation?.cancel();
    record.animation = null;
    moving.delete(details);
    record.expanded = expanded;
    showExpandedState(details, expanded);
    if (!expanded && details.contains(document.activeElement)
        && document.activeElement !== details.querySelector(':scope > summary')) {
      details.querySelector(':scope > summary').focus({preventScroll: true});
    }
    // Keep native content visible until the closing motion is complete.
    details.open = true;
    const endHeight = expanded ? details.getBoundingClientRect().height : closedHeight(details);
    const finish = () => {
      record.animation = null;
      moving.delete(details);
      details.style.overflow = record.overflow;
      details.open = expanded;
      settleViewportMotion();
    };
    if (reducedMotion.matches || !details.isConnected || Math.abs(startHeight - endHeight) < 1) {
      finish();
      return;
    }
    details.style.overflow = 'hidden';
    const animation = details.animate(
      [{height: `${startHeight}px`}, {height: `${endHeight}px`}],
      {duration: expanded ? 380 : 320, easing: 'cubic-bezier(.4, 0, .2, 1)'}
    );
    record.animation = animation;
    moving.add(details);
    animation.onfinish = () => { if (record.animation === animation) finish(); };
  }

  function enhanceDisclosure(details) {
    if (disclosures.has(details)) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;
    const record = {expanded: details.open, animation: null, overflow: details.style.overflow};
    disclosures.set(details, record);
    showExpandedState(details, details.open);
    summary.addEventListener('click', event => {
      if (event.defaultPrevented || event.target.closest('a, button, input, select, textarea')) return;
      event.preventDefault();
      setDisclosure(details, !record.expanded);
    });
    details.addEventListener('toggle', () => {
      if (details.open === record.expanded) return;
      if (details.open && record.animation) return;
      // Existing form validation and destination links may open details directly.
      if (details.open) setDisclosure(details, true, closedHeight(details));
      else {
        record.animation?.cancel();
        record.animation = null;
        moving.delete(details);
        details.style.overflow = record.overflow;
        record.expanded = false;
        showExpandedState(details, false);
        settleViewportMotion();
      }
    });
  }

  function mountNavigation() {
    const layout = app.querySelector('.layout');
    if (!layout) return;
    layout.classList.add('with-navigation');
    let nav = layout.querySelector('.site-navigation');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'site-navigation';
      nav.setAttribute('aria-label', '画面一覧');
      nav.innerHTML = pages.map(([route, label, short, symbol]) =>
        `<a id='nav-${route}' class='nav-link' href='#${route}' data-page='${route}' aria-label='${label}'>${icon(symbol)}<span class='nav-label'>${label}</span><span class='nav-short' aria-hidden='true'>${short}</span></a>`
      ).join('');
      nav.addEventListener('click', event => {
        const link = event.target.closest('.nav-link');
        if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const route = link.dataset.page;
        if (route === 'editor') {
          if (current === 'editor') return;
          openFeed();
        } else navigate(route);
        window.scrollTo(0, 0);
      });
      layout.querySelector('.site-header').after(nav);
    }
    nav.querySelectorAll('.nav-link').forEach(link => {
      if (link.dataset.page === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const editingPage = current === 'editor' && Boolean(editing);
    const editorLink = nav.querySelector('[data-page="editor"]');
    const editorLabel = editingPage ? '通知設定を編集' : '通知設定を追加';
    editorLink.setAttribute('aria-label', editorLabel);
    const fullLabel = editorLink.querySelector('.nav-label');
    const shortLabel = editorLink.querySelector('.nav-short');
    if (fullLabel.textContent !== editorLabel) fullLabel.textContent = editorLabel;
    if (shortLabel.textContent !== (editingPage ? '編集' : '追加')) shortLabel.textContent = editingPage ? '編集' : '追加';
  }

  function enhance() {
    if (roomLayout && roomLayout !== app.querySelector('.layout')) {
      for (const details of moving) {
        if (!app.contains(details)) {
          const record = disclosures.get(details);
          record.animation?.cancel();
          record.animation = null;
          details.style.overflow = record.overflow;
          details.open = record.expanded;
          moving.delete(details);
        }
      }
      releaseViewportRoom();
      if (!moving.size) app.classList.remove('disclosure-motion');
    }
    mountNavigation();
    document.querySelectorAll('details').forEach(enhanceDisclosure);
  }

  // The extra room contracts only as the reader scrolls back toward the content.
  function scheduleViewportRoom() {
    if (!roomLayout || roomFrame) return;
    roomFrame = requestAnimationFrame(() => {
      roomFrame = 0;
      reconcileViewportRoom();
    });
  }
  window.addEventListener('scroll', scheduleViewportRoom, {passive: true});
  window.addEventListener('resize', scheduleViewportRoom);

  // Use the same motion for connection buttons and native summaries.
  document.addEventListener('invalid', event => {
    const details = event.target.closest('details');
    if (!details) return;
    enhanceDisclosure(details);
    if (!disclosures.get(details).expanded) setDisclosure(details, true);
  }, true);
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-expand]');
    if (!trigger) return;
    const details = document.getElementById(trigger.dataset.expand);
    if (!details) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enhanceDisclosure(details);
    setDisclosure(details, !disclosures.get(details).expanded);
  }, true);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) [...moving].forEach(details => {
      const record = disclosures.get(details);
      setDisclosure(details, record.expanded);
    });
  });
  new MutationObserver(enhance).observe(app, {childList: true, subtree: true});
  enhance();
})();
