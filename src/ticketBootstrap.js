import { Client } from 'discord.js';
import { pool } from './db.js';

import { initializeTicketSystem } from './ticketSystem.js';
import { applyTicketSupportBanner } from './ticketSupportBanner.js';

const initializedClients = new WeakSet();
const originalLogin = Client.prototype.login;

Client.prototype.login = function patchedLogin(...args) {
  const client = this;

  if (!initializedClients.has(client)) {
    initializedClients.add(client);

    client.once('clientReady', () => {
      void (async () => {
        await initializeTicketSystem({
          client,
          pool,
          footerText: 'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC.'
        });
        await applyTicketSupportBanner(client);
      })().catch(async error => {
        console.error('❌ [TICKETS] Ticket system initialization failed:', error);
      });
    });
  }

  return originalLogin.apply(client, args);
};

console.log('✅ [TICKETS] Ticket bootstrap armed.');
