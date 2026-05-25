use std::collections::HashSet;
use std::path::Path;

use anyhow::{bail, Context};
use aws_sdk_s3::config::Credentials;

#[derive(serde::Deserialize, Clone)]
pub struct ProfileConfig {
    pub name: String,
    pub description: String,
    pub aws_access_key_id: String,
    pub aws_secret_access_key: String,
    pub aws_region: String,
    pub aws_endpoint_url: String,
    pub s3_bucket_name: String,
    pub tantivy_index_path: String,
}

impl ProfileConfig {
    pub async fn s3_client(&self) -> aws_sdk_s3::Client {
        let creds = Credentials::new(
            &self.aws_access_key_id,
            &self.aws_secret_access_key,
            None,
            None,
            "toml-config",
        );
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .credentials_provider(creds)
            .region(aws_config::Region::new(self.aws_region.clone()))
            .endpoint_url(&self.aws_endpoint_url)
            .load()
            .await;
        aws_sdk_s3::Client::new(&config)
    }
}

#[derive(serde::Deserialize)]
pub struct AppConfig {
    pub profiles: Vec<ProfileConfig>,
}

impl AppConfig {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config file: {}", path.display()))?;
        let config: Self = toml::from_str(&contents)
            .with_context(|| format!("failed to parse config file: {}", path.display()))?;

        if config.profiles.is_empty() {
            bail!("config must contain at least one [[profiles]] entry");
        }

        let mut seen = HashSet::new();
        for profile in &config.profiles {
            if profile.name.is_empty() {
                bail!("profile name must not be empty");
            }
            if !profile
                .name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
            {
                bail!(
                    "profile name '{}' must contain only lowercase letters, digits, hyphens, and underscores",
                    profile.name
                );
            }
            if !seen.insert(&profile.name) {
                bail!("duplicate profile name: '{}'", profile.name);
            }
        }

        Ok(config)
    }
}
