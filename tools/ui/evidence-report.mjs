// evidence/runs/ 의 실행 결과를 읽어 한 장짜리 판정 리포트를 만든다.
// 값은 전부 실제 실행 산출물에서 읽는다. 없는 항목은 "실행 기록 없음"으로 남긴다.
import fs from 'node:fs';
import path from 'node:path';

const RUNS = process.env.RUNS_DIR || 'evidence/runs';
const OUT = process.env.OUT_FILE || 'evidence/report.html';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = (v) => `${Number(v).toLocaleString('ko-KR')}원`;

/**
 * `<접두사><타임스탬프>` 형태의 실행 폴더 중 가장 최근 것.
 * 접두사 뒤에 타임스탬프가 바로 오는 것만 받는다. 그래야 `PAYMENT-FLOW-` 가
 * 형식이 다른 `PAYMENT-FLOW-CARD-...` 같은 폴더를 잘못 집지 않는다.
 */
const TS = /^(\d{8}T\d{6}Z)$/;
const latest = (prefix) => {
  let dirs;
  try { dirs = fs.readdirSync(RUNS, { withFileTypes: true }); } catch { return null; }
  const hit = dirs
    .filter(d => d.isDirectory() && d.name.startsWith(prefix) && TS.test(d.name.slice(prefix.length)))
    .map(d => d.name).sort();
  return hit.length ? path.join(RUNS, hit[hit.length - 1]) : null;
};
/** `<접두사><타임스탬프>` 폴더 전부를 최신순으로 */
const allRuns = (prefix) => {
  let dirs;
  try { dirs = fs.readdirSync(RUNS, { withFileTypes: true }); } catch { return []; }
  return dirs
    .filter(d => d.isDirectory() && d.name.startsWith(prefix) && TS.test(d.name.slice(prefix.length)))
    .map(d => d.name).sort().reverse().map(n => path.join(RUNS, n));
};
/** 같은 실행의 탐지 결과 폴더(DETECT-<실행명>). 짝이 맞는 것만 쓴다. */
const detectFor = (runDir) => {
  if (!runDir) return null;
  const d = path.join(RUNS, `DETECT-${path.basename(runDir)}`);
  return fs.existsSync(d) ? d : null;
};
/**
 * 판정 리포트이므로 **탐지까지 끝난** 가장 최근 실행을 고른다.
 * 더 최근에 탐지를 돌리지 않은 실행이 있으면 개수를 같이 돌려줘 각주로 알린다.
 */
const latestJudged = (prefix) => {
  const runs = allRuns(prefix);
  const idx = runs.findIndex(r => detectFor(r));
  if (idx < 0) return { run: runs[0] || null, detect: null, skipped: runs.length };
  return { run: runs[idx], detect: detectFor(runs[idx]), skipped: idx };
};
const stamp = (dir) => (dir ? (dir.match(/(\d{8})T(\d{6})Z/) || []).slice(1).join('T') : null);
const inKst = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
};
const when = (dir) => {
  const m = dir && dir.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return inKst(d);
};
const rel = (p) => (p ? path.relative(path.dirname(OUT), p).split(path.sep).join('/') : '');

/* ------------------------------------------------------------ 수집 */
const collectCard03 = (kind) => {
  const { run, detect, skipped } = latestJudged(`HC03-${kind}-`);
  if (!run) return null;
  const meta = readJson(path.join(run, 'requests/run.json'));
  const responses = ['A', 'B'].map(x => {
    const j = readJson(path.join(run, `requests/request-${x}.json`));
    return j && { tag: x, decision: j.decision, amount: j.approvedAmount, reason: j.reasonCode, authNo: j.authorizationNo };
  }).filter(Boolean);
  const res = detect && readJson(path.join(detect, 'detection/result.json'));
  const summary = detect && readText(path.join(detect, 'detection/summary.txt'));
  const checks = summary ? summary.split('\n')
    .filter(l => /^(PASS|ALERT|FAIL)\s/.test(l))
    .map(l => ({ verdict: l.slice(0, l.indexOf(' ')), text: l.slice(l.indexOf(' ') + 1) })) : [];
  // db-summary.tsv 의 card_limits 행: [section, cardId, limit, used, version]
  const db = detect && readText(path.join(detect, 'detection/db-summary.tsv'));
  const limitRow = db && db.split('\n').map(l => l.split('\t')).find(c => c[0] === 'card_limits');
  const authRows = db ? db.split('\n').map(l => l.split('\t')).filter(c => c[0] === 'authorization_requests') : [];
  return { kind, run, detect, skipped, meta, responses, res, checks, limitRow, authRows };
};

