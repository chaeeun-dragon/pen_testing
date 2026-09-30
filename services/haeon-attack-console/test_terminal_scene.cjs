// Offline command parser, evidence, and interactive-controller tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('./www/terminal-scene-core.js');
assert.equal(core.parse(' LAB   before '),'lab before');
for(const raw of ['curl https://example.com','lab before; whoami','lab records --url x','rm -rf /','', 'x'.repeat(81)])assert.equal(core.parse(raw),null);
const makeStage=(label,status,detail={})=>({label,status,detail,at:'2026-09-29T00:00:00Z'});
const base={runId:'BASE-1',mode:'baseline',status:'COMPLETED',stages:[makeStage('등록 대상 연결 진단','SUCCESS')]};
const before={runId:'BEFORE-1',mode:'before',status:'ALERT',baselineRunId:base.runId,stages:[makeStage('제한된 모의 웹 세션 생성','ALERT'),makeStage('합성 지원 자료 조회','ALERT',{recordCount:1}),makeStage('내부 수신기로 전송','ALERT',{recordCount:1,runId:'BEFORE-1',transferId:'TRANSFER-BEFORE-1',receiverStatus:'RECEIVED',payloadSha256:'a'.repeat(64)})]};
const after={runId:'AFTER-1',mode:'after',status:'BLOCKED',beforeRunId:'BEFORE-1',stages:[makeStage('비정상 진단 입력 탐지·차단','BLOCKED',{httpStatus:403,errorCode:'DIAGNOSTIC_INPUT_BLOCKED'}),makeStage('After 정상 진단 재검증','SUCCESS',{httpStatus:200})]};
assert.equal(core.facts(before).received,true);
assert.equal(core.facts({...before,runId:'OTHER'}).received,false);
assert.equal(core.compare(before,after,base)[3][2],'정상 유지');
assert.equal(core.compare(before,{...after,beforeRunId:'OTHER'},base)[0][2],'미확인');
assert.equal(core.facts({...after,stages:[...after.stages,makeStage('After 정상 진단 재검증','ERROR')]}).normalAfter,false);
class Element {
  constructor(){this.children=[];this.dataset={};this.textContent='';this.value='';this.handlers={};this.hidden=false;this.disabled=false;const values=new Set();this.classList={toggle:(key,on)=>{const yes=on===undefined?!values.has(key):on;yes?values.add(key):values.delete(key);return yes;}};}
  append(...items){items.forEach(item=>{item.parent=this;this.children.push(item);});}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,handler){this.handlers[name]=handler;}
  setAttribute(){} focus(){} click(){} remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);}
  get firstChild(){return this.children[0];}
}
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};
(async()=>{
  const html=fs.readFileSync(path.join(__dirname,'www/terminal-scene.html'),'utf8');
  assert.doesNotMatch(html,/service-window|sceneResult|<iframe\b/);
  for(const url of ['http://www.haeoncard.co.kr/','http://www.haeoncard.co.kr/mypage'])assert.ok(html.includes('href="'+url+'" target="_blank" rel="noopener"'));
  assert.ok(html.includes('href="/" target="_blank" rel="noopener"'));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  const els=Object.fromEntries(ids.map(id=>[id,new Element()]));let runs=[],pending=null,requests=[],periodicRefresh;
  const overview=()=>({runs,targetConnected:true,pendingResponseRunId:pending});
  const document={hidden:false,body:new Element(),getElementById:id=>{assert.ok(els[id],id);return els[id];},querySelectorAll:()=>[],createElement:()=>new Element()};
  const context={document,window:{TerminalSceneCore:core},setInterval(callback){periodicRefresh=callback;},setTimeout,Blob,URL,fetch:async(url,options)=>{
    requests.push([url,options]);const body=options.body?JSON.parse(options.body):null;let data={},status=200;
    if(url==='/api/overview')data=overview();
    else if(url==='/api/runs') {const run=structuredClone({baseline:base,before,after}[body.mode]);runs.unshift(run);if(body.mode==='before')pending=run.runId;data=run;}
    else if(url.endsWith('/respond')){const run=runs.find(r=>r.mode==='before');run.status='CONTAINED';run.containmentVerified=true;pending=null;run.stages.push(makeStage('실행 세션 폐기 및 회원 보호 안내 등록','BLOCKED',{protectionNoticeCreated:true}),...['이전 세션 재조회 거부 검증','이전 세션 재전송 거부 검증'].map(label=>makeStage(label,'BLOCKED',{httpStatus:403,errorCode:'SHELL_SESSION_REVOKED'})));data={run};}
    else if(url.startsWith('/api/runs/'))data={run:runs.find(run=>url.endsWith(run.runId))};
    else if(url==='/api/card03/compare')data={comparisonId:'CARD03-TEST',verified:true,regression:{passed:true},before:{approvedCount:2,approvedAmount:120000,attempts:[{requestId:'TX-1',observedRemaining:100000,result:'APPROVED'}]},after:{approvedCount:1,approvedAmount:60000,attempts:[{requestId:'TX-2',observedRemaining:40000,result:'DECLINED'}]}};
    else if(url==='/api/terminal/records'){const run=runs.find(r=>r.mode==='before');if(run.status==='CONTAINED'){status=403;data={errorCode:'SHELL_SESSION_REVOKED'};}else data={runId:run.runId,simulation:true,recordCount:1,records:[{supportRef:'SUP-202609-01',memberNo:'HC-MEMBER-001',cardLast4:'2001',transactionRef:'LAB-TXN-001',amount:13700}],source:'live-lab-records-query'};}
    return {ok:status===200,status,json:async()=>data};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'www/terminal-scene.js'),'utf8'),context);await flush();
  assert.equal(els.output.children.length,0,'Startup must not print a banner or tutorial');
  await periodicRefresh();assert.equal(els.output.children.length,0,'Idle refresh must stay quiet');
  const command=async value=>{els.commandInput.value=value;els.commandForm.handlers.submit({preventDefault(){}});await flush();assert.equal(els.commandInput.disabled,false);};
  const contents=e=>[e.textContent,...e.children.map(contents)].join('\n');
  const text=()=>contents(els.output);
  await command('id; curl x');assert.ok(text().includes('알 수 없는 명령'));assert.equal(requests.filter(([,o])=>o.method==='POST').length,0);
  await command('lab before');assert.ok(text().includes('기준선 없음 · lab baseline 필요'));assert.equal(runs.length,0);
  await command('lab baseline');assert.ok(text().includes('[VERIFY] 정상 연결 확인'));
  await command('lab before');assert.ok(text().includes('[RECEIVED] 1건 · 내부 수신 확인'));
  await command('lab records');assert.ok(text().includes('[HTTP 200] 1건'));
  assert.ok(text().includes('HC-MEMBER-001'));assert.ok(text().includes('**** 2001'));
  await command('lab receipt');assert.ok(text().includes('TRANSFER-BEFORE-1'));
  await command('lab contain');assert.ok(text().includes('재조회·재전송 HTTP 403 확인'));assert.ok(text().includes('[NOTICE] HC-MEMBER-001 · 보호 안내 등록'));
  await command('lab records');assert.ok(text().includes('[HTTP 403] SHELL_SESSION_REVOKED'));
  await command('lab after');await command('lab compare');assert.ok(text().includes('[VERIFY] 차단 + 정상 기능 유지 확인'));assert.ok(text().includes('정상 유지'));assert.ok(text().includes('[PAIR] BEFORE-1 → AFTER-1'));
  await command('lab card03');assert.ok(text().includes('[CARD-03] 격리 합성 장부'));assert.ok(text().includes('120,000원'));assert.ok(text().includes('[REGRESSION] PASS'));
  await command('lab compare');assert.equal(els.terminalStatus.textContent,'READY');
  assert.doesNotMatch(text(),/VIRTUAL LAB TERMINAL|웹 화면:|실제 사이트는|실제 OS|이 표는|뜻은 아닙니다|실행하세요|확인하세요|\[NEXT\]|\[SCOPE\]|\[REQUEST\]|\[QUERY\]|\[RESPONSE\]|https?:/);
  const writes=requests.filter(([,o])=>o.method==='POST').length;
  await command('clear');assert.equal(requests.filter(([,o])=>o.method==='POST').length,writes);assert.equal(runs.length,3);assert.equal(els.output.children.length,0);
  runs.unshift({...structuredClone(before),runId:'BEFORE-2'});pending='BEFORE-2';
  await periodicRefresh();assert.equal(els.output.children.length,0,'Background state changes must not insert narration');assert.equal(els.terminalStatus.textContent,'STATE CHANGED');
  await command('help');assert.ok(text().includes('허용된 가상 명령어'));assert.ok(text().includes('lab records'));
  await command('clear');assert.equal(els.output.children.length,0);assert.equal(requests.filter(([,o])=>o.method==='POST').length,writes);
  console.log('PASS: clean startup, results-only commands, silent refresh, help on demand, empty non-destructive clear, parser, receipt integrity, paired comparison, full command flow, real denial rendering');
})().catch(error=>{console.error(error);process.exitCode=1;});
