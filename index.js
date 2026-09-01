"use strict"

// The ffprobe executable for this platform, or null when unsupported.
// Consumers should treat null as "ffprobe unavailable" and degrade to the
// host's PATH (bare `ffprobe`), exactly like @hoardodile/7z-bin returns
// null for platforms it cannot ship.
const path = require("node:path")
const os = require("node:os")

// Statically linked ffprobe builds, sourced at build-assets time from the
// up-to-date 9.0 builders (BtbN/FFmpeg-Builds Windows + Linux,
// evermeet.cx + osxexperts.net macOS):
//   win32-x64      -> bin/win32-x64/ffprobe.exe
//   darwin-x64     -> bin/darwin-x64/ffprobe
//   darwin-arm64   -> bin/darwin-arm64/ffprobe
//   linux-x64      -> bin/linux-x64/ffprobe
//   linux-arm64    -> bin/linux-arm64/ffprobe
// win32-ia32 / win32-arm64 / linux-ia32 / linux-arm have no maintained
// 9.0.1 build and resolve to null.
const BINARIES = {
	"win32-x64": "ffprobe.exe",
	"darwin-x64": "ffprobe",
	"darwin-arm64": "ffprobe",
	"linux-x64": "ffprobe",
	"linux-arm64": "ffprobe",
}

const ENV_VAR = "FFPROBE_BIN_PATH"

if (process.env[ENV_VAR]) {
	module.exports = process.env[ENV_VAR]
} else {
	const key = `${os.platform()}-${os.arch()}`
	const bin = BINARIES[key]
	module.exports = bin ? path.join(__dirname, "bin", key, bin) : null
}
