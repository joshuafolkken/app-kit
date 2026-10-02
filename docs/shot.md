# UI verification screenshots (`josh-app shot`)

The completion gate asks you to _look_ at a UI change before calling it done — but a SvelteKit project had no mechanism behind that rule, so in practice a green test run stood in for a look at the page. `josh-app shot` is that mechanism: give it the routes you changed and it builds the app once, boots the preview once, drives a real browser over every route, and tears the server down.

```bash
pnpm josh-app shot /                    # one route
pnpm josh-app shot / /blog /blog/hello  # several, against one build and one server
pnpm josh-app shot / --mobile           # 390x844 instead of the default 1280x800
```

## Where the images go

The PNGs land in a fixed, already-gitignored directory — `test-results/screenshots/` — named after the route (`/` → `root.png`, `/blog/hello` → `blog-hello.png`, and a `-mobile` suffix for the mobile viewport), so you know a route's file name before the run starts. Each run deletes exactly the files it is about to write and nothing else: a route that fails leaves no stale image behind, while a desktop run and a mobile run of the same route happily coexist. Playwright's own `outputDir` is the same `test-results/`, which it clears when a suite starts — these images are throwaway verification artifacts, so sharing the directory is deliberate.

## When it fails

A route that answers 4xx or 5xx **fails the command** and writes no image, and so does a preview that never comes up: a screenshot run that quietly photographed the 404 page and exited 0 would reintroduce exactly the silent pass this command exists to remove. Two different routes that flatten to the same file name (`/blog/post` and `/blog-post`) are refused for the same reason — one image reported as two captures is a silent overwrite. Playwright is resolved from your project (not from the global CLI), so a project without it is told to install it rather than dying on a stack trace.
