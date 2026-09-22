/**
 * 한국 공모주 알리미 프론트엔드 어플리케이션
 */

// 상태 관리
const state = {
  ipos: [],
  underwriters: [],
  selectedUnderwriters: new Set(),
  currentStatus: 'ALL',
  searchQuery: '',
  excludeSpacInView: false, // 화면 목록 스팩 제외 토글
  sortBy: 'ALL_SOON', // 'ALL_SOON' | 'SUBS_SOON' | 'LISTING_SOON'
  viewMode: 'grid', // 'grid' | 'table'
  preferences: {
    preferredUnderwriters: [],
    notifySubsDeadline: true,
    notifyListing: true,
    excludeSpac: true, // 스팩주 알림 제외 기본값
    webhookUrl: '',
  },
  lastCrawledAt: null,
};

// 6대 대형 증권사 목록
const MAJOR_UNDERWRITERS = [
  '미래에셋증권',
  '한국투자증권',
  'KB증권',
  '삼성증권',
  'NH투자증권',
  '신한투자증권',
];

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initNotificationPermissionStatus();
  setupEventListeners();

  // 데이터 로드
  await loadPreferences();
  await loadUnderwriters();
  await loadIpos();
  await loadSchedulerStatus();
});

// 1. 실시간 시계 업데이트 (KST 기준)
function initClock() {
  const clockEl = document.getElementById('live-clock');
  const update = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    if (clockEl) clockEl.textContent = `${timeStr} (KST)`;
  };
  update();
  setInterval(update, 1000);
}

// 2. 브라우저 알림 권한 상태 표시
function initNotificationPermissionStatus() {
  const badge = document.getElementById('push-status-badge');
  const btnReq = document.getElementById('btn-request-permission');

  if (!('Notification' in window)) {
    if (badge) {
      badge.textContent = '이 브라우저는 웹 알림을 지원하지 않습니다.';
      badge.className = 'text-xs px-2.5 py-1 rounded-md bg-red-900/40 text-red-300 border border-red-700/50 inline-block';
    }
    if (btnReq) btnReq.disabled = true;
    return;
  }

  if (Notification.permission === 'granted') {
    if (badge) {
      badge.textContent = '✅ 브라우저 푸시 알림 허용됨';
      badge.className = 'text-xs px-2.5 py-1 rounded-md bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 inline-block';
    }
    if (btnReq) {
      btnReq.textContent = '허용 완료';
      btnReq.classList.replace('bg-blue-600', 'bg-slate-700');
    }
  } else if (Notification.permission === 'denied') {
    if (badge) {
      badge.textContent = '🚫 알림 권한이 차단되었습니다 (브라우저 설정에서 변경 필요)';
      badge.className = 'text-xs px-2.5 py-1 rounded-md bg-red-900/40 text-red-300 border border-red-700/50 inline-block';
    }
  } else {
    if (badge) {
      badge.textContent = '⚠️ 알림 권한 대기 중 (권한 요청 버튼을 눌러주세요)';
      badge.className = 'text-xs px-2.5 py-1 rounded-md bg-amber-900/40 text-amber-300 border border-amber-700/50 inline-block';
    }
  }
}

// 3. API 통신 및 데이터 로드
async function loadPreferences() {
  try {
    const res = await fetch('/api/preferences');
    const json = await res.json();
    if (json.success && json.data) {
      state.preferences = json.data;
      // 로컬 스토리지에 저장된 선택값이 있으면 우선 활용
      const localSelected = localStorage.getItem('ipo_selected_underwriters');
      if (localSelected) {
        state.selectedUnderwriters = new Set(JSON.parse(localSelected));
      } else if (state.preferences.preferredUnderwriters && state.preferences.preferredUnderwriters.length > 0) {
        state.selectedUnderwriters = new Set(state.preferences.preferredUnderwriters);
      }
      updatePreferencesUI();
    }
  } catch (err) {
    console.error('Failed to load preferences:', err);
  }
}

async function loadUnderwriters() {
  try {
    const res = await fetch('/api/underwriters');
    const json = await res.json();
    if (json.success) {
      state.underwriters = json.data;
      renderUnderwritersChips();
      renderModalUnderwritersList();
    }
  } catch (err) {
    console.error('Failed to load underwriters:', err);
  }
}

