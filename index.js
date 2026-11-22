/**
 * Fallout 2d20 Tracker — SillyTavern Third-Party Extension
 * Tracks S.P.E.C.I.A.L., HP (with Radiation cap), Party AP Pool (0-6), and Luck Points per chat.
 */

const MODULE_NAME = 'fallout_2d20_tracker';
const EXTENSION_FOLDER = 'scripts/extensions/third-party/fallout-2d20-tracker';
const SPECIAL_KEYS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LCK'];

const DEFAULT_CHARACTER = {
  name: 'Elena Vance',
  origin: 'Wastelander',
  level: 1,
  special: { STR: 5, PER: 7, END: 6, CHA: 6, INT: 8, AGI: 5, LCK: 5 },
  hp: 11,
  maxHpOverride: null,
  lifegiverRanks: 0,
  rads: 0,
  ap: 2,
  maxAp: 6,
  luckPoints: 5,
  caps: 45,
  location: 'Mt. Sin Central — Triage Bay',
  conditions: 'None',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  hudVisible: true,
  hudCollapsed: false,
  hudTheme: 'amber',
  injectPrompt: true,
  promptDepth: 2,
  autoParseMessages: true,
  autoCalcHp: true,
  hudPosition: { top: 64, right: 16 },
  defaultCharacter: structuredClone(DEFAULT_CHARACTER),
};

function getCtx() {
  return SillyTavern.getContext();
}

function getSettings() {
  const { extensionSettings } = getCtx();
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  const s = extensionSettings[MODULE_NAME];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (s[k] === undefined) {
      s[k] = typeof v === 'object' && v !== null ? structuredClone(v) : v;
    }
  }
  return s;
}

function getBaseMaxHp(char, settings) {
  if (!settings.autoCalcHp && Number.isFinite(char.maxHpOverride) && char.maxHpOverride > 0) {
    return char.maxHpOverride;
  }
  const lvlBonus = Math.max(0, (char.level || 1) - 1);
  const lifegiver = Math.max(0, char.lifegiverRanks || 0) * (char.special?.END || 5);
  return Math.max(1, (char.special?.END || 5) + (char.special?.LCK || 5) + lvlBonus + lifegiver);
}

function getEffectiveMaxHp(char, settings) {
  return Math.max(0, getBaseMaxHp(char, settings) - Math.max(0, char.rads || 0));
}

function clampVitals(char, settings) {
  const baseMax = getBaseMaxHp(char, settings);
  char.level = Math.max(1, Number(char.level) || 1);
  char.rads = Math.max(0, Math.min(Number(char.rads) || 0, baseMax));
  const effMax = getEffectiveMaxHp(char, settings);
  char.hp = Math.max(0, Math.min(Number(char.hp) ?? effMax, effMax));
  char.maxAp = Math.max(1, Number(char.maxAp) || 6);
  char.ap = Math.max(0, Math.min(Number(char.ap) || 0, char.maxAp));
  char.luckPoints = Math.max(0, Math.min(Number(char.luckPoints) ?? char.special.LCK, char.special.LCK));
  char.caps = Math.max(0, Number(char.caps) || 0);
  return char;
}

function getActiveCharacter() {
  const ctx = getCtx();
  const settings = getSettings();
  if (!ctx.chatMetadata) {
    return clampVitals(structuredClone(settings.defaultCharacter), settings);
  }
  if (!ctx.chatMetadata.fallout2d20) {
    const seed = structuredClone(settings.defaultCharacter);
    if (ctx.name1 && seed.name === DEFAULT_CHARACTER.name) {
      seed.name = ctx.name1;
    }
    ctx.chatMetadata.fallout2d20 = clampVitals(seed, settings);
  }
  return clampVitals(ctx.chatMetadata.fallout2d20, settings);
}

