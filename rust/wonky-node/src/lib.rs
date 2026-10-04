//! wonky-node: the Rust kernel as an in-process N-API addon (docs/rust-migration.md
//! 3.3, package W0). Same interface as the Bend native addon
//! (src/native/binding/bx_addon.c, slice build): `init`, `call(op, Uint32Array)`,
//! `info`, `reset`, `stats`, plus `wire(version, op, words, 'args'|'result')`,
//! the wire conformance round trip (decode with the generated codec, encode
//! again) that tests and the replay harness use.
//!
//! No npm package, no bindgen: the few N-API functions used are declared here
//! against Node's stable C ABI (NAPI_VERSION 8, headers vendored in
//! src/native/include) and resolved from the Node process at load time. The
//! addon is context-aware (`napi_register_module_v1`), so worker threads can
//! load it; it holds no per-environment state and no kernel state between calls.
//!
//! Every op runs inside `catch_unwind`: a panic answers status 5 with its
//! message and the next call runs normally. Replies are the wonky-wire status
//! words (0 ok, 1 malformed, 2 unknown op, 3 invalid value, 5 fault, 6
//! unavailable), never a thrown error; only bad JS arguments throw (BX_ARGS).
#![allow(non_camel_case_types)]

#[cfg(not(panic = "unwind"))]
compile_error!("wonky-node requires panic=unwind: abort would terminate the Node host");

