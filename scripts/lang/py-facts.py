"""Static facts about Python CAD files in Marc's corpus (corpus analysis only).

Run through scripts/lang/scan-py.mjs, which feeds a JSON file list on stdin:
  uv run --no-project --offline python scripts/lang/py-facts.py fixtures/lang/b3d-vocab.json < files.json > facts.json

Parses with the stdlib `ast` module and evaluates nothing. Mirrors
scripts/lang/fs-analyze.mjs: besides construct counts it classifies
*geometry-synchronization sites*, places where Python control or data flow
depends on a value only the geometry kernel can produce.

Taint bits
  TOPO    result of a topology selector (.faces(), .edges(), filter_by, ...)
  SELPRED entity list chosen by a host-side geometric predicate (lambda or
          comprehension filter over measured values)
  MEASURE numeric/boolean geometry (bounding_box, volume, area, distance_to, ...)
  FAIL    success/failure of a modeling call (try/except around modeling)

Shape-valued expressions (constructors, operations, shape algebra, helpers that
always return shapes) carry no taint: in a lazy/dataflow core they stay
symbolic, and the synchronization point is recorded where a measured value is
consumed instead.

build123d evaluates every selector eagerly. A selector chain that uses only
built-in filters (Axis, GeomType, Plane, SortBy, indexing) is still expressible
as a lazy symbolic query and is recorded as `entity-selection`; a chain
with a Python lambda or a comprehension filter over measured values needs host
code to run against kernel results and is recorded as `predicate-selection`.

Site kinds mirror fs-analyze.mjs (geo-branch, geo-iterate, geo-data,
failure-branch) plus geo-select (filter_by/sort_by/group_by with a lambda).
Python-specific geo-iterate subs: comprehension-filter, comprehension-map,
measured-values, static-trip (literal containers: trip count known before any
kernel call). Flags: modelingInBranch/modelingInBody, selects, filter, inMap,
carried, pred (see fs-analyze.mjs), inline (entity argument is a selector chain
written at the call).
"""
import ast
import json
import re
import sys
from collections import Counter

VOCAB = json.load(open(sys.argv[1]))
CAT = VOCAB["categories"]
B3D_METHODS = set(VOCAB["methods"])

TOPO, MEASURE, FAIL, SELPRED = 1, 8, 4, 16
GEO = TOPO | MEASURE | SELPRED
# Calls whose result carries no geometry information even with tainted inputs:
# type tests, string formatting, reporting.
NEUTRAL_CALLS = {"isinstance", "hasattr", "type", "callable", "str", "repr", "print", "format", "id", "hash", "getattr",
                 "sorted_keys", "json.dumps", "json.dump", "logging.info", "log"}
NEUTRAL_METHODS = {"keys", "startswith", "endswith", "format", "join", "lower", "upper", "split", "replace", "strip",
                   "write", "write_text", "append", "extend", "update", "setdefault", "copy", "to_json"}

SELECTORS = {"faces", "edges", "vertices", "wires", "solids", "shells", "compounds", "face", "edge", "vertex", "wire",
             "solid", "shell"}
FILTERS = {"filter_by", "filter_by_position", "sort_by", "sort_by_distance", "group_by", "first", "last"}
SHAPELIST_OPS = (ast.BitOr, ast.RShift, ast.LShift)  # |, >>, << on ShapeLists (> < are Compare)
# Measurement sources that are specific to shapes (strong) and ones that are
# only geometric when the base is already known to be a shape (weak).
MEASURE_STRONG = {"bounding_box", "volume", "area", "distance_to", "closest_points", "distance_to_with_closest_points",
                  "is_inside", "is_valid", "normal_at", "oriented_bounding_box", "geom_type", "is_planar",
                  "max_dimension", "principal_properties", "matrix_of_inertia", "position_at", "location_at",
                  "tangent_at", "center_location", "intersect", "is_manifold", "is_closed", "find_intersection_points",
                  "faces_intersected_by_axis", "distance", "is_null", "mass", "compute_mass", "static_moments",
                  "radius_of_gyration", "project_to_shape", "to_axis", "is_coplanar", "is_parallel", "arc_center",
                  "start_point", "end_point", "param_at_point", "radius", "radii", "is_interior", "do_children_intersect"}
MEASURE_WEAK = {"length", "center", "position", "location", "orientation", "width", "height", "normal", "x", "y", "z",
                "X", "Y", "Z", "min", "max", "size", "wrapped"}
PART_MODEL_OPS = {"extrude", "revolve", "loft", "sweep", "fillet", "chamfer", "offset", "mirror", "split", "section",
                  "project", "make_face", "make_hull", "thicken", "scale", "full_round", "add", "draft", "trace",
                  "make_brake_formed", "project_workplane"}
SHAPE_METHOD_OPS = {"fuse", "cut", "intersect", "fillet", "chamfer", "extrude", "revolve", "moved", "located", "move",
                    "locate", "rotate", "translate", "mirror", "offset", "offset_3d", "offset_2d", "split", "shell",
                    "thicken", "scale", "transformed", "hollow", "clean", "fix", "make_holes", "fillet_2d", "chamfer_2d",
                    "project_to_shape", "sweep", "make_loft", "dprism", "extrude_until", "trim"}
# Return annotations that declare a shape-valued helper (Face/Edge/Vertex lists
# are selections, so they are deliberately absent).
SHAPE_RETURN_TYPES = {"Part", "Sketch", "Solid", "Compound", "Shape", "Curve", "Shell"}
FACTORY = re.compile(r"^make_|^extrude|^sweep|^revolve|^thicken")
EXPORT_METHODS = {"export_step", "export_stl", "export_brep", "export_gltf", "export_obj", "export_3mf", "write"}
CHECK_NAME = re.compile(r"(^|/)(test_|check|audit|verify|inspect|render|watch|debug|diag|probe|compare|measure|slice|cache|"
                        r"view|preview|screenshot|report|analy[sz]e|validate|validation|conftest|dump)", re.I)
FS_TEXT = re.compile(r"FeatureScript \d+;|opExtrude\(|newSketchOnPlane\(|qCreatedBy\(|defineFeature\(")


