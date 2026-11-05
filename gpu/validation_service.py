"""Cancellable validation subprocesses, isolated from the live project solver."""
import asyncio
import json
import sys
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PREFIX=b'CONTACT_VALIDATION '

async def validation_session(ws,arch):
    process=None;cancel=None;cpu_file=None
    tag=uuid.uuid4().hex[:12]
    log=ROOT/'artifacts'/('contact-validation-'+tag+'.log')
    try:
        await ws.send(json.dumps(dict(type='ready',feature='contact-validation/1')))
        command=json.loads(await asyncio.wait_for(ws.recv(),15))
        if command!={'type':'run','version':'contact-clock/1'}:
            raise ValueError('无效接触验证请求')
        cancel=asyncio.create_task(ws.recv())
        async def line():
            read=asyncio.create_task(process.stdout.readline())
            try:
                done,_=await asyncio.wait([read,cancel],timeout=180,return_when=asyncio.FIRST_COMPLETED)
                if cancel in done:raise asyncio.CancelledError()
                if read not in done:raise TimeoutError('验证进程长时间无响应')
                return read.result()
            finally:
                if not read.done():read.cancel()
        with log.open('wb') as errors:
            await ws.send(json.dumps(dict(type='progress',value=dict(backend='CPU',index=0,total=11,case='initializing',fraction=0))))
            process=await asyncio.create_subprocess_exec('node','tests/run-contact-validation.mjs','--json',
                cwd=ROOT,stdout=asyncio.subprocess.PIPE,stderr=errors,limit=4_000_000)
            output=await line()
            if await process.wait()!=0:raise RuntimeError('CPU 验证失败，请查看 '+log.name)
            report=json.loads(output)
            if report.get('version')!='contact-clock/1':raise RuntimeError('CPU 验证版本不匹配')
            cpu_file=ROOT/'artifacts'/('contact-validation-cpu-'+tag+'.json')
            cpu_file.write_text(json.dumps(report),encoding='utf-8')
            process=await asyncio.create_subprocess_exec(sys.executable,'-X','utf8','gpu/contact_validation.py',
                '--arch',arch,'--cpu-report',str(cpu_file),cwd=ROOT,stdout=asyncio.subprocess.PIPE,stderr=errors,limit=4_000_000)
            completed=False
            while True:
                data=await line()
                if not data:break
                if data.startswith(PREFIX):
                    message=json.loads(data[len(PREFIX):])
                    if message.get('type')=='complete':completed=True
                    await ws.send(json.dumps(message,allow_nan=False))
            if await process.wait()!=0 or not completed:raise RuntimeError('GPU 验证失败，请查看 '+log.name)
    except asyncio.CancelledError:
        pass
    except Exception as error:
        try:await ws.send(json.dumps(dict(type='error',message=str(error)),ensure_ascii=False))
        except Exception:pass
    finally:
        if cancel:
            cancel.cancel()
            await asyncio.gather(cancel,return_exceptions=True)
        if process and process.returncode is None:
            process.terminate()
            try:await asyncio.wait_for(process.wait(),10)
            except TimeoutError:process.kill();await process.wait()
        if cpu_file:cpu_file.unlink(missing_ok=True)
