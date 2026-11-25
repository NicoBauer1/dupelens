# Security

## Security model

- DupeLens is a static page that runs in the browser. It reads the files the
  user selects and analyses them in the page.
- The page declares a Content-Security-Policy that sets `connect-src 'none'`
  and only allows the app's own scripts and styles, so that the browser blocks
  network connections from the page and the loading of remote content.
- DupeLens itself does not write to files. It offers downloads (JSON, CSV and
  move scripts).
- The generated move scripts embed every path as a literal string, so that
  names containing quotes, `$`, backticks, spaces or a leading `-` are treated
  as text, not as commands. The scripts contain no delete commands, skip a file
  whose target already exists and only move files when they are run with the
  apply flag.
- Only the maintainer has write access to the repository (see
  [docs/BRANCHING.md](docs/BRANCHING.md)).

## No support or reporting channel

DupeLens is maintained by its author only. There is no support channel and no
channel for reporting problems or vulnerabilities, and the repository does not
accept issues, pull requests or other contributions.

DupeLens is provided "as is", without warranty of any kind (see the
[MIT licence](LICENSE)). The descriptions in this repository explain how
DupeLens is meant to work; they are not a guarantee. Use it at your own risk,
review any generated script before running it and keep a backup of your
photos.
