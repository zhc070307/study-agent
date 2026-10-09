// Study Agent owns this entry; retained boot/shutdown code keeps the proven lifecycle.
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from './profile-boot.ts'
import { runDumpConfig } from './dump-config.ts'
const args=process.argv.slice(2), patches:string[]=[]
let dump=false
for(let i=0;i<args.length;i++) {
  const flag=args[i]
  if(flag==='--patch' && args[i+1])patches.push(args[++i]!)
  else if(flag==='--profile' && args[i+1]==='sdk-minimal')i++
  else if(flag==='--dump-config')dump=true
  else throw new Error(`Unsupported Study Agent runtime option: ${flag}`)
}
if(dump)runDumpConfig('sdk-minimal',false,patches)
else await runProfile({environment:loadLayeredEnv('study-agent'),profile:'sdk-minimal',patchFiles:patches,args:[]})
