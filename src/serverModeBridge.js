import {
  ActivityType,
  Client,
  EmbedBuilder,
  Message,
  MessageFlags,
  Routes,
  TextChannel
} from 'discord.js';
import pg from 'pg';

const { Pool } = pg;

const STATUS_CHANNEL_ID = '1543309765243834428';
const SERVER_NAME =
  'EU | TLC | THE LAST COALITION | UHC | PVP | PERSISTENT RANK | DRONES';
const FOOTER_TEXT =
  'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC';
const OWNER_ID = process.env.FAILSAFE_OWNER_ID;
const STATE_TABLE = 'server_mode_state';

const MODE_CONFIG = Object.freeze({
  maintenance: {
    label: 'MAINTENANCE',
    emoji: '🛠️',
    color: 0xFEE75C,
    presence: '🛠️ MAINTENANCE',
    presenceStatus: 'idle'
  },
  testing: {
    label: 'TESTING',
    emoji: '🧪',
    color: 0x5865F2,
    presence: '🧪 TESTING',
    presenceStatus: 'idle'
  },
  'final-checks': {
    label: 'FINAL CHECKS',
    emoji: '🔍',
    color: 0x9B59B6,
    presence: '🔍 FINAL CHECKS',
    presenceStatus: 'idle'
  },
  ready: {
    label: 'READY',
    emoji: '🟢',
    color: 0x57F287,
    presence: '🟢 READY',
    presenceStatus: 'online'
  }
});

const SERVER_ALERT_TITLES = new Set([
  '🔴 TLC SERVER DOWN',
  '🟢 TLC SERVER ONLINE AGAIN'
]);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

let bridgeMode = 'live';
let bridgeUpdatedAt = new Date();
let nativePresenceSetter = null;

function isManualMode() {
  return Object.hasOwn(MODE_CONFIG, bridgeMode);
}

function getEmbedTitle(embed) {
  return embed?.data?.title ?? embed?.title ?? null;
}

async function restoreBridgeState() {
  try {
    const result = await pool.query(`
      SELECT mode, updated_at
      FROM ${STATE_TABLE}
      WHERE id = 1;
    `);

    if (result.rows.length === 0) return;

    bridgeMode = result.rows[0].mode;
    bridgeUpdatedAt = new Date(result.rows[0].updated_at);
    console.log(`✅ [SERVERMODE-BRIDGE] Restored mode: ${bridgeMode}.`);
  } catch (error) {
    console.error('❌ [SERVERMODE-BRIDGE] Could not restore mode:', error);
  }
}

async function persistMode(mode) {
  const result = await pool.query(`
    INSERT INTO ${STATE_TABLE} (id, mode, updated_at)
    VALUES (1, $1::text, NOW())
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode,
      updated_at = EXCLUDED.updated_at
    RETURNING mode, updated_at;
  `, [mode]);

  bridgeMode = result.rows[0].mode;
  bridgeUpdatedAt = new Date(result.rows[0].updated_at);
}

await restoreBridgeState();

const previousMessageEdit = Message.prototype.edit;
Message.prototype.edit = async function bridgeProtectedEdit(payload) {
  const title = getEmbedTitle(payload?.embeds?.[0]);

  if (
    isManualMode() &&
    this.channelId === STATUS_CHANNEL_ID &&
    title === SERVER_NAME
  ) {
    return this;
  }

  return previousMessageEdit.call(this, payload);
};

const previousTextChannelSend = TextChannel.prototype.send;
TextChannel.prototype.send = async function bridgeProtectedSend(payload) {
  const title = getEmbedTitle(payload?.embeds?.[0]);

  if (
    isManualMode() &&
    this.id === STATUS_CHANNEL_ID &&
    SERVER_ALERT_TITLES.has(title)
  ) {
    console.log(`ℹ️ [SERVERMODE-BRIDGE] Suppressed ${title} while ${bridgeMode} is active.`);
    return { id: `servermode-bridge-suppressed-${Date.now()}` };
  }

  return previousTextChannelSend.call(this, payload);
};

