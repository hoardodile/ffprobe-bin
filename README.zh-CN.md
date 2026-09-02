# @hoardodile/ffprobe-bin

[English](./README.md)

静态 **ffprobe 9.0.1** 二进制 npm 包。包体只有几 KB，二进制在安装时从 GitHub Releases 下载——上游静态构建站点不适合直接依赖。与 `@hoardodile/7z-bin` 和 `@derhuerst/ffprobe-static` 相同的安装时下载模型。

## 平台

| 平台 | 二进制 |
| --- | --- |
| win32-x64 | ffprobe.exe |
| darwin-x64 | ffprobe |
| darwin-arm64 | ffprobe |
| linux-x64 | ffprobe |
| linux-arm64 | ffprobe |

二进制的来源是维护中的 9.0 构建者：[GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg) **essentials**（Windows，精简构建——保留常用解码器与 mjpeg 编码器，去掉重型编码库）、[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)（Linux）、[evermeet.cx](https://evermeet.cx/ffmpeg/)（macOS x64）和 [osxexperts.net](https://www.osxexperts.net/)（macOS arm64）。

release 资产是**未压缩的原始二进制**（release 页面显示的大小即真实占用，无 tar/gz 包装）。Windows 与 Linux 为 ffprobe `9.0.1`；macOS arm64 构建为 `9.0`（各第三方构建者的补丁版本不同）。

不支持的平台（`win32-ia32`、`win32-arm64`、`linux-ia32`、`linux-arm` —— 没有维护中的 9.0.1 构建）返回 `null`；使用者应回退到 PATH 上的 `ffprobe`。

## 使用

```js
const ffprobe = require("@hoardodile/ffprobe-bin") // 路径或 null
```

- `FFPROBE_BIN_PATH` — 覆盖返回的路径。
- `FFPROBE_BINARIES_URL` — 覆盖下载源。
- 安装时校验 SHA-256（`assets.json`）并要求 `ffprobe -version` 输出含 "9.0"（主.次版本）。

## 运行时下载（Electron）

不打包二进制：让应用按需从 release 下载、校验并 `chmod +x`：

```
https://github.com/hoardodile/ffprobe-bin/releases/download/v<版本>/ffprobe-<平台>-<架构>
```

- 免鉴权；资产是原始 `ffprobe` 二进制（Windows 为 `ffprobe.exe`）。
- 校验：包内 `assets.json`，或 release 上的 `SHA256SUMS.txt`。校验 SHA-256 后，macOS/Linux 需 `chmod +x`。

## 构建资产 / 发版

`assets.json` 在首次构建前只有空的 `sha256` 占位符——构建脚本会写入每个重打包产物的真实 SHA-256。

1. 更新 `scripts/build-assets.mjs` 中的 `VERSION`（以及上游文件名，若命名变化）
2. 提升 `package.json` 版本号（决定 release tag）
3. 运行 `npm run build:assets`（幂等；`--skip-upload` 只本地构建并写入真实 `assets.json`）
4. 提交（至少 `assets.json` + 版本号）、推送，然后推送 `v<version>` tag。
   tag 会触发 release 工作流：构建/上传资产到 GitHub release，并自动发布
   npm（Trusted Publishing / OIDC —— Actions 中不存任何 registry token）。

npm 侧一次性设置（每个包一次，npm >= 11.11，owner 账号，需一次 2FA 验证）：

```
npm trust github @hoardodile/ffprobe-bin --file release.yml --repo hoardodile/ffprobe-bin --allow-publish
```

注意：bump 提交触发的 main CI 可能在 release 工作流上传完资产前启动，
install/verify 任务会因 404 瞬时失败——待 release 工作流结束后重跑即可：

```
gh run rerun --repo hoardodile/ffprobe-bin --failed <run-id>
```

## 许可

脚本 GPL-3.0。ffprobe 二进制版权归其各自的构建者（GPL / LGPL），不随包发布，需参见各自上游的许可证。`scripts/build-assets.mjs` 与 release 说明中记录了出处。
