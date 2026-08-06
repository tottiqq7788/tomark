//! Document load/save commands that preserve encoding metadata.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

use crate::atomic_write::{self, AtomicWriteError};
use crate::text_codec::{
    apply_line_ending, detect_and_decode, encode_text, normalize_newlines, CodecError,
    DetectionConfidence, DetectionSource, EncodingHint, EncodingMeta, TextEncodingId,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormatDto {
    pub line_ending: String,
    pub has_bom: bool,
    pub encoding: TextEncodingId,
    pub confidence: DetectionConfidence,
    pub source: DetectionSource,
    pub allow_direct_overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocumentDto {
    pub path: String,
    pub content: String,
    pub format: DocumentFormatDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub path: String,
    pub content: String,
    pub format: DocumentFormatDto,
    /// When true, force UTF-8 without BOM regardless of format.encoding.
    #[serde(default)]
    pub force_utf8: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum DocumentIoError {
    #[error("path is not allowed by the filesystem scope")]
    PathForbidden,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Codec(String),
    #[error(transparent)]
    Atomic(#[from] AtomicWriteError),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentIoErrorDto {
    kind: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<TextEncodingId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    codepoint: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
}

impl DocumentIoError {
    fn from_codec(error: CodecError) -> Self {
        Self::Codec(error.to_string())
    }

    fn to_dto(&self) -> DocumentIoErrorDto {
        match self {
            Self::PathForbidden => DocumentIoErrorDto {
                kind: "pathForbidden".into(),
                message: self.to_string(),
                encoding: None,
                codepoint: None,
                index: None,
            },
            Self::Io(error) => DocumentIoErrorDto {
                kind: "io".into(),
                message: error.to_string(),
                encoding: None,
                codepoint: None,
                index: None,
            },
            Self::Atomic(AtomicWriteError::PathForbidden) => DocumentIoErrorDto {
                kind: "pathForbidden".into(),
                message: self.to_string(),
                encoding: None,
                codepoint: None,
                index: None,
            },
            Self::Atomic(AtomicWriteError::Io(error)) => DocumentIoErrorDto {
                kind: "io".into(),
                message: error.to_string(),
                encoding: None,
                codepoint: None,
                index: None,
            },
            Self::Codec(message) => {
                // Parse structured details from message when possible via helper below.
                DocumentIoErrorDto {
                    kind: if message.contains("cannot be encoded") {
                        "unmappableCharacter".into()
                    } else if message.contains("NUL") || message.contains("binary") {
                        "binaryOrNul".into()
                    } else {
                        "decodeFailed".into()
                    },
                    message: message.clone(),
                    encoding: None,
                    codepoint: None,
                    index: None,
                }
            }
        }
    }
}

impl From<CodecError> for DocumentIoError {
    fn from(value: CodecError) -> Self {
        match value {
            CodecError::UnmappableCharacter {
                codepoint,
                encoding,
                index,
            } => Self::Codec(format!(
                "UNMAPPABLE|{codepoint}|{encoding:?}|{index}|character U+{codepoint:04X} cannot be encoded as {encoding:?}"
            )),
            other => Self::from_codec(other),
        }
    }
}

impl serde::Serialize for DocumentIoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut dto = self.to_dto();
        if let DocumentIoError::Codec(message) = self {
            if let Some(rest) = message.strip_prefix("UNMAPPABLE|") {
                let mut parts = rest.splitn(4, '|');
                let codepoint = parts.next().and_then(|s| s.parse().ok());
                let encoding = parts.next().and_then(|s| match s {
                    "Utf8" => Some(TextEncodingId::Utf8),
                    "Utf16Le" => Some(TextEncodingId::Utf16Le),
                    "Utf16Be" => Some(TextEncodingId::Utf16Be),
                    "Windows1252" => Some(TextEncodingId::Windows1252),
                    "Gbk" => Some(TextEncodingId::Gbk),
                    "Gb18030" => Some(TextEncodingId::Gb18030),
                    "Big5" => Some(TextEncodingId::Big5),
                    "ShiftJis" => Some(TextEncodingId::ShiftJis),
                    "EucKr" => Some(TextEncodingId::EucKr),
                    _ => None,
                });
                let index = parts.next().and_then(|s| s.parse().ok());
                let human = parts.next().unwrap_or(message.as_str()).to_string();
                dto.kind = "unmappableCharacter".into();
                dto.message = human;
                dto.codepoint = codepoint;
                dto.encoding = encoding;
                dto.index = index;
            }
        }
        dto.serialize(serializer)
    }
}

fn meta_from_format(format: &DocumentFormatDto) -> EncodingMeta {
    EncodingMeta {
        encoding: format.encoding,
        has_bom: format.has_bom,
        confidence: format.confidence,
        source: format.source,
        allow_direct_overwrite: format.allow_direct_overwrite,
    }
}

fn format_from_decoded(
    meta: EncodingMeta,
    line_ending: &str,
) -> DocumentFormatDto {
    DocumentFormatDto {
        line_ending: line_ending.to_string(),
        has_bom: meta.has_bom,
        encoding: meta.encoding,
        confidence: meta.confidence,
        source: meta.source,
        allow_direct_overwrite: meta.allow_direct_overwrite,
    }
}

fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), DocumentIoError> {
    if !app.fs_scope().is_allowed(path) {
        return Err(DocumentIoError::PathForbidden);
    }
    Ok(())
}

fn load_path(path: &Path, hint: EncodingHint) -> Result<LoadedDocumentDto, DocumentIoError> {
    let bytes = std::fs::read(path)?;
    let decoded = detect_and_decode(&bytes, hint)?;
    let (content, crlf) = normalize_newlines(&decoded.text);
    Ok(LoadedDocumentDto {
        path: path.to_string_lossy().into_owned(),
        content,
        format: format_from_decoded(decoded.meta, if crlf { "crlf" } else { "lf" }),
    })
}

fn save_path(request: &SaveDocumentRequest) -> Result<(), DocumentIoError> {
    let meta = if request.force_utf8 {
        EncodingMeta {
            encoding: TextEncodingId::Utf8,
            has_bom: false,
            confidence: DetectionConfidence::Certain,
            source: DetectionSource::Default,
            allow_direct_overwrite: true,
        }
    } else {
        meta_from_format(&request.format)
    };
    let crlf = request.format.line_ending.eq_ignore_ascii_case("crlf");
    let with_ending = apply_line_ending(&request.content, crlf);
    let bytes = encode_text(&with_ending, &meta)?;
    atomic_write::write_bytes(Path::new(&request.path), &bytes)?;
    Ok(())
}

#[tauri::command]
pub fn load_markdown_document<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    hint: Option<EncodingHint>,
) -> Result<LoadedDocumentDto, DocumentIoError> {
    let target = Path::new(&path);
    ensure_allowed(&app, target)?;
    load_path(target, hint.unwrap_or(EncodingHint::Auto))
}

