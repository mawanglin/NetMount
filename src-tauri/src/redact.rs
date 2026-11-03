//! 日志脱敏工具（仅依赖标准库）。
//!
//! sidecar 的启动参数会写入诊断日志，而日志又可能被打包进导出的诊断文件，
//! 因此其中的密码、令牌和代理凭据必须先隐藏。

const MASK: &str = "***";

fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["pass", "secret", "token"].iter().any(|k| key.contains(k))
}

/// 隐藏 URL 中的 `user:pass@` 凭据部分，保留协议与主机
fn mask_url_userinfo(value: &str) -> String {
    if let Some(scheme_end) = value.find("://") {
        let rest = &value[scheme_end + 3..];
        if let Some(at) = rest.rfind('@') {
            return format!("{}{}@{}", &value[..scheme_end + 3], MASK, &rest[at + 1..]);
        }
    }
    value.to_string()
}

/// 返回脱敏后的参数列表，用于写日志。
///
/// 识别 `--key=value`、`key=value` 与 `--key value` 三种形式；
/// 键名含 pass / secret / token 时隐藏值，键名含 proxy 时隐藏 URL 中的凭据。
pub fn redact_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut redact_next = false;

    for (i, arg) in args.iter().enumerate() {
        if redact_next {
            out.push(MASK.to_string());
            redact_next = false;
            continue;
        }

        // `openlist admin set <密码>`：子命令的位置参数就是密码
        if i >= 1 && arg == "set" && args[i - 1] == "admin" {
            redact_next = true;
            out.push(arg.clone());
            continue;
        }

        let dashes = arg.len() - arg.trim_start_matches('-').len();
        let rest = &arg[dashes..];

        if let Some((key, value)) = rest.split_once('=') {
            let prefix = &arg[..dashes];
            if is_secret_key(key) {
                out.push(format!("{}{}={}", prefix, key, MASK));
                continue;
            }
            if key.to_ascii_lowercase().contains("proxy") {
                out.push(format!("{}{}={}", prefix, key, mask_url_userinfo(value)));
                continue;
            }
        } else if dashes > 0 && is_secret_key(rest) {
            // `--rc-pass VALUE` 形式：下一个参数是值
            redact_next = true;
        }

        // 其余 token：URL 中的 user:pass@ 凭据同样隐藏
        if arg.contains("://") && arg.contains('@') {
            out.push(mask_url_userinfo(arg));
        } else {
            out.push(arg.clone());
        }
    }
    out
}

/// 对多行文本（如日志）脱敏：按行、按空白切分后复用参数脱敏规则。
/// 会把连续空白折叠为单个空格，仅用于诊断输出。
pub fn redact_text(text: &str) -> String {
    text.lines()
        .map(|line| {
            let tokens: Vec<String> = line.split_whitespace().map(|t| t.to_string()).collect();
            redact_args(&tokens).join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn masks_equals_form_secrets() {
        let out = redact_args(&v(&["rcd", "--rc-user=admin", "--rc-pass=hunter2", "--log-level=INFO"]));
        assert_eq!(out, v(&["rcd", "--rc-user=admin", "--rc-pass=***", "--log-level=INFO"]));
    }

    #[test]
    fn masks_separate_value_form() {
        let out = redact_args(&v(&["--rc-pass", "hunter2", "--rc-addr", ":5572"]));
        assert_eq!(out, v(&["--rc-pass", "***", "--rc-addr", ":5572"]));
    }

    #[test]
    fn masks_proxy_credentials_but_keeps_host() {
        let out = redact_args(&v(&["--http-proxy=socks5://me:p%40ss@10.0.0.1:1080"]));
        assert_eq!(out, v(&["--http-proxy=socks5://***@10.0.0.1:1080"]));
        let plain = redact_args(&v(&["--http-proxy=http://10.0.0.1:8080"]));
        assert_eq!(plain, v(&["--http-proxy=http://10.0.0.1:8080"]));
    }

    #[test]
    fn masks_key_value_without_dashes_and_urls_in_plain_tokens() {
        let out = redact_args(&v(&["password=hunter2", "url=https://u:p@host/x", "ok=1"]));
        assert_eq!(out, v(&["password=***", "url=https://***@host/x", "ok=1"]));
        let out = redact_args(&v(&["https://u:p@host/x"]));
        assert_eq!(out, v(&["https://***@host/x"]));
    }

    #[test]
    fn redacts_log_text_line_by_line() {
        let text = "2024 INFO args: rcd --rc-user=admin --rc-pass=hunter2\nnext line --rc-pass topsecret --x";
        let out = redact_text(text);
        assert!(!out.contains("hunter2") && !out.contains("topsecret"));
        assert!(out.contains("--rc-user=admin"));
        assert_eq!(out.lines().count(), 2);
    }

    #[test]
    fn masks_openlist_admin_set_password() {
        let out = redact_args(&v(&["--data", "/d", "admin", "set", "hunter2"]));
        assert_eq!(out, v(&["--data", "/d", "admin", "set", "***"]));
        // 其他场景下的 "set" 不受影响
        let other = redact_args(&v(&["config", "set", "x"]));
        assert_eq!(other, v(&["config", "set", "x"]));
    }

    #[test]
    fn leaves_ordinary_args_untouched() {
        let args = v(&["--config=/home/u/.netmount/rclone.conf", "--cache-dir=/tmp/x", "serve"]);
        assert_eq!(redact_args(&args), args);
    }
}
