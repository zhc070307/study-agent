"""Guard the adopted source boundary, licensing, and standalone workspace resolution."""
import json
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[2]
runtime=root/'packages/runtime'
source=json.loads((runtime/'SOURCE.json').read_text())
assert not (root/'.gitmodules').exists(), 'Runtime must not become a submodule again'
assert not (root/'vendor/deepseek-harness').exists(), 'Use the adopted source, not a parallel checkout'
if (root/'.git').exists():
    assert '160000' not in subprocess.check_output(['git','ls-files','--stage'],cwd=root,text=True), 'No gitlinks in product source'
for package,record in source['components'].items():
    directory=runtime/record['path']
    manifest=json.loads((directory/'package.json').read_text())
    assert manifest['name']==package
    assert manifest['license']==record['license'] in ('MIT','BSD-3-Clause')
    if record['path'].startswith('foundation/'):
        assert (directory/'LICENSE').is_file(), package+' lost its own notice'
    for export in manifest.get('exports',{}).values():
        if isinstance(export,dict):
            for value in export.values():
                if value.startswith('./') and '*' not in value:assert (directory/value).is_file(),(package,value)
assert 'Copyright (c) 2026 DeepSeek' in (runtime/'LICENSE').read_text()
assert 'Redistribution' in (runtime/'native/system/LICENSE').read_text()
assert (root/'THIRD_PARTY_NOTICES.md').is_file()
if (root/'.git').exists():
    tracked=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
    assert not any(p.endswith('.node') for p in tracked), 'Generated native output must not be committed'
print('Adopted runtime source, licenses and module boundaries passed')
