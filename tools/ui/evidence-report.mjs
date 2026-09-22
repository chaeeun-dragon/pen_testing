// HAEON-DIAG-01 실행 증거를 모아 검토용 HTML 리포트를 생성한다.
import fs from 'node:fs';
import path from 'node:path';

const RUNS = process.env.RUNS_DIR || 'evidence/runs';
const OUT = process.env.OUT_FILE || 'evidence/report.html';
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const entries = prefix => {
  try { return fs.readdirSync(RUNS, {withFileTypes:true}).filter(item => item.isDirectory() && item.name.startsWith(prefix)).map(item => path.join(RUNS, item.name)).sort().reverse(); }
  catch { return []; }
};
const latest = prefix => entries(prefix)[0] || null;
const diagDirs = entries('HAEON-DIAG-').filter(dir => /^HAEON-DIAG-\d{14}-\d{4}$/.test(path.basename(dir)));
const collect = dir => dir ? {
  dir,
  scenario: readJson(path.join(dir, 'scenario.json')),
  attack: readJson(path.join(dir, 'attack-response.json')),
  records: readJson(path.join(dir, 'records.json')),
  transfer: readJson(path.join(dir, 'exfiltration.json')),
  response: readJson(path.join(dir, 'response-action.json')),
  state: readJson(path.join(dir, 'run-state.json')),
  events: readJson(path.join(dir, 'events.json')),
  summary: readText(path.join(dir, 'summary.txt')),
  verification: readText(path.join(dir, 'verification.txt')),
} : null;
const before = collect(diagDirs.find(dir => readJson(path.join(dir, 'scenario.json'))?.mode === 'before'));
const after = collect(diagDirs.find(dir => readJson(path.join(dir, 'scenario.json'))?.mode === 'after'));
const normalDir = latest('NORMAL-');
const normal = normalDir ? {dir:normalDir, response:readJson(path.join(normalDir, 'response.json')), summary:readText(path.join(normalDir, 'summary.txt'))} : null;
const generated = new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul', hour12:false});
const runName = item => item?.dir ? path.basename(item.dir) : '실행 기록 없음';
const verdict = text => `<span class="badge ${/PASS|SUCCESS|RECEIVED|CONTAINED|BLOCKED/.test(String(text || '')) ? 'ok' : /ALERT/.test(String(text || '')) ? 'alert' : /FAIL|REJECTED/.test(String(text || '')) ? 'fail' : 'none'}">${esc(text || '기록 없음')}</span>`;
const tile = (title, value, details, dir) => `<article class="tile"><header><h3>${esc(title)}</h3>${verdict(value)}</header><dl>${details.map(([label, detail]) => `<div><dt>${esc(label)}</dt><dd>${detail}</dd></div>`).join('')}</dl>${dir ? `<footer>${esc(path.basename(dir))}</footer>` : ''}</article>`;
const eventRows = item => {
  const list = Array.isArray(item?.events) ? item.events : [];
  return list.length ? list.map(event => `<tr><td>${esc(event.eventType || '-')}</td><td>${verdict(event.result)}</td><td>${esc(event.correlationId || '-')}</td><td>${esc(event.occurredAt || '-')}</td></tr>`).join('') : '<tr><td colspan="4">이 실행의 이벤트 증거가 없습니다. RUN_ID를 지정해 verify를 실행하세요.</td></tr>';
};
const count = item => item?.records?.recordCount ?? item?.records?.records?.length ?? '-';
const safeHash = item => item?.transfer?.payloadSha256 || '-';
const httpStatus = item => item?.attack?.httpStatus ?? item?.attack?.status ?? item?.summary.match(/attackHttp=(\d+)/)?.[1] ?? '-';
const eventSection = item => `<section><h2>실행 이벤트 · ${esc(runName(item))}</h2><p class="lead">같은 실행 ID에 기록된 이벤트와 상관 ID를 표시한다.</p><div class="panel"><table><thead><tr><th>이벤트</th><th>결과</th><th>상관 ID</th><th>발생 시각</th></tr></thead><tbody>${eventRows(item)}</tbody></table></div></section>`;

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>해온카드 진단 API · 실행 증거 리포트</title>
<style>
:root{--ink:#1e2926;--muted:#6d7974;--line:#dce6e2;--paper:#fff;--bg:#f4f7f5;--brand:#087b72;--deep:#073d39;--green:#08785f;--amber:#a4650a;--red:#b33f49}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Pretendard Variable",Pretendard,"Noto Sans KR",system-ui,sans-serif;line-height:1.6;word-break:keep-all}.wrap{max-width:1120px;margin:auto;padding:0 22px}.top{background:linear-gradient(118deg,#092f2d,#0c7168 68%,#398b77);color:#fff;padding:30px 0}.top h1{margin:0;font-size:25px;letter-spacing:-.04em}.top p{margin:7px 0 0;color:#d9eee7;font-size:11px}.main{padding:24px 0 56px}section{margin-top:25px}h2{font-size:16px;margin:0 0 4px}.lead{margin:0 0 11px;color:var(--muted);font-size:11px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.tile,.panel{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px}.tile{border-top:3px solid var(--brand)}.tile header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.tile h3{font-size:12px;margin:0}.tile dl{font-size:10px;margin:0}.tile dl div{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid #eff3f1}.tile dt{color:var(--muted)}.tile dd{margin:0;font-weight:750;text-align:right;overflow-wrap:anywhere}.tile footer{margin-top:8px;color:#8d9994;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.badge{display:inline-block;border-radius:99px;padding:3px 8px;font-size:9px;font-weight:850;white-space:nowrap}.badge.ok{background:#e5f5ef;color:var(--green)}.badge.alert{background:#fff4df;color:var(--amber)}.badge.fail{background:#fff0f1;color:var(--red)}.badge.none{background:#edf1ef;color:#7b8782}.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.panel h3{font-size:12px;margin:0 0 7px}.panel p{font-size:10px;color:var(--muted);margin:5px 0}.panel .big{font-size:13px;color:var(--deep);font-weight:800}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}th{background:#f3f8f6;color:#45625a}.mono{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.note{padding:10px 12px;border:1px solid #ebdcba;background:#fffaf0;border-radius:8px;color:#69572f;font-size:10px}.flow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.flow span{background:#e8f5f0;color:#155a4b;padding:6px 8px;border-radius:6px;font-size:10px;font-weight:800}.flow b{color:#9aa7a2}.foot{margin-top:32px;padding-top:13px;border-top:1px solid var(--line);font-size:10px;color:var(--muted)}
@media(max-width:720px){.pair{grid-template-columns:1fr}.wrap{padding-left:14px;padding-right:14px}.top{padding:24px 0}}@media print{body{background:white}.tile,.panel{break-inside:avoid}}
</style></head><body>
<header class="top"><div class="wrap"><h1>해온카드 결제 연동 진단 API · 실행 증거</h1><p>HAEON-DIAG-01 · 생성 ${esc(generated)} · evidence/runs/에서 읽은 실행 파일 기준</p></div></header>
<main class="wrap main">
<section><h2>판정 요약</h2><p class="lead">정상 기준선, 취약 입력 처리, 자료 전송, 운영자 대응, 개선 통제 결과를 실행 증거와 대조한다.</p><div class="tiles">
${tile('정상 진단',normal?.response?.result,[['대상',esc(normal?.response?.targetId || '-')],['응답 시간',normal?.response?.latencyMs != null ? `${esc(normal.response.latencyMs)} ms` : '-'],['실행 시각',esc(runName(normal))]],normal?.dir)}
${tile('Before · 최초 진입',before?.attack?.result,[['실행 모드',esc(before?.scenario?.mode || '-')],['제한 세션',before?.attack?.shellSessionToken ? '생성됨' : '-'],['조회 건수',`${esc(count(before))}건`],['전송 결과',esc(before?.transfer?.receiverStatus || '-')]],before?.dir)}
${tile('내부 수신 증거',before?.transfer?.receiverStatus,[['전송 ID',esc(before?.transfer?.transferId || '-')],['수신 건수',`${esc(before?.transfer?.recordCount ?? '-')}건`],['SHA-256',`<span class="mono">${esc(safeHash(before))}</span>`]],before?.dir)}
${tile('운영자 대응',before?.response?.result,[['실행 상태',esc(before?.state?.status || '-')],['경보 상태',esc(before?.state?.alertStatus || '-')],['보호 안내',before?.response?.protectionNoticeCreated ? '기록됨' : '-']],before?.dir)}
${tile('After · 입력 차단',after?.attack?.errorCode || after?.attack?.result,[['실행 모드',esc(after?.scenario?.mode || '-')],['응답 코드',esc(httpStatus(after))],['제한 세션',after?.attack?.shellSessionToken ? '확인 필요' : '없음'],['실행 상태',esc(after?.state?.status || '-')]],after?.dir)}
</div></section>
<section><h2>실행 흐름</h2><p class="lead">Before와 After는 각각 별도 실행 ID를 사용하며, 대응은 Before 실행에 적용한다.</p><div class="panel"><div class="flow"><span>가맹점 로그인</span><b>›</b><span>정상 진단 ${esc(normal?.response?.result || '미실행')}</span><b>›</b><span>Before ${esc(before?.attack?.result || '미실행')}</span><b>›</b><span>전송 ${esc(before?.transfer?.receiverStatus || '미확인')}</span><b>›</b><span>대응 ${esc(before?.state?.status || '미확인')}</span><b>›</b><span>After ${esc(after?.attack?.errorCode || after?.attack?.result || '미실행')}</span></div></div></section>
${eventSection(before)}
${eventSection(after)}
<section><h2>증거 파일과 판독 기준</h2><p class="lead">각 실행 폴더의 요청, 응답, 이벤트 및 수신 결과를 교차 확인한다.</p><div class="pair"><article class="panel"><h3>Before · ${esc(runName(before))}</h3><p>폴더: <code class="mono">${esc(before?.dir || '실행 기록 없음')}</code></p><p>조회 자료: <strong>${esc(count(before))}건</strong> · 수신 결과: ${verdict(before?.transfer?.receiverStatus)}</p><p>전송 ID: <code class="mono">${esc(before?.transfer?.transferId || '-')}</code></p><p>SHA-256: <code class="mono">${esc(safeHash(before))}</code></p><p>대응 명령 결과: ${verdict(before?.response?.result)}</p></article><article class="panel"><h3>After · ${esc(runName(after))}</h3><p>폴더: <code class="mono">${esc(after?.dir || '실행 기록 없음')}</code></p><p>응답 결과: ${verdict(after?.attack?.errorCode || after?.attack?.result)}</p><p>후속 자료 조회 및 전송: 차단 요청 뒤 미실행</p><p>요약: <code class="mono">${esc(after?.summary || '실행 기록 없음')}</code></p><p>검증: <code class="mono">${esc(after?.verification || '검증 자료 없음')}</code></p></article></div><p class="note">응답 파일에는 세션 토큰이 포함될 수 있으므로 공유 화면에서 원문을 열지 않는다. 이 리포트에는 토큰과 자료 원문을 표시하지 않는다.</p></section>
<footer class="foot">생성 도구: <code>tools/evidence-report.sh</code> · 입력 위치: <code>${esc(RUNS)}/</code> · 기존 카드 승인·결제 회귀 실행 자료는 이 리포트 생성 과정에서 수정하거나 삭제하지 않는다.</footer>
</main></body></html>`;

fs.mkdirSync(path.dirname(OUT), {recursive:true});
fs.writeFileSync(OUT, html, 'utf8');
console.log(`HAEON-DIAG-01 증거 리포트 생성: ${OUT}`);
console.log(`기준선: ${runName(normal)} · Before: ${runName(before)} · After: ${runName(after)}`);
