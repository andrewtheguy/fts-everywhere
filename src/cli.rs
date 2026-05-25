use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "minisearch", version, about = "S3 file browser with full-text search")]
pub struct Cli {
    #[arg(short, long, env = "MINISEARCH_CONFIG")]
    pub config: PathBuf,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Start the web server
    Serve,
    /// Index S3 bucket contents into Tantivy
    Index {
        /// Profile name to index (indexes all profiles if not specified)
        #[arg(short, long)]
        profile: Option<String>,
    },
}
