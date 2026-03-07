'use strict';

/* ============================================================
   CONFIG
   ============================================================ */
const CONFIG = {
  DATA_URL: 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/refs/heads/main/data/kyiv-region.json',
  POLL_INTERVAL: 300,   // seconds
  FEATURED_GROUP: 'GPV3.2',
  GROUP_ORDER: [
    'GPV1.1','GPV1.2',
    'GPV2.1','GPV2.2',
    'GPV3.1','GPV3.2',
    'GPV4.1','GPV4.2',
    'GPV5.1','GPV5.2',
    'GPV6.1','GPV6.2',
  ],
  MONITOR_URL: 'https://raw.githubusercontent.com/elzadj/my-svitlo/refs/heads/main/monitor.json',
  MONITOR_POLL: 30,   // seconds — browser polls every 30 s (file is tiny, no rate limit)
  MONITOR_CHECKS: [
    { slug: 'svitlobot-hata',   uk: 'Квартира',          en: 'Apartment'          },
    { slug: 'svitlobot-poverkh', uk: 'Комора поверх',    en: 'Storage floor'      },
    { slug: 'svitlobot-pidval',  uk: 'Комора Д10 підвал', en: 'Storage D10 basement' },
  ],
};

/* ============================================================
   STATE — single source of truth
   ============================================================ */
const STATE = {
  raw: null,
  lang: 'uk',
  tomorrowVisible: false,
  todayKey: null,
  tomorrowKey: null,
  countdown: CONFIG.POLL_INTERVAL,
  fetchError: false,
  lastFetchTime: null,
  group:    { dataType: 'fact', day: 'today' },
  overview: { dataType: 'fact', day: 'today' },
  monitor:  { checks: [], fetchError: false },
};

/* ============================================================
   I18N
   ============================================================ */
