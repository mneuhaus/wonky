import Base

# Unary Nat algebra the spike proofs lean on. Base ships none of these.

def add_zero(n: Nat) -> {Nat.add(n, 0n) == n : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def add_succ(a: Nat, -b: Nat) -> {1n+Nat.add(a, b) == Nat.add(a, 1n+b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_succ(p, b) : {1n+1n+Nat.add(p, b) == 1n+_ : Nat}
      {==}

def add_comm(a: Nat, +b: Nat) -> {Nat.add(a, b) == Nat.add(b, a) : Nat}:
  match a:
    case 0n:
      %add_zero(b) : {_ == Nat.add(b, 0n) : Nat}
      {==}
    case 1n+p:
      %add_succ(b, p) : {1n+Nat.add(p, b) == _ : Nat}
      %add_comm(p, b) : {1n+Nat.add(p, b) == 1n+_ : Nat}
      {==}

def add_assoc(a: Nat, -b: Nat, -c: Nat) -> {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

def assoc_r(a: Nat, -b: Nat, -c: Nat) -> {Nat.add(a, Nat.add(b, c)) == Nat.add(Nat.add(a, b), c) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %assoc_r(p, b, c) : {1n+Nat.add(p, Nat.add(b, c)) == 1n+_ : Nat}
      {==}

def left_comm(+a: Nat, +b: Nat, +c: Nat) -> {Nat.add(a, Nat.add(b, c)) == Nat.add(b, Nat.add(a, c)) : Nat}:
  %add_assoc(b, a, c) : {Nat.add(a, Nat.add(b, c)) == _ : Nat}
  %add_comm(a, b) : {Nat.add(a, Nat.add(b, c)) == Nat.add(_, c) : Nat}
  assoc_r(a, b, c)

def swap_middle(+a: Nat, +b: Nat, +c: Nat, +d: Nat) ->
  {Nat.add(Nat.add(a, b), Nat.add(c, d)) == Nat.add(Nat.add(a, c), Nat.add(b, d)) : Nat}:
  %assoc_r(a, c, Nat.add(b, d)) : {Nat.add(Nat.add(a, b), Nat.add(c, d)) == _ : Nat}
  %left_comm(b, c, d) : {Nat.add(Nat.add(a, b), Nat.add(c, d)) == Nat.add(a, _) : Nat}
  add_assoc(a, b, Nat.add(c, d))

def double_fold(a: Nat, -b: Nat) -> {Nat.double(Nat.add(a, b)) == Nat.add(Nat.double(a), Nat.double(b)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %double_fold(p, b) : {2n+Nat.double(Nat.add(p, b)) == 2n+_ : Nat}
      {==}

def double_unfold(a: Nat, -b: Nat) -> {Nat.add(Nat.double(a), Nat.double(b)) == Nat.double(Nat.add(a, b)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %double_unfold(p, b) : {2n+Nat.add(Nat.double(p), Nat.double(b)) == 2n+_ : Nat}
      {==}

def and_assoc(a: Bool, -b: Bool, -c: Bool) -> {Bool.and(Bool.and(a, b), c) == Bool.and(a, Bool.and(b, c)) : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      {==}

def and_comm(a: Bool, b: Bool) -> {Bool.and(a, b) == Bool.and(b, a) : Bool}:
  match a b:
    case True{} True{}:
      {==}
    case True{} False{}:
      {==}
    case False{} True{}:
      {==}
    case False{} False{}:
      {==}

def and_true(a: Bool) -> {a == Bool.and(a, True{}) : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      {==}

def mul_one_r(a: Nat) -> {a == Nat.mul(a, 1n) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %mul_one_r(p) : {1n+p == 1n+_ : Nat}
      {==}

# a * 2b == 2(a * b)
def mul_double_r(a: Nat, +b: Nat) -> {Nat.double(Nat.mul(a, b)) == Nat.mul(a, Nat.double(b)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %mul_double_r(p, b) : {Nat.double(Nat.add(b, Nat.mul(p, b))) == Nat.add(Nat.double(b), _) : Nat}
      double_fold(b, Nat.mul(p, b))

def zero_r(n: Nat) -> {n == Nat.add(n, 0n) : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %zero_r(p) : {1n+p == 1n+_ : Nat}
      {==}

# (x + y) * z == x * z + y * z
def mul_distr(x: Nat, -y: Nat, +z: Nat) -> {Nat.add(Nat.mul(x, z), Nat.mul(y, z)) == Nat.mul(Nat.add(x, y), z) : Nat}:
  match x:
    case 0n:
      {==}
    case 1n+p:
      %mul_distr(p, y, z) : {Nat.add(Nat.add(z, Nat.mul(p, z)), Nat.mul(y, z)) == Nat.add(z, _) : Nat}
      add_assoc(z, Nat.mul(p, z), Nat.mul(y, z))
