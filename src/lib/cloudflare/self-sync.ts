import { self_sync_guard } from '@joshuafolkken/kit/self-sync-guard'

function did_refuse_self_sync(package_root: string, project_root: string): boolean {
	const refusal = self_sync_guard.self_sync_refusal(package_root, project_root)
	if (refusal === undefined) return false

	process.stderr.write(`\n${refusal}\n`)
	process.exitCode = 1

	return true
}

const app_self_sync = { did_refuse_self_sync }

export { app_self_sync }
