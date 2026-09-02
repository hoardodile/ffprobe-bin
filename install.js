#!/usr/bin/env node
"use strict"

// Download the ffprobe static binary for this platform. The asset is the
// raw single-file binary (uncompressed — the release page shows the real
// on-disk size), so install is a plain download + chmod, no tar/gz/gunzip.
//
//   win32-x64      -> ffprobe-win32-x64    (ffprobe.exe)
//   darwin-x64     -> ffprobe-darwin-x64   (ffprobe)
//   darwin-arm64   -> ffprobe-darwin-arm64 (ffprobe)
//   linux-x64      -> ffprobe-linux-x64    (ffprobe)
//   linux-arm64    -> ffprobe-linux-arm64  (ffprobe)
//
// A failed download exits non-zero so the package manager skips the
// optional dependency and the host degrades to a PATH `ffprobe`.
// `FFPROBE_BINARIES_URL` overrides the GitHub release base URL.

const { createHash } = require("node:crypto")
const {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
} = require("node:fs")
const { join } = require("node:path")
const { spawnSync } = require("node:child_process")

// Downloads go through the system `curl` (bundled on Windows 10+,
// macOS and Linux): it honors HTTP_PROXY/HTTPS_PROXY like gh/git do,
// follows redirects and retries on transient failures.

function downloadWithRetry(url, dest, attempts = 3) {
	const args = [
		"-fsSL",
		"--retry",
		"3",
		"--retry-delay",
		"1",
		"--max-time",
		"600",
		"-o",
		dest,
		url,
	]
	const res = spawnSync("curl", args, { stdio: "ignore", timeout: 620_000 })
	if (res.error) throw res.error
	if (res.status !== 0) {
		if (attempts > 1) {
			console.info(`[ffprobe-bin] download failed (curl exit ${res.status}), retrying ...`)
			return new Promise((r) => setTimeout(r, 1_000)).then(() =>
				downloadWithRetry(url, dest, attempts - 1),
			)
		}
		throw new Error(`curl ${url} exited ${res.status}`)
	}
}
let manifest
try {
	manifest = require("./assets.json")
} catch {
	manifest = null
}

const { version } = require("./package.json")

const RELEASE_BASE = `https://github.com/hoardodile/ffprobe-bin/releases/download/v${version}`
const ENV_BASE = process.env["FFPROBE_BINARIES_URL"]

const BINARY = {
	win32: "ffprobe.exe",
	darwin: "ffprobe",
	linux: "ffprobe",
}

const platform = process.env.npm_config_platform || process.platform
const arch = process.env.npm_config_arch || process.arch
const key = `${platform}-${arch}`
const asset = manifest?.assets?.[key]

if (!asset) {
	console.warn(
		`[ffprobe-bin] no ffprobe ${manifest?.ffprobe ?? "?"} binary for ${platform}-${arch}; skipping.`,
	)
	process.exit(0)
}

const pkgDir = __dirname
const TMP_DIR = join(pkgDir, "tmp")
const binDir = join(pkgDir, "bin", key)
const binPath = join(binDir, BINARY[platform])

function verifyExisting() {
	try {
		if (!existsSync(binPath) || statSync(binPath).size <= 0) return false
		return true
	} catch {
		return false
	}
}

function fail(msg, err) {
	console.error(`[ffprobe-bin] ${msg}${err ? `: ${err.message}` : ""}`)
	process.exit(1)
}

function verifyHash(file, expected) {
	if (!expected) return
	const hash = createHash("sha256")
	hash.update(readFileSync(file))
	if (hash.digest("hex") !== expected) {
		throw new Error(`sha256 mismatch for ${file}`)
	}
}

/**
 * Smoke-run the installed binary and require the expected ffprobe
 * major.minor version: a wrong artifact (e.g. a stale/default build) fails
 * here instead of at runtime. `ffprobe -version` prints
 * "ffprobe version <ver>-..." across all the upstream builders (GyanD /
 * evermeet / osxexperts / BtbN).
 */
function smokeTest() {
	const res = spawnSync(binPath, ["-version"], {
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 30_000,
	})
	if (res.status !== 0) {
		throw new Error(`${binPath} failed its smoke run (exit ${res.status})`)
	}
	// Builders differ in the patch level (9.0 vs 9.0.1), so require the
	// major.minor from assets.json, not the exact patch.
	const mm = String(manifest?.ffprobe ?? "").split(".").slice(0, 2).join(".")
	if (mm && !String(res.stdout).split("\n")[0].includes(mm)) {
		throw new Error(
			`${binPath} does not report ffprobe ${mm} (expected in 'ffprobe -version')`,
		)
	}
}

async function main() {
	if (verifyExisting()) {
		console.info(`[ffprobe-bin] ${BINARY[platform]} already installed.`)
		return
	}
	mkdirSync(TMP_DIR, { recursive: true })
	try {
		const tmp = join(TMP_DIR, asset.file)
		await downloadWithRetry(`${ENV_BASE || RELEASE_BASE}/${asset.file}`, tmp)
		verifyHash(tmp, asset.sha256)
		mkdirSync(binDir, { recursive: true })
		copyFileSync(tmp, binPath)
		if (platform !== "win32") chmodSync(binPath, 0o755)
		if (!verifyExisting()) {
			throw new Error(`${binPath} missing after install`)
		}
		smokeTest()
		console.info(`[ffprobe-bin] ${BINARY[platform]} installed at ${binPath}`)
	} catch (err) {
		rmSync(binPath, { force: true })
		fail(`failed to install ffprobe ${manifest?.ffprobe ?? "?"}`, err)
	} finally {
		rmSync(TMP_DIR, { recursive: true, force: true })
	}
}

main()
