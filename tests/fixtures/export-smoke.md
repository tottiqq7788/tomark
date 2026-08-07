# 导出冒烟 Fixture

这是一份用于导出验证的 Markdown，包含中文、GFM 表格、列表、代码块、链接和图片。

## 列表

- 第一项
- 第二项
  1. 嵌套有序
  2. 继续

## 表格

| 功能 | 状态 |
| --- | --- |
| PDF 单页矢量 | 待验证 |
| DOCX 可编辑 | 待验证 |

## 代码

```ts
export function hello(name: string): string {
  return `你好，${name}`;
}
```

## 链接与图片

访问 [tomark](https://example.com)。

![内联小图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

相对本地图（若文档旁无文件则应产生警告而不阻断）：

![本地相对图](./images/missing-sample.png)
