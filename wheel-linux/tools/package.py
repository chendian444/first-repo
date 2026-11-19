"""Package Linux sources, sanitized control reference and existing compression runtime."""
from pathlib import Path
import hashlib
import subprocess
import zipfile
repo=Path(__file__).resolve().parents[2]
out=repo/'deliverables/wheel-linux-data-analysis-v1.0.zip'
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z','--',
    'wheel-linux/','aiot-platform/','reaction-wheel-compression-v1.1/'],cwd=repo).decode().split('\0')
files={repo/p for p in paths if p}
root=repo/'reaction-wheel-compression-v1.1/DataCompress_System'
files.add(root/'backend/target/data-compress-control-system-v5-5.0.0.jar')
for suffix in ('frontend/dist','bridge/node_modules'):
    files.update(p for p in (root/suffix).rglob('*') if p.is_file())
for p in files:
    if any(x in ('runtime','__pycache__','.venv') for x in p.relative_to(repo).parts):raise ValueError('unexpected runtime path')
    if p.name=='.env':raise ValueError('unexpected credentials file')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(files):z.write(p,p.relative_to(repo))
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert len(z.namelist())==len(set(z.namelist()))
    assert z.read('reaction-wheel-compression-v1.1/DataCompress_System/backend/target/data-compress-control-system-v5-5.0.0.jar')==(root/'backend/target/data-compress-control-system-v5-5.0.0.jar').read_bytes()
digest=hashlib.sha256(out.read_bytes()).hexdigest()
(out.parent/'wheel-linux-data-analysis-v1.0-SHA256SUMS.txt').write_text(digest+'  '+out.name+'\n')
print(out.name,len(files),'files',out.stat().st_size,'bytes',digest)
