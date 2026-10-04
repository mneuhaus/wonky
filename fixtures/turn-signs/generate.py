# /// script
# dependencies = ["sympy==1.14.0"]
# ///
# Run from repository root: uv run fixtures/turn-signs/generate.py
import sympy as s, random, json, hashlib, pathlib, time
rng=random.Random(20261003)
angles=[0,90,180,270,360,30,45,60,15,75,120,135,36,72,10,40,1,7,17,23]
# Denominator is fixed, so every oracle expression is an exact rational combination.
rows=[]; start=time.monotonic(); cached={}
for i in range(10000):
    # Degree 48 signs are sampled explicitly; low-degree classes supply the bulk.
    deg=angles[i%16] if i<9900 else angles[16+i%4]
    a,b,c=rng.randint(-9,9),rng.randint(-9,9),rng.randint(-120,120)
    if i%100==0: deg,a,b,c=60,1,0,-6 # cos60 - 1/2, denominator12
    co,si=cached.setdefault(deg,(s.cos(s.pi*s.Rational(deg,180)),s.sin(s.pi*s.Rational(deg,180))))
    expr=a*co+b*si+s.Rational(c,12)
    answer=s.sign(expr)
    if answer not in [-1,0,1]: raise RuntimeError((i,expr,answer))
    rows.append(f'{deg} {a} {b} {c} {int(answer)}\n')
    if (i+1)%1000==0: print(f'{i+1}/10000 {time.monotonic()-start:.3f}s',flush=True)
path=pathlib.Path('fixtures/turn-signs/sympy.tsv');path.write_text(''.join(rows))
source=pathlib.Path(__file__).read_bytes()
pathlib.Path('fixtures/turn-signs/provenance.json').write_text(json.dumps({'origin':'SymPy exact sign(a*cos(degree*pi/180)+b*sin(degree*pi/180)+c/12)','sympyVersion':s.__version__,'seed':20261003,'count':10000,'dataSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'generatorSha256':hashlib.sha256(source).hexdigest(),'denominator':12},indent=2)+'\n')
