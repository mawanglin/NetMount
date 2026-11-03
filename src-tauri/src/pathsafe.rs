//! 路径安全校验工具（仅依赖标准库）。
//!
//! 直接对不存在的路径 `canonicalize` 会失败，若回退为原始路径再用 `starts_with`
//! 判断，`base/../../x` 这类带 `..` 的路径会被误判为在 `base` 之内。
//! 这里先做词法规范化，再对已存在的最长祖先目录解析符号链接，最后拼回剩余部分。

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// 词法规范化：消除 `.` 与 `..`，不访问文件系统。
pub fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                // 已在根目录或相对路径开头时无法再上溯，直接忽略
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 解析路径的真实位置：对已存在的最长祖先做 `canonicalize`（解析符号链接），
/// 再拼接其后的、已词法规范化的剩余部分。
pub fn resolve_lenient(path: &Path) -> PathBuf {
    let normalized = normalize_lexical(path);
    let mut existing: &Path = normalized.as_path();
    let mut tail: Vec<&OsStr> = Vec::new();
    loop {
        if let Ok(mut resolved) = existing.canonicalize() {
            for part in tail.iter().rev() {
                resolved.push(part);
            }
            return resolved;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                existing = parent;
            }
            _ => return normalized,
        }
    }
}

/// `candidate` 解析后是否位于 `base` 之内（含 `base` 本身）。
pub fn is_under(base: &Path, candidate: &Path) -> bool {
    resolve_lenient(candidate).starts_with(resolve_lenient(base))
}

/// 将压缩包条目名安全地拼接到 `base` 下。
/// 仅允许普通路径分量，拒绝 `..`、绝对路径、盘符前缀与反斜杠。
pub fn safe_join(base: &Path, entry_name: &str) -> Result<PathBuf, String> {
    if entry_name.is_empty() || entry_name.contains('\\') || entry_name.contains('\0') {
        return Err(format!("非法的条目路径 '{}'", entry_name));
    }
    let mut out = base.to_path_buf();
    for component in Path::new(entry_name).components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => return Err(format!("非法的条目路径 '{}'", entry_name)),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netmount-pathsafe-{}-{}-{}",
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
    fn normalizes_dot_segments() {
        assert_eq!(
            normalize_lexical(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(normalize_lexical(Path::new("/../..")), PathBuf::from("/"));
    }

    #[test]
    fn allows_existing_and_new_children() {
        let base = unique_dir("ok");
        assert!(is_under(&base, &base));
        assert!(is_under(&base, &base.join("new/sub/file.txt")));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rejects_dotdot_escape_of_nonexistent_path() {
        let base = unique_dir("escape");
        let evil = base.join("../../../../tmp/netmount-evil");
        assert!(!is_under(&base, &evil));
        assert!(!is_under(&base, &base.join("a/../../outside")));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rejects_sibling_with_same_prefix() {
        let base = unique_dir("prefix");
        let sibling = PathBuf::from(format!("{}-other/file", base.display()));
        assert!(!is_under(&base, &sibling));
        fs::remove_dir_all(&base).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let base = unique_dir("symlink");
        let outside = unique_dir("symlink-outside");
        std::os::unix::fs::symlink(&outside, base.join("link")).unwrap();
        assert!(!is_under(&base, &base.join("link/secret.txt")));
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn safe_join_accepts_normal_and_rejects_traversal() {
        let base = Path::new("/tmp/base");
        assert_eq!(
            safe_join(base, "openlist/config.json").unwrap(),
            PathBuf::from("/tmp/base/openlist/config.json")
        );
        assert!(safe_join(base, "../evil").is_err());
        assert!(safe_join(base, "a/../../evil").is_err());
        assert!(safe_join(base, "/etc/passwd").is_err());
        assert!(safe_join(base, "a\\b").is_err());
        assert!(safe_join(base, "").is_err());
    }
}
