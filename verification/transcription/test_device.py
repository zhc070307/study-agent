import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/transcription'))
import device

class DeviceTests(unittest.TestCase):
    def test_missing_gpu_blocks_before_download_and_cpu_requires_selection(self):
        with tempfile.TemporaryDirectory() as directory,patch('device.detect',return_value={'backend':None,'message':'没有 GPU'}),patch('device.available_memory',return_value=16*device.GIB),patch('device.shutil.disk_usage') as disk:
            disk.return_value.free=32*device.GIB
            self.assertFalse(device.check(directory)['eligible'])
            self.assertTrue(device.check(directory,cpu=True)['eligible'])
            self.assertEqual(list(Path(directory).iterdir()),[])
    def test_gpu_and_unified_memory_requirements(self):
        with tempfile.TemporaryDirectory() as directory,patch('device.shutil.disk_usage') as disk,patch('device.available_memory',return_value=16*device.GIB):
            disk.return_value.free=32*device.GIB
            with patch('device.detect',return_value={'backend':'cuda','name':'GPU','gpu_free_gib':2}):
                result=device.check(directory);self.assertFalse(result['eligible']);self.assertIn('显存',result['message'])
            with patch('device.detect',return_value={'backend':'mps','name':'Apple GPU'}),patch('device.available_memory',return_value=4*device.GIB):
                self.assertFalse(device.check(directory)['eligible'])
            with patch('device.detect',return_value={'backend':'mps','name':'Apple GPU'}):
                self.assertTrue(device.check(directory)['eligible'])
                disk.return_value.free=device.GIB
                self.assertFalse(device.check(directory)['eligible'])
    def test_nvidia_driver_and_best_available_gpu(self):
        rows='Card A, 1024, 8192, 580.88\nCard B, 7168, 8192, 580.88'
        with patch('device.platform.system',return_value='Windows'),patch('device.platform.machine',return_value='AMD64'),patch('device.command',return_value=rows):
            self.assertEqual(device.detect()['index'],1)
            with patch('device.command',return_value='Card, 7168, 8192, 560.01'):
                self.assertIsNone(device.detect()['backend'])
    def test_mac_requires_supported_metal(self):
        with patch('device.platform.system',return_value='Darwin'),patch('device.platform.machine',return_value='arm64'),patch('device.platform.mac_ver',return_value=('14.7',(),'')),patch('device.command',return_value=json.dumps({'SPDisplaysDataType':[{'spdisplays_metal':'Metal 3'}]})):
            self.assertEqual(device.detect()['backend'],'mps')
            with patch('device.platform.mac_ver',return_value=('13.7',(),'')):
                self.assertIsNone(device.detect()['backend'])
