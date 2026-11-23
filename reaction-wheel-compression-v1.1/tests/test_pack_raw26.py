import pathlib,subprocess,sys,tempfile,unittest,struct
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'serial-agent'))
from wheel_protocol import Raw26Parser,encode,decode

class PackRaw26Test(unittest.TestCase):
    def test_integrated_poll_26_fields_crc_and_host_encoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe=pathlib.Path(tmp)/'poll';wire=pathlib.Path(tmp)/'frame.rwt'
            subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror','-D__app_H','-DBUFFER_SIZE=128',
                '-include',str(ROOT/'tests/mcu_stubs.h'),'-I'+str(ROOT/'firmware-raw26-pack/UserFile'),'-I'+str(ROOT/'firmware/UserFile'),
                str(ROOT/'firmware-raw26-pack/UserFile/WheelTelemetry.c'),str(ROOT/'tests/test_pack_raw26.c'),'-o',str(exe)],check=True)
            subprocess.run([str(exe),str(wire)],check=True)
            data=wire.read_bytes();frames=Raw26Parser().feed(data)
            self.assertEqual(len(data),122);self.assertEqual(len(frames),1)
            f=frames[0];self.assertEqual(struct.unpack('<26f',f['raw']),tuple(range(1,27)))
            self.assertEqual(f['sequence'],0);self.assertEqual(f['deviceMillis'],110)
            self.assertEqual(decode(encode(f['raw'],f['sequence'],f['deviceMillis'],source=2))['raw'],f['raw'])
    def test_preparer_copies_source_without_control_changes(self):
        sys.path.insert(0,str(ROOT/'tools'))
        from prepare_pack_raw26 import prepare
        with tempfile.TemporaryDirectory() as tmp:
            dst=pathlib.Path(tmp)/'new';prepare(ROOT/'firmware',dst)
            changed=[p.relative_to(dst).as_posix() for p in dst.rglob('*') if p.is_file() and p.read_bytes()!=(ROOT/'firmware'/p.relative_to(dst)).read_bytes()]
            self.assertEqual(set(changed),{'UserFile/WheelTelemetry.c','UserFile/WheelTelemetry.h'})
            with self.assertRaises(ValueError):prepare(ROOT/'firmware',dst)
if __name__=='__main__':unittest.main(verbosity=2)
