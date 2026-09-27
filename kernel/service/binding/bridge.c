// Bridge effects for the in-process Node binding (docs/native-bridge/binding.md).
// Spliced by the Bend compiler after the runtime. The actual behaviour lives in
// the wrapper (src/native/binding/bx_addon.c, via bx_pre.h), which defines BX_WRAPPER and
// the bx_* hooks; a plain `bend run` of this module fails with an explicit error.

#ifdef CID_BRIDGE_NEXT
#ifdef BX_WRAPPER
static Term bx_next(Env e, Term* f, IoWork* w);
static Term bx_reply(Env e, Term* f, IoWork* w);
#else
static Term bx_next(Env e, Term* f, IoWork* w) {
  err_fail("Bridge.next is only served by the Node binding");
  return 0;
}
static Term bx_reply(Env e, Term* f, IoWork* w) {
  err_fail("Bridge.reply is only served by the Node binding");
  return 0;
}
#endif
Term bridge_next_run(Env e, Term* f, IoWork* w) { return bx_next(e, f, w); }
Term bridge_reply_run(Env e, Term* f, IoWork* w) { return bx_reply(e, f, w); }
static void __attribute__((constructor)) bridge_use(void) {
  io_eff(CID_BRIDGE_NEXT, bridge_next_run, 0);
  io_eff(CID_BRIDGE_REPLY, bridge_reply_run, 0);
}
#endif