use std::ffi::{c_char, c_void, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use wonky_wire::{
    dispatch, reply_words, roundtrip_args, roundtrip_result, status_reply, v3, CallError, Kernel, Version, API_VERSION, OPS, STATUS_FAULT,
    STATUS_INVALID, STATUS_MALFORMED, STATUS_OK, STATUS_UNAVAILABLE, WIRE_FORMAT, WIRE_HASH,
};

// ---------------------------------------------------------------- N-API FFI

type napi_env = *mut c_void;
type napi_value = *mut c_void;
type napi_callback_info = *mut c_void;
type napi_status = i32;
type napi_callback = unsafe extern "C" fn(napi_env, napi_callback_info) -> napi_value;

const NAPI_OK: napi_status = 0;
const NAPI_NUMBER: i32 = 3; // napi_valuetype
const NAPI_STRING: i32 = 4;
const NAPI_OBJECT: i32 = 6;
const NAPI_UNDEFINED: i32 = 0;
const NAPI_UINT32_ARRAY: i32 = 6; // napi_typedarray_type
const NAPI_VERSION: i32 = 8;

extern "C" {
    fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
    fn napi_call_function(env: napi_env, recv: napi_value, func: napi_value, argc: usize, argv: *const napi_value, result: *mut napi_value) -> napi_status;
    fn napi_create_function(env: napi_env, name: *const c_char, len: usize, cb: napi_callback, data: *mut c_void, result: *mut napi_value) -> napi_status;
    fn napi_set_named_property(env: napi_env, object: napi_value, name: *const c_char, value: napi_value) -> napi_status;
    fn napi_get_named_property(env: napi_env, object: napi_value, name: *const c_char, result: *mut napi_value) -> napi_status;
    fn napi_get_cb_info(env: napi_env, info: napi_callback_info, argc: *mut usize, argv: *mut napi_value, this: *mut napi_value, data: *mut *mut c_void) -> napi_status;
    fn napi_typeof(env: napi_env, value: napi_value, result: *mut i32) -> napi_status;
    fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
    fn napi_get_value_string_utf8(env: napi_env, value: napi_value, buf: *mut c_char, bufsize: usize, result: *mut usize) -> napi_status;
    fn napi_is_typedarray(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
    fn napi_get_typedarray_info(env: napi_env, value: napi_value, kind: *mut i32, length: *mut usize, data: *mut *mut c_void, arraybuffer: *mut napi_value, byte_offset: *mut usize) -> napi_status;
    fn napi_create_arraybuffer(env: napi_env, byte_length: usize, data: *mut *mut c_void, result: *mut napi_value) -> napi_status;
    fn napi_create_typedarray(env: napi_env, kind: i32, length: usize, arraybuffer: napi_value, byte_offset: usize, result: *mut napi_value) -> napi_status;
    fn napi_throw_error(env: napi_env, code: *const c_char, msg: *const c_char) -> napi_status;
    fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
    fn napi_create_string_utf8(env: napi_env, s: *const c_char, len: usize, result: *mut napi_value) -> napi_status;
    fn napi_create_double(env: napi_env, value: f64, result: *mut napi_value) -> napi_status;
    fn napi_create_array_with_length(env: napi_env, len: usize, result: *mut napi_value) -> napi_status;
    fn napi_set_element(env: napi_env, object: napi_value, index: u32, value: napi_value) -> napi_status;
}

fn cstring(s: &str) -> CString {
    CString::new(s.replace('\0', "\u{fffd}")).expect("no interior NUL after replacement")
}

unsafe fn throw(env: napi_env, code: &str, message: &str) -> napi_value {
    let (c, m) = (cstring(code), cstring(message));
    napi_throw_error(env, c.as_ptr(), m.as_ptr());
    ptr::null_mut()
}

unsafe fn string(env: napi_env, s: &str) -> napi_value {
    let mut v = ptr::null_mut();
    napi_create_string_utf8(env, s.as_ptr() as *const c_char, s.len(), &mut v);
    v
}

unsafe fn number(env: napi_env, x: f64) -> napi_value {
    let mut v = ptr::null_mut();
    napi_create_double(env, x, &mut v);
    v
}

unsafe fn set(env: napi_env, object: napi_value, key: &str, value: napi_value) {
    let k = cstring(key);
    napi_set_named_property(env, object, k.as_ptr(), value);
}

unsafe fn strings(env: napi_env, items: &[&str]) -> napi_value {
    let mut arr = ptr::null_mut();
    napi_create_array_with_length(env, items.len(), &mut arr);
    for (i, s) in items.iter().enumerate() {
        napi_set_element(env, arr, i as u32, string(env, s));
    }
    arr
}

unsafe fn args<const N: usize>(env: napi_env, info: napi_callback_info) -> (usize, [napi_value; N]) {
    let mut argc = N;
    let mut argv = [ptr::null_mut(); N];
    napi_get_cb_info(env, info, &mut argc, argv.as_mut_ptr(), ptr::null_mut(), ptr::null_mut());
    (argc, argv)
}

unsafe fn type_of(env: napi_env, v: napi_value) -> i32 {
    let mut t = -1;
    napi_typeof(env, v, &mut t);
    t
}

unsafe fn u32_arg(env: napi_env, v: napi_value) -> Option<u32> {
    if type_of(env, v) != NAPI_NUMBER {
        return None;
    }
    let mut d = -1.0;
    if napi_get_value_double(env, v, &mut d) != NAPI_OK || !(d >= 0.0) || d > u32::MAX as f64 || d != (d as u32) as f64 {
        return None;
    }
    Some(d as u32)
}

/// The words of a Uint32Array argument (copied: the kernel never sees JS memory).
unsafe fn words_arg(env: napi_env, v: napi_value) -> Option<Vec<u32>> {
    let mut is = false;
    napi_is_typedarray(env, v, &mut is);
    if !is {
        return None;
    }
    let (mut kind, mut len, mut data, mut ab, mut off) = (-1, 0usize, ptr::null_mut(), ptr::null_mut(), 0usize);
    if napi_get_typedarray_info(env, v, &mut kind, &mut len, &mut data, &mut ab, &mut off) != NAPI_OK || kind != NAPI_UINT32_ARRAY {
        return None;
    }
    if len == 0 || data.is_null() {
        return Some(Vec::new());
    }
    Some(std::slice::from_raw_parts(data as *const u32, len).to_vec())
}

unsafe fn words_value(env: napi_env, words: &[u32]) -> napi_value {
    let (mut data, mut ab, mut res) = (ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
    napi_create_arraybuffer(env, words.len() * 4, &mut data, &mut ab);
    if !words.is_empty() {
        ptr::copy_nonoverlapping(words.as_ptr(), data as *mut u32, words.len());
    }
    napi_create_typedarray(env, NAPI_UINT32_ARRAY, words.len(), ab, 0, &mut res);
    res
}

unsafe fn string_arg(env: napi_env, v: napi_value) -> Option<String> {
    if type_of(env, v) != NAPI_STRING {
        return None;
    }
    let mut length = 0usize;
    if napi_get_value_string_utf8(env, v, ptr::null_mut(), 0, &mut length) != NAPI_OK {
        return None;
    }
    let mut buf = vec![0u8; length.checked_add(1)?];
    let mut copied = 0usize;
    if napi_get_value_string_utf8(env, v, buf.as_mut_ptr() as *mut c_char, buf.len(), &mut copied) != NAPI_OK || copied != length {
        return None;
    }
    buf.truncate(length);
    String::from_utf8(buf).ok()
}

// ---------------------------------------------------------------- state

/// The ported kernel: nothing yet (W0). Every entry keeps the default
/// `Kernel` method and answers status 6 until a port overrides it.
struct RustKernel;

impl Kernel for RustKernel {
    #[cfg(feature = "plant-panic")]
    fn real__max(&self, a: wonky_wire::Real, b: wonky_wire::Real) -> Result<wonky_wire::Real, wonky_wire::OpError> {
        let _ = (a, b);
        panic!("planted panic in kernel/real.bend:max (feature plant-panic)");
    }
}

static THREADS: AtomicU32 = AtomicU32::new(0);
static CALLS: AtomicU64 = AtomicU64::new(0);
static FAULTS: AtomicU64 = AtomicU64::new(0);
static UNAVAILABLE: AtomicU64 = AtomicU64::new(0);
static REFUSED: AtomicU64 = AtomicU64::new(0);

const SOURCE_HASH: &str = match option_env!("WONKY_SOURCE_HASH") {
    Some(h) => h,
    None => "unbuilt",
};

fn features() -> Vec<&'static str> {
    let mut f = Vec::new();
    if cfg!(feature = "plant-panic") {
        f.push("plant-panic");
    }
    if cfg!(feature = "plant-count") {
        f.push("plant-count");
    }
    f
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "panic with a non-string payload".to_string()
    }
}

/// Runs `f` behind catch_unwind; a panic becomes a status-5 reply.
fn guarded(entry: Option<&str>, f: impl FnOnce() -> Result<Vec<u32>, CallError>) -> Vec<u32> {
    let reply = match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => reply_words(result, entry),
        Err(payload) => status_reply(STATUS_FAULT, &format!("panic in {}: {}", entry.unwrap_or("the Rust kernel"), panic_message(payload))),
    };
    CALLS.fetch_add(1, Ordering::Relaxed);
    match reply.first().copied() {
        Some(STATUS_OK) => {}
        Some(STATUS_UNAVAILABLE) => {
            UNAVAILABLE.fetch_add(1, Ordering::Relaxed);
        }
        Some(STATUS_FAULT) => {
            FAULTS.fetch_add(1, Ordering::Relaxed);
        }
        Some(STATUS_MALFORMED) | Some(STATUS_INVALID) | _ => {
            REFUSED.fetch_add(1, Ordering::Relaxed);
        }
    }
    reply
}

