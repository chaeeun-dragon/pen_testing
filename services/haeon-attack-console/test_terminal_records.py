"""Fixed-path terminal API tests: no live service or stored credentials used."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('terminal_server', Path(__file__).with_name('server.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class TerminalRecordsTests(unittest.TestCase):
    def setUp(self):
        s.STATE = {'runs': [{'runId': 'TEST-1', 'mode': 'before', 'status': 'ALERT'}]}
        s.PRIVATE_SESSIONS = {'TEST-1': 'private-test-session'}
        self.row = {'supportRef': 'SUP-202609-01', 'memberNo': 'HC-MEMBER-001', 'cardLast4': '2001',
                    'transactionRef': 'LAB-TXN-001', 'amount': 13700, 'occurredAt': '2026-09-19T12:00:00Z'}

    def response(self, **extra):
        return {'runId': 'TEST-1', 'recordCount': 1, 'records': [dict(self.row)], 'simulation': True, **extra}

    def test_allowed_fields_only_and_no_token_exposure(self):
        value = self.response()
        value['records'][0]['secret'] = 'must-not-leak'
        with patch.object(s, 'call', return_value=(200,value)) as call:
            code,result=s.terminal_records('TEST-1')
        call.assert_called_once_with('GET','/lab-shell/v1/sessions/private-test-session/records')
        self.assertEqual(code,200)
        self.assertEqual(result['records'],[self.row])
        self.assertNotIn('private-test-session',str(result))

    def test_revocation_is_real_upstream_response(self):
        s.STATE['runs'][0]['status']='CONTAINED'
        with patch.object(s,'call',return_value=(403,{'errorCode':'SHELL_SESSION_REVOKED'})) as call:
            code,result=s.terminal_records('TEST-1')
        self.assertEqual(code,403)
        self.assertEqual(result['errorCode'],'SHELL_SESSION_REVOKED')
        call.assert_called_once()

    def test_reject_non_synthetic_mismatched_and_invalid_payloads(self):
        for value in [self.response(simulation=False),self.response(runId='OTHER'),self.response(recordCount=20),self.response(records='bad'),self.response(records=[self.row]*51,recordCount=51)]:
            with self.subTest(value=value),patch.object(s,'call',return_value=(200,value)):
                self.assertEqual(s.terminal_records('TEST-1')[0],502)
        for key,value in [('memberNo','REAL-MEMBER'),('cardLast4','4111111111111111'),('supportRef','private-name'),('transactionRef','REAL-TXN'),('amount','13700'),('occurredAt',None)]:
            row={**self.row,key:value}
            with self.subTest(field=key),patch.object(s,'call',return_value=(200,self.response(records=[row]))):
                self.assertEqual(s.terminal_records('TEST-1')[0],502)

    def test_invalid_input_does_not_call_service(self):
        with patch.object(s,'call') as call:
            for value in [None,{},'../secret','a/b','test;id','a'*101]:
                self.assertEqual(s.terminal_records(value)[0],400)
        call.assert_not_called()

    def test_missing_running_and_non_before_are_denied(self):
        with patch.object(s,'call') as call:
            self.assertEqual(s.terminal_records('MISSING')[0],404)
            s.STATE['runs'][0]['mode']='after'
            self.assertEqual(s.terminal_records('TEST-1')[0],404)
            s.STATE['runs'][0].update(mode='before',status='RUNNING')
            self.assertEqual(s.terminal_records('TEST-1')[0],409)
            s.STATE['runs'][0]['status']='ALERT'
            s.PRIVATE_SESSIONS={}
            self.assertEqual(s.terminal_records('TEST-1')[0],409)
        call.assert_not_called()

    def test_busy_is_denied(self):
        s.ACTION_LOCK.acquire()
        try:
            with patch.object(s,'call') as call:
                self.assertEqual(s.terminal_records('TEST-1')[0],409)
                call.assert_not_called()
        finally:
            s.ACTION_LOCK.release()

    def test_upstream_error_messages_cannot_leak_token(self):
        with patch.object(s,'call',return_value=(502,{'errorCode':'SECRET_private-test-session','message':'private-test-session'})):
            code,result=s.terminal_records('TEST-1')
        self.assertEqual(code,502)
        self.assertNotIn('private-test-session',str(result))


if __name__=='__main__':unittest.main()
