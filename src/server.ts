import express from 'express';
import cors from 'cors';
import path from 'path';
import { dbService } from './services/db';
import { ipoScheduler } from './scheduler/ipoScheduler';
import { notifierService } from './services/notifier';
import { sendTelegramMessage, formatSubsDeadlineMessage, parseChatIds } from './services/telegram';
import { fetchAllIpoSchedules } from './crawler/38crawler';

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 1. 공모주 목록 조회 API (주관사 필터, 검색어, 상태 필터 지원)
app.get('/api/ipos', async (req, res) => {
  const { underwriters, search, status, refresh } = req.query;
  
  // 데이터가 없거나 수동 새로고침 요청인 경우 즉시 크롤링
  let list = dbService.getAllIpos();
  if (list.length === 0 || refresh === 'true') {
    try {
      const crawled = await fetchAllIpoSchedules(false);
      dbService.saveIpos(crawled);
      list = dbService.getAllIpos();
    } catch (e) {
      console.warn('[API] On-demand crawl warning:', e);
    }
  }

  // 검색어 필터링
  if (typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(item => 
      item.name.toLowerCase().includes(q) ||
      item.underwriters.some(u => u.toLowerCase().includes(q))
    );
  }

  // 주관사 필터링 (다중 주관사 매칭)
  if (typeof underwriters === 'string' && underwriters.trim()) {
    const uList = underwriters.split(',').map(s => s.trim()).filter(Boolean);
    if (uList.length > 0) {
      list = list.filter(item => item.underwriters.some(u => uList.includes(u)));
    }
  }

  // 상태 필터링
  if (typeof status === 'string' && status !== 'ALL') {
    if (status === 'ACTIVE') {
      list = list.filter(item => item.status === 'SUBS_ACTIVE' || item.status === 'SUBS_DEADLINE_TODAY');
    } else if (status === 'UPCOMING') {
      list = list.filter(item => item.status === 'UPCOMING');
    } else if (status === 'CLOSED') {
      list = list.filter(item => item.status === 'SUBS_CLOSED' || item.status === 'LISTED');
    }
  }

  res.json({
    success: true,
    total: list.length,
    lastCrawledAt: dbService.getLastCrawledAt(),
    data: list,
  });
});

// 2. 단일 공모주 상세 조회
app.get('/api/ipos/:id', (req, res) => {
  const ipo = dbService.getIpoById(req.params.id);
  if (!ipo) {
    return res.status(404).json({ success: false, message: 'IPO item not found' });
  }
  res.json({ success: true, data: ipo });
});

// 3. 주관사 통계 목록 조회 API
app.get('/api/underwriters', async (req, res) => {
  let list = dbService.getAllIpos();
  if (list.length === 0) {
    try {
      const crawled = await fetchAllIpoSchedules(false);
      dbService.saveIpos(crawled);
    } catch (e) {
      console.warn('[API] On-demand crawl for underwriters warning:', e);
    }
  }
  const stats = dbService.getUnderwritersStats();
  res.json({ success: true, data: stats });
});

// 4. 수동 즉시 크롤링 동기화 API
app.post('/api/crawl/refresh', async (req, res) => {
  const result = await ipoScheduler.runCrawl('MANUAL_USER_REQUEST');
  res.json({
    ...result,
    message: result.success ? `크롤링 완료 (총 ${result.count}건 / 신규 ${result.added}건 / 갱신 ${result.updated}건)` : '크롤링 중이거나 오류가 발생했습니다.',
  });
});

// 5. 환경설정 조회 및 저장 API
app.get('/api/preferences', (req, res) => {
  const prefs = dbService.getPreferences();
  // 환경변수가 있으면 우선 적용
  if (process.env.TELEGRAM_BOT_TOKEN) prefs.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) prefs.telegramChatId = process.env.TELEGRAM_CHAT_ID;
  res.json({ success: true, data: prefs });
});

app.post('/api/preferences', (req, res) => {
  const updated = dbService.updatePreferences(req.body);
  res.json({ success: true, data: updated });
});

// 6. 알림 로그 조회 API
app.get('/api/notifications', (req, res) => {
  const logs = dbService.getNotificationLogs();
  res.json({ success: true, data: logs });
});

