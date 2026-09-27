// bx_addon.c: N-API driver for a Bend-emitted C program, included AFTER the
// emitted C and a generated <name>_ops.h (BX_OPS table, BX_MODULE_NAME).
// See docs/native-bridge/binding.md.
//
// Model: the Bend module's main is an IO loop that asks Bridge.next() for a
// Req and hands its answer to Bridge.reply(Reply). The driver evaluates main
// once, steps the IO action until it parks inside Bridge.next, and on every JS
// run() builds a Req term directly in the runtime heap, resumes the parked
// action with it (io_step), and reads the Reply term back. No process, pipe or
// text serialisation is involved; U32 words cross as raw heap words.
//
// Constraints of Bend 2.0.25's emitted runtime (all process-global statics):
// one runtime per process, calls serialised by bx_lock, init once.
//
// Two builds share this driver:
//   * probe/kernel builds (scripts/native-bridge/binding-build.mjs): run, call(name, args),
//     resident handles, gpuBuild; the measurement tool of docs/native-bridge/binding.md.
//   * the production slice build (scripts/native-bridge/build-native.mjs), whose generated
//     <name>_ops.h defines BX_SLICE 1: exactly init, call(op, words), info, reset, stats.
//     call() evaluates the one bound def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>
//     (BX_KCALL_FID); the op range is checked here, because Bend lowers `match op` to an
//     if/else chain whose last arm would otherwise run for any out-of-range op. Handles,
//     the IO bridge and gpuBuild are not compiled in.

#ifndef BX_SLICE
#define BX_SLICE 0
#endif

#define NAPI_VERSION 8
#include <node_api.h>
#include <sys/time.h>
#include <sys/resource.h>

// ---------------------------------------------------------------- state

static pthread_mutex_t bx_lock = PTHREAD_MUTEX_INITIALIZER;
static int        bx_state;          // 0 = not initialised, 1 = ready, 2 = poisoned
static Corpus     bx_H;
static IoAct*     bx_parked;         // the action parked inside Bridge.next
static Term       bx_out;            // the Reply handed to Bridge.reply
static bool       bx_has_out;
static long       bx_threads;
static bool       bx_dev;
static u64        bx_calls;
static u64        bx_respawns;
static char       bx_poison[1024];
// Slice build: every call starts on an empty heap (see bx_heap_clear).
static bool       bx_keep_heap;      // init({heap: 'keep'}): measurement of the old behaviour only
static u64        bx_clears;
static u32        bx_last_pages;     // heap pages the last call reached (bump high-water)
static u32        bx_last_start;     // bump value the last call started from (1 = empty heap)

static _Thread_local sigjmp_buf bx_jmp;
static _Thread_local int        bx_armed;
static _Thread_local char       bx_err[4096];
static _Thread_local size_t     bx_err_len;

// resident terms owned by JS handles
#define BX_HANDLES 4096
static Term bx_hand[BX_HANDLES];
static bool bx_hand_used[BX_HANDLES];

// ---------------------------------------------------------------- process hooks

static void bx_capture(const char* p, size_t n) {
  size_t room = sizeof bx_err - 1 - bx_err_len;
  if (n > room) {
    n = room;
  }
  memcpy(bx_err + bx_err_len, p, n);
  bx_err_len += n;
  bx_err[bx_err_len] = 0;
}

static int bx_fprintf(FILE* f, const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n;
  if (f == stderr && bx_armed) {
    char buf[1024];
    n = vsnprintf(buf, sizeof buf, fmt, ap);
    bx_capture(buf, n < 0 ? 0 : (size_t)n < sizeof buf ? (size_t)n : sizeof buf - 1);
  } else {
    n = vfprintf(f, fmt, ap);
  }
  va_end(ap);
  return n;
}

static size_t bx_fwrite(const void* p, size_t size, size_t n, FILE* f) {
  if (f == stderr && bx_armed) {
    bx_capture(p, size * n);
    return n;
  }
  return (fwrite)(p, size, n, f);
}

// Fail-stop: the runtime calls _exit(1) after printing "bend: <why>". On the
// thread that is inside a JS call we jump back to that call instead; on any
// other thread (a pool worker) there is nothing to unwind to, so the process
// ends exactly as the stock runtime would.
static void bx_exit(int code) {
  if (bx_armed) {
    siglongjmp(bx_jmp, 1);
  }
  static const char msg[] = "bend-binding: fail-stop outside a JS call (pool worker or init); exiting\n";
  (void)!write(2, msg, sizeof msg - 1);
  (_exit)(code);
}

// Guard pages the runtime protects under its explicit stacks.
#define BX_GUARDS 256
static struct { uintptr_t lo, hi; } bx_guard[BX_GUARDS];
static _Atomic u32 bx_nguard;

static int bx_mprotect(void* p, size_t n, int prot) {
  if (prot == PROT_NONE) {
    u32 i = atomic_fetch_add(&bx_nguard, 1);
    if (i < BX_GUARDS) {
      bx_guard[i].lo = (uintptr_t)p;
      bx_guard[i].hi = (uintptr_t)p + n;
    }
  }
  return (mprotect)(p, n, prot);
}

static bool bx_in_guard(uintptr_t a) {
  u32 n = atomic_load(&bx_nguard);
  for (u32 i = 0; i < n && i < BX_GUARDS; i += 1) {
    if (a >= bx_guard[i].lo && a < bx_guard[i].hi) {
      return true;
    }
  }
  return false;
}

// SIGSEGV/SIGBUS: the runtime wants err_trap for its own stack-guard faults;
// V8 (wasm trap handler) and Node want theirs for everything else. We keep the
// handler that was installed before the runtime asked, and forward to it for
// faults that are not in a runtime guard page.
static struct sigaction bx_prev[2];
static void (*bx_rt_handler[2])(int);
static bool bx_chained[2];