fn entry_of(op: u32) -> Option<&'static str> {
    OPS.get(op as usize).map(|o| o.entry)
}

// ---------------------------------------------------------------- exports

unsafe extern "C" fn js_init(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<1>(env, info);
    let mut threads = 1u32;
    if argc >= 1 && type_of(env, argv[0]) != NAPI_UNDEFINED {
        if type_of(env, argv[0]) != NAPI_OBJECT {
            return throw(env, "BX_ARGS", "init({ threads })");
        }
        let (mut t, key) = (ptr::null_mut(), cstring("threads"));
        napi_get_named_property(env, argv[0], key.as_ptr(), &mut t);
        if type_of(env, t) != NAPI_UNDEFINED {
            match u32_arg(env, t) {
                Some(n) if (1..=64).contains(&n) => threads = n,
                _ => return throw(env, "BX_ARGS", "threads must be an integer in 1..64"),
            }
        }
    }
    // One setting per process: every worker thread shares the static.
    match THREADS.compare_exchange(0, threads, Ordering::SeqCst, Ordering::SeqCst) {
        Ok(_) => {}
        Err(current) if current == threads => {}
        Err(current) => return throw(env, "BX_ABI", &format!("the Rust addon already runs with {current} thread(s); asked for {threads}")),
    }
    let mut out = ptr::null_mut();
    napi_create_object(env, &mut out);
    set(env, out, "threads", number(env, threads as f64));
    set(env, out, "apiVersion", number(env, API_VERSION as f64));
    out
}

