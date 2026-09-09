import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

import {
  TICKET_CLOSE_OVERRIDE_ROLE_IDS,
  TICKET_CONFIG
} from './config/tickets.js';

const SUPPORT_MENU_ID = 'tlc_ticket_type';
const COMMAND_NAME = 'supportbanner';

function hasOverrideRole(member) {
  return member?.roles?.cache?.some(role =>
    TICKET_CLOSE_OVERRIDE_ROLE_IDS.includes(role.id)
  ) ?? false;
}

async function findSupportPanel(client) {
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
    throw new Error('TLC support panel was not found.');
  }

  return panel;
}

async function applyUploadedBanner(client, attachment) {
  if (!attachment?.url) {
    throw new Error('No image attachment was supplied.');
  }

  if (attachment.contentType && !attachment.contentType.startsWith('image/')) {
    throw new Error('The supplied attachment is not an image.');
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Could not download the supplied image (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? attachment.contentType ?? 'image/jpeg';
  const extension = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('gif')
        ? 'gif'
        : 'jpg';
  const filename = `tlc-support-banner.${extension}`;

  const panel = await findSupportPanel(client);
  const currentEmbed = panel.embeds[0];
  if (!currentEmbed) {
    throw new Error('TLC support panel does not contain an embed.');
  }

  const embed = EmbedBuilder.from(currentEmbed)
    .setImage(`attachment://${filename}`);

  await panel.edit({
    embeds: [embed],
    attachments: [],
    files: [
      new AttachmentBuilder(buffer, { name: filename })
    ]
  });

  console.log(`[TICKETS] Support banner replaced from Discord upload (${filename}, ${buffer.length} bytes).`);
}

async function registerSupportBannerCommand(client) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.FAILSAFE_GUILD_ID;
  if (!token || !guildId) {
    throw new Error('Missing bot token or guild ID for /supportbanner registration.');
  }

  const applicationId = Buffer
    .from(token.split('.')[0], 'base64')
    .toString('utf8');

  if (!/^\d+$/.test(applicationId)) {
    throw new Error('Could not derive Discord application ID from bot token.');
  }

  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Replace the TLC Support Center banner')
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('The exact banner image to use')
        .setRequired(true)
    );

  const rest = new REST({ version: '10' }).setToken(token);
  const route = Routes.applicationGuildCommands(applicationId, guildId);
  const commands = await rest.get(route);
  const existing = Array.isArray(commands)
    ? commands.find(entry => entry.name === COMMAND_NAME)
    : null;

  if (existing) {
    await rest.patch(
      Routes.applicationGuildCommand(applicationId, guildId, existing.id),
      { body: command.toJSON() }
    );
  } else {
    await rest.post(route, { body: command.toJSON() });
  }

  console.log('✅ [TICKETS] /supportbanner command registered.');
}

const initializedClients = new WeakSet();
const originalLogin = Client.prototype.login;

Client.prototype.login = function patchedSupportBannerLogin(...args) {
  const client = this;

  if (!initializedClients.has(client)) {
    initializedClients.add(client);

    client.once('clientReady', () => {
      void registerSupportBannerCommand(client).catch(error => {
        console.error('❌ [TICKETS] /supportbanner registration failed:', error);
      });
    });

    client.on('interactionCreate', interaction => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) {
        return;
      }

      void (async () => {
        if (!hasOverrideRole(interaction.member)) {
          await interaction.reply({
            content: '❌ You are not authorized to replace the TLC support banner.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const attachment = interaction.options.getAttachment('image', true);
        await applyUploadedBanner(client, attachment);
        await interaction.editReply('✅ TLC Support Center banner replaced successfully.');
      })().catch(async error => {
        console.error('❌ [TICKETS] Failed to replace support banner:', error);

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('❌ The support banner could not be replaced.').catch(() => {});
        } else {
          await interaction.reply({
            content: '❌ The support banner could not be replaced.',
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
      });
    });
  }

  return originalLogin.apply(client, args);
};

console.log('✅ [TICKETS] Support banner command bridge armed.');
