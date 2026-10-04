// Tiny real Cargo cdylib for build/cache/loader machinery, never a kernel.
#[cfg(not(panic = "unwind"))]
compile_error!("wonky-node requires panic=unwind: abort would terminate the Node host");

// Exported symbols keep the keyed bytes and workspace dependency in the binary.
#[no_mangle]
pub extern "C" fn source_hash() -> *const u8 {
    env!("WONKY_SOURCE_HASH").as_ptr()
}

#[no_mangle]
pub extern "C" fn dependency_value() -> u32 { wonky_wire::value() }
