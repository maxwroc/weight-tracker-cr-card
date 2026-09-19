# Weight Tracker Card (Custom Records)

[![hacs][hacs-badge]][hacs-url]

A Home Assistant Lovelace card that visualises your **weight progress toward a
target**. It renders a progress **gauge**, a **stats** block (starting / current /
goal), and a **line graph** with selectable time periods and a dashed target
line — all in a single card — plus a button to add new measurements.

It is powered by the [**Custom Records**][custom-records] integration.

> ⚠️ **Requires the Custom Records integration.** This card reads and writes
> data through the Custom Records WebSocket API. Support for regular Home
> Assistant entities + recorder history is planned (see [Roadmap](#roadmap)).

This card is for fresh Custom Records installations. Only the `custom_records`
backend and `custom:weight-tracker-cr-card` card type are supported; legacy
integration and card identifiers are not supported.

<img width="506" height="706" alt="image" src="https://github.com/user-attachments/assets/4da65772-bd3a-4d81-868a-47fabf4cd0bf" />

---

## Features

- 🎯 **Progress gauge** — a themeable SVG arc showing how far you are from your
  goal (the big number is the remaining distance to target).
- 📊 **Stats** — starting weight, current weight and goal.
- 📈 **Line graph** — progress over time with a dashed **target line**.
- ⏱️ **Period buttons** — `7D` / `1M` / `6M` / `1Y` with smart bucketing (raw
  points for a week, daily for a month, weekly for longer ranges) so the graph
  stays readable and updates automatically.
- ➕ **Add record** — a popup form to log a new measurement.
- 🎨 **Theme aware** — uses your dashboard theme colours, with optional
  per-element overrides.
- 🧩 **Visual editor** — configure the common options without editing YAML.
- 🪶 **No heavy dependencies** — gauge and chart are hand-rolled SVG (~40 KB
  minified bundle, no charting library).

## Installation

### HACS (recommended)

1. Make sure the [Custom Records][custom-records] integration is installed and
   you have a numeric record type (e.g. `weight`).
2. In HACS → **Frontend**, add this repository as a **custom repository** of
   category **Lovelace**, then install **Weight Tracker (Custom Records)**.
3. Reload your browser (a hard refresh may be needed the first time).

### Manual

1. Download `weight-tracker-cr-card.js` from the latest [release][releases].
2. Copy it into your Home Assistant `config/www/` folder.
3. Add it as a dashboard resource: **Settings → Dashboards → ⋮ → Resources →
   Add resource**, URL `/local/weight-tracker-cr-card.js`, type **JavaScript
   Module**.

## Usage

Minimal configuration:

```yaml
type: custom:weight-tracker-cr-card
title: Weight Tracker
record_type: body_weight
target: 86
```

A more complete example:

```yaml
type: custom:weight-tracker-cr-card
title: Max's Weight
record_type: body_weight
value_field: weight        # numeric field to plot (defaults to the first number field)
target: 86
start_weight: 104.6        # optional; otherwise the earliest record is used
unit: kg
default_period: 1m         # 7d | 1m | 6m | 1y
filter:                    # Custom Records server-side filter
  - name: Max
show_gauge: true
show_stats: true
show_graph: true
show_add_record: true
colors:                    # all optional; omit to use theme colours
  gauge_progress: "#ff6b6b"
  line: "var(--primary-color)"
  target_line: "#ff6b6b"
```

### Configuration options

| Option            | Type      | Default                     | Description |
| ----------------- | --------- | --------------------------- | ----------- |
| `record_type`     | string    | **required**                | Custom Records record type key (e.g. `body_weight`). |
| `title`           | string    | *(none)*                    | Card header text. |
| `data_source`     | string    | `custom_records`            | Backend. Only `custom_records` is supported today. |
| `value_field`     | string    | first `number` field        | Numeric field key to plot (e.g. `weight`). |
| `target`          | number    | *(none)*                    | Goal weight (gauge + target line). |
| `start_weight`    | number    | earliest known record       | Starting weight used by the gauge. |
| `unit`            | string    | `kg`                        | Display unit. |
| `default_period`  | string    | `1m`                        | Initial graph period: `7d`, `1m`, `6m`, `1y`. Only affects the graph - the gauge/stats always reflect current progress regardless of the selected period. |
| `filter`          | list      | *(none)*                    | Custom Records filter conditions (see below). |
| `show_gauge`      | boolean   | `true`                      | Show the progress gauge. |
| `show_stats`      | boolean   | `true`                      | Show the stats block. |
| `show_graph`      | boolean   | `true`                      | Show the line graph. |
| `show_add_record` | boolean   | `true`                      | Show the "add record" button. |
| `colors`          | object    | *(theme)*                   | Colour overrides (see below). |

#### `filter`

Scope the card to a subset of records. Each entry is a single `field: value`
condition; **all** must match. Values may start with an operator (`==`, `!=`,
`>`, `>=`, `<`, `<=`); a plain value means "equals".

```yaml
filter:
  - name: Max
  - weight: "> 80"
```

Filtering happens server-side, and the same filter values pre-fill the
add-record form.

#### `colors`

| Key              | Falls back to               |
| ---------------- | --------------------------- |
| `gauge_progress` | `--primary-color`           |
| `gauge_track`    | `--divider-color`           |
| `line`           | `--primary-color`           |
| `point`          | the line colour             |
| `target_line`    | `--error-color`             |

Values can be any CSS colour or a `var(--...)` reference.

## How the gauge works

Progress is `(start − current) / (start − target)`, clamped to 0–100 %. The big
number in the middle is the **remaining** distance to your goal
(`current − target`). The starting weight is your configured `start_weight`, or —
if not set — your earliest known record. The gauge and stats block always
reflect your overall current progress; the `7d`/`1m`/`6m`/`1y` period selector
only changes what the graph shows.

## Development

No Docker / devcontainer required — just Node.

```bash
npm ci            # install (node_modules ~300 MB)
npm run build     # produce dist/weight-tracker-cr-card.js
npm run watch     # rebuild on change + serve on http://localhost:5000
npm test          # run the unit tests
npm run lint      # eslint
npm run type-check
```

### Testing against your Home Assistant

- **Served build:** run `npm run watch`, then add a dashboard **Resource**
  pointing at `http://<dev-machine>:5000/weight-tracker-cr-card.js` (module).
  Requires your HA host to be able to reach this machine.
- **Copied build:** run `npm run build` and copy `dist/weight-tracker-cr-card.js`
  into HA `config/www/`, then add `/local/weight-tracker-cr-card.js` as a module
  resource.

### Standalone demo (no Home Assistant)

`demo/index.html` mounts the card against a mocked `hass` with synthetic weight
data, so you can preview the gauge, stats, chart, period buttons and add dialog
without an HA instance. After `npm run build`, serve the repo root and open it:

```bash
npx http-server . -p 8123 -c-1
# then open http://localhost:8123/demo/index.html
```

## Roadmap

- Support for regular Home Assistant entities + recorder history as an
  alternative data source (the internal `DataSource` abstraction is already in
  place).
- Optional secondary metrics (body fat, BMI, …).

## License

MIT — see [LICENSE](LICENSE).

[custom-records]: https://github.com/maxwroc/custom_records
[releases]: https://github.com/maxwroc/weight-tracker-cr-card/releases
[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
