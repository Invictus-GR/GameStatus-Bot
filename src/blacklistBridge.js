import {
  Client,
  EmbedBuilder,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import pg from 'pg';

const { Pool } = pg;

const OWNER_ID = process.env.FAILSAFE_OWNER_ID;
const GUILD_ID = process.env.FAILSAFE_GUILD_ID;
const WARNING_LOG_CHANNEL_ID = '1540989189380640858';
const FOOTER_TEXT =
  'TLC Command • Custom development © 2026 MSgt_Invictus_GR for TLC';
const BLACKLIST_TABLE = 'discord_blacklist';
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const MAX_BLACKLIST_ENTRIES_PER_EMBED = 15;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export const prebanCommand = new SlashCommandBuilder()
  .setName('preban')
  .setDescription('Pre-ban a Discord user by User ID and add them to the TLC blacklist')
  .addStringOption(option =>
    option
      .setName('user_id')
      .setDescription('Discord User ID to blacklist')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for the blacklist')
      .setRequired(true)
      .setMaxLength(400)
  );

export const unprebanCommand = new SlashCommandBuilder()
  .setName('unpreban')
  .setDescription('Remove a Discord User ID from the TLC blacklist and unban them')
  .addStringOption(option =>
    option
      .setName('user_id')
      .setDescription('Discord User ID to remove from the blacklist')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20)
  );

export const blacklistCommand = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Publish the current TLC blacklist in this channel');

async function initializeBlacklistDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${BLACKLIST_TABLE} (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      username TEXT,
      reason TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE ${BLACKLIST_TABLE}
    ADD COLUMN IF NOT EXISTS username TEXT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS discord_blacklist_added_at_idx
    ON ${BLACKLIST_TABLE} (added_at DESC);
  `);

  console.log('✅ [BLACKLIST] Database table ready.');
}

function isOwner(interaction) {
  return Boolean(OWNER_ID) && interaction.user?.id === OWNER_ID;
}

async function denyInteraction(interaction) {
  await interaction.reply({
    content: '❌ You do not have permission to use this command.',
    flags: MessageFlags.Ephemeral
  });
}

async function fetchUserIdentity(client, userId) {
  try {
    const user = await client.users.fetch(userId, { force: true });
    return {
      displayName: user.globalName || user.username || `User ${userId}`,
      username: user.username || null
    };
  } catch {
    return {
      displayName: `User ${userId}`,
      username: null
    };
  }
}

async function sendModerationLog(
  client,
  { type, userId, displayName, username, reason, moderator }
) {
  try {
    const channel = await client.channels.fetch(WARNING_LOG_CHANNEL_ID);
    if (!channel?.isTextBased?.()) return;

    const isAdded = type === 'added';
    const userLines = [`**${displayName}**`];
    if (username) userLines.push(`Username: \`${username}\``);
    userLines.push(`ID: \`${userId}\``);

    const embed = new EmbedBuilder()
      .setTitle(isAdded ? '⛔ USER ADDED TO BLACKLIST' : '✅ USER REMOVED FROM BLACKLIST')
      .addFields(
        { name: 'User', value: userLines.join('\n'), inline: false },
        { name: 'Actioned by', value: `${moderator}`, inline: true },
        {
          name: 'Reason',
          value: isAdded ? reason : 'Removed from blacklist',
          inline: false
        }
      )
      .setColor(isAdded ? 0xED4245 : 0x57F287)
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error('❌ [BLACKLIST] Moderation log failed:', error);
  }
}

