"""3D MLS-MPM solids, PBF liquids and conservative heat on Taichi GPU fields."""
import math
import time
import numpy as np
import taichi as ti
from materials import PROPERTIES, TEMPERATURES, enthalpy_at
from gravity import Gravity
from laboratory import Laboratory, MAX_PARTS
from metal_plasticity import DEFAULTS, MODEL_COUNT, parameters, metal_return
from sampling import sampling_options,jitter_points
from thermal_plasticity import DEFAULTS as THERMAL_DEFAULTS, parameters as thermal_parameters, thermal_return
from pressure_plasticity import DEFAULTS as PRESSURE_DEFAULTS, parameters as pressure_parameters, pressure_return
from phase_change import parameters as phase_parameters
from discretization import DEFAULT_DOMAIN,domain_parameters,geometry_parameters,geometry_points,vector

CAPACITY = 1_000_000
PREVIEW_LIMIT = 100_000
N, H, O = 67, 8.0, -264.0
MELT_RELAX_SPEED, MELT_SETTLE_TIME, MELT_HANDOFF_SPEED = 8.0, .1, .25
V3 = ti.types.vector(3, ti.f32)
GRAVITY_DEFAULTS = dict(gravityMode="scene",gravityStrength=1.0,gravityDirection="down",gravityCenter=[0,0,0],gravitySoftening=8.0)
DIRECTIONS = dict(down=[0,-1,0],up=[0,1,0],left=[-1,0,0],right=[1,0,0],front=[0,0,1],back=[0,0,-1])


