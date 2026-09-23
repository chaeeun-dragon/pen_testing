(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { currentRunId:null, current:null, pendingResponseRunId:null, events:[], localEvents:[], logTab:"events", toastTimer:null, busy:false, responding:false, activeRunId:null, polling:false, overview:null, comparison:null, logAnimationRunId:null, logGeneration:0, logWriteQueue:Promise.resolve(), animatedEventKeys:new Set(), animatedStepKeys:new Set() };
  const eventLabels = {
    diagnostic_request_received:"진단 요청 수신",
    diagnostic_completed:"진단 완료",
    simulated_command_injection_observed:"비정상 진단 입력 탐지",
    lab_shell_session_created:"모의 웹 세션 생성",
    synthetic_records_accessed:"합성 지원 자료 조회",
    synthetic_records_exfiltration_attempted:"내부 수신기 전송",
    diagnostic_injection_blocked:"비정상 진단 입력 차단",
    incident_response_contained:"사고 대응 완료",
    run_created:"시나리오 실행 등록",
    console_api_failed:"콘솔 API 호출 실패"
  };
  const statusLabels = {RUNNING:"진행 중",SUCCESS:"완료",COMPLETED:"완료",ALERT:"탐지",BLOCKED:"차단",CONTAINED:"대응 완료",ERROR:"오류",PASS:"정상",NONE:"대기 중",SKIPPED:"미실행"};
  const modeLabels = {baseline:"정상 진단",before:"Before 공격 흐름",after:"After 차단 검증"};
  const text = value => value == null || value === "" ? "—" : String(value);
  const shortId = value => {
    const raw = text(value);
    return raw.length > 26 ? raw.slice(0, 18) + "…" + raw.slice(-6) : raw;
  };
  function fmtTime(value, short) {
    if(!value)return "—";
    let normalized=String(value).replace(" ","T");
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized))normalized+="Z";
    const date=new Date(normalized); if(Number.isNaN(date.getTime()))return String(value);
    const opts=short?{hour:"2-digit",minute:"2-digit",second:"2-digit"}:{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"};
    const formatted=date.toLocaleString("ko-KR",opts);
    const fraction=(normalized.match(/\.(\d{1,3})/)||[])[1];
    return short&&fraction ? formatted+"."+fraction.padEnd(3,"0") : formatted;
  }
  function notify(message) {
    const box=$("#toast");box.textContent=message;box.classList.add("show");
    clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>box.classList.remove("show"),2800);
  }
  async function api(url, options) {
    const response=await fetch(url,Object.assign({cache:"no-store",headers:{Accept:"application/json"}},options||{}));
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.errorCode||("HTTP "+response.status));
    return data;
  }
  function detailText(value) {
    if(!value)return "";
    if(typeof value==="string"){try{value=JSON.parse(value);}catch{return "";}}
    const labels={httpStatus:"HTTP",latencyMs:"응답 시간",recordCount:"자료 건수",receiverStatus:"수신 상태",payloadSha256:"SHA-256",mode:"모드",control:"차단 정책",protectionNoticeCreated:"보호 안내",changed:"상태 변경",exfiltrationConfirmed:"수신 확인",source:"기록 출처"};
    const parts=[];
    Object.keys(labels).forEach(key=>{
      if(value[key]!=null){
        let display=String(value[key]);
        if(key==="latencyMs") display+=" ms";
        if(key==="control"&&display==="allow-list") display="허용 목록";
        if(key==="receiverStatus") display=({RECEIVED:"수신 완료",FAILED:"수신 실패",REJECTED:"수신 거부"})[display]||display;
        if(key==="protectionNoticeCreated") display=value[key]?"등록됨":"해당 없음";
        if(key==="exfiltrationConfirmed") display=value[key]?"확인됨":"미확인";
        parts.push(labels[key]+": "+display);
      }
    });
    return parts.join(" · ");
  }
  function recordLocalFailure(runId, context) {
    state.localEvents.unshift({runId, eventType:"console_api_failed", result:"ERROR", occurredAt:new Date().toISOString(), detail:{source:context}});
    state.localEvents=state.localEvents.slice(0,20);
  }
  function logWait(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }
  async function typeLogText(node,value,speed,generation) {
    const content=String(value||"");node.textContent="";
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){node.textContent=content;return;}
    node.classList.add("log-typing");
    for(const character of Array.from(content)){
      if(generation!==state.logGeneration)break;
      node.textContent+=character;
      await logWait(speed);
    }
    node.classList.remove("log-typing");
  }
  function enqueueTypedLog(list,row,titleNode,titleValue,detailNode,detailValue,key,kind) {
    const generation=state.logGeneration;
    row.dataset.logKey=key;row.classList.add("log-entry-new");
    const queued=state.logWriteQueue.then(async()=>{
      if(generation!==state.logGeneration)return;
      list.querySelector(".log-pending")?.remove();
      list.classList.remove("empty-state");
      list.prepend(row);
      await typeLogText(titleNode,titleValue,kind==="event"?42:40,generation);
      if(detailNode&&detailValue&&generation===state.logGeneration)await typeLogText(detailNode,detailValue,kind==="event"?18:16,generation);
      row.classList.remove("log-entry-new");
    });
    state.logWriteQueue=queued.catch(()=>{});
  }
  async function drainLogQueue() {
    let queue;
    do { queue=state.logWriteQueue;await queue; } while(queue!==state.logWriteQueue);
  }
  function beginLogPlayback(runId,reset=true) {
    state.logGeneration+=1;state.logAnimationRunId=runId;state.logWriteQueue=Promise.resolve();
    const events=$("#eventList"),steps=$("#stepLogList");
    if(reset){
      state.animatedEventKeys=new Set();state.animatedStepKeys=new Set();
      events.replaceChildren();events.classList.remove("empty-state");
      steps.replaceChildren();steps.classList.remove("empty-state");
      events.scrollTop=0;steps.scrollTop=0;
      [events,steps].forEach(list=>{const pending=document.createElement("span");pending.className="log-pending";pending.textContent="새 실행 로그를 기다리는 중입니다.";list.append(pending);});
    }else{
      state.animatedEventKeys=new Set([...events.querySelectorAll("[data-log-key]")].map(row=>row.dataset.logKey));
      state.animatedStepKeys=new Set([...steps.querySelectorAll("[data-log-key]")].map(row=>row.dataset.logKey));
    }
  }
  function eventLogKey(event,runId,index) {
    return String(event.eventId||event.id||[runId,event.occurredAt,event.eventType,event.result,JSON.stringify(event.detail||"")].join("|"));
  }
  function stepLogKey(item,run,index) {
    return String(item.id||item.stageId||[run.runId,index,item.at,item.label,item.status].join("|"));
  }
  function empty(parent,message,icon) {
    parent.replaceChildren();parent.classList.add("empty-state");
    const mark=document.createElement("b");mark.className="empty-icon";mark.textContent=icon||"◷";
    const label=document.createElement("span");label.textContent=message;
    parent.append(mark,label);
  }
  function stageSeverity(status) {
    return ({ERROR:6,BLOCKED:5,ALERT:4,RUNNING:3,SUCCESS:2,COMPLETED:2,PASS:2,SKIPPED:1})[status]||0;
  }
  function summarizedStages(run) {
    const groups=[
      {key:"access",title:"인증 및 대상 확인",items:[]},
      {key:"diagnostic",title:"정상 진단",items:[]},
      {key:"reproduction",title:"모의 침해 재현",items:[]},
      {key:"response",title:"대응",items:[]},
      {key:"after",title:"After 재검증",items:[]},
      {key:"other",title:"실행 기록",items:[]}
    ];
    const pick=(item)=>{
      const label=item.label||"";
      if(/인증|대상 확인|실행 ID 발급/.test(label)) return "access";
      if(run.mode==="after"&&(/비정상|세션 생성|자료 조회|전송|선행 단계/.test(label))) return "after";
      if(/진단 요청|연결 진단|정상 진단/.test(label)) return "diagnostic";
      if(/세션 생성|자료 조회|수신기|내부 전송|전송/.test(label)) return "reproduction";
      if(/세션 폐기|회원 보호|사고 대응/.test(label)) return "response";
      return "other";
    };
    (run.stages||[]).forEach(item=>groups.find(group=>group.key===pick(item)).items.push(item));
    return groups.filter(group=>group.items.length).map(group=>{
      const latest=group.items[group.items.length-1];
      const status=group.items.reduce((current,item)=>stageSeverity(item.status)>=stageSeverity(current)?item.status:current,latest.status);
      return {...group,latest,status};
    });
  }
  function renderStages(run) {
    const list=$("#stageList");list.replaceChildren();$("#selectedRunLabel").textContent=run?run.runId:"실행을 선택하세요";
    if(!run||!run.stages||!run.stages.length){
      list.classList.add("empty-state");
      const mark=document.createElement("b");mark.className="empty-icon";mark.textContent="⌁";
      const title=document.createElement("strong");title.textContent=run?"단계 로그를 수신하는 중입니다":"아직 실행된 단계가 없습니다";
      const sub=document.createElement("span");sub.textContent=run?"잠시 후 자동으로 갱신됩니다.":"정상 진단 또는 공격 흐름을 시작하면 진행 상태가 여기에 표시됩니다.";
      list.append(mark,title,sub);return;
    }
    list.classList.remove("empty-state");
    const label=$("#selectedRunLabel");label.textContent=shortId(run.runId);label.title=run.runId;
    summarizedStages(run).forEach(group=>{
      const row=document.createElement("div");row.className="stage-row";row.dataset.status=group.status||"";row.setAttribute("role","listitem");
      const mark=document.createElement("span");mark.className="stage-mark";mark.textContent=({SUCCESS:"✓",ALERT:"!",BLOCKED:"⊘",ERROR:"×",RUNNING:"·",SKIPPED:"—"})[group.status]||"·";
      const copy=document.createElement("div");copy.className="stage-copy";
      const title=document.createElement("strong");title.textContent=group.title;copy.append(title);
      const sub=document.createElement("small");
      const subText=detailText(group.latest.detail);
      sub.textContent=group.latest.label+" · "+group.items.length+"개 단계 기록"+(subText?" · "+subText:"");copy.append(sub);
      const stamp=document.createElement("span");stamp.className="stage-time";stamp.textContent=fmtTime(group.latest.at,true);
      row.append(mark,copy,stamp);list.append(row);
    });
  }
  function renderEvents(events, runId) {
    const visible=[...events,...state.localEvents.filter(event=>!event.runId||event.runId===runId)];
    $("#eventCount").textContent=String(visible.length);
    const list=$("#eventList");
    if(!visible.length){empty(list,"아직 이벤트가 없습니다.","◷");return;}
    const animate=state.logAnimationRunId===runId&&state.logTab==="events";
    if(animate){
      list.classList.remove("empty-state");
      visible.forEach((event,index)=>{
        const key=eventLogKey(event,runId,index);if(state.animatedEventKeys.has(key))return;
        state.animatedEventKeys.add(key);
        const row=document.createElement("div");row.className="event-row";row.dataset.result=event.result||"";
        const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({BLOCKED:"⊘",ALERT:"!",ERROR:"×",PASS:"✓"})[event.result]||"·";
        const copy=document.createElement("div");copy.className="event-copy";
        const title=document.createElement("strong");copy.append(title);
        const sub=document.createElement("small"),subText=["#"+(index+1),event.result,detailText(event.detail)].filter(Boolean).join(" · ");
        if(subText)copy.append(sub);
        const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(event.occurredAt,true);
        row.append(pin,copy,stamp);
        enqueueTypedLog(list,row,title,eventLabels[event.eventType]||event.eventType||"보안 이벤트",sub,subText,key,"event");
      });
      return;
    }
    list.replaceChildren();list.classList.remove("empty-state");state.animatedEventKeys=new Set();
    [...visible].reverse().forEach((event,index)=>{
      const key=eventLogKey(event,runId,visible.length-index-1);state.animatedEventKeys.add(key);
      const row=document.createElement("div");row.className="event-row";row.dataset.result=event.result||"";row.dataset.logKey=key;
      const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({BLOCKED:"⊘",ALERT:"!",ERROR:"×",PASS:"✓"})[event.result]||"·";
      const copy=document.createElement("div");copy.className="event-copy";
      const title=document.createElement("strong");title.textContent=eventLabels[event.eventType]||event.eventType||"보안 이벤트";
      const sub=document.createElement("small");sub.textContent=["#"+(visible.length-index),event.result,detailText(event.detail)].filter(Boolean).join(" · ");
      copy.append(title);if(sub.textContent)copy.append(sub);
      const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(event.occurredAt,true);
      row.append(pin,copy,stamp);list.append(row);
    });
  }
  function renderStepLog(run) {
    const list=$("#stepLogList");
    if(!run||!run.stages||!run.stages.length){list.replaceChildren();list.classList.add("empty-state");const span=document.createElement("span");span.textContent="아직 실행 로그가 없습니다.";list.append(span);return;}
    const animate=state.logAnimationRunId===run.runId&&state.logTab==="steps";
    if(animate){
      list.classList.remove("empty-state");
      run.stages.forEach((item,index)=>{
        const key=stepLogKey(item,run,index);if(state.animatedStepKeys.has(key))return;
        state.animatedStepKeys.add(key);
        const row=document.createElement("div");row.className="event-row";row.dataset.result=item.status||"";
        const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({SUCCESS:"✓",ALERT:"!",BLOCKED:"⊘",ERROR:"×",RUNNING:"·",SKIPPED:"—"})[item.status]||"·";
        const copy=document.createElement("div");copy.className="event-copy";
        const title=document.createElement("strong");copy.append(title);
        const detail=detailText(item.detail),sub=document.createElement("small"),subText=["#"+(index+1),detail].filter(Boolean).join(" · ");copy.append(sub);
        const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(item.at,true);
        row.append(pin,copy,stamp);
        enqueueTypedLog(list,row,title,item.label||"실행 단계",sub,subText,key,"step");
      });
      return;
    }
    list.replaceChildren();list.classList.remove("empty-state");state.animatedStepKeys=new Set();
    [...run.stages].reverse().forEach((item,index)=>{
      const key=stepLogKey(item,run,run.stages.length-index-1);state.animatedStepKeys.add(key);
      const row=document.createElement("div");row.className="event-row";row.dataset.result=item.status||"";row.dataset.logKey=key;
      const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({SUCCESS:"✓",ALERT:"!",BLOCKED:"⊘",ERROR:"×",RUNNING:"·",SKIPPED:"—"})[item.status]||"·";
      const copy=document.createElement("div");copy.className="event-copy";
      const title=document.createElement("strong");title.textContent=item.label||"실행 단계";copy.append(title);
      const detail=detailText(item.detail);const sub=document.createElement("small");sub.textContent=["#"+(run.stages.length-index),detail].filter(Boolean).join(" · ");copy.append(sub);
      const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(item.at,true);
      row.append(pin,copy,stamp);list.append(row);
    });
  }
  function evidenceFromRun(run) {
    if(!run)return null;
    const stages=run.stages||[];
    const details=stages.map(item=>item.detail||{});
    return {
      runId:run.runId,status:run.status,
      sessionCreated:stages.some(item=>item.label==="제한된 모의 웹 세션 생성"&&["SUCCESS","ALERT"].includes(item.status)),
      recordCount:details.map(detail=>detail.recordCount).find(value=>value!=null),
      receiverStatus:details.map(detail=>detail.receiverStatus).find(Boolean),
      diagnosticCompleted:stages.some(item=>item.label==="등록 대상 연결 진단"&&item.status==="SUCCESS")
    };
  }
  function comparisonValue(evidence,key,mode) {
    if(!evidence)return "미실행";
    if(key==="session"){
      if(mode==="after"&&evidence.status==="BLOCKED")return "차단되어 미생성";
      return evidence.sessionCreated?"생성됨":"미생성";
    }
    if(key==="records"){
      if(mode==="after"&&evidence.status==="BLOCKED")return "선행 차단으로 미실행";
      return evidence.recordCount!=null?evidence.recordCount+"건 조회":"미실행";
    }
    if(key==="receiver"){
      if(mode==="after"&&evidence.status==="BLOCKED")return "선행 차단으로 미실행";
      return ({RECEIVED:"수신 증적 확인",FAILED:"수신 실패",REJECTED:"수신 거부"})[evidence.receiverStatus]||"미실행";
    }
    return evidence.diagnosticCompleted?"정상 진단 완료":"미실행";
  }
  function renderComparison(comparison) {
    const values=comparison||{};
    const before=values.before||null, after=values.after||null, baseline=values.baseline||null;
    $("#comparisonSessionBefore").textContent=comparisonValue(before,"session","before");
    $("#comparisonSessionAfter").textContent=comparisonValue(after,"session","after");
    $("#comparisonRecordsBefore").textContent=comparisonValue(before,"records","before");
    $("#comparisonRecordsAfter").textContent=comparisonValue(after,"records","after");
    $("#comparisonReceiverBefore").textContent=comparisonValue(before,"receiver","before");
    $("#comparisonReceiverAfter").textContent=comparisonValue(after,"receiver","after");
    const baselineValue=comparisonValue(baseline,"diagnostic","baseline");
    $("#comparisonBaselineBefore").textContent=baselineValue;
    $("#comparisonBaselineAfter").textContent=baselineValue;
    $("#comparisonSummary").textContent=!before
      ?"Before 실행을 시작하면 실제 모의 세션·자료 조회·수신 증적을 표시합니다."
      :!after
        ?"Before 실행 증거를 표시합니다. After는 아직 미실행입니다."
        :"Before 실행 기록과 After 차단 검증 기록을 비교합니다.";
    $("#comparisonNote").textContent=baseline
      ?"정상 진단은 Before·After와 분리된 실행 기록으로 표시합니다."
      :"정상 진단을 실행하면 비교 표에 별도 결과가 표시됩니다.";
  }
  function detectionPresentation(run) {
    const stages=run.stages||[];
    const received=stages.some(item=>item.detail?.receiverStatus==="RECEIVED");
    if(run.mode==="before"&&run.status==="ALERT")return {title:"비정상 입력 탐지",note:received?"모의 세션 · 자료 조회 · 수신 증적 확인":"비정상 진단 입력과 후속 흐름 관찰"};
    if(run.mode==="after"&&run.status==="BLOCKED")return {title:"차단 확인",note:"허용 목록 정책이 비정상 입력을 거부함"};
    if(run.mode==="before"&&run.status==="CONTAINED")return {title:"대응 완료",note:"모의 세션 폐기 · 회원 보호 안내 등록"};
    if(run.mode==="baseline")return {title:statusLabels[run.status]||run.status,note:"등록 대상의 실제 HTTP 연결 결과"};
    return {title:statusLabels[run.status]||run.status,note:run.summary||"실행 결과를 확인하세요"};
  }
  function setRunContext(overview) {
    const run=state.current, pending=state.pendingResponseRunId;
    const engineReady=Boolean(overview?.targetConnected);
    $("#engineState").textContent=engineReady?"사용 가능":"연결 확인 필요";
    $("#engineStateNote").textContent=engineReady?"지원 서비스 응답을 확인했습니다.":"지원 서비스 연결을 다시 확인하세요.";
    if(!run){
      $("#selectedRunState").textContent=pending?"Before 대응 대기":"선택된 실행 없음";
      $("#selectedRunStateNote").textContent=pending?"대응 대기 실행을 열어 주세요.":"실행 기록을 선택하면 결과가 표시됩니다.";
      $("#currentPhase").textContent=pending?"대응 대기":"실행 대기";
      $("#currentPhaseNote").textContent=pending?"모의 세션 폐기와 보호 안내 등록이 필요합니다.":"정상 진단부터 시작할 수 있습니다.";
      $("#nextAction").textContent=pending?"대응 대기 실행 열기":"정상 진단 실행";
      $("#nextActionNote").textContent=pending?"대응할 Before 실행을 선택합니다.":"등록 대상의 연결 상태를 확인합니다.";
      return;
    }
    const selected=modeLabels[run.mode]||run.mode;
    $("#selectedRunState").textContent=selected+" · "+(statusLabels[run.status]||run.status);
    $("#selectedRunStateNote").textContent=shortId(run.runId);
    if(state.busy||state.activeRunId||run.status==="RUNNING"){
      $("#currentPhase").textContent="실행 중";
      $("#currentPhaseNote").textContent="실제 단계 기록을 수신하고 있습니다.";
      $("#nextAction").textContent="현재 실행 완료 대기";
      $("#nextActionNote").textContent="완료 후 가능한 다음 작업이 표시됩니다.";
    }else if(pending){
      $("#currentPhase").textContent=run.runId===pending?"대응 대기":"Before 대응 대기";
      $("#currentPhaseNote").textContent=run.runId===pending
        ?"현재 Before 실행의 모의 세션이 아직 유효합니다."
        :"선택 실행과 별도로 Before 실행의 모의 세션이 아직 유효합니다.";
      $("#nextAction").textContent=run.runId===pending?"대응 실행":"대응 대기 실행 열기";
      $("#nextActionNote").textContent="대응은 세션 폐기와 회원 보호 안내 등록을 수행합니다.";
    }else if(run.mode==="before"&&run.status==="CONTAINED"){
      $("#currentPhase").textContent="대응 완료";
      $("#currentPhaseNote").textContent="모의 세션 폐기와 보호 안내 등록 기록을 확인했습니다.";
      $("#nextAction").textContent="After 차단 검증";
      $("#nextActionNote").textContent="별도 허용 목록 설정에서 같은 입력을 검증합니다.";
    }else if(run.mode==="after"&&run.status==="BLOCKED"){
      $("#currentPhase").textContent="선행 단계 차단";
      $("#currentPhaseNote").textContent="세션 생성·자료 조회·전송은 실행되지 않았습니다.";
      $("#nextAction").textContent="정상 진단 실행";
      $("#nextActionNote").textContent="등록 대상의 정상 연결을 다시 확인할 수 있습니다.";
    }else{
      $("#currentPhase").textContent=statusLabels[run.status]||run.status;
      $("#currentPhaseNote").textContent=run.summary||"실행 결과를 확인하세요.";
      $("#nextAction").textContent="정상 진단 실행";
      $("#nextActionNote").textContent="등록 대상의 연결 상태를 확인합니다.";
    }
  }
  function setActionState(key, status, reason, cta, locked, current) {
    const modes={Baseline:"baseline",Before:"before",After:"after"};
    const card=key==="Respond"?$("#respondButton"):$('[data-run-mode="'+modes[key]+'"]');
    $("#actionStatus"+key).textContent=status;
    const reasonNode=$("#actionReason"+key);const dot=document.createElement("i");
    reasonNode.replaceChildren(dot,document.createTextNode(" "+reason));
    $("#actionCta"+key).textContent=cta;
    card.classList.toggle("is-locked",locked);
    card.classList.toggle("is-current",current);
  }
  function updateRun(run,events) {
    if(!run)return;
    state.current=run;state.currentRunId=run.runId;state.events=events||[];
    $("#activityRunId").textContent=shortId(run.runId);$("#activityRunId").title=run.runId;
    $("#activityStatus").textContent=statusLabels[run.status]||run.status;
    $("#metricLastRun").textContent=modeLabels[run.mode]||run.mode;
    $("#metricLastRunNote").textContent=shortId(run.runId)+" · "+fmtTime(run.createdAt,false);
    const detection=detectionPresentation(run);
    $("#metricDetection").textContent=detection.title;
    $("#metricDetectionNote").textContent=detection.note;
    const recordCount=(run.stages||[]).map(item=>item.detail&&item.detail.recordCount).find(value=>value!=null);
    const unexecuted=run.mode==="after"&&run.status==="BLOCKED"&&recordCount==null;
    $("#metricRecords").textContent=unexecuted?"미실행":recordCount==null?"0":String(recordCount);
    $("#metricRecordsUnit").textContent=unexecuted?"":"건";
    $("#lastUpdated").textContent=fmtTime(new Date().toISOString(),true);
    $("#activityStatus").className="status-text "+run.status;
    state.comparison={...(state.comparison||{}),[run.mode]:evidenceFromRun(run)};
    renderStages(run);renderEvents(events||[],run.runId);renderStepLog(run);
    renderComparison(state.comparison);setRunContext(state.overview);
    syncControls();
  }
  function syncControls(){
    const run=state.current;
    const busy=state.busy||Boolean(state.activeRunId)||run?.status==="RUNNING";
    const pending=state.pendingResponseRunId;
    const baseline=$('[data-run-mode="baseline"]');
    const before=$('[data-run-mode="before"]');
    const after=$('[data-run-mode="after"]');
    const responseAvailable=!busy&&Boolean(run)&&run.mode==="before"&&run.runId===pending&&run.status!=="CONTAINED";
    baseline.disabled=busy;
    before.disabled=busy||Boolean(pending);
    after.disabled=busy||Boolean(pending);
    $("#respondButton").disabled=!responseAvailable;
    $("#pendingRunButton").classList.toggle("hidden",!state.pendingResponseRunId||state.pendingResponseRunId===state.currentRunId);
    $("#executionHint").textContent=busy
      ?"실행 중입니다. 실제 단계 기록이 완료되면 다음 작업을 선택할 수 있습니다."
      :pending
        ?"Before 실행의 모의 세션을 먼저 폐기하세요. After는 별도 허용 목록 설정을 검증합니다."
        :"정상 진단 → Before → 대응 → After 순서로 실행하세요.";
    const currentMode=run?.mode;
    setActionState("Baseline",
      busy&&currentMode==="baseline"?"진행 중":currentMode==="baseline"&&run?.status!=="RUNNING"?"최근 실행 완료":"실행 가능",
      busy&&currentMode!=="baseline"?"다른 실행이 끝난 뒤 시작할 수 있습니다.":"등록 대상의 연결 상태를 확인합니다.",
      busy&&currentMode==="baseline"?"실행 중":"정상 진단 실행",busy,currentMode==="baseline");
    setActionState("Before",
      busy&&currentMode==="before"?"진행 중":pending?"대응 대기":currentMode==="before"&&run?.status==="CONTAINED"?"대응 완료":"실행 가능",
      pending?"Before 실행의 대응이 완료될 때까지 새 실행을 잠급니다.":busy&&currentMode!=="before"?"다른 실행이 끝난 뒤 시작할 수 있습니다.":"제한된 진단 입력 처리와 모의 세션 흐름을 확인합니다.",
      busy&&currentMode==="before"?"실행 중":pending?"대응 대기":"Before 실행",Boolean(pending)||busy,currentMode==="before");
    const waitingForBefore=Boolean(pending&&run?.runId===pending&&run?.mode==="before"&&run.status==="RUNNING");
    setActionState("Respond",
      state.responding?"대응 중":responseAvailable?"대응 필요":waitingForBefore?"Before 실행 중":pending?"실행 선택 필요":currentMode==="before"&&run?.status==="CONTAINED"?"대응 완료":"대응 대기",
      state.responding?"세션 폐기와 회원 보호 안내를 적용하고 있습니다.":responseAvailable?"현재 Before 실행의 모의 세션을 폐기할 수 있습니다.":waitingForBefore?"Before 실행이 끝나면 대응을 시작할 수 있습니다.":pending?"대응할 Before 실행을 선택하세요.":currentMode==="before"&&run?.status==="CONTAINED"?"세션 폐기와 회원 보호 안내 등록을 확인했습니다.":"Before 실행 완료 후 사용할 수 있습니다.",
      state.responding?"적용 중":responseAvailable?"대응 실행":waitingForBefore?"실행 중":currentMode==="before"&&run?.status==="CONTAINED"?"대응 완료":"대응 대기",!responseAvailable,currentMode==="before"&&Boolean(pending));
    setActionState("After",
      busy&&currentMode==="after"?"진행 중":pending?"잠김":currentMode==="after"&&run?.status==="BLOCKED"?"차단 확인":"실행 가능",
      pending?"Before 대응 완료 후 별도 검증을 실행할 수 있습니다.":busy&&currentMode!=="after"?"다른 실행이 끝난 뒤 시작할 수 있습니다.":currentMode==="after"&&run?.status==="BLOCKED"?"허용 목록 정책에서 비정상 입력이 차단됐습니다.":"강화된 입력 검증 모드를 확인합니다.",
      busy&&currentMode==="after"?"실행 중":pending?"대응 후 실행":currentMode==="after"&&run?.status==="BLOCKED"?"차단 확인":"After 차단 검증",Boolean(pending)||busy,currentMode==="after");
    setRunContext(state.overview);
  }
  async function loadHistory(selectNewest) {
    try{
      const data=await api("/api/overview");
      state.overview=data;state.comparison=data.comparison||state.comparison;
      state.pendingResponseRunId=data.pendingResponseRunId||null;
      const runs=data.runs||[];
      state.activeRunId=runs.find(run=>run.status==="RUNNING")?.runId||null;
      $("#connectionText").textContent=data.targetConnected?"지원 서비스 연결됨":"지원 서비스 연결 실패";
      $("#targetConnection").textContent=data.targetConnected?"지원 서비스 응답 확인":"현재 연결 상태 확인 필요";
      $("#targetReadiness").textContent=data.targetConnected?"사용 가능":"연결 확인 필요";
      $("#engineSummary").textContent=data.targetConnected?"지원 서비스 응답 확인":"지원 서비스 연결을 다시 확인하세요.";
      $(".connection").classList.toggle("offline",!data.targetConnected);
      $("#runCount").textContent=String(runs.length).padStart(2,"0");
      $("#historyCount").textContent=runs.length+" RUNS";
      const list=$("#historyList");list.replaceChildren();
      if(!runs.length){
        list.classList.add("empty-state");
        const title=document.createElement("strong");title.textContent="아직 실행 기록이 없습니다";
        const sub=document.createElement("span");sub.textContent="시나리오 실행 후 이력에서 다시 확인할 수 있습니다.";
        list.append(title,sub);
      }else{
        list.classList.remove("empty-state");
        runs.forEach(run=>{
          const row=document.createElement("button");row.type="button";row.className="history-item";
          row.addEventListener("click",()=>{selectRun(run.runId);showView("overview");});
          const name=document.createElement("span");name.className="history-name";
          const id=document.createElement("strong");id.textContent=shortId(run.runId);id.title=run.runId;
          const mode=document.createElement("small");mode.textContent=modeLabels[run.mode]||run.mode;name.append(id,mode);
          const date=document.createElement("span");date.className="history-time";date.textContent=fmtTime(run.createdAt,false);
          const status=document.createElement("span");const pill=document.createElement("span");pill.className="status-pill "+run.status;pill.textContent=statusLabels[run.status]||run.status;status.append(pill);
          const open=document.createElement("span");open.className="history-open";open.textContent="↗";
          row.append(name,date,status,open);list.append(row);
        });
      }
      renderComparison(state.comparison);setRunContext(data);
      if(runs.length&&selectNewest&&!state.currentRunId)await selectRun(runs[0].runId);
      syncControls();
    }catch(error){recordLocalFailure(null,"실행 목록 갱신");renderEvents(state.events,state.currentRunId);notify("실행 목록을 불러오지 못했습니다.");}
  }
  async function selectRun(id) {
    if(state.logAnimationRunId&&state.logAnimationRunId!==id){state.logGeneration+=1;state.logAnimationRunId=null;state.logWriteQueue=Promise.resolve();}
    state.currentRunId=id;$("#activityRunId").textContent=shortId(id);$("#activityRunId").title=id;
    try{
      const data=await api("/api/runs/"+encodeURIComponent(id));
      if(state.currentRunId!==id)return;
      state.pendingResponseRunId=data.pendingResponseRunId??null;
      if(state.activeRunId===id&&data.run.status!=="RUNNING")state.activeRunId=null;
      $("#upstreamWarning").textContent=data.upstreamError||"";
      $("#upstreamWarning").classList.toggle("hidden",!data.upstreamError);
      updateRun(data.run,data.events||[]);
    }catch(error){
      if(state.currentRunId!==id)return;
      recordLocalFailure(id,"실행 상세 갱신");
      renderEvents(state.events,id);
      $("#upstreamWarning").textContent="갱신 실패 · 표시된 결과는 마지막 확인 기록입니다.";
      $("#upstreamWarning").classList.remove("hidden");
    }
  }

  async function startRun(mode) {
    const button=$('[data-run-mode="'+mode+'"]');if(button.disabled)return;
    state.busy=true;syncControls();
    button.classList.add("loading");
    try{
      const data=await api("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:mode})});
      beginLogPlayback(data.runId);
      state.currentRunId=data.runId;if(mode==="before")state.pendingResponseRunId=data.runId;
      $("#activityRunId").textContent=data.runId;$("#activityStatus").textContent="진행 중";
      notify((modeLabels[mode]||mode)+" 실행을 시작했습니다.");showView("overview");
      await selectRun(data.runId);await loadHistory(false);
    }catch(error){recordLocalFailure(state.currentRunId,"시나리오 시작");renderEvents(state.events,state.currentRunId);notify("시나리오를 시작하지 못했습니다.");}
    finally{await drainLogQueue();state.busy=false;button.classList.remove("loading");syncControls();}
  }
  async function respond() {
    const run=state.current;if(!run||state.busy)return;state.busy=true;state.responding=true;syncControls();
    if(state.logAnimationRunId!==run.runId)beginLogPlayback(run.runId,false);
    const button=$("#respondButton");button.disabled=true;button.classList.add("loading");
    try{
      const data=await api("/api/runs/"+encodeURIComponent(run.runId)+"/respond",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      state.pendingResponseRunId=null;updateRun(data.run,data.events||[]);
      notify(data.run.summary||"대응 결과를 확인했습니다.");await loadHistory(false);
    }catch(error){recordLocalFailure(run.runId,"대응 실행");renderEvents(state.events,run.runId);notify("대응 요청을 처리하지 못했습니다.");button.disabled=false;}
    finally{await drainLogQueue();state.responding=false;state.busy=false;button.classList.remove("loading");syncControls();}
  }
  function showView(view) {
    const history=view==="history";
    $("#overviewView").classList.toggle("hidden",history);
    $("#historyView").classList.toggle("hidden",!history);
    $$(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
    $("#topCrumb").textContent=history?"실행 이력":"시나리오 실행";
    if(history)loadHistory(false);
  }
  $$(".nav-item").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
  $$(".scenario-item").forEach(button=>button.addEventListener("click",()=>{
    if(button.dataset.scenario!=="haeon")notify("북웨이브와 PG는 서로 독립된 시나리오로 준비 중입니다.");
  }));
  $$("[data-run-mode]").forEach(button=>button.addEventListener("click",()=>startRun(button.dataset.runMode)));
  $("#pendingRunButton").addEventListener("click",()=>{if(state.pendingResponseRunId)selectRun(state.pendingResponseRunId);});
  $("#respondButton").addEventListener("click",respond);
  $("#refreshButton").addEventListener("click",()=>{loadHistory(false);if(state.currentRunId)selectRun(state.currentRunId);notify("콘솔 데이터를 새로고침했습니다.");});
  $$(".activity-tab").forEach(button=>button.addEventListener("click",()=>{
    const tab=button.dataset.logTab;
    $$(".activity-tab").forEach(item=>item.classList.toggle("active",item===button));
    state.logTab=tab;
    $("#eventList").classList.toggle("hidden",tab!=="events");
    $("#stepLogList").classList.toggle("hidden",tab!=="steps");
    if(state.logAnimationRunId){
      state.logGeneration+=1;state.logAnimationRunId=null;state.logWriteQueue=Promise.resolve();
      if(state.current){renderEvents(state.events,state.current.runId);renderStepLog(state.current);}
    }
  }));
  function tick(){ $("#clock").textContent=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
  async function init(){
    tick();setInterval(tick,1000);
    try{
      const data=await api("/api/overview");state.pendingResponseRunId=data.pendingResponseRunId||null;
      if(data.runs&&data.runs.length){state.currentRunId=data.runs[0].runId;await selectRun(state.currentRunId);}
      await loadHistory(false);
    }catch(error){notify("콘솔 연결에 실패했습니다: "+error.message);}
    setInterval(async()=>{if(state.polling||document.hidden)return;state.polling=true;try{if(state.currentRunId)await selectRun(state.currentRunId);}finally{state.polling=false;}},1500);
    setInterval(()=>{if(!document.hidden)loadHistory(false);},10000);
  }
  init();
})();
