import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flow_handler import compile_handler, run_handler


class DataHandlerTests(unittest.TestCase):
    def test_existing_arithmetic_and_conditional_json_handlers(self):
        source = '''def run(inputs, context):
    count = min(inputs.get("requested", 0), inputs["available"])
    if count < 0:
        return {"questions": 0}
    return {"questions": count, "course": context.get("course")}
'''
        self.assertEqual(run_handler(source, {'requested': 6, 'available': 3}, {'course': 'DEMO'}),
                         {'questions': 3, 'course': 'DEMO'})
        self.assertEqual(run_handler(source, {'requested': -1, 'available': 3}, {}), {'questions': 0})

    def test_handler_cannot_mutate_original_input_or_context(self):
        inputs, context = {'value': [1, 2]}, {'course': 'DEMO'}
        result = run_handler('def run(input, context):\n input["value"][0] = 99\n context["course"] = "OTHER"\n return input', inputs, context)
        self.assertEqual(result, {'value': [99, 2]})
        self.assertEqual(inputs, {'value': [1, 2]})
        self.assertEqual(context, {'course': 'DEMO'})

    def test_host_access_and_python_introspection_are_rejected_before_execution(self):
        sources = [
            'from pathlib import Path\ndef run(input, context):\n return {}',
            'def run(input, context):\n return {"data": open("outside.txt", "w")}',
            'def run(input, context):\n return {"data": __import__("os").getcwd()}',
            'def run(input, context):\n return {"data": input.__class__}',
            'def run(input, context):\n return {"data": getattr(input, "__class__")}',
            'def run(input, context):\n return {"data": eval("1+1")}',
            'def run(input, context):\n return {"data": globals()}',
            'def run(input, context):\n return {"data": str.format("{0.__class__}", input)}',
            'def run(input, context):\n helper = input.get\n return {"data": helper("x")}',
            'def run(input, context):\n helper = len\n return {"data": helper(input)}',
            'def run(input, context):\n return {"data": (lambda: 1)()}',
            'def run(input, context):\n while True:\n  pass\n return {}',
            '@open("outside.txt", "w")\ndef run(input, context):\n return {}',
            'def run(input=open("outside.txt", "w"), context=None):\n return {}',
            'def run(input, context):\n return run(input, context)',
        ]
        for source in sources:
            with self.subTest(source=source), self.assertRaises(ValueError):
                compile_handler(source)
            with self.subTest(persisted=source), self.assertRaises(ValueError):
                run_handler(source, {}, {})

    def test_only_json_dictionary_get_is_exposed(self):
        with self.assertRaises(ValueError):
            run_handler('def run(input, context):\n return {"data": "text".get("x")}', {}, {})


if __name__ == '__main__':
    unittest.main()
