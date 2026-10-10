"""Remaining businesses through the same persistent Harness operations."""
from pathlib import Path
import subprocess
import sqlite3
from contextlib import closing
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import Store, db
from study_agent.assessment import AssessmentService
from study_agent.models import Clock


class ServicesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(self.root)
        self.sequence = 0

    def tearDown(self):
        self.store.conn.close()
        self.temp.cleanup()

    def call(self, action, args, identifier=None):
        self.sequence += 1
        return self.store.execute({'action': action, 'args': args, 'id': identifier or 'service-' + str(self.sequence)})

    def start(self, flow, course=None):
        return self.call('start', {'flow': flow, 'course': course, 'session': 'services'})

    def advance(self, run, inputs, identifier=None):
        return self.call('advance', {'run': run['id'], 'step': run['next']['id'], 'input': inputs}, identifier)

    def course(self, code='DEMO'):
        run = self.start('course', code)
        return run, self.call('read', {'course': code})

    def review(self, state, **extra):
        return dict(course=state['course_state']['course'], summary='Compared facts and materials; unknown teaching remains unknown',
                    ledger_hash=state['course_state']['ledger_hash'], course_hash=state['course_state']['course_hash'], **extra)

    def initial_issue(self, course='DEMO'):
        run = self.start('feedback', course)
        run = self.advance(run, {'answers': 'Original answer', 'summary': 'Actual misconception',
            'issues': [{'concept': 'Implication', 'issue_type': 'wrong'}]})
        return run['history'][0]['result']['issues'][0]

    def test_workspace_daily_plan_restarts_and_publishes_same_ledger_views(self):
        _, _ = self.course()
        task = self.store.tasks.create_task('Practice or read as chosen', course='DEMO', status='open')
        run = self.start('daily')
        self.assertIsNone(run['course'])
        run = self.advance(run, {})
        self.store.conn.close()
        self.store = Store(self.root)
        run = self.call('read', {'run': run['id']})
        self.assertEqual(run['next']['id'], 'reconcile')
        state = self.call('read', {'course': 'DEMO'})
        run = self.advance(run, {'reviews': [self.review(state)]})
        inputs = {'pool': [{'task': task.task_key, 'priority': 'should', 'reason': 'User chooses flexible practice'}],
                  'selected': [task.task_key], 'reason': 'Fits user current needs; no reading prerequisite'}
        args = {'run': run['id'], 'step': 'selection', 'input': inputs}
        completed = self.call('advance', args, 'same-daily-operation')
        self.assertEqual(completed['status'], 'completed')
        before = self.store.learning.list_today(Clock().today().isoformat())
        self.assertEqual(completed, self.call('advance', args, 'same-daily-operation'))
        self.assertEqual(before, self.store.learning.list_today(Clock().today().isoformat()))
        self.assertEqual(self.store.tasks.get_task(task.task_key).status, 'open')
        self.assertEqual(self.store.tasks.dependencies_for(task.id), [])
        for name in ('TODAY_WORKING.md', 'WEEK.md', 'BACKLOG.md'):
            self.assertTrue((self.root / name).is_file())
        self.assertIn(task.title, (self.root / 'TODAY_WORKING.md').read_text())
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM courses').fetchone()[0], 1)
        with closing(sqlite3.connect(self.root / '.study-system/backups/latest.sqlite3')) as backup:
            self.assertEqual(backup.execute('SELECT status FROM flow_runs WHERE id=?', (run['id'],)).fetchone()[0], 'completed')

    def test_daily_stale_course_rejects_and_rolls_back_pool_changes(self):
        _, _ = self.course()
        task = self.store.tasks.create_task('Practice', course='DEMO', status='open')
        run = self.advance(self.start('daily'), {})
        run = self.advance(run, {'reviews': []})
        with self.assertRaises(Exception):
            self.advance(run, {'pool': [{'task': task.task_key, 'priority': 'should', 'reason': 'Current task'}],
                               'selected': [task.task_key], 'reason': 'Select work'})
        self.assertEqual(self.store.learning.list_pool(Clock().today().strftime('%Y-%m-%d')), [])
        self.assertEqual(self.call('read', {'run': run['id']})['next']['id'], 'selection')

    def test_course_rewrite_checks_versions_and_preserves_previous_document(self):
        run, state = self.course()
        old = state['course_context']
        content = old + '\nActual scope unknown; student chooses reading and practice order.\n'
        run = self.advance(run, {'reviews': [self.review(state, content=content)]})
        self.assertEqual(run['status'], 'completed')
        current = self.call('read', {'course': 'DEMO'})
        self.assertFalse(current['course_state']['needs_review'])
        self.assertEqual(current['course_context'], content)
        previous = self.store.conn.execute('SELECT * FROM course_context_snapshots').fetchone()
        self.assertEqual((self.root / previous['snapshot_path']).read_text(), old)
        with self.assertRaisesRegex(ValueError, '已改变'):
            self.advance(self.start('course', 'DEMO'), {'reviews': [self.review(state)]})

    def test_retest_requires_answers_preserves_history_and_reopens_new_failure(self):
        issue = self.initial_issue()
        run = self.start('retest', 'DEMO')
        with self.assertRaisesRegex(ValueError, '原始复测'):
            self.advance(run, {'summary': 'Student saw explanation', 'results': [{'issue': issue, 'result': 'passed'}]})
        for expected, result in [('pending', 'uncertain'), ('passed', 'passed'), ('pending', 'failed')]:
            run = self.advance(run, {'answers': 'Independent answer for ' + result, 'summary': 'Actual check',
                                    'results': [{'issue': issue, 'result': result}]})
            self.assertFalse(run['history'][0]['result']['tasks_completed'])
            self.assertEqual(self.store.conn.execute('SELECT status FROM learning_issues WHERE id=?', (issue,)).fetchone()[0], expected)
            run = self.start('retest', 'DEMO')
        state = self.call('read', {'course': 'DEMO'})
        self.assertEqual(len(state['assessments']), 4)
        self.assertEqual(len(state['retest_results']), 4)
        for attempt in state['assessments']:
            self.assertTrue(Path(attempt['evidence_ref']).is_file())
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0], 0)

    def test_retest_rejects_other_course_and_domain_api_rejects_missing_evidence(self):
        issue = self.initial_issue('OTHER')
        with self.assertRaisesRegex(ValueError, '本课'):
            self.advance(self.start('retest', 'DEMO'), {'answers': 'Answer', 'summary': 'Check',
                'results': [{'issue': issue, 'result': 'passed'}]})
        service = AssessmentService(self.store.conn)
        with self.assertRaises(Exception):
            service.record_assessment({'course': 'DEMO', 'source_kind': 'other', 'summary': 'No evidence',
                'issues': [{'concept': 'Guessed error', 'issue_type': 'wrong'}]})
        with self.assertRaises(Exception):
            service.record_issue_result({'issue_id': issue, 'result': 'passed'})
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM assessment_attempts').fetchone()[0], 1)

    def test_retest_cannot_reuse_other_course_attempt_or_overwrite_an_old_result(self):
        issue = self.initial_issue()
        other = self.initial_issue('OTHER')
        other_run = self.advance(self.start('retest', 'OTHER'), {'answers': 'Other answer', 'summary': 'Check',
            'results': [{'issue': other, 'result': 'passed'}]})
        attempt = other_run['history'][0]['result']['attempt']
        service = AssessmentService(self.store.conn)
        with self.assertRaises(Exception):
            service.record_issue_result({'issue_id': issue, 'result': 'passed', 'attempt_id': attempt})
        with self.assertRaises(Exception):
            service.record_issue_result({'issue_id': other, 'result': 'failed', 'attempt_id': attempt})
        self.assertEqual(self.store.conn.execute('SELECT status FROM learning_issues WHERE id=?', (other,)).fetchone()[0], 'passed')

    def test_memory_global_versions_backup_and_same_operation_retry(self):
        memory = self.call('read', {})['memory']
        first = self.advance(self.start('memory'), {'content': 'User chooses reading and practice order.',
                            'expected': memory['content_hash'], 'summary': 'Save standing preference'})
        current = self.call('read', {})['memory']
        self.assertEqual(current['content'], 'User chooses reading and practice order.')
        run = self.start('memory')
        with self.assertRaisesRegex(ValueError, '已改变'):
            self.advance(run, {'content': 'Changed', 'expected': memory['content_hash'], 'summary': 'Old input'})
        run = self.advance(run, {'content': current['content'] + '\nKeep original evidence.', 'expected': current['content_hash'],
                                 'summary': 'Add user agreement'})
        result = run['history'][0]['result']
        self.assertEqual(Path(result['last_review']['value']['backup']).read_text(), current['content'])
        self.store.conn.close()
        self.store = Store(self.root)
        self.assertIn('Keep original evidence', self.call('read', {})['memory']['content'])
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM courses').fetchone()[0], 0)

    def test_interrupted_file_write_restores_original_on_restart(self):
        memory = self.call('read', {})['memory']
        self.advance(self.start('memory'), {'content': 'Original agreement', 'expected': memory['content_hash'], 'summary': 'Original'})
        worker_dir = str(Path(__file__).resolve().parents[1])
        script = '''import os,sys
sys.path.insert(0,sys.argv[2])
from worker import Store,db
s=Store(sys.argv[1]); path=s.root/'.study-system/AGENT_MEMORY.md'
with db.atomic(s.conn):
 s.stage_text(path,'Uncommitted change','interrupted')
 db.write_text_atomic(path,'Uncommitted change')
 s.learning.checkpoint('memory.last_update', {'uncommitted':True})
 os._exit(9)
'''
        process = subprocess.run([sys.executable, '-c', script, str(self.root), worker_dir], timeout=5)
        self.assertEqual(process.returncode, 9)
        self.assertEqual((self.root / '.study-system/AGENT_MEMORY.md').read_text(), 'Uncommitted change')
        self.store.conn.close()
        self.store = Store(self.root)
        self.assertEqual(self.call('read', {})['memory']['content'], 'Original agreement')
        self.assertFalse(list((self.root / '.study-system/runtime/changes').glob('*.json')))

    def test_failed_memory_operation_restores_file_and_progress(self):
        old = self.call('read', {})['memory']
        run = self.start('memory')
        real = type(self.store.learning).rewrite_memory
        def failed(*args, **kwargs):
            real(*args, **kwargs)
            raise ValueError('Interrupted after file write')
        with patch.object(type(self.store.learning), 'rewrite_memory', autospec=True, side_effect=failed):
            with self.assertRaisesRegex(ValueError, 'Interrupted'):
                self.advance(run, {'content': 'Should roll back', 'expected': old['content_hash'], 'summary': 'Check'})
        self.assertEqual(self.call('read', {})['memory']['content'], '')
        self.assertEqual(self.call('read', {'run': run['id']})['history'], [])

    def test_view_publication_failure_recovers_without_losing_committed_plan(self):
        run = self.advance(self.start('daily'), {})
        run = self.advance(run, {'reviews': []})
        with patch('worker.write_learning_view', side_effect=ValueError('Temporary output failure')):
            run = self.advance(run, {'selected': [], 'reason': 'User wants no work today'})
        self.assertEqual(run['status'], 'completed')
        self.assertTrue(run['recovery_warnings'])
        self.store.conn.close()
        self.store = Store(self.root)
        self.assertEqual(self.store.cleanup(), [])
        self.assertTrue((self.root / 'TODAY_WORKING.md').exists())

    def test_recovering_partial_views_preserves_student_checkbox_feedback_in_backup(self):
        self.course()
        task = self.store.tasks.create_task('User practice', course='DEMO', status='open')
        run = self.advance(self.start('daily'), {})
        state = self.call('read', {'course': 'DEMO'})
        run = self.advance(run, {'reviews': [self.review(state)]})
        from worker import write_learning_view
        def interrupted(conn, kind, *args):
            if kind == 'week':
                raise ValueError('Interrupted view publication')
            return write_learning_view(conn, kind, *args)
        with patch('worker.write_learning_view', side_effect=interrupted):
            self.advance(run, {'pool': [{'task': task.task_key, 'priority': 'should', 'reason': 'User needs practice'}],
                               'selected': [task.task_key], 'reason': 'User selected work'})
        view = self.root / 'TODAY_WORKING.md'
        view.write_text(view.read_text().replace('- [ ]', '- [x]', 1))
        self.store.conn.close()
        self.store = Store(self.root)
        self.assertEqual(self.store.cleanup(), [])
        self.assertEqual(self.store.tasks.get_task(task.task_key).status, 'completed')
        with closing(sqlite3.connect(self.root / '.study-system/backups/latest.sqlite3')) as backup:
            self.assertEqual(backup.execute('SELECT status FROM tasks WHERE id=?', (task.id,)).fetchone()[0], 'completed')

    def test_view_publication_uses_execution_order_instead_of_run_creation_order(self):
        older = self.advance(self.start('daily'), {})
        older = self.advance(older, {'reviews': []})
        newer = self.advance(self.start('daily'), {})
        newer = self.advance(newer, {'reviews': []})
        newer = self.advance(newer, {'selected': [], 'reason': 'First completed choice'})
        older = self.advance(older, {'selected': [], 'reason': 'User resumes older run and changes choice'})
        markers = self.root / '.study-system/runtime/plan-views'
        self.assertTrue((markers / (newer['id'] + '.json')).exists())
        self.assertTrue((markers / (older['id'] + '.json')).exists())

    def test_editable_multistep_plan_republishes_after_each_committed_choice(self):
        candidate = self.call('change', {'flow': 'daily', 'action': 'preview', 'reason': 'User wants week and day choices separately',
            'definition': {'title': 'Separate model operations', 'scope': 'workspace', 'steps': [
                {'id': 'week', 'kind': 'daily', 'instructions': 'Save weekly choice'},
                {'id': 'today', 'kind': 'daily', 'after': ['week'], 'instructions': 'Save daily choice'}]}})
        self.call('change', {'flow': 'daily', 'action': 'apply', 'expected': candidate['current'], 'version': candidate['version']})
        run = self.advance(self.start('daily'), {'reason': 'Weekly choice', 'selected': []})
        marker = self.root / '.study-system/runtime/plan-views' / (run['id'] + '.json')
        first = json.loads(marker.read_text())['operation']
        run = self.advance(run, {'reason': 'Daily choice', 'selected': []})
        self.assertNotEqual(json.loads(marker.read_text())['operation'], first)
        self.assertEqual(json.loads(marker.read_text())['operation'], run['history'][-1]['operation'])

    def test_invalid_workspace_edit_keeps_previous_executable_flow(self):
        previous = self.call('read', {})['flows']['daily']['id']
        with self.assertRaisesRegex(ValueError, '课程范围'):
            self.call('change', {'flow': 'daily', 'action': 'preview', 'reason': 'Candidate should fail validation',
                'definition': {'title': 'Invalid scope', 'scope': 'workspace', 'steps': [
                    {'id': 'feedback', 'kind': 'feedback', 'instructions': 'Requires a real course'}]}})
        self.assertEqual(self.start('daily')['version'], previous)

    def test_existing_course_only_runs_migrate_without_losing_history(self):
        run = self.start('feedback', 'DEMO')
        run = self.advance(run, {'answers': 'Original', 'summary': 'Review'})
        with db.atomic(self.store.conn):
            self.store.conn.execute("CREATE TABLE old_runs(id TEXT PRIMARY KEY,course TEXT NOT NULL REFERENCES courses(id),session TEXT NOT NULL,version TEXT NOT NULL REFERENCES flow_versions(id),history TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'open')")
            self.store.conn.execute('INSERT INTO old_runs SELECT * FROM flow_runs')
            self.store.conn.execute('DROP TABLE flow_runs')
            self.store.conn.execute('ALTER TABLE old_runs RENAME TO flow_runs')
        self.store.conn.close()
        self.store = Store(self.root)
        restored = self.call('read', {'run': run['id']})
        self.assertEqual(restored['history'], run['history'])
        self.assertEqual(restored['next']['id'], 'plan')
        self.assertIsNone(self.start('daily')['course'])

    def test_unified_service_entry_reads_the_same_ledger(self):
        self.course()
        project = Path(__file__).resolve().parents[3]
        result = subprocess.run([sys.executable, str(project / 'study-agent'), 'service', '--data', str(self.root),
                                 '--json', 'course', 'list'], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('DEMO', result.stdout)


if __name__ == '__main__':
    unittest.main()