static void bx_forward(int sig, siginfo_t* info, void* ctx, struct sigaction* prev) {
  if (prev->sa_flags & SA_SIGINFO) {
    if (prev->sa_sigaction != NULL) {
      prev->sa_sigaction(sig, info, ctx);
      return;
    }
  } else if (prev->sa_handler != SIG_DFL && prev->sa_handler != SIG_IGN) {
    prev->sa_handler(sig);
    return;
  }
  // default action: restore and return; the fault re-executes and kills.
  struct sigaction dfl;
  memset(&dfl, 0, sizeof dfl);
  dfl.sa_handler = SIG_DFL;
  (sigaction)(sig, &dfl, NULL);
}

static void bx_on_fault(int sig, siginfo_t* info, void* ctx) {
  int k = sig == SIGBUS;
  if (bx_in_guard((uintptr_t)info->si_addr) && bx_rt_handler[k] != NULL) {
    bx_rt_handler[k](sig);
    return;
  }
  bx_forward(sig, info, ctx, &bx_prev[k]);
}

static int bx_sigaction(int sig, const struct sigaction* sa, struct sigaction* old) {
  // BX_NO_CHAIN=1 is a control for the report: the stock runtime behaviour
  // (Bend's err_trap replaces V8's handler for the whole process).
  static int no_chain = -1;
  if (no_chain < 0) {
    const char* v = getenv("BX_NO_CHAIN");
    no_chain = v != NULL && v[0] == '1';
  }
  if ((sig == SIGSEGV || sig == SIGBUS) && sa != NULL && !no_chain) {
    int k = sig == SIGBUS;
    bx_rt_handler[k] = sa->sa_handler;
    if (bx_chained[k]) {
      return 0;
    }
    struct sigaction mine;
    memset(&mine, 0, sizeof mine);
    mine.sa_sigaction = bx_on_fault;
    mine.sa_flags     = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&mine.sa_mask);
    bx_chained[k] = true;
    return (sigaction)(sig, &mine, &bx_prev[k]);
  }
  return (sigaction)(sig, sa, old);
}

static char bx_self[4096];

static int bx_exec_path(char* buf, uint32_t* size) {
  size_t n = strlen(bx_self);
  if (n + 1 > *size) {
    return -1;
  }
  memcpy(buf, bx_self, n + 1);
  return 0;
}

// ---------------------------------------------------------------- helpers

static double bx_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6;
}

