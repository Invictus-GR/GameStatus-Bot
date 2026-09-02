import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  buildRollingModAlertDescription,
  countRollingModChanges
} from './rollingModAlerts.js';

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
    ? '*No confirmed mod additions in the current UK reporting period.*'
    : '*No confirmed mod removals in the current UK reporting period.*';
}

function buildHistoryEmbed({ type, events, activeMods, reportDate, footerText }) {
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
    .setFooter({
      text: `${reportDate} UK reporting day • ${footerText}`
    });
}

export function createModChangesCommandEmbeds({
  added = [],
  removed = [],
  activeMods = null,
  reportDate,
  footerText
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new TypeError('A valid report date is required for /modchanges.');
  }

  return [
    buildHistoryEmbed({
      type: 'added',
      events: added,
      activeMods,
      reportDate,
      footerText
    }),
    buildHistoryEmbed({
      type: 'removed',
      events: removed,
      activeMods,
      reportDate,
      footerText
    })
  ];
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

  const current = await context.getCurrentRollingModHistory();
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
