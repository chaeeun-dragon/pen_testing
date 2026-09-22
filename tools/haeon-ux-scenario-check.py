#!/usr/bin/env python3
"""Local API regression checks. --faults briefly pauses/restarts only Haeon services.
Run from repository root: python3 tools/haeon-ux-scenario-check.py --faults
Evidence contains masked tokens and is never used to inject success into the DB.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
ENV = dict(line.split('=', 1) for line in (ROOT/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
CONTROL = os.environ.get('HAEON_LAB_CONTROL_TOKEN', ENV.get('HAEON_LAB_CONTROL_TOKEN','lab-control-token-2026')).strip('"\'')
OUT = ROOT/'evidence/runs'/('HAEON-UX-QA-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
OUT.mkdir(parents=True,exist_ok=True)
CHECKS=[]
CALLS=[]
OWN_RUNS=[]
SESSIONS=[]
COMPOSE=['docker','compose','--env-file','.env']

def masked(value):
    if isinstance(value,dict):
        return {key: ('[REDACTED]' if re.search(r'token|password|sessionId',key,re.I) else masked(item)) for key,item in value.items()}
    if isinstance(value,list):return [masked(item) for item in value]
    return value

def api(path,body=None,method=None,token=None,control=False,console=False,expected=200):
    headers={'Host':'haeon-attack.localhost:8090' if console else 'haeon.localhost:8090','Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    if control:headers['X-Lab-Control-Token']=CONTROL
    port=8092 if control else 8090
    data=None if body is None else json.dumps(body).encode()
    request=Request(f'http://127.0.0.1:{port}'+path,data=data,headers=headers,method=method or ('POST' if body is not None else 'GET'))
    start=time.monotonic()
    try:
        with urlopen(request,timeout=12) as response: code,raw=response.status,response.read()
    except HTTPError as error:code,raw=error.code,error.read()
    try:value=json.loads(raw) if raw else {}
    except ValueError:value={'html':raw.decode(errors='replace')[:150]}
    CALLS.append({'path':re.sub(r'/sessions/[^/]+','/sessions/[REDACTED]',path),'method':request.method,'status':code,'elapsedMs':round((time.monotonic()-start)*1000),'request':masked(body),'response':masked(value)})
    if expected is not None: assert code==expected,(path.split('/sessions/')[0],code,masked(value))
    return value

def check(name,condition=True):
    assert condition,name
    CHECKS.append({'name':name,'result':'PASS'})
    print('PASS',name,flush=True)

def login(name,password,portal=False):
    path='/portal/v1/sessions' if portal else '/merchant/v1/sessions'
    value=api(path,{'loginId':name,'password':password})
    SESSIONS.append((path,value['sessionToken']))
    return value['sessionToken']

def run(mode='before'):
    value=api('/control/v1/runs',{'mode':mode,'merchantNo':'HAEON-MART','memberNo':'HC-MEMBER-001'},control=True)
    OWN_RUNS.append(value['runId']);return value['runId']

def shell(merchant,run_id):
    return api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'status;LAB_SHELL','runId':run_id},token=merchant)['shellSessionToken']

def respond(run_id):return api(f'/control/v1/runs/{run_id}/respond',{},control=True)

def receipt(transfer):
    # Read internal receipt through the existing console network; no host port is published.
    code="import urllib.request;print(urllib.request.urlopen('http://haeon-lab-receiver:8093/v1/receipts/"+transfer+"').read().decode())"
    return json.loads(subprocess.check_output(COMPOSE+['exec','-T','haeon-attack-console','python','-c',code],cwd=ROOT,text=True))

def wait_console(run_id):
    for _ in range(40):
        value=api('/api/runs/'+run_id,console=True)
        if value['run']['status']!='RUNNING':return value
        time.sleep(.25)
    raise AssertionError('console did not complete')

def docker(*args):
    subprocess.run(COMPOSE+list(args),cwd=ROOT,check=True,stdout=subprocess.DEVNULL)

def suite(faults):
    merchant=login('labmart','LabMart!2026')
    member=login('haeon01','Haeon!2026',True)
    other=login('haeon02','Haeon!2026',True)
    check('member login/cards/history',len(api('/portal/v1/me/cards',token=member)['cards'])>0 and 'transactions' in api('/portal/v1/me/transactions?limit=20',token=member))
    api('/portal/v1/me/protection-notices',expected=401)
    baseline=api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'status'},token=merchant)
    check('normal diagnostic performs HTTP',baseline['result']=='SUCCESS' and isinstance(baseline['latencyMs'],int))
    api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-cafe','option':'status'},token=merchant,expected=404)
    api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'unexpected'},token=merchant,expected=400)
    check('merchant ownership and option allowlist')
    for path in ['/control/v1/runs','/internal/v1/authorizations']:
        api(path,{},expected=404)
    api('/control/v1/runs',{},token=merchant,expected=404)
    check('public gateway blocks management and approval routes')
    created=run(); session=shell(merchant,created); path='/lab-shell/v1/sessions/'+session
    active_conflict=api('/control/v1/runs',{'mode':'after','merchantNo':'HAEON-MART','memberNo':'HC-MEMBER-001'},control=True,expected=409)
    check('management API limits active execution',active_conflict['errorCode']=='ACTIVE_RUN_EXISTS')
    records=api(path+'/records')
    check('Before authenticated mock session reads 20 records',records['recordCount']==20 and all(x['memberNo']=='HC-MEMBER-001' for x in records['records']))
    transfer='QA-'+created
    sent=api(path+'/exfiltrate',{'transferId':transfer})
    replay=api(path+'/exfiltrate',{'transferId':transfer})
    received=receipt(transfer)
    check('receiver count/hash verified and retry idempotent',sent['recordCount']==20 and sent['runId']==replay['runId']==created and sent['payloadSha256']==received['sha256']==replay['payloadSha256'] and received['recordCount']==20)
    (OUT/'receiver-receipt.json').write_text(json.dumps(received,ensure_ascii=False,indent=2))
    # The completed, verified transfer is the impact evidence used by response.
    # A separate concurrent submission would not prove which request acquired the
    # controller lock first, so it is intentionally not treated as a race test.
    response=respond(created)
    check('response reports observed impact',response['protectionNoticeCreated'] and response['exfiltrationConfirmed'])
    events1=api(f'/control/v1/runs/{created}/events',control=True)
    respond(created)
    events2=api(f'/control/v1/runs/{created}/events',control=True)
    check('duplicate response does not duplicate events',len(events1)==len(events2))
    for suffix in ['', '/records']:
        api(path+suffix,expected=403)
    api(path+'/exfiltrate',{'transferId':'LATE-'+created},expected=403)
    api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'status;LAB_SHELL','runId':created},token=merchant,expected=403)
    check('revoked session and contained run cannot re-enter/read/transfer')
    notices=api('/portal/v1/me/protection-notices',token=member)['notices']
    own=[n for n in notices if n['runId']==created]
    check('affected member receives exactly one notice',len(own)==1)
    notice=own[0]['noticeId']
    api(f'/portal/v1/me/protection-notices/{notice}/acknowledgement',{},token=other,expected=404)
    check('other member cannot read notices',not api('/portal/v1/me/protection-notices',token=other)['notices'])
    api(f'/portal/v1/me/protection-notices/{notice}/acknowledgement',{},token=member)
    acknowledged=[n for n in api('/portal/v1/me/protection-notices',token=member)['notices'] if n['noticeId']==notice][0]
    check('acknowledgement persists',acknowledged['acknowledged'] and acknowledged['acknowledgedAt'])
    after=run('after')
    blocked=api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'status;LAB_SHELL','runId':after},token=merchant,expected=403)
    check('After blocks same input',blocked['errorCode']=='DIAGNOSTIC_INPUT_BLOCKED')
    noimpact=respond(after)
    check('blocked input without access creates no notice',not noimpact['protectionNoticeCreated'])
    overview=api('/api/overview',console=True)
    check('console health reflects support',overview['targetConnected'])
    if overview.get('pendingResponseRunId'):raise AssertionError('Existing operator run awaits response; finish it before this suite.')
    for mode,expected in [('baseline','COMPLETED'),('before','ALERT'),('after','BLOCKED')]:
        result=api('/api/runs',{'mode':mode},console=True,expected=202)
        detail=wait_console(result['runId'])
        check('console '+mode,detail['run']['status']==expected)
        if mode=='before':
            OWN_RUNS.append(result['runId'])
            api('/api/runs/'+result['runId']+'/respond',{},console=True)
        if mode=='after':check('After explicitly marks skipped follow-up',any(s['status']=='SKIPPED' for s in detail['run']['stages']))
    api('/api/runs',[],console=True,expected=400)
    api('/api/runs',{'mode':[]},console=True,expected=400)
    check('console malformed requests rejected')
    if faults:
        fault_run=run();fault_shell=shell(merchant,fault_run);fault_path='/lab-shell/v1/sessions/'+fault_shell
        docker('pause','haeon-lab-receiver')
        try:
            start=time.monotonic()
            failed=api('/merchant/v1/diagnostics/connectivity',{'targetId':'diag-target-mart','option':'status'},token=merchant,expected=502)
            check('receiver timeout is failure within bound',failed['result']=='FAILED' and time.monotonic()-start<6)
            failed=api(fault_path+'/exfiltrate',{'transferId':'RETRY-'+fault_run},expected=502)
            check('failed transfer never reports received',failed['receiverStatus']=='FAILED')
        finally:docker('unpause','haeon-lab-receiver')
        sent=api(fault_path+'/exfiltrate',{'transferId':'RETRY-'+fault_run})
        check('failed transfer can retry safely',sent['receiverStatus']=='RECEIVED' and receipt('RETRY-'+fault_run)['sha256']==sent['payloadSha256'])
        respond(fault_run)
        docker('restart','haeon-merchant-support')
        for _ in range(45):
            try:
                if api('/actuator/health',control=True,expected=None).get('status')=='UP':break
            except OSError:pass
            time.sleep(1)
        api(fault_path+'/records',expected=403)
        check('containment survives support restart')
        docker('restart','haeon-attack-console')
        for _ in range(15):
            try:
                history=api('/api/overview',console=True)
                break
            except (OSError,AssertionError):time.sleep(1)
        check('console history survives restart',any(x['runId']==result['runId'] for x in history['runs']))
    api('/merchant/v1/sessions',method='DELETE',token=merchant,expected=204)
    api('/merchant/v1/diagnostic-targets',token=merchant,expected=401)
    check('logout invalidates merchant token')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--faults',action='store_true');args=parser.parse_args()
    success=False
    try:
        suite(args.faults);success=True
    finally:
        for run_id in OWN_RUNS:
            try:respond(run_id)
            except Exception:pass
        for path,token in SESSIONS:
            try:api(path,method='DELETE',token=token,expected=204)
            except Exception:pass
        (OUT/'requests-responses.json').write_text(json.dumps(CALLS,ensure_ascii=False,indent=2))
        (OUT/'result.json').write_text(json.dumps({'success':success,'checks':CHECKS,'faults':args.faults},ensure_ascii=False,indent=2))
        hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.glob('*.json')}
        (OUT/'sha256.json').write_text(json.dumps(hashes,indent=2))
        print('Evidence:',OUT,flush=True)
