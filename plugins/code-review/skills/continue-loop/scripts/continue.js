#!/usr/bin/env node

'use strict';

/**
 * Skill-local entry point for /continue-loop.
 *
 * The canonical implementation lives beside its helper module (iterate.js)
 * under code-review-loop/scripts/. This thin wrapper keeps the /continue-loop
 * skill self-contained so it can be discovered, validated, and reasoned about
 * on its own, without changing how the shared module locates iterate.js.
 *
 * Arguments (process.argv) are forwarded unchanged; require() triggers the
 * shared script's main() on load.
 */

require('../../code-review-loop/scripts/continue.js');
