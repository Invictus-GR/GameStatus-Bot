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
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function testDatabaseConnection() {

  try {
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected successfully.');
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error);
  }
}
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        report_date DATE PRIMARY KEY,
        peak_players INTEGER NOT NULL DEFAULT 0,
        player_sum BIGINT NOT NULL DEFAULT 0,
        player_samples INTEGER NOT NULL DEFAULT 0,
        peak_queue INTEGER NOT NULL DEFAULT 0,

        uptime_seconds BIGINT NOT NULL DEFAULT 0,
        downtime_seconds BIGINT NOT NULL DEFAULT 0,
        offline_events INTEGER NOT NULL DEFAULT 0,

        queue_10_reached BOOLEAN NOT NULL DEFAULT FALSE,
        queue_20_reached BOOLEAN NOT NULL DEFAULT FALSE,
        queue_25_reached BOOLEAN NOT NULL DEFAULT FALSE,

        active_mods INTEGER NOT NULL DEFAULT 0,
        mods_removed_count INTEGER NOT NULL DEFAULT 0,

        warnings_count INTEGER NOT NULL DEFAULT 0,
        changelogs_count INTEGER NOT NULL DEFAULT 0,

        status_checks INTEGER NOT NULL DEFAULT 0,
        mod_checks INTEGER NOT NULL DEFAULT 0,
        bot_errors INTEGER NOT NULL DEFAULT 0,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log('✅ Daily stats table ready.');
  } catch (error) {
    console.error('❌ Failed to initialize daily stats table:', error);
  }
}
async function recordDailyServerStats(players, queue) {
  try {
    await pool.query(`
      INSERT INTO daily_stats (
        report_date,
        peak_players,
        player_sum,
        player_samples,
        peak_queue,
        queue_10_reached,
        queue_20_reached,
        queue_25_reached,
        status_checks,
        updated_at
      )
      VALUES (
        (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date,
        $1,
        $1,
        1,
        LEAST($2, 25),
        $2 >= 10,
        $2 >= 20,
        $2 >= 25,
        1,
        NOW()
      )
      ON CONFLICT (report_date) DO UPDATE SET
        peak_players = GREATEST(daily_stats.peak_players, EXCLUDED.peak_players),
        player_sum = daily_stats.player_sum + EXCLUDED.player_sum,
        player_samples = daily_stats.player_samples + 1,
        peak_queue = GREATEST(daily_stats.peak_queue, EXCLUDED.peak_queue),
        queue_10_reached = daily_stats.queue_10_reached OR EXCLUDED.queue_10_reached,
        queue_20_reached = daily_stats.queue_20_reached OR EXCLUDED.queue_20_reached,
        queue_25_reached = daily_stats.queue_25_reached OR EXCLUDED.queue_25_reached,
        status_checks = daily_stats.status_checks + 1,
        updated_at = NOW();
    `, [players, queue]);
  } catch (error) {
    console.error('❌ Failed to record daily server stats:', error);
  }
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const SERVER_URL =
  'https://www.armahq.com/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300';
const SERVER_NAME = 'EU | TLC | THE LAST COALITION | UHC | PVP | PERSISTENT RANK | DRONES';
const CHANNEL_ID = '1543309765243834428';
const CHANGELOG_CHANNEL_ID = '1535567655442972722';
const WARNING_LOG_CHANNEL_ID = '1540989189380640858';
const GENERAL_CHANNEL_ID = '1529549362563125271';
const MOD_REMOVALS_CHANNEL_ID = '1543567256024252496';
const ADMIN_REPORT_CHANNEL_ID = '1530535429491916810';
let previousModSnapshot = null;
let pendingRemovedMods = new Map();
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
      .setURL(SERVER_URL),

    new ButtonBuilder()
      .setCustomId('show_mods')
      .setLabel('Show Mods')
      .setEmoji('📦')
      .setStyle(ButtonStyle.Secondary)
  );
}
async function checkQueueAlerts(queue, players, maxPlayers) {
  const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

  if (!channel || !channel.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 });

  const alerts = messages.filter(message =>
    message.author.id === client.user.id &&
   message.embeds?.[0]?.footer?.text === 'TLC Command • Created by MSgt_Invictus_GR for TLC'
  );

  const previousAlert = alerts.first();