async function persistCharacter(char) {
  const ctx = getCtx();
  const settings = getSettings();
  const clamped = clampVitals(char, settings);
  if (ctx.chatMetadata) {
    ctx.chatMetadata.fallout2d20 = clamped;
    if (typeof ctx.saveMetadata === 'function') {
      await ctx.saveMetadata();
    }
  }
  settings.defaultCharacter = structuredClone(clamped);
  ctx.saveSettingsDebounced();
  syncPromptInjection();
  renderHud();
}

function syncPromptInjection() {
  const ctx = getCtx();
  const settings = getSettings();
  const promptType = ctx.extension_prompt_types?.IN_CHAT ?? 1;

  if (!settings.enabled || !settings.injectPrompt) {
    ctx.setExtensionPrompt(MODULE_NAME, '', promptType, settings.promptDepth);
    return;
  }

  const char = getActiveCharacter();
  const baseMax = getBaseMaxHp(char, settings);
  const effMax = getEffectiveMaxHp(char, settings);
  const sp = char.special;

  const promptBlock = [
    `[FALLOUT 2D20 CHARACTER SHEET — ${char.name}]`,
    `Origin: ${char.origin} | Level: ${char.level} | Location: ${char.location}`,
    `S.P.E.C.I.A.L.: STR ${sp.STR} | PER ${sp.PER} | END ${sp.END} | CHA ${sp.CHA} | INT ${sp.INT} | AGI ${sp.AGI} | LCK ${sp.LCK}`,
    `Vitals: HP ${char.hp}/${effMax} (Base Max ${baseMax}, Rad Damage ${char.rads}) | Party AP Pool: ${char.ap}/${char.maxAp} | Luck Points: ${char.luckPoints}/${sp.LCK} | Caps: ${char.caps}`,
    `Active Conditions: ${char.conditions || 'None'}`,
    `GM Tracking Rule: When HP, AP, Rads, or Luck change, append a summary tag outside thinking blocks using [HP: +/-N | AP: +/-N | Rads: +/-N | Luck: +/-N].`,
  ].join('\n');

  ctx.setExtensionPrompt(MODULE_NAME, promptBlock, promptType, Number(settings.promptDepth) || 2);
}

