import Base
import ./geometry.bend as G
import ./vendor/bend-collections/src/crypto/sha/sha256.bend as SHA256

# Keys are framed strings, not geometry hashes or array offsets. The framing
# is injective over the sequence of Unicode strings, including delimiters.
# The one exception is a long ancestry part (see lineage below).
type IdentityKey is Data:
  IdentityKey{value: String}

type ParentIdentity is Data:
  ParentIdentity{origin_id: String, instance_id: String, revision: String, operation_id: String}

type EntityIdentity is Data:
  EntityIdentity{origin_id: String, instance_id: String, revision: String,
    kind: String, role: String, stability: String, operation_id: String,
    relation: String, matching: String, parents: List<&2, ParentIdentity>}

type IdentitySet is Data:
  IdentitySet{body: EntityIdentity, vertices: List<&2, EntityIdentity>,
    edges: List<&2, EntityIdentity>, faces: List<&2, EntityIdentity>}

def frame(+value: String) -> String:
  String.concat([Nat.show(String.length(value)), ":", value])

def frames(parts: List<&2, String>) -> String:
  match parts:
    case Nil{}:
      ""
    case head <> tail:
      String.append(frame(head), frames(tail))

def key(domain: String, parts: List<&2, String>) -> IdentityKey:
  IdentityKey{String.concat(["wk1/", frame(domain), frames(parts)])}

def key_text(value: IdentityKey) -> String:
  IdentityKey{text} = value
  text

# UTF-8 bytes of a string, as U32 values in 0..255 (code points are U32).
def utf8_four(+c: U32, acc: List<&2, U32>) -> List<&2, U32>:
  (128 .|. (c .&. 63 : U32) : U32) <> (128 .|. (U32.shrn(c, 6n) .&. 63 : U32) : U32) <>
    (128 .|. (U32.shrn(c, 12n) .&. 63 : U32) : U32) <> (240 .|. U32.shrn(c, 18n) : U32) <> acc

