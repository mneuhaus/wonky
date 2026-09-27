import Base
import ../vendor/bend-collections/src/containers/balanced_search_tree.bend as TreeMap
import ../vendor/bend-collections/src/containers/binary_heap.bend as BinaryHeap
import ../vendor/bend-collections/src/containers/bitset.bend as Bitset
import ../vendor/bend-collections/src/containers/types/bitset.bend as BitsetE
import ../vendor/bend-collections/src/containers/deque.bend as Deque
import ../vendor/bend-collections/src/containers/dlist_iterator.bend as ListIterator
import ../vendor/bend-collections/src/containers/doubly_linked_list.bend as LinkedList
import ../vendor/bend-collections/src/containers/dynamic_array.bend as DynArray
import ../vendor/bend-collections/src/containers/types/dynamic_array.bend as DynArrayE
import ../vendor/bend-collections/src/containers/hash_table.bend as HashMap
import ../vendor/bend-collections/src/containers/lru.bend as LRU
import ../vendor/bend-collections/src/containers/priority_queue.bend as PriorityQueue
import ../vendor/bend-collections/src/containers/queue.bend as Queue
import ../vendor/bend-collections/src/containers/simple_queue.bend as SimpleQueue
import ../vendor/bend-collections/src/containers/stack.bend as Stack
import ../vendor/bend-collections/src/math/hash.bend as Hash
import ../vendor/bend-collections/src/math/pow2.bend as Pow2
import ../vendor/bend-collections/src/math/u64.bend as U64
import ../vendor/bend-collections/src/crypto/sha/sha256.bend as SHA256
import ../vendor/bend-collections/src/crypto/keccak/keccak.bend as Keccak
import ../vendor/bend-collections/src/crypto/keccak/hex.bend as KeccakHex
import ../vendor/bend-collections/src/crypto/blake/blake2s/blake2s.bend as BLAKE2s
import ../vendor/bend-collections/src/crypto/blake/blake2s/hex.bend as BLAKE2sHex
import ../vendor/bend-collections/src/crypto/blake/blake2b/blake2b.bend as BLAKE2b
import ../vendor/bend-collections/src/crypto/blake/blake2b/hex.bend as BLAKE2bHex
import ../vendor/bend-collections/src/crypto/blake/blake3/blake3.bend as BLAKE3
import ../vendor/bend-collections/src/crypto/blake/blake3/hex.bend as BLAKE3Hex
import ./id-vec.bend as IdVec
import ./id-set.bend as IdSet
import ./keys.bend as K

# Test drivers for the vendored bend-collections tree and the kernel/lib
# adapters (docs/collections.md). It imports every public vendored module,
# exactly as upstream main.bend does, so a loader or compiler change that
# breaks any of them fails here. The defs below touch the four containers the
# adapters build on, SHA-256, and every adapter operation; test/collections.test.mjs
# checks their answers on the JS target against JS oracles and, opt-in, against
# a native build of the same drivers. Nothing in the kernel imports this file.

# Destructuring lets and matches only take parameters, so each step that
# returns a (container, answer) pair hands it to the next def as a parameter.

# Dynamic array: push every value, read index i back, return the whole array.
def da_fill(xs: List<&2, U32>, r: DynArray.DynArray<&2, U32> & Result<&2, &2, DynArrayE.Error, Unit>) -> DynArray.DynArray<&2, U32>:
  match xs r:
    case x <> tail Tuple{da, _}:
      da_fill(tail, DynArray.push(U32, da, x))
    case Nil{} Tuple{da, _}:
      da

def da_list(r: DynArray.DynArray<&2, U32> & List<&2, U32>, v: U32) -> List<&2, U32>:
  (_, xs) = r
  v <> xs

def da_item(r: DynArray.DynArray<&2, U32> & Result<&2, &2, DynArrayE.Error, U32>) -> List<&2, U32>:
  match r:
    case Tuple{da, Done{v}}:
      da_list(DynArray.to_list(U32, da), v)
    case Tuple{da, Fail{_}}:
      da_list(DynArray.to_list(U32, da), 4294967295)

# [xs[i]] ++ xs, through a dynamic array (4294967295 when i is out of range).
def dynamic_array(xs: List<&2, U32>, +i: U32) -> List<&2, U32>:
  da_item(DynArray.get(U32, da_fill(xs, (DynArray.new(U32), Done{Unit{}})), U32.to_nat(i)))

