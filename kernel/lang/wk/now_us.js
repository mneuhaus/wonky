// IO
// ==

function wk_now_us() {
  return BigInt(Math.floor(performance.now() * 1000));
}
