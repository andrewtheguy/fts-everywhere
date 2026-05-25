# Architecture

MiniSearch is a full-text search application for S3 objects. It indexes file contents and metadata from an S3-compatible bucket into a [Tantivy](https://github.com/quickwit-oss/tantivy) search index, then serves a web UI for querying and browsing results.

## High-level overview

```
                  ┌──────────────┐
                  │  S3 Bucket   │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        ┌─────▼─────┐        ┌─────▼─────┐
        │  Indexer   │        │  Presign  │
        │ (CLI mode) │        │ (runtime) │
        └─────┬──────┘        └───────────┘
              │
        ┌─────▼──────┐
        │  Tantivy   │
        │   Index    │
        └─────┬──────┘
              │
        ┌─────▼──────┐       ┌────────────┐
        │ Axum HTTP  │◄──────│  React SPA │
        │  Server    │       │ (embedded) │
        └────────────┘       └────────────┘
```

The application ships as a single binary. The React frontend is compiled and embedded into the binary at build time via `rust-embed`, so no separate static file hosting is needed.

## CLI modes

The binary has two subcommands:

- **`index`** — Scans the configured S3 bucket, downloads text files, and builds/updates the Tantivy index on disk.
- **`serve`** — Starts the Axum web server on port 3000, serving the API and embedded frontend.

Configuration is loaded from a TOML file (`-c`/`--config` flag or `MINISEARCH_CONFIG` env var).

## Backend (Rust)

### Module layout

| Module | Responsibility |
|---|---|
| `main.rs` | Entry point — parses CLI args, loads config, dispatches to indexer or server |
| `cli.rs` | Clap-based CLI definition (`Serve` / `Index` commands) |
| `config.rs` | TOML config parsing, AWS credential and S3 client construction |
| `state.rs` | `AppState` — shared state holding S3 client, index path, and thread-safe search reader |
| `search.rs` | Tantivy schema definition, tokenizer registration, index open/create |
| `indexer.rs` | S3 object listing, content downloading, incremental index updates |
| `handlers.rs` | Axum request handlers for search, presign, and health endpoints |
| `error.rs` | `AppError` enum — maps error variants to HTTP status codes |
| `assets.rs` | Embedded frontend asset serving with SPA fallback |

### Tantivy schema

| Field | Type | Indexed | Stored | Notes |
|---|---|---|---|---|
| `key` | Text | Yes (Jieba) | Yes | S3 object key |
| `content` | Text | Yes (Jieba) | Yes | File body (text files only) |
| `size` | u64 | No | Yes | File size in bytes |
| `last_modified` | String | No | Yes | ISO 8601 timestamp |

The [Jieba](https://github.com/nickel-org/tantivy-jieba) tokenizer handles both Chinese and English text segmentation.

The index is stored at `{tantivy_index_path}/{s3_host}/{bucket_name}/`.

### Indexing pipeline

1. Lists all objects in the S3 bucket (paginated with continuation tokens).
2. For each object, checks whether it has already been indexed with the same `last_modified` timestamp — if so, skips it.
3. Determines if the file is text based on file extension (`.txt`, `.md`, `.json`, `.py`, etc.) or HTTP `Content-Type` header.
4. Text files: downloads body and indexes both key and content. Non-text files: indexes key only.
5. Removes index entries for S3 objects that no longer exist.
6. Commits to the Tantivy index every 100 documents.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/search?q=<query>&page=<n>` | Full-text search with paginated results (20 per page) |
| `GET` | `/api/presign?key=<s3_key>` | Redirects to a 1-hour presigned S3 URL |
| `GET` | `/api/health` | Returns `"ok"` |
| `GET` | `/*` | Serves embedded frontend assets (SPA fallback to `index.html`) |

### Search response

Results include structured snippet segments that indicate which portions of the text matched the query:

```json
{
  "query": "search term",
  "count": 42,
  "limit": 20,
  "page": 1,
  "total_pages": 3,
  "results": [
    {
      "key": "path/to/file.md",
      "snippet": [
        { "text": "some ", "highlighted": false, "start": 0, "end": 5 },
        { "text": "search", "highlighted": true, "start": 5, "end": 11 },
        { "text": " context", "highlighted": false, "start": 11, "end": 19 }
      ],
      "score": 3.5,
      "size": 12345,
      "last_modified": "2025-05-25T12:34:56Z"
    }
  ]
}
```

Snippet generation selects the best 150-character fragment with the most query term matches and splits it into highlighted/non-highlighted segments.

### Shared state

```
AppState
├── s3_client: aws_sdk_s3::Client
├── bucket_name: String
├── index_path: PathBuf
└── search: Arc<RwLock<Option<SearchState>>>
         └── SearchState
             ├── reader: IndexReader
             └── schema: SearchSchema
```

The search reader is lazily initialized on first query. This allows the server to start even if no index has been built yet (returns 503 until ready).

### Error handling

- `anyhow` for application-level errors (main, indexer, search internals).
- `thiserror` for typed API errors (`AppError` in `error.rs`):
  - `BadRequest` → 400
  - `ServiceUnavailable` → 503
  - `Internal` → 500 (generic message to client, full error chain logged to stderr)

## Frontend (React + TypeScript)

### Stack

- React 19 with TypeScript
- Vite (bundler)
- Tailwind CSS (styling)
- @base-ui/react (headless UI primitives)
- lucide-react (icons)
- Biome (linting/formatting)

### Key behaviors

- **URL-synchronized search state**: query and page number are reflected in URL parameters (`?q=...&page=...`) for shareability and browser history navigation.
- **Request cancellation**: uses `AbortController` to cancel in-flight searches when a new query is submitted.
- **Snippet rendering**: displays search result snippets with `<mark>` tags on highlighted terms.
- **File access**: result links point to `/api/presign?key=...`, which redirects to a temporary S3 URL.
- **Pagination**: first/previous/next/last page controls with scroll-to-top on page change.

## Build and deployment

### Single binary build

```
frontend/src/ ──► vite build ──► frontend/dist/ ──► rust-embed ──► cargo build ──► minisearch binary
```

The frontend is built first, then `rust-embed` bundles the `frontend/dist/` directory into the Rust binary at compile time.

### Development

```bash
# Backend (port 3000)
cargo run -- -c config.toml serve

# Frontend dev server (port 5173, proxies /api to :3000)
cd frontend && bun run dev
```

### CI/CD

GitHub Actions builds release binaries for:
- Linux x86_64
- Linux arm64
- macOS arm64

### Configuration

All configuration is in a single TOML file:

```toml
aws_access_key_id = "..."
aws_secret_access_key = "..."
aws_region = "us-east-1"
aws_endpoint_url = "https://s3.amazonaws.com"  # or MinIO/compatible endpoint
s3_bucket_name = "my-bucket"
tantivy_index_path = "./tantivy_index"
```
