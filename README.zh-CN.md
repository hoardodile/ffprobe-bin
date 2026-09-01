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
| linux-ia32 | ffprobe |
| linux-arm64 | ffprobe |
| linux-arm | ffprobe |

二进制的来源与 [`ffprobe-static`](https://github.com/eugeneware/ffmpeg-static) 相同：[GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg)（Windows）、[evermeet.cx](https://evermeet.cx/ffmpeg/)（macOS x64）、[osxexperts.net](https://www.osxexperts.net/)（macOS arm64）和 [johnvansickle.com](https://johnvansickle.com/ffmpeg/)（Linux）。

不支持的平台（如 `win32-ia32`、`win32-arm64` —— 没有维护中的 9.0.1 构建）返回 `null`；使用者应回退到 PATH 上的 `ffprobe`。

## 使用

```js
const ffprobe = require("@hoardodile/ffprobe-bin") // 路径或 null
```

- `FFPROBE_BIN_PATH` — 覆盖返回的路径。
- `FFPROBE_BINARIES_URL` — 覆盖下载源。
- 安装时校验 SHA-256（`assets.json`）并要求 `ffprobe -version` 输出含 "9.0.1"。

## 运行时下载（Electron）

不打包二进制：让应用按需从 release 下载、校验并解压：

```
https://github.com/hoardodile/ffprobe-bin/releases/download/v<版本>/<平台>.tar.gz
```

- 免鉴权；内容为 `ffprobe`（Windows 为 `ffprobe.exe`）。
- 校验：包内 `assets.json`，或 release 上的 `SHA256SUMS.txt`。
- 解压：`tar -xf`。

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