function stripReasoningBlocks(text) {
  return String(text || '')
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

function parseGmMessageTags(rawMessage) {
  const settings = getSettings();
  if (!settings.enabled || !settings.autoParseMessages) return false;

  const clean = stripReasoningBlocks(rawMessage);
  if (!clean) return false;

  const char = getActiveCharacter();
  let changed = false;

  const applyNum = (regex, getter, setter) => {
    const matches = [...clean.matchAll(regex)];
    if (!matches.length) return;
    const token = matches[matches.length - 1][1].trim();
    const prev = getter();
    let next = prev;
    if (token.startsWith('+') || token.startsWith('-')) {
      next = prev + parseInt(token, 10);
    } else if (token.includes('/')) {
      next = parseInt(token.split('/')[0], 10);
    } else {
      next = parseInt(token, 10);
    }
    if (Number.isFinite(next) && next !== prev) {
      setter(next);
      changed = true;
    }
  };

  applyNum(/\bHP\s*:\s*([+-]?\d+(?:\s*\/\s*\d+)?)/gi, () => char.hp, (v) => { char.hp = v; });
  applyNum(/\bAP\s*:\s*([+-]?\d+(?:\s*\/\s*\d+)?)/gi, () => char.ap, (v) => { char.ap = v; });
  applyNum(/\bRADS?\s*:\s*([+-]?\d+)/gi, () => char.rads, (v) => { char.rads = v; });
  applyNum(/\bLUCK(?:\s*PTS?)?\s*:\s*([+-]?\d+(?:\s*\/\s*\d+)?)/gi, () => char.luckPoints, (v) => { char.luckPoints = v; });
  applyNum(/\bCAPS?\s*:\s*([+-]?\d+)/gi, () => char.caps, (v) => { char.caps = v; });

  const locMatch = clean.match(/\[[^\]]*\bLocation\s*:\s*([^|\]]+)/i);
  if (locMatch && locMatch[1].trim() && locMatch[1].trim() !== char.location) {
    char.location = locMatch[1].trim();
    changed = true;
  }

  if (changed) {
    persistCharacter(char);
  }
  return changed;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHud() {
  const settings = getSettings();
  const char = getActiveCharacter();
  let hud = document.getElementById('f2d20-hud');

  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'f2d20-hud';
    document.body.appendChild(hud);
    bindHudInteractions(hud);
  }

  hud.dataset.theme = settings.hudTheme || 'amber';
  hud.classList.toggle('f2d20-hidden', !settings.enabled || !settings.hudVisible);
  hud.classList.toggle('f2d20-collapsed', Boolean(settings.hudCollapsed));

  const baseMax = getBaseMaxHp(char, settings);
  const effMax = getEffectiveMaxHp(char, settings);
  const hpPct = baseMax > 0 ? Math.round((char.hp / baseMax) * 100) : 0;
  const radPct = baseMax > 0 ? Math.round((char.rads / baseMax) * 100) : 0;
  const hpClass = char.hp <= Math.ceil(effMax * 0.25) ? 'is-critical' : char.hp <= Math.ceil(effMax * 0.5) ? 'is-low' : '';

  const apPipsHtml = Array.from({ length: char.maxAp }, (_, idx) => {
    const active = idx < char.ap ? 'is-active' : '';
    return `<button type="button" class="f2d20-ap-pip ${active}" data-ap-set="${idx + 1}" title="Set AP to ${idx + 1}"></button>`;
  }).join('');

  const specialHtml = SPECIAL_KEYS.map((key) => `
    <div class="f2d20-special-cell" data-special-edit="${key}" title="Click to edit ${key} (Right-click to decrement)">
      <span class="f2d20-special-key">${key}</span>
      <span class="f2d20-special-val f2d20-mono">${char.special[key]}</span>
    </div>
  `).join('');

  hud.innerHTML = `
    <div class="f2d20-header" id="f2d20-drag-handle">
      <div class="f2d20-title-block">
        <span class="f2d20-char-name">${escapeHtml(char.name)}</span>
        <span class="f2d20-char-meta">Lvl ${char.level} ${escapeHtml(char.origin)} · ${char.caps} Caps</span>
      </div>
      <div class="f2d20-header-actions">
        <button type="button" class="f2d20-icon-btn" data-action="edit-name" title="Edit Character Name/Origin">Edit</button>
        <button type="button" class="f2d20-icon-btn" data-action="toggle-collapse" title="Collapse/Expand">${settings.hudCollapsed ? '+' : '−'}</button>
      </div>
    </div>

    <div class="f2d20-body">
      <div class="f2d20-vital-row">
        <div class="f2d20-vital-top">
          <span class="f2d20-label">HP <span class="f2d20-mono" style="color: var(--f2d20-text)">${char.hp}/${effMax}</span>${char.rads > 0 ? ` <span style="color:#ef4444">(-${char.rads} RAD)</span>` : ''}</span>
          <div class="f2d20-steppers">
            <button type="button" class="f2d20-step-btn" data-delta-hp="-1">−</button>
            <button type="button" class="f2d20-step-btn" data-delta-hp="1">+</button>
          </div>
        </div>
        <div class="f2d20-hp-track">
          <div class="f2d20-hp-fill ${hpClass}" style="width: ${hpPct}%"></div>
          <div class="f2d20-rad-fill" style="width: ${radPct}%"></div>
        </div>
      </div>

      <div class="f2d20-vital-row">
        <div class="f2d20-vital-top">
          <span class="f2d20-label">AP POOL <span class="f2d20-mono" style="color: var(--f2d20-text)">${char.ap}/${char.maxAp}</span></span>
          <div class="f2d20-steppers">
            <button type="button" class="f2d20-step-btn" data-delta-ap="-1">−</button>
            <button type="button" class="f2d20-step-btn" data-delta-ap="1">+</button>
          </div>
        </div>
        <div class="f2d20-ap-pips">${apPipsHtml}</div>
      </div>

      <div class="f2d20-sub-stats">
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="f2d20-label">RADS <span class="f2d20-mono" style="color:var(--f2d20-text)">${char.rads}</span></span>
          <button type="button" class="f2d20-step-btn" data-delta-rads="-1">−</button>
          <button type="button" class="f2d20-step-btn" data-delta-rads="1">+</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="f2d20-label">LUCK <span class="f2d20-mono" style="color:var(--f2d20-text)">${char.luckPoints}/${char.special.LCK}</span></span>
          <button type="button" class="f2d20-step-btn" data-delta-luck="-1">−</button>
          <button type="button" class="f2d20-step-btn" data-delta-luck="1">+</button>
        </div>
      </div>

      <div class="f2d20-special-grid">${specialHtml}</div>

      <div class="f2d20-location-bar" title="${escapeHtml(char.location)}">
        Location: ${escapeHtml(char.location)}
      </div>
    </div>
  `;
}

