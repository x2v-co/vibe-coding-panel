#!/usr/bin/env python3
"""Fetch only the fixed repository's latest CI release; preserve local rollback state."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

ROOT = Path('/opt/vibe-coding-panel')
API = 'https://api.github.com/repos/x2v-co/vibe-coding-panel/releases/latest'

def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'vibe-panel-updater'})
    return urllib.request.urlopen(request, timeout=120)

with get(API) as response:
    release = json.load(response)
tag = release['tag_name']
if not tag.startswith('relay-') or len(tag) != 46 or any(c not in '0123456789abcdef' for c in tag[6:]):
    raise SystemExit('No valid relay release')
state = ROOT / 'deploy/last-release'
if state.exists() and state.read_text().strip() == tag:
    raise SystemExit(0)
assets = {a['name']: a['browser_download_url'] for a in release['assets']}
with tempfile.TemporaryDirectory(prefix='vibe-release-') as directory:
    archive = Path(directory) / 'relay-image.tar.gz'
    with get(assets['SHA256SUMS']) as response:
        expected = response.read().decode().split()[0]
    digest = hashlib.sha256()
    with get(assets[archive.name]) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != expected:
        raise SystemExit('Release checksum mismatch')
    subprocess.run(['docker', 'load', '-i', str(archive)], check=True)
    subprocess.run(['bash', str(ROOT / 'deploy/apply-release.sh'), 'vibe-panel:' + tag[6:]], check=True)
    state.write_text(tag + '\n')
