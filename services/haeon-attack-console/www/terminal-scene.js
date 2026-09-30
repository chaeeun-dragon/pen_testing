(() => {
  'use strict';
  const {commands,parse,facts,compare} = window.TerminalSceneCore;
  const $ = id => document.getElementById(id);
  const set = (id,value) => { $(id).textContent = value ?? '—'; };
  const state = {busy:false,syncing:false,connected:false,overview:null,before:null,after:null,baseline:null,history:[],historyIndex:0,transcript:[]};
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  const fmt = value => new Date(value).toLocaleTimeString('en-GB',{hour12:false});
  async function api(path,body) {
    const response = await fetch(path,{cache:'no-store',...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) { const error = new Error(data.message || data.errorCode || '응답 오류'); error.status=response.status;error.code=data.errorCode;throw error; }
    return data;
  }
  function line(value,tone='normal') {
    const node=document.createElement('div');node.className='line '+tone;node.textContent=value;
    $('output').append(node); state.transcript.push(value);
    while ($('output').children.length > 350) $('output').firstChild.remove();
    if (state.transcript.length > 2000) state.transcript.splice(0,state.transcript.length-2000);
    $('output').scrollTop=$('output').scrollHeight;
  }
  function table(headers,rows) {
    const wrap=document.createElement('div');wrap.className='table-wrap';
    const node=document.createElement('table');node.className='record-table';
    const head=document.createElement('thead'),body=document.createElement('tbody'),headRow=document.createElement('tr');
    headers.forEach(value=>{const cell=document.createElement('th');cell.textContent=value;headRow.append(cell);});head.append(headRow);
    rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});body.append(tr);});
    node.append(head,body);wrap.append(node);$('output').append(wrap);
    state.transcript.push(headers.join(' | '),...rows.map(row=>row.join(' | ')));$('output').scrollTop=$('output').scrollHeight;
  }
  function actor(value) { set('actor',value.toUpperCase());$('actor').className='actor '+value;set('prompt',value); }
  function phase(name) { document.querySelectorAll('#sequence li').forEach(node=>node.classList.toggle('active',node.dataset.phase===name)); }
  function updateGuide() {
    const b=facts(state.before),a=facts(state.after);
    set('nextStep',!state.baseline?'lab baseline → 정상 연결 확인':!state.before?'lab before → 침해 흐름 실행':!b.contained?'lab records / lab receipt → 확인 후 lab contain':!a.blocked?'lab records → 접근 거부 확인 후 lab after':'lab compare → 전후 결과 비교');
  }
  async function sync() {
    if(state.syncing) return false;
    state.syncing=true;
    try {
      const overview=await api('/api/overview'); const runs=overview.runs || [];
      const b=runs.find(run=>run.runId===overview.pendingResponseRunId) || runs.find(run=>run.mode==='before');
      const a=b && runs.find(run=>run.mode==='after' && run.beforeRunId===b.runId);
      const baseline=b ? runs.find(run=>run.runId===b.baselineRunId) : runs.find(run=>run.mode==='baseline');
      const values=await Promise.all([b,a,baseline].map(run=>run?api('/api/runs/'+encodeURIComponent(run.runId)):null));
      if(values.some(value=>value?.upstreamError)) throw new Error('실행 근거 갱신 실패');
      const oldBefore=state.before?.runId;
      state.overview=overview;[state.before,state.after,state.baseline]=values.map(value=>value?.run || null);
      if(oldBefore && oldBefore!==state.before?.runId) {
        phase('idle');if(!state.busy)set('terminalStatus','STATE CHANGED');
      }
      state.connected=Boolean(overview.targetConnected);set('connection',state.connected?'● 지원 서비스 연결됨':'연결 확인 필요');
      updateGuide();return true;
    } catch(error) { state.connected=false;set('connection','연결/근거 갱신 실패');throw error; }
    finally {state.syncing=false;}
  }
  function emitStages(run,seen) {
    for(const item of run.stages || []) {
      const key=JSON.stringify([item.label,item.status,item.at,item.detail]);if(seen.has(key))continue;seen.add(key);
      const d=item.detail || {},parts=[d.httpStatus?'HTTP '+d.httpStatus:'',d.errorCode,d.recordCount!=null?d.recordCount+'건':'',d.receiverStatus].filter(Boolean);
      line('['+(item.at?fmt(item.at):'--:--:--')+'] '+item.status.padEnd(7)+' '+item.label+(parts.length?' / '+parts.join(' · '):''),item.status==='ERROR'?'error':item.status==='ALERT'?'alert':item.status==='RUNNING'?'muted':'success');
    }
  }
  async function run(mode) {
    await sync();
    if(!state.connected) throw new Error('지원 서비스 연결 실패');
    if(mode==='before' && !(state.overview.runs || []).some(item=>item.mode==='baseline' && item.status==='COMPLETED')) throw new Error('기준선 없음 · lab baseline 필요');
    const name=mode==='before'?'attacker':mode==='after'?'defender':'operator';actor(name);phase(mode);
    const created=await api('/api/runs',{mode});line('[RUN] '+created.runId,'muted');
    const seen=new Set(),deadline=Date.now()+90000;let result;
    while(Date.now()<deadline) {
      const payload=await api('/api/runs/'+encodeURIComponent(created.runId));
      if(payload.upstreamError) throw new Error(payload.upstreamError);
      result=payload.run;emitStages(result,seen);
      if(result.status!=='RUNNING')break;
      await wait(650);
    }
    if(!result || result.status==='RUNNING') throw new Error('응답 대기 시간 초과 · 실행 상태 미확인');
    await sync();if(mode==='baseline')state.baseline=result;updateGuide();phase(mode);
    const expected={baseline:'COMPLETED',before:'ALERT',after:'BLOCKED'}[mode];
    if(result.status!==expected) throw new Error('실행 결과: '+result.status+(result.summary?' · '+result.summary:''));
    if(mode==='baseline') line('[VERIFY] 정상 연결 확인','success');
    if(mode==='before') {
      const b=facts(result);
      line(b.received?'[RECEIVED] '+b.count+'건 · 내부 수신 확인':'[CHECK] 내부 수신 증거 미확인',b.received?'alert':'error');
    }
    if(mode==='after') line('[VERIFY] 비정상 입력 차단 · 정상 진단 유지','success');
  }
  function requireBefore() { if(!state.before)throw new Error('선택된 Before 없음');return state.before; }
  async function records() {
    await sync();const before=requireBefore();actor('attacker');phase('records');
    try {
      const result=await api('/api/terminal/records',{runId:before.runId});
      if(result.runId!==before.runId || result.simulation!==true || !Array.isArray(result.records) || result.recordCount!==result.records.length)throw new Error('조회 응답 검증 실패');
      line('[HTTP 200] '+result.recordCount+'건 · 합성자료','alert');
      table(['지원 참조','회원','카드','거래 참조','금액'],result.records.map(row=>[row.supportRef,row.memberNo,'**** '+row.cardLast4,row.transactionRef,Number(row.amount).toLocaleString('ko-KR')+'원']));
    } catch(error) {
      if(error.status===403 && ['SHELL_SESSION_REVOKED','RUN_CONTAINED'].includes(error.code)) {
        line('[HTTP 403] '+error.code,'success');
        phase('contain');
      } else throw error;
    }
  }
  async function receipt() {
    await sync();requireBefore();const b=facts(state.before);actor('attacker');
    if(!b.received)throw new Error('유효한 수신 증적 없음');
    line('[INTERNAL RECEIVER] RECEIVED · '+b.count+'건','alert');
    line('runId      '+state.before.runId);line('transferId '+b.receipt.transferId);
    line('SHA-256    '+b.receipt.payloadSha256,'hash');
  }
  async function contain() {
    await sync();const before=requireBefore();actor('defender');phase('contain');
    const result=await api('/api/runs/'+encodeURIComponent(before.runId)+'/respond',{});
    emitStages({stages:(result.run.stages || []).filter(item=>/세션 폐기|이전 세션/.test(item.label))},new Set());
    await sync();
    if(!facts(result.run).contained)throw new Error('재접근 거부 검증 미완료');
    line('[VERIFY] 같은 세션의 재조회·재전송 HTTP 403 확인','success');
    if(facts(result.run).notice) {
      line('[NOTICE] HC-MEMBER-001 · 보호 안내 등록','success');
    } else line('[NOTICE] 보호 안내 등록 미확인','alert');
  }
  async function compareRuns() {
    await sync();requireBefore();actor('defender');
    if(!state.after || state.after.beforeRunId!==state.before.runId)throw new Error('연결된 After 없음');
    const rows=compare(state.before,state.after,state.baseline);table(['항목','Before','After'],rows);
    const ok=facts(state.after).blocked && facts(state.after).normalAfter && facts(state.before).contained;
    phase('compare');line('[VERIFY] '+(ok?'차단 + 정상 기능 유지 확인':'일부 검증 미완료'),ok?'success':'error');
    line('[PAIR] '+state.before.runId+' → '+state.after.runId,'muted');
  }
  async function card03() {
    actor('operator');
    const result=await api('/api/card03/compare',{});
    line('[CARD-03] 격리 합성 장부','muted');
    const rows=[];for(const [mode,value] of [['Before',result.before],['After',result.after]]) {
      for(const attempt of value.attempts) rows.push([mode,attempt.requestId,attempt.observedRemaining.toLocaleString('ko-KR')+'원',attempt.result]);
    }
    table(['구분','거래','판정 시 잔여','결과'],rows);line('[RUN] '+result.comparisonId,'muted');
    const ok=result.verified===true && result.regression.passed===true;
    phase('card03');
    table(['항목','Before','After'],[['승인 건수',result.before.approvedCount+'건',result.after.approvedCount+'건'],['승인 합계',result.before.approvedAmount.toLocaleString('ko-KR')+'원',result.after.approvedAmount.toLocaleString('ko-KR')+'원']]);
    line('[REGRESSION] '+(ok?'PASS':'검증 실패'),ok?'success':'error');
  }
  async function status() {
    await sync();actor('operator');
    line('[SERVICE] '+(state.connected?'UP':'연결 실패'),state.connected?'success':'error');
    for(const [label,run] of [['BASELINE',state.baseline],['BEFORE',state.before],['AFTER',state.after]])line(label.padEnd(9)+(run?run.runId+' / '+run.status:'미실행'),'muted');
    if(state.overview.pendingResponseRunId)line('[PENDING] '+state.overview.pendingResponseRunId,'alert');
    const active=(state.overview.runs || []).find(run=>run.status==='RUNNING');if(active)line('[RUNNING] '+active.runId,'alert');
  }
  function help() {
    line('HAEON LAB · 허용된 가상 명령어','title');
    for(const [command,note] of [['lab status','환경과 현재 실행 확인'],['lab baseline','정상 진단'],['lab before','생성·조회·내부 전송을 묶은 침해 흐름'],['lab records','같은 세션으로 합성자료 재조회 / 폐기 후 403 확인'],['lab receipt','동일 실행의 내부 수신 증거'],['lab contain','세션 폐기·재조회/재전송 거부 검증'],['lab after','개선 설정에서 새 입력 차단·정상 진단'],['lab compare','연결된 Before / After 비교'],['lab card03','별도 장부의 동시 승인 실험'],['clear','이 화면의 터미널 출력만 지우기']])line(command.padEnd(15)+' '+note,'muted');
    line('임의 OS 명령·주소·스크립트 실행은 지원하지 않습니다. 상태 초기화는 기존 콘솔에서 별도로 수행하세요.','muted');
  }
  async function submit(raw) {
    if(state.busy)return;
    const command=parse(raw);if(!raw.trim())return;
    line($('prompt').textContent+'@haeon-lab:~$ '+raw.trim(),'command');$('commandInput').value='';
    if(!command){line('[ERROR] 알 수 없는 명령','error');return;}
    state.history.push(command);state.history=state.history.slice(-50);state.historyIndex=state.history.length;
    if(command==='clear'){$('output').replaceChildren();state.transcript=[];return;}
    if(command==='help'){help();return;}
    state.busy=true;$('submitCommand').disabled=true;$('commandInput').disabled=true;set('terminalStatus','RUNNING');
    try {
      if(command==='lab status')await status();
      else if(command==='lab records')await records();
      else if(command==='lab receipt')await receipt();
      else if(command==='lab contain')await contain();
      else if(command==='lab compare')await compareRuns();
      else if(command==='lab card03')await card03();
      else await run(command.split(' ')[1]);
      set('terminalStatus','READY');
    }catch(error){line('[ERROR] '+[error.status?'HTTP '+error.status:null,error.code,error.message!==error.code?error.message:null].filter(Boolean).join(' · '),'error');set('terminalStatus','CHECK REQUIRED');}
    finally {state.busy=false;$('submitCommand').disabled=false;$('commandInput').disabled=false;$('commandInput').focus();}
  }
  $('commandForm').addEventListener('submit',event=>{event.preventDefault();submit($('commandInput').value);});
  document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{if(!state.busy){$('commandInput').value=button.dataset.command;$('commandInput').focus();}}));
  $('commandInput').addEventListener('keydown',event=>{
    if(event.key==='ArrowUp' || event.key==='ArrowDown') {event.preventDefault();state.historyIndex=Math.max(0,Math.min(state.history.length,state.historyIndex+(event.key==='ArrowUp'?-1:1)));$('commandInput').value=state.history[state.historyIndex] || '';}
    if(event.key==='Tab') {const matches=commands.filter(command=>command.startsWith($('commandInput').value.toLowerCase()));if(matches.length===1){event.preventDefault();$('commandInput').value=matches[0];}}
  });
  $('focusMode').addEventListener('click',()=>{const active=document.body.classList.toggle('shoot-mode');$('focusMode').setAttribute('aria-pressed',String(active));set('focusMode',active?'안내 다시 보기':'촬영 모드');});
  $('exportLog').addEventListener('click',()=>{
    const blob=new Blob(['합성정보 기반 가상 터미널 시연\n'+new Date().toISOString()+'\n\n'+state.transcript.join('\n')],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='haeon-terminal-'+new Date().toISOString().replace(/[:.]/g,'-')+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  async function refreshIdle() {
    if(state.busy || document.hidden)return;
    try {await sync();}
    catch(error){set('terminalStatus','CONNECTION CHECK');}
  }
  refreshIdle();setInterval(refreshIdle,5000);
})();
