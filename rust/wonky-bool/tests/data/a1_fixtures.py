"""Frozen G9 oracle. Consumer: tests/a1.rs; feature: A1 SSI branches.
SymPy exact real_roots checks multiplicity and completeness independently.
Regenerate explicitly and review diffs; never regenerate to force green.
"""
import hashlib
import sympy as s
from pathlib import Path
x = s.symbols('x')
rows = []
def emit(kind, args, polynomial):
    p = s.Poly(polynomial, x)
    roots = s.real_roots(p.as_expr(), multiple=False)
    coefficients = [p.nth(i) for i in range(3)]
    rows.append(' '.join(map(str, [kind, *args, *coefficients, len(roots), *(m for _, m in roots)])))
# Plane x cylinder: x=d, with the two roots as generator y coordinates.
for r in range(1, 9):
    for d in (0, r-1, r, r+1, -r):
        emit('PC', [r,d], x*x+d*d-r*r)
# Parallel cylinder x cylinder: first radius r, partner radius s, centre (d,0).
# Coordinate is y on the radical axis x=(r^2-s^2+d^2)/(2d).
for r in range(1, 7):
    for radius, d in ((r,1),(r,2*r),(r,2*r+1),(r+1,1),(r+1,2*r+1)):
        h=s.Rational(r*r-radius*radius+d*d,2*d)
        emit('CC', [r,radius,d], x*x+h*h-r*r)
# Coaxial cylinder x cone r_cone(z)=b+kz, including nonrational heights
# through an exact radial frame scale with square 2 (affine construction).
for r in range(1, 7):
    for b,k in ((0,1),(2,1),(3,-1),(1,2)):
        emit('CK',[r,b,k], r*r-(b+k*x)**2)
# Plane through cone axis gives two generators, independent of apex height.
for b,k in ((0,1),(2,1),(3,-1),(1,2),(4,3),(5,-2)):
    emit('PK',[b,k], x*x-k*k)
# Coaxial cones: both signed meridians are squared (complete double supports).
for b,k,c,j in ((1,1,3,2),(2,1,4,1),(1,2,3,-1),(0,1,0,2),(3,-2,2,1),(2,1,2,-1)):
    emit('KK',[b,k,c,j],(b+k*x)**2-(c+j*x)**2)
# Coincident whole supports: an axial translation leaves a cylinder's implicit
# unchanged; reversing both cone meridian coefficients also leaves its square.
y,z=s.symbols('y z')
for r,h in ((1,-5),(3,0),(7,9)):
    left=x*x+y*y-r*r
    right=x*x+y*y-r*r  # cylinder translated by h along its axis
    assert s.expand(left-right)==0
    rows.append(f'CI {r} {h}')
for b,k in ((0,1),(2,1),(3,-2)):
    assert s.expand((b+k*z)**2-(-b-k*z)**2)==0
    rows.append(f'KI {b} {k}')
out=Path(__file__).with_name('a1-fixtures.txt')
out.write_text('# SymPy '+s.__version__+'; generator sha256='+hashlib.sha256(Path(__file__).read_bytes()).hexdigest()+'; exact coefficients ascending; distinct roots with multiplicities\n'+'\n'.join(rows)+'\n')
print(f'{len(rows)} configurations -> {out}')