#[tauri::command]
pub fn save_markdown_document<R: Runtime>(
    app: AppHandle<R>,
    request: SaveDocumentRequest,
) -> Result<(), DocumentIoError> {
    let target = Path::new(&request.path);
    ensure_allowed(&app, target)?;
    save_path(&request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tomark-doc-io-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_and_save_preserves_windows1252() {
        let dir = temp_dir("w1252");
        let path = dir.join("note.md");
        let original = b"# Title \x97 Section\r\n".to_vec();
        fs::write(&path, &original).unwrap();

        let loaded = load_path(&path, EncodingHint::Auto).unwrap();
        assert!(loaded.content.contains('—'));
        assert_eq!(loaded.format.encoding, TextEncodingId::Windows1252);
        assert_eq!(loaded.format.line_ending, "crlf");

        save_path(&SaveDocumentRequest {
            path: path.to_string_lossy().into_owned(),
            content: loaded.content.clone(),
            format: loaded.format.clone(),
            force_utf8: false,
        })
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), original);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unmappable_keeps_original_bytes() {
        let dir = temp_dir("unmap");
        let path = dir.join("note.md");
        let original = b"hello\r\n".to_vec();
        fs::write(&path, &original).unwrap();

        let loaded = load_path(&path, EncodingHint::Western).unwrap();
        let err = save_path(&SaveDocumentRequest {
            path: path.to_string_lossy().into_owned(),
            content: format!("{}😀", loaded.content.trim_end()),
            format: DocumentFormatDto {
                line_ending: "crlf".into(),
                has_bom: false,
                encoding: TextEncodingId::Windows1252,
                confidence: DetectionConfidence::Certain,
                source: DetectionSource::UserHint,
                allow_direct_overwrite: true,
            },
            force_utf8: false,
        })
        .unwrap_err();
        assert!(matches!(err, DocumentIoError::Codec(_)));
        assert_eq!(fs::read(&path).unwrap(), original);

        save_path(&SaveDocumentRequest {
            path: path.to_string_lossy().into_owned(),
            content: "hello 😀\n".into(),
            format: loaded.format,
            force_utf8: true,
        })
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello \xF0\x9F\x98\x80\r\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn loads_real_windows1252_problem_file_when_present() {
        let path = std::path::Path::new(
            "/Users/totti/个人/project/tudi/sizhu/guanwang/Home-Contact-EN-Copy.md",
        );
        if !path.exists() {
            return;
        }
        let loaded = load_path(path, EncodingHint::Auto).unwrap();
        assert!(loaded.content.contains('—'));
        assert!(!loaded.content.contains('\u{FFFD}'));
        assert_eq!(loaded.format.encoding, TextEncodingId::Windows1252);

        let dir = temp_dir("real-copy");
        let copy = dir.join("copy.md");
        fs::copy(path, &copy).unwrap();
        let original = fs::read(&copy).unwrap();

        // Compatible edit keeps original encoding.
        save_path(&SaveDocumentRequest {
            path: copy.to_string_lossy().into_owned(),
            content: format!("{}\n", loaded.content.trim_end()),
            format: loaded.format.clone(),
            force_utf8: false,
        })
        .unwrap();
        assert!(!fs::read(&copy).unwrap().is_empty());

        // Emoji must not overwrite original bytes.
        fs::write(&copy, &original).unwrap();
        let err = save_path(&SaveDocumentRequest {
            path: copy.to_string_lossy().into_owned(),
            content: format!("{} 😀\n", loaded.content.trim_end()),
            format: loaded.format.clone(),
            force_utf8: false,
        })
        .unwrap_err();
        assert!(matches!(err, DocumentIoError::Codec(_)));
        assert_eq!(fs::read(&copy).unwrap(), original);

        save_path(&SaveDocumentRequest {
            path: copy.to_string_lossy().into_owned(),
            content: format!("{} 😀\n", loaded.content.trim_end()),
            format: loaded.format,
            force_utf8: true,
        })
        .unwrap();
        let utf8 = String::from_utf8(fs::read(&copy).unwrap()).unwrap();
        assert!(utf8.contains('😀'));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn loads_poct_brochure_utf8_when_present() {
        let path = std::path::Path::new(
            "/Users/totti/个人/project/tudi/sizhu/guanwang/POCT-Brochure-English-Content-Draft.md",
        );
        if !path.exists() {
            return;
        }
        let loaded = load_path(path, EncodingHint::Auto).unwrap();
        assert!(loaded.content.starts_with("# POCT Brochure"));
        assert!(!loaded.content.contains('\u{FFFD}'));
        assert_eq!(loaded.format.encoding, TextEncodingId::Utf8);
        assert_eq!(loaded.format.line_ending, "lf");
        assert!(!loaded.format.has_bom);
    }
}
