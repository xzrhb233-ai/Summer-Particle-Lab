"""Resident thermal boundaries for the shared MPM / FEM material selections.

Only initialization and result frames transfer data. Overlapping boundaries
are applied in CPU-contract order: power, convection, then thermostats.
"""
import numpy as np
import taichi as ti
from mixed_program import DeviceCurve

@ti.data_oriented
class MixedThermalLoads:
    def __init__(self,solver,descriptors):
        self.s=solver;self.loads=[];self.curves=[];rows=[]
        for item in descriptors:
            start=len(rows);domain={'mpm':0,'fem':1,'rigid':2}[item['domain']]
            entries=item['entries']
            rows.extend([[e['index'],e['weight'],e['area']] for e in entries])
            self.loads.append(dict(definition=item['definition'],domain=domain,start=start,end=len(rows),weight=sum(e['weight'] for e in entries)))
            d=item['definition'];self.curves.append(DeviceCurve(d.get('program'),d.get('power',0.) if d['type']=='thermal-power' else d['temperature']))
        if len(self.loads)>32 or len(rows)>32*max(solver.n,solver.nn):raise ValueError('热载荷选择超过 GPU 容量')
        self.rows=ti.Vector.field(3,ti.f64,shape=max(1,len(rows)))
        self.rows.from_numpy(np.asarray(rows or [[0,0,0]],dtype=np.float64))
        self.heat=ti.field(ti.f64,shape=max(1,len(self.loads)))
        self.requested=ti.field(ti.f64,shape=max(1,len(self.loads)))
        self.back_heat=ti.field(ti.f64,shape=max(1,len(self.loads)))
        self.back_requested=ti.field(ti.f64,shape=max(1,len(self.loads)))
        self.previous=np.zeros(max(1,len(self.loads)))

    @ti.kernel
    def apply(self,slot:ti.i32,domain:ti.i32,start:ti.i32,end:ti.i32,mode:ti.i32,curve:ti.template(),coefficient:ti.f64,total:ti.f64,dt:ti.f64):
        command=curve.average(self.s.device_time[None],dt)
        if mode==2:command=curve.value(self.s.device_time[None]+dt)
        for row in range(start,end):
            index=ti.cast(self.rows[row][0],ti.i32);weight=self.rows[row][1];area=self.rows[row][2]
            cap=ti.cast(0.,ti.f64);energy=ti.cast(0.,ti.f64)
            if domain==0:
                mass=ti.cast(self.s.s.mass[index],ti.f64);cap=self.s.particle_cp*mass;energy=mass*self.s.s.enthalpy[index]
                if ti.static(hasattr(self.s,'particle_cps')):cap=self.s.particle_cps[index]*mass
            elif domain==1:cap=self.s.capacity[index];energy=cap*self.s.temperature[index]
            else:
                if ti.static(hasattr(self.s,'rigid_temperature')):cap=self.s.rigid_capacity;energy=cap*self.s.rigid_temperature[0]
            q=command*dt*weight/total
            if mode==1:
                x=coefficient*area*dt/cap
                # Stable 1-exp(-x) for small heat-transfer coefficients.
                fraction=1-ti.exp(-x)
                if x<1e-4:fraction=x*(1-x/2+x*x/6-x*x*x/24)
                q=(command-energy/cap)*cap*fraction
            if mode==2:q=cap*command-energy
            after=ti.max(-273.15*cap,energy+q);actual=ti.cast(0.,ti.f64)
            if domain==0:
                mass=ti.cast(self.s.s.mass[index],ti.f64);next_h=after/mass
                actual=mass*(next_h-self.s.s.enthalpy[index])
                self.s.s.enthalpy[index]=next_h
                self.s.s.temp[index]=ti.cast(self.s.s.enthalpy[index]/self.s.particle_cp,ti.f32)
                if ti.static(hasattr(self.s,'particle_cps')):self.s.s.temp[index]=ti.cast(next_h/self.s.particle_cps[index],ti.f32)
            elif domain==1:
                next_t=after/cap;actual=cap*(next_t-self.s.temperature[index]);self.s.temperature[index]=next_t
            else:
                if ti.static(hasattr(self.s,'rigid_temperature')):
                    next_t=after/cap;actual=cap*(next_t-self.s.rigid_temperature[0]);self.s.rigid_temperature[0]=next_t
            # Account for the energy represented by the stored H/T after the
            # division, including roundoff, not the unrounded intermediate.
            self.requested[slot]+=q;self.heat[slot]+=actual

    def step(self,dt):
        if not self.s.project['solver']['thermal']:return
        for mode,kind in enumerate(['thermal-power','thermal-convection','thermal-temperature']):
            for slot,item in enumerate(self.loads):
                d=item['definition']
                if d['enabled'] and d['type']==kind:
                    self.apply(slot,item['domain'],item['start'],item['end'],mode,self.curves[slot],d.get('coefficient',0.),item['weight'],dt)

    def checkpoint(self,restore=False):
        for a,b in [(self.heat,self.back_heat),(self.requested,self.back_requested)]:a.copy_from(b) if restore else b.copy_from(a)

    def results(self,duration):
        heat=self.heat.to_numpy();requested=self.requested.to_numpy();delta=heat-self.previous;self.previous=heat.copy()
        return [dict(id=item['definition']['id'],target=item['definition']['target'],type=item['definition']['type'],enabled=item['definition']['enabled'],heat=float(heat[k]),requestedHeat=float(requested[k]),intervalHeat=float(delta[k]),heatRate=float(delta[k]/duration) if duration else 0.) for k,item in enumerate(self.loads)]