async function findStatusMessage(client) {
  const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Status channel not found.');
  }

  const messages = await channel.messages.fetch({ limit: 50 });
  const message = messages.find(item =>
    item.author.id === client.user.id &&
    item.embeds?.[0]?.title === SERVER_NAME
  );

  if (!message) {
    throw new Error('Existing TLC status panel was not found.');
  }

  return { channel, message };
}

async function renderManualPanel(client) {
  const config = MODE_CONFIG[bridgeMode];
  if (!config) return;

  const { channel, message } = await findStatusMessage(client);
  const unix = Math.floor(bridgeUpdatedAt.getTime() / 1000);
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
    .setTimestamp(bridgeUpdatedAt);

  if (guildIcon) embed.setThumbnail(guildIcon);

  await client.rest.patch(
    Routes.channelMessage(STATUS_CHANNEL_ID, message.id),
    {
      body: {
        content: '',
        embeds: [embed.toJSON()],
        components: []
      }
    }
  );
}

async function setBridgePresence(client) {
  if (!nativePresenceSetter || !isManualMode()) return;
  const config = MODE_CONFIG[bridgeMode];

  await nativePresenceSetter({
    activities: [{ name: config.presence, type: ActivityType.Custom }],
    status: config.presenceStatus
  });
}

async function handleServerModeInteraction(client, interaction) {
  if (!interaction?.isChatInputCommand?.()) return;
  if (interaction.commandName !== 'servermode') return;

  console.log(
    `ℹ️ [SERVERMODE-BRIDGE] Interaction received from ${interaction.user?.id ?? 'unknown'}.`
  );

  try {
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: '❌ You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const requestedMode = interaction.options.getSubcommand();
    await persistMode(requestedMode);

    if (requestedMode === 'live') {
      if (nativePresenceSetter) {
        await nativePresenceSetter({
          activities: [{ name: '🟠 STATUS REFRESHING', type: ActivityType.Custom }],
          status: 'idle'
        });
      }

      await interaction.editReply(
        '✅ Server mode set to **LIVE**. Automatic ArmaHQ monitoring has control again.'
      );
      console.log('✅ [SERVERMODE-BRIDGE] Returned to live mode.');
      return;
    }

    await renderManualPanel(client);
    await setBridgePresence(client);

    const config = MODE_CONFIG[requestedMode];
    await interaction.editReply(
      `✅ Server status set to **${config.emoji} ${config.label}**.`
    );
    console.log(`✅ [SERVERMODE-BRIDGE] Status set to ${config.label}.`);
  } catch (error) {
    console.error('❌ [SERVERMODE-BRIDGE] Interaction failed:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ Could not update the server mode. Please try again.');
      } else {
        await interaction.reply({
          content: '❌ Could not update the server mode. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error('❌ [SERVERMODE-BRIDGE] Could not send error reply:', replyError);
    }
  }
}

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function serverModeBridgeEmit(eventName, ...args) {
  if (eventName === 'interactionCreate') {
    void handleServerModeInteraction(this, args[0]);
  }

  if (eventName === 'clientReady') {
    if (this.user && !nativePresenceSetter) {
      nativePresenceSetter = this.user.setPresence.bind(this.user);
      const bridgeUser = this.user;

      bridgeUser.setPresence = async data => {
        if (isManualMode()) return bridgeUser;
        return nativePresenceSetter(data);
      };
    }

    if (isManualMode()) {
      setTimeout(() => {
        renderManualPanel(this)
          .then(() => setBridgePresence(this))
          .catch(error => {
            console.error('❌ [SERVERMODE-BRIDGE] Manual-mode restore failed:', error);
          });
      }, 1200);
    }
  }

  return originalEmit.call(this, eventName, ...args);
};

console.log('✅ [SERVERMODE-BRIDGE] Interaction bridge armed.');