unsafe fn initialised(env: napi_env) -> bool {
    if THREADS.load(Ordering::SeqCst) == 0 {
        throw(env, "BX_POISONED", "not initialised: call init() first");
        return false;
    }
    true
}

/// call(op, words, wire = 2) -> Uint32Array [status, ...]
unsafe extern "C" fn js_call(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<3>(env, info);
    if argc < 2 {
        return throw(env, "BX_ARGS", "call(op, words: Uint32Array, wire = 2)");
    }
    let Some(op) = u32_arg(env, argv[0]) else { return throw(env, "BX_ARGS", "op must be an unsigned 32-bit integer") };
    let Some(words) = words_arg(env, argv[1]) else { return throw(env, "BX_ARGS", "words must be a Uint32Array") };
    let version = if argc >= 3 && type_of(env, argv[2]) != NAPI_UNDEFINED {
        match u32_arg(env, argv[2]).and_then(Version::from_u32) {
            Some(v) => v,
            None => return throw(env, "BX_ARGS", "wire must be 1 or 2"),
        }
    } else {
        Version::V2
    };
    if !initialised(env) {
        return ptr::null_mut();
    }
    let reply = guarded(entry_of(op), || dispatch(&RustKernel, version, op, &words));
    words_value(env, &reply)
}

/// wire(version, op, words, 'args' | 'result') -> Uint32Array [status, ...re-encoded words]
unsafe extern "C" fn js_wire(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<4>(env, info);
    if argc < 4 {
        return throw(env, "BX_ARGS", "wire(version, op, words: Uint32Array, 'args' | 'result')");
    }
    let Some(version) = u32_arg(env, argv[0]).and_then(Version::from_u32) else { return throw(env, "BX_ARGS", "version must be 1 or 2") };
    let Some(op) = u32_arg(env, argv[1]) else { return throw(env, "BX_ARGS", "op must be an unsigned 32-bit integer") };
    let Some(words) = words_arg(env, argv[2]) else { return throw(env, "BX_ARGS", "words must be a Uint32Array") };
    let what = string_arg(env, argv[3]);
    let args_side = match what.as_deref() {
        Some("args") => true,
        Some("result") => false,
        _ => return throw(env, "BX_ARGS", "the fourth argument must be 'args' or 'result'"),
    };
    let reply = guarded(entry_of(op), || {
        let body = if args_side { roundtrip_args(version, op, &words)? } else { roundtrip_result(version, op, &words)? };
        let mut out = Vec::with_capacity(body.len() + 1);
        out.push(STATUS_OK);
        out.extend_from_slice(&body);
        Ok(out)
    });
    words_value(env, &reply)
}

