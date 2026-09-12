import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const botSource = await readFile(new URL('../src/bot.js', import.meta.url), 'utf8');
const startSource = await readFile(new URL('../src/start.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../src/ticketBootstrap.js', import.meta.url), 'utf8');
const supportBannerSource = await readFile(new URL('../src/supportBannerCommand.js', import.meta.url), 'utf8');
const blacklistSource = await readFile(new URL('../src/blacklistBridge.js', import.meta.url), 'utf8');
const serverModeSource = await readFile(new URL('../src/serverModeBridge.js', import.meta.url), 'utf8');

test('existing mods button handler ignores TLC ticket button ids', () => {
  assert.match(botSource, /const isShowMods = interaction\.customId === 'show_mods';/);
  assert.match(botSource, /const isModsPage = interaction\.customId\.startsWith\('mods_page_'\);/);
  assert.match(botSource, /if \(!isShowMods && !isModsPage\) return;/);
});

test('ticket initialization is explicit instead of patching Client.login', () => {
  assert.doesNotMatch(bootstrapSource, /Client\.prototype\.login/);
  assert.match(bootstrapSource, /export async function initializeTicketBootstrap\(client\)/);
  assert.match(botSource, /import \{ initializeTicketBootstrap \} from '\.\/ticketBootstrap\.js';/);
  assert.match(botSource, /await initializeTicketBootstrap\(client\);/);
  assert.doesNotMatch(startSource, /import '\.\/ticketBootstrap\.js';/);
});

test('support banner handler is explicit instead of patching Client.login', () => {
  assert.doesNotMatch(supportBannerSource, /Client\.prototype\.login/);
  assert.match(
    supportBannerSource,
    /export function registerSupportBannerCommandHandler\(client\)/
  );
  assert.match(botSource, /registerSupportBannerCommandHandler\(client\);/);
  assert.doesNotMatch(startSource, /import '\.\/supportBannerCommand\.js';/);
});

test('ticket startup applies the exact support banner after initialization', () => {
  const initializeCall = bootstrapSource.indexOf('await initializeTicketSystem({');
  const bannerCall = bootstrapSource.indexOf('await applyTicketSupportBanner(client);');

  assert.ok(initializeCall >= 0, 'ticket initialization call is missing');
  assert.ok(bannerCall >= 0, 'support banner call is missing');
  assert.ok(initializeCall < bannerCall, 'support banner must be applied after ticket initialization');
});


test('blacklist interactions use an explicit client handler instead of Client.emit patching', () => {
  assert.doesNotMatch(blacklistSource, /Client\.prototype\.emit/);
  assert.match(blacklistSource, /export async function initializeBlacklistBridge\(client\)/);
  assert.match(botSource, /await initializeBlacklistBridge\(client\);/);
  assert.doesNotMatch(startSource, /import '\.\/blacklistBridge\.js';/);
});

test('server mode interactions use an explicit client handler instead of Client.emit patching', () => {
  assert.doesNotMatch(serverModeSource, /Client\.prototype\.emit/);
  assert.match(serverModeSource, /export async function initializeServerModeBridge\(client\)/);
  assert.match(botSource, /await initializeServerModeBridge\(client\);/);
  assert.doesNotMatch(startSource, /import '\.\/serverModeBridge\.js';/);
});


test('server mode automation guards replace Discord.js message/channel monkey patches', () => {
  assert.doesNotMatch(serverModeSource, /Message\.prototype\.edit/);
  assert.doesNotMatch(serverModeSource, /TextChannel\.prototype\.send/);
  assert.doesNotMatch(serverModeSource, /\.setPresence\s*=\s*async/);
  assert.match(serverModeSource, /export function isServerModeManual\(\)/);
  assert.match(botSource, /if \(isServerModeManual\(\)\) return;/);
  assert.match(
    botSource,
    /Server status alert suppressed while manual server mode is active/
  );
});
