# fts-everywhere

Full-text search everywhere — Rust backend.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [mold](https://github.com/rui314/mold) linker (for fast incremental builds)
- [bacon](https://github.com/Canop/bacon) (file watcher)

Install on Debian/Ubuntu:

```bash
sudo apt install mold clang
cargo install bacon
```

## Development

Run bacon in one terminal to auto-rebuild on file changes:

```bash
bacon
```

Run the server in another terminal:

```bash
cargo run
```

After making changes, bacon rebuilds the binary in the background (~0.5s). Stop the server with Ctrl+C and run `cargo run` again to apply.

## API

| Endpoint | Method | Response |
|----------|--------|----------|
| `/`      | GET    | `ok`     |

Server listens on `http://localhost:3000`.
