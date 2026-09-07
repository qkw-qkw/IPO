import cron from 'node-cron';
import { fetchAllIpoSchedules } from '../crawler/38crawler';
import { dbService } from '../services/db';
import { notifierService } from '../services/notifier';
import { SchedulerStatus } from '../types';

export class IpoScheduler {
  private isCrawling = false;
  private readonly crawlerCron = '30 18 * * *';   // 매일 18:30 (업무 종료 후 1일 1회 정기 갱신)
  private readonly subsAlertCron = '50 15 * * *'; // 매일 15:50 (청약 마감일 16:00 전)
  private readonly listingAlertCron = '50 8 * * *'; // 매일 08:50 (상장일 09:00 전)

  public init() {
    console.log('[Scheduler] Initializing Korean IPO Schedulers...');

    // 1. 매일 18:30 일일 1회 정기 크롤링 동기화
    cron.schedule(this.crawlerCron, async () => {
      console.log(`[Scheduler] Running daily scheduled crawl at 18:30...`);
      await this.runCrawl('DAILY_SCHEDULED_18:30');
    });

    // 2. 매일 15:50 청약 마감 임박 알림 (16:00 마감 전)
    cron.schedule(this.subsAlertCron, async () => {
      console.log(`[Scheduler] Checking subscription deadline alerts at 15:50...`);
      await this.checkAndSendSubsDeadlineAlerts();
    });

    // 3. 매일 08:50 상장일 알림 (09:00 장 시작 전)
    cron.schedule(this.listingAlertCron, async () => {
      console.log(`[Scheduler] Checking listing date alerts at 08:50...`);
      await this.checkAndSendListingAlerts();
    });

    console.log(`[Scheduler] Schedulers registered:`);
    console.log(`  - 정기 크롤링: 매일 18:30 (${this.crawlerCron})`);
    console.log(`  - 청약 마감 알림: 매일 15:50 (${this.subsAlertCron})`);
    console.log(`  - 상장일 알림: 매일 08:50 (${this.listingAlertCron})`);
  }

  /**
   * 크롤링 실행 함수 (스케줄러 또는 수동 새로고침 호출)
   */
  public async runCrawl(reason = 'MANUAL'): Promise<{ success: boolean; count: number; added: number; updated: number }> {
    if (this.isCrawling) {
      console.log(`[Scheduler] Crawling already in progress. Skipping ${reason}.`);
      return { success: false, count: 0, added: 0, updated: 0 };
    }

    this.isCrawling = true;
    try {
      console.log(`[Scheduler] Starting crawl (Reason: ${reason})...`);
      const items = await fetchAllIpoSchedules(true);
      const { added, updated } = dbService.saveIpos(items);
      console.log(`[Scheduler] Crawl complete. Total: ${items.length}, Added: ${added}, Updated: ${updated}`);
      return { success: true, count: items.length, added, updated };
    } catch (err) {
      console.error('[Scheduler] Crawl failed:', err);
      return { success: false, count: 0, added: 0, updated: 0 };
    } finally {
      this.isCrawling = false;
    }
  }

  /**
   * 청약 마감일 당일 알림 체크 & 전송
   */
  public async checkAndSendSubsDeadlineAlerts(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const ipos = dbService.getAllIpos();
    const prefs = dbService.getPreferences();

    let alertCount = 0;
    for (const ipo of ipos) {
      // 마감일이 오늘인지 확인
      if (ipo.subsEndDate === today) {
        const sent = await notifierService.sendSubsDeadlineAlert(ipo, prefs);
        if (sent) alertCount++;
      }
    }
    console.log(`[Scheduler] Sent ${alertCount} subscription deadline alerts for date ${today}.`);
    return alertCount;
  }

  /**
   * 상장일 당일 알림 체크 & 전송
   */
  public async checkAndSendListingAlerts(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const ipos = dbService.getAllIpos();
    const prefs = dbService.getPreferences();

    let alertCount = 0;
    for (const ipo of ipos) {
      if (ipo.listingDate === today) {
        const sent = await notifierService.sendListingAlert(ipo, prefs);
        if (sent) alertCount++;
      }
    }
    console.log(`[Scheduler] Sent ${alertCount} listing date alerts for date ${today}.`);
    return alertCount;
  }

  /**
   * 스케줄러 상태 및 카운트 통계 반환
   */
  public getStatus(): SchedulerStatus {
    const today = new Date().toISOString().slice(0, 10);
    const ipos = dbService.getAllIpos();

    const activeIpos = ipos.filter(i => i.status === 'SUBS_ACTIVE' || i.status === 'SUBS_DEADLINE_TODAY');
    const todaySubsDeadline = ipos.filter(i => i.subsEndDate === today);
    const todayListing = ipos.filter(i => i.listingDate === today);

    return {
      lastCrawledAt: dbService.getLastCrawledAt(),
      nextDailyCrawlAt: '매일 18:30 (KST)',
      totalIposCount: ipos.length,
      activeIposCount: activeIpos.length,
      todaySubsDeadlineCount: todaySubsDeadline.length,
      todayListingCount: todayListing.length,
      crawlerCron: this.crawlerCron,
      subsAlertCron: this.subsAlertCron,
      listingAlertCron: this.listingAlertCron,
      isCrawling: this.isCrawling,
    };
  }
}

export const ipoScheduler = new IpoScheduler();
