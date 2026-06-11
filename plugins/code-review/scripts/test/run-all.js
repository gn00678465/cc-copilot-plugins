#!/usr/bin/env node

'use strict';

/**
 * Runs every smoke test in this directory in sequence.
 *
 * Usage: node plugins/code-review/scripts/test/run-all.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = __dirname;
const tests = fs.readdirSync(TEST_DIR)
  .filter((f) => f.startsWith('test-') && f.endsWith('.js'))
  .sort();

let failed = 0;
for (const t of tests) {
  process.stdout.write(`\n── ${t} ─────────────────────────────────\n`);
  const r = spawnSync(process.execPath, [path.join(TEST_DIR, t)], {
    stdio: 'inherit',
  });
  if (r.status !== 0) failed += 1;
}

if (failed) {
  process.stderr.write(`\n❌ ${failed} test file(s) failed.\n`);
  process.exit(1);
}
process.stdout.write('\n✅ All smoke tests passed.\n');