/// v3 transport only: checked decode + canonical encode, never a geometry op.
/// Replies [0, ...canonical words] or [1, ...message code points].
unsafe extern "C" fn js_wire_v3(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<1>(env, info);
    if argc != 1 {
        return throw(env, "BX_ARGS", "wireV3(words: Uint32Array)");
    }
    let Some(words) = words_arg(env, argv[0]) else { return throw(env, "BX_ARGS", "words must be a Uint32Array") };
    if !initialised(env) {
        return ptr::null_mut();
    }
    let reply = match catch_unwind(AssertUnwindSafe(|| v3::checked_json(&words))) {
        Ok(Ok(_)) => std::iter::once(STATUS_OK).chain(words.iter().copied()).collect(),
        Ok(Err(message)) => status_reply(STATUS_MALFORMED, &message),
        Err(payload) => status_reply(STATUS_FAULT, &format!("panic in wireV3: {}", panic_message(payload))),
    };
    words_value(env, &reply)
}

/// The WC0 JSON reading (docs/rust-wire-v3.md) of a checked canonical v3 body.
unsafe extern "C" fn js_reference_step_json(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<1>(env, info);
    if argc != 1 { return throw(env, "BX_ARGS", "referenceStepJson expects STEP text"); }
    if type_of(env, argv[0]) != NAPI_STRING { return throw(env, "BX_ARGS", "STEP text must be a string"); }
    let mut length = 0usize;
    if napi_get_value_string_utf8(env, argv[0], ptr::null_mut(), 0, &mut length) != NAPI_OK { return throw(env, "BX_ARGS", "cannot read STEP text length"); }
    if length > 16 * 1024 * 1024 { return throw(env, "BX_CAPABILITY", "import/source-byte-limit"); }
    let mut bytes = vec![0u8; length + 1];
    let mut copied = 0usize;
    if napi_get_value_string_utf8(env, argv[0], bytes.as_mut_ptr() as *mut c_char, bytes.len(), &mut copied) != NAPI_OK || copied != length { return throw(env, "BX_ARGS", "cannot read complete STEP text"); }
    bytes.truncate(copied);
    if !initialised(env) { return ptr::null_mut(); }
    match catch_unwind(AssertUnwindSafe(|| wonky_ops::reference::import_json(&bytes))) {
        Ok(Ok(json)) => string(env, &json),
        Ok(Err(reason)) => throw(env, "BX_CAPABILITY", &reason),
        Err(payload) => throw(env, "BX_FAULT", &format!("panic in referenceStepJson: {}", panic_message(payload))),
    }
}

unsafe extern "C" fn js_reference_display_json(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<2>(env, info);
    if argc != 2 { return throw(env, "BX_ARGS", "referenceDisplayJson expects STEP text"); }
    if type_of(env, argv[0]) != NAPI_STRING { return throw(env, "BX_ARGS", "STEP text must be a string"); }
    let mut length = 0usize;
    if napi_get_value_string_utf8(env, argv[0], ptr::null_mut(), 0, &mut length) != NAPI_OK { return throw(env, "BX_ARGS", "cannot read STEP text length"); }
    if length > 16 * 1024 * 1024 { return throw(env, "BX_CAPABILITY", "import/source-byte-limit"); }
    let mut bytes = vec![0u8; length + 1];
    let mut copied = 0usize;
    if napi_get_value_string_utf8(env, argv[0], bytes.as_mut_ptr() as *mut c_char, bytes.len(), &mut copied) != NAPI_OK || copied != length { return throw(env, "BX_ARGS", "cannot read complete STEP text"); }
    bytes.truncate(copied);
    let mut deviation = 0.0;
    if napi_get_value_double(env, argv[1], &mut deviation) != NAPI_OK { return throw(env, "BX_ARGS", "deviation must be a number"); }
    if !initialised(env) { return ptr::null_mut(); }
    match catch_unwind(AssertUnwindSafe(|| wonky_ops::reference::display_source_json(&bytes, deviation))) {
        Ok(Ok(json)) => string(env, &json),
        Ok(Err(reason)) => throw(env, "BX_CAPABILITY", &reason),
        Err(payload) => throw(env, "BX_FAULT", &format!("panic in referenceDisplayJson: {}", panic_message(payload))),
    }
}

