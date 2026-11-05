"""Separate loopback endpoint for unified GPU projects; never steals a particle session."""
import argparse
import asyncio
import json
import struct
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from runtime import initialize
from project_solver import ProjectSolver
from validation_service import validation_session

ORIGINS=['http://127.0.0.1:5173','http://localhost:5173']
FEATURE='rigidMpmPbfClockV11'

def packet(header,data):
    encoded=json.dumps(header,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
    return struct.pack('<I',len(encoded))+encoded+b' '*((-len(encoded))%4)+data.astype('<f4',copy=False).tobytes()

async def run(arch,port):
    backend=initialize(arch);solver=ProjectSolver();active=False;validating=False
    async def session(ws):
        nonlocal active,validating
        if ws.request.path=='/validation':
            if validating:
                await ws.send(json.dumps(dict(type='error',message='该服务已有独立接触验证在运行。')));return
            validating=True
            try:await validation_session(ws,arch)
            finally:validating=False
            return
        if active:
            await ws.send(json.dumps(dict(type='error',message='该 GPU 项目服务正被另一个页面使用；请选择另一个端口。')));await ws.close(code=1013);return
        active=True;initialized=False
        try:
            await ws.send(json.dumps(dict(type='ready',backend=backend,features=[FEATURE,'partThermalLoadsV1'])))
            async for raw in ws:
                request=None
                try:
                    if not isinstance(raw,str):raise ValueError('预期 JSON 命令')
                    request=json.loads(raw)
                    if not isinstance(request,dict) or not isinstance(request.get('id'),int):raise ValueError('无效请求 ID')
                    if request.get('type')=='init':
                        frame,data=solver.initialize(request['project']);initialized=True
                    elif request.get('type')=='step' and initialized:
                        duration=request.get('dt')
                        if solver.time+(duration if isinstance(duration,(int,float)) else 100)>60+1e-8:raise ValueError('累计求解最多 60 s')
                        frame,data=solver.step(duration)
                    elif request.get('type')=='command' and initialized:
                        frame,data=solver.command(request.get('command'))
                    else:raise ValueError('项目未初始化或命令不支持')
                    frame.update(backend=backend)
                    await ws.send(packet(dict(type='frame',id=request['id'],frame=frame,count=len(data)),data))
                except (ValueError,KeyError,TypeError) as error:
                    await ws.send(json.dumps(dict(type='operation',id=request.get('id') if isinstance(request,dict) else None,ok=False,message=str(error)),ensure_ascii=False))
        except ConnectionClosed:pass
        except Exception as error:
            import traceback
            traceback.print_exc()
            try:await ws.send(json.dumps(dict(type='error',message='GPU 耦合已停止：'+str(error)),ensure_ascii=False))
            except ConnectionClosed:pass
        finally:active=False
    try:
        async with serve(session,'127.0.0.1',port,origins=ORIGINS,max_size=1_000_000,max_queue=4,compression=None,ping_interval=20):
            print(f'GPU PROJECT READY ws://127.0.0.1:{port} | {backend}',flush=True)
            await asyncio.Future()
    finally:solver.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--arch',choices=['cuda','vulkan'],default='cuda');parser.add_argument('--port',type=int,default=8769);args=parser.parse_args()
    if not 8765<=args.port<=8799:parser.error('port must be 8765–8799')
    try:asyncio.run(run(args.arch,args.port))
    except KeyboardInterrupt:pass