async function loadIpos() {
  try {
    const res = await fetch('/api/ipos');
    const json = await res.json();
    if (json.success) {
      state.ipos = json.data;
      state.lastCrawledAt = json.lastCrawledAt;

      // 주관사 목록이 아직 안 채워진 경우 공모주 데이터로부터 즉시 실시간 추출
      if (state.underwriters.length === 0 && state.ipos.length > 0) {
        const stats = {};
        state.ipos.forEach(item => {
          (item.underwriters || []).forEach(u => {
            if (u && u !== '-') stats[u] = (stats[u] || 0) + 1;
          });
        });
        state.underwriters = Object.entries(stats)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
        renderUnderwritersChips();
        renderModalUnderwritersList();
      }

      updateStats();
      renderIpos();
    }
  } catch (err) {
    console.error('Failed to load IPOs:', err);
    showToast('공모주 데이터를 불러오는데 실패했습니다.', 'error');
  }
}

async function loadSchedulerStatus() {
  try {
    const res = await fetch('/api/scheduler/status');
    const json = await res.json();
    if (json.success && json.data) {
      const status = json.data;
      const lastSyncEl = document.getElementById('last-sync-time');
      if (lastSyncEl && status.lastCrawledAt) {
        const d = new Date(status.lastCrawledAt);
        lastSyncEl.textContent = `${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
  } catch (err) {
    console.error('Failed to load scheduler status:', err);
  }
}

// 4. 이벤트 리스너 등록
function setupEventListeners() {
  // 수동 새로고침 버튼
  const btnRefresh = document.getElementById('btn-refresh');
  btnRefresh.addEventListener('click', handleManualRefresh);

  // 설정 모달 열기 / 닫기
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  // 알림 기록 로그 모달 열기 / 닫기
  document.getElementById('btn-open-logs').addEventListener('click', openLogsModal);
  document.getElementById('btn-close-logs').addEventListener('click', () => {
    document.getElementById('logs-modal').classList.add('hidden');
  });

  // 브라우저 알림 권한 요청
  document.getElementById('btn-request-permission').addEventListener('click', async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      initNotificationPermissionStatus();
      if (permission === 'granted') {
        showToast('브라우저 알림 권한이 승인되었습니다!', 'success');
        playBeep();
      }
    }
  });

  // 주관사 빠른 필터 버튼
  document.getElementById('btn-filter-all').addEventListener('click', () => {
    state.underwriters.forEach(u => state.selectedUnderwriters.add(u.name));
    saveSelectedUnderwriters();
    renderUnderwritersChips();
    updatePreferencesUI();
    renderIpos();
  });

  document.getElementById('btn-filter-major').addEventListener('click', () => {
    state.selectedUnderwriters.clear();
    MAJOR_UNDERWRITERS.forEach(u => state.selectedUnderwriters.add(u));
    saveSelectedUnderwriters();
    renderUnderwritersChips();
    updatePreferencesUI();
    renderIpos();
  });

  document.getElementById('btn-filter-clear').addEventListener('click', () => {
    state.selectedUnderwriters.clear();
    saveSelectedUnderwriters();
    renderUnderwritersChips();
    updatePreferencesUI();
    renderIpos();
  });

  // 상태 탭 클릭
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white', 'shadow');
        b.classList.add('text-slate-400');
      });
      const target = e.currentTarget;
      target.classList.add('bg-blue-600', 'text-white', 'shadow');
      target.classList.remove('text-slate-400');
      state.currentStatus = target.getAttribute('data-status');
      renderIpos();
    });
  });

  // 스팩 제외 토글 버튼
  const btnToggleSpac = document.getElementById('btn-toggle-spac');
  if (btnToggleSpac) {
    btnToggleSpac.addEventListener('click', () => {
      state.excludeSpacInView = !state.excludeSpacInView;
      if (state.excludeSpacInView) {
        btnToggleSpac.classList.remove('bg-slate-800', 'text-slate-300', 'border-slate-700');
        btnToggleSpac.classList.add('bg-amber-600', 'text-white', 'border-amber-500', 'shadow-md', 'shadow-amber-600/30');
        showToast('스팩(SPAC) 종목을 목록에서 제외했습니다.', 'info');
      } else {
        btnToggleSpac.classList.remove('bg-amber-600', 'text-white', 'border-amber-500', 'shadow-md', 'shadow-amber-600/30');
        btnToggleSpac.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
        showToast('모든 공모주(스팩 포함)를 표시합니다.', 'info');
      }
      renderIpos();
    });
  }

  // 검색창 입력
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderIpos();
  });

  // 정렬 기준 변경
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderIpos();
    });
  }

  // 카드/테이블 뷰 토글
  const btnToggleView = document.getElementById('btn-toggle-view');
  btnToggleView.addEventListener('click', () => {
    state.viewMode = state.viewMode === 'grid' ? 'table' : 'grid';
    const icon = document.getElementById('view-icon');
    const gridContainer = document.getElementById('ipo-list-container');
    const tableContainer = document.getElementById('ipo-table-container');

    if (state.viewMode === 'table') {
      icon.className = 'fa-solid fa-grip text-xs';
      gridContainer.classList.add('hidden');
      tableContainer.classList.remove('hidden');
    } else {
      icon.className = 'fa-solid fa-table-list text-xs';
      gridContainer.classList.remove('hidden');
      tableContainer.classList.add('hidden');
    }
    renderIpos();
  });

  // 알림 즉시 테스트 버튼
  document.getElementById('btn-test-subs').addEventListener('click', () => triggerTestAlert('SUBS_DEADLINE'));
  document.getElementById('btn-test-listing').addEventListener('click', () => triggerTestAlert('LISTING'));

  // 텔레그램 테스트 메시지 전송 버튼
  const btnTestTelegram = document.getElementById('btn-test-telegram');
  if (btnTestTelegram) {
    btnTestTelegram.addEventListener('click', handleTestTelegram);
  }

  // 환경설정 저장
  document.getElementById('btn-save-settings').addEventListener('click', handleSavePreferences);
}

// 5. 수동 새로고침 처리
async function handleManualRefresh() {
  const icon = document.getElementById('refresh-icon');
  icon.classList.add('fa-spin');

  showToast('38커뮤니케이션에서 최신 공모주 일정을 수집 중입니다...', 'info');

  try {
    const res = await fetch('/api/crawl/refresh', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message || '공모주 데이터가 최신으로 갱신되었습니다.', 'success');
      await loadUnderwriters();
      await loadIpos();
      await loadSchedulerStatus();
    } else {
      showToast('새로고침 중 오류가 발생했습니다.', 'error');
    }
  } catch (err) {
    showToast('서버 연결 실패', 'error');
  } finally {
    icon.classList.remove('fa-spin');
  }
}

// 6. 주관사 칩 렌더링
function renderUnderwritersChips() {
  const container = document.getElementById('underwriters-chips-container');
  if (!container) return;

  if (state.underwriters.length === 0) {
    container.innerHTML = '<span class="text-xs text-slate-500">주관사 데이터 없음</span>';
    return;
  }

  const isAllSelected = state.selectedUnderwriters.size === 0 || state.selectedUnderwriters.size === state.underwriters.length;

  container.innerHTML = state.underwriters.map(u => {
    const isSelected = !isAllSelected && state.selectedUnderwriters.has(u.name);
    const isMajor = MAJOR_UNDERWRITERS.includes(u.name);
    return `
      <button 
        onclick="toggleUnderwriterChip('${u.name}')"
        class="underwriter-chip px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition ${
          isSelected 
            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20' 
            : 'bg-slate-900/60 hover:bg-slate-700 text-slate-300 border-slate-700/60'
        }"
      >
        <span>${u.name}</span>
        <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-blue-800 text-blue-200' : 'bg-slate-800 text-slate-400'}">${u.count}</span>
        ${isMajor ? '<i class="fa-solid fa-star text-[9px] text-amber-400 ml-0.5"></i>' : ''}
      </button>
    `;
  }).join('');
}

// 주관사 칩 클릭 토글
window.toggleUnderwriterChip = function(name) {
  if (state.selectedUnderwriters.size === 0) {
    // 아무것도 선택 안된(전체) 상태에서 클릭 시, 해당 주관사만 단독 선택
    state.selectedUnderwriters.add(name);
  } else {
    if (state.selectedUnderwriters.has(name)) {
      state.selectedUnderwriters.delete(name);
    } else {
      state.selectedUnderwriters.add(name);
    }
  }

  saveSelectedUnderwriters();
  renderUnderwritersChips();
  updatePreferencesUI();
  renderIpos();
};

function saveSelectedUnderwriters() {
  localStorage.setItem('ipo_selected_underwriters', JSON.stringify(Array.from(state.selectedUnderwriters)));
}

// 7. 모달 내 주관사 체크박스 목록 렌더링
function renderModalUnderwritersList() {
  const container = document.getElementById('modal-underwriters-list');
  if (!container) return;

  container.innerHTML = state.underwriters.map(u => {
    const isChecked = state.selectedUnderwriters.has(u.name);
    return `
      <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" value="${u.name}" ${isChecked ? 'checked' : ''} onchange="onModalUnderwriterCheck(this)" class="w-3.5 h-3.5 rounded text-blue-600 bg-slate-800 border-slate-600 focus:ring-blue-500">
        <span class="truncate">${u.name}</span>
      </label>
    `;
  }).join('');
}

window.onModalUnderwriterCheck = function(checkbox) {
  const name = checkbox.value;
  if (checkbox.checked) {
    state.selectedUnderwriters.add(name);
  } else {
    state.selectedUnderwriters.delete(name);
  }
  saveSelectedUnderwriters();
  renderUnderwritersChips();
  updatePreferencesUI();
  renderIpos();
};

// 8. 환경설정 UI 및 상단 통계 업데이트
function updatePreferencesUI() {
  const prefCountEl = document.getElementById('stat-pref-count');
  const prefSummaryEl = document.getElementById('stat-pref-summary');

  if (state.selectedUnderwriters.size === 0 || state.selectedUnderwriters.size === state.underwriters.length) {
    if (prefCountEl) prefCountEl.innerHTML = `전체<span class="text-sm font-normal text-slate-400 ml-1">선택</span>`;
    if (prefSummaryEl) prefSummaryEl.textContent = '모든 주관사 알림 수신';
  } else {
    if (prefCountEl) prefCountEl.innerHTML = `${state.selectedUnderwriters.size}<span class="text-sm font-normal text-slate-400 ml-1">개사</span>`;
    if (prefSummaryEl) prefSummaryEl.textContent = `선택된 주관사만 필터링 중`;
  }

  // 모달 인풋 동기화
  const chkSubs = document.getElementById('chk-notify-subs');
  const chkListing = document.getElementById('chk-notify-listing');
  const chkExcludeSpac = document.getElementById('chk-exclude-spac');
  const inputWebhook = document.getElementById('input-webhook');
  const inputTgToken = document.getElementById('input-tg-token');
  const inputTgChat = document.getElementById('input-tg-chat');

  if (chkSubs) chkSubs.checked = state.preferences.notifySubsDeadline !== false;
  if (chkListing) chkListing.checked = state.preferences.notifyListing !== false;
  if (chkExcludeSpac) chkExcludeSpac.checked = state.preferences.excludeSpac !== false;
  if (inputWebhook) inputWebhook.value = state.preferences.webhookUrl || '';
  if (inputTgToken) inputTgToken.value = state.preferences.telegramBotToken || '';
  if (inputTgChat) inputTgChat.value = state.preferences.telegramChatId || '';
}

function updateStats() {
  // 한국 시간(KST) 기준으로 오늘 날짜 계산
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  const todaySubs = state.ipos.filter(i => i.subsEndDate === today);
  const todayListing = state.ipos.filter(i => i.listingDate === today);
  const activeCount = state.ipos.filter(i => i.status === 'SUBS_ACTIVE' || i.status === 'SUBS_DEADLINE_TODAY' || i.status === 'UPCOMING').length;

  document.getElementById('stat-subs-today').innerHTML = `${todaySubs.length}<span class="text-sm font-normal text-slate-400 ml-1">건</span>`;
  document.getElementById('stat-listing-today').innerHTML = `${todayListing.length}<span class="text-sm font-normal text-slate-400 ml-1">건</span>`;
  document.getElementById('stat-active-count').innerHTML = `${activeCount}<span class="text-sm font-normal text-slate-400 ml-1">건</span>`;
  document.getElementById('stat-total-count').textContent = state.ipos.length;

  if (todaySubs.length > 0) {
    document.getElementById('stat-subs-today-desc').textContent = todaySubs.map(i => i.name).join(', ');
  }
  if (todayListing.length > 0) {
    document.getElementById('stat-listing-today-desc').textContent = todayListing.map(i => i.name).join(', ');
  }
}

// 9. 공모주 필터링 및 렌더링
function getFilteredIpos() {
  // 한국 시간(KST) 기준으로 오늘 날짜 계산
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let list = [...state.ipos];

  // 1) 주관사 필터 (선택된 주관사가 있는 경우)
  if (state.selectedUnderwriters.size > 0 && state.selectedUnderwriters.size < state.underwriters.length) {
    list = list.filter(item => item.underwriters.some(u => state.selectedUnderwriters.has(u)));
  }

  // 2) 상태 탭 필터
  if (state.currentStatus === 'ACTIVE') {
    list = list.filter(item => item.status === 'SUBS_ACTIVE' || item.status === 'SUBS_DEADLINE_TODAY');
  } else if (state.currentStatus === 'UPCOMING') {
    list = list.filter(item => item.status === 'UPCOMING');
  } else if (state.currentStatus === 'CLOSED') {
    list = list.filter(item => item.status === 'SUBS_CLOSED' || item.status === 'LISTED');
  }

  // 3) 검색어 필터
  if (state.searchQuery) {
    list = list.filter(item => 
      item.name.toLowerCase().includes(state.searchQuery) ||
      item.underwriters.some(u => u.toLowerCase().includes(state.searchQuery))
    );
  }

  // 4) 스팩(SPAC) 제외 필터
  if (state.excludeSpacInView) {
    list = list.filter(item => !isSpacItem(item));
  }

  // 5) 정렬 적용
  if (state.sortBy === 'ALL_SOON' || state.sortBy === 'SMART') {
    // 전체 빠른순: 청약이든 상장이든 오늘 이후 가장 빠른 유효 일정(D-Day) 기준 정렬
    const getNextEventDate = (item) => {
      const dates = [];
      if (item.subsStartDate && item.subsStartDate >= today) dates.push(item.subsStartDate);
      if (item.subsEndDate && item.subsEndDate >= today) dates.push(item.subsEndDate);
      if (item.listingDate && item.listingDate >= today) dates.push(item.listingDate);
      if (dates.length > 0) {
        return dates.sort()[0]; // 가장 가까운 미래 일정
      }
      // 미래 일정이 없으면 최근 지난 일정(내림차순 정렬용)
      return null;
    };

    const upcoming = list.filter(item => getNextEventDate(item) !== null)
      .sort((a, b) => {
        const dateA = getNextEventDate(a);
        const dateB = getNextEventDate(b);
        return dateA.localeCompare(dateB);
      });

    const past = list.filter(item => getNextEventDate(item) === null)
      .sort((a, b) => {
        const lastA = a.listingDate || a.subsEndDate || a.subsStartDate || '';
        const lastB = b.listingDate || b.subsEndDate || b.subsStartDate || '';
        return lastB.localeCompare(lastA);
      });

    list = [...upcoming, ...past];
  } else if (state.sortBy === 'SUBS_SOON' || state.sortBy === 'DATE_ASC') {
    // 청약 빠른순: 청약 시작일 오름차순 (미래 우선, 과거 후순위)
    const upcoming = list.filter(i => (i.subsEndDate || i.subsStartDate) >= today)
      .sort((a, b) => (a.subsStartDate || '').localeCompare(b.subsStartDate || ''));
    const closed = list.filter(i => (i.subsEndDate || i.subsStartDate) < today)
      .sort((a, b) => (b.subsStartDate || '').localeCompare(a.subsStartDate || ''));
    list = [...upcoming, ...closed];
  } else if (state.sortBy === 'LISTING_SOON') {
    // 상장 빠른순: 상장 예정일 기준 오름차순 (상장일 미정은 맨 뒤로)
    const withListingUpcoming = list.filter(i => i.listingDate && i.listingDate >= today)
      .sort((a, b) => a.listingDate.localeCompare(b.listingDate));
    const withoutListing = list.filter(i => !i.listingDate || i.listingDate === '-');
    const pastListing = list.filter(i => i.listingDate && i.listingDate < today)
      .sort((a, b) => b.listingDate.localeCompare(a.listingDate));
    list = [...withListingUpcoming, ...withoutListing, ...pastListing];
  }

  return list;
}

// 스팩 종목 여부 정밀 판별 헬퍼
function isSpacItem(ipo) {
  const name = (ipo.name || '').replace(/\s+/g, '');
  const market = (ipo.market || '').replace(/\s+/g, '');

  // 1. 국내 스팩주 사명 패턴 (호스팩, 제N호스팩, 스팩N호, 기업인수목적)
  const isSpacNamePattern = /(호스팩|제\d+호스팩|스팩\d+호|기업인수목적|spac)/i.test(name) ||
                            /(스팩|spac|기업인수목적)/i.test(market);

  // 2. 공모가 보조 판별 (스팩은 공모가가 예외 없이 2,000원)
  const fixedPrice = (ipo.fixedPrice || '').replace(/,/g, '').trim();
  const hopePrice = (ipo.hopePrice || '').replace(/,/g, '').trim();
  const is2000Won = fixedPrice === '2000' || hopePrice === '2000' || hopePrice.includes('2000');

  // 사명 끝이 '스팩'으로 끝나거나 명확한 스팩 패턴인 경우
  if (isSpacNamePattern) {
    // '스팩트럼' 등 사명 중간에 스팩이 들어간 일반기업 방어: 단어 끝이 스팩이거나 호수가 있는 경우
    if (/스팩$|spac$|호스팩|스팩\d+호|기업인수목적/i.test(name) || is2000Won) {
      return true;
    }
  }

  return false;
}

function renderIpos() {
  const list = getFilteredIpos();
  const gridContainer = document.getElementById('ipo-list-container');
  const tableBody = document.getElementById('ipo-table-body');

  if (list.length === 0) {
    const emptyHtml = `
      <div class="col-span-full py-16 text-center text-slate-400 bg-slate-800/40 rounded-2xl border border-slate-700/40">
        <i class="fa-regular fa-folder-open text-3xl text-slate-500 mb-3"></i>
        <p class="text-sm font-medium text-slate-300">조건에 일치하는 공모주 일정이 없습니다.</p>
        <p class="text-xs text-slate-500 mt-1">주관사 필터나 검색어를 변경해 보세요.</p>
      </div>
    `;
    if (gridContainer) gridContainer.innerHTML = emptyHtml;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400">조건에 일치하는 공모주 일정이 없습니다.</td></tr>`;
    return;
  }

  // 카드 그리드 렌더링
  if (gridContainer) {
    gridContainer.innerHTML = list.map(ipo => createIpoCardHtml(ipo)).join('');
  }

  // 테이블 뷰 렌더링
  if (tableBody) {
    tableBody.innerHTML = list.map(ipo => createIpoTableRowHtml(ipo)).join('');
  }
}

// 공모주 카드 HTML 생성
function createIpoCardHtml(ipo) {
  // 한국 시간(KST) 기준으로 오늘 날짜 계산
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isSubsEndToday = ipo.subsEndDate === today;
  const isListingToday = ipo.listingDate === today;

  // D-Day 계산
  let dDayText = '';
  let dDayClass = 'bg-slate-700 text-slate-300';

  if (ipo.subsStartDate) {
    const diffTime = new Date(ipo.subsStartDate).getTime() - new Date(today).getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      dDayText = `청약 D-${diffDays}`;
      dDayClass = 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
    } else if (ipo.subsEndDate && today <= ipo.subsEndDate) {
      if (isSubsEndToday) {
        dDayText = '🚨 오늘 16:00 마감!';
        dDayClass = 'bg-red-500/30 text-red-300 border border-red-500/50 font-bold animate-pulse';
      } else {
        dDayText = '청약 진행중';
        dDayClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      }
    } else if (ipo.listingDate) {
      if (isListingToday) {
        dDayText = '🎉 오늘 상장 (09:00)!';
        dDayClass = 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold';
      } else {
        dDayText = `상장일: ${ipo.listingDate.slice(5)}`;
        dDayClass = 'bg-slate-800 text-slate-400 border border-slate-700';
      }
    } else {
      dDayText = '청약 마감';
      dDayClass = 'bg-slate-800 text-slate-500';
    }
  }

  // 시장 뱃지 색상
  let marketBadge = 'bg-slate-700 text-slate-300';
  if (ipo.market === '코스피') marketBadge = 'bg-blue-600/30 text-blue-300 border border-blue-500/40';
  else if (ipo.market === '스팩') marketBadge = 'bg-purple-600/30 text-purple-300 border border-purple-500/40';
  else if (ipo.market === '코스닥') marketBadge = 'bg-teal-600/30 text-teal-300 border border-teal-500/40';

  // 주관사 태그 렌더링
  const underwritersHtml = ipo.underwriters.map(u => {
    const isPreferred = state.selectedUnderwriters.has(u);
    return `
      <span class="px-2 py-0.5 rounded-md text-[11px] font-medium ${
        isPreferred 
          ? 'bg-blue-900/70 text-blue-200 border border-blue-600/60' 
          : 'bg-slate-800 text-slate-300 border border-slate-700'
      }">
        ${u}
      </span>
    `;
  }).join('');

  return `
    <div class="ipo-card bg-slate-800/90 border border-slate-700/70 rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden animate-fade-in ${
      isSubsEndToday ? 'ring-2 ring-red-500/50' : isListingToday ? 'ring-2 ring-amber-500/50' : ''
    }">
      <!-- 상단: 뱃지 및 종목명 -->
      <div>
        <div class="flex items-center justify-between gap-2 mb-2.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-md ${marketBadge}">
              ${ipo.market || '코스닥'}
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-full ${dDayClass}">
              ${dDayText}
            </span>
          </div>
          <a 
            href="${ipo.detailUrl}" 
            target="_blank" 
            rel="noopener noreferrer"
            title="38커뮤니케이션 상세페이지 바로가기"
            class="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 transition"
          >
            <span>38상세</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          </a>
        </div>

        <h3 class="text-lg font-bold text-white tracking-tight flex items-center gap-2 mb-3">
          ${ipo.name}
        </h3>

        <!-- 정보 그리드 -->
        <div class="space-y-2 py-2 border-y border-slate-700/60 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 flex items-center gap-1.5">
              <i class="fa-regular fa-calendar text-blue-400 text-[11px]"></i>
              청약 일정
            </span>
            <span class="font-semibold text-slate-200">${ipo.subsSchedule || '-'}</span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-400 flex items-center gap-1.5">
              <i class="fa-solid fa-won-sign text-emerald-400 text-[11px]"></i>
              공모가
            </span>
            <span class="font-bold text-white">
              ${ipo.fixedPrice !== '-' ? `<span class="text-emerald-400">${ipo.fixedPrice}원</span>` : `${ipo.hopePrice}원`}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-400 flex items-center gap-1.5">
              <i class="fa-solid fa-rocket text-amber-400 text-[11px]"></i>
              상장일
            </span>
            <span class="font-medium ${isListingToday ? 'text-amber-300 font-bold' : 'text-slate-300'}">
              ${ipo.listingDate || '미정'}
            </span>
          </div>

          ${ipo.refundDate ? `
          <div class="flex items-center justify-between">
            <span class="text-slate-400 flex items-center gap-1.5">
              <i class="fa-solid fa-money-bill-transfer text-purple-400 text-[11px]"></i>
              환불일
            </span>
            <span class="text-slate-300">${ipo.refundDate}</span>
          </div>
          ` : ''}

          ${ipo.competitionRate && ipo.competitionRate !== '-' ? `
          <div class="flex items-center justify-between">
            <span class="text-slate-400 flex items-center gap-1.5">
              <i class="fa-solid fa-chart-line text-indigo-400 text-[11px]"></i>
              경쟁률
            </span>
            <span class="text-indigo-300 font-semibold">${ipo.competitionRate}</span>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- 하단: 주관사 목록 & 버튼 -->
      <div class="mt-4 pt-2">
        <div class="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1">
          <i class="fa-solid fa-building-columns text-[10px]"></i>
          주관사
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${underwritersHtml || '<span class="text-xs text-slate-500">주관사 미정</span>'}
        </div>

        <a 
          href="${ipo.detailUrl}" 
          target="_blank" 
          rel="noopener noreferrer" 
          class="w-full py-2 px-3 rounded-xl bg-slate-700/80 hover:bg-blue-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition group"
        >
          <span>38커뮤니케이션 상세정보 보기</span>
          <i class="fa-solid fa-chevron-right text-[10px] group-hover:translate-x-0.5 transition"></i>
        </a>
      </div>
    </div>
  `;
}

// 테이블 행 HTML 생성
function createIpoTableRowHtml(ipo) {
  // 한국 시간(KST) 기준으로 오늘 날짜 계산
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isSubsEndToday = ipo.subsEndDate === today;
  const isListingToday = ipo.listingDate === today;

  return `
    <tr class="hover:bg-slate-700/40 transition">
      <td class="px-4 py-3 font-semibold text-white">
        <div class="flex items-center gap-2">
          <span>${ipo.name}</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-700 text-slate-300">${ipo.market || '코스닥'}</span>
        </div>
      </td>
      <td class="px-4 py-3">
        ${
          isSubsEndToday 
            ? '<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-300 border border-red-500/40">오늘 마감</span>'
            : isListingToday 
            ? '<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">오늘 상장</span>'
            : `<span class="text-slate-400 text-xs">${ipo.status}</span>`
        }
      </td>
      <td class="px-4 py-3 text-slate-300">${ipo.subsSchedule}</td>
      <td class="px-4 py-3 font-medium text-white">${ipo.fixedPrice !== '-' ? ipo.fixedPrice : ipo.hopePrice}</td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-1">
          ${ipo.underwriters.map(u => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 border border-slate-700">${u}</span>`).join('')}
        </div>
      </td>
      <td class="px-4 py-3 text-slate-300">${ipo.listingDate || '-'}</td>
      <td class="px-4 py-3 text-center">
        <a href="${ipo.detailUrl}" target="_blank" class="px-2 py-1 rounded bg-slate-700 hover:bg-blue-600 text-[11px] text-white transition">
          38 이동
        </a>
      </td>
    </tr>
  `;
}

// 10. 환경설정 저장 처리
async function handleSavePreferences() {
  const chkSubs = document.getElementById('chk-notify-subs');
  const chkListing = document.getElementById('chk-notify-listing');
  const chkExcludeSpac = document.getElementById('chk-exclude-spac');
  const inputWebhook = document.getElementById('input-webhook');
  const inputTgToken = document.getElementById('input-tg-token');
  const inputTgChat = document.getElementById('input-tg-chat');

  const payload = {
    preferredUnderwriters: Array.from(state.selectedUnderwriters),
    notifySubsDeadline: chkSubs ? chkSubs.checked : true,
    notifyListing: chkListing ? chkListing.checked : true,
    excludeSpac: chkExcludeSpac ? chkExcludeSpac.checked : true,
    webhookUrl: inputWebhook ? inputWebhook.value.trim() : '',
    telegramBotToken: inputTgToken ? inputTgToken.value.trim() : '',
    telegramChatId: inputTgChat ? inputTgChat.value.trim() : '',
  };

  try {
    const res = await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.success) {
      state.preferences = json.data;
      saveSelectedUnderwriters();
      showToast('환경설정이 성공적으로 저장되었습니다!', 'success');
      document.getElementById('settings-modal').classList.add('hidden');
      renderUnderwritersChips();
      updatePreferencesUI();
      renderIpos();
    }
  } catch (err) {
    showToast('설정 저장 실패', 'error');
  }
}

// 11. 텔레그램 테스트 메시지 전송 처리
async function handleTestTelegram() {
  const inputTgToken = document.getElementById('input-tg-token');
  const inputTgChat = document.getElementById('input-tg-chat');
  const btn = document.getElementById('btn-test-telegram');

  const botToken = inputTgToken ? inputTgToken.value.trim() : '';
  const chatId = inputTgChat ? inputTgChat.value.trim() : '';

  if (!botToken || !chatId) {
    showToast('텔레그램 봇 토큰과 채팅 ID를 모두 입력해주세요.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 전송 중...';

  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId }),
    });
    const json = await res.json();
    if (json.success) {
      showToast('🎉 텔레그램으로 테스트 메시지가 전송되었습니다! 앱을 확인해보세요.', 'success');
      playBeep();
    } else {
      showToast(json.message || '텔레그램 메시지 전송에 실패했습니다.', 'error');
    }
  } catch (err) {
    showToast('서버 통신 실패', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-brands fa-telegram"></i> <span>텔레그램 테스트 메시지 전송</span>';
  }
}

// 11. 알림 즉시 테스트 발송
async function triggerTestAlert(type) {
  try {
    const sampleIpo = state.ipos[0];
    const res = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ipoId: sampleIpo ? sampleIpo.id : undefined }),
    });
    const json = await res.json();
    if (json.success) {
      const log = json.data;
      showToast(`[테스트 알림] ${log.title}`, 'info');

      // 브라우저 웹 푸시 알림 발동
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(log.title, {
          body: log.message,
          icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
        });
        playBeep();
      }
    }
  } catch (err) {
    showToast('테스트 알림 발송 실패', 'error');
  }
}

// 12. 알림 로그 모달 열기
async function openLogsModal() {
  const modal = document.getElementById('logs-modal');
  const container = document.getElementById('logs-list-container');
  modal.classList.remove('hidden');

  container.innerHTML = '<div class="text-xs text-slate-500 py-6 text-center">알림 로그를 불러오는 중...</div>';

  try {
    const res = await fetch('/api/notifications');
    const json = await res.json();
    if (json.success && json.data) {
      const logs = json.data;
      if (logs.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-8 text-center">발송된 알림 내역이 없습니다.</div>';
        return;
      }
      container.innerHTML = logs.map(l => `
        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-700/60 text-xs space-y-1">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white flex items-center gap-1.5">
              ${l.type === 'SUBS_DEADLINE' ? '🚨 [청약마감]' : '🎉 [상장일]'} ${l.ipoName}
            </span>
            <span class="text-[10px] text-slate-400">${new Date(l.sentAt).toLocaleString('ko-KR')}</span>
          </div>
          <div class="text-slate-300 text-[11px]">${l.message}</div>
          <div class="flex items-center justify-between pt-1 text-[10px] text-slate-500">
            <span>주관사: ${l.underwriters.join(', ') || '전체'}</span>
            <span class="text-emerald-400">발송완료 (${l.channel})</span>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    container.innerHTML = '<div class="text-xs text-red-400 py-6 text-center">로그 로드 실패</div>';
  }
}

// 사운드 및 토스트 헬퍼
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600 text-white shadow-emerald-500/20',
    error: 'bg-red-600 text-white shadow-red-500/20',
    info: 'bg-blue-600 text-white shadow-blue-500/20',
  };

  toast.className = `px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl transition-all duration-300 transform translate-y-2 opacity-0 flex items-center gap-2 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-bell'}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    // ignore audio block
  }
}