def utf8_three(wide: Bool, +c: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match wide:
    case True{}:
      utf8_four(c, acc)
    case False{}:
      (128 .|. (c .&. 63 : U32) : U32) <> (128 .|. (U32.shrn(c, 6n) .&. 63 : U32) : U32) <>
        (224 .|. U32.shrn(c, 12n) : U32) <> acc

def utf8_two(wide: Bool, +c: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match wide:
    case True{}:
      utf8_three(U32.is_lt(65535, c), c, acc)
    case False{}:
      (128 .|. (c .&. 63 : U32) : U32) <> (192 .|. U32.shrn(c, 6n) : U32) <> acc

def utf8_one(wide: Bool, +c: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match wide:
    case True{}:
      utf8_two(U32.is_lt(2047, c), c, acc)
    case False{}:
      c <> acc

# Tail loop over the string; acc holds the bytes in reverse.
def utf8_go(s: String, acc: List<&2, U32>) -> List<&2, U32>:
  match s:
    case SNil{}:
      List.reverse(&2, U32, acc)
    case SCon{Chr{+c}, t}:
      utf8_go(t, utf8_one(U32.is_lt(127, c), c, acc))

def utf8(s: String) -> List<&2, U32>:
  utf8_go(s, Nil{})

def longer_than(s: String, n: Nat) -> Bool:
  match s:
    case SNil{}:
      False{}
    case SCon{_, t}:
      match n:
        case 0n:
          True{}
        case 1n+p:
          longer_than(t, p)

def lineage_pick(long: Bool, +text: String) -> String:
  match long:
    case True{}:
      String.append("sha256:", SHA256.hex(SHA256.sha256(utf8(text))))
    case False{}:
      text

# A key part that names ancestor keys (the parents' origins or instances, or
# the instance a rigid copy was made from). Up to 512 characters it is kept in
# full, so shallow keys stay readable and unchanged. A longer part becomes
# "sha256:" and the SHA-256 of its UTF-8 bytes. In full, a Boolean chain nests
# every ancestor key again: the body origin grew linearly and the instance
# quadratically with chain depth (a 104-face body 23 Booleans deep held
# 198 MB of identity). A full part is framed (it starts with a digit or is
# empty) or is a whole key ("wk1/..."), so it never equals a digest part.
def lineage(+text: String) -> String:
  lineage_pick(longer_than(text, 512n), text)

def parent(entity: EntityIdentity) -> ParentIdentity:
  EntityIdentity{origin, instance, revision, _, _, _, operation, _, _, _} = entity
  ParentIdentity{origin, instance, revision, operation}

def parent_origins(parents: List<&2, ParentIdentity>) -> List<&2, String>:
  match parents:
    case Nil{}:
      Nil{}
    case ParentIdentity{origin, _, _, _} <> tail:
      origin <> parent_origins(tail)

def parent_instances(parents: List<&2, ParentIdentity>) -> List<&2, String>:
  match parents:
    case Nil{}:
      Nil{}
    case ParentIdentity{_, instance, _, _} <> tail:
      instance <> parent_instances(tail)

def persistent(+stability: String) -> Bool:
  Bool.or(String.eq(stability, "semantic"), String.eq(stability, "source"))

# origin_part and instance_part are the lineage of the parents' origins and
# instances; callers that create many entities with the same parents compute
# them once (roles).
def created_with(namespace: String, +operation: String, occurrence: String, +revision: String,
  +kind: String, +role: String, +stability: String, origin_part: String, instance_part: String,
  parents: List<&2, ParentIdentity>) -> EntityIdentity:
  scope = Bool.pick(String, persistent(stability), "", revision)
  +origin = key_text(key("origin", [namespace, operation, kind, role, scope, origin_part]))
  instance = key_text(key("instance", [origin, occurrence, instance_part]))
  matching = Bool.pick(String, persistent(stability), "semantic-role", "revision-local-only")
  EntityIdentity{origin, instance, revision, kind, role, stability, operation, "created", matching, parents}

def created(namespace: String, +operation: String, occurrence: String, +revision: String,
  +kind: String, +role: String, +stability: String, +parents: List<&2, ParentIdentity>) -> EntityIdentity:
  created_with(namespace, operation, occurrence, revision, kind, role, stability,
    lineage(frames(parent_origins(parents))), lineage(frames(parent_instances(parents))), parents)

def from_source(+namespace: String, +operation: String, occurrence: String, +revision: String,
  body_id: String, +kind: String, +source_id: String, +known_namespace: Bool,
  +parents: List<&2, ParentIdentity>) -> EntityIdentity:
  +stability = Bool.pick(String, known_namespace, "source", "revision-local")
  scope = Bool.pick(String, known_namespace, "", revision)
  +origin = key_text(key("source", [namespace, body_id, kind, source_id, scope]))
  instance = key_text(key("instance", [origin, occurrence]))
  matching = Bool.pick(String, known_namespace, "frozen-source-id", "revision-local-only")
  EntityIdentity{origin, instance, revision, kind, source_id, stability, operation, "imported", matching, parents}

def transformed(entity: EntityIdentity, +operation: String, occurrence: String, +revision: String) -> EntityIdentity:
  EntityIdentity{+origin, +old_instance, old_revision, kind, role, stability, old_operation, _, _, _} = entity
  previous = {ParentIdentity{origin, old_instance, old_revision, old_operation} : ParentIdentity}
  instance = key_text(key("instance", [origin, occurrence, lineage(old_instance)]))
  EntityIdentity{origin, instance, revision, kind, role, stability, operation,
    "rigid-transform", "exact-topology-preserved", [previous]}

def transformed_list(entities: List<&2, EntityIdentity>, +operation: String,
  +occurrence: String, +revision: String) -> List<&2, EntityIdentity>:
  match entities:
    case Nil{}:
      Nil{}
    case head <> tail:
      transformed(head, operation, occurrence, revision) <> transformed_list(tail, operation, occurrence, revision)

def transform(identities: IdentitySet, +operation: String, +occurrence: String, +revision: String) -> IdentitySet:
  IdentitySet{body, vertices, edges, faces} = identities
  IdentitySet{transformed(body, operation, occurrence, revision),
    transformed_list(vertices, operation, occurrence, revision),
    transformed_list(edges, operation, occurrence, revision),
    transformed_list(faces, operation, occurrence, revision)}

# Tail loop (a 1000-sided prism has 3000 edges); acc holds the entities in reverse.
def roles_with(names: List<&2, String>, acc: List<&2, EntityIdentity>, +namespace: String, +operation: String,
  +occurrence: String, +revision: String, +kind: String, +stability: String, +origin_part: String,
  +instance_part: String, +parents: List<&2, ParentIdentity>) -> List<&2, EntityIdentity>:
  match names:
    case Nil{}:
      List.reverse(&2, EntityIdentity, acc)
    case role <> tail:
      roles_with(tail, created_with(namespace, operation, occurrence, revision, kind, role, stability, origin_part, instance_part, parents) <> acc,
        namespace, operation, occurrence, revision, kind, stability, origin_part, instance_part, parents)

def roles(+namespace: String, +operation: String, +occurrence: String, +revision: String,
  +kind: String, names: List<&2, String>, +stability: String,
  +parents: List<&2, ParentIdentity>) -> List<&2, EntityIdentity>:
  roles_with(names, Nil{}, namespace, operation, occurrence, revision, kind, stability,
    lineage(frames(parent_origins(parents))), lineage(frames(parent_instances(parents))), parents)

def policy(entity: EntityIdentity, relation: String, matching: String) -> EntityIdentity:
  EntityIdentity{origin, instance, revision, kind, role, stability, operation, _, _, parents} = entity
  EntityIdentity{origin, instance, revision, kind, role, stability, operation, relation, matching, parents}

def policy_list(entities: List<&2, EntityIdentity>, +relation: String, +matching: String) -> List<&2, EntityIdentity>:
  match entities:
    case Nil{}:
      Nil{}
    case head <> tail:
      policy(head, relation, matching) <> policy_list(tail, relation, matching)

def local_roles(left: Nat, +index: U32, +prefix: String) -> List<&2, String>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      String.concat([prefix, "/", U32.show(index)]) <> local_roles(p, (index + 1 : U32), prefix)

def frustum(+namespace: String, +operation: String, +occurrence: String, +revision: String) -> IdentitySet:
  +body = created(namespace, operation, occurrence, revision, "body", "frustum/solid", "semantic", Nil{})
  +parents = {[parent(body)] : List<&2, ParentIdentity>}
  IdentitySet{body,
    roles(namespace, operation, occurrence, revision, "vertex", ["start/seam", "end/seam"], "semantic", parents),
    roles(namespace, operation, occurrence, revision, "edge", ["start/rim", "end/rim", "side/seam"], "semantic", parents),
    roles(namespace, operation, occurrence, revision, "face", ["cap/start", "cap/end", "side/lateral"], "semantic", parents)}

# Caps are semantic sweep roles. Anonymous profile positions are deliberately
# revision-local, even when the same array length happens to recur.
def extrusion(+namespace: String, +operation: String, +occurrence: String, +revision: String, +n: U32) -> IdentitySet:
  +body = created(namespace, operation, occurrence, revision, "body", "extrusion/solid", "semantic", Nil{})
  +parents = {[parent(body)] : List<&2, ParentIdentity>}
  caps = roles(namespace, operation, occurrence, revision, "face", ["cap/start", "cap/end"], "semantic", parents)
  sides = roles(namespace, operation, occurrence, revision, "face", local_roles(U32.to_nat(n), 0, "profile-side"), "revision-local", parents)
  IdentitySet{body,
    roles(namespace, operation, occurrence, revision, "vertex", local_roles(U32.to_nat((2 * n : U32)), 0, "profile-vertex"), "revision-local", parents),
    roles(namespace, operation, occurrence, revision, "edge", local_roles(U32.to_nat((3 * n : U32)), 0, "profile-edge"), "revision-local", parents),
    List.append(&2, EntityIdentity, caps, sides)}

# A solved named sketch supplies semantic entity and endpoint-pair names in
# the actual native use order. Coordinate changes and insertion-order changes
# do not turn these names into positional identities. Negative sweeps store
# the end ring first, so start/end roles follow the signed construction depth.
def sweep_roles(names: List<&2, String>, +prefix: String) -> List<&2, String>:
  match names:
    case Nil{}:
      Nil{}
    case name <> tail:
      String.concat([prefix, "/", frame(name)]) <> sweep_roles(tail, prefix)

def named_extrusion(+namespace: String, +operation: String, +occurrence: String, +revision: String,
    +entities: List<&2, String>, +junctions: List<&2, String>, +positive: Bool) -> IdentitySet:
  +body = created(namespace, operation, occurrence, revision, "body", "extrusion/solid", "semantic", Nil{})
  +parents = {[parent(body)] : List<&2, ParentIdentity>}
  +low = Bool.pick(String, positive, "start", "end")
  +high = Bool.pick(String, positive, "end", "start")
  vertices = List.append(&2, String, sweep_roles(junctions, low), sweep_roles(junctions, high))
  edges = List.append(&2, String, sweep_roles(entities, low),
    List.append(&2, String, sweep_roles(entities, high), sweep_roles(junctions, "sweep")))
  faces = List.append(&2, String, [String.append("cap/", low), String.append("cap/", high)], sweep_roles(entities, "profile-side"))
  IdentitySet{body,
    roles(namespace, operation, occurrence, revision, "vertex", vertices, "semantic", parents),
    roles(namespace, operation, occurrence, revision, "edge", edges, "semantic", parents),
    roles(namespace, operation, occurrence, revision, "face", faces, "semantic", parents)}

def box_layout(points: List<&2, G.Vec3>) -> Bool:
  match points:
    case [G.V3{+x0, +y0, _}, G.V3{+x1, y1, _}, G.V3{+x2, +y2, _}, G.V3{x3, y3, _}]:
      Bool.and(F32.is_lt(x0, x1), Bool.and(F32.is_lt(y0, y2),
        Bool.and(F32.is_eq(x0, x3), Bool.and(F32.is_eq(x1, x2),
          Bool.and(F32.is_eq(y0, y1), F32.is_eq(y2, y3))))))
    case _:
      False{}

def box(+namespace: String, +operation: String, +occurrence: String, +revision: String) -> IdentitySet:
  +body = created(namespace, operation, occurrence, revision, "body", "box/solid", "semantic", Nil{})
  +parents = {[parent(body)] : List<&2, ParentIdentity>}
  IdentitySet{body,
    roles(namespace, operation, occurrence, revision, "vertex",
      ["start/x-min/y-min", "start/x-max/y-min", "start/x-max/y-max", "start/x-min/y-max",
       "end/x-min/y-min", "end/x-max/y-min", "end/x-max/y-max", "end/x-min/y-max"], "semantic", parents),
    roles(namespace, operation, occurrence, revision, "edge",
      ["start/y-min", "start/x-max", "start/y-max", "start/x-min",
       "end/y-min", "end/x-max", "end/y-max", "end/x-min",
       "sweep/x-min/y-min", "sweep/x-max/y-min", "sweep/x-max/y-max", "sweep/x-min/y-max"], "semantic", parents),
    roles(namespace, operation, occurrence, revision, "face",
      ["cap/start", "cap/end", "side/y-min", "side/x-max", "side/y-max", "side/x-min"], "semantic", parents)}

# No general Boolean split/merge correspondence is asserted. Input ancestry is
# retained, while every result component/entity gets a revision-local key.
def local_set(+namespace: String, +operation: String, +occurrence: String, +revision: String,
  role: String, vertices: U32, edges: U32, faces: U32, +parents: List<&2, ParentIdentity>,
  +relation: String, +matching: String) -> IdentitySet:
  +body = policy(created(namespace, operation, occurrence, revision, "body", role, "revision-local", parents), relation, matching)
  +ancestry = {parent(body) <> parents : List<&2, ParentIdentity>}
  IdentitySet{body,
    policy_list(roles(namespace, operation, occurrence, revision, "vertex", local_roles(U32.to_nat(vertices), 0, "unmatched-vertex"), "revision-local", ancestry), relation, matching),
    policy_list(roles(namespace, operation, occurrence, revision, "edge", local_roles(U32.to_nat(edges), 0, "unmatched-edge"), "revision-local", ancestry), relation, matching),
    policy_list(roles(namespace, operation, occurrence, revision, "face", local_roles(U32.to_nat(faces), 0, "unmatched-face"), "revision-local", ancestry), relation, matching)}

def boolean_result(namespace: String, operation: String, occurrence: String, revision: String,
  component: U32, vertices: U32, edges: U32, faces: U32, parents: List<&2, ParentIdentity>) -> IdentitySet:
  local_set(namespace, operation, occurrence, revision, String.concat(["boolean-result/", U32.show(component)]),
    vertices, edges, faces, parents, "boolean-generated", "unsupported-split-merge-correspondence")

def unattributed(namespace: String, operation: String, occurrence: String, revision: String,
  vertices: U32, edges: U32, faces: U32) -> IdentitySet:
  local_set(namespace, operation, occurrence, revision, "unattributed/solid", vertices, edges, faces,
    Nil{}, "unattributed", "unsupported-unattributed-geometry")
