const TelegramBot = require('node-telegram-bot-api');
const { query } = require('./database');
const logger = require('./logger');

// Runs the Telegram bot using long polling. Started once from server.js.
//
// Flow: /start -> bot asks the user to share their phone number via
// Telegram's native contact button -> once shared, we save it against
// their user record (creating one if this is their first time) and show
// the "Play Aviator" button that opens the Mini App.
function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const miniAppUrl = process.env.MINI_APP_URL;

  if (!token) {
    logger.warn('[bot] TELEGRAM_BOT_TOKEN not set - Telegram bot will not start');
    return null;
  }
  if (!miniAppUrl) {
    logger.warn('[bot] MINI_APP_URL not set - the Mini App button will not work');
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'there';

    bot.sendMessage(
      chatId,
      `Welcome to Aviator, ${firstName}! ✈️\n\n` +
        `To get started, please share your phone number. We use this for withdrawals.`,
      {
        reply_markup: {
          keyboard: [
            [
              {
                text: '📱 Share my phone number',
                request_contact: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  });

  // Fires when the user taps the "Share my phone number" button above.
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const phone = msg.contact.phone_number;

    // Only accept a contact the user shared about themselves, not someone
    // else's contact card they might have forwarded.
    if (msg.contact.user_id !== telegramId) {
      bot.sendMessage(chatId, 'Please share your own phone number using the button provided.');
      return;
    }

    try {
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      const { rows } = await query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);

      if (rows.length > 0) {
        await query('UPDATE users SET telegram_phone = $1 WHERE telegram_id = $2', [normalizedPhone, telegramId]);
      } else {
        // Store it for now; the full account record gets created/confirmed
        // when they open the Mini App and we verify their initData there.
        // We stash the phone number keyed by telegram_id so auth.js can
        // pick it up on first login.
        await query(
          `INSERT INTO pending_telegram_phones (telegram_id, phone) VALUES ($1, $2)
           ON CONFLICT (telegram_id) DO UPDATE SET phone = $2`,
          [telegramId, normalizedPhone]
        );
      }

      bot.sendMessage(chatId, 'Thanks! Your phone number has been saved. ✅', {
        reply_markup: { remove_keyboard: true },
      });

      bot.sendMessage(chatId, 'Tap below to start playing:', {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 Play Aviator',
                web_app: { url: miniAppUrl },
              },
            ],
          ],
        },
      });
    } catch (err) {
      logger.error('[bot] Failed to save phone number', { error: err.message, telegramId });
      bot.sendMessage(chatId, 'Something went wrong saving your number. Please try /start again.');
    }
  });

  bot.on('polling_error', (err) => {
    logger.error('[bot] Polling error', { error: err.message });
  });

  logger.info('[bot] Telegram bot started (long polling)');
  return bot;
}

module.exports = { startBot };