#define BX_CHECK(env, call)                                   \
  do {                                                         \
    if ((call) != napi_ok) {                                   \
      napi_throw_error(env, "BX_NAPI", "N-API call failed: " #call); \
      return NULL;                                             \
    }                                                          \
  } while (0)

static napi_value bx_throw(napi_env env, const char* code, const char* msg) {
  napi_throw_error(env, code, msg);
  return NULL;
}

static Env bx_env(void) {
  return (Env){ bx_H, ALC[0] };
}

static Term bx_list(Env e, const u32* w, size_t n) {
  Term xs = term_pak(CID_NIL, 0);
  for (size_t i = n; i > 0; i -= 1) {
    xs = io_node(e, CID_CON, (Term)w[i - 1], xs);
  }
  return xs;
}

// Non-destructive walk (resident handles): term_peek sees through RFC shares.
static size_t bx_list_len(Env e, Term xs) {
  size_t n = 0;
  while (term_aux(xs) == CID_CON) {
    xs = e.mem[term_peek(e, xs) + 1];
    n += 1;
  }
  return n;
}

static void bx_list_peek(Env e, Term xs, u32* out) {
  size_t i = 0;
  while (term_aux(xs) == CID_CON) {
    Loc c = term_peek(e, xs);
    out[i++] = (u32)e.mem[c];
    xs = e.mem[c + 1];
  }
}

// Destructive walk (a reply): consumes the cells as io_cstr does for strings.
static u32* bx_list_take(Env e, Term xs, size_t* len) {
  size_t cap = 64, n = 0;
  u32* buf = io_mem(malloc(cap * 4));
  while (term_aux(xs) == CID_CON) {
    Term fb[2];
    spare_free(e, cls_fit(2), ctr_take(e, xs, 2, fb));
    if (n == cap) {
      cap *= 2;
      buf = io_mem(realloc(buf, cap * 4));
    }
    buf[n++] = (u32)fb[0];
    xs = fb[1];
  }
  term_sink(e, xs);
  *len = n;
  return buf;
}

static Term bx_ctr3(Env e, u64 cid, Term a, Term b, Term c) {
  Loc l = heap_alloc(e, cls_fit(3));
  e.mem[l]     = a;  // the Op index: a raw word, never sealed
  e.mem[l + 1] = io_seal(e, b, cid);
  e.mem[l + 2] = io_seal(e, c, cid);
  return term_ctr(cid, l);
}

static Term bx_next(Env e, Term* f, IoWork* w) {
  (void)e;
  (void)f;
  bx_parked = (IoAct*)w;
  return IO_PARK;
}

static Term bx_reply(Env e, Term* f, IoWork* w) {
  (void)w;
  if (bx_has_out) {
    term_sink(e, bx_out);
  }
  bx_out     = f[0];
  bx_has_out = true;
  return term_pak(CID_UNIT, 0);
}

// Evaluate main and step it until it parks in Bridge.next. Caller holds lock and is armed.
static int bx_spawn(void) {
#if !BX_HAS_BRIDGE
  return 0;  // a call-only module: main is never run
#else
  Env e = bx_env();
  Term m = corpus_eval(bx_H, term_tsk(MAIN_FID, task_node(e, MAIN_FID, TERM_HOLE, 0, 0)));
  IoAct* a = io_mem(calloc(1, sizeof(IoAct)));
  a->cont  = m;
  a->item  = term_clo(FID_IO_EMIT, 0);
  io_live  = 1;
  bx_parked = NULL;
  int code = io_step(e, a);
  if (code >= 0 || bx_parked == NULL) {
    return -1;
  }
  return 0;
#endif
}

// ---------------------------------------------------------------- N-API

static bool bx_get_prop(napi_env env, napi_value obj, const char* key, napi_value* out) {
  bool has = false;
  if (obj == NULL || napi_has_named_property(env, obj, key, &has) != napi_ok || !has) {
    return false;
  }
  return napi_get_named_property(env, obj, key, out) == napi_ok;
}

static napi_value bx_init(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = { NULL };
  BX_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_value opts = argc > 0 ? argv[0] : NULL;
  napi_value v;
  int32_t threads = 1;
  bool gpu = false;
  double gpu_mb = 0;
  if (bx_get_prop(env, opts, "threads", &v)) {
    napi_get_value_int32(env, v, &threads);
  }
  if (bx_get_prop(env, opts, "gpu", &v)) {
    napi_get_value_bool(env, v, &gpu);
  }
  if (bx_get_prop(env, opts, "gpuMB", &v)) {
    napi_get_value_double(env, v, &gpu_mb);
  }
  bool keep_heap = false;
  if (bx_get_prop(env, opts, "heap", &v)) {
    char mode[16] = { 0 };
    size_t len = 0;
    if (napi_get_value_string_utf8(env, v, mode, sizeof mode, &len) != napi_ok || (strcmp(mode, "clear") != 0 && strcmp(mode, "keep") != 0)) {
      return bx_throw(env, "BX_ARGS", "init: heap must be 'clear' (default) or 'keep'");
    }
    keep_heap = strcmp(mode, "keep") == 0;
  }
  pthread_mutex_lock(&bx_lock);
  if (bx_state != 0) {
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_ONCE", "the Bend runtime is process-global and already initialised");
  }
  double t0 = bx_now_ms();
  bool dev = false;
  double t_probe = 0, t_setup = 0, t_main = 0;
  bx_err_len = 0;
  bx_armed = 1;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "init failed: %s", bx_err);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_FAILSTOP", bx_poison);
  }
  if (gpu) {
    dev = BANGS != 0 && gpu_probe();
    if (!dev) {
      bx_armed = 0;
      pthread_mutex_unlock(&bx_lock);
      return bx_throw(env, "BX_NO_GPU", BANGS == 0
        ? "gpu requested, but this module has no GPU-eligible (bang) function"
        : "gpu requested, but no Metal device was found");
    }
  }
  t_probe = bx_now_ms() - t0;
  bx_H = corpus_setup(dev, threads < 1 ? 1 : threads, (u64)(gpu_mb * 1048576.0));
  io_stk = pool_stack();
  if (pipe(io_wake_fd) | fcntl(io_wake_fd[0], F_SETFL, O_NONBLOCK)) {
    err_fail("the event loop failed to open");
  }
  t_setup = bx_now_ms() - t0 - t_probe;
  double t1 = bx_now_ms();
  if (bx_spawn() != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "main did not park in Bridge.next: %s", bx_err);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_PROTOCOL", bx_poison);
  }
  t_main = bx_now_ms() - t1;
  bx_armed = 0;
  bx_state = 1;
  bx_threads = pool_size;
  bx_dev = dev;
  bx_keep_heap = keep_heap;
  pthread_mutex_unlock(&bx_lock);

  napi_value out, x;
  BX_CHECK(env, napi_create_object(env, &out));
  napi_create_double(env, t_probe, &x);
  napi_set_named_property(env, out, "probeMs", x);
  napi_create_double(env, t_setup, &x);
  napi_set_named_property(env, out, "setupMs", x);
  napi_create_double(env, t_main, &x);
  napi_set_named_property(env, out, "mainMs", x);
  napi_create_int32(env, (int32_t)pool_size, &x);
  napi_set_named_property(env, out, "threads", x);
  napi_get_boolean(env, dev, &x);
  napi_set_named_property(env, out, "gpu", x);
  napi_create_int32(env, BANGS, &x);
  napi_set_named_property(env, out, "bangs", x);
  napi_create_string_utf8(env, BX_MODULE_NAME, NAPI_AUTO_LENGTH, &x);
  napi_set_named_property(env, out, "module", x);
  return out;
}

#if !BX_SLICE
// An all-nullary Data type (Op) is a raw U32 arm index in Bend 2.0.25's
// lowering, so the request carries the index, not a constructor.
static int bx_op_index(napi_env env, napi_value v, u32* op) {
  napi_valuetype t;
  napi_typeof(env, v, &t);
  if (t == napi_number) {
    // raw index: a hook to feed the runtime an out-of-range op
    // Bend lowers `match op` to an if/else chain whose last arm is the
    // plain else: an index past the end silently runs the LAST arm. Reject it.
    uint32_t n;
    napi_get_value_uint32(env, v, &n);
    if (n >= BX_NOPS && getenv("BX_RAW_OP") == NULL) {
      return -1;
    }
    *op = n;
    return 0;
  }
  char name[64];
  size_t n = 0;
  if (napi_get_value_string_utf8(env, v, name, sizeof name, &n) != napi_ok) {
    return -1;
  }
  for (size_t i = 0; i < BX_NOPS; i += 1) {
    if (strcmp(BX_OPS[i].name, name) == 0) {
      *op = BX_OPS[i].index;
      return 0;
    }
  }
  return -1;
}

static int bx_hand_new(Term t) {
  for (int i = 1; i < BX_HANDLES; i += 1) {
    if (!bx_hand_used[i]) {
      bx_hand_used[i] = true;
      bx_hand[i] = t;
      return i;
    }
  }
  return -1;
}

