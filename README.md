# @hoardodile/ffprobe-bin

[中文](./README.zh-CN.md)

Static **ffprobe 9.0.1** binary as an npm package. The package is only a few KB; the binary is downloaded from GitHub Releases at install time because the upstream static-build sites are unreliable to depend on directly. This is the same install-time-download model as `@hoardodile/7z-bin` and `@derhuerst/ffprobe-static`.

## Platforms

| Platform | Binary |
| --- | --- |
| win32-x64 | ffprobe.exe |
| darwin-x64 | ffprobe |
| darwin-arm64 | ffprobe |
| linux-x64 | ffprobe |
| linux-ia32 | ffprobe |
| linux-arm64 | ffprobe |
| linux-arm | ffprobe |

The binaries are the statically linked builds from the same upstreams [`ffprobe-static`](https://github.com/eugeneware/ffmpeg-static) uses: [GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg) (Windows), [evermeet.cx](https://evermeet.cx/ffmpeg/) (macOS x64), [osxexperts.net](https://www.osxexperts.net/) (macOS arm64) and [johnvansickle.com](https://johnvansickle.com/ffmpeg/) (Linux).

Unsupported platforms (e.g. `win32-ia32`, `win32-arm64` — no maintained 9.0.1 build) resolve to `null`; consumers should degrade to a PATH `ffprobe`.

## Usage

```js
const ffprobe = require("@hoardodile/ffprobe-bin") // path or null
```

- `FFPROBE_BIN_PATH` — overrides the returned path.
- `FFPROBE_BINARIES_URL` — overrides the download base URL.
- Install verifies SHA-256 (`assets.json`) and requires ffprobe `9.0.1` in the `ffprobe -version` output.

## Runtime download (Electron)

Skip bundling binaries: let your app download them from the release on demand, verify, and unpack:

```
https://github.com/hoardodile/ffprobe-bin/releases/download/v<version>/<platform>.tar.gz
```

- No authentication required; contents: `ffprobe` (or `ffprobe.exe` on Windows).
- Checksums: `assets.json` in the package, or `SHA256SUMS.txt` on the release.
- Unpack with `tar -xf`.

## Building the assets + releasing

`assets.json` ships with empty `sha256` placeholders until the assets are first built — the script records the real SHA-256 of each repacked artifact.

1. Update `VERSION` (and per-platform filenames, if the upstream naming changed) in `scripts/build-assets.mjs`
2. Bump `package.json` version (defines the release tag)
3. Run `npm run build:assets` (idempotent; `--skip-upload` builds locally only and writes the real `assets.json`)
4. Commit (at minimum `assets.json` + the version), push, then push the `v<version>` tag. The tag triggers the release workflow: assets are built/uploaded to the GitHub release and the package is published to npm automatically (Trusted Publishing / OIDC — no registry token in Actions).

One-time npm-side setup (per package, npm >= 11.11, owner account, asks for a 2FA code once):

```
npm trust github @hoardodile/ffprobe-bin --file release.yml --repo hoardodile/ffprobe-bin --allow-publish
```

Note: the main-branch CI run for the bump commit can transiently fail its install/verify jobs while the tag-triggered release workflow is still uploading assets (404 on the `v<version>` download URL) — rerun the failed jobs once the release workflow finished:

```
gh run rerun --repo hoardodile/ffprobe-bin --failed <run-id>
```

## License

GPL-3.0 (scripts). The ffprobe binary is copyright its respective builders (GPL / LGPL), not shipped in the package; consult each upstream build's own license. Attribution is recorded by `scripts/build-assets.mjs` and the release notes.
