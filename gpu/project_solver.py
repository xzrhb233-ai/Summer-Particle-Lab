"""Taichi particles with CPU Rapier, exchanging reactions every physical substep.

Region projects keep grid contact and attachments on GPU, exchanging compact
body impulses/poses and PBF boundary samples. Other projects retain the existing
active-grid contact bridge. Browser messages are batched result frames.
"""
import json
import math
import struct
import subprocess
import time
from pathlib import Path
import numpy as np
import taichi as ti
from solver import Solver, N
from region_constraints import RegionConstraints
from project_thermal import ProjectThermal
from pair_contacts import PairContacts
from material_contact import MaterialContact

ROOT = Path(__file__).resolve().parent.parent
L = .025


class RigidBridge:
    def __init__(self):
        self.bytes_sent = self.bytes_received = self.requests = 0
        self.process = subprocess.Popen(['node', str(ROOT/'gpu/rigid-bridge.mjs')], cwd=ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    def read(self, size):
        chunks = []
        while size:
            chunk = self.process.stdout.read(size)
            if not chunk:
                raise RuntimeError('刚体求解进程已断开')
            chunks.append(chunk); size -= len(chunk)
        return b''.join(chunks)

    def request(self, message, data=None):
        header = json.dumps(message, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
        payload = b'' if data is None else np.ascontiguousarray(data, dtype='<f4').tobytes()
        self.bytes_sent += len(payload); self.requests += 1
        self.process.stdin.write(struct.pack('<II', len(header), len(payload))+header+payload)
        self.process.stdin.flush()
        a, b = struct.unpack('<II', self.read(8))
        if a > 1_000_000 or b > 16_000_000 or b % 4:
            raise RuntimeError('无效刚体进程响应')
        result = json.loads(self.read(a)); values = np.frombuffer(self.read(b), dtype='<f4').copy()
        self.bytes_received += b
        if not result.get('ok'):
            raise ValueError(result.get('message', '刚体求解失败'))
        return result, values

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try: self.process.wait(timeout=3)
            except subprocess.TimeoutExpired: self.process.terminate(); self.process.wait(timeout=3)
        if not self.process.stdin.closed: self.process.stdin.close()
        self.process.stdout.close()


@ti.data_oriented
class ProjectSolver:
    def __init__(self):
        self.s = Solver()
        self.regions = RegionConstraints(self)
        self.pairs = PairContacts(self)
        self.multi = MaterialContact(self)
        self.thermal = ProjectThermal(self)
        self.native = False
        self.last_duration = 0.
        self.ids = ti.Vector.field(3, ti.i32, shape=N**3)
        self.active_count = ti.field(ti.i32, shape=())
        self.penetration = ti.field(ti.f32, shape=())
        self.bridge = RigidBridge()
        self.model = None; self.time = 0.; self.speed = 1.; self.initial_thermal = 0.
        self.last_ms = 0.; self.total_ms = 0.; self.substeps = 0

    @ti.kernel
    def seed(self, rows: ti.types.ndarray(dtype=ti.f32, ndim=2)):
        for i in range(rows.shape[0]):
            self.s.mass[i] = rows[i,8]; self.s.volume[i] = rows[i,9]
            self.s.inv_mass[i] = (1-self.s.pinned[i])/rows[i,8]
            self.s.lab.part[i] = ti.cast(rows[i,10], ti.i32)
            self.s.melted[i] = ti.cast(rows[i,17], ti.i32)
            self.s.fluid_transition[i] = ti.cast(rows[i,18], ti.i32)

    def initialize(self, project):
        # The existing CPU constructor validates all geometry, overlaps, joints,
        # fixed faces and capacity before the active GPU fields are changed.
        result, values = self.bridge.request(dict(type='init', project=project))
        model, domain = result['model'], result['domain']; seed = values.reshape(-1,result['seedWidth'])
        self.s.reset('empty'); self.s.configure_domain(domain)
        rows = np.zeros((len(seed),9),np.float32); rows[:,:3] = seed[:,:3]
        rows[:,3] = seed[:,12]; rows[:,4:] = seed[:,[3,4,5,6,7]]
        self.s.insert(0,rows); self.s.count = len(rows); self.seed(seed)
        from metal_plasticity import parameters as metal
        from pressure_plasticity import parameters as pressure
        from thermal_plasticity import parameters as thermal
        from phase_change import parameters as phase
        for k,p in enumerate(model['coupling']['parts'],1):
            self.s.plasticity[k]=metal(p['plasticity']); self.s.pressure_materials[k]=pressure(p['pressure'])
            self.s.thermal_materials[k]=thermal(p['thermalMaterial'])
            self.s.phase_materials[k]=phase(p['phaseChange'])
            f=p['fracture'];self.s.fracture_materials[k]=[int(f['enabled']),f['onset'],f['failure']]
            # Initial velocities use the same native part edit as particle mode.
            self.s.lab.edit(self.s.count,k,0,[v/L for v in p['velocity']],[0,0,0],[0,0,0])
        self.model = model; self.time = self.s.time = 0.; self.speed = 1.
        from physics_clock import PhysicsClock
        self.clock=PhysicsClock(min(model['dt'],1/480))
        self.schedule=result['schedule']
        self.pairs.initialize(model,result['contactProfiles'])
        self.multi.initialize(model)
        self.part_thermal_active=any(d['definition']['enabled'] for d in result.get('partThermalLoads',[]))
        self.thermal_active = bool(self.part_thermal_active or self.pairs.thermal_active or model['coupling']['thermal'] or model['coupling']['heater']['power'] or any(b['thermal']['power'] for b in model['bodies']) or any(b['enabled'] and b['kind'].endswith('heat') for b in model['loadBindings']))
        self.phase_capable = any(p['phaseChange']['enabled'] or p['method']=='pbf' for p in model['coupling']['parts'])
        self.native = len(model['coupling']['parts'])>1 or bool(model['contactPairs']) or bool(result['attachments']) or self.thermal_active or any(p['phaseChange']['enabled'] for p in model['coupling']['parts'])
        self.last_duration = 0.
        self.regions.initialize(result, seed)
        self.thermal.initialize(model)
        self.thermal.part_loads.initialize(result.get('partThermalLoads',[]))
        self.regions.update_phases(self.s.count,self.regions.count)
        self.regions.fluid_count=int(self.regions.fluid_size[None])
        self.has_fluid=self.regions.fluid_count>0
        # Freshly seeded PBF water uses its rest density immediately. Only an
        # actual solid-to-liquid phase change requires a melt handoff.
        self.last_ms = self.total_ms = 0.; self.substeps = 0; self.penetration[None] = 0
        self.initial_thermal = float(np.sum(seed[:,8].astype(float)*seed[:,4])) + sum(b['mass']*b['thermal']['cp']*b['thermal']['temperature'] for b in model['bodies'])
        self.bridge.bytes_sent = self.bridge.bytes_received = self.bridge.requests = 0
        return self.snapshot()

    def command(self, command):
        if not self.model:raise ValueError('请先载入项目')
        result,poses=self.bridge.request(dict(type='thermal-command',command=command))
        self.model['coupling']['heater']=result['heater']
        self.model['loadBindings']=result['loadBindings'];self.schedule=result['schedule'];self.thermal.source_powers=None
        for k,power in enumerate(result['powers']):
            self.model['bodies'][k]['thermal']['power']=power;self.thermal.power[k]=power
        self.regions.load_bodies(poses)
        self.native=True
        self.thermal_active=bool(self.part_thermal_active or self.pairs.thermal_active or self.model['coupling']['thermal'] or result['heater']['power'] or any(result['powers']) or any(b['enabled'] and b['kind'].endswith('heat') for b in self.model['loadBindings']))
        return self.snapshot()

    @ti.kernel
    def gravity(self, n:ti.i32, dt:ti.f32, g:ti.types.vector(3,ti.f32)):
        for i in range(n):
            self.s.old[i]=self.s.x[i]
            if not self.s.pinned[i]: self.s.v[i] += dt*g/L
            if not self.s.is_solid(i):self.s.x[i]+=dt*self.s.v[i]

    @ti.kernel
    def export_particles(self,n:ti.i32,out:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for i in range(n):
            for a in ti.static(range(3)):out[i*6+a]=self.s.x[i][a];out[i*6+3+a]=self.s.v[i][a]

    @ti.kernel
    def import_fluids(self,n:ti.i32,data:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for i in range(n):
            if not self.s.is_solid(i):
                self.s.x[i]=ti.Vector([data[i*6+a] for a in ti.static(range(3))])
                self.s.v[i]=ti.Vector([data[i*6+3+a] for a in ti.static(range(3))])

    @ti.kernel
    def fluid_velocity(self,n:ti.i32,dt:ti.f32,before:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for i in range(n):
            if self.s.is_solid(i):
                # PBF adds pressure impulses to MPM, preserving its APIC velocity.
                previous=ti.Vector([before[i*6+a] for a in ti.static(range(3))])
                self.s.v[i]+=(self.s.x[i]-previous)/dt
            else:self.s.v[i]=(self.s.x[i]-self.s.old[i])/dt

    @ti.kernel
    def stabilize_pressure(self,n:ti.i32,dt:ti.f32):
        full=1/self.s.max_delta[None];safe=full
        if self.s.projection_energy[1]>1e-20:
            safe=ti.min(full,ti.cast(ti.max(0.,-self.s.projection_energy[0]/self.s.projection_energy[1]),ti.f32))
        for i in range(n):
            shift=self.s.delta[i]*(full-safe)
            self.s.old[i]+=shift
            # MPM receives PBF's increment relative to its post-G2P position,
            # rather than old, so remove this non-kinetic component explicitly.
            if self.s.is_solid(i):self.s.v[i]-=shift/dt

    @ti.kernel
    def collect_grid(self):
        self.active_count[None] = 0
        for I in ti.grouped(self.s.gmass):
            if self.s.gmass[I] > 1e-12:
                k = ti.atomic_add(self.active_count[None],1); self.ids[k] = I

    @ti.kernel
    def export_contact(self, n:ti.i32, nodes:ti.i32, out:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for i in range(n):
            for a in ti.static(range(3)): out[i*3+a] = self.s.x[i][a]
        for k in range(nodes):
            I=self.ids[k]; offset=n*3+k*6
            out[offset]=(I[2]*N+I[1])*N+I[0]; out[offset+1]=self.s.gmass[I]
            for a in ti.static(range(3)): out[offset+2+a]=self.s.gv[I][a]
            out[offset+5]=self.s.fixed[I]

    @ti.kernel
    def import_grid(self, nodes:ti.i32, values:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for k in range(nodes):
            self.s.gv[self.ids[k]]=ti.Vector([values[k*3+a] for a in ti.static(range(3))])

    @ti.func
    def rotate(self, q, p):
        xyz=ti.Vector([q[0],q[1],q[2]])
        return p+2*xyz.cross(xyz.cross(p)+q[3]*p)

    @ti.func
    def surface(self, point, shape, center, q, half):
        p=self.rotate(ti.Vector([-q[0],-q[1],-q[2],q[3]]),point-center)
        normal=ti.Vector([1.,0.,0.]); distance=0.
        if shape==4:
            radial=ti.sqrt(p[0]**2+p[1]**2);delta=radial-(half[0]-half[2]);length=ti.sqrt(delta**2+p[2]**2)
            distance=length-half[2];normal=ti.Vector([0.,0.,1.])
            if length>1e-12:
                direction=ti.Vector([1.,0.,0.])
                if radial>1e-12:direction=ti.Vector([p[0]/radial,p[1]/radial,0.])
                normal=ti.Vector([direction[0]*delta/length,direction[1]*delta/length,p[2]/length])
        elif shape==1:
            length=p.norm(); distance=length-half[0]
            if length>1e-12: normal=p/length
        elif shape==0:
            z=ti.abs(p)-half; outside=ti.max(z,0.); length=outside.norm()
            distance=length+ti.min(0.,z.max())
            if length>1e-12:
                for a in ti.static(range(3)): normal[a]=outside[a]/length*(-1 if p[a]<0 else 1)
            else:
                axis=0
                if z[1]>z[axis]:axis=1
                if z[2]>z[axis]:axis=2
                normal=ti.Vector.zero(ti.f32,3); normal[axis]=-1 if p[axis]<0 else 1
        else:
            if shape==3:
                p=ti.Vector([p[0],p[2],p[1]]);half=ti.Vector([half[0],half[2],half[1]])
            length=ti.sqrt(p[0]**2+p[2]**2); dr=length-half[0]; dy=ti.abs(p[1])-half[1]
            radial=ti.Vector([1.,0.,0.]);cap=ti.Vector([0.,-1. if p[1]<0 else 1.,0.])
            if length>1e-12:radial=ti.Vector([p[0],0.,p[2]])/length
            distance=ti.sqrt(ti.max(0.,dr)**2+ti.max(0.,dy)**2)+ti.min(0.,ti.max(dr,dy))
            normal=cap
            if dr>dy:normal=radial
            if dr>0 and dy>0:normal=(radial*dr+cap*dy)/ti.sqrt(dr*dr+dy*dy)
            if shape==3:normal=ti.Vector([normal[0],normal[2],normal[1]])
        return distance,self.rotate(q,normal)

    @ti.kernel
    def cleanup(self,n:ti.i32,offset:ti.i32,bodies:ti.i32,radius:ti.f32,mechanical:ti.i32,poses:ti.types.ndarray(dtype=ti.f32,ndim=1)):
        for i in range(n):
            if self.s.pinned[i]: self.s.x[i]=self.s.anchor[i]; self.s.v[i]=ti.Vector.zero(ti.f32,3)
            elif mechanical:
                for b in range(bodies):
                    k=offset+b*11;shape=ti.cast(poses[k],ti.i32)
                    center=ti.Vector([poses[k+1+a] for a in ti.static(range(3))]);q=ti.Vector([poses[k+4+a] for a in ti.static(range(4))]);half=ti.Vector([poses[k+8+a] for a in ti.static(range(3))])
                    point=self.s.x[i]*L
                    # A bounding sphere is conservative for every supported shape.
                    if (point-center).norm_sqr()<=(half.norm()+radius)**2:
                        distance,normal=self.surface(point,shape,center,q,half)
                        depth=ti.max(0.,radius-distance);ti.atomic_max(self.penetration[None],depth)
                        self.s.x[i]+=normal*ti.min(depth,self.s.mpm_h[None]*L*.25)/L

    @ti.kernel
    def export_state(self,n:ti.i32,out:ti.types.ndarray(dtype=ti.f32,ndim=2)):
        for i in range(n):
            for a in ti.static(range(3)):out[i,a]=self.s.x[i][a]*L;out[i,9+a]=self.s.v[i][a]*L
            code=self.s.material[i]
            if code==11:
                code=11+self.s.model[i]
                if self.s.fracture_materials[self.s.lab.part[i]][0]>.5:code=24
                if self.s.damage[i]>=1:code=25
                if self.s.melted[i]:code=23
            out[i,3]=code;out[i,4]=self.s.temp[i];out[i,5]=self.s.pinned[i]
            out[i,6]=self.s.stress[i];out[i,7]=self.s.plastic[i];out[i,8]=self.s.mass[i]
            out[i,12]=self.s.lab.part[i];out[i,13]=ti.cast(self.s.enthalpy[i],ti.f32)
            out[i,14]=self.s.damage[i]

    def native_substep(self, h, begin, duration, transitioning):
        s, r, c = self.s, self.regions, self.model['coupling']
        bodies = len(self.model['bodies'])
        r.begin(int(begin))
        if self.multi.parts>1:self.multi.contact(self.multi.parts,h)
        if self.pairs.definitions or self.multi.parts>1:
            self.pairs.prepare(s.count,bodies,s.domain['spacing']*L*.6)
            self.pairs.contact(bodies)
        elif c['mechanical']:
            r.mark_contacts(s.count, bodies, s.domain['spacing']*L*.6)
            r.contact(bodies, c['friction'])
        r.prepare(r.count, len(r.definitions))
        r.solve(r.count, self.model['iterations'], h, s.domain['spacing']*L)
        if r.conflict[None]:
            raise RuntimeError('区域连接与固定网格支撑重叠，GPU 求解已停止')
        if self.pairs.definitions or self.multi.parts>1:self.pairs.g2p(s.count,h)
        else:s.g2p(s.count, h)
        s.apply_corrections(s.count, 0, 0, 0., 0)
        if self.has_fluid:
            r.save_fluid_start(s.count)
            s.clear_neighbors();s.build_neighbors(s.count)
            for _ in range(3):
                s.density(s.count);s.corrections(s.count,1,h,3,1)
                if not transitioning:self.stabilize_pressure(s.count,h)
                s.apply_corrections(s.count,1,0,0.,int(transitioning))
            if transitioning:s.finish_fluid_transition(s.count,h,3)
            r.fluid_velocity(s.count,h);s.viscosity(s.count);s.contacts(s.count,1,0,0.,0.)
        values = np.empty(bodies*12+r.fluid_count*8, np.float32)
        r.export_advance(bodies, r.fluid_count, values)
        state, updated = self.bridge.request(dict(type='native-advance', dt=h, endTime=self.tick_end, begin=begin, duration=duration, fluids=r.fluid_count), values)
        r.import_advance(bodies, r.fluid_count, updated)
        s.regularize_solids(h)
        r.cleanup(s.count, bodies, s.domain['spacing']*L*.4, int(c['mechanical']))
        if self.thermal_active:
            self.thermal.step(h,begin,state['thermal'])
            if self.phase_capable:
                r.update_phases(s.count,r.count)
                r.fluid_count=int(r.fluid_size[None])
                self.has_fluid=r.fluid_count>0
        return state

    def step(self, duration):
        if not self.model: raise ValueError('请先载入项目')
        if not isinstance(duration,(int,float)) or not math.isfinite(duration) or not 0<duration<=1/30:raise ValueError('GPU 请求步长需在 0–1/30 s 内')
        start=time.perf_counter(); end=self.time+duration; total_steps=0;self.penetration[None]=0
        c=self.model['coupling'];s=self.s
        self.last_duration=duration
        if self.pairs.definitions or self.multi.parts>1:self.pairs.begin()
        self.thermal.interval_heat.fill(0)
        # Adaptive dyadic steps share an absolute grid with CPU. An aligned
        # output request never clips the CFL step into a different trajectory.
        while end-self.time>1e-10:
            if total_steps>=512:raise RuntimeError('GPU 耦合子步过多，已停止')
            s.prepare(s.count,c['stiffness'])
            transitioning=self.has_fluid and bool(s.limits[4])
            if transitioning:s.clear_neighbors();s.build_neighbors(s.count);s.fluid_baselines(s.count)
            stable=min(self.model['dt'],1/480,float(s.limits[0]),s.domain['spacing']*L*.2/self.speed)
            if stable<1e-7:raise RuntimeError('GPU 耦合稳定步长过小，已停止')
            h,self.tick_end=self.clock.next(self.time,end,stable,self.schedule)
            self.gravity(s.count,h,self.model['gravity']);s.clear_grid()
            if self.multi.parts>1:self.multi.transfer(s.count,h)
            else:s.p2g(s.count,h);s.grid_step(0,0.,0.)
            if self.native:
                state=self.native_substep(h,total_steps==0,duration,transitioning)
                self.schedule=state['schedule'];self.time=s.time=state['time'];self.speed=state['speed'];total_steps+=1
                continue
            self.collect_grid();nodes=int(self.active_count[None]);data=np.empty(s.count*3+nodes*6,np.float32)
            self.export_contact(s.count,nodes,data)
            # Report force as impulse / result interval, not impulse / a tiny
            # final remainder step. The reaction itself is applied immediately.
            state,updated=self.bridge.request(dict(type='step',nodes=nodes,dt=h,endTime=self.tick_end,begin=total_steps==0,duration=duration,defer=self.has_fluid),data)
            self.import_grid(nodes,updated);s.g2p(s.count,h)
            s.apply_corrections(s.count,0,0,0.,0)
            offset=nodes*3
            if self.has_fluid:
                before=np.empty(s.count*6,np.float32);self.export_particles(s.count,before)
                s.clear_neighbors();s.build_neighbors(s.count)
                for _ in range(3):
                    # Moving rigid boundaries may abruptly compress liquid too.
                    # Apply the shared energy-decreasing pressure line search
                    # even when no solid-to-liquid handoff is in progress.
                    s.density(s.count);s.corrections(s.count,1,h,3,1)
                    if not transitioning:self.stabilize_pressure(s.count,h)
                    s.apply_corrections(s.count,1,0,0.,int(transitioning))
                if transitioning:s.finish_fluid_transition(s.count,h,3)
                self.fluid_velocity(s.count,h,before);s.viscosity(s.count);s.contacts(s.count,1,0,0.,0.)
                self.export_particles(s.count,before)
                state,updated=self.bridge.request(dict(type='advance',dt=h,endTime=self.tick_end),before)
                self.import_fluids(s.count,updated);offset=s.count*6
            s.regularize_solids(h)
            self.cleanup(s.count,offset,len(self.model['bodies']),s.domain['spacing']*L*.4,int(c['mechanical']),updated)
            self.schedule=state['schedule'];self.time=s.time=state['time'];self.speed=state['speed'];total_steps+=1
        s.prepare(s.count,c['stiffness']);self.substeps=total_steps
        self.last_ms=(time.perf_counter()-start)*1000;self.total_ms+=self.last_ms
        return self.snapshot()

    def snapshot(self):
        state,_=self.bridge.request(dict(type='snapshot'));frame=state['frame']
        data=np.empty((self.s.count,15),np.float32);self.export_state(self.s.count,data)
        if not np.isfinite(data).all() or np.any(np.abs(data[:,:3])>1e6):raise RuntimeError('GPU 状态出现非有限数值，已停止')
        heat=self.thermal.results(frame['bodies'],self.last_duration)
        frame['thermalLoads']=self.thermal.part_loads.results(self.last_duration)
        masses=data[:,8].astype(float);mass=float(masses.sum())
        if self.native:
            frame['joints'].extend(self.regions.results(data, frame['bodies'], self.last_duration))
            frame['maxError']=max([frame['maxError']]+[j['error'] for j in frame['joints']])
        frame['particleRadius']=self.s.domain['spacing']*L*.35
        liquids=int(np.count_nonzero((data[:,3]==2)|(data[:,3]==23)));gases=int(np.count_nonzero(data[:,3]==3))
        frame['particleColorMode']='temperature' if self.thermal_active else 'material' if self.has_fluid or any(p['fracture']['enabled'] for p in self.model['coupling']['parts']) else 'temperature'
        frame['coupling']=dict(count=len(data),solids=len(data)-liquids-gases,liquids=liquids,gases=gases,damaged=int(np.count_nonzero(data[:,14]>=1)),mass=mass,meanTemperature=float(np.sum(masses*data[:,4])/mass),minTemperature=float(data[:,4].min()),maxTemperature=float(data[:,4].max()),maxStress=float(data[:,6].max()),maxPlastic=float(data[:,7].max()),maxPenetration=float(self.penetration[None]),**heat)
        for load in frame.get('loadResponses',[]):
            if load['kind']=='region-heat':load['response']=frame['coupling']['meanTemperature']
            if load['kind']=='body-heat':load['response']=next(b['temperature'] for b in frame['bodies'] if b['id']==load['target'])
        frame['contactPairs']=self.pairs.results(state.get('pairContactStats',[]),self.last_duration)
        frame['clock']=self.clock.snapshot()
        work=self.multi.work.to_numpy()
        frame['materialContactWork']=dict(normal=float(work[0]),friction=float(work[1]),positive=float(work[2]))
        parts=[dict(id=b['id'],method='rigid',values={k:b[k] for k in ['position','displacement','velocity','temperature','contactForce','kinetic']}) for b in frame['bodies']]
        for k,p in enumerate(self.model['coupling']['parts'],1):
            a=data[data[:,12]==k];m=a[:,8].astype(float);total=float(m.sum());center=np.sum(a[:,:3]*m[:,None],axis=0)/total
            parts.append(dict(id=p['id'],method=p['method'],values=dict(count=len(a),mass=total,temperature=float(np.sum(a[:,4]*m)/total),position=center.tolist(),displacement=(center-np.array(p['center'])).tolist(),velocity=(np.sum(a[:,9:12]*m[:,None],axis=0)/total).tolist(),plastic=float(a[:,7].max()),damage=float(a[:,14].max()),failed=int(np.count_nonzero(a[:,14]>=1)))))
        frame['results']=dict(schema='summer-results/1',time=frame['time'],units=dict(position='m',velocity='m/s',temperature='degC',contactForce='N',kinetic='J'),contactPairs=frame['contactPairs'],loads=frame.get('loadResponses',[]),parts=parts,connections=frame['joints'],balance=dict(thermalResidual=heat['thermalResidual'],externalHeat=heat['externalHeat']))
        frame['performance']=dict(stepMs=self.last_ms,totalMs=self.total_ms,substeps=self.substeps,rate=self.time/(self.total_ms/1000) if self.total_ms else 0,
            couplingPath='gpu-regions' if self.native else 'cpu-contact',ipcPayloadBytes=self.bridge.bytes_sent+self.bridge.bytes_received,ipcRequests=self.bridge.requests)
        return frame,np.ascontiguousarray(data[:,:8])

    def close(self):self.bridge.close()
