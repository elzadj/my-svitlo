# my-svitlo

Power outage schedule for Kyiv region, Ukraine. Fetches live data every 5 minutes and displays it as:

- A detailed hourly timeline for Group 3.2
- A full all-groups overview table

**Live site:** https://elzadj.github.io/my-svitlo/

## Features

- Actual (fact) and predicted (preset) schedule tabs
- Today / Tomorrow switcher (tomorrow shown only when data is available)
- Ukrainian / English UI, persisted in localStorage
- Light / dark theme, persisted in localStorage
- Auto-refresh every 5 minutes with countdown timer
- Responsive — works on desktop, tablet, and mobile

## Data source

[outage-data-ua](https://github.com/Baskerville42/outage-data-ua) by Baskerville42

## Local development

Needs an HTTP server (browsers block `fetch()` over `file://`):

```bash
python3 -m http.server
# open http://localhost:8000
```

No build step, no dependencies, no bundler — plain HTML/CSS/JS.
