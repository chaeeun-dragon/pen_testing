
    (() => {
      const $ = (id) => document.getElementById(id);
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
        $('heroOverline').textContent = slide.overline; $('heroTitle').innerHTML = slide.title;
        $('heroText').innerHTML = slide.text; $('heroCardName').textContent = slide.card;
        $('slideCount').textContent = `0${index + 1} / 03`;
        $('heroPanel').style.background = ['#e6f2ec', '#f4efdf', '#e8eff5'][index];
        $('heroPanel').setAttribute('aria-labelledby', `heroTab${index}`);
        document.querySelector('.hero-card-art').style.background = ['linear-gradient(150deg,#164e45,#0d7060 65%,#83af7d)', 'linear-gradient(135deg,#9a8959,#c2ac73)', 'linear-gradient(135deg,#434d66,#77879b)'][index];
        document.querySelectorAll('[data-slide]').forEach((button, i) => {button.classList.toggle('active', i === index); button.setAttribute('aria-pressed', i === index);});
        document.querySelectorAll('[data-hero]').forEach((button, i) => {button.classList.toggle('active', i === index); button.setAttribute('aria-selected', i === index); button.tabIndex = i === index ? 0 : -1;});
      };
      const restartSlides = () => {clearInterval(slideTimer); if (playing && !document.hidden) slideTimer = setInterval(() => setSlide((slideIndex + 1) % heroSlides.length), 6000);};
      const updatePlayback = () => { $('slidePause').textContent = playing ? 'Ⅱ' : '▶'; $('slidePause').setAttribute('aria-label', playing ? '배너 자동 재생 정지' : '배너 자동 재생 시작'); $('slidePause').setAttribute('aria-pressed', playing); restartSlides(); };
      document.querySelectorAll('[data-slide], [data-hero]').forEach(button => button.addEventListener('click', () => {setSlide(Number(button.dataset.slide ?? button.dataset.hero)); playing = false; updatePlayback();}));
      $('slidePause').addEventListener('click', () => {playing = !playing; updatePlayback();});
      document.addEventListener('visibilitychange', restartSlides);
      setSlide(0);

      const modal = $('paymentModal'); const form = $('paymentForm'); const submitButton = $('paymentSubmit'); const replayButton = $('paymentReplay'); const result = $('modalResult'); const resultEmptyText = $('resultEmptyText'); const resultState = $('resultState'); let lastRequest = null;
      const makeId = (prefix) => {
        const suffix = globalThis.crypto?.randomUUID
          ? crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
        return `${prefix}-${suffix}`;
      }; const money = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;
      const seedOrder = () => { $('paymentOrder').value = makeId('BW-ORDER'); };
      let paymentOpener;
      const setModalIsolation = (active) => document.querySelectorAll('body > *:not(#paymentModal)').forEach(element => {
        element.inert = active;
        if (active) element.setAttribute('aria-hidden', 'true');
        else element.removeAttribute('aria-hidden');
      });
      const resetPaymentResult = () => {
        lastRequest = null; replayButton.disabled = true; result.className = 'modal-result empty';
        resultEmptyText.hidden = false; resultState.className = 'result-state';
        ['outOrder', 'outAmount', 'outPgTid', 'outAuth', 'outCorrelation', 'outReason'].forEach(id => $(id).textContent = '-');
        $('resultPill').className = 'result-pill'; $('resultPill').textContent = '';
        $('resultTitle').textContent = '-'; $('resultSubtitle').textContent = '-'; $('resultError').textContent = '';
      };
      const openModal = (event) => { if (event) event.preventDefault(); paymentOpener = document.activeElement; resetPaymentResult(); seedOrder(); modal.classList.add('show'); document.body.style.overflow = 'hidden'; setModalIsolation(true); $('paymentOrder').focus(); };
      const closeModal = () => {modal.classList.remove('show'); document.body.style.overflow = ''; setModalIsolation(false); paymentOpener?.focus();};
      $('paymentOpen').addEventListener('click', openModal); $('modalClose').addEventListener('click', closeModal); modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('show')) closeModal(); });
      const showResult = (kind, title, subtitle, data = {}) => { result.className = 'modal-result'; resultEmptyText.hidden = true; resultState.className = 'result-state show'; const pill = $('resultPill'); pill.className = `result-pill ${kind}`; pill.textContent = kind === 'approved' ? '승인 완료' : kind === 'declined' ? '승인 거절' : '확인 필요'; $('resultTitle').textContent = title; $('resultSubtitle').textContent = subtitle; $('outOrder').textContent = data.orderNo || '-'; $('outAmount').textContent = data.approvedAmount != null ? money(data.approvedAmount) : (data.amount != null ? money(data.amount) : '-'); $('outPgTid').textContent = data.pgTid || '-'; $('outAuth').textContent = data.authorizationNo || '-'; $('outCorrelation').textContent = data.correlationId || '-'; $('outReason').textContent = data.reasonCode || data.errorCode || '-'; $('resultError').textContent = data.message || ''; };
      const callPayment = async (request) => { const response = await fetch('/api/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': request.correlationId, 'Idempotency-Key': request.merchantRequestId }, body: JSON.stringify(request) }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.message || `요청이 실패했습니다 (${response.status})`); error.body = body; throw error; } return body; };
      const sendPayment = async (request, replay = false) => { submitButton.disabled = true; replayButton.disabled = true; form.setAttribute('aria-busy', 'true'); submitButton.textContent = replay ? '재조회 중…' : '승인 요청 중…'; try { const body = await callPayment(request); lastRequest = request; showResult(body.decision === 'APPROVED' ? 'approved' : 'declined', body.decision === 'APPROVED' ? '결제가 승인되었습니다.' : '결제가 거절되었습니다.', replay ? '동일 요청의 기존 결과를 반환했습니다.' : '북웨이브 결제 요청이 정상 처리되었습니다.', body); replayButton.disabled = false; } catch (error) { showResult('error', '승인 결과를 확인하지 못했습니다.', '잠시 후 다시 시도해 주세요.', {...(error.body || {}), orderNo: request.orderNo, amount: request.amount, correlationId: error.body?.correlationId || request.correlationId}); } finally { form.removeAttribute('aria-busy'); submitButton.disabled = false; submitButton.textContent = '결제 승인 요청'; } };
      form.addEventListener('submit', (event) => { event.preventDefault(); const request = { correlationId: makeId('BW-FLOW'), orderNo: $('paymentOrder').value.trim(), merchantRequestId: makeId('BW-REQ'), amount: Number($('paymentAmount').value), currency: 'KRW', paymentMethodToken: $('paymentToken').value.trim() }; sendPayment(request); }); replayButton.addEventListener('click', () => { if (lastRequest) sendPayment(lastRequest, true); });
      const focusMy = (event) => { if (event) event.preventDefault(); $('myPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => { const target = $('myLoginView').hidden ? $('myPageLink') : $('loginId'); if (target) target.focus(); }, 320); };
      const setLoggedIn = (loggedIn, profile = {}) => { $('myLoginView').hidden = loggedIn; $('myAccountView').hidden = !loggedIn; $('headerLogin').textContent = loggedIn ? '로그아웃' : '로그인'; if (profile.name) $('myGreeting').textContent = `${profile.name}님, 좋은 하루 되세요!`; if (profile.cardName) $('myCardName').textContent = profile.cardName; };
      window.haeonCardUi = { setLoggedIn };
      $('loginForm').addEventListener('submit', (event) => { event.preventDefault(); if (!$('loginId').value.trim() || !$('loginPassword').value.trim()) return; $('loginStatus').hidden = false; $('loginStatus').textContent = '로그인 서비스는 준비 중입니다. 현재 입력한 정보는 전송되지 않습니다.'; });
      $('myNav').addEventListener('click', focusMy); $('headerLogin').addEventListener('click', (event) => { if ($('myAccountView').hidden) focusMy(event); else setLoggedIn(false); }); $('myPageLink').addEventListener('click', focusMy); $('myPaymentButton').addEventListener('click', openModal);
      const infoDialog = $('infoDialog');
      const searchDialog = $('searchDialog');
      const infoCopy = {
        '해온 데일리': ['생활에 꼭 필요한 할인', '온라인 쇼핑 10% · 편의점·커피 5% · 대중교통 3%', '매일 사용하는 생활 영역의 혜택을 한 장에 담았습니다.'],
        '해온 플러스': ['쇼핑과 구독을 더 알뜰하게', '주요 쇼핑몰 10% · 외식·배달 5% · 모든 가맹점 2%', '자주 찾는 쇼핑과 일상 결제에 어울리는 카드입니다.'],
        '해온 트래블': ['여행의 시작부터 끝까지', '해외 결제 2% · 해외 수수료 0원 · 공항 라운지 무료', '여행과 해외 이용을 위한 혜택을 모았습니다.'],
        '이벤트 자세히 보기': ['9월 생활 캐시백 이벤트', '2026.09.01 ~ 2026.09.30', '생활 영역 결제 시 최대 10%, 최대 30,000원 캐시백을 소개하는 모의 이벤트입니다. 실제 응모나 캐시백 지급은 제공하지 않습니다.'],
        '장기카드대출': ['목돈이 필요할 때', '이용한도 최대 5,000만원', '금융상품 소개를 위한 모의 화면입니다. 실제 대출 조회·신청은 제공하지 않습니다.'],
        '단기카드대출': ['필요한 순간, 간편하게', '365일 이용 안내', '단기카드대출을 소개하는 모의 화면입니다. 실제 대출 조회·신청은 제공하지 않습니다.'],
        '일부결제금액이월': ['결제 비율을 선택하는 서비스', '일부결제금액이월약정 안내', '이월 금액에는 이자가 발생할 수 있습니다. 이 모의서비스에서는 약정이나 금융 거래를 진행하지 않습니다.'],
        '오토 금융': ['새로운 출발을 위한 자동차 금융', '온라인 이용 안내', '자동차 금융 소개 화면입니다. 실제 견적과 신청 기능은 준비 중입니다.'],
        '자동납부': ['생활요금, 한 번에 관리하세요', '아파트관리비 · 전기요금 · 통신요금', '자동납부 신청 기능은 준비 중입니다. 실제 납부 수단은 변경되지 않습니다.'],
        '해외 안심 케어': ['해외에서도 안심하는 카드 생활', '해외 이용 알림 · 이용 관리 안내', '해외 이용 관리 서비스는 준비 중입니다.'],
        '해온 포인트': ['일상에서 쌓이는 즐거움', '포인트 조회 및 사용 안내', '포인트 조회는 회원 서비스 연결 후 이용할 수 있습니다.'],
        '자주 묻는 질문': ['자주 찾는 이용 안내', '이용내역은 어디서 확인하나요? → 상단 MY 메뉴에서 확인할 수 있습니다.', '결제 승인 결과는 어떻게 확인하나요? → 빠른 메뉴의 즉시결제에서 연동 조회 화면을 열 수 있습니다. 로그인 서비스는 현재 준비 중입니다.'],
        '카드 분실·도난 신고': ['분실·도난 신고 안내', '현재는 신고 절차를 소개하는 모의 화면입니다.', '실제 카드의 분실·도난은 해당 카드를 발급한 카드사의 공식 채널을 이용해 주세요.'],
        '상담 및 문의': ['해온카드 이용 안내', '고객 상담 서비스는 준비 중입니다.', '팀 프로젝트 담당자에게 모의서비스 이용과 관련한 사항을 문의해 주세요.'],
        '개인정보처리방침': ['모의서비스 개인정보 안내', '실제 개인정보를 입력하지 마세요.', '현재 로그인 폼은 인증 서버로 입력 정보를 전송하지 않습니다. 결제 연동에는 합성 데이터만 사용합니다.']
      };
      const showInfo = title => {
        $('infoTitle').textContent = title;
        $('infoBody').replaceChildren();
        const tag = document.createElement('span'); tag.className = 'dialog-tag'; tag.textContent = 'HAEON CARD'; $('infoBody').append(tag);
        (infoCopy[title] || [title + ' 안내', '해당 서비스는 준비 중입니다. 서비스가 연결되면 이곳에서 이용할 수 있습니다.']).forEach(text => {const p = document.createElement('p'); p.textContent = text; $('infoBody').append(p);});
        if (title.startsWith('해온 ') && ['해온 데일리','해온 플러스','해온 트래블'].includes(title)) {
          const note = document.createElement('p'); note.textContent = '모의 카드 상품입니다. 표시된 혜택은 프로젝트 예시이며 실제 발급·신청은 제공하지 않습니다.'; $('infoBody').append(note);
        }
        infoDialog.showModal();
      };
      document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
      [infoDialog, searchDialog].forEach(dialog => dialog.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault(); dialog.close();}}));
      [infoDialog, searchDialog].forEach(dialog => {dialog.addEventListener('click', event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();}});});
      document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => showInfo(button.dataset.info)));
      const products = [...document.querySelectorAll('.product-card')];
      document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
        const filter = button.dataset.filter;
        products.forEach((card, index) => card.hidden = filter !== 'all' && Number(filter) !== index);
        document.querySelectorAll('[data-filter]').forEach(item => {item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', item === button);});
        $('filterStatus').textContent = `${filter === 'all' ? 3 : 1}개의 카드가 표시됩니다.`;
      }));
      const activateLogin = simple => {
        $('loginForm').hidden = simple; $('simpleLoginPanel').hidden = !simple;
        [$('idLoginTab'), $('simpleLoginTab')].forEach((tab, index) => {const selected = simple === Boolean(index); tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', selected); tab.tabIndex = selected ? 0 : -1;});
      };
      $('idLoginTab').addEventListener('click', () => activateLogin(false));
      $('simpleLoginTab').addEventListener('click', () => activateLogin(true));
      document.querySelectorAll('[role="tablist"]').forEach(list => list.addEventListener('keydown', event => {
        const tabs = [...list.querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(document.activeElement);
        if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].click(); tabs[next].focus();
      }));
      document.querySelectorAll('a[href="#myPanel"]').forEach(link => link.addEventListener('click', () => activateLogin(false)));
      $('headerLogin').addEventListener('click', () => activateLogin(false));
      const menuItems = [
        ['나의 카드 · 이용내역', '#myPanel', 'MY'], ['결제예정금액 · 이용가능한도', '#myPanel', 'MY'],
        ['해온 데일리 · 생활·교통', '#cards', '카드'], ['해온 플러스 · 쇼핑·구독', '#cards', '카드'], ['해온 트래블 · 여행·해외', '#cards', '카드'],
        ['이벤트 · 캐시백 혜택', '#benefit', '혜택'], ['장기·단기카드대출 · 리볼빙', '#finance', '금융'],
        ['자동납부 · 해외 안심 케어 · 포인트', '#life', '라이프'], ['공지사항 · 분실 신고 · 고객센터', '#notice', '고객센터']
      ];
      const renderSearch = () => {
        const term = $('siteSearch').value.trim().toLowerCase(); const matches = menuItems.filter(item => item.join(' ').toLowerCase().includes(term));
        $('searchResults').replaceChildren();
        matches.forEach(([label, href, group]) => {
          const link = document.createElement('a'); link.href = href;
          const text = document.createElement('span'); text.textContent = label;
          const small = document.createElement('small'); small.textContent = group + '  ›'; link.append(text, small);
          link.addEventListener('click', event => {event.preventDefault(); searchDialog.close(); if(href === '#cards') document.querySelector('[data-filter="all"]').click(); if(href === '#myPanel') activateLogin(false); const target = document.querySelector(href); target.setAttribute('tabindex','-1'); target.focus({preventScroll:true}); target.scrollIntoView({behavior:'smooth',block:'start'});});
          $('searchResults').append(link);
        });
        $('searchStatus').textContent = `${matches.length}개의 검색 결과`;
        if (!matches.length) {const p = document.createElement('p'); p.className = 'empty-search'; p.textContent = '검색 결과가 없습니다. 카드, 금융, 포인트 등 다른 검색어를 입력해 주세요.'; $('searchResults').append(p);}
      };
      const openSearch = () => {$('siteSearch').value = ''; renderSearch(); searchDialog.showModal(); $('siteSearch').focus();};
      $('searchButton').addEventListener('click', openSearch); $('siteSearch').addEventListener('input', renderSearch);
      document.querySelectorAll('a[href="#"]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault();
        if (link.id === 'myPageLink') return;
        const text = link.textContent.replace(/[〉↗›]/g,'').trim();
        if (text === '검색') {openSearch(); return;}
        if (text === '전체 카드') {document.querySelector('[data-filter="all"]').click(); $('cards').scrollIntoView({behavior:'smooth'}); return;}
        if (text === '금융상품 전체 보기' || text === '전체 서비스 보기') {$(text === '금융상품 전체 보기' ? 'finance' : 'life').scrollIntoView({behavior:'smooth'}); return;}
        const article = link.closest('.product-card, .finance-card, .life-card');
        showInfo(article ? article.querySelector('h3').textContent : text);
      }));
      document.querySelectorAll('.notice-list li').forEach((item, index) => {const span = item.querySelector('span'); if (!span) return; const button = document.createElement('button'); button.type = 'button'; button.textContent = span.textContent; button.addEventListener('click', () => {const title = button.textContent; infoCopy[title] = index === 0 ? ['해온카드 모의서비스 이용 안내', '이 사이트는 팀 프로젝트용 가상 카드사입니다. 합성 데이터로 기능을 확인해 주세요.'] : index === 1 ? ['안전한 카드 이용 안내', '실제 개인정보나 카드번호를 입력하지 말고 프로젝트용 합성 데이터를 이용해 주세요.'] : ['시스템 점검 안내', '개발 및 점검 중에는 서비스 이용이 일시적으로 제한될 수 있습니다.']; showInfo(title);}); span.replaceWith(button);});
      document.querySelectorAll('.my-actions button:not(#myPaymentButton)').forEach(button => button.addEventListener('click', () => showInfo(button.textContent)));
      document.querySelectorAll('.gnb a').forEach(link => link.addEventListener('click', () => {document.querySelectorAll('.gnb a').forEach(item => item.classList.toggle('active', item === link));}));
      document.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || !modal.classList.contains('show')) return;
        const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')]; const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      });

      seedOrder();
    })();
