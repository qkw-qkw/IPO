import http from 'http';
import * as cheerio from 'cheerio';
import { IpoItem } from '../types';

const BASE_URL = 'http://www.38.co.kr';

/**
 * EUC-KR 인코딩 웹 페이지를 fetch하여 UTF-8 문자열로 디코딩
 */
export async function fetchHtmlEucKr(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    const req = http.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} from ${fullUrl}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          const decoder = new TextDecoder('euc-kr');
          const html = decoder.decode(buf);
          resolve(html);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${fullUrl}`));
    });
  });
}

/**
 * 38커뮤니케이션 청약일정 문자열 파싱 (예: "2026.10.20~10.21" -> start: "2026-10-20", end: "2026-10-21")
 */
export function parseSubsSchedule(scheduleRaw: string): { startDate: string; endDate: string } {
  const clean = scheduleRaw.replace(/\s+/g, '');
  const parts = clean.split('~');
  if (parts.length === 2) {
    const startStr = parts[0].trim(); // e.g. "2026.10.20"
    const endStr = parts[1].trim();   // e.g. "10.21" or "2026.10.21"

    const startParts = startStr.split('.');
    let startFormatted = '';
    let startYear = new Date().getFullYear().toString();
    if (startParts.length === 3) {
      startYear = startParts[0];
      startFormatted = `${startParts[0]}-${startParts[1].padStart(2, '0')}-${startParts[2].padStart(2, '0')}`;
    } else if (startParts.length === 2) {
      startFormatted = `${startYear}-${startParts[0].padStart(2, '0')}-${startParts[1].padStart(2, '0')}`;
    }

    let endFormatted = '';
    if (endStr.includes('.')) {
      const endParts = endStr.split('.');
      if (endParts.length === 3) {
        endFormatted = `${endParts[0]}-${endParts[1].padStart(2, '0')}-${endParts[2].padStart(2, '0')}`;
      } else if (endParts.length === 2) {
        endFormatted = `${startYear}-${endParts[0].padStart(2, '0')}-${endParts[1].padStart(2, '0')}`;
      }
    } else {
      endFormatted = startFormatted;
    }

    return { startDate: startFormatted, endDate: endFormatted };
  }
  return { startDate: scheduleRaw.replace(/\./g, '-'), endDate: scheduleRaw.replace(/\./g, '-') };
}

/**
 * 날짜 문자열 정규화 (YYYY.MM.DD 또는 YYYY/MM/DD -> YYYY-MM-DD)
 */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim().replace(/[./]/g, '-');
  const match = trimmed.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return '';
}

/**
 * 주관사 문자열 파싱 (쉼표, 슬래시, 공백 구분 다중 주관사 분리 및 정리)
 */
export function parseUnderwriters(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,/·\n\t]+/)
    .map(u => u.trim().replace(/\s+/g, ''))
    .filter(u => {
      if (!u || u === '-' || u.includes('공모뉴스') || u.includes('공모주') || u.includes('청약')) return false;
      // Filter out prices or pure numbers e.g. "12", "600~15"
      if (/^[\d,~.-]+$/.test(u)) return false;
      return true;
    });
}

/**
 * 공모주 진행 상태 판별
 */
export function determineStatus(
  subsStartDate: string,
  subsEndDate: string,
  listingDate: string,
  todayStr: string
): IpoItem['status'] {
  if (listingDate && listingDate === todayStr) {
    return 'LISTING_TODAY';
  }
  if (listingDate && listingDate < todayStr) {
    return 'LISTED';
  }
  if (subsEndDate && subsEndDate === todayStr) {
    return 'SUBS_DEADLINE_TODAY';
  }
  if (subsStartDate && subsEndDate && todayStr >= subsStartDate && todayStr <= subsEndDate) {
    return 'SUBS_ACTIVE';
  }
  if (subsStartDate && todayStr < subsStartDate) {
    return 'UPCOMING';
  }
  if (subsEndDate && todayStr > subsEndDate) {
    return 'SUBS_CLOSED';
  }
  return 'UPCOMING';
}

/**
 * 38커뮤니케이션 공모주 상세 페이지에서 상장일, 환불일 등 세부 정보 크롤링
 */
export async function fetchIpoDetail(detailUrl: string): Promise<Partial<IpoItem>> {
  try {
    const html = await fetchHtmlEucKr(detailUrl);
    const $ = cheerio.load(html);

    let listingDate = '';
    let refundDate = '';
    let shares = '';
    let market = '코스닥';

    // summary="공모청약일정" 테이블 파싱
    $('table[summary="공모청약일정"] tr').each((_, row) => {
      const label = $(row).find('td').eq(0).text().trim() || $(row).find('td').eq(1).text().trim();
      const val = $(row).find('td').last().text().trim();
      
      if (label.includes('상장일')) {
        listingDate = normalizeDate(val);
      } else if (label.includes('환불일')) {
        refundDate = normalizeDate(val);
      }
    });

    // summary="공모정보" 테이블 파싱
    $('table[summary="공모정보"] tr').each((_, row) => {
      const text = $(row).text();
      if (text.includes('총공모주식수')) {
        const tdText = $(row).find('td').eq(1).text().trim();
        if (tdText) shares = tdText;
      }
    });

    const titleText = $('title').text();
    if (titleText.includes('스팩')) {
      market = '스팩';
    } else if (titleText.includes('유가증권') || titleText.includes('KOSPI') || titleText.includes('코스피')) {
      market = '코스피';
    } else if (titleText.includes('코넥스')) {
      market = '코넥스';
    }

    return { listingDate, refundDate, shares, market };
  } catch (err) {
    return {};
  }
}

/**
 * 38커뮤니케이션 신규상장 페이지(o=nw)에서 상장일 정보 맵 수집
 */
export async function fetchListingDatesMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const html = await fetchHtmlEucKr('/html/fund/index.htm?o=nw');
    const $ = cheerio.load(html);

    $('table').each((_, table) => {
      const headerText = $(table).find('thead').text();
      if (headerText.includes('기업명') && headerText.includes('신규상장일')) {
        $(table).find('tbody tr').each((_, row) => {
          const name = $(row).find('td').eq(0).text().trim();
          const rawDate = $(row).find('td').eq(1).text().trim();
          if (name && rawDate) {
            map[name] = normalizeDate(rawDate);
          }
        });
      }
    });
  } catch (err) {
    console.warn('[Crawler] Error fetching new listings table:', err);
  }
  return map;
}

/**
 * 38커뮤니케이션 공모주 전체 일정 메인 크롤링 함수
 */
export async function fetchAllIpoSchedules(fetchDetails = true): Promise<IpoItem[]> {
  console.log('[Crawler] Fetching IPO schedules from 38 Communication...');
  const html = await fetchHtmlEucKr('/html/fund/index.htm?o=k');
  const $ = cheerio.load(html);

  const ipoList: IpoItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // 신규 상장일 매핑 테이블 사전 수집
  let listingMap: Record<string, string> = {};
  try {
    listingMap = await fetchListingDatesMap();
  } catch (e) {
    console.warn('[Crawler] listingMap fetch failed, continuing...');
  }

  // 정확한 공모청약 일정 테이블 탐색 (중첩 테이블 제외한 최하위 실데이터 테이블)
  $('table').each((_, table) => {
    if ($(table).find('table').length > 0) return; // 상위 부모 테이블 스킵
    const thead = $(table).find('thead');
    const theadText = thead.text() || '';
    if (theadText.includes('공모주일정') && theadText.includes('주간사')) {
      const rows = $(table).find('tbody tr');
      rows.each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length >= 6) {
          const nameLink = tds.eq(0).find('a');
          const name = nameLink.text().trim();
          const href = nameLink.attr('href') || '';
          
          if (!name || !href.includes('o=v')) return;

          // 상세 URL 완성
          const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/html/fund/'}${href}`;
          // id 추출 (no= 파라미터)
          const idMatch = href.match(/no=(\d+)/);
          const id = idMatch ? idMatch[1] : `ipo_${name}_${Math.random().toString(36).substring(2, 7)}`;

          const subsSchedule = tds.eq(1).text().trim();
          const fixedPrice = tds.eq(2).text().trim() || '-';
          const hopePrice = tds.eq(3).text().trim() || '-';
          const competitionRate = tds.eq(4).text().trim() || '-';
          const underwriterRaw = tds.eq(5).text().trim();

          const { startDate, endDate } = parseSubsSchedule(subsSchedule);
          const underwriters = parseUnderwriters(underwriterRaw);

          let market = '코스닥';
          if (name.includes('스팩')) market = '스팩';

          const listingDate = listingMap[name] || '';

          const status = determineStatus(startDate, endDate, listingDate, today);

          ipoList.push({
            id,
            name,
            market,
            subsSchedule,
            subsStartDate: startDate,
            subsEndDate: endDate,
            listingDate,
            refundDate: '',
            fixedPrice,
            hopePrice,
            competitionRate,
            underwriters,
            detailUrl,
            status,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }
  });

  console.log(`[Crawler] Found ${ipoList.length} IPO items from main schedule.`);

  // 상세 페이지 정보 보강 (상위 15개 또는 청약예정/진행중인 주요 종목)
  if (fetchDetails && ipoList.length > 0) {
    const targetItems = ipoList.slice(0, 15);
    for (const item of targetItems) {
      if (item.detailUrl && (!item.listingDate || !item.refundDate)) {
        try {
          const detail = await fetchIpoDetail(item.detailUrl);
          if (detail.listingDate) item.listingDate = detail.listingDate;
          if (detail.refundDate) item.refundDate = detail.refundDate;
          if (detail.shares) item.shares = detail.shares;
          if (detail.market) item.market = detail.market;
          // 상태 재계산
          item.status = determineStatus(item.subsStartDate, item.subsEndDate, item.listingDate, today);
        } catch (e) {
          // ignore individual detail fail
        }
      }
    }
  }

  return ipoList;
}
