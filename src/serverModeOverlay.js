import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  MessageFlags,
  SlashCommandBuilder,
  TextChannel
} from 'discord.js';
import pg from 'pg';

const { Pool } = pg;

const SERVER_URL =
  'https://www.armahq.com/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300';
const SERVER_NAME =
  'EU | TLC | THE LAST COALITION | UHC | PVP | PERSISTENT RANK | DRONES';
const STATUS_CHANNEL_ID = '1543309765243834428';
const FOOTER_TEXT =
  'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC';
const OWNER_ID = process.env.FAILSAFE_OWNER_ID;
const SERVER_QUEUE_CAPACITY = 25;
const STATE_TABLE = 'server_mode_state';

const MODE_CONFIG = Object.freeze({
  maintenance: {
    label: 'MAINTENANCE',
    emoji: '🛠️',
    color: 0xFEE75C,
    presence: '🛠️ MAINTENANCE'
  },
  testing: {
    label: 'TESTING',
    emoji: '🧪',
    color: 0x5865F2,
    presence: '🧪 TESTING'
  },
  'final-checks': {
    label: 'FINAL CHECKS',
    emoji: '🔍',
    color: 0x9B59B6,
    presence: '🔍 FINAL CHECKS'
  },
  ready: {
    label: 'READY',
    emoji: '🟢',
    color: 0x57F287,
    presence: '🟢 READY'
  }
});

const SERVER_ALERT_TITLES = new Set([
  '🔴 TLC SERVER DOWN',
  '🟢 TLC SERVER ONLINE AGAIN'
]);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

let serverMode = 'live';
let serverModeUpdatedAt = new Date();
let capturedClient = null;
let originalUserSetPresence = null;

function getEmbedTitle(embed) {
  return embed?.data?.title ?? embed?.title ?? null;
}

function isManualMode() {
  return Object.hasOwn(MODE_CONFIG, serverMode);
}

async function initializeAndRestoreServerMode() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ [SERVERMODE] DATABASE_URL missing; defaulting to live mode.');
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (
          mode IN ('live', 'maintenance', 'testing', 'final-checks', 'ready')
        ),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const result = await pool.query(`
      SELECT mode, updated_at
      FROM ${STATE_TABLE}
      WHERE id = 1;
    `);

    if (result.rows.length === 0) {
      await pool.query(`
        INSERT INTO ${STATE_TABLE} (id, mode, updated_at)
        VALUES (1, 'live', NOW());
      `);
      serverMode = 'live';
      serverModeUpdatedAt = new Date();
      console.log('✅ [SERVERMODE] Initialized in live mode.');
      return;
    }

    const restoredMode = result.rows[0].mode;
    serverMode = restoredMode === 'live' || Object.hasOwn(MODE_CONFIG, restoredMode)
      ? restoredMode
      : 'live';
    serverModeUpdatedAt = new Date(result.rows[0].updated_at);
    console.log(`✅ [SERVERMODE] Restored mode: ${serverMode}.`);
  } catch (error) {
    console.error('❌ [SERVERMODE] Could not restore state; defaulting to live mode:', error);
    serverMode = 'live';
    serverModeUpdatedAt = new Date();
  }
}

async function persistServerMode(mode) {
  const result = await pool.query(`
    INSERT INTO ${STATE_TABLE} (id, mode, updated_at)
    VALUES (1, $1::text, NOW())
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode,
      updated_at = EXCLUDED.updated_at
    RETURNING mode, updated_at;
  `, [mode]);

  serverMode = result.rows[0].mode;
  serverModeUpdatedAt = new Date(result.rows[0].updated_at);
}

await initializeAndRestoreServerMode();

const originalMessageEdit = Message.prototype.edit;
Message.prototype.edit = async function serverModeProtectedEdit(payload) {
  const title = getEmbedTitle(payload?.embeds?.[0]);

  if (
    isManualMode() &&
    this.channelId === STATUS_CHANNEL_ID &&
    title === SERVER_NAME
  ) {
    return this;
  }

  return originalMessageEdit.call(this, payload);
};

const originalTextChannelSend = TextChannel.prototype.send;
TextChannel.prototype.send = async function serverModeProtectedSend(payload) {
  const title = getEmbedTitle(payload?.embeds?.[0]);

  if (
    isManualMode() &&
    this.id === STATUS_CHANNEL_ID &&
    SERVER_ALERT_TITLES.has(title)
  ) {
    console.log(`ℹ️ [SERVERMODE] Suppressed ${title} while ${serverMode} is active.`);
    return { id: `servermode-suppressed-${Date.now()}` };
  }

  return originalTextChannelSend.call(this, payload);
};

function createManualComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('show_mods')
        .setLabel('Show Mods')
        .setEmoji('📦')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    )
  ];
}

function createLiveComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('View Server')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Link)
        .setURL(SERVER_URL),
      new ButtonBuilder()
        .setCustomId('show_mods')
        .setLabel('Show Mods')
        .setEmoji('📦')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function getStatusChannel() {
  if (!capturedClient) {
    throw new Error('Discord client is not ready.');
  }

  const channel = await capturedClient.channels.fetch(STATUS_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Status channel not found.');
  }
  return channel;
}

async function getStatusMessage() {
  const channel = await getStatusChannel();
  const messages = await channel.messages.fetch({ limit: 50 });

  const existing = messages.find(message =>
    message.author.id === capturedClient.user.id &&
    message.embeds?.[0]?.title === SERVER_NAME
  );

  if (existing) return existing;

  return originalTextChannelSend.call(channel, 'Loading server status...');
}

async function editStatusMessage(payload) {
  const message = await getStatusMessage();
  return originalMessageEdit.call(message, payload);
}

async function renderManualPanel() {
  if (!isManualMode()) return;

  const channel = await getStatusChannel();
  const config = MODE_CONFIG[serverMode];
  const unix = Math.floor(serverModeUpdatedAt.getTime() / 1000);
  const guildIcon = channel.guild?.iconURL({ extension: 'png', size: 256 });

  const embed = new EmbedBuilder()
    .setTitle(SERVER_NAME)
    .setDescription('### 🔴 SERVER OFFLINE')
    .addFields(
      {
        name: '📡 Status',
        value: `**${config.emoji} ${config.label}**`,
        inline: true
      },
      {
        name: '🕒 Last Updated',
        value: `<t:${unix}:F>`,
        inline: false
      }
    )
    .setColor(config.color)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp(serverModeUpdatedAt);

  if (guildIcon) {
    embed.setThumbnail(guildIcon);
  }

  await editStatusMessage({
    content: '',
    embeds: [embed],
    components: createManualComponents()
  });

  if (originalUserSetPresence) {
    await originalUserSetPresence({
      activities: [{ name: config.presence, type: ActivityType.Custom }],
      status: serverMode === 'ready' ? 'online' : 'idle'
    });
  }
}

function parseLiveServerPage(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  if (/\b(?:Server|Status)\s*:?\s*Offline\b/i.test(text)) {
    return { isOnline: false, players: 0, maxPlayers: 128, queue: 0 };
  }

  const playersMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
  const queueMatch = text.match(/Queue\s*(\d+)\s*\/\s*(\d+)\s*waiting/i);

  if (!playersMatch) {
    throw new Error('Player count was not found.');
  }

  return {
    isOnline: true,
    players: Number(playersMatch[1]),
    maxPlayers: Number(playersMatch[2]),
    queue: queueMatch ? Number(queueMatch[1]) : 0
  };
}

function formatCapacity(value, maximum, segments = 20) {
  const safeMaximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const safeValue = Math.min(safeMaximum, Math.max(0, Number(value) || 0));
  const percentage = Math.round((safeValue / safeMaximum) * 100);
  const filled = Math.round((safeValue / safeMaximum) * segments);
  const bar = '█'.repeat(filled) + '░'.repeat(segments - filled);
  return `\`\`\`${bar}\`\`\`\n**${safeValue}/${safeMaximum}** • ${percentage}%`;
}

async function renderLiveSnapshot() {
  const channel = await getStatusChannel();
  const guildIcon = channel.guild?.iconURL({ extension: 'png', size: 256 });
  const embed = new EmbedBuilder()
    .setTitle(SERVER_NAME)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;

    try {
      response = await fetch(SERVER_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`ArmaHQ returned HTTP ${response.status}`);
    }

    const data = parseLiveServerPage(await response.text());

    if (data.isOnline) {
      embed
        .setDescription('### 🟢 SERVER ONLINE')
        .addFields(
          {
            name: '👥 Player Capacity',
            value: formatCapacity(data.players, data.maxPlayers),
            inline: false
          },
          {
            name: '⏳ Queue Capacity',
            value: formatCapacity(data.queue, SERVER_QUEUE_CAPACITY),
            inline: false
          },
          { name: '📡 Status', value: '**ONLINE**', inline: true },
          { name: '📦 Active Mods', value: '**Updating…**', inline: true }
        )
        .setColor(0x57F287);
    } else {
      embed
        .setDescription('### 🔴 SERVER OFFLINE')
        .addFields({ name: '📡 Status', value: '**OFFLINE**', inline: true })
        .setColor(0xED4245);
    }
  } catch (error) {
    embed
      .setDescription('### 🟠 STATUS DATA UNAVAILABLE')
      .addFields({
        name: '📡 Data Source',
        value: '**ArmaHQ temporarily unavailable**',
        inline: true
      })
      .setColor(0xFEE75C);
    console.warn('⚠️ [SERVERMODE] Immediate live refresh failed:', error.message);
  }

  if (guildIcon) embed.setThumbnail(guildIcon);

  await editStatusMessage({
    content: '',
    embeds: [embed],
    components: createLiveComponents()
  });
}

