#!/usr/bin/env node

'use strict';

/**
 * Code Review Stop Hook
 *
 * Runs when Claude Code tries to exit. Checks if a review loop is active,
 * evaluates whether the Reviewer has issued "Approval", and either allows
 * the session to end or blocks the exit with a continuation prompt.
 *
 * Hook input (stdin): { "transcript_path": "/path/to/transcript.jsonl" }
 * Hook output (stdout): JSON block decision, or empty to allow exit.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATE_FILE = path.join('.claude', 'review-state.json');
const APPROVAL_SIGNAL = 'Approval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read stdin synchronously and return the raw string.
 * Works on both Unix (/dev/stdin) and Windows (process.stdin fd 0).
 */
function readStdin() {
  try {
    return fs.readFileSync('/dev/stdin', 'utf8');
  } catch (_) {
    // Fallback: read from fd 0 directly (Windows-compatible)
    try {
      return fs.readFileSync(0, 'utf8');
    } catch (err) {
      return '';
    }
  }
}

/**
 * Delete the state file, suppressing errors if it no longer exists.
 */
function deleteStateFile() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch (_) {
    // Already gone — that's fine
  }
}

/**
 * Write updated state back to the state file atomically via a temp file.
 * Follows immutability: returns a new state object, writes it to disk.
 *
 * @param {object} state
 * @returns {object} new state object
 */
function updateStateFile(state) {
  const newState = { ...state };
  const uniqueSuffix = Date.now() + Math.random().toString(36).slice(2);
  const tmpPath = STATE_FILE + '.tmp.' + uniqueSuffix;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(newState, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, STATE_FILE);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      // Ignore cleanup errors
    }
    throw err;
  }
  return newState;
}

/**
 * Parse a JSONL file and return all successfully parsed objects.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
function parseJsonl(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`Warning: Could not read file ${filePath}: ${err.message}\n`);
    return [];
  }
  const lines = raw.split('\n');
  const results = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch (_) {
      // Skip malformed lines
    }
  }
  return results;
}

/**
 * Extract the text content from the last assistant message in a JSONL transcript.
 *
 * @param {string} transcriptPath
 * @returns {{ text: string } | { error: string }}
 */
function extractLastAssistantMessage(transcriptPath) {
  let entries;
  try {
    entries = parseJsonl(transcriptPath);
  } catch (err) {
    return { error: `Failed to read transcript: ${err.message}` };
  }

  const assistantEntries = entries.filter(
    (entry) => entry && entry.role === 'assistant'
  );

  if (assistantEntries.length === 0) {
    return { error: 'No assistant messages found in transcript' };
  }

  const last = assistantEntries[assistantEntries.length - 1];

  // Extract text blocks from message.content[]
  let textContent = '';
  try {
    const content = last.message && Array.isArray(last.message.content)
      ? last.message.content
      : [];

    textContent = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  } catch (err) {
    return { error: `Failed to parse assistant message content: ${err.message}` };
  }

  if (!textContent) {
    return { error: 'Assistant message contained no text content' };
  }

  return { text: textContent };
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------
function main() {
  // Step 1: Read stdin (hook input JSON)
  const stdinRaw = readStdin();
  let hookInput = {};
  try {
    if (stdinRaw.trim()) {
      hookInput = JSON.parse(stdinRaw);
    }
  } catch (_) {
    // Non-fatal; we can still check state and transcript path
  }

  // Step 2: Check if state file exists
  if (!fs.existsSync(STATE_FILE)) {
    // No active review loop — allow exit silently
    process.exit(0);
  }

  // Step 3: Read and validate state
  let state;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    state = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`\u26A0\uFE0F  Code review loop: Failed to parse state file: ${err.message}\n`);
    deleteStateFile();
    process.exit(0);
  }

  // If loop is not active, allow exit
  if (!state.active) {
    process.exit(0);
  }

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const maxIterations = typeof state.max_iterations === 'number' ? state.max_iterations : 0;
  const reviewPrompt = typeof state.prompt === 'string' ? state.prompt : '';
  const model = typeof state.model === 'string' ? state.model : 'claude-opus-4-5';

  // Step 3b: Check max iterations
  if (maxIterations > 0 && iteration >= maxIterations) {
    process.stdout.write(
      '\uD83D\uDED1 Code review loop: Max iterations reached.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  // Step 4: Extract last assistant message from transcript
  const rawTranscriptPath = hookInput.transcript_path || '';

  if (!rawTranscriptPath) {
    process.stderr.write(
      '\u26A0\uFE0F  Code review loop: No transcript_path provided in hook input.\n' +
      '   Code review loop is stopping.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  const transcriptPath = path.resolve(rawTranscriptPath);

  if (!path.isAbsolute(transcriptPath)) {
    process.stderr.write(
      `\u26A0\uFE0F  Code review loop: transcript_path is not an absolute path: ${rawTranscriptPath}\n` +
      '   Code review loop is stopping.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  if (!fs.existsSync(transcriptPath)) {
    process.stderr.write(
      `\u26A0\uFE0F  Code review loop: Transcript file not found: ${transcriptPath}\n` +
      '   Code review loop is stopping.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  const messageResult = extractLastAssistantMessage(transcriptPath);

  if (messageResult.error) {
    process.stderr.write(
      `\u26A0\uFE0F  Code review loop: ${messageResult.error}\n` +
      '   Code review loop is stopping.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  const lastAssistantText = messageResult.text;

  // Step 5: Check for "Approval" signal (case-sensitive)
  if (lastAssistantText.includes(APPROVAL_SIGNAL)) {
    process.stdout.write(
      '\u2705 Code review loop: Approval detected. Session complete.\n'
    );
    deleteStateFile();
    process.exit(0);
  }

  // Step 6: Not approved — increment iteration and block the stop
  const nextIteration = iteration + 1;
  const newState = updateStateFile({ ...state, iteration: nextIteration });

  const systemMessage =
    `\uD83D\uDD04 Code Review iteration ${nextIteration} | Reviewer has not yet issued Approval. ` +
    'Continue addressing feedback.';

  const blockOutput = {
    decision: 'block',
    reason: reviewPrompt,
    systemMessage,
  };

  process.stdout.write(JSON.stringify(blockOutput, null, 2) + '\n');
  process.exit(0);
}

main();
