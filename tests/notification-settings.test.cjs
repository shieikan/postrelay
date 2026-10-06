const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../web/notification-settings.js');

test('web push requires explicit consent to notifications with unknown post kind', () => {
  assert.throws(() => policy.postTypes({web_push:true}, false, {}), /投稿の種類/);
});
test('consent covers all post kinds rather than pretending replies can be identified', () => {
  assert.deepEqual(policy.postTypes({web_push:true}, true, {include_replies:false,include_reposts:false}),
    {include_replies:true,include_reposts:true});
});
test('existing incompatible web-push settings visibly need confirmation', () => {
  assert.equal(policy.needsConfirmation({web_push:true}, {include_replies:true,include_reposts:false}), true);
  assert.equal(policy.needsConfirmation({web_push:true}, {include_replies:true,include_reposts:true}), false);
});
test('normalized sources retain their existing reply and repost choices', () => {
  const configured = {include_replies:true,include_reposts:false};
  assert.deepEqual(policy.postTypes({web_push:false}, false, configured), configured);
  assert.equal(policy.needsConfirmation({web_push:false}, configured), false);
});
