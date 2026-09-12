import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  TICKET_CLOSE_OVERRIDE_ROLE_IDS,
  TICKET_CONFIG,
  TICKET_TRAINEE_APPROVER_ROLE_IDS,
  TICKET_TYPES
} from './config/tickets.js';

const SUPPORT_MENU_ID = 'tlc_ticket_type';
const BUTTON_PREFIX = 'tlc_ticket_';
const CLOSE_REASON_MODAL_PREFIX = 'tlc_ticket_close_reason:';
const DEFAULT_CLOSE_REASON = 'No reason provided.';
const closingTickets = new Set();

function roleMention(roleId) {
  return `<@&${roleId}>`;
}

function userMention(userId) {
  return `<@${userId}>`;
}

function discordTimestamp(date) {
  const timestamp = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${timestamp}:F>`;
}

function hasAnyRole(member, roleIds) {
  return member?.roles?.cache?.some(role => roleIds.includes(role.id)) ?? false;
}

function getTicketType(ticketTypeKey) {
  return TICKET_TYPES[ticketTypeKey] ?? null;
}

function getCurrentHandlerRoleIds(ticket) {
  const type = getTicketType(ticket.ticket_type);
  if (!type) return [];

  if (Number(ticket.escalation_index) === 0) {
    return type.initialRoleIds;
  }

  return type.escalationLevels[Number(ticket.escalation_index) - 1] ?? [];
}

function getNextEscalationRoleIds(ticket) {
  const type = getTicketType(ticket.ticket_type);
  if (!type) return [];

  return type.escalationLevels[Number(ticket.escalation_index)] ?? [];
}

function canClaim(member, ticket) {
  return hasAnyRole(member, TICKET_CLOSE_OVERRIDE_ROLE_IDS) || hasAnyRole(member, getCurrentHandlerRoleIds(ticket));
}

function canClose(member, ticket) {
  if (ticket.current_handler_id === member?.id) return true;
  return hasAnyRole(member, TICKET_CLOSE_OVERRIDE_ROLE_IDS);
}

function canApproveTrainee(member) {
  return hasAnyRole(member, TICKET_TRAINEE_APPROVER_ROLE_IDS);
}

function buildSupportSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SUPPORT_MENU_ID)
    .setPlaceholder('Select a ticket type...')
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(type.label)
          .setDescription(type.description)
          .setValue(value)
      )
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildSupportEmbed({ footerText, bannerUrl }) {
  const embed = new EmbedBuilder()
    .setTitle('TLC Support')
    .setDescription(
      '**Welcome to the TLC Support Center.**\n' +
      'Please select the appropriate ticket type from the menu below.\n\n' +
      'Make sure you choose the category that best matches your request so the correct staff team can assist you.'
    )
    .setColor(0x5865F2)
    .setFooter({ text: footerText });

  if (bannerUrl) {
    embed.setImage(bannerUrl);
  }

  return embed;
}

function buildTicketButtons(ticket) {
  const ticketNumber = ticket.ticket_number;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}claim:${ticketNumber}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary)
  ];

  const type = getTicketType(ticket.ticket_type);

  if (type?.traineeApproval) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}approve_trainee:${ticketNumber}`)
        .setLabel(ticket.trainee_approved_at ? 'Trainee Approved' : 'Approve as Trainee')
        .setStyle(ButtonStyle.Success)
        .setDisabled(Boolean(ticket.trainee_approved_at))
    );
  }

  if (getNextEscalationRoleIds(ticket).length > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}escalate:${ticketNumber}`)
        .setLabel('Escalate')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}close:${ticketNumber}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}close_reason:${ticketNumber}`)
      .setLabel('Close With Reason')
      .setStyle(ButtonStyle.Danger)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

function buildTicketEmbed(ticket, footerText) {
  const type = getTicketType(ticket.ticket_type);
  const fields = [
    {
      name: 'Ticket Type',
      value: type?.label ?? ticket.ticket_type,
      inline: true
    },
    {
      name: 'Opened By',
      value: userMention(ticket.opener_id),
      inline: true
    },
    {
      name: 'Status',
      value: `**${ticket.status.charAt(0).toUpperCase()}${ticket.status.slice(1)}**`,
      inline: true
    },
    {
      name: 'Current Handler',
      value: ticket.current_handler_id
        ? userMention(ticket.current_handler_id)
        : ticket.status === 'escalated'
          ? 'Awaiting claim'
          : 'None',
      inline: true
    }
  ];

  if (Number(ticket.escalation_index) > 0) {
    const currentRoles = getCurrentHandlerRoleIds(ticket);
    fields.push({
      name: 'Escalation Level',
      value: currentRoles.length > 0
        ? currentRoles.map(roleMention).join(' + ')
        : `Level ${ticket.escalation_index}`,
      inline: true
    });
  }

  if (ticket.status === 'escalated' && ticket.previous_handler_id) {
    fields.push({
      name: 'Previous Handler',
      value: userMention(ticket.previous_handler_id),
      inline: true
    });
  }

  return new EmbedBuilder()
    .setTitle(`TLC Support — Ticket #${ticket.ticket_number}`)
    .setDescription(type?.instructions ?? 'A member of the TLC Team will assist you shortly.')
    .addFields(fields)
    .setColor(
      ticket.status === 'escalated'
        ? 0xFEE75C
        : ticket.status === 'claimed'
          ? 0x57F287
          : 0x5865F2
    )
    .setFooter({ text: footerText })
    .setTimestamp(new Date(ticket.opened_at));
}

