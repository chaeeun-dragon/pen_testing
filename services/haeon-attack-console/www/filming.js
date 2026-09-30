(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const set = (id, value) => { $(id).textContent = value ?? '—'; };
  const money = value => Number(value).toLocaleString('ko-KR') + '원';
  const names = {RUNNING:'진행 중',ALERT:'ALERT · 탐지',CONTAINED:'CONTAINED · 격리',BLOCKED:'BLOCKED · 차단',COMPLETED:'완료',ERROR:'오류 · 확인 필요'};
  const labels = {SUCCESS:'성공',BLOCKED:'차단',ALERT:'관측',SKIPPED:'미실행',ERROR:'오류',RUNNING:'진행 중'};
  let overview = {}, selected = '', beforeRun = null, busy = false, loading = false, connected = false;
  let currentView = 'diag', scenario = 'diag', historyKey = '';
  const readOnly = new URLSearchParams(location.search).get('view') === 'results';
  if (readOnly) document.body.classList.add('results-only');
  const stage = (run, label) => run?.stages?.find(s => s.label === label);
  async function api(path, body) {
    const response = await fetch(path, {cache:'no-store', ...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const value = await response.json();
    if (!response.ok) throw new Error(value.message || value.errorCode || 'HTTP ' + response.status);
    return value;
  }
  function controls() {
    const active = busy || !connected || (overview.runs || []).some(r => r.status === 'RUNNING');
    const pending = overview.pendingResponseRunId;
    ['baseline','reset'].forEach(id => $(id).disabled = active || readOnly);
    ['before','after','cardRun'].forEach(id => $(id).disabled = active || Boolean(pending) || readOnly);
    const latestBefore = (overview.runs || []).find(r => r.mode === 'before');
    $('after').disabled = $('after').disabled || !beforeRun?.containmentVerified || latestBefore?.runId !== beforeRun?.runId;
    $('respond').disabled = active || readOnly || !beforeRun || selected !== beforeRun.runId || beforeRun.mode !== 'before' ||
      !(pending === beforeRun.runId || (beforeRun.status === 'CONTAINED' && !beforeRun.containmentVerified));
    const running = (overview.runs || []).find(r => r.status === 'RUNNING');
    for (const mode of ['baseline','before','after']) {
      set(mode+'ActionState', running?.mode === mode ? '진행 중' : $(mode).disabled ? '잠김' : '실행 가능');
    }
    set('respondActionState', !beforeRun ? '대응 대기' : beforeRun.containmentVerified ? '격리 검증 완료' : $('respond').disabled ? '실행 선택 필요' : '대응 가능');
    set('executionHint', !connected ? '연결 상태를 확인하는 중입니다. 갱신 완료 후 실행할 수 있습니다.' : busy || running ? '실행 중입니다. 실제 단계 기록이 완료될 때까지 기다려 주세요.' : pending ? 'Before 실행의 대응이 필요합니다. 해당 Before를 선택한 뒤 대응을 실행하세요.' : beforeRun?.containmentVerified ? '기존 세션 재접근 거부를 확인했습니다. After에서 새 입력 차단과 정상 진단을 검증하세요.' : '정상 진단 → Before → 대응 → After 순서로 실행하세요.');
    set('cardHint', !connected ? '연결 확인 후 실행할 수 있습니다.' : busy || running ? '다른 실행이 끝난 뒤 시작할 수 있습니다.' : pending ? '진단 API Before 대응을 먼저 완료하세요.' : '별도 합성 장부에서 Before와 After를 순서대로 실행합니다.');
    $('cardRun').textContent = busy && currentView === 'card' ? '검증 진행 중…' : '동시 승인 비교 실행';
    $('refresh').disabled = loading;
  }
  function steps(id, run) {
    const signature = JSON.stringify(run?.stages || []);
    if ($(id).dataset.signature === signature) return;
    $(id).dataset.signature = signature;
    $(id).replaceChildren();
    (run?.stages || []).forEach(s => {
      const row = document.createElement('li');
      row.className = 'event-row'; row.dataset.result = s.status;
      const mark = document.createElement('span'); mark.className = 'event-pin';
      mark.textContent = ({SUCCESS:'✓',ALERT:'!',BLOCKED:'⊘',ERROR:'×',SKIPPED:'—'})[s.status] || '·';
      const copy = document.createElement('div'); copy.className = 'event-copy';
      const title = document.createElement('strong'); title.textContent = s.label;
      const detail = document.createElement('small');
      detail.textContent = [labels[s.status] || s.status, s.detail?.httpStatus ? `HTTP ${s.detail.httpStatus}` : '', s.detail?.errorCode,
        s.detail?.recordCount != null ? `${s.detail.recordCount}건` : '', s.detail?.receiverStatus].filter(Boolean).join(' · ');
      copy.append(title, detail); row.append(mark, copy);
      $(id).append(row);
    });
  }
  function render(before, after, baseline) {
    beforeRun = before;
    set('beforeStatus', names[before?.status] || '미실행');
    set('afterStatus', names[after?.status] || '미실행');
    const unknown = before ? (before.status === 'RUNNING' ? '진행 중' : '확인 불가') : '미실행';
    const input = stage(before, '진단 요청 전송');
    const query = stage(before, '합성 지원 자료 조회');
    const receipt = stage(before, '내부 수신기로 전송');
    set('bInput', input?.detail?.httpStatus === 200 ? 'HTTP 200 · 취약 경로 도달' : unknown);
    set('bSession', stage(before, '제한된 모의 웹 세션 생성')?.status === 'ALERT' ? '제한된 세션 생성' : unknown);
    set('bRecords', query?.detail?.recordCount != null ? `${query.detail.recordCount}건 조회` : unknown);
    set('metricRecords', query?.detail?.recordCount != null ? `${query.detail.recordCount}건` : unknown);
    set('activityRunId', before?.runId || '선택된 실행 없음');
    $('activityRunId').title = before?.runId || '';
    set('activityStageCount', `${before?.stages?.length || 0} / ${after?.stages?.length || 0}개`);
    set('bReceiver', receipt?.detail?.receiverStatus === 'RECEIVED' ? `${receipt.detail.recordCount}건 · RECEIVED` : unknown);
    const blocked = stage(after, '비정상 진단 입력 탐지·차단')?.status === 'BLOCKED';
    set('aInput', blocked ? 'HTTP 403 · 입력 허용 목록' : after ? (after.status === 'RUNNING' ? '검증 중' : '확인 불가') : '미실행');
    set('aSession', blocked ? '미생성 · 선행 차단' : '미실행');
    set('aRecords', blocked ? '미실행 · 선행 차단' : '미실행');
    set('aReceiver', blocked ? '미실행 · 선행 차단' : '미실행');
    const baseOk = baseline?.status === 'COMPLETED';
    set('bNormal', baseOk ? 'HTTP 200 · 정상 연결' : '연결된 기준선 없음');
    set('baselineState', baseOk ? '기준선: 정상 진단 성공' : '정상 기준선 미실행');
    const normalAfter = stage(after, 'After 정상 진단 재검증');
    set('aNormal', normalAfter?.status === 'SUCCESS' ? 'HTTP 200 · 정상 기능 유지' : normalAfter ? '검증 실패' : '미실행');
    for (const [id, label] of [['retryRead','이전 세션 재조회 거부 검증'],['retrySend','이전 세션 재전송 거부 검증']]) {
      const s = stage(before, label);
      set(id, s?.status === 'BLOCKED' ? 'HTTP 403 · 폐기 확인' : s ? '검증 실패' : '미검증');
    }
    const notice = stage(before, '실행 세션 폐기 및 회원 보호 안내 등록');
    set('notice', notice ? notice.detail?.protectionNoticeCreated ? '영향 회원 1명 · 안내 등록' : '안내 대상 없음' : '미등록');
    set('beforeId', before?.runId); set('afterId', after?.runId);
    set('transferId', receipt?.detail?.transferId); set('sha', receipt?.detail?.payloadSha256);
    steps('beforeSteps', before); steps('afterSteps', after);
  }
  function renderCard(run) {
    if (!run) {
      set('cardStatus','미실행');
      ['Before','After'].forEach(name => { set(`card${name}Total`,'—'); $(`card${name}Rows`).replaceChildren(); });
      set('cardBeforeNote','두 트랜잭션의 읽기 시점을 맞춰 경쟁 조건을 재현합니다.');
      set('cardAfterNote','행 잠금 이후 최신 사용액으로 다시 판정합니다.');
      ['cardNormal','cardRetry','cardConflict'].forEach(id => set(id,'미검증'));
      set('cardId','실행 ID: —');
      return;
    }
    set('cardStatus', run.verified ? '검증 완료' : '오류 · 근거 확인 필요');
    for (const [name, value] of [['Before',run.before],['After',run.after]]) {
      set(`card${name}Total`, `${value.approvedCount}건 승인 / ${money(value.approvedAmount)}`);
      set(`card${name}Note`, `실험 장부 사용액 ${money(value.usedAmount)} · 잔여 ${money(value.limitAmount - value.usedAmount)}`);
      $(`card${name}Rows`).replaceChildren();
      value.attempts.forEach(attempt => {
        const row = document.createElement('tr');
        [attempt.requestId, money(attempt.observedRemaining), attempt.result === 'APPROVED' ? '승인' : '한도 초과 거절'].forEach(text => {
          const td = document.createElement('td'); td.textContent = text; td.dataset.result = attempt.result; row.append(td);
        });
        $(`card${name}Rows`).append(row);
      });
    }
    set('cardNormal', run.regression.normalApproval === 'APPROVED' ? '승인' : '실패');
    set('cardRetry', run.regression.retry.idempotentReplay ? '최초 결과 재사용' : '실패');
    set('cardConflict', run.regression.keyConflict === 'KEY_CONFLICT' && run.regression.overLimit === 'DECLINED' ? '모두 거절' : '실패');
    set('cardId', `실행 ID: ${run.comparisonId} / ${new Date(run.createdAt).toLocaleString('ko-KR')}`);
  }
  function showView(view) {
    currentView = view;
    if (view !== 'history') scenario = view;
    for (const name of ['diag','card','history']) $(name+'Panel').hidden = name !== view;
    ['diag','card'].forEach(name => $(name+'Tab').classList.toggle('active', name === scenario));
    $('overviewTab').classList.toggle('active', view !== 'history');
    $('historyTab').classList.toggle('active', view === 'history');
    set('topCrumb', view === 'history' ? '실행 이력' : readOnly ? '결과 전용 화면' : view === 'card' ? 'CARD-03 동시 승인' : '시나리오 실행');
  }
  function renderHistory(runs) {
    set('runCount', String(runs.length).padStart(2,'0')); set('historyCount', runs.length+' RUNS');
    const signature = JSON.stringify(runs);
    if (historyKey === signature) return;
    historyKey = signature; $('historyList').replaceChildren();
    if (!runs.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '아직 실행 기록이 없습니다.'; $('historyList').append(empty); return; }
    for (const run of runs) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'history-item';
      const name = document.createElement('span'); name.className = 'history-name';
      const id = document.createElement('strong'); id.textContent = run.runId;
      const mode = document.createElement('small'); mode.textContent = ({baseline:'정상 진단',before:'Before 공격 흐름',after:'After 차단 검증'})[run.mode] || run.mode;
      name.append(id, mode);
      const date = document.createElement('span'); date.className = 'history-time'; date.textContent = new Date(run.createdAt).toLocaleString('ko-KR');
      const status = document.createElement('span'); status.className = 'status-pill '+run.status; status.textContent = names[run.status] || run.status;
      const arrow = document.createElement('span'); arrow.className = 'history-open'; arrow.textContent = '↗';
      row.append(name, date, status, arrow);
      row.addEventListener('click', async () => {
        $('historyDetail').hidden = false; set('historyDetailId', run.runId); $('historySteps').replaceChildren(); delete $('historySteps').dataset.signature;
        try { const data = await api('/api/runs/'+encodeURIComponent(run.runId));
          if ($('historyDetailId').textContent !== run.runId) return;
          steps('historySteps',data.run); if (data.upstreamError) showError(data.upstreamError);
        } catch(e) { showError(e.message); }
      });
      $('historyList').append(row);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      overview = await api('/api/overview');
      const runs = overview.runs || [];
      renderHistory(runs);
      const befores = runs.filter(r => r.mode === 'before');
      if (!befores.some(r => r.runId === selected)) selected = befores[0]?.runId || '';
      const selector = $('runSelect');
      const options = befores.map(r => r.runId).join('|');
      if (selector.dataset.options !== options) {
        selector.replaceChildren();
        if (!befores.length) selector.add(new Option('실행 기록 없음', ''));
        befores.forEach(r => selector.add(new Option(r.runId, r.runId)));
        selector.dataset.options = options;
      }
      selector.value = selected;
      const before = befores.find(r => r.runId === selected);
      const after = runs.find(r => r.mode === 'after' && r.beforeRunId === selected && selected);
      const baseline = before ? runs.find(r => r.runId === before.baselineRunId) : runs.find(r => r.mode === 'baseline');
      const [b,a,card] = await Promise.all([before ? api('/api/runs/' + before.runId) : null,after ? api('/api/runs/' + after.runId) : null,api('/api/card03')]);
      render(b?.run, a?.run, baseline);
      renderCard(card.runs?.[0]);
      set('connection', overview.targetConnected ? '● 지원 서비스 연결됨' : '지원 서비스 연결 실패');
      $('connection').classList.toggle('offline', !overview.targetConnected);
      set('targetReadiness', overview.targetConnected ? '사용 가능' : '연결 확인 필요');
      set('engineSummary', overview.targetConnected ? '지원 서비스 응답 확인' : '대상 연결 상태 확인 필요');
      set('updated', '갱신 ' + new Date().toLocaleTimeString('ko-KR'));
      if (b?.upstreamError || a?.upstreamError) throw new Error('상세 근거 갱신 실패 · 이전 결과가 표시될 수 있습니다.');
      connected = Boolean(overview.targetConnected);
    } catch (e) { connected = false; set('connection','연결/갱신 확인 필요'); $('connection').classList.add('offline'); showError(e.message); }
    finally { loading = false; controls(); }
  }
  function showError(message) { set('error', message); $('error').hidden = false; }
  async function action(path, body) {
    if (busy || readOnly) return;
    busy = true; controls(); $('error').hidden = true;
    try {
      const result = await api(path, body);
      if (body?.mode === 'before' && result.runId) selected = result.runId;
      if (result.comparisonId) renderCard(result);
      await refresh();
    } catch (e) { showError(e.message); }
    finally { busy = false; controls(); }
  }
  ['baseline','before','after'].forEach(mode => $(mode).addEventListener('click', () => action('/api/runs',{mode})));
  $('respond').addEventListener('click', () => beforeRun && action('/api/runs/' + beforeRun.runId + '/respond', {}));
  $('cardRun').addEventListener('click', () => action('/api/card03/compare', {}));
  $('runSelect').addEventListener('change', e => { selected = e.target.value; controls(); refresh(); });
  for (const tab of ['diag','card']) $(tab+'Tab').addEventListener('click', () => showView(tab));
  $('overviewTab').addEventListener('click', () => showView(scenario));
  $('historyTab').addEventListener('click', () => { showView('history'); refresh(); });
  $('refresh').addEventListener('click', () => { $('error').hidden = true; refresh(); });
  for (const tab of ['before','after']) $(tab+'LogTab').addEventListener('click', () => {
    for (const name of ['before','after']) { $(name+'Steps').hidden = name !== tab; $(name+'LogTab').classList.toggle('active', name === tab); }
  });
  $('reset').addEventListener('click', () => { if (!busy && !readOnly) $('resetDialog').showModal(); });
  $('cancelReset').addEventListener('click', () => $('resetDialog').close());
  $('confirmReset').addEventListener('click', async () => {
    if (busy || readOnly) return;
    busy = true; controls(); $('confirmReset').disabled = true; $('cancelReset').disabled = true;
    try { await api('/api/demo/reset', {confirmation:'RESET_HAEON_DEMO'}); location.reload(); }
    catch(e) { $('resetDialog').close(); showError(e.message); }
    finally { busy = false; $('confirmReset').disabled = false; $('cancelReset').disabled = false; controls(); }
  });
  $('resetDialog').addEventListener('cancel', e => { if(busy) e.preventDefault(); });
  const tick = () => set('clock',new Date().toLocaleTimeString('ko-KR'));
  showView('diag'); controls(); tick(); setInterval(tick,1000);
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 2000);
})();
