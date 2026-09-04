import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import './serverModeOverlay.js';
import './bot.js';

const serverModeCommand = new SlashCommandBuilder()
  .setName('servermode')
  .setDescription('Control the TLC public server status mode')
  .addSubcommand(subcommand =>
    subcommand
      .setName('maintenance')
      .setDescription('Set the server status to Maintenance')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('testing')
      .setDescription('Set the server status to Testing')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('final-checks')
      .setDescription('Set the server status to Final Checks')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('ready')
      .setDescription('Set the server status to Ready')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('live')
      .setDescription('Return the status panel to live ArmaHQ monitoring')
  );

async function ensureServerModeCommand() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.FAILSAFE_GUILD_ID;

  if (!token || !guildId) {
    console.error('❌ [SERVERMODE] Cannot register command: missing bot token or guild ID.');
    return;
  }

  try {
    // The first segment of a Discord bot token encodes the bot/application ID.
    const applicationId = Buffer
      .from(token.split('.')[0], 'base64')
      .toString('utf8');

    if (!/^\d+$/.test(applicationId)) {
      throw new Error('Could not derive Discord application ID from bot token.');
    }

    const rest = new REST({ version: '10' }).setToken(token);
    const route = Routes.applicationGuildCommands(applicationId, guildId);
    const commands = await rest.get(route);
    const existing = Array.isArray(commands)
      ? commands.find(command => command.name === 'servermode')
      : null;

    if (existing) {
      await rest.patch(
        Routes.applicationGuildCommand(applicationId, guildId, existing.id),
        { body: serverModeCommand.toJSON() }
      );
    } else {
      await rest.post(route, { body: serverModeCommand.toJSON() });
    }

    console.log('✅ [SERVERMODE] /servermode command registered via Discord REST.');
  } catch (error) {
    console.error('❌ [SERVERMODE] REST command registration failed:', error);
  }
}

// The main bot replaces its guild command set during clientReady.
// Register /servermode just after that startup pass has completed.
setTimeout(() => {
  ensureServerModeCommand().catch(error => {
    console.error('❌ [SERVERMODE] Delayed registration failed:', error);
  });
}, 4000);
