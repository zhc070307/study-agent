"""Assemble self-contained desktop resources on the target OS; never install on users' hosts."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

PROJECT=Path(__file__).resolve().parents[1]
BUILD=PROJECT/'.build'

def copy(source,target):
    if target.exists():shutil.rmtree(target)
    shutil.copytree(source,target,symlinks=True,ignore=shutil.ignore_patterns('node_modules','__pycache__','*.pyc','tests','test','fixtures','.git','bin'))

def prepare(args):
    runtime=BUILD/'desktop-runtime'
    runtime.mkdir(parents=True,exist_ok=True)
    for name in ('packages','ui','scripts'):
        copy(PROJECT/name,runtime/name)
    shutil.rmtree(runtime/'packages/desktop',ignore_errors=True)
    for name in ('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','LICENSE','THIRD_PARTY_NOTICES.md'):
        if (PROJECT/name).exists():shutil.copy2(PROJECT/name,runtime/name)
    command=shutil.which('pnpm.cmd' if os.name=='nt' else 'pnpm')
    install=[command,'install','--frozen-lockfile','--ignore-scripts','--node-linker=hoisted']
    if os.name=='nt':install=['cmd.exe','/d','/c',*install]
    subprocess.run(install,cwd=runtime,check=True)
    # The native resolver maps source packages. No links to a build machine ship in an app.
    for directory,dirs,files in os.walk(runtime/'node_modules',followlinks=False):
        for name in [*dirs,*files]:
            path=Path(directory)/name
            if path.is_symlink():
                target=path.resolve()
                if target.is_relative_to(runtime/'packages'):path.unlink()
    for directory in (runtime/'packages').rglob('node_modules'):
        shutil.rmtree(directory,ignore_errors=True)
    shutil.rmtree(runtime/'node_modules/.bin',ignore_errors=True)
    node_binary=Path(shutil.which('node')).resolve()
    licenses=runtime/'licenses';licenses.mkdir(exist_ok=True)
    for candidate in (node_binary.parent/'LICENSE',node_binary.parent.parent/'LICENSE'):
        if candidate.exists():shutil.copy2(candidate,licenses/'Node-LICENSE');break
    shutil.copy2(shutil.which('node'),runtime/('node.exe' if os.name=='nt' else 'node'))
    if args.source_only:return
    executable=Path(args.python).resolve()
    python_root=executable.parent if os.name=='nt' else executable.parent.parent
    target=BUILD/'desktop-python'
    if target.exists():shutil.rmtree(target)
    shutil.copytree(python_root,target,symlinks=True)
    python=target/('python.exe' if os.name=='nt' else 'bin/python3')
    subprocess.run([str(python),'-m','pip','install','--disable-pip-version-check','pypdfium2==4.30.0','pillow==11.3.0','tzdata==2025.2'],check=True)
    tex_root=Path(subprocess.check_output(['kpsewhich','-var-value=TEXMFROOT'],text=True).strip())
    tex=BUILD/'desktop-tex'
    if tex.exists():shutil.rmtree(tex)
    shutil.copytree(tex_root,tex,symlinks=True)
    # Package the upstream license texts alongside the redistribution.
    (runtime/'licenses/component-licenses.json').write_text(json.dumps({'python':'PSF License','node':'Node.js license','tex':'individual TeX Live package licenses','pdf':'pypdfium2 Apache-2.0/BSD-3-Clause and PDFium BSD-style licenses'},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--python')
    parser.add_argument('--source-only',action='store_true')
    args=parser.parse_args()
    if not args.source_only and not args.python:parser.error('--python must point to the standalone Python installed for this build')
    prepare(args)
