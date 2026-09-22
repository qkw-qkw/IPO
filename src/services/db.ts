import fs from 'fs';
import path from 'path';
import { IpoItem, UserPreferences, NotificationLog } from '../types';

// Vercel 서버리스 환경(/tmp) 및 로컬 환경 호환
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, '../../data');
const IPOS_FILE = path.join(DATA_DIR, 'ipos.json');
const PREFS_FILE = path.join(DATA_DIR, 'preferences.json');
const LOGS_FILE = path.join(DATA_DIR, 'notification_logs.json');

// 디렉터리 초기화 (에러 무시)
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem 환경에서는 메모리 저장소로 동작
}

export class JsonDbService {
  private ipos: Map<string, IpoItem> = new Map();
  private preferences: UserPreferences;
  private notificationLogs: NotificationLog[] = [];
  private lastCrawledAt: string | null = null;

  constructor() {
    this.preferences = {
      userId: 'default_user',
      preferredUnderwriters: [], // 빈 배열: 전체 주관사 관심
      notifySubsDeadline: true,
      notifyListing: true,
      excludeSpac: true, // 기본값: 스팩주 알림 제외
      updatedAt: new Date().toISOString(),
    };
    try {
      this.loadFromDisk();
    } catch (e) {
      // 메모리 기본값 사용
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(IPOS_FILE)) {
        const raw = fs.readFileSync(IPOS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.items)) {
          parsed.items.forEach((item: IpoItem) => this.ipos.set(item.id, item));
          this.lastCrawledAt = parsed.lastCrawledAt || null;
        }
      }

      if (fs.existsSync(PREFS_FILE)) {
        const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
        this.preferences = { ...this.preferences, ...JSON.parse(raw) };
      }

      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        this.notificationLogs = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[DB] Failed to load data from disk:', err);
    }
  }

  private saveIposToDisk(): void {
    try {
      const data = {
        lastCrawledAt: this.lastCrawledAt,
        items: Array.from(this.ipos.values()),
      };
      fs.writeFileSync(IPOS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to save ipos to disk:', err);
    }
  }

  private savePrefsToDisk(): void {
    try {
      fs.writeFileSync(PREFS_FILE, JSON.stringify(this.preferences, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to save preferences to disk:', err);
    }
  }

  private saveLogsToDisk(): void {
    try {
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.notificationLogs.slice(0, 200), null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to save notification logs to disk:', err);
    }
  }

  // IPO 데이터 저장 및 갱신 (기존 정보와 merge)
  public saveIpos(newItems: IpoItem[]): { added: number; updated: number } {
    let added = 0;
    let updated = 0;

    for (const item of newItems) {
      if (this.ipos.has(item.id)) {
        const existing = this.ipos.get(item.id)!;
        this.ipos.set(item.id, {
          ...existing,
          ...item,
          // 기존에 보강된 상세 데이터 유지
          listingDate: item.listingDate || existing.listingDate,
          refundDate: item.refundDate || existing.refundDate,
          shares: item.shares || existing.shares,
          updatedAt: new Date().toISOString(),
        });
        updated++;
      } else {
        this.ipos.set(item.id, item);
        added++;
      }
    }

    this.lastCrawledAt = new Date().toISOString();
    this.saveIposToDisk();
    return { added, updated };
  }

  public getAllIpos(): IpoItem[] {
    // 한국 시간(KST) 기준으로 오늘 날짜 계산
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const items = Array.from(this.ipos.values());

    // 전체 빠른순: 청약 시작일, 마감일, 상장일 중 오늘 이후 가장 가까운 유효 일정 기준
    const getNextEventDate = (item: IpoItem) => {
      const dates: string[] = [];
      if (item.subsStartDate && item.subsStartDate >= today) dates.push(item.subsStartDate);
      if (item.subsEndDate && item.subsEndDate >= today) dates.push(item.subsEndDate);
      if (item.listingDate && item.listingDate >= today) dates.push(item.listingDate);
      return dates.length > 0 ? dates.sort()[0] : null;
    };

    // 1. 다가오는/진행중인 일정 (오늘 포함 미래): 가장 임박한 D-Day 오름차순
    const upcomingOrActive = items
      .filter(item => getNextEventDate(item) !== null)
      .sort((a, b) => {
        const dateA = getNextEventDate(a)!;
        const dateB = getNextEventDate(b)!;
        return dateA.localeCompare(dateB);
      });

    // 2. 이미 모든 일정이 지난 과거 일정: 최근 일정 기준 내림차순
    const pastClosed = items
      .filter(item => getNextEventDate(item) === null)
      .sort((a, b) => {
        const lastA = a.listingDate || a.subsEndDate || a.subsStartDate || '';
        const lastB = b.listingDate || b.subsEndDate || b.subsStartDate || '';
        return lastB.localeCompare(lastA);
      });

    return [...upcomingOrActive, ...pastClosed];
  }

  public getIpoById(id: string): IpoItem | undefined {
    return this.ipos.get(id);
  }

  public getLastCrawledAt(): string | null {
    return this.lastCrawledAt;
  }

  // 고유 주관사 목록 및 카운트 반환
  public getUnderwritersStats(): { name: string; count: number }[] {
    const stats: Record<string, number> = {};
    for (const ipo of this.ipos.values()) {
      for (const u of ipo.underwriters) {
        stats[u] = (stats[u] || 0) + 1;
      }
    }
    return Object.entries(stats)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  // 사용자 환경설정
  public getPreferences(): UserPreferences {
    return this.preferences;
  }

  public updatePreferences(newPrefs: Partial<UserPreferences>): UserPreferences {
    this.preferences = {
      ...this.preferences,
      ...newPrefs,
      updatedAt: new Date().toISOString(),
    };
    this.savePrefsToDisk();
    return this.preferences;
  }

  // 알림 로그 관리
  public addNotificationLog(log: Omit<NotificationLog, 'id' | 'sentAt'>): NotificationLog {
    const newLog: NotificationLog = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sentAt: new Date().toISOString(),
    };
    this.notificationLogs.unshift(newLog);
    if (this.notificationLogs.length > 200) {
      this.notificationLogs = this.notificationLogs.slice(0, 200);
    }
    this.saveLogsToDisk();
    return newLog;
  }

  public getNotificationLogs(): NotificationLog[] {
    return this.notificationLogs;
  }
}

export const dbService = new JsonDbService();
