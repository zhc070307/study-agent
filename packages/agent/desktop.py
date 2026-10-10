"""App-owned backend and optional GPU service. No external setup or terminal."""
import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import threading

os.environ['STUDY_NATIVE']='1'
from workspace import PROJECT
from web import create_server

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args()
    os.environ['STUDY_NATIVE']='1'
    args.data.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(PROJECT/'packages/transcription'))
    from host import Service,Handler,write,ThreadingHTTPServer
    service=Service(args.data/'.transcription')
    host=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    host.daemon_threads=True;host.service=service;host.token=secrets.token_urlsafe(32)
    config=args.data/'.settings/transcription.json'
    write(config,{'url':f'http://127.0.0.1:{host.server_port}','token':host.token})
    if os.name!='nt':config.chmod(0o600)
    os.environ['STUDY_TRANSCRIBE_CONFIG']=str(config)
    threading.Thread(target=host.serve_forever,daemon=True).start()
    server=create_server(args.data,args.port)
    server.close_token=secrets.token_urlsafe(32)
    print(json.dumps({'ready':True,'port':server.server_port,'close_token':server.close_token}),flush=True)
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        server.runtime.stop();server.server_close()
        service.stop(service.active)
        if service.child and service.child.poll() is None:
            try:service.child.wait(timeout=5)
            except Exception:service.child.kill()
        host.shutdown();host.server_close()

if __name__=='__main__':main()