function buildInitialPing(ticket) {
  const type = getTicketType(ticket.ticket_type);
  const roleIds = [...new Set([
    ...(type?.initialRoleIds ?? []),
    ...(type?.openingPingRoleIds ?? [])
  ].filter(Boolean))];
  const userIds = [...new Set([
    ticket.opener_id,
    ...(type?.openingPingUserIds ?? [])
  ].filter(Boolean))];

  return {
    content: [
      ...roleIds.map(roleMention),
      ...userIds.map(userMention)
    ].join(' '),
    allowedMentions: {
      roles: roleIds,
      users: userIds
    }
  };
}

async function initializeTicketDatabase(pool, guild) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tlc_ticket_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL CHECK (next_number > 0)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tlc_tickets (
      ticket_number INTEGER PRIMARY KEY,
      channel_id TEXT UNIQUE NOT NULL,
      panel_message_id TEXT,
      ticket_type TEXT NOT NULL,
      opener_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'escalated', 'closed')),
      current_handler_id TEXT,
      previous_handler_id TEXT,
      escalation_index INTEGER NOT NULL DEFAULT 0 CHECK (escalation_index >= 0),
      trainee_approved_at TIMESTAMPTZ,
      trainee_approved_by_id TEXT,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      closed_by_id TEXT,
      close_reason TEXT
    );
  `);

  await pool.query(`
    ALTER TABLE tlc_tickets
    ADD COLUMN IF NOT EXISTS trainee_approved_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE tlc_tickets
    ADD COLUMN IF NOT EXISTS trainee_approved_by_id TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tlc_ticket_events (
      id BIGSERIAL PRIMARY KEY,
      ticket_number INTEGER NOT NULL REFERENCES tlc_tickets(ticket_number),
      event_type TEXT NOT NULL,
      actor_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tlc_ticket_events_ticket_idx
    ON tlc_ticket_events (ticket_number, created_at, id);
  `);

  let legacyMax = 0;

  for (const channel of guild.channels.cache.values()) {
    const match = /^ticket-(\d+)$/.exec(channel.name ?? '');
    if (match) legacyMax = Math.max(legacyMax, Number(match[1]));
  }

  try {
    const logChannel = await guild.channels.fetch(TICKET_CONFIG.ticketLogsChannelId);
    if (logChannel?.isTextBased()) {
      const recentLogs = await logChannel.messages.fetch({ limit: 100 });

      for (const message of recentLogs.values()) {
        for (const embed of message.embeds) {
          const ticketField = embed.fields?.find(field =>
            /ticket\s*id|ticket\s*#/i.test(field.name ?? '')
          );
          const candidates = [
            ticketField?.value,
            embed.title,
            embed.description
          ].filter(Boolean);

          for (const candidate of candidates) {
            const match = String(candidate).match(/(?:ticket\s*#?|^#?)(\d{1,8})/i);
            if (match) legacyMax = Math.max(legacyMax, Number(match[1]));
          }
        }
      }
    }
  } catch (error) {
    console.warn('[TICKETS] Could not inspect legacy ticket logs for numbering:', error?.message ?? error);
  }

  const dbMaxResult = await pool.query(`
    SELECT COALESCE(MAX(ticket_number), 0) AS max_ticket
    FROM tlc_tickets;
  `);
  const dbMax = Number(dbMaxResult.rows[0]?.max_ticket ?? 0);
  const desiredNext = Math.max(legacyMax, dbMax) + 1;

  await pool.query(`
    INSERT INTO tlc_ticket_state (id, next_number)
    VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET
      next_number = GREATEST(tlc_ticket_state.next_number, EXCLUDED.next_number);
  `, [desiredNext]);
}

async function allocateTicketNumber(pool) {
  const result = await pool.query(`
    UPDATE tlc_ticket_state
    SET next_number = next_number + 1
    WHERE id = 1
    RETURNING next_number - 1 AS ticket_number;
  `);

  if (result.rows.length === 0) {
    throw new Error('Ticket counter is not initialized.');
  }

  return Number(result.rows[0].ticket_number);
}

async function getTicketByNumber(pool, ticketNumber) {
  const result = await pool.query(`
    SELECT *
    FROM tlc_tickets
    WHERE ticket_number = $1;
  `, [ticketNumber]);

  return result.rows[0] ?? null;
}

async function recordTicketEvent(pool, ticketNumber, eventType, actorId, details = {}) {
  await pool.query(`
    INSERT INTO tlc_ticket_events (
      ticket_number,
      event_type,
      actor_id,
      details
    )
    VALUES ($1, $2, $3, $4::jsonb);
  `, [ticketNumber, eventType, actorId ?? null, JSON.stringify(details)]);
}

async function updateTicketPanel(client, pool, ticket, footerText) {
  if (!ticket.panel_message_id) return;

  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(ticket.panel_message_id).catch(() => null);
  if (!message) return;

  await message.edit({
    embeds: [buildTicketEmbed(ticket, footerText)],
    components: [buildTicketButtons(ticket)]
  });
}

async function resolveSupportBannerUrl(channel, client) {
  const messages = await channel.messages.fetch({ limit: 100 });

  const ownPanel = messages.find(message =>
    message.author.id === client.user.id &&
    message.components.some(row =>
      row.components.some(component => component.customId === SUPPORT_MENU_ID)
    )
  );

  const ownImage = ownPanel?.embeds?.[0]?.image?.url;
  if (ownImage) return ownImage;

  const legacyPanel = messages.find(message =>
    message.embeds.some(embed =>
      /tlc\s+support/i.test(embed.title ?? '') && Boolean(embed.image?.url)
    )
  );

  return legacyPanel?.embeds?.find(embed => embed.image?.url)?.image?.url ?? null;
}

async function ensureSupportPanel(client, footerText) {
  const channel = await client.channels.fetch(TICKET_CONFIG.supportChannelId);
  if (!channel?.isTextBased()) {
    throw new Error('TLC support-center channel was not found or is not text-based.');
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const existing = messages.find(message =>
    message.author.id === client.user.id &&
    message.components.some(row =>
      row.components.some(component => component.customId === SUPPORT_MENU_ID)
    )
  );

  const bannerUrl = await resolveSupportBannerUrl(channel, client);
  const payload = {
    embeds: [buildSupportEmbed({ footerText, bannerUrl })],
    components: [buildSupportSelectRow()],
    allowedMentions: { parse: [] }
  };

  if (existing) {
    await existing.edit(payload);
    console.log('[TICKETS] TLC support panel refreshed.');
    return existing;
  }

  const created = await channel.send(payload);
  console.log('[TICKETS] TLC support panel created.');
  return created;
}

async function grantTicketAccess(channel, targetId) {
  await channel.permissionOverwrites.edit(targetId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true
  });
}

async function createTicketFromSelection({ interaction, client, pool, footerText }) {
  const ticketTypeKey = interaction.values?.[0];
  const type = getTicketType(ticketTypeKey);

  if (!type) {
    return interaction.reply({
      content: '❌ Unknown ticket type.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (!guild) {
    return interaction.editReply('❌ Tickets can only be opened inside the TLC server.');
  }

  const ticketNumber = await allocateTicketNumber(pool);
  let channel = null;
  let db = null;
  let transactionOpen = false;

  try {
    channel = await guild.channels.create({
      name: `ticket-${ticketNumber}`,
      type: ChannelType.GuildText,
      parent: TICKET_CONFIG.ticketsCategoryId,
      reason: `TLC ticket #${ticketNumber} opened by ${interaction.user.tag}`
    });

    try {
      await channel.lockPermissions();
    } catch (error) {
      console.warn(
        `[TICKETS] Could not sync permissions for ticket-${ticketNumber}:`,
        error?.message ?? error
      );
    }

    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      ViewChannel: false
    });
    await grantTicketAccess(channel, interaction.user.id);

    const accessRoleIds = [...new Set([
      ...type.initialRoleIds,
      ...(type.openingPingRoleIds ?? [])
    ].filter(Boolean))];
    const accessUserIds = [...new Set(
      (type.openingPingUserIds ?? []).filter(Boolean)
    )];

    for (const roleId of accessRoleIds) {
      await grantTicketAccess(channel, roleId);
    }
    for (const userId of accessUserIds) {
      await grantTicketAccess(channel, userId);
    }

    db = await pool.connect();
    await db.query('BEGIN');
    transactionOpen = true;

    const insertResult = await db.query(`
      INSERT INTO tlc_tickets (
        ticket_number,
        channel_id,
        ticket_type,
        opener_id,
        status,
        escalation_index
      )
      VALUES ($1, $2, $3, $4, 'open', 0)
      RETURNING *;
    `, [ticketNumber, channel.id, ticketTypeKey, interaction.user.id]);

    let ticket = insertResult.rows[0];
    if (!ticket) {
      throw new Error(`Ticket #${ticketNumber} insert returned no row.`);
    }

    await recordTicketEvent(db, ticketNumber, 'opened', interaction.user.id, {
      ticketType: ticketTypeKey,
      channelId: channel.id,
      initialRoleIds: type.initialRoleIds,
      openingPingRoleIds: type.openingPingRoleIds ?? [],
      openingPingUserIds: type.openingPingUserIds ?? []
    });

    const ping = buildInitialPing(ticket);
    const panelMessage = await channel.send({
      ...ping,
      embeds: [buildTicketEmbed(ticket, footerText)],
      components: [buildTicketButtons(ticket)]
    });

    const updatedResult = await db.query(`
      UPDATE tlc_tickets
      SET panel_message_id = $2
      WHERE ticket_number = $1
      RETURNING *;
    `, [ticketNumber, panelMessage.id]);

    ticket = updatedResult.rows[0];
    if (!ticket) {
      throw new Error(`Ticket #${ticketNumber} panel update returned no row.`);
    }

    await db.query('COMMIT');
    transactionOpen = false;

    await interaction.editReply({
      content: `✅ Your ticket has been created: ${channel}`
    });

    console.log(
      `[TICKETS] Opened ticket-${ticketNumber} (${type.label}) for ${interaction.user.tag}.`
    );
  } catch (error) {
    if (db && transactionOpen) {
      await db.query('ROLLBACK').catch(rollbackError => {
        console.error(
          `[TICKETS] Failed to roll back ticket-${ticketNumber} database transaction:`,
          rollbackError
        );
      });
      transactionOpen = false;
    }

    if (channel) {
      await channel.delete(
        `Rolling back failed TLC ticket #${ticketNumber} creation`
      ).catch(deleteError => {
        console.error(
          `[TICKETS] Failed to remove orphaned ticket-${ticketNumber}:`,
          deleteError
        );
      });
    }

    console.error(
      `[TICKETS] Ticket-${ticketNumber} creation failed and was rolled back:`,
      error
    );
    throw error;
  } finally {
    if (db) db.release();
  }
}

