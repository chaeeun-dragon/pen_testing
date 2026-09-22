// 해온카드 가맹점 화면과 운영 콘솔의 브라우저 회귀 점검.
// wrapper는 이 파일을 일회성 Playwright 컨테이너에서 실행한다.
// 모든 동작은 공개 UI를 통해서만 수행하며, DB와 관리 API를 직접 호출하지 않는다.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const merchantUrl = process.env.MERCHANT_URL || 'http://127.0.0.1:8090/merchant/';
const consoleUrl = process.env.ATTACK_CONSOLE_URL || 'http://127.0.0.1:8094/';
const merchantLoginId = process.env.MERCHANT_LOGIN_ID || 'labmart';
const merchantPassword = process.env.MERCHANT_PASSWORD || 'LabMart!2026';
const outputDir = process.env.OUT_DIR || '/out';
const runId = process.env.RUN_ID || path.basename(outputDir);

fs.mkdirSync(outputDir, { recursive: true });

const startedAt = new Date().toISOString();
const checks = [];
const artifacts = [];
const pageErrors = [];
const httpErrors = [];
let merchantResult = null;
let consoleResult = null;
let fatalError = null;
let browser;
let merchantPage;
let consolePage;

const redact = value => String(value || '')
  .replace(/(authorization|token|password|session)[=:]\s*[^\s,;]+/ig, '$1=[REDACTED]')
  .slice(0, 500);

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return redact(value);
  }
}

function addCheck(name, passed, detail = '') {
  const item = { name, result: passed ? 'PASS' : 'FAIL' };
  if (detail) item.detail = redact(detail);
  checks.push(item);
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + item.detail : ''));
}

function requireCheck(name, passed, detail = '') {
  addCheck(name, passed, detail);
  if (!passed) throw new Error(name + (detail ? ': ' + detail : ''));
}

function attachTelemetry(page, label) {
  page.on('pageerror', error => pageErrors.push({ page: label, message: redact(error.message) }));
  page.on('console', message => {
    if (message.type() === 'error') {
      pageErrors.push({ page: label, message: redact('console: ' + message.text()) });
    }
  });
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      httpErrors.push({ page: label, status: response.status(), url: safeUrl(response.url()) });
    }
  });
}

async function screenshot(page, fileName) {
  const file = path.join(outputDir, fileName);
  await page.screenshot({ path: file, fullPage: true });
  artifacts.push(fileName);
}

async function text(page, selector) {
  return (await page.locator(selector).innerText()).trim();
}

async function waitUntil(label, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = redact(error && error.message ? error.message : error);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(label + ' timed out' + (lastError ? ': ' + lastError : ''));
}

async function verifyMerchantFlow() {
  await merchantPage.goto(merchantUrl, { waitUntil: 'domcontentloaded' });
  await merchantPage.locator('#loginPanel').waitFor({ state: 'visible', timeout: 15000 });

  requireCheck('가맹점 로그인 화면 표시', await merchantPage.locator('#loginPanel').isVisible());
  requireCheck('가맹점 로그인 입력 요소 표시',
    await merchantPage.locator('#loginId').count() === 1
    && await merchantPage.locator('#password').count() === 1
    && await merchantPage.locator('#loginButton').count() === 1);
  requireCheck('가맹점 진단 화면 제목 표시',
    (await text(merchantPage, '.page-heading h1')).includes('결제 연동 점검'));
  await screenshot(merchantPage, '01-merchant-login.png');

  await merchantPage.locator('#loginId').fill(merchantLoginId);
  await merchantPage.locator('#password').fill(merchantPassword);
  await merchantPage.locator('#loginButton').click();
  await merchantPage.locator('#diagnosticPanel').waitFor({ state: 'visible', timeout: 15000 });

  const targetCount = await merchantPage.locator('#target option').count();
  requireCheck('가맹점 로그인 후 등록 진단 대상 표시', targetCount > 0, String(targetCount) + '개');
  requireCheck('로그인 후 연결 상태 확인 버튼 표시',
    await merchantPage.locator('#runButton').isVisible());

  await merchantPage.locator('#runButton').click();
  await merchantPage.locator('#resultPanel.visible').waitFor({ state: 'visible', timeout: 15000 });

  const title = await text(merchantPage, '#resultTitle');
  const status = await text(merchantPage, '#resultStatus');
  const latency = await text(merchantPage, '#resultLatency');
  requireCheck('가맹점 정상 진단 결과 표시', title.includes('연결 상태 정상') && status === '정상',
    title + ' / ' + status);
  requireCheck('가맹점 정상 진단 응답 시간 표시', /^\d+\s*ms$/.test(latency), latency);
  await screenshot(merchantPage, '02-merchant-diagnostic-success.png');

  merchantResult = { targetCount, title, status, latency };

  await merchantPage.locator('#headerLogout').click();
  await merchantPage.locator('#loginPanel').waitFor({ state: 'visible', timeout: 10000 });
  requireCheck('가맹점 로그아웃 후 로그인 화면 복귀', await merchantPage.locator('#loginPanel').isVisible());
}