// run(op, words: Uint32Array | {handle}, text: string, keep?: bool)
//   -> { words: Uint32Array, text: string }  or, with keep, { handle, text }
static napi_value bx_run(napi_env env, napi_callback_info info) {
#if !BX_HAS_BRIDGE
  (void)info;
  return bx_throw(env, "BX_ARGS", "this module has no Bridge.next/Bridge.reply loop: use call()");
#else
  size_t argc = 4;
  napi_value argv[4] = { NULL, NULL, NULL, NULL };
  BX_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 3) {
    return bx_throw(env, "BX_ARGS", "run(op, words, text, keep?)");
  }
  u32 op;
  if (bx_op_index(env, argv[0], &op) != 0) {
    return bx_throw(env, "BX_ARGS", "unknown op");
  }
  // words: a typed array (copied into the heap as a List<U32>) or a resident handle
  u32* words = NULL;
  size_t nwords = 0;
  int32_t in_handle = 0;
  bool is_ta = false;
  napi_is_typedarray(env, argv[1], &is_ta);
  if (is_ta) {
    napi_typedarray_type tt;
    void* data;
    napi_value ab;
    size_t off;
    napi_get_typedarray_info(env, argv[1], &tt, &nwords, &data, &ab, &off);
    if (tt != napi_uint32_array) {
      return bx_throw(env, "BX_ARGS", "words must be a Uint32Array");
    }
    words = data;
  } else {
    napi_value hv;
    if (!bx_get_prop(env, argv[1], "handle", &hv)) {
      return bx_throw(env, "BX_ARGS", "words must be a Uint32Array or {handle}");
    }
    napi_get_value_int32(env, hv, &in_handle);
  }
  size_t tlen = 0;
  BX_CHECK(env, napi_get_value_string_utf8(env, argv[2], NULL, 0, &tlen));
  char* volatile text = malloc(tlen + 1);
  napi_get_value_string_utf8(env, argv[2], text, tlen + 1, &tlen);
  bool keep = false;
  if (argc > 3 && argv[3] != NULL) {
    napi_get_value_bool(env, argv[3], &keep);
  }

  pthread_mutex_lock(&bx_lock);
  if (bx_state != 1) {
    free(text);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_POISONED", bx_state == 0 ? "not initialised"
      : bx_poison);
  }
  if (in_handle != 0 && (in_handle < 0 || in_handle >= BX_HANDLES || !bx_hand_used[in_handle])) {
    free(text);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_HANDLE", "stale or unknown handle");
  }
  Env e = bx_env();
  bx_err_len = 0;
  bx_err[0] = 0;
  bx_armed = 1;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "%s", bx_err);
    size_t k = strlen(bx_poison);
    while (k > 0 && bx_poison[k - 1] == '\n') {
      bx_poison[--k] = 0;
    }
    free(text);
    pthread_mutex_unlock(&bx_lock);
    char msg[1200];
    snprintf(msg, sizeof msg, "Bend runtime fail-stop: %s (runtime poisoned; call reset())", bx_poison);
    return bx_throw(env, "BX_FAILSTOP", msg);
  }
  Term w;
  if (in_handle != 0) {
    w = bx_hand[in_handle];
    bx_hand_used[in_handle] = false;
  } else {
    w = bx_list(e, words, nwords);
  }
  Term req = bx_ctr3(e, CID_REQ, (Term)op, w, io_str(e, text, tlen));
  free(text);
  text = NULL;
  IoAct* a = bx_parked;
  bx_parked  = NULL;
  bx_has_out = false;
  a->item = req;
  int code = io_step(e, a);
  bx_calls += 1;
  if (code >= 0 || bx_parked == NULL) {
    // IO.die (Halt) or main returned: the loop is gone; start a fresh one.
    char why[1200];
    size_t k = bx_err_len;
    while (k > 0 && bx_err[k - 1] == '\n') {
      bx_err[--k] = 0;
    }
    snprintf(why, sizeof why, code >= 0 ? "Bend IO.die(%d): %s" : "Bend main ended (%d)%s", code, bx_err);
    if (bx_has_out) {
      term_sink(e, bx_out);
      bx_has_out = false;
    }
    if (code >= 0) {
      free(a);
    }
    bx_respawns += 1;
    if (bx_spawn() != 0) {
      bx_armed = 0;
      bx_state = 2;
      snprintf(bx_poison, sizeof bx_poison, "respawn failed after: %s", why);
    }
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    napi_value err, msgv, codev;
    napi_create_string_utf8(env, why, NAPI_AUTO_LENGTH, &msgv);
    napi_create_string_utf8(env, "BX_DIE", NAPI_AUTO_LENGTH, &codev);
    napi_create_error(env, codev, msgv, &err);
    napi_value ec;
    napi_create_int32(env, code, &ec);
    napi_set_named_property(env, err, "exitCode", ec);
    napi_throw(env, err);
    return NULL;
  }
  if (!bx_has_out) {
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_PROTOCOL", "Bridge.next was reached without a Bridge.reply");
  }
  Term out = bx_out;
  bx_has_out = false;
  // Reply{words, text}
  Term fs[2];
  Loc src = ctr_take(e, out, 2, fs);
  spare_free(e, cls_fit(2), src);
  u64 olen = 0;
  char* otext = io_cstr(e, fs[1], &olen);
  napi_value res, x;
  napi_create_object(env, &res);
  if (keep) {
    int h = bx_hand_new(fs[0]);
    if (h < 0) {
      term_sink(e, fs[0]);
    }
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    if (h < 0) {
      free(otext);
      return bx_throw(env, "BX_HANDLE", "handle table full");
    }
    napi_create_int32(env, h, &x);
    napi_set_named_property(env, res, "handle", x);
  } else {
    size_t n = 0;
    u32* got = bx_list_take(e, fs[0], &n);
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    void* data = NULL;
    napi_value ab;
    napi_create_arraybuffer(env, n * 4, &data, &ab);
    memcpy(data, got, n * 4);
    free(got);
    napi_create_typedarray(env, napi_uint32_array, n, ab, 0, &x);
    napi_set_named_property(env, res, "words", x);
  }
  napi_create_string_utf8(env, otext, olen, &x);
  napi_set_named_property(env, res, "text", x);
  free(otext);
  return res;
#endif
}

// ---------------------------------------------------------------- direct calls
//
// call(name, args[], keep?) evaluates a top-level def of the module directly:
// the arguments are written into a task node for the def's FID and
// corpus_eval normalises it, exactly as the runtime starts main. No IO loop,
// no request/reply types. The generated BX_CALLS table (from the def's Bend
// signature) gives each parameter's kind:
//   'u' U32 word (JS number)      'f' F32 as its U32 bit pattern (JS number)
//   'n' Nat, an immediate below 2^48 (JS number)
//   'l' List<U32|F32> (Uint32Array, or a {handle})
//   'h' any other value: only a resident {handle} from an earlier call
// and the result's kind (same letters; 'h' results always come back as a handle).

