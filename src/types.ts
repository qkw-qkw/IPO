export interface IpoItem {
  id: string;                      // 38커뮤니케이션 고유 번호 또는 종목 식별자
  name: string;                    // 종목명 (기업명)
  market?: string;                 // 시장 구분 (코스피 / 코스닥 / 코넥스 / 스팩 등)
  subsSchedule: string;            // 청약 일정 원본 문자열 (예: "2026.10.20~10.21")
  subsStartDate: string;           // 청약 시작일 (YYYY-MM-DD)
  subsEndDate: string;             // 청약 마감일 (YYYY-MM-DD)
  listingDate: string;             // 상장일 (YYYY-MM-DD 또는 "")
  refundDate?: string;             // 환불일 (YYYY-MM-DD 또는 "")
  fixedPrice: string;              // 확정 공모가 (예: "15,000" 또는 "-")
  hopePrice: string;               // 희망 공모가 (예: "12,600~15,300")
  competitionRate: string;         // 청약 경쟁률 (예: "1,250:1" 또는 "-")
  underwriters: string[];          // 주관사 목록 (예: ["신한투자증권", "삼성증권"])
  detailUrl: string;               // 38커뮤니케이션 상세 링크
  shares?: string;                 // 총 공모 주식수
  status: 'UPCOMING' | 'SUBS_ACTIVE' | 'SUBS_DEADLINE_TODAY' | 'SUBS_CLOSED' | 'LISTING_TODAY' | 'LISTED';
  updatedAt: string;               // 수집 일시 (ISO string)
}

export interface UserPreferences {
  userId: string;
  preferredUnderwriters: string[]; // 관심 주관사 목록 (빈 배열이면 전체 관심)
  notifySubsDeadline: boolean;     // 청약 마감 알림 활성화 여부 (기본 true)
  notifyListing: boolean;          // 상장일 알림 활성화 여부 (기본 true)
  telegramBotToken?: string;       // 텔레그램 봇 토큰 (예: 123456:ABC-DEF...)
  telegramChatId?: string;         // 텔레그램 수신 채팅 ID (예: 123456789)
  webhookUrl?: string;             // Discord / Slack / Telegram 웹훅 URL
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  type: 'SUBS_DEADLINE' | 'LISTING' | 'SCHEDULE_CHANGED' | 'SYSTEM_ALERT';
  ipoId?: string;
  ipoName: string;
  title: string;
  message: string;
  underwriters: string[];
  detailUrl: string;
  sentAt: string;
  channel: 'BROWSER_PUSH' | 'WEBHOOK' | 'CONSOLE' | 'IN_APP';
  success: boolean;
}

export interface SchedulerStatus {
  lastCrawledAt: string | null;
  nextDailyCrawlAt: string;
  totalIposCount: number;
  activeIposCount: number;
  todaySubsDeadlineCount: number;
  todayListingCount: number;
  crawlerCron: string;             // "30 18 * * *"
  subsAlertCron: string;           // "50 15 * * *"
  listingAlertCron: string;        // "50 8 * * *"
  isCrawling: boolean;
}
