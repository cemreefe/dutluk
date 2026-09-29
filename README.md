# dutl.uk

Source for [dutl.uk](https://dutl.uk), the index of small tools I host under `*.dutl.uk`.

The page rebuilds itself every night, so it stays current without anyone editing it.

## How it works

`scripts/build.mjs` (Node 22, no dependencies):

1. Lists the public, non-fork repos of `cemreefe` on GitHub.
2. Reads each repo's `CNAME` file. Any repo that serves a `*.dutl.uk` domain is a project.
3. Merges in `projects.json`, which holds:
   - `overrides`: display names and blurbs, keyed by domain (falls back to the repo description)
   - `extra`: projects that don't come from a public repo with a `CNAME`
   - `pinned`, `hide`, `retired`: ordering and visibility
4. Checks that each live domain responds, and marks unreachable ones.
5. Fills `template.html` and writes the result to `_site/`.

`.github/workflows/build.yml` runs the build on every push to `main`, nightly, and on manual dispatch, then deploys `_site/` to GitHub Pages.

## Adding a project

- Hosted from a public repo via GitHub Pages: nothing to do. It appears after the next build. Optionally add a nicer name or blurb under `overrides`.
- Hosted elsewhere: add it to `extra`.

## Local build

```sh
GITHUB_TOKEN=$(gh auth token) node scripts/build.mjs
python3 -m http.server -d _site 8080
```

The token is optional. It only raises the GitHub API rate limit.
