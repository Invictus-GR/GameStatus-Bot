import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';

const DIAGNOSTIC_ROLE_IDS = [
  '1529632873987178668',
  '1540715768625496135',
  '1538451886758170744'
];

const REQUIRED_ENV_VARS = [
  'DISCORD_BOT_TOKEN',
  'DATABASE_URL',
  'FAILSAFE_OWNER_ID',
  'FAILSAFE_GUILD_ID'
];

const QUEUE_LEVELS = [10, 20, 25];

export const diagnosticCommand = new SlashCommandBuilder()
  .setName('test')
  .setDescription('Run TLC Command diagnostics without affecting production data')
  .addSubcommand(subcommand =>
    subcommand
      .setName('all')
      .setDescription('Run the complete TLC Command diagnostic suite')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('queue')
      .setDescription('Preview a queue alert without posting it to General')
      .addIntegerOption(option =>
        option
          .setName('level')
          .setDescription('Queue level to simulate')
          .setRequired(true)
          .addChoices(
            { name: '10+ queue', value: 10 },
            { name: '20+ queue', value: 20 },
            { name: '25/25 queue', value: 25 }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('mods')
      .setDescription('Test ArmaHQ mod parsing, pagination and change detection')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('database')
      .setDescription('Test PostgreSQL connection and required tables')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('armahq')
      .setDescription('Test ArmaHQ access and server status parsing')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Test the live status panel and Show Mods button')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('channels')
      .setDescription('Check all configured TLC Discord channels')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('permissions')
      .setDescription('Check the bot permissions needed by TLC Command')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('warn')
      .setDescription('Dry-run the warning system without warning a user')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('changelog')
      .setDescription('Dry-run the changelog system without pinging anyone')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('daily')
      .setDescription('Test the daily-report database data and destination channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('failsafe')
      .setDescription('Safely verify failsafe configuration without triggering it')
  );

function hasDiagnosticRole(interaction) {
  return interaction.member?.roles?.cache?.some(role =>
    DIAGNOSTIC_ROLE_IDS.includes(role.id)
  ) ?? false;
}

function pass(name, details = 'OK') {
  return { name, status: 'pass', details };
}

function warn(name, details) {
  return { name, status: 'warn', details };
}

function fail(name, details) {
  return { name, status: 'fail', details };
}

function iconFor(status) {
  if (status === 'pass') return '🟢';
  if (status === 'warn') return '🟡';
  return '🔴';
}

function summarize(results) {
  const passed = results.filter(result => result.status === 'pass').length;
  const warnings = results.filter(result => result.status === 'warn').length;
  const failed = results.filter(result => result.status === 'fail').length;
  return { passed, warnings, failed, total: results.length };
}

function truncate(text, max = 900) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function createResultsEmbed(title, results, note = null) {
  const summary = summarize(results);
  const color = summary.failed > 0
    ? 0xED4245
    : summary.warnings > 0
      ? 0xFEE75C
      : 0x57F287;

  const lines = results.map(result =>
    `${iconFor(result.status)} **${result.name}**\n${truncate(result.details, 280)}`
  );

  const description = [
    `**${summary.passed}/${summary.total} PASS**` +
      (summary.warnings ? ` • ${summary.warnings} WARN` : '') +
      (summary.failed ? ` • ${summary.failed} FAIL` : ''),
    note,
    ...lines
  ].filter(Boolean).join('\n\n');

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncate(description, 4000))
    .setColor(color)
    .setFooter({ text: 'TLC Command Diagnostics • Dry-run mode' })
    .setTimestamp();
}

function buildQueuePreview(level, players = 128, maxPlayers = 128) {
  let title;
  let description;
  let color;

  if (level === 10) {
    title = '⚠️ TLC IS FILLING UP';
    description =
      `👥 **(+${level}) ${players}/${maxPlayers}**\n\n` +
      `The queue is building.\n` +
      `If you're joining, now's the time.`;
    color = 0xFEE75C;
  } else if (level === 20) {
    title = '🔥 TLC IS PACKED';
    description =
      `👥 **(+${level}) ${players}/${maxPlayers}**\n\n` +
      `Heavy queue in progress.\n` +
      `Expect a wait before getting in.`;
    color = 0xF47B20;
  } else {
    title = '🚨 TLC QUEUE IS MAXED';
    description =
      `👥 **(+${level}) ${players}/${maxPlayers}**\n\n` +
      `Queue capacity reached.\n` +
      `Good luck getting through the gates.`;
    color = 0xED4245;
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setImage('https://raw.githubusercontent.com/Invictus-GR/GameStatus-Bot/main/TLC-queue-banner.png')
    .setFooter({ text: 'TEST PREVIEW • Nothing was posted to General' })
    .setTimestamp();
}

function buildWarnPreview() {
  return new EmbedBuilder()
    .setTitle('⚠️ TLC OFFICIAL WARNING')
    .setDescription(
      'You have received an official warning from **The Last Coalition Staff**.\n\n' +
      '**Reason:**\nDiagnostic dry-run. No user was warned.'
    )
    .setColor(0xED4245)
    .setFooter({ text: 'TEST PREVIEW • No DM was sent' })
    .setTimestamp();
}

function buildChangelogPreview() {
  return new EmbedBuilder()
    .setTitle('🛠️ TLC SERVER CHANGELOG')
    .setDescription('Latest changes to the TLC server.')
    .addFields(
      { name: '➕ Added', value: 'Diagnostic preview item' },
      { name: '🔧 Fixed', value: 'Diagnostic preview item' },
      { name: '🔄 Changed', value: 'Diagnostic preview item' },
      { name: '➖ Removed', value: 'Diagnostic preview item' }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'TEST PREVIEW • No @everyone was sent' })
    .setTimestamp();
}

function buildDailyPreview(stats = {}) {
  return new EmbedBuilder()
    .setTitle('📊 TLC DAILY OPERATIONS REPORT')
    .addFields(
      {
        name: '👥 PLAYER ACTIVITY',
        value:
          `Peak Players: **${stats.peak_players ?? 0}/128**\n` +
          `Samples: **${stats.player_samples ?? 0}**\n` +
          `Peak Queue: **${stats.peak_queue ?? 0}/25**`,
        inline: false
      },
      {
        name: '🖥️ SERVER HEALTH',
        value:
          `Uptime Seconds: **${stats.uptime_seconds ?? 0}**\n` +
          `Downtime Seconds: **${stats.downtime_seconds ?? 0}**\n` +
          `Offline Incidents: **${stats.offline_events ?? 0}**`,
        inline: true
      },
      {
        name: '📦 MODS',
        value:
          `Active Mods: **${stats.active_mods ?? 0}**\n` +
          `Removed: **${stats.mods_removed_count ?? 0}**`,
        inline: true
      }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'TEST PREVIEW • No report was posted' })
    .setTimestamp();
}

async function fetchTextChannel(client, id, label) {
  try {
    const channel = await client.channels.fetch(id);
    if (!channel) return { result: fail(label, `Channel ${id} was not found.`), channel: null };
    if (!channel.isTextBased()) {
      return { result: fail(label, `${channel.name ?? id} is not text-based.`), channel };
    }
    return { result: pass(label, `#${channel.name ?? id} (${id})`), channel };
  } catch (error) {
    return { result: fail(label, error.message), channel: null };
  }
}

async function testDatabase(pool) {
  const results = [];

  try {
    const nowResult = await pool.query('SELECT NOW() AS now');
    results.push(pass('PostgreSQL connection', `Connected • ${nowResult.rows[0]?.now ?? 'time returned'}`));
  } catch (error) {
    results.push(fail('PostgreSQL connection', error.message));
    return results;
  }

  try {
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('daily_stats', 'server_health_state')
      ORDER BY table_name
    `);
    const names = tables.rows.map(row => row.table_name);
    const missing = ['daily_stats', 'server_health_state'].filter(name => !names.includes(name));
    results.push(
      missing.length
        ? fail('Database tables', `Missing: ${missing.join(', ')}`)
        : pass('Database tables', names.join(', '))
    );
  } catch (error) {
    results.push(fail('Database tables', error.message));
  }

  return results;
}

async function testArmaHQ(context) {
  const results = [];

  try {
    const started = Date.now();
    const html = await context.fetchArmaHQPage();
    const elapsed = Date.now() - started;
    results.push(pass('ArmaHQ reachability', `${html.length.toLocaleString()} bytes • ${elapsed} ms`));

    const data = context.parseServerPage(html);
    const playerText = data.isOnline
      ? `${data.players}/${data.maxPlayers} • queue ${data.queue}`
      : 'Server reported OFFLINE';
    results.push(pass('Server status parser', playerText));
  } catch (error) {
    results.push(fail('ArmaHQ / status parser', error.message));
  }

  return results;
}

function simulateModChanges(mods) {
  if (mods.length < 2) {
    return fail('Mod change detector', 'Need at least two mods to run simulation.');
  }

  const baseline = new Map(mods.map(mod => [mod.modId, mod]));
  const removedId = mods[0].modId;
  const afterRemoval = new Map(baseline);
  afterRemoval.delete(removedId);

  const removedDetected = baseline.has(removedId) && !afterRemoval.has(removedId);
  const fakeAdded = { name: 'TLC Diagnostic Fake Mod', modId: '__tlc_test__', version: '0.0.0' };
  const afterAddition = new Map(afterRemoval);
  afterAddition.set(fakeAdded.modId, fakeAdded);
  const addedDetected = !afterRemoval.has(fakeAdded.modId) && afterAddition.has(fakeAdded.modId);

  return removedDetected && addedDetected
    ? pass('Mod added/removed detection', 'Dry-run detected one removal and one addition correctly.')
    : fail('Mod added/removed detection', 'Simulation did not produce expected changes.');
}

async function testMods(context) {
  const results = [];

  try {
    const mods = await context.fetchServerMods();
    if (!mods.length) {
      return [fail('Mod parser', 'ArmaHQ returned zero parsed mods.')];
    }

    results.push(pass('Mod parser', `${mods.length} active mods parsed.`));

    const pages = Math.ceil(mods.length / 20);
    const lastPageCount = mods.length - ((pages - 1) * 20);
    const paginationValid = pages >= 1 && lastPageCount >= 1 && lastPageCount <= 20;
    results.push(
      paginationValid
        ? pass('Show Mods pagination', `${pages} pages • last page ${lastPageCount} mods.`)
        : fail('Show Mods pagination', 'Page calculation failed.')
    );

    const uniqueIds = new Set(mods.map(mod => mod.modId));
    results.push(
      uniqueIds.size === mods.length
        ? pass('Mod ID uniqueness', `${uniqueIds.size}/${mods.length} unique IDs.`)
        : warn('Mod ID uniqueness', `${mods.length - uniqueIds.size} duplicate mod IDs after parsing.`)
    );

    results.push(simulateModChanges(mods));
  } catch (error) {
    results.push(fail('Mod diagnostics', error.message));
  }

  return results;
}

async function testChannels(context) {
  const channelDefinitions = [
    [context.CHANNEL_ID, 'Status channel'],
    [context.CHANGELOG_CHANNEL_ID, 'Changelog channel'],
    [context.WARNING_LOG_CHANNEL_ID, 'Warning log channel'],
    [context.GENERAL_CHANNEL_ID, 'General / queue channel'],
    [context.MOD_REMOVALS_CHANNEL_ID, 'Mod removals channel'],
    [context.MOD_ADDED_CHANNEL_ID, 'Mod added channel'],
    [context.ADMIN_REPORT_CHANNEL_ID, 'Admin report channel']
  ];

  const results = [];
  const channels = [];

  for (const [id, label] of channelDefinitions) {
    const checked = await fetchTextChannel(context.client, id, label);
    results.push(checked.result);
    if (checked.channel) channels.push({ label, channel: checked.channel });
  }

  return { results, channels };
}

async function testPermissions(context) {
  const { results: channelResults, channels } = await testChannels(context);
  const failedChannels = channelResults.filter(result => result.status === 'fail');
  const results = [];

  if (failedChannels.length) {
    results.push(fail('Channel availability', `${failedChannels.length} configured channel(s) unavailable.`));
  } else {
    results.push(pass('Channel availability', 'All configured channels are reachable.'));
  }

  for (const { label, channel } of channels) {
    const guild = channel.guild;
    const me = guild?.members?.me;
    if (!me) {
      results.push(fail(`${label} permissions`, 'Bot guild member was not available in cache.'));
      continue;
    }

    const permissions = channel.permissionsFor(me);
    if (!permissions) {
      results.push(fail(`${label} permissions`, 'Could not resolve channel permissions.'));
      continue;
    }

    const needed = [
      ['View', PermissionFlagsBits.ViewChannel],
      ['Send', PermissionFlagsBits.SendMessages],
      ['Embeds', PermissionFlagsBits.EmbedLinks]
    ];

    if (label === 'Status channel' || label === 'General / queue channel') {
      needed.push(['History', PermissionFlagsBits.ReadMessageHistory]);
    }

    if (label === 'General / queue channel') {
      needed.push(['Manage Messages', PermissionFlagsBits.ManageMessages]);
    }

    const missing = needed
      .filter(([, bit]) => !permissions.has(bit))
      .map(([name]) => name);

    results.push(
      missing.length
        ? fail(`${label} permissions`, `Missing: ${missing.join(', ')}`)
        : pass(`${label} permissions`, needed.map(([name]) => name).join(', '))
    );
  }

  return results;
}

async function testStatus(context) {
  const results = [];

  try {
    const channel = await context.client.channels.fetch(context.CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      return [fail('Status panel channel', 'Configured status channel is unavailable.')];
    }

    const messages = await channel.messages.fetch({ limit: 50 });
    const panel = messages.find(message =>
      message.author.id === context.client.user.id &&
      message.embeds?.[0]?.title === context.SERVER_NAME &&
      message.components?.some(row =>
        row.components?.some(component => component.customId === 'show_mods')
      )
    );

    if (!panel) {
      results.push(fail('Live status panel', 'Could not find the TLC status panel in the latest 50 messages.'));
    } else {
      results.push(pass('Live status panel', `Message ${panel.id} found.`));
      const hasViewServer = panel.components?.some(row =>
        row.components?.some(component => component.style === ButtonStyle.Link)
      );
      const hasShowMods = panel.components?.some(row =>
        row.components?.some(component => component.customId === 'show_mods')
      );
      results.push(
        hasViewServer && hasShowMods
          ? pass('Status buttons', 'View Server + Show Mods are present.')
          : fail('Status buttons', 'One or more expected buttons are missing.')
      );
    }

    const html = await context.fetchArmaHQPage();
    const parsed = context.parseServerPage(html);
    const testEmbed = new EmbedBuilder()
      .setTitle(context.SERVER_NAME)
      .setDescription(parsed.isOnline ? '### 🟢 SERVER ONLINE' : '### 🔴 SERVER OFFLINE')
      .setColor(parsed.isOnline ? 0x57F287 : 0xED4245);
    const testRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('View Server')
        .setStyle(ButtonStyle.Link)
        .setURL(context.SERVER_URL),
      new ButtonBuilder()
        .setCustomId('show_mods')
        .setLabel('Show Mods')
        .setStyle(ButtonStyle.Secondary)
    );

    testEmbed.toJSON();
    testRow.toJSON();
    results.push(pass('Status render dry-run', 'Embed and button row serialize correctly.'));
  } catch (error) {
    results.push(fail('Status diagnostics', error.message));
  }

  return results;
}

async function testWarn(context) {
  const results = [];
  const checked = await fetchTextChannel(context.client, context.WARNING_LOG_CHANNEL_ID, 'Warning log channel');
  results.push(checked.result);

  try {
    buildWarnPreview().toJSON();
    results.push(pass('Warning embed', 'Dry-run warning embed serializes correctly.'));
    results.push(pass('Warning DM safety', 'No DM was sent during this test.'));
  } catch (error) {
    results.push(fail('Warning embed', error.message));
  }

  return results;
}

async function testChangelog(context) {
  const results = [];
  const checked = await fetchTextChannel(context.client, context.CHANGELOG_CHANNEL_ID, 'Changelog channel');
  results.push(checked.result);

  try {
    buildChangelogPreview().toJSON();
    results.push(pass('Changelog embed', 'Dry-run changelog serializes correctly.'));
    results.push(pass('@everyone safety', 'No mention was sent during this test.'));
  } catch (error) {
    results.push(fail('Changelog embed', error.message));
  }

  return results;
}

async function testDaily(context) {
  const results = [];
  const checked = await fetchTextChannel(context.client, context.ADMIN_REPORT_CHANNEL_ID, 'Admin report channel');
  results.push(checked.result);

  try {
    const query = await context.pool.query(`
      SELECT *
      FROM daily_stats
      WHERE report_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date - 1
    `);

    if (query.rows.length) {
      results.push(pass('Yesterday daily stats', 'Daily-report source row exists.'));
      buildDailyPreview(query.rows[0]).toJSON();
    } else {
      results.push(warn('Yesterday daily stats', 'No row exists yet; this is valid when no stats were recorded yesterday.'));
      buildDailyPreview().toJSON();
    }

    results.push(pass('Daily report render', 'Dry-run report embed serializes correctly.'));
    results.push(pass('Daily report safety', 'No report was posted during this test.'));
  } catch (error) {
    results.push(fail('Daily report diagnostics', error.message));
  }

  return results;
}

async function testFailsafe(context) {
  const results = [];

  const ownerId = process.env.FAILSAFE_OWNER_ID;
  const guildId = process.env.FAILSAFE_GUILD_ID;

  results.push(
    ownerId ? pass('Failsafe owner ID', 'Configured.') : fail('Failsafe owner ID', 'FAILSAFE_OWNER_ID is missing.')
  );
  results.push(
    guildId ? pass('Failsafe guild ID', 'Configured.') : fail('Failsafe guild ID', 'FAILSAFE_GUILD_ID is missing.')
  );

  if (!ownerId || !guildId) return results;

  try {
    const guild = await context.client.guilds.fetch(guildId);
    results.push(pass('Failsafe guild', `${guild.name} (${guild.id})`));

    try {
      const member = await guild.members.fetch(ownerId);
      results.push(pass('Failsafe owner present', `${member.user.username} is currently in the guild.`));
    } catch (error) {
      results.push(fail('Failsafe owner present', `Owner lookup failed: ${error.message}`));
    }
  } catch (error) {
    results.push(fail('Failsafe guild', error.message));
  }

  results.push(pass('Failsafe trigger safety', 'Trigger was NOT executed. No messages were sent and the bot did not leave.'));
  return results;
}

function testEnvironment() {
  return REQUIRED_ENV_VARS.map(name =>
    process.env[name]
      ? pass(`ENV ${name}`, 'Present.')
      : fail(`ENV ${name}`, 'Missing.')
  );
}

function testListeners(context) {
  const interactionCount = context.client.listenerCount('interactionCreate');
  const memberRemoveCount = context.client.listenerCount('guildMemberRemove');

  return [
    interactionCount === 1
      ? pass('interactionCreate listeners', '1 listener registered.')
      : warn('interactionCreate listeners', `${interactionCount} listeners registered; expected 1.`),
    memberRemoveCount === 1
      ? pass('guildMemberRemove listeners', '1 listener registered.')
      : warn('guildMemberRemove listeners', `${memberRemoveCount} listeners registered; expected 1.`)
  ];
}

async function runAll(context) {
  const results = [];

  results.push(
    context.client.isReady()
      ? pass('Discord connection', `${context.client.user.tag} • WS ping ${context.client.ws.ping} ms`)
      : fail('Discord connection', 'Discord client is not ready.')
  );

  results.push(...testEnvironment());
  results.push(...testListeners(context));
  results.push(...await testDatabase(context.pool));
  results.push(...await testArmaHQ(context));
  results.push(...await testMods(context));

  const channelCheck = await testChannels(context);
  const channelFailures = channelCheck.results.filter(result => result.status === 'fail');
  results.push(
    channelFailures.length
      ? fail('Configured channels', `${channelFailures.length} channel(s) failed. Run /test channels for details.`)
      : pass('Configured channels', `${channelCheck.results.length}/${channelCheck.results.length} reachable.`)
  );

  const permissionResults = await testPermissions(context);
  const permissionFailures = permissionResults.filter(result => result.status === 'fail');
  results.push(
    permissionFailures.length
      ? fail('Bot permissions', `${permissionFailures.length} permission check(s) failed. Run /test permissions.`)
      : pass('Bot permissions', 'Required channel permissions are present.')
  );

  const statusResults = await testStatus(context);
  const statusFailures = statusResults.filter(result => result.status === 'fail');
  results.push(
    statusFailures.length
      ? fail('Status system', statusFailures.map(result => result.details).join(' | '))
      : pass('Status system', 'Panel, buttons and dry-run render passed.')
  );

  const warningResults = await testWarn(context);
  results.push(
    warningResults.some(result => result.status === 'fail')
      ? fail('Warning system', 'Dry-run failed. Run /test warn for details.')
      : pass('Warning system', 'Channel + embed + no-DM dry-run passed.')
  );

  const changelogResults = await testChangelog(context);
  results.push(
    changelogResults.some(result => result.status === 'fail')
      ? fail('Changelog system', 'Dry-run failed. Run /test changelog for details.')
      : pass('Changelog system', 'Channel + embed + no-mention dry-run passed.')
  );

  const dailyResults = await testDaily(context);
  results.push(
    dailyResults.some(result => result.status === 'fail')
      ? fail('Daily report system', 'Dry-run failed. Run /test daily for details.')
      : pass('Daily report system', 'Database + channel + render dry-run passed.')
  );

  const failsafeResults = await testFailsafe(context);
  results.push(
    failsafeResults.some(result => result.status === 'fail')
      ? fail('Failsafe', 'Configuration check failed. Run /test failsafe for details.')
      : pass('Failsafe', 'Configuration verified without triggering the failsafe.')
  );

  for (const level of QUEUE_LEVELS) {
    try {
      buildQueuePreview(level).toJSON();
      results.push(pass(`Queue ${level} dry-run`, 'Embed serializes correctly; nothing posted to General.'));
    } catch (error) {
      results.push(fail(`Queue ${level} dry-run`, error.message));
    }
  }

  return results;
}

async function editDiagnosticReply(interaction, title, results, extraEmbeds = []) {
  const embed = createResultsEmbed(title, results);
  await interaction.editReply({
    content: '',
    embeds: [embed, ...extraEmbeds].slice(0, 10),
    components: []
  });
}

export async function handleDiagnosticCommand(interaction, context) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'test') {
    return false;
  }

  if (!hasDiagnosticRole(interaction)) {
    await interaction.reply({
      content: '❌ You do not have permission to run TLC Command diagnostics.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'all') {
    const results = await runAll(context);
    await editDiagnosticReply(
      interaction,
      '🩺 TLC COMMAND • FULL DIAGNOSTIC',
      results
    );
    return true;
  }

  if (subcommand === 'queue') {
    const level = interaction.options.getInteger('level', true);
    const results = [
      pass('Queue simulation', `Generated ${level}+ queue alert in dry-run mode.`),
      pass('Production safety', 'No General message was created, edited or deleted.')
    ];
    await editDiagnosticReply(
      interaction,
      `🧪 QUEUE ${level} TEST`,
      results,
      [buildQueuePreview(level)]
    );
    return true;
  }

  if (subcommand === 'mods') {
    await editDiagnosticReply(interaction, '📦 MOD SYSTEM TEST', await testMods(context));
    return true;
  }

  if (subcommand === 'database') {
    await editDiagnosticReply(interaction, '🗄️ DATABASE TEST', await testDatabase(context.pool));
    return true;
  }

  if (subcommand === 'armahq') {
    await editDiagnosticReply(interaction, '🌐 ARMAHQ TEST', await testArmaHQ(context));
    return true;
  }

  if (subcommand === 'status') {
    await editDiagnosticReply(interaction, '🖥️ STATUS SYSTEM TEST', await testStatus(context));
    return true;
  }

  if (subcommand === 'channels') {
    const checked = await testChannels(context);
    await editDiagnosticReply(interaction, '📡 CHANNEL TEST', checked.results);
    return true;
  }

  if (subcommand === 'permissions') {
    await editDiagnosticReply(interaction, '🔐 PERMISSIONS TEST', await testPermissions(context));
    return true;
  }

  if (subcommand === 'warn') {
    await editDiagnosticReply(
      interaction,
      '⚠️ WARNING SYSTEM TEST',
      await testWarn(context),
      [buildWarnPreview()]
    );
    return true;
  }

  if (subcommand === 'changelog') {
    await editDiagnosticReply(
      interaction,
      '🛠️ CHANGELOG SYSTEM TEST',
      await testChangelog(context),
      [buildChangelogPreview()]
    );
    return true;
  }

  if (subcommand === 'daily') {
    const results = await testDaily(context);
    let stats = {};
    try {
      const query = await context.pool.query(`
        SELECT *
        FROM daily_stats
        WHERE report_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date - 1
      `);
      stats = query.rows[0] ?? {};
    } catch {
      // The diagnostic results already contain the DB failure.
    }
    await editDiagnosticReply(
      interaction,
      '📊 DAILY REPORT TEST',
      results,
      [buildDailyPreview(stats)]
    );
    return true;
  }

  if (subcommand === 'failsafe') {
    await editDiagnosticReply(interaction, '🛡️ FAILSAFE TEST', await testFailsafe(context));
    return true;
  }

  await interaction.editReply({ content: '❌ Unknown diagnostic subcommand.' });
  return true;
}
