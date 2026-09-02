import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import pg from 'pg';
import {
  buildRollingModAlertDescription,
  countRollingModChanges,
  groupRollingModEvents
} from './rollingModAlerts.js';

const { Client } = pg;

export const MOD_CHANGES_OWNER_ID = '758072706099970129';
const COMMAND_DESCRIPTION_LIMIT_PER_EMBED = 2600;

export const modChangesCommand = new SlashCommandBuilder()
  .setName('modchanges')
  .setDescription('Post the current TLC mod additions and removals in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

function buildHistoryDescription(events, type) {
  if (events.length > 0) {
    return buildRollingModAlertDescription(
      events,
      COMMAND_DESCRIPTION_LIMIT_PER_EMBED
    );
  }

  return type === 'added'
    ? '*No mod additions recorded.*'
    : '*No mod removals recorded.*';
}

function buildHistoryEmbed({ type, events, activeMods, footerText }) {
  const isRemoval = type === 'removed';
  const total = countRollingModChanges(events);

  return new EmbedBuilder()
    .setTitle(
      isRemoval
        ? '🗑️ CURRENT MOD REMOVALS'
        : '➕ CURRENT MOD ADDITIONS'
    )
    .setDescription(buildHistoryDescription(events, type))
    .addFields(
      {
        name: '📦 Current Active Mods',
        value: Number.isInteger(activeMods) ? `${activeMods}` : 'Unknown',
        inline: true
      },
      {
        name: isRemoval ? '🗑️ Removals Shown' : '➕ Additions Shown',
        value: `${total}`,
        inline: true
      }
    )
    .setColor(isRemoval ? 0xED4245 : 0x57F287)
    .setFooter({ text: footerText });
}

export function createModChangesCommandEmbeds({
  added = [],
  removed = [],
  activeMods = null,
  footerText
}) {
  return [
    buildHistoryEmbed({
      type: 'added',
      events: added,
      activeMods,
      footerText
    }),
    buildHistoryEmbed({
      type: 'removed',
      events: removed,
      activeMods,
      footerText
    })
  ];
}

function hasRecordedChanges(history) {
  return (
    Array.isArray(history?.added) && history.added.length > 0
  ) || (
    Array.isArray(history?.removed) && history.removed.length > 0
  );
}

export async function queryLatestRecordedModHistory(db) {
  const latestDateResult = await db.query(`
    SELECT TO_CHAR(MAX(report_date), 'YYYY-MM-DD') AS report_date
    FROM (
      SELECT report_date FROM mod_alert_events
      UNION ALL
      SELECT report_date FROM daily_mod_changes
    ) recorded_days;
  `);
  const reportDate = latestDateResult.rows[0]?.report_date ?? null;

  if (!reportDate) return null;

  const historyResult = await db.query(`
    SELECT change_type, mod_id, mod_name, detected_at
    FROM (
      SELECT
        event.change_type,
        event.mod_id,
        event.mod_name,
        event.detected_at
      FROM mod_alert_events event
      WHERE event.report_date = $1::date

      UNION ALL

      SELECT
        daily.change_type,
        daily.mod_id,
        daily.mod_name,
        daily.detected_at
      FROM daily_mod_changes daily
      WHERE daily.report_date = $1::date
        AND NOT EXISTS (
          SELECT 1
          FROM mod_alert_events event
          WHERE event.report_date = daily.report_date
            AND event.change_type = daily.change_type
            AND event.mod_id = daily.mod_id
            AND event.detected_at = daily.detected_at
        )
    ) history
    ORDER BY detected_at ASC, LOWER(mod_name) ASC, mod_id ASC;
  `, [reportDate]);

  return {
    reportDate,
    activeMods: null,
    added: groupRollingModEvents(
      historyResult.rows.filter(row => row.change_type === 'added')
    ),
    removed: groupRollingModEvents(
      historyResult.rows.filter(row => row.change_type === 'removed')
    )
  };
}

async function getLatestRecordedModHistoryFromDatabase() {
  if (!process.env.DATABASE_URL) return null;

  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  let connected = false;

  try {
    await client.connect();
    connected = true;
    return await queryLatestRecordedModHistory(client);
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

export async function handleModChangesCommand(interaction, context) {
  if (interaction.user.id !== MOD_CHANGES_OWNER_ID) {
    await interaction.reply({
      content: '❌ You are not authorized to use this command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();

  let current = await context.getCurrentRollingModHistory();

  if (!hasRecordedChanges(current)) {
    try {
      const loadLatestHistory = context.getLatestRecordedModHistory
        ?? getLatestRecordedModHistoryFromDatabase;
      const latestHistory = await loadLatestHistory();

      if (hasRecordedChanges(latestHistory)) {
        current = latestHistory;
      }
    } catch (error) {
      console.error('❌ Failed to load persistent mod history:', error);
    }
  }

  let activeMods = current.activeMods;

  if (!Number.isInteger(activeMods)) {
    const mods = await context.fetchServerMods();
    activeMods = mods.length;
  }

  const embeds = createModChangesCommandEmbeds({
    ...current,
    activeMods,
    footerText: context.footerText
  });

  await interaction.editReply({ embeds });
}
