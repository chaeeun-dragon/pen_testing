(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const phaseOrder = ["preflight", "baseline", "before", "evidence", "respond", "after", "member"];
  const phaseNames = {
    preflight: "환경 확인",
    baseline: "정상 진단",
    before: "Before 공격",
    evidence: "공격 증거",
    respond: "운영자 대응",
    after: "After 검증",
    member: "회원 보호"
  };
  const actorNames = { system:"SYSTEM", attacker:"ATTACKER", defender:"DEFENDER" };
  const statusNames = { RUNNING:"진행 중", SUCCESS:"완료", COMPLETED:"완료", ALERT:"탐지", BLOCKED:"차단", CONTAINED:"대응 완료", SKIPPED:"미실행", ERROR:"오류" };
  const state = {
    demoRunIds: {},
    knownLines: new Set(),
    currentPhase: null,
    running: false,
    nextStep: "baseline",
    terminalGroup: null,
    beforeDetail: null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    writeQueue: Promise.resolve(),
    evidence: { baseline:"대기", detection:"대기", records:"—", receiver:"—", response:"대기", after:"대기" }
  };

  function presentationWait(ms) { return new Promise(resolve => window.setTimeout(resolve, state.reducedMotion ? 0 : ms)); }
  function pollWait(ms) { return new Promise(resolve => window.setTimeout(resolve, ms)); }
  function formatTime(value) {
    if (!value) return "--:--:--";
    const date = new Date(String(value).endsWith("Z") ? value : `${value}Z`);
    return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  }
  function shortId(value) {
    const text = String(value || "");
    return text.length > 28 ? `${text.slice(0, 18)}…${text.slice(-6)}` : text || "실행 ID 없음";
  }
  function shortHash(value) {
    const text = String(value || "");
    return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text || "—";
  }
  async function api(url, options) {
    const response = await fetch(url, Object.assign({ cache:"no-store", headers:{ Accept:"application/json" } }, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.errorCode || `HTTP ${response.status}`);
    return data;
  }
  function detailBits(detail) {
    if (!detail || typeof detail !== "object") return "";
    const parts = [];
    if (detail.httpStatus != null) parts.push(`HTTP ${detail.httpStatus}`);
    if (detail.latencyMs != null) parts.push(`${detail.latencyMs} ms`);
    if (detail.recordCount != null) parts.push(`${detail.recordCount}건`);
    if (detail.receiverStatus) parts.push(detail.receiverStatus === "RECEIVED" ? "수신 확인" : detail.receiverStatus);
    if (detail.payloadSha256) parts.push(`SHA-256 ${shortHash(detail.payloadSha256)}`);
    if (detail.protectionNoticeCreated != null) parts.push(detail.protectionNoticeCreated ? "보호 안내 등록" : "보호 안내 대상 없음");
    if (detail.control) parts.push("허용 목록 정책");
    return parts.join(" · ");
  }
  async function typeText(node, value, speed) {
    if (!value) return;
    if (state.reducedMotion) {
      node.textContent = value;
      return;
    }
    node.classList.add("is-typing");
    for (const character of Array.from(value)) {
      node.textContent += character;
      $("#terminalOutput").scrollTop = $("#terminalOutput").scrollHeight;
      await presentationWait(speed);
    }
    node.classList.remove("is-typing");
  }
  async function renderLine(kind, message, meta, actor) {
    const output = $("#terminalOutput");
    output.querySelector(".terminal-welcome")?.remove();
    const row = document.createElement("div");
    row.className = `terminal-line ${kind} actor-${actor}`;
    const time = document.createElement("time"); time.textContent = formatTime(new Date().toISOString());
    const marker = document.createElement("span"); marker.className = "line-marker"; marker.textContent = actorNames[actor] || actorNames.system;
    const text = document.createElement("strong");
    row.append(time, marker, text); output.append(row); output.scrollTop = output.scrollHeight;
    await typeText(text, message, kind === "command" ? 72 : 52);
    if (meta) {
      const detail = document.createElement("small"); row.append(detail);
      await typeText(detail, meta, 34);
    }
    await presentationWait(520);
  }
  function appendLine(kind, message, meta = "", key = `${kind}:${message}:${meta}:${Date.now()}`, actor = "system") {
    if (state.knownLines.has(key)) return Promise.resolve(false);
    state.knownLines.add(key);
    const queued = state.writeQueue.then(() => renderLine(kind, message, meta, actor));
    state.writeQueue = queued.catch(() => {});
    return queued;
  }
  async function beginTerminalGroup(code, title) {
    await state.writeQueue;
    if (state.terminalGroup === code) return;
    const output = $("#terminalOutput");
    output.replaceChildren();
    output.scrollTop = 0;
    state.terminalGroup = code;
    $("#terminalTitle").textContent = `haeon-sec / terminal ${code}`;
    $("#terminalSessionLabel").textContent = `SESSION ${code}`;
    output.dataset.session = code;
    output.classList.remove("terminal-session-open");
    void output.offsetWidth;
    output.classList.add("terminal-session-open");
    const heading = document.createElement("div");
    heading.className = "terminal-group-heading";
    const number = document.createElement("span"); number.textContent = code;
    const label = document.createElement("strong"); label.textContent = title;
    const fresh = document.createElement("small"); fresh.textContent = "NEW SESSION";
    heading.append(number, label, fresh);
    output.append(heading);
  }
  function setActor(actor) {
    const value = actorNames[actor] ? actor : "system";
    const badge = $("#actorBadge");
    badge.textContent = actorNames[value]; badge.className = `actor-badge ${value}`;
  }
  function setPlaybackState(text, tone) {
    const pill = $("#playbackState");
    pill.textContent = text; pill.className = `state-pill ${tone}`;
  }
  function setPhase(phase, status = "current") {
    state.currentPhase = phase;
    $$("#phaseList li").forEach(item => {
      const active = item.dataset.phase === phase;
      const past = phaseOrder.indexOf(item.dataset.phase) < phaseOrder.indexOf(phase);
      item.classList.toggle("active", active);
      item.classList.toggle("done", past || (active && status === "done"));
      item.classList.toggle("blocked", active && status === "blocked");
      item.classList.toggle("failed", active && status === "error");
    });
  }
  function setMetrics() {
    $("#metricBaseline").textContent = state.evidence.baseline;
    $("#metricDetection").textContent = state.evidence.detection;
    $("#metricRecords").textContent = state.evidence.records;
    $("#metricReceiver").textContent = state.evidence.receiver;
    $("#metricResponse").textContent = state.evidence.response;
    $("#metricAfter").textContent = state.evidence.after;
  }
  function updatePrimaryAction() {
    const labels = {
      baseline:"시연 시작 · 기준선 확인",
      attacker:"다음 단계 · 공격자 Before",
      defender:"다음 단계 · 방어자 대응 / After",
      member:"다음 단계 · 회원 보호",
      complete:"새 시연 준비",
      error:"표시 초기화 후 다시 시작"
    };
    const guides = {
      baseline:"환경과 정상 진단을 확인한 뒤 공격자 단계에서 잠시 멈춥니다.",
      attacker:"Before 공격과 수신 증거를 순서대로 표시한 뒤 방어자 단계에서 멈춥니다.",
      defender:"세션 폐기와 After 차단 검증을 순서대로 표시합니다.",
      member:"영향 회원의 보호 안내 장면으로 전환합니다.",
      complete:"전체 단계가 끝났습니다. 새 시연을 준비할 수 있습니다.",
      error:"표시를 초기화한 뒤 실행 상태를 확인하고 다시 시작하세요."
    };
    $("#startButtonLabel").textContent = labels[state.nextStep];
    $("#controlGuide").textContent = guides[state.nextStep];
  }
  function updateScene(kind, values = {}) {
    const address = $("#sceneAddress"), title = $("#sceneTitle"), description = $("#sceneDescription");
    const resultLabel = $("#sceneResultLabel"), resultValue = $("#sceneResultValue"), body = $("#sceneBody"), link = $("#sceneLink");
    const scenes = {
      preflight: { address:"haeon.localhost/merchant", title:"결제 연동 상태 진단", description:"등록된 진단 대상과 지원 서비스 연결 상태를 확인합니다.", label:"환경", value:"준비 확인", className:"scene-merchant", href:"http://haeon.localhost:8090/merchant/", action:"가맹점 화면 열기" },
      baseline: { address:"haeon.localhost/merchant", title:"결제 연동 상태 진단", description:"등록된 대상의 연결 확인이 완료되었습니다.", label:"연결 상태", value:values.latency ? `정상 · ${values.latency} ms` : "정상", className:"scene-merchant", href:"http://haeon.localhost:8090/merchant/", action:"가맹점 화면 열기" },
      before: { address:"haeon-attack.localhost", title:"공격자 관점 · Before", description:"제한된 세션 흐름과 지정 자료 접근 결과가 실행 ID에 연결되었습니다.", label:"공격 결과", value:values.records ? `${values.records}건 · ${values.receiver || "수신 확인"}` : "탐지", className:"scene-security", href:"http://haeon-attack.localhost:8090/", action:"운영 콘솔 열기" },
      evidence: { address:"haeon-attack.localhost", title:"공격 증거 대조", description:"실행 단계와 내부 수신 결과를 같은 실행 단위로 확인합니다.", label:"SHA-256", value:values.hash || "확인됨", className:"scene-security", href:"http://haeon-attack.localhost:8090/", action:"운영 콘솔 열기" },
      respond: { address:"haeon.localhost/mypage", title:"방어자 대응 · 회원 보호", description:"모의 세션을 폐기하고 영향 회원에게 추가 확인 안내를 등록합니다.", label:"보호 상태", value:values.notice ? "안내 등록" : "대응 완료", className:"scene-member", href:"http://haeon.localhost:8090/mypage", action:"회원 포털 열기" },
      after: { address:"haeon.localhost/merchant", title:"방어자 관점 · After", description:"비정상 진단 입력이 허용 목록 정책에서 차단되었습니다.", label:"검증 결과", value:"403 · 차단", className:"scene-blocked", href:"http://haeon.localhost:8090/merchant/", action:"가맹점 화면 열기" },
      member: { address:"haeon.localhost/mypage", title:"추가 확인 필요 안내", description:"회원 포털에서 안내와 확인 완료 상태를 조회할 수 있습니다.", label:"회원 보호", value:"안내 조회", className:"scene-member", href:"http://haeon.localhost:8090/mypage", action:"회원 포털 열기" },
      error: { address:"haeon-attack.localhost", title:"시연 실행 중단", description:"실제 결과를 확인하지 못해 이후 단계를 실행하지 않았습니다.", label:"상태", value:"확인 필요", className:"scene-error", href:"http://haeon-attack.localhost:8090/", action:"운영 콘솔 열기" }
    };
    const scene = scenes[kind] || scenes.preflight;
    address.textContent = scene.address; title.textContent = scene.title; description.textContent = scene.description;
    resultLabel.textContent = scene.label; resultValue.textContent = scene.value;
    const isHash = kind === "evidence" && Boolean(values.hash);
    resultValue.classList.toggle("scene-result-hash", isHash);
    if (isHash) resultValue.title = values.hash;
    else resultValue.removeAttribute("title");
    body.className = `scene-body ${scene.className}`; link.href = scene.href; link.childNodes[0].textContent = `${scene.action} `;
  }
  async function stageLine(run, stage, actor) {
    const key = `${run.runId}:${stage.label}:${stage.status}:${stage.at}`;
    const status = statusNames[stage.status] || stage.status;
    const meta = [status, detailBits(stage.detail)].filter(Boolean).join(" · ");
    const kind = stage.status === "ERROR" ? "error" : stage.status === "ALERT" || stage.status === "BLOCKED" ? "notice" : "result";
    await appendLine(kind, stage.label, meta, key, actor);
  }
  function extractEvidence(run) {
    const stages = run.stages || [];
    const details = stages.map(stage => stage.detail || {});
    const first = key => details.find(detail => detail[key] != null)?.[key];
    return { latency:first("latencyMs"), records:first("recordCount"), receiver:first("receiverStatus"), hash:first("payloadSha256"), notice:first("protectionNoticeCreated") };
  }
  async function waitForRun(runId, expectedStatus, phase, actor) {
    const deadline = Date.now() + 90000;
    let latest;
    while (Date.now() < deadline) {
      const payload = await api(`/api/runs/${encodeURIComponent(runId)}`);
      latest = payload;
      for (const stage of payload.run.stages || []) await stageLine(payload.run, stage, actor);
      if (payload.run.status !== "RUNNING") break;
      await pollWait(350);
    }
    if (!latest) throw new Error("실행 결과를 불러오지 못했습니다.");
    const actual = latest.run.status;
    if (actual !== expectedStatus) throw new Error(`${phaseNames[phase]} 결과가 ${statusNames[expectedStatus] || expectedStatus} 상태가 아닙니다. 현재 상태: ${statusNames[actual] || actual}`);
    return latest;
  }
  async function executeRun(phase, mode, expectedStatus, actor) {
    setActor(actor); setPhase(phase); setPlaybackState(`${phaseNames[phase]} 실행 중`, "running");
    await appendLine("command", `${phaseNames[phase]} 단계 시작`, "고정된 시나리오 경로 실행", `command:${phase}:${Date.now()}`, actor);
    const created = await api("/api/runs", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ mode }) });
    state.demoRunIds[phase] = created.runId;
    $("#runSummary").textContent = shortId(created.runId);
    await appendLine("notice", "실행 ID 발급", shortId(created.runId), `created:${created.runId}`, actor);
    const detail = await waitForRun(created.runId, expectedStatus, phase, actor);
    const evidence = extractEvidence(detail.run);
    if (phase === "baseline") {
      state.evidence.baseline = evidence.latency ? `정상 · ${evidence.latency} ms` : "정상";
      updateScene("baseline", evidence);
    }
    if (phase === "before") {
      state.evidence.detection = "탐지";
      state.evidence.records = evidence.records != null ? `${evidence.records}건` : "확인 필요";
      state.evidence.receiver = evidence.receiver === "RECEIVED" ? "수신 확인" : (evidence.receiver || "확인 필요");
      updateScene("before", evidence);
    }
    if (phase === "after") {
      state.evidence.after = "차단 · 후속 미실행";
      updateScene("after", evidence);
    }
    setMetrics(); setPhase(phase, expectedStatus === "BLOCKED" ? "blocked" : "done");
    return detail;
  }
  async function executeResponse(beforeDetail) {
    setActor("defender"); setPhase("respond"); setPlaybackState("방어자 대응 실행 중", "running");
    await appendLine("command", "운영자 대응 단계 시작", "Before 실행의 모의 세션을 폐기합니다.", `respond:${Date.now()}`, "defender");
    const runId = beforeDetail.run.runId;
    const payload = await api(`/api/runs/${encodeURIComponent(runId)}/respond`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:"{}" });
    for (const stage of payload.run.stages || []) await stageLine(payload.run, stage, "defender");
    if (payload.run.status !== "CONTAINED") throw new Error("운영자 대응 완료 상태를 확인하지 못했습니다.");
    const evidence = extractEvidence(payload.run);
    state.evidence.response = evidence.notice ? "세션 폐기 · 안내 등록" : "세션 폐기";
    setMetrics(); updateScene("respond", evidence); setPhase("respond", "done");
    await appendLine("notice", "운영자 대응 완료", state.evidence.response, `response:${runId}`, "defender");
    return payload;
  }
  async function preflight() {
    setActor("system"); setPhase("preflight"); setPlaybackState("환경 확인 중", "running"); updateScene("preflight");
    await appendLine("command", "시연 환경 확인", "대상 연결과 실행 대기 상태를 확인합니다.", "preflight:start", "system");
    const overview = await api("/api/overview");
    if (!overview.targetConnected) throw new Error("지원 서비스 연결 상태를 확인하지 못했습니다.");
    if (overview.pendingResponseRunId) throw new Error("이전 Before 실행이 대응 대기 중입니다. 운영 콘솔에서 먼저 확인하세요.");
    if ((overview.runs || []).some(run => run.status === "RUNNING")) throw new Error("이미 진행 중인 실행이 있습니다. 완료 후 다시 시작하세요.");
    $("#serviceStatus").classList.add("online"); $("#serviceStatus").lastChild.textContent = "지원 서비스 연결됨";
    await appendLine("result", "대상 환경 준비 확인", "haeon.localhost · 고정 시나리오 경로", "preflight:ready", "system");
    setPhase("preflight", "done");
  }
  async function runBaselineStep() {
    await beginTerminalGroup("00–01", "환경 확인 · 정상 진단");
    await preflight();
    await executeRun("baseline", "baseline", "COMPLETED", "system");
    await appendLine("notice", "기준선 확인 완료", "다음 버튼을 눌러 공격자 Before 단계를 시작하세요.", "pause:baseline", "system");
    setPlaybackState("기준선 완료 · 공격자 대기", "success");
    state.nextStep = "attacker";
  }
  async function runAttackerStep() {
    await beginTerminalGroup("02–03", "공격자 Before · 증거");
    setActor("attacker");
    const before = await executeRun("before", "before", "ALERT", "attacker");
    state.beforeDetail = before;
    setPhase("evidence"); setPlaybackState("공격 증거 확인", "alert");
    const evidence = extractEvidence(before.run);
    await appendLine("notice", "탐지 증거 대조", `${evidence.records ?? "—"}건 · ${evidence.receiver === "RECEIVED" ? "수신 확인" : "수신 결과 확인"} · SHA-256 ${shortHash(evidence.hash)}`, `evidence:${before.run.runId}`, "attacker");
    updateScene("evidence", evidence); setPhase("evidence", "done");
    await appendLine("notice", "공격자 단계 완료", "다음 버튼을 눌러 방어자 대응과 After 검증을 시작하세요.", "pause:attacker", "attacker");
    setPlaybackState("공격자 완료 · 방어자 대기", "alert");
    state.nextStep = "defender";
  }
  async function runDefenderStep() {
    if (!state.beforeDetail) throw new Error("먼저 공격자 Before 단계를 완료하세요.");
    await beginTerminalGroup("04", "운영자 대응 · 세션 폐기");
    setActor("defender");
    await executeResponse(state.beforeDetail);
    await appendLine("result", "대응 결과 확인", "모의 세션 폐기 후 동일 입력의 차단 여부를 검증합니다.", "defender:transition", "defender");
    await beginTerminalGroup("05", "After 차단 검증");
    await executeRun("after", "after", "BLOCKED", "defender");
    await appendLine("notice", "방어자 단계 완료", "다음 버튼을 눌러 회원 보호 안내 장면으로 이동하세요.", "pause:defender", "defender");
    setPlaybackState("방어자 완료 · 회원 보호 대기", "success");
    state.nextStep = "member";
  }
  async function runMemberStep() {
    await beginTerminalGroup("06", "회원 보호 안내");
    setActor("defender"); setPhase("member"); setPlaybackState("회원 보호 안내 확인", "success");
    await appendLine("result", "회원 보호 안내 조회 준비", "영향 회원의 마이페이지에서 추가 확인 안내를 확인할 수 있습니다.", "member:ready", "defender");
    updateScene("member"); setPhase("member", "done");
    await appendLine("result", "시연 시나리오 재생 완료", "정상 진단 · 공격자 Before · 방어자 대응 / After · 회원 보호 안내", "finish", "system");
    setActor("system"); setPlaybackState("재생 완료", "success");
    state.nextStep = "complete";
  }
  async function advancePlayback() {
    if (state.running) return;
    if (state.nextStep === "complete" || state.nextStep === "error") {
      clearDisplay();
      return;
    }
    state.running = true; $("#startButton").disabled = true; $("#clearButton").disabled = true;
    try {
      if (state.nextStep === "baseline") await runBaselineStep();
      else if (state.nextStep === "attacker") await runAttackerStep();
      else if (state.nextStep === "defender") await runDefenderStep();
      else if (state.nextStep === "member") await runMemberStep();
    } catch (error) {
      const phase = state.currentPhase || "preflight";
      setPhase(phase, "error"); setPlaybackState("확인 필요", "error"); setActor("system");
      await appendLine("error", "시연을 중단했습니다", error.message || "실제 결과를 확인하지 못했습니다.", `error:${Date.now()}`, "system");
      updateScene("error"); state.nextStep = "error";
    } finally {
      state.running = false; $("#startButton").disabled = false; $("#clearButton").disabled = false; updatePrimaryAction();
    }
  }
  function clearDisplay() {
    if (state.running) return;
    state.demoRunIds = {}; state.knownLines.clear(); state.currentPhase = null; state.beforeDetail = null;
    state.nextStep = "baseline"; state.terminalGroup = null; state.writeQueue = Promise.resolve();
    state.evidence = { baseline:"대기", detection:"대기", records:"—", receiver:"—", response:"대기", after:"대기" };
    setMetrics(); updateScene("preflight"); setActor("system");
    $("#terminalTitle").textContent = "haeon-sec / scenario-playback";
    $("#terminalSessionLabel").textContent = "시연 세션 대기";
    $("#runSummary").textContent = "실행 ID 없음"; setPlaybackState("준비됨", "ready");
    $$("#phaseList li").forEach(item => item.className = "");
    const output = $("#terminalOutput"); output.replaceChildren();
    const welcome = document.createElement("div"); welcome.className = "terminal-welcome";
    const mark = document.createElement("span"); mark.className = "welcome-mark"; mark.textContent = "H";
    const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = "해온카드 시나리오 재생 준비";
    const text = document.createElement("p"); text.textContent = "버튼을 눌러 기준선부터 공격자와 방어자 단계를 순서대로 진행합니다.";
    copy.append(title, text); welcome.append(mark, copy); output.append(welcome); updatePrimaryAction();
  }
  async function checkHealth() {
    try {
      const data = await api("/api/overview");
      const online = Boolean(data.targetConnected);
      $("#serviceStatus").classList.toggle("online", online); $("#serviceStatus").lastChild.textContent = online ? "지원 서비스 연결됨" : "연결 확인 필요";
    } catch (_) { $("#serviceStatus").lastChild.textContent = "연결 확인 필요"; }
  }
  $("#startButton").addEventListener("click", advancePlayback);
  $("#clearButton").addEventListener("click", clearDisplay);
  $("#shootModeButton").addEventListener("click", event => {
    const enabled = document.body.classList.toggle("shoot-mode"); event.currentTarget.setAttribute("aria-pressed", String(enabled));
    event.currentTarget.title = enabled ? "기본 모드 전환" : "촬영 모드 전환";
  });
  clearDisplay(); checkHealth(); window.setInterval(checkHealth, 12000);
})();
