import { Client } from 'discord.js';
import pg from 'pg';

import { initializeTicketSystem } from './ticketSystem.js';

const { Pool } = pg;
const initializedClients = new WeakSet();
const originalLogin = Client.prototype.login;

Client.prototype.login = function patchedLogin(...args) {
  const client = this;

  if (!initializedClients.has(client)) {
    initializedClients.add(client);

    client.once('clientReady', () => {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL
      });

      void initializeTicketSystem({
        client,
        pool,
        footerText: 'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC.'
      }).catch(async error => {
        console.error('❌ [TICKETS] Ticket system initialization failed:', error);
        await pool.end().catch(() => {});
      });
    });
  }

  return originalLogin.apply(client, args);
};

console.log('✅ [TICKETS] Ticket bootstrap armed.');
