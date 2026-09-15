import { fetchAllIpoSchedules } from '../src/crawler/38crawler';
import { sendTelegramMessage, formatSubsDeadlineMessage, formatListingMessage, parseChatIds } from '../src/services/telegram';
import { dbService } from '../src/services/db';

export default async function handler(req: any, res: any) {
  try {
    const { type, token, chat_id } = req.query;
    console.log(`[Vercel Cron] Triggered. Type: ${type || 'ALL'}`);

    // 항상 최신 데이터로 크롤링
    const ipos = await fetchAllIpoSchedules(true);
    const today = new Date().toISOString().slice(0, 10);

    // 텔레그램 설정 (환경변수 우선)
    const prefs = dbService.getPreferences();
    const botToken = (token as string) || process.env.TELEGRAM_BOT_TOKEN || prefs.telegramBotToken || '';
    const chatIdRaw = (chat_id as string) || process.env.TELEGRAM_CHAT_ID || prefs.telegramChatId || '';

    // ③ 다중 Chat ID 파싱 (쉼표 구분)
    const chatIds = parseChatIds(chatIdRaw);
    const telegramConfig = { botToken, chatIds };

    // ① 알림 N분 전 설정 (query > 환경변수 > 기본 20분)
    const minutesParam = req.query.minutes as string;
    const minutesBefore = parseInt(minutesParam || process.env.ALERT_MINUTES_BEFORE || '20', 10);

    // 주관사 필터링
    const preferredUnderwriters = process.env.PREFERRED_UNDERWRITERS
      ? process.env.PREFERRED_UNDERWRITERS.split(',').map(s => s.trim())
      : prefs.preferredUnderwriters || [];

    const isMatched = (underwriters: string[]) => {
      if (!preferredUnderwriters || preferredUnderwriters.length === 0) return true;
      return underwriters.some(u => preferredUnderwriters.includes(u));
    };

    const sentAlerts: string[] = [];

    // 청약 마감일 알림 체크
    if (type === 'subs' || !type) {
      const deadlineIpos = ipos.filter(i => i.subsEndDate === today);
      for (const ipo of deadlineIpos) {
        if (isMatched(ipo.underwriters)) {
          const msg = formatSubsDeadlineMessage(ipo, minutesBefore);
          if (botToken && chatIds.length > 0) {
            await sendTelegramMessage(telegramConfig, msg);
          }
          sentAlerts.push(`[청약마감] ${ipo.name}`);
        }
      }
    }

    // 상장일 알림 체크
    if (type === 'listing' || !type) {
      const listingIpos = ipos.filter(i => i.listingDate === today);
      for (const ipo of listingIpos) {
        if (isMatched(ipo.underwriters)) {
          const msg = formatListingMessage(ipo, minutesBefore);
          if (botToken && chatIds.length > 0) {
            await sendTelegramMessage(telegramConfig, msg);
          }
          sentAlerts.push(`[상장일] ${ipo.name}`);
        }
      }
    }

    res.status(200).json({
      success: true,
      date: today,
      type: type || 'ALL',
      totalIposChecked: ipos.length,
      sentAlertsCount: sentAlerts.length,
      sentAlerts,
      chatIdsCount: chatIds.length,
      telegramConfigured: Boolean(botToken && chatIds.length > 0),
    });
  } catch (error: any) {
    console.error('[Vercel Cron Error]:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error',
    });
  }
}
