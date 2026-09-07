import express from 'express';
import cors from 'cors';
import path from 'path';
import { dbService } from './services/db';
import { ipoScheduler } from './scheduler/ipoScheduler';
import { notifierService } from './services/notifier';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 1. 공모주 목록 조회 API (주관사 필터, 검색어, 상태 필터 지원)
app.get('/api/ipos', (req, res) => {
  const { underwriters, search, status } = req.query;
  let list = dbService.getAllIpos();

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
app.get('/api/underwriters', (req, res) => {
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
  const ipos = dbService.getAllIpos();
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

// 8. 스케줄러 상태 조회 API
app.get('/api/scheduler/status', (req, res) => {
  const status = ipoScheduler.getStatus();
  res.json({ success: true, data: status });
});

// 서버 시작 및 초기화
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 공모주 알림 서버 실행 중: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // 스케줄러 등록
  ipoScheduler.init();

  // 기존 저장 데이터가 없을 경우 최초 1회 즉시 크롤링
  const existingIpos = dbService.getAllIpos();
  if (existingIpos.length === 0) {
    console.log('[Init] No cached IPO data found. Performing initial crawl...');
    await ipoScheduler.runCrawl('SERVER_INITIAL_START');
  } else {
    console.log(`[Init] Loaded ${existingIpos.length} cached IPO items from disk.`);
  }
});