const I18N = (() => {
  const strings = {
    uk: {
      meta: {
        title: 'Графік відключень — Київська область',
        description: 'Графік відключень світла по Київській області',
      },
      header: {
        title: 'Графік відключень',
        region: 'Київська обл.',
        updated: 'Оновлено:',
        refresh: 'Оновлення:',
      },
      section: {
        group: 'Черга',
        overview: 'Огляд усіх черг',
        monitor: 'Моніторинг',
      },
      tabs: {
        actual: 'Фактичний',
        predicted: 'Прогноз',
        today: 'Сьогодні',
        tomorrow: 'Завтра',
      },
      status: {
        yes: 'Є світло',
        no: 'Немає',
        first: 'Перша пів.',
        second: 'Друга пів.',
        maybe: 'Можливо',
        mfirst: 'Мб. перша пів.',
        msecond: 'Мб. друга пів.',
      },
      error: {
        fetchFailed: 'Не вдалося завантажити дані. Показано останні відомі дані.',
      },
      monitor: {
        up:      'Є світло',
        down:    'Немає світла',
        grace:   'Перевіряємо...',
        unknown: 'Невідомо',
      },
      footer: {
        source: 'Джерело даних:',
      },
      time: {
        never: 'ніколи',
        justNow: 'щойно',
        minutesAgo: (n) => `${n} хв. тому`,
      },
    },
    en: {
      meta: {
        title: 'Power Outage Schedule — Kyiv Region',
        description: 'Power outage schedule for Kyiv region, Ukraine',
      },
      header: {
        title: 'Power Outage Schedule',
        region: 'Kyiv Region',
        updated: 'Updated:',
        refresh: 'Refresh:',
      },
      section: {
        group: 'Group',
        overview: 'All Groups Overview',
        monitor: 'Live monitoring',
      },
      tabs: {
        actual: 'Actual',
        predicted: 'Predicted',
        today: 'Today',
        tomorrow: 'Tomorrow',
      },
      status: {
        yes: 'Power on',
        no: 'Power off',
        first: 'Off first half',
        second: 'Off second half',
        maybe: 'Maybe off',
        mfirst: 'Maybe 1st half',
        msecond: 'Maybe 2nd half',
      },
      error: {
        fetchFailed: 'Failed to load data. Showing last known data.',
      },
      monitor: {
        up:      'Power on',
        down:    'Power out',
        grace:   'Checking...',
        unknown: 'Unknown',
      },
      footer: {
        source: 'Data source:',
      },
      time: {
        never: 'never',
        justNow: 'just now',
        minutesAgo: (n) => `${n} min ago`,
      },
    },
  };

  function t(key) {
    const parts = key.split('.');
    let obj = strings[STATE.lang];
    for (const p of parts) {
      if (obj == null) return key;
      obj = obj[p];
    }
    return typeof obj === 'string' ? obj : key;
  }

  function applyToDOM() {
    document.documentElement.lang = STATE.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = t(key);
      if (val !== key) el.textContent = val;
    });
    document.title = t('meta.title');
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = t('meta.description');
    // Always sync lang button highlights here — single source of truth
    document.querySelectorAll('.lang-btn').forEach(btn => {
      const isActive = btn.dataset.lang === STATE.lang;
      btn.classList.toggle('lang-btn--active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    // Append dd.mm.yyyy dates to today/tomorrow tab buttons
    const _fmt = (d) =>
      `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    const _today    = new Date();
    const _tomorrow = new Date(_today.getTime() + 86400000);
    document.querySelectorAll('[data-day="today"]').forEach(btn => {
      btn.textContent += '\u00a0' + _fmt(_today);
    });
    document.querySelectorAll('[data-day="tomorrow"]').forEach(btn => {
      btn.textContent += '\u00a0' + _fmt(_tomorrow);
    });
  }

  function setLang(lang) {
    if (!strings[lang]) return;
    STATE.lang = lang;
    try { localStorage.setItem('svitlobot-lang', lang); } catch (_) {}
    applyToDOM();
  }

  function init() {
    try {
      const saved = localStorage.getItem('svitlobot-lang');
      if (saved && strings[saved]) STATE.lang = saved;
    } catch (_) {}
  }

  return { t, applyToDOM, setLang, init };
})();

/* ============================================================
   DATA SERVICE
   ============================================================ */
const DataService = (() => {
  async function fetchData() {
    const resp = await fetch(`${CONFIG.DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  function _computeTomorrowVisibility(raw) {
    const fact = raw.fact;
    const tomorrowKey = String(fact.today + 86400);
    STATE.tomorrowKey = tomorrowKey;

    const data = fact.data;
    if (!data[tomorrowKey]) {
      STATE.tomorrowVisible = false;
      return;
    }

    let allYes = true;
    outer:
    for (const group of CONFIG.GROUP_ORDER) {
      for (let s = 1; s <= 24; s++) {
        const slot = String(s);
        const val = data[tomorrowKey]?.[group]?.[slot];
        if (val !== 'yes') {
          allYes = false;
          break outer;
        }
      }
    }
    STATE.tomorrowVisible = !allYes;
  }

  function getHourlyData(group, sectionState) {
    if (!STATE.raw) return null;
    const { dataType, day } = sectionState;

    if (dataType === 'fact') {
      const key = day === 'today' ? STATE.todayKey : STATE.tomorrowKey;
      return STATE.raw.fact.data[key]?.[group] ?? null;
    } else {
      // preset — keyed by day of week
      const targetDate = day === 'today' ? new Date() : new Date(Date.now() + 86400000);
      const jsDay = targetDate.getDay(); // 0=Sun
      const dowKey = jsDay === 0 ? '7' : String(jsDay);
      // actual structure: preset.data[groupCode][dowKey][slotKey]
      return STATE.raw.preset.data[group]?.[dowKey] ?? null;
    }
  }

  function getCurrentSlot() {
    // slot "1" = 00:00-01:00, slot "N" = (N-1):00 - N:00
    // current slot = getHours() + 1
    return new Date().getHours() + 1;
  }

  function getTimeZoneLabel(slot) {
    const tz = STATE.raw?.preset?.time_zone?.[String(slot)];
    if (tz) return tz[0]; // e.g. "00-01"
    // fallback
    const h = slot - 1;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}-${pad(h + 1 === 24 ? 0 : h + 1)}`;
  }

  function formatLastUpdated() {
    if (!STATE.lastFetchTime) return I18N.t('time.never');
    const diffMs = Date.now() - STATE.lastFetchTime;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return I18N.t('time.justNow');
    return I18N.t('time.minutesAgo')(diffMin);
  }

  function getGroupDisplayName(groupCode) {
    if (STATE.lang === 'en') {
      // Convert GPV3.2 → Group 3.2
      return 'Group ' + groupCode.replace('GPV', '');
    }
    return STATE.raw?.preset?.sch_names?.[groupCode] ?? groupCode;
  }

  function getShortGroupName(groupCode) {
    return groupCode.replace('GPV', '');
  }

  function processRaw(raw) {
    STATE.raw = raw;
    STATE.todayKey = String(raw.fact.today);
    _computeTomorrowVisibility(raw);
    STATE.lastFetchTime = Date.now();
    STATE.fetchError = false;
  }

  return {
    fetchData,
    getHourlyData,
    getCurrentSlot,
    getTimeZoneLabel,
    formatLastUpdated,
    getGroupDisplayName,
    getShortGroupName,
    processRaw,
  };
})();

/* ============================================================
   MONITOR SERVICE
   ============================================================ */
const MonitorService = (() => {
  async function fetchMonitor() {
    try {
      const resp = await fetch(`${CONFIG.MONITOR_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const KNOWN_STATUSES = new Set(['up', 'down', 'grace', 'unknown']);
      const bySlug = {};
      for (const c of (data.checks ?? [])) bySlug[c.slug] = c.status;
      STATE.monitor.checks = CONFIG.MONITOR_CHECKS.map(cfg => {
        const raw = bySlug[cfg.slug] ?? 'unknown';
        return {
          slug:   cfg.slug,
          uk:     cfg.uk,
          en:     cfg.en,
          status: KNOWN_STATUSES.has(raw) ? raw : 'unknown',
        };
      });
      STATE.monitor.fetchError = false;
    } catch (err) {
      console.warn('[svitlobot] Monitor fetch failed:', err);
      STATE.monitor.fetchError = true;
    }
  }

  return { fetchMonitor };
})();

/* ============================================================
   RENDERER
   ============================================================ */
const Renderer = (() => {

  // Returns color key for a status
  function statusToColorKey(status) {
    switch (status) {
      case 'yes':     return 'yes';
      case 'no':      return 'no';
      case 'maybe':   return 'maybe';
      case 'first':   return 'no';   // bar uses no color for "off" part
      case 'second':  return 'yes';  // bar uses yes color for "on" part (dominant)
      case 'mfirst':  return 'maybe';
      case 'msecond': return 'yes';
      default:        return 'yes';
    }
  }

  function statusLabel(status) {
    const map = {
      yes: I18N.t('status.yes'),
      no: I18N.t('status.no'),
      first: I18N.t('status.first'),
      second: I18N.t('status.second'),
      maybe: I18N.t('status.maybe'),
      mfirst: I18N.t('status.mfirst'),
      msecond: I18N.t('status.msecond'),
    };
    return map[status] ?? status;
  }

  function statusTextClass(status) {
    if (status === 'yes') return 'status--yes';
    if (status === 'no') return 'status--no';
    if (['maybe', 'mfirst', 'msecond'].includes(status)) return 'status--maybe';
    if (status === 'first') return 'status--no';
    if (status === 'second') return 'status--yes';
    return '';
  }

  // Build the bar element for the timeline
  function buildTimelineBar(status) {
    const bar = document.createElement('div');
    bar.classList.add('timeline__bar');

    if (status === 'first' || status === 'mfirst') {
      // off first half, on second half
      bar.classList.add('timeline__bar--split');
      const h1 = document.createElement('div');
      h1.classList.add('bar-half', status === 'first' ? 'bar--no' : 'bar--maybe');
      const h2 = document.createElement('div');
      h2.classList.add('bar-half', 'bar--yes');
      bar.append(h1, h2);
    } else if (status === 'second' || status === 'msecond') {
      // on first half, off second half
      bar.classList.add('timeline__bar--split');
      const h1 = document.createElement('div');
      h1.classList.add('bar-half', 'bar--yes');
      const h2 = document.createElement('div');
      h2.classList.add('bar-half', status === 'second' ? 'bar--no' : 'bar--maybe');
      bar.append(h1, h2);
    } else {
      bar.classList.add(`bar--${statusToColorKey(status)}`);
    }
    return bar;
  }

  // Build a table cell content for the overview
  function buildCellContent(status) {
    const isSplit = ['first', 'second', 'mfirst', 'msecond'].includes(status);

    if (isSplit) {
      const wrap = document.createElement('div');
      wrap.classList.add('cell-split');

      let h1Class, h2Class;
      if (status === 'first') {
        h1Class = 'bg--no'; h2Class = 'bg--yes';
      } else if (status === 'second') {
        h1Class = 'bg--yes'; h2Class = 'bg--no';
      } else if (status === 'mfirst') {
        h1Class = 'bg--maybe'; h2Class = 'bg--yes';
      } else { // msecond
        h1Class = 'bg--yes'; h2Class = 'bg--maybe';
      }
      const h1 = document.createElement('div');
      h1.classList.add('cell-half', h1Class);
      const h2 = document.createElement('div');
      h2.classList.add('cell-half', h2Class);
      wrap.append(h1, h2);
      return wrap;
    } else {
      const wrap = document.createElement('div');
      wrap.classList.add('cell-full', `bg--${statusToColorKey(status)}`);
      return wrap;
    }
  }

  function renderGroupSection() {
    const timeline = document.getElementById('group-timeline');
    if (!timeline) return;

    const group = CONFIG.FEATURED_GROUP;
    const slotData = DataService.getHourlyData(group, STATE.group);
    const currentSlot = DataService.getCurrentSlot();

    // Update group name display
    const nameEl = document.getElementById('group-name-display');
    if (nameEl) nameEl.textContent = DataService.getShortGroupName(group);

    // Clear and rebuild
    timeline.innerHTML = '';

    let currentItem = null;

    for (let s = 1; s <= 24; s++) {
      const slot = String(s);
      const status = slotData?.[slot] ?? 'yes';
      const timeLabel = DataService.getTimeZoneLabel(s);
      const isCurrent = s === currentSlot;

      const li = document.createElement('li');
      li.classList.add('timeline__item');
      li.setAttribute('role', 'listitem');
      if (isCurrent) {
        li.classList.add('timeline__item--current');
        li.setAttribute('aria-current', 'true');
        currentItem = li;
      }

      // Time label
      const timeEl = document.createElement('span');
      timeEl.classList.add('timeline__time');
      timeEl.textContent = timeLabel;
      timeEl.setAttribute('aria-label', `Година ${timeLabel}`);

      // Bar
      const bar = buildTimelineBar(status);

      // Label
      const labelEl = document.createElement('span');
      labelEl.classList.add('timeline__label', statusTextClass(status));
      labelEl.textContent = statusLabel(status);

      li.append(timeEl, bar, labelEl);
      timeline.appendChild(li);
    }

    // Scroll current into view (smooth if not first render)
    if (currentItem) {
      currentItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function renderOverviewTable() {
    const thead = document.getElementById('overview-thead');
    const tbody = document.getElementById('overview-tbody');
    if (!thead || !tbody) return;

    const currentSlot = DataService.getCurrentSlot();
    const groups = CONFIG.GROUP_ORDER;

    // ── Header: "Group" cell + one th per hour (1–24) ──────────
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');

    const thGroup = document.createElement('th');
    thGroup.classList.add('col-group');
    thGroup.scope = 'col';
    thGroup.textContent = STATE.lang === 'uk' ? 'Черга' : 'Group';
    headerRow.appendChild(thGroup);

    let currentTh = null;
    for (let s = 1; s <= 24; s++) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = DataService.getTimeZoneLabel(s);
      if (s === currentSlot) {
        th.classList.add('col-current');
        currentTh = th;
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    // ── Body: one row per group ──────────────────────────────────
    tbody.innerHTML = '';

    for (const group of groups) {
      const isFeatured = group === CONFIG.FEATURED_GROUP;
      const slotData = DataService.getHourlyData(group, STATE.overview);

      const tr = document.createElement('tr');
      if (isFeatured) tr.classList.add('row--featured');

      // Sticky group name cell
      const tdGroup = document.createElement('td');
      tdGroup.classList.add('col-group');
      tdGroup.textContent = DataService.getShortGroupName(group);
      tdGroup.title = DataService.getGroupDisplayName(group);
      tr.appendChild(tdGroup);

      // One cell per hour
      for (let s = 1; s <= 24; s++) {
        const slot = String(s);
        const status = slotData?.[slot] ?? 'yes';
        const isCurrent = s === currentSlot;

        const td = document.createElement('td');
        if (isCurrent) td.classList.add('col-current');
        td.setAttribute('aria-label',
          `${DataService.getShortGroupName(group)} ${DataService.getTimeZoneLabel(s)}: ${statusLabel(status)}`);
        td.appendChild(buildCellContent(status));
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    // Scroll current hour column into view (horizontally)
    if (currentTh) {
      currentTh.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }

  function updateMetaBar() {
    const updatedEl = document.getElementById('last-updated-time');
    if (updatedEl) updatedEl.textContent = DataService.formatLastUpdated();
  }

  function updateErrorBanner() {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    if (STATE.fetchError) {
      banner.hidden = false;
      const msgEl = document.getElementById('error-message');
      if (msgEl) msgEl.textContent = I18N.t('error.fetchFailed');
    } else {
      banner.hidden = true;
    }
  }

  function renderAll() {
    if (!STATE.raw) return;
    renderGroupSection();
    renderOverviewTable();
    updateMetaBar();
    updateErrorBanner();
    // MonitorRenderer is defined after this IIFE, so access via global
    if (typeof MonitorRenderer !== 'undefined') MonitorRenderer.renderMonitorGrid();
  }

  return { renderAll, updateMetaBar, updateErrorBanner, renderGroupSection, renderOverviewTable };
})();

/* ============================================================
   MONITOR RENDERER
   ============================================================ */
const MonitorRenderer = (() => {
  function renderMonitorGrid() {
    const section = document.getElementById('monitor-section');
    const grid    = document.getElementById('monitor-grid');
    if (!section || !grid) return;

    const checks = STATE.monitor.checks;
    if (checks.length === 0 || STATE.monitor.fetchError) {
      section.hidden = true;
      document.body.removeAttribute('data-monitor-status');
      return;
    }

    // Body border reflects the first (apartment) check status
    document.body.dataset.monitorStatus = checks[0].status;

    section.hidden = false;
    grid.innerHTML = '';

    for (const check of checks) {
      const name   = STATE.lang === 'uk' ? check.uk : check.en;
      const status = check.status;
      const label  = I18N.t(`monitor.${status}`);

      const card = document.createElement('div');
      card.className = `monitor-card monitor-card--${status}`;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', `${name}: ${label}`);

      const nameEl = document.createElement('span');
      nameEl.className = 'monitor-card__name';
      nameEl.textContent = name;

      const statusEl = document.createElement('span');
      statusEl.className = 'monitor-card__status';
      statusEl.textContent = label;

      card.append(nameEl, statusEl);
      grid.appendChild(card);
    }
  }

  return { renderMonitorGrid };
})();

/* ============================================================
   TAB CONTROLLER
   ============================================================ */
const TabController = (() => {
  function syncTomorrowButtons() {
    document.querySelectorAll('.tab-btn--tomorrow').forEach(btn => {
      btn.hidden = !STATE.tomorrowVisible;
    });
  }

  function activateTypeTab(section, type) {
    const sectionEl = document.querySelector(`[data-section="${section}"].tab-group:not(.tab-group--day)`);
    if (!sectionEl) return;
    sectionEl.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.type === type;
      btn.classList.toggle('tab-btn--active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
  }

  function activateDayTab(section, day) {
    const sectionEl = document.querySelector(`[data-section="${section}"].tab-group--day`);
    if (!sectionEl) return;
    sectionEl.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.day === day;
      btn.classList.toggle('tab-btn--active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
  }

  function init() {
    // Handle type tabs (fact/preset)
    document.querySelectorAll('[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section; // 'group' or 'overview'
        const type = btn.dataset.type;
        if (!section || !type) return;

        STATE[section].dataType = type;
        activateTypeTab(section, type);

        if (section === 'group') Renderer.renderGroupSection();
        else Renderer.renderOverviewTable();
        Renderer.updateMetaBar();
      });
    });

    // Handle day tabs (today/tomorrow)
    document.querySelectorAll('[data-day]').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        const day = btn.dataset.day;
        if (!section || !day) return;
        if (day === 'tomorrow' && !STATE.tomorrowVisible) return;

        STATE[section].day = day;
        activateDayTab(section, day);

        if (section === 'group') Renderer.renderGroupSection();
        else Renderer.renderOverviewTable();
      });
    });

    syncTomorrowButtons();
  }

  return { init, syncTomorrowButtons };
})();

/* ============================================================
   COUNTDOWN TIMER
   ============================================================ */
const CountdownTimer = (() => {
  let _intervalId = null;

  function _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function _tick() {
    STATE.countdown -= 1;
    const displayEl = document.getElementById('countdown-display');
    if (displayEl) displayEl.textContent = _formatTime(STATE.countdown);

    if (STATE.countdown <= 0) {
      STATE.countdown = CONFIG.POLL_INTERVAL; // prevent re-entry while refresh is in flight
      App.refresh();
    }
  }

  function reset() {
    STATE.countdown = CONFIG.POLL_INTERVAL;
    const displayEl = document.getElementById('countdown-display');
    if (displayEl) displayEl.textContent = _formatTime(STATE.countdown);
  }

  function start() {
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = setInterval(_tick, 1000);
  }

  function stop() {
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = null;
  }

  return { reset, start, stop };
})();

/* ============================================================
   APP
   ============================================================ */
const App = (() => {
  let _lastHiddenAt = null;

  async function _doFetch() {
    try {
      const raw = await DataService.fetchData();
      DataService.processRaw(raw);
      STATE.fetchError = false;
    } catch (err) {
      console.warn('[svitlobot] Fetch failed:', err);
      STATE.fetchError = true;
    }
  }

  async function refresh() {
    await _doFetch();
    CountdownTimer.reset();
    TabController.syncTomorrowButtons();
    // If tomorrow was selected but is now hidden, fall back to today
    for (const section of ['group', 'overview']) {
      if (STATE[section].day === 'tomorrow' && !STATE.tomorrowVisible) {
        STATE[section].day = 'today';
      }
    }
    I18N.applyToDOM();
    Renderer.renderAll();
  }

  function _wireLanguageButtons() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        if (!lang) return;
        I18N.setLang(lang);
        Renderer.renderAll();
      });
    });
  }

  function _initTheme() {
    let saved;
    try { saved = localStorage.getItem('svitlobot-theme'); } catch (_) {}
    const theme = saved === 'light' ? 'light' : 'dark';
    _applyTheme(theme);
  }

  function _applyTheme(theme) {
    const btn = document.getElementById('btn-theme');
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (btn) btn.textContent = '🌙';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (btn) btn.textContent = '☀';
    }
    try { localStorage.setItem('svitlobot-theme', theme); } catch (_) {}
  }

  function _wireThemeButton() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      _applyTheme(current === 'light' ? 'dark' : 'light');
    });
  }

  function _wireVisibilityChange() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        _lastHiddenAt = Date.now();
      } else {
        // Tab became visible
        if (_lastHiddenAt !== null) {
          const hiddenMs = Date.now() - _lastHiddenAt;
          if (hiddenMs > CONFIG.POLL_INTERVAL * 1000) {
            // Was hidden more than poll interval — refresh immediately
            CountdownTimer.stop();
            await refresh();
            CountdownTimer.start();
          }
        }
        _lastHiddenAt = null;
      }
    });
  }

  async function init() {
    I18N.init();
    _initTheme();
    I18N.applyToDOM();
    TabController.init();
    _wireLanguageButtons();
    _wireThemeButton();
    _wireVisibilityChange();

    // First fetch
    await _doFetch();
    document.body.classList.remove('loading');

    TabController.syncTomorrowButtons();
    I18N.applyToDOM();
    Renderer.renderAll();

    CountdownTimer.reset();
    CountdownTimer.start();

    // Monitor polling (independent of main data countdown)
    MonitorService.fetchMonitor().then(MonitorRenderer.renderMonitorGrid);
    setInterval(() => {
      MonitorService.fetchMonitor().then(MonitorRenderer.renderMonitorGrid);
    }, CONFIG.MONITOR_POLL * 1000);
  }

  return { init, refresh };
})();

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());
