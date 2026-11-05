"""SI heat exchange for unified projects, matching CoupledSimulation.heatStep.

Enthalpy and the heat ledger use f64. Every pair applies the same Q with opposite
signs. A shared capacity budget prevents overshoot from simultaneous contacts.
Rigid bodies have one temperature each; particles have individual temperatures.
"""
import numpy as np
import taichi as ti
from solver import H
from materials import PROPERTIES
from part_thermal_loads import PartThermalLoads

L = .025

@ti.data_oriented
class ProjectThermal:
    def __init__(self, project):
        self.project, self.s = project, project.s
        self.capacity = ti.field(ti.f64, shape=64)
        self.conductivity = ti.field(ti.f64, shape=64)
        self.power = ti.field(ti.f64, shape=64)
        self.energy = ti.field(ti.f64, shape=64)
        self.temperature = ti.field(ti.f64, shape=64)
        self.budget = ti.field(ti.f64, shape=64)
        self.heat = ti.field(ti.f64, shape=64)
        self.interval_heat = ti.field(ti.f64, shape=64)
        self.density_ratio = ti.field(ti.f64, shape=128)
        self.heated_mass = ti.field(ti.f64, shape=())
        # external heat, cumulative absolute internal exchange, total energy
        self.ledger = ti.field(ti.f64, shape=3)
        self.initial_energy = 0.
        self.enabled = False
        self.part_loads=PartThermalLoads(self)

    def initialize(self, model):
        self.bodies = len(model['bodies'])
        self.enabled = model['coupling']['thermal']
        for field in [self.capacity,self.conductivity,self.power,self.energy,self.temperature,self.interval_heat,self.ledger]:
            field.fill(0)
        ratio=np.ones(128,np.float64)
        for k,p in enumerate(model['coupling']['parts'],1):
            ratio[k]=p['density']/PROPERTIES[2 if p['method']=='pbf' else 11,0]
        self.density_ratio.from_numpy(ratio)
        for k,b in enumerate(model['bodies']):
            t=b['thermal'];cap=b['mass']*t['cp']
            self.capacity[k]=cap;self.conductivity[k]=t['conductivity'];self.power[k]=t['power']
            self.energy[k]=cap*t['temperature'];self.temperature[k]=t['temperature']
        self.source_powers=None
        self.refresh(self.s.count)
        self.total(self.s.count,self.bodies)
        self.initial_energy=float(self.ledger[2])

    @ti.func
    def decode(self,i):
        self.s.phase(i)
        # Keep the user density scale across phase changes instead of silently
        # replacing custom MPM / water densities with global material defaults.
        if self.s.material[i] != 3:
            self.s.volume[i]=ti.cast(self.s.mass[i]*1000/(self.density_ratio[self.s.lab.part[i]]*self.s.props[self.s.material[i]][0,0]),ti.f32)

    @ti.func
    def minimum_enthalpy(self,i):
        mat=self.s.material[i]
        if mat==2 or mat==3 or mat==4:mat=4
        return (ti.cast(-27315,ti.f64)/100)*self.s.props[mat][1,0]

    @ti.kernel
    def refresh(self,n:ti.i32):
        for i in range(n):self.decode(i)

    @ti.kernel
    def sources(self,n:ti.i32,bodies:ti.i32,dt:ti.f64,center:ti.types.vector(3,ti.f32),radius:ti.f32,power:ti.f64,begin:ti.i32):
        self.heated_mass[None]=0.
        for b in range(bodies):
            if begin:self.interval_heat[b]=0.
            after=ti.max((ti.cast(-27315,ti.f64)/100)*self.capacity[b],self.energy[b]+self.power[b]*dt)
            self.ledger[0]+=after-self.energy[b]
            self.energy[b]=after;self.temperature[b]=after/self.capacity[b]
        for i in range(n):
            if power!=0 and (self.s.x[i]*L-center).norm_sqr()<=radius*radius:
                self.heated_mass[None]+=ti.cast(self.s.mass[i],ti.f64)
        for i in range(n):
            if power!=0 and (self.s.x[i]*L-center).norm_sqr()<=radius*radius:
                after=ti.max(self.minimum_enthalpy(i),self.s.enthalpy[i]+power*dt/self.heated_mass[None])
                self.ledger[0]+=ti.cast(self.s.mass[i],ti.f64)*(after-self.s.enthalpy[i])
                self.s.enthalpy[i]=after;self.decode(i)

    @ti.func
    def particle_conductance(self,i,j,distance,scale,bulk):
        ki,kj=self.s.props[self.s.material[i]][2,0],self.s.props[self.s.material[j]][2,0]
        area=ti.min((ti.cast(self.s.volume[i],ti.f64)*.001)**(2./3.),(ti.cast(self.s.volume[j],ti.f64)*.001)**(2./3.))
        a,b=self.s.lab.part[i]-1,self.s.lab.part[j]-1
        g=ti.cast(0.,ti.f64)
        if a!=b and (self.project.pairs.material_params[a,b,4]>.5 or self.project.pairs.material_params[a,b,5]>.5):
            li=(ti.cast(self.s.volume[i],ti.f64)*.001)**(1./3.);lj=(ti.cast(self.s.volume[j],ti.f64)*.001)**(1./3.)
            reach=(li+lj)*.55
            if self.project.pairs.material_params[a,b,1]>.5 and self.project.pairs.material_params[a,b,3]>0 and distance*L<reach:
                g=scale*area*ti.max(0.,1-distance*L/reach)/(1/self.project.pairs.material_params[a,b,3]+li*.5/ki+lj*.5/kj)
        elif bulk:g=scale*2*ki*kj/(ki+kj)*area/(distance*L)*(1-distance/H)**2
        return g

    @ti.func
    def body_conductance(self,i,b,scale):
        part=self.s.lab.part[i]-1
        interface=self.project.pairs.params[b,part,3]
        r=self.project.regions
        center,half=r.vector(b,1),r.vector(b,8)
        length=(ti.cast(self.s.volume[i],ti.f64)*.001)**(1./3.)
        radius=length*.5;g=ti.cast(0.,ti.f64)
        point=self.s.x[i]*L
        if self.project.pairs.params[b,part,1]>.5 and interface>0 and (point-center).norm_sqr()<=(half.norm()+radius*1.5)**2:
            distance,normal=self.project.surface(point,ti.cast(r.body[b,0],ti.i32),center,r.quaternion(b),half)
            if distance<=radius*1.5:
                area=length*length*ti.max(0.,ti.min(1.,1-distance/(radius*1.5)))
                g=scale*area/(1/interface+radius/self.s.props[self.s.material[i]][2,0]+half.min()/self.conductivity[b])
        return g

    @ti.kernel
    def budgets(self,n:ti.i32,bodies:ti.i32,dt:ti.f64,scale:ti.f64,bulk:ti.i32):
        for b in range(bodies):
            self.budget[b]=0.;self.heat[b]=0.
        for i in range(n):
            total=ti.cast(0.,ti.f64);cell=self.s.cell(self.s.x[i])
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                    j=self.s.sorted_ids[slot];distance=(self.s.x[i]-self.s.x[j]).norm()
                    if j!=i and distance>1e-6 and distance<H:
                        total+=self.particle_conductance(i,j,distance,scale,bulk)
            for b in range(bodies):
                g=self.body_conductance(i,b,scale);total+=g;self.budget[b]+=g
            self.s.budget[i]=1.
            if total>0:self.s.budget[i]=ti.min(1.,.45*self.s.mass[i]*self.s.props[self.s.material[i]][1,0]/(dt*total))
            self.s.heat[i]=0.
        for b in range(bodies):
            self.budget[b]=ti.min(1.,.45*self.capacity[b]/(dt*self.budget[b])) if self.budget[b]>0 else 1.

    @ti.kernel
    def exchange(self,n:ti.i32,bodies:ti.i32,dt:ti.f64,scale:ti.f64,bulk:ti.i32):
        for i in range(n):
            cell=self.s.cell(self.s.x[i])
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                    j=self.s.sorted_ids[slot];distance=(self.s.x[i]-self.s.x[j]).norm()
                    if j>i and distance>1e-6 and distance<H:
                        g=self.particle_conductance(i,j,distance,scale,bulk)
                        Q=ti.cast(self.s.temp[j]-self.s.temp[i],ti.f64)*g*dt*ti.min(self.s.budget[i],self.s.budget[j])
                        self.s.heat[i]+=Q;self.s.heat[j]-=Q;self.ledger[1]+=ti.abs(Q)
                        a,b=self.s.lab.part[i]-1,self.s.lab.part[j]-1
                        if a!=b and g>0 and self.project.pairs.material_params[a,b,4]>.5:
                            lo,hi=ti.min(a,b),ti.max(a,b);signed=Q if a<b else -Q
                            self.project.pairs.material_stats[lo,hi,13]+=signed
                            self.project.pairs.material_stats[lo,hi,14]+=signed
                            self.project.pairs.material_stats[lo,hi,15]+=1.
            for b in range(bodies):
                g=self.body_conductance(i,b,scale)
                Q=(self.temperature[b]-ti.cast(self.s.temp[i],ti.f64))*g*dt*ti.min(self.s.budget[i],self.budget[b])
                self.s.heat[i]+=Q;self.heat[b]-=Q;self.ledger[1]+=ti.abs(Q)
                if self.project.pairs.enabled[None] and g>0:
                    part=self.s.lab.part[i]-1
                    self.project.pairs.stats[b,part,13]-=Q
                    self.project.pairs.stats[b,part,14]-=Q
                    self.project.pairs.stats[b,part,15]+=1.

    @ti.kernel
    def apply(self,n:ti.i32,bodies:ti.i32):
        for i in range(n):
            self.s.enthalpy[i]+=self.s.heat[i]/ti.cast(self.s.mass[i],ti.f64);self.decode(i)
        for b in range(bodies):
            self.energy[b]+=self.heat[b];self.temperature[b]=self.energy[b]/self.capacity[b]
            self.interval_heat[b]+=self.heat[b]

    @ti.kernel
    def total(self,n:ti.i32,bodies:ti.i32):
        self.ledger[2]=0.
        for i in range(n):self.ledger[2]+=ti.cast(self.s.mass[i],ti.f64)*self.s.enthalpy[i]
        for b in range(bodies):self.ledger[2]+=self.energy[b]

    def step(self,dt,begin,source=None):
        c=self.project.model['coupling'];h=source['heater'] if source else c['heater']
        if source:
            powers=np.zeros(64,np.float64);powers[:self.bodies]=source['powers']
            if self.source_powers is None or not np.array_equal(powers,self.source_powers):
                self.power.from_numpy(powers);self.source_powers=powers
        self.sources(self.s.count,self.bodies,dt,h['center'],h['radius'],h['power'],int(begin))
        if c['thermal'] or self.project.pairs.thermal_active:
            self.s.clear_neighbors();self.s.build_neighbors(self.s.count)
            self.budgets(self.s.count,self.bodies,dt,c['thermalScale'],int(c['thermal']))
            self.exchange(self.s.count,self.bodies,dt,c['thermalScale'],int(c['thermal']))
            self.apply(self.s.count,self.bodies)
        self.part_loads.step(dt,begin)

    def results(self,bodies,duration):
        self.total(self.s.count,self.bodies)
        energies=self.energy.to_numpy();temperatures=self.temperature.to_numpy();heat=self.interval_heat.to_numpy();caps=self.capacity.to_numpy()
        for k,b in enumerate(bodies):
            b.update(temperature=float(temperatures[k]),thermalEnergy=float(energies[k]),heatCapacity=float(caps[k]),contactHeatRate=float(heat[k]/duration) if duration else 0.)
        ledger=self.ledger.to_numpy()
        return dict(thermalEnergy=float(ledger[2]),externalHeat=float(ledger[0]),thermalResidual=float(ledger[2]-self.initial_energy-ledger[0]),exchangedHeat=float(ledger[1]))