unsafe extern "C" fn js_reference_check_points(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<3>(env, info);
    if argc != 3 { return throw(env, "BX_ARGS", "referenceCheckPoints expects STEP text"); }
    if type_of(env, argv[0]) != NAPI_STRING { return throw(env, "BX_ARGS", "STEP text must be a string"); }
    let mut length = 0usize;
    if napi_get_value_string_utf8(env, argv[0], ptr::null_mut(), 0, &mut length) != NAPI_OK { return throw(env, "BX_ARGS", "cannot read STEP text length"); }
    if length > 16 * 1024 * 1024 { return throw(env, "BX_CAPABILITY", "import/source-byte-limit"); }
    let mut bytes = vec![0u8; length + 1];
    let mut copied = 0usize;
    if napi_get_value_string_utf8(env, argv[0], bytes.as_mut_ptr() as *mut c_char, bytes.len(), &mut copied) != NAPI_OK || copied != length { return throw(env, "BX_ARGS", "cannot read complete STEP text"); }
    bytes.truncate(copied);
    let mut deviation = 0.0;
    if napi_get_value_double(env, argv[2], &mut deviation) != NAPI_OK { return throw(env, "BX_ARGS", "deviation must be a number"); }
    let mut row_length = 0usize;
    if type_of(env, argv[1]) != NAPI_STRING || napi_get_value_string_utf8(env, argv[1], ptr::null_mut(), 0, &mut row_length) != NAPI_OK || row_length > 64*1024*1024 { return throw(env, "BX_ARGS", "invalid mesh observations"); }
    let mut row_bytes = vec![0u8; row_length + 1];
    let mut row_copied = 0usize;
    if napi_get_value_string_utf8(env, argv[1], row_bytes.as_mut_ptr() as *mut c_char, row_bytes.len(), &mut row_copied) != NAPI_OK || row_copied != row_length { return throw(env, "BX_ARGS", "incomplete mesh observations"); }
    let rows = match std::str::from_utf8(&row_bytes[..row_length]) { Ok(s) => s, Err(_) => return throw(env, "BX_ARGS", "mesh observation encoding") };
    if !initialised(env) { return ptr::null_mut(); }
    match catch_unwind(AssertUnwindSafe(|| wonky_ops::reference::check_display_points(&bytes, &rows, deviation))) {
        Ok(Ok(json)) => string(env, &json),
        Ok(Err(reason)) => throw(env, "BX_CAPABILITY", &reason),
        Err(payload) => throw(env, "BX_FAULT", &format!("panic in referenceCheckPoints: {}", panic_message(payload))),
    }
}

unsafe extern "C" fn js_reference_legalize_rows(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc,argv)=args::<1>(env,info);let mut length=0usize;
    if argc!=1||type_of(env,argv[0])!=NAPI_STRING||napi_get_value_string_utf8(env,argv[0],ptr::null_mut(),0,&mut length)!=NAPI_OK||length>16*1024*1024 {return throw(env,"BX_ARGS","invalid reference chart rows");}
    let mut bytes=vec![0u8;length+1];let mut copied=0usize;
    if napi_get_value_string_utf8(env,argv[0],bytes.as_mut_ptr() as *mut c_char,bytes.len(),&mut copied)!=NAPI_OK||copied!=length {return throw(env,"BX_ARGS","incomplete reference chart rows");}
    let rows=match std::str::from_utf8(&bytes[..length]) {Ok(s)=>s,Err(_)=>return throw(env,"BX_ARGS","reference chart encoding")};
    if !initialised(env) {return ptr::null_mut();}
    match catch_unwind(AssertUnwindSafe(||wonky_ops::reference::legalize_display_rows(rows))) {
        Ok(Ok(json))=>string(env,&json),Ok(Err(reason))=>throw(env,"BX_CAPABILITY",&reason),
        Err(payload)=>throw(env,"BX_FAULT",&format!("panic in referenceLegalizeRows: {}",panic_message(payload))),
    }
}

