use tantivy::IndexReader;

use crate::search::SearchSchema;

#[derive(Clone)]
pub struct AppState {
    pub s3_client: aws_sdk_s3::Client,
    pub bucket_name: String,
    pub search_reader: Option<IndexReader>,
    pub search_schema: Option<SearchSchema>,
}
