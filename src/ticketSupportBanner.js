import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { fileURLToPath } from 'node:url';

import { TICKET_CONFIG } from './config/tickets.js';

const SUPPORT_MENU_ID = 'tlc_ticket_type';
const SUPPORT_BANNER_NAME = 'tlc-support-banner.jpg';
const SUPPORT_BANNER_PATH = fileURLToPath(
  new URL('../assets/tlc-support-banner.jpg', import.meta.url)
);

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
    .setImage(`attachment://${SUPPORT_BANNER_NAME}`);

  const banner = new AttachmentBuilder(SUPPORT_BANNER_PATH, {
    name: SUPPORT_BANNER_NAME
  });

  await panel.edit({
    embeds: [embed],
    attachments: [],
    files: [banner]
  });

  console.log('[TICKETS] Exact TLC support banner applied.');
  return panel;
}
