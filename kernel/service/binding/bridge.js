// The JS backend has no bridge: calling kernels from JS goes through src/kernel.mjs.
function bridge_next() { throw new Error('Bridge.next is native-only (Node binding)'); }
function bridge_reply(reply) { throw new Error('Bridge.reply is native-only (Node binding)'); }
