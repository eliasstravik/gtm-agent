# eliasstravik GTM Workspace Deploy — Generation 14 Upgrade

Date: 2026-09-09

## Push

Repo: `/Users/eliasstravik/.gtm/gtm-eliasstravik` (branch `main`).

- Pre-push state: working tree clean, HEAD `cd5f6fd chore(workflows): adopt workflow library generation 14`, ahead of `origin/main` by 1 commit.
- `git push origin main` result: `96492d0..cd5f6fd  main -> main` — succeeded.

## Deployment

Vercel project `gtm-eliasstravik-workflows` (team `stravik`).

- Deployment: `dpl_DX1o9i56bpsVyJUxSkqwo9EyfvHP` (`https://gtm-eliasstravik-workflows-kag2g4ugv-stravik.vercel.app`)
- Built from commit `cd5f6fd` on `main` (confirmed via build logs: `Cloning github.com/eliasstravik/gtm-eliasstravik (Branch: main, Commit: cd5f6fd)`)
- Build completed cleanly in ~7s, deployed, cache uploaded.
- Status: **Ready** (production), aliased to `gtm-eliasstravik-workflows.vercel.app`.

## Verification probes

| Probe | Expected | Actual |
|---|---|---|
| `GET /api/diagram/nothing` | 401 application/json | **500 application/json** |
| `GET /gtm/diagram/nothing` | 401 application/json | **500 application/json** |
| `GET /api/deployment` with `Authorization: Bearer x` | 401 JSON (bearer invalid) | 401 JSON — `{"error":{"code":"unauthorized","message":"A valid bearer is required."}}` ✅ |

The `/api/deployment` probe passed, confirming the new build is live and serving (no Vercel login wall) and that route's auth check works correctly.

## Concern: diagram routes crash at runtime

Both diagram routes return an unhandled 500 instead of the expected 401 (route exists, signature required). Runtime logs (`vercel logs <deployment-url>`) show:

```
ReferenceError: __filename is not defined in ES module scope
    at isFileSystemCaseSensitive (file:///var/task/_libs/typescript-parser.mjs:7533:34)
    at getNodeSystem (file:///var/task/_libs/typescript-parser.mjs:7346:40)
    ...
    at file:///var/task/_runtime.mjs:19:49
    at file:///var/task/_chunks/diagram-route.mjs:72:49
```

Root cause: `workflows/package.json` aliases the `typescript` npm package as `typescript-parser` (`"typescript-parser": "npm:typescript@5.9.3"`), which is imported by `workflows/lib/diagram.ts` / `workflows/lib/diagram-route.ts`. Nitro/rolldown bundles this CommonJS-style code into the ESM serverless function output for the Vercel build. TypeScript's compiler code references `__filename`, which doesn't exist in native ES module scope, so the import throws before the request handler (including the auth/signature check) ever runs. This is isolated to the diagram feature added in generation 14 — `/api/deployment` and presumably other non-diagram routes are unaffected.

**Fix needed** (not yet applied): mark `typescript` / `typescript-parser` as external in the Nitro/Vercel build config, or restructure `diagram.ts`/`diagram-route.ts` so the TypeScript parser isn't pulled into the request-time bundle (e.g. lazy dynamic import guarded appropriately, or move the parsing to build time). Diagram routes are not currently usable in production until this is fixed.

## Summary

- Push: ✅ succeeded.
- Deployment: ✅ Ready, correct commit, serving live (no auth wall on the platform level).
- `/api/deployment` bearer-auth probe: ✅ passed.
- `/api/diagram/*` and `/gtm/diagram/*` probes: ❌ failed — 500 due to an ESM bundling bug in the `typescript` dependency used by the new diagram feature, not a signature/auth issue.
