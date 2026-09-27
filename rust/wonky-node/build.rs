// The addon is loaded by Node, which provides the napi_* symbols: on macOS the
// cdylib must leave them undefined for the dynamic loader. The build key
// (scripts/rust/build-node.mjs) passes WONKY_SOURCE_HASH; a change rebuilds.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-cdylib-link-arg=-undefined");
        println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
    }
    println!("cargo:rerun-if-env-changed=WONKY_SOURCE_HASH");
    println!("cargo:rerun-if-changed=build.rs");
}
