import https from 'https';
import { IpoItem } from '../types';

export interface TelegramConfig {
  botToken: string;
  chatIds: string[]; // ③ 다중 Chat ID 지원 (배열)
}

/**
 * 다중 Chat ID를 쉼표로 분리하여 배열로 변환
 */
export function parseChatIds(chatIdStr: string): string[] {
  return chatIdStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 텔레그램 단일 채팅방에 메시지 전송
 */
async function sendToSingleChat(botToken: string, chatId: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
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
            console.log(`[Telegram] Sent to chatId ${chatId} successfully!`);
            resolve(true);
          } else {
            console.error(`[Telegram] Failed to chatId ${chatId} (HTTP ${res.statusCode}):`, body);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[Telegram] Request error for chatId ${chatId}:`, err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
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
 * ③ 다중 Chat ID 전송: 모든 채팅방에 순서대로 발송
 */
export async function sendTelegramMessage(config: TelegramConfig, text: string): Promise<boolean> {
  if (!config.botToken || !config.chatIds || config.chatIds.length === 0) {
    console.warn('[Telegram] Missing botToken or chatIds. Skipping notification.');
    return false;
  }

  const results: boolean[] = [];
  for (const chatId of config.chatIds) {
    const result = await sendToSingleChat(config.botToken, chatId, text);
    results.push(result);
  }

  return results.some(r => r); // 하나라도 성공하면 true
}

/**
 * 청약 마감일 알림 템플릿 포맷팅 (① 알림 시간 분 표시 포함)
 */
export function formatSubsDeadlineMessage(ipo: IpoItem, minutesBefore = 10): string {
  const price = ipo.fixedPrice !== '-' ? `${ipo.fixedPrice}원` : `${ipo.hopePrice}원`;
  const underwriters = ipo.underwriters.join(', ') || '미정';

  return `
🚨 <b>[공모주 청약 마감 임박]</b> 🚨

🏢 <b>종목명:</b> ${ipo.name} (${ipo.market || '코스닥'})
📅 <b>청약일정:</b> ${ipo.subsSchedule}
⏰ <b>마감시간:</b> 오늘 16:00 마감 (${minutesBefore}분 전 알림)
💰 <b>공모가:</b> ${price}
🏦 <b>주관사:</b> ${underwriters}
${ipo.competitionRate && ipo.competitionRate !== '-' ? `📊 <b>경쟁률:</b> ${ipo.competitionRate}\n` : ''}
🔗 <a href="${ipo.detailUrl}">38커뮤니케이션 상세정보 보기</a>
`.trim();
}

/**
 * 상장일 알림 템플릿 포맷팅 (① 알림 시간 분 표시 포함)
 */
export function formatListingMessage(ipo: IpoItem, minutesBefore = 10): string {
  const price = ipo.fixedPrice !== '-' ? `${ipo.fixedPrice}원` : `${ipo.hopePrice}원`;
  const underwriters = ipo.underwriters.join(', ') || '미정';

  return `
🎉 <b>[오늘 신규 상장 안내]</b> 🎉

🏢 <b>종목명:</b> ${ipo.name} (${ipo.market || '코스닥'})
🚀 <b>상장일:</b> 오늘 (09:00 장 시작 / ${minutesBefore}분 전 알림)
💰 <b>공모가:</b> ${price}
🏦 <b>주관사:</b> ${underwriters}

🔗 <a href="${ipo.detailUrl}">38커뮤니케이션 상세정보 보기</a>
`.trim();
}
