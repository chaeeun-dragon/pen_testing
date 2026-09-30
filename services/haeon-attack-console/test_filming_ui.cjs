// Offline DOM/controller regression tests. Never call the running lab.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = fs.existsSync(path.join(__dirname, 'www')) ? path.join(__dirname, 'www') : __dirname;
const html = fs.readFileSync(path.join(root, 'filming.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'filming.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.handlers = {}; this.textContent = ''; this.hidden = false;
    const values = new Set();
    this.classList = {add:x=>values.add(x), toggle:(x,on)=>on?values.add(x):values.delete(x)};
  }
  append(...nodes) { this.children.push(...nodes); }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const flush = async () => { for(let i=0;i<4;i++) await new Promise(setImmediate); };
const stage = (label,status,detail={}) => ({label,status,detail});
function fixture(verified=true, pending=false) {
  const baseline = {runId:'BASE-1',mode:'baseline',status:'COMPLETED',createdAt:'2026-09-29T00:00:00Z'};
  const before = {runId:'BEFORE-1',mode:'before',status:pending?'ALERT':'CONTAINED',baselineRunId:'BASE-1',containmentVerified:verified,createdAt:baseline.createdAt,stages:[
    stage('진단 요청 전송','SUCCESS',{httpStatus:200}),stage('제한된 모의 웹 세션 생성','ALERT'),
    stage('합성 지원 자료 조회','SUCCESS',{recordCount:20}),stage('내부 수신기로 전송','SUCCESS',{recordCount:20,receiverStatus:'RECEIVED',transferId:'TX-TEST',payloadSha256:'a'.repeat(64)}),
    stage('이전 세션 재조회 거부 검증',verified?'BLOCKED':'ERROR',{httpStatus:verified?403:502}),
    stage('이전 세션 재전송 거부 검증',verified?'BLOCKED':'ERROR',{httpStatus:verified?403:502})]};
  const after = {runId:'AFTER-1',mode:'after',status:'BLOCKED',beforeRunId:'BEFORE-1',createdAt:baseline.createdAt,stages:[
    stage('비정상 진단 입력 탐지·차단','BLOCKED',{httpStatus:403}),stage('After 정상 진단 재검증','SUCCESS',{httpStatus:200})]};
  return {runs:[after,before,baseline],pendingResponseRunId:pending?before.runId:null,targetConnected:true};
}
async function boot(data,search='',fail=false) {
  const elements = Object.fromEntries(ids.map(id=>[id,new Element()]));
  const requests=[];
  const context={document:{hidden:false,body:new Element(),getElementById:id=>{assert.ok(elements[id],`Missing #${id}`);return elements[id];},createElement:()=>new Element()},
    URLSearchParams,location:{search,reload(){}},setInterval(){},Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},
    fetch:async (url,options)=>{
      requests.push({url,options}); if(fail) throw Error('offline');
      let body = url==='/api/overview'?data:url==='/api/card03'?{runs:[]}:url.startsWith('/api/runs/')?{run:data.runs.find(r=>url.endsWith(r.runId))}:{runId:'NEW-1'};
      return {ok:true,json:async()=>body};
    }};
  vm.runInNewContext(script,context); await flush();
  return {el:elements,requests};
}
(async()=>{
  let ui = await boot(fixture());
  assert.equal(ui.el.before.disabled,false); assert.equal(ui.el.after.disabled,false); assert.equal(ui.el.respond.disabled,true);
  assert.equal(ui.el.bRecords.textContent,'20건 조회'); assert.equal(ui.el.aInput.textContent,'HTTP 403 · 입력 허용 목록');
  assert.equal(ui.el.aNormal.textContent,'HTTP 200 · 정상 기능 유지'); assert.equal(ui.el.transferId.textContent,'TX-TEST');
  assert.equal(ui.el.beforeSteps.children.length,6);
  ui.el.cardTab.handlers.click(); assert.equal(ui.el.diagPanel.hidden,true); assert.equal(ui.el.cardPanel.hidden,false);
  ui.el.historyTab.handlers.click(); await flush(); assert.equal(ui.el.historyPanel.hidden,false);
  await ui.el.historyList.children[1].handlers.click(); assert.equal(ui.el.historySteps.children.length,6);
  ui.el.reset.handlers.click(); assert.equal(ui.el.resetDialog.open,true);
  ui.el.cancelReset.handlers.click(); assert.equal(ui.el.resetDialog.open,false);
  assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,0);
  ui = await boot(fixture(false)); assert.equal(ui.el.after.disabled,true); assert.equal(ui.el.respond.disabled,false);
  ui = await boot(fixture(false,true)); for(const id of ['before','after','cardRun']) assert.equal(ui.el[id].disabled,true);
  assert.equal(ui.el.respond.disabled,false);
  ui = await boot(fixture(),'?view=results');
  for(const id of ['baseline','before','respond','after','cardRun','reset']) assert.equal(ui.el[id].disabled,true);
  await ui.el.before.handlers.click(); assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,0);
  ui = await boot({runs:[],targetConnected:true}); assert.equal(ui.el.after.disabled,true); assert.equal(ui.el.beforeStatus.textContent,'미실행');
  ui = await boot(fixture(),'',true); for(const id of ['baseline','before','after','respond','cardRun','reset']) assert.equal(ui.el[id].disabled,true);
  assert.equal(ui.el.error.hidden,false);
  console.log('PASS: 7 UI state cases; comparison, history, navigation, reset cancel, retry, results-only, offline guards');
})().catch(error=>{console.error(error);process.exitCode=1;});
