"""Run against the local service with no browser GPU session connected."""
import json
import struct
import unittest
import os
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

URI=f"ws://127.0.0.1:{int(os.environ.get('SUMMER_TEST_GPU_PORT','8765'))}"
ORIGIN="http://127.0.0.1:5173"


async def frame(ws,predicate=lambda x:True):
    for _ in range(30):
        raw=await ws.recv()
        if isinstance(raw,str):
            message=json.loads(raw)
            if message.get("type")=="error":
                raise AssertionError(message)
            continue
        size=struct.unpack_from("<I",raw)[0];offset=4+(size+3)//4*4
        meta=json.loads(raw[4:4+size]);assert len(raw)==offset+meta.get("renderCount",meta["count"])*32
        await ws.send('{"type":"ack"}')
        if predicate(meta):
            return meta
    raise AssertionError("Expected frame not received")


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_custom_phase_protocol_and_cooling(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            ready=json.loads(await ws.recv());self.assertIn('customPhaseChange',ready['features']);self.assertIn('stablePhaseHandoff',ready['features'])
            await ws.send(json.dumps(dict(type='init',scene='empty')))
            await ws.send(json.dumps(dict(type='pause',value=True)));await frame(ws,lambda x:x['paused'])
            await ws.send(json.dumps(dict(type='geometry',a=[0,0,0],b=[4,4,4],material=11,model=10,temperature=180,phaseChange=dict(enabled=True,meltingPoint=120,latentHeat=120000))))
            molten=await frame(ws,lambda x:x['count']==8);self.assertEqual(molten['liquids'],8);self.assertEqual(molten['solids'],0)
            for _ in range(16):await ws.send(json.dumps(dict(type='brush',tool='cool',point=[2,2,2],radius=8)))
            frozen=await frame(ws,lambda x:x['solids']==8);self.assertEqual(frozen['models'][10],8)
            self.assertEqual(frozen['mass'],molten['mass']);self.assertLess(frozen['energy'],molten['energy'])

    async def test_thermal_models_and_parameter_rejection(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            await ws.recv();await ws.send(json.dumps(dict(type='init',scene='empty')))
            await ws.send(json.dumps(dict(type='pause',value=True)));await frame(ws,lambda x:x['paused'])
            for model in [10,11]:
                x=-20 if model==10 else 20
                await ws.send(json.dumps(dict(type='geometry',a=[x-4,0,-4],b=[x+4,8,4],material=11,model=model,thermalMaterial=dict(Q=40000),sampling=dict(enabled=True,seed=42))))
                created=await frame(ws,lambda s:s['count']==27*(model-9));self.assertEqual(created['models'][model],27)
            await ws.send(json.dumps(dict(type='geometry',a=[0,0,20],b=[8,8,28],material=11,model=11,thermalMaterial=dict(Q=-1))))
            for _ in range(20):
                raw=await ws.recv()
                if isinstance(raw,str):
                    d=json.loads(raw)
                    if d.get('type')=='created':self.assertFalse(d['ok']);break
                else:await ws.send('{"type":"ack"}')
            else:self.fail('Missing invalid-parameter rejection')
            await ws.send(json.dumps(dict(type='step')));stepped=await frame(ws,lambda s:s['time']>0)
            self.assertEqual(stepped['count'],54);self.assertTrue(stepped['paused'])

    async def test_pressure_models_and_parameter_rejection(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            await ws.recv();await ws.send(json.dumps(dict(type='init',scene='empty')))
            await ws.send(json.dumps(dict(type='pause',value=True)));await frame(ws,lambda x:x['paused'])
            for model in [8,9]:
                x=-20 if model==8 else 20
                await ws.send(json.dumps(dict(type='geometry',a=[x-4,0,-4],b=[x+4,8,4],material=11,model=model,pressure=dict(alpha=2),sampling=dict(enabled=True,seed=42))))
                created=await frame(ws,lambda s:s['count']==27*(model-7));self.assertEqual(created['models'][model],27)
            await ws.send(json.dumps(dict(type='geometry',a=[0,0,20],b=[8,8,28],material=11,model=9,pressure=dict(epsD=0))))
            for _ in range(20):
                raw=await ws.recv()
                if isinstance(raw,str):
                    d=json.loads(raw)
                    if d.get('type')=='created':self.assertFalse(d['ok']);break
                else:await ws.send('{"type":"ack"}')
            else:self.fail('Missing invalid-parameter rejection')
            await ws.send(json.dumps(dict(type='step')));stepped=await frame(ws,lambda s:s['time']>0)
            self.assertEqual(stepped['count'],54);self.assertTrue(stepped['paused'])

    async def test_new_material_parameters_through_protocol(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            await ws.recv()
            await ws.send(json.dumps(dict(type='init',scene='empty')))
            await ws.send(json.dumps(dict(type='pause',value=True)))
            await frame(ws,lambda x:x['paused'])
            for model in range(4,8):
                x=-40+(model-4)*24
                await ws.send(json.dumps(dict(type='geometry',a=[x,0,-4],b=[x+8,8,4],material=11,model=model,plasticity=dict(A=.01,B=.2,C=.04),temperature=650)))
                created=await frame(ws,lambda s:s['count']==27*(model-3))
                self.assertEqual(created['models'][model],27)
            await ws.send(json.dumps(dict(type='geometry',a=[-4,0,20],b=[4,8,28],material=11,model=6,plasticity=dict(Tm=20))))
            for _ in range(20):
                raw=await ws.recv()
                if isinstance(raw,str):
                    d=json.loads(raw)
                    if d.get('type')=='created':
                        self.assertFalse(d['ok']);break
                else:await ws.send('{"type":"ack"}')
            else:self.fail('Missing invalid-parameter rejection')
            await ws.send(json.dumps(dict(type='step')))
            stepped=await frame(ws,lambda x:x['time']>0)
            self.assertEqual(stepped['count'],108);self.assertTrue(stepped['paused'])

    async def test_parts_timed_run_and_single_step(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            await ws.recv()
            await ws.send(json.dumps(dict(type='init',scene='empty')))
            await ws.send(json.dumps(dict(type='pause',value=True)))
            await frame(ws,lambda x:x['paused'])
            await ws.send(json.dumps(dict(type='geometry',a=[-4,0,-4],b=[4,8,4],material=2,name='Probe',velocity=[3,0,0])))
            created=await frame(ws,lambda x:x['count']==27)
            self.assertEqual(created['parts'][0]['name'],'Probe')
            self.assertAlmostEqual(created['parts'][0]['kinetic'],121.5)
            await ws.send(json.dumps(dict(type='settings',value=dict(gravity=False))))
            await ws.send(json.dumps(dict(type='run',duration=.023)))
            stopped=await frame(ws,lambda x:x['run']['status']=='completed')
            # Init and pause are separate messages: init may advance one frame.
            self.assertTrue(stopped['paused']);self.assertAlmostEqual(stopped['time']-created['time'],.023,places=8)
            await ws.send(json.dumps(dict(type='step')))
            stepped=await frame(ws,lambda x:x['time']>stopped['time']+1e-5)
            self.assertTrue(stepped['paused']);self.assertAlmostEqual(stepped['time']-stopped['time'],1/60,places=8)
            await ws.send(json.dumps(dict(type='part',id=1,action='rename',name='Renamed')))
            renamed=await frame(ws,lambda x:x['parts'][0]['name']=='Renamed')
            self.assertAlmostEqual(renamed['time'],stepped['time'])

    async def test_planet_and_sampled_million_frames(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            self.assertEqual(json.loads(await ws.recv())["type"],"ready")
            await ws.send(json.dumps(dict(type="init",scene="planet")))
            planet=await frame(ws)
            self.assertEqual(planet["count"],20000)
            self.assertEqual(planet["renderCount"],20000)
            self.assertEqual(planet["solids"],0)
            self.assertTrue(planet["selfGravity"])
            await ws.send(json.dumps(dict(type="reset",scene="million")))
            big=await frame(ws,lambda x:x["count"]==1_000_000)
            self.assertEqual(big["renderCount"],100_000)
            self.assertEqual(big["capacity"],1_000_000)
            self.assertEqual(big["mass"],1_000_000)
            self.assertGreater(big["time"],0)

    async def test_origin_restriction(self):
        with self.assertRaises(InvalidStatus):
            async with connect(URI,origin="https://example.invalid"):
                pass

    async def test_session_commands_and_exclusivity(self):
        async with connect(URI,origin=ORIGIN,max_size=4_000_000) as ws:
            ready=json.loads(await ws.recv());self.assertEqual(ready["type"],"ready")
            self.assertEqual(ready["backend"]["arch"],"cuda")
            async with connect(URI,origin=ORIGIN) as other:
                rejected=json.loads(await other.recv());self.assertEqual(rejected["type"],"error")
            await ws.send(json.dumps(dict(type="init",scene="empty")))
            await ws.send(json.dumps(dict(type="pause",value=True)))
            empty=await frame(ws);self.assertEqual(empty["count"],0)
            await ws.send(json.dumps(dict(type="box",a=[-4,0,-4],b=[4,8,4],material=11,model=2,temperature=20)))
            created=await frame(ws,lambda x:x["count"]==27);self.assertEqual(created["models"],[0,0,27,0,0,0,0,0,0,0,0,0])
            await ws.send(json.dumps(dict(type="settings",value=dict(gravityMode="repel",gravityStrength=.5,gravityCenter=[4,5,6]))))
            changed=await frame(ws,lambda x:x.get("gravityMode")=="repel")
            self.assertEqual(changed["count"],27);self.assertEqual(changed["gravityStrength"],.5)
            self.assertEqual(changed["time"],0)
            await ws.send(json.dumps(dict(type="press",value=dict(enabled=True,target=-20))))
            paused=await frame(ws,lambda x:x["press"]["enabled"]);self.assertEqual(paused["press"]["y"],64)
            await ws.send(json.dumps(dict(type="pause",value=False)))
            moving=await frame(ws,lambda x:x["time"]>0);self.assertLess(moving["press"]["y"],64)
            await ws.send(json.dumps(dict(type="reset",scene="empty")))
            reset=await frame(ws,lambda x:x["count"]==0);self.assertFalse(reset["press"]["enabled"])


if __name__=="__main__":
    unittest.main(verbosity=2)
