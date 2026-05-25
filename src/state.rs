use tantivy::IndexReader;

use crate::search::SearchSchema;

#[derive(Clone)]
pub struct AppState {
    pub search_reader: Option<IndexReader>,
    pub search_schema: Option<SearchSchema>,
}
