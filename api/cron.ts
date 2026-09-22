import { fetchAllIpoSchedules } from '../src/crawler/38crawler';
import { sendTelegramMessage, formatSubsDeadlineMessage, formatListingMessage, parseChatIds } from '../src/services/telegram';
import { dbService } from '../src/services/db';

export default async function handler(req: any, res: any) {
  try {
    const { type, token, chat_id } = req.query;
    console.log(`[Vercel Cron] Triggered. Type: ${type || 'ALL'}`);

    // 항상 최신 데이터로 크롤링
    const ipos = await fetchAllIpoSchedules(true);
    // 한국 시간(KST) 기준으로 오늘 날짜 계산
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

    // 스팩주 알림 제외 여부 (환경변수 EXCLUDE_SPAC 또는 prefs.excludeSpac, 기본 true)
    const excludeSpac = process.env.EXCLUDE_SPAC !== undefined 
      ? process.env.EXCLUDE_SPAC === 'true' 
      : prefs.excludeSpac !== false;

    const isSpac = (ipo: any) => {
      const name = (ipo.name || '').replace(/\s+/g, '');
      const market = (ipo.market || '').replace(/\s+/g, '');
      const isSpacNamePattern = /(호스팩|제\d+호스팩|스팩\d+호|기업인수목적|spac)/i.test(name) ||
                                /(스팩|spac|기업인수목적)/i.test(market);
      const fixedPrice = (ipo.fixedPrice || '').replace(/,/g, '').trim();
      const hopePrice = (ipo.hopePrice || '').replace(/,/g, '').trim();
      const is2000Won = fixedPrice === '2000' || hopePrice === '2000' || hopePrice.includes('2000');
      if (isSpacNamePattern) {
        if (/스팩$|spac$|호스팩|스팩\d+호|기업인수목적/i.test(name) || is2000Won) {
          return true;
        }
      }
      return false;
    };

    const sentAlerts: string[] = [];

    // 청약 마감일 알림 체크
    if (type === 'subs' || !type) {
      const deadlineIpos = ipos.filter(i => i.subsEndDate === today);
      for (const ipo of deadlineIpos) {
        if (excludeSpac && isSpac(ipo)) {
          console.log(`[Vercel Cron] Skipped SPAC item: ${ipo.name}`);
          continue;
        }
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
        if (excludeSpac && isSpac(ipo)) {
          console.log(`[Vercel Cron] Skipped SPAC item: ${ipo.name}`);
          continue;
        }
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
