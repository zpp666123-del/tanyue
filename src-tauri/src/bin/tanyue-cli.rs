use serde_json::json;
use std::{env, fs, path::Path, process};
use tanyue_lib::import_package::{
    default_app_data_dir, queue_import_package, validate_import_package, IMPORT_SCHEMA,
};

fn output(value: serde_json::Value) {
    println!(
        "{}",
        serde_json::to_string(&value).expect("serialize CLI result")
    );
}

fn fail(message: impl Into<String>) -> ! {
    output(
        json!({ "ok": false, "error": { "code": "invalid_request", "message": message.into() } }),
    );
    process::exit(2);
}

fn read_package(path: &str) -> String {
    fs::read_to_string(Path::new(path))
        .unwrap_or_else(|error| fail(format!("cannot read {path}: {error}")))
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [command] if command == "schema" => println!("{IMPORT_SCHEMA}"),
        [command, path] if command == "validate" => {
            let raw = read_package(path);
            match validate_import_package(&raw) {
                Ok(result) => output(json!({ "ok": true, "result": result })),
                Err(error) => fail(error),
            }
        }
        [command, path] if command == "import" => {
            let raw = read_package(path);
            let app_data = default_app_data_dir().unwrap_or_else(|error| fail(error));
            match queue_import_package(&raw, &app_data) {
                Ok(result) => output(json!({ "ok": true, "result": result })),
                Err(error) => fail(error),
            }
        }
        _ => fail("usage: tanyue-cli schema | validate <package.tanyue.json> | import <package.tanyue.json>"),
    }
}