// 7. 알림 즉시 테스트 발송 API
app.post('/api/notifications/test', async (req, res) => {
  const { type, ipoId } = req.body;
  
  let ipos = dbService.getAllIpos();
  if (ipos.length === 0) {
    try {
      const crawled = await fetchAllIpoSchedules(false);
      dbService.saveIpos(crawled);
      ipos = dbService.getAllIpos();
    } catch (e) {
      console.warn('[API] On-demand crawl for test warning:', e);
    }
  }

  const foundIpo = ipoId ? dbService.getIpoById(ipoId) : ipos[0];
  const targetIpo: any = foundIpo || {
    id: 'test_sample',
    name: '티앤이코리아 (테스트 샘플)',
    market: '코스닥',
    subsSchedule: '2026.10.20~10.21',
    subsStartDate: '2026-10-20',
    subsEndDate: '2026-10-21',
    listingDate: '2026-10-30',
    refundDate: '2026-10-23',
    fixedPrice: '15,000',
    hopePrice: '12,600~15,300',
    competitionRate: '1,250:1',
    underwriters: ['신한투자증권', '삼성증권'],
    detailUrl: 'http://www.38.co.kr/html/fund/',
    status: 'SUBS_ACTIVE',
    updatedAt: new Date().toISOString(),
  };

  const prefs = dbService.getPreferences();
  let log;
  if (type === 'LISTING') {
    log = await notifierService.sendListingAlert(targetIpo, { ...prefs, preferredUnderwriters: [] });
  } else {
    log = await notifierService.sendSubsDeadlineAlert(targetIpo, { ...prefs, preferredUnderwriters: [] });
  }

  res.json({
    success: true,
    message: '테스트 알림이 성공적으로 발송되었습니다.',
    data: log,
  });
});

// 8. 텔레그램 봇 테스트 메시지 전송 API
app.post('/api/telegram/test', async (req, res) => {
  const { botToken, chatId } = req.body;
  const prefs = dbService.getPreferences();
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN || prefs.telegramBotToken;
  const chat = chatId || process.env.TELEGRAM_CHAT_ID || prefs.telegramChatId;

  if (!token || !chat) {
    return res.status(400).json({
      success: false,
      message: '텔레그램 봇 토큰과 채팅 ID를 모두 입력해주세요.',
    });
  }

  let ipos = dbService.getAllIpos();
  if (ipos.length === 0) {
    try {
      const crawled = await fetchAllIpoSchedules(false);
      dbService.saveIpos(crawled);
      ipos = dbService.getAllIpos();
    } catch (e) {
      console.warn('[API] On-demand crawl for telegram test warning:', e);
    }
  }

  const sampleIpo = ipos[0] || {
    id: 'sample',
    name: '티앤이코리아 (샘플)',
    market: '코스닥',
    subsSchedule: '2026.10.20~10.21',
    subsStartDate: '2026-10-20',
    subsEndDate: '2026-10-21',
    listingDate: '2026-10-30',
    fixedPrice: '15,000',
    hopePrice: '12,600~15,300',
    competitionRate: '1,250:1',
    underwriters: ['신한투자증권'],
    detailUrl: 'http://www.38.co.kr/html/fund/',
    status: 'SUBS_ACTIVE',
    updatedAt: new Date().toISOString(),
  };

  const sampleMsg = formatSubsDeadlineMessage(sampleIpo);
  const testMsg = `
🔔 <b>[공모주 알리미] 텔레그램 봇 연동 테스트 성공!</b>

정상적으로 텔레그램 알림을 수신할 수 있습니다.

---------------------------------
<b>[발송 샘플 미리보기]</b>
${sampleMsg}
`.trim();

  // import 구문 없이 require 형태로 사용된 parseChatIds 우회 또는 상단 import 추가 (파일 상단에서 처리되어야 함)
  // We need to make sure parseChatIds is imported at the top of server.ts
  
  // Here we just use the parseChatIds function that we'll add to imports
  const chatIds = parseChatIds(chat);
  const success = await sendTelegramMessage({ botToken: token, chatIds }, testMsg);

  if (success) {
    // 설정 저장
    dbService.updatePreferences({ telegramBotToken: token, telegramChatId: chat });
    res.json({ success: true, message: '텔레그램 테스트 메시지가 성공적으로 전송되었습니다!' });
  } else {
    res.status(500).json({ success: false, message: '텔레그램 전송 실패: 토큰이나 채팅 ID를 다시 확인해주세요.' });
  }
});

// 9. 스케줄러 상태 조회 API
app.get('/api/scheduler/status', (req, res) => {
  const status = ipoScheduler.getStatus();
  res.json({ success: true, data: status });
});

// Vercel Serverless 및 로컬 서버 호환
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`🚀 공모주 알림 서버 실행 중: http://localhost:${PORT}`);
    console.log(`======================================================\n`);

    ipoScheduler.init();

    const existingIpos = dbService.getAllIpos();
    if (existingIpos.length === 0) {
      await ipoScheduler.runCrawl('SERVER_INITIAL_START');
    }
  });
}

export default app;
