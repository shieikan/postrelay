import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('server_config',
    Path(__file__).resolve().parents[1] / 'scripts' / 'configure-server.py')
config = importlib.util.module_from_spec(spec);spec.loader.exec_module(config)


class ServerConfigTests(unittest.TestCase):
    def test_configuration_is_private_and_existing_key_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = config.configure(directory, 18765)
            original = path.read_bytes()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn(b'POSTRELAY_PUBLIC_URL=http://localhost:18765', original)
            with self.assertRaises(FileExistsError): config.configure(directory)
            self.assertEqual(path.read_bytes(), original)

    def test_invalid_origins_do_not_create_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            for origin in ['https://user:secret@example.test', 'https://example.test/path',
                           'https://example.test?secret=value', 'https://example.test/\nPRIVATE',
                           'https://example.test/${SECRET}', 'https://[invalid']:
                with self.subTest(origin=origin), self.assertRaises(ValueError):
                    config.configure(directory, origin=origin)
                self.assertFalse((Path(directory) / '.env').exists())

    def test_origins_require_a_host_valid_port_and_https_for_remote_access(self):
        with tempfile.TemporaryDirectory() as directory:
            for origin in ['http://:8765', 'https://example.test:99999', 'https://example.test:abc',
                           'http://example.test', 'https://:password@example.test']:
                with self.subTest(origin=origin), self.assertRaises(ValueError):
                    config.configure(directory, origin=origin)
                self.assertFalse((Path(directory) / '.env').exists())
