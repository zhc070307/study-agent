const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const yaml=require('../packages/desktop/node_modules/js-yaml');

function digest(file,algorithm,encoding){
  const hash=crypto.createHash(algorithm),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);
  try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
  return hash.digest(encoding);
}
function prepare(input,output,version){
  if(!/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.[0-9]+)?$/.test(version))throw new Error('Unsupported release version');
  const files=new Map();
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error('Release assets cannot be symbolic links');
    if(entry.isDirectory()){walk(file);continue;}
    if(!/\.(exe|dmg|zip|blockmap)$/.test(entry.name)&&!/^(latest|beta|alpha)(-mac)?\.yml$/.test(entry.name))continue;
    if(files.has(entry.name))throw new Error('Duplicate release asset: '+entry.name);
    files.set(entry.name,file);
  }}
  walk(input);
  const channel=version.includes('-')?version.split('-')[1].split('.')[0]:'latest';
  for(const suffix of ['','-mac']){
    const meta=files.get(channel+suffix+'.yml');if(!meta)throw new Error('Missing update metadata');
    const info=yaml.load(fs.readFileSync(meta,'utf8'));
    if(info.version!==version||!Array.isArray(info.files)||!info.files.length)throw new Error('Invalid update version or files');
    const verify=item=>{
      if(typeof item.url!=='string'||path.basename(item.url)!==item.url||/[\\/]/.test(item.url))throw new Error('Unsafe update filename');
      const file=files.get(item.url);if(!file)throw new Error('Missing update asset: '+item.url);
      if(digest(file,'sha512','base64')!==item.sha512)throw new Error('Update checksum mismatch');
      if(item.size!==undefined&&item.size!==fs.statSync(file).size)throw new Error('Update size mismatch');
    };
    info.files.forEach(verify);
    if(!info.files.some(item=>item.url.endsWith(suffix?'.zip':'.exe')))throw new Error('Missing platform update payload');
    if(info.path)verify({url:info.path,sha512:info.sha512});
  }
  for(const ext of ['exe','dmg','zip'])if([...files.keys()].filter(name=>name.endsWith('.'+ext)).length!==1)throw new Error('Expected one '+ext+' installer');
  fs.mkdirSync(output,{recursive:true});if(fs.readdirSync(output).length)throw new Error('Release output must be empty');
  const manifest={};
  for(const [name,file] of files){fs.copyFileSync(file,path.join(output,name));manifest[name]={size:fs.statSync(file).size,digest:'sha256:'+digest(file,'sha256','hex')};}
  const checksums=path.join(output,'SHA256SUMS.txt');
  fs.writeFileSync(checksums,Object.entries(manifest).map(([name,info])=>info.digest.slice(7)+'  '+name+'\n').join(''));
  manifest['SHA256SUMS.txt']={size:fs.statSync(checksums).size,digest:'sha256:'+digest(checksums,'sha256','hex')};
  return manifest;
}
if(require.main===module){const [input,output,version]=process.argv.slice(2);fs.writeFileSync('manifest.json',JSON.stringify(prepare(input,output,version)));}
module.exports={prepare};
