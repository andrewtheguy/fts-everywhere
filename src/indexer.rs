use tantivy::doc;

use crate::search;

pub async fn run_indexer() {
    let bucket_name = std::env::var("S3_BUCKET_NAME").expect("S3_BUCKET_NAME must be set");
    let aws_config = aws_config::load_from_env().await;
    let s3_client = aws_sdk_s3::Client::new(&aws_config);

    let search_schema = search::build_schema();
    let index_path = search::index_path();
    let index =
        search::open_or_create_index(&index_path, &search_schema.schema).expect("failed to open/create index");

    let mut writer = index.writer(50_000_000).expect("failed to create index writer");

    writer.delete_all_documents().unwrap();
    writer.commit().unwrap();

    let mut indexed = 0usize;
    let mut skipped = 0usize;
    let mut continuation_token: Option<String> = None;

    loop {
        let mut req = s3_client.list_objects_v2().bucket(&bucket_name);
        if let Some(token) = &continuation_token {
            req = req.continuation_token(token);
        }
        let output = req.send().await.expect("failed to list S3 objects");

        let contents = output.contents();
        for obj in contents {
            let key = match obj.key() {
                Some(k) => k.to_string(),
                None => continue,
            };
            let size = obj.size().unwrap_or(0) as u64;
            let last_modified = obj
                .last_modified()
                .map(|dt| {
                    dt.fmt(aws_sdk_s3::primitives::DateTimeFormat::DateTime)
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let get_result = s3_client
                .get_object()
                .bucket(&bucket_name)
                .key(&key)
                .send()
                .await;

            let body = match get_result {
                Ok(output) => match output.body.collect().await {
                    Ok(bytes) => bytes.into_bytes(),
                    Err(e) => {
                        eprintln!("warning: failed to read body for {key}: {e}");
                        skipped += 1;
                        continue;
                    }
                },
                Err(e) => {
                    eprintln!("warning: failed to download {key}: {e}");
                    skipped += 1;
                    continue;
                }
            };

            let text = match String::from_utf8(body.to_vec()) {
                Ok(t) => t,
                Err(_) => {
                    eprintln!("warning: skipping non-UTF-8 file: {key}");
                    skipped += 1;
                    continue;
                }
            };

            writer
                .add_document(doc!(
                    search_schema.key => key.as_str(),
                    search_schema.content => text.as_str(),
                    search_schema.size => size,
                    search_schema.last_modified => last_modified.as_str(),
                ))
                .unwrap();

            indexed += 1;
            if indexed % 100 == 0 {
                writer.commit().unwrap();
                println!("progress: indexed {indexed} files...");
            }
        }

        if output.is_truncated() == Some(true) {
            continuation_token = output.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    writer.commit().unwrap();
    println!("done: indexed {indexed} files, skipped {skipped}");
}
