import http from 'http';
import https from 'https';
import { IpoItem, NotificationLog, UserPreferences } from '../types';
import { dbService } from './db';

export class NotifierService {
  /**
   * 주관사 필터 매칭 여부 판별
   * preferredUnderwriters가 비어있으면 전체 관심으로 간주하여 true 반환
   */
  public isUnderwriterMatched(ipoUnderwriters: string[], preferredUnderwriters: string[]): boolean {
    if (!preferredUnderwriters || preferredUnderwriters.length === 0) {
      return true; // 전체 관심
    }
    return ipoUnderwriters.some(u => preferredUnderwriters.includes(u));
  }

  public isSpac(ipo: IpoItem): boolean {
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
  }

  /**
   * 청약 마감 임박 알림 전송 (16:00 전)
   */
  public async sendSubsDeadlineAlert(ipo: IpoItem, prefs: UserPreferences): Promise<NotificationLog | null> {
    if (!prefs.notifySubsDeadline) return null;
    if (prefs.excludeSpac !== false && this.isSpac(ipo)) {
      console.log(`[Notifier] Skipped SPAC item: ${ipo.name}`);
      return null;
    }
    if (!this.isUnderwriterMatched(ipo.underwriters, prefs.preferredUnderwriters)) {
      console.log(`[Notifier] Skipped ${ipo.name} (Underwriters [${ipo.underwriters.join(', ')}] not in user preferences)`);
      return null;
    }

    const title = `🚨 [청약 마감 임박] ${ipo.name}`;
    const message = `오늘 16:00 공모주 청약이 마감됩니다! (주관사: ${ipo.underwriters.join(', ') || '미정'} / 공모가: ${ipo.fixedPrice || ipo.hopePrice}원)`;

    console.log(`\n========================================`);
    console.log(`[알림 발송] ${title}`);
    console.log(`내용: ${message}`);
    console.log(`상세정보: ${ipo.detailUrl}`);
    console.log(`========================================\n`);

    // 웹훅 전송 (설정된 경우)
    let webhookSuccess = true;
    if (prefs.webhookUrl) {
      webhookSuccess = await this.sendWebhook(prefs.webhookUrl, {
        title,
        message,
        detailUrl: ipo.detailUrl,
        underwriters: ipo.underwriters.join(', '),
      });
    }

    return dbService.addNotificationLog({
      type: 'SUBS_DEADLINE',
      ipoId: ipo.id,
      ipoName: ipo.name,
      title,
      message,
      underwriters: ipo.underwriters,
      detailUrl: ipo.detailUrl,
      channel: prefs.webhookUrl ? 'WEBHOOK' : 'BROWSER_PUSH',
      success: webhookSuccess,
    });
  }

  /**
   * 상장일 알림 전송 (09:00 전)
   */
  public async sendListingAlert(ipo: IpoItem, prefs: UserPreferences): Promise<NotificationLog | null> {
    if (!prefs.notifyListing) return null;
    if (prefs.excludeSpac !== false && this.isSpac(ipo)) {
      console.log(`[Notifier] Skipped SPAC listing alert: ${ipo.name}`);
      return null;
    }
    if (!this.isUnderwriterMatched(ipo.underwriters, prefs.preferredUnderwriters)) {
      console.log(`[Notifier] Skipped ${ipo.name} listing alert (Underwriter not in preferences)`);
      return null;
    }

    const title = `🎉 [오늘 상장일] ${ipo.name}`;
    const message = `오늘 09:00 코스닥/코스피에 신규 상장됩니다! (공모가: ${ipo.fixedPrice || ipo.hopePrice}원 / 주관사: ${ipo.underwriters.join(', ') || '미정'})`;

    console.log(`\n========================================`);
    console.log(`[알림 발송] ${title}`);
    console.log(`내용: ${message}`);
    console.log(`상세정보: ${ipo.detailUrl}`);
    console.log(`========================================\n`);

    let webhookSuccess = true;
    if (prefs.webhookUrl) {
      webhookSuccess = await this.sendWebhook(prefs.webhookUrl, {
        title,
        message,
        detailUrl: ipo.detailUrl,
        underwriters: ipo.underwriters.join(', '),
      });
    }

    return dbService.addNotificationLog({
      type: 'LISTING',
      ipoId: ipo.id,
      ipoName: ipo.name,
      title,
      message,
      underwriters: ipo.underwriters,
      detailUrl: ipo.detailUrl,
      channel: prefs.webhookUrl ? 'WEBHOOK' : 'BROWSER_PUSH',
      success: webhookSuccess,
    });
  }

  /**
   * Discord / Slack / 범용 Webhook 전송
   */
  private async sendWebhook(webhookUrl: string, data: { title: string; message: string; detailUrl: string; underwriters: string }): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const url = new URL(webhookUrl);
        const isDiscord = webhookUrl.includes('discord.com');
        const isSlack = webhookUrl.includes('slack.com');

        let payloadStr = '';
        if (isDiscord) {
          payloadStr = JSON.stringify({
            username: '공모주 알리미',
            avatar_url: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
            embeds: [
              {
                title: data.title,
                description: data.message,
                url: data.detailUrl,
                color: 0x3b82f6,
                fields: [
                  { name: '주관사', value: data.underwriters || '미정', inline: true },
                  { name: '상세링크', value: `[38커뮤니케이션 바로가기](${data.detailUrl})`, inline: true },
                ],
                footer: { text: '한국 주식 공모주 알림 시스템' },
                timestamp: new Date().toISOString(),
              },
            ],
          });
        } else if (isSlack) {
          payloadStr = JSON.stringify({
            text: `${data.title}\n${data.message}\n상세보기: ${data.detailUrl}`,
          });
        } else {
          // 범용 Webhook JSON
          payloadStr = JSON.stringify(data);
        }

        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadStr),
          },
          timeout: 5000,
        }, (res) => {
          resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
        });

        req.on('error', (e) => {
          console.error('[Notifier] Webhook send error:', e.message);
          resolve(false);
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.write(payloadStr);
        req.end();
      } catch (err) {
        console.error('[Notifier] Invalid webhook URL or dispatch error:', err);
        resolve(false);
      }
    });
  }
}

export const notifierService = new NotifierService();
