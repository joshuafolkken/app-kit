// A prerequisite the user can fix — a missing Docker daemon for `dast`, a missing k6 binary or an
// unseeded scenario for `load` — not a defect in app-kit. The CLI reports it as a plain actionable
// message; its own type keeps that friendly presentation from also swallowing the stack trace of a
// genuine bug. Single-sourced here so `dast` and `load` raise the same shape rather than each
// declaring its own near-identical error class.
class EnvironmentError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'EnvironmentError'
	}
}

export { EnvironmentError }