# Tree map: insert (k, k * 10) for every k, then the keys in order and the value at `probe`.
def tm_fill(xs: List<&2, U32>, r: TreeMap.TreeMap<U32, U32, U32.cmp> & Result<&2, &2, TreeMap.Rejected<U32, U32>, Maybe<&2, U32>>) -> TreeMap.TreeMap<U32, U32, U32.cmp>:
  match xs r:
    case +x <> tail Tuple{m, _}:
      tm_fill(tail, TreeMap.put(~U32, ~U32, ~U32.cmp, m, x, (x * 10 : U32)))
    case Nil{} Tuple{m, _}:
      m

def tm_new(xs: List<&2, U32>) -> TreeMap.TreeMap<U32, U32, U32.cmp>:
  tm_fill(xs, (TreeMap.new(~U32, ~U32, ~U32.cmp), Done{None{}}))

# Ascending keys by successor queries; n bounds the walk (the map size).
def tm_walk(n: Nat, r: TreeMap.TreeMap<U32, U32, U32.cmp> & Maybe<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match n r:
    case 1n+p Tuple{m, Some{+k}}:
      tm_walk(p, TreeMap.higher_key(~U32, ~U32, ~U32.cmp, m, k), k <> acc)
    case _ _:
      List.reverse(&2, U32, acc)

def tm_value(r: TreeMap.TreeMap<U32, U32, U32.cmp> & Maybe<&2, U32>) -> U32:
  match r:
    case Tuple{_, Some{v}}:
      v
    case Tuple{_, None{}}:
      4294967295

def tree_map_value(xs: List<&2, U32>, +probe: U32) -> U32:
  tm_value(TreeMap.get(~U32, ~U32, ~U32.cmp, tm_new(xs), probe))

def tree_map_keys(+xs: List<&2, U32>) -> List<&2, U32>:
  tm_walk(List.length(&2, U32, xs), TreeMap.first_key(~U32, ~U32, ~U32.cmp, tm_new(xs)), Nil{})

# Bitset: set every index (out-of-range indexes are refused), then the members.
def bs_fill(xs: List<&2, U32>, r: Bitset.Bitset & Result<&2, &2, BitsetE.Error, Unit>) -> Bitset.Bitset:
  match xs r:
    case x <> tail Tuple{s, _}:
      bs_fill(tail, Bitset.set(s, U32.to_nat(x)))
    case Nil{} Tuple{s, _}:
      s

def nats_go(xs: List<&2, Nat>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> tail:
      U32.from_nat(x) <> nats_go(tail)

def nats(r: Bitset.Bitset & List<&2, Nat>) -> List<&2, U32>:
  (_, xs) = r
  nats_go(xs)

def bitset_members(+size: U32, xs: List<&2, U32>) -> List<&2, U32>:
  nats(Bitset.to_list(bs_fill(xs, (Bitset.new(U32.to_nat(size)), Done{Unit{}}))))

# Hash map: key i -> value i for every key, then the value at `probe` (0 when absent).
def hm_fill(keys: List<&2, String>, +i: U32, m: HashMap.HashMap<&2, U32>) -> HashMap.HashMap<&2, U32>:
  match keys:
    case Nil{}:
      m
    case k <> tail:
      hm_fill(tail, (i + 1 : U32), HashMap.set(&2, U32, m, k, i))

def hm_value(r: HashMap.HashMap<&2, U32> & U32) -> U32:
  (_, v) = r
  v

def hash_map_value(keys: List<&2, String>, probe: String) -> U32:
  hm_value(HashMap.get(U32, 0, hm_fill(keys, 1, HashMap.new(&2, U32)), probe))

def sha256_hex(s: String) -> String:
  SHA256.hex(SHA256.sha256(SHA256.ascii(s)))

# ---- kernel/lib/id-vec.bend ----

type VecTrace is Data:
  VecTrace{flags: List<&2, Bool>, reads: List<&2, U32>, items: List<&2, U32>, length: U32}

def vec_flag(r: IdVec.IdVec<U32> & Bool, flags: List<&2, Bool>) -> IdVec.IdVec<U32> & List<&2, Bool>:
  (v, ok) = r
  (v, ok <> flags)

# set(ids[k], values[k]) in order, recording each flag (newest first).
def vec_sets(ids: List<&2, U32>, values: List<&2, U32>, r: IdVec.IdVec<U32> & List<&2, Bool>) -> IdVec.IdVec<U32> & List<&2, Bool>:
  match ids values r:
    case id <> tail x <> rest Tuple{v, flags}:
      vec_sets(tail, rest, vec_flag(IdVec.set(U32, v, id, x), flags))
    case _ _ done:
      done

def vec_read(r: IdVec.IdVec<U32> & U32, reads: List<&2, U32>) -> IdVec.IdVec<U32> & List<&2, U32>:
  (v, x) = r
  (v, x <> reads)

# get(ids[k], fallback) in order (newest first).
def vec_gets(ids: List<&2, U32>, +fallback: U32, r: IdVec.IdVec<U32> & List<&2, U32>) -> IdVec.IdVec<U32> & List<&2, U32>:
  match ids r:
    case id <> tail Tuple{v, reads}:
      vec_gets(tail, fallback, vec_read(IdVec.get(U32, v, id, fallback), reads))
    case Nil{} done:
      done

def vec_trace_length(r: IdVec.IdVec<U32> & U32, flags: List<&2, Bool>, reads: List<&2, U32>, items: List<&2, U32>) -> VecTrace:
  (_, n) = r
  VecTrace{List.reverse(&2, Bool, flags), List.reverse(&2, U32, reads), items, n}

def vec_trace_items(r: IdVec.IdVec<U32> & List<&2, U32>, flags: List<&2, Bool>, reads: List<&2, U32>) -> VecTrace:
  (v, items) = r
  vec_trace_length(IdVec.length(U32, v), flags, reads, items)

def vec_trace_reads(r: IdVec.IdVec<U32> & List<&2, U32>, flags: List<&2, Bool>) -> VecTrace:
  (v, reads) = r
  vec_trace_items(IdVec.to_list(U32, v), flags, reads)

def vec_trace_sets(r: IdVec.IdVec<U32> & List<&2, Bool>, gets: List<&2, U32>, +fallback: U32) -> VecTrace:
  (v, flags) = r
  vec_trace_reads(vec_gets(gets, fallback, (v, Nil{})), flags)

def vec_trace_built(r: IdVec.IdVec<U32> & Bool, ids: List<&2, U32>, values: List<&2, U32>, gets: List<&2, U32>, +fallback: U32) -> VecTrace:
  (v, ok) = r
  vec_trace_sets(vec_sets(ids, values, (v, [ok])), gets, fallback)

# from_list(xs), then the sets, then the gets. flags = [from_list ok, set flags..].
def id_vec_script(xs: List<&2, U32>, ids: List<&2, U32>, values: List<&2, U32>, gets: List<&2, U32>, +fallback: U32) -> VecTrace:
  vec_trace_built(IdVec.from_list(U32, xs), ids, values, gets, fallback)

def id_vec_filled(n: U32, +x: U32, ids: List<&2, U32>, values: List<&2, U32>) -> VecTrace:
  vec_trace_built(IdVec.filled(U32, n, x), ids, values, Nil{}, 0)

def vec_find(r: IdVec.IdVec<U32> & Maybe<&2, U32>) -> Maybe<&2, U32>:
  (_, found) = r
  found

def vec_find_built(r: IdVec.IdVec<U32> & Bool, id: U32) -> Maybe<&2, U32>:
  (v, _) = r
  vec_find(IdVec.find(U32, v, id))

def id_vec_find(xs: List<&2, U32>, id: U32) -> Maybe<&2, U32>:
  vec_find_built(IdVec.from_list(U32, xs), id)

# ---- kernel/lib/id-set.bend ----

type SetTrace is Data:
  SetTrace{added: Bool, removed: List<&2, Bool>, probes: List<&2, Bool>, any: Bool, count: U32, capacity: U32, members: List<&2, U32>}

def set_flag(r: IdSet.IdSet & Bool, flags: List<&2, Bool>) -> IdSet.IdSet & List<&2, Bool>:
  (s, ok) = r
  (s, ok <> flags)

def set_removes(ids: List<&2, U32>, r: IdSet.IdSet & List<&2, Bool>) -> IdSet.IdSet & List<&2, Bool>:
  match ids r:
    case id <> tail Tuple{s, flags}:
      set_removes(tail, set_flag(IdSet.remove(s, id), flags))
    case Nil{} done:
      done

def set_probes(ids: List<&2, U32>, r: IdSet.IdSet & List<&2, Bool>) -> IdSet.IdSet & List<&2, Bool>:
  match ids r:
    case id <> tail Tuple{s, flags}:
      set_probes(tail, set_flag(IdSet.has(s, id), flags))
    case Nil{} done:
      done

def set_trace_members(r: IdSet.IdSet & List<&2, U32>, added: Bool, removed: List<&2, Bool>, probes: List<&2, Bool>, any: Bool, count: U32, capacity: U32) -> SetTrace:
  (s, members) = r
  SetTrace{added, List.reverse(&2, Bool, removed), List.reverse(&2, Bool, probes), any, count, capacity, members}

def set_trace_capacity(r: IdSet.IdSet & U32, added: Bool, removed: List<&2, Bool>, probes: List<&2, Bool>, any: Bool, count: U32) -> SetTrace:
  (s, capacity) = r
  set_trace_members(IdSet.members(s), added, removed, probes, any, count, capacity)

def set_trace_count(r: IdSet.IdSet & U32, added: Bool, removed: List<&2, Bool>, probes: List<&2, Bool>, any: Bool) -> SetTrace:
  (s, count) = r
  set_trace_capacity(IdSet.capacity(s), added, removed, probes, any, count)

def set_trace_any(r: IdSet.IdSet & Bool, added: Bool, removed: List<&2, Bool>, probes: List<&2, Bool>) -> SetTrace:
  (s, any) = r
  set_trace_count(IdSet.count(s), added, removed, probes, any)

def set_trace_probes(r: IdSet.IdSet & List<&2, Bool>, added: Bool, removed: List<&2, Bool>, any_of: List<&2, U32>) -> SetTrace:
  (s, probes) = r
  set_trace_any(IdSet.has_any(s, any_of), added, removed, probes)

def set_trace_removed(r: IdSet.IdSet & List<&2, Bool>, added: Bool, probes: List<&2, U32>, any_of: List<&2, U32>) -> SetTrace:
  (s, removed) = r
  set_trace_probes(set_probes(probes, (s, Nil{})), added, removed, any_of)

def set_trace_added(r: IdSet.IdSet & Bool, removes: List<&2, U32>, probes: List<&2, U32>, any_of: List<&2, U32>) -> SetTrace:
  (s, added) = r
  set_trace_removed(set_removes(removes, (s, Nil{})), added, probes, any_of)

# from_ids(n, adds), then remove each of removes, then has for each probe, has_any(any_of).
def id_set_script(n: U32, adds: List<&2, U32>, removes: List<&2, U32>, probes: List<&2, U32>, any_of: List<&2, U32>) -> SetTrace:
  set_trace_added(IdSet.from_ids(n, adds), removes, probes, any_of)

# ---- kernel/lib/keys.bend with the vendored tree map ----

type EdgeTrace is Data:
  EdgeTrace{keys: List<&2, K.IdPair>, found: List<&2, U32>, size: U32}

def edge_fill(as: List<&2, U32>, bs: List<&2, U32>, +i: U32, r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & Result<&2, &2, TreeMap.Rejected<K.IdPair, U32>, Maybe<&2, U32>>) -> TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp>:
  match as bs r:
    case a <> tail b <> rest Tuple{m, _}:
      edge_fill(tail, rest, (i + 1 : U32), TreeMap.put(~K.IdPair, ~U32, ~K.pair_cmp, m, K.edge(a, b), i))
    case _ _ Tuple{m, _}:
      m

def edge_found(r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & Maybe<&2, U32>, found: List<&2, U32>) -> TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & List<&2, U32>:
  match r:
    case Tuple{m, Some{v}}:
      (m, v <> found)
    case Tuple{m, None{}}:
      (m, 4294967295 <> found)

def edge_gets(as: List<&2, U32>, bs: List<&2, U32>, r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & List<&2, U32>) -> TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & List<&2, U32>:
  match as bs r:
    case a <> tail b <> rest Tuple{m, found}:
      edge_gets(tail, rest, edge_found(TreeMap.get(~K.IdPair, ~U32, ~K.pair_cmp, m, K.edge(a, b)), found))
    case _ _ done:
      done

def edge_walk(n: Nat, r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & Maybe<&2, K.IdPair>, acc: List<&2, K.IdPair>) -> List<&2, K.IdPair>:
  match n r:
    case 1n+p Tuple{m, Some{+k}}:
      edge_walk(p, TreeMap.higher_key(~K.IdPair, ~U32, ~K.pair_cmp, m, k), k <> acc)
    case _ _:
      List.reverse(&2, K.IdPair, acc)

def edge_trace_size(r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & Nat, found: List<&2, U32>) -> EdgeTrace:
  (m, +n) = r
  EdgeTrace{edge_walk(n, TreeMap.first_key(~K.IdPair, ~U32, ~K.pair_cmp, m), Nil{}), List.reverse(&2, U32, found), U32.from_nat(n)}

def edge_trace_found(r: TreeMap.TreeMap<K.IdPair, U32, K.pair_cmp> & List<&2, U32>) -> EdgeTrace:
  (m, found) = r
  edge_trace_size(TreeMap.size(~K.IdPair, ~U32, ~K.pair_cmp, m), found)

# Edge (as[k], bs[k]) -> k (a repeated edge, in either direction, keeps the
# last k); then the keys in order and the value of every query edge.
def edge_map(as: List<&2, U32>, bs: List<&2, U32>, qa: List<&2, U32>, qb: List<&2, U32>) -> EdgeTrace:
  edge_trace_found(edge_gets(qa, qb, (edge_fill(as, bs, 0, (TreeMap.new(~K.IdPair, ~U32, ~K.pair_cmp), Done{None{}})), Nil{})))

def f32_orders(xs: List<&2, F32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> tail:
      K.f32_order(x) <> f32_orders(tail)

type PointTrace is Data:
  PointTrace{keys: List<&2, K.Key3>, firsts: List<&2, U32>}

def point_fill(xs: List<&2, F32>, ys: List<&2, F32>, zs: List<&2, F32>, +i: U32, r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & Result<&2, &2, TreeMap.Rejected<K.Key3, U32>, Maybe<&2, U32>>) -> TreeMap.TreeMap<K.Key3, U32, K.key3_cmp>:
  match xs ys zs r:
    case x <> tail y <> rest z <> more Tuple{m, _}:
      point_fill(tail, rest, more, (i + 1 : U32), TreeMap.put_if_absent(~K.Key3, ~U32, ~K.key3_cmp, m, K.vec3_key(x, y, z), i))
    case _ _ _ Tuple{m, _}:
      m

def point_walk(n: Nat, r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & Maybe<&2, K.Key3>, acc: List<&2, K.Key3>) -> TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, K.Key3>:
  match n r:
    case 1n+p Tuple{m, Some{+k}}:
      point_walk(p, TreeMap.higher_key(~K.Key3, ~U32, ~K.key3_cmp, m, k), k <> acc)
    case _ Tuple{m, _}:
      (m, List.reverse(&2, K.Key3, acc))

def point_found(r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & Maybe<&2, U32>, found: List<&2, U32>) -> TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, U32>:
  match r:
    case Tuple{m, Some{v}}:
      (m, v <> found)
    case Tuple{m, None{}}:
      (m, 4294967295 <> found)

def point_gets(keys: List<&2, K.Key3>, r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, U32>) -> TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, U32>:
  match keys r:
    case k <> tail Tuple{m, found}:
      point_gets(tail, point_found(TreeMap.get(~K.Key3, ~U32, ~K.key3_cmp, m, k), found))
    case Nil{} done:
      done

def point_trace(r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, U32>, keys: List<&2, K.Key3>) -> PointTrace:
  (_, firsts) = r
  PointTrace{keys, List.reverse(&2, U32, firsts)}

def point_trace_keys(r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & List<&2, K.Key3>) -> PointTrace:
  (m, +keys) = r
  point_trace(point_gets(keys, (m, Nil{})), keys)

def point_trace_size(r: TreeMap.TreeMap<K.Key3, U32, K.key3_cmp> & Nat) -> PointTrace:
  (m, +n) = r
  point_trace_keys(point_walk(n, TreeMap.first_key(~K.Key3, ~U32, ~K.key3_cmp, m), Nil{}))

# Point k = (xs[k], ys[k], zs[k]) keyed exactly (vec3_key), first index kept:
# the distinct keys in order, and for each the index of its first occurrence.
def point_map(xs: List<&2, F32>, ys: List<&2, F32>, zs: List<&2, F32>) -> PointTrace:
  point_trace_size(TreeMap.size(~K.Key3, ~U32, ~K.key3_cmp, point_fill(xs, ys, zs, 0, (TreeMap.new(~K.Key3, ~U32, ~K.key3_cmp), Done{None{}}))))
