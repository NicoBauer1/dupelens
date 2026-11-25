# Development of DupeLens

DupeLens is maintained by its author only. It does not accept issues, pull
requests or other contributions.

This document describes the author's own workflow, so that the history and
the release process stay easy to follow.

## Principles

1. **Photos are analysed in the browser.** The app has no server part and is
   not meant to make network requests; the Content-Security-Policy
   (`connect-src 'none'`) stays.
2. **Zero dependencies.** No npm packages at runtime *or* for development, no
   CDNs, web fonts or icon packs. See
   [ADR 0001](docs/adr/0001-zero-dependencies.md).
3. **The app does not write to user files.** It reads files and offers
   downloads. Generated scripts move files into a review folder, dry-run first.
4. **Original work.** Algorithms are implemented from their mathematical
   description; code from other projects is not copied.

## Setup

[Node.js](https://nodejs.org/) 22 or newer (24 is used for the checks). There
is nothing to install.

```sh
npm test           # unit tests (node:test)
```

Further scripts are described in the [README](README.md#development-and-testing).

## Branches

Work happens on short-lived branches cut from `develop`:

| Prefix       | Use for                                   |
| ------------ | ----------------------------------------- |
| `feature/`   | new functionality                         |
| `fix/`       | bug fixes                                 |
| `docs/`      | documentation only                        |
| `chore/`     | tooling, repository maintenance           |
| `refactor/`  | code changes without behaviour change     |
| `test/`      | tests only                                |
| `hotfix/`    | urgent fixes, cut from `main`             |

`develop` is the integration branch, `staging` holds release candidates and
`main` only contains released code. Details: [docs/BRANCHING.md](docs/BRANCHING.md).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary in the imperative>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`,
`build`. Examples:

```
feat(engine): add DCT hash
fix(scripts): quote paths that start with a dash
docs: explain the similarity scale
```

## Pull request checklist

- [ ] The branch is up to date with `develop`.
- [ ] `npm test` passes; new behaviour has tests.
- [ ] `npm run build` succeeds and `dist/dupelens.html` opens from disk.
- [ ] No dependency, CDN or network request was added.
- [ ] User-facing changes are listed under `[Unreleased]` in
      [CHANGELOG.md](CHANGELOG.md).
- [ ] Docs are updated (README, `docs/`).
- [ ] The pull request description lists the checks that were run.

Every pull request is verified locally with `npm test` and `npm run build`.

Pull requests are merged with a merge commit (no squash, no rebase) so that the
history shows how a feature came together. Only the maintainer opens pull
requests, pushes or merges (see [docs/BRANCHING.md](docs/BRANCHING.md)).

## Coding style

- Modern JavaScript (ES modules), no transpilation. Type hints in JSDoc
  comments.
- Two-space indentation, single quotes, semicolons, LF line endings
  (see `.editorconfig`).
- Small, pure modules; the analysis engine in `src/engine/` does not touch the
  DOM so that it runs in Node and in Web Workers.
- The single-file build is produced by a small in-house bundler. Its rules
  (named imports and exports only, unique top-level names) are documented in
  [docs/architecture.md](docs/architecture.md).

## Releases

See [docs/RELEASING.md](docs/RELEASING.md).
