"""Evidence integrity tests. No live upstream calls or filesystem outside tempdirs."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('filming_server', Path(__file__).with_name('server.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class FilmingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        s.DATA = Path(self.tmp.name)
        s.STATE_FILE = s.DATA / 'state.json'
        s.PRIVATE_FILE = s.DATA / 'private.json'
        s.EXPORT = s.DATA / 'evidence'
        s.PRIVATE_SESSIONS = {}
        s.STATE = {'runs': [{'runId':'TEST-1','mode':'before','controlRunId':'TEST-1','status':'RUNNING','stages':[]}], 'pendingResponseRunId':'TEST-1'}

    def tearDown(self):
        self.tmp.cleanup()

    def fake(self, method, path, body=None, merchant=None, control=False, **kw):
        if path == '/merchant/v1/sessions':
            return (200, {'sessionToken':'merchant-private'}) if method == 'POST' else (204,{})
        if path.endswith('diagnostic-targets'):
            return 200, [{'targetId':'diag-target-mart'}]
        if path.endswith('/events'): return 200, []
        if path.startswith('/control/v1/runs/'):
            if path.endswith('/respond'): return 200, {'result':'BLOCKED','protectionNoticeCreated':True}
            return 200, {'status':'ACTIVE'}
        if path.endswith('/connectivity'):
            if body.get('option') == 'status': return 200, {'result':'SUCCESS','latencyMs':3}
            if s.STATE['runs'][0]['mode'] == 'after': return 403, {'errorCode':'DIAGNOSTIC_INPUT_BLOCKED'}
            return 200, {'result':'ALERT','shellSessionToken':'never-public'}
        if path.endswith('/records'): return 200, {'recordCount':20}
        if path.endswith('/exfiltrate'): return 200, {'receiverStatus':'RECEIVED','recordCount':20,'transferId':body['transferId'],'payloadSha256':'a'*64,'runId':'TEST-1'}
        raise AssertionError(path)

    def test_receipt_and_private_token_are_separate(self):
        with patch.object(s,'call',side_effect=self.fake): s.execute('TEST-1','before')
        self.assertEqual(s.STATE['runs'][0]['status'],'ALERT')
        public = json.dumps(s.STATE)
        self.assertNotIn('never-public', public)
        self.assertNotIn('never-public', (s.EXPORT/'TEST-1.json').read_text(encoding='utf-8'))
        self.assertEqual(s.PRIVATE_SESSIONS['TEST-1'],'never-public')
        self.assertIn('TRANSFER-TEST-1', public)

    def test_failed_receiver_is_not_success(self):
        def broken(*args, **kw):
            if args[1].endswith('/exfiltrate'): return 502, {'errorCode':'RECEIVER_FAILED'}
            return self.fake(*args, **kw)
        with patch.object(s,'call',side_effect=broken): s.execute('TEST-1','before')
        self.assertEqual(s.STATE['runs'][0]['status'],'ERROR')

    def test_after_checks_normal_function(self):
        s.STATE['runs'][0]['mode']='after'
        with patch.object(s,'call',side_effect=self.fake): s.execute('TEST-1','after')
        self.assertEqual(s.STATE['runs'][0]['status'],'BLOCKED')
        self.assertTrue(s.comparison_evidence(s.STATE['runs'][0])['normalAfterCompleted'])

    def test_mismatched_receipt_is_not_confirmed(self):
        def mismatched(*args, **kw):
            code, value = self.fake(*args, **kw)
            if args[1].endswith('/exfiltrate'): value['recordCount'] = 19
            return code, value
        with patch.object(s,'call',side_effect=mismatched): s.execute('TEST-1','before')
        self.assertEqual(s.STATE['runs'][0]['status'],'ERROR')

    def test_after_regression_failure_is_error_not_pass(self):
        s.STATE['runs'][0]['mode']='after'
        def broken(*args, **kw):
            if len(args)>2 and isinstance(args[2],dict) and args[2].get('option')=='status': return 502, {'result':'FAILED'}
            return self.fake(*args, **kw)
        with patch.object(s,'call',side_effect=broken): s.execute('TEST-1','after')
        self.assertEqual(s.STATE['runs'][0]['status'],'ERROR')

    def test_same_before_session_is_replayed_and_checked(self):
        s.STATE['runs'][0]['status']='ALERT'
        s.PRIVATE_SESSIONS['TEST-1']='old-private'
        calls=[]
        def revoked(*args, **kw):
            calls.append(args)
            if '/lab-shell/' in args[1]: return 403, {'errorCode':'SHELL_SESSION_REVOKED'}
            return self.fake(*args, **kw)
        with patch.object(s,'call',side_effect=revoked): code, result=s.respond('TEST-1')
        self.assertEqual(code,200)
        self.assertTrue(result['run']['containmentVerified'])
        self.assertEqual(sum('/old-private/' in args[1] for args in calls),2)
        self.assertIsNone(s.STATE['pendingResponseRunId'])

    def test_replay_unexpected_success_does_not_claim_verified(self):
        s.STATE['runs'][0]['status']='ALERT'
        s.PRIVATE_SESSIONS['TEST-1']='old-private'
        with patch.object(s,'call',side_effect=self.fake): code,result=s.respond('TEST-1')
        self.assertFalse(result['run']['containmentVerified'])
        self.assertIn('미검증',result['run']['summary'])

    def test_card03_is_locked_while_before_requires_response(self):
        with patch.object(s,'call') as upstream: code,_=s.card03_compare()
        self.assertEqual(code,409)
        upstream.assert_not_called()

    def test_overview_does_not_pair_unrelated_after(self):
        s.STATE['runs']=[{'runId':'AFTER','mode':'after','beforeRunId':'OTHER'}, {'runId':'BEFORE','mode':'before'}]
        with patch.object(s,'call',return_value=(200,{'status':'UP'})): value=s.overview()
        self.assertIsNone(value['comparison']['after'])

    def test_after_requires_verified_before(self):
        s.STATE={'runs':[], 'pendingResponseRunId':None}
        with patch.object(s,'call') as upstream: code,value=s.create_run('after')
        self.assertEqual(code,409)
        self.assertEqual(value['errorCode'],'VERIFIED_BEFORE_REQUIRED')
        upstream.assert_not_called()


if __name__=='__main__': unittest.main()
