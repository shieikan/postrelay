// Shared with the browser and Node tests; no network or secret handling.
(() => {
  'use strict';
  const usesWebPush = source => source?.web_push === true;
  const needsConfirmation = (source, feed) => usesWebPush(source) && !(feed.include_replies && feed.include_reposts);
  function postTypes(source, consent, configured) {
    if (usesWebPush(source)) {
      if (consent !== true) throw new Error('投稿の種類で絞り込まずに通知する、にチェックしてください。接続した通知元では、通常の投稿・返信・リポストを区別できません。');
      return {include_replies:true, include_reposts:true};
    }
    return {include_replies:configured.include_replies === true, include_reposts:configured.include_reposts === true};
  }
  const policy = Object.freeze({usesWebPush, needsConfirmation, postTypes});
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else globalThis.PostRelayNotificationSettings = policy;
})();
