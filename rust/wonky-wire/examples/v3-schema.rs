//! Export the frozen public schema and generated transport examples.
//! cargo run -p wonky-wire --example v3-schema -- ../out/wc0
#[path = "../tests/v3_cases/mod.rs"]
mod v3_cases;
fn main() {
    let root = std::path::PathBuf::from(std::env::args().nth(1).expect("output directory"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("rust-wire-v3.schema.json"),
        wonky_wire::v3::json_schema() + "\n",
    )
    .unwrap();
    let mut corpus = String::new();
    for seed in 0..128 {
        let body = v3_cases::generated(seed);
        // Export only samples that traverse the actual word codec successfully.
        let words = wonky_wire::v3::encode(&body).unwrap();
        let recovered = wonky_wire::v3::decode(&words).unwrap();
        corpus.push_str(&wonky_wire::v3::to_json(recovered.body()).unwrap());
        corpus.push('\n');
    }
    std::fs::write(root.join("cases.jsonl"), corpus).unwrap();
}