unsafe extern "C" fn js_wire_v3_json(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<1>(env, info);
    if argc != 1 {
        return throw(env, "BX_ARGS", "wireV3Json(words: Uint32Array)");
    }
    let Some(words) = words_arg(env, argv[0]) else { return throw(env, "BX_ARGS", "words must be a Uint32Array") };
    if !initialised(env) {
        return ptr::null_mut();
    }
    match catch_unwind(AssertUnwindSafe(|| v3::checked_json(&words))) {
        Ok(Ok(json)) => string(env, &json),
        Ok(Err(message)) => throw(env, "BX_WIRE", &message),
        Err(payload) => throw(env, "BX_FAULT", &format!("panic in wireV3Json: {}", panic_message(payload))),
    }
}

/// Host operations of the planar extrusion slice (wonky_ops::host): sketch
/// region, BLIND prism as a WC0 v3 body, measurements, planar STEP. Replies
/// [status, ...payload]: 0 ok, 1 malformed, 5 panic, 7 named refusal.
unsafe extern "C" fn js_host_op(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc, argv) = args::<1>(env, info);
    if argc != 1 {
        return throw(env, "BX_ARGS", "hostOp(words: Uint32Array)");
    }
    let Some(words) = words_arg(env, argv[0]) else { return throw(env, "BX_ARGS", "words must be a Uint32Array") };
    if !initialised(env) {
        return ptr::null_mut();
    }
    let reply = match catch_unwind(AssertUnwindSafe(|| wonky_ops::host::host_op(&words))) {
        Ok(reply) => reply,
        Err(payload) => status_reply(STATUS_FAULT, &format!("panic in hostOp: {}", panic_message(payload))),
    };
    CALLS.fetch_add(1, Ordering::Relaxed);
    words_value(env, &reply)
}