@ti.data_oriented
class Solver:
    def __init__(self, capacity=CAPACITY, neighbor_domain=None):
        if not isinstance(capacity, int) or not 1 <= capacity <= CAPACITY:
            raise ValueError('Invalid particle allocation capacity')
        self.capacity = capacity
        # Project solvers have an immutable domain. Keep the legacy allocation
        # for the interactive solver, whose domain can change without recreation.
        self.neighbor_domain = domain_parameters(neighbor_domain) if neighbor_domain is not None else None
        h = max(H, max(self.neighbor_domain['size'])/60) if self.neighbor_domain else H
        self.neighbor_shape = tuple(min(N, math.ceil(s/h)+5) for s in self.neighbor_domain['size']) if self.neighbor_domain else (N,N,N)
        self.neighbor_cells = math.prod(self.neighbor_shape)
        self.count = 0
        # Optional two-group filter owned by the four-method adapter. A zero
        # split preserves legacy single-domain behaviour.
        self.pressure_split=ti.field(ti.i32,shape=())
        self.pressure_cross=ti.field(ti.i32,shape=())
        self.pressure_cross[None]=1
        self.gravity = Gravity(capacity)
        self.gravity_params=ti.field(ti.f32,shape=2)
        self.gravity_params.from_numpy(np.array([1,8],np.float32))
        self.gravity_direction=ti.Vector.field(3,ti.f32,shape=())
        self.gravity_direction[None]=[0,-1,0]
        self.gravity_center=ti.Vector.field(3,ti.f32,shape=())
        self.bounds_lo = ti.Vector.field(3, ti.f32, shape=())
        self.bounds_hi = ti.Vector.field(3, ti.f32, shape=())
        self.neighbor_h=ti.field(ti.f32,shape=())
        self.neighbor_origin=ti.Vector.field(3,ti.f32,shape=())
        self.fracture_materials=ti.Vector.field(3,ti.f32,shape=MAX_PARTS)
        self.mpm_h=ti.field(ti.f32,shape=())
        self.mpm_origin=ti.Vector.field(3,ti.f32,shape=())
        self.domain_lo=ti.Vector.field(3,ti.f32,shape=());self.domain_hi=ti.Vector.field(3,ti.f32,shape=())
        for name in ("x", "v", "old", "anchor", "delta", "grab_offset", "relax_delta"):
            setattr(self, name, ti.Vector.field(3, ti.f32, shape=capacity))
        for name in ("F", "C", "tau"):
            setattr(self, name, ti.Matrix.field(3, 3, ti.f32, shape=capacity))
        for name in ("mass", "volume", "inv_mass", "temp", "jp", "dilation", "yield_strain", "friction", "stress", "plastic", "lam", "relax_lam", "fluid_stable", "fluid_baseline", "solid_spacing", "damage"):
            setattr(self, name, ti.field(ti.f32, shape=capacity))
        for name in ("enthalpy", "heat", "budget"):
            setattr(self, name, ti.field(ti.f64, shape=capacity))
        for name in ("material", "model", "pinned", "next", "grab", "melted", "fluid_transition", "relax_zone"):
            setattr(self, name, ti.field(ti.i32, shape=capacity))
        self.props = ti.Matrix.field(4, 1, ti.f64, shape=12)
        self.props.from_numpy(PROPERTIES.reshape(12, 4, 1))
        self.gmass = ti.field(ti.f32, shape=(N,N,N))
        self.gv = ti.Vector.field(3, ti.f32, shape=(N,N,N))
        self.fixed = ti.field(ti.i32, shape=(N,N,N))
        self.head = ti.field(ti.i32, shape=(N,N,N))
        self.cell_index = ti.Vector.field(3,ti.i32,shape=capacity)
        self.counts=ti.field(ti.i32,shape=self.neighbor_cells)
        self.prefix=ti.field(ti.i32,shape=self.neighbor_cells)
        self.cursor=ti.field(ti.i32,shape=self.neighbor_cells)
        self.sorted_ids=ti.field(ti.i32,shape=capacity)
        self.scan=ti.algorithms.PrefixSumExecutor(self.neighbor_cells)
        self.limits = ti.field(ti.f32, shape=5)
        self.reduction = ti.field(ti.f64, shape=26)
        self.plasticity = ti.Vector.field(8,ti.f32,shape=MAX_PARTS)
        self.pressure_materials = ti.Vector.field(10,ti.f32,shape=MAX_PARTS)
        self.thermal_materials = ti.Vector.field(9,ti.f32,shape=MAX_PARTS)
        self.phase_materials = ti.Vector.field(3,ti.f64,shape=MAX_PARTS)
        self.max_delta = ti.field(ti.f32, shape=())
        self.max_relax_delta = ti.field(ti.f32, shape=())
        self.projection_energy = ti.field(ti.f64,shape=2)
        self.impulse = ti.field(ti.f32, shape=())
        self.heat_total = ti.field(ti.f64, shape=())
        self.settings = dict(gravity=True, stiffness=1.0, thermal=True, heatRate=20.0, ambient=False)
        self.settings.update(GRAVITY_DEFAULTS)
        self.settings.update(timeStepScale=1.0,pbfIterations=3,pbfAntiClump=True,solidAntiClump=True)
        self.lab=Laboratory(self,capacity)
        self.drag_point = None
        self.reset("empty")

    @ti.func
    def solid(self, m):
        return self.props[m][3, 0] > .5

    @ti.func
    def is_solid(self, i):
        return self.solid(self.material[i]) and self.melted[i] == 0

    @ti.func
    def pressure_allowed(self,i,j):
        split=self.pressure_split[None]
        return split==0 or self.pressure_cross[None]!=0 or (i<split)==(j<split)

    @ti.func
    def reset_deformation(self, i):
        self.F[i] = ti.Matrix.identity(ti.f32, 3)
        self.C[i] = ti.Matrix.zero(ti.f32, 3, 3)
        self.tau[i] = ti.Matrix.zero(ti.f32, 3, 3)
        self.jp[i], self.dilation[i], self.stress[i], self.plastic[i] = 1.0, 0.0, 0.0, 0.0

    @ti.func
    def phase(self, i):
        old, mat, h = self.material[i], self.material[i], self.enthalpy[i]
        was_melted = self.melted[i]
        t = h / self.props[mat][1, 0]
        if mat == 2 or mat == 3 or mat == 4:
            if h < 0:
                mat, t = 4, h / 2100
            elif h < 334000:
                mat, t = 2, 0.0
                if old == 4:
                    mat = 4
            elif h < 752000:
                mat, t = 2, (h - 334000) / 4180
            elif h < 3008000:
                mat, t = 2, 100.0
                if old == 3:
                    mat = 3
            else:
                mat, t = 3, 100 + (h - 3008000) / 2010
        elif mat == 0 or mat == 1:
            if h < 840000:
                mat, t = 0, h / 840
            elif h < 1240000:
                t = 1000.0
            else:
                mat, t = 1, 1000 + (h - 1240000) / 1200
        elif mat == 5 or mat == 7 or mat == 10:
            if h < 692100:
                mat, t = 5, h / 450
                if old == 7:
                    mat = 7
            elif h < 939100:
                t = 1538.0
            else:
                mat, t = 10, 1538 + (h - 939100) / 820
        elif mat == 11:
            params = self.phase_materials[self.lab.part[i]]
            if params[0] > .5:
                start = self.props[11][1,0]*params[1]
                if h <= start:
                    self.melted[i] = 0
                elif h >= start+params[2]:
                    self.melted[i] = 1
                    t = (h-params[2])/self.props[11][1,0]
                else:
                    t = params[1]
            else:
                self.melted[i] = 0
        self.material[i], self.temp[i] = mat, ti.cast(t, ti.f32)
        if mat!=3:
            self.volume[i] = ti.cast(ti.min(8.0, ti.max(.000001, self.mass[i]*1000/self.props[mat][0,0])),ti.f32)
        if mat != old:
            self.reset_deformation(i)
            self.model[i] = 0
            if not self.solid(mat):
                self.pinned[i], self.inv_mass[i] = 0, 1/self.mass[i]
            self.fluid_transition[i] = ti.cast(self.solid(old) and not self.solid(mat) and mat != 3, ti.i32)
            self.fluid_stable[i] = 0
        if was_melted != self.melted[i]:
            self.reset_deformation(i)
            self.fluid_transition[i], self.fluid_stable[i] = self.melted[i], 0
            if self.melted[i]:
                self.pinned[i], self.inv_mass[i] = 0, 1/self.mass[i]

    @ti.kernel
    def insert(self, start: ti.i32, rows: ti.types.ndarray(dtype=ti.f32, ndim=2)):
        for k in range(rows.shape[0]):
            i = start + k
            self.x[i] = ti.Vector([rows[k,0], rows[k,1], rows[k,2]])
            self.v[i] = ti.Vector.zero(ti.f32,3)
            self.damage[i]=0
            self.material[i], self.model[i] = ti.cast(rows[k,3],ti.i32), ti.cast(rows[k,4],ti.i32)
            self.melted[i], self.fluid_transition[i], self.fluid_stable[i], self.relax_zone[i] = 0, 0, 0, 0
            mat = self.material[i]
            self.mass[i] = ti.cast(self.props[mat][0,0]/1000,ti.f32)
            self.inv_mass[i], self.volume[i] = 1/self.mass[i], 1.0
            self.enthalpy[i] = ti.cast(rows[k,5],ti.f64)
            self.pinned[i] = ti.cast(rows[k,6],ti.i32)
            self.anchor[i] = self.x[i]
            self.lab.reference[i]=self.x[i];self.lab.part[i]=0
            if self.pinned[i]:
                self.inv_mass[i] = 0
            self.yield_strain[i], self.friction[i] = rows[k,7], rows[k,8]
            self.grab[i] = 0
            self.reset_deformation(i)
            self.phase(i)

    @ti.kernel
    def initialize_phase(self,start: ti.i32,end: ti.i32,temperature: ti.f64):
        for i in range(start,end):
            params=self.phase_materials[self.lab.part[i]]
            self.enthalpy[i]=self.props[11][1,0]*temperature
            if temperature>params[1]:
                self.enthalpy[i]+=params[2]
            self.phase(i)

    def box(self, a, b, material=11, fixed=False, temperature=None, model=0, yieldStrain=.025, friction=35, shape="box", name="", velocity=None, plasticity=None, sampling={}, pressure=None, thermalMaterial=None, phaseChange=None):
        if temperature is None:
            temperature = TEMPERATURES[material] if isinstance(material,int) and 0 <= material < 12 else float("nan")
        try:
            phase_params=phase_parameters(phaseChange)
            if phase_params is None or phase_params[0] and material!=11:return False
            noise=sampling_options(sampling);pressure_params=pressure_parameters(pressure)
            if noise is None or pressure_params is None:return False
            thermal_params=thermal_parameters(thermalMaterial)
            if thermal_params is None:return False
            params=parameters(plasticity)
            if params is None:return False
            if len(a)!=3 or len(b)!=3 or not all(math.isfinite(float(v)) for v in [*a,*b,temperature,yieldStrain,friction]):
                return False
            if self.lab.next_id>=MAX_PARTS or shape not in ("box","ellipsoid","cylinder") or material not in range(12) or not isinstance(model,int) or model not in range(MODEL_COUNT):
                return False
            lo = np.maximum(np.minimum(a,b),self.bounds_lo[None].to_numpy()+1)
            hi = np.minimum(np.maximum(a,b),self.bounds_hi[None].to_numpy()-1)
            dims = np.floor((hi-lo)/4).astype(int)+1
            velocity=[0,0,0] if velocity is None else velocity
            if not isinstance(velocity,list) or len(velocity)!=3 or not all(isinstance(v,(int,float)) and math.isfinite(v) and abs(v)<=80 for v in velocity):return False
            if min(dims)<2:
                return False
            z,y,x=np.meshgrid(np.arange(dims[2]),np.arange(dims[1]),np.arange(dims[0]),indexing="ij")
            rows=np.empty((int(np.prod(dims)),9),dtype=np.float32)
            rows[:,:3]=lo+4*np.column_stack((x.ravel(),y.ravel(),z.ravel()))
            if shape!="box":
                q=(rows[:,:3]-(lo+hi)*.5)/((hi-lo)*.5)
                keep=np.sum(q*q,axis=1)<=1+1e-7 if shape=="ellipsoid" else q[:,0]**2+q[:,2]**2<=1+1e-7
                rows=rows[keep]
            if not len(rows) or self.count+len(rows)>self.capacity:return False
            rows[:,3:]=[material,model if material==11 else 0,enthalpy_at(material,temperature),0,
                        np.clip(yieldStrain,.005,.08),np.clip(friction,15,50)]
            if fixed:
                rows[:,6]=np.isclose(rows[:,0],lo[0])
            rows[:,:3]=jitter_points(rows[:,:3],lo,hi,shape,rows[:,6].astype(bool),noise)
            start=self.count
            self.insert(start,rows)
            self.count += len(rows)
            part=self.lab.register(start,name)
            self.plasticity[part]=params;self.pressure_materials[part]=pressure_params;self.thermal_materials[part]=thermal_params
            self.phase_materials[part]=phase_params
            if material==11 and phase_params[0]:self.initialize_phase(start,self.count,temperature)
            if any(velocity):self.lab.edit(self.count,part,0,velocity,[0,0,0],[0,0,0])
            self.nonuniform_heat = True
            return True
        except (TypeError, ValueError, OverflowError):
            return False

    def set_domain_fields(self,d):
        self.neighbor_h[None]=max(H,max(d['size'])/60);self.neighbor_origin[None]=[v-2*float(self.neighbor_h[None]) for v in d['lower']]
        self.mpm_h[None]=d['cellSize'];self.mpm_origin[None]=d['origin'];self.domain_lo[None]=d['lower'];self.domain_hi[None]=d['upper']

    def configure_domain(self,value):
        d=domain_parameters(value);lo=np.array(d['lower'])+d['spacing']*.25;hi=np.array(d['upper'])-d['spacing']*.25
        if self.neighbor_domain is not None and d != self.neighbor_domain:
            raise ValueError('紧凑 GPU 网格修改计算域后需重新构建求解器')
        x=self.x.to_numpy()[:self.count]
        if np.any(x<lo) or np.any(x>hi):raise ValueError('新计算域无法容纳已有粒子；请扩大范围或在空场景设置')
        if self.press['enabled'] and not lo[1]+2<=self.press['y']<=d['upper'][1]:raise ValueError('当前压板超出新计算域，请先关闭压板')
        self.domain=d;self.set_domain_fields(d);self.bounds_lo[None]=lo;self.bounds_hi[None]=hi
        press_min=d['lower'][1]+min(16,d['size'][1]/2)
        self.press['target']=float(np.clip(self.press['target'],press_min,d['upper'][1]))
        if not self.press['enabled']:
            self.press['y']=float(np.clip(self.press['y'],press_min,d['upper'][1]));self.press['origin']=self.press['y']
        return d

    @ti.kernel
    def scale_geometry(self,start:ti.i32,end:ti.i32,volume:ti.f32):
        for i in range(start,end):
            self.mass[i]*=volume;self.volume[i]=volume
            self.inv_mass[i]=(1-self.pinned[i])/self.mass[i]

    def create_geometry(self,d):
        g=geometry_parameters(d,self.domain);mat=d.get('material',11);model=d.get('model',0)
        temp=d.get('temperature',TEMPERATURES[mat] if isinstance(mat,int) and mat in range(12) else float('nan'))
        noise=sampling_options(d.get('sampling',{}));phase=phase_parameters(d.get('phaseChange'));plasticity=parameters(d.get('plasticity'));pressure=pressure_parameters(d.get('pressure'));thermal=thermal_parameters(d.get('thermalMaterial'));velocity=d.get('velocity',[0,0,0]);ys=d.get('yieldStrain',.025);friction=d.get('friction',35)
        if any(p is None for p in [noise,phase,plasticity,pressure,thermal]) or mat not in range(12) or not isinstance(model,int) or model not in range(MODEL_COUNT) or not vector([temp,ys,friction]) or phase[0] and mat!=11 or not vector(velocity) or any(abs(x)>80 for x in velocity) or self.lab.next_id>=MAX_PARTS:raise ValueError('材料、初始条件或部件容量无效')
        points=geometry_points(g,self.capacity-self.count);original=points.copy();local=(points-g['center'])@g['R'];fixed=(local[:,0]<local[:,0].min()+g['spacing']*.5) if d.get('fixed',False) else np.zeros(len(points),bool)
        local=jitter_points(local,-np.array(g['size'])*.5,np.array(g['size'])*.5,g['shape'],fixed,noise,g['spacing'])
        points=local@g['R'].T+g['center'];lo=self.bounds_lo[None].to_numpy();hi=self.bounds_hi[None].to_numpy()
        outside=np.any((points<lo)|(points>hi),axis=1);points[outside]=original[outside]
        if np.any((points<lo)|(points>hi)):raise ValueError('采样点触及边界缓冲区，请将几何稍向计算域内部移动')
        rows=np.empty((len(points),9),np.float32);rows[:,:3]=points;rows[:,3:]=[mat,model if mat==11 else 0,enthalpy_at(mat,temp),0,np.clip(ys,.005,.08),np.clip(friction,15,50)];rows[:,6]=fixed
        start=self.count;self.insert(start,rows);self.count+=len(rows);self.scale_geometry(start,self.count,g['volume']/len(rows)/64)
        part=self.lab.register(start,d.get('name',''));self.plasticity[part]=plasticity;self.pressure_materials[part]=pressure;self.thermal_materials[part]=thermal;self.phase_materials[part]=phase
        self.lab.definitions[part]=dict(shape=g['shape'],center=g['center'],size=g['size'],rotation=g['rotation'],volume=g['volume'],spacing=g['spacing'],cellSize=self.domain['cellSize'],particlesPerCell=self.domain['particlesPerCell'],count=len(rows))
        if mat==11 and phase[0]:self.initialize_phase(start,self.count,temp)
        if any(velocity):self.lab.edit(self.count,part,0,velocity,[0,0,0],[0,0,0])
        self.nonuniform_heat=True
        return part

    def reset(self, scene="coupled"):
        if self.neighbor_domain is not None and scene != 'empty':
            raise ValueError('紧凑 GPU 网格仅用于固定计算域的项目求解器')
        self.phase_materials.from_numpy(np.tile(np.array(phase_parameters(),np.float64),(MAX_PARTS,1)))
        self.plasticity.from_numpy(np.tile(np.array(list(DEFAULTS.values()),np.float32),(MAX_PARTS,1)))
        self.thermal_materials.from_numpy(np.tile(np.array(list(THERMAL_DEFAULTS.values()),np.float32),(MAX_PARTS,1)))
        self.pressure_materials.from_numpy(np.tile(np.array(list(PRESSURE_DEFAULTS.values()),np.float32),(MAX_PARTS,1)))
        self.count, self.time, self.substeps = 0, 0.0, 0
        self.fracture_materials.fill(0)
        self.lab.reset()
        self.scene = scene
        self.space = scene in ("planet", "million")
        self.self_gravity = scene == "planet"
        self.bounds_lo[None]=[-240]*3 if self.space else [-63,-47,-63]
        self.bounds_hi[None]=[240]*3 if self.space else [63,71,63]
        self.domain=domain_parameters(dict(DEFAULT_DOMAIN,lower=[-240]*3,upper=[240]*3) if self.space else DEFAULT_DOMAIN)
        if self.neighbor_domain is not None:
            self.domain=self.neighbor_domain
            self.bounds_lo[None]=np.array(self.domain['lower'])+self.domain['spacing']*.25
            self.bounds_hi[None]=np.array(self.domain['upper'])-self.domain['spacing']*.25
        self.set_domain_fields(self.domain)
        self.heat_total[None]=0;self.impulse[None]=0
        self.drag_point, self.history, self.profile = None, [], {}
        y = 12.0 if scene in ("compression","metals","porous","thermomech") else 64.0
        self.press = dict(enabled=scene in ("compression","metals","porous","thermomech"),y=y,target=y,origin=y,speed=8.0,velocity=0.0,force=0.0)
        self.nonuniform_heat = False
        if scene=="planet":
            # Select antipodal lattice pairs for an exact count and zero initial COM.
            x,y,z=np.meshgrid(np.arange(.5,18),np.arange(-17.5,18),np.arange(-17.5,18),indexing="ij")
            half=4*np.column_stack((x.ravel(),y.ravel(),z.ravel()))
            half=half[np.argsort(np.sum(half*half,axis=1),kind="stable")[:10000]]
            rows=np.zeros((20000,9),dtype=np.float32)
            rows[:,:3]=np.concatenate((half,-half))
            rows[:,3:]=[2,0,enthalpy_at(2,20),0,.025,35]
            self.insert(0,rows);self.count=20000;self.lab.register(0,"PBF 星球")
        elif scene=="million":
            self.box([-198]*3,[198]*3,2,temperature=20)
        elif scene=="coupled":
            self.box([-44,24,-12],[-8,36,12],11,True)
            self.box([12,8,4],[32,28,24])
            self.box([-44,-42,-36],[44,-34,36],2)
        elif scene in ("thermomech","melting"):
            names=["冷态 J2 · 20°C","热态 J2 · 180°C","冷态蠕变 · 20°C","热态蠕变 · 180°C"]
            for k in range(4):
                x=-44 if k%2==0 else 16;z=-44 if k<2 else 16
                self.box([x,-40,z],[x+24,0,z+24],model=10 if k<2 else 11,temperature=180 if k%2 else 20,name=names[k],sampling=dict(enabled=True,strength=.2,seed=42+k),phaseChange=dict(enabled=scene=="melting"))
        elif scene=="porous":
            names=["低剪胀岩土","高剪胀岩土","低平台泡沫","高平台泡沫"]
            for k in range(4):
                x,z=(-44 if k%2==0 else 16),(-44 if k<2 else 16)
                pressure=dict(dilatancy=0 if k==0 else .45) if k<2 else dict(plateau=.008 if k==2 else .04)
                self.box([x,-40,z],[x+24,0,z+24],model=8 if k<2 else 9,name=names[k],sampling=dict(enabled=True,strength=.2,seed=42+k),pressure=pressure)
        elif scene=="metals":
            names=["理想弹塑性 · J2","线性强化 · J2","Johnson–Cook","简化 Johnson–Cook"]
            for k in range(4):
                x,z=(-44 if k%2==0 else 16),(-44 if k<2 else 16)
                self.box([x,-40,z],[x+24,0,z+24],model=k+4,temperature=650 if k>=2 else 20,name=names[k])
        elif scene=="compression":
            for model in range(4):
                x,z = (-44 if model%2==0 else 16),(-44 if model<2 else 16)
                self.box([x,-40,z],[x+24,0,z+24],model=model)
        elif scene in ("models","large"):
            for model in range(4):
                x,z = (-56 if model%2==0 else 12),(-56 if model<2 else 12)
                self.box([x,-36 if scene=="large" else 4,z],[x+40,64 if scene=="large" else 28,z+40],model=model)
        elif scene=="thermal":
            self.box([-30,-36,-20],[-2,-20,20],2,temperature=80)
            self.box([2,-36,-20],[30,-20,20],2,temperature=20)
        self.nonuniform_heat = scene in ("coupled","thermal","metals","thermomech")

    @ti.func
    def stress_tensor(self, i, stiffness):
        F, model = self.F[i], self.model[i]
        J = F.determinant()
        E = self.mass[i]/(64*self.volume[i])*16000*stiffness
        mu, la = .4*E, .4*E
        if model == 2:
            hard = ti.min(4.0,ti.max(.25,ti.exp(10*(1-self.jp[i]))))
            mu, la = mu*hard, la*hard
        tau = ti.Matrix.zero(ti.f32,3,3)
        if model == 1:
            tau = mu*(F@F.transpose()-ti.Matrix.identity(ti.f32,3)) + la*ti.log(ti.max(J,1e-6))*ti.Matrix.identity(ti.f32,3)
        else:
            U,S,V = ti.svd(F,ti.f32)
            if model >= 3:
                e = ti.Vector([ti.log(ti.max(S[k,k],1e-6)) for k in ti.static(range(3))])
                diagonal = 2*mu*e + la*e.sum()
                tau = U@ti.Matrix([[diagonal[0],0.0,0.0],[0.0,diagonal[1],0.0],[0.0,0.0,diagonal[2]]])@U.transpose()
            else:
                R = U@V.transpose()
                tau = 2*mu*(F-R)@F.transpose() + la*(J-1)*J*ti.Matrix.identity(ti.f32,3)
        vm = ti.sqrt(ti.max(0.0,.5*((tau[0,0]-tau[1,1])**2+(tau[1,1]-tau[2,2])**2+(tau[2,2]-tau[0,0])**2)+3*(tau[0,1]**2+tau[0,2]**2+tau[1,2]**2)))
        if 8<=model<10:J*=self.jp[i]
        self.stress[i] = vm/ti.max(J,1e-6)/E
        if self.damage[i]<1:tau*=1-self.damage[i]
        return tau

    @ti.kernel
    def prepare(self, n: ti.i32, stiffness: ti.f32):
        self.limits[0],self.limits[1],self.limits[2],self.limits[3] = 1/120,-1000,0,0
        self.limits[4] = 0
        for i in range(n):
            self.relax_zone[i] = 0
            if self.fluid_transition[i]:
                ti.atomic_max(self.limits[4],1)
            if self.pinned[i]:
                ti.atomic_max(self.limits[1],self.x[i][1]+2)
            if self.is_solid(i):
                ti.atomic_max(self.limits[3],1)
                F,C = self.F[i],self.C[i]
                row,col,grad = 0.0,0.0,0.0
                for a in ti.static(range(3)):
                    r,c = 0.0,0.0
                    for b in ti.static(range(3)):
                        r += ti.abs(F[a,b]); c += ti.abs(F[b,a]); grad += ti.abs(C[a,b])
                    row,col = ti.max(row,r),ti.max(col,c)
                hard,compression = 1.0,1.0
                if self.model[i]==2:
                    hard = ti.min(4.0,ti.max(.25,ti.exp(10*(1-self.jp[i]))))
                if self.model[i]==1 or 8<=self.model[i]<10:
                    total_j=F.determinant()
                    if 8<=self.model[i]<10:total_j*=self.jp[i]
                    compression = 1/ti.max(.05,total_j)
                wave = self.v[i].norm()+ti.sqrt(19200*stiffness*hard)*ti.max(1.0,row*col,compression)
                ti.atomic_min(self.limits[0],ti.min(self.mpm_h[None]/8/240,1.4*self.mpm_h[None]/8/ti.max(wave,1),.08/ti.max(grad,1)))
                self.tau[i] = self.stress_tensor(i,stiffness)
            else:
                ti.atomic_max(self.limits[2],1)
                self.stress[i] = 0

    @ti.kernel
    def forces(self,n: ti.i32,dt: ti.f32,gravity: ti.i32,dragging: ti.i32,point: V3):
        for i in range(n):
            self.old[i] = self.x[i]
            if not self.pinned[i]:
                if gravity==2:
                    net=self.gravity.net[None]
                    bias=ti.cast(ti.Vector([net[0],net[1],net[2]])/ti.max(net[3],1e-20),ti.f32)
                    if net[4]>0:
                        bias=ti.Vector.zero(ti.f32,3)
                    self.v[i] += (self.gravity.acceleration[i]-bias)*dt*self.gravity_params[0]
                elif gravity==1:
                    self.v[i] += self.gravity_direction[None]*(24.0 if self.material[i]!=3 else -8.0)*dt*self.gravity_params[0]
                elif gravity==3 or gravity==4:
                    d=self.gravity_center[None]-self.x[i]
                    scale=24000*self.gravity_params[0]/(d.norm_sqr()+self.gravity_params[1]**2)**1.5
                    if gravity==4:
                        scale=-scale
                    self.v[i]+=d*scale*dt
                if dragging and self.grab[i]:
                    force = 90*(point+self.grab_offset[i]-self.x[i])-12*self.v[i]
                    self.v[i] += ti.min(900.0,ti.max(-900.0,force))*dt
                if not self.is_solid(i):
                    self.x[i] += dt*self.v[i]

    @ti.kernel
    def clear_grid(self):
        for I in ti.grouped(self.gmass):
            self.gmass[I] = 0
            self.gv[I] = ti.Vector.zero(ti.f32,3)
            self.fixed[I] = 0

    @ti.func
    def weights(self, fx):
        return ti.Matrix.rows([.5*(1.5-fx)**2,.75-(fx-1)**2,.5*(fx-.5)**2])

    @ti.kernel
    def p2g(self,n: ti.i32,dt: ti.f32):
        h=self.mpm_h[None];origin=self.mpm_origin[None]
        for p in range(n):
            if self.is_solid(p):
                base = ti.cast(ti.floor((self.x[p]-origin)/h-.5),ti.i32)
                fx = (self.x[p]-origin)/h-base
                w = self.weights(fx)
                affine = self.mass[p]*self.C[p]-dt*64*self.volume[p]*4/(h*h)*self.tau[p]
                for i,j,k in ti.static(ti.ndrange(3,3,3)):
                    offset = ti.Vector([i,j,k]);dpos = (offset-fx)*h
                    weight = w[i,0]*w[j,1]*w[k,2]
                    self.gmass[base+offset] += weight*self.mass[p]
                    self.gv[base+offset] += weight*(self.mass[p]*self.v[p]+affine@dpos)
                    if self.pinned[p] and weight>1e-8:
                        ti.atomic_max(self.fixed[base+offset],1)

    @ti.kernel
    def grid_step(self,enabled: ti.i32,y: ti.f32,velocity: ti.f32):
        h=self.mpm_h[None]
        for I in ti.grouped(self.gmass):
            if self.gmass[I]>1e-12:
                v = self.gv[I]/self.gmass[I]
                q = self.mpm_origin[None]+ti.cast(I,ti.f32)*h
                for a in ti.static(range(3)):
                    lo,hi = self.domain_lo[None][a],self.domain_hi[None][a]
                    if self.fixed[I] or (q[a]<lo+h and v[a]<0) or (q[a]>hi-h and v[a]>0):
                        v[a]=0
                if enabled and q[1]>=y-h*.5 and not self.fixed[I]:
                    after = ti.min(v[1],velocity)
                    self.impulse[None] += (v[1]-after)*self.gmass[I]
                    v[1]=after
                self.gv[I]=v

    @ti.func
    def project(self,i,F,dt):
        result = F
        fracture=self.fracture_materials[self.lab.part[i]]
        if fracture[0]>.5 and self.damage[i]<1:
            U,S,V=ti.svd(F,ti.f32)
            strain=ti.max(0.,ti.log(ti.max(S[0,0],ti.max(S[1,1],S[2,2]))))
            self.damage[i]=ti.max(self.damage[i],ti.min(1.,(strain-fracture[1])/(fracture[2]-fracture[1])))
            if self.damage[i]>=1:
                self.model[i]=3;self.jp[i]=1;self.dilation[i]=0
                F=ti.Matrix.identity(ti.f32,3);result=F
        if self.model[i]>=2:
            U,S,V = ti.svd(F,ti.f32)
            sigma = ti.Vector([ti.max(S[k,k],1e-8) for k in ti.static(range(3))])
            projected = sigma
            increment=0.0
            if self.model[i]==2:
                projected = ti.min(1+self.yield_strain[i]*.3,ti.max(1-self.yield_strain[i],sigma))
                self.jp[i] = ti.min(20.0,ti.max(.6,self.jp[i]*(sigma[0]*sigma[1]*sigma[2])/(projected[0]*projected[1]*projected[2])))
            elif self.model[i]>=10:
                projected,increment=thermal_return(sigma,self.model[i],self.plastic[i],dt,self.temp[i],self.thermal_materials[self.lab.part[i]])
            elif 8<=self.model[i]<10:
                projected,new_jp,increment=pressure_return(sigma,self.model[i],self.jp[i],self.plastic[i],self.pressure_materials[self.lab.part[i]])
                self.jp[i]=new_jp
            elif self.model[i]>=4:
                projected,increment=metal_return(sigma,self.model[i],self.plastic[i],dt,self.temp[i],self.plasticity[self.lab.part[i]])
            else:
                e = ti.log(ti.max(sigma,1e-6))
                trace = e.sum()+self.dilation[i]
                if trace>=0:
                    projected=ti.Vector([1.0,1.0,1.0]);self.dilation[i]=trace
                else:
                    self.dilation[i]=0
                    dev=e-trace/3;length=dev.norm()
                    sine=ti.sin(self.friction[i]*math.pi/180)
                    alpha=ti.sqrt(2/3)*2*sine/(3-sine)
                    delta=ti.max(0.0,length+2.5*trace*alpha)
                    projected=ti.exp(e-delta/ti.max(length,1e-20)*dev)
            if self.model[i]<4:increment=ti.log(sigma/projected).norm()
            self.plastic[i] += increment
            result=U@ti.Matrix([[projected[0],0.0,0.0],[0.0,projected[1],0.0],[0.0,0.0,projected[2]]])@V.transpose()
        return result

    @ti.kernel
    def g2p(self,n: ti.i32,dt: ti.f32):
        h=self.mpm_h[None];origin=self.mpm_origin[None]
        for p in range(n):
            if self.is_solid(p) and not self.pinned[p]:
                base=ti.cast(ti.floor((self.x[p]-origin)/h-.5),ti.i32)
                fx=(self.x[p]-origin)/h-base;w=self.weights(fx)
                v=ti.Vector.zero(ti.f32,3);C=ti.Matrix.zero(ti.f32,3,3)
                for i,j,k in ti.static(ti.ndrange(3,3,3)):
                    offset=ti.Vector([i,j,k]);weight=w[i,0]*w[j,1]*w[k,2]
                    gv=self.gv[base+offset]
                    v+=weight*gv;C+=weight*gv.outer_product((offset-fx)*4/h)
                self.v[p],self.C[p]=v,C
                self.F[p]=self.project(p,(ti.Matrix.identity(ti.f32,3)+dt*C)@self.F[p],dt)
                self.x[p]+=dt*v

    @ti.kernel
    def clear_neighbors(self):
        for i in range(self.neighbor_cells):
            self.counts[i]=0;self.cursor[i]=0;self.prefix[i]=0

    @ti.func
    def cell(self,x):
        return ti.min(ti.Vector(self.neighbor_shape)-2,ti.max(1,ti.cast(ti.floor((x-self.neighbor_origin[None])/self.neighbor_h[None]),ti.i32)))

    @ti.kernel
    def count_neighbors(self,n: ti.i32):
        for i in range(n):
            c=self.cell(self.x[i])
            self.cell_index[i]=c
            self.counts[self.cell_id(c)]+=1

    @ti.func
    def cell_id(self,c):
        return (c[2]*self.neighbor_shape[1]+c[1])*self.neighbor_shape[0]+c[0]

    @ti.kernel
    def scatter_neighbors(self,n: ti.i32):
        for i in range(n):
            c=self.cell_id(self.cell_index[i]);slot=ti.atomic_add(self.cursor[c],1)
            self.sorted_ids[self.prefix[c]-self.counts[c]+slot]=i

    def build_neighbors(self,n):
        self.count_neighbors(n);self.prefix.copy_from(self.counts);self.scan.run(self.prefix);self.scatter_neighbors(n)

    @ti.kernel
    def sampling_prepare(self,n: ti.i32):
        self.max_delta[None]=1.0
        for i in range(n):
            self.delta[i]=ti.Vector.zero(ti.f32,3)
            self.solid_spacing[i]=0.0
            if self.is_solid(i):
                jp=1.0
                if self.model[i]==2 or self.model[i]==8 or self.model[i]==9:jp=self.jp[i]
                volume=ti.min(8.0,ti.max(.015625,self.volume[i]*self.F[i].determinant()*jp))
                self.solid_spacing[i]=2.8*volume**(1.0/3.0)

    @ti.kernel
    def sampling_pairs(self,n: ti.i32,dt: ti.f32):
        gain=1.0-ti.exp(-40.0*dt)
        for i in range(n):
            if self.is_solid(i):
                cell=self.cell_index[i]
                for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                    cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                    for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                        j=self.sorted_ids[slot]
                        if j>i and self.is_solid(j) and self.lab.part[i]==self.lab.part[j]:
                            total=self.inv_mass[i]+self.inv_mass[j]
                            d=self.x[i]-self.x[j];r=d.norm()
                            target=(self.solid_spacing[i]+self.solid_spacing[j])*.5
                            if total>0 and r<target:
                                distance=r
                                if r<1e-8:
                                    hashed=ti.cast(i+1,ti.u32)*ti.u32(73856093)^ti.cast(j+1,ti.u32)*ti.u32(19349663)
                                    d=ti.Vector([ti.cast(hashed&1023,ti.f32)/511.5-1,ti.cast((hashed>>10)&1023,ti.f32)/511.5-1,ti.cast((hashed>>20)&1023,ti.f32)/511.5-1])
                                    r=d.norm();distance=0.0
                                shift=d*((target-distance)*gain/(r*total))
                                self.delta[i]+=shift*self.inv_mass[i]
                                self.delta[j]-=shift*self.inv_mass[j]

    @ti.kernel
    def sampling_limit(self,n: ti.i32,dt: ti.f32):
        for i in range(n):
            ti.atomic_max(self.max_delta[None],self.delta[i].norm()/(8*dt))

    @ti.kernel
    def sampling_apply(self,n: ti.i32,enabled: ti.i32,y: ti.f32):
        for i in range(n):
            if self.is_solid(i) and not self.pinned[i]:
                hi=self.bounds_hi[None]
                if enabled:hi[1]=ti.min(hi[1],y-1.8)
                self.x[i]=ti.min(hi,ti.max(self.bounds_lo[None],self.x[i]+self.delta[i]/self.max_delta[None]))

    def regularize_solids(self,dt):
        # Sampling correction is deliberately after physical velocity/contact
        # updates. It must not create a displacement/dt impulse or reset F/C.
        self.clear_neighbors();self.build_neighbors(self.count)
        self.sampling_prepare(self.count);self.sampling_pairs(self.count,dt);self.sampling_limit(self.count,dt)
        self.sampling_apply(self.count,int(self.press['enabled']),self.press['y'])

    @ti.kernel
    def fluid_baselines(self,n: ti.i32):
        # Before advection: split inherited packing error from new compression.
        for i in range(n):
            self.relax_zone[i]=0
            if not self.is_solid(i) and self.material[i]!=3:
                rho=self.volume[i];zone=self.fluid_transition[i];cell=self.cell_index[i]
                for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                    cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                    for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                        j=self.sorted_ids[slot];r=(self.x[i]-self.x[j]).norm()
                        if j!=i and self.material[j]!=3 and r>1e-6 and r<H and self.pressure_allowed(i,j):
                            q=1-r/H;rho+=self.volume[j]*q*q*q
                            zone=ti.max(zone,self.fluid_transition[j])
                self.fluid_baseline[i]=ti.max(2.08,rho);self.relax_zone[i]=zone

    @ti.kernel
    def density(self,n: ti.i32):
        for i in range(n):
            self.lam[i]=0
            self.relax_lam[i]=0
            if not self.is_solid(i) and self.material[i]!=3:
                rho,den=self.volume[i],0.0;grad=ti.Vector.zero(ti.f32,3);cell=self.cell_index[i]
                for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                    cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                    for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                        j=self.sorted_ids[slot]
                        d=self.x[i]-self.x[j];r=d.norm()
                        if j!=i and self.material[j]!=3 and r>1e-6 and r<H and self.pressure_allowed(i,j):
                            q=1-r/H;rho+=self.volume[j]*q*q*q
                            g=-3*q*q/H/2.08/r*self.volume[j]*d
                            grad+=g;den+=self.inv_mass[j]*g.norm_sqr()
                denominator=den+self.inv_mass[i]*grad.norm_sqr()+.025
                full=-ti.max(0.0,rho/2.08-1)/denominator
                self.lam[i]=full
                if self.relax_zone[i]:
                    self.lam[i]=-ti.max(0.0,(rho-self.fluid_baseline[i])/2.08)/denominator
                self.relax_lam[i]=full-self.lam[i]

    @ti.kernel
    def corrections(self,n: ti.i32,anti_clump: ti.i32,dt: ti.f32,iterations: ti.i32,transitioning: ti.i32):
        self.max_delta[None]=1
        self.max_relax_delta[None]=1
        self.projection_energy[0],self.projection_energy[1]=0,0
        for i in range(n):
            total=ti.Vector.zero(ti.f32,3);relax=ti.Vector.zero(ti.f32,3);cell=self.cell_index[i]
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                    j=self.sorted_ids[slot]
                    d=self.x[i]-self.x[j];r=d.norm()
                    if j!=i and r>1e-6 and r<H and self.pressure_allowed(i,j):
                        q=1-r/H
                        scorr=0.0
                        if anti_clump and not self.is_solid(i) and not self.is_solid(j) and self.material[i]!=3 and self.material[j]!=3:
                            scorr=-.05*(dt*120)**2*3/iterations*(q/.7)**12
                        pressure=scorr*(self.volume[i]+self.volume[j])*.5
                        regular_pressure,relax_pressure=pressure,0.0
                        if self.relax_zone[i] or self.relax_zone[j]:
                            regular_pressure,relax_pressure=0.0,pressure
                        g=self.inv_mass[i]*(-3*q*q/H/2.08/r)*d
                        total+=(self.lam[i]*self.volume[j]+self.lam[j]*self.volume[i]+regular_pressure)*g
                        relax+=(self.relax_lam[i]*self.volume[j]+self.relax_lam[j]*self.volume[i]+relax_pressure)*g
            self.delta[i]=total;ti.atomic_max(self.max_delta[None],total.norm())
            self.relax_delta[i]=relax;ti.atomic_max(self.max_relax_delta[None],relax.norm()/(MELT_RELAX_SPEED*dt/iterations))
            if transitioning:
                self.projection_energy[0]+=ti.cast(self.mass[i]*(self.x[i]-self.old[i]).dot(total),ti.f64)
                self.projection_energy[1]+=ti.cast(self.mass[i]*total.norm_sqr(),ti.f64)

    @ti.kernel
    def apply_corrections(self,n: ti.i32,correct: ti.i32,press: ti.i32,plate_y: ti.f32,transitioning: ti.i32):
        for i in range(n):
            if correct:
                scale=1/self.max_delta[None]
                if transitioning and self.projection_energy[1]>1e-20:
                    scale=ti.min(scale,ti.cast(ti.max(0.0,-self.projection_energy[0]/self.projection_energy[1]),ti.f32))
                self.x[i]+=self.delta[i]*scale
                if not self.pinned[i]:
                    hi=self.bounds_hi[None]
                    if press:hi[1]=ti.min(hi[1],plate_y-1.8)
                    lo=self.bounds_lo[None]
                    shift=ti.min(hi,ti.max(lo,self.x[i]+self.relax_delta[i]/self.max_relax_delta[None]))-ti.min(hi,ti.max(lo,self.x[i]))
                    self.x[i]+=shift;self.old[i]+=shift
            self.x[i]=ti.min(self.bounds_hi[None],ti.max(self.bounds_lo[None],self.x[i]))
            if self.pinned[i]:
                self.x[i]=self.anchor[i]

    @ti.kernel
    def finish_fluid_transition(self,n: ti.i32,dt: ti.f32,iterations: ti.i32):
        for i in range(n):
            if self.fluid_transition[i]:
                settled=self.fluid_baseline[i]<=2.08*1.001 and self.relax_delta[i].norm()<=MELT_HANDOFF_SPEED*dt/iterations
                self.fluid_stable[i]=self.fluid_stable[i]+dt if settled else 0.0
                if self.fluid_stable[i]>=MELT_SETTLE_TIME:self.fluid_transition[i]=0

    @ti.kernel
    def velocities(self,n: ti.i32,dt: ti.f32):
        for i in range(n):
            self.v[i]=ti.min(160.0,ti.max(-160.0,(self.x[i]-self.old[i])/dt))

    @ti.kernel
    def viscosity(self,n: ti.i32):
        for i in range(n):
            total=ti.Vector.zero(ti.f32,3);cell=self.cell_index[i]
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                    j=self.sorted_ids[slot]
                    r=(self.x[i]-self.x[j]).norm();mass=self.inv_mass[i]+self.inv_mass[j]
                    if j!=i and r<H and mass>0 and (not self.is_solid(i) or not self.is_solid(j)):
                        q=1-r/H;total+=(self.v[j]-self.v[i])*.015*q*q*self.inv_mass[i]/mass
            self.delta[i]=total

    @ti.kernel
    def contacts(self,n: ti.i32,viscous: ti.i32,enabled: ti.i32,y: ti.f32,velocity: ti.f32):
        for i in range(n):
            if viscous:
                self.v[i]+=self.delta[i]
            if enabled and not self.pinned[i] and self.x[i][1]>y-1.8:
                self.x[i][1]=y-1.8
                after=ti.min(self.v[i][1],velocity)
                self.impulse[None]+=(self.v[i][1]-after)*self.mass[i]
                self.v[i][1]=after

    @ti.kernel
    def heat_budget(self,n: ti.i32,dt: ti.f64,rate: ti.f64):
        for i in range(n):
            total=ti.cast(0,ti.f64);cell=self.cell(self.x[i]);ki=self.props[self.material[i]][2,0]
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                    j=self.sorted_ids[slot]
                    r=(self.x[i]-self.x[j]).norm()
                    if j!=i and r>1e-6 and r<H and self.pressure_allowed(i,j):
                        kj=self.props[self.material[j]][2,0]
                        total+=(1-r/H)*20*rate*2*ki*kj/(ki+kj)
            self.budget[i]=1
            if total>0:
                self.budget[i]=ti.min(1.0,.45*self.mass[i]*self.props[self.material[i]][1,0]/(dt*total))
            self.heat[i]=0

    @ti.kernel
    def heat_exchange(self,n: ti.i32,dt: ti.f64,rate: ti.f64):
        for i in range(n):
            cell=self.cell(self.x[i]);ki=self.props[self.material[i]][2,0]
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cell_id=self.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.prefix[cell_id]-self.counts[cell_id],self.prefix[cell_id]):
                    j=self.sorted_ids[slot]
                    r=(self.x[i]-self.x[j]).norm()
                    if j>i and r>1e-6 and r<H:
                        kj=self.props[self.material[j]][2,0];g=(1-r/H)*20*rate*2*ki*kj/(ki+kj)
                        q=(self.temp[j]-self.temp[i])*g*dt*ti.min(self.budget[i],self.budget[j])
                        self.heat[i]+=q;self.heat[j]-=q;self.heat_total[None]+=ti.abs(q)

    @ti.kernel
    def heat_apply(self,n: ti.i32,dt: ti.f64,ambient: ti.i32):
        for i in range(n):
            self.enthalpy[i]+=self.heat[i]/self.mass[i]
            if ambient:
                self.enthalpy[i]-=(self.temp[i]-15)*self.props[self.material[i]][1,0]*dt*.003
            self.phase(i)

    @ti.kernel
    def brush_kernel(self,n: ti.i32,kind: ti.i32,point: V3,radius: ti.f32):
        for i in range(n):
            if (self.x[i]-point).norm()<radius:
                if kind==0 or kind==1:
                    self.pinned[i]=kind
                    self.inv_mass[i]=(1-kind)/self.mass[i]
                    self.anchor[i]=self.x[i]
                    if kind:
                        self.v[i]=ti.Vector.zero(ti.f32,3)
                elif kind==2 or kind==3:
                    mat=self.material[i];cp=self.props[mat][1,0]
                    if mat==1:
                        cp=840
                    elif mat==10:
                        cp=450
                    elif mat==2 or mat==3 or mat==4:
                        cp=2100
                    self.enthalpy[i]=ti.max(-273.15*cp,self.enthalpy[i]+(1 if kind==2 else -1)*ti.cast(500000,ti.f64)/30/self.mass[i])
                    self.phase(i)
                elif kind==4 and not self.pinned[i]:
                    self.grab[i]=1;self.grab_offset[i]=self.x[i]-point

    @ti.kernel
    def erase_kernel(self,n: ti.i32,point: V3,radius: ti.f32)->ti.i32:
        count=n
        # Erase is an interactive edit, serialized only for deterministic swap removal.
        ti.loop_config(serialize=True)
        for rev in range(n):
            i=n-1-rev
            if i<count and (self.x[i]-point).norm()<radius:
                count-=1
                self.lab.part[i]=self.lab.part[count];self.lab.reference[i]=self.lab.reference[count]
                self.x[i],self.v[i],self.anchor[i]=self.x[count],self.v[count],self.anchor[count]
                self.F[i],self.C[i],self.tau[i]=self.F[count],self.C[count],self.tau[count]
                self.material[i],self.model[i],self.pinned[i]=self.material[count],self.model[count],self.pinned[count]
                self.melted[i]=self.melted[count]
                self.fluid_transition[i],self.fluid_stable[i]=self.fluid_transition[count],self.fluid_stable[count]
                for field in ti.static([self.mass,self.volume,self.inv_mass,self.temp,self.jp,self.dilation,self.yield_strain,self.friction,self.stress,self.plastic,self.enthalpy,self.damage]):
                    field[i]=field[count]
        return count

    def set_press(self,value):
        if isinstance(value.get("enabled"),bool):
            self.press["enabled"]=value["enabled"]
        for key,lo,hi in (("target",self.domain['lower'][1]+min(16,self.domain['size'][1]/2),self.domain['upper'][1]),("speed",1,20)):
            if isinstance(value.get(key),(int,float)) and math.isfinite(value[key]):
                self.press[key]=float(np.clip(value[key],lo,hi))
        if value.get("hold"):
            self.press["target"]=self.press["y"]
        if not self.press["enabled"]:
            self.press["velocity"]=self.press["force"]=0

    def gravity_mode(self):
        mode=self.settings["gravityMode"]
        if mode=="scene":
            mode="self" if self.self_gravity else ("none" if self.space else "uniform")
        return mode if self.settings["gravity"] and self.settings["gravityStrength"]>0 else "none"

    def configure_gravity(self):
        self.gravity_params.from_numpy(np.array([self.settings["gravityStrength"],self.settings["gravitySoftening"]],np.float32))
        self.gravity_direction[None]=DIRECTIONS[self.settings["gravityDirection"]]
        self.gravity_center[None]=self.settings["gravityCenter"]
        return {"none":0,"uniform":1,"self":2,"attract":3,"repel":4}[self.gravity_mode()]

    def command(self,d):
        kind=d.get("type")
        if kind=="reset":
            self.reset(d.get("scene","coupled"))
        elif kind=="settings":
            for key in ("gravity","thermal","ambient","pbfAntiClump","solidAntiClump"):
                if isinstance(d.get("value",{}).get(key),bool):
                    self.settings[key]=d["value"][key]
            for key,lo,hi in (("stiffness",.25,4),("heatRate",1,100),("gravityStrength",0,4),("gravitySoftening",4,32),("timeStepScale",.1,1)):
                value=d.get("value",{}).get(key)
                if isinstance(value,(int,float)) and math.isfinite(value):
                    self.settings[key]=float(np.clip(value,lo,hi))
            value=d.get("value",{})
            if isinstance(value.get("pbfIterations"),int):self.settings["pbfIterations"]=int(np.clip(value["pbfIterations"],1,8))
            if value.get("gravityMode") in ("scene","none","uniform","self","attract","repel"):
                self.settings["gravityMode"]=value["gravityMode"]
            if isinstance(value.get("gravityDirection"),str) and value["gravityDirection"] in DIRECTIONS:
                self.settings["gravityDirection"]=value["gravityDirection"]
            c=value.get("gravityCenter")
            if isinstance(c,list) and len(c)==3 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in c):
                self.settings["gravityCenter"]=[float(np.clip(v,-240,240)) for v in c]
        elif kind=="press":
            self.set_press(d.get("value",{}))
        elif kind=="part":
            return dict(type="operation",ok=self.lab.command(d))
        elif kind=='domain':
            try:
                self.configure_domain(d.get('value'));return dict(type='domain-configured',ok=True)
            except (ValueError,TypeError,OverflowError) as e:return dict(type='domain-configured',ok=False,message=str(e))
        elif kind in ("box","geometry"):
            try:
                part=self.create_geometry(d);return dict(type='created',ok=True,partId=part)
            except (ValueError,TypeError,OverflowError,KeyError,IndexError) as e:return dict(type='created',ok=False,message=str(e))
        elif kind in ("brush","drag-start","drag"):
            point=d.get("point",[])
            if len(point)!=3 or not all(isinstance(v,(int,float)) and math.isfinite(v) and abs(v)<1000 for v in point):
                return None
            radius=float(np.clip(d.get("radius",9),1,50))
            if kind=="drag":
                self.drag_point=point
            elif kind=="drag-start":
                self.grab.fill(0);self.brush_kernel(self.count,4,point,radius);self.drag_point=point
            elif d.get("tool")=="erase":
                self.count=self.erase_kernel(self.count,point,radius);self.drag_point=None
            else:
                tool={"release":0,"anchor":1,"heat":2,"cool":3}.get(d.get("tool"))
                if tool is not None:
                    self.brush_kernel(self.count,tool,point,radius);self.nonuniform_heat=True
        elif kind=="drag-end":
            self.drag_point=None
        return None

    def step(self,dt=1/60):
        start=time.perf_counter();self.profile=dict(gravity=0,constitutive=0,transfer=0,grid=0,fluid=0,thermal=0,diagnostics=0,other=0,total=0)
        self.impulse[None]=0;self.heat_total[None]=0
        remaining,steps=dt,0
        def measured(key,fn):
            before=time.perf_counter();fn();ti.sync();self.profile[key]+=(time.perf_counter()-before)*1000
        gravity_mode=self.configure_gravity()
        if gravity_mode==2 and self.count:
            measured("gravity",lambda:self.gravity.build(self))
        while remaining>1e-9 and steps<48:
            measured("constitutive",lambda:self.prepare(self.count,self.settings["stiffness"]))
            limits=self.limits.to_numpy();h=min(remaining,float(limits[0])*self.settings["timeStepScale"]);has_fluid=bool(limits[2]);has_solid=bool(limits[3])
            transitioning=bool(limits[4])
            if transitioning:
                measured("fluid",lambda:(self.clear_neighbors(),self.build_neighbors(self.count),self.fluid_baselines(self.count)))
            p=self.press
            p["velocity"]=float(np.clip((max(p["target"],float(limits[1]))-p["y"])/h,-p["speed"],p["speed"])) if p["enabled"] else 0.0
            p["y"]+=p["velocity"]*h
            self.forces(self.count,h,gravity_mode,int(self.drag_point is not None),self.drag_point or [0,0,0])
            if has_solid:
                measured("transfer",lambda:(self.clear_grid(),self.p2g(self.count,h)))
                measured("grid",lambda:self.grid_step(int(p["enabled"]),p["y"],p["velocity"]))
                # G2P includes F update and plastic return; the UI labels this combined cost.
                measured("transfer",lambda:self.g2p(self.count,h))
            def fluids():
                if has_fluid:
                    self.clear_neighbors();self.build_neighbors(self.count)
                    for _ in range(self.settings["pbfIterations"]):
                        self.density(self.count);self.corrections(self.count,int(self.settings["pbfAntiClump"]),h,self.settings["pbfIterations"],int(transitioning));self.apply_corrections(self.count,1,int(p["enabled"]),p["y"],int(transitioning))
                    if transitioning:self.finish_fluid_transition(self.count,h,self.settings["pbfIterations"])
                else:
                    self.apply_corrections(self.count,0,int(p["enabled"]),p["y"],0)
                self.velocities(self.count,h)
                if has_fluid:
                    self.viscosity(self.count)
                self.contacts(self.count,int(has_fluid),int(p["enabled"]),p["y"],p["velocity"])
            measured("fluid",fluids)
            if has_solid and self.settings['solidAntiClump']:
                measured("grid",lambda:self.regularize_solids(h))
            remaining-=h;steps+=1
        advanced=dt-remaining;self.time+=advanced;self.substeps=steps
        self.press["force"]=float(self.impulse[None])/advanced if advanced else 0.0
        if self.press["enabled"]:
            self.history.append([self.press["origin"]-self.press["y"],self.press["force"]]);self.history=self.history[-300:]
        if self.settings["thermal"] and (self.nonuniform_heat or self.settings["ambient"]):
            def thermal():
                self.clear_neighbors();self.build_neighbors(self.count)
                self.heat_budget(self.count,advanced,self.settings["heatRate"])
                self.heat_exchange(self.count,advanced,self.settings["heatRate"])
                self.heat_apply(self.count,advanced,int(self.settings["ambient"]))
            measured("thermal",thermal)
        measured("diagnostics",lambda:self.prepare(self.count,self.settings["stiffness"]))
        self.profile["total"]=(time.perf_counter()-start)*1000
        self.profile["other"]=max(0,self.profile["total"]-sum(v for k,v in self.profile.items() if k not in ("total","other")))

    @ti.kernel
    def pack(self,n: ti.i32,stride: ti.i32,data: ti.types.ndarray(dtype=ti.f32,ndim=2)):
        for k in range(26):
            self.reduction[k]=0
        self.reduction[6],self.reduction[7],self.reduction[8]=1e30,-1e30,1
        for i in range(n):
            row=i//stride
            # One deterministic sample per block; hashing avoids lattice stripes.
            hashed=ti.cast(row,ti.u32)*ti.u32(747796405)+ti.u32(2891336453)
            hashed=((hashed >> ((hashed >> 28)+4)) ^ hashed)*ti.u32(277803737)
            hashed=(hashed >> 22) ^ hashed
            chosen=ti.cast(hashed % ti.cast(ti.min(stride,n-row*stride),ti.u32),ti.i32)
            if i % stride == chosen:
                for a in ti.static(range(3)):
                    data[row,a]=self.x[i][a]
                data[row,3]=self.material[i]
                if self.material[i]==11:
                    data[row,3]+=self.model[i]
                if self.melted[i]:
                    data[row,3]=23
                data[row,4],data[row,5],data[row,6],data[row,7]=self.temp[i],self.pinned[i],self.stress[i],self.plastic[i]
            # Validate every simulated particle, including those not previewed.
            if not (self.x[i].norm_sqr()<1e20 and self.v[i].norm_sqr()<1e20):
                self.reduction[25]+=1
            self.reduction[0]+=self.mass[i]
            self.reduction[1]+=self.mass[i]*self.enthalpy[i]
            if self.is_solid(i):
                self.reduction[2]+=1
                self.reduction[12+self.model[i]]+=1
                ti.atomic_min(self.reduction[8],self.F[i].determinant())
            else:
                self.reduction[3]+=1
            ti.atomic_min(self.reduction[6],self.temp[i]);ti.atomic_max(self.reduction[7],self.temp[i])
            ti.atomic_max(self.reduction[9],self.stress[i]);ti.atomic_max(self.reduction[10],self.plastic[i])

    def snapshot(self):
        stride=max(1,math.ceil(self.count/PREVIEW_LIMIT))
        render_count=math.ceil(self.count/stride)
        data=np.empty((render_count,8),dtype=np.float32)
        self.pack(self.count,stride,data)
        r=self.reduction.to_numpy()
        self.nonuniform_heat=bool(r[7]-r[6]>1e-9)
        result=dict(domain=self.domain,parts=self.lab.snapshot(),count=self.count,capacity=self.capacity,renderCount=render_count,sampleStride=stride,
                    scene=self.scene,space=self.space,selfGravity=self.gravity_mode()=="self",gravityMode=self.gravity_mode(),gravityStrength=self.settings["gravityStrength"],models=[int(x) for x in r[12:12+MODEL_COUNT]],time=self.time,
                    mass=float(r[0]),energy=float(r[1]),solids=int(r[2]),liquids=int(r[3]),
                    min=float(r[6]) if self.count else 0,max=float(r[7]) if self.count else 0,
                    heat=float(self.heat_total[None]),substeps=self.substeps,minJ=float(r[8]),
                    profile=self.profile,maxStress=float(r[9]),maxPlastic=float(r[10]),press=self.press.copy(),history=self.history)
        if r[25] or not np.isfinite(data).all() or not all(math.isfinite(float(result[k])) for k in ("mass","energy","minJ")):
            raise RuntimeError("Non-finite GPU state; simulation stopped")
        return result,data
