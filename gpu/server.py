"""Loopback-only GPU service; one live simulation, bounded frames and commands."""
import argparse
import asyncio
import json
import struct
import time
from collections import deque
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from runtime import initialize
from solver import Solver, GRAVITY_DEFAULTS
from run_control import RunControl

ORIGINS=["http://127.0.0.1:5173","http://localhost:5173"]


def packet(metadata,data):
    header=json.dumps(metadata,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
    padding=(-len(header))%4
    return struct.pack("<I",len(header))+header+b" "*padding+data.astype("<f4",copy=False).tobytes()


async def run(arch,port):
    backend=initialize(arch)
    solver=Solver()
    print("Warming GPU kernels (first launch compiles Taichi kernels)...",flush=True)
    solver.reset("coupled");solver.step();solver.snapshot()
    solver.command(dict(type="drag-start",point=[20,20,10],radius=9))
    solver.command(dict(type="brush",tool="heat",point=[20,20,10],radius=9))
    solver.command(dict(type="brush",tool="erase",point=[100,100,100],radius=1))
    solver.reset("empty")
    active=False

    async def session(ws):
        nonlocal active
        if active:
            await ws.send(json.dumps(dict(type="error",message="GPU 正被另一个标签页使用。请关闭该 GPU 页面，或切换到 CPU。")))
            await ws.close(code=1013,reason="GPU session busy")
            return
        active=True
        queue=deque();ack=True;running=True;control=RunControl();initialized=False;wake=asyncio.Event()
        ms=0.0;rate=0.0;last_tick=0;dirty=True

        async def receive():
            nonlocal ack,running
            try:
                async for message in ws:
                    if not isinstance(message,str):
                        continue
                    d=json.loads(message)
                    if not isinstance(d,dict):
                        raise ValueError("Expected a command object")
                    if d.get("type")=="ack":
                        ack=True
                    else:
                        # Coalesce high-rate target updates while keeping edit order.
                        if queue and d.get("type") in ("drag","press") and queue[-1].get("type")==d.get("type"):
                            if d["type"]=="press":
                                queue[-1].setdefault("value",{}).update(d.get("value",{}))
                            else:
                                queue[-1]=d
                        elif len(queue)<128:
                            queue.append(d)
                        else:
                            raise ValueError("Command queue limit exceeded")
                    wake.set()
            except ConnectionClosed:
                pass
            except (ValueError,TypeError):
                await ws.close(code=1008,reason="Invalid command")
            finally:
                running=False;wake.set()

        reader=asyncio.create_task(receive())
        try:
            await ws.send(json.dumps(dict(type="ready",backend=backend,features=["customPhaseChange","stablePhaseHandoff","solidSampling","discretization"])))
            while running:
                wake.clear()
                start=time.perf_counter()
                for _ in range(min(len(queue),32)):
                    d=queue.popleft();kind=d.get("type")
                    if kind=="init":
                        solver.settings.update(GRAVITY_DEFAULTS)
                        solver.settings.update(gravity=True,stiffness=1.0,thermal=True,heatRate=20.0,ambient=False,timeStepScale=1.0,pbfIterations=3,pbfAntiClump=True,solidAntiClump=True)
                        control.reset();solver.reset(d.get("scene","coupled"));initialized=True;ms=rate=0;last_tick=0
                    elif kind=="pause":
                        control.pause(d.get("value"),solver.time);last_tick=0
                    elif initialized and kind in ("run","step"):
                        ok=control.start(d.get("duration"),solver.time) if kind=="run" else control.single()
                        await ws.send(json.dumps(dict(type="operation",ok=ok)))
                        last_tick=0
                    elif initialized:
                        result=solver.command(d)
                        if result:
                            await ws.send(json.dumps(result))
                        if kind=="reset":
                            ms=rate=0;last_tick=0;control.reset()
                    dirty=True
                # Backpressure also stops simulation when a background tab stops acknowledging.
                if initialized and ack:
                    dt=control.dt(solver.time)
                    if dt>0:
                        before=solver.time;tick=time.perf_counter();solver.step(dt);now=time.perf_counter()
                        control.advanced(solver.time)
                        ms=(now-tick)*1000;rate=(solver.time-before)/(now-last_tick) if last_tick else 0
                        last_tick=now;dirty=True
                    if dirty:
                        snapshot_start=time.perf_counter();state,data=solver.snapshot();snapshot_ms=(time.perf_counter()-snapshot_start)*1000
                        state.update(type="frame",backend=backend,ms=ms,paused=control.paused,run=control.snapshot(),rate=rate,snapshotMs=snapshot_ms)
                        ack=False;dirty=False
                        await ws.send(packet(state,data))
                # Wake immediately on ACK; polling at 60 Hz otherwise halves throughput.
                if not ack and running:
                    try:
                        await asyncio.wait_for(wake.wait(),timeout=1)
                    except asyncio.TimeoutError:
                        pass
                await asyncio.sleep(max(.001,(.02 if control.paused else 1/60)-(time.perf_counter()-start)))
        except ConnectionClosed:
            pass
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                await ws.send(json.dumps(dict(type="error",message="GPU 求解已停止："+str(exc))))
            except ConnectionClosed:
                pass
        finally:
            running=False;reader.cancel()
            await asyncio.gather(reader,return_exceptions=True)
            solver.reset("empty");active=False

    async with serve(session,"127.0.0.1",port,origins=ORIGINS,max_size=65536,max_queue=16,compression=None,ping_interval=20):
        print(f"GPU READY ws://127.0.0.1:{port} | {backend}",flush=True)
        await asyncio.Future()


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--arch",choices=["cuda","vulkan"],default="cuda")
    parser.add_argument("--port",type=int,default=8765)
    args=parser.parse_args()
    try:
        asyncio.run(run(args.arch,args.port))
    except KeyboardInterrupt:
        pass
