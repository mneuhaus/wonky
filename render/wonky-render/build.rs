fn main() {
    println!("cargo:rerun-if-env-changed=WONKY_RENDER_SOURCE_HASH");
    // Direct Cargo tests may compile without publishing a keyed renderer.
    let hash = std::env::var("WONKY_RENDER_SOURCE_HASH").unwrap_or_else(|_| "unkeyed".into());
    println!("cargo:rustc-env=WONKY_RENDER_SOURCE_HASH={hash}");
}
