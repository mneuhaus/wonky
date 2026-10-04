# /// script
# dependencies = ["sympy==1.13.3"]
# ///
"""Independent Cartesian slice integration, not the kernel's Green formula."""
import hashlib,json,pathlib
import sympy as s
x,y,z=s.symbols('x y z',positive=True)
radii=[s.Integer(12),s.Integer(55),112+40*s.sqrt(3),112-40*s.sqrt(3)]
rows=[]
for r2 in radii:
    radius=s.sqrt(r2)
    # Substitute x = radius*sin(t) into the Cartesian upper semicircle.
    # Jacobian cancels the radical; integration is independently Cartesian.
    t=s.symbols('t',real=True)
    half=s.simplify(s.integrate(radius**2*s.cos(t)**2,(t,-s.pi/2,s.pi/2)))
    quarter=s.simplify(s.integrate(radius**2*s.cos(t)**2,(t,0,s.pi/2)))
    assert s.simplify(half-r2*s.pi/2)==0
    # An offset vertical cut: integrate the strip's Cartesian heights.
    primitive=s.integrate(2*s.sqrt(z-x*x),x)
    cap=s.simplify(primitive.subs({x:s.sqrt(z)})-primitive.subs({x:1}))
    cap=s.simplify(cap.subs(z,r2))
    coeff=lambda value:[str(s.expand(value/s.pi).coeff(s.sqrt(3),0)),str(s.expand(value/s.pi).coeff(s.sqrt(3)))]
    rows.append({'r2':str(r2),'half_pi':coeff(half),'quarter_pi':coeff(quarter),
                 'full_area':str(s.N(2*half,40)), 'offset_cap':str(s.N(cap,40))})
# Sum-of-two-rational-squares obstruction: primes congruent to 3 mod 4 must
# have even valuation. 11 has odd valuation in 55, unchanged by clearing a
# rational square denominator. This independently disproves a rational anchor.
factors=s.factorint(55)
assert factors[11]%2 and 11%4==3
print(json.dumps({'provenance':{'script_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'sympy':s.__version__},'rows':rows,'obstruction':{'prime':11,'valuation':factors[11]}},indent=2))
