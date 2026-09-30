(function(root) {
  'use strict';
  const commands = ['help','lab status','lab baseline','lab before','lab records','lab receipt','lab contain','lab after','lab compare','lab card03','clear'];
  const parse = input => {
    if (typeof input !== 'string' || input.length > 80) return null;
    const command = input.trim().replace(/\s+/g,' ').toLowerCase();
    return commands.includes(command) ? command : null;
  };
  const stage = (run,label) => [...(run?.stages || [])].reverse().find(item => item.label === label);
  const successful = item => item && ['SUCCESS','ALERT','BLOCKED'].includes(item.status);
  function facts(run) {
    const query = stage(run,'합성 지원 자료 조회');
    const receipt = stage(run,'내부 수신기로 전송');
    const info = receipt?.detail || {};
    const count = successful(query) && Number.isInteger(query.detail?.recordCount) ? query.detail.recordCount : null;
    const received = Boolean(successful(receipt) && info.receiverStatus === 'RECEIVED' && info.runId === run?.runId &&
      info.transferId === 'TRANSFER-'+run?.runId && Number.isInteger(info.recordCount) && info.recordCount === count && /^[a-f0-9]{64}$/.test(info.payloadSha256 || ''));
    const denied = label => { const item = stage(run,label); return item?.status === 'BLOCKED' && item.detail?.httpStatus === 403 && ['SHELL_SESSION_REVOKED','RUN_CONTAINED'].includes(item.detail?.errorCode); };
    const blocked = stage(run,'비정상 진단 입력 탐지·차단');
    const notice = stage(run,'실행 세션 폐기 및 회원 보호 안내 등록');
    return {
      session:stage(run,'제한된 모의 웹 세션 생성')?.status === 'ALERT', count, received, receipt:received?info:null,
      normal:stage(run,'등록 대상 연결 진단')?.status === 'SUCCESS',
      notice:Boolean(successful(notice) && notice.detail?.protectionNoticeCreated === true),
      contained:Boolean(run?.containmentVerified && denied('이전 세션 재조회 거부 검증') && denied('이전 세션 재전송 거부 검증')),
      blocked:blocked?.status === 'BLOCKED' && blocked.detail?.httpStatus === 403 && blocked.detail?.errorCode === 'DIAGNOSTIC_INPUT_BLOCKED',
      normalAfter:stage(run,'After 정상 진단 재검증')?.status === 'SUCCESS'
    };
  }
  function compare(before, after, baseline) {
    const b = facts(before), a = facts(after?.beforeRunId === before?.runId ? after : null);
    const normal = Boolean(before?.baselineRunId && baseline?.runId === before.baselineRunId && facts(baseline).normal);
    return [
      ['모의 웹 세션', b.session?'생성':'미확인', a.blocked?'미생성 · 선행 차단':'미확인'],
      ['합성자료 조회', b.count === null?'미확인':b.count+'건', a.blocked?'미실행':'미확인'],
      ['내부 수신기', b.received?'RECEIVED':'미확인', a.blocked?'미실행':'미확인'],
      ['정상 진단', normal?'정상':'기준선 미확인', a.normalAfter?'정상 유지':'미검증']
    ];
  }
  const core = {commands,parse,stage,facts,compare};
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.TerminalSceneCore = core;
})(typeof window === 'undefined' ? {} : window);
