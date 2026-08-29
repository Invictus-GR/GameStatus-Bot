import {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
} from 'discord.js';

import fetch from 'node-fetch';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SERVER_URL =
  'https://www.armahq.com/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300';

const CHANNEL_ID = '1543309765243834428';
const CHANGELOG_CHANNEL_ID = '1535567655442972722';
const changelogCommand = new SlashCommandBuilder()
  .setName('changelog')
  .setDescription('Create a TLC server changelog');
let statusMessage = null;

async function getChannel() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Status channel not found');
  }

  return channel;
}

async function getStatusMessage() {
  const channel = await getChannel();

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

function createButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View Server')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Link)
      .setURL(SERVER_URL)
  );
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

    const channel = await getChannel();

    const guildIcon = channel.guild?.iconURL({
      extension: 'png',
      size: 256
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

    if (guildIcon) {
      embed.setThumbnail(guildIcon);
    }

    const message = await getStatusMessage();

    await message.edit({
      content: '',
      embeds: [embed],
      components: [createButton()]
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
      const channel = await getChannel();

      const guildIcon = channel.guild?.iconURL({
        extension: 'png',
        size: 256
      });

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

      if (guildIcon) {
        embed.setThumbnail(guildIcon);
      }

      const message = await getStatusMessage();

      await message.edit({
        content: '',
        embeds: [embed],
        components: [createButton()]
      });

    } catch {}
  }
}
client.on('interactionCreate', async interaction => {

  // /changelog command
  if (interaction.isChatInputCommand() && interaction.commandName === 'changelog') {

    const modal = new ModalBuilder()
      .setCustomId('changelogModal')
      .setTitle('TLC Server Changelog');

    const addedInput = new TextInputBuilder()
      .setCustomId('added')
      .setLabel('Added')
      .setPlaceholder('What was added?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    const fixedInput = new TextInputBuilder()
      .setCustomId('fixed')
      .setLabel('Fixed')
      .setPlaceholder('What was fixed?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    const changedInput = new TextInputBuilder()
      .setCustomId('changed')
      .setLabel('Changed')
      .setPlaceholder('What was changed?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    const removedInput = new TextInputBuilder()
      .setCustomId('removed')
      .setLabel('Removed')
      .setPlaceholder('What was removed?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(addedInput),
      new ActionRowBuilder().addComponents(fixedInput),
      new ActionRowBuilder().addComponents(changedInput),
      new ActionRowBuilder().addComponents(removedInput)
    );

    await interaction.showModal(modal);
  }

  // Changelog form submitted
  if (interaction.isModalSubmit() && interaction.customId === 'changelogModal') {

    const added = interaction.fields.getTextInputValue('added');
    const fixed = interaction.fields.getTextInputValue('fixed');
    const changed = interaction.fields.getTextInputValue('changed');
    const removed = interaction.fields.getTextInputValue('removed');

    const fields = [];

    if (added) {
      fields.push({
        name: '➕ Added',
        value: added
      });
    }

    if (fixed) {
      fields.push({
        name: '🔧 Fixed',
        value: fixed
      });
    }

    if (changed) {
      fields.push({
        name: '🔄 Changed',
        value: changed
      });
    }

    if (removed) {
      fields.push({
        name: '➖ Removed',
        value: removed
      });
    }

    if (fields.length === 0) {
      return interaction.reply({
        content: '❌ You need to fill in at least one field.',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛠️ TLC SERVER CHANGELOG')
      .setDescription('Latest changes to the TLC server.')
      .addFields(fields)
      .setColor(0x5865F2)
      .setFooter({
        text: `Updated by ${interaction.user.username}`
      })
      .setTimestamp();

    const channel = await client.channels.fetch(CHANGELOG_CHANNEL_ID);

    await channel.send({
  content: '@everyone',
  embeds: [embed],
  allowedMentions: {
    parse: ['everyone']
  }
});
      

    await interaction.reply({
      content: '✅ Changelog published.',
      ephemeral: true
    });
  }
});
client.once('clientReady', async () => {
  await client.application.commands.set([changelogCommand]);
console.log('/changelog command registered');
  console.log(`Discord bot connected as ${client.user.tag}`);

  updateServerStatus();

  setInterval(updateServerStatus, 120000);
});

client.login(process.env.DISCORD_BOT_TOKEN);
