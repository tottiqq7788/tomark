# Fonts for PDF export (SIL Open Font License 1.1)

Required by the app:

| File | Family | Role |
| --- | --- | --- |
| `SourceHanSansSC-VF.ttf` | Source Han Sans SC | CJK body / fallback |
| `SourceCodePro-Regular.ttf` | Source Code Pro | Monospace code (regular) |
| `SourceCodePro-Bold.ttf` | Source Code Pro | Monospace code (bold) |
| `NotoSansSymbols2-Regular.ttf` | Noto Sans Symbols 2 | Misc symbols |
| `NotoEmoji-Regular.ttf` | Noto Emoji | Monochrome emoji (variable wght) |

## Download

```sh
# Source Han Sans SC (variable TTF)
curl -L -o SourceHanSansSC-VF.ttf \
  https://github.com/adobe-fonts/source-han-sans/raw/release/Variable/TTF/SourceHanSansSC-VF.ttf

# Source Code Pro
curl -L -o SourceCodePro-Regular.ttf \
  https://github.com/adobe-fonts/source-code-pro/raw/release/TTF/SourceCodePro-Regular.ttf
curl -L -o SourceCodePro-Bold.ttf \
  https://github.com/adobe-fonts/source-code-pro/raw/release/TTF/SourceCodePro-Bold.ttf

# Noto Sans Symbols 2
curl -L -o NotoSansSymbols2-Regular.ttf \
  https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf

# Noto Emoji (monochrome variable from google/fonts OFL tree)
curl -L -o NotoEmoji-Regular.ttf \
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf"
```
