import { pool } from './db.js';

import { initializeTicketSystem } from './ticketSystem.js';
import { applyTicketSupportBanner } from './ticketSupportBanner.js';

const initializedClients = new WeakSet();

export async function initializeTicketBootstrap(client) {
  if (!client) {
    throw new TypeError('Discord client is required for ticket initialization.');
  }

  if (initializedClients.has(client)) return;
  initializedClients.add(client);

  try {
    await initializeTicketSystem({
      client,
      pool,
      footerText: 'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC.'
    });
    await applyTicketSupportBanner(client);
    console.log('✅ [TICKETS] Ticket bootstrap initialized.');
  } catch (error) {
    initializedClients.delete(client);
    throw error;
  }
}
