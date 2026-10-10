"""Scripted ASR process for integration checks; never represents speech recognition."""
import json
from pathlib import Path


def install_fixture(tool):
    tool.python.parent.mkdir(parents=True,exist_ok=True)
    tool.python.write_text('''#!/usr/bin/env python3
import json,sys,time
from pathlib import Path
directory=Path(sys.argv[2])
print(json.dumps({'type':'progress','message':'正在转写测试片段'}),flush=True)
time.sleep(0.6)
text=directory/'fixture.txt'
text.write_text('脚本化转写示例：导数表示变化率。',encoding='utf-8')
(directory/'result.json').write_text(json.dumps({'raw_transcript':str(text)}))
''')
    tool.python.chmod(0o755)
    source=json.loads((Path(__file__).resolve().parents[2]/'transcription/SOURCE.json').read_text())
    (tool.shared/'installed.json').write_text(json.dumps({'runtime':tool.version()}))