async function handlePreban(client, interaction) {
  if (!isOwner(interaction)) {
    await denyInteraction(interaction);
    return;
  }

  const userId = interaction.options.getString('user_id', true).trim();
  const reason = interaction.options.getString('reason', true).trim();

  if (!DISCORD_ID_PATTERN.test(userId)) {
    await interaction.reply({
      content: '❌ Invalid Discord User ID.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (userId === client.user.id) {
    await interaction.reply({
      content: '❌ I am not putting myself on the blacklist. Nice try.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (userId === interaction.user.id) {
    await interaction.reply({
      content: '❌ You cannot blacklist yourself.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('❌ This command can only be used inside the TLC server.');
    return;
  }

  const { displayName, username } = await fetchUserIdentity(client, userId);
  let alreadyBanned = false;

  try {
    const existingBan = await guild.bans.fetch(userId).catch(() => null);
    alreadyBanned = Boolean(existingBan);

    if (!alreadyBanned) {
      await guild.bans.create(userId, {
        deleteMessageSeconds: 0,
        reason: `TLC pre-ban by ${interaction.user.username}: ${reason}`.slice(0, 512)
      });
    }

    try {
      await pool.query(`
        INSERT INTO ${BLACKLIST_TABLE} (
          user_id,
          display_name,
          username,
          reason,
          added_by,
          added_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          username = EXCLUDED.username,
          reason = EXCLUDED.reason,
          added_by = EXCLUDED.added_by,
          added_at = NOW();
      `, [userId, displayName, username, reason, interaction.user.id]);
    } catch (databaseError) {
      if (!alreadyBanned) {
        await guild.bans.remove(userId, 'Rolling back failed TLC blacklist database write')
          .catch(() => {});
      }
      throw databaseError;
    }

    await sendModerationLog(client, {
      type: 'added',
      userId,
      displayName,
      username,
      reason,
      moderator: interaction.user
    });

    await interaction.editReply(
      `✅ **${displayName}** (\`${userId}\`) is now blacklisted and banned from TLC.\n` +
      `**Reason:** ${reason}`
    );

    console.log(`⛔ [BLACKLIST] ${userId} added by ${interaction.user.id}.`);
  } catch (error) {
    console.error('❌ [BLACKLIST] Pre-ban failed:', error);
    await interaction.editReply(
      '❌ Could not pre-ban this user. Check that TLC Command has the **Ban Members** permission and try again.'
    );
  }
}

async function handleUnpreban(client, interaction) {
  if (!isOwner(interaction)) {
    await denyInteraction(interaction);
    return;
  }

  const userId = interaction.options.getString('user_id', true).trim();

  if (!DISCORD_ID_PATTERN.test(userId)) {
    await interaction.reply({
      content: '❌ Invalid Discord User ID.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('❌ This command can only be used inside the TLC server.');
    return;
  }

  try {
    const rowResult = await pool.query(`
      SELECT display_name, username, reason
      FROM ${BLACKLIST_TABLE}
      WHERE user_id = $1;
    `, [userId]);

    const stored = rowResult.rows[0] ?? null;
    const fetchedIdentity = await fetchUserIdentity(client, userId);
    const displayName = stored?.display_name || fetchedIdentity.displayName;
    const username = stored?.username || fetchedIdentity.username;
    const existingBan = await guild.bans.fetch(userId).catch(() => null);

    if (existingBan) {
      await guild.bans.remove(
        userId,
        `Removed from TLC blacklist by ${interaction.user.username}`.slice(0, 512)
      );
    }

    const deleteResult = await pool.query(`
      DELETE FROM ${BLACKLIST_TABLE}
      WHERE user_id = $1;
    `, [userId]);

    if (!existingBan && (deleteResult.rowCount ?? 0) === 0) {
      await interaction.editReply(`ℹ️ \`${userId}\` was not on the TLC blacklist.`);
      return;
    }

    await sendModerationLog(client, {
      type: 'removed',
      userId,
      displayName,
      username,
      reason: stored?.reason ?? 'No stored reason',
      moderator: interaction.user
    });

    await interaction.editReply(
      `✅ **${displayName}** (\`${userId}\`) has been removed from the TLC blacklist and unbanned.`
    );

    console.log(`✅ [BLACKLIST] ${userId} removed by ${interaction.user.id}.`);
  } catch (error) {
    console.error('❌ [BLACKLIST] Unpreban failed:', error);
    await interaction.editReply('❌ Could not remove this user from the blacklist.');
  }
}

function buildBlacklistEmbeds(rows) {
  if (rows.length === 0) {
    return [
      new EmbedBuilder()
        .setTitle('⛔ TLC BLACKLIST')
        .setDescription('The TLC blacklist is currently empty.')
        .setColor(0x57F287)
        .setFooter({ text: FOOTER_TEXT })
        .setTimestamp()
    ];
  }

  const embeds = [];

  for (let offset = 0; offset < rows.length; offset += MAX_BLACKLIST_ENTRIES_PER_EMBED) {
    const pageRows = rows.slice(offset, offset + MAX_BLACKLIST_ENTRIES_PER_EMBED);
    const description = pageRows
      .map((row, pageIndex) => {
        const number = offset + pageIndex + 1;
        const addedAt = Math.floor(new Date(row.added_at).getTime() / 1000);
        const name = row.display_name || `User ${row.user_id}`;
        const usernameLine = row.username ? `Username: \`${row.username}\`\n` : '';

        return (
          `**${number}. ${name}**\n` +
          usernameLine +
          `ID: \`${row.user_id}\`\n` +
          `Reason: **${row.reason}**\n` +
          `Added: <t:${addedAt}:d>`
        );
      })
      .join('\n\n');

    embeds.push(
      new EmbedBuilder()
        .setTitle(offset === 0 ? '⛔ TLC BLACKLIST' : '⛔ TLC BLACKLIST • CONTINUED')
        .setDescription(description)
        .setColor(0xED4245)
        .setFooter({
          text: `${rows.length} blacklisted user${rows.length === 1 ? '' : 's'} • ${FOOTER_TEXT}`
        })
        .setTimestamp()
    );
  }

  return embeds.slice(0, 10);
}

async function handleBlacklist(interaction) {
  if (!isOwner(interaction)) {
    await denyInteraction(interaction);
    return;
  }

  await interaction.deferReply();

  try {
    const result = await pool.query(`
      SELECT user_id, display_name, username, reason, added_by, added_at
      FROM ${BLACKLIST_TABLE}
      ORDER BY added_at DESC, user_id ASC;
    `);

    const embeds = buildBlacklistEmbeds(result.rows);

    await interaction.editReply({
      content: '',
      embeds,
      allowedMentions: { parse: [] }
    });

    console.log(
      `📋 [BLACKLIST] Public snapshot posted in channel ${interaction.channelId} ` +
      `by ${interaction.user.id}.`
    );
  } catch (error) {
    console.error('❌ [BLACKLIST] Could not publish blacklist:', error);
    await interaction.editReply('❌ Could not load the TLC blacklist.');
  }
}

async function handleBlacklistInteraction(client, interaction) {
  if (!interaction?.isChatInputCommand?.()) return;

  if (interaction.commandName === 'preban') {
    await handlePreban(client, interaction);
    return;
  }

  if (interaction.commandName === 'unpreban') {
    await handleUnpreban(client, interaction);
    return;
  }

  if (interaction.commandName === 'blacklist') {
    await handleBlacklist(interaction);
  }
}

async function registerBlacklistCommands() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token || !GUILD_ID) {
    console.error('❌ [BLACKLIST] Cannot register commands: missing bot token or guild ID.');
    return;
  }

  try {
    const applicationId = Buffer
      .from(token.split('.')[0], 'base64')
      .toString('utf8');

    if (!/^\d+$/.test(applicationId)) {
      throw new Error('Could not derive Discord application ID from bot token.');
    }

    const rest = new REST({ version: '10' }).setToken(token);
    const route = Routes.applicationGuildCommands(applicationId, GUILD_ID);
    const commands = await rest.get(route);

    for (const commandBuilder of [prebanCommand, unprebanCommand, blacklistCommand]) {
      const body = commandBuilder.toJSON();
      const existing = Array.isArray(commands)
        ? commands.find(command => command.name === body.name)
        : null;

      if (existing) {
        await rest.patch(
          Routes.applicationGuildCommand(applicationId, GUILD_ID, existing.id),
          { body }
        );
      } else {
        await rest.post(route, { body });
      }
    }

    console.log('✅ [BLACKLIST] /preban, /unpreban and /blacklist commands registered.');
  } catch (error) {
    console.error('❌ [BLACKLIST] Command registration failed:', error);
  }
}

await initializeBlacklistDatabase().catch(error => {
  console.error('❌ [BLACKLIST] Database initialization failed:', error);
});

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function blacklistBridgeEmit(eventName, ...args) {
  if (eventName === 'interactionCreate') {
    void handleBlacklistInteraction(this, args[0]).catch(error => {
      console.error('❌ [BLACKLIST] Interaction bridge failed:', error);
    });
  }

  return originalEmit.call(this, eventName, ...args);
};

setTimeout(() => {
  registerBlacklistCommands().catch(error => {
    console.error('❌ [BLACKLIST] Delayed command registration failed:', error);
  });
}, 5000);

console.log('✅ [BLACKLIST] Interaction bridge armed.');
