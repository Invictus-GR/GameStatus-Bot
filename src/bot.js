import {
  Client,
  GatewayIntentBits,
  ActivityType
} from 'discord.js';

import fetch from 'node-fetch';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SERVER_URL =
  'https://www.armahq.com/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300';

async function updateServerStatus() {
  try {
    const response = await fetch(SERVER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    const playersMatch = text.match(/(\d+)\s*\/\s*(\d+)/);

    const queueMatch = text.match(
      /Queue\s*(\d+)\s*\/\s*(\d+)\s*waiting/i
    );

    if (!playersMatch) {
      throw new Error('Player count not found');
    }

    const players = Number(playersMatch[1]);
    const maxPlayers = Number(playersMatch[2]);

    const queue = queueMatch
      ? Number(queueMatch[1])
      : 0;

    const status =
      queue > 0
        ? `🟢 ONLINE | (+${queue}) ${players}/${maxPlayers}`
        : `🟢 ONLINE | ${players}/${maxPlayers}`;

    await client.user.setPresence({
      activities: [
        {
          name: status,
          type: ActivityType.Custom
        }
      ],
      status: 'online'
    });

    console.log(`Status updated: ${status}`);

  } catch (error) {
    console.error('Server status error:', error.message);

    await client.user.setPresence({
      activities: [
        {
          name: '🔴 SERVER OFFLINE',
          type: ActivityType.Custom
        }
      ],
      status: 'idle'
    });
  }
}

client.once('clientReady', () => {
  console.log(`Discord bot connected as ${client.user.tag}`);

  updateServerStatus();

  setInterval(updateServerStatus, 120000);
});

client.login(process.env.DISCORD_BOT_TOKEN);