function bindHudInteractions(hud) {
  hud.addEventListener('click', (e) => {
    const target = e.target.closest('button, [data-special-edit]');
    if (!target) return;

    const settings = getSettings();
    const char = getActiveCharacter();

    if (target.dataset.action === 'toggle-collapse') {
      settings.hudCollapsed = !settings.hudCollapsed;
      getCtx().saveSettingsDebounced();
      renderHud();
      return;
    }

    if (target.dataset.action === 'edit-name') {
      const nextName = window.prompt('Character Name:', char.name);
      if (nextName !== null && nextName.trim()) {
        char.name = nextName.trim();
        const nextOrigin = window.prompt('Origin (e.g., Wastelander, Vault Dweller):', char.origin);
        if (nextOrigin !== null && nextOrigin.trim()) char.origin = nextOrigin.trim();
        const nextLoc = window.prompt('Current Location:', char.location);
        if (nextLoc !== null && nextLoc.trim()) char.location = nextLoc.trim();
        persistCharacter(char);
      }
      return;
    }

    if (target.dataset.deltaHp) {
      char.hp += parseInt(target.dataset.deltaHp, 10);
      persistCharacter(char);
      return;
    }

    if (target.dataset.deltaAp) {
      char.ap += parseInt(target.dataset.deltaAp, 10);
      persistCharacter(char);
      return;
    }

    if (target.dataset.apSet) {
      const clicked = parseInt(target.dataset.apSet, 10);
      char.ap = char.ap === clicked ? clicked - 1 : clicked;
      persistCharacter(char);
      return;
    }

    if (target.dataset.deltaRads) {
      char.rads += parseInt(target.dataset.deltaRads, 10);
      persistCharacter(char);
      return;
    }

    if (target.dataset.deltaLuck) {
      char.luckPoints += parseInt(target.dataset.deltaLuck, 10);
      persistCharacter(char);
      return;
    }

    if (target.dataset.specialEdit) {
      const key = target.dataset.specialEdit;
      const val = window.prompt(`Set ${key} (1–12):`, String(char.special[key]));
      if (val !== null) {
        const parsed = parseInt(val, 10);
        if (Number.isFinite(parsed)) {
          char.special[key] = Math.max(1, Math.min(12, parsed));
          persistCharacter(char);
        }
      }
    }
  });

  // Simple drag support via header
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  hud.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('#f2d20-drag-handle');
    if (!handle || e.target.closest('button')) return;
    dragging = true;
    const rect = hud.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    hud.style.right = 'auto';
    hud.style.left = `${origLeft}px`;
    hud.style.top = `${origTop}px`;
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    hud.style.left = `${Math.max(8, Math.min(window.innerWidth - 310, origLeft + dx))}px`;
    hud.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, origTop + dy))}px`;
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

function registerCommands() {
  const ctx = getCtx();
  const handler = async (_namedArgs, unnamedArgs) => {
    const raw = Array.isArray(unnamedArgs) ? unnamedArgs.join(' ') : String(unnamedArgs || '');
    const parts = raw.trim().split(/\s+/);
    const sub = (parts[0] || 'status').toLowerCase();
    const arg1 = parts[1];
    const arg2 = parts[2];

    const settings = getSettings();
    const char = getActiveCharacter();

    const applyDeltaOrSet = (val, token) => {
      if (!token) return null;
      if (token.startsWith('+') || token.startsWith('-')) {
        const d = parseInt(token, 10);
        return Number.isFinite(d) ? val + d : null;
      }
      const abs = parseInt(token, 10);
      return Number.isFinite(abs) ? abs : null;
    };

    if (sub === 'status') {
      const effMax = getEffectiveMaxHp(char, settings);
      const sp = char.special;
      return `${char.name} | HP ${char.hp}/${effMax} (Rads ${char.rads}) | AP ${char.ap}/${char.maxAp} | Luck ${char.luckPoints}/${sp.LCK} | S:${sp.STR} P:${sp.PER} E:${sp.END} C:${sp.CHA} I:${sp.INT} A:${sp.AGI} L:${sp.LCK}`;
    }

    if (sub === 'hp') {
      const nextVal = applyDeltaOrSet(char.hp, arg1);
      if (nextVal === null) return 'Usage: /f2d20 hp <+N|-N|N>';
      char.hp = nextVal;
      await persistCharacter(char);
      return `HP set to ${char.hp}/${getEffectiveMaxHp(char, settings)}.`;
    }

    if (sub === 'ap') {
      const nextVal = applyDeltaOrSet(char.ap, arg1);
      if (nextVal === null) return 'Usage: /f2d20 ap <+N|-N|N>';
      char.ap = nextVal;
      await persistCharacter(char);
      return `Party AP set to ${char.ap}/${char.maxAp}.`;
    }

    if (sub === 'rads' || sub === 'rad') {
      const nextVal = applyDeltaOrSet(char.rads, arg1);
      if (nextVal === null) return 'Usage: /f2d20 rads <+N|-N|N>';
      char.rads = nextVal;
      await persistCharacter(char);
      return `Rads set to ${char.rads} (Effective Max HP: ${getEffectiveMaxHp(char, settings)}).`;
    }

    if (sub === 'luck') {
      const nextVal = applyDeltaOrSet(char.luckPoints, arg1);
      if (nextVal === null) return 'Usage: /f2d20 luck <+N|-N|N>';
      char.luckPoints = nextVal;
      await persistCharacter(char);
      return `Luck Points set to ${char.luckPoints}/${char.special.LCK}.`;
    }

    if (sub === 'special' && arg1 && arg2) {
      const key = arg1.toUpperCase();
      if (!SPECIAL_KEYS.includes(key)) return `Invalid attribute "${arg1}". Use STR, PER, END, CHA, INT, AGI, or LCK.`;
      const val = parseInt(arg2, 10);
      if (!Number.isFinite(val)) return 'Usage: /f2d20 special <STAT> <value>';
      char.special[key] = Math.max(1, Math.min(12, val));
      await persistCharacter(char);
      return `${key} updated to ${char.special[key]}.`;
    }

    if (sub === 'rest') {
      char.hp = getEffectiveMaxHp(char, settings);
      char.luckPoints = char.special.LCK;
      await persistCharacter(char);
      return `Rest complete: HP ${char.hp}, Luck ${char.luckPoints}.`;
    }

    return 'Usage: /f2d20 [status|hp|ap|rads|luck|special|rest]';
  };

  if (ctx.SlashCommandParser && ctx.SlashCommand) {
    ctx.SlashCommandParser.addCommandObject(
      ctx.SlashCommand.fromProps({
        name: 'f2d20',
        callback: handler,
        returns: 'string',
        helpString: 'View or update Fallout 2d20 S.P.E.C.I.A.L., HP, Rads, AP, and Luck.',
      })
    );
  } else if (typeof ctx.registerSlashCommand === 'function') {
    ctx.registerSlashCommand('f2d20', handler, [], 'Fallout 2d20 Tracker command', true, true);
  }
}

async function mountSettingsUi() {
  const settings = getSettings();
  const container = document.getElementById('extensions_settings');
  if (!container) return;

  try {
    const resp = await fetch(`/${EXTENSION_FOLDER}/settings.html`);
    if (resp.ok) {
      const html = await resp.text();
      $(container).append(html);
    }
  } catch (err) {
    console.warn('[Fallout2d20] Failed to load settings.html', err);
    return;
  }

  const bindCheckbox = (id, key, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = Boolean(settings[key]);
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      getCtx().saveSettingsDebounced();
      onChange?.();
    });
  };

  bindCheckbox('f2d20_enabled', 'enabled', () => { syncPromptInjection(); renderHud(); });
  bindCheckbox('f2d20_hud_visible', 'hudVisible', renderHud);
  bindCheckbox('f2d20_auto_calc_hp', 'autoCalcHp', () => { syncPromptInjection(); renderHud(); });
  bindCheckbox('f2d20_auto_parse', 'autoParseMessages');
  bindCheckbox('f2d20_inject_prompt', 'injectPrompt', syncPromptInjection);

  const depthEl = document.getElementById('f2d20_prompt_depth');
  if (depthEl) {
    depthEl.value = String(settings.promptDepth ?? 2);
    depthEl.addEventListener('change', () => {
      settings.promptDepth = Math.max(0, Math.min(12, parseInt(depthEl.value, 10) || 0));
      getCtx().saveSettingsDebounced();
      syncPromptInjection();
    });
  }

  const themeEl = document.getElementById('f2d20_hud_theme');
  if (themeEl) {
    themeEl.value = settings.hudTheme || 'amber';
    themeEl.addEventListener('change', () => {
      settings.hudTheme = themeEl.value;
      getCtx().saveSettingsDebounced();
      renderHud();
    });
  }

  document.getElementById('f2d20_btn_toggle_hud')?.addEventListener('click', () => {
    settings.hudVisible = !settings.hudVisible;
    const cb = document.getElementById('f2d20_hud_visible');
    if (cb) cb.checked = settings.hudVisible;
    getCtx().saveSettingsDebounced();
    renderHud();
  });

  document.getElementById('f2d20_btn_rest')?.addEventListener('click', () => {
    const char = getActiveCharacter();
    char.hp = getEffectiveMaxHp(char, settings);
    char.luckPoints = char.special.LCK;
    persistCharacter(char);
  });

  document.getElementById('f2d20_btn_reset')?.addEventListener('click', () => {
    persistCharacter(structuredClone(DEFAULT_CHARACTER));
  });

  document.getElementById('f2d20_btn_export')?.addEventListener('click', () => {
    const char = getActiveCharacter();
    const blob = new Blob([JSON.stringify(char, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${char.name.toLowerCase().replace(/\s+/g, '-')}-fallout2d20.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById('f2d20_import_file');
  document.getElementById('f2d20_btn_import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      persistCharacter(Object.assign(structuredClone(DEFAULT_CHARACTER), parsed));
    } catch (err) {
      console.error('[Fallout2d20] Invalid character JSON', err);
    }
  });
}

jQuery(async () => {
  const ctx = getCtx();
  getSettings();
  await mountSettingsUi();
  registerCommands();
  renderHud();
  syncPromptInjection();

  ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
    renderHud();
    syncPromptInjection();
  });

  ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, () => {
    const latest = ctx.chat?.[ctx.chat.length - 1];
    if (latest && !latest.is_user && latest.mes) {
      parseGmMessageTags(latest.mes);
    }
  });
});
