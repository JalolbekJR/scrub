# Release procedure

Publication and deployment require repository-owner approval. CI does not deploy. The existing website can run an older version; do not describe it as updated before post-deployment checks pass.

## Before publication

1. Review the candidate tree, reachable history, notices and documentation. Run the commands in TESTING.md, including `node scripts/check-release.mjs` after building. Confirm the intended files, downloads and security headers.
2. Check the existing GitHub/Cloudflare connection with the owner. Before publishing a candidate branch, confirm that it cannot trigger production or preview deployments unexpectedly.
3. With explicit approval, push only the reviewed release branch and open a pull request to main. Never publish unrelated local branches or use `git push --all`.
4. Require successful `CI / quality` and all three `CI / browsers` matrix checks, plus the existing CodeQL check if available. Configure protection for main: PR review, required checks, no direct pushes or force pushes. Confirm the displayed check names after the first authorized PR run. These remote settings are owner actions, not established by this file.
5. Review the diff and approve merge. Preserve the last known-good Cloudflare deployment/version identifier before changing production.

## Proposed Cloudflare Git integration

Use the existing assets-only Worker named `scrub`, not a new Pages project. Its configuration publishes only `dist/`. There is no runtime API token or user-data backend.

After separate approval, confirm or connect the intended GitHub repository to that Worker. Set the production branch to main, repository root to `/`, Node to the tested 24 LTS version, and the build command to:

```sh
npm ci --ignore-scripts && npm run typecheck && npm run lint && npm test && npm run build && node scripts/check-release.mjs
```

Use the separately approved, pinned deploy command:

```sh
npx wrangler@4.149.0 deploy
```

This version was read from the registry during release preparation; Wrangler deployment itself has not been run. Recheck its compatibility before authorization. Disable automatic non-production branch builds/previews unless explicitly desired. Configure deployment permissions in Cloudflare/GitHub rather than committing tokens. Retain the existing free-tier plan; do not provision additional services or alter billing.

Workers Builds separates build and deploy commands. It does not replace PR checks or approval. Integration state, branch protection, deployed headers and account permissions must be verified by the owner. Official references: [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## After an approved deployment

Check the deployment's source revision and the existing public URL. Verify the original landing/ticker/scanner/themes/footer/support dialog, same-origin model/font requests, CSP and other headers, narrow layout, a JPEG export, single/multipage PDFs and a mixed ZIP. Use synthetic content. Inspect output bytes, page counts, opaque masks, failure/retry and stale-download blocking. Check a missing navigation route and vendor/hashed asset cache behavior. Mark the website updated only after these checks pass.

## Rollback

If deployment or post-deployment verification fails, stop promotion and use the existing Worker's deployment/version rollback control to restore the recorded known-good version. Verify its live behavior and headers. Revert the faulty main commit through an approved PR so automatic builds cannot redeploy it. Retain failure evidence locally. A successful build or deploy command alone does not establish a successful release.
