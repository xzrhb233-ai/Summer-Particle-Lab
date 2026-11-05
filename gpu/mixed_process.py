"""One CUDA context per loaded model; replacement never accumulates fields.

The process boundary carries initialization and complete output frames only.
An unsuccessful new model leaves the previous worker and its state intact.
"""
import multiprocessing as mp

def solve(pipe,compiled):
    try:
        from runtime import initialize
        from mixed_solver import MixedSolver
        backend=initialize('cuda')
        if compiled.get('four'):
            from mpm_unified_solver import UnifiedMPMSolver
            solver=UnifiedMPMSolver(compiled)
        else:solver=MixedSolver(compiled)
        frame,points=solver.snapshot();frame['backend']=backend;pipe.send((True,frame,points))
        while True:
            request=pipe.recv()
            if request is None:break
            try:
                frame,points=solver.step(request);frame['backend']=backend;pipe.send((True,frame,points))
            except ValueError as error:pipe.send((False,str(error),None))
    except (EOFError,BrokenPipeError):pass
    except Exception as error:
        try:pipe.send((False,str(error),None))
        except (EOFError,BrokenPipeError):pass
    finally:pipe.close()

class MixedProcess:
    def __init__(self,compiled):
        context=mp.get_context('spawn');self.pipe,child=context.Pipe();self.process=context.Process(target=solve,args=(child,compiled),daemon=True);self.process.start();child.close()
    def receive(self):
        if not self.pipe.poll(180):self.close();raise ValueError('混合 GPU 编译或求解响应超时')
        try:ok,value,data=self.pipe.recv()
        except EOFError as error:raise ValueError('混合 GPU 进程已退出') from error
        if not ok:raise ValueError(value)
        return value,data
    def step(self,dt):self.pipe.send(dt);return self.receive()
    def close(self):
        if self.process.is_alive():
            try:self.pipe.send(None)
            except (EOFError,BrokenPipeError,OSError):pass
            self.process.join(2)
            if self.process.is_alive():self.process.terminate();self.process.join(2)
        self.pipe.close()
