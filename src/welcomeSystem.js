import { EmbedBuilder } from 'discord.js';
import { client } from './bot.js';

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const WELCOME_LOGO_URL = process.env.WELCOME_LOGO_URL;
const TIKTOK_URL = 'https://www.tiktok.com/@thelastcoalition';

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

    if (WELCOME_LOGO_URL) {
      embed.setThumbnail(WELCOME_LOGO_URL);
    }

    await channel.send({
      content: `${member}`,
      embeds: [embed],
      allowedMentions: { users: [member.id] }
    });

    console.log(`✅ [WELCOME] Welcomed ${member.user.tag} (${member.id}).`);
  } catch (error) {
    console.error('❌ [WELCOME] Failed to send welcome message:', error);
  }
});
