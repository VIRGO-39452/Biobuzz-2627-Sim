import re, sys, collections
path = sys.argv[1]
prod = {}; pdf = {}; pdform = {}; nauo = []
buf = ''
keep = ('PRODUCT(', 'PRODUCT_DEFINITION(', 'PRODUCT_DEFINITION_FORMATION', 'NEXT_ASSEMBLY_USAGE_OCCURRENCE(')
with open(path, 'r', errors='replace') as f:
    for line in f:
        if not buf and not line.startswith('#'): continue
        buf += line.rstrip('\n')
        if not buf.endswith(';'): 
            if len(buf) > 4000 and not any(k in buf[:80] for k in keep): 
                # skip long irrelevant entity quickly
                while not line.rstrip().endswith(';'):
                    line = f.readline()
                buf = ''
            continue
        s = buf; buf = ''
        m = re.match(r"#(\d+)=(\w+)\((.*)\);$", s)
        if not m: continue
        i, t, a = m.groups()
        if t == 'PRODUCT':
            prod[i] = re.match(r"'([^']*)'", a).group(1)
        elif t.startswith('PRODUCT_DEFINITION_FORMATION'):
            pdform[i] = re.findall(r"#(\d+)", a)[0]
        elif t == 'PRODUCT_DEFINITION':
            pdf[i] = re.findall(r"#(\d+)", a)[0]
        elif t == 'NEXT_ASSEMBLY_USAGE_OCCURRENCE':
            r = re.findall(r"#(\d+)", a); nauo.append((r[0], r[1]))
name = lambda d: prod[pdform[pdf[d]]]
children = collections.defaultdict(list); has_parent = set()
for p, c in nauo: children[p].append(c); has_parent.add(c)
roots = [d for d in pdf if d not in has_parent]
maxd = int(sys.argv[2]) if len(sys.argv) > 2 else 3
def show(d, depth):
    cnt = collections.Counter(name(c) for c in children[d])
    seen = set()
    for c in children[d]:
        n = name(c)
        if n in seen: continue
        seen.add(n)
        print('  ' * depth + f"{n} x{cnt[n]}" + (f"  [{len(children[c])} children]" if children[c] else ''))
        if depth < maxd: show(c, depth + 1)
for r in roots:
    print(name(r), f"[{len(children[r])} children]"); show(r, 1)
