// 최신 실행 증거와 포털 캡처를 읽어, 촬영자가 그대로 따라갈 수 있는 단일 HTML 큐시트를 만든다.
import fs from 'node:fs';
import path from 'node:path';

const RUNS = process.env.RUNS_DIR || 'evidence/runs';
const OUT = process.env.OUT_FILE || 'docs/scenarios/haeon-lab-demo-shooting-guide-v1.0.html';
const TS = /^(\d{8}T\d{6}Z)$/;
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = v => `${Number(v || 0).toLocaleString('ko-KR')}원`;
const allRuns = prefix => {
  try {
    return fs.readdirSync(RUNS, {withFileTypes:true})
      .filter(d => d.isDirectory() && d.name.startsWith(prefix) && TS.test(d.name.slice(prefix.length)))
      .map(d => path.join(RUNS, d.name)).sort().reverse();
  } catch { return []; }
};
const latest = prefix => allRuns(prefix)[0] || null;
const detectFor = run => run && path.join(RUNS, `DETECT-${path.basename(run)}`);
const latestJudged = prefix => allRuns(prefix).find(r => fs.existsSync(detectFor(r))) || null;
const dataUrl = p => {
  try { return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`; }
  catch { return ''; }
};
const stamp = dir => path.basename(dir || '실행 기록 없음');

const portalDir = latest('PORTAL-UI-');
const portal = portalDir && readJson(path.join(portalDir, 'result.json'));
const incidentDir = latest('INCIDENT-SIM-');
const incident = incidentDir && readJson(path.join(incidentDir, 'result.json'));
const paymentDir = latest('PAYMENT-FLOW-');
const payment = paymentDir && readJson(path.join(paymentDir, 'run.json'));
const networkDir = latest('SECURITY-NETWORK-');
const network = networkDir && readJson(path.join(networkDir, 'result.json'));

const collectCard = kind => {
  const run = latestJudged(`HC03-${kind}-`);
  if (!run) return null;
  const detect = detectFor(run);
  const responses = ['A','B'].map(tag => ({tag, ...readJson(path.join(run, `requests/request-${tag}.json`))}));
  const result = readJson(path.join(detect, 'detection/result.json'));
  const db = readText(path.join(detect, 'detection/db-summary.tsv')).split('\n').map(x => x.split('\t'));
  const limit = db.find(x => x[0] === 'card_limits');
  const auth = db.filter(x => x[0] === 'authorization_requests');
  return {run, detect, responses, result, limit, auth};
};
const before = collectCard('BEFORE');
const after = collectCard('AFTER');

const shots = {
  home: portalDir && dataUrl(path.join(portalDir, '1-landing-logged-out.png')),
  login: portalDir && dataUrl(path.join(portalDir, '2-mypage-login.png')),
  mypage: portalDir && dataUrl(path.join(portalDir, '3-mypage-logged-in.png')),
  homeIn: portalDir && dataUrl(path.join(portalDir, '4-landing-logged-in.png')),
};
const shot = (src, alt, caption) => src
  ? `<figure class="shot"><img src="${src}" alt="${esc(alt)}"><figcaption>${esc(caption)}</figcaption></figure>`
  : `<div class="missing">캡처 없음: ${esc(alt)}</div>`;
const term = (command, output, tone='') => `<div class="terminal ${tone}">
  <div class="termbar"><i></i><i></i><i></i><span>WSL · bookwave-haeon-lab</span></div>
  <pre><b>$ ${esc(command)}</b>\n${esc(output)}</pre>
</div>`;
const responseLines = c => c ? c.responses.map(r =>
  `${r.tag}  ${r.decision || '-'}  ${won(r.approvedAmount)}  ${r.reasonCode || '-'}`).join('\n') : '실행 기록 없음';
const limitLine = c => c?.limit
  ? `limit=${won(c.limit[2])}  used=${won(c.limit[3])}  version=${c.limit[4]}` : 'DB 요약 없음';
const snapshotLines = c => c?.auth?.map(r =>
  `${(r[3] || '').slice(-1)}  ${r[6]}  read_used=${won(r[8])}  read_version=v${r[9]}`).join('\n') || '스냅샷 없음';
const generated = new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul', hour12:false});

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>해온카드 시연 촬영 큐시트</title>
<style>
:root{--green:#0d7c69;--deep:#0a3833;--mint:#e8f6f1;--ink:#1a2523;--sub:#687773;--line:#dbe6e2;--red:#c84d48;--amber:#e49b2e;--bg:#f4f7f6}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Pretendard,"Noto Sans KR",system-ui,sans-serif;line-height:1.6;word-break:keep-all}
.hero{background:linear-gradient(135deg,#082f2b 0%,#0d5e52 62%,#14977e 100%);color:#fff;padding:52px 24px 46px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;width:420px;height:420px;border:1px solid rgba(255,255,255,.15);border-radius:50%;right:-100px;top:-170px;box-shadow:0 0 0 70px rgba(255,255,255,.04)}
.hero .inner,.wrap{max-width:1180px;margin:auto}.kicker{font-size:12px;letter-spacing:.18em;color:#9ee1d1;font-weight:800}.hero h1{font-size:clamp(32px,5vw,58px);line-height:1.12;margin:10px 0 14px;letter-spacing:-.05em}.hero p{max-width:760px;margin:0;color:#cce9e2}.meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.pill{padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.12);font-size:12px;border:1px solid rgba(255,255,255,.16)}
.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.nav .inner{max-width:1180px;margin:auto;padding:10px 20px;display:flex;gap:8px;overflow:auto}.nav a{white-space:nowrap;text-decoration:none;color:#46605a;font-size:12px;font-weight:750;padding:7px 10px;border-radius:8px}.nav a:hover{background:var(--mint);color:var(--green)}
.wrap{padding:28px 24px 70px}.intro{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-bottom:34px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 10px 30px rgba(19,57,49,.05)}.card h2,.card h3{margin:0 0 8px}.card p{margin:6px 0;color:var(--sub);font-size:14px}.order{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}.order span{background:var(--mint);color:var(--deep);font-weight:800;font-size:12px;padding:8px 10px;border-radius:9px}.order b{color:#95a49f}.check{list-style:none;padding:0;margin:10px 0 0}.check li{padding:8px 0;border-top:1px solid #eef3f1;font-size:13px}.check li:before{content:"✓";color:var(--green);font-weight:900;margin-right:8px}
.step{scroll-margin-top:70px;margin:22px 0;background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden}.stephead{display:flex;align-items:flex-start;gap:14px;padding:20px 22px;border-bottom:1px solid var(--line)}.num{width:38px;height:38px;border-radius:12px;background:var(--deep);color:#fff;display:grid;place-items:center;font-weight:900;flex:0 0 auto}.stephead h2{margin:0;font-size:21px;letter-spacing:-.03em}.stephead p{margin:3px 0 0;color:var(--sub);font-size:13px}.badge{margin-left:auto;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:900}.badge.screen{background:#e4f4ff;color:#21648e}.badge.term{background:#eee8ff;color:#6245a8}.badge.core{background:#fff0df;color:#9a5b05}.badge.pass{background:var(--mint);color:var(--green)}
.content{padding:22px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.shot{margin:0}.shot img{width:100%;display:block;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(8,48,42,.10)}.shot figcaption{font-size:11px;color:var(--sub);margin-top:6px}.cue{border-left:4px solid var(--green);background:#f2faf7;padding:13px 15px;border-radius:0 10px 10px 0;margin:12px 0;font-size:14px}.cue strong{color:var(--deep)}.say{background:#fff9e8;border:1px solid #f2df9f;padding:13px 15px;border-radius:10px;margin:12px 0;font-size:14px;color:#5b4816}.say:before{content:"발표 멘트";display:block;font-weight:900;font-size:10px;letter-spacing:.12em;color:#a47300;margin-bottom:4px}
.terminal{background:#101817;border-radius:13px;overflow:hidden;color:#d7eee7;margin:12px 0;box-shadow:0 12px 30px rgba(0,0,0,.16)}.terminal.alert{box-shadow:inset 4px 0 var(--red),0 12px 30px rgba(0,0,0,.16)}.terminal.good{box-shadow:inset 4px 0 #21ae83,0 12px 30px rgba(0,0,0,.16)}.termbar{height:35px;background:#1d2927;display:flex;align-items:center;gap:6px;padding:0 12px}.termbar i{width:9px;height:9px;border-radius:50%;background:#ff6b62}.termbar i:nth-child(2){background:#f1bf4c}.termbar i:nth-child(3){background:#48c879}.termbar span{margin-left:7px;font:11px ui-monospace,monospace;color:#94aaa5}.terminal pre{margin:0;padding:16px;white-space:pre-wrap;overflow:auto;font:12px/1.6 "Cascadia Mono",Consolas,monospace}.terminal b{color:#fff}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}.fact{background:#f5f9f7;border:1px solid var(--line);border-radius:10px;padding:12px}.fact small{display:block;color:var(--sub);font-size:10px}.fact strong{display:block;font-size:18px;margin-top:2px}.danger{color:var(--red)}.ok{color:var(--green)}
.compare{display:grid;grid-template-columns:1fr 48px 1fr;gap:10px;align-items:stretch}.arrow{display:grid;place-items:center;font-size:28px;color:var(--green)}.compare .card{box-shadow:none}.compare h3{display:flex;justify-content:space-between}.screenmock{border-radius:12px;border:1px solid var(--line);padding:14px;background:linear-gradient(145deg,#fff,#f2f8f6)}.screenmock .bar{height:9px;border-radius:9px;background:#dfe9e6;overflow:hidden;margin:8px 0}.screenmock .bar i{display:block;height:100%;background:var(--red)}.screenmock.after .bar i{width:60%;background:var(--green)}.screenmock.before .bar i{width:100%}.screenmock p{margin:4px 0;color:var(--ink);font-size:13px}.screenmock b{font-size:19px}.source{font-size:10px;color:#87948f;margin-top:10px;overflow-wrap:anywhere}.finish{background:var(--deep);color:#fff}.finish p{color:#c9e0da}.finish a{display:inline-block;background:#fff;color:var(--deep);padding:10px 14px;border-radius:9px;text-decoration:none;font-weight:850;margin:5px 6px 0 0}
@media(max-width:820px){.intro,.grid2,.compare{grid-template-columns:1fr}.arrow{transform:rotate(90deg)}.facts{grid-template-columns:1fr}.badge{margin-left:0}.stephead{flex-wrap:wrap}}
@media print{.nav{display:none}.step{break-inside:avoid}.hero{padding:28px 20px}.wrap{padding:16px}.terminal{box-shadow:none}}
</style></head><body>
<header class="hero"><div class="inner"><div class="kicker">HAEON CARD · RECORDING CUE SHEET</div><h1>해온카드 시연,<br>이 순서대로 찍으면 됩니다.</h1><p>화면은 “무슨 일이 일어났나”, 터미널은 “왜 일어났나”를 보여줍니다. 아래 카드를 위에서 아래로 따라가면 기준선부터 공격 재현, 개선 확인, 증거 리포트까지 한 번에 촬영할 수 있습니다.</p><div class="meta"><span class="pill">최종 생성 ${esc(generated)}</span><span class="pill">합성 데이터 · localhost 전용</span><span class="pill">핵심: E → D Before → D After</span></div></div></header>
<nav class="nav"><div class="inner"><a href="#prep">0 준비</a><a href="#home">1 홈</a><a href="#login">2 로그인</a><a href="#pay">3 결제</a><a href="#incident">4 침입 재현</a><a href="#before">5 Before</a><a href="#after">6 After</a><a href="#report">7 리포트</a><a href="#cleanup">8 복원</a></div></nav>
<main class="wrap">
<section class="intro"><div class="card"><h2>촬영 순서</h2><div class="order"><span>B 화면</span><b>→</b><span>C 결제</span><b>→</b><span>E 침입 재현</span><b>→</b><span>D Before</span><b>→</b><span>D After</span><b>→</b><span>리포트</span></div><p>D는 카드 한도와 내역을 바꾸므로 B·C보다 먼저 찍지 않습니다. 발표 편집에서는 E와 D를 핵심 서사로 두고, D After를 마지막 해결 장면으로 사용합니다.</p></div><div class="card"><h3>녹화 전 30초 체크</h3><ul class="check"><li>브라우저 8080 / 8085 두 창</li><li>WSL 터미널 글자 18~20pt</li><li>알림·메신저·비밀번호 자동완성 숨김</li><li>실제 카드·개인정보 사용 금지</li></ul></div></section>

<section class="step" id="prep"><div class="stephead"><div class="num">0</div><div><h2>기동과 기준선</h2><p>카메라를 켜기 전, 서비스와 화면 데이터를 정상 상태로 맞춥니다.</p></div><span class="badge term">터미널</span></div><div class="content grid2"><div>${term('docker compose --env-file .env up -d && docker compose --env-file .env ps','8개 컨테이너 healthy\n8080 bookwave-app  · 8083 mock-pg\n8085 haeon-card portal','good')}${term('bash tools/portal-ui-check.sh',`포털 화면 점검: ${portal?.result || '기록 없음'} (${portal ? `${portal.checks - portal.failures}/${portal.checks}` : '-'})\n${stamp(portalDir)}`,'good')}</div><div><div class="cue"><strong>화면에 띄우지 않을 것:</strong> 로그인 비밀번호와 환경변수 값. 기동·복원은 녹화 전에 끝내고 결과만 짧게 보여줍니다.</div><div class="facts"><div class="fact"><small>포털 UI</small><strong class="ok">${esc(portal?.result || '-')}</strong></div><div class="fact"><small>네트워크</small><strong class="ok">${esc(network?.result || '-')}</strong></div><div class="fact"><small>결제 계약</small><strong class="ok">${payment?.sameReplayResponse ? 'PASS' : '-'}</strong></div></div><p class="source">실행: ${esc(stamp(portalDir))} · ${esc(stamp(networkDir))} · ${esc(stamp(paymentDir))}</p></div></div></section>

<section class="step" id="home"><div class="stephead"><div class="num">1</div><div><h2>해온카드 홈</h2><p>카드사 홈에는 카드·혜택 안내만 있고 회원 상세정보는 없습니다.</p></div><span class="badge screen">브라우저</span></div><div class="content grid2">${shot(shots.home,'해온카드 홈 로그아웃 화면','실제 자동 점검 캡처 · 로그아웃 상태')}<div><div class="cue"><strong>클릭:</strong> 상단 MY. 홈에서는 회원번호·한도·이용내역이 보이지 않는다는 점을 먼저 잡습니다.</div><div class="say">“해온카드 홈은 상품 안내 영역입니다. 개인 카드와 승인 내역은 로그인한 마이페이지에서만 확인합니다.”</div><ul class="check"><li>상단 MY가 /mypage로 이동</li><li>빠른 메뉴도 /mypage로 이동</li><li>카드 결제 시작 기능은 없음</li></ul></div></div></section>

<section class="step" id="login"><div class="stephead"><div class="num">2</div><div><h2>마이페이지 로그인 → 조회</h2><p>틀린 비밀번호 오류를 한 번 보여준 뒤 합성 계정으로 로그인합니다.</p></div><span class="badge screen">브라우저</span></div><div class="content"><div class="grid2">${shot(shots.login,'마이페이지 로그인 화면','로그인 전에는 조회 본문이 숨겨짐')}${shot(shots.mypage,'마이페이지 로그인 후 화면','보유 카드 3장 · 최근 이용내역 16건')}</div><div class="cue"><strong>장면 전환:</strong> 주소는 /mypage 그대로이고 로그인 카드만 회원 조회 화면으로 바뀝니다. 토큰과 limit version은 노출되지 않습니다.</div><div class="say">“조회 대상은 요청 파라미터가 아니라 로그인 세션에서 결정됩니다. 그래서 다른 회원의 카드나 내부 version 값은 화면에 나오지 않습니다.”</div></div></section>

<section class="step" id="pay"><div class="stephead"><div class="num">3</div><div><h2>북웨이브 결제 → 해온카드 확인</h2><p>결제는 가맹점에서 시작하고, 승인 원본은 카드사 DB와 마이페이지에 남습니다.</p></div><span class="badge screen">브라우저 중심</span></div><div class="content grid2"><div><div class="screenmock after"><p>북웨이브 · 느리게 읽는 밤</p><b>16,800원 결제 승인</b><p>승인번호 AUTH-HC-…</p><div class="bar"><i></i></div></div><div class="say">“북웨이브는 주문 장부, 해온카드는 승인 장부의 주인입니다. 같은 승인번호로 두 화면이 이어집니다.”</div></div><div>${term('bash tools/payment-flow-contract-check.sh',`동시 멱등 응답 동일: ${payment?.sameConcurrentResponse ? 'PASS' : '-'}\n재조회 응답 동일: ${payment?.sameReplayResponse ? 'PASS' : '-'}\n로그: bookwave-app → mock-pg → haeon-card`,'good')}<div class="cue"><strong>촬영:</strong> 북웨이브 승인번호를 읽고 마이페이지 새로고침 후 같은 번호를 찾습니다. 이후 500,000원 결제로 LIMIT_EXCEEDED 거절을 보여줍니다.</div></div></div></section>

<section class="step" id="incident"><div class="stephead"><div class="num">4</div><div><h2>가상 웹쉘 기반 결제서버 침입 재현</h2><p>실행 가능한 웹쉘 없이 고정된 합성 징후만 S1~S4로 재현합니다.</p></div><span class="badge core">핵심 · 터미널</span></div><div class="content grid2"><div>${term('bash tools/payment-server-incident-simulation.sh',`S1 결제서버 접근 징후  OBSERVED\nS2 합성 데이터 접근 시도  OBSERVED\nS3 탐지 규칙              ALERT\nS4 접근 차단·추가 검증    PASS\nMock PG 호출 없음 · 해온카드 호출 없음`,'good')}</div><div><div class="facts"><div class="fact"><small>탐지</small><strong class="danger">${esc(incident?.detection || '-')}</strong></div><div class="fact"><small>차단</small><strong class="ok">${esc(incident?.containment || '-')}</strong></div><div class="fact"><small>최종 판정</small><strong class="ok">${esc(incident?.result || '-')}</strong></div></div><div class="say">“침입 징후는 탐지됐지만 결제 경로와 카드사까지 번지기 전에 차단됐습니다. 실행 가능한 악성 파일은 사용하지 않았습니다.”</div><p class="source">실행: ${esc(stamp(incidentDir))}</p></div></div></section>

<section class="step" id="before"><div class="stephead"><div class="num">5</div><div><h2>CARD-03 Before · 취약 재현</h2><p>demo 프로파일: 한도 1천만원에 6백만원 요청 두 건을 동시에 보냅니다.</p></div><span class="badge core">핵심 · ALERT가 합격</span></div><div class="content grid2"><div>${term('LAB_PROFILE=before CARD03_SCENARIO_PROFILE=demo bash tools/card03-concurrency.sh',responseLines(before),'alert')}${term('bash tools/card03-detection-check.sh',`${limitLine(before)}\n${snapshotLines(before)}\ndetection=${before?.result?.result || '-'}  alerts=${before?.result?.alerts ?? '-'}`,'alert')}</div><div><div class="screenmock before"><p>해온 플러스 **** 0001</p><b class="danger">이용 12,000,000원</b><p>잔여 0원 / 한도 10,000,000원</p><div class="bar"><i></i></div><p>6,000,000원 승인 · 6,000,000원 승인</p></div><div class="say">“두 요청이 모두 사용액 0원, version 0을 읽었습니다. 각각 승인할 때는 괜찮아 보였지만 합계는 한도를 넘었습니다.”</div><div class="cue"><strong>중요:</strong> Before의 <b>ALERT</b>는 실패가 아니라 취약 상태가 의도대로 재현됐다는 판정입니다.</div><p class="source">실행: ${esc(stamp(before?.run))}</p></div></div></section>

<section class="step" id="after"><div class="stephead"><div class="num">6</div><div><h2>CARD-03 After · 통제 확인</h2><p>같은 요청을 행 잠금과 최신값 재판정 경로로 다시 보냅니다.</p></div><span class="badge pass">핵심 · PASS</span></div><div class="content"><div class="compare"><div class="card"><h3>Before <span class="danger">ALERT</span></h3><p>잠금 없이 같은 스냅샷을 읽음</p><div class="facts"><div class="fact"><small>승인</small><strong>2건</strong></div><div class="fact"><small>사용액</small><strong class="danger">12,000,000원</strong></div><div class="fact"><small>version</small><strong>2</strong></div></div></div><div class="arrow">→</div><div class="card"><h3>After <span class="ok">PASS</span></h3><p>SELECT … FOR UPDATE 후 최신값 재판정</p><div class="facts"><div class="fact"><small>승인 / 거절</small><strong>1 / 1</strong></div><div class="fact"><small>사용액</small><strong class="ok">6,000,000원</strong></div><div class="fact"><small>version</small><strong>1</strong></div></div></div></div><div class="grid2">${term('LAB_PROFILE=after CARD03_SCENARIO_PROFILE=demo bash tools/card03-concurrency.sh',responseLines(after),'good')}${term('bash tools/card03-detection-check.sh',`${limitLine(after)}\n${snapshotLines(after)}\ndetection=${after?.result?.result || '-'}  failures=${after?.result?.failures ?? '-'}`,'good')}</div><div class="say">“같은 공격을 다시 보냈지만 먼저 잠금을 잡은 한 건만 승인됩니다. 두 번째 요청은 최신 사용액 600만원을 읽고 한도 초과로 거절됩니다.”</div><p class="source">실행: ${esc(stamp(after?.run))}</p></div></section>

<section class="step" id="report"><div class="stephead"><div class="num">7</div><div><h2>증거 리포트로 마무리</h2><p>방금 본 결과가 요청·DB·로그·화면 캡처로 남았음을 한 장에서 보여줍니다.</p></div><span class="badge screen">브라우저</span></div><div class="content grid2"><div>${term('bash tools/evidence-report.sh','리포트 생성: evidence/report.html\n침입재현 · Before · After · 화면 · 네트워크 · 결제왕복','good')}<div class="facts"><div class="fact"><small>Before</small><strong class="danger">${esc(before?.result?.result || '-')}</strong></div><div class="fact"><small>After</small><strong class="ok">${esc(after?.result?.result || '-')}</strong></div><div class="fact"><small>UI</small><strong class="ok">${esc(portal?.result || '-')}</strong></div></div></div><div><div class="cue"><strong>마지막 화면:</strong> evidence/report.html의 판정 요약 → Before/After 비교 → 회원 화면 캡처 순으로 천천히 스크롤합니다.</div><div class="say">“지금 보신 요청, DB 상태, 탐지 결과와 화면 캡처가 모두 이 리포트에 남아 있습니다.”</div><a href="../../evidence/report.html" style="color:var(--green);font-weight:850">증거 리포트 열기 →</a></div></div></section>

<section class="step" id="cleanup"><div class="stephead"><div class="num">8</div><div><h2>정상 상태로 복원</h2><p>8084 디버그 포트를 닫고 lab 기준선과 포털 더미데이터를 되돌립니다.</p></div><span class="badge term">터미널 · 필수</span></div><div class="content grid2"><div>${term('docker compose --env-file .env up -d --force-recreate haeon-card','normal 프로파일 복원\n8084 호스트 차단 · 8085 포털 개방','good')}${term('bash tools/network-port-security-check.sh',`host-port checks: ${network?.hostPortChecks ?? '-'}\nnetwork checks: ${network?.networkChecks ?? '-'}\nfailures: ${network?.failures ?? '-'}\nresult: ${network?.result || '-'}`,'good')}</div><div>${shot(shots.homeIn,'로그인 유지 홈 화면','세션 유지 상태에서도 홈에 개인 상세정보가 노출되지 않음')}<div class="cue"><strong>최종 확인:</strong> portal-ui-check 35/35, 네트워크 PASS, 카드 한도 100,000원·사용액 0원, 포털 내역 16건.</div></div></div></section>

<section class="card finish"><h2>촬영에서 반드시 남겨야 할 네 장면</h2><p>① 북웨이브 승인번호와 마이페이지 승인번호 일치 · ② 침입 징후 ALERT 후 차단 PASS · ③ Before 1천2백만원 초과 승인 · ④ After 1건 승인/1건 거절과 탐지 PASS</p><a href="haeon-lab-demo-runbook-v1.0.pdf">전체 런북 PDF</a><a href="../../evidence/report.html">최종 증거 리포트</a></section>
</main></body></html>`;

fs.mkdirSync(path.dirname(OUT), {recursive:true});
fs.writeFileSync(OUT, html, 'utf8');
console.log(`촬영 큐시트 생성: ${OUT} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
console.log(`포털 캡처: ${stamp(portalDir)} · Before: ${stamp(before?.run)} · After: ${stamp(after?.run)}`);
