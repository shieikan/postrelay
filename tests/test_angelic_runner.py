import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('angelic_runner',
    Path(__file__).resolve().parents[1] / 'integrations' / 'angelic' / 'runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class AngelicRunnerTests(unittest.TestCase):
    def test_copied_dashboard_url_is_converted_to_fixed_private_ingress(self):
        token = 'synthetic_token_' + 'x' * 30
        url = runner.receiver_url('https://app.example.test/api/hooks/' + token)
        self.assertEqual(url, 'http://127.0.0.1:8767/api/push/' + token)
        self.assertEqual(runner.receiver_url(token), url)

    def test_bad_input_is_rejected_without_echoing_credentials(self):
        for value in ['short-secret', 'https://evil.test/messages/private-secret',
                      'https://user:private-secret@app.example.test/api/hooks/'+'x'*43,
                      'https://app.example.test/api/hooks/'+'x'*43+'?secret=private-secret']:
            with self.subTest(value=value), self.assertRaises(ValueError) as caught:
                runner.receiver_url(value)
            self.assertNotIn('private-secret', str(caught.exception))
            self.assertNotIn('short-secret', str(caught.exception))

    def test_source_secret_is_private_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            private = Path(folder) / 'private';private.mkdir(mode=0o700)
            token = 'synthetic_token_' + 'x' * 30
            runner.save_receiver(private, token)
            path = private / 'postrelay-token'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(runner.load_receiver(private).endswith('/api/push/' + token))
            path.chmod(0o644)
            with self.assertRaises(ValueError): runner.load_receiver(private)
            path.unlink();path.symlink_to(Path(folder) / 'outside')
            with self.assertRaises(ValueError): runner.save_receiver(private, token)
            with self.assertRaises(ValueError): runner.load_receiver(private)

    def test_shared_source_directory_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            private=Path(folder)/'private';private.mkdir(mode=0o755)
            with self.assertRaises(ValueError): runner.save_receiver(private, 'x'*43)
