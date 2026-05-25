use std::path::{Path, PathBuf};

use tantivy::schema::{Field, Schema, STORED, STRING, TEXT};
use tantivy::Index;

#[derive(Clone)]
pub struct SearchSchema {
    pub schema: Schema,
    pub key: Field,
    pub content: Field,
    pub size: Field,
    pub last_modified: Field,
}

pub fn build_schema() -> SearchSchema {
    let mut builder = Schema::builder();
    let key = builder.add_text_field("key", TEXT | STORED);
    let content = builder.add_text_field("content", TEXT | STORED);
    let size = builder.add_u64_field("size", STORED);
    let last_modified = builder.add_text_field("last_modified", STRING | STORED);
    SearchSchema {
        schema: builder.build(),
        key,
        content,
        size,
        last_modified,
    }
}

pub fn index_path() -> PathBuf {
    std::env::var("TANTIVY_INDEX_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./tantivy_index"))
}

pub fn open_or_create_index(path: &Path, schema: &Schema) -> tantivy::Result<Index> {
    if path.exists() {
        Index::open_in_dir(path)
    } else {
        std::fs::create_dir_all(path).expect("failed to create index directory");
        Index::create_in_dir(path, schema.clone())
    }
}

pub fn open_index(path: &Path) -> Option<Index> {
    if path.exists() {
        Index::open_in_dir(path).ok()
    } else {
        None
    }
}
