(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  // 페이지마다 있는 요소가 다르므로 없는 요소는 조용히 건너뛴다.
  const setHidden = (id, hidden) => { const n = $(id); if (n) n.hidden = hidden; };
  const setText = (id, text) => { const n = $(id); if (n) n.textContent = text; };
  const on = (id, type, handler) => { const n = $(id); if (n) n.addEventListener(type, handler); };

  const money = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;
  const pad = (value) => String(value).padStart(2, '0');
  const dateTime = (iso) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '-';
    return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  };
  const dateOnly = (iso) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '-';
    return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())}`;
  };
  const percent = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);

  /* ================================================================ 회원 포털 API */
  const API_BASE = '/portal/v1';
  const TOKEN_KEY = 'haeon.session.token';
  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (error) { return null; } };
  const writeToken = (token) => {
    try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); }
    catch (error) { /* 저장소를 쓸 수 없으면 이번 세션에서만 유지한다. */ }
  };

  const call = async (path, options = {}) => {
    const headers = Object.assign({ Accept: 'application/json' }, options.headers);
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
    } catch (error) {
      const failure = new Error('해온카드 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      failure.code = 'NETWORK_ERROR';
      throw failure;
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(body.message || '요청을 처리하지 못했습니다.');
      failure.code = body.errorCode || `HTTP_${response.status}`;
      failure.status = response.status;
      throw failure;
    }
    return body;
  };

  /* ================================================================ 공유 상태 */
  const MYPAGE_URL = '/mypage';
  const isMypage = !!$('mypageBody');   // 마이페이지 화면인가
  const hasMyPanel = !!$('myPanel');    // 랜딩의 MY 요약 패널이 있는가
  let member = null;
  let cardList = null;
  let transactionList = null;

  const reasonText = {
    APPROVED: '정상 승인',
    LIMIT_EXCEEDED: '이용한도 초과',
    CARD_BLOCKED: '카드 이용 불가'
  };

  /* ================================================================ 마이페이지 렌더 */
  const setMypageError = (message) => {
    const box = $('mypageError');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  };

  const renderProfile = () => {
    const box = $('mypageProfile');
    if (!box || !member) return;
    box.replaceChildren();
    [['회원명', member.displayName], ['회원번호', member.memberNo],
     ['가입일', dateOnly(member.joinedAt)], ['보유 카드', `${member.cardCount}장`]]
      .forEach(([label, value]) => {
        const item = el('div', 'profile-item');
        item.append(el('span', null, label), el('strong', null, value));
        box.append(item);
      });
  };

  const renderSummary = () => {
    const box = $('mypageSummary');
    if (!box || !cardList) return;
    box.replaceChildren();
    [['총 이용한도', money(cardList.totalLimitAmount)],
     ['총 이용금액', money(cardList.totalUsedAmount)],
     ['총 잔여한도', money(cardList.totalRemainingAmount)]]
      .forEach(([label, value], index) => {
        const item = el('div', index === 2 ? 'summary-item accent' : 'summary-item');
        item.append(el('span', null, label), el('strong', null, value));
        box.append(item);
      });
  };

  const cardRow = (card) => {
    const row = el('div', 'card-row');
    const head = el('div', 'card-row-head');
    head.append(el('strong', null, card.cardName), el('span', null, card.maskedNumber));
    if (card.primary) head.append(el('span', 'card-tag', '주 이용'));
    row.append(head);
    row.append(el('div', 'card-meta', `${card.brand} · ${card.cardType} · 결제일 매월 ${card.paymentDay}일`));
    const usage = el('div', 'card-usage');
    const bar = el('div', 'usage-bar');
    const fill = el('i');
    fill.style.width = `${percent(card.usedAmount, card.limitAmount)}%`;
    bar.append(fill);
    usage.append(bar, el('span', null,
      `이용금액 ${money(card.usedAmount)} · 잔여한도 ${money(card.remainingAmount)} / 이용한도 ${money(card.limitAmount)}`));
    row.append(usage);
    if (card.benefitSummary) row.append(el('div', 'card-benefit', card.benefitSummary));
    return row;
  };

  const renderCards = () => {
    const target = $('mypageCards');
    if (!target || !cardList) return;
    target.replaceChildren();
    if (!cardList.cards.length) { target.append(el('p', 'empty-note', '보유한 카드가 없습니다.')); return; }
    cardList.cards.forEach(card => target.append(cardRow(card)));
  };

  const transactionRow = (item) => {
    const row = el('div', 'history-row');
    const main = el('div', 'history-main');
    main.append(el('strong', null, item.merchantName),
      el('span', null, `${dateTime(item.occurredAt)} · ${item.cardName} ${item.maskedNumber} · 승인번호 ${item.authorizationNo}`));
    const trailing = el('div', 'history-amount');
    trailing.append(el('strong', null, money(item.amount)));
    const badges = el('div', 'history-badges');
    const approved = item.status === 'APPROVED';
    badges.append(el('span', `history-pill${approved ? '' : ' cancel'}`, approved ? '결제 승인' : '승인 거절'));
    if (!approved) badges.append(el('span', 'history-reason', reasonText[item.reasonCode] || item.reasonCode));
    trailing.append(badges);
    row.append(main, trailing);
    return row;
  };

  const renderTransactions = () => {
    const statTarget = $('mypageHistoryStat');
    const listTarget = $('mypageHistory');
    if (!statTarget || !listTarget || !transactionList) return;
    statTarget.replaceChildren();
    listTarget.replaceChildren();
    const stat = el('div', 'history-stat');
    stat.append(el('span', null, `조회 ${transactionList.transactions.length}건`),
      el('span', null, `승인 ${transactionList.approvedCount}건 · 합계 ${money(transactionList.approvedAmount)} · 거절 ${transactionList.declinedCount}건`));
    statTarget.append(stat);
    if (!transactionList.transactions.length) {
      listTarget.append(el('p', 'empty-note', '조회된 이용내역이 없습니다. 북웨이브에서 결제하면 이곳에 승인 결과가 표시됩니다.'));
      return;
    }
    transactionList.transactions.forEach(item => listTarget.append(transactionRow(item)));
  };

  /* ================================================================ 랜딩 MY 요약 패널 */
  const renderMyPanel = () => {
    if (!hasMyPanel || !member) return;
    setText('myGreeting', `${member.displayName}님, 좋은 하루 되세요!`);
    if (!cardList) return;
    const primary = cardList.cards.find(card => card.primary) || cardList.cards[0];
    setText('myCardName', primary ? `${primary.cardName} · ${primary.maskedNumber}` : '보유 카드 없음');
    setText('mySpent', money(cardList.totalUsedAmount));
    setText('myDue', primary ? money(primary.usedAmount) : money(0));
    setText('myAvailable', money(cardList.totalRemainingAmount));
  };

  /* ================================================================ 로그인 상태 전환 */
  const showLoggedOut = () => {
    member = null; cardList = null; transactionList = null;
    setHidden('myLoginView', false);
    setHidden('myAccountView', true);
    setText('headerLogin', '로그인');
    setHidden('mypageLogin', false);
    setHidden('mypageBody', true);
    setHidden('mypageRefresh', true);
    setMypageError('');
  };

  const showLoggedIn = () => {
    setHidden('myLoginView', true);
    setHidden('myAccountView', false);
    setText('headerLogin', '로그아웃');
    setHidden('mypageLogin', true);
    setHidden('mypageBody', false);
    setHidden('mypageRefresh', false);
  };

  const handleSessionLoss = (error) => {
    writeToken(null);
    showLoggedOut();
    setMypageError(error && error.message ? error.message : '다시 로그인해 주세요.');
  };

  /** 랜딩: 요약만 필요하므로 카드 조회 한 번. */
  const loadSummary = async () => {
    try {
      cardList = await call('/me/cards');
      member = cardList.member;
      showLoggedIn();
      renderMyPanel();
    } catch (error) {
      if (error.status === 401) { writeToken(null); showLoggedOut(); return; }
      showLoggedOut();
    }
  };

  /** 마이페이지: 카드와 이용내역을 함께 조회한다. */
  const loadMypage = async () => {
    const refresh = $('mypageRefresh');
    if (refresh) refresh.disabled = true;
    try {
      const [cards, transactions] = await Promise.all([call('/me/cards'), call('/me/transactions?limit=20')]);
      cardList = cards;
      transactionList = transactions;
      member = cards.member;
      setMypageError('');
      showLoggedIn();
      renderProfile(); renderSummary(); renderCards(); renderTransactions();
    } catch (error) {
      if (error.status === 401) { handleSessionLoss(error); return; }
      setMypageError(error.message);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  };

  const loadForThisPage = () => (isMypage ? loadMypage() : loadSummary());

  const restoreSession = async () => {
    if (!readToken()) { showLoggedOut(); return; }
    try {
      member = await call('/me');
      showLoggedIn();
      await loadForThisPage();
    } catch (error) {
      if (error.status === 401) { writeToken(null); showLoggedOut(); return; }
      showLoggedOut();
      setMypageError(error.message);
    }
  };

  /* ================================================================ 로그인 · 로그아웃 */
  const loginStatus = (message, tone) => {
    const box = $('loginStatus');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
    box.classList.toggle('error', tone === 'error');
  };

  on('loginForm', 'submit', async (event) => {
    event.preventDefault();
    const loginId = $('loginId').value.trim();
    const password = $('loginPassword').value;
    if (!loginId || !password) { loginStatus('아이디와 비밀번호를 입력해 주세요.', 'error'); return; }
    const submit = $('loginSubmit');
    submit.disabled = true;
    submit.textContent = '로그인 중…';
    try {
      const body = await call('/sessions', { method: 'POST', body: JSON.stringify({ loginId, password }) });
      writeToken(body.sessionToken);
      member = body.member;
      $('loginPassword').value = '';
      loginStatus('');
      showLoggedIn();
      await loadForThisPage();
    } catch (error) {
      loginStatus(error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = '로그인';
    }
  });

  const logout = async () => {
    try { await call('/sessions', { method: 'DELETE' }); }
    catch (error) { /* 세션이 이미 없으면 화면만 정리한다. */ }
    writeToken(null);
    showLoggedOut();
    loginStatus('');
  };

  on('headerLogin', 'click', (event) => {
    if (member) { logout(); return; }
    if (hasMyPanel) { activateLogin(false); focusMy(event); }
    else if (!isMypage) { window.location.href = MYPAGE_URL; }
    else { const input = $('loginId'); if (input) input.focus(); }
  });

  /* ================================================================ 화면 이동 */
  const focusMy = (event) => {
    if (!hasMyPanel) return;
    if (event) event.preventDefault();
    $('myPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const target = $('myLoginView') && $('myLoginView').hidden ? $('myPageLink') : $('loginId');
      if (target) target.focus();
    }, 320);
  };
  // MY 메뉴는 로그인 여부와 관계없이 마이페이지로 이동한다(로그인 폼은 그 화면에 있다).
  on('mypageRefresh', 'click', loadMypage);

  /* ================================================================ 안내 · 검색 대화상자 */
  const infoDialog = $('infoDialog');
  const searchDialog = $('searchDialog');
  const infoCopy = {
    '해온 데일리': ['생활에 꼭 필요한 할인', '온라인 쇼핑 10% · 편의점·커피 5% · 대중교통 3%', '매일 사용하는 생활 영역의 혜택을 한 장에 담았습니다.'],
    '해온 플러스': ['쇼핑과 구독을 더 알뜰하게', '주요 쇼핑몰 10% · 외식·배달 5% · 모든 가맹점 2%', '자주 찾는 쇼핑과 일상 결제에 어울리는 카드입니다.'],
    '해온 트래블': ['여행의 시작부터 끝까지', '해외 결제 2% · 해외 수수료 0원 · 공항 라운지 무료', '여행과 해외 이용을 위한 혜택을 모았습니다.'],
    '이벤트 자세히 보기': ['9월 생활 캐시백 이벤트', '2026.09.01 ~ 2026.09.30', '생활 영역에서 결제하면 자동으로 응모됩니다. 대상 가맹점과 유의사항은 이벤트 상세에서 확인해 주세요.'],
    '장기카드대출': ['목돈이 필요할 때', '이용한도 최대 5,000만원', '한도와 금리는 심사 결과에 따라 달라집니다. 자세한 조건은 고객센터로 문의해 주세요.'],
    '단기카드대출': ['필요한 순간, 간편하게', '365일 이용 안내', '이용 가능 금액은 보유 카드의 한도에 따라 달라집니다. 상환은 다음 결제일에 함께 청구됩니다.'],
    '일부결제금액이월': ['결제 비율을 선택하는 서비스', '일부결제금액이월약정 안내', '이월한 금액에는 약정 이자가 발생합니다. 결제 비율 변경과 약정 신청은 고객센터에서 도와드립니다.'],
    '오토 금융': ['새로운 출발을 위한 자동차 금융', '온라인 이용 안내', '온라인 견적과 신청은 차종에 따라 순차적으로 열립니다. 자세한 안내는 고객센터를 이용해 주세요.'],
    '자동납부': ['생활요금, 한 번에 관리하세요', '아파트관리비 · 전기요금 · 통신요금', '자동납부를 등록하면 결제일에 맞춰 자동으로 납부됩니다. 등록은 고객센터에서 도와드립니다.'],
    '해외 안심 케어': ['해외에서도 안심하는 카드 생활', '해외 이용 알림 · 이용 관리 안내', '해외 이용 알림과 이용 국가 제한은 고객센터에서 신청할 수 있습니다.'],
    '카드 분실·도난 신고': ['분실·도난 신고 안내', '분실·도난을 확인하면 즉시 신고해 주세요. 신고 접수와 동시에 카드 이용이 정지됩니다.', '신고 이후에는 재발급 절차를 안내해 드리며, 접수 시점 이후의 부정사용은 보상 대상이 됩니다.'],
    '상담 및 문의': ['해온카드 이용 안내', '카드 이용·이용한도·결제일 문의는 고객센터에서 도와드립니다.', '상담 가능 시간은 평일 09:00~18:00이며, 분실·도난 신고는 24시간 접수합니다.'],
    '개인정보처리방침': ['개인정보 처리 안내', '해온카드는 회원 본인 확인과 이용내역 조회에 필요한 최소한의 정보만 처리합니다.', '로그인 정보는 회원 인증에만 사용하며, 이용한도와 이용내역은 로그인한 회원의 카드로만 조회됩니다.']
  };
  const faq = [
    { q: '이용내역은 어디서 확인하나요?', a: '로그인한 뒤 상단 MY 메뉴의 마이페이지에서 최근 결제 승인·거절 내역을 확인할 수 있습니다.' },
    { q: '결제 승인 결과는 어떻게 확인하나요?', a: '가맹점(북웨이브)에서 해온카드로 결제하면 승인 결과가 해온카드에 기록됩니다. 마이페이지 이용내역에서 승인번호와 함께 확인할 수 있습니다.' },
    { q: '카드 이용한도는 어떻게 조회하나요?', a: '마이페이지의 “보유 카드”에서 카드별 이용한도·이용금액·잔여한도를 확인할 수 있습니다.' },
    { q: '결제가 거절되면 어떻게 하나요?', a: '이용내역에 거절 사유가 함께 표시됩니다. “이용한도 초과”라면 잔여한도를 확인한 뒤 금액을 조정해 다시 결제해 주세요.' },
    { q: '포인트는 어디서 확인하나요?', a: '라이프 영역의 “해온 포인트”에서 보유 포인트와 적립·사용 안내를 확인할 수 있습니다.' },
    { q: '카드를 분실했을 때는 어떻게 하나요?', a: '고객센터의 “분실·도난 신고”에서 절차 안내를 확인할 수 있습니다.' },
    { q: '로그인 정보는 안전하게 보관되나요?', a: '비밀번호는 원래 값으로 되돌릴 수 없는 형태로만 보관하며, 로그인 정보는 회원 인증에만 사용합니다. 이용한도와 이용내역은 로그인한 회원의 카드로만 조회됩니다.' }
  ];
  const points = {
    balance: 128450,
    history: [
      { date: '2026.09.13', desc: '북웨이브 결제 적립', delta: 389, type: '적립' },
      { date: '2026.09.10', desc: '해온마트 결제 적립', delta: 412, type: '적립' },
      { date: '2026.09.08', desc: '9월 등급 보너스', delta: 2000, type: '적립' },
      { date: '2026.09.05', desc: '해온카페 포인트 사용', delta: -3000, type: '사용' },
      { date: '2026.08.31', desc: '8월 실적 캐시백', delta: 5600, type: '적립' }
    ]
  };

  const buildDialog = (title) => {
    setText('infoTitle', title);
    $('infoBody').replaceChildren();
    $('infoBody').append(el('span', 'dialog-tag', 'HAEON CARD'));
    return $('infoBody');
  };
  const showFaq = () => {
    const body = buildDialog('자주 묻는 질문');
    const list = el('div', 'faq-list');
    faq.forEach(({ q, a }) => {
      const item = el('details', 'faq-item');
      item.append(el('summary', null, q), el('p', null, a));
      list.append(item);
    });
    body.append(list);
    infoDialog.showModal();
  };
  const showPoints = () => {
    const body = buildDialog('해온 포인트');
    const balance = el('div', 'point-balance');
    balance.append(el('span', null, '보유 포인트'), el('strong', null, `${points.balance.toLocaleString('ko-KR')} P`));
    body.append(balance);
    const list = el('div', 'point-list');
    points.history.forEach(p => {
      const row = el('div', 'point-row');
      const main = el('div', 'point-main');
      main.append(el('strong', null, p.desc), el('span', null, `${p.date} · ${p.type}`));
      row.append(main, el('strong', `point-delta ${p.delta < 0 ? 'minus' : 'plus'}`,
        `${p.delta > 0 ? '+' : ''}${p.delta.toLocaleString('ko-KR')} P`));
      list.append(row);
    });
    body.append(list);
    body.append(el('p', 'point-note', '포인트는 결제일 다음 날 적립되며, 적립 후 5년간 사용할 수 있습니다.'));
    infoDialog.showModal();
  };
  const showInfo = (title) => {
    if (!infoDialog) return;
    if (title === '자주 묻는 질문') { showFaq(); return; }
    if (title === '해온 포인트') { showPoints(); return; }
    const body = buildDialog(title);
    (infoCopy[title] || [`${title} 안내`, '해당 서비스는 순차적으로 열립니다. 자세한 안내는 고객센터를 이용해 주세요.'])
      .forEach(text => body.append(el('p', null, text)));
    if (['해온 데일리', '해온 플러스', '해온 트래블'].includes(title)) {
      body.append(el('p', null, '표시된 혜택은 전월 이용실적과 이용 조건에 따라 달라질 수 있습니다.'));
    }
    infoDialog.showModal();
  };

  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  [infoDialog, searchDialog].filter(Boolean).forEach(dialog => {
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dialog.close(); } });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => showInfo(button.dataset.info)));

  /* ================================================================ 검색 */
  const menuItems = [
    ['마이페이지 · 이용내역 조회', '/mypage', 'MY'], ['보유 카드 · 이용가능한도', '/mypage', 'MY'],
    ['해온 데일리 · 생활·교통', '/#cards', '카드'], ['해온 플러스 · 쇼핑·구독', '/#cards', '카드'], ['해온 트래블 · 여행·해외', '/#cards', '카드'],
    ['이벤트 · 캐시백 혜택', '/#benefit', '혜택'], ['장기·단기카드대출 · 리볼빙', '/#finance', '금융'],
    ['자동납부 · 해외 안심 케어 · 포인트', '/#life', '라이프'], ['공지사항 · 분실 신고 · 고객센터', '/#notice', '고객센터']
  ];
  const renderSearch = () => {
    const term = $('siteSearch').value.trim().toLowerCase();
    const matches = menuItems.filter(item => item.join(' ').toLowerCase().includes(term));
    $('searchResults').replaceChildren();
    matches.forEach(([label, href, group]) => {
      const link = document.createElement('a');
      link.href = href;
      link.append(el('span', null, label), el('small', null, `${group}  ›`));
      link.addEventListener('click', event => {
        const hash = href.startsWith('/#') ? href.slice(1) : null;
        const target = hash ? document.querySelector(hash) : null;
        if (!target) return;             // 다른 페이지면 기본 이동에 맡긴다
        event.preventDefault();
        searchDialog.close();
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('searchResults').append(link);
    });
    setText('searchStatus', `${matches.length}개의 검색 결과`);
    if (!matches.length) $('searchResults').append(el('p', 'empty-search', '검색 결과가 없습니다. 카드, 금융, 포인트 등 다른 검색어를 입력해 주세요.'));
  };
  const openSearch = () => { $('siteSearch').value = ''; renderSearch(); searchDialog.showModal(); $('siteSearch').focus(); };
  on('searchButton', 'click', openSearch);
  on('siteSearch', 'input', renderSearch);

  /* ================================================================ 랜딩 전용 */
  function activateLogin(simple) {
    if (!$('idLoginTab')) return;
    $('loginForm').hidden = simple;
    $('simpleLoginPanel').hidden = !simple;
    [$('idLoginTab'), $('simpleLoginTab')].forEach((tab, index) => {
      const selected = simple === Boolean(index);
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected);
      tab.tabIndex = selected ? 0 : -1;
    });
  }

  const initHero = () => {
    if (!$('heroPanel')) return;
    const heroSlides = [
      { overline: 'HAEON CARD · EVERYDAY BENEFIT', title: '오늘의 생활에<br>딱 맞는 카드', text: '쓸수록 커지는 일상의 혜택을<br>해온카드에서 만나보세요.', card: '해온 데일리' },
      { overline: 'HAEON CARD · SMART SHOPPING', title: '쇼핑하는 순간마다<br>커지는 즐거움', text: '온라인 쇼핑부터 구독 서비스까지<br>해온 플러스로 알뜰하게.', card: '해온 플러스' },
      { overline: 'HAEON CARD · TRAVEL LIFE', title: '여행의 모든 순간을<br>더 가볍게', text: '공항부터 해외 결제까지<br>해온 트래블의 특별한 혜택.', card: '해온 트래블' }
    ];
    let slideIndex = 0;
    let slideTimer;
    let playing = false;
    const setSlide = (index) => {
      slideIndex = index; const slide = heroSlides[index];
      setText('heroOverline', slide.overline);
      $('heroTitle').innerHTML = slide.title;
      $('heroText').innerHTML = slide.text;
      setText('heroCardName', slide.card);
      setText('slideCount', `0${index + 1} / 03`);
      $('heroPanel').style.background = ['#e6f2ec', '#f4efdf', '#e8eff5'][index];
      $('heroPanel').setAttribute('aria-labelledby', `heroTab${index}`);
      document.querySelector('.hero-card-art').style.background = ['linear-gradient(150deg,#164e45,#0d7060 65%,#83af7d)', 'linear-gradient(135deg,#9a8959,#c2ac73)', 'linear-gradient(135deg,#434d66,#77879b)'][index];
      document.querySelectorAll('[data-slide]').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-pressed', i === index); });
      document.querySelectorAll('[data-hero]').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-selected', i === index); button.tabIndex = i === index ? 0 : -1; });
    };
    const restartSlides = () => { clearInterval(slideTimer); if (playing && !document.hidden) slideTimer = setInterval(() => setSlide((slideIndex + 1) % heroSlides.length), 6000); };
    const updatePlayback = () => {
      setText('slidePause', playing ? 'Ⅱ' : '▶');
      $('slidePause').setAttribute('aria-label', playing ? '배너 자동 재생 정지' : '배너 자동 재생 시작');
      $('slidePause').setAttribute('aria-pressed', playing);
      restartSlides();
    };
    document.querySelectorAll('[data-slide], [data-hero]').forEach(button => button.addEventListener('click', () => { setSlide(Number(button.dataset.slide ?? button.dataset.hero)); playing = false; updatePlayback(); }));
    on('slidePause', 'click', () => { playing = !playing; updatePlayback(); });
    document.addEventListener('visibilitychange', restartSlides);
    setSlide(0);
  };

  const initProductFilter = () => {
    const products = [...document.querySelectorAll('.product-card')];
    if (!products.length) return;
    document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      products.forEach((card, index) => card.hidden = filter !== 'all' && Number(filter) !== index);
      document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', item === button); });
      setText('filterStatus', `${filter === 'all' ? 3 : 1}개의 카드가 표시됩니다.`);
    }));
  };

  const initLoginTabs = () => {
    if (!$('idLoginTab')) return;
    on('idLoginTab', 'click', () => activateLogin(false));
    on('simpleLoginTab', 'click', () => activateLogin(true));
    document.querySelectorAll('a[href="#myPanel"]').forEach(link => link.addEventListener('click', () => activateLogin(false)));
  };

  const initTabKeys = () => document.querySelectorAll('[role="tablist"]').forEach(list => list.addEventListener('keydown', event => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  }));

  const initInPageLinks = () => document.querySelectorAll('a[href="#"]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const text = link.textContent.replace(/[〉↗›]/g, '').trim();
    if (text === '검색') { openSearch(); return; }
    if (text === '전체 카드') { document.querySelector('[data-filter="all"]').click(); $('cards').scrollIntoView({ behavior: 'smooth' }); return; }
    if (text === '금융상품 전체 보기' || text === '전체 서비스 보기') { $(text === '금융상품 전체 보기' ? 'finance' : 'life').scrollIntoView({ behavior: 'smooth' }); return; }
    const article = link.closest('.product-card, .finance-card, .life-card');
    showInfo(article ? article.querySelector('h3').textContent : text);
  }));

  const initNotices = () => document.querySelectorAll('.notice-list li').forEach((item, index) => {
    const span = item.querySelector('span');
    if (!span) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = span.textContent;
    button.addEventListener('click', () => {
      const title = button.textContent;
      infoCopy[title] = index === 0
        ? ['해온카드 서비스 이용 안내', '마이페이지에서 보유 카드의 이용한도와 결제 승인 내역을 확인할 수 있습니다.', '카드 이용과 관련한 문의는 고객센터를 이용해 주세요.']
        : index === 1
          ? ['안전한 카드 이용을 위한 보안 안내', '해온카드는 비밀번호를 문자·전화로 묻지 않습니다. 출처가 불분명한 링크에 로그인 정보를 입력하지 마세요.', '이용한도와 이용내역은 로그인한 회원의 카드로만 조회됩니다.']
          : ['시스템 점검 일정 안내', '점검 중에는 조회 서비스 이용이 잠시 제한될 수 있습니다.'];
      showInfo(title);
    });
    span.replaceWith(button);
  });

  const initGnb = () => document.querySelectorAll('.gnb a').forEach(link => link.addEventListener('click', () => {
    if (link.getAttribute('href') !== '#') return;
    document.querySelectorAll('.gnb a').forEach(item => item.classList.toggle('active', item === link));
  }));

  initHero();
  initProductFilter();
  initLoginTabs();
  initTabKeys();
  initInPageLinks();
  initNotices();
  initGnb();

  showLoggedOut();
  restoreSession();
})();
