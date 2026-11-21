/* Local Ledger 記一筆 form (Telegram Mini App). local-ledger-form v2.19.0
 * Static page: no data, no secrets. The bot puts the choices (and the entry to edit) in ?d=, the page sends the
 * answer back with Telegram.WebApp.sendData. The bot checks everything again (ledger/form.py validate).
 * Opened from inline mode (d.x, 2.5.0, a group): sendData does not exist there, so 送出 puts "記帳|…" after
 * "@bot" in the chat's input (switchInlineQuery) and the bot shows it as a card to tap (ledger/inline.py).
 * 2.16.0: 金額 is always TWD; a 外幣 (currency + orig) is only recorded. The page follows Telegram's light / dark
 * theme (or the phone's, outside Telegram).
 * The top half is plain functions (tested with node: tests/test_form.js); the bottom half draws the page. */
(function (root) {
  "use strict";
  var VERSION = 1;                     /* the data sent (v); the page's own version is FORM_VERSION */
  /* 2.13.0: this page's version (ledger/form.py FORM_VERSION; also the first line here and in index.html). Shown at
   * the bottom of the form, sent back as fv; the bot puts the version it expects in d.fv. */
  var FORM_VERSION = "2.19.0";
  var HINT = {
    "食": "食品＆日用品", "衣": "服飾／美容／美髮", "住": "設備／修繕／水電瓦斯網路／貸款", "行": "加油／保養／交通費／停車",
    "育": "學費／育兒／教育", "樂": "旅遊／門票／遊戲", "醫藥保健": "醫療／個人保險", "其他": "禮金／禮物／稅",
    "薪資": "薪水", "獎金": "年終／分紅", "其他收入": "利息／紅包／其他"
  };

  function b64urlDecode(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* 2.13.0 (review): every field the page uses has the type it needs, so a hand-made ?d= cannot break the page
   * half-way (it shows "open it from Telegram" instead). The bot checks what is sent again anyway. */
  /* 2.18.0 (review): size caps, so a hand-made address with a huge ?d= costs no real work: the address part at most
   * MAX_SETUP characters, a list at most MAX_LIST entries, a text at most MAX_TEXT characters (the bot's setup is
   * far below all three: 30 固定支出 items, about 20 目錄, names of 20 characters, a 備註 of 100) */
  var MAX_SETUP = 16384, MAX_LIST = 200, MAX_TEXT = 300;
  function isStr(v) { return typeof v === "string" && v.length <= MAX_TEXT; }
  function strs(a, need) { return Array.isArray(a) && a.length <= MAX_LIST && (!need || a.length > 0) && a.every(isStr); }
  function optStr(v) { return v === undefined || v === null || isStr(v); }
  function num(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) < 1e12; }
  function wellFormed(d) {
    if (!d || typeof d !== "object" || Array.isArray(d) || d.v !== VERSION) return false;
    if (!strs(d.o, true) || !strs(d.pa, true) || !strs(d.ce, true) || !strs(d.ci)) return false;
    if (!isStr(d.j) || !isStr(d.me) || !optStr(d["do"]) || !optStr(d.dc) || !optStr(d.fv) || !optStr(d.t)) return false;
    if (d.cu !== undefined && !strs(d.cu, true)) return false;
    if (d.fd !== undefined && !(strs(d.fd) && d.fd.length === 3)) return false;
    if (d.fi !== undefined && !(Array.isArray(d.fi) && d.fi.length <= MAX_LIST && d.fi.every(function (r) {
      return Array.isArray(r) && r.length >= 8 && r.length <= 12 && num(r[0]) && isStr(r[1]) && optStr(r[2]) &&
        optStr(r[3]) && optStr(r[4]) && optStr(r[5]) && (r[6] === null || isStr(r[6]) || num(r[6]));
    }))) return false;
    if (d.e !== undefined) {
      var e = d.e;
      if (!e || typeof e !== "object" || Array.isArray(e) || !num(e.id) || !isStr(e.kind) ||
          !isStr(e.date) || !/^\d{4}-\d{2}-\d{2}/.test(e.date) || !(isStr(e.amount) || num(e.amount)) ||
          !isStr(e.category) || !optStr(e.note) || !optStr(e.owner) || !optStr(e.payer) || !optStr(e.currency) ||
          !optStr(e.remark) || !(optStr(e.twd) || num(e.twd)))
        return false;
    }
    return true;
  }

  /* ?d=... (or #d=...) -> the setup from the bot, or null. 2.13.0: the page reads it from the address's # part
   * too, which the browser never sends to GitHub; the bot still uses ?d= until that is tried on the phones. */
  function readSetup(where) {
    var m = /[?&#]d=([^&#]+)/.exec(where || "");
    if (!m || m[1].length > MAX_SETUP) return null;
    try {
      var d = JSON.parse(b64urlDecode(decodeURIComponent(m[1])));
      return wellFormed(d) ? d : null;
    } catch (e) {
      return null;
    }
  }

  function localDate(now) {
    now = now || new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
  }

  function plain(a) {
    return a === undefined || a === null ? "" : String(a).replace(/\.00$/, "");
  }

  /* the starting values of the form. 2.16.0: amount = 金額 (TWD); currency + orig = the 外幣 ("TWD" = 無).
   * Editing a foreign entry: 金額 is d.e.twd (a bot older than 2.16.0 sends none: empty, the bot keeps its TWD) */
  function initialState(d, now) {
    if (d.e) {
      var cur = d.e.currency || "TWD", foreign = cur !== "TWD";
      return { kind: d.e.kind === "income" ? "income" : "expense", date: d.e.date, owner: d.e.owner, payer: d.e.payer,
               fixed: d.e.fixed ? 1 : 0, category: d.e.category, note: d.e.note || "", currency: cur,
               amount: foreign ? plain(d.e.twd) : plain(d.e.amount), orig: foreign ? plain(d.e.amount) : "",
               remark: d.e.remark || "" };
    }
    return { kind: "expense", date: localDate(now), owner: d["do"] || d.o[0], payer: d.pa.indexOf(d.me) >= 0 ? d.me : d.pa[0],
             fixed: 0, category: firstCategory(d, "expense"), note: "", amount: "", currency: "TWD", orig: "", remark: "" };
  }

  function clean(a) {
    return String(a === undefined || a === null ? "" : a).replace(/,/g, "").trim();
  }

  function foreign(st) {
    return !!st.currency && st.currency !== "TWD";
  }

  /* the 外幣 choices: d.cu without TWD (無 is "TWD") */
  function foreignCurrencies(d) {
    return (d.cu || ["TWD"]).filter(function (c) { return c !== "TWD"; });
  }

  /* 2.9.0: a new expense starts on d.dc (DEFAULT_CATEGORY, 食) when it is in the list; an older bot sends no dc */
  function firstCategory(d, kind) {
    var cats = kind === "income" ? d.ci : d.ce;
    return kind === "expense" && d.dc && cats.indexOf(d.dc) >= 0 ? d.dc : cats[0];
  }

  /* switching 支出 <-> 收入 keeps what still makes sense */
  function switchKind(st, d, kind) {
    var s = Object.assign({}, st, { kind: kind });
    var cats = kind === "income" ? d.ci : d.ce;
    if (cats.indexOf(s.category) < 0) s.category = firstCategory(d, kind);
    if (kind === "income" && s.owner === d.j && !st._ownerTouched) s.owner = d.o.indexOf(d.me) >= 0 && d.me !== d.j ? d.me : d.o[1];
    if (kind === "expense" && s.owner !== d.j && !st._ownerTouched) s.owner = d["do"] || d.j;
    return s;
  }

  /* 2.12.0: the form has three kinds: 支出, 固定支出 (an expense with fixed = 1) and 收入 */
  function mode(st) {
    return st.kind === "income" ? "income" : (st.fixed ? "fixed" : "expense");
  }

  /* d.fd = [歸屬, 消費方式, 目錄] for 固定支出 (FIXED_DEFAULTS); a bot older than 2.12.0 sends none */
  function fixedDefaults(d) {
    var fd = Array.isArray(d.fd) ? d.fd : [d.j, d.j, "住"];
    return { owner: fd[0] || d.j, payer: fd[1] || d.j, category: fd[2] || "" };
  }

  /* picking 支出／固定支出／收入: 固定支出 fills its defaults (Joint｜Joint｜住), 支出 the usual ones
     (歸屬 = 記帳人, 記帳人付, 食); the date, 項目 and amounts stay */
  function switchMode(st, d, m) {
    var s;
    if (d.e && m !== "income") {             /* changing an entry: 支出 <-> 固定支出 only flips 消費類別 */
      s = st.kind === "income" ? switchKind(st, d, "expense") : Object.assign({}, st);
      s.fixed = m === "fixed" ? 1 : 0;
      delete s._item;
      return s;
    }
    if (m === "income") {
      s = switchKind(st, d, "income");
      s.fixed = 0;
    } else {
      s = Object.assign({}, st, { kind: "expense", _ownerTouched: false });
      if (m === "fixed") {
        var fd = fixedDefaults(d);
        s.fixed = 1;
        if (d.o.indexOf(fd.owner) >= 0) s.owner = fd.owner;
        if (d.pa.indexOf(fd.payer) >= 0) s.payer = fd.payer;
        if (fd.category && d.ce.indexOf(fd.category) >= 0) s.category = fd.category;
        else if (d.ce.indexOf(s.category) < 0) s.category = firstCategory(d, "expense");
      } else {
        s.fixed = 0;
        s.owner = d["do"] || d.j;
        s.payer = d.pa.indexOf(d.me) >= 0 ? d.me : d.pa[0];
        if (st.kind === "income" || st.fixed || d.ce.indexOf(s.category) < 0) s.category = firstCategory(d, "expense");
      }
    }
    delete s._item;
    return s;
  }

  function ownersFor(d, kind) {
    return d.o.slice();     /* 收入 can be Joint too (half each); a kid's income is the kid's */
  }

  var TAG = "記帳|", TAG2 = "記帳2|", MAX_QUERY = 256;

  /* is the bot (d.fv, the form version it expects) at least v (e.g. [2, 19, 0])? none sent = older than 2.13.0 */
  function botAtLeast(d, v) {
    var have = vt(d && d.fv);
    if (!have) return false;
    for (var i = 0; i < 3; i++) if (have[i] !== v[i]) return have[i] > v[i];
    return true;
  }

  /* inline mode: the answer as the inline query ledger/inline.py form_json reads.
   * 2.19.0 (Jimmy: the group form lost the 外幣 when 金額 was filled): to a bot of 2.19.0 or later "記帳2|", which
   * carries 金額 (TWD, may be empty) and the 外幣 apart, like the private form. To an older bot the old query: one
   * amount in one currency, 金額 in TWD, only when 金額 is empty the 外幣 (the bot converts) */
  function inlineQuery(st, d) {
    var p = payload(st, Object.assign({}, d, { e: null }));
    /* 2.18.0 (review): no field may hold a "|" or a line break, not only 項目 and 備註 (a hand-made ?d= could put
     * one in a name); the bot also rejects a query with the wrong number of fields */
    var safe = function (v) { return String(v === undefined || v === null ? "" : v).replace(/\|/g, "／").replace(/[\r\n]+/g, " "); };
    var head = [p.kind === "income" ? "i" : "e", p.date, p.owner, p.payer || "", p.fixed ? 1 : 0, p.category];
    var tail = p.remark ? [safe(p.remark)] : [];       /* 2.15.0: the 備註 is the last field, only when there is one */
    if (botAtLeast(d, [2, 19, 0])) {
      var f = foreign(st);
      return TAG2 + head.concat([clean(st.amount), f ? st.currency : "TWD", f ? clean(st.orig) : "", p.note || ""])
        .map(safe).concat(tail).join("|");
    }
    var cur = "TWD", amount = clean(st.amount);
    if (foreign(st) && (amount === "" || oldBot(d))) { cur = st.currency; amount = clean(st.orig); }
    return TAG + head.concat([cur, amount, p.note || ""]).map(safe).concat(tail).join("|");
  }

  var FUTURE_DAYS = 366;               /* ledger/parse.py FUTURE_DAYS */
  /* days from today to date; 0 when the bot did not say what today is */
  function daysAhead(today, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today || "")) return 0;
    return Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  }

  /* 2.19.0: today is the later of the bot's day in the link (d.t) and the phone's. The 🧾 表單 key in the private chat
   * keeps the link of the day it was sent: two days later d.t alone made today look like "the future" and every
   * entry was refused (只有固定支出可以記未來的日期). The bot checks the date again with its own today.
   * "" when the bot did not say what today is (older than 2.14.0): no date check here, as before */
  function today(d, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test((d && d.t) || "")) return "";
    var mine = localDate(now);
    return d.t > mine ? d.t : mine;
  }

  /* the same rules as the bot; returns an error text or "" (now: for the tests) */
  function check(st, d, now) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date || "")) return "請選日期";
    /* 2.14.0: only a 固定支出 (房貸、分期) may be dated after tomorrow; an edit may keep the date of a non-固定 entry
     * (one imported with its future date), like ledger/form.py validate (db.entry_date) */
    var kept = d.e && st.date === d.e.date && !(d.e.kind === "expense" && d.e.fixed);
    var ahead = kept ? 0 : daysAhead(today(d, now), st.date);
    if (ahead > 1 && !(st.kind === "expense" && st.fixed)) return "只有固定支出可以記未來的日期";
    if (ahead > FUTURE_DAYS) return "固定支出最多記到一年後";
    /* 2.16.0: 金額 (TWD) is needed unless a 外幣 is given (the bot converts it); a 外幣 needs its amount */
    var a = clean(st.amount), o = clean(st.orig), num = /^-?\d+(\.\d{1,2})?$/;
    if (foreign(st)) {
      if (foreignCurrencies(d).indexOf(st.currency) < 0) return "請選外幣";
      if (o === "") return "選了外幣就要填外幣金額";
      if (!num.test(o) || Number(o) === 0) return "外幣金額要是數字（不能是 0，最多兩位小數）";
      if (Math.abs(Number(o)) > 999999999999.99) return "外幣金額太大";
    }
    var onlyOrig = foreign(st) && oldBot(d);           /* a bot older than 2.16.0 gets the 外幣 only (payload) */
    if (!onlyOrig && (a !== "" || !foreign(st))) {
      if (!num.test(a) || Number(a) === 0) return "金額要是數字（不能是 0，最多兩位小數；退款按 ± 變負數）";
      if (Math.abs(Number(a)) > 9999999999.99) return "金額太大";
    }
    if (!onlyOrig && foreign(st) && a !== "" && (Number(a) < 0) !== (Number(o) < 0))
      return "金額和外幣要同是正數或同是負數（退款按 ±，兩個一起變負數）";
    if ((st.kind === "income" ? d.ci : d.ce).indexOf(st.category) < 0) return "請選目錄";
    if (ownersFor(d, st.kind).indexOf(st.owner) < 0) return st.kind === "income" ? "請選是誰的收入" : "請選費用歸屬";
    if (st.kind === "expense" && d.pa.indexOf(st.payer) < 0) return "請選消費方式";
    if ((st.note || "").length > 100) return "項目最多 100 字";
    if ((st.remark || "").length > 100) return "備註最多 100 字";
    if (d.x && inlineQuery(st, d).length > MAX_QUERY) return "內容太長，請縮短項目或備註";
    return "";
  }

  /* 2.16.0 review: is the bot older than 2.16.0? It says its form version in d.fv (2.13.0 and later; none = older)
   * and, to edit, a 2.16.0 bot sends e.twd. An old bot reads amount in `currency` and knows no 外幣 apart. */
  function oldBot(d) {
    var v = vt(d && d.fv);
    if (!v || v[0] < 2 || (v[0] === 2 && v[1] < 16)) return true;
    return !!(d.e && (d.e.twd === undefined || d.e.twd === null));
  }

  /* what sendData sends (ledger/form.py validate reads it). 2.16.0: with "orig", amount is TWD ("" = convert the
   * 外幣), currency is the 外幣 or TWD (無), orig the 外幣 amount. To a bot older than 2.16.0 the old meaning,
   * without "orig": the 外幣 amount in its currency when there is a 外幣 (the bot converts), else the TWD */
  function payload(st, d) {
    var f = foreign(st), old = oldBot(d);
    var p = { v: VERSION, op: d.e ? "edit" : "add", kind: st.kind, date: st.date, owner: st.owner,
              category: st.category, note: (st.note || "").trim(), amount: f && old ? clean(st.orig) : clean(st.amount),
              currency: f ? st.currency : "TWD", remark: (st.remark || "").trim() };   /* 2.15.0: 備註 */
    if (!old) p.orig = f ? clean(st.orig) : "";
    p.fv = FORM_VERSION;
    if (d.e) p.id = d.e.id;
    if (st.kind === "expense") { p.payer = st.payer; p.fixed = st.fixed ? 1 : 0; }
    return p;
  }

  /* ---- 固定支出 items: d.fi = [[id, name, category, owner, payer, currency, amount or null, amountFixed]] */
  function items(d) {
    return (Array.isArray(d.fi) ? d.fi : []).map(function (r) {
      return { id: r[0], name: r[1], category: r[2], owner: r[3], payer: r[4], currency: r[5] || "TWD",
               amount: r[6] === null || r[6] === undefined ? "" : String(r[6]), fixed: r[7] ? 1 : 0 };
    });
  }

  /* picking an item in 常用固定支出 fills the form (the amount stays editable). An item in a 外幣 fills the 外幣;
   * 金額 stays empty (the bot converts) */
  function applyItem(st, d, it) {
    var s = Object.assign({}, st, { kind: "expense", note: it.name, fixed: 1, currency: it.currency || "TWD",
                                    _item: it.id });
    if (d.ce.indexOf(it.category) >= 0) s.category = it.category;
    if (d.o.indexOf(it.owner) >= 0) { s.owner = it.owner; s._ownerTouched = true; }
    if (d.pa.indexOf(it.payer) >= 0) s.payer = it.payer;
    if (s.currency !== "TWD" && foreignCurrencies(d).indexOf(s.currency) < 0) s.currency = "TWD";
    if (foreign(s)) { s.orig = it.amount || ""; s.amount = ""; } else { s.orig = ""; s.amount = it.amount || ""; }
    return s;
  }

  /* "2.13.0" -> [2, 13, 0]; anything else -> null */
  function vt(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  /* the line under the title when the bot expects a newer page than this one (d.fv); "" when it is fine.
   * A bot older than 2.13.0 sends no fv: nothing to say. */
  function versionNote(d) {
    var want = vt(d && d.fv), mine = vt(FORM_VERSION);
    if (!want) return "";
    for (var i = 0; i < 3; i++) {
      if (want[i] > mine[i]) return "⚠️ 這個表單是 v" + FORM_VERSION + "，記帳 bot 要 v" + d.fv +
        "：在 Studio 執行 sudo ./setup_ledger.command --step form 會自動換上新版。照樣可以記。";
      if (want[i] < mine[i]) return "";
    }
    return "";
  }

  function flipSign(a) {
    var t = String(a || "").trim();
    return t.charAt(0) === "-" ? t.slice(1) : "-" + t;
  }

  /* 2.16.0: ± flips 金額 and the 外幣 amount together (a refund is negative in both); an empty one stays empty
   * unless both are */
  function flipMoney(st) {
    var s = Object.assign({}, st), a = clean(st.amount), o = foreign(st) ? clean(st.orig) : "";
    if (a === "" && o === "") { s.amount = flipSign(a); return s; }
    if (a !== "") s.amount = flipSign(a);
    if (o !== "") s.orig = flipSign(o);
    return s;
  }

  /* the 送出 button's amount: 金額 (TWD), or the 外幣 when 金額 is empty (or the bot is older than 2.16.0: it gets
   * only the 外幣) */
  function shownMoney(st, d) {
    if (foreign(st) && d && oldBot(d)) return money(st.orig, st.currency);
    return money(st.amount) || (foreign(st) ? money(st.orig, st.currency) : "");
  }

  /* "修改 11/16 午餐" (2.16.0: no #編號 anywhere on the page) */
  function editTitle(e) {
    return "修改 " + String(e.date || "").slice(5, 10).replace("-", "/") + " " + (e.note || e.category || "");
  }

  /* ---- 2.16.0 dark mode. Inside Telegram the page follows Telegram's theme (colorScheme, themeParams; the
   * themeChanged event); outside it, CSS prefers-color-scheme (index.html). The page background is the darker of
   * Telegram's bg_color / secondary_bg_color and the fields the lighter one, in both schemes. */
  var HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function lum(c) {
    var h = c.slice(1);
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    var n = parseInt(h, 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  }
  function themeVars(scheme, tp) {
    tp = tp && typeof tp === "object" ? tp : {};
    var ok = function (c) { return typeof c === "string" && HEX.test(c); };
    var v = {}, a = tp.bg_color, b = tp.secondary_bg_color;
    if (ok(a) && ok(b)) {
      var darker = lum(a) <= lum(b);
      v["--bg"] = darker ? a : b;
      v["--card"] = darker ? b : a;
    }
    var map = { text_color: "--ink", hint_color: "--hint", button_color: "--acc", button_text_color: "--acc-ink",
                section_separator_color: "--line" };
    Object.keys(map).forEach(function (k) { if (ok(tp[k])) v[map[k]] = tp[k]; });
    return { cls: scheme === "dark" || scheme === "light" ? scheme : "", vars: v };
  }
  var THEME_VARS = ["--bg", "--card", "--ink", "--hint", "--acc", "--acc-ink", "--line"];
  /* tg outside Telegram (a browser) has platform "unknown": the phone's setting decides (CSS) */
  function inTelegram(tg) {
    return !!(tg && tg.platform && tg.platform !== "unknown");
  }

  function money(a, cur) {
    var n = Number(String(a || "").replace(/,/g, ""));
    if (!isFinite(n) || n === 0) return "";
    return (cur && cur !== "TWD" ? cur + " " : "NT$") + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  var api = { readSetup: readSetup, initialState: initialState, switchKind: switchKind, ownersFor: ownersFor,
              mode: mode, switchMode: switchMode, fixedDefaults: fixedDefaults,
              check: check, payload: payload, money: money, HINT: HINT, localDate: localDate, VERSION: VERSION,
              items: items, applyItem: applyItem, inlineQuery: inlineQuery, TAG: TAG, flipSign: flipSign, wellFormed: wellFormed,
              FORM_VERSION: FORM_VERSION, MAX_SETUP: MAX_SETUP, MAX_LIST: MAX_LIST, versionNote: versionNote, flipMoney: flipMoney, shownMoney: shownMoney,
              editTitle: editTitle, themeVars: themeVars, inTelegram: inTelegram, foreignCurrencies: foreignCurrencies,
              oldBot: oldBot, botAtLeast: botAtLeast, today: today, TAG2: TAG2 };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LedgerForm = api;

  /* ------------------------------------------------------------------ the page */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* 2.16.0: Telegram's light / dark theme on the page (see themeVars); nothing outside Telegram (CSS decides) */
  function applyTheme(tg) {
    var r = document.documentElement;
    var t = inTelegram(tg) ? themeVars(tg.colorScheme, tg.themeParams) : { cls: "", vars: {} };
    r.classList.remove("dark", "light");
    if (t.cls) r.classList.add(t.cls);
    THEME_VARS.forEach(function (k) {
      if (t.vars[k]) r.style.setProperty(k, t.vars[k]); else r.style.removeProperty(k);
    });
  }

  function start() {
    var tg = root.Telegram && root.Telegram.WebApp;
    var app = document.getElementById("app");
    applyTheme(tg);
    if (tg && tg.onEvent) tg.onEvent("themeChanged", function () { applyTheme(tg); if (update) update(); });
    var update = null;
    var d = readSetup(root.location.search + root.location.hash);
    if (!d) {
      app.appendChild(el("p", "msg", "這個表單要從 Telegram 開：私訊 bot 時按鍵盤「🧾 表單」，群組裡在輸入框打 @bot 名稱再點「📝 開記帳表單」。"));
      return;
    }
    if (tg) { tg.ready(); tg.expand(); }
    var st = initialState(d);
    var err = el("p", "err", "");

    function chips(items, cur, onPick, labelOf) {
      var box = el("div", "chips");
      items.forEach(function (it) {
        var b = el("button", "chip" + (it === cur ? " on" : ""), labelOf ? labelOf(it) : it);
        b.type = "button";
        b.addEventListener("click", function () { onPick(it); });
        box.appendChild(b);
      });
      return box;
    }

    function field(label, node) {
      var f = el("div", "field");
      f.appendChild(el("label", "", label));
      f.appendChild(node);
      return f;
    }

    function render() {
      app.textContent = "";
      var head = el("div", "head");
      head.appendChild(el("h1", "", d.e ? editTitle(d.e) : "記一筆"));
      if (d.e) {
        var was = d.e.currency && d.e.currency !== "TWD";
        head.appendChild(el("span", "sub", "原本：" + (was ? (money(d.e.twd) ? money(d.e.twd) + "（" + money(d.e.amount, d.e.currency) + "）"
                                                          : money(d.e.amount, d.e.currency))
                                                     : money(d.e.amount))));
      }
      app.appendChild(head);
      if (versionNote(d)) app.appendChild(el("p", "warn", versionNote(d)));
      app.appendChild(chips(["expense", "fixed", "income"], mode(st), function (m) { st = switchMode(st, d, m); render(); },
                            function (m) { return { expense: "支出", fixed: "固定支出", income: "收入" }[m]; })).className = "chips seg three";
      var fis = items(d);
      if (!d.e && fis.length && mode(st) === "fixed") {
        var pick = el("select", "pick");
        var none = el("option", "", "📌 常用固定支出（點選帶入）"); none.value = "";
        pick.appendChild(none);
        fis.forEach(function (it) {
          var o = el("option", "", it.name + (it.amount ? "　" + money(it.amount, it.currency) : ""));
          o.value = String(it.id);
          if (st._item === it.id) o.selected = true;
          pick.appendChild(o);
        });
        pick.addEventListener("change", function () {
          var it = fis.filter(function (x) { return String(x.id) === pick.value; })[0];
          if (it) { st = applyItem(st, d, it); render(); }
        });
        app.appendChild(field("常用固定支出", pick));
      }

      var date = el("input"); date.type = "date"; date.value = st.date;
      date.addEventListener("change", function () { st.date = date.value; update(); });
      app.appendChild(field("日期", date));

      app.appendChild(field(st.kind === "income" ? "誰的收入" : "費用歸屬",
        chips(ownersFor(d, st.kind), st.owner, function (o) { st.owner = o; st._ownerTouched = true; render(); })));
      /* 2.19.0: what 📝 記一筆 says too: a Joint income counts half for each adult (d.pa = Joint + the adults) */
      if (st.kind === "income" && st.owner === d.j && d.pa[0] === d.j && d.pa.length > 2)
        app.appendChild(el("p", "foot", d.j + " 的收入：" + d.pa.slice(1).join("、") + " 各算一半"));
      if (st.kind === "expense") {
        app.appendChild(field("消費方式", chips(d.pa, st.payer, function (p) { st.payer = p; render(); })));
      }
      var catSel = el("select");
      (st.kind === "income" ? d.ci : d.ce).forEach(function (c) {
        var o = el("option", "", c + (HINT[c] ? "　" + HINT[c] : "")); o.value = c;
        if (c === st.category) o.selected = true;
        catSel.appendChild(o);
      });
      catSel.addEventListener("change", function () { st.category = catSel.value; update(); });
      app.appendChild(field(st.kind === "income" ? "收入類別" : "目錄", catSel));

      var note = el("input"); note.type = "text"; note.maxLength = 100; note.value = st.note; note.placeholder = "例：午餐";
      note.addEventListener("input", function () { st.note = note.value; });
      app.appendChild(field("項目", note));

      /* 2.16.0 (Jimmy): 金額 is always TWD; the 外幣 below is only recorded (with 金額 empty the bot converts it) */
      var row = el("div", "money");
      var ntd = el("span", "ntd", "NT$");
      var amt = el("input"); amt.type = "text"; amt.inputMode = "decimal"; amt.value = st.amount;
      amt.placeholder = foreign(st) ? "空白＝用匯率換算" : "0";
      if (foreign(st) && oldBot(d)) { amt.value = ""; amt.disabled = true; }
      amt.className = "amount " + st.kind;
      amt.addEventListener("input", function () { st.amount = amt.value; update(); });
      /* 2.11.0: a refund is a negative amount; the iPhone number pad has no minus key, so ± flips the sign */
      var flip = el("button", "sign", "±"); flip.type = "button";
      flip.addEventListener("click", function () {
        st = flipMoney(st); render();
      });
      row.appendChild(ntd); row.appendChild(amt); row.appendChild(flip);
      app.appendChild(field("金額（台幣，記帳用）", row));
      if (clean(st.amount).charAt(0) === "-" || (foreign(st) && clean(st.orig).charAt(0) === "-"))
        app.appendChild(el("p", "foot", st.kind === "income" ? "負數＝收入扣回" : "負數＝退款／折抵：從這個目錄的支出扣掉"));

      var frow = el("div", "money");
      var cur = el("select", "cur");
      [["TWD", "無"]].concat(foreignCurrencies(d).map(function (c) { return [c, c]; })).forEach(function (c) {
        var o = el("option", "", c[1]); o.value = c[0];
        if (c[0] === (st.currency || "TWD")) o.selected = true;
        cur.appendChild(o);
      });
      cur.addEventListener("change", function () {
        st.currency = cur.value;
        if (!foreign(st)) st.orig = "";
        render();
      });
      var orig = el("input"); orig.type = "text"; orig.inputMode = "decimal"; orig.value = foreign(st) ? (st.orig || "") : "";
      orig.placeholder = foreign(st) ? "外幣金額" : "先選幣別"; orig.disabled = !foreign(st);
      orig.addEventListener("input", function () { st.orig = orig.value; update(); });
      frow.appendChild(cur); frow.appendChild(orig);
      app.appendChild(field("外幣（選填，只記錄，不列入記帳）", frow));
      /* 2.15.0: 備註, after 金額 like the old sheet's column S; yours to write (who recorded it is not put here) */
      var remark = el("input"); remark.type = "text"; remark.maxLength = 100; remark.value = st.remark || "";
      remark.placeholder = "選填";
      remark.addEventListener("input", function () { st.remark = remark.value; });
      app.appendChild(field("備註", remark));
      if (mode(st) === "fixed") {
        var fd = fixedDefaults(d);
        app.appendChild(el("p", "foot", "固定支出預設 " + fd.owner + "｜" + fd.payer + (fd.category ? "｜" + fd.category : "") +
          (fis.length && !d.e ? "；選「常用固定支出」的項目會帶入它的設定和金額" : "") + "（項目在 App 的固定支出頁或 /items 維護）"));
      }
      if (d.x) app.appendChild(el("p", "foot", "按下方按鈕後回到聊天：點輸入框上方跳出的預覽卡片，才會記到這個聊天裡"));
      if (foreign(st) && oldBot(d)) {
        app.appendChild(el("p", "foot", "記帳 bot 是 2.16.0 以前的版本：有外幣時只送外幣，bot 用臺灣銀行匯率換成台幣（金額不能自己填）"));
      } else if (foreign(st)) {
        app.appendChild(el("p", "foot", d.x && !botAtLeast(d, [2, 19, 0])
          ? "群組裡（inline）只送一個金額：金額空白就送外幣，bot 用臺灣銀行當天的即期賣出匯率換成台幣；金額有填就只記台幣"
          : "金額空白：bot 用臺灣銀行當天的即期賣出匯率把外幣換成台幣；有填就照你填的台幣記。刷卡的話，匯入信用卡帳單後會改成實際刷卡金額"));
      }

      app.appendChild(err);
      if (d.e) {
        var del = el("button", "del", "🗑 刪除這筆"); del.type = "button";
        del.addEventListener("click", function () {
          var go = function (yes) { if (yes) send({ v: VERSION, fv: FORM_VERSION, op: "del", id: d.e.id }); };
          var ask = "刪除這筆（" + editTitle(d.e).slice(3) + "）？";
          if (tg && tg.showConfirm) tg.showConfirm(ask, go); else go(root.confirm(ask));
        });
        app.appendChild(del);
      }
      app.appendChild(el("p", "foot", "選項由 bot 帶入；送出後 bot 會再檢查一次"));
      app.appendChild(el("p", "ver", "表單 v" + FORM_VERSION));
      if (!tg) app.appendChild(el("p", "msg", "（不在 Telegram 裡，送不出去）"));
      update();
    }

    function label() {
      if (d.e) return "儲存修改";
      var m = shownMoney(st, d);
      if (d.x) return "下一步：送到聊天" + (m ? "　" + m : "");
      return ({ income: "記收入", fixed: "記固定支出" }[mode(st)] || "記一筆") + (m ? "　" + m : "");
    }

    update = function () {
      err.textContent = "";
      if (!tg) return;
      tg.MainButton.setParams({ text: label(), color: st.kind === "income" ? "#34a853" : (tg.themeParams.button_color || "#2481cc"),
                                is_visible: true, is_active: true });
    };

    function send(p) {
      if (d.x) {                         // inline mode (a group): back to the chat's input with the answer
        if (!tg || !tg.switchInlineQuery || !tg.isVersionAtLeast || !tg.isVersionAtLeast("6.7")) {
          err.textContent = "這個 Telegram 版本太舊，請更新 Telegram，或在聊天裡用「📝 記一筆」";
          return;
        }
        tg.switchInlineQuery(inlineQuery(st, d));
        return;
      }
      var s = JSON.stringify(p);
      if (tg) tg.sendData(s);            // closes the form; the bot answers in the chat
    }

    if (tg) {
      tg.MainButton.onClick(function () {
        var e = check(st, d);
        if (e) { err.textContent = e; if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("error"); return; }
        send(payload(st, d));
      });
    }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : this);
