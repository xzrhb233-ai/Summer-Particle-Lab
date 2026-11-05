"""Framework contracts, native field views and transaction fan-out (no GPU)."""
import unittest
from mpm_framework import DeviceDomains,DomainView,DeviceTransaction,MPMFramework

class FrameworkTests(unittest.TestCase):
    def test_shared_views_and_identity(self):
        fields={'position':object()};registry=DeviceDomains()
        a=registry.register(DomainView('solid','mpm',4,fields));b=registry.register(DomainView('water','pbf',5,fields,start=4))
        self.assertIs(a.fields['position'],b.fields['position'])
        self.assertEqual(registry.describe()[1]['start'],4)
        with self.assertRaises(ValueError):registry.register(DomainView('solid','fem',3,{}))
    def test_transaction_captures_and_restores_every_participant(self):
        calls=[];tx=DeviceTransaction(lambda restore:calls.append(('particles-fem',restore)),lambda restore:calls.append(('thermal',restore)),lambda restore:calls.append(('rigid-ledgers',restore)))
        tx.checkpoint();tx.checkpoint(True)
        self.assertEqual(calls,[(n,r) for r in [False,True] for n in ['particles-fem','thermal','rigid-ledgers']])
    def test_global_clock_advances_after_all_domains_and_coupling(self):
        calls=[]
        class Owner:
            def capture_motion(self):calls.append('capture')
            def check_motion(self):calls.append('motion')
            def validate_state(self,h):calls.append('validate')
            def advance_clock(self,h):calls.append('clock')
        class Domain:
            def __init__(self,name):self.name=name
            def predict(self,h):calls.append(self.name+'-predict')
            def advance(self,h):calls.append(self.name+'-advance')
        class Coupling:
            def mechanical(self,h):calls.append('contact')
            def thermal(self,h):calls.append('heat')
        root=object.__new__(MPMFramework);root.o=Owner();root.o.c=root.o
        root.operators=[Domain(n) for n in ['mpm','pbf','fem','rigid']];root.coupling=Coupling();root.substep(.001)
        self.assertEqual(calls,['capture']+[n+'-predict' for n in ['mpm','pbf','fem','rigid']]+[n+'-advance' for n in ['mpm','pbf','fem','rigid']]+['contact','heat','motion','validate','clock'])
        def fail(h):raise ValueError('invalid state')
        root.o.validate_state=fail;calls.clear()
        with self.assertRaises(ValueError):root.substep(.001)
        self.assertNotIn('clock',calls)

if __name__=='__main__':unittest.main()
