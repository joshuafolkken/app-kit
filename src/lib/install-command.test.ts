import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const BINDING_GYP = 'binding.gyp'
const INSTALL_DOCS = ['README.md', 'docs/setup/install.md']
// pnpm runs these lifecycle scripts on install, and a `binding.gyp` gets an implicit
// `node-gyp rebuild`; under pnpm 12 every one of them fails `pnpm add` unless approved.
const BUILD_SCRIPTS = ['preinstall', 'install', 'postinstall']
const INSTALL_COMMAND_PATTERN = /^pnpm add -D (?<flags>.*)@joshuafolkken\/app-kit\b/gmu
const ALLOW_BUILD_PATTERN = /--allow-build=(?<name>\S+)/gu

interface Manifest {
	name: string
	scripts?: Record<string, string>
	dependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

function read_manifest(directory: string): Manifest {
	return JSON.parse(readFileSync(path.join(directory, MANIFEST), ENCODING)) as Manifest
}

// pnpm auto-installs peers, optional ones included (#270: kit's optional
// eslint-import-resolver-typescript peer is what brings unrs-resolver in), so they are walked too.
function dependency_names(manifest: Manifest): Array<string> {
	return [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]
}

function resolve_package(name: string, from: string): string | undefined {
	const candidate = path.join(from, NODE_MODULES, name)
	if (existsSync(path.join(candidate, MANIFEST))) return realpathSync(candidate)
	const parent = path.dirname(from)

	return parent === from ? undefined : resolve_package(name, parent)
}

function resolve_dependencies(directory: string, manifest: Manifest): Array<string> {
	return dependency_names(manifest).flatMap((name) => resolve_package(name, directory) ?? [])
}

// Every installed package reachable from the root's dependencies, keyed by its real directory;
// the root itself is not part of it.
function collect_closure(root: string): Map<string, Manifest> {
	const seen = new Map<string, Manifest>()
	const pending = resolve_dependencies(root, read_manifest(root))

	for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
		if (seen.has(directory)) continue
		const manifest = read_manifest(directory)

		seen.set(directory, manifest)
		pending.push(...resolve_dependencies(directory, manifest))
	}

	return seen
}

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function has_build_step(directory: string, manifest: Manifest): boolean {
	const has_script = BUILD_SCRIPTS.some((script) => manifest.scripts?.[script] !== undefined)

	return has_script || existsSync(path.join(directory, BINDING_GYP))
}

// The closure a consumer's `pnpm add -D @joshuafolkken/app-kit` installs: app-kit's own
// dependencies and peers, walked through the installed tree. devDependencies stay out.
function packages_needing_build(): Array<string> {
	const names = [...collect_closure(process.cwd())]
		.filter(([directory, manifest]) => has_build_step(directory, manifest))
		.map(([, manifest]) => manifest.name)

	return [...new Set(names)].toSorted(by_name)
}

function install_commands(document: string): Array<string> {
	const content = readFileSync(document, ENCODING)

	return [...content.matchAll(INSTALL_COMMAND_PATTERN)].map(
		(match) => match.groups?.['flags'] ?? '',
	)
}

function allowed_builds(flags: string): Array<string> {
	const names = [...flags.matchAll(ALLOW_BUILD_PATTERN)].map(
		(match) => match.groups?.['name'] ?? '',
	)

	return names.toSorted(by_name)
}

describe('documented install command', () => {
	it('finds a build-script package in the install closure', () => {
		expect(packages_needing_build()).toContain('unrs-resolver')
	})

	it.each(INSTALL_DOCS)('%s approves exactly the builds the install closure runs', (document) => {
		const expected = packages_needing_build()
		const commands = install_commands(document)

		expect(commands).not.toHaveLength(0)

		for (const flags of commands) {
			expect(allowed_builds(flags)).toStrictEqual(expected)
		}
	})
})