for (const [, message] of alerts) {
  if (previousAlert && message.id !== previousAlert.id) {
    await message.delete().catch(() => {});
  }
}
  let level = 0;

  if (queue >= 25) {
    level = 25;
  } else if (queue >= 20) {
    level = 20;
  } else if (queue >= 10) {
    level = 10;
  }

  // Queue below 10 = reset
  if (level === 0) {
    for (const [, message] of alerts) {
      await message.delete().catch(() => {});
    }
    return;
  }

  let previousLevel = 0;

  if (previousAlert) {
    const title = previousAlert.embeds[0]?.title || '';

    if (title.includes('MAXED')) previousLevel = 25;
    else if (title.includes('PACKED')) previousLevel = 20;
    else if (title.includes('FILLING')) previousLevel = 10;
  }

  // Already sent this level or a higher one
  if (level <= previousLevel) {
    return;
  }

  let title;
  let description;
  let color;

  if (level === 10) {
    title = '⚠️ TLC IS FILLING UP';
    description =
      `👥 **(+${queue}) ${players}/${maxPlayers}**\n\n` +
      `The queue is building.\n` +
      `If you're joining, now's the time.`;
    color = 0xFEE75C;
  }

  if (level === 20) {
    title = '🔥 TLC IS PACKED';
    description =
      `👥 **(+${queue}) ${players}/${maxPlayers}**\n\n` +
      `Heavy queue in progress.\n` +
      `Expect a wait before getting in.`;
    color = 0xF47B20;
  }

  if (level === 25) {
    title = '🚨 TLC QUEUE IS MAXED';
    description =
      `👥 **(+${queue}) ${players}/${maxPlayers}**\n\n` +
      `Queue capacity reached.\n` +
      `Good luck getting through the gates.`;
    color = 0xED4245;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
 
    .setColor(color)
.setImage('https://raw.githubusercontent.com/Invictus-GR/GameStatus-Bot/main/TLC-queue-banner.png')

   .setFooter({
  text: 'TLC Command • Created by MSgt_Invictus_GR for TLC'
})
    .setTimestamp();

  // Delete previous queue alert
  for (const [, message] of alerts) {
    await message.delete().catch(() => {});
  }

  // Send the new level
  await channel.send({
 
  embeds: [embed]
});
    
 

  console.log(`Queue alert sent: ${level}+`);
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
await checkQueueAlerts(queue, players, maxPlayers);
  
await recordDailyServerStats(players, queue);

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
      .setTitle('EU | TLC | THE LAST COALITION | UHC | PVP | PERSISTENT RANK | DRONES')
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
       text: 'TLC Command • Created by MSgt_Invictus_GR for TLC'
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
      .setTitle('EU | TLC | THE LAST COALITION | UHC | PVP | PERSISTENT RANK | DRONES')
        .setDescription('### 🔴 SERVER OFFLINE')
        .addFields({
          name: '📡 Status',
          value: '**OFFLINE**',
          inline: true
        })
        .setColor(0xED4245)
        
 .setFooter({
  text: 'TLC Command • Created by MSgt_Invictus_GR for TLC'
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
async function fetchServerMods() {
  const response = await fetch(SERVER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!response.ok) {
    throw new Error(`ArmaHQ returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const modRegex =
   /\{\\"name\\":\\"([^"\\]*)\\",\\"modId\\":\\"([^"\\]*)\\",\\"version\\":\\"([^"\\]*)\\"\}/g;

  const mods = [];
  let match;

  while ((match = modRegex.exec(html)) !== null) {
    mods.push({
      name: match[1],
      modId: match[2],
      version: match[3]
    });
  }

  const uniqueMods = [
    ...new Map(mods.map(mod => [mod.modId, mod])).values()
  ];

  return uniqueMods.sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
}
async function checkForRemovedMods() {
  try {
    const currentMods = await fetchServerMods();

    if (!currentMods.length) {
      console.log('Mod removal check skipped: no mods found.');
      return;
    }

    const currentSnapshot = new Map(
      currentMods.map(mod => [mod.modId, mod])
    );

    // First run: save current list without sending an alert
    if (!previousModSnapshot) {
      previousModSnapshot = currentSnapshot;
   
      console.log(`Mod removal watcher initialized with ${currentMods.length} mods.`);
      return;
    }

   const removedMods = [];

// Confirm mods that were already missing on the previous check
for (const [modId, mod] of pendingRemovedMods) {
  if (!currentSnapshot.has(modId)) {
    removedMods.push(mod);
    pendingRemovedMods.delete(modId);
  } else {
    // Mod appeared again, cancel the pending removal
    pendingRemovedMods.delete(modId);
  }
}

// Detect newly missing mods and wait for confirmation
for (const [modId, mod] of previousModSnapshot) {
  if (!currentSnapshot.has(modId) && !pendingRemovedMods.has(modId)) {
    pendingRemovedMods.set(modId, mod);
  }
}

    // Always update the snapshot
    previousModSnapshot = currentSnapshot;

    // Ignore additions and version changes
    if (removedMods.length === 0) {
      return;
    }

    const channel = await client.channels.fetch(MOD_REMOVALS_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error('Mod removals channel not found.');
      return;
    }

    const removedList = removedMods
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(mod => `• **${mod.name}**`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(
        removedMods.length === 1
          ? '🗑️ TLC MOD REMOVED'
          : '🗑️ TLC MODS REMOVED'
      )
      .setDescription(
        `The following ${removedMods.length === 1 ? 'mod has' : 'mods have'} been removed from the server:\n\n${removedList}`
      )
      .addFields({
        name: '📦 Current Active Mods',
        value: `${currentMods.length}`,
        inline: true
      })
      .setColor(0xED4245)
      .setFooter({
        text: 'TLC Command • Created by MSgt_Invictus_GR for TLC'
      })
      .setTimestamp();

await channel.send({
  content: '@everyone',
  embeds: [embed],
  allowedMentions: {
    parse: ['everyone']
  }
});
   

    console.log(`Mod removal alert sent for ${removedMods.length} mod(s).`);

  } catch (error) {
    console.error('Mod removal watcher error:', error);
  }
}
const MODS_PER_PAGE = 20;
const modsCache = new Map();
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const isShowMods = interaction.customId === 'show_mods';
  const isModsPage = interaction.customId.startsWith('mods_page_');

  if (!isShowMods && !isModsPage) return;

  try {
   let mods;

if (isShowMods) {
  mods = await fetchServerMods();
  modsCache.set(interaction.user.id, mods);
} else {
  mods = modsCache.get(interaction.user.id);

  if (!mods) {
    mods = await fetchServerMods();
    modsCache.set(interaction.user.id, mods);
  }

}
    if (!mods.length) {
      return interaction.reply({
        content: '❌ Could not find the server mod list.',
        ephemeral: true
      });
    }

    let page = 0;

    if (isModsPage) {
      page = Number(interaction.customId.replace('mods_page_', ''));
    }

    const totalPages = Math.ceil(mods.length / MODS_PER_PAGE);

    page = Math.max(0, Math.min(page, totalPages - 1));

    const start = page * MODS_PER_PAGE;
    const pageMods = mods.slice(start, start + MODS_PER_PAGE);

    const description = pageMods
      .map((mod, index) =>
        `**${start + index + 1}. ${mod.name}**\nVersion: \`${mod.version}\``
      )
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('📦 TLC SERVER MODS')
      .setDescription(description)
      .setColor(0x5865F2)
      .setFooter({
        text: `${mods.length} Mods • Page ${page + 1}/${totalPages} • TLC Command`
      });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mods_page_${page - 1}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),

      new ButtonBuilder()
        .setCustomId(`mods_page_${page + 1}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === totalPages - 1)
    );

    if (isShowMods) {
      await interaction.reply({
        embeds: [embed],
        components: [buttons],
        ephemeral: true
      });
    } else {
      await interaction.update({
        embeds: [embed],
        components: [buttons]
      });
    }

  } catch (error) {
    console.error('Show Mods error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Failed to load the server mod list. Please try again.',
        ephemeral: true
      });
    }
  }
});
client.once('clientReady', async () => {
  await testDatabaseConnection();
  await initializeDatabase();
  await client.application.commands.set([]);

  const guild = client.guilds.cache.first();
  await guild.commands.set([changelogCommand, warnCommand]);
console.log('/changelog command registered');
  console.log(`Discord bot connected as ${client.user.tag}`);

  updateServerStatus();
checkForRemovedMods();
 
  setInterval(updateServerStatus, 120000);
setInterval(checkForRemovedMods, 300000);
});

client.login(process.env.DISCORD_BOT_TOKEN);