static Term bx_take_handle(int32_t h) {
  Term t = bx_hand[h];
  bx_hand_used[h] = false;
  return t;
}

static int bx_call_index(napi_env env, napi_value v) {
  char name[128];
  size_t n = 0;
  if (napi_get_value_string_utf8(env, v, name, sizeof name, &n) != napi_ok) {
    return -1;
  }
  for (size_t i = 0; i < BX_NCALLS; i += 1) {
    if (strcmp(BX_CALLS[i].name, name) == 0) {
      return (int)i;
    }
  }
  return -1;
}

#define BX_MAXARGS 16

static napi_value bx_call(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3] = { NULL, NULL, NULL };
  BX_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 2) {
    return bx_throw(env, "BX_ARGS", "call(name, args[], keep?)");
  }
  int ci = bx_call_index(env, argv[0]);
  if (ci < 0) {
    return bx_throw(env, "BX_ARGS", "unknown callable def (not in the generated BX_CALLS table)");
  }
  const char* kinds = BX_CALLS[ci].params;
  u32 ar = (u32)strlen(kinds);
  bool is_arr = false;
  napi_is_array(env, argv[1], &is_arr);
  uint32_t given = 0;
  if (is_arr) {
    napi_get_array_length(env, argv[1], &given);
  }
  if (!is_arr || given != ar) {
    char m[160];
    snprintf(m, sizeof m, "%s takes %u argument(s) as an array", BX_CALLS[ci].name, ar);
    return bx_throw(env, "BX_ARGS", m);
  }
  bool keep = false;
  if (argc > 2 && argv[2] != NULL) {
    napi_get_value_bool(env, argv[2], &keep);
  }
  // Validate and pin every argument before touching the runtime.
  struct { u64 word; const u32* data; size_t n; int32_t handle; } in[BX_MAXARGS];
  for (u32 i = 0; i < ar; i += 1) {
    napi_value a;
    napi_get_element(env, argv[1], i, &a);
    in[i].handle = 0;
    in[i].data = NULL;
    in[i].n = 0;
    char k = kinds[i];
    if (k == 'u' || k == 'f') {
      napi_valuetype t;
      napi_typeof(env, a, &t);
      if (t != napi_number) {
        return bx_throw(env, "BX_ARGS", "a U32/F32 argument must be a number (F32 as its bit pattern)");
      }
      uint32_t w;
      napi_get_value_uint32(env, a, &w);
      in[i].word = w;
      continue;
    }
    if (k == 'n') {
      int64_t v = -1;
      napi_get_value_int64(env, a, &v);
      double d = -1;
      napi_get_value_double(env, a, &d);
      if (d < 0 || d != (double)v || (u64)v > NAT_IMM) {
        return bx_throw(env, "BX_ARGS", "a Nat argument must be an integer in [0, 2^48)");
      }
      in[i].word = (u64)v;
      continue;
    }
    bool ta = false;
    napi_is_typedarray(env, a, &ta);
    if (k == 'l' && ta) {
      napi_typedarray_type tt;
      void* data;
      napi_value ab;
      size_t off;
      napi_get_typedarray_info(env, a, &tt, &in[i].n, &data, &ab, &off);
      if (tt != napi_uint32_array) {
        return bx_throw(env, "BX_ARGS", "a list argument must be a Uint32Array");
      }
      in[i].data = data;
      continue;
    }
    napi_value hv;
    if (!bx_get_prop(env, a, "handle", &hv)) {
      return bx_throw(env, "BX_ARGS", k == 'l' ? "a list argument must be a Uint32Array or {handle}"
        : "this argument has no JS encoding: pass a resident {handle}");
    }
    napi_get_value_int32(env, hv, &in[i].handle);
  }
  pthread_mutex_lock(&bx_lock);
  if (bx_state != 1) {
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_POISONED", bx_state == 0 ? "not initialised" : bx_poison);
  }
  for (u32 i = 0; i < ar; i += 1) {
    int32_t h = in[i].handle;
    if (h != 0 && (h < 0 || h >= BX_HANDLES || !bx_hand_used[h])) {
      pthread_mutex_unlock(&bx_lock);
      return bx_throw(env, "BX_HANDLE", "stale or unknown handle");
    }
    for (u32 j = 0; j < i; j += 1) {
      if (h != 0 && in[j].handle == h) {
        pthread_mutex_unlock(&bx_lock);
        return bx_throw(env, "BX_HANDLE", "the same handle twice in one call (dup() it first)");
      }
    }
  }
  Env e = bx_env();
  bx_err_len = 0;
  bx_err[0] = 0;
  bx_armed = 1;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "%s", bx_err);
    size_t k = strlen(bx_poison);
    while (k > 0 && bx_poison[k - 1] == '\n') {
      bx_poison[--k] = 0;
    }
    pthread_mutex_unlock(&bx_lock);
    char msg[1200];
    snprintf(msg, sizeof msg, "Bend runtime fail-stop: %s (runtime poisoned; call reset())", bx_poison);
    return bx_throw(env, "BX_FAILSTOP", msg);
  }
  Fid fid = BX_CALLS[ci].fid;
  Loc loc = task_node(e, fid, TERM_HOLE, 0, 0);
  for (u32 i = 0; i < ar; i += 1) {
    Term t;
    if (in[i].handle != 0) {
      t = bx_take_handle(in[i].handle);
    } else if (kinds[i] == 'l') {
      t = bx_list(e, in[i].data, in[i].n);
    } else {
      t = (Term)in[i].word;
    }
    e.mem[loc + i] = t;
  }
  Term r = corpus_eval(bx_H, term_tsk(fid, loc));
  bx_calls += 1;
  char rk = BX_CALLS[ci].result;
  napi_value res = NULL;
  if (rk == 'h' || (keep && rk == 'l')) {
    int h = bx_hand_new(r);
    if (h < 0) {
      term_sink(e, r);
    }
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    if (h < 0) {
      return bx_throw(env, "BX_HANDLE", "handle table full");
    }
    napi_value x;
    napi_create_object(env, &res);
    napi_create_int32(env, h, &x);
    napi_set_named_property(env, res, "handle", x);
    return res;
  }
  if (rk == 'l') {
    size_t n = 0;
    u32* got = bx_list_take(e, r, &n);
    bx_armed = 0;
    pthread_mutex_unlock(&bx_lock);
    void* data = NULL;
    napi_value ab;
    napi_create_arraybuffer(env, n * 4, &data, &ab);
    memcpy(data, got, n * 4);
    free(got);
    napi_create_typedarray(env, napi_uint32_array, n, ab, 0, &res);
    return res;
  }
  bx_armed = 0;
  pthread_mutex_unlock(&bx_lock);
  if (rk == 'n') {
    napi_create_double(env, (double)r, &res);
  } else {
    napi_create_uint32(env, (uint32_t)r, &res);
  }
  return res;
}

