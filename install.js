#!/usr/bin/env node
"use strict"

// Download and unpack the ffprobe static binary for this platform, the
// same install-time model as @hoardodile/7z-bin and ffprobe-static: the
// npm tarball stays tiny and the binary lands at install time.
//
// The binaries are pre-built per platform by scripts/build-assets.mjs
// (from the official/static upstream builds: GyanD/codexffmpeg Windows,
// evermeet.cx + osxexperts.net macOS, johnvansickle.com Linux) and
// hosted on this repo's GitHub Releases. The release tag always matches
// this package's own version; the ffprobe version and the SHA-256 of each
// asset live in assets.json.
//
//   win32-x64      -> win32-x64.tar.gz    (ffprobe.exe)
//   darwin-x64     -> darwin-x64.tar.gz   (ffprobe)
//   darwin-arm64   -> darwin-arm64.tar.gz (ffprobe)
//   linux-x64      -> linux-x64.tar.gz    (ffprobe)
//   linux-ia32     -> linux-ia32.tar.gz   (ffprobe)
//   linux-arm64    -> linux-arm64.tar.gz  (ffprobe)
//   linux-arm      -> linux-arm.tar.gz    (ffprobe)
//
// A failed download/unpack exits non-zero so the package manager skips
// the optional dependency and the host degrades to a PATH `ffprobe`.
// `FFPROBE_BINARIES_URL` overrides the GitHub release base URL.

const { createHash } = require("node:crypto")
const {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
} = require("node:fs")
const { join } = require("node:path")
const { spawnSync } = require("node:child_process")
const tar = require("tar")

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
 * Extract (tar.gz) into `destDir` via node-tar — no system tar is needed
 * on any platform, so PATH ambiguity (Git for Windows' GNU tar misparses
 * drive-letter paths as remote hosts) cannot bite.
 */
function runTar(tarball, destDir) {
	tar.x({ file: tarball, cwd: destDir, sync: true })
}

/** Extract the platform package (tar.gz) into bin/<platform>-<arch>/. */
function unpack() {
	mkdirSync(binDir, { recursive: true })
	const tarball = join(TMP_DIR, asset.file)
	try {
		runTar(tarball, binDir)
	} catch (err) {
		// A first failure is often transient when the runner's antivirus or
		// indexer locks the freshly written binary; clear the partial tree
		// and retry once before giving up.
		console.warn(`[ffprobe-bin] unpack failed, retrying once (${err.message})`)
		rmSync(binDir, { recursive: true, force: true })
		mkdirSync(binDir, { recursive: true })
		runTar(tarball, binDir)
	}
	if (platform !== "win32") chmodSync(binPath, 0o755)
}

/**
 * Smoke-run the installed binary and require the expected ffprobe version:
 * a wrong artifact (e.g. a stale/default build) fails here instead of at
 * runtime. `ffprobe -version` prints "ffprobe version <ver>-..." across all
 * the upstream builders (GyanD / evermeet / osxexperts / johnvansickle).
 */
function smokeTest() {
	const res = spawnSync(binPath, ["-version"], {
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 30_000,
	})
	if (res.status !== 0) {
		throw new Error(`${binPath} failed its smoke run (exit ${res.status})`)
	}
	const expected = String(manifest?.ffprobe ?? "")
	if (expected && !String(res.stdout).includes(expected)) {
		throw new Error(
			`${binPath} does not report ffprobe ${expected} (expected in 'ffprobe -version')`,
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
		const tarball = join(TMP_DIR, asset.file)
		await downloadWithRetry(`${ENV_BASE || RELEASE_BASE}/${asset.file}`, tarball)
		verifyHash(tarball, asset.sha256)
		unpack()
		if (!verifyExisting()) {
			throw new Error(`${binPath} missing after unpack`)
		}
		smokeTest()
		console.info(`[ffprobe-bin] ${BINARY[platform]} installed at ${binPath}`)
	} catch (err) {
		fail(`failed to install ffprobe ${manifest?.ffprobe ?? "?"}`, err)
	} finally {
		rmSync(TMP_DIR, { recursive: true, force: true })
	}
}

main()
