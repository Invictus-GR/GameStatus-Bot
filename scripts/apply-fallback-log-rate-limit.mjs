import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 anchor, found ${count}`);
  return text.replace(oldText, newText);
}

const dsPath = 'src/serverDataSources.js';
let ds = fs.readFileSync(dsPath, 'utf8');

ds = replaceOnce(
  ds,
  "const DEFAULT_BASE_URL = 'https://api.reforgermods.net/v2';",
  "import { fallbackWarning } from './fallbackWarning.js';\n\nconst DEFAULT_BASE_URL = 'https://api.reforgermods.net/v2';",
  'fallback warning import'
);

ds = replaceOnce(
  ds,
  `      console.warn(\n        'BattleMetrics status failed; trying ReforgerMods status fallback:',\n        battleMetricsError?.message || battleMetricsError\n      );`,
  `      fallbackWarning(\n        'battlemetrics-status',\n        '[WARN] BattleMetrics status unavailable; using ReforgerMods fallback:',\n        battleMetricsError?.message || battleMetricsError\n      );`,
  'BattleMetrics warning'
);

ds = replaceOnce(
  ds,
  "    console.warn(`ArmaHQ ${operation} failed; trying secondary source:`, primaryError?.message || primaryError);",
  "    fallbackWarning(\n      `armahq-${operation}`,\n      `[WARN] ArmaHQ ${operation} unavailable; using secondary source:`,\n      primaryError?.message || primaryError\n    );",
  'ArmaHQ warning'
);

fs.writeFileSync(dsPath, ds);

const botPath = 'src/bot.js';
let bot = fs.readFileSync(botPath, 'utf8');

bot = replaceOnce(
  bot,
  "        console.warn('Primary data source unavailable; using ReforgerMods fallback for status.');\n",
  '',
  'redundant status fallback warning'
);

bot = replaceOnce(
  bot,
  "  if (result.source === 'ReforgerMods') {\n    console.warn('Primary data source unavailable; using ReforgerMods fallback for mods.');\n  }\n\n",
  '',
  'redundant mods fallback warning'
);

fs.writeFileSync(botPath, bot);

const testPath = 'test/fallbackWarning.test.js';
fs.writeFileSync(testPath, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createRateLimitedWarning } from '../src/fallbackWarning.js';\n\ntest('rate-limited warning logs immediately and suppresses repeats inside interval', () => {\n  let now = 1000;\n  const logs = [];\n  const warn = createRateLimitedWarning({\n    intervalMs: 300000,\n    now: () => now,\n    log: (...args) => logs.push(args)\n  });\n\n  assert.equal(warn('armahq-status', 'first'), true);\n  assert.equal(warn('armahq-status', 'second'), false);\n  assert.deepEqual(logs, [['first']]);\n});\n\ntest('rate-limited warning logs again after interval', () => {\n  let now = 1000;\n  const logs = [];\n  const warn = createRateLimitedWarning({\n    intervalMs: 300000,\n    now: () => now,\n    log: (...args) => logs.push(args)\n  });\n\n  warn('battlemetrics-status', 'first');\n  now += 299999;\n  assert.equal(warn('battlemetrics-status', 'too soon'), false);\n  now += 1;\n  assert.equal(warn('battlemetrics-status', 'after interval'), true);\n  assert.deepEqual(logs, [['first'], ['after interval']]);\n});\n\ntest('rate limits are independent per warning key', () => {\n  const logs = [];\n  const warn = createRateLimitedWarning({\n    intervalMs: 300000,\n    now: () => 1000,\n    log: (...args) => logs.push(args)\n  });\n\n  assert.equal(warn('armahq-status', 'status'), true);\n  assert.equal(warn('armahq-mods', 'mods'), true);\n  assert.equal(warn('armahq-status', 'duplicate'), false);\n  assert.deepEqual(logs, [['status'], ['mods']]);\n});\n\ntest('rate limiter validates configuration and keys', () => {\n  assert.throws(() => createRateLimitedWarning({ intervalMs: -1 }), RangeError);\n  const warn = createRateLimitedWarning({ now: () => 1000, log: () => {} });\n  assert.throws(() => warn('', 'message'), TypeError);\n});\n`);