# Selection-predicate vocabulary: which geometric properties a host-side
# predicate reads. range = coordinate/size windows (center, bbox, length, area,
# volume, radius); direction = normals/tangents/dot products; type = geometry
# type or closedness; complex = anything else (is_inside, distance_to, user code).
PRED_RANGE = {"center", "position", "length", "area", "volume", "bounding_box", "min", "max", "X", "Y", "Z", "x", "y", "z",
              "radius", "size", "center_location", "position_at", "start_point", "end_point", "arc_center", "width", "height"}
PRED_TYPE = {"geom_type", "is_closed", "is_planar", "geom_type_name"}
PRED_DIR = {"normal_at", "normal", "direction", "tangent_at", "z_dir", "x_dir", "dot", "is_parallel", "is_perpendicular",
            "normalized", "cross", "get_angle"}
PRED_NEUTRAL_CALLS = {"abs", "min", "max", "round", "len", "any", "all", "float", "int", "math.isclose", "isclose"}


def attr_chain(node):
    """Name.attr.attr -> 'Name.attr.attr' (None when not a plain chain)."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def only_raises(stmts):
    if not stmts:
        return False
    for s in stmts:
        if isinstance(s, (ast.Raise, ast.Pass)):
            continue
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call):
            fn = attr_chain(s.value.func) or ""
            if fn in ("print", "sys.exit", "exit", "warnings.warn", "logging.warning", "logging.error") or fn.endswith(".fail"):
                continue
        if isinstance(s, ast.Return) and (s.value is None or isinstance(s.value, ast.Constant)):
            continue
        return False
    return True


class FileFacts:
    def __init__(self, source, path):
        self.source = source
        self.path = path
        self.lines = source.split("\n")
        self.tree = ast.parse(source, filename=path)
        self.c = Counter()          # constructs
        self.b3d = Counter()        # build123d top-level names referenced
        self.members = Counter()    # Enum/Plane/Axis members (Axis.Z, Mode.SUBTRACT, ...)
        self.methods = Counter()    # b3d methods called
        self.props = Counter()      # b3d measurement attributes read (no call)
        self.imports = set()
        self.b3d_scope = set()      # names bound to build123d objects in this module
        self.b3d_aliases = set()    # `import build123d as bd`
        self.khana = Counter()
        self.sites = []
        self.local_fns = {}
        self.geo_fns = {}           # fn name -> taint bits returned
        self.model_fns = set()      # fns that (transitively) do modeling
        self.shape_fns = set()      # fns whose every return value is a shape
        self.tainted_params = {}    # fn name -> {index: bits}

    # ---- name resolution -------------------------------------------------
    def b3d_name(self, node):
        if isinstance(node, ast.Name) and node.id in self.b3d_scope:
            return node.id
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in self.b3d_aliases:
            return node.attr if node.attr in CAT else None
        return None

    def uses_b3d(self):
        return bool(self.b3d_scope or self.b3d_aliases)

    def is_model_call(self, call):
        name = self.b3d_name(call.func)
        if name:
            cat = CAT.get(name)
            if cat in ("part-object", "sketch-object", "line-object", "builder"):
                return True
            if cat == "operation" and name in PART_MODEL_OPS:
                return True
            if cat == "shape-class":
                return False
        f = call.func
        if isinstance(f, ast.Attribute):
            # Solid.make_box(...), Face.make_rect(...), Wire.make_polygon(...)
            base = self.b3d_name(f.value)
            if base and CAT.get(base) == "shape-class" and FACTORY.search(f.attr):
                return True
            if f.attr in SHAPE_METHOD_OPS and self.uses_b3d():
                return True
        if isinstance(f, ast.Name) and f.id in self.model_fns:
            return True
        return False

    def contains_modeling(self, nodes):
        for n in nodes if isinstance(nodes, list) else [nodes]:
            for m in ast.walk(n):
                if isinstance(m, ast.Call) and self.is_model_call(m):
                    return True
                if isinstance(m, (ast.BinOp, ast.AugAssign)) and self.shape_binop(m):
                    return True
        return False

    # Algebra mode: arithmetic on shape-valued operands.
    def shape_valued(self, node, env_shapes=None):
        env_shapes = env_shapes or set()
        if isinstance(node, ast.Call):
            name = self.b3d_name(node.func)
            if name and CAT.get(name) in ("part-object", "sketch-object", "line-object", "location"):
                return True
            if name and name in PART_MODEL_OPS:
                return True
            if isinstance(node.func, ast.Attribute):
                base = self.b3d_name(node.func.value)
                if base and CAT.get(base) in ("shape-class",) and FACTORY.search(node.func.attr):
                    return True
                if node.func.attr in SHAPE_METHOD_OPS:
                    return True
        if isinstance(node, ast.Name) and node.id in env_shapes:
            return True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in self.shape_fns:
            return True
        if isinstance(node, ast.Attribute):
            if node.attr in ("part", "sketch", "line") and isinstance(node.value, ast.Name):
                return True
            base = self.b3d_name(node.value)
            if base and CAT.get(base) == "geometry-value":  # Plane.XY * Box(...)
                return True
        if isinstance(node, ast.BinOp):
            return self.shape_binop(node, env_shapes)
        return False

    def shape_binop(self, node, env_shapes=None):
        if isinstance(node, ast.AugAssign):
            if isinstance(node.op, (ast.Add, ast.Sub, ast.BitAnd)):
                return self.shape_valued(node.value, env_shapes) or (isinstance(node.target, ast.Name) and node.target.id in (env_shapes or set()))
            return False
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.BitAnd, ast.Mult)):
            return self.shape_valued(node.left, env_shapes) or self.shape_valued(node.right, env_shapes)
        return False

    # ---- pass 1: imports, inventory ---------------------------------------
    def inventory(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.imports.add(a.name.split(".")[0])
                    if a.name == "build123d":
                        self.b3d_aliases.add(a.asname or "build123d")
                        self.c["b3d:importModule"] += 1
            elif isinstance(node, ast.ImportFrom) and node.module:
                mod = node.module.split(".")[0]
                self.imports.add(mod)
                if mod == "build123d":
                    for a in node.names:
                        if a.name == "*":
                            self.b3d_scope |= set(CAT)
                            self.c["b3d:starImport"] += 1
                        else:
                            self.b3d_scope.add(a.asname or a.name)
                            self.c["b3d:namedImport"] += 1
                if mod == "cad_khana":
                    for a in node.names:
                        self.khana[a.name] += 1
                    # cad_khana re-exports build123d in its examples via star import
                    if any(a.name == "*" for a in node.names):
                        self.b3d_scope |= set(CAT)
        for node in self.tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.local_fns[node.name] = node
            if isinstance(node, ast.ClassDef):
                for m in node.body:
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        self.local_fns.setdefault(m.name, m)

    # ---- pass 2: construct counting ---------------------------------------
    def count(self):
        c = self.c
        fn_stack = []

        def visit(node, depth_fn=0, in_class=False):
            t = type(node)
            if t in (ast.FunctionDef, ast.AsyncFunctionDef):
                c["py:function"] += 1
                if depth_fn > 0 and not in_class:
                    c["py:nestedFunction"] += 1
                if in_class:
                    c["py:method"] += 1
                for d in node.decorator_list:
                    dn = attr_chain(d.func if isinstance(d, ast.Call) else d) or "?"
                    c[f"py:decorator:{dn.split('.')[-1]}"] += 1
                if node.args.defaults or node.args.kw_defaults:
                    c["py:defaultArgs"] += 1
                if node.args.vararg or node.args.kwarg:
                    c["py:varargs"] += 1
                if node.returns or any(a.annotation for a in node.args.args):
                    c["py:typeHints"] += 1
                fn_stack.append(node.name)
                for m in ast.walk(node):
                    if isinstance(m, ast.Call) and isinstance(m.func, ast.Name) and m.func.id == node.name and m is not node:
                        c["py:recursion"] += 1
                        break
                for ch in node.body:
                    visit(ch, depth_fn + 1, False)
                fn_stack.pop()
                return
            if t is ast.ClassDef:
                c["py:class"] += 1
                decos = [attr_chain(d.func if isinstance(d, ast.Call) else d) or "?" for d in node.decorator_list]
                if any(d.endswith("dataclass") for d in decos):
                    c["py:dataclass"] += 1
                for b in node.bases:
                    bn = attr_chain(b) or ""
                    if bn in CAT:
                        c[f"py:subclassB3d:{bn}"] += 1
                    elif bn in ("NamedTuple", "typing.NamedTuple"):
                        c["py:namedtuple"] += 1
                    elif bn.endswith("Enum"):
                        c["py:enumClass"] += 1
                for ch in node.body:
                    visit(ch, depth_fn, True)
                return
            if t is ast.Lambda:
                c["py:lambda"] += 1
            elif t in (ast.ListComp, ast.SetComp, ast.GeneratorExp):
                c["py:comprehension"] += 1
                if any(g.ifs for g in node.generators):
                    c["py:comprehensionFilter"] += 1
            elif t is ast.DictComp:
                c["py:dictComprehension"] += 1
            elif t is ast.For:
                c["py:for"] += 1
            elif t is ast.While:
                c["py:while"] += 1
            elif t is ast.If:
                c["py:if"] += 1
            elif t is ast.IfExp:
                c["py:ternary"] += 1
            elif t is ast.Try or t.__name__ == "TryStar":
                c["py:try"] += 1
            elif t is ast.Raise:
                c["py:raise"] += 1
            elif t is ast.Assert:
                c["py:assert"] += 1
            elif t is ast.Match:
                c["py:match"] += 1
            elif t is ast.JoinedStr:
                c["py:fstring"] += 1
            elif t in (ast.Global, ast.Nonlocal):
                c["py:globalNonlocal"] += 1
            elif t is ast.Yield or t is ast.YieldFrom:
                c["py:generator"] += 1
            elif t is ast.Dict:
                c["py:dictLiteral"] += 1
            elif t is ast.Starred:
                c["py:starred"] += 1
            elif t is ast.NamedExpr:
                c["py:walrus"] += 1
            elif t is ast.With:
                builders = []
                for item in node.items:
                    if isinstance(item.context_expr, ast.Call):
                        name = self.b3d_name(item.context_expr.func)
                        if name and CAT.get(name) in ("builder", "location"):
                            builders.append(name)
                            c[f"b3d:with:{name}"] += 1
                            if CAT.get(name) == "location":
                                c["b3d:withLocation"] += 1
                            else:
                                c["b3d:builderMode"] += 1
                        elif name == "Locations" or (name and name.endswith("Locations")):
                            c["b3d:withLocation"] += 1
                if not builders:
                    c["py:with"] += 1
            elif t is ast.Call:
                self.count_call(node)
            elif t is ast.Attribute and isinstance(node.ctx, ast.Load):
                base = self.b3d_name(node.value)
                if base and CAT.get(base) in ("enum", "geometry-value"):
                    self.members[f"{base}.{node.attr}"] += 1
                elif node.attr in MEASURE_STRONG and self.uses_b3d():
                    self.props[node.attr] += 1
                if isinstance(node.value, ast.Name) and node.value.id in ("np", "numpy"):
                    c["py:numpy"] += 1
                if isinstance(node.value, ast.Name) and node.value.id == "math":
                    c["py:math"] += 1
            elif t is ast.Name and isinstance(node.ctx, ast.Load):
                if node.id in self.b3d_scope and node.id in CAT:
                    self.b3d[node.id] += 1
            elif t is ast.BinOp:
                if self.uses_b3d() and self.shape_binop(node, self.module_shapes):
                    op = type(node.op).__name__
                    left_loc = self.is_location_expr(node.left)
                    if isinstance(node.op, ast.Mult):
                        c["b3d:algebra:place" if left_loc else "b3d:algebra:mult"] += 1
                    else:
                        c[{"Add": "b3d:algebra:fuse", "Sub": "b3d:algebra:cut", "BitAnd": "b3d:algebra:intersect"}[op]] += 1
                    c["b3d:algebraMode"] += 1
                elif isinstance(node.op, SHAPELIST_OPS) and self.is_selector_expr(node.left):
                    c[f"b3d:shapelistOp:{type(node.op).__name__}"] += 1
            elif t is ast.AugAssign:
                if self.uses_b3d() and self.shape_binop(node, self.module_shapes):
                    op = type(node.op).__name__
                    c[{"Add": "b3d:algebra:fuse", "Sub": "b3d:algebra:cut", "BitAnd": "b3d:algebra:intersect"}.get(op, "b3d:algebra:other")] += 1
                    c["b3d:algebraMode"] += 1
            elif t is ast.Compare:
                if any(isinstance(o, (ast.Gt, ast.Lt)) for o in node.ops) and self.is_selector_expr(node.left) and \
                        any(self.b3d_name(x) or isinstance(x, ast.Attribute) and self.b3d_name(x.value) for x in node.comparators):
                    c["b3d:shapelistOp:sort"] += 1
            elif t is ast.Subscript:
                if self.is_selector_expr(node.value):
                    c["b3d:selectIndex"] += 1
            for ch in ast.iter_child_nodes(node):
                visit(ch, depth_fn, in_class if t is not ast.ClassDef else True)

        self.module_shapes = self.collect_shapes(self.tree)
        for n in self.tree.body:
            visit(n)

    def is_location_expr(self, node):
        if isinstance(node, ast.Call):
            name = self.b3d_name(node.func)
            return bool(name and CAT.get(name) in ("location",))
        if isinstance(node, ast.Attribute):
            base = self.b3d_name(node.value)
            return bool(base and base in ("Plane",))
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            return self.is_location_expr(node.left) and self.is_location_expr(node.right)
        return False

    def is_selector_expr(self, node):
        while True:
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Attribute) and (f.attr in SELECTORS or f.attr in FILTERS):
                    return True
                if isinstance(f, ast.Name) and f.id in SELECTORS and f.id in self.b3d_scope:
                    return True  # builder-mode free functions: edges(), faces()
                return False
            if isinstance(node, ast.Subscript):
                node = node.value
                continue
            if isinstance(node, ast.BinOp) and isinstance(node.op, SHAPELIST_OPS):
                node = node.left
                continue
            return False

    def is_locationish(self, node, shapes):
        """Pure placement values (Location/Pos/Rot/Plane products): arithmetic, not geometry."""
        if isinstance(node, ast.Call):
            name = self.b3d_name(node.func)
            if name and CAT.get(name) == "location":
                return True
            if isinstance(node.func, ast.Attribute) and node.func.attr in ("inverse", "rotated", "moved") and \
                    self.is_locationish(node.func.value, shapes):
                return True
            return False
        if isinstance(node, ast.Name):
            return f"loc:{node.id}" in shapes
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            return self.is_locationish(node.left, shapes) and self.is_locationish(node.right, shapes)
        if isinstance(node, ast.Attribute):
            base = self.b3d_name(node.value)
            return bool(base == "Plane")
        return False

    def collect_shapes(self, scope):
        shapes = set()
        for _ in range(2):
            for n in ast.walk(scope):
                if isinstance(n, ast.Assign) and self.is_locationish(n.value, shapes):
                    for tgt in n.targets:
                        if isinstance(tgt, ast.Name):
                            shapes.add(f"loc:{tgt.id}")
                    continue
                if isinstance(n, ast.Assign) and self.shape_valued(n.value, shapes):
                    for tgt in n.targets:
                        if isinstance(tgt, ast.Name):
                            shapes.add(tgt.id)
                if isinstance(n, ast.withitem) and n.optional_vars is not None and isinstance(n.context_expr, ast.Call):
                    name = self.b3d_name(n.context_expr.func)
                    if name and CAT.get(name) == "builder" and isinstance(n.optional_vars, ast.Name):
                        shapes.add(n.optional_vars.id)
        return shapes

    def count_call(self, node):
        c = self.c
        name = self.b3d_name(node.func)
        f = node.func
        if name:
            cat = CAT.get(name)
            c[f"b3d:call:{cat}"] += 1
            if cat == "export":
                c["b3d:export"] += 1
            if cat == "import":
                c["b3d:importGeometry"] += 1
            for kw in node.keywords:
                if kw.arg == "mode":
                    mv = attr_chain(kw.value) or "?"
                    c[f"b3d:mode:{mv.split('.')[-1]}"] += 1
                if kw.arg == "align":
                    c["b3d:alignKw"] += 1
        if isinstance(f, ast.Attribute):
            if f.attr in B3D_METHODS and self.uses_b3d():
                self.methods[f.attr] += 1
            if f.attr in SELECTORS and node.args:
                a = attr_chain(node.args[0]) or ""
                if a.startswith("Select."):
                    c[f"b3d:select:{a.split('.')[-1]}"] += 1
            if f.attr in ("filter_by", "sort_by", "group_by") and node.args:
                a = node.args[0]
                kind = "lambda" if isinstance(a, ast.Lambda) else (attr_chain(a) or type(a).__name__).split(".")[0]
                if isinstance(a, ast.Name) and a.id in self.local_fns:
                    kind = "function"
                c[f"b3d:{f.attr}:{kind}"] += 1
            if f.attr in EXPORT_METHODS and self.uses_b3d():
                c["b3d:export"] += 1
            chain = attr_chain(f) or ""
            if chain.startswith(("np.", "numpy.")):
                c["py:numpy"] += 1
            if chain.startswith("ocp_vscode.") or chain in ("show", "show_object"):
                c["b3d:viewer"] += 1
            if chain.startswith("subprocess."):
                c["py:subprocess"] += 1
        if isinstance(f, ast.Name):
            if f.id in ("show", "show_object", "show_all") and "ocp_vscode" in self.imports:
                c["b3d:viewer"] += 1
            if f.id in self.local_fns:
                c["py:userCall"] += 1
            if f.id in ("open",):
                c["py:fileIO"] += 1

    # ---- pass 3: taint + sites --------------------------------------------
    def expr_taint(self, node, env, shapes):
        """Bits of geometry-derived information carried by an expression."""
        if node is None:
            return 0
        t = type(node)
        if t is ast.Name:
            return env.get(node.id, 0)
        if t is ast.Constant or t is ast.Lambda or t is ast.JoinedStr:
            return 0
        if t is ast.Attribute:
            base_bits = self.expr_taint(node.value, env, shapes)
            if node.attr in MEASURE_STRONG and self.uses_b3d():
                return (base_bits & ~(TOPO | SELPRED)) | MEASURE
            if node.attr in MEASURE_WEAK and not self.is_locationish(node.value, shapes) and \
                    (base_bits or self.shape_valued(node.value, shapes)):
                return (base_bits & ~(TOPO | SELPRED)) | MEASURE
            return base_bits
        if t is ast.Call:
            f = node.func
            bits = 0
            if (attr_chain(f) or "") in NEUTRAL_CALLS:
                return 0
            if isinstance(f, ast.Attribute):
                base_bits = self.expr_taint(f.value, env, shapes)
                if f.attr in SELECTORS and self.uses_b3d():
                    return TOPO | (base_bits & MEASURE)
                if f.attr in FILTERS and (base_bits & TOPO or self.is_selector_expr(f.value)):
                    extra = 0
                    for a in node.args:
                        if isinstance(a, ast.Lambda):
                            extra |= SELPRED  # host-side predicate reads geometry
                    return TOPO | base_bits | extra
                if f.attr in NEUTRAL_METHODS:
                    return 0
                if f.attr in MEASURE_STRONG and self.uses_b3d():
                    return MEASURE | (base_bits & ~(TOPO | SELPRED))
                if f.attr in MEASURE_WEAK and not self.is_locationish(f.value, shapes) and \
                        (base_bits or self.shape_valued(f.value, shapes)):
                    return MEASURE | (base_bits & ~(TOPO | SELPRED))
                if f.attr in SHAPE_METHOD_OPS or self.is_model_call(node):
                    return 0  # a new shape: symbolic in a lazy core
                bits |= base_bits
            elif isinstance(f, ast.Name):
                if f.id in SELECTORS and f.id in self.b3d_scope:
                    return TOPO
                if f.id in NEUTRAL_CALLS:
                    return 0
                if f.id == "len":
                    return self.expr_taint(node.args[0], env, shapes) if node.args else 0
                if f.id in self.shape_fns:
                    return 0  # returns a (symbolic) shape
                if f.id in self.geo_fns:
                    bits |= self.geo_fns[f.id]
                name = self.b3d_name(f)
                if name and CAT.get(name) in ("part-object", "sketch-object", "line-object", "builder") or \
                        (name and name in PART_MODEL_OPS):
                    return 0
            for a in node.args:
                bits |= self.expr_taint(a, env, shapes)
            for kw in node.keywords:
                bits |= self.expr_taint(kw.value, env, shapes)
            return bits
        if t in (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp):
            bits = 0
            inner = dict(env)
            for g in node.generators:
                gb = self.expr_taint(g.iter, inner, shapes)
                bits |= gb
                self.assign_loop(g.target, g.iter, inner, shapes, lambda tgt, b: [inner.__setitem__(x.id, b) for x in ast.walk(tgt) if isinstance(x, ast.Name)])
                for cond in g.ifs:
                    if gb & TOPO and self.expr_taint(cond, inner, shapes) & (MEASURE | SELPRED):
                        bits |= SELPRED  # entities chosen by a host-side geometric predicate
            elt = node.elt if t is not ast.DictComp else node.value
            bits |= self.expr_taint(elt, inner, shapes)
            return bits
        if t is ast.Subscript:
            return self.expr_taint(node.value, env, shapes) | (self.expr_taint(node.slice, env, shapes) & MEASURE)
        if t is ast.BinOp and self.uses_b3d() and self.shape_binop(node, shapes):
            return 0  # shape algebra yields a new (symbolic) shape
        bits = 0
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, (ast.expr_context, ast.operator, ast.cmpop, ast.boolop, ast.unaryop)):
                continue
            bits |= self.expr_taint(ch, env, shapes)
        return bits

    def run_scope(self, key, scope, params, collect=None):
        env = {}
        pt = self.tainted_params.get(key, {})
        for i, p in enumerate(params):
            if pt.get(i):
                env[p] = pt[i]
        shapes = self.collect_shapes(scope)
        returned = 0
        body = scope.body if hasattr(scope, "body") else []

        def assign(target, bits):
            # Taint bound names; for `a[i].f = v` only the container `a`, never
            # the index expression `i`.
            if not bits:
                return
            if isinstance(target, ast.Name):
                env[target.id] = env.get(target.id, 0) | bits
            elif isinstance(target, (ast.Tuple, ast.List)):
                for e in target.elts:
                    assign(e, bits)
            elif isinstance(target, ast.Starred):
                assign(target.value, bits)
            elif isinstance(target, (ast.Subscript, ast.Attribute)):
                base = target.value
                while isinstance(base, (ast.Subscript, ast.Attribute)):
                    base = base.value
                if isinstance(base, ast.Name):
                    env[base.id] = env.get(base.id, 0) | bits

        def walk_stmts(stmts):
            nonlocal returned
            for s in stmts:
                for n in self.scope_walk(s):
                    if isinstance(n, ast.Assign):
                        b = self.expr_taint(n.value, env, shapes)
                        for tgt in n.targets:
                            assign(tgt, b)
                    elif isinstance(n, ast.AugAssign) and self.uses_b3d() and self.shape_binop(n, shapes):
                        pass  # s += shape / s -= shape: stays a symbolic shape
                    elif isinstance(n, (ast.AugAssign, ast.AnnAssign)) and n.value is not None:
                        assign(n.target, self.expr_taint(n.value, env, shapes))
                    elif isinstance(n, ast.NamedExpr):
                        assign(n.target, self.expr_taint(n.value, env, shapes))
                    elif isinstance(n, (ast.For, ast.AsyncFor)):
                        self.assign_loop(n.target, n.iter, env, shapes, assign)
                    elif isinstance(n, ast.Return) and n.value is not None and not self.shape_valued(n.value, shapes):
                        returned |= self.expr_taint(n.value, env, shapes)
                    elif isinstance(n, ast.Try):
                        if self.contains_modeling(n.body):
                            for h in n.handlers:
                                for m in h.body:
                                    for mm in ast.walk(m):
                                        if isinstance(mm, ast.Assign):
                                            for tgt in mm.targets:
                                                assign(tgt, FAIL)
                    elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in self.local_fns:
                        for i, a in enumerate(n.args):
                            b = self.expr_taint(a, env, shapes) & GEO
                            if b:
                                m = self.tainted_params.setdefault(n.func.id, {})
                                if (m.get(i, 0) | b) != m.get(i, 0):
                                    m[i] = m.get(i, 0) | b
                                    self.changed = True

        walk_stmts(body)
        walk_stmts(body)  # loop-carried taint
        if collect is not None:
            collect.update(env)
            collect["__shapes__"] = shapes
        return returned

    def assign_loop(self, target, it, env, shapes, assign):
        """Loop targets: keys of .items() and indices of enumerate() carry no geometry."""
        bits = self.expr_taint(it, env, shapes)
        if isinstance(target, ast.Tuple) and len(target.elts) == 2 and isinstance(it, ast.Call):
            fn = it.func
            if (isinstance(fn, ast.Attribute) and fn.attr == "items") or (isinstance(fn, ast.Name) and fn.id == "enumerate"):
                assign(target.elts[1], bits)
                return
        assign(target, bits)

    def scope_walk_body(self, fn):
        for s in fn.body:
            yield from self.scope_walk(s)

    def scope_walk(self, node):
        """ast.walk that does not descend into nested function/class scopes
        (including when `node` itself is a nested definition)."""
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return
        stack = [node]
        while stack:
            n = stack.pop()
            yield n
            for ch in ast.iter_child_nodes(n):
                if isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
                stack.append(ch)

    def scopes(self):
        out = [("<module>", self.tree, [])]
        for n in ast.walk(self.tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out.append((n.name, n, [a.arg for a in n.args.args]))
        return out

    def analyze_sites(self):
        scopes = self.scopes()
        # functions returning shapes (fixed point over local helpers)
        for _ in range(6):
            for name, fn in self.local_fns.items():
                if name in self.shape_fns:
                    continue
                shapes = self.collect_shapes(fn)
                rets = [n.value for n in self.scope_walk_body(fn) if isinstance(n, ast.Return) and n.value is not None]
                annotated = (attr_chain(fn.returns) or "") if fn.returns is not None else ""
                if annotated.split(".")[-1] in SHAPE_RETURN_TYPES or (rets and all(self.shape_valued(r, shapes) for r in rets)):
                    self.shape_fns.add(name)
        # transitive modeling functions
        for _ in range(6):
            for name, fn in self.local_fns.items():
                if name not in self.model_fns and self.contains_modeling(fn.body):
                    self.model_fns.add(name)
        self.changed, it = True, 0
        while self.changed and it < 8:
            self.changed = False
            it += 1
            for key, scope, params in scopes:
                bits = self.run_scope(key, scope, params) & GEO
                if key != "<module>" and bits and (self.geo_fns.get(key, 0) | bits) != self.geo_fns.get(key, 0):
                    self.geo_fns[key] = self.geo_fns.get(key, 0) | bits
                    self.changed = True

        for key, scope, params in scopes:
            env = {}
            self.run_scope(key, scope, params, env)
            shapes = env.pop("__shapes__", set())
            defs = self.local_defs(scope)
            for n in (x for s in getattr(scope, "body", []) for x in self.scope_walk(s)):
                line = getattr(n, "lineno", 0)
                text = self.lines[line - 1].strip()[:160] if line else ""
                rec = lambda kind, sub, **kw: self.sites.append({"kind": kind, "sub": sub, "line": line, "fn": key, "text": text, **kw})
                sel = lambda body: self.selects(body, env, shapes)
                if isinstance(n, (ast.If, ast.While, ast.IfExp)):
                    bits = self.expr_taint(n.test, env, shapes)
                    if bits & GEO:
                        yes = n.body if isinstance(n.body, list) else [n.body]
                        no = n.orelse if isinstance(n.orelse, list) else [n.orelse]
                        if isinstance(n, ast.While):
                            rec("geo-iterate", "while-bound", modelingInBody=self.contains_modeling(n.body), measure=bool(bits & MEASURE),
                                selects=sel(n.body))
                            continue
                        assert_like = isinstance(n, ast.If) and only_raises(n.body) and not n.orelse
                        loop_filter = isinstance(n, ast.If) and not n.orelse and all(isinstance(x, (ast.Continue, ast.Break)) for x in n.body)
                        empt = self.emptiness(n.test, env, shapes)
                        sub = "assert" if assert_like else "measure-decision" if bits & MEASURE else "emptiness-guard" if empt else "topology-decision"
                        rec("geo-branch", sub, modelingInBranch=self.contains_modeling(yes) or self.contains_modeling(no), measure=bool(bits & MEASURE),
                            filter=loop_filter, inMap=self.in_map(n, env, shapes, defs), pred=self.pred_kind(n.test, env, shapes, defs) if bits & (MEASURE | SELPRED) else None,
                            selects=sel(yes) or sel(no) or (isinstance(n, ast.IfExp) and bool(self.expr_taint(n.body, env, shapes) & (TOPO | SELPRED))))
                    elif bits & FAIL:
                        rec("failure-branch", "try-result")
                elif isinstance(n, ast.Assert):
                    bits = self.expr_taint(n.test, env, shapes)
                    if bits & GEO:
                        rec("geo-branch", "assert", modelingInBranch=False, measure=bool(bits & MEASURE))
                elif isinstance(n, (ast.For, ast.AsyncFor)):
                    bits = self.expr_taint(n.iter, env, shapes)
                    static = self.static_iter(n.iter, defs)
                    if bits & TOPO and not static:
                        rec("geo-iterate", "entities", modelingInBody=self.contains_modeling(n.body), measure=bool(bits & MEASURE),
                            predicate=bool(bits & SELPRED), selects=sel(n.body), carried=self.loop_carried(n))
                    elif bits & (TOPO | MEASURE):
                        rec("geo-iterate", "measured-values" if not static else "static-trip", modelingInBody=self.contains_modeling(n.body),
                            measure=True, selects=sel(n.body))
                elif isinstance(n, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
                    inner = dict(env)
                    for g in n.generators:
                        gb = self.expr_taint(g.iter, inner, shapes)
                        self.assign_loop(g.target, g.iter, inner, shapes,
                                         lambda tgt, b: [inner.__setitem__(x.id, b) for x in ast.walk(tgt) if isinstance(x, ast.Name)])
                        if gb & TOPO:
                            filt = any(self.expr_taint(cond, inner, shapes) & (MEASURE | SELPRED) for cond in g.ifs)
                            pk = None
                            if filt:
                                kinds = {self.pred_kind(cond, inner, shapes, defs) for cond in g.ifs}
                                pk = "complex" if "complex" in kinds else "+".join(sorted({k for x in kinds for k in x.split("+")}))
                            elt = n.elt if not isinstance(n, ast.DictComp) else n.value
                            rec("geo-iterate", "comprehension-filter" if filt else "comprehension-map",
                                modelingInBody=self.contains_modeling(elt), measure=filt, pred=pk,
                                selects=bool(filt and self.expr_taint(elt, inner, shapes) & (TOPO | SELPRED)))
                elif isinstance(n, ast.Call):
                    f = n.func
                    if isinstance(f, ast.Attribute) and f.attr in ("filter_by", "sort_by", "group_by") and n.args and \
                            (isinstance(n.args[0], ast.Lambda) or isinstance(n.args[0], ast.Name) and n.args[0].id in self.local_fns):
                        arg = n.args[0]
                        pk = self.pred_kind(arg.body, env, shapes, defs) if isinstance(arg, ast.Lambda) else "complex"
                        rec("geo-select", "predicate-selection", op=f.attr, pred=pk)
                    elif self.is_model_call(n):
                        bits = 0
                        sel = False
                        for a in list(n.args) + [kw.value for kw in n.keywords]:
                            bits |= self.expr_taint(a, env, shapes)
                            if self.is_selector_expr(a):
                                sel = True
                        opname = (attr_chain(f) or "?").split(".")[-1]
                        if bits & MEASURE:
                            rec("geo-data", "measure-param", op=opname, measure=True)
                        elif bits & SELPRED:
                            rec("geo-data", "predicate-selection", op=opname)
                        elif bits & TOPO or sel:
                            # inline: every entity argument is a selector chain written at the call
                            # (declarative, expressible as a lazy query); otherwise a materialized list
                            inline = all(self.is_selector_expr(a) or not (self.expr_taint(a, env, shapes) & TOPO)
                                         for a in list(n.args) + [kw.value for kw in n.keywords])
                            rec("geo-data", "entity-selection", op=opname, inline=inline)
                elif isinstance(n, ast.Try):
                    if self.contains_modeling(n.body):
                        handler_work = any(not only_raises(h.body) for h in n.handlers)
                        sub = "try-recover" if handler_work else "try-rethrow" if n.handlers else "try-finally"
                        rec("failure-branch", sub, modelingInHandler=any(self.contains_modeling(h.body) for h in n.handlers))

    def selects(self, body, env, shapes):
        """Does a branch/loop body bind, collect or return entity values (host-side selection)?"""
        for s in body if isinstance(body, list) else [body]:
            for m in self.scope_walk(s) if isinstance(s, ast.stmt) else ast.walk(s):
                if isinstance(m, ast.Assign) and self.expr_taint(m.value, env, shapes) & (TOPO | SELPRED):
                    return True
                if isinstance(m, ast.Return) and m.value is not None and self.expr_taint(m.value, env, shapes) & (TOPO | SELPRED):
                    return True
                if isinstance(m, (ast.Yield,)) and m.value is not None and self.expr_taint(m.value, env, shapes) & (TOPO | SELPRED):
                    return True
                if isinstance(m, ast.Call) and isinstance(m.func, ast.Attribute) and m.func.attr in ("append", "extend", "add", "insert") \
                        and any(self.expr_taint(a, env, shapes) & (TOPO | SELPRED) for a in m.args):
                    return True
        return False

    def pred_kind(self, expr, env, shapes, defs, depth=0):
        kinds = set()
        for m in ast.walk(expr):
            if isinstance(m, ast.Attribute):
                if m.attr in PRED_TYPE:
                    kinds.add("type")
                elif m.attr in PRED_DIR:
                    kinds.add("direction")
                elif m.attr in PRED_RANGE:
                    kinds.add("range")
            if isinstance(m, ast.Call):
                fn = attr_chain(m.func) or ""
                last = fn.split(".")[-1]
                if fn in PRED_NEUTRAL_CALLS or last in PRED_RANGE | PRED_TYPE | PRED_DIR:
                    continue
                if isinstance(m.func, ast.Attribute) and self.expr_taint(m.func.value, env, shapes) & GEO:
                    kinds.add("complex")  # e.g. is_inside, distance_to, intersect
                elif isinstance(m.func, ast.Name) and m.func.id not in self.b3d_scope:
                    if any(self.expr_taint(a, env, shapes) & GEO for a in m.args):
                        kinds.add("complex")  # user predicate over geometry
            if isinstance(m, ast.Name) and depth < 3 and m.id in defs and self.expr_taint(m, env, shapes) & (MEASURE | SELPRED):
                sub = self.pred_kind(defs[m.id], env, shapes, defs, depth + 1)
                kinds |= set(sub.split("+")) if sub else set()
        if "complex" in kinds:
            return "complex"
        return "+".join(sorted(kinds)) or "range"

    def static_iter(self, it, defs, depth=0):
        """Iterable with a program-determined trip count (literal containers and
        names bound to them), even when its elements carry geometry."""
        node = it
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("items", "values", "keys"):
            node = node.func.value
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("zip", "enumerate", "reversed", "sorted", "list", "tuple"):
            return bool(node.args) and all(self.static_iter(a, defs, depth + 1) for a in node.args)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "range":
            return True
        if isinstance(node, (ast.Tuple, ast.List, ast.Dict, ast.Set, ast.Constant)):
            return True
        if isinstance(node, (ast.DictComp, ast.ListComp)) and depth < 3:
            return all(self.static_iter(g.iter, defs, depth + 1) and not g.ifs for g in node.generators)
        if isinstance(node, ast.Name) and depth < 3 and node.id in defs:
            return self.static_iter(defs[node.id], defs, depth + 1)
        return False

    def in_map(self, node, env, shapes, defs):
        """Inside a non-sequential loop over an evaluated entity selection (a filtered map)?"""
        cur = self.parents.get(node)
        while cur is not None and not isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.Module)):
            if isinstance(cur, (ast.For, ast.AsyncFor)) and self.expr_taint(cur.iter, env, shapes) & TOPO and \
                    not self.static_iter(cur.iter, defs) and not self.loop_carried(cur):
                return True
            cur = self.parents.get(cur)
        return False

    def loop_carried(self, loop):
        """Sequential semantics: break, try, or reassignment of a name the iterable reads."""
        iter_names = {x.id for x in ast.walk(loop.iter) if isinstance(x, ast.Name)}
        for s in loop.body:
            for m in self.scope_walk(s):
                if isinstance(m, (ast.Break, ast.Try)):
                    return True
                if isinstance(m, (ast.Assign, ast.AugAssign)):
                    targets = m.targets if isinstance(m, ast.Assign) else [m.target]
                    if any(isinstance(x, ast.Name) and x.id in iter_names for tg in targets for x in ast.walk(tg)):
                        return True
        return False

    def local_defs(self, scope):
        defs = {}
        for n in (x for s in getattr(scope, "body", []) for x in self.scope_walk(s)):
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                defs[n.targets[0].id] = n.value
            elif isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Tuple) and \
                    isinstance(n.value, (ast.GeneratorExp, ast.ListComp, ast.Tuple)):
                for e in n.targets[0].elts:
                    if isinstance(e, ast.Name):
                        defs[e.id] = n.value
        return defs

    def emptiness(self, test, env, shapes):
        for n in ast.walk(test):
            if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.Not) and \
                    self.expr_taint(n.operand, env, shapes) & (TOPO | MEASURE) == TOPO:
                return True
            if isinstance(n, ast.Compare):
                sides = [n.left] + n.comparators
                has_len = any(isinstance(s, ast.Call) and isinstance(s.func, ast.Name) and s.func.id == "len" and
                              self.expr_taint(s, env, shapes) & TOPO for s in sides)
                has_small = any(isinstance(s, ast.Constant) and isinstance(s.value, int) and s.value <= 1 for s in sides)
                if has_len and has_small:
                    return True
        if isinstance(test, (ast.Name, ast.BoolOp)) and self.expr_taint(test, env, shapes) & (TOPO | MEASURE) == TOPO:
            return True
        return False

    def role(self):
        c = self.c
        model_calls = c["b3d:call:part-object"] + c["b3d:call:sketch-object"] + c["b3d:call:line-object"] + \
            c["b3d:call:builder"] + sum(v for k, v in c.items() if k.startswith("b3d:algebra:") and k != "b3d:algebra:place") + \
            sum(self.methods[m] for m in ("fuse", "cut", "fillet", "chamfer", "extrude", "revolve")) + \
            sum(1 for _ in [])
        ops = sum(v for k, v in c.items() if k == "b3d:call:operation")
        model_calls += ops
        measure = sum(self.props.values()) + sum(self.methods[m] for m in MEASURE_STRONG if m in self.methods)
        fs_text = bool(FS_TEXT.search(self.source))
        if self.uses_b3d():
            if model_calls >= 5 and not CHECK_NAME.search(self.path):
                r = "b3d-model"
            elif model_calls >= 5 and model_calls >= 2 * max(1, measure + c["b3d:importGeometry"]):
                r = "b3d-model"
            elif c["b3d:importGeometry"] or measure or CHECK_NAME.search(self.path):
                r = "b3d-check"
            else:
                r = "b3d-tooling"
        elif fs_text:
            r = "fs-generator"
        elif {"fusion_khana", "adsk"} & self.imports:
            r = "fusion"
        elif {"trimesh", "manifold3d", "OCP", "numpy", "scipy", "shapely"} & self.imports:
            r = "mesh-or-numeric"
        else:
            r = "tooling"
        return r, model_calls, measure, fs_text


def main():
    files = json.load(sys.stdin)
    out = []
    for f in files:
        row = {"path": f["path"]}
        try:
            source = open(f["abs"], encoding="utf-8", errors="replace").read()
            ff = FileFacts(source, f["path"])
        except SyntaxError as e:
            row["parseError"] = f"{e.msg} at {e.lineno}"
            out.append(row)
            continue
        ff.inventory()
        ff.parents = {ch: p for p in ast.walk(ff.tree) for ch in ast.iter_child_nodes(p)}
        ff.count()
        role, model_calls, measure, fs_text = ff.role()
        row.update({"role": role, "modelCalls": model_calls, "measureCalls": measure, "fsText": fs_text,
                    "imports": sorted(ff.imports), "usesB3d": ff.uses_b3d(), "khana": dict(ff.khana)})
        if ff.uses_b3d():
            try:
                ff.analyze_sites()
            except RecursionError:
                row["siteError"] = "recursion"
            row["b3dNames"] = dict(ff.b3d)
            row["members"] = dict(ff.members)
            row["methods"] = dict(ff.methods)
            row["props"] = dict(ff.props)
            row["sites"] = ff.sites
            row["geoFunctions"] = sorted(k for k, v in ff.geo_fns.items() if v & GEO)
            row["functionNames"] = sorted(ff.local_fns)
            row["shapeFunctions"] = sorted(ff.shape_fns)
        row["constructs"] = dict(ff.c)
        out.append(row)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    sys.setrecursionlimit(20000)
    main()