static napi_value bx_calls_info(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value arr, o, x;
  napi_create_array_with_length(env, BX_NCALLS, &arr);
  for (size_t i = 0; i < BX_NCALLS; i += 1) {
    napi_create_object(env, &o);
    napi_create_string_utf8(env, BX_CALLS[i].name, NAPI_AUTO_LENGTH, &x);
    napi_set_named_property(env, o, "name", x);
    napi_create_string_utf8(env, BX_CALLS[i].params, NAPI_AUTO_LENGTH, &x);
    napi_set_named_property(env, o, "params", x);
    char r[2] = { BX_CALLS[i].result, 0 };
    napi_create_string_utf8(env, r, 1, &x);
    napi_set_named_property(env, o, "result", x);
    napi_create_uint32(env, BX_CALLS[i].fid, &x);
    napi_set_named_property(env, o, "fid", x);
    napi_set_element(env, arr, (uint32_t)i, o);
  }
  return arr;
}

// handles: read (copy out without consuming), dup (share), drop
static napi_value bx_handle_op(napi_env env, napi_callback_info info, int what) {
  size_t argc = 1;
  napi_value argv[1];
  BX_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  int32_t h = 0;
  napi_value hv;
  if (argc < 1 || !bx_get_prop(env, argv[0], "handle", &hv)) {
    return bx_throw(env, "BX_ARGS", "expected {handle}");
  }
  napi_get_value_int32(env, hv, &h);
  pthread_mutex_lock(&bx_lock);
  if (bx_state != 1 || h <= 0 || h >= BX_HANDLES || !bx_hand_used[h]) {
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_HANDLE", "stale or unknown handle (or runtime not ready)");
  }
  Env e = bx_env();
  napi_value res = NULL, x;
  bx_armed = 1;
  bx_err_len = 0;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "%s", bx_err);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_FAILSTOP", bx_poison);
  }
  if (what == 0) {
    size_t n = bx_list_len(e, bx_hand[h]);
    void* data = NULL;
    napi_value ab;
    napi_create_arraybuffer(env, n * 4, &data, &ab);
    bx_list_peek(e, bx_hand[h], data);
    napi_create_typedarray(env, napi_uint32_array, n, ab, 0, &res);
  } else if (what == 1) {
    Term t = term_keep(e, bx_hand[h]);
    bx_hand[h] = t;
    int k = bx_hand_new(t);
    napi_create_object(env, &res);
    napi_create_int32(env, k, &x);
    napi_set_named_property(env, res, "handle", x);
  } else {
    term_sink(e, bx_hand[h]);
    bx_hand_used[h] = false;
    napi_get_undefined(env, &res);
  }
  bx_armed = 0;
  pthread_mutex_unlock(&bx_lock);
  return res;
}

static napi_value bx_read(napi_env env, napi_callback_info info) { return bx_handle_op(env, info, 0); }
static napi_value bx_dup(napi_env env, napi_callback_info info) { return bx_handle_op(env, info, 1); }
static napi_value bx_drop(napi_env env, napi_callback_info info) { return bx_handle_op(env, info, 2); }
#endif  // !BX_SLICE

#if BX_SLICE
// ---------------------------------------------------------------- slice build
//
// call(op, words) -> Uint32Array: [status, ...result words] from kcall. Status
// 0 ok, 1 malformed request, 2 unknown op (the generated dispatcher's last arm).
// Driver-level refusals (not a number, op out of range, not a Uint32Array) throw
// BX_ARGS before the runtime is touched; a fail-stop on this thread throws
// BX_FAILSTOP and poisons the runtime until reset().

// Every call starts on an empty heap. Between two slice calls nothing in the
// heap is live: the request list is consumed by kcall, the reply list is taken
// destructively (bx_list_take), there are no handles and no parked IO action.
// Without this, the allocator's free lists (per-lane HOT/COLD chains and the
// class banks) accumulate every freed cell of every earlier call in reuse
// order, so later calls allocate from cells scattered over the whole touched
// heap instead of from fresh, sequential pages; measured per-call time grew up
// to ~10x within one process (docs/native-bridge/prototype.md, "heap churn").
// The clear empties the allocator, not the pages: the bump pointer returns to
// 1, the lanes' chains and the banks are emptied, the static image is restored
// as corpus_setup lays it; mapped pages stay mapped (no page faults, no
// munmap). Pages are reused with old contents, exactly as recycled free-list
// cells always are (heap_alloc_miss writes each slot's link word; every
// constructor writes the words it uses). Caller holds bx_lock; pool workers
// are idle between calls.
static void bx_heap_clear(void) {
  Corpus H = bx_H;
  bx_last_pages = a32_load(a32_at(H, H_BUMP));
  memset(ALC, 0, sizeof ALC);
  for (Cls c = 0; c < NCLS_ALL; c += 1) {
    Bank* b = bank_at(H, c);
    b->rd  = 0;
    b->wr  = 0;
    b->top = 0;
  }
  memcpy(H + STAT_OFF, STAT_IMG, STAT_LEN * sizeof(u64));
  a32_store(a32_at(H, H_BUMP), 1);
  bx_clears += 1;
}

