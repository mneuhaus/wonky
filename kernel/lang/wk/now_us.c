// IO
// ==
// Microsecond monotonic clock for per-node timing in the WK real-model
// evaluator (kernel/lang/wk/main.bend, WK.now_us). Same shape as Base's
// IO.now (effs/now.c), which only has millisecond resolution.

Term wk_now_us_run(Env e, Term* f, IoWork* w) {
  return (Term)(io_tick() / 1000);
}

static void __attribute__((constructor)) wk_now_us_use(void) {
  io_eff(CID_WK_NOW_US, wk_now_us_run, 0);
}
