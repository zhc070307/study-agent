#!/usr/bin/env python3
"""Check actual installation capabilities using temporary files, without inference."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import subprocess
import sys
import tempfile

PROJECT = Path(__file__).resolve().parents[1]
SYSTEM_PACKAGES = ('python3 build-essential curl ca-certificates bash git ripgrep '
                   'latexmk texlive-xetex texlive-lang-chinese texlive-latex-extra '
                   'texlive-fonts-recommended texlive-science poppler-utils')
TEX = r'''\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{amsmath,amssymb,graphicx,geometry,booktabs,enumitem,xcolor,hyperref,tikz,siunitx,mathtools,tcolorbox,pgfplots}
\begin{document}
中文安装检查：函数 $f(x)=x^2$，$f'(x)=2x$。
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
\end{document}
'''


def run(command, **kwargs):
    return subprocess.run(command, capture_output=True, text=True, check=True, timeout=120, **kwargs)


def check_pdf(directory):
    directory = Path(directory)
    (directory/'main.tex').write_text(TEX, encoding='utf-8')
    run(['latexmk','-norc','-xelatex','-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex'], cwd=directory)
    info = run(['pdfinfo',str(directory/'main.pdf')], env=dict(os.environ, LC_ALL='C')).stdout
    if 'Pages:' not in info: raise RuntimeError('无法读取 PDF 页数')
    text = run(['pdftotext',str(directory/'main.pdf'),'-']).stdout
    if '中文安装检查' not in text: raise RuntimeError('中文字体或 PDF 文字提取不可用')
    run(['pdftoppm','-f','1','-l','1','-singlefile','-scale-to','200','-png',str(directory/'main.pdf'),str(directory/'page')])
    if not (directory/'page.png').is_file(): raise RuntimeError('无法生成 PDF 页面图片')


def main(arguments=None):
    parser=argparse.ArgumentParser(description='检查安装条件，不调用模型，也不读取学习材料')
    parser.add_argument('--before-setup',action='store_true',help='只检查安装前的系统依赖')
    parser.add_argument('--require-model',action='store_true',help='模型密钥未配置时检查失败')
    parser.add_argument('--data',type=Path,help='检查此目录的写入和数据库能力')
    args=parser.parse_args(arguments)
    problems=[]

    def check(label, action, remedy):
        try:
            action()
            print('通过：'+label)
        except Exception:
            # Subprocess output may include credentials or personal paths. Never echo it.
            problems.append(label)
            print('未通过：'+label+'。'+remedy)

    def supported():
        if platform.system()!='Linux' or platform.machine() not in ('x86_64','AMD64') or platform.libc_ver()[0]!='glibc':
            raise RuntimeError('unsupported platform')
        if sys.version_info<(3,9): raise RuntimeError('Python 3.9 required')
    check('运行平台与 Python',supported,'macOS、Windows 和 ARM 主机请使用仓库的 Docker Compose 安装方式。')
    commands=['node','pnpm','bash','cc','curl','tar','git','rg','xelatex','latexmk','kpsewhich','pdfinfo','pdftotext','pdftoppm']
    missing=[command for command in commands if not shutil.which(command)]
    if missing:
        problems.append('系统工具')
        print('未通过：缺少 '+', '.join(missing)+'。Ubuntu/Debian 依赖：sudo apt-get install -y '+SYSTEM_PACKAGES+'；另需 Node 24 和 pnpm 11.19.0。')
    else: print('通过：系统工具')

    def versions():
        version=run(['node','-p','process.versions.node']).stdout.strip()
        if int(version.split('.')[0])!=24: raise RuntimeError('Node version')
        if run(['pnpm','--version']).stdout.strip()!='11.19.0': raise RuntimeError('pnpm version')
    check('Node 与 pnpm 版本',versions,'使用 Node 24 与 pnpm 11.19.0。')

    with tempfile.TemporaryDirectory(prefix='study-install-check-') as directory:
        check('中文 LaTeX 编译、常用宏包、PDF 文字和页面读取',lambda:check_pdf(directory),
              '安装上列 TeX Live/Poppler 依赖；确认 ctex、Fandol 字体和常用宏包可用。自定义文档仍可能需要额外宏包或附件。')
        if not args.before_setup:
            check('运行核心、图像库、终端和会话写锁',lambda:run(['node','--import','tsx/esm',str(PROJECT/'verification/runtime/install-smoke.ts'),directory],cwd=PROJECT),
                  '运行 ./study-agent setup；不要使用跳过可选依赖的安装方式。')
    if args.data:
        def storage():
            args.data.mkdir(parents=True,exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='.install-check-',dir=args.data) as directory:
                with sqlite3.connect(str(Path(directory)/'check.sqlite')) as conn:
                    conn.execute('PRAGMA journal_mode=WAL')
                    conn.execute('CREATE TABLE probe (value TEXT)')
                    conn.execute('INSERT INTO probe VALUES (?)',('保存检查',))
                    conn.commit()
                    if conn.execute('SELECT value FROM probe').fetchone()[0]!='保存检查': raise RuntimeError('storage')
        check('学习目录可写与数据库保存',storage,'使用当前运行用户可写的独立持久目录，勿使用只读目录。')

    if not args.before_setup and shutil.which('node'):
        # Use exactly the runtime's .env precedence. Only a boolean leaves Node.
        try:
            configured=run(['node','--import','tsx/esm','--input-type=module','-e',
                "import {loadLayeredEnv} from './packages/runtime/modules/boot/app-boot/src/index.ts';loadLayeredEnv('study-agent');process.stdout.write(process.env.DEEPSEEK_API_KEY?.trim()?'yes':'no')"],cwd=PROJECT).stdout.strip()=='yes'
        except Exception: configured=False
        if configured: print('通过：模型密钥已配置（未验证联网或调用）')
        else:
            print('未配置：DEEPSEEK_API_KEY；请在私有 .env 或运行环境中配置，助理需要它才能回答。')
            if args.require_model: problems.append('模型密钥')
    if problems:
        print('安装检查未通过，请先处理上述项目。')
        return 1
    print('安装检查通过；未调用模型，也未验证 API 余额或服务可达性。')
    return 0


if __name__=='__main__': raise SystemExit(main())
