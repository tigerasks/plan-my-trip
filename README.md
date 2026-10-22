# plan-my-trip

A day planner for trips. It runs at **<https://tigerasks.github.io/plan-my-trip/>** — plain HTML,
CSS and JavaScript served by GitHub Pages, with no backend and no build step.

A trip has a backlog of ideas and a set of days. Each day has three plan versions, a timeline with
real times, and travel times from open routing services, with the planner's own estimates behind
them. Everything is saved in your browser; nothing is sent anywhere except the map and routing
services the page credits.

## Setting up a fresh clone

You need **Python 3.11 or newer** and **Node 20 or newer**. Nothing is installed system-wide: the
Python packages go into a virtual environment inside the clone, which git ignores.

```sh
git clone git@github.com:tigerasks/plan-my-trip.git
cd plan-my-trip

python3 -m venv .venv                              # a sandbox for this project alone
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium              # the browser the tests drive
```

That is everything the app and its tests need.

**Using pyenv?** `.python-version` pins the interpreter to 3.13.0, so `pyenv install` picks the
right one and `python3 -m venv` then uses it. Any Python from 3.11 works if you would rather not.

**Activating is optional.** `.venv/bin/python` is already the right interpreter, which is why every
command below spells it out — it cannot be wrong about which environment it is in. If you prefer a
shorter prompt, `source .venv/bin/activate` puts it on your `PATH` until you type `deactivate`.

## Running it

The app is static files, so anything that serves a folder will do:

```sh
.venv/bin/python -m http.server -d docs 8000       # then open http://localhost:8000
```

Opening `docs/index.html` straight off disk mostly works, but browser storage behaves differently
over `file://`, so the server is the honest test.

## Running the tests

```sh
.venv/bin/python tests/app_test.py             # the planner, in a real browser
node tests/core_test.js                        # the model, in Node
.venv/bin/python tests/probe_test.py           # the service test page
.venv/bin/python tests/probe_transit_test.py   # the public transport probe
```

They make no network calls: every outside service is mocked. Each prints a `PASS`/`FAIL` line per
check and exits non-zero if anything fails or the page logs a console error. Run them before every
commit. See [`tests/README.md`](tests/README.md) for what else is in there.

## Refreshing the stop snapshot

Only needed when the published stop data is stale, which is about once a year. It wants two more
things, one of which cannot live in the virtual environment:

```sh
brew install osmium-tool                             # a compiled binary, so not a Python package
.venv/bin/pip install -r tools/requirements.txt
```

See [`tools/README.md`](tools/README.md) for what it does and how long it takes.

## Where things live

| Folder | What it is | Published |
|---|---|---|
| `docs/` | the app itself, and the two service test pages | yes |
| `documentation/` | the design doc, which is the source of truth for decisions | no |
| `tests/` | Playwright and Node tests, mocks, a small real slice of the stop snapshot | no |
| `tools/` | scripts run by hand, such as the stop snapshot refresh | no |
| `reference/v1/` | the previous version's code, kept for reuse | no |

GitHub Pages serves `docs/` and nothing else, so everything outside it stays private to the
repository.

Two files are worth reading before changing anything:
[`CLAUDE.md`](CLAUDE.md) for how the project is run, and
[`documentation/day-planner-v2-design.md`](documentation/day-planner-v2-design.md) for what it does
and why. Where they disagree, the design doc wins.

## Licence

[AGPL-3.0-or-later](LICENSE). The stop snapshot it reads is a separate database, derived from
OpenStreetMap and published under the
[ODbL](https://opendatacommons.org/licenses/odbl/) at
[plan-my-trip-data-stops](https://github.com/tigerasks/plan-my-trip-data-stops).
