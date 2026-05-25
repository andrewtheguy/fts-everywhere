# Using MiniSearch with an S3 Gateway

Index and search files on a local filesystem by fronting them with an S3-compatible gateway. MiniSearch only performs read-only S3 operations (ListObjectsV2, HeadObject, GetObject, presigned GET), so the gateway never needs write permissions.

This guide uses [VersityGW](https://github.com/versity/versitygw) as the example, but any S3-compatible gateway works.

## Prerequisites

- MiniSearch binary ([install instructions](../README.md#install-pre-built-binary))
- [VersityGW](https://github.com/versity/versitygw/releases)
- A directory of files you want to index

## 1. Start VersityGW

Point VersityGW at a local directory using the POSIX backend in read-only mode:

```bash
versitygw posix \
  --port 7070 \
  --access myaccesskey \
  --secret mysecretkey \
  --readonly \
  --nometa \
  /path/to/your/files
```

- `--readonly` — enforces strictly read-only access at the gateway level. All write API calls (create, upload, delete) return `AccessDenied` (HTTP 403). Can also be set via env var `VGW_READ_ONLY=true`.
- `--nometa` — disables xattr metadata storage. Useful for read-only setups since there is no metadata to write, and removes the xattr filesystem requirement.
- `--access` / `--secret` — arbitrary credential strings; use the same values in the MiniSearch config.

With the POSIX backend, the S3 bucket name corresponds to a subdirectory under the root path. For example, if you point VersityGW at `/data` and your files are in `/data/documents`, the bucket name is `documents`.

## 2. Set up a hostname for the gateway

MiniSearch requires the endpoint URL to use a hostname, not an IP address. Using `http://127.0.0.1:7070` will fail with:

```
AWS_ENDPOINT_URL host must be a hostname, not an IP address
```

Add a hostname alias to `/etc/hosts`:

```
127.0.0.1  versitygw.local
```

Then use `http://versitygw.local:7070` as the endpoint URL. `localhost` also works if VersityGW is on the same machine.

## 3. Configure MiniSearch

Create a `config.toml`:

```toml
aws_access_key_id = "myaccesskey"
aws_secret_access_key = "mysecretkey"
aws_region = "us-east-1"
aws_endpoint_url = "http://versitygw.local:7070"
s3_bucket_name = "documents"
tantivy_index_path = "./tantivy_index"
```

`aws_region` is required but not meaningful for a local gateway — any valid region string works.

## 4. Index and serve

```bash
# Build the search index
minisearch -c config.toml index

# Start the web server
minisearch -c config.toml serve
```

Open http://localhost:3000 to search your files.

## Security notes

- MiniSearch never writes to S3. Even if the gateway allows writes, MiniSearch will not modify your files.
- VersityGW can be further locked down with IAM policies for read-only access, but this is not strictly necessary given MiniSearch's read-only behavior.
- Presigned URLs point back to the gateway endpoint. For the browser to follow them, the gateway must be reachable from the client machine at the configured endpoint URL.
- For production deployments, consider running VersityGW behind a reverse proxy with TLS.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `AWS_ENDPOINT_URL host must be a hostname, not an IP address` | Endpoint URL uses an IP like `127.0.0.1` | Use a hostname — add an `/etc/hosts` entry or use `localhost` |
| `failed to list S3 objects` | Gateway not running or bucket does not exist | Verify VersityGW is running and the subdirectory matching your bucket name exists |
| `search index not available` (503) | Index not built yet | Run `minisearch -c config.toml index` before serving |
| Presigned URLs return errors in the browser | Gateway not reachable from the browser | Ensure the endpoint URL hostname resolves on the client machine |
