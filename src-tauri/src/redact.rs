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
pub fn redact_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut redact_next = false;

    for arg in args {
        if redact_next {
            out.push(MASK.to_string());
            redact_next = false;
            continue;
        }

        if let Some(rest) = arg.strip_prefix("--") {
            if let Some((key, value)) = rest.split_once('=') {
                if is_secret_key(key) {
                    out.push(format!("--{}={}", key, MASK));
                } else if key.to_ascii_lowercase().contains("proxy") {
                    out.push(format!("--{}={}", key, mask_url_userinfo(value)));
                } else {
                    out.push(arg.clone());
                }
                continue;
            }
            if is_secret_key(rest) {
                // `--rc-pass VALUE` 形式：下一个参数是值
                redact_next = true;
            }
        }
        out.push(arg.clone());
    }
    out
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
    fn leaves_ordinary_args_untouched() {
        let args = v(&["--config=/home/u/.netmount/rclone.conf", "--cache-dir=/tmp/x", "serve"]);
        assert_eq!(redact_args(&args), args);
    }
}
