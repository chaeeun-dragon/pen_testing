// 해온카드 회원 포털 화면 점검. tools/portal-ui-check.sh가 컨테이너 안에서 실행한다.
// 실제 Chromium으로 랜딩(/)과 마이페이지(/mypage)를 오가며 조회 흐름을 확인한다.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.env.PORTAL_URL || 'http://127.0.0.1:8085';
const LOGIN_ID = process.env.PORTAL_LOGIN_ID || 'haeon01';
const PASSWORD = process.env.PORTAL_PASSWORD || 'Haeon!2026';
const OUT = process.env.OUT_DIR || '/out';
const EXPECT_CARDS = Number(process.env.EXPECT_CARDS || 3);

const results = [];
const check = (name, okFlag, detail = '') => {
  results.push({ name, result: okFlag ? 'PASS' : 'FAIL', detail });
  console.log(`  ${okFlag ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const page = await browser.newPage();
const jsErrors = [];
const httpErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });
page.on('response', r => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });
await page.setViewport({ width: 1440, height: 1200 });

console.log('1. 랜딩 (로그아웃)');
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
check('랜딩에 회원 조회 영역이 없다', await page.$('#mypageBody') === null);
check('MY 메뉴가 /mypage로 연결', await page.$eval('#myNav', a => a.getAttribute('href')) === '/mypage');
check('빠른 메뉴가 모두 /mypage로 연결', await page.$$eval('.quick-link', ns => ns.every(n => n.getAttribute('href') === '/mypage')));
await page.screenshot({ path: `${OUT}/1-landing-logged-out.png` });

console.log('2. 마이페이지 (로그아웃)');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#myNav')]);
check('주소가 /mypage', page.url().endsWith('/mypage'), page.url());
check('로그인 카드 표시', await page.$eval('#mypageLogin', n => !n.hidden));
check('조회 본문 숨김', await page.$eval('#mypageBody', n => n.hidden));
check('마케팅 섹션 없음', await page.$('#cards') === null);
await page.screenshot({ path: `${OUT}/2-mypage-login.png` });

console.log('3. 로그인 후 조회');
await page.type('#loginId', LOGIN_ID);
await page.type('#loginPassword', PASSWORD);
await page.click('#loginSubmit');
await page.waitForFunction(n => document.querySelectorAll('#mypageCards .card-row').length === n,
  { timeout: 20000 }, EXPECT_CARDS);
check('같은 주소에서 조회 화면 전환', page.url().endsWith('/mypage')
  && await page.$eval('#mypageBody', n => !n.hidden) && await page.$eval('#mypageLogin', n => n.hidden));
check(`보유 카드 ${EXPECT_CARDS}장`, (await page.$$('#mypageCards .card-row')).length === EXPECT_CARDS);
const history = (await page.$$('#mypageHistory .history-row')).length;
check('이용내역 1건 이상', history >= 1, `${history}건`);
const bodyText = await page.$eval('#mypage', n => n.textContent);
check('카드 토큰 미노출', !/card-token/.test(bodyText));
check('한도 version 미노출', !/version/i.test(bodyText));
check('금지 표현 없음', !/실습|테스트|시뮬레이션|공격|가상|모의|팀 프로젝트/.test(bodyText));
await page.screenshot({ path: `${OUT}/3-mypage-logged-in.png`, fullPage: true });

console.log('4. 랜딩 복귀 (세션 유지)');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.breadcrumb a')]);
await page.waitForFunction(() => !document.getElementById('myAccountView').hidden, { timeout: 15000 });
check('랜딩에서 로그인 유지', await page.$eval('#myAccountView', n => !n.hidden));
check('랜딩에 개인 상세 미노출', await page.$('#mypageProfile') === null);
await page.screenshot({ path: `${OUT}/4-landing-logged-in.png` });

console.log('5. 로그아웃');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.my-actions a')]);
await page.waitForFunction(() => document.querySelectorAll('#mypageCards .card-row').length > 0, { timeout: 20000 });
await page.click('#headerLogin');
await page.waitForFunction(() => !document.getElementById('mypageLogin').hidden, { timeout: 15000 });
check('로그아웃 후 로그인 카드로 복귀', await page.$eval('#mypageBody', n => n.hidden));
check('세션 토큰 삭제', await page.evaluate(() => localStorage.getItem('haeon.session.token')) === null);

console.log('6. 화면 구조 점검 (홈 · 마이페이지)');
const structure = async (path, label) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
    const dupIds = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    const anchors = [...new Set([...document.querySelectorAll('a[href^="#"]')]
      .map(a => a.getAttribute('href')).filter(h => h.length > 1))];
    const deadAnchors = anchors.filter(h => !document.getElementById(h.slice(1)));
    const badRefs = [];
    ['aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(attr =>
      document.querySelectorAll(`[${attr}]`).forEach(n =>
        n.getAttribute(attr).split(/\s+/).filter(Boolean).forEach(id => {
          if (!document.getElementById(id)) badRefs.push(`${attr}=${id}`);
        })));
    const badLabels = [...document.querySelectorAll('label[for]')]
      .filter(l => !document.getElementById(l.getAttribute('for'))).map(l => l.getAttribute('for'));
    const unnamed = [...document.querySelectorAll('input, select, textarea')].filter(e =>
      e.type !== 'hidden' && !(e.id && document.querySelector(`label[for="${e.id}"]`))
      && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.placeholder)
      .map(e => e.id || e.name);
    const band = document.querySelector('.page-top');
    return {
      dupIds, deadAnchors, badRefs, badLabels, unnamed,
      bandOk: !band || (!!band.querySelector('.home-top') && !!band.querySelector('.quick-links')
                        && !band.querySelector('#mypage') && !band.querySelector('#cards')),
      pageBg: getComputedStyle(document.querySelector('.page')).backgroundImage,
      leftovers: ['paymentModal', 'myPaymentButton', 'haeonCardUi', '즉시결제']
        .filter(t => document.documentElement.outerHTML.includes(t)),
    };
  });
};
for (const [path, label] of [['/', '홈'], ['/mypage', '마이페이지']]) {
  const r = await structure(path, label);
  check(`${label}: 중복 id 없음`, r.dupIds.length === 0, r.dupIds.join(','));
  check(`${label}: 끊긴 앵커 없음`, r.deadAnchors.length === 0, r.deadAnchors.join(','));
  check(`${label}: aria 참조 유효`, r.badRefs.length === 0, r.badRefs.join(','));
  check(`${label}: label[for] 유효`, r.badLabels.length === 0, r.badLabels.join(','));
  check(`${label}: 입력에 접근 가능한 이름`, r.unnamed.length === 0, r.unnamed.join(','));
  check(`${label}: 상단 밴드 범위 정상`, r.bandOk);
  check(`${label}: 배경 고정 픽셀 경계 없음`, !/px/.test(r.pageBg) || r.pageBg === 'none', r.pageBg);
  check(`${label}: 제거된 결제 기능 잔재 없음`, r.leftovers.length === 0, r.leftovers.join(','));
}

check('JS 오류 없음', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));
check('4xx/5xx 응답 없음', httpErrors.length === 0, httpErrors.slice(0, 3).join(' | '));

await browser.close();

const failures = results.filter(r => r.result === 'FAIL');
const verdict = failures.length ? 'FAIL' : 'PASS';
fs.writeFileSync(`${OUT}/summary.txt`,
  results.map(r => `${r.result}\t${r.name}${r.detail ? `\t${r.detail}` : ''}`).join('\n')
  + `\n\nchecks: ${results.length}\nfailures: ${failures.length}\nresult: ${verdict}\n`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({
  result: verdict, checks: results.length, failures: failures.length, baseUrl: BASE, results }, null, 2));
console.log(`\n포털 화면 점검: ${verdict} (${results.length - failures.length}/${results.length})`);
process.exit(failures.length ? 1 : 0);
