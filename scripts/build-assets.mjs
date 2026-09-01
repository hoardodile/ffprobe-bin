#!/usr/bin/env node
// Build the per-platform ffprobe binary packages for the GitHub release,
// then create/update the release with `gh`.
//
//   node scripts/build-assets.mjs            # build + upload
//   node scripts/build-assets.mjs --skip-upload   # build locally only
//
// Steps: download the upstream static ffprobe builds (GyanD/codexffmpeg
// Windows, evermeet.cx + osxexperts.net macOS, johnvansickle.com Linux
// — the same sources ffprobe-static uses), extract ffprobe, tar.gz each
// platform into dist/, write assets.json (the SHA-256 source of truth
// consumed by install.js) and SHA256SUMS.txt, then upload everything to
// the release tagged v<package.json version>.
//
// Idempotent: rerunning reuses cached upstream downloads, skips release
// assets that already exist and leaves existing releases untouched.
// Pass --skip-upload to build locally without touching GitHub.
//
// The upstream "release"-tracking URLs (johnvansickle, evermeet,
// osxexperts) are mutable — they move to whatever the builder currently
// ships. Their SHA-256 is therefore recorded on first download in
// .assets-cache/OFFICIAL_SHASUMS.json and re-verified on every rerun: a
// changed hash aborts so a release never silently mixes versions. The
// consumer-facing authenticity pin is always `assets.json`, which holds
// the SHA-256 of OUR repacked artifact.
//
// Bump flow for a new ffprobe: update VERSION (and the per-platform
// filenames if the upstream naming changed), bump package.json version,
// run this script, commit assets.json, then `npm publish`.

import { createHash } from "node:crypto"
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { create as tarCreate } from "tar"

const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const CACHE_DIR = join(ROOT, ".assets-cache")
const WORK_DIR = join(CACHE_DIR, "work")
const DIST_DIR = join(ROOT, "dist")

// --- ffprobe release to mirror (edit when bumping) ---
const VERSION = "9.0.1"
const EXT = process.platform === "win32" ? ".exe" : ""
const BINARY = `ffprobe${EXT}` // only this binary is extracted per repo

// Upstream download bases. Filenames are derived below so the only field
// you normally touch on a bump is VERSION.
const GYAN_BASE = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}`
const EVERMEET_BASE = "https://evermeet.cx/ffmpeg/"
const OSXEXPERT_BASE = "https://www.osxexperts.net/"
const JVS_BASE = "https://johnvansickle.com/ffmpeg/releases/"

const ARM_MAJOR = VERSION.split(".")[0] // osxexperts filenames embed the major only: ffprobe9arm.zip

const PLATFORMS = {
	"win32-x64": {
		official: [`${GYAN_BASE}/ffmpeg-${VERSION}-essentials_build.7z`],
		kind: "7z",
	},
	"darwin-x64": {
		official: [`${EVERMEET_BASE}ffprobe-${VERSION}.zip`],
		kind: "zip",
	},
	"darwin-arm64": {
		official: [`${OSXEXPERT_BASE}ffprobe${ARM_MAJOR}arm.zip`],
		kind: "zip",
	},
	"linux-x64": {
		official: [`${JVS_BASE}ffmpeg-release-amd64-static.tar.xz`],
		kind: "tar.xz",
	},
	"linux-ia32": {
		official: [`${JVS_BASE}ffmpeg-release-i686-static.tar.xz`],
		kind: "tar.xz",
	},
	"linux-arm64": {
		official: [`${JVS_BASE}ffmpeg-release-arm64-static.tar.xz`],
		kind: "tar.xz",
	},
	"linux-arm": {
		official: [`${JVS_BASE}ffmpeg-release-armhf-static.tar.xz`],
		kind: "tar.xz",
	},
}

// --- helpers ---

function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function fail(msg, err) {
	console.error(`[ffprobe-bin] ${msg}${err ? `: ${err.message}` : ""}`)
	process.exit(1)
}

function download(url, dest) {
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
	if (res.status !== 0) throw new Error(`curl ${url} exited ${res.status}`)
}

function downloadWithRetry(url, dest, attempts = 3) {
	try {
		download(url, dest)
	} catch (err) {
		rmSync(dest, { force: true })
		if (attempts <= 1) throw err
		console.info(`[ffprobe-bin] download failed (${err.message}), retrying ...`)
		return new Promise((res) => setTimeout(res, 1_000)).then(() =>
			downloadWithRetry(url, dest, attempts - 1),
		)
	}
}

function run(cmd, args, { cwd } = {}) {
	const res = spawnSync(cmd, args, {
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 300_000,
		...(cwd ? { cwd } : {}),
	})
	if (res.error) throw res.error
	if (res.status !== 0) {
		throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}: ${String(res.stderr).trim()}`)
	}
	return String(res.stdout)
}

