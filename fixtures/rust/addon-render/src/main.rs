// Machinery fixture only: build identity is real; rendering is unavailable.
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--build-identity") {
        println!("{}", env!("WONKY_RENDER_SOURCE_HASH"));
    } else {
        eprintln!("fixture/rendering-unavailable");
        std::process::exit(1);
    }
}
