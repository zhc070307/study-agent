const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {localFile}=require('../../packages/desktop/local-files.cjs');
test('native file boundary resolves filesystem aliases and rejects files outside the learning library',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-local-path-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const learning=path.join(root,'学习资料 长路径'),course=path.join(learning,'课程文件');fs.mkdirSync(course,{recursive:true});
  const file=path.join(course,'中文笔记.md');fs.writeFileSync(file,'fixture');
  assert.equal(localFile(file,learning),fs.realpathSync.native(file));
  const other=path.join(root,'private.txt');fs.writeFileSync(other,'outside');
  assert.throws(()=>localFile(other,learning),/位置/);
  assert.throws(()=>localFile(course,learning),/位置/);
  if(process.platform==='win32'){
    const script=`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class Paths { [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path,StringBuilder output,uint size); }'; $buf=New-Object System.Text.StringBuilder 32768; $count=[Paths]::GetShortPathName($env:STUDY_PATH_FIXTURE,$buf,32768); if ($count -eq 0) { throw 'Short path lookup failed' }; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($buf.ToString())))`;
    const encoded=execFileSync('powershell.exe',['-NoProfile','-Command',script],{env:{...process.env,STUDY_PATH_FIXTURE:learning},encoding:'utf8'}).trim();
    const short=Buffer.from(encoded,'base64').toString('utf8');
    assert.equal(localFile(file,short),fs.realpathSync.native(file));
  }else{
    const alias=path.join(root,'alias');fs.symlinkSync(learning,alias);
    assert.equal(localFile(file,alias),fs.realpathSync.native(file));
    fs.symlinkSync(other,path.join(course,'external.txt'));
    assert.throws(()=>localFile(path.join(course,'external.txt'),learning),/位置/);
  }
});
