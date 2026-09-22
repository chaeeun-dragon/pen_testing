(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { currentRunId:null, current:null, pendingResponseRunId:null, events:[], localEvents:[], logTab:"events", toastTimer:null, busy:false, activeRunId:null, polling:false };
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
  function fmtTime(value, short) {
    if(!value)return "—";
    let normalized=String(value).replace(" ","T");
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized))normalized+="Z";
    const date=new Date(normalized); if(Number.isNaN(date.getTime()))return String(value);
    const opts=short?{hour:"2-digit",minute:"2-digit",second:"2-digit"}:{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"};
    return date.toLocaleString("ko-KR",opts);
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
  function empty(parent,message,icon) {
    parent.replaceChildren();parent.classList.add("empty-state");
    const mark=document.createElement("b");mark.className="empty-icon";mark.textContent=icon||"◷";
    const label=document.createElement("span");label.textContent=message;
    parent.append(mark,label);
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
    const latest=new Map(); run.stages.forEach(item=>latest.set(item.label,item));
    [...latest.values()].forEach(item=>{
      const row=document.createElement("div");row.className="stage-row";row.dataset.status=item.status||"";
      const mark=document.createElement("span");mark.className="stage-mark";mark.textContent=({SUCCESS:"✓",ALERT:"!",BLOCKED:"⊘",ERROR:"×",RUNNING:"·",SKIPPED:"—"})[item.status]||"·";
      const copy=document.createElement("div");copy.className="stage-copy";
      const title=document.createElement("strong");title.textContent=item.label||"실행 단계";copy.append(title);
      const subText=detailText(item.detail);
      if(subText){const sub=document.createElement("small");sub.textContent=subText;copy.append(sub);}
      const stamp=document.createElement("span");stamp.className="stage-time";stamp.textContent=fmtTime(item.at,true);
      row.append(mark,copy,stamp);list.append(row);
    });
  }
  function renderEvents(events, runId) {
    const list=$("#eventList");list.replaceChildren();$("#eventCount").textContent=String(events.length);
    const visible=[...events,...state.localEvents.filter(event=>!event.runId||event.runId===runId)];
    $("#eventCount").textContent=String(visible.length);
    if(!visible.length){empty(list,"아직 이벤트가 없습니다.","◷");return;}
    list.classList.remove("empty-state");
    [...visible].reverse().forEach(event=>{
      const row=document.createElement("div");row.className="event-row";row.dataset.result=event.result||"";
      const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({BLOCKED:"⊘",ALERT:"!",ERROR:"×",PASS:"✓"})[event.result]||"·";
      const copy=document.createElement("div");copy.className="event-copy";
      const title=document.createElement("strong");title.textContent=eventLabels[event.eventType]||event.eventType||"보안 이벤트";
      const sub=document.createElement("small");sub.textContent=[event.result,detailText(event.detail)].filter(Boolean).join(" · ");
      copy.append(title);if(sub.textContent)copy.append(sub);
      const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(event.occurredAt,true);
      row.append(pin,copy,stamp);list.append(row);
    });
  }
  function renderStepLog(run) {
    const list=$("#stepLogList");list.replaceChildren();
    if(!run||!run.stages||!run.stages.length){const span=document.createElement("span");span.textContent="아직 실행 로그가 없습니다.";list.append(span);return;}
    [...run.stages].reverse().forEach(item=>{
      const row=document.createElement("div");row.className="event-row";row.dataset.result=item.status||"";
      const pin=document.createElement("span");pin.className="event-pin";pin.textContent=({SUCCESS:"✓",ALERT:"!",BLOCKED:"⊘",ERROR:"×",RUNNING:"·",SKIPPED:"—"})[item.status]||"·";
      const copy=document.createElement("div");copy.className="event-copy";
      const title=document.createElement("strong");title.textContent=item.label||"실행 단계";copy.append(title);
      const detail=detailText(item.detail);if(detail){const sub=document.createElement("small");sub.textContent=detail;copy.append(sub);}
      const stamp=document.createElement("span");stamp.className="event-time";stamp.textContent=fmtTime(item.at,true);
      row.append(pin,copy,stamp);list.append(row);
    });
  }
  function updateRun(run,events) {
    if(!run)return;
    state.current=run;state.currentRunId=run.runId;state.events=events||[];
    $("#activityRunId").textContent=run.runId;
    $("#activityStatus").textContent=statusLabels[run.status]||run.status;
    $("#metricLastRun").textContent=modeLabels[run.mode]||run.mode;
    $("#metricLastRunNote").textContent=run.runId+" · "+fmtTime(run.createdAt,false);
    $("#metricDetection").textContent=statusLabels[run.status]||run.status;
    $("#metricDetectionNote").textContent=run.summary||"이벤트 수신 대기";
    const recordCount=(run.stages||[]).map(item=>item.detail&&item.detail.recordCount).find(value=>value!=null);
    $("#metricRecords").textContent=recordCount==null?"0":String(recordCount);
    $("#lastUpdated").textContent=fmtTime(new Date().toISOString(),true);
    $("#activityStatus").className="status-text "+run.status;
    const types=new Set((events||[]).map(item=>item.eventType));
    const received=(run.stages||[]).some(item=>item.detail?.receiverStatus==="RECEIVED");
    const covered=[types.has("lab_shell_session_created"),types.has("synthetic_records_accessed"),received,types.has("incident_response_contained")].filter(Boolean).length;
    $("#signalCount").textContent=run.mode==="before"?covered+" / 4":run.mode==="after"?"선행 차단 검증":"정상 진단";
    $(".coverage-track i").style.width=(run.mode==="before"?covered*25:0)+"%";
    renderStages(run);renderEvents(events||[],run.runId);renderStepLog(run);
    syncControls();
  }
  function syncControls(){
    const run=state.current;
    const busy=state.busy||Boolean(state.activeRunId)||run?.status==="RUNNING";
    $$("[data-run-mode]").forEach(button=>button.disabled=busy||(button.dataset.runMode!=="baseline"&&Boolean(state.pendingResponseRunId)));
    $("#respondButton").disabled=busy||!run||run.mode!=="before"||run.status==="CONTAINED";
    $("#pendingRunButton").classList.toggle("hidden",!state.pendingResponseRunId||state.pendingResponseRunId===state.currentRunId);
    $("#executionHint").textContent=busy?"실행 중입니다. 단계가 끝나면 다음 작업을 선택할 수 있습니다.":state.pendingResponseRunId?"Before 실행의 대응을 먼저 완료한 뒤 After를 검증하세요.":"정상 진단 → Before → 대응 → After 순서로 실행하세요.";
  }
  async function loadHistory(selectNewest) {
    try{
      const data=await api("/api/overview");
      state.pendingResponseRunId=data.pendingResponseRunId||null;
      const runs=data.runs||[];
      state.activeRunId=runs.find(run=>run.status==="RUNNING")?.runId||null;
      $("#connectionText").textContent=data.targetConnected?"지원 서비스 연결됨":"지원 서비스 연결 실패";
      $("#targetConnection").textContent=data.targetConnected?"지원 서비스 응답 확인":"현재 연결 상태 확인 필요";
      $("#targetReadiness").textContent=data.targetConnected?"READY":"OFFLINE";
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
          const id=document.createElement("strong");id.textContent=run.runId;
          const mode=document.createElement("small");mode.textContent=modeLabels[run.mode]||run.mode;name.append(id,mode);
          const date=document.createElement("span");date.className="history-time";date.textContent=fmtTime(run.createdAt,false);
          const status=document.createElement("span");const pill=document.createElement("span");pill.className="status-pill "+run.status;pill.textContent=statusLabels[run.status]||run.status;status.append(pill);
          const open=document.createElement("span");open.className="history-open";open.textContent="↗";
          row.append(name,date,status,open);list.append(row);
        });
      }
      if(runs.length&&selectNewest&&!state.currentRunId)await selectRun(runs[0].runId);
      syncControls();
    }catch(error){recordLocalFailure(null,"실행 목록 갱신");renderEvents(state.events,state.currentRunId);notify("실행 목록을 불러오지 못했습니다.");}
  }
  async function selectRun(id) {
    state.currentRunId=id;$("#activityRunId").textContent=id;
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
      state.currentRunId=data.runId;if(mode==="before")state.pendingResponseRunId=data.runId;
      $("#activityRunId").textContent=data.runId;$("#activityStatus").textContent="진행 중";
      notify((modeLabels[mode]||mode)+" 실행을 시작했습니다.");showView("overview");
      await selectRun(data.runId);await loadHistory(false);
    }catch(error){recordLocalFailure(state.currentRunId,"시나리오 시작");renderEvents(state.events,state.currentRunId);notify("시나리오를 시작하지 못했습니다.");}
    finally{state.busy=false;button.classList.remove("loading");syncControls();}
  }
  async function respond() {
    const run=state.current;if(!run||state.busy)return;state.busy=true;syncControls();
    const button=$("#respondButton");button.disabled=true;button.classList.add("loading");
    try{
      const data=await api("/api/runs/"+encodeURIComponent(run.runId)+"/respond",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      state.pendingResponseRunId=null;updateRun(data.run,data.events||[]);
      notify(data.run.summary||"대응 결과를 확인했습니다.");await loadHistory(false);
    }catch(error){recordLocalFailure(run.runId,"대응 실행");renderEvents(state.events,run.runId);notify("대응 요청을 처리하지 못했습니다.");button.disabled=false;}
    finally{state.busy=false;button.classList.remove("loading");syncControls();}
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
    $("#eventList").classList.toggle("hidden",tab!=="events");
    $("#stepLogList").classList.toggle("hidden",tab!=="steps");
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
