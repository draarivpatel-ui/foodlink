import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTests } from '../src/selftest.mjs';

const suite = runSelfTests();

test('self-test suite reports zero failures', () => {
  assert.equal(suite.failed, 0, suite.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`).join('\n'));
});

test('self-test suite runs at least 20 checks', () => {
  assert.ok(suite.results.length >= 20, `${suite.results.length} checks`);
});

test('every result carries name and detail', () => {
  for (const r of suite.results) {
    assert.ok(typeof r.name === 'string' && r.name.length > 0);
    assert.ok(typeof r.detail === 'string');
  }
});

// Re-assert each individual check as its own Node test for granularity.
for (const r of suite.results) {
  test(`selftest: ${r.name}`, () => {
    assert.ok(r.ok, r.detail);
  });
}
