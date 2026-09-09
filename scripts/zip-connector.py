"""Portable ZIP with executable modes; skip only npm's unused bin symlinks."""
import pathlib
import sys
import zipfile
source = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(source.rglob('*')):
        if '.bin' in file.relative_to(source).parts:
            continue
        if file.is_symlink():
            raise RuntimeError(f'Unexpected symlink: {file.relative_to(source)}')
        if file.is_file():
            archive.write(file, pathlib.Path(source.name) / file.relative_to(source))
