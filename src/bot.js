import {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder
} from 'discord.js';

import fetch from 'node-fetch';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SERVER_URL =
  'https://www.armahq.com/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300';

const CHANNEL_ID = '1543309765243834428';

let statusMessage = null;

async function getStatusMessage() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Status channel not found');
  }

  if (statusMessage) return statusMessage;

  const messages = await channel.messages.fetch({ limit: 20 });

  statusMessage = messages.find(
    message => message.author.id === client.user.id
  );

  if (!statusMessage) {
    statusMessage = await channel.send('Loading server status...');
  }

  return statusMessage;
}

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
    const queue = queueMatch ? Number(queueMatch[1]) : 0;

    const playerDisplay =
      queue > 0
        ? `(+${queue}) ${players}/${maxPlayers}`
        : `${players}/${maxPlayers}`;

    await client.user.setPresence({
      activities: [
        {
          name: `🟢 ONLINE | ${playerDisplay}`,
          type: ActivityType.Custom
        }
      ],
      status: 'online'
    });

    const embed = new EmbedBuilder()
      .setTitle('⚔️ TLC Ultra Hardcore')
      .setDescription('### 🟢 SERVER ONLINE')
      .addFields(
        {
          name: '👥 Players',
          value: `**${playerDisplay}**`,
          inline: true
        },
        {
          name: '📡 Status',
          value: '**ONLINE**',
          inline: true
        }
      )
      .setColor(0x57F287)
      .setFooter({
        text: 'TLC Server Status • Auto-update every 2 minutes'
      })
      .setTimestamp();

    const message = await getStatusMessage();

    await message.edit({
      content: '',
      embeds: [embed]
    });

    console.log(`Status updated: 🟢 ONLINE | ${playerDisplay}`);

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

    try {
      const embed = new EmbedBuilder()
        .setTitle('⚔️ TLC Ultra Hardcore')
        .setDescription('### 🔴 SERVER OFFLINE')
        .addFields({
          name: '📡 Status',
          value: '**OFFLINE**',
          inline: true
        })
        .setColor(0xED4245)
        .setFooter({
          text: 'TLC Server Status • Auto-update every 2 minutes'
        })
        .setTimestamp();

      const message = await getStatusMessage();

      await message.edit({
        content: '',
        embeds: [embed]
      });

    } catch {}
  }
}

client.once('clientReady', () => {
  console.log(`Discord bot connected as ${client.user.tag}`);

  updateServerStatus();

  setInterval(updateServerStatus, 120000);
});

client.login(process.env.DISCORD_BOT_TOKEN);