/**
 * The tar that reads the upstream `.tar.xz` (linux) and `.zip` (macOS)
 * artifacts. node-tar cannot decode xz, so the pinned Windows system tar
 * (bsdtar, Windows 10+) is used when packing runs on a win32 host — the
 * bare `tar` name is ambiguous there (Git for Windows ships GNU tar in
 * PATH, which misparses drive-letter paths as remote hosts); every other
 * platform keeps PATH resolution.
 */
function tarCommand() {
	if (process.platform === "win32" && process.env.SystemRoot) {
		return join(process.env.SystemRoot, "System32", "tar.exe")
	}
	return "tar"
}

function extract(archive, destDir) {
	const kind = archive.endsWith(".tar.xz") ? "-xJf" : "-xf"
	run(tarCommand(), [kind, archive, "-C", destDir])
}

function gh(args) {
	const res = spawnSync("gh", args, {
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 300_000,
	})
	if (res.status !== 0) {
		throw new Error(`gh ${args.join(" ")} exited ${res.status}: ${String(res.stderr).trim()}`)
	}
	return String(res.stdout)
}

function findFile(dir, name) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) {
			const hit = findFile(p, name)
			if (hit) return hit
		} else if (entry.name === name) {
			return p
		}
	}
	return null
}

// --- upstream sha cache (records + detects drift on mutable URLs) ---

function loadOfficialShas() {
	try {
		return JSON.parse(readFileSync(join(CACHE_DIR, "OFFICIAL_SHASUMS.json"), "utf8"))
	} catch {
		return {}
	}
}

function saveOfficialShas(record) {
	writeFileSync(
		join(CACHE_DIR, "OFFICIAL_SHASUMS.json"),
		JSON.stringify(record, null, "\t") + "\n",
	)
}

async function fetchOfficial(name, url, record) {
	const dest = join(CACHE_DIR, name)
	if (existsSync(dest)) {
		const got = sha256(dest)
		const known = record[name]
		if (known !== undefined && known !== got) {
			throw new Error(
				`cached ${name} sha256 ${got} != recorded ${known} (upstream drifted); ` +
					"re-run or bump VERSION",
			)
		}
		if (known === undefined) {
			record[name] = got
			saveOfficialShas(record)
		}
		console.info(`[ffprobe-bin] using cached ${name}`)
		return dest
	}
	console.info(`[ffprobe-bin] downloading ${url} ...`)
	await downloadWithRetry(url, dest)
	const got = sha256(dest)
	const known = record[name]
	if (known !== undefined && known !== got) {
		rmSync(dest, { force: true })
		throw new Error(`sha256 mismatch for ${name} (recorded ${known}, got ${got})`)
	}
	if (known === undefined) {
		record[name] = got
		saveOfficialShas(record)
	}
	return dest
}

// --- platform builds ---

async function buildPlatform(key, spec, record) {
	const stage = join(WORK_DIR, `stage-${key}`)
	mkdirSync(stage, { recursive: true })

	const official = spec.official[0]
	const name = basename(new URL(official).pathname)
	const artifact = await fetchOfficial(name, official, record)

	if (spec.kind === "7z") {
		// GyanD .7z holds ffprobe.exe at the archive root. Use the
		// cross-platform 7z from @hoardodile/7z-bin (dev dependency) so the
		// build doesn't depend on a system 7z.
		let seven
		try {
			seven = require("@hoardodile/7z-bin")
		} catch (err) {
			throw new Error("extract the GyanD .7z needs @hoardodile/7z-bin (npm install)")
		}
		if (!seven) throw new Error("@hoardodile/7z-bin resolved to null on this host")
		run(seven, ["x", artifact, `-o${stage}`, "-y", "-bd"])
	} else {
		extract(artifact, stage)
	}

	const file = findFile(stage, BINARY)
	if (!file) throw new Error(`${BINARY} not found in ${name}`)
	const out = join(stage, BINARY)
	if (file !== out) copyFileSync(file, out)
	chmodSync(out, 0o755)
	return stage
}