function parseTicketButton(customId) {
  const match = /^tlc_ticket_(claim|escalate|approve_trainee|close|close_reason):(\d+)$/.exec(customId);
  if (!match) return null;

  return {
    action: match[1],
    ticketNumber: Number(match[2])
  };
}

async function validateTicketInteraction(interaction, pool, ticketNumber) {
  const ticket = await getTicketByNumber(pool, ticketNumber);

  if (!ticket || ticket.status === 'closed') {
    await interaction.reply({
      content: '❌ This ticket is no longer active.',
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  if (ticket.channel_id !== interaction.channelId) {
    await interaction.reply({
      content: '❌ This control does not belong to this channel.',
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  return ticket;
}

async function handleClaim({ interaction, client, pool, footerText, ticket }) {
  if (!canClaim(interaction.member, ticket)) {
    return interaction.reply({
      content: '❌ You are not part of the staff level currently assigned to this ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (ticket.current_handler_id === interaction.user.id) {
    return interaction.reply({
      content: 'ℹ️ You are already the current handler for this ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  const previousHandlerId = ticket.current_handler_id;
  const result = await pool.query(`
    UPDATE tlc_tickets
    SET
      current_handler_id = $2,
      previous_handler_id = $3,
      status = 'claimed'
    WHERE ticket_number = $1
    RETURNING *;
  `, [ticket.ticket_number, interaction.user.id, previousHandlerId ?? ticket.previous_handler_id]);

  const updated = result.rows[0];
  await recordTicketEvent(pool, ticket.ticket_number, 'claimed', interaction.user.id, {
    previousHandlerId: previousHandlerId ?? null,
    escalationIndex: Number(updated.escalation_index)
  });
  await updateTicketPanel(client, pool, updated, footerText);

  return interaction.reply({
    content: '✅ You are now the current handler for this ticket.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleEscalate({ interaction, client, pool, footerText, ticket }) {
  if (ticket.current_handler_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Only the current ticket handler can escalate this ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  const nextRoleIds = getNextEscalationRoleIds(ticket);
  if (nextRoleIds.length === 0) {
    return interaction.reply({
      content: '❌ This ticket has no further escalation level.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.channel;
  for (const roleId of nextRoleIds) {
    await grantTicketAccess(channel, roleId);
  }

  const previousHandlerId = ticket.current_handler_id;
  const result = await pool.query(`
    UPDATE tlc_tickets
    SET
      status = 'escalated',
      previous_handler_id = $2,
      current_handler_id = NULL,
      escalation_index = escalation_index + 1
    WHERE ticket_number = $1
    RETURNING *;
  `, [ticket.ticket_number, previousHandlerId]);

  const updated = result.rows[0];
  await recordTicketEvent(pool, ticket.ticket_number, 'escalated', interaction.user.id, {
    fromHandlerId: previousHandlerId,
    toRoleIds: nextRoleIds,
    escalationIndex: Number(updated.escalation_index)
  });

  await updateTicketPanel(client, pool, updated, footerText);

  await channel.send({
    content:
      `⬆️ Ticket #${ticket.ticket_number} has been escalated by ${userMention(interaction.user.id)} to ` +
      `${nextRoleIds.map(roleMention).join(' + ')}.`,
    allowedMentions: {
      roles: nextRoleIds,
      users: [interaction.user.id]
    }
  });

  await interaction.editReply('✅ Ticket escalated. The current handler has been released.');
}

async function handleApproveTrainee({ interaction, client, pool, footerText, ticket }) {
  const type = getTicketType(ticket.ticket_type);
  const approval = type?.traineeApproval;

  if (!approval) {
    return interaction.reply({
      content: '❌ This ticket type does not support trainee approval.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!canApproveTrainee(interaction.member)) {
    return interaction.reply({
      content: '❌ Only Owner, Senior Admin, or Discord Admin can approve trainee roles.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (ticket.trainee_approved_at) {
    return interaction.reply({
      content: 'ℹ️ This applicant has already been approved as a trainee through this ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const applicant = await guild.members.fetch(ticket.opener_id).catch(() => null);

  if (!applicant) {
    return interaction.editReply('❌ The applicant is no longer available in this Discord server.');
  }

  try {
    if (!applicant.roles.cache.has(approval.roleId)) {
      await applicant.roles.add(
        approval.roleId,
        `TLC ticket #${ticket.ticket_number} trainee approval by ${interaction.user.tag}`
      );
    }
  } catch (error) {
    console.error(`[TICKETS] Could not assign trainee role for ticket-${ticket.ticket_number}:`, error);
    return interaction.editReply(
      '❌ I could not assign the trainee role. Please check the bot role hierarchy and permissions.'
    );
  }

  const result = await pool.query(`
    UPDATE tlc_tickets
    SET
      trainee_approved_at = NOW(),
      trainee_approved_by_id = $2
    WHERE ticket_number = $1
      AND trainee_approved_at IS NULL
    RETURNING *;
  `, [ticket.ticket_number, interaction.user.id]);

  if (result.rows.length === 0) {
    return interaction.editReply('ℹ️ This applicant has already been approved as a trainee through this ticket.');
  }

  const updated = result.rows[0];

  await recordTicketEvent(pool, ticket.ticket_number, 'trainee_approved', interaction.user.id, {
    applicantId: ticket.opener_id,
    roleId: approval.roleId,
    roleName: approval.roleName
  });

  await updateTicketPanel(client, pool, updated, footerText);

  await interaction.channel.send({
    content: [
      `${userMention(ticket.opener_id)}, your application has been approved for the **${approval.roleName}** stage.`,
      '',
      `You have now been given the **${approval.roleName}** role and access to the ${approval.accessChannelName}.`,
      '',
      approval.evaluationText,
      '',
      `Once you successfully complete the evaluation, you will be considered for the **${approval.nextRoleName}** role.`,
      '',
      'This ticket can now be closed.'
    ].join('\n'),
    allowedMentions: {
      users: [ticket.opener_id],
      roles: []
    }
  });

  return interaction.editReply(
    `✅ ${approval.roleName} assigned to ${userMention(ticket.opener_id)} and the approval message was posted.`
  );
}

function buildCloseReasonModal(ticketNumber) {
  const modal = new ModalBuilder()
    .setCustomId(`${CLOSE_REASON_MODAL_PREFIX}${ticketNumber}`)
    .setTitle(`Close Ticket #${ticketNumber}`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Close reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('Why is this ticket being closed?');

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMessageContent(message) {
  const content = message.content?.trim()
    ? `<div class="content">${escapeHtml(message.content).replaceAll('\n', '<br>')}</div>`
    : '';

  const attachments = [...message.attachments.values()].map(attachment =>
    `<div class="attachment"><a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name ?? 'Attachment')}</a></div>`
  ).join('');

  const embeds = message.embeds.map(embed => {
    const fields = (embed.fields ?? []).map(field =>
      `<div class="embed-field"><strong>${escapeHtml(field.name)}</strong><br>${escapeHtml(field.value).replaceAll('\n', '<br>')}</div>`
    ).join('');

    return `<div class="discord-embed">${
      embed.title ? `<strong>${escapeHtml(embed.title)}</strong>` : ''
    }${
      embed.description ? `<div>${escapeHtml(embed.description).replaceAll('\n', '<br>')}</div>` : ''
    }${fields}</div>`;
  }).join('');

  return content + attachments + embeds || '<div class="content muted">No text content available.</div>';
}

function eventSummary(event) {
  const details = event.details ?? {};

  if (event.event_type === 'opened') {
    return `Ticket opened by ${event.actor_id ? userMention(event.actor_id) : 'unknown user'}`;
  }
  if (event.event_type === 'claimed') {
    return `Claimed by ${event.actor_id ? userMention(event.actor_id) : 'unknown staff'}`;
  }
  if (event.event_type === 'trainee_approved') {
    return `Trainee role approved by ${event.actor_id ? userMention(event.actor_id) : 'unknown staff'}`;
  }
  if (event.event_type === 'escalated') {
    const roles = Array.isArray(details.toRoleIds)
      ? details.toRoleIds.map(roleMention).join(' + ')
      : 'next level';
    return `Escalated by ${event.actor_id ? userMention(event.actor_id) : 'unknown staff'} to ${roles}`;
  }
  if (event.event_type === 'closed') {
    return `Closed by ${event.actor_id ? userMention(event.actor_id) : 'unknown staff'}`;
  }

  return `${event.event_type} by ${event.actor_id ?? 'system'}`;
}

async function fetchAllTicketMessages(channel) {
  const all = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });

    if (batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function buildHtmlTranscript({ channel, ticket, events, closingInfo = null }) {
  const messages = await fetchAllTicketMessages(channel);
  const type = getTicketType(ticket.ticket_type);
  const transcriptEvents = closingInfo
    ? [
        ...events,
        {
          event_type: 'closed',
          actor_id: closingInfo.closerId,
          details: { reason: closingInfo.reason },
          created_at: closingInfo.closedAt
        }
      ]
    : events;

  const eventRows = transcriptEvents.map(event =>
    `<li><strong>${escapeHtml(new Date(event.created_at).toISOString())}</strong> — ${escapeHtml(eventSummary(event))}</li>`
  ).join('');

  const messageRows = messages.map(message => {
    const displayName = message.member?.displayName ?? message.author.globalName ?? message.author.username;
    const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 64 });
    const edited = message.editedTimestamp ? ' · edited' : '';

    return `
      <article class="message">
        <img class="avatar" src="${escapeHtml(avatarUrl)}" alt="">
        <div class="message-body">
          <div class="meta">
            <strong>${escapeHtml(displayName)}</strong>
            <span>@${escapeHtml(message.author.username)}</span>
            <time>${escapeHtml(new Date(message.createdTimestamp).toISOString())}${edited}</time>
          </div>
          ${renderMessageContent(message)}
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TLC Ticket #${ticket.ticket_number} Transcript</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#111214; color:#dbdee1; font:15px/1.45 Arial,Helvetica,sans-serif; }
  .wrap { width:min(1100px,calc(100% - 32px)); margin:32px auto; }
  .card { background:#1e1f22; border:1px solid #2b2d31; border-radius:10px; padding:20px; margin-bottom:18px; }
  h1,h2 { margin:0 0 12px; color:#f2f3f5; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px 18px; }
  .label { color:#949ba4; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  .value { color:#f2f3f5; margin-top:2px; }
  .message { display:flex; gap:12px; padding:12px 8px; border-top:1px solid #2b2d31; }
  .message:first-child { border-top:0; }
  .avatar { width:40px; height:40px; border-radius:50%; flex:0 0 40px; }
  .message-body { min-width:0; flex:1; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
  .meta span,.meta time,.muted { color:#949ba4; font-size:12px; }
  .content { white-space:normal; overflow-wrap:anywhere; margin-top:3px; }
  a { color:#00a8fc; }
  .attachment,.discord-embed { margin-top:8px; padding:10px; background:#2b2d31; border-radius:6px; }
  .discord-embed { border-left:4px solid #5865f2; }
  .embed-field { margin-top:8px; }
  ul { margin:8px 0 0; padding-left:20px; }
  footer { color:#949ba4; text-align:center; padding:12px; }
</style>
</head>
<body>
<div class="wrap">
  <section class="card">
    <h1>TLC Ticket #${ticket.ticket_number}</h1>
    <div class="grid">
      <div><div class="label">Ticket Type</div><div class="value">${escapeHtml(type?.label ?? ticket.ticket_type)}</div></div>
      <div><div class="label">Opened By</div><div class="value">${escapeHtml(ticket.opener_id)}</div></div>
      <div><div class="label">Final Handler</div><div class="value">${escapeHtml(ticket.current_handler_id ?? 'None')}</div></div>
      <div><div class="label">Opened At</div><div class="value">${escapeHtml(new Date(ticket.opened_at).toISOString())}</div></div>
      ${closingInfo ? `<div><div class="label">Closed By</div><div class="value">${escapeHtml(closingInfo.closerId)}</div></div>` : ''}
      ${closingInfo ? `<div><div class="label">Closed At</div><div class="value">${escapeHtml(new Date(closingInfo.closedAt).toISOString())}</div></div>` : ''}
      ${closingInfo ? `<div><div class="label">Close Reason</div><div class="value">${escapeHtml(closingInfo.reason)}</div></div>` : ''}
    </div>
  </section>
  <section class="card">
    <h2>Ticket History</h2>
    <ul>${eventRows || '<li>No lifecycle events recorded.</li>'}</ul>
  </section>
  <section class="card">
    <h2>Conversation</h2>
    ${messageRows || '<div class="muted">No messages found.</div>'}
  </section>
  <footer>TLC Command • Ticket transcript</footer>
</div>
</body>
</html>`;
}

async function getTicketEvents(pool, ticketNumber) {
  const result = await pool.query(`
    SELECT *
    FROM tlc_ticket_events
    WHERE ticket_number = $1
    ORDER BY created_at ASC, id ASC;
  `, [ticketNumber]);

  return result.rows;
}

function buildClosedTicketEmbed({ ticket, closerId, reason, events, footerText, closedAt }) {
  const type = getTicketType(ticket.ticket_type);
  const escalationEvents = events.filter(event => event.event_type === 'escalated');
  const fields = [
    { name: 'Ticket ID', value: `${ticket.ticket_number}`, inline: true },
    { name: 'Ticket Type', value: type?.label ?? ticket.ticket_type, inline: true },
    { name: 'Opened By', value: userMention(ticket.opener_id), inline: true },
    { name: 'Closed By', value: userMention(closerId), inline: true },
    { name: 'Final Handler', value: ticket.current_handler_id ? userMention(ticket.current_handler_id) : 'None', inline: true },
    { name: 'Escalated', value: escalationEvents.length > 0 ? 'Yes' : 'No', inline: true },
    { name: 'Opened At', value: discordTimestamp(ticket.opened_at), inline: false },
    { name: 'Closed At', value: discordTimestamp(closedAt), inline: false },
    { name: 'Reason', value: reason, inline: false }
  ];

  if (escalationEvents.length > 0) {
    const path = escalationEvents.map(event => {
      const roles = Array.isArray(event.details?.toRoleIds)
        ? event.details.toRoleIds.map(roleMention).join(' + ')
        : 'Unknown';
      return roles;
    }).join(' → ');

    fields.push({
      name: 'Escalation Path',
      value: path,
      inline: false
    });
  }

  return new EmbedBuilder()
    .setTitle(`Ticket #${ticket.ticket_number} — Closed`)
    .addFields(fields)
    .setColor(0xED4245)
    .setFooter({ text: footerText })
    .setTimestamp();
}

async function closeTicket({ interaction, client, pool, footerText, ticket, reason }) {
  if (!canClose(interaction.member, ticket)) {
    return interaction.reply({
      content: '❌ Only the current handler or an authorized senior staff override can close this ticket.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (closingTickets.has(ticket.ticket_number)) {
    return interaction.reply({
      content: 'ℹ️ This ticket is already being closed.',
      flags: MessageFlags.Ephemeral
    });
  }

  closingTickets.add(ticket.ticket_number);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.channel;
    const eventsBeforeClose = await getTicketEvents(pool, ticket.ticket_number);
    const closedAt = new Date();
    const html = await buildHtmlTranscript({
      channel,
      ticket,
      events: eventsBeforeClose,
      closingInfo: {
        closerId: interaction.user.id,
        reason,
        closedAt
      }
    });

    const logChannel = await client.channels.fetch(TICKET_CONFIG.ticketLogsChannelId);
    if (!logChannel?.isTextBased()) {
      throw new Error('Ticket log channel not found or is not text-based.');
    }

    const logEmbed = buildClosedTicketEmbed({
      ticket,
      closerId: interaction.user.id,
      reason,
      events: eventsBeforeClose,
      footerText,
      closedAt
    });
    const transcript = new AttachmentBuilder(Buffer.from(html, 'utf8'), {
      name: `ticket-${ticket.ticket_number}-transcript.html`
    });

    await logChannel.send({
      embeds: [logEmbed],
      files: [transcript],
      allowedMentions: { parse: [] }
    });

    await pool.query(`
      UPDATE tlc_tickets
      SET
        status = 'closed',
        closed_at = NOW(),
        closed_by_id = $2,
        close_reason = $3
      WHERE ticket_number = $1;
    `, [ticket.ticket_number, interaction.user.id, reason]);

    await recordTicketEvent(pool, ticket.ticket_number, 'closed', interaction.user.id, {
      reason,
      finalHandlerId: ticket.current_handler_id ?? null,
      overrideClose: ticket.current_handler_id !== interaction.user.id
    });

    await interaction.editReply('✅ Ticket logged and transcript saved. Closing channel...');

    setTimeout(() => {
      channel.delete(`TLC ticket #${ticket.ticket_number} closed by ${interaction.user.tag}`)
        .catch(error => console.error(`[TICKETS] Failed to delete ticket-${ticket.ticket_number}:`, error));
    }, 1500);
  } catch (error) {
    console.error(`[TICKETS] Failed to close ticket-${ticket.ticket_number}:`, error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ The ticket could not be safely closed. It has been left open.').catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ The ticket could not be safely closed. It has been left open.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  } finally {
    closingTickets.delete(ticket.ticket_number);
  }
}

async function handleTicketButton({ interaction, client, pool, footerText }) {
  const parsed = parseTicketButton(interaction.customId);
  if (!parsed) return false;

  const ticket = await validateTicketInteraction(interaction, pool, parsed.ticketNumber);
  if (!ticket) return true;

  if (parsed.action === 'claim') {
    await handleClaim({ interaction, client, pool, footerText, ticket });
    return true;
  }

  if (parsed.action === 'escalate') {
    await handleEscalate({ interaction, client, pool, footerText, ticket });
    return true;
  }

  if (parsed.action === 'approve_trainee') {
    await handleApproveTrainee({ interaction, client, pool, footerText, ticket });
    return true;
  }

  if (parsed.action === 'close') {
    await closeTicket({
      interaction,
      client,
      pool,
      footerText,
      ticket,
      reason: DEFAULT_CLOSE_REASON
    });
    return true;
  }

  if (parsed.action === 'close_reason') {
    if (!canClose(interaction.member, ticket)) {
      await interaction.reply({
        content: '❌ Only the current handler or an authorized senior staff override can close this ticket.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.showModal(buildCloseReasonModal(ticket.ticket_number));
    return true;
  }

  return false;
}

async function handleCloseReasonModal({ interaction, client, pool, footerText }) {
  if (!interaction.customId.startsWith(CLOSE_REASON_MODAL_PREFIX)) return false;

  const ticketNumber = Number(interaction.customId.slice(CLOSE_REASON_MODAL_PREFIX.length));
  if (!Number.isInteger(ticketNumber)) return false;

  const ticket = await getTicketByNumber(pool, ticketNumber);
  if (!ticket || ticket.status === 'closed' || ticket.channel_id !== interaction.channelId) {
    await interaction.reply({
      content: '❌ This ticket is no longer active.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  await closeTicket({
    interaction,
    client,
    pool,
    footerText,
    ticket,
    reason: reason || DEFAULT_CLOSE_REASON
  });
  return true;
}

async function handleTicketInteraction({ interaction, client, pool, footerText }) {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === SUPPORT_MENU_ID) {
      await createTicketFromSelection({ interaction, client, pool, footerText });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) {
      await handleTicketButton({ interaction, client, pool, footerText });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CLOSE_REASON_MODAL_PREFIX)) {
      await handleCloseReasonModal({ interaction, client, pool, footerText });
    }
  } catch (error) {
    console.error('[TICKETS] Interaction error:', error);

    if (interaction.deferred) {
      await interaction.editReply('❌ Something went wrong while processing this ticket action.').catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp({
        content: '❌ Something went wrong while processing this ticket action.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ Something went wrong while processing this ticket action.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

export async function initializeTicketSystem({ client, pool, footerText }) {
  if (!client || !pool) {
    throw new TypeError('initializeTicketSystem requires both client and pool.');
  }

  const guild = client.guilds.cache.first();
  if (!guild) {
    throw new Error('TLC guild is not available in the Discord client cache.');
  }

  await initializeTicketDatabase(pool, guild);

  client.on('interactionCreate', interaction => {
    void handleTicketInteraction({ interaction, client, pool, footerText });
  });

  await ensureSupportPanel(client, footerText);
  console.log('[TICKETS] TLC ticket system initialized.');
}

export const __ticketInternals = {
  buildSupportSelectRow,
  buildTicketButtons,
  getCurrentHandlerRoleIds,
  getNextEscalationRoleIds,
  parseTicketButton,
  canApproveTrainee
};
