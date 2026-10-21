'use strict';

const assert = require('assert');
const { PUBLISH_FILES, buildPublishPlan, publishDecision } = require('./publish-update');

assert.ok(Array.isArray(PUBLISH_FILES), 'publish file list must be exported');
assert.ok(PUBLISH_FILES.includes('server.js'));
assert.ok(PUBLISH_FILES.includes('public/app.js'));
assert.ok(PUBLISH_FILES.includes('public/pantry-logic.js'));
assert.ok(PUBLISH_FILES.includes('_pantrylogic-test.js'));
assert.ok(PUBLISH_FILES.includes('build-package.js'));
assert.ok(PUBLISH_FILES.includes('docs/product/2026-10-18-family-workspace-flow.md'));
assert.ok(!PUBLISH_FILES.some((p) => p.startsWith('data/')));
assert.ok(!PUBLISH_FILES.some((p) => p.startsWith('package/')));

const plan = buildPublishPlan({ root: __dirname });
assert.ok(plan.files.length >= 5);
assert.ok(plan.files.every((p) => !p.includes('\\data\\') && !p.includes('\\package\\')));
assert.ok(plan.commitMessage.includes('家庭菜单'));
assert.deepStrictEqual(publishDecision(''), { commit: false, push: true });
assert.deepStrictEqual(publishDecision('server.js'), { commit: true, push: true });

console.log('publish workflow self-test passed');
