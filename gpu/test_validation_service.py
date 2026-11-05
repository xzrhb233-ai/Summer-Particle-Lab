import asyncio
import json
import unittest
from unittest.mock import patch
from validation_service import validation_session,PREFIX

class Socket:
    def __init__(self,command=None):
        self.commands=asyncio.Queue()
        self.commands.put_nowait(command or {'type':'run','version':'contact-clock/1'})
        self.sent=[]
    async def recv(self):
        return json.dumps(await self.commands.get())
    async def send(self,value):
        self.sent.append(json.loads(value))

class Process:
    def __init__(self,lines=None):
        self.stdout=self;self.lines=lines;self.returncode=None;self.terminated=False
        self.done=asyncio.Event()
    async def readline(self):
        if self.lines is None:await self.done.wait();return b''
        return self.lines.pop(0) if self.lines else b''
    async def wait(self):
        self.returncode=-15 if self.terminated else 0
        return self.returncode
    def terminate(self):
        self.terminated=True;self.done.set()
    def kill(self):
        self.terminate()

class ValidationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_request_does_not_launch_a_solver(self):
        socket=Socket({'type':'run','version':'wrong'})
        with patch('validation_service.asyncio.create_subprocess_exec') as spawn:
            await validation_session(socket,'cuda')
            spawn.assert_not_called()
        self.assertEqual(socket.sent[-1]['type'],'error')

    async def test_cancel_terminates_only_its_own_child(self):
        socket=Socket();child=Process();started=asyncio.Event()
        async def spawn(*args,**kwargs):
            started.set();return child
        with patch('validation_service.asyncio.create_subprocess_exec',spawn):
            task=asyncio.create_task(validation_session(socket,'cuda'))
            await started.wait();socket.commands.put_nowait({'type':'cancel'})
            await asyncio.wait_for(task,2)
        self.assertTrue(child.terminated)
        self.assertFalse(any(x['type']=='complete' for x in socket.sent))

    async def test_cpu_gpu_pipeline_relays_results_and_removes_temporary_input(self):
        socket=Socket()
        cpu=Process([json.dumps({'version':'contact-clock/1','rows':[]}).encode()])
        gpu=Process([b'Taichi compiler output\n',PREFIX+json.dumps({'type':'complete','report':{'version':'contact-clock/1'}}).encode()])
        children=[cpu,gpu];temporary=None
        async def spawn(*args,**kwargs):
            nonlocal temporary
            if '--cpu-report' in args:
                from pathlib import Path
                temporary=Path(args[args.index('--cpu-report')+1])
                self.assertTrue(temporary.exists())
            return children.pop(0)
        with patch('validation_service.asyncio.create_subprocess_exec',spawn):
            await validation_session(socket,'cuda')
        self.assertEqual(socket.sent[-1]['type'],'complete')
        self.assertFalse(temporary.exists())
        self.assertFalse(cpu.terminated or gpu.terminated)
if __name__=='__main__':unittest.main(verbosity=2)
