"""Exercise the actual switch script's success and failed-public-check rollback paths."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('apply-release.sh').resolve()
OLD = 'sha256:' + 'a' * 64

class ReleaseTest(unittest.TestCase):
    def apply(self, public_version):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'deploy').mkdir()
            (root / 'bin').mkdir()
            docker = root / 'bin/docker'
            docker.write_text('''#!/usr/bin/env python3
import os,sys
from pathlib import Path
args = sys.argv[1:]
old = 'sha256:' + 'a' * 64
if args[0] == 'inspect':
    print(old if '.Image' in args[-1] else '127.0.0.1')
elif args[:2] == ['image', 'inspect']:
    print('v1')
elif args[0] == 'compose':
    with open('switches', 'a') as f: f.write(os.environ['PANEL_RELAY_IMAGE'] + '\\n')
elif 'node' in args:
    print('v1')
''')
            docker.chmod(0o755)
            curl = root / 'bin/curl'
            curl.write_text('#!/bin/sh\nprintf \'%s\\n\' \'' + json.dumps({'ok': True, 'version': public_version}) + "'\n")
            curl.chmod(0o755)
            result = subprocess.run(['bash', str(SCRIPT), 'vibe-panel:v1'], env={**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'PANEL_DEPLOY_ROOT': str(root)}, capture_output=True, text=True)
            switches = (root / 'switches').read_text().splitlines()
            if public_version == 'v1':
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(switches, ['vibe-panel:v1'])
                self.assertEqual((root / 'deploy/previous-image').read_text().strip(), OLD)
                self.assertEqual((root / 'deploy/current-image').read_text().strip(), 'vibe-panel:v1')
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(switches, ['vibe-panel:v1', OLD])
                self.assertFalse((root / 'deploy/current-image').exists())
                self.assertIn('restoring', result.stdout)
    def test_success_records_previous_digest(self):
        self.apply('v1')
    def test_failed_public_health_restores_previous_digest(self):
        self.apply('wrong-version')

if __name__ == '__main__':
    unittest.main()