// Ask the same interpreter that constructed the angle to reconstruct atan.
// The input is rounded from the exact rational by Rust, not supplied by JS.
unsafe fn interpreter_atan(env: napi_env, input: f64) -> Result<f64, wonky_geom::Refused> {
    let (mut global, mut math, mut atan, mut argument, mut result) =
        (ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
    let mut word = 0.;
    if napi_get_global(env, &mut global) != NAPI_OK
        || napi_get_named_property(env, global, b"Math\0".as_ptr().cast(), &mut math) != NAPI_OK
        || napi_get_named_property(env, math, b"atan\0".as_ptr().cast(), &mut atan) != NAPI_OK
        || napi_create_double(env, input, &mut argument) != NAPI_OK
        || napi_call_function(env, math, atan, 1, &argument, &mut result) != NAPI_OK
        || napi_get_value_double(env, result, &mut word) != NAPI_OK
    {
        return Err(wonky_geom::Refused("angle/witness-construction-unavailable"));
    }
    Ok(word)
}

unsafe extern "C" fn js_angle_witness(env: napi_env, info: napi_callback_info) -> napi_value {
    let (argc,argv)=args::<4>(env,info);
    if argc!=4 {return throw(env,"BX_ARGS","angleWitness(word, kind, numerator, denominator)")}
    let mut word=0.;
    if napi_get_value_double(env,argv[0],&mut word)!=NAPI_OK {return throw(env,"BX_ARGS","angle word")}
    let result=catch_unwind(AssertUnwindSafe(|| -> Result<(),wonky_geom::Refused> {
        let kind=string_arg(env,argv[1]).ok_or(wonky_geom::Refused("angle/witness-mismatch"))?;
        let n=string_arg(env,argv[2]).and_then(|s|s.parse::<wonky_alg::BigInt>().ok()).ok_or(wonky_geom::Refused("angle/witness-mismatch"))?;
        let d=string_arg(env,argv[3]).and_then(|s|s.parse::<wonky_alg::BigInt>().ok()).ok_or(wonky_geom::Refused("angle/witness-mismatch"))?;
        if d<=wonky_alg::BigInt::from(0) {return Err(wonky_geom::Refused("angle/witness-mismatch"))}
        let q=wonky_geom::Q::new(n,d);
        let witness=match kind.as_str() {"Turns"=>wonky_geom::AngleWitness::Turns(q),"Tan"=>wonky_geom::AngleWitness::Tan(q),_=>return Err(wonky_geom::Refused("angle/witness-mismatch"))};
        wonky_geom::Turn::verify_witness_with_atan(word,Some(&witness), |input| interpreter_atan(env, input))
    }));
    match result {Ok(Ok(()))=>string(env,""),Ok(Err(e))=>string(env,e.0),Err(_)=>string(env,"angle/witness-fault")}
}

unsafe extern "C" fn js_info(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut out = ptr::null_mut();
    napi_create_object(env, &mut out);
    set(env, out, "apiVersion", number(env, API_VERSION as f64));
    set(env, out, "sourceHash", string(env, SOURCE_HASH));
    set(env, out, "wireHash", string(env, WIRE_HASH));
    set(env, out, "wireFormat", string(env, WIRE_FORMAT));
    set(env, out, "set", string(env, "rust"));
    set(env, out, "napi", number(env, NAPI_VERSION as f64));
    set(env, out, "threads", number(env, THREADS.load(Ordering::SeqCst) as f64));
    let entries: Vec<&str> = OPS.iter().map(|o| o.entry).collect();
    set(env, out, "ops", strings(env, &entries));
    set(env, out, "features", strings(env, &features()));
    let mut versions = ptr::null_mut();
    napi_create_array_with_length(env, 3, &mut versions);
    napi_set_element(env, versions, 0, number(env, 1.0));
    napi_set_element(env, versions, 1, number(env, 2.0));
    napi_set_element(env, versions, 2, number(env, 3.0));
    // The host-op request layout version (wonky_ops::host::VERSION).
    set(env, out, "hostOpVersion", number(env, wonky_ops::host::VERSION as f64));
    set(env, out, "wireVersions", versions);
    out
}

/// Nothing to reset: the addon keeps no kernel state between calls. Kept for
/// the Bend addon's interface; answers 0 (ms).
unsafe extern "C" fn js_reset(env: napi_env, _info: napi_callback_info) -> napi_value {
    number(env, 0.0)
}

unsafe extern "C" fn js_stats(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut out = ptr::null_mut();
    napi_create_object(env, &mut out);
    set(env, out, "calls", number(env, CALLS.load(Ordering::Relaxed) as f64));
    set(env, out, "faults", number(env, FAULTS.load(Ordering::Relaxed) as f64));
    set(env, out, "unavailable", number(env, UNAVAILABLE.load(Ordering::Relaxed) as f64));
    set(env, out, "refused", number(env, REFUSED.load(Ordering::Relaxed) as f64));
    out
}

#[no_mangle]
pub unsafe extern "C" fn napi_register_module_v1(env: napi_env, exports: napi_value) -> napi_value {
    let functions: [(&str, napi_callback); 14] = [
        ("angleWitness", js_angle_witness),
        ("init", js_init),
        ("call", js_call),
        ("wire", js_wire),
        ("wireV3", js_wire_v3),
        ("wireV3Json", js_wire_v3_json),
        ("referenceStepJson", js_reference_step_json),
        ("referenceDisplayJson", js_reference_display_json),
        ("referenceCheckPoints", js_reference_check_points),
        ("referenceLegalizeRows", js_reference_legalize_rows),
        ("hostOp", js_host_op),
        ("info", js_info),
        ("reset", js_reset),
        ("stats", js_stats),
    ];
    for (name, cb) in functions {
        let mut f = ptr::null_mut();
        napi_create_function(env, name.as_ptr() as *const c_char, name.len(), cb, ptr::null_mut(), &mut f);
        set(env, exports, name, f);
    }
    exports
}

#[no_mangle]
pub extern "C" fn node_api_module_get_api_version_v1() -> i32 {
    NAPI_VERSION
}
