//! Text encoding detection, strict decode, and strict encode for Markdown documents.

use encoding_rs::{
    Encoding, BIG5, EUC_KR, GB18030, GBK, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextEncodingId {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1252,
    Gbk,
    Gb18030,
    Big5,
    ShiftJis,
    EucKr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionConfidence {
    Certain,
    High,
    Tentative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionSource {
    Bom,
    Utf8Strict,
    Utf16Heuristic,
    Chardet,
    UserHint,
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncodingHint {
    Auto,
    Western,
    SimplifiedChinese,
    TraditionalChinese,
    Japanese,
    Korean,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EncodingMeta {
    pub encoding: TextEncodingId,
    pub has_bom: bool,
    pub confidence: DetectionConfidence,
    pub source: DetectionSource,
    pub allow_direct_overwrite: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedText {
    pub text: String,
    pub meta: EncodingMeta,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CodecError {
    #[error("file looks binary or contains NUL bytes")]
    BinaryOrNul,
    #[error("unable to decode text with a supported encoding")]
    DecodeFailed,
    #[error("character U+{codepoint:04X} cannot be encoded as {encoding:?}")]
    UnmappableCharacter {
        codepoint: u32,
        encoding: TextEncodingId,
        index: usize,
    },
}

impl TextEncodingId {
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf16Le => "utf-16le",
            Self::Utf16Be => "utf-16be",
            Self::Windows1252 => "windows-1252",
            Self::Gbk => "gbk",
            Self::Gb18030 => "gb18030",
            Self::Big5 => "big5",
            Self::ShiftJis => "shift_jis",
            Self::EucKr => "euc-kr",
        }
    }

    fn encoding_rs(self) -> Option<&'static Encoding> {
        match self {
            Self::Utf8 => Some(UTF_8),
            Self::Utf16Le => Some(UTF_16LE),
            Self::Utf16Be => Some(UTF_16BE),
            Self::Windows1252 => Some(WINDOWS_1252),
            Self::Gbk => Some(GBK),
            Self::Gb18030 => Some(GB18030),
            Self::Big5 => Some(BIG5),
            Self::ShiftJis => Some(SHIFT_JIS),
            Self::EucKr => Some(EUC_KR),
        }
    }
}

fn looks_binary_or_nul(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return true;
    }
    let sample = &bytes[..bytes.len().min(4096)];
    if sample.is_empty() {
        return false;
    }
    let control = sample
        .iter()
        .filter(|&&b| b < 0x09 || (0x0b..=0x0c).contains(&b) || (0x0e..=0x1f).contains(&b))
        .count();
    control * 20 > sample.len()
}

fn strip_utf8_bom(bytes: &[u8]) -> (&[u8], bool) {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        (&bytes[3..], true)
    } else {
        (bytes, false)
    }
}

fn decode_utf16(bytes: &[u8], le: bool) -> Option<String> {
    if bytes.len() % 2 != 0 || bytes.is_empty() {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if le {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect();
    String::from_utf16(&units).ok()
}

fn encode_utf16(text: &str, le: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2);
    for unit in text.encode_utf16() {
        let bytes = if le {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        out.extend_from_slice(&bytes);
    }
    out
}

fn utf16_heuristic(bytes: &[u8]) -> Option<(TextEncodingId, DetectionConfidence)> {
    if bytes.len() < 40 || bytes.len() % 2 != 0 {
        return None;
    }
    let sample_units = (bytes.len() / 2).min(256);
    let mut le_zero = 0usize;
    let mut be_zero = 0usize;
    for i in 0..sample_units {
        let lo = bytes[i * 2];
        let hi = bytes[i * 2 + 1];
        if hi == 0 {
            le_zero += 1;
        }
        if lo == 0 {
            be_zero += 1;
        }
    }
    let le_ratio = le_zero as f64 / sample_units as f64;
    let be_ratio = be_zero as f64 / sample_units as f64;
    if le_ratio >= 0.60 && be_ratio <= 0.05 {
        if decode_utf16(bytes, true).is_some() {
            return Some((TextEncodingId::Utf16Le, DetectionConfidence::High));
        }
    }
    if be_ratio >= 0.60 && le_ratio <= 0.05 {
        if decode_utf16(bytes, false).is_some() {
            return Some((TextEncodingId::Utf16Be, DetectionConfidence::High));
        }
    }
    None
}

fn strict_decode_legacy(encoding: TextEncodingId, bytes: &[u8]) -> Result<String, CodecError> {
    let Some(enc) = encoding.encoding_rs() else {
        return Err(CodecError::DecodeFailed);
    };
    let mut decoder = enc.new_decoder_without_bom_handling();
    let mut out = String::with_capacity(bytes.len() * 2);
    let (result, _) = decoder.decode_to_string_without_replacement(bytes, &mut out, true);
    match result {
        encoding_rs::DecoderResult::InputEmpty => Ok(out),
        _ => Err(CodecError::DecodeFailed),
    }
}

fn has_gb18030_four_byte(bytes: &[u8]) -> bool {
    let mut i = 0;
    while i + 3 < bytes.len() {
        let b0 = bytes[i];
        if (0x81..=0xfe).contains(&b0) {
            let b1 = bytes[i + 1];
            if (0x30..=0x39).contains(&b1) {
                let b2 = bytes[i + 2];
                let b3 = bytes[i + 3];
                if (0x81..=0xfe).contains(&b2) && (0x30..=0x39).contains(&b3) {
                    return true;
                }
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    false
}

fn map_chardet(encoding: &'static Encoding, bytes: &[u8]) -> Option<TextEncodingId> {
    if encoding == WINDOWS_1252 {
        return Some(TextEncodingId::Windows1252);
    }
    // Other single-byte Latin encodings from chardetng are treated as Windows-1252
    // for document editing, since that covers the common Western Markdown corpus.
    let name = encoding.name();
    if name.starts_with("windows-125")
        || name.starts_with("ISO-8859-")
        || name == "macintosh"
    {
        return Some(TextEncodingId::Windows1252);
    }
    if encoding == GBK || encoding == GB18030 {
        return Some(if has_gb18030_four_byte(bytes) {
            TextEncodingId::Gb18030
        } else {
            TextEncodingId::Gbk
        });
    }
    if encoding == BIG5 {
        return Some(TextEncodingId::Big5);
    }
    if encoding == SHIFT_JIS {
        return Some(TextEncodingId::ShiftJis);
    }
    if encoding == EUC_KR {
        return Some(TextEncodingId::EucKr);
    }
    if encoding == UTF_8 {
        return Some(TextEncodingId::Utf8);
    }
    None
}

fn hint_encoding(hint: EncodingHint) -> Option<TextEncodingId> {
    match hint {
        EncodingHint::Auto => None,
        EncodingHint::Western => Some(TextEncodingId::Windows1252),
        EncodingHint::SimplifiedChinese => Some(TextEncodingId::Gbk),
        EncodingHint::TraditionalChinese => Some(TextEncodingId::Big5),
        EncodingHint::Japanese => Some(TextEncodingId::ShiftJis),
        EncodingHint::Korean => Some(TextEncodingId::EucKr),
    }
}

pub fn detect_and_decode(
    bytes: &[u8],
    hint: EncodingHint,
) -> Result<DecodedText, CodecError> {
    // BOM paths are certain and must run before NUL/binary checks (UTF-16 uses NULs).
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        let (body, _) = strip_utf8_bom(bytes);
        if looks_binary_or_nul(body) {
            return Err(CodecError::BinaryOrNul);
        }
        let text = std::str::from_utf8(body).map_err(|_| CodecError::DecodeFailed)?;
        return Ok(DecodedText {
            text: text.to_string(),
            meta: EncodingMeta {
                encoding: TextEncodingId::Utf8,
                has_bom: true,
                confidence: DetectionConfidence::Certain,
                source: DetectionSource::Bom,
                allow_direct_overwrite: true,
            },
        });
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        let text = decode_utf16(&bytes[2..], true).ok_or(CodecError::DecodeFailed)?;
        return Ok(DecodedText {
            text,
            meta: EncodingMeta {
                encoding: TextEncodingId::Utf16Le,
                has_bom: true,
                confidence: DetectionConfidence::Certain,
                source: DetectionSource::Bom,
                allow_direct_overwrite: true,
            },
        });
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let text = decode_utf16(&bytes[2..], false).ok_or(CodecError::DecodeFailed)?;
        return Ok(DecodedText {
            text,
            meta: EncodingMeta {
                encoding: TextEncodingId::Utf16Be,
                has_bom: true,
                confidence: DetectionConfidence::Certain,
                source: DetectionSource::Bom,
                allow_direct_overwrite: true,
            },
        });
    }

    if let Some((encoding, confidence)) = utf16_heuristic(bytes) {
        let text = decode_utf16(bytes, matches!(encoding, TextEncodingId::Utf16Le))
            .ok_or(CodecError::DecodeFailed)?;
        return Ok(DecodedText {
            text,
            meta: EncodingMeta {
                encoding,
                has_bom: false,
                confidence,
                source: DetectionSource::Utf16Heuristic,
                allow_direct_overwrite: confidence != DetectionConfidence::Tentative,
            },
        });
    }

    if looks_binary_or_nul(bytes) {
        return Err(CodecError::BinaryOrNul);
    }

    if let Some(forced) = hint_encoding(hint) {
        let text = match forced {
            TextEncodingId::Utf16Le => decode_utf16(bytes, true).ok_or(CodecError::DecodeFailed)?,
            TextEncodingId::Utf16Be => {
                decode_utf16(bytes, false).ok_or(CodecError::DecodeFailed)?
            }
            TextEncodingId::Utf8 => {
                std::str::from_utf8(bytes)
                    .map_err(|_| CodecError::DecodeFailed)?
                    .to_string()
            }
            other => strict_decode_legacy(other, bytes)?,
        };
        return Ok(DecodedText {
            text,
            meta: EncodingMeta {
                encoding: forced,
                has_bom: false,
                confidence: DetectionConfidence::Certain,
                source: DetectionSource::UserHint,
                allow_direct_overwrite: true,
            },
        });
    }

    // Strict UTF-8 without BOM.
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(DecodedText {
            text: text.to_string(),
            meta: EncodingMeta {
                encoding: TextEncodingId::Utf8,
                has_bom: false,
                confidence: DetectionConfidence::High,
                source: DetectionSource::Utf8Strict,
                allow_direct_overwrite: true,
            },
        });
    }

    let mut detector =
        chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let guessed = detector.guess(None, chardetng::Utf8Detection::Deny);
    let encoding = map_chardet(guessed, bytes)
        .or_else(|| {
            // Last resort: try Windows-1252 if high bytes are present.
            if bytes.iter().any(|&b| b >= 0x80)
                && strict_decode_legacy(TextEncodingId::Windows1252, bytes).is_ok()
            {
                Some(TextEncodingId::Windows1252)
            } else {
                None
            }
        })
        .ok_or(CodecError::DecodeFailed)?;
    let text = strict_decode_legacy(encoding, bytes)?;
    let high_bytes = bytes.iter().filter(|&&b| b >= 0x80).count();
    let confidence = if high_bytes >= 32 {
        DetectionConfidence::High
    } else {
        DetectionConfidence::Tentative
    };
    Ok(DecodedText {
        text,
        meta: EncodingMeta {
            encoding,
            has_bom: false,
            confidence,
            source: DetectionSource::Chardet,
            allow_direct_overwrite: true,
        },
    })
}

fn encode_legacy(text: &str, encoding: TextEncodingId) -> Result<Vec<u8>, CodecError> {
    let enc = encoding.encoding_rs().ok_or(CodecError::DecodeFailed)?;
    let mut encoder = enc.new_encoder();
    let mut out = Vec::with_capacity(text.len() * 2);
    let mut remaining = text;
    let mut char_index = 0usize;
    loop {
        let (result, read) =
            encoder.encode_from_utf8_to_vec_without_replacement(remaining, &mut out, true);
        match result {
            encoding_rs::EncoderResult::InputEmpty => return Ok(out),
            encoding_rs::EncoderResult::OutputFull => {
                out.reserve(out.capacity().max(1024));
                let consumed = &remaining[..read];
                char_index += consumed.chars().count();
                remaining = &remaining[read..];
            }
            encoding_rs::EncoderResult::Unmappable(ch) => {
                let prefix = &remaining[..read];
                return Err(CodecError::UnmappableCharacter {
                    codepoint: ch as u32,
                    encoding,
                    index: char_index + prefix.chars().count(),
                });
            }
        }
    }
}

pub fn encode_text(text: &str, meta: &EncodingMeta) -> Result<Vec<u8>, CodecError> {
    match meta.encoding {
        TextEncodingId::Utf8 => {
            let mut out = Vec::with_capacity(text.len() + 3);
            if meta.has_bom {
                out.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        TextEncodingId::Utf16Le => {
            let mut out = Vec::new();
            if meta.has_bom {
                out.extend_from_slice(&[0xff, 0xfe]);
            }
            out.extend(encode_utf16(text, true));
            Ok(out)
        }
        TextEncodingId::Utf16Be => {
            let mut out = Vec::new();
            if meta.has_bom {
                out.extend_from_slice(&[0xfe, 0xff]);
            }
            out.extend(encode_utf16(text, false));
            Ok(out)
        }
        other => encode_legacy(text, other),
    }
}

/// Normalize newlines to LF in memory; report whether original used CRLF.
pub fn normalize_newlines(text: &str) -> (String, bool) {
    let has_crlf = text.contains("\r\n");
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    (normalized, has_crlf)
}

pub fn apply_line_ending(text: &str, crlf: bool) -> String {
    if crlf {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_utf8_bom() {
        let bytes = b"\xEF\xBB\xBF# hello\n";
        let decoded = detect_and_decode(bytes, EncodingHint::Auto).unwrap();
        assert_eq!(decoded.text, "# hello\n");
        assert!(decoded.meta.has_bom);
        assert_eq!(decoded.meta.encoding, TextEncodingId::Utf8);
    }

    #[test]
    fn detects_windows1252_em_dash() {
        let bytes = b"# Title \x97 Section\r\n";
        let decoded = detect_and_decode(bytes, EncodingHint::Auto).unwrap();
        assert!(decoded.text.contains('—'));
        assert_eq!(decoded.meta.encoding, TextEncodingId::Windows1252);
        let encoded = encode_text(&decoded.text.replace("\r\n", "\n").replace('\n', "\r\n"), &decoded.meta)
            .unwrap();
        assert_eq!(encoded, bytes);
    }

    #[test]
    fn utf16_le_roundtrip_with_bom() {
        let text = "# 你好\n";
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(encode_utf16(text, true));
        let decoded = detect_and_decode(&bytes, EncodingHint::Auto).unwrap();
        assert_eq!(decoded.text, text);
        assert_eq!(decoded.meta.encoding, TextEncodingId::Utf16Le);
        assert!(decoded.meta.has_bom);
        let encoded = encode_text(&decoded.text, &decoded.meta).unwrap();
        assert_eq!(encoded, bytes);
    }

    #[test]
    fn rejects_nul_as_binary() {
        let bytes = b"hello\0world";
        assert_eq!(
            detect_and_decode(bytes, EncodingHint::Auto),
            Err(CodecError::BinaryOrNul)
        );
    }

    #[test]
    fn unmappable_emoji_on_windows1252() {
        let meta = EncodingMeta {
            encoding: TextEncodingId::Windows1252,
            has_bom: false,
            confidence: DetectionConfidence::High,
            source: DetectionSource::Chardet,
            allow_direct_overwrite: true,
        };
        let err = encode_text("hello 😀", &meta).unwrap_err();
        match err {
            CodecError::UnmappableCharacter { codepoint, .. } => {
                assert_eq!(codepoint, 0x1f600);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn utf16_be_roundtrip_with_bom() {
        let text = "# Hello\n";
        let mut bytes = vec![0xfe, 0xff];
        bytes.extend(encode_utf16(text, false));
        let decoded = detect_and_decode(&bytes, EncodingHint::Auto).unwrap();
        assert_eq!(decoded.text, text);
        assert_eq!(decoded.meta.encoding, TextEncodingId::Utf16Be);
        let encoded = encode_text(&decoded.text, &decoded.meta).unwrap();
        assert_eq!(encoded, bytes);
    }

    #[test]
    fn gbk_roundtrip() {
        let text = "你好世界\n";
        let meta = EncodingMeta {
            encoding: TextEncodingId::Gbk,
            has_bom: false,
            confidence: DetectionConfidence::High,
            source: DetectionSource::UserHint,
            allow_direct_overwrite: true,
        };
        let encoded = encode_text(text, &meta).unwrap();
        let decoded = detect_and_decode(&encoded, EncodingHint::SimplifiedChinese).unwrap();
        assert_eq!(decoded.text, text);
        assert_eq!(decoded.meta.encoding, TextEncodingId::Gbk);
    }

    #[test]
    fn big5_shift_jis_euc_kr_roundtrips() {
        let cases = [
            (TextEncodingId::Big5, EncodingHint::TraditionalChinese, "繁體中文\n"),
            (TextEncodingId::ShiftJis, EncodingHint::Japanese, "日本語\n"),
            (TextEncodingId::EucKr, EncodingHint::Korean, "한국어\n"),
        ];
        for (encoding, hint, text) in cases {
            let meta = EncodingMeta {
                encoding,
                has_bom: false,
                confidence: DetectionConfidence::High,
                source: DetectionSource::UserHint,
                allow_direct_overwrite: true,
            };
            let encoded = encode_text(text, &meta).unwrap();
            let decoded = detect_and_decode(&encoded, hint).unwrap();
            assert_eq!(decoded.text, text, "{encoding:?}");
            assert_eq!(decoded.meta.encoding, encoding);
        }
    }

    #[test]
    fn utf8_without_bom_roundtrip() {
        let text = "# hello 😀\n";
        let decoded = detect_and_decode(text.as_bytes(), EncodingHint::Auto).unwrap();
        assert_eq!(decoded.meta.encoding, TextEncodingId::Utf8);
        assert!(!decoded.meta.has_bom);
        let encoded = encode_text(&decoded.text, &decoded.meta).unwrap();
        assert_eq!(encoded, text.as_bytes());
    }

    #[test]
    fn user_hint_forces_western() {
        let bytes = b"cafe \xE9\n";
        let decoded = detect_and_decode(bytes, EncodingHint::Western).unwrap();
        assert_eq!(decoded.meta.encoding, TextEncodingId::Windows1252);
        assert!(decoded.text.contains('é'));
    }
}
