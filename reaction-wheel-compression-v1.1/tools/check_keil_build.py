"""Read-only Keil project check and optional ARMCC5 compile/link smoke test.

python tools/check_keil_build.py
python tools/check_keil_build.py --arm-bin D:\\Keil\\ARM\\ARM_Compiler_5.06u7\\Bin

The smoke test uses the current shell environment, not uVision's process context.
It neither installs licenses nor changes product/licensing environment variables.
"""
import argparse
import pathlib
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]


def project_check():
    project = ROOT / 'firmware/USER/AT32F403A.uvprojx'
    tree = ET.parse(project)
    files = tree.findall('.//FilePath')
    errors = []
    for item in files:
        source = (project.parent / item.text.replace('\\', '/')).resolve()
        if not source.is_file():
            errors.append('Missing source/library: ' + item.text)
    for target in tree.findall('./Targets/Target'):
        opts = target.find('./TargetOption/TargetArmAds/Cads')
        if opts is None:
            errors.append('Missing ARM C compiler settings')
            continue
        defines = opts.findtext('./VariousControls/Define', '')
        if 'AT32F403ARCT7' not in defines.replace(',', ' ').split():
            errors.append('AT32F403ARCT7 must be explicitly defined')
        if opts.findtext('uC99') != '1':
            errors.append('C99 must be explicitly enabled')
    if errors:
        for message in errors:
            print('FAIL:', message)
        return False
    print('PASS: project XML, source/library paths, device macro and C99 settings')
    print('NOTE: this static check does not prove ARMCC licensing or full firmware build success.')
    return True


def run_stage(stage, command):
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                errors='replace', timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        print('FAIL:', stage, type(error).__name__)
        return False
    if result.returncode:
        output = result.stdout + '\n' + result.stderr
        print('FAIL:', stage, 'exit code', result.returncode)
        if '9511E' in output:
            print('C9511E/A9511E/L9511E: MDK product/toolkit or license recognition failed.')
            print('Repair/register the complete MDK/ARMCC5 installation and check License Management.')
        else:
            # Keep license variables and diagnostic details local to avoid disclosure.
            print('Inspect this tool in the licensed MDK environment; do not publish license details.')
        return False
    print('PASS:', stage)
    return True


def smoke_test(folder):
    armcc, armlink = folder / 'armcc.exe', folder / 'armlink.exe'
    if not armcc.is_file() or not armlink.is_file():
        print('FAIL: --arm-bin must contain both armcc.exe and armlink.exe')
        return False
    with tempfile.TemporaryDirectory(prefix='wheel-armcc-check-') as tmp:
        d = pathlib.Path(tmp)
        source, obj, axf = d/'probe.c', d/'probe.o', d/'probe.axf'
        source.write_text('int wheel_probe(void) { return 0; }\n', encoding='ascii')
        if not run_stage('ARMCC5 minimal C compilation', [str(armcc), '--cpu=Cortex-M4',
                '--c99', '-c', str(source), '-o', str(obj)]):
            return False
        if not obj.is_file():
            print('FAIL: compiler did not create an object file')
            return False
        if not run_stage('ARM linker minimal link', [str(armlink), '--entry=wheel_probe',
                '--no_scanlib', str(obj), '--output='+str(axf)]):
            return False
        if not axf.is_file():
            print('FAIL: linker did not create an AXF')
            return False
    print('NOTE: smoke test excludes startup assembly, vendor FOC library and full firmware.')
    print('Next: Rebuild the complete project in uVision and confirm 0 Error(s).')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arm-bin', type=pathlib.Path)
    args = parser.parse_args()
    if not project_check():
        return 1
    if args.arm_bin and not smoke_test(args.arm_bin):
        return 2
    if not args.arm_bin:
        print('ARMCC compile/link: NOT RUN (pass --arm-bin in a correctly installed MDK environment)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