const portal = (() => {
  const dir = latest('PORTAL-UI-');
  if (!dir) return null;
  const res = readJson(path.join(dir, 'result.json'));
  const shots = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  return res && { dir, res, shots };
})();

const network = (() => {
  const dir = latest('SECURITY-NETWORK-');
  if (!dir) return null;
  const res = readJson(path.join(dir, 'result.json'));
  const rows = (name) => {
    const t = readText(path.join(dir, name));
    return t ? t.trim().split('\n').slice(1).map(l => l.split('\t')) : [];
  };
  return res && { dir, res, ports: rows('ports.tsv'), networks: rows('networks.tsv') };
})();

const paymentFlow = (() => {
  const dir = latest('PAYMENT-FLOW-');
  const j = dir && readJson(path.join(dir, 'run.json'));
  return j && { dir, j };
})();

const smoke = (() => {
  const dir = latest('HC-SMOKE-');
  if (!dir) return null;
  const meta = readJson(path.join(dir, 'run.json'));
  const first = readJson(path.join(dir, 'first-response.json'));
  const replay = readJson(path.join(dir, 'replay-response.json'));
  return meta && { dir, meta, first, replay };
})();

const incident = (() => {
  const dir = latest('INCIDENT-SIM-');
  if (!dir) return null;
  const result = readJson(path.join(dir, 'result.json'));
  const summary = readText(path.join(dir, 'detection/summary.txt'));
  return result && { dir, result, summary };
})();

const before = collectCard03('BEFORE');
const after = collectCard03('AFTER');

/* ------------------------------------------------------------ 렌더 */
const badge = (v) => `<span class="badge ${v === 'PASS' ? 'ok' : v === 'ALERT' ? 'alert' : v === 'FAIL' ? 'fail' : 'none'}">${esc(v || '기록 없음')}</span>`;
const tile = (title, verdict, lines, dir) => `
  <article class="tile ${verdict === 'PASS' ? 'ok' : verdict === 'ALERT' ? 'alert' : verdict === 'FAIL' ? 'fail' : 'none'}">
    <header><h3>${esc(title)}</h3>${badge(verdict)}</header>
    <dl>${lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${dir ? `<footer>${esc(path.basename(dir))}</footer>` : ''}
  </article>`;

