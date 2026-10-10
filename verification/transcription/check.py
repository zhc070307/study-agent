"""Optional speech dependency/audio/checkpoint checks; no Qwen weights or inference."""
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
import numpy as np
import soundfile as sf
import torch
import torchaudio
from transformers import AutoModelForMultimodalLM, AutoProcessor

from local_transcribe.audio import decode_audio, prepare_segments
from local_transcribe.pipeline import Pipeline
from local_transcribe.task_store import create_task, read_task

from local_transcribe.models import detect_device, validate_device
# A device failure cannot silently select CPU or start fetching weights.
with patch('torch.backends.mps.is_available',return_value=False),patch('torch.cuda.is_available',return_value=False),patch('torch.xpu.is_available',return_value=False),patch.dict(os.environ,{'LOCALTRANSCRIBE_DEVICE':'auto'}):
    try:detect_device();raise AssertionError('Unexpected CPU fallback')
    except RuntimeError:pass
with patch.dict(os.environ,{'LOCALTRANSCRIBE_DEVICE':'cpu'}):assert validate_device()[0]=='cpu'

with tempfile.TemporaryDirectory(prefix='speech-check-') as directory:
    root=Path(directory)
    os.environ.update(LOCALTRANSCRIBE_DATA_DIR=str(root/'data'),LOCALTRANSCRIBE_CACHE_DIR=str(root/'cache'),LOCALTRANSCRIBE_LOG_DIR=str(root/'logs'))
    source=root/'source.wav'
    sf.write(source,np.sin(np.arange(32000)*2*np.pi*220/16000)*0.1,16000)
    decoded=root/'decoded.wav';decode_audio(source,decoded)
    actual=prepare_segments(decoded,root/'segments',root/'segments.json')
    assert actual and Path(actual[0]['path']).is_file()
    # Exercise the original pipeline's interrupted-chunk resume with a scripted recognizer.
    task=create_task(source,root/'output')
    calls=[]
    fail=[True]
    class Recognizer:
        device='scripted-test'
        def __init__(self,*unused):pass
        def transcribe(self,path):
            calls.append(path.name)
            if path.name=='two.wav' and fail[0]:raise RuntimeError('scripted interruption')
            return {'text':'脚本化片段 '+path.name}
    def segments(decoded,folder,manifest,**unused):
        folder.mkdir(parents=True,exist_ok=True)
        items=[]
        for index,name in enumerate(('one.wav','two.wav')):
            path=folder/name;sf.write(path,np.zeros(16000),16000)
            items.append({'index':index,'path':str(path),'start_seconds':index,'end_seconds':index+1})
        manifest.write_text(json.dumps(items));return items
    with patch('local_transcribe.pipeline.prepare_segments',segments),patch('local_transcribe.pipeline.ensure_model',return_value=root/'model'),patch('local_transcribe.pipeline.QwenAsr',Recognizer):
        try:Pipeline(task['id'],lambda unused:None).run(skip_refiner=True)
        except RuntimeError:pass
        else:raise AssertionError('failed chunk was not retained')
        assert read_task(task['id'])['status']=='failed'
        fail[0]=False
        Pipeline(task['id'],lambda unused:None).run(skip_refiner=True)
        saved=read_task(task['id'])
        assert saved['status']=='completed'
        assert calls==['one.wav','two.wav','two.wav'],calls
        assert 'one.wav' in Path(saved['raw_transcript']).read_text()
        assert source.is_file()
print('CPU imports, actual WAV decoding/VAD/segment preparation, and scripted checkpoint resume passed. No Qwen inference.')
