const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

// Runs the Telegram bot using long polling (no webhook/public URL needed
// for the bot itself - separate from the Mini App, which IS served over
// HTTPS via your Vercel URL). Started once from server.js.
function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const miniAppUrl = process.env.MINI_APP_URL; // e.g. https://mmy-1c4m.vercel.app

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
        `Watch the multiplier climb and cash out before it crashes. ` +
        `Tap the button below to open the game.`,
      {
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
      }
    );
  });

  bot.on('polling_error', (err) => {
    logger.error('[bot] Polling error', { error: err.message });
  });

  logger.info('[bot] Telegram bot started (long polling)');
  return bot;
}

module.exports = { startBot };