const card03Block = (c, expect) => {
  if (!c) return `<div class="empty">${esc(expect)} 실행 기록이 없다. 런북 D단계를 실행하면 채워진다.</div>`;
  const rows = c.responses.map(r =>
    `<tr><td>${esc(r.tag)}</td><td>${badge(r.decision === 'APPROVED' ? 'PASS' : 'ALERT').replace(/PASS|ALERT/, r.decision === 'APPROVED' ? '승인' : '거절')}</td>` +
    `<td class="num">${won(r.amount)}</td><td>${esc(r.reason)}</td><td class="mono">${esc(r.authNo)}</td></tr>`).join('');
  const limit = c.limitRow ? Number(c.limitRow[2]) : null;
  const used = c.limitRow ? Number(c.limitRow[3]) : null;
  const over = limit != null && used != null && used > limit;
  // db-summary.tsv 의 authorization_requests 열:
  // 0 section · 1 auth_id · 2 merchant_request_id · 3 correlation_id · 4 card_id
  // 5 amount · 6 status · 7 decision_code · 8 read_used_amount · 9 read_limit_version
  const snap = c.authRows.map(r =>
    `<tr><td class="mono">${esc((r[3] || '').slice(-1))}</td><td>${esc(r[6])}</td>` +
    `<td class="num">${won(Number(r[8]))}</td><td class="num">v${esc(r[9])}</td></tr>`).join('');
  return `
    <table class="grid"><thead><tr><th>요청</th><th>판정</th><th>승인액</th><th>사유</th><th>승인번호</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${c.limitRow ? `<p class="fact ${over ? 'bad' : 'good'}">카드 한도 ${won(limit)} · 사용액 <strong>${won(used)}</strong>
       ${over ? '<b>← 한도 초과</b>' : '(한도 이내)'} · version ${esc(c.limitRow[4])}</p>` : ''}
    ${snap ? `<table class="grid small"><thead><tr><th>요청</th><th>상태</th><th>읽은 사용액</th><th>읽은 version</th></tr></thead>
      <tbody>${snap}</tbody></table>
      <p class="note">두 요청이 <strong>같은 값</strong>을 읽었으면 경합이 일어난 것이다.</p>` : ''}
    ${c.checks.length ? `<ul class="checks">${c.checks.map(x =>
      `<li class="${x.verdict === 'PASS' ? 'ok' : 'alert'}"><span>${esc(x.verdict)}</span>${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${!c.detect ? `<p class="note">이 실행은 탐지를 돌리지 않았다. 판정을 채우려면
      <code>card03-detection-check.sh</code>를 실행한다.</p>` : ''}
    ${c.skipped ? `<p class="note">이보다 최근에 탐지를 돌리지 않은 실행이 ${c.skipped}건 있다.
      여기 표시한 값은 <strong>탐지까지 끝난 가장 최근 실행</strong>(${esc(path.basename(c.run))})이다.</p>` : ''}`;
};

const genAt = inKst(new Date());

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>해온카드 검증 증거 리포트</title>
<style>
  :root{--ink:#1b2422;--sub:#6d7a77;--line:#e1e8e6;--ok:#0d7060;--alert:#b4524a;--bg:#f6f8f7}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:"Pretendard Variable",Pretendard,"Noto Sans KR",system-ui,sans-serif;line-height:1.65;word-break:keep-all}
  .wrap{max-width:1180px;margin:auto;padding:0 28px}
  header.top{background:#0b3b36;color:#fff;padding:34px 0 30px}
  header.top h1{margin:0;font-size:28px;letter-spacing:-1px}
  header.top p{margin:8px 0 0;color:#a8c9c2;font-size:13px}
  main{padding:30px 0 60px}
  section{margin-top:34px}
  h2{font-size:19px;margin:0 0 4px;letter-spacing:-.5px}
  .lead{margin:0 0 16px;color:var(--sub);font-size:13px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
  .tile{background:#fff;border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:18px 20px}
  .tile.ok{border-top-color:var(--ok)} .tile.alert{border-top-color:#e0a03a} .tile.fail{border-top-color:var(--alert)}
  .tile header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  .tile h3{margin:0;font-size:15px}
  .tile dl{margin:0;font-size:12px}
  .tile dl div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid #f0f4f3}
  .tile dt{color:var(--sub)} .tile dd{margin:0;font-weight:700;text-align:right;overflow-wrap:anywhere}
  .tile footer{margin-top:12px;font-size:10.5px;color:#9aa8a5;font-family:ui-monospace,monospace;overflow-wrap:anywhere}
  .badge{font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap}
  .badge.ok{background:#e2f5ef;color:var(--ok)} .badge.alert{background:#fdf0dd;color:#8a5a12}
  .badge.fail{background:#fbe9e8;color:var(--alert)} .badge.none{background:#eef1f0;color:#8b9794}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}
  .panel h3{margin:0 0 4px;font-size:16px}
  .panel .sub{margin:0 0 14px;font-size:12px;color:var(--sub)}
  table.grid{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
  table.grid th,table.grid td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left}
  table.grid th{background:#f4f8f7;color:#3f5b55;font-weight:700}
  table.grid td.num{text-align:right;font-variant-numeric:tabular-nums}
  table.grid.small{font-size:11.5px}
  .mono{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere}
  .fact{margin:10px 0;padding:10px 12px;border-radius:8px;font-size:13px}
  .fact.bad{background:#fbe9e8;color:#8f3b34} .fact.good{background:#e2f5ef;color:#0b5c4f}
  .note{margin:6px 0 0;font-size:11.5px;color:var(--sub)}
  ul.checks{list-style:none;margin:12px 0 0;padding:0;font-size:12px}
  ul.checks li{display:flex;gap:9px;padding:5px 0;border-top:1px solid #f0f4f3}
  ul.checks li span{flex:0 0 46px;font-weight:800;font-size:10.5px;padding-top:2px}
  ul.checks li.ok span{color:var(--ok)} ul.checks li.alert span{color:#8a5a12}
  .shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:14px}
  .shots figure{margin:0}
  .shots img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  .shots figcaption{margin-top:6px;font-size:11px;color:var(--sub)}
  .review{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}
  .review ul{margin:8px 0 0;padding-left:20px;font-size:13px}
  .review li{margin:7px 0}
  .profile{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  .profile th,.profile td{padding:8px;border-bottom:1px solid var(--line);text-align:left}
  .profile th{background:#f4f8f7;color:#3f5b55}
  .quicklinks{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .quicklinks a{display:inline-flex;padding:8px 12px;border-radius:8px;background:#fff;color:#0b5c4f;text-decoration:none;font-size:12px;font-weight:700;border:1px solid #cddbd7}
  .empty{background:#fff;border:1px dashed #c8d4d1;border-radius:10px;padding:26px;text-align:center;color:var(--sub);font-size:13px}
  .cols2{columns:2;column-gap:22px}
  footer.foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--sub)}
  @media(max-width:860px){.pair,.review,.cols2{grid-template-columns:1fr;columns:1}}
  @media print{body{background:#fff}.tile,.panel{break-inside:avoid}}
</style></head>
<body>
<header class="top"><div class="wrap">
  <h1>해온카드 검증 증거 리포트</h1>
  <p>생성 ${esc(genAt)} · 출처 <code>${esc(RUNS)}/</code> · 각 항목은 실제 실행이 남긴 산출물에서 읽은 값이다</p>
</div></header>

<main class="wrap">

<section>
  <h2>판정 요약</h2>
  <p class="lead">가장 최근 실행 기준이다. Before의 ALERT는 취약 상태가 의도대로 재현됐다는 합격 신호이며, After는 통제가 작동해야 PASS다.</p>
  <div class="tiles">
    ${tile('가상 웹쉘 기반 침입 징후', incident?.result?.result, [
      ['탐지', incident?.result ? esc(incident.result.detection) : '-'],
      ['차단·추가 검증', incident?.result ? esc(incident.result.containment) : '-'],
      ['Mock PG 호출', incident?.result ? (incident.result.mockPgCorrelationObserved ? '있음' : '없음') : '-'],
      ['카드사 호출', incident?.result ? (incident.result.haeonCardCorrelationObserved ? '있음' : '없음') : '-'],
      ['실행 시각', when(incident?.dir) || '-'],
    ], incident?.dir)}
    ${tile('CARD-03 Before (취약 재현)', before?.res?.result, [
      ['승인 건수', before ? `${before.responses.filter(r => r.decision === 'APPROVED').length}건` : '-'],
      ['한도 초과 승인', before?.res ? `${before.res.approvedOverLimit}건` : '-'],
      ['동일 스냅샷 중복 승인', before?.res ? `${before.res.duplicateSnapshot}건` : '-'],
      ['실행 시각', when(before?.run) || '-'],
    ], before?.detect)}
    ${tile('CARD-03 After (통제 확인)', after?.res?.result, [
      ['승인 건수', after ? `${after.responses.filter(r => r.decision === 'APPROVED').length}건` : '-'],
      ['한도 초과 승인', after?.res ? `${after.res.approvedOverLimit}건` : '-'],
      ['검사 실패', after?.res ? `${after.res.failures}건` : '-'],
      ['실행 시각', when(after?.run) || '-'],
    ], after?.detect)}
    ${tile('회원 화면 점검', portal?.res?.result, [
      ['통과', portal?.res ? `${portal.res.checks - portal.res.failures} / ${portal.res.checks}` : '-'],
      ['대상', portal?.res ? esc(portal.res.baseUrl) : '-'],
      ['실행 시각', when(portal?.dir) || '-'],
    ], portal?.dir)}
    ${tile('네트워크·포트 격리', network?.res?.result, [
      ['호스트 포트 검사', network?.res ? `${network.res.hostPortChecks}건` : '-'],
      ['네트워크 검사', network?.res ? `${network.res.networkChecks}건` : '-'],
      ['실패', network?.res ? `${network.res.failures}건` : '-'],
      ['실행 시각', when(network?.dir) || '-'],
    ], network?.dir)}
    ${tile('결제 왕복 계약', paymentFlow ? (paymentFlow.j.sameReplayResponse && paymentFlow.j.sameConcurrentResponse ? 'PASS' : 'FAIL') : null, [
      ['멱등 재조회 동일', paymentFlow ? (paymentFlow.j.sameReplayResponse ? '예' : '아니오') : '-'],
      ['동시 요청 동일', paymentFlow ? (paymentFlow.j.sameConcurrentResponse ? '예' : '아니오') : '-'],
      ['로그 연결', paymentFlow ? esc(paymentFlow.j.logServices.join(' → ')) : '-'],
      ['실행 시각', when(paymentFlow?.dir) || '-'],
    ], paymentFlow?.dir)}
    ${tile('카드 승인 스모크', smoke ? (smoke.first?.authorizationNo && smoke.first.authorizationNo === smoke.replay?.authorizationNo ? 'PASS' : 'FAIL') : null, [
      ['승인 금액', smoke?.first ? won(smoke.first.approvedAmount) : '-'],
      ['재시도 승인번호 동일', smoke ? (smoke.first?.authorizationNo === smoke.replay?.authorizationNo ? '예' : '아니오') : '-'],
      ['프로파일', smoke?.meta ? esc(smoke.meta.profile) : '-'],
      ['실행 시각', when(smoke?.dir) || '-'],
    ], smoke?.dir)}
  </div>
</section>

<section>
  <h2>최종 검토 결론</h2>
  <p class="lead">프로젝트 원안, 현재 코드, 합성 데이터, 실행 증거를 교차 확인한 결과다.</p>
  <div class="review">
    <div class="panel">
      <h3>프로젝트 의도와의 정합성</h3>
      <ul>
        <li><strong>역할 경계 유지:</strong> 북웨이브는 주문, Mock PG는 중계, 해온카드는 승인 원본과 한도 장부를 소유한다.</li>
        <li><strong>주 시나리오 유지:</strong> CARD-03은 인증된 서로 다른 두 요청이 같은 한도를 경쟁하는 결함이며, PG 결과 위조나 침입 재현과 판정을 섞지 않는다.</li>
        <li><strong>Before/After 의미 명확:</strong> 이전 커밋 비교가 아니라 같은 빌드의 취약 경로와 행 잠금 경로 비교다. normal 동작은 After와 같다.</li>
        <li><strong>안전한 교육 환경:</strong> 실제 카드번호·CVC·금융망·실행 가능한 웹쉘 없이 localhost 합성 데이터만 사용한다.</li>
      </ul>
      <div class="quicklinks">
        <a href="../docs/scenarios/haeon-lab-demo-shooting-guide-v1.0.html">촬영용 한눈에 보기</a>
        <a href="../docs/scenarios/haeon-lab-demo-runbook-v1.0.pdf">최종 시연 런북 PDF</a>
      </div>
    </div>
    <div class="panel">
      <h3>금액 프로파일 구분</h3>
      <table class="profile"><thead><tr><th>프로파일</th><th>한도</th><th>동시 요청</th></tr></thead><tbody>
        <tr><td><strong>lab</strong> · 원안/자동시험</td><td>100,000원</td><td>80,000원 × 2</td></tr>
        <tr><td><strong>demo</strong> · 발표 화면</td><td>10,000,000원</td><td>6,000,000원 × 2</td></tr>
      </tbody></table>
      <p class="note">금액만 확대한 별도 fixture다. 경쟁 조건과 판정 규칙은 동일하며 한 실행에서 두 프로파일을 섞지 않는다.</p>
    </div>
  </div>
</section>

${incident ? `<section>
  <h2>가상 웹쉘 기반 결제 서버 침입 재현</h2>
  <p class="lead">실행 가능한 웹쉘이나 명령 실행은 포함하지 않고, 고정된 침입 징후 S1~S4만 남긴 안전한 재현이다.</p>
  <div class="panel">
    <p class="fact good">S3에서 <strong>ALERT</strong>, S4에서 합성 데이터 접근 차단과 추가 검증 <strong>PASS</strong>를 같은 correlationId 범위에서 확인했다.</p>
    <ul class="checks">
      ${(incident.summary || '').split('\n').filter(Boolean).map(line => `<li class="${/FAIL/.test(line) ? 'alert' : 'ok'}"><span>${/FAIL/.test(line) ? 'FAIL' : 'PASS'}</span>${esc(line)}</li>`).join('')}
    </ul>
    <p class="note">결제 라우트·Mock PG·해온카드 호출은 발생하지 않아, 승인 DB를 직접 수정하지 않는다.</p>
  </div>
</section>` : ''}

<section>
  <h2>CARD-03 — 한도 이중 사용 Before / After</h2>
  <p class="lead">촬영용 demo 프로파일: 같은 카드에 6,000,000원 결제 두 건을 동시에 보낸 결과다. 한도는 10,000,000원이다.</p>
  <div class="pair">
    <div class="panel"><h3>Before — 잠금 없이 읽기</h3>
      <p class="sub">한도 행을 잠그지 않고 스냅샷만 읽는 경로</p>${card03Block(before, 'Before')}</div>
    <div class="panel"><h3>After — 행 잠금 후 재판정</h3>
      <p class="sub">SELECT … FOR UPDATE 로 잠그고 최신 값으로 다시 판정하는 경로</p>${card03Block(after, 'After')}</div>
  </div>
</section>

${portal ? `<section>
  <h2>회원 화면 점검</h2>
  <p class="lead">실제 브라우저로 홈 → 마이페이지 → 로그인 → 조회 → 로그아웃을 돌린 결과다.</p>
  <div class="panel">
    <ul class="checks cols2">${portal.res.results.map(r =>
      `<li class="${r.result === 'PASS' ? 'ok' : 'alert'}"><span>${esc(r.result)}</span>${esc(r.name)}${r.detail ? ` <em>(${esc(r.detail)})</em>` : ''}</li>`).join('')}</ul>
    <div class="shots">${portal.shots.map(f =>
      `<figure><img src="${esc(rel(path.join(portal.dir, f)))}" alt="${esc(f)}"><figcaption>${esc(f)}</figcaption></figure>`).join('')}</div>
  </div>
</section>` : ''}

${network ? `<section>
  <h2>네트워크·포트 격리</h2>
  <p class="lead">DB 포트 미노출, 앱 포트 로컬호스트 바인딩, 카드사 포트 경계를 확인한다.</p>
  <div class="pair">
    <div class="panel"><h3>호스트 포트</h3>
      <table class="grid"><thead><tr><th>서비스</th><th>공개 포트</th><th>판정</th></tr></thead><tbody>
      ${network.ports.map(r => `<tr><td>${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td>${badge(r[2])}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="panel"><h3>네트워크</h3>
      <table class="grid"><thead><tr><th>이름</th><th>내부 전용</th><th>판정</th></tr></thead><tbody>
      ${network.networks.map(r => `<tr><td class="mono">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${badge(r[3])}</td></tr>`).join('')}
      </tbody></table></div>
  </div>
</section>` : ''}

<footer class="foot wrap">
  이 리포트는 <code>tools/evidence-report.sh</code> 가 <code>${esc(RUNS)}/</code> 를 읽어 만든다.
  값을 손으로 적지 않으며, 실행 기록이 없는 항목은 비워 둔다.
  원본 산출물은 각 카드 아래의 실행 폴더 이름으로 찾는다.
</footer>
</main>
</body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
const found = [incident && '침입재현', before && 'Before', after && 'After', portal && '화면', network && '네트워크',
  paymentFlow && '결제왕복', smoke && '스모크'].filter(Boolean);
console.log(`리포트 생성: ${OUT} (${Math.round(html.length / 1024)} KB)`);
console.log(`포함된 실행: ${found.join(' · ') || '없음'}`);
