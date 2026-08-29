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
const WARNING_LOG_CHANNEL_ID = '1540989189380640858';
const changelogCommand = new SlashCommandBuilder()
  .setName('changelog')
  .setDescription('Create a TLC server changelog');
const warnCommand = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Send an official TLC warning to a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to warn')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for the warning')
      .setRequired(true)
  );
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
    const allowedRoleIds = [
      '1529632873987178668',
      '1540715768625496135',
      '1538451886758170744'
    ];

    const hasPermission = interaction.member.roles.cache.some(
      role => allowedRoleIds.includes(role.id)
    );

    if (!hasPermission) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true
      });
    }
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
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'warn') return;

  const allowedRoleIds = [
    '1540715768625496135',
    '1529632873987178668',
    '1538451886758170744'
  ];

  const hasPermission = interaction.member.roles.cache.some(role =>
    allowedRoleIds.includes(role.id)
  );

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ You do not have permission to use this command.',
      ephemeral: true
    });
  }

  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');

  const warningEmbed = new EmbedBuilder()
    .setTitle('⚠️ TLC OFFICIAL WARNING')
    .setDescription(
      `You have received an official warning from **The Last Coalition Staff**.\n\n**Reason:**\n${reason}`
    )
    .setColor(0xED4245)
    .setFooter({ text: 'The Last Coalition' })
    .setTimestamp();

  let dmSent = true;

  try {
    await user.send({
      embeds: [warningEmbed]
    });
  } catch {
    dmSent = false;
  }

  const logChannel = await client.channels.fetch(WARNING_LOG_CHANNEL_ID);

  const logEmbed = new EmbedBuilder()
    .setTitle('⚠️ USER WARNING')
    .addFields(
      {
        name: 'User',
        value: `${user}`,
        inline: true
      },
      {
        name: 'Reason',
        value: reason
      },
      {
        name: 'DM Status',
        value: dmSent ? '✅ Delivered' : '❌ Could not deliver',
        inline: true
      }
    )
    .setColor(0xED4245)
    .setTimestamp();

  await logChannel.send({
    embeds: [logEmbed]
  });

  await interaction.reply({
    content: dmSent
      ? `✅ Warning sent to ${user}.`
      : `⚠️ Warning logged, but I could not DM ${user}. Their DMs may be closed.`,
    ephemeral: true
  });
});
client.once('clientReady', async () => {
  await client.application.commands.set([]);

  const guild = client.guilds.cache.first();
  await guild.commands.set([changelogCommand, warnCommand]);
console.log('/changelog command registered');
  console.log(`Discord bot connected as ${client.user.tag}`);

  updateServerStatus();

  setInterval(updateServerStatus, 120000);
});

client.login(process.env.DISCORD_BOT_TOKEN);