async function verifyConsoleFlow() {
  await consolePage.goto(consoleUrl, { waitUntil: 'domcontentloaded' });
  await consolePage.locator('#overviewView h1').filter({ hasText: '진단 API 침해 시나리오' })
    .waitFor({ state: 'visible', timeout: 15000 });
  await waitUntil('공격 콘솔 연결 상태', async () => {
    const connection = await text(consolePage, '#connectionText');
    return connection !== '' && !connection.includes('확인 중');
  });

  requireCheck('공격 콘솔 시나리오 제목 표시',
    (await text(consolePage, '#overviewView h1')).includes('진단 API 침해 시나리오'));
  const modes = await consolePage.locator('[data-run-mode]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-run-mode')));
  requireCheck('공격 콘솔 실행 제어 표시',
    ['baseline', 'before', 'after'].every(mode => modes.includes(mode)), modes.join(','));
  requireCheck('공격 콘솔 단계와 로그 영역 표시',
    await consolePage.locator('#stageList').isVisible()
    && await consolePage.locator('#eventList').isVisible()
    && await consolePage.locator('#stepLogList').count() === 1);
  const readiness = await text(consolePage, '#targetReadiness');
  requireCheck('공격 콘솔 대상 상태 표시', readiness !== '' && readiness !== '확인 중', readiness);
  await screenshot(consolePage, '03-attack-console-overview.png');

  await waitUntil('공격 콘솔 정상 진단 버튼 활성화',
    async () => !(await consolePage.locator('[data-run-mode="baseline"]').isDisabled()), 25000);
  await consolePage.locator('[data-run-mode="baseline"]').click();
  await waitUntil('공격 콘솔 정상 진단 결과',
    async () => ['완료', '오류'].includes(await text(consolePage, '#activityStatus')), 30000);

  const runStatus = await text(consolePage, '#activityStatus');
  const run = await text(consolePage, '#activityRunId');
  const stageText = await text(consolePage, '#stageList');
  requireCheck('공격 콘솔 정상 진단 실행 완료', runStatus === '완료', runStatus);
  requireCheck('공격 콘솔 실행 ID 표시', /^HAEON-BASELINE-/.test(run), run);
  requireCheck('공격 콘솔 단계 결과 표시', stageText.includes('등록 대상 연결 진단'), stageText);

  await consolePage.locator('[data-log-tab="steps"]').click();
  await consolePage.locator('#stepLogList').waitFor({ state: 'visible', timeout: 5000 });
  const stepCount = await consolePage.locator('#stepLogList .event-row').count();
  requireCheck('공격 콘솔 실행 로그 표시', stepCount >= 3, String(stepCount) + '개');
  await screenshot(consolePage, '04-attack-console-baseline-completed.png');

  consoleResult = { runId: run, status: runStatus, stageRows: stepCount, readiness };
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const context = await browser.newContext({
    locale: 'ko-KR',
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  merchantPage = await context.newPage();
  consolePage = await context.newPage();
  attachTelemetry(merchantPage, 'merchant');
  attachTelemetry(consolePage, 'attack-console');

  await verifyMerchantFlow();
  await verifyConsoleFlow();
} catch (error) {
  fatalError = redact(error && error.message ? error.message : error);
  addCheck('브라우저 동선 완료', false, fatalError);
  for (const [page, file] of [[merchantPage, 'failure-merchant.png'], [consolePage, 'failure-attack-console.png']]) {
    if (!page || page.isClosed()) continue;
    try {
      await screenshot(page, file);
    } catch {
      // 이미 실패한 실행에서는 화면 캡처 실패를 별도 오류로 만들지 않는다.
    }
  }
} finally {
  if (browser) await browser.close();
}

addCheck('브라우저 JavaScript 오류 없음', pageErrors.length === 0,
  pageErrors.map(item => item.page + ': ' + item.message).join(' | '));
addCheck('UI 요청 4xx/5xx 없음', httpErrors.length === 0,
  httpErrors.map(item => item.status + ' ' + item.url).join(' | '));

const failures = checks.filter(item => item.result === 'FAIL');
const report = {
  result: failures.length ? 'FAIL' : 'PASS',
  runId,
  startedAt,
  finishedAt: new Date().toISOString(),
  target: {
    merchantUrl: safeUrl(merchantUrl),
    attackConsoleUrl: safeUrl(consoleUrl),
  },
  execution: {
    usedSyntheticMerchantFixture: true,
    directDatabaseAccess: false,
    directManagementApiAccess: false,
  },
  merchantResult,
  consoleResult,
  checks,
  fatalError,
  artifacts,
};
fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(outputDir, 'browser-errors.json'), JSON.stringify({
  pageErrors,
  httpErrors,
}, null, 2) + '\n');

const hashes = {};
for (const file of fs.readdirSync(outputDir).sort()) {
  if (file === 'sha256.json') continue;
  const fullPath = path.join(outputDir, file);
  if (fs.statSync(fullPath).isFile()) {
    hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  }
}
fs.writeFileSync(path.join(outputDir, 'sha256.json'), JSON.stringify(hashes, null, 2) + '\n');

console.log('\nUI flow result: ' + report.result + ' (' + (checks.length - failures.length) + '/' + checks.length + ')');
console.log('Evidence: ' + outputDir);
process.exitCode = failures.length ? 1 : 0;
