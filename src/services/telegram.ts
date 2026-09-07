import https from 'https';
import { IpoItem } from '../types';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * 텔레그램 메시지 전송 함수
 */
export async function sendTelegramMessage(config: TelegramConfig, text: string): Promise<boolean> {
  if (!config.botToken || !config.chatId) {
    console.warn('[Telegram] Missing botToken or chatId. Skipping notification.');
    return false;
  }

  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${config.botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[Telegram] Message sent successfully!');
            resolve(true);
          } else {
            console.error(`[Telegram] Send failed (HTTP ${res.statusCode}):`, body);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Telegram] Request error:', err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('[Telegram] Request timeout');
        resolve(false);
      });

      req.write(payload);
      req.end();
    } catch (e) {
      console.error('[Telegram] Unexpected error:', e);
      resolve(false);
    }
  });
}

/**
 * 청약 마감일 알림 템플릿 포맷팅
 */
export function formatSubsDeadlineMessage(ipo: IpoItem): string {
  const price = ipo.fixedPrice !== '-' ? `${ipo.fixedPrice}원` : `${ipo.hopePrice}원`;
  const underwriters = ipo.underwriters.join(', ') || '미정';
  
  return `
🚨 <b>[공모주 청약 마감 임박]</b> 🚨

🏢 <b>종목명:</b> ${ipo.name} (${ipo.market || '코스닥'})
📅 <b>청약일정:</b> ${ipo.subsSchedule}
⏰ <b>마감시간:</b> 오늘 16:00 마감
💰 <b>공모가:</b> ${price}
🏦 <b>주관사:</b> ${underwriters}
${ipo.competitionRate && ipo.competitionRate !== '-' ? `📊 <b>경쟁률:</b> ${ipo.competitionRate}\n` : ''}
🔗 <a href="${ipo.detailUrl}">38커뮤니케이션 상세정보 보기</a>
`.trim();
}

/**
 * 상장일 알림 템플릿 포맷팅
 */
export function formatListingMessage(ipo: IpoItem): string {
  const price = ipo.fixedPrice !== '-' ? `${ipo.fixedPrice}원` : `${ipo.hopePrice}원`;
  const underwriters = ipo.underwriters.join(', ') || '미정';

  return `
🎉 <b>[오늘 신규 상장 안내]</b> 🎉

🏢 <b>종목명:</b> ${ipo.name} (${ipo.market || '코스닥'})
🚀 <b>상장일:</b> 오늘 (09:00 장 시작)
💰 <b>공모가:</b> ${price}
🏦 <b>주관사:</b> ${underwriters}

🔗 <a href="${ipo.detailUrl}">38커뮤니케이션 상세정보 보기</a>
`.trim();
}
