# image-hanhua · 网页图片汉化

一个 Edge / Chrome 扩展，加上一个本机服务：把网页图片里的英文、韩文识别出来，翻译成简体中文，再按原文位置用白底中文框盖在图片上。原图文件不动，随时可以切回原图。

- **识别**：Mac 用系统自带的 Vision；Windows 用 [RapidOCR](https://github.com/RapidAI/RapidOCR)（PP-OCRv5 韩文模型，英文也能识别）。
- **翻译**：默认离线翻译（英→中用 Argos/OPUS-MT，韩→中用 M2M100，都通过 CTranslate2 运行）；也可以配置 OpenAI 兼容接口，翻译时会带上网页上下文。
- 图片只在本机识别。服务只监听 `127.0.0.1:17863`，请求必须带配对码。

## 原理

```
网页 <img> → 扩展（content/engine.js 找图，background.js 取图）
          → 本机服务 service/server.py
              ├─ service/ocr.py：Mac 调用 runtime/ocr（Vision），Windows 用 RapidOCR
              ├─ merge_lines：把相邻的行合并成文字框
              └─ 离线模型或 AI 接口（service/ai.py）翻译
          → 返回文字框坐标和译文 → 扩展在图片上叠加中文框
```

## 目录

| 路径 | 说明 |
|---|---|
| `extension/` | 浏览器扩展（Mac / Windows 共用） |
| `service/` | 本机服务、离线模型安装脚本（共用） |
| `examples/` | 体验页、配对页、AI 设置页 |
| `mac/` | Vision 识别程序 `ocr.swift`，以及 `安装.command`、`启动.command` |
| `windows/` | `install.bat`、`start.bat` 和 RapidOCR 依赖 |
| `docs/` | 最初 Mac 版的详细说明和验收记录 |

模型和运行环境会在安装时下载到 `models/`、`runtime/`，不放进仓库。

## Mac 安装（Apple Silicon）

需要：[uv](https://docs.astral.sh/uv/)、Xcode Command Line Tools。

1. 双击 `mac/安装.command`。首次运行会下载依赖和约 560 MB 模型。
2. 双击 `mac/启动.command`，保持窗口开着。

## Windows 安装（Windows 10 / 11）

需要：uv。在 PowerShell 运行 `winget install --id=astral-sh.uv -e`，然后重新打开窗口。

1. 双击 `windows/install.bat`。首次运行会下载依赖、约 560 MB 翻译模型和 RapidOCR 识别模型。
2. 双击 `windows/start.bat`，保持窗口开着。

## 加载扩展（两个平台相同）

1. 打开 `edge://extensions`（Chrome：`chrome://extensions`），开启"开发人员模式"，点"加载解压缩的扩展"，选择 `extension` 文件夹。
2. 打开 `http://127.0.0.1:17863/setup`，复制配对码，粘贴到扩展的"配对设置"里。
3. 在普通网页点击扩展的"翻译当前页"。可以先打开 `http://127.0.0.1:17863/demo` 试用。

AI 翻译：打开 `http://127.0.0.1:17863/ai-settings`，填写以 `/chat/completions` 结尾的接口地址、模型名和密钥。密钥明文保存在 `runtime/ai-config.json`。

## 限制

- 只支持英文、韩文 → 简体中文。
- 不处理 CSS 背景图、canvas、视频、跨域 iframe 和 Shadow DOM 里的图片。
- 单张图片不超过 12 MB / 2400 万像素。
- Windows 版用 RapidOCR，识别效果和 Mac 的 Vision 不完全一样。

## 模型来源与许可

- 英→中：[Argos Translate](https://github.com/argosopentech/argos-translate) 1.9 版模型，基于 OPUS-MT（CC-BY 4.0，作者 Jörg Tiedemann、Santhosh Thottingal）。
- 韩→中：[facebook/m2m100_418M](https://huggingface.co/facebook/m2m100_418M) 的 CTranslate2 转换版（`gn64/M2M100_418M_CTranslate2`）。
- Windows 识别：RapidOCR / PaddleOCR 模型（Apache-2.0）。