/** Smoke-run a win32 binary on the win32 build host (like 7z-bin). */
function smokeWin32(stage) {
	const bin = join(stage, BINARY)
	const res = spawnSync(bin, ["-version"], {
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 30_000,
	})
	if (res.status !== 0) throw new Error(`${bin} failed its smoke run (exit ${res.status})`)
	if (!String(res.stdout).includes(VERSION)) {
		throw new Error(`${bin} does not report ffprobe ${VERSION} (expected in 'ffprobe -version')`)
	}
}

function pack(key, stage) {
	const out = join(DIST_DIR, `${key}.tar.gz`)
	// node-tar produces the archive (no system tar anywhere in packing);
	// fixed mtime + a portable gzip header make the output reproducible
	// across machines, so assets.json stays the single source of truth.
	tarCreate(
		{
			file: out,
			cwd: stage,
			gzip: { portable: true },
			mtime: new Date(0),
			sync: true,
		},
		["."],
	)
	return out
}

// --- release ---

function publishRelease(tag) {
	let existing = []
	const view = spawnSync(
		"gh",
		["release", "view", tag, "--json", "assets", "-q", ".assets[].name"],
		{ stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
	)
	if (view.status === 0) {
		existing = String(view.stdout).trim().split("\n").filter(Boolean)
		console.info(`[ffprobe-bin] release ${tag} exists (${existing.length} assets)`)
	} else {
		const notes = [
			`ffprobe ${VERSION} static binaries for @hoardodile/ffprobe-bin@${tag.slice(1)}.`,
			"",
			"Assets:",
			...Object.keys(PLATFORMS).map((k) => `- ${k}: ${k}.tar.gz`),
			"",
			"Verify with SHA256SUMS.txt.",
		].join("\n")
		gh([
			"release",
			"create",
			tag,
			"--title",
			`@hoardodile/ffprobe-bin ${tag} - ffprobe ${VERSION} binaries`,
			"--notes",
			notes,
		])
		console.info(`[ffprobe-bin] created release ${tag}`)
	}
	const files = readdirSync(DIST_DIR)
		.filter((f) => f.endsWith(".tar.gz"))
		.map((f) => join(DIST_DIR, f))
	files.push(join(DIST_DIR, "SHA256SUMS.txt"))
	for (const file of files) {
		const name = basename(file)
		if (existing.includes(name)) {
			console.info(`[ffprobe-bin] asset ${name} already present, skipping`)
			continue
		}
		gh(["release", "upload", tag, file])
		console.info(`[ffprobe-bin] uploaded ${name}`)
	}
}

// --- main ---

async function main() {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
	const tag = `v${pkg.version}`

	mkdirSync(CACHE_DIR, { recursive: true })
	rmSync(WORK_DIR, { recursive: true, force: true })
	mkdirSync(WORK_DIR, { recursive: true })
	mkdirSync(DIST_DIR, { recursive: true })

	const record = loadOfficialShas()
	const assets = {}
	for (const [key, spec] of Object.entries(PLATFORMS)) {
		const stage = await buildPlatform(key, spec, record)
		if (key === "win32-x64") smokeWin32(stage)
		const out = pack(key, stage)
		assets[key] = { file: `${key}.tar.gz`, sha256: sha256(out) }
		console.info(`[ffprobe-bin] built ${key}.tar.gz`)
	}

	writeFileSync(
		join(ROOT, "assets.json"),
		JSON.stringify({ ffprobe: VERSION, assets }, null, "\t") + "\n",
	)

	const sums =
		readdirSync(DIST_DIR)
			.filter((f) => f.endsWith(".tar.gz"))
			.map((f) => `${sha256(join(DIST_DIR, f))}  ${f}`)
			.join("\n") + "\n"
	writeFileSync(join(DIST_DIR, "SHA256SUMS.txt"), sums)

	if (process.argv.includes("--skip-upload")) {
		console.info(
			`[ffprobe-bin] done (--skip-upload): ${Object.keys(assets).length} platform packages in dist/, assets.json written`,
		)
		return
	}
	publishRelease(tag)
	console.info(`[ffprobe-bin] done: release ${tag} ready for npm publish`)
}

main().catch((err) => fail("build failed", err))
