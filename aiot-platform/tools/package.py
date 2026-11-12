"""Create self-contained source/runtime package; Python and pyserial installed separately."""
import hashlib
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[2]
out=root/'deliverables/aiot-device-test-v0.1.zip';out.parent.mkdir(exist_ok=True)
files=[]
for p in (root/'aiot-platform').rglob('*'):
    if p.is_file() and not any(x in ('runtime','__pycache__') for x in p.relative_to(root/'aiot-platform').parts) and p.suffix not in ('.pyc','.db'):files.append(p)
for name in ['serial-agent/wheel_protocol.py','serial-agent/wheel_agent.py','serial-agent/requirements.txt','examples/full-telemetry26.rwt','examples/full-telemetry26-NOTE.txt','examples/legacy-gyro.uart']:
    files.append(root/'reaction-wheel-compression-v1.1'/name)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files):z.write(p,p.relative_to(root))
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert not any('/runtime/' in n or 'admin-token' in n or 'device-binding' in n for n in z.namelist())
checksum=hashlib.sha256(out.read_bytes()).hexdigest()
(out.parent/'aiot-device-test-v0.1-SHA256SUMS.txt').write_text(checksum+'  '+out.name+'\n')
print(out.name,out.stat().st_size,'bytes',len(files),'files',checksum)
