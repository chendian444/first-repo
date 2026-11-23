"""Build a two-file AT32 firmware patch matching wheel-linux-data-analysis-v1.0.zip."""
from pathlib import Path
import hashlib
import json
import zipfile
ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parent
out=REPO/'deliverables/AT32-raw26-wheel-linux-v1.0-patch.zip'
manifest={}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for name in ('WheelTelemetry.c','WheelTelemetry.h'):
        p=ROOT/'firmware-raw26-pack/UserFile'/name
        target='reaction-wheel-compression-v1.1/firmware/UserFile/'+name
        z.write(p,target)
        z.write(p,'reaction-wheel-compression-v1.1/firmware-raw26-pack/UserFile/'+name)
        manifest[target]={'baseSHA256':hashlib.sha256((ROOT/'firmware/UserFile'/name).read_bytes()).hexdigest(),
            'replacementSHA256':hashlib.sha256(p.read_bytes()).hexdigest()}
    doc=ROOT/'firmware-raw26-pack/替换说明.md'
    z.write(doc,'AT32-26通道替换说明.md')
    z.write(doc,'reaction-wheel-compression-v1.1/firmware-raw26-pack/替换说明.md')
    z.write(ROOT/'tools/prepare_pack_raw26.py','reaction-wheel-compression-v1.1/tools/prepare_pack_raw26.py')
    for name in ('pack-raw26-tests.log','pack-raw26-syntax.log'):
        z.write(ROOT/'tests/validation'/name,'reaction-wheel-compression-v1.1/tests/validation/'+name)
    z.writestr('AT32-26通道SHA256.json',json.dumps(manifest,indent=2))
with zipfile.ZipFile(out) as z:assert z.testzip() is None
out.with_suffix('.sha256').write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+out.name+'\n')
print(out.name,out.stat().st_size,'bytes; only two original firmware files are replaced')
