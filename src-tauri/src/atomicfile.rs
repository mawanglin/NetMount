//! 原子写文件与损坏文件隔离（仅依赖标准库）。
//!
//! 直接 `File::create` 再写入会先清空文件：写入中途崩溃、断电或磁盘写满，
//! 会留下空的或被截断的文件。这里改为先写同目录下的临时文件并 fsync，
//! 再用重命名覆盖目标（同一文件系统内的重命名是原子的）。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    path.with_file_name(name)
}

/// 原子地把 `bytes` 写入 `path`。失败时目标文件保持原样。
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = tmp_path(path);
    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// 把损坏的文件改名为 `<name>.corrupt-<unix 秒>` 留作取证/手动恢复，返回新路径。
pub fn quarantine_corrupt(path: &Path) -> std::io::Result<PathBuf> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(".corrupt-{}", ts));
    let target = path.with_file_name(name);
    fs::rename(path, &target)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netmount-atomic-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_and_overwrites_existing() {
        let dir = unique_dir("write");
        let path = dir.join("config.json");
        write_atomic(&path, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"a\":1}");
        write_atomic(&path, b"{\"a\":2}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"a\":2}");
        // 不应遗留临时文件
        assert!(!dir.join("config.json.tmp").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_write_keeps_original_content() {
        let dir = unique_dir("fail");
        let path = dir.join("config.json");
        write_atomic(&path, b"original").unwrap();
        // 目标目录不存在 → 创建临时文件失败，原文件不受影响
        let bad = dir.join("missing-dir").join("config.json");
        assert!(write_atomic(&bad, b"new").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn quarantine_moves_file_aside() {
        let dir = unique_dir("quarantine");
        let path = dir.join("config.json");
        fs::write(&path, b"{truncated").unwrap();
        let moved = quarantine_corrupt(&path).unwrap();
        assert!(!path.exists());
        assert!(moved.exists());
        assert!(moved
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("config.json.corrupt-"));
        assert_eq!(fs::read(&moved).unwrap(), b"{truncated");
        fs::remove_dir_all(&dir).ok();
    }
}
