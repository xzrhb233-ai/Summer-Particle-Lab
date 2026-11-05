import math

class RunControl:
    def __init__(self):
        self.paused=False;self.reset()
    def reset(self):
        self.end=None;self.pending=0;self.completed=False
    def pause(self,value,time):
        self.paused=bool(value);self.pending=0
        if not value and self.end is not None and time>=self.end-1e-9:self.reset()
    def start(self,duration,time):
        if not isinstance(duration,(int,float)) or not math.isfinite(duration) or duration<=0 or duration>600:return False
        self.end=time+duration;self.paused=False;self.completed=False;self.pending=0;return True
    def single(self):
        if not self.paused:return False
        self.reset();self.pending=1;return True
    def dt(self,time):
        if self.pending:self.pending-=1;return 1/60
        if self.paused:return 0
        return 1/60 if self.end is None else max(0,min(1/60,self.end-time))
    def advanced(self,time):
        if self.end is not None and time>=self.end-1e-9:self.paused=True;self.completed=True
    def snapshot(self):
        return dict(end=self.end,status='completed' if self.completed else 'paused' if self.paused else 'running')
