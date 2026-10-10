// Exercise the installed binaries, rather than merely checking their filenames.
import sharp from 'sharp'
import * as pty from 'node-pty'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { tryLockExclusive } from '../../packages/runtime/native/system/packages/entry/src/flock.ts'

const directory=process.argv[2]!
await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer()
const file=await open(join(directory,'lock'),'w+')
try { await tryLockExclusive(file.fd) } finally { await file.close() }
await new Promise<void>((resolve,reject)=>{
  const terminal=pty.spawn('/bin/bash',['-c','printf install-ok'],{cwd:directory,env:process.env})
  let output=''
  const timer=setTimeout(()=>{terminal.kill();reject(new Error('terminal timed out'))},10000)
  terminal.onData(data=>output+=data)
  terminal.onExit(({exitCode})=>{
    clearTimeout(timer)
    if(exitCode!==0||!output.includes('install-ok'))reject(new Error('terminal failed'))
    else resolve()
  })
})
