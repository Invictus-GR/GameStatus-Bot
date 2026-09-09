import { EmbedBuilder } from 'discord.js';

import { TICKET_CONFIG } from './config/tickets.js';

const SUPPORT_MENU_ID = 'tlc_ticket_type';
const SUPPORT_BANNER_URL =
  'https://raw.githubusercontent.com/Invictus-GR/GameStatus-Bot/main/assets/tlc-support-banner.jpg';

export async function applyTicketSupportBanner(client) {
  const channel = await client.channels.fetch(TICKET_CONFIG.supportChannelId);
  if (!channel?.isTextBased()) {
    throw new Error('TLC support-center channel was not found or is not text-based.');
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const panel = messages.find(message =>
    message.author.id === client.user.id &&
    message.components.some(row =>
      row.components.some(component => component.customId === SUPPORT_MENU_ID)
    )
  );

  if (!panel) {
    throw new Error('TLC support panel was not found after ticket initialization.');
  }

  const currentEmbed = panel.embeds[0];
  if (!currentEmbed) {
    throw new Error('TLC support panel does not contain an embed.');
  }

  const embed = EmbedBuilder.from(currentEmbed)
    .setImage(SUPPORT_BANNER_URL);

  await panel.edit({
    embeds: [embed],
    attachments: []
  });

  console.log('[TICKETS] Exact TLC support banner applied from GitHub.');
  return panel;
}
