/**
 * Telegram notifications to Joe. No-ops (with a warning) until TELEGRAM_BOT_TOKEN
 * + TELEGRAM_CHAT_ID are set, so nothing breaks without it.
 *
 * Setup: message @BotFather → /newbot → copy the token (TELEGRAM_BOT_TOKEN).
 * Then DM your new bot once, and grab your chat id from
 * https://api.telegram.org/bot<token>/getUpdates (TELEGRAM_CHAT_ID).
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

export function isTelegramConfigured(): boolean {
  return Boolean(token && chatId);
}

export async function notifyTelegram(text: string) {
  if (!token || !chatId) {
    console.warn("[telegram] not configured — skipping:", text.slice(0, 80));
    return { skipped: true as const };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      console.error("[telegram] send failed:", await r.text());
      return { error: true as const };
    }
    return { ok: true as const };
  } catch (err) {
    console.error("[telegram] error:", err);
    return { error: true as const };
  }
}
