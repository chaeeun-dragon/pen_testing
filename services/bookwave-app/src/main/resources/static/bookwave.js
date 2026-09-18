/*
 * 북웨이브 가맹점 화면 — 연동 확인용 임시 자리채움(stand-in)입니다.
 *
 * 해온카드 쪽에서 "결제를 시작하는 가맹점 화면"이 필요해 만든 임시 화면입니다.
 * 도서 목록·가격·베스트셀러는 전부 지어낸 표시용 값이고, 북웨이브 담당자의 실제
 * 화면이 들어오면 이 디렉터리(index.html / bookwave.css / bookwave.js)를 통째로
 * 지우거나 덮어쓰면 됩니다. 백엔드(POST /api/v1/payments)와 해온카드 쪽 코드는
 * 이 파일들에 의존하지 않습니다.
 *
 * 교체할 때 지켜야 하는 연동 계약:
 *   docs/handoff/bookwave-merchant-integration-handoff-v0.1.md
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const money = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;
  const makeId = (prefix) => {
    const suffix = globalThis.crypto?.randomUUID
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    return `${prefix}-${suffix}`;
  };

  /* 해온카드 홈페이지는 카드사 쪽 포트에서 서비스한다. 호스트는 현재 접속 주소를 따른다. */
  const PORTAL_PORT = '8085';
  const portalUrl = (hash = '') => `${location.protocol}//${location.hostname}:${PORTAL_PORT}/${hash}`;
  $('haeonLink').href = portalUrl();
  $('haeonFooterLink').href = portalUrl();
  $('resultPortalLink').href = portalUrl('#mypage');

  const books = [
    { id: 'BW-1001', title: '느리게 읽는 밤', author: '정하윤', price: 16800, cover: 'linear-gradient(150deg,#23408e,#4a6ec9)', summary: '하루의 끝에서 천천히 문장을 따라가는 에세이.' },
    { id: 'BW-1002', title: '데이터의 바다', author: '김서준', price: 24000, cover: 'linear-gradient(150deg,#0d7060,#31a189)', summary: '흩어진 기록을 읽는 법을 다룬 입문서.' },
    { id: 'BW-1003', title: '도시의 계절', author: '이연우', price: 15200, cover: 'linear-gradient(150deg,#b3651a,#e29a3c)', summary: '골목마다 바뀌는 계절을 담은 산문집.' },
    { id: 'BW-1004', title: '작은 코드의 습관', author: '박도윤', price: 28500, cover: 'linear-gradient(150deg,#3a2f63,#6b5bab)', summary: '매일 조금씩 나아지는 개발 습관 안내서.' },
    { id: 'BW-1005', title: '바다를 건너는 일', author: '최유진', price: 18900, cover: 'linear-gradient(150deg,#1f5f7a,#3f95b5)', summary: '먼 길을 떠난 사람들의 이야기 모음.' },
    { id: 'BW-1006', title: '주말의 부엌', author: '한지아', price: 21000, cover: 'linear-gradient(150deg,#8c2f47,#c05c74)', summary: '주말 한 끼를 위한 조용한 레시피.' }
  ];

  const grid = $('bookGrid');
  books.forEach(book => {
    const card = el('article', 'book-card');
    const cover = el('div', 'book-cover', book.title.slice(0, 2));
    cover.style.background = book.cover;
    const foot = el('div', 'book-foot');
    const buy = el('button', 'buy-button', '구매하기');
    buy.type = 'button';
    buy.addEventListener('click', () => openOrder(book));
    foot.append(el('span', 'book-price', money(book.price)), buy);
    card.append(cover, el('h3', null, book.title), el('p', 'author', book.author),
      el('p', 'summary', book.summary), foot);
    grid.append(card);
  });
  $('bookCount').textContent = `총 ${books.length}종`;

  const rankList = $('rankList');
  [...books].sort((a, b) => b.price - a.price).slice(0, 4).forEach(book => {
    const item = document.createElement('li');
    item.append(el('strong', null, book.title), el('span', null, `${book.author} · ${money(book.price)}`));
    rankList.append(item);
  });

  /* ------------------------------------------------------------------- 주문서 */
  const modal = $('orderModal');
  const form = $('orderForm');
  const submitButton = $('orderSubmit');
  const replayButton = $('orderReplay');
  const result = $('modalResult');
  const resultEmptyText = $('resultEmptyText');
  const resultState = $('resultState');
  let lastRequest = null;
  let selectedBook = null;
  let modalOpener = null;

  const setModalIsolation = (active) => document.querySelectorAll('body > *:not(#orderModal)').forEach(node => {
    node.inert = active;
    if (active) node.setAttribute('aria-hidden', 'true');
    else node.removeAttribute('aria-hidden');
  });

  const resetResult = () => {
    lastRequest = null;
    replayButton.disabled = true;
    result.className = 'modal-result empty';
    resultEmptyText.hidden = false;
    resultState.className = 'result-state';
    ['outOrder', 'outAmount', 'outPgTid', 'outAuth', 'outCorrelation', 'outReason']
      .forEach(id => { $(id).textContent = '-'; });
    $('resultPill').className = 'result-pill';
    $('resultPill').textContent = '';
    $('resultTitle').textContent = '-';
    $('resultSubtitle').textContent = '-';
    $('resultError').textContent = '';
  };

  function openOrder(book) {
    selectedBook = book;
    modalOpener = document.activeElement;
    resetResult();
    $('orderBook').value = `${book.title} · ${book.author}`;
    $('orderNo').value = makeId('BW-ORDER');
    $('orderAmount').value = book.price;
    $('orderModalSubtitle').textContent = `${book.title} 주문 내용을 확인하고 결제해 주세요.`;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    setModalIsolation(true);
    $('orderAmount').focus();
  }

  const closeOrder = () => {
    modal.classList.remove('show');
    document.body.style.overflow = '';
    setModalIsolation(false);
    modalOpener?.focus();
  };

  $('modalClose').addEventListener('click', closeOrder);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeOrder(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('show')) closeOrder();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !modal.classList.contains('show')) return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not([readonly]):not(:disabled), select, a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  const reasonText = {
    APPROVED: '정상 승인되었습니다.',
    LIMIT_EXCEEDED: '카드 이용한도를 초과했습니다.',
    CARD_BLOCKED: '현재 이용할 수 없는 카드입니다.'
  };

  const showResult = (kind, title, subtitle, data = {}) => {
    result.className = 'modal-result';
    resultEmptyText.hidden = true;
    resultState.className = 'result-state show';
    const pill = $('resultPill');
    pill.className = `result-pill ${kind}`;
    pill.textContent = kind === 'approved' ? '결제 승인' : kind === 'declined' ? '승인 거절' : '확인 필요';
    $('resultTitle').textContent = title;
    $('resultSubtitle').textContent = subtitle;
    $('outOrder').textContent = data.orderNo || '-';
    $('outAmount').textContent = data.approvedAmount == null ? '-' : money(data.approvedAmount);
    $('outPgTid').textContent = data.pgTid || '-';
    $('outAuth').textContent = data.authorizationNo || '-';
    $('outCorrelation').textContent = data.correlationId || '-';
    $('outReason').textContent = data.reasonCode || '-';
    $('resultError').textContent = data.errorMessage || '';
  };

  const callPayment = async (request) => {
    const response = await fetch('/api/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': request.correlationId,
        'Idempotency-Key': request.merchantRequestId
      },
      body: JSON.stringify(request)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || '결제 요청을 처리하지 못했습니다.');
      error.payload = body;
      throw error;
    }
    return body;
  };

  const orders = [];
  const renderOrders = () => {
    const list = $('orderList');
    list.replaceChildren();
    $('orderEmpty').hidden = orders.length > 0;
    orders.forEach(order => {
      const row = el('div', 'order-row');
      const main = el('div', 'order-main');
      main.append(el('strong', null, order.title),
        el('span', null, `${order.orderNo} · 승인번호 ${order.authorizationNo || '-'}`));
      row.append(main);
      row.append(el('span', `order-pill ${order.kind === 'approved' ? '' : order.kind}`.trim(),
        order.kind === 'approved' ? '결제 승인' : order.kind === 'declined' ? '승인 거절' : '확인 필요'));
      row.append(el('span', 'order-amount', money(order.amount)));
      list.append(row);
    });
  };

  /* 같은 주문을 재조회하면 결과가 같으므로 한 줄로 유지한다. */
  const recordOrder = (order) => {
    const index = orders.findIndex(item => item.orderNo === order.orderNo);
    if (index >= 0) orders.splice(index, 1);
    orders.unshift(order);
  };

  const sendPayment = async (request, replay = false) => {
    submitButton.disabled = true;
    replayButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submitButton.textContent = replay ? '재조회 중…' : '결제 중…';
    try {
      const body = await callPayment(request);
      lastRequest = request;
      const approved = body.decision === 'APPROVED';
      showResult(approved ? 'approved' : 'declined',
        approved ? '결제가 승인되었습니다.' : '결제가 거절되었습니다.',
        reasonText[body.reasonCode] || (approved ? '정상 승인되었습니다.' : '카드사에서 승인을 거절했습니다.'),
        body);
      recordOrder({
        title: selectedBook ? selectedBook.title : '주문',
        orderNo: body.orderNo,
        authorizationNo: body.authorizationNo,
        amount: approved ? body.approvedAmount : request.amount,
        kind: approved ? 'approved' : 'declined'
      });
      renderOrders();
      replayButton.disabled = false;
    } catch (error) {
      const payload = error.payload || {};
      showResult('error', '결제 결과를 확인해 주세요.',
        payload.retryable ? '잠시 후 같은 주문으로 다시 시도할 수 있습니다.' : '주문 내용을 확인한 뒤 다시 시도해 주세요.',
        { orderNo: request.orderNo, correlationId: request.correlationId,
          reasonCode: payload.errorCode, errorMessage: error.message });
      lastRequest = request;
      replayButton.disabled = false;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '결제하기';
      form.removeAttribute('aria-busy');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Number($('orderAmount').value);
    if (!Number.isInteger(amount) || amount < 1) {
      showResult('error', '결제 금액을 확인해 주세요.', '1원 이상의 정수 금액만 결제할 수 있습니다.', {});
      return;
    }
    sendPayment({
      correlationId: makeId('BW-FLOW'),
      orderNo: $('orderNo').value.trim(),
      merchantRequestId: makeId('BW-REQ'),
      amount,
      currency: 'KRW',
      paymentMethodToken: $('orderCard').value
    });
  });

  replayButton.addEventListener('click', () => { if (lastRequest) sendPayment(lastRequest, true); });

  renderOrders();
  document.querySelectorAll('.gnb a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.gnb a').forEach(item => item.classList.toggle('active', item === link));
  }));
})();
