import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import Store, delivery


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(self.root)
        self.counter = 0

    def tearDown(self):
        self.store.conn.close()
        self.temp.cleanup()

    def call(self, action, args, identifier=None):
        self.counter += 1
        return self.store.execute({'action': action, 'args': args, 'id': identifier or str(self.counter)})

    def start(self, course='DEMO', flow='feedback', session='session-a'):
        return self.call('start', dict(course=course, flow=flow, session=session))

    def advance(self, run, inputs):
        return self.call('advance', dict(run=run['id'], step=run['next']['id'], input=inputs))

    def changed(self, definition, course=None):
        args = dict(flow='material', definition=definition, reason='User wants independent practice first')
        if course:
            args['course'] = course
        candidate = self.call('change', dict(args, action='preview'))
        return self.call('change', dict(flow='material', action='apply', course=course,
                                       version=candidate['version'], expected=candidate['current']))

    def test_restart_keeps_next_step_evidence_and_session_scope(self):
        run = self.start()
        run = self.advance(run, dict(answers='My original answer', summary='Needs a counterexample'))
        self.store.conn.close()
        self.store = Store(self.root)
        restored = self.call('read', {'run': run['id']})
        self.assertEqual(restored['next']['id'], 'plan')
        evidence = json.loads(Path(restored['history'][0]['result']['evidence']).read_text())
        self.assertEqual(evidence['answers'], 'My original answer')
        self.assertEqual(len(self.call('read', {'session': 'session-a'})['pending']), 1)
        self.assertEqual(self.call('read', {'session': 'session-b'})['pending'], [])

    def test_repeated_operation_does_not_duplicate_attempt(self):
        run = self.start()
        args = dict(run=run['id'], step='feedback', input=dict(answers='Answer', summary='Review'))
        first = self.call('advance', args, 'retry')
        self.assertEqual(first, self.call('advance', args, 'retry'))
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM assessment_attempts').fetchone()[0], 1)
        with self.assertRaisesRegex(ValueError, '同一操作'):
            self.call('advance', dict(args, input=dict(answers='Different')), 'retry')

    def test_invalid_feedback_and_out_of_order_steps_leave_run_unchanged(self):
        run = self.start()
        with self.assertRaisesRegex(ValueError, '原始作答'):
            self.advance(run, {'summary': 'Guessed from conversation'})
        with self.assertRaisesRegex(ValueError, '必要依据'):
            self.call('advance', dict(run=run['id'], step='review', input={}))
        self.assertEqual(self.call('read', {'run': run['id']})['history'], [])

    def test_course_specific_change_effective_after_restart_and_global_unchanged(self):
        old = self.start(flow='material')
        self.start(course='OTHER', flow='material')
        definition = copy.deepcopy(self.store.version(old['version'])['definition'])
        definition['steps'][1]['instructions'] = '用户自主安排阅读与练习；无需新的笔记任务'
        applied = self.changed(definition, 'DEMO')
        self.store.conn.close()
        self.store = Store(self.root)
        new = self.start(flow='material')
        other = self.start(course='OTHER', flow='material')
        self.assertEqual(new['version'], applied['version'])
        self.assertEqual(other['version'], old['version'])
        self.assertEqual(self.call('read', {'run': old['id']})['version'], old['version'])
        switched = self.call('switch', dict(run=old['id'], reason='User changes this run'))
        self.assertEqual(switched['version'], new['version'])
        rollback = self.call('change', dict(flow='material', course='DEMO', action='rollback', expected=new['version']))
        self.assertEqual(rollback['version'], old['version'])

    def test_failed_handler_validation_keeps_old_active_flow(self):
        old = self.start(flow='material')
        definition = {'title': 'New behavior', 'steps': [{'id': 'new', 'kind': 'custom', 'instructions': 'Calculate',
            'handler': 'def run(inputs, context):\n return {"total": inputs["x"] + 1}',
            'tests': [{'input': {'x': 2}, 'expected': {'total': 99}}]}]}
        with self.assertRaisesRegex(ValueError, '未通过'):
            self.changed(definition)
        self.assertEqual(self.start(flow='material')['version'], old['version'])

    def test_generated_execution_code_changes_real_result(self):
        self.start(flow='material')
        definition = {'title': 'Adapted practice', 'steps': [{'id': 'load', 'kind': 'custom', 'instructions': 'Adjust practice load',
            'handler': 'def run(inputs, context):\n return {"questions": min(inputs["requested"], inputs["available"])}',
            'tests': [{'input': {'requested': 6, 'available': 3}, 'expected': {'questions': 3}}]}]}
        self.changed(definition)
        run = self.advance(self.start(flow='material'), dict(requested=8, available=2))
        self.assertEqual(run['history'][0]['result'], {'questions': 2})
        self.assertEqual(run['status'], 'completed')

    def test_unsafe_preview_cannot_write_outside_semester_or_change_active_flow(self):
        old = self.start(flow='material')
        marker = self.root.parent / (self.root.name + '-outside.txt')
        definition = {'title': 'Unsafe candidate', 'steps': [{'id': 'probe', 'kind': 'custom',
            'instructions': 'Audit', 'handler': f'from pathlib import Path\ndef run(input, context):\n Path({str(marker)!r}).write_text("changed")\n return input',
            'tests': [{'input': {}, 'expected': {}}]}]}
        with self.assertRaises(ValueError):
            self.changed(definition)
        self.assertFalse(marker.exists())
        self.assertEqual(self.start(flow='material')['version'], old['version'])

    def test_concurrent_modification_rejected(self):
        old = self.start(flow='material')
        definition = copy.deepcopy(self.store.version(old['version'])['definition'])
        definition['title'] = 'New flow'
        self.changed(definition)
        with self.assertRaisesRegex(ValueError, '其他修改'):
            self.call('change', dict(flow='material', action='rollback', expected=old['version']))

    def test_switch_does_not_reuse_changed_completed_step(self):
        self.start(flow='material')
        definition = {'title': 'One step', 'steps': [{'id': 'one', 'kind': 'task', 'task': 'Practice', 'instructions': 'Practice'},
             {'id': 'two', 'kind': 'task', 'task': 'Review', 'instructions': 'Review'}]}
        self.changed(definition)
        run = self.start(flow='material')
        run = self.call('advance', dict(run=run['id'], step='one', input={'description': 'Answer the actual questions'}))
        definition['steps'][0]['instructions'] = 'Different evidence required'
        self.changed(definition)
        with self.assertRaisesRegex(ValueError, '已完成步骤'):
            self.call('switch', dict(run=run['id'], reason='Change'))
        self.assertEqual(self.call('read', {'run': run['id']})['version'], run['version'])
        with self.assertRaises(Exception):
            self.store.tasks.complete(run['history'][0]['result']['task'])

    def test_classification_uses_content_and_rejects_stale_versions(self):
        self.start(flow='material')
        folder = self.root / 'DEMO'
        path = folder / 'transcript.mp3'
        path.write_text('An assignment, despite the name')
        second = folder / 'same-date-recording.txt'
        second.write_text('A separate item')
        materials = self.call('read', {'course': 'DEMO'})['materials']
        self.assertTrue(all(item['artifact_kind'] == 'other' for item in materials))
        self.assertEqual(len(set(item['session_key'] for item in materials)), 2)
        event = next(item for item in materials if item['payload']['path'].endswith('transcript.mp3'))
        self.store.learning.classify_material(event['id'], 'assignment', reason='Read submission instructions')
        path.write_text('Changed contents')
        self.store.learning.scan_materials(self.root)
        with self.assertRaises(Exception):
            self.store.learning.classify_material(event['id'], 'transcript', reason='Old inspection')
        latest = next(item for item in self.store.learning.pending_events() if item['id'] != event['id'] and item['source_key'] == event['source_key'])
        self.assertEqual(latest['artifact_kind'], 'assignment')

    def test_inspect_cannot_take_other_course_material(self):
        run = self.start(flow='material')
        self.start(course='OTHER', flow='material')
        (self.root / 'OTHER' / 'assignment.txt').write_text('Submit work')
        event = self.call('read', {'course': 'OTHER'})['materials'][0]
        with self.assertRaisesRegex(ValueError, '本课'):
            self.advance(run, dict(event=event['id'], kind='assignment', summary='Read assignment'))

    def test_material_receipt_requires_notes_or_explicit_reason_and_keeps_tasks_open(self):
        run = self.start(flow='material')
        (self.root / 'DEMO' / 'lecture.txt').write_text('Lecture transcript')
        event = self.call('read', {'course': 'DEMO'})['materials'][0]
        run = self.advance(run, dict(event=event['id'], kind='transcript', summary='Read lecture text'))
        run = self.advance(run, dict(reason='User requested independent practice with existing notes',
            tasks=[dict(title='Independent practice', description='Answer independently')]))
        receipt = dict(summary='Reviewed actual scope', task_effect='One pending practice task', material_map_updated=True,
                       course_state_reviewed=True, requirements_checked=True)
        with self.assertRaises(Exception):
            self.advance(run, receipt)
        receipt['notes_not_required_reason'] = 'Existing notes cover this revision; user requested reuse'
        run = self.advance(run, receipt)
        self.assertEqual(run['status'], 'completed')
        self.assertEqual(self.store.learning.pending_events(), [])
        self.assertTrue(all(task.status == 'open' for task in self.store.tasks.list_tasks()))

    def test_delivery_requires_factual_review_and_does_not_claim_mastery(self):
        run = self.advance(self.start(), dict(answers='My answer', summary='Review'))
        run = self.advance(run, dict(plan='Two sourced questions; no duplicates; one page', issues=[]))
        artifact = self.root / 'DEMO' / 'worksheet.txt'
        artifact.write_text('Question 1\nQuestion 2')
        with self.assertRaises(Exception):
            self.advance(run, dict(artifact=str(artifact), review={}))
        review = {'checks': {key: 'Checked against actual source' for key in (
            'source_scope','layout','task_handoff','plan_alignment','deduplication','source_questions','question_load','issue_weighting')},
            'page_count': 1, 'pages': [{'page': 1, 'status': 'passed', 'summary': 'Inspected rendered page'}],
            'artifact_sha256': delivery.digest(artifact)}
        run = self.advance(run, dict(artifact=str(artifact), review=review))
        result = run['history'][-1]['result']
        self.assertTrue(result['issued_only'])
        self.assertTrue(Path(result['receipt']).is_file())
        self.assertFalse(Path(result['work']).exists())
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM assessment_attempts').fetchone()[0], 1)

    def test_independent_operations_can_run_in_either_order_without_task_dependencies(self):
        self.start(flow='material')
        self.changed({'title': 'User chooses learning order', 'steps': [
            {'id': 'reading', 'kind': 'task', 'task': 'Read notes', 'instructions': 'Record requested reading'},
            {'id': 'practice', 'kind': 'task', 'task': 'Practice', 'instructions': 'Record requested practice'}]})
        run = self.start(flow='material')
        self.assertEqual({step['id'] for step in run['available']}, {'reading', 'practice'})
        self.assertIsNone(run['next'])
        run = self.call('advance', dict(run=run['id'], step='practice', input={'description': 'Practice first if user chooses'}))
        run = self.advance(run, {'description': 'Read notes whenever needed'})
        self.assertEqual(run['status'], 'completed')
        self.assertEqual([item['step'] for item in run['history']], ['practice', 'reading'])
        self.assertTrue(all(task.status == 'open' for task in self.store.tasks.list_tasks()))

    def test_material_can_reuse_existing_work_without_creating_tasks(self):
        run = self.start(flow='material')
        (self.root / 'DEMO' / 'lecture.txt').write_text('Reviewed lecture')
        event = self.call('read', {'course': 'DEMO'})['materials'][0]
        run = self.advance(run, dict(event=event['id'], kind='transcript', summary='Read actual lecture'))
        run = self.advance(run, dict(tasks=[], reason='User wants to reuse current notes and practice'))
        self.assertEqual(self.store.tasks.list_tasks(), [])
        self.assertEqual(run['next']['id'], 'receipt')

    def test_cleanup_failure_preserves_recovery_and_other_operations(self):
        with patch('worker.finish_work', side_effect=ValueError('Artifact changed')):
            run = self.advance(self.start(), dict(answers='Answer', summary='Review'))
            run = self.advance(run, dict(plan='One real question'))
            # Simulate a committed receipt left by an interrupted cleanup.
            work = Path(run['history'][-1]['result']['work'])
            history = run['history'] + [{'step': 'review', 'kind': 'review', 'result': {'work': str(work), 'artifact': 'changed', 'receipt': 'saved'}}]
            self.store.conn.execute("UPDATE flow_runs SET history=?,status='completed' WHERE id=?", (json.dumps(history),run['id']))
            warnings = self.store.cleanup()
            self.assertTrue(warnings)
            self.assertTrue(work.exists())
            another = self.start(course='OTHER')
            self.assertTrue(another['recovery_warnings'])


if __name__ == '__main__':
    unittest.main()
