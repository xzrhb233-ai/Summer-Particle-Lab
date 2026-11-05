"""Common part thermal boundaries, with material selections compiled in JS.

Energy updates run on Taichi, preserving particle enthalpy and phase state.
No readback of the particle field is required to apply a boundary.
"""
import numpy as np
import taichi as ti

@ti.data_oriented
class PartThermalLoads:
    def __init__(self, thermal):
        self.thermal, self.s = thermal, thermal.s
        self.rows = ti.Vector.field(3, ti.f64, shape=32*16384)
        self.heat = ti.field(ti.f64, shape=32)
        self.interval = ti.field(ti.f64, shape=32)
        self.requested = ti.field(ti.f64, shape=32)
        self.loads = []

    def initialize(self, descriptors):
        self.loads=[];flat=[]
        self.heat.fill(0);self.interval.fill(0);self.requested.fill(0)
        for item in descriptors:
            d=item['definition'];start=len(flat)
            for e in item['entries']:flat.append([e['index'],e['weight'],e['area']])
            self.loads.append(dict(definition=d,start=start,end=len(flat),weight=sum(e['weight'] for e in item['entries'])))
        if len(flat)>32*16384:raise ValueError('热载荷选择点数超过 GPU 容量')
        data=np.zeros((32*16384,3),np.float64)
        if flat:data[:len(flat)]=flat
        self.rows.from_numpy(data)

    @ti.func
    def target(self, i, T):
        h=self.s.enthalpy[i];mat=self.s.material[i]
        if ti.abs(T-ti.cast(self.s.temp[i],ti.f64))>1e-10:
            cp=ti.cast(self.s.props[mat][1,0],ti.f64);h=cp*T
            if mat==11:
                p=self.s.phase_materials[self.s.lab.part[i]]
                if p[0]>.5 and T>p[1]:h+=p[2]
            elif mat==2 or mat==3 or mat==4:
                h=2100*T
                if T>0:h=334000+4180*T
                if T>100:h=334000+418000+2256000+2010*(T-100)
        return h

    @ti.kernel
    def apply(self, slot:ti.i32,start:ti.i32,end:ti.i32,mode:ti.i32,power:ti.f64,T:ti.f64,coefficient:ti.f64,total:ti.f64,dt:ti.f64):
        for row in range(start,end):
            index=ti.cast(self.rows[row][0],ti.i32)
            weight,area=self.rows[row][1],self.rows[row][2]
            energy,cap,current,target,minimum=ti.cast(0.,ti.f64),ti.cast(0.,ti.f64),ti.cast(0.,ti.f64),ti.cast(0.,ti.f64),ti.cast(0.,ti.f64)
            if index>=0:
                m=ti.cast(self.s.mass[index],ti.f64)
                energy=m*self.s.enthalpy[index];cap=m*self.s.props[self.s.material[index]][1,0];current=ti.cast(self.s.temp[index],ti.f64)
                target=m*self.target(index,T);minimum=m*self.thermal.minimum_enthalpy(index)
            else:
                b=-index-1;energy=self.thermal.energy[b];cap=self.thermal.capacity[b];current=self.thermal.temperature[b];target=cap*T;minimum=-273.15*cap
            q=power*dt*weight/total
            if mode==1:q=(T-current)*cap*(1-ti.exp(-coefficient*area*dt/cap))
            if mode==2:q=target-energy
            after=ti.max(minimum,energy+q);actual=after-energy
            self.requested[slot]+=q;self.heat[slot]+=actual;self.interval[slot]+=actual;self.thermal.ledger[0]+=actual
            if index>=0:
                self.s.enthalpy[index]=after/ti.cast(self.s.mass[index],ti.f64);self.thermal.decode(index)
            else:
                b=-index-1;self.thermal.energy[b]=after;self.thermal.temperature[b]=after/cap

    def step(self,dt,begin=False):
        if begin:self.interval.fill(0)
        for mode,kind in enumerate(['thermal-power','thermal-convection','thermal-temperature']):
            for slot,item in enumerate(self.loads):
                d=item['definition']
                if d['enabled'] and d['type']==kind:
                    self.apply(slot,item['start'],item['end'],mode,d.get('power',0.),d.get('temperature',20.),d.get('coefficient',0.),item['weight'],dt)

    def results(self,dt):
        heat=self.heat.to_numpy();interval=self.interval.to_numpy();requested=self.requested.to_numpy()
        return [dict(id=item['definition']['id'],target=item['definition']['target'],type=item['definition']['type'],enabled=item['definition']['enabled'],heat=float(heat[k]),intervalHeat=float(interval[k]),heatRate=float(interval[k]/dt) if dt else 0.,requestedHeat=float(requested[k])) for k,item in enumerate(self.loads)]
