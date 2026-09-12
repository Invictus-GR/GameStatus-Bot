import { EmbedBuilder } from 'discord.js';

const STATE_KEY = 'general_support_kofi';
const INTERVAL_MS = 4 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const KOFI_URL = 'https://ko-fi.com/thelastcoalition';
const SUPPORT_EMOJI = '<:emoji_3:1533902636204687390>';

let timer = null;

function buildSupportEmbed(footerText) {
  return new EmbedBuilder()
    .setTitle(`${SUPPORT_EMOJI} SUPPORT THE LAST COALITION`)
    .setDescription([
      'The Last Coalition is more than just a server — it’s a community we’ve built together.',
      '',
      'A lot of time, care, and personal resources go into keeping TLC online, stable, and constantly improving. If you enjoy being part of the server and would like to help us continue building something special, you can support us through Ko-fi.',
      '',
      'There’s absolutely no obligation. Simply playing, being active, and being part of the community already means a lot to us.',
      '',
      'But if you’re in a position to contribute, every donation — no matter the amount — genuinely helps with server costs, development, and the future of TLC.',
      '',
      `☕ **Support The Last Coalition:**\n${KOFI_URL}`,
      '',
      'Thank you for being here, for supporting the server, and most importantly, for being part of The Last Coalition.'
    ].join('\n'))
    .setColor(0xED4245)
    .setFooter({ text: footerText });
}

async function ensureStateTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_message_state (
      state_key TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getState(pool) {
  const result = await pool.query(`
    SELECT channel_id, message_id, sent_at
    FROM scheduled_message_state
    WHERE state_key = $1;
  `, [STATE_KEY]);

  return result.rows[0] ?? null;
}

async function saveState(pool, channelId, messageId) {
  await pool.query(`
    INSERT INTO scheduled_message_state (
      state_key,
      channel_id,
      message_id,
      sent_at,
      updated_at
    )
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (state_key) DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      message_id = EXCLUDED.message_id,
      sent_at = EXCLUDED.sent_at,
      updated_at = NOW();
  `, [STATE_KEY, channelId, messageId]);
}

async function replaceSupportMessage({ client, pool, channelId, footerText }) {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased()) {
    throw new Error('General channel was not found or is not text-based.');
  }

  const previousState = await getState(pool);

  if (previousState?.message_id && previousState.channel_id === channel.id) {
    const previousMessage = await channel.messages
      .fetch(previousState.message_id)
      .catch(() => null);

    if (previousMessage?.author?.id === client.user.id) {
      await previousMessage.delete().catch(error => {
        console.warn('[SUPPORT MESSAGE] Could not delete previous message:', error?.message ?? error);
      });
    }
  }

  const message = await channel.send({
    embeds: [buildSupportEmbed(footerText)],
    allowedMentions: { parse: [] }
  });

  await saveState(pool, channel.id, message.id);
  console.log('[SUPPORT MESSAGE] General Ko-fi embed refreshed.');
}

export async function initializeGeneralSupportMessage({
  client,
  pool,
  channelId,
  footerText
}) {
  if (!client || !pool || !channelId || !footerText) {
    throw new TypeError(
      'initializeGeneralSupportMessage requires client, pool, channelId and footerText.'
    );
  }

  await ensureStateTable(pool);

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const state = await getState(pool);
  const sentAtMs = state?.sent_at ? new Date(state.sent_at).getTime() : NaN;
  const elapsedMs = Number.isFinite(sentAtMs) ? Date.now() - sentAtMs : INTERVAL_MS;
  const firstDelayMs = Math.max(0, INTERVAL_MS - elapsedMs);

  const scheduleNext = delayMs => {
    timer = setTimeout(async () => {
      try {
        await replaceSupportMessage({ client, pool, channelId, footerText });
        scheduleNext(INTERVAL_MS);
      } catch (error) {
        console.error('[SUPPORT MESSAGE] Refresh failed:', error);
        scheduleNext(RETRY_MS);
      }
    }, delayMs);
  };

  if (firstDelayMs === 0) {
    try {
      await replaceSupportMessage({ client, pool, channelId, footerText });
      scheduleNext(INTERVAL_MS);
    } catch (error) {
      console.error('[SUPPORT MESSAGE] Initial send failed:', error);
      scheduleNext(RETRY_MS);
    }
  } else {
    scheduleNext(firstDelayMs);
    console.log(
      `[SUPPORT MESSAGE] Next General Ko-fi refresh in ${Math.ceil(firstDelayMs / 60000)} minute(s).`
    );
  }
}

export const __generalSupportInternals = {
  buildSupportEmbed,
  INTERVAL_MS
};