static napi_value bx_kcall(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = { NULL, NULL };
  BX_CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc != 2) {
    return bx_throw(env, "BX_ARGS", "call(op, words: Uint32Array)");
  }
  napi_valuetype t;
  double d = -1;
  napi_typeof(env, argv[0], &t);
  if (t != napi_number || napi_get_value_double(env, argv[0], &d) != napi_ok || !(d >= 0) || d > 4294967295.0 || d != (double)(uint32_t)d) {
    return bx_throw(env, "BX_ARGS", "op must be an unsigned 32-bit integer");
  }
  uint32_t op = (uint32_t)d;
  if (op >= BX_NKOPS) {
    char m[160];
    snprintf(m, sizeof m, "unknown op %u (this build serves ops 0..%u)", op, (unsigned)BX_NKOPS - 1);
    return bx_throw(env, "BX_ARGS", m);
  }
  bool ta = false;
  napi_is_typedarray(env, argv[1], &ta);
  if (!ta) {
    return bx_throw(env, "BX_ARGS", "words must be a Uint32Array");
  }
  napi_typedarray_type tt;
  void* data = NULL;
  size_t n = 0, off = 0;
  napi_value ab;
  napi_get_typedarray_info(env, argv[1], &tt, &n, &data, &ab, &off);
  if (tt != napi_uint32_array) {
    return bx_throw(env, "BX_ARGS", "words must be a Uint32Array");
  }
  // The generated decoder counts the request words in a U32 and refuses any
  // count word that claims more than the words left after it; that bound is
  // exact only below 2^32 words (16 GiB), so larger requests are refused here.
  if (n > 0xFFFFFFFFu) {
    return bx_throw(env, "BX_ARGS", "request longer than 2^32 - 1 words");
  }
  pthread_mutex_lock(&bx_lock);
  if (bx_state != 1) {
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_POISONED", bx_state == 0 ? "not initialised" : bx_poison);
  }
  Env e = bx_env();
  bx_err_len = 0;
  bx_err[0] = 0;
  bx_armed = 1;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "%s", bx_err);
    size_t k = strlen(bx_poison);
    while (k > 0 && bx_poison[k - 1] == '\n') {
      bx_poison[--k] = 0;
    }
    pthread_mutex_unlock(&bx_lock);
    char msg[1200];
    snprintf(msg, sizeof msg, "Bend runtime fail-stop in op %u: %s (runtime poisoned; call reset())", op, bx_poison);
    return bx_throw(env, "BX_FAILSTOP", msg);
  }
  bx_last_start = a32_load(a32_at(bx_H, H_BUMP));
  Loc loc = task_node(e, BX_KCALL_FID, TERM_HOLE, 0, 0);
  e.mem[loc]     = (Term)op;
  e.mem[loc + 1] = bx_list(e, (const u32*)data, n);
  Term r = corpus_eval(bx_H, term_tsk(BX_KCALL_FID, loc));
  bx_calls += 1;
  size_t got_n = 0;
  u32* got = bx_list_take(e, r, &got_n);
  if (bx_keep_heap) {
    bx_last_pages = a32_load(a32_at(bx_H, H_BUMP));
  } else {
    bx_heap_clear();
  }
  bx_armed = 0;
  pthread_mutex_unlock(&bx_lock);
  void* out = NULL;
  napi_value res;
  napi_create_arraybuffer(env, got_n * 4, &out, &ab);
  memcpy(out, got, got_n * 4);
  free(got);
  napi_create_typedarray(env, napi_uint32_array, got_n, ab, 0, &res);
  return res;
}

static void bx_set_str(napi_env env, napi_value obj, const char* key, const char* value) {
  napi_value x;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &x);
  napi_set_named_property(env, obj, key, x);
}

static void bx_set_num(napi_env env, napi_value obj, const char* key, double value) {
  napi_value x;
  napi_create_double(env, value, &x);
  napi_set_named_property(env, obj, key, x);
}

// info(): what was compiled in, for the loader's stale check and brep.json.
static napi_value bx_info(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out, arr, x;
  BX_CHECK(env, napi_create_object(env, &out));
  bx_set_num(env, out, "apiVersion", BX_API_VERSION);
  bx_set_str(env, out, "sourceHash", BX_SOURCE_HASH);
  bx_set_str(env, out, "wireHash", BX_WIRE_HASH);
  bx_set_str(env, out, "set", BX_SET);
  bx_set_str(env, out, "bend", BX_BEND);
  bx_set_str(env, out, "clang", BX_CLANG);
  bx_set_str(env, out, "flags", BX_FLAGS);
  bx_set_str(env, out, "arch", BX_ARCH);
  bx_set_str(env, out, "module", BX_MODULE_NAME);
  bx_set_num(env, out, "napi", NAPI_VERSION);
  bx_set_num(env, out, "bangs", BANGS);
  bx_set_num(env, out, "kcallFid", BX_KCALL_FID);
  pthread_mutex_lock(&bx_lock);
  int state = bx_state;
  long threads = bx_threads;
  pthread_mutex_unlock(&bx_lock);
  bx_set_num(env, out, "threads", state == 0 ? 0 : (double)threads);
  bx_set_str(env, out, "heap", bx_keep_heap ? "keep" : "clear");
  bx_set_num(env, out, "state", state);
  napi_create_array_with_length(env, BX_NKOPS, &arr);
  for (uint32_t i = 0; i < BX_NKOPS; i += 1) {
    napi_create_string_utf8(env, BX_KOPS[i], NAPI_AUTO_LENGTH, &x);
    napi_set_element(env, arr, i, x);
  }
  napi_set_named_property(env, out, "ops", arr);
  return out;
}
#endif  // BX_SLICE

