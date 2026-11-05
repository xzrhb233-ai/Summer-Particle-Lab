"""Same absolute dyadic time grid as src/simulation/physics-clock.js."""
import math

class PhysicsClock:
    def __init__(self, base_dt):
        self.base_dt=base_dt
        self.steps=0
        self.min_dt=math.inf
        self.max_dt=0.
        self.request_cuts=0
        self.event_cuts=0

    def next(self,time,end,stable,schedule):
        limit=min(stable,schedule['maxDt'],self.base_dt)
        if not math.isfinite(limit) or limit<1e-7:
            raise RuntimeError('稳定时间步过小，求解已停止')
        quantum=self.base_dt
        while quantum>limit*(1+1e-12):
            quantum*=.5
        target=(math.floor(time/quantum+1e-8)+1)*quantum
        cut=None
        event=schedule['nextEvent']
        if time+1e-10<event<target-1e-10:
            target=event
            cut='event'
        if end<target-1e-10:
            target=end
            cut='request'
        if cut=='event':self.event_cuts+=1
        if cut=='request':self.request_cuts+=1
        dt=target-time
        if not dt>0:
            raise RuntimeError('物理时钟未向前推进')
        self.steps+=1
        self.min_dt=min(self.min_dt,dt)
        self.max_dt=max(self.max_dt,dt)
        return dt,target

    def snapshot(self):
        return dict(scheme='dyadic-clock/1',baseDt=self.base_dt,steps=self.steps,
                    minDt=self.min_dt if self.steps else None,
                    maxDt=self.max_dt if self.steps else None,
                    requestCuts=self.request_cuts,eventCuts=self.event_cuts)
