"""Build release notes from this checkout and the prior published revision."""
import argparse
import re
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--revision', required=True)
parser.add_argument('--previous', default='')
parser.add_argument('--output', required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    parser.error('revision must be an exact Git SHA')
if args.previous and not re.fullmatch(r'relay-[a-f0-9]{40}', args.previous):
    parser.error('previous must be a versioned Relay release tag')
root = Path(__file__).resolve().parent.parent
repo = 'https://github.com/x2v-co/vibe-coding-panel'
revision_range = f'{args.previous[6:]}..{args.revision}' if args.previous else args.revision
command = ['git', 'log', '--format=%H%x09%s']
if not args.previous:
    command.append('--max-count=20')
command.append(revision_range)
commits = subprocess.check_output(command, cwd=root, text=True).splitlines()
changes = []
for line in commits:
    revision, subject = line.split('\t', 1)
    subject = re.sub(r'([\\`*_[\]<>])', r'\\\1', subject)
    changes.append(f'- [{revision[:8]}]({repo}/commit/{revision}) {subject}')
if not changes:
    raise SystemExit('No commits found for this release range')
notes = f'''# Vibe Panel 0.1.0 · {args.revision[:8]}

Source: [{args.revision}]({repo}/commit/{args.revision}). This is an internal beta.

## Changes in this release

{chr(10).join(changes)}

[Full changelog]({repo}/blob/{args.revision}/CHANGELOG.md)

## Downloads and validation

Choose the ZIP for macOS Apple Silicon, macOS Intel, Windows x64 or Linux x64.
Extract it fully and start Vibe Panel. Node 24 and locked app dependencies are
included; an authenticated Codex/Claude CLI remains required. Optional Setup Voice
installs managed Python, CPU Whisper, ffmpeg and the small model.

The release requires all four CI runners to pass server/startup tests, build,
extracted-package pairing/task acceptance without global Node/npm, and actual
isolated speech installation/transcription. CI uses fixture agents for cross-OS
task execution; this does not certify real CLI compatibility or physical phones.
The release job also verifies the public production revision after deployment.

Verify each downloaded file against SHA256SUMS. Relay production applies the
versioned image with health checks and rollback. For Connector rollback, stop it
and extract the selected older release into a different directory; pairing state
is stored outside the package.

## Known limitations

{(root / 'docs/known-issues.md').read_text().split('## Current limitations', 1)[1].split('## Updates and feedback', 1)[0].strip()}

## More information

- [Package instructions]({repo}/blob/{args.revision}/docs/portable-connector.md)
- [Native handoff and recovery]({repo}/blob/{args.revision}/docs/native-session-handoff.md)
- [Privacy](https://vibe.tooluse.app/privacy/) · [Terms](https://vibe.tooluse.app/terms/)
- [Feedback]({repo}/issues): include revision, platform and reproduction steps;
  remove secrets, pairing links and private content from public reports.
'''
# Resolve documentation-relative links for the GitHub Release page.
for name in ['native-session-handoff.md', 'portable-connector.md']:
    notes = notes.replace(f']({name})', f']({repo}/blob/{args.revision}/docs/{name})')
Path(args.output).write_text(notes)
