"""Dedicated loopback service: result-frame transfers, resident physical steps."""
import argparse,asyncio,json,struct
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from mixed_process import MixedProcess
from benchmark_mixed import compile_project
FEATURE='residentMpmFemV6'

async def run(port):
    backend=dict(name='Taichi',arch='cuda',device='CUDA worker (verified on load)');active=False;solver=None
    async def session(ws):
        nonlocal active,solver,backend
        if active:
            await ws.send(json.dumps(dict(type='error',message='混合 GPU 服务已有连接，请使用当前页面或另开端口。')));return
        active=True
        try:
            await ws.send(json.dumps(dict(type='ready',backend=backend,feature=FEATURE,features=[FEATURE,'residentFourMethodV2','mixedMetalPlasticityV1'])))
            async for raw in ws:
                d={}
                try:
                    if not isinstance(raw,str):raise ValueError('Expected JSON command')
                    d=json.loads(raw)
                    if not isinstance(d,dict) or not isinstance(d.get('id'),int):raise ValueError('Invalid request ID')
                    if d.get('type')=='init':
                        compiled=await asyncio.to_thread(compile_project,project=d['project'])
                        next_solver=MixedProcess(compiled)
                        try:frame,particles=await asyncio.to_thread(next_solver.receive)
                        except Exception:next_solver.close();raise
                        previous=solver;solver=next_solver
                        if previous:previous.close()
                    elif d.get('type')=='advance' and solver:frame,particles=await asyncio.to_thread(solver.step,d['dt'])
                    else:raise ValueError('Load a mixed project before advancing')
                    header=json.dumps(dict(type='frame',id=d['id'],frame=frame,count=len(particles)),ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
                    await ws.send(struct.pack('<I',len(header))+header+b' '*((-len(header))%4)+particles.astype('<f4',copy=False).tobytes())
                except (ValueError,KeyError,TypeError) as error:
                    await ws.send(json.dumps(dict(type='operation',id=d.get('id') if isinstance(d,dict) else None,message=str(error)),ensure_ascii=False))
        except ConnectionClosed:pass
        except Exception as error:
            import traceback;traceback.print_exc()
            try:await ws.send(json.dumps(dict(type='error',message='混合 GPU 求解停止：'+str(error)),ensure_ascii=False))
            except ConnectionClosed:pass
        finally:
            if solver:solver.close()
            active=False;solver=None
    async with serve(session,'127.0.0.1',port,origins=['http://127.0.0.1:5173','http://localhost:5173'],max_size=1_000_000,compression=None,ping_interval=20):
        print(f'MIXED GPU READY ws://127.0.0.1:{port} | {backend}',flush=True);await asyncio.Future()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8795);args=p.parse_args()
    if not 8765<=args.port<=8799:p.error('port must be 8765–8799')
    try:asyncio.run(run(args.port))
    except KeyboardInterrupt:pass
