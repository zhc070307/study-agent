const fs=require('node:fs'),path=require('node:path');
function localFile(target,learning){
  // The native resolver expands Windows short-name aliases as Python Path.resolve does.
  const canonical=fs.realpathSync.native(target),root=fs.realpathSync.native(learning);
  const relative=path.relative(root,canonical);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.statSync(canonical).isFile())throw new Error('文件位置无效');
  return canonical;
}
module.exports={localFile};