const serverModeCommand = new SlashCommandBuilder()
  .setName('servermode')
  .setDescription('Control the TLC public server status mode')
  .addSubcommand(subcommand =>
    subcommand
      .setName('maintenance')
      .setDescription('Set the server status to Maintenance')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('testing')
      .setDescription('Set the server status to Testing')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('final-checks')
      .setDescription('Set the server status to Final Checks')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('ready')
      .setDescription('Set the server status to Ready')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('live')
      .setDescription('Return the status panel to live ArmaHQ monitoring')
  );

async function handleServerModeInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'servermode') {
    return;
  }

  if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
    await interaction.reply({
      content: '❌ You do not have permission to use this command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const requestedMode = interaction.options.getSubcommand();

  try {
    await persistServerMode(requestedMode);

    if (requestedMode === 'live') {
      if (originalUserSetPresence) {
        await originalUserSetPresence({
          activities: [{ name: '🟠 STATUS REFRESHING', type: ActivityType.Custom }],
          status: 'idle'
        });
      }

      await renderLiveSnapshot();
      await interaction.editReply(
        '✅ Server mode set to **LIVE**. Automatic ArmaHQ monitoring has control again.'
      );
      console.log('✅ [SERVERMODE] Returned to live ArmaHQ monitoring.');
      return;
    }

    await renderManualPanel();
    const config = MODE_CONFIG[requestedMode];
    await interaction.editReply(
      `✅ Server status set to **${config.emoji} ${config.label}**.`
    );
    console.log(`✅ [SERVERMODE] Manual status set to ${config.label}.`);
  } catch (error) {
    console.error('❌ [SERVERMODE] Command failed:', error);
    await interaction.editReply('❌ Could not update the server mode. Please try again.');
  }
}

function patchClientPresence(client) {
  if (!client.user || originalUserSetPresence) return;

  originalUserSetPresence = client.user.setPresence.bind(client.user);

  client.user.setPresence = async data => {
    if (isManualMode()) {
      return client.user;
    }
    return originalUserSetPresence(data);
  };
}

function patchGuildCommandRegistration(client) {
  const guild = client.guilds.cache.first();
  if (!guild) {
    console.error('❌ [SERVERMODE] No guild available for command registration patch.');
    return;
  }

  const commandManager = guild.commands;
  const originalSet = commandManager.set.bind(commandManager);

  commandManager.set = async (commands, guildId) => {
    const commandList = Array.isArray(commands) ? [...commands] : commands;

    if (Array.isArray(commandList)) {
      const alreadyIncluded = commandList.some(command => {
        const data = typeof command?.toJSON === 'function' ? command.toJSON() : command;
        return data?.name === 'servermode';
      });

      if (!alreadyIncluded) {
        commandList.push(serverModeCommand);
      }
    }

    const result = await originalSet(commandList, guildId);
    console.log('✅ [SERVERMODE] /servermode registered with the main command set.');
    return result;
  };
}

const originalClientLogin = Client.prototype.login;
Client.prototype.login = function serverModeAwareLogin(token) {
  capturedClient = this;
  this.on('interactionCreate', handleServerModeInteraction);

  this.prependOnceListener('clientReady', async () => {
    try {
      patchClientPresence(this);
      patchGuildCommandRegistration(this);
    } catch (error) {
      console.error('❌ [SERVERMODE] Startup integration failed:', error);
    }
  });

  this.once('clientReady', async () => {
    if (!isManualMode()) return;

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await renderManualPanel();
    } catch (error) {
      console.error('❌ [SERVERMODE] Could not restore manual panel:', error);
    }
  });

  return originalClientLogin.call(this, token);
};
