import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const botSource = await readFile(new URL('../src/bot.js', import.meta.url), 'utf8');
const startSource = await readFile(new URL('../src/start.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../src/ticketBootstrap.js', import.meta.url), 'utf8');

test('existing mods button handler ignores TLC ticket button ids', () => {
  assert.match(botSource, /const isShowMods = interaction\.customId === 'show_mods';/);
  assert.match(botSource, /const isModsPage = interaction\.customId\.startsWith\('mods_page_'\);/);
  assert.match(botSource, /if \(!isShowMods && !isModsPage\) return;/);
});

test('ticket bootstrap is loaded before bot login module', () => {
  const ticketImport = startSource.indexOf("import './ticketBootstrap.js';");
  const botImport = startSource.indexOf("import './bot.js';");

  assert.ok(ticketImport >= 0, 'ticket bootstrap import is missing');
  assert.ok(botImport >= 0, 'bot import is missing');
  assert.ok(ticketImport < botImport, 'ticket bootstrap must load before bot.js');
});

test('ticket startup applies the exact support banner after initialization', () => {
  const initializeCall = bootstrapSource.indexOf('await initializeTicketSystem({');
  const bannerCall = bootstrapSource.indexOf('await applyTicketSupportBanner(client);');

  assert.ok(initializeCall >= 0, 'ticket initialization call is missing');
  assert.ok(bannerCall >= 0, 'support banner call is missing');
  assert.ok(initializeCall < bannerCall, 'support banner must be applied after ticket initialization');
});
