# Branching model

```
feature/* ─┐
fix/*     ─┼─► develop ──► staging ──► main ──► tag vX.Y.Z
docs/*    ─┘      ▲                      │
                  └──── back-merge ◄─────┘
hotfix/*  ───────────────────────────► main (then back-merge into staging and develop)
```

| Branch    | Purpose                                       | Receives changes from       |
| --------- | --------------------------------------------- | --------------------------- |
| `develop` | Integration branch, default branch on GitHub  | work branches via PR        |
| `staging` | Release candidate, verified before a release  | `develop` via release PR    |
| `main`    | Released code only, every release is tagged   | `staging` or `hotfix/*`     |

## Rules

1. Changes are merged through pull requests, assigned to the maintainer, with a
   description that says how the change was tested.
2. Pull requests are merged with a **merge commit**. Squash and rebase merges
   are not used, so the individual commits stay visible.
3. Work branches are cut from `develop` and named `<type>/<topic>`, for example
   `feature/compare-view` or `fix/heic-message`.
4. `staging` and `main` are not committed to directly. A release is a PR from
   `develop` into `staging`, and after verification a PR from `staging` into
   `main`.
5. Hotfixes branch off `main`, are merged into `main` and then back-merged into
   `staging` and `develop`.
6. Shared branches keep their history: no force pushes and no amending of
   pushed commits.
7. Merged work branches may be deleted; `develop`, `staging` and `main` are
   permanent (release PRs use `develop` and `staging` as head branches).

## Who can change the branches

DupeLens has a single maintainer. Only the maintainer opens pull requests,
pushes or merges.