// reset(): after a fail-stop, drop the whole heap and start main again.
// Only possible when no pool worker is running Bend code (they are idle
// between calls); resident handles become invalid.
static napi_value bx_reset(napi_env env, napi_callback_info info) {
  (void)info;
  pthread_mutex_lock(&bx_lock);
  if (bx_state == 0) {
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_ARGS", "not initialised");
  }
  double t0 = bx_now_ms();
  bx_armed = 1;
  bx_err_len = 0;
  if (sigsetjmp(bx_jmp, 1) != 0) {
    bx_armed = 0;
    bx_state = 2;
    snprintf(bx_poison, sizeof bx_poison, "reset failed: %s", bx_err);
    pthread_mutex_unlock(&bx_lock);
    return bx_throw(env, "BX_FAILSTOP", bx_poison);
  }
  if (!bx_dev) {
    munmap(CORPUS, corpus_size);
  }
  memset(ALC, 0, sizeof ALC);
  memset(bx_hand_used, 0, sizeof bx_hand_used);
  bx_has_out = false;
  bx_parked = NULL;
  if (bx_dev) {
    memset(CORPUS, 0, STAK_OFF * 8);
    Corpus H = CORPUS;
    corpus_lay(H, corpus_size);
    memcpy(H + STAT_OFF, STAT_IMG, STAT_LEN * sizeof(u64));
    a32_store(a32_at(H, H_BUMP), 1);
    bx_H = H;
  } else {
    bx_H = corpus_setup(false, bx_threads, 0);
  }
  int ok = bx_spawn();
  bx_armed = 0;
  bx_state = ok == 0 ? 1 : 2;
  if (ok != 0) {
    snprintf(bx_poison, sizeof bx_poison, "reset: main did not park");
  }
  pthread_mutex_unlock(&bx_lock);
  napi_value x;
  napi_create_double(env, bx_now_ms() - t0, &x);
  return x;
}

static napi_value bx_stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out, x;
  napi_create_object(env, &out);
  pthread_mutex_lock(&bx_lock);
  napi_create_double(env, (double)bx_calls, &x);
  napi_set_named_property(env, out, "calls", x);
  napi_create_double(env, (double)bx_respawns, &x);
  napi_set_named_property(env, out, "respawns", x);
  napi_create_int32(env, bx_state, &x);
  napi_set_named_property(env, out, "state", x);
  napi_create_double(env, (double)corpus_size, &x);
  napi_set_named_property(env, out, "corpusBytes", x);
  int live = 0;
  for (int i = 0; i < BX_HANDLES; i += 1) {
    live += bx_hand_used[i];
  }
  napi_create_int32(env, live, &x);
  napi_set_named_property(env, out, "handles", x);
  napi_get_boolean(env, !bx_keep_heap, &x);
  napi_set_named_property(env, out, "heapClearPerCall", x);
  napi_create_double(env, (double)bx_clears, &x);
  napi_set_named_property(env, out, "heapClears", x);
  napi_create_double(env, (double)bx_last_start, &x);
  napi_set_named_property(env, out, "lastCallStartPage", x);
  napi_create_double(env, (double)bx_last_pages, &x);
  napi_set_named_property(env, out, "lastCallPages", x);
  pthread_mutex_unlock(&bx_lock);
  struct rusage ru;
  getrusage(RUSAGE_SELF, &ru);
  napi_create_double(env, (double)ru.ru_maxrss, &x);
  napi_set_named_property(env, out, "maxRssBytes", x);
  return out;
}

#if !BX_SLICE
static napi_value bx_ops(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value arr, s;
  size_t n = BX_NOPS;
  napi_create_array_with_length(env, n, &arr);
  for (size_t i = 0; i < n; i += 1) {
    napi_create_string_utf8(env, BX_OPS[i].name, NAPI_AUTO_LENGTH, &s);
    napi_set_element(env, arr, (uint32_t)i, s);
  }
  return arr;
}

// Writes the Metal binary archive next to the .node (what `bend -o` does for a binary).
static napi_value bx_gpu_build(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value x;
  bool ok = gpu_probe() && gpu_make(gpu_path());
  napi_create_string_utf8(env, ok ? gpu_path() : "", NAPI_AUTO_LENGTH, &x);
  return x;
}
#endif  // !BX_SLICE

NAPI_MODULE_INIT() {
  Dl_info di;
  if (dladdr((void*)bx_init, &di) && di.dli_fname != NULL) {
    snprintf(bx_self, sizeof bx_self, "%s", di.dli_fname);
  }
#if BX_SLICE
  napi_property_descriptor props[] = {
    { "init", NULL, bx_init, NULL, NULL, NULL, napi_default, NULL },
    { "call", NULL, bx_kcall, NULL, NULL, NULL, napi_default, NULL },
    { "info", NULL, bx_info, NULL, NULL, NULL, napi_default, NULL },
    { "reset", NULL, bx_reset, NULL, NULL, NULL, napi_default, NULL },
    { "stats", NULL, bx_stats, NULL, NULL, NULL, napi_default, NULL },
  };
#else
  napi_property_descriptor props[] = {
    { "init", NULL, bx_init, NULL, NULL, NULL, napi_default, NULL },
    { "run", NULL, bx_run, NULL, NULL, NULL, napi_default, NULL },
    { "read", NULL, bx_read, NULL, NULL, NULL, napi_default, NULL },
    { "dup", NULL, bx_dup, NULL, NULL, NULL, napi_default, NULL },
    { "drop", NULL, bx_drop, NULL, NULL, NULL, napi_default, NULL },
    { "reset", NULL, bx_reset, NULL, NULL, NULL, napi_default, NULL },
    { "stats", NULL, bx_stats, NULL, NULL, NULL, napi_default, NULL },
    { "ops", NULL, bx_ops, NULL, NULL, NULL, napi_default, NULL },
    { "call", NULL, bx_call, NULL, NULL, NULL, napi_default, NULL },
    { "calls", NULL, bx_calls_info, NULL, NULL, NULL, napi_default, NULL },
    { "gpuBuild", NULL, bx_gpu_build, NULL, NULL, NULL, napi_default, NULL },
  };
#endif
  napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
  return exports;
}
