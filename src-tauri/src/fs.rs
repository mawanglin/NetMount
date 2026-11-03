use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use tauri::Manager as _;

use crate::Runtime;

/// 检查路径是否为绝对路径
fn is_absolute_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    // Unix 绝对路径: /foo
    // Windows 盘符路径: C:/foo 或 C:\foo
    // Windows UNC 路径: \\server\share 或 //server/share
    path.starts_with('/') ||
    path.starts_with("\\\\") ||
    path.starts_with("//") ||
    (path.len() > 1 && path.chars().nth(1) == Some(':'))
}

/// 修复 openlist 配置文件中的绝对路径
/// 将来自其他设备的绝对路径转换为相对路径
fn fix_openlist_config_paths(config_path: &Path) -> anyhow::Result<()> {
    // 读取配置文件
    let content = fs::read_to_string(config_path)?;
    let mut config: serde_json::Value = serde_json::from_str(&content)?;
    
    // 需要修复的路径字段
    let path_fields = vec![
        ("database", "db_file"),
        ("log", "name"),
        ("", "bleve_dir"),
        ("", "temp_dir"),
    ];
    
    // 获取数据目录前缀（用于路径匹配）
    let data_dir = crate::resolve_data_dir();
    let data_dir_str = data_dir.to_string_lossy().replace('\\', "/");
    
    for (parent, field) in path_fields {
        if let Some(value) = if parent.is_empty() {
            config.get(field).cloned()
        } else {
            config.get(parent).and_then(|p| p.get(field)).cloned()
        } {
            if let Some(path_str) = value.as_str() {
                // 检查是否为绝对路径
                if is_absolute_path(path_str) {
                    // 尝试提取相对路径部分
                    let normalized = path_str.replace('\\', "/");
                    
                    // 尝试从路径中提取相对部分
                    // 支持两种格式：
                    //   - 普通模式: C:/Users/username/.netmount/openlist/xxx
                    //   - 便携式模式: E:/NetMount/data/openlist/xxx
                    let relative_path = if normalized.contains("/.netmount/openlist/") {
                        normalized.split("/.netmount/openlist/").nth(1).map(|s| s.to_string())
                    } else if normalized.contains("/.netmount/") {
                        normalized.split("/.netmount/").nth(1).map(|s| {
                            if s.starts_with("openlist/") {
                                s.strip_prefix("openlist/").map(|p| p.to_string()).unwrap_or(s.to_string())
                            } else {
                                s.to_string()
                            }
                        })
                    } else if normalized.contains("/data/openlist/") {
                        // 便携式模式路径: E:/NetMount/data/openlist/xxx
                        normalized.split("/data/openlist/").nth(1).map(|s| s.to_string())
                    } else if normalized.contains("/data/") && data_dir_str.contains("/data/") {
                        // 便携式模式其他路径: E:/NetMount/data/xxx
                        normalized.split("/data/").nth(1).map(|s| {
                            if s.starts_with("openlist/") {
                                s.strip_prefix("openlist/").map(|p| p.to_string()).unwrap_or(s.to_string())
                            } else {
                                s.to_string()
                            }
                        })
                    } else {
                        None
                    };
                    
                    if let Some(new_path) = relative_path {
                        // 更新配置
                        if parent.is_empty() {
                            config[field] = serde_json::Value::String(new_path);
                        } else {
                            if let Some(parent_obj) = config.get_mut(parent) {
                                parent_obj[field] = serde_json::Value::String(new_path);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 写回配置文件
    let file = fs::File::create(config_path)?;
    serde_json::to_writer_pretty(file, &config)?;
    
    Ok(())
}

fn resolve_path(app: &tauri::AppHandle<Runtime>, path: &str) -> anyhow::Result<PathBuf> {
    if path.starts_with("~") {
        let home = app.path().home_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get home dir: {}", e))?;
        // 支持 "~"、"~/"、"~\\"
        let rest = path
            .trim_start_matches('~')
            .trim_start_matches(['/', '\\']);
        if rest.is_empty() {
            Ok(home)
        } else {
            Ok(home.join(rest))
        }
    } else {
        Ok(Path::new(path).to_owned())
    }
}

fn app_data_dir(app: &tauri::AppHandle<Runtime>) -> anyhow::Result<PathBuf> {
    Ok(crate::resolve_data_dir())
}

/// 检查目录是否存在。
/// 仅返回布尔值、不读取内容，因此不限制在数据目录内（挂载点通常在数据目录之外）；
/// 路径不存在时返回 false 而不是报错。
#[tauri::command]
pub fn fs_exist_dir(app: tauri::AppHandle<Runtime>, path: &str) -> anyhow_tauri::TAResult<bool> {
    let resolved_path = crate::pathsafe::normalize_lexical(&resolve_path(&app, path)?);
    match std::fs::metadata(resolved_path) {
        Ok(meta) => Ok(meta.is_dir()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(anyhow::Error::from(e).into()),
    }
}

/// 创建目录。
/// 挂载点目录可能位于数据目录之外（如 /mnt、~/Mounts），因此不限制在数据目录内，
/// 但要求是绝对路径，并经过词法规范化（消除 `..`），实际权限由操作系统控制。
#[tauri::command]
pub fn fs_make_dir(app: tauri::AppHandle<Runtime>, path: &str) -> anyhow_tauri::TAResult<()> {
    let resolved_path = crate::pathsafe::normalize_lexical(&resolve_path(&app, path)?);
    if !resolved_path.is_absolute() {
        return Err(anyhow::anyhow!("Path must be absolute: {}", resolved_path.display()).into());
    }
    std::fs::create_dir_all(resolved_path).map_err(anyhow::Error::from)?;
    Ok(())
}

#[tauri::command]
pub fn read_text_file_tail(
    app: tauri::AppHandle<Runtime>,
    path: &str,
    max_bytes: Option<u64>,
) -> anyhow_tauri::TAResult<String> {
    let path = resolve_path(&app, path)?;

    // 安全：仅允许读取数据目录下的文件
    let candidate = validate_path_in_allowed_dir(&app, &path)?;

    let max_bytes = max_bytes.unwrap_or(256 * 1024).max(1024); // 默认 256KB，至少 1KB

    let mut file = std::fs::File::open(&candidate).map_err(anyhow::Error::from)?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).map_err(anyhow::Error::from)?;

    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(anyhow::Error::from)?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}



use serde_json::{to_string_pretty, Value};

/// 验证路径是否在允许的目录内（防止路径遍历攻击）
/// 对不存在的路径同样有效：先词法规范化 `..`，再解析已存在祖先的符号链接。
fn validate_path_in_allowed_dir(app: &tauri::AppHandle<Runtime>, path: &Path) -> anyhow::Result<PathBuf> {
    let base = app_data_dir(app)?;
    if !crate::pathsafe::is_under(&base, path) {
        return Err(anyhow::anyhow!(
            "Access denied: only files under {} are allowed",
            crate::pathsafe::resolve_lenient(&base).display()
        ));
    }
    Ok(crate::pathsafe::resolve_lenient(path))
}

#[tauri::command]
pub fn read_json_file(app: tauri::AppHandle<Runtime>, path: Option<&str>) -> Result<Value, String> {
    let path_str = path.ok_or_else(|| "Path is required".to_string())?;
    let resolved_path = resolve_path(&app, path_str)
        .map_err(|e| e.to_string())?;
    
    // 安全：验证路径在允许目录内
    let validated_path = validate_path_in_allowed_dir(&app, &resolved_path)
        .map_err(|e| e.to_string())?;
    
    let content_result = fs::read_to_string(validated_path);
    match content_result {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(config) => Ok(config),
            Err(json_error) => Err(format!("Failed to parse JSON from file: {}", json_error)),
        },
        Err(io_error) => Err(format!("Failed to read file: {}", io_error)),
    }
}

#[tauri::command]
pub async fn write_json_file(app: tauri::AppHandle<Runtime>, config_data: Value, path: Option<&str>) -> Result<(), String> {
    let path_str = path.ok_or_else(|| "Path is required".to_string())?;
    let resolved_path = resolve_path(&app, path_str)
        .map_err(|e| e.to_string())?;
    
    // 安全：验证路径在允许目录内
    let validated_path = validate_path_in_allowed_dir(&app, &resolved_path)
        .map_err(|e| e.to_string())?;
    
    let pretty_config = to_string_pretty(&config_data)
        .map_err(|json_error| format!("Failed to serialize JSON: {}", json_error))?;

    fs::write(validated_path, pretty_config)
        .map_err(|io_error| format!("Failed to write file: {}", io_error))?;

    Ok(())
}

#[tauri::command]
pub fn copy_file(app: tauri::AppHandle<Runtime>, src: &str, dest: &str) -> Result<(), String> {
    let src_path = resolve_path(&app, src)
        .map_err(|e| e.to_string())?;
    let dest_path = resolve_path(&app, dest)
        .map_err(|e| e.to_string())?;
    
    // 安全：验证源路径和目标路径都在允许目录内
    let validated_src = validate_path_in_allowed_dir(&app, &src_path)
        .map_err(|e| e.to_string())?;
    let validated_dest = validate_path_in_allowed_dir(&app, &dest_path)
        .map_err(|e| e.to_string())?;
    
    fs::copy(validated_src, validated_dest)
        .map_err(|io_error| format!("Failed to copy file: {}", io_error))?;
    Ok(())
}

// ============================================
// 配置导入导出功能
// ============================================

fn resolve_tilde(app: &tauri::AppHandle<Runtime>, path: &str) -> anyhow::Result<PathBuf> {
    if path.starts_with('~') {
        let home = app
            .path()
            .home_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get home dir: {}", e))?;
        let rest = path
            .trim_start_matches('~')
            .trim_start_matches(['/', '\\']);
        if rest.is_empty() {
            Ok(home)
        } else {
            Ok(home.join(rest))
        }
    } else {
        Ok(Path::new(path).to_owned())
    }
}

/// 验证 zip 文件的目录结构
fn validate_zip_structure(zip: &mut zip::ZipArchive<impl Read + Seek>) -> anyhow::Result<()> {
    let required_files = [
        "config.json",
        "openlist/config.json",
    ];
    
    let mut found_files = std::collections::HashSet::new();
    
    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        let name = entry.name();
        found_files.insert(name.to_string());
    }
    
    // 检查必需文件是否存在
    for required in &required_files {
        if !found_files.contains(*required) {
            return Err(anyhow::anyhow!(
                "Invalid backup structure: missing required file '{}'",
                required
            ));
        }
    }
    
    Ok(())
}

/// 递归复制目录
fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> anyhow::Result<()> {
    let dst = dst.as_ref();
    fs::create_dir_all(&dst)?;
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    
    Ok(())
}

/// 导出配置到 zip 文件
#[tauri::command]
pub fn export_config(
    app: tauri::AppHandle<Runtime>,
    out_path: String,
) -> anyhow_tauri::TAResult<String> {
    fn inner(app: &tauri::AppHandle<Runtime>, out_path: &str) -> anyhow::Result<String> {
        let out_path = out_path.trim();
        if out_path.is_empty() {
            return Err(anyhow::anyhow!("Output path is required"));
        }
        if !out_path.to_ascii_lowercase().ends_with(".zip") {
            return Err(anyhow::anyhow!("Output file must end with .zip"));
        }

        // 输出位置由用户通过保存对话框选择，可以在数据目录之外
        let out = crate::pathsafe::normalize_lexical(&resolve_tilde(app, out_path)?);
        if !out.is_absolute() {
            return Err(anyhow::anyhow!("Output path must be absolute"));
        }
        
        if let Some(parent) = out.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
            }
        }

        let file = fs::File::create(&out).map_err(anyhow::Error::from)?;
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let data_dir = crate::resolve_data_dir();
        
        // 递归添加目录内容（排除 log 目录）
        fn add_dir_to_zip(
            zip: &mut zip::ZipWriter<fs::File>,
            options: &zip::write::FileOptions<'_, ()>,
            src_dir: &Path,
            base_dir: &Path,
            skip: &Path,
        ) -> anyhow::Result<()> {
            for entry in fs::read_dir(src_dir)? {
                let entry = entry?;
                let path = entry.path();
                let file_name = entry.file_name();
                let file_name_str = file_name.to_string_lossy().to_lowercase();
                
                // 排除 log 目录
                if path.is_dir() && file_name_str == "log" {
                    continue;
                }
                
                // 输出文件若位于数据目录内，不要把它自己打进压缩包
                if crate::pathsafe::resolve_lenient(&path) == skip {
                    continue;
                }

                let relative_path = path.strip_prefix(base_dir)?;
                
                if path.is_dir() {
                    add_dir_to_zip(zip, options, &path, base_dir, skip)?;
                } else {
                    let entry_name = relative_path.to_string_lossy().replace('\\', "/");
                    zip.start_file(&entry_name, *options)?;
                    let mut file = fs::File::open(&path)?;
                    let mut buffer = Vec::new();
                    file.read_to_end(&mut buffer)?;
                    zip.write_all(&buffer)?;
                }
            }
            Ok(())
        }

        if data_dir.exists() {
            let skip = crate::pathsafe::resolve_lenient(&out);
            add_dir_to_zip(&mut zip, &options, &data_dir, &data_dir, &skip)?;
        }

        zip.finish().map_err(anyhow::Error::from)?;
        Ok(out.to_string_lossy().to_string())
    }

    inner(&app, &out_path).map_err(Into::into)
}

/// 从 zip 文件导入配置
#[tauri::command]
pub fn import_config(
    app: tauri::AppHandle<Runtime>,
    zip_path: String,
) -> anyhow_tauri::TAResult<String> {
    fn inner(app: &tauri::AppHandle<Runtime>, zip_path: &str) -> anyhow::Result<String> {
        let zip_path = resolve_tilde(app, zip_path)?;
        
        if !zip_path.exists() {
            return Err(anyhow::anyhow!("备份文件不存在"));
        }
        
        if !zip_path.to_string_lossy().to_ascii_lowercase().ends_with(".zip") {
            return Err(anyhow::anyhow!("备份文件必须是 ZIP 格式"));
        }

        // 打开 zip 文件
        let file = fs::File::open(&zip_path)
            .map_err(|e| anyhow::anyhow!("无法打开备份文件：{}", e))?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|e| anyhow::anyhow!("无法读取 ZIP 文件：{}", e))?;
        
        // 验证目录结构
        validate_zip_structure(&mut zip)
            .map_err(|e| anyhow::anyhow!("无效的备份文件：{}", e))?;
        
        // 获取数据目录
        let data_dir = crate::resolve_data_dir();
        
        // 确保数据目录存在
        fs::create_dir_all(&data_dir)?;
        
        let temp_dir = data_dir.join(".backup_temp");
        
        // 如果临时目录已存在，先删除
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(&temp_dir)?;
        
        // 解压所有文件到临时目录（带 Zip Slip 与压缩炸弹防护）
        const MAX_ENTRIES: usize = 100_000;
        const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB
        if zip.len() > MAX_ENTRIES {
            return Err(anyhow::anyhow!("ZIP 文件条目过多（{}）", zip.len()));
        }
        let mut total_written: u64 = 0;

        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let entry_name = entry.name().to_string();

            // 跳过目录条目（zip 中目录条目通常以/结尾）
            if entry_name.ends_with('/') {
                continue;
            }

            // 安全：仅接受由普通分量组成的相对路径，拒绝 `..`、绝对路径、盘符与反斜杠；
            // 必须在创建任何目录之前完成校验
            let target_path = crate::pathsafe::safe_join(&temp_dir, &entry_name)
                .map_err(|e| anyhow::anyhow!("安全警告：ZIP 文件包含可疑路径：{}", e))?;

            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }

            // 限制解压总量，防止声明大小与实际不符的压缩炸弹
            let remaining = MAX_TOTAL_BYTES - total_written;
            let mut outfile = fs::File::create(&target_path)?;
            let written = std::io::copy(&mut (&mut entry).take(remaining + 1), &mut outfile)?;
            total_written += written;
            if total_written > MAX_TOTAL_BYTES {
                return Err(anyhow::anyhow!("ZIP 解压后体积超过上限（4 GiB）"));
            }
        }

        // 先修复 openlist/config.json 中的绝对路径（在 temp_dir 中），再动现有数据
        let temp_openlist_config_path = temp_dir.join("openlist/config.json");
        if temp_openlist_config_path.exists() {
            fix_openlist_config_paths(&temp_openlist_config_path)?;
        }

        // 备份当前配置（以防万一）
        let backup_dir = data_dir.join(".backup_old");
        if data_dir.exists() {
            if backup_dir.exists() {
                let _ = fs::remove_dir_all(&backup_dir);
            }
            // 复制当前配置到备份目录（排除临时目录）；备份失败则中止，避免丢失现有配置
            fs::create_dir_all(&backup_dir)?;
            for entry in fs::read_dir(&data_dir)? {
                let entry = entry?;
                let file_name = entry.file_name();
                let file_name_str = file_name.to_string_lossy();
                
                // 跳过临时目录和备份目录
                if file_name_str == ".backup_temp" || file_name_str == ".backup_old" {
                    continue;
                }
                
                let src = entry.path();
                let dst = backup_dir.join(&file_name);
                
                if src.is_dir() {
                    copy_dir_all(&src, &dst)
                        .map_err(|e| anyhow::anyhow!("备份现有配置失败，已中止导入：{}", e))?;
                } else {
                    fs::copy(&src, &dst)
                        .map_err(|e| anyhow::anyhow!("备份现有配置失败，已中止导入：{}", e))?;
                }
            }
        }
        
        // 删除旧配置（忽略失败，因为文件可能被占用）
        for entry in fs::read_dir(&data_dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            // 跳过临时目录和备份目录
            if file_name_str == ".backup_temp" || file_name_str == ".backup_old" {
                continue;
            }
            
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
        
        // 复制新配置到数据目录；失败时用备份恢复，避免留下残缺的配置
        let apply_result: anyhow::Result<()> = (|| {
            for entry in fs::read_dir(&temp_dir)? {
                let entry = entry?;
                let src = entry.path();
                let dst = data_dir.join(entry.file_name());

                if src.is_dir() {
                    copy_dir_all(&src, &dst)?;
                } else {
                    fs::copy(&src, &dst)?;
                }
            }
            Ok(())
        })();
        if let Err(e) = apply_result {
            for entry in fs::read_dir(&backup_dir)? {
                let entry = entry?;
                let src = entry.path();
                let dst = data_dir.join(entry.file_name());
                let _ = if src.is_dir() { copy_dir_all(&src, &dst) } else { fs::copy(&src, &dst).map(|_| ()).map_err(Into::into) };
            }
            return Err(anyhow::anyhow!("写入新配置失败，已从备份恢复：{}", e));
        }

        // 清理临时目录
        fs::remove_dir_all(&temp_dir)?;
        
        // 保留旧备份（可选：可以在成功后删除）
        // fs::remove_dir_all(&backup_dir)?;
        
        Ok(format!("配置导入成功，文件来源：{}", zip_path.display()))
    }

    inner(&app, &zip_path)
        .map_err(|e| {
            // 提供更友好的错误信息
            let msg = e.to_string();
            anyhow::anyhow!("导入配置失败：{}", msg)
        })
        .map_err(Into::into)
}
