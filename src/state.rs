use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use tantivy::IndexReader;

use crate::search::SearchSchema;

#[derive(Clone)]
pub struct AppState {
    pub profiles: Vec<ProfileEntry>,
}

impl AppState {
    pub fn get_profile(&self, name: &str) -> Option<&ProfileEntry> {
        self.profiles.iter().find(|p| p.name == name)
    }
}

#[derive(Clone)]
pub struct ProfileEntry {
    pub name: String,
    pub description: String,
    pub state: ProfileState,
}

#[derive(Clone)]
pub struct ProfileState {
    pub s3_client: aws_sdk_s3::Client,
    pub bucket_name: String,
    pub index_path: PathBuf,
    pub search: Arc<RwLock<Option<SearchState>>>,
}

#[derive(Clone)]
pub struct SearchState {
    pub reader: IndexReader,
    pub schema: SearchSchema,
}
