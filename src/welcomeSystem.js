import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import pg from 'pg';

import { client } from './bot.js';
import { TICKET_CLOSE_OVERRIDE_ROLE_IDS } from './config/tickets.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const TIKTOK_URL = 'https://www.tiktok.com/@thelastcoalition';
const COMMAND_NAME = 'welcomelogo';
const DELAYED_REGISTRATION_MS = 105_000;
const DEFAULT_LOGO_FILENAME = 'tlc-welcome-logo.png';

function hasOverrideRole(member) {
  return member?.roles?.cache?.some(role =>
    TICKET_CLOSE_OVERRIDE_ROLE_IDS.includes(role.id)
  ) ?? false;
}

async function ensureWelcomeAssetTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS welcome_assets (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      image_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function saveWelcomeLogo(attachment) {
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
  if (buffer.length === 0) {
    throw new Error('The supplied image is empty.');
  }

  const contentType = response.headers.get('content-type') ?? attachment.contentType ?? 'image/png';
  const extension = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('gif')
        ? 'gif'
        : 'jpg';
  const filename = `tlc-welcome-logo.${extension}`;

  await ensureWelcomeAssetTable();
  await pool.query(`
    INSERT INTO welcome_assets (id, filename, content_type, image_data, updated_at)
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id) DO UPDATE SET
      filename = EXCLUDED.filename,
      content_type = EXCLUDED.content_type,
      image_data = EXCLUDED.image_data,
      updated_at = NOW();
  `, [filename, contentType, buffer]);

  console.log(`[WELCOME] Logo saved to PostgreSQL (${filename}, ${buffer.length} bytes).`);
}

async function loadWelcomeLogo() {
  try {
    await ensureWelcomeAssetTable();
    const result = await pool.query(`
      SELECT filename, content_type, image_data
      FROM welcome_assets
      WHERE id = 1;
    `);

    const row = result.rows[0];
    if (!row?.image_data) return null;

    return {
      filename: row.filename || DEFAULT_LOGO_FILENAME,
      contentType: row.content_type || 'image/png',
      buffer: Buffer.from(row.image_data)
    };
  } catch (error) {
    console.error('❌ [WELCOME] Failed to load welcome logo:', error);
    return null;
  }
}

async function registerWelcomeLogoCommand(source = 'initial') {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.FAILSAFE_GUILD_ID;

  if (!token || !guildId) {
    throw new Error('Missing bot token or guild ID for /welcomelogo registration.');
  }

  const applicationId = Buffer
    .from(token.split('.')[0], 'base64')
    .toString('utf8');

  if (!/^\d+$/.test(applicationId)) {
    throw new Error('Could not derive Discord application ID from bot token.');
  }

  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Set the TLC welcome message logo')
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('The logo image to use as the welcome thumbnail')
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

  console.log(`✅ [WELCOME] /welcomelogo command registered (${source}).`);
}

client.once('clientReady', () => {
  void ensureWelcomeAssetTable().catch(error => {
    console.error('❌ [WELCOME] Could not initialize welcome assets table:', error);
  });

  void registerWelcomeLogoCommand('initial').catch(error => {
    console.error('❌ [WELCOME] /welcomelogo initial registration failed:', error);
  });

  setTimeout(() => {
    void registerWelcomeLogoCommand('post-core-registration').catch(error => {
      console.error('❌ [WELCOME] /welcomelogo delayed registration failed:', error);
    });
  }, DELAYED_REGISTRATION_MS);
});

client.on('interactionCreate', interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) {
    return;
  }

  void (async () => {
    if (!hasOverrideRole(interaction.member)) {
      await interaction.reply({
        content: '❌ You are not authorized to change the TLC welcome logo.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = interaction.options.getAttachment('image', true);
    await saveWelcomeLogo(attachment);
    await interaction.editReply('✅ TLC welcome logo updated successfully.');
  })().catch(async error => {
    console.error('❌ [WELCOME] Failed to update welcome logo:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ The welcome logo could not be updated.').catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ The welcome logo could not be updated.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  });
});

client.on('guildMemberAdd', async member => {
  if (member.user?.bot) return;
  if (!WELCOME_CHANNEL_ID) {
    console.warn('⚠️ [WELCOME] Disabled: WELCOME_CHANNEL_ID is not configured.');
    return;
  }

  try {
    const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel?.isTextBased()) {
      console.error('❌ [WELCOME] Welcome channel not found or is not text based.');
      return;
    }

    const logo = await loadWelcomeLogo();
    const embed = new EmbedBuilder()
      .setTitle('WELCOME TO THE LAST COALITION')
      .setDescription([
        `Welcome ${member}!`,
        '',
        'Our game mode, **DEADLOCK**, is built around realistic and dynamic frontline warfare.',
        '',
        '__**How DEADLOCK works**__',
        '',
        '• **No traditional capture-point system**',
        '• **Game Masters place objectives** across the battlefield',
        '• **Both teams attack and defend** as the frontline shifts',
        '• **Each round develops differently** depending on where the GM drives the battle',
        '• Expect **trenches, towns, FOBs, buildings and open-ground fighting**',
        '• **Combined arms matter** — infantry, armour, helicopters and support elements all have a role',
        '',
        'The goal is not simply to capture points. It is to **take ground, hold the line and break through the enemy**.',
        '',
        '__**DEADLOCK**__',
        '**Controlled by the GM. Driven by the players. Built to TLC standards.**',
        '',
        `__**Follow TLC on TikTok**__\n${TIKTOK_URL}`
      ].join('\n'))
      .setFooter({ text: 'TLC Command • Welcome System' });

    const payload = {
      content: `${member}`,
      embeds: [embed],
      allowedMentions: { users: [member.id] }
    };

    if (logo) {
      embed.setThumbnail(`attachment://${logo.filename}`);
      payload.files = [
        new AttachmentBuilder(logo.buffer, { name: logo.filename })
      ];
    }

    await channel.send(payload);
    console.log(`✅ [WELCOME] Welcomed ${member.user.tag} (${member.id}).`);
  } catch (error) {
    console.error('❌ [WELCOME] Failed to send welcome message:', error);
  }
});
