mod assets;
mod cli;
mod handlers;
mod indexer;
mod search;
mod state;

use axum::{routing::get, Router};
use clap::Parser;
use cli::{Cli, Commands};
use state::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();

    match cli.command {
        Commands::Index => {
            indexer::run_indexer().await;
        }
        Commands::Serve => {
            let index_path = search::index_path();
            let (search_reader, search_schema) = match search::open_index(&index_path) {
                Some(index) => {
                    let reader = index
                        .reader()
                        .expect("failed to create index reader");
                    let schema = search::build_schema();
                    (Some(reader), Some(schema))
                }
                None => {
                    eprintln!("warning: search index not found at {index_path:?} — search will be unavailable");
                    (None, None)
                }
            };

            let state = AppState {
                search_reader,
                search_schema,
            };

            let app = Router::new()
                .route("/api/health", get(|| async { "ok" }))
                .route("/api/search", get(handlers::search))
                .with_state(state)
                .fallback(assets::static_handler);

            let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
            println!("listening on http://localhost:3000");
            axum::serve(listener, app).await.unwrap();
        }
    }
}
