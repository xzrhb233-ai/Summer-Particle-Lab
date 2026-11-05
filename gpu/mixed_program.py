"""Precompiled shared time curves; evaluation stays on the device."""
import math
import numpy as np
import taichi as ti

@ti.data_oriented
class DeviceCurve:
    def __init__(self,definition=None,constant=0.):
        d=definition or dict(type='step',points=[[0,constant],[60,constant]])
        self.kind=['step','linear','smooth','sine'].index(d['type'])
        self.sine=[d.get(k,0.) for k in ['start','end','offset','amplitude','frequency','phase']]
        points=d.get('points',[[0,constant],[60,constant]])
        self.n=len(points);self.points=ti.Vector.field(2,ti.f64,shape=self.n)
        self.points.from_numpy(np.asarray(points,np.float64))

    @ti.func
    def value(self,t):
        result=self.points[0][1]
        if ti.static(self.kind==3):
            a,b,offset,amplitude,frequency,phase=ti.static(self.sine)
            u=ti.min(b,ti.max(a,t))-a
            result=offset+amplitude*ti.sin(2*math.pi*frequency*u+phase*math.pi/180)
        else:
            for k in range(1,self.n):
                a,v=self.points[k-1][0],self.points[k-1][1];b,w=self.points[k][0],self.points[k][1]
                if t>=a:
                    x=ti.min(1.,(t-a)/(b-a));s=ti.cast(0.,ti.f64)
                    if ti.static(self.kind==1):s=x
                    elif ti.static(self.kind==2):s=x*x*(3-2*x)
                    result=v+(w-v)*s
            if t>=self.points[self.n-1][0]:result=self.points[self.n-1][1]
        return result

    @ti.func
    def integral(self,a,b):
        result=ti.cast(0.,ti.f64)
        if ti.static(self.kind==3):
            start,end,offset,amplitude,frequency,phase=ti.static(self.sine)
            lo,hi=ti.max(a,start),ti.min(b,end);w=2*math.pi*frequency;p=phase*math.pi/180
            result=ti.max(0.,ti.min(b,start)-a)*self.value(start)+ti.max(0.,b-ti.max(a,end))*self.value(end)
            if hi>lo:result+=offset*(hi-lo)+amplitude*(ti.cos(w*(lo-start)+p)-ti.cos(w*(hi-start)+p))/w
        else:
            result=ti.max(0.,ti.min(b,self.points[0][0])-a)*self.points[0][1]
            for k in range(1,self.n):
                t,v=self.points[k-1][0],self.points[k-1][1];end,w=self.points[k][0],self.points[k][1]
                lo,hi=ti.max(a,t),ti.min(b,end)
                if hi>lo:
                    d=end-t;u,z=(lo-t)/d,(hi-t)/d;delta=ti.cast(0.,ti.f64)
                    if ti.static(self.kind==1):delta=(z*z-u*u)/2
                    elif ti.static(self.kind==2):delta=z**3-.5*z**4-u**3+.5*u**4
                    result+=v*(hi-lo)+(w-v)*d*delta
            result+=ti.max(0.,b-ti.max(a,self.points[self.n-1][0]))*self.points[self.n-1][1]
        return result

    @ti.func
    def average(self,t,dt):
        value=self.value(t)
        if dt>0:value=self.integral(t,t+dt)/dt
        return value
