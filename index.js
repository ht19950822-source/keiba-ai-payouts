/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-21-rebuild-21";

const HISTORY_VENUES = {

  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉"

};


/* =========================================================
 * 共通JSON
 * ======================================================= */

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {
      status,

      headers: {

        "Content-Type":
          "application/json; charset=UTF-8",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,HEAD,OPTIONS",

        "Access-Control-Allow-Headers":
          "*",

        "Cache-Control":
          "no-store"

      }

    }

  );

}


/* =========================================================
 * OPTIONS
 * ======================================================= */

function handleOptions() {

  return new Response(
    null,
    {
      status: 204,

      headers: {

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,PUT,DELETE,HEAD,OPTIONS",

        "Access-Control-Allow-Headers":
          "*",

        "Access-Control-Max-Age":
          "86400"

      }
    }
  );

}


/* =========================================================
 * エラー
 * ======================================================= */

function errorResponse(
  message,
  status = 500
) {

  return json(

    {
      ok: false,
      error:
        String(
          message ||
          "Unknown Error"
        )
    },

    status

  );

}


/* =========================================================
 * 文字列正規化
 * ======================================================= */

function normalizeText(
  value
) {

  return String(
    value || ""
  )

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&amp;/gi,
      "&"
    )

    .replace(
      /&lt;/gi,
      "<"
    )

    .replace(
      /&gt;/gi,
      ">"
    )

    .replace(
      /&quot;/gi,
      '"'
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    .replace(
      /&#x27;/gi,
      "'"
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* =========================================================
 * HTMLタグ除去
 * ======================================================= */

function stripHtml(
  html
) {

  return String(
    html || ""
  )

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    .replace(
      /<[^>]+>/g,
      " "
    );

}


/* =========================================================
 * 数値変換
 * ======================================================= */

function toNumberOrNull(
  value
) {

  const text =
    normalizeText(
      value
    );

  if (!text) {
    return null;
  }

  const number =
    Number(
      text.replace(
        /,/g,
        ""
      )
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;

}


/* =========================================================
 * 日付文字列
 * ======================================================= */

function getDaysInMonth(
  year,
  month
) {

  return new Date(
    year,
    month,
    0
  ).getDate();

}


/* =========================================================
 * 日付チェック
 * ======================================================= */

function isValidDateString(
  date
) {

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date || ""
    )
  ) {

    return false;

  }

  const parts =
    date.split("-");

  const year =
    Number(parts[0]);

  const month =
    Number(parts[1]);

  const day =
    Number(parts[2]);

  if (
    year < 1900 ||
    year > 2100
  ) {

    return false;

  }

  if (
    month < 1 ||
    month > 12
  ) {

    return false;

  }

  const maxDay =
    getDaysInMonth(
      year,
      month
    );

  return (
    day >= 1 &&
    day <= maxDay
  );

}


/* =========================================================
 * JRA HTML取得
 *
 * JRAはShift_JISのページがあるため
 * arrayBufferからTextDecoderで変換する。
 * ======================================================= */

async function fetchJRAHtmlOnce(
  url
) {

  const response =
    await fetch(

      url,

      {
        method: "GET",

        headers: {

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "ja,en-US;q=0.9,en;q=0.8",

          "Cache-Control":
            "no-cache"

        }

      }

    );

  if (
    !response.ok
  ) {

    throw new Error(
      `JRA取得失敗: HTTP ${response.status} ${url}`
    );

  }

  const buffer =
    await response.arrayBuffer();

  const decoder =
    new TextDecoder(
      "shift_jis"
    );

  return decoder.decode(
    buffer
  );

}


/* =========================================================
 * JRA URLを絶対URLへ変換
 * ======================================================= */

function extractJRAInternalCnames(
  html,
  targetPrefix
) {

  const found =
    new Set();

  if (!html) {
    return [];
  }

  /*
   * CNAME=形式
   */

  const cnamePattern =
    /CNAME\s*=\s*["']?([^"'&<>\s#]+)["']?/gi;

  let match;

  while (
    (match =
      cnamePattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/%26/gi, "&")
        .trim();

    cname =
      cname
        .split('"')[0]
        .split("'")[0]
        .split(">")[0]
        .split("<")[0];

    if (
      cname
        .toLowerCase()
        .startsWith(
          targetPrefix.toLowerCase()
        )
    ) {

      found.add(
        cname
      );

    }
  }


  /*
   * JavaScript等に直接書かれている形式
   */

  const directPattern =
    new RegExp(
      `(${targetPrefix}[^"'<>\\s]+)`,
      "gi"
    );

  while (
    (match =
      directPattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(
          /&amp;/gi,
          "&"
        )
        .trim();

    cname =
      cname
        .split('"')[0]
        .split("'")[0]
        .split(">")[0]
        .split("<")[0]
        .split(")")[0]
        .split(";")[0];

    if (
      cname
        .toLowerCase()
        .startsWith(
          targetPrefix.toLowerCase()
        )
    ) {

      found.add(
        cname
      );

    }
  }


  return Array.from(
    found
  );
}


/* =========================================================
 * JRAレースリンク抽出
 * ======================================================= */

function parseJRACname(url) {

  try {

    const u =
      new URL(url);

    const cname =
      u.searchParams.get("CNAME") || "";

    const m =
      cname.match(
        /pw01sde(\d{4})(\d{8})(\d{2})(\d{8})(?:\/[^\/]+)?$/i
      );

    if (!m) {
      return null;
    }

    return {

      type: "result",

      venueCode:
        m[1].slice(-2),

      meetingDate:
        m[2],

      raceNo:
        Number(m[3]),

      date:
        `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}`,

      url

    };

  } catch {

    return null;

  }

}

function extractCourseInfo(
  html
) {
  const result = { surface: "", distance: null, raw: "" };
  // 全角の数字・記号（１，６００ｍ など）を半角に揃える
  const T = normalizeText(stripHtml(html)).normalize("NFKC");
  const validDistance = n => Number.isFinite(n) && n >= 800 && n <= 4500;
  const toDist = v => Number(String(v).replace(/[,，]/g, ""));
  const SURF = /(ダート|芝|障害|ダ(?!ート))/;
  const toSurface = w => (w === "芝" ? "芝" : w === "障害" ? "障害" : w ? "ダート" : "");

  // 診断用：コース情報の周辺の文字（取得できなかったときに原因を確認できる）
  const ci = T.search(/コース/);
  const near = ci >= 0 ? T.slice(ci, ci + 90) : "";
  result.raw = near;

  // 距離①：「コース：」の直後
  let m = near.match(/([\d,]{3,6})\s*(?:メートル|m|M)/);
  if (m && validDistance(toDist(m[1]))) result.distance = toDist(m[1]);

  // 距離②：全体から「数字＋メートル/m」を順に探し、距離として妥当な最初のもの
  let distIndex = -1;
  if (!result.distance) {
    for (const mm of T.matchAll(/([\d,]{3,6})\s*(?:メートル|m|M)/g)) {
      if (validDistance(toDist(mm[1]))) { result.distance = toDist(mm[1]); distIndex = mm.index; break; }
    }
  }
  // 距離③：「芝1,600」「ダート1200」「芝・外 1,600」型
  if (!result.distance) {
    const mm = T.match(/(?:芝|ダート|ダ|障害)[^\d]{0,8}([\d,]{4,6})/);
    if (mm && validDistance(toDist(mm[1]))) result.distance = toDist(mm[1]);
  }

  // 芝・ダート①：「コース：」の周辺（括弧の中の順序が違っても拾う）
  m = near.match(SURF);
  if (m) result.surface = toSurface(m[1]);
  // ②：距離の前後
  if (!result.surface && result.distance) {
    const k = distIndex >= 0 ? distIndex : T.search(new RegExp(String(result.distance).replace(/(\d)(\d{3})$/, "$1,?$2") + "\\s*(?:メートル|m|M)"));
    if (k >= 0) {
      const around = T.slice(Math.max(0, k - 40), k + 60);
      const mm = around.match(SURF);
      if (mm) result.surface = toSurface(mm[1]);
    }
  }
  // ③：ページ冒頭付近（ナビゲーションなど無関係な文字が混ざりにくい範囲）
  if (!result.surface) {
    const mm = T.slice(0, 1500).match(SURF);
    if (mm) result.surface = toSurface(mm[1]);
  }
  return result;
}

/* =========================================================
 * レース名
 * ======================================================= */

function extractRaceName(
  html
) {

  const patterns = [

    /<span[^>]*class=["'][^"']*\brace_name\b[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i,

    /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );

    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        stripHtml(
          match[1]
        )
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * 天候
 * ======================================================= */

function extractWeather(
  html
) {

  const patterns = [

    /<li[^>]*class=["'][^"']*\bweather\b[^"']*["'][\s\S]*?<span[^>]*class=["'][^"']*\btxt\b[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,

    /天候[：:]\s*([^ <]+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        match[1]
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * 馬場状態
 * ======================================================= */

function extractTrackCondition(
  html
) {

  const patterns = [

    /<li[^>]*class=["'][^"']*\bdurt\b[^"']*["'][\s\S]*?<span[^>]*class=["'][^"']*\btxt\b[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,

    /馬場[：:]\s*([^ <]+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      normalizeText(
        match[1]
      );


    if (value) {
      return value;
    }

  }


  return "";

}


/* =========================================================
 * TDセルの文字列取得
 * ======================================================= */

function getCellText(
  row,
  className
) {

  const escaped =
    className.replace(
      /[-/\\^$*+?.()|[\]{}]/g,
      "\\$&"
    );


  const re =
    new RegExp(

      `<td[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,

      "i"

    );


  const match =
    row.match(
      re
    );


  if (!match) {
    return "";
  }


  return normalizeText(
    stripHtml(
      match[1]
    )
  );

}


/* =========================================================
 * 枠番
 * ======================================================= */

function extractFrameNumber(
  row
) {

  const patterns = [

    /<td[^>]*class=["'][^"']*\bwaku\b[^"']*["'][^>]*>[\s\S]*?<img[^>]*alt=["']枠(\d+)[^"']*["']/i,

    /枠(\d+)/i

  ];


  for (
    const pattern of patterns
  ) {

    const match =
      row.match(
        pattern
      );


    if (!match) {
      continue;
    }


    const value =
      Number(
        match[1]
      );


    if (
      Number.isFinite(
        value
      )
    ) {

      return value;

    }

  }


  return null;

}
/* =========================================================
 * 第3回 / 10
 * 馬データ解析・JRA結果解析
 * ======================================================= */


/* =========================================================
 * 馬名取得
 * ======================================================= */

function extractHorseName(row) {
  const horseCell = String(row || "").match(
    /<td[^>]*class=["'][^"']*\bhorse\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
  );
  if (!horseCell) return "";

  const inner = horseCell[1];
  const anchorPattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(inner)) !== null) {
    const name = normalizeText(stripHtml(match[1]));
    if (name) return name;
  }

  const plain = normalizeText(stripHtml(inner));
  return plain;
}


/* =========================================================
 * 性齢解析
 * ======================================================= */

function parseSexAge(
  value
) {

  const text =
    normalizeText(
      value
    );


  const ageMatch =
    text.match(
      /(\d+)/
    );


  const age =
    ageMatch
      ? Number(
          ageMatch[1]
        )
      : null;


  const sex =
    text
      .replace(
        /\d/g,
        ""
      )
      .trim();


  return {

    sex,

    age

  };

}


/* =========================================================
 * 馬体重解析
 * ======================================================= */

function parseHorseWeight(
  value
) {

  const text =
    normalizeText(
      value
    );


  const match =
    text.match(
      /^(\d+)\s*(?:\(([+-]?\d+)\))?$/
    );


  if (!match) {

    return {

      horseWeight:
        null,

      horseWeightChange:
        null

    };

  }


  return {

    horseWeight:
      Number(
        match[1]
      ),

    horseWeightChange:
      match[2] != null
        ? Number(
            match[2]
          )
        : null

  };

}


/* =========================================================
 * コーナー情報
 * ======================================================= */

function extractCornerInfo(
  row
) {

  const result = [];


  const re =
    /title=["'][^"']*(?:コーナー|corner)[^"']*["'][^>]*>\s*([^<]+)\s*</gi;


  let match;


  while (
    (match = re.exec(
      row
    )) !== null
  ) {

    const value =
      normalizeText(
        match[1]
      );


    if (value) {

      result.push(
        value
      );

    }

  }


  return [
    ...new Set(
      result
    )
  ];

}


/* =========================================================
 * JRA馬1頭分の解析
 * ======================================================= */


/* 馬ごとのコーナー通過順位（数値の配列）。表のcorner列(li/div/テキスト)→title属性の順に試す */
function extractCornerPositions(row) {
  const src = String(row || "");
  const cell = src.match(/<td[^>]*class="[^"]*\bcorner\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
  let vals = [];
  if (cell) {
    const body = cell[1];
    const lis = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => normalizeText(stripHtml(m[1])));
    vals = lis.map(t => (t.match(/\d{1,2}/g) || []).pop()).filter(Boolean).map(Number);
    if (!vals.length) vals = (normalizeText(stripHtml(body)).match(/\d{1,2}/g) || []).map(Number);
  }
  if (!vals.length) {
    const re = /title=["'][^"']*コーナー[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*(\d{1,2})/gi;
    let m;
    while ((m = re.exec(src)) !== null) vals.push(Number(m[1]));
  }
  return vals.filter(v => v >= 1 && v <= 18).slice(0, 4);
}

/* レースのラップ（ハロンタイム）。「ハロンタイム」の後ろの 10〜20秒台の数値の並び */
function extractJRALap(html) {
  const text = String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  for (const label of ["ハロンタイム", "ラップタイム"]) {
    let from = 0;
    while (true) {
      const i = text.indexOf(label, from);
      if (i < 0) break;
      const seg = text.slice(i + label.length, i + label.length + 420);
      const nums = [];
      const re = /(\d{1,2}\.\d)(?!\d)/g;
      let m, lastEnd = 0;
      while ((m = re.exec(seg)) !== null) {
        const gap = seg.slice(lastEnd, m.index);
        if (nums.length && /[^\s\-－―–~〜,、.:：]/.test(gap)) break;
        const v = Number(m[1]);
        if (v < 9 || v > 20) { if (nums.length) break; lastEnd = re.lastIndex; continue; }
        nums.push(v);
        lastEnd = re.lastIndex;
      }
      if (nums.length >= 5) return nums;
      from = i + label.length;
    }
  }
  return null;
}

/* 診断：ラップ・通過順位がページのどこにどう書かれているか */
async function handleDebugResult(request) {
  const url = new URL(request.url);
  const cname = String(url.searchParams.get("cname") || "");
  if (!/^pw01sde\d{4}\d{8}\d{2}\d{8}\/[0-9A-Za-z]{1,4}$/.test(cname)) return errorResponse("cname=pw01sde… を指定してください。", 400);
  try {
    const html = await fetchJRAHtml(`${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`);
    const flat = s => String(s || "").replace(/\s+/g, " ");
    const at = (needle, w) => { const i = html.indexOf(needle); return i < 0 ? "" : flat(html.slice(Math.max(0, i - 80), i + w)); };
    const rows = (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(t => /accessU\.html/i.test(t));
    return json({
      ok: true, htmlLength: html.length,
      hasHalon: html.includes("ハロンタイム"), hasLapLabel: html.includes("ラップ"),
      lap: extractJRALap(html),
      lapSnippet: at("ハロンタイム", 700) || at("ラップ", 700),
      cornerLabelSnippet: at("コーナー", 500),
      rowCount: rows.length,
      firstRowCorner: rows.slice(0, 6).map(r => extractCornerPositions(r)),
      cornerCellHtml: flat((rows[0] || "").match(/<td[^>]*class="[^"]*\bcorner\b[^"]*"[\s\S]*?<\/td>/i)?.[0] || "").slice(0, 700),
      firstRowHtml: flat(rows[0] || "").slice(0, 1800)
    });
  } catch (error) {
    return errorResponse(error?.message || error, 500);
  }
}

function parseJRAHorseRow(
  row
) {

  const horseName =
    extractHorseName(
      row
    );


  /*
   * 馬名がない行は
   * 馬データではない。
   *
   * これにより
   * 「1:32.9」
   * 「不良」
   * 「稍重」
   * などの誤認識を防ぐ。
   */

  if (!horseName) {
    return null;
  }


  const finishText =
    getCellText(
      row,
      "place"
    );


  const numberText =
    getCellText(
      row,
      "num"
    );


  const weightText =
    getCellText(
      row,
      "weight"
    );


  const jockey =
    getCellText(
      row,
      "jockey"
    )
      .replace(
        /^☆\s*/,
        ""
      )
      .trim();


  const trainer =
    getCellText(
      row,
      "trainer"
    );


  const time =
    getCellText(
      row,
      "time"
    );


  const estimatedLast3F =
    toNumberOrNull(
      getCellText(
        row,
        "f_time"
      )
    );


  const sexAgeText =
    getCellText(
      row,
      "age"
    );


  const sexAge =
    parseSexAge(
      sexAgeText
    );


  const horseWeight =
    parseHorseWeight(
      getCellText(
        row,
        "h_weight"
      )
    );


  /*
   * 人気は保存する。
   *
   * ただしAI入力では使用しない。
   */

  const popularity =
    toNumberOrNull(
      getCellText(
        row,
        "pop"
      )
    );


  return {

    finishPosition:
      toNumberOrNull(
        finishText
      ),

    frame:
      extractFrameNumber(
        row
      ),

    horseNumber:
      toNumberOrNull(
        numberText
      ),

    horseName,

    sex:
      sexAge.sex,

    age:
      sexAge.age,

    weight:
      toNumberOrNull(
        weightText
      ),

    jockey,

    trainer,

    time,

    estimatedLast3F,

    horseWeight:
      horseWeight.horseWeight,

    horseWeightChange:
      horseWeight.horseWeightChange,

    corner: extractCornerPositions(row),

    popularity

  };

}


/* =========================================================
 * JRA結果ページ解析
 * ======================================================= */

function extractJRAResultInfo(
  html
) {

  const result = {

    raceName:
      extractRaceName(
        html
      ),

    surface:
      "",

    distance:
      null,

    weather:
      extractWeather(
        html
      ),

    trackCondition:
      extractTrackCondition(
        html
      ),

    horses:
      []

  };


  const course =
    extractCourseInfo(
      html
    );


  result.surface =
    course.surface;


  result.distance =
    course.distance;


  /*
   * tbodyごとに解析する。
   */

  const tbodyMatches =
    String(
      html || ""
    ).match(
      /<tbody[\s\S]*?<\/tbody>/gi
    ) || [];


  for (
    const tbody of tbodyMatches
  ) {

    const rows =
      tbody.match(
        /<tr[\s\S]*?<\/tr>/gi
      ) || [];


    for (
      const row of rows
    ) {

      const horse =
        parseJRAHorseRow(
          row
        );


      if (horse) {

        result.horses.push(
          horse
        );

      }

    }

  }


  return result;

}


/* =========================================================
 * 1レース取得
 * ======================================================= */

function raceResultToRows(
  result
) {

  const rows = [];

  /*
   * raceNumber が存在しない場合は
   * raceNo から取得する。
   *
   * 現在のJRAデータでは raceNo が
   * 入っているため、これで undefined を防ぐ。
   */
  const raceNumber =
    result.raceNumber ??
    result.raceNo;

  for (
    const horse of
      result.horses || []
  ) {

    rows.push({

      date:
        result.date,

      raceId:
        makeRaceId(
          result.date,
          result.venueCode,
          raceNumber
        ),

      raceNumber:
        raceNumber,

      place:
        result.venue,

      venueCode:
        result.venueCode,

      raceName:
        result.raceName,

      surface:
        result.surface,

      distance:
        result.distance,

      weather:
        result.weather,

      going:
        result.trackCondition,

      finish:
        horse.finishPosition,

      frame:
        horse.frame,

      number:
        horse.horseNumber,

      horse:
        horse.horseName,

      age:
        horse.age,

      sex:
        horse.sex,

      weight:
        horse.weight,

      jockey:
        horse.jockey,

      trainer:
        horse.trainer,

      horseWeight:
        horse.horseWeight,

      horseWeightChange:
        horse.horseWeightChange,

      time:
        horse.time,

      estimatedLast3F:
        horse.estimatedLast3F,

      corner:
        horse.corner,

      /*
       * 保存はする。
       * AI入力には使用しない。
       */
      popularity:
        horse.popularity

    });

  }

  return rows;
}

/* =========================================================
 * レースID生成
 * ======================================================= */

function makeRaceId(
  date,
  venueCode,
  raceNumber
) {

  return (

    `${date}-` +
    `${venueCode}-` +
    `${String(
      raceNumber
    ).padStart(2, "0")}`

  );

}


/* =========================================================
 * AI入力からオッズ・人気を除外
 * ======================================================= */

async function fetchJRAHtmlPostOnce(
  path,
  cname
) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language":
      "ja,en-US;q=0.9,en;q=0.8",
    "Cache-Control":
      "no-cache"
  };

  // まずPOST方式で取得
  try {
    const response = await fetch(
      `${JRA_BASE}${path}`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          `cname=${encodeURIComponent(cname)}`
      }
    );

    if (response.ok) {
      const buffer =
        await response.arrayBuffer();

      return new TextDecoder(
        "shift_jis"
      ).decode(buffer);
    }
  } catch (error) {
    // POST失敗時はGET方式を試す
  }

  // POSTが失敗した場合はGET方式で再試行
  const url = new URL(
    `${JRA_BASE}${path}`
  );

  url.searchParams.set(
    "CNAME",
    cname
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",
      headers
    }
  );

  if (!response.ok) {
    throw new Error(
      `JRA取得失敗: POSTおよびGETが失敗。HTTP ${response.status} ${url.toString()}`
    );
  }

  const buffer =
    await response.arrayBuffer();

  return new TextDecoder(
    "shift_jis"
  ).decode(buffer);
}


/* =========================================================
 * JRA年月チェックコード取得
 *
 * JRA形式:
 * objParam["1904"]="XX"
 *
 * 1904 = 2019年04月
 * 2301 = 2023年01月
 * ======================================================= */


/* 一時的な失敗（5xx・429・通信断）は間隔をあけて最大3回まで再試行する */
async function withRetry(fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (/HTTP 4(?!29)\d\d/.test(msg)) break;          // 404などは再試行しない
      await new Promise(r => setTimeout(r, 400 * (i + 1) * (i + 1)));
    }
  }
  throw last;
}
async function fetchJRAHtml(url) { return withRetry(() => fetchJRAHtmlOnce(url)); }
async function fetchJRAHtmlPost(path, cname) { return withRetry(() => fetchJRAHtmlPostOnce(path, cname)); }

async function getJRAMonthCheckCode(
  year,
  month
) {

  const searchPage =
    await fetchJRAHtmlPost(
      "/JRADB/accessS.html",
      "pw01skl00999999/B3"
    );


  const yy =
    String(year)
      .slice(-2);

  const mm =
    String(month)
      .padStart(2, "0");

  const targetKey =
    `${yy}${mm}`;


  /*
   * JRAページ内の
   *
   * objParam["1901"]="XX"
   * objParam["1902"]="XX"
   *
   * を全部取得する。
   *
   * 特定年月だけを直接検索するより
   * JRA側の空白・改行等にも強い。
   */

  const pattern =
    /objParam\s*\[\s*["'](\d{4})["']\s*\]\s*=\s*["']([^"']+)["']/gi;


  const params =
    new Map();

  let match;

  while (
    (match =
      pattern.exec(
        searchPage
      )) !== null
  ) {

    params.set(
      match[1],
      match[2]
    );

  }


  const checkCode =
    params.get(
      targetKey
    );


  if (!checkCode) {

    throw new Error(
      `JRA年月チェックコード取得失敗: ${year}-${mm} / key=${targetKey} / found=${params.size}`
    );

  }


  return checkCode;
}


/* =========================================================
 * 指定年月の開催日ページを取得
 *
 * 過去レース検索
 * ↓
 * pw01srl
 * ↓
 * 開催日ページ
 * ======================================================= */

async function discoverJRAMeetingPages(
  year,
  month
) {

  const checkCode =
    await getJRAMonthCheckCode(
      year,
      month
    );


  const yyyymm =
    `${year}${String(month).padStart(2, "0")}`;


  const cname =
    `pw01skl10${yyyymm}/${checkCode}`;


  const html =
    await fetchJRAHtmlPost(
      "/JRADB/accessS.html",
      cname
    );

 
console.log("JRA開催ページHTML調査", {
  cname,
  htmlLength: html ? html.length : 0,
  hasSrl: /pw01srl/i.test(html || ""),
  srlMatches: (html || "").match(/.{0,100}pw01srl.{0,200}/gi)?.slice(0, 5) || [],
  links: (html || "").match(/(?:href|action)\s*=\s*["'][^"']+["']/gi)?.slice(0, 15) || [],
  scripts: (html || "").match(/<script[^>]*src=["'][^"']+["']/gi)?.slice(0, 10) || [],
  title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
  hasObjParam: /objParam/i.test(html),
  hasKaisai: /開催|競馬場|レース検索/.test(html),
  bodyStart: (html.match(/<body[^>]*>([\s\S]{0,600})/i)?.[1] || "").replace(/\s+/g, " ").slice(0, 400)
});



  if (
    !html ||
    html.length < 500
  ) {

    throw new Error(
      `JRA過去レース検索ページ取得失敗: ${yyyymm}`
    );

  }


  /*
   * 開催日ページ
   *
   * pw01srl
   *
   * を抽出する。
   */

  const srlCnames =
    extractJRAInternalCnames(
      html,
      "pw01srl"
    );

  console.log("JRA月別ページ調査", {
  htmlLength: html.length,
  meetingLinkCount: srlCnames.length,
  meetingLinks: srlCnames.slice(0, 10)
});

  return srlCnames;
}


/* =========================================================
 * 指定日のレース結果URLを発見
 *
 * 年月
 * ↓
 * 開催日ページ
 * ↓
 * レース結果URL
 * ======================================================= */

function parseJRAEntryCname(cname, sourceUrl = "") {
  const value = String(cname || "").replace(/&amp;/gi, "&").trim();
  // JRA公式ページでは pw01dde / sw01dde / sw01ddd など複数の接頭辞が使われる。
  // 接頭辞や末尾の識別コードをレース番号から推測せず、実際のCNAMEを解析する。
  const m = value.match(
    /^(?:pw|sw)01dd[de]01(\d{2})(\d{8})(\d{2})(\d{8})\/([0-9a-f]+)$/i
  );
  if (!m) return null;

  const [, venueCode, meetingDate, raceNoText, dateText] = m;
  const raceNo = Number(raceNoText);
  if (!HISTORY_VENUES[venueCode] || raceNo < 1 || raceNo > 12) return null;
  if (!/^\d{8}$/.test(dateText) || !/^\d{8}$/.test(meetingDate)) return null;

  // リンクから取得できた場合は、JRA側が実際に指定したホストを維持する。
  // CNAME単独の場合のみ接頭辞に基づく既知の公式ホストを選ぶ。
  let host = "www.jra.go.jp";
  try {
    if (sourceUrl) host = new URL(sourceUrl).hostname;
    else if (/^sw01ddd/i.test(value)) host = "sp.jra.jp";
    else if (/^sw01dde/i.test(value)) host = "app.jra.jp";
  } catch {}

  return {
    type: "entry",
    date: `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`,
    venueCode,
    venue: HISTORY_VENUES[venueCode],
    venueName: HISTORY_VENUES[venueCode],
    meetingDate,
    raceNo,
    raceNumber: raceNo,
    cname: value,
    url: `https://${host}/JRADB/accessD.html?CNAME=${encodeURIComponent(value)}`
  };
}


const isPwEntry = c => /^pw01dd/i.test(String(c || ""));
const entryKey = r => `${r.date}-${r.venueCode}-${r.raceNo}`;
/* 同じレースに複数の版があるときは、PC版(pw01dde)だけを残す。PC版が無いレースはそのまま残す */
function dedupePreferPw(list) {
  const best = new Map();
  for (const r of list) {
    const k = entryKey(r), prev = best.get(k);
    if (!prev || (isPwEntry(r.cname) && !isPwEntry(prev.cname))) best.set(k, r);
  }
  return [...best.values()];
}

function extractJRAEntryLinks(html, baseUrl = JRA_BASE) {
  const found = new Map();
  if (!html) return [];

  const addCandidate = (raw) => {
    if (!raw) return;
    let absolute;
    try {
      absolute = new URL(
        String(raw).replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/gi, "/"),
        baseUrl
      );
    } catch {
      return;
    }

    if (!["www.jra.go.jp", "sp.jra.jp", "app.jra.jp", "own.jra.jp"].includes(absolute.hostname)) return;
    if (!/\/JRADB\/accessD\.html$/i.test(absolute.pathname)) return;

    const cname = absolute.searchParams.get("CNAME");
    const parsed = parseJRAEntryCname(cname, absolute.toString());
    if (!parsed) return;

    // 公式リンクで指定されたホストとCNAMEを維持する。
    found.set(parsed.cname, { ...parsed, url: absolute.toString() });
  };

  const attrPattern = /(?:href|action)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrPattern.exec(html)) !== null) addCandidate(match[1]);

  // JRA pages sometimes embed CNAME links in JavaScript rather than href.
  const cnamePattern = /(?:https?:\/\/(?:www\.jra\.go\.jp|sp\.jra\.jp|app\.jra\.jp|own\.jra\.jp)?\/?[^"'<> ]*\/JRADB\/accessD\.html)?[^"'<> ]*CNAME(?:=|%3D)([^"'<> &]+)(?:&amp;|&|["'])?/gi;
  while ((match = cnamePattern.exec(html)) !== null) {
    let cname = match[1] || "";
    try { cname = decodeURIComponent(cname); } catch {}
    const parsed = parseJRAEntryCname(cname);
    if (parsed) found.set(parsed.cname, parsed);
  }

  // Also catch bare CNAME values embedded in script strings.
  const directPattern = /(((?:pw|sw)01dd[de])01\d{2}\d{8}\d{2}\d{8}\/[0-9a-f]{1,16})/gi;
  while ((match = directPattern.exec(html)) !== null) {
    const parsed = parseJRAEntryCname(match[1]);
    if (parsed) found.set(parsed.cname, parsed);
  }

  return [...found.values()];
}

function extractJRAEntryLinksForDate(html, date) {
  const found = new Map();
  if (!html) return [];
  // Lightweight scan: only inspect JRA's embedded CNAME-shaped race links.
  // This avoids the three full-HTML scans used by the general-purpose extractor.
  const directPattern = /(((?:pw|sw)01dd[de])01\d{2}\d{8}\d{2}\d{8}\/[0-9a-f]{1,16})/gi;
  let match;
  while ((match = directPattern.exec(html)) !== null) {
    const parsed = parseJRAEntryCname(match[1]);
    if (parsed && parsed.date === date) found.set(parsed.cname, parsed);
  }
  return [...found.values()];
}

/* =========================================================
 * 出馬表メニュー経由の探索
 * JRA公式の「出馬表」メニュー（固定CNAME）→ 開催場別ページ → 各レース
 * 結果ページの探索（月別→開催日→レース）と同じ考え方。
 * ======================================================= */

const JRA_ENTRY_TOP_CNAME = "pw01dli00/F3";

function extractJRAEntryListCnames(html) {
  const found = new Set();
  const re = /pw01dr[a-z]\d{2}\d*\/[0-9A-Fa-f]{1,4}/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) found.add(m[0]);
  return [...found];
}

async function discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter = null) {
  const out = [];
  let availableDates = [];
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessD.html", JRA_ENTRY_TOP_CNAME);
    const lists = extractJRAEntryListCnames(top);
    // 実物の形式：pw01drl00 + 開催場(2) + 開催(8) + 日付(8) + /チェック
    const parsed = lists.map(c => {
      const m = c.match(/^pw01dr[a-z]\d{2}(\d{2})(\d{8})(\d{8})\//i);
      return m
        ? { cname: c, venueCode: m[1], date: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}` }
        : { cname: c, venueCode: null, date: null };
    });
    availableDates = [...new Set(parsed.map(p => p.date).filter(Boolean))].sort();
    let target = parsed.filter(p => p.date === date && (!venueFilter || p.venueCode === venueFilter));
    if (!target.length && !availableDates.length) target = parsed; // 形式が想定外のときだけ全て候補にする
    diagnostics.push({
      step: "menu-top",
      htmlLength: top.length,
      listCount: lists.length,
      availableDates,
      targetCount: target.length,
      sample: lists.slice(0, 6)
    });
    for (const l of extractJRAEntryLinksForDate(top, date)) out.push(l);
    for (const p of target.slice(0, 6)) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessD.html", p.cname);
        const links = extractJRAEntryLinksForDate(html, date);
        diagnostics.push({
          step: "menu-list",
          cname: p.cname,
          htmlLength: html.length,
          raceLinks: links.length,
          ddeSamples: (html.match(/pw01dd[a-z]\d+\/[0-9A-Fa-f]+/gi) || []).slice(0, 3)
        });
        for (const l of links) out.push(l);
      } catch (error) {
        diagnostics.push({ step: "menu-list", cname: p.cname, error: String(error?.message || error) });
      }
    }
  } catch (error) {
    diagnostics.push({ step: "menu-top", error: String(error?.message || error) });
  }
  return { links: out, availableDates };
}

async function discoverJRAEntryRacesForDate(date = null, venueFilter = null) {
  if (date != null && !isValidDateString(date)) {
    throw new Error("date は YYYY-MM-DD 形式で指定してください");
  }

  const seedPages = [
    "https://www.jra.go.jp/keiba/thisweek/",
    "https://www.jra.go.jp/keiba/"
  ];
  const seeds = new Map();
  const diagnostics = [];

  // 最初の2ページだけを入口として確認する。
  for (const pageUrl of seedPages) {
    try {
      const html = await fetchJRAHtml(pageUrl);
      const links = extractJRAEntryLinks(html, pageUrl);
      diagnostics.push({ pageUrl, htmlLength: html.length, entryLinks: links.length });
      for (const link of links) seeds.set(link.cname, link);
    } catch (error) {
      diagnostics.push({ pageUrl, error: String(error?.message || error) });
    }
  }

  // 開催場を指定した場合は、その開催場のページだけをたどる（1回あたりの通信回数を減らす）。
  // 入口ページにその開催場のリンクがない場合のみ、他開催場のページ経由で探す。
  // 入口ページだけでは指定開催場の全レースが揃わない場合、出馬表メニュー経由で補う
  let menuInfo = null;
  if (date != null) {
    const have = [...seeds.values()].filter(r => isPwEntry(r.cname) && r.date === date && (!venueFilter || r.venueCode === venueFilter)).length;
    if (have < 12) {
      menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter);
      for (const link of menuInfo.links) seeds.set(link.cname, link);
    }
  }

  const baseSeeds = dedupePreferPw([...seeds.values()]);
  const pwKeys = new Set(baseSeeds.filter(r => isPwEntry(r.cname)).map(entryKey));
  const strictVenue = !!venueFilter && baseSeeds.some(r => r.venueCode === venueFilter);
  const allSeeds = strictVenue ? baseSeeds.filter(r => r.venueCode === venueFilter) : baseSeeds;
  const sameDateSeeds = date == null
    ? []
    : allSeeds.filter(race => race.date === date);

  // 指定日が入口ページにない場合、無関係なページを最大45件たどる旧処理を避け、
  // まず最大8件だけを探索する。対象日が見つかったら、その日の出馬表を優先する。
  const discoveryLimit = 8;
  const queue = date == null
    ? [...allSeeds]
    : sameDateSeeds.length > 0
      ? [...sameDateSeeds]
      : allSeeds.slice(0, discoveryLimit);

  const visited = new Set();
  const queued = new Set(queue.map(race => race.cname));
  const matches = new Map();
  const visitedByVenue = new Map();
  const maxPages = 45;

  while (queue.length > 0 && visited.size < maxPages) {
    const race = queue.shift();
    if (!race || visited.has(race.cname)) continue;
    visited.add(race.cname);

    try {
      const html = await fetchJRAHtml(race.url);

      // 1開催場あたり最初の2ページだけ、指定日分のCNAMEを軽量抽出する。
      // 旧処理は探索全体の先頭4ページだけを調べたため、7-10Rや12Rなどが欠落することがあった。
      // 汎用リンク抽出の3回スキャンを避け、対象日だけを拾ってCPU負荷も抑える。
      const venueVisits = (visitedByVenue.get(race.venueCode) || 0) + 1;
      visitedByVenue.set(race.venueCode, venueVisits);
      const shouldDiscoverLinks = date == null
        ? visited.size <= 6
        : (venueVisits <= 2 || matches.size === 0);
      const links = shouldDiscoverLinks
        ? (date == null
            ? extractJRAEntryLinks(html, race.url)
            : extractJRAEntryLinksForDate(html, date))
        : [];

      if ((date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter)) {
        {
        const mk = `${race.date}-${race.venueCode}-${race.raceNo}`, prev = matches.get(mk);
        // すでにPC版を読めているレースは、スマホ版・アプリ版で上書きしない
        if (!(prev && isPwEntry(prev.cname) && !isPwEntry(race.cname))) {
          matches.set(mk, { ...race, entryInfo: extractJRAEntryInfo(html), htmlLength: html.length });
        }
      }
      }

      for (const link of links) {
        if (visited.has(link.cname) || queued.has(link.cname)) continue;
        if (!isPwEntry(link.cname) && pwKeys.has(entryKey(link))) continue;   // PC版があるレースの、スマホ版・アプリ版は取らない
        if (date != null && link.date !== date) continue;
        if (strictVenue && link.venueCode !== venueFilter) continue;
        if (queue.length >= maxPages) continue;
        queue.push(link);
        queued.add(link.cname);
      }
    } catch (error) {
      diagnostics.push({
        cname: race.cname,
        error: String(error?.message || error)
      });
      if ((date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter)) {
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: { raceName: "", surface: "", distance: null, horses: [] },
          fetchError: String(error?.message || error)
        });
      }
    }
  }

  const result = [...matches.values()]
    .filter(race => (date == null || race.date === date) && (!venueFilter || race.venueCode === venueFilter))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.venueCode.localeCompare(b.venueCode) ||
      a.raceNo - b.raceNo
    );

  console.log("JRA出馬表リンク探索", {
    date,
    seedCount: seeds.size,
    sameDateSeedCount: sameDateSeeds.length,
    visitedCount: visited.size,
    raceCount: result.length,
    diagnostics: diagnostics.slice(0, 8)
  });

  if (result.length === 0 && menuInfo && menuInfo.availableDates.length && !menuInfo.availableDates.includes(date)) {
    throw new Error(
      `${date} はJRAの開催日ではありません。現在公開されている開催日：${menuInfo.availableDates.join("、")}`
    );
  }

  if (result.length === 0) {
    const searchNote = date != null && sameDateSeeds.length === 0
      ? ` 指定日のリンクが入口ページにないため、先頭${Math.min(discoveryLimit, allSeeds.length)}件だけ追加探索しました。`
      : "";
    throw new Error(
      `JRA公式ページから${date || "次回開催"}の出馬表リンクを発見できませんでした。` +
      `JRAの出馬表公開状況、または公式ページのリンク構造を確認してください。` +
      searchNote +
      ` (seed=${seeds.size}, visited=${visited.size})` +
      ` 診断=${JSON.stringify(diagnostics.slice(0, 6)).slice(0, 900)}`
    );
  }

  return result;
}

function getCellTextAny(row, classNames) {
  for (const className of classNames) {
    const value = getCellText(row, className);
    if (value) return value;
  }
  return "";
}

// JRA出馬表のHTMLは開催・端末向けページによってclass名が変わるため、
// class名が一致しない場合も馬リンクとセル順から必要情報を補完する。

function getEntryCells(row) {
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(String(row || ""))) !== null) {
    cells.push({ attrs: m[1] || "", html: m[2] || "", text: normalizeText(stripHtml(m[2] || "")) });
  }
  return cells;
}

function extractEntryHorseName(row) {
  const byClass = extractHorseName(row);
  if (byClass) return byClass;
  const anchors = String(row || "").match(/<a\b[^>]*href=["'][^"']*(?:accessU\.html|horse)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const m = anchor.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const name = m ? normalizeText(stripHtml(m[1])) : "";
    if (name && !/^\d+$/.test(name)) return name;
  }
  return "";
}

/* 出馬表の騎手欄は「58.0kg 川田 将雅 (栗東)」のように重量・所属が混ざることがあるため、名前だけにする */

function cleanJockeyText(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/\d{2}(?:\.\d)?\s*(?:kg|ｋｇ|Kg)/gi, " ")
    .replace(/(?:^|\s)\d{2}\.\d(?=\s|$)/g, " ")
    .replace(/[（(][^）)]{0,8}[）)]/g, " ")
    .replace(/(?:栗東|美浦|地方|外国|招待|ＪＲＡ|JRA)/g, " ")
    .replace(/[☆★▲△◇◆]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}


/* 調教師欄は「栗東・杉山 晴紀」「(栗)杉山晴紀」のように所属が混ざることがあるため、名前だけにする */
function cleanTrainerText(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/[（(][^）)]{0,6}[）)]/g, " ")
    .replace(/(?:栗東|美浦|地方|外国|招待|ＪＲＡ|JRA)\s*[・･]?/g, " ")
    .replace(/[・･]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/* 入れ子の要素（p/div/span等）のclass名から読む */
function pickInner(row, names) {
  const re = new RegExp("<(p|div|span|a|li|dd|dt)\\b[^>]*class=[\"'][^\"']*\\b(?:" + names.join("|") + ")\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/\\1>", "i");
  const m = String(row || "").match(re);
  return m ? normalizeText(stripHtml(m[2])) : "";
}
/* リンク先のURLで読む（騎手=accessK / 調教師=accessC） */
function pickAnchor(row, hrefPattern) {
  const re = new RegExp("<a\\b[^>]*href=[\"'][^\"']*(?:" + hrefPattern + ")[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/a>", "i");
  const m = String(row || "").match(re);
  return m ? normalizeText(stripHtml(m[1])) : "";
}
/* 表の見出し（騎手・調教師の列位置）。class名が合わないとき、列の並びから読むために使う */
function entryHeaderMap(headHtml) {
  const ths = [...String(headHtml || "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => normalizeText(stripHtml(m[1])));
  if (!ths.length) return null;
  const find = re => ths.findIndex(t => re.test(t));
  return { len: ths.length, jockey: find(/騎手/), trainer: find(/調教師|厩舎/), texts: ths.join("|") };
}
/* 血統：行の文章から「父」「母」「母の父」を読む。無ければ空文字 */
function extractPedigree(row) {
  const text = normalizeText(stripHtml(String(row || "")));
  const nameRe = "([^\\s　（()）\\d父母・:：]{2,20})";
  let damSire = "", sire = "", dam = "";
  let m = text.match(new RegExp("母の父[：:\\s]*" + nameRe));
  if (m) damSire = m[1];
  const t2 = text.replace(/母の父[：:\s]*[^\s　（()）\d]{0,20}/g, " ");
  m = t2.match(new RegExp("(?:^|[\\s　（(])父[：:\\s]*" + nameRe));
  if (m) sire = m[1];
  m = t2.match(new RegExp("(?:^|[\\s　（(])母[：:\\s]*" + nameRe));
  if (m) dam = m[1];
  if (!sire) sire = pickInner(row, ["sire", "father", "chichi"]);
  if (!damSire) damSire = pickInner(row, ["damsire", "bms", "dam_sire"]);
  const clean = v => String(v || "").replace(/[\\s　]+/g, "").slice(0, 20);
  return { sire: clean(sire), dam: clean(dam), damSire: clean(damSire) };
}
function parseJRAEntryHorseRow(row, hdr) {
  const horseName = extractEntryHorseName(row);
  if (!horseName) return null;
  const cells = getEntryCells(row);
  const horseCellIdx = cells.findIndex(c => /accessU\.html/i.test(c.html) || /\b(?:horse|bamei)\b/i.test(c.attrs));
  // 馬番：class名 → 入れ子class → 馬名セルより前の数字セルのうち最後（枠→馬番→馬名の並び）
  let numberText = getCellTextAny(row, ["num", "umaban", "horse_num", "horseNumber", "HorseNum", "Umaban"]);
  if (!numberText) numberText = pickInner(row, ["umaban", "horse_num", "num"]);
  if (!numberText) {
    const lim = horseCellIdx > 0 ? horseCellIdx : Math.min(cells.length, 4);
    let last = "";
    for (const cell of cells.slice(0, lim)) {
      const value = String(cell.text || "").replace(/[^0-9]/g, "");
      const n = Number(value);
      if (value && Number.isInteger(n) && n >= 1 && n <= 18) last = String(n);
    }
    numberText = last;
  }
  const horseNumber = toNumberOrNull(String(numberText).replace(/[^0-9]/g, ""));
  if (horseNumber == null || horseNumber < 1 || horseNumber > 18) return null;
  const weightText = getCellTextAny(row, ["weight", "futan", "burden_weight"]) || pickInner(row, ["weight", "futan"]);
  // 騎手：class名 → セル属性 → 入れ子class → リンク先
  let jockey = getCellTextAny(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) jockey = cells.find(c => /(?:jockey|kisyu|rider)/i.test(c.attrs))?.text || "";
  if (!jockey) jockey = pickInner(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) jockey = pickAnchor(row, "accessK\\.html");
  if (!jockey && hdr && hdr.jockey >= 0 && cells.length === hdr.len) jockey = cells[hdr.jockey]?.text || "";
  const jockeyRaw = jockey;
  jockey = cleanJockeyText(jockey.replace(/^[☆★▲△\s]+/, "").trim());
  const ageText = getCellTextAny(row, ["age", "sex_age", "sexage"]) || pickInner(row, ["age", "sex_age"]);
  const ageMatch = ageText.match(/([牡牝セ騙])\s*(\d+)/);
  // 調教師：class名 → セル属性 → 入れ子class → リンク先 → 「(栗)名前」の形
  let trainer = getCellTextAny(row, ["trainer", "chokyo", "trainer_name"]);
  if (!trainer) trainer = cells.find(c => /(?:trainer|chokyo|kyusya|stable)/i.test(c.attrs))?.text || "";
  if (!trainer) trainer = pickInner(row, ["trainer", "chokyo", "kyusya"]);
  if (!trainer) trainer = pickAnchor(row, "accessC\\.html");
  if (!trainer) {
    const t = normalizeText(stripHtml(row)).match(/[（(](?:栗|美)[）)]\s*([^\s（()）\d]{1,6}(?:\s[^\s（()）\d]{1,6})?)/);
    trainer = t ? t[1] : "";
  }
  if (!trainer && hdr && hdr.trainer >= 0 && cells.length === hdr.len) trainer = cells[hdr.trainer]?.text || "";
  const trainerRaw = trainer;
  trainer = cleanTrainerText(trainer);
  if (trainer && jockey && trainer === jockey) trainer = "";
  const ped = extractPedigree(row);
  return {
    finishPosition: null,
    frame: extractFrameNumber(row),
    horseNumber,
    horseName,
    sex: ageMatch ? ageMatch[1] : "",
    age: ageMatch ? Number(ageMatch[2]) : null,
    weight: toNumberOrNull(weightText.replace(/[^\d.]/g, "")),
    jockey,
    jockeyRaw,
    trainer,
    trainerRaw,
    sire: ped.sire,
    dam: ped.dam,
    damSire: ped.damSire,
    time: "",
    estimatedLast3F: null,
    horseWeight: null,
    horseWeightChange: null,
    corner: [],
    popularity: null
  };
}

function findOddsCname(html) {
  const t = String(html || "").replace(/%2F/gi, "/");
  const m = t.match(/pw151ou[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/i);
  return m ? m[0] : "";
}

/* レースのグレード表記（GI/GII/GIII）は画像のalt属性にあることが多く、stripHtmlで消えるため別に拾う */

function extractJRAGradeText(html) {
  const t = String(html || "");
  const m = t.match(/<img[^>]*alt=["']([^"']*(?:G\s*[1-3IⅠⅡⅢ]|Ｇ\s*[１-３ⅠⅡⅢ])[^"']*)["']/i);
  return m ? normalizeText(m[1]) : "";
}

/* 1着賞金（万円）。グレード判別の予備（G1は1億円以上など） */

function extractJRAPrize1(html) {
  const m = String(html || "").match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

function extractJRAEntryInfo(html) {
  const result = {
    oddsCname: findOddsCname(html),
    grade: extractJRAGradeText(html),
    prize1: extractJRAPrize1(html),
    raceName: extractRaceName(html),
    cls: ((String(html || "").match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim(),
    surface: "",
    distance: null,
    weather: "",
    trackCondition: extractTrackCondition(html),
    horses: []
  };

  const course = extractCourseInfo(html);
  result.surface = course.surface;
  result.distance = course.distance;
  result.courseRaw = course.raw;
  const hdr = entryHeaderMap((String(html || "").match(/<thead[\s\S]*?<\/thead>/i) || [""])[0]);
  result.header = hdr ? hdr.texts : "";

  const tbodies = String(html || "").match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
  for (const tbody of tbodies) {
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row, hdr);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  // Some JRA page variants place the entries in a table without tbody.
  if (result.horses.length === 0) {
    const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row, hdr);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  const seen = new Set();
  let dup = 0;
  result.horses = result.horses.filter(horse => {
    if (seen.has(horse.horseNumber)) { dup++; return false; }
    seen.add(horse.horseNumber);
    return true;
  }).sort((a, b) => a.horseNumber - b.horseNumber);
  result.dupDropped = dup;
  result.nameRows = (String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(r => extractEntryHorseName(r)).length;
  return result;
}

async function discoverJRAEntryVenuesForDate(date) {
  const seedPages = ["https://www.jra.go.jp/keiba/thisweek/", "https://www.jra.go.jp/keiba/"];
  const seeds = new Map();
  const diagnostics = [];
  for (const pageUrl of seedPages) {
    try {
      const html = await fetchJRAHtml(pageUrl);
      for (const link of extractJRAEntryLinks(html, pageUrl)) seeds.set(link.cname, link);
    } catch (error) {
      diagnostics.push({ pageUrl, error: String(error?.message || error) });
    }
  }
  const menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics);
  for (const link of menuInfo.links) seeds.set(link.cname, link);
  let same = [...seeds.values()].filter(r => r.date === date);
  if (!same.length) {
    // 入口ページに指定日のリンクがない場合：開催場ごとに1ページだけ開いて指定日のリンクを探す
    const picked = [];
    const seen = new Set();
    for (const r of seeds.values()) {
      if (!seen.has(r.venueCode)) { seen.add(r.venueCode); picked.push(r); }
    }
    for (const r of picked.slice(0, 4)) {
      try {
        const html = await fetchJRAHtml(r.url);
        for (const link of extractJRAEntryLinksForDate(html, date)) same.push(link);
      } catch (error) {
        diagnostics.push({ cname: r.cname, error: String(error?.message || error) });
      }
    }
  }
  const venues = new Map();
  for (const r of same) {
    if (!venues.has(r.venueCode)) venues.set(r.venueCode, { venueCode: r.venueCode, venueName: r.venueName, seedCount: 0 });
    venues.get(r.venueCode).seedCount++;
  }
  return { venues: [...venues.values()].sort((a, b) => a.venueCode.localeCompare(b.venueCode)), availableDates: menuInfo.availableDates, diagnostics };
}

async function handleRaceCardsRaw(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }

  try {
    if (url.searchParams.get("list") === "1") {
      const v = await discoverJRAEntryVenuesForDate(date);
      return json({ ok: true, source: "JRA", date, venues: v.venues, availableDates: v.availableDates, diagnostics: v.diagnostics });
    }
    const venueParam = url.searchParams.get("venue");
    const races = await discoverJRAEntryRacesForDate(date, venueParam || null);
    const cards = [];

    for (const race of races) {
      try {
        const parsed = race.entryInfo || { raceName: "", surface: "", distance: null, horses: [] };
        cards.push({
          date,
          venue: race.venue,
          venueName: race.venueName || race.venue,
          venueCode: race.venueCode,
          raceNumber: race.raceNumber ?? race.raceNo,
          raceName: parsed.raceName,
          className: parsed.cls || "",
          grade: parsed.grade || "",
          rowStats: { nameRows: parsed.nameRows ?? null, dupDropped: parsed.dupDropped ?? 0 },
          prize: parsed.prize1 ?? null,
          oddsCname: parsed.oddsCname || "",
          going: parsed.trackCondition || "",
          entryKind: isPwEntry(race.cname) ? "pc" : "sp",   // pc=PC版（騎手・調教師・オッズへのリンクあり）／sp=スマホ・アプリ版（これらが無い）
          courseRaw: (!parsed.surface || !parsed.distance) ? (parsed.courseRaw || "") : "",
          surface: parsed.surface,
          distance: parsed.distance,
          horses: parsed.horses,
          horseCount: parsed.horses.length,
          error: race.fetchError || undefined,
          url: race.url
        });
      } catch (error) {
        cards.push({
          date,
          venue: race.venue,
          venueName: race.venueName || race.venue,
          venueCode: race.venueCode,
          raceNumber: race.raceNumber ?? race.raceNo,
          horses: [],
          horseCount: 0,
          error: String(error?.message || error),
          url: race.url
        });
      }
    }

    return json({
      ok: true,
      source: "JRA",
      date,
      raceCount: cards.length,
      races: cards,
      warning: cards.some(card => card.horseCount === 0)
        ? "一部レースの出馬表解析で馬を取得できませんでした。"
        : null
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}



/* 取り込み品質：レースごとに「頭数」「馬番が1..Nで連続」「騎手・調教師を読めた数」を付ける */
function entryQuality(card) {
  const hs = Array.isArray(card.horses) ? card.horses : [];
  const nums = hs.map(h => Number(h.horseNumber)).filter(Number.isFinite).sort((a, b) => a - b);
  const maxNo = nums.length ? nums[nums.length - 1] : 0;
  const issues = [];
  if (hs.length < 5) issues.push("出走馬が" + hs.length + "頭しか読めていません");
  if (nums.length && maxNo > hs.length + 1 && hs.length < maxNo) issues.push("馬番が抜けています（最大" + maxNo + "番に対し" + hs.length + "頭）");
  const jk = hs.filter(h => String(h.jockey || "").trim().length >= 2).length;
  const tr = hs.filter(h => String(h.trainer || "").trim().length >= 2).length;
  if (hs.length && jk < hs.length) issues.push("騎手を読めない馬 " + (hs.length - jk) + "頭");
  if (hs.length && tr < hs.length) issues.push("調教師を読めない馬 " + (hs.length - tr) + "頭");
  if (!card.surface || !card.distance) issues.push("コース（芝ダ・距離）を読めていません");
  if (card.entryKind === "sp") issues.push("スマホ・アプリ版のページを読んでいます（騎手・調教師・オッズのリンクが無い版）");
  if (card.rowStats && card.rowStats.dupDropped) issues.push("馬番が重複して読めた馬 " + card.rowStats.dupDropped + "頭を除外（馬番の読み取りに問題）");
  return { horses: hs.length, jockeyFilled: jk, trainerFilled: tr, ok: issues.length === 0, issues };
}
async function handleRaceCards(request) {
  const res = await handleRaceCardsRaw(request);
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("list") === "1") return res;
    const data = await res.clone().json();
    if (Array.isArray(data.races)) {
      for (const r of data.races) r.quality = entryQuality(r);
      data.quality = {
        races: data.races.length,
        okRaces: data.races.filter(r => r.quality.ok).length,
        jockeyMissing: data.races.reduce((a, r) => a + (r.quality.horses - r.quality.jockeyFilled), 0),
        trainerMissing: data.races.reduce((a, r) => a + (r.quality.horses - r.quality.trainerFilled), 0)
      };
      return json(data);
    }
  } catch (e) { /* 品質情報が付けられなくても本体の結果は返す */ }
  return res;
}

function extractJRARefund(html,url){
  html=String(html||"");
  const i=html.indexOf('class="refund_unit');
  const area=i>=0?html.slice(i):"";
  const toN=s=>Number(String(s).replace(/[^\d.]/g,""));
  const pay={};let m;
  const lre=/<li class="(win|place|wakuren|umaren|umatan|wide|fuku3|tan3|sanrenpuku|sanrentan)">([\s\S]*?)<\/li>/g;
  while((m=lre.exec(area))){
    const lines=[],lr=/<div class="num">([^<]*)<\/div>\s*<div class="yen">([\d,]+)[\s\S]*?<div class="pop">(\d+)/g;let l;
    while((l=lr.exec(m[2])))lines.push({num:l[1].trim(),yen:toN(l[2]),pop:Number(l[3])});
    if(lines.length&&!pay[m[1]])pay[m[1]]=lines;
  }
  const cm=String(url||"").match(/CNAME=pw01sde10(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})(\d{8})/);
  const raceId=cm?`${cm[2]}${cm[1]}${cm[3]}${cm[4]}${cm[5]}`:null;
  const toList=a=>(a||[]).map(x=>({number:Number(x.num),yen:x.yen,pop:x.pop}));
  return{raceId,date:cm?`${cm[6].slice(0,4)}-${cm[6].slice(4,6)}-${cm[6].slice(6,8)}`:null,
   venueCode:cm?cm[1]:null,raceNo:cm?Number(cm[5]):null,win:toList(pay.win),place:toList(pay.place)};
}

function parseMeetingDate(cname) {
  const m = String(cname || "").match(/(\d{8})\/[0-9A-Za-z]{1,4}$/);
  if (!m) return null;
  const d = m[1];
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

async function handleJraDays(request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") || "";
  const mm = month.match(/^(\d{4})-(\d{2})$/);
  if (!mm) return errorResponse("month=YYYY-MM を指定してください。", 400);
  try {
    const srl = await discoverJRAMeetingPages(Number(mm[1]), Number(mm[2]));
    const days = [...new Set(srl.map(parseMeetingDate).filter(d => d && d.startsWith(month)))].sort();
    return json({
      ok: true, month, days, meetingPages: srl.length,
      unparsed: srl.filter(c => !parseMeetingDate(c)).length,
      sample: srl.slice(0, 3)
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

async function handleJraDay(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!isValidDateString(date)) return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  try {
    const [y, m] = date.split("-").map(Number);
    const srl = await discoverJRAMeetingPages(y, m);
    let target = srl.filter(c => parseMeetingDate(c) === date);
    // 日付を読めない形式のときだけ、月内の全ページを調べる
    if (!target.length && srl.some(c => !parseMeetingDate(c))) target = srl;
    const found = new Map();
    const failed = [];
    for (const meeting of target) {
      try {
        const html = await fetchJRAHtmlPost("/JRADB/accessS.html", meeting);
        if (!html || html.length < 500) continue;
        for (const cname of extractJRAInternalCnames(html, "pw01sde")) {
          const race = parseJRACname(`${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`);
          if (!race || race.date !== date || !HISTORY_VENUES[race.venueCode]) continue;
          if (race.raceNo < 1 || race.raceNo > 12) continue;
          const key = `${race.venueCode}-${race.raceNo}`;
          if (!found.has(key)) {
            found.set(key, { date, venueCode: race.venueCode, venueName: HISTORY_VENUES[race.venueCode], raceNo: race.raceNo, cname });
          }
        }
      } catch (error) {
        failed.push({ meeting, reason: String(error?.message || error) });
      }
    }
    const races = [...found.values()].sort((a, b) => a.venueCode.localeCompare(b.venueCode) || a.raceNo - b.raceNo);
    return json({ ok: true, date, pages: target.length, count: races.length, races, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

async function handleJraResults(request) {
  const url = new URL(request.url);
  const list = String(url.searchParams.get("cnames") || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!list.length) return errorResponse("cnames=… を指定してください。", 400);
  if (list.length > 8) return errorResponse("cnames は最大8件までです。", 400);
  const rows = [];
  const payouts = [];
  const failed = [];
  for (const cname of list) {
    try {
      if (!/^pw01sde\d{4}\d{8}\d{2}\d{8}\/[0-9A-Za-z]{1,4}$/.test(cname)) throw new Error("CNAMEの形式が正しくありません");
      const pageUrl = `${JRA_BASE}/JRADB/accessS.html?CNAME=${encodeURIComponent(cname)}`;
      const race = parseJRACname(pageUrl);
      if (!race) throw new Error("CNAMEを解析できません");
      const html = await fetchJRAHtml(pageUrl);
      const parsed = extractJRAResultInfo(html);
      if (!parsed || !Array.isArray(parsed.horses) || !parsed.horses.length) throw new Error("結果が0頭");
      const result = {
        date: race.date, venue: HISTORY_VENUES[race.venueCode], venueCode: race.venueCode,
        raceNumber: race.raceNo, raceName: parsed.raceName, surface: parsed.surface, distance: parsed.distance,
        weather: parsed.weather, trackCondition: parsed.trackCondition, horses: parsed.horses
      };
      for (const r of raceResultToRows(result)) {
        rows.push({
          date: r.date, raceId: r.raceId, venueCode: r.venueCode, raceNumber: r.raceNumber,
          surface: r.surface, distance: r.distance, finish: r.finish, number: r.number,
          horse: r.horse, age: r.age, jockey: r.jockey, pop: r.popularity ?? null,
          trainer: r.trainer || "", sex: r.sex || "", weight: r.weight ?? null,
          horseWeight: r.horseWeight ?? null, last3F: r.estimatedLast3F ?? null,
          going: r.going || "", raceName: r.raceName || "", frame: r.frame ?? null,
          corner: Array.isArray(r.corner) ? r.corner : []
        });
      }
      const clsText = ((String(html).match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim();
      const prizeM = String(html).match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
      const prize1 = prizeM ? Number(prizeM[1].replace(/,/g, "")) : null;
      const gradeText = extractJRAGradeText(html);
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; row.grade = gradeText; } }
      {
        let lap = extractJRALap(html);
        const dist = Number(parsed.distance) || 0;
        if (lap && dist && Math.abs(lap.length - Math.round(dist / 200)) > 1) lap = null;
        const rid = makeRaceId(race.date, race.venueCode, race.raceNo);
        const win = rows.find(x => x.raceId === rid && x.finish === 1);
        if (win && lap) win.lap = lap;
      }
      const refund = extractJRARefund(html, pageUrl);
      if (refund.place.length) {
        payouts.push({
          raceId: makeRaceId(race.date, race.venueCode, race.raceNo), date: race.date,
          venueCode: race.venueCode, raceNo: race.raceNo, win: refund.win, place: refund.place
        });
      }
    } catch (error) {
      failed.push({ cname, reason: String(error?.message || error) });
    }
  }
  return json({ ok: true, count: rows.length, rows, payouts, failed });
}

/* ---- オッズ（JRAのオッズ画面の構造は実物未確認のため、複数の読み方と診断つき） ---- */

function parseJraOddsHtmlTan(html) {
  const text = String(html || "");
  // 読み方A：class名に num / odds_tan を使う形
  const a = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const num = row.match(/<td[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/td>/i);
    if (!num) continue;
    const o = row.match(/class="[^"]*odds_tan[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([\d,]+\.\d)/i);
    if (o) a[Number(num[1])] = Number(o[1].replace(/,/g, ""));
  }
  // 読み方B：表のセルを順に見て、「馬番の次が馬名、その後ろの最初の小数が単勝」
  const b = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 3) continue;
    const ni = cells.findIndex(c => /[\u3040-\u30ff\u4e00-\u9fff]/.test(c) && !/^\d/.test(c));
    if (ni < 1 || !/^\d{1,2}$/.test(cells[ni - 1])) continue;
    const o = cells.slice(ni + 1).find(c => /^[\d,]+\.\d$/.test(c));
    if (o) b[Number(cells[ni - 1])] = Number(o.replace(/,/g, ""));
  }
  const ca = Object.keys(a).length, cb = Object.keys(b).length;
  return cb > ca ? { odds: b, method: "cells" } : { odds: a, method: "class" };
}


/* 複勝オッズ（下限〜上限）。読み方が複数あるため、2通り試して多く読めた方を採用 */
function parseJraPlaceOdds(html) {
  const text = String(html || "");
  const num = x => Number(String(x).replace(/,/g, ""));
  const a = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const n = row.match(/<td[^>]*class="[^"]*\bnum\b[^"]*"[^>]*>\s*(\d{1,2})\s*<\/td>/i);
    const f = row.match(/class="[^"]*odds_fuku[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (!n || !f) continue;
    const v = (f[1].replace(/<[^>]+>/g, " ").match(/[\d,]+\.\d/g) || []).map(num);
    if (v.length >= 2 && v[0] >= 1 && v[1] >= v[0]) a[Number(n[1])] = [v[0], v[1]];
  }
  const b = {};
  for (const row of text.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 4) continue;
    const ni = cells.findIndex(c => /[\u3040-\u30ff\u4e00-\u9fff]/.test(c) && !/^\d/.test(c));
    if (ni < 1 || !/^\d{1,2}$/.test(cells[ni - 1])) continue;
    const rest = cells.slice(ni + 1);
    const ti = rest.findIndex(c => /^[\d,]+\.\d$/.test(c));
    if (ti < 0) continue;
    const tail = rest.slice(ti + 1).join(" ");
    const v = (tail.match(/[\d,]+\.\d/g) || []).map(num);
    if (v.length >= 2 && v[0] >= 1 && v[1] >= v[0]) b[Number(cells[ni - 1])] = [v[0], v[1]];
  }
  return Object.keys(b).length > Object.keys(a).length ? b : a;
}
function parseJraOddsHtml(html) {
  const r = parseJraOddsHtmlTan(html);
  r.place = parseJraPlaceOdds(html);
  return r;
}

function oddsSnippet(html) {
  const t = String(html || "");
  const i = t.search(/<table/i);
  return t.slice(Math.max(0, i), Math.max(0, i) + 700).replace(/\s+/g, " ");
}

async function fetchOddsPage(cname) {
  let html = "";
  try { html = await fetchJRAHtmlPost("/JRADB/accessO.html", cname); } catch (e) { html = ""; }
  if (!html || html.length < 500) {
    html = await fetchJRAHtml(`${JRA_BASE}/JRADB/accessO.html?CNAME=${encodeURIComponent(cname)}`);
  }
  return html;
}


/* 指定日・開催場の、単勝・複勝オッズ画面へのリンク（レース番号つき）だけを返す軽い処理 */
async function handleJraOddsLinks(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = String(url.searchParams.get("venue") || "").padStart(2, "0");
  if (!isValidDateString(date) || !/^\d{2}$/.test(venue)) return errorResponse("date=YYYY-MM-DD&venue=05 を指定してください。", 400);
  const compact = date.replace(/-/g, "");
  const re = /pw15[0-9a-z]{3}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/gi;
  const collect = html => [...new Set(String(html || "").replace(/%2F/gi, "/").match(re) || [])];
  const vOf = c => ((String(c).match(/^pw15[0-9a-z]{3}\d{2}(\d{2})/i) || [])[1] || "");
  const kindsOf = cs => [...new Set(cs.map(c => c.slice(0, 9)))].slice(0, 10);
  const links = new Map();
  const diag = [];
  const take = cs => {
    for (const c of cs) {
      const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})(\d{8})\//i);
      if (m && m[1] === venue && m[3] === compact) links.set(Number(m[2]), c);
    }
  };
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessO.html", "pw15oli00/6D");
    const topC = collect(top);
    take(topC);
    const isMenu = c => /^pw15o[a-z]{2}/i.test(c) && c.includes(compact) && vOf(c) === venue;
    const menus = topC.filter(isMenu);
    diag.push({ step: "top", htmlLength: top.length, cnames: topC.length, kinds: kindsOf(topC), menus: menus.length, sample: topC.slice(0, 6) });
    const seen = new Set();
    let frontier = menus.slice(0, 3), fetched = 0;
    for (let depth = 0; depth < 2 && frontier.length && fetched < 7; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 7) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          take(cs);
          for (const x of cs) if (isMenu(x) && !seen.has(x)) next.push(x);
          diag.push({ step: "menu" + (depth + 1), cname: c, htmlLength: html.length, cnames: cs.length, kinds: kindsOf(cs), races: [...links.keys()].length, sample: cs.filter(x => !/^pw15o[a-z]{2}/i.test(x)).slice(0, 6) });
        } catch (error) {
          diag.push({ step: "menu" + (depth + 1), cname: c, error: String(error?.message || error) });
        }
      }
      frontier = next.slice(0, 4);
    }
    return json({ ok: true, date, venue, count: links.size, links: [...links.entries()].sort((a, b) => a[0] - b[0]).map(([raceNo, cname]) => ({ raceNo, cname })), diag });
  } catch (error) {
    return errorResponse(error?.message || error, 500);
  }
}

async function handleJraOdds(request) {
  const url = new URL(request.url);
  // 方式1：出馬表から拾ったオッズ画面のCNAMEを直接読む（最も確実）
  const direct = String(url.searchParams.get("cnames") || "").split(",").map(x => x.trim()).filter(Boolean);
  if (direct.length) {
    if (direct.length > 8) return errorResponse("cnames は最大8件までです。", 400);
    const items = [], failed = [];
    let sample = "";
    for (const c of direct) {
      try {
        if (!/^pw151ou[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}$/i.test(c)) throw new Error("CNAMEの形式が正しくありません");
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const n = Object.keys(p.odds).length;
        if (n < 4) { if (!sample) sample = oddsSnippet(html); throw new Error(`オッズを読み取れません（${n}頭）`); }
        items.push({ cname: c, odds: p.odds, place: p.place || {}, count: n, method: p.method, placeCount: Object.keys(p.place || {}).length });
      } catch (error) {
        failed.push({ cname: c, reason: String(error?.message || error) });
      }
    }
    return json({ ok: true, count: items.length, items, failed, sample });
  }
  // 方式2：オッズ画面のメニューからたどる（出馬表にリンクがないとき）
  const date = url.searchParams.get("date");
  const venueFilter = url.searchParams.get("venue");
  if (!isValidDateString(date)) return errorResponse("date=YYYY-MM-DD または cnames=… を指定してください。", 400);
  const compact = date.replace(/-/g, "");
  const diag = [];
  const cnameRe = /pw15[0-9a-z]{3}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/gi;
  const collect = html => [...new Set(String(html || "").replace(/%2F/gi, "/").match(cnameRe) || [])];
  try {
    const top = await fetchJRAHtmlPost("/JRADB/accessO.html", "pw15oli00/6D");
    const topC = collect(top);
    diag.push({ step: "odds-top", htmlLength: top.length, cnames: topC.length, kinds: [...new Set(topC.map(c => c.slice(0, 9)))].slice(0, 8), sample: topC.slice(0, 5) });
    const raceLevel = new Map();
    const seen = new Set();
    const addRace = c => { if (/^pw151ou/i.test(c)) raceLevel.set(c, true); };
    topC.forEach(addRace);
    // 最大3階層まで、指定日を含むページをたどる
    const vOf = c => ((String(c).match(/^pw15[0-9a-z]{3}\d{2}(\d{2})/i) || [])[1] || "");
    const vf0 = venueFilter ? String(venueFilter).padStart(2, "0") : "";
    const isMenu = c => /^pw15o[a-z]{2}/i.test(c) && c.includes(compact) && (!vf0 || vOf(c) === vf0);
    let frontier = topC.filter(isMenu);
    let fetched = 0;
    for (let depth = 0; depth < 3 && frontier.length && fetched < 16; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 16) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          cs.forEach(addRace);
          for (const x of cs) if (isMenu(x) && !seen.has(x)) next.push(x);
          diag.push({ step: "odds-level" + (depth + 1), cname: c, htmlLength: html.length, found: cs.length, raceLevel: cs.filter(x => /^pw151ou/i.test(x)).length });
        } catch (error) {
          diag.push({ step: "odds-level" + (depth + 1), cname: c, error: String(error?.message || error) });
        }
      }
      frontier = next;
    }
    const targetsAll = [...raceLevel.keys()].filter(c => c.includes(compact));
    const vf = venueFilter ? String(venueFilter).padStart(2, "0") : "";
    const targets = vf ? targetsAll.filter(c => { const mm = c.match(/^pw151ou\d{2}(\d{2})/i); return mm && mm[1] === vf; }) : targetsAll;
    const races = [];
    for (const c of targets.slice(0, 18)) {
      try {
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})\d{8}/i);
        const venueCode = m ? m[1] : null, raceNo = m ? Number(m[2]) : null;
        const n = Object.keys(p.odds).length;
        diag.push({ step: "odds-race", cname: c, venueCode, raceNo, horses: n, method: p.method, htmlLength: html.length });
        if (n >= 4 && venueCode && raceNo && (!venueFilter || venueCode === String(venueFilter))) races.push({ venueCode, raceNo, odds: p.odds, place: p.place || {} });
      } catch (error) {
        diag.push({ step: "odds-race", cname: c, error: String(error?.message || error) });
      }
    }
    return json({ ok: true, date, count: races.length, targets: targets.length, targetsAll: targetsAll.length, races, diagnostics: diag.slice(0, 60), foundRaceNos: targets.map(c => { const m = c.match(/^pw151ou\d{2}\d{2}\d{8}(\d{2})/i); return m ? Number(m[1]) : null; }).filter(Boolean).sort((a, b) => a - b), noParse: diag.filter(x => x.step === "odds-race" && (x.error || x.horses < 4)).map(x => x.raceNo || x.cname) });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error), diagnostics: diag }, 502);
  }
}


/* =========================================================
 * 自動バックアップ（Cloudflare KV）
 *   GET/PUT  /backup/manifest        バックアップの一覧（どのチャンクがいつ保存されたか）
 *   GET/PUT/DELETE /backup/chunk?name=…   データ本体（gzip済み、グループごと）
 * パスフレーズのSHA-256（64桁）を x-backup-id ヘッダで受け取り、その値ごとに保存先を分ける。
 * KV の binding 名は BACKUP（wrangler.jsonc の kv_namespaces）。
 * ======================================================= */

const BACKUP_NAME_RE = /^(csv-(?:0|20\d\d)|live-20\d\d-(?:0[1-9]|1[0-2])|pay-20\d\d-(?:0[1-9]|1[0-2])|meta)$/;

const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

function backupHeaders(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store"
  }, extra || {});
}

async function handleBackup(request, env, pathname) {
  const method = request.method.toUpperCase();
  const jsonHeaders = backupHeaders({ "Content-Type": "application/json; charset=UTF-8" });
  const fail = (message, status) => new Response(JSON.stringify({ ok: false, error: message }), { status, headers: jsonHeaders });
  if (!env || !env.BACKUP) {
    return fail("バックアップ用のKV（BACKUP）が設定されていません。wrangler.jsonc の kv_namespaces を確認してください。", 501);
  }
  const id = request.headers.get("x-backup-id") || "";
  if (!/^[0-9a-f]{64}$/.test(id)) return fail("認証情報が正しくありません。", 401);
  const url = new URL(request.url);

  if (pathname === "/backup/manifest") {
    if (method === "GET") {
      const v = await env.BACKUP.get(`${id}:m`, "text");
      return new Response(v || JSON.stringify({ ok: true, exists: false }), { headers: jsonHeaders });
    }
    if (method === "PUT") {
      const text = await request.text();
      if (text.length > 300000) return fail("manifest が大きすぎます。", 413);
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return fail("JSON が正しくありません。", 400); }
      obj.ok = true; obj.exists = true;
      await env.BACKUP.put(`${id}:m`, JSON.stringify(obj));
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    return fail("未対応のメソッドです。", 405);
  }

  if (pathname === "/backup/chunk") {
    const name = url.searchParams.get("name") || "";
    if (!BACKUP_NAME_RE.test(name)) return fail("チャンク名が正しくありません。", 400);
    const key = `${id}:c:${name}`;
    if (method === "GET") {
      const buf = await env.BACKUP.get(key, "arrayBuffer");
      if (!buf) return fail("チャンクがありません。", 404);
      return new Response(buf, { headers: backupHeaders({ "Content-Type": "application/octet-stream" }) });
    }
    if (method === "PUT") {
      const len = Number(request.headers.get("content-length")) || 0;
      if (len > BACKUP_MAX_BYTES) return fail("データが大きすぎます（1チャンク20MBまで）。", 413);
      const buf = await request.arrayBuffer();
      if (buf.byteLength > BACKUP_MAX_BYTES) return fail("データが大きすぎます（1チャンク20MBまで）。", 413);
      await env.BACKUP.put(key, buf);
      return new Response(JSON.stringify({ ok: true, bytes: buf.byteLength }), { headers: jsonHeaders });
    }
    if (method === "DELETE") {
      await env.BACKUP.delete(key);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    return fail("未対応のメソッドです。", 405);
  }
  return fail("見つかりません。", 404);
}


/* =========================================================
 * アプリ化（ホーム画面に追加）用：manifest とアイコン
 * ======================================================= */

const APP_ICONS = {
  "180": "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",
  "192": "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAMx0lEQVR42u2de1xMeR/Hz0xDcq0sGy/rbotcklwS1i4ilNLq4tKicieXeIhosRIWj/vlyWXXIvfWWmKJlGtIWNeZZtKSakqlIWp6/sjjcanM+Z0zZ84583n/OTPfc37nnPd8v7/fufyOxNzKhgKAFCl2AYBAAAIBCAQgEAAQCEAgAIEABAIAAgEIBCAQgEAAQCDAMjI+NMJp1iUcCTISlnUxbAMkhrofCNKIQyauBYI3IjOJI4HgjVhN4kKgz9pj8EIuXAy+b/UrUAWbB2nEsbf1KFCZ2wNvDGWSnva8XgSCOsajEfsCfdpuqMMrjdg9HFLYY2wDMXZHxFLYA4d4UcI+ahPU4X85Y+UYSWGP0aYiVvKQFPbAIR51omGPELtEhhQIF7nEN87nTiAULxQyqZ7aBIykkJEL9L62sEfoDhEnISlze4Axd4ak7IoMjK2Q4akMwAiSSxni6/1sXb+8caOvaIW8KNB4eI8WX/Gie0Bl+A9RFGXbyrqlTQtaIbl5+dhvKGGAc4Ewesd4HhkIoIQBCASMTiB0gNANQgYCKGEAAgEIBAAEAhAIQCAgVPh1NV4qlUbv3879ehs1bEA3pFrVqkcP7jTIXrr/QB48ZyEEKgOJRNKtaydh/PNkJoZqahVTU5QwgD4QABAIQCAAgQAEAhAIAAgEIBCAQAACAQCBAAQCEAiIF8HPztGslWN2znPhtt+urW1szAFkIIASBgAEAhAIQCAAgQCAQAACAQgEIBAAEAjoAdHOVN+/X68ZQWMVCpU8RSVXqBQpKrlC+Tw3j8s2VK1qZtfW1sG+XQf7tllZ6hmzF0IgwdDBro29XRt7uzbvf5id81wuV/5PKaVcoZKnqF68KGAtn0ulLZo3KTXGwb5dK5sWJiYmpV+ps3OC5ywqKSmBQMKgtW0ZL5GxtDC3dLDr6GD3/ocZmWq5QilXKOUpqhMnY+/df0RrRXXr1O5g386hfdsO9u3s7VrXqFG9zJ/VtrT4ukXT+w/kEEiPFBcX93MbRiskLz+/HIGsdTegbp3ajp07UBQllyt1FKjXt92H+Xg42Lf7qkF9HVfk5NjpU4EeylPobvKLggIIVC6Xr15nvhDzWjXr17MiCEy8nqzjLxvUt/Jwc6G1cCfHjtt27vnow4ICDSubjFGY3uvXZ3ma/uxp+jMdfxx/8Qrd5Xdz7IhhvDCwbWVNEKV7+qEoSq5Qpadn0Ost1f2iedPGEEgIGYhIoOs3kmn9PuHiVbqr6O7UGQIJALu2tvrOQBRFxV+gXcX6OX8LgfiOpYU5QQnTarU3bt7Wt0Df9HCsXr0aBOI13Z06SyQSulH3H8gLCjS0Qh4plBkZWbRCTCtXdu7VAwLxmm+6k7yHim79Ik5CA1z6QCBe06ObI5FASdwI5Nyrh2nlyhCIp9SvZ9WsaSOCwLNxFwmiYuMu0A2pXr1aj+5dIJCo6teDh/LUx/8QBCpVjwkubw0UURUTn0Ak9euv2HjiNR6POUM3xN21r5lZFQjEO2Qyk+96OhEEnj5znlygU7F0Q2rWrOHu2g8C8TD9dK3zRW26Ua9evUq4lEi80sRrN7PU2XSjRg73gkC8w8tzIEHU+YQrhYWFxCvVarUn/zpHN6pTx/YtbVpAIB5hZlZlQL/eBIGnzsQxXPWJk7EEUT8MGwKBeET/fr2qVatK0gGKPc9w1WfOJRS+fk03ynvIIFM+vbjJ2AUa4kFSv1KUqYqUVIarLijQxCdcphtlXqumu2tfCMQLLC3Mv+vZjSAw+o+TrDQg+o8YgqigiQEEl+0gkB7Sj6drpUokt+dGHYhmpQFHjsa8evWKblRLmxZuA5whkIGRyUwmjh1JEHjz1t90n8Eoj/z8F8eOnyYInDV9gqCTkBgE8nQfoPujER+kn/3RLDZjz74jBFGtWn7t2r8PBDIYEolk6qRAgsDi4uKDR46x2JLYuAt075IWQRISvEB9+/S0sW5OMvY+m5CRqWaxJVqtNurgUYJA21bWA116QyDDMI0o/VAUtfdANOuN2bPvMFlgyKwpMpkJBOKarl0cOnVsT9bn/fPEGdbbc/+BPCn5DkGgjXXzCWNGQiCuez/zQ6ZxOerWhd/2HiILnB08iWwoAIEIGe47uHNHe7LYTf/5RU+t2h11mGwSGTOzKsuXhEIgjqhtaRE2L5gs9tTpuL/vPtBTwzSal5E7dhMPCAQ3pBeqQD+GBltamJPFrl63Va9t2xK5i+DaaikRP80V1oNjghSoS6cOQ709yGITrydfYHD7mC5kZKrJTipSFFXP6suFocEQSI/IZCarloURn3lbvXYLB41cv3G7Vqslix3l5+Pl6QaB9EXIzClkZw4pinooTzlOdPMXXR4plH/GkJ8mWL38R7IJRiDQZ3Ab4Dx1ciBx+NoNkcSJgS5rNkQSx5qZVfk1ck2tmjUgEJvYWDff8O9w4uKVnp4Rtf93zlp7NTGJYP6XdzRp3HDzumX8v0YmGIFq1ayxa9s6sptW3w7clqx8/eYNl22eFxbBZFrWvn16zpw2HgKx0UqpdOuGFWTPLL8dfF27GXXgd46bnZR8h3g4Vsrs4En+I30hEFNC50zrw2BWFK1WO2vuYoPM0bwwfJVG85I4XCKRrAifHzBqKAQiZ0HI9KmTApgsYdeeQ3Qnj2KLZ88yV65heuJg+ZLQMf7DIRDJ/y9i8Vwmwy6KonLz8heFrzLgVqzbtP1x2hOGC4lYPHdcoB8EotfvWbtyMfN/XvjytQSPHrNIYWFh2OIVzJcTvnDO5PGjIZBOyGQmWzesGOYzmOFy7t1/RHxpk0UORR+/dOUaCz2q+TMjN63k1cUyPgpkYV5r944Ngwe5MFxOUVHxlODQoqJiPmzUxKkhdOdgLJPBg1zOnTzUtnVLCFQ23Z06J8RG92FjJspF4auuJibxZLsUKakzQxaxsqimTRqePLaXJ8N7HglUqZJsQcj0I/u21bP6kvnSTseeX7txG6/+G3v2HTl4mJ3nQEwrV14RPn/dqp8g0FuaNW0Uc3TP1MmBUikLTUpPzxg3eTYPX8417V9hZHPplXmCYEvkLghEURRVt07tU8ei2rdrzcrStFpt4MSZhh15lUd+/ouACcHMu2WP0570dRuafPsuBKIoisrIVHuPGMfWU1oRP68nmH2XM64mJkX8vJ7JElSpaQM8RqhS09AH+mC3Og/0kStUDJcTF39pxepNFL9ZuWYz8aREWerswT7+zM9MirATrUpN6+vqyyQt37pzz89/Cmd3/DApsn4BQYnXbtIN1Gheeg8fx3xCI9EO49XZOW6eP1y7QfLWgYfyFE+fgNy8fEoIaDQvvYaPpTXHdFFRsV9A0PWkW7zaEN6dB8rNy/fw9qf7FsjHaU/ch4zOzFJTwiHnea6HN41iFBQcynw2PvELVDpU8fQN1L0jnJGRNWjIqCdP0ymh8TT92WBvf10GjFu3/bY76jAPN4Gnr/0uKNB4jxh3eG/kZx99z3me6+49OkWZSgmTRwrlkKFjjh7cWcEVrsRrN+eGLf3AvNlljDbqLW3Effv5ezW+tJdw+869iuvd976Bd+89pIRMUvKd74eOUWfnlPltZpbaLyDozZuid+qUaU/FXxmjQKV+ePoGlDe2fyhP6e3ixbdOJRmXr17v5eL16Xx7JSUlAeODS98lraMfHGvE9zsSMzLV7l6jPn0b9+nY8737ez9SKCmxoEpNc3b1PXX6g1nPt0Tuiou/VF7NqlgjCPSWtH+eeg0f9/69EOs37/AeMT5PICN2WqMHH7/x6zfveKfUwvBVxDZw45Awbqq/feee//gZJSUlha9fTwiaMy8sori4mBIjWq12XljElBnzXr95ExQcqtG8ZOIBBw7JhLJnY06dnbtgaeKNZP7c4qM/ft19MC7+Mk+udokhA5WycesvxmDPu/rFSgrRdxKSUgBAIFHCVvLQaxKCQAACAaEIlLDs/y/Vdpp1CbtPNLx/NN8/yshAACUMQCAAgdAN4hq27u/57HKIO0DIQAAlDEmIkzTGpkCoYhjAIwMZRRLi4C5pKbsKA/44pEsU82NHKBBBrgNcOkTgHNkxlZhb2RiqfAICPntpXXd1WDl8rPWBUMg4S0XlKVLBV/o7Xowy0KftQB4S3MiL4VFjmoFgjNBheASlelUb8D/9GH4Y/5HCcMhIihebGQgOGac9LHSiK/YGPSTeli22Dg2bfaBP24RUJG572O9EwyGjsoflElaxNChnfBhtsX4U9CIQNDIGdfQuUMX1CyaJY2/rVyAdu0GQSbj7lguB0JU2FBz8MzkSCCaJzBuDCQSTxOGN4QWCTMKVhncCAeGCpzIABAIQCEAgAIEAgEAAAgEIBCAQABAIQCAAgQAEAqAM/guLgPiW96QH6gAAAABJRU5ErkJggg==",
  "512": "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"
};

function iconResponse(size) {
  const bin = Uint8Array.from(atob(APP_ICONS[size]), c => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}

function manifestResponse() {
  const manifest = {
    name: "穴馬好走ツール", short_name: "穴馬AI", start_url: "/", scope: "/", display: "standalone",
    background_color: "#101828", theme_color: "#101828", lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=UTF-8", "Cache-Control": "public, max-age=3600" } });
}


/* =========================================================
 * 診断：出馬表ページの中身を確認する（開催場ごとにページの形が違うときの原因調べ用）
 *   /debug-entry?date=YYYY-MM-DD&venue=08&race=1
 * ======================================================= */

async function handleDebugEntry(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race") || 1);
  if (!isValidDateString(date) || !venue) return errorResponse("date=YYYY-MM-DD&venue=08&race=1 を指定してください。", 400);
  try {
    const races = await discoverJRAEntryRacesForDate(date, venue);
    const r = races.find(x => Number(x.raceNo) === raceNo) || races[0];
    if (!r) return json({ ok: true, date, venue, found: 0, note: "この開催場のレースを見つけられませんでした" });
    const html = await fetchJRAHtml(r.url);
    const text = normalizeText(stripHtml(html)).normalize("NFKC");
    const parsed = extractJRAEntryInfo(html);
    const kinds = {};
    for (const m of String(html).replace(/%2F/gi, "/").matchAll(/pw[0-9a-z]{4,}\d*\/[0-9A-Fa-f]{1,4}/gi)) {
      const k = m[0].slice(0, 9).toLowerCase();
      kinds[k] = (kinds[k] || 0) + 1;
    }
    const horseRows = (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).filter(t => /accessU\.html/i.test(t) || /horse|馬名|umaban|waku/i.test(t));
    const sampleRows = horseRows.slice(0, 2).map(t => t.replace(/\s+/g, " ").slice(0, 2200));
    const rowSummary = horseRows.slice(0, 24).map(t => { const h = parseJRAEntryHorseRow(t); return h ? h.horseNumber + "|" + h.horseName + "|J:" + (h.jockey || "-") + "|T:" + (h.trainer || "-") + "|S:" + (h.sire || "-") + "|MS:" + (h.damSire || "-") : "×解析不可:" + (extractEntryHorseName(t) || "名前なし") + "|" + t.replace(/\s+/g, " ").slice(0, 160); });
    const firstHorseRow = (String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []).find(t => /horse|馬名|umaban|waku/i.test(t)) || "";
    return json({
      ok: true, date, venueCode: venue, raceNo: r.raceNo, pageUrl: r.url, htmlLength: String(html).length,
      textHead: text.slice(0, 400),
      courseNear: (() => { const i = text.search(/コース/); return i >= 0 ? text.slice(i, i + 100) : "（「コース」の文字がありません）"; })(),
      meterNear: (() => { const m = text.match(/.{0,30}(?:メートル|\d\s*m\b).{0,30}/); return m ? m[0] : "（距離の文字がありません）"; })(),
      parsed: { raceName: parsed.raceName, cls: parsed.cls, surface: parsed.surface, distance: parsed.distance, horses: parsed.horses.length, oddsCname: parsed.oddsCname, firstJockey: parsed.horses[0] ? parsed.horses[0].jockey : "" },
      cnameKinds: kinds,
      hasOddsWord: /オッズ/.test(text),
      tableCount: (String(html).match(/<table/gi) || []).length,
      firstHorseRow: firstHorseRow.replace(/\s+/g, " ").slice(0, 300),
      rowStats: { nameRows: parsed.nameRows, dupDropped: parsed.dupDropped, horses: parsed.horses.length },
      header: parsed.header || "",
      theadText: ((String(html).match(/<thead[\s\S]*?<\/thead>/i) || [""])[0]).replace(/\s+/g, " ").slice(0, 700),
      rowSummary,
      sampleRows
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

/* =========================================================
 * メインWorker
 * ======================================================= */

/* ---- 画面（ビルド時に埋め込み） ---- */
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGJ1dHRvbiBpZD0iYWxsR28iIGNsYXNzPSJiaWciIHN0eWxlPSJiYWNrZ3JvdW5kOiMxMzczMzMiPuKRoyDjgZzjgpPjgbbjgYrjgb7jgYvjgZvvvIjikaHihpLikaDihpLikaLjgpLpoIbnlarjgavlrp/ooYzvvIk8L2J1dHRvbj4KIDxkaXYgaWQ9ImFsbFN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5q+O6YCx44Gu5pu05paw44KSMeWbnuOBp+ihjOOBhOOBvuOBme+8mumBjuWOu+ODrOODvOOCueOBruabtOaWsCDihpIg5LuK6YCx5pyr44Gu5Y+W5b6X44Go5LqI5oOzIOKGkiDjg5Djg4Pjgq/jgqLjg4Pjg5fvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroqK3lrprmuIjjgb/jga7loLTlkIjvvInjgII8L2Rpdj4KIDxkaXYgaWQ9ImJrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KIDxkaXYgaWQ9ImRhdGFTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8L2Rpdj4KCjxkaXYgY2xhc3M9InRhYnMiIGlkPSJ0YWJzIj4KIDxidXR0b24gZGF0YS10YWI9InZBeGlzIiBjbGFzcz0ib24iPui2hemJhOadvzwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idkV2Ij7mnJ/lvoXlgKQ8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZVcHNldCI+5rOi5Lmx5bqmPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2SG9sZSI+56m06aasPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2UmFjZXMiPuWFqOODrOODvOOCuTwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlN1bSI+5Y+W44KK6L6844G/54q25rOBPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2VGVzdCI+5qSc6Ki8PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U2V0Ij7oqK3lrpo8L2J1dHRvbj4KPC9kaXY+Cgo8ZGl2IGlkPSJnYXRlIj48L2Rpdj4KCjxkaXYgaWQ9InZBeGlzIiBjbGFzcz0idmlldyBvbiBjYXJkIj48ZGl2IGNsYXNzPSJzbWFsbCI+44CM5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCPC9kaXY+PC9kaXY+CjxkaXYgaWQ9InZFdiIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZVcHNldCIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZIb2xlIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlJhY2VzIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlN1bSIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+Cgo8ZGl2IGlkPSJ2VGVzdCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44Oi44OH44Or44Gu54q25oWLPC9oMj4KIDxkaXYgaWQ9Im1zdGF0IiBjbGFzcz0id3JhcCI+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImFsbEZpdCIgY2xhc3M9InN1YiI+5qSc6Ki844KS44G+44Go44KB44Gm5a6f6KGM77yI5aW96LWw546H4oaS5rOi5Lmx5bqm4oaS5Zue5Y+O546H77yJPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJhbGxGaXRTdGF0dXMiIGNsYXNzPSJzbWFsbCI+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5Zue5Y+O546H44Gu5qSc6Ki877yI5omV5oi744Gk44GN44O75pmC57O75YiX77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHjgIzjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHjgI3jgpLkvb/jgYbjg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnvvIjlkITjg6zjg7zjgrkxMDDlhobvvInjgILjgZPjgZPjgac8Yj7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjga7lm57lj47njofjgYwxMDAl44KS6LaF44GI44CB6Kqk5beu44Gu5bmF44KS5byV44GE44Gm44KCMTAwJeS7peS4ijwvYj7jgajnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjgaDjgZHjgYzjgIHnlLvpnaLkuIrjgafjgIzmpJzoqLzmuIjjgb/jgI3jgavjgarjgorjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0iYnRTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPjxidXR0b24gaWQ9ImJ0UnVuIj7mpJzoqLzjgpLlrp/ooYw8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYnRHcmFkZSIgY2xhc3M9InN1YiI+6YeN6LOe44Gg44GR77ya44Kw44Os44O844OJ6KOc5q2j44GC44KKL+OBquOBl+OCkuavlOi8gzwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuazouS5seW6puOBruS/oemgvOW6puOCkuS4iuOBkuOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB5rOi5Lmx5bqm44Gu5LqI5ris44Go5a6f6Zqb44Gu5rOi5Lmx546H44KS56qB44GN5ZCI44KP44Gb44G+44GZ44CC44Kz44O844K55Yil77yI6ZaL5YKs5aC0w5foip3jg4DDl+i3nembosOX44Kv44Op44K577yJ44Gu6YGO5Y675rOi5Lmx546H44KS6Laz44GX44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+avlOOBueOBpuOAgeaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OBvuOBmeOAguiJr+OBj+OBquOCieOBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBp+OAgeetiee0muOBlOOBqOOBruWun+e4vueOh+OBoOOBkeOCkuaknOiovOOBl+OBn+aVsOWtl+OBq+W3ruOBl+abv+OBiOOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJ1cFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMS0wMS0wMSI+PGJ1dHRvbiBpZD0idXBSdW4iPuazouS5seW6puOCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InVwQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0idXBPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOCkuato+eiuuOBq+OBmeOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOCj+OBm+OBvuOBmeOAgumBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+eiuueOh+OBqOOAgeS6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgTxiPuePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWkzwvYj7jgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILmmI7norrjgavoia/jgYTjgajjgY3jgaDjgZHmjqHnlKjjgZfjgIHotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7ln7rmupbjgoLjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+5qSc6Ki844Gu6ZaL5aeL5pelIDxpbnB1dCBpZD0icGxTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMTktMDEtMDEiPjxidXR0b24gaWQ9InBsUnVuIj7lpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraM8L2J1dHRvbj48YnV0dG9uIGlkPSJwbENsZWFyIiBjbGFzcz0ic3ViIj7mqJnmupbjgavmiLvjgZk8L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9InBsT3V0IiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzvvIjpgY7ljrvjg6zjg7zjgrnjga7lj5blvpflvozjgavlrp/ooYzjgILmlbDliIbjgYvjgYvjgorjgb7jgZnvvIk8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0icGF5RXhwIiBjbGFzcz0ic3ViIj7miZXmiLvjgpLmm7jjgY3lh7rjgZc8L2J1dHRvbj48bGFiZWwgY2xhc3M9InNtYWxsIj7oqq3jgb/ovrzjgb8gPGlucHV0IGlkPSJwYXlJbXAiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24iPjwvbGFiZWw+PC9kaXY+CiA8ZGl2IGlkPSJidE91dCIgY2xhc3M9InN0YXR1cyI+44OH44O844K/5Y+W5b6X44Gu44GC44Go44Gn5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjwvZGl2PgoKPGRpdiBpZD0idlNldCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44OQ44OD44Kv44Ki44OD44OX6Kit5a6a77yIQ2xvdWRmbGFyZeOBq+S/neWtmO+8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+44OR44K544OV44Os44O844K644GuU0hBLTI1NuOBoOOBkeOCkuS9v+OBo+OBpuS/neWtmOWFiOOCkuWIhuOBkeOBvuOBme+8iOODkeOCueODleODrOODvOOCuuiHquS9k+OBr+mAgeOCiuOBvuOBm+OCk++8ieOAguWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+W+qeWFg+OBp+OBjeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9ImJrUGFzcyIgdHlwZT0icGFzc3dvcmQiIHBsYWNlaG9sZGVyPSLjg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJIiBhdXRvY29tcGxldGU9Im9mZiIgc3R5bGU9ImZsZXg6MTttaW4td2lkdGg6MjAwcHgiPjxidXR0b24gaWQ9ImJrU2hvdyIgY2xhc3M9InN1YiI+6KGo56S6PC9idXR0b24+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxsYWJlbD48aW5wdXQgaWQ9ImJrQXV0byIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOWkieabtOOBjOOBguOCjOOBsOiHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBmeOCizwvbGFiZWw+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJrTm93Ij7ku4rjgZnjgZDlt67liIbjg5Djg4Pjgq/jgqLjg4Pjg5c8L2J1dHRvbj48YnV0dG9uIGlkPSJia1Jlc3RvcmUiIGNsYXNzPSJzdWIiPuODkOODg+OCr+OCouODg+ODl+OBi+OCieW+qeWFgzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrRnVsbCIgY2xhc3M9InN1YiI+44GZ44G544Gm5L+d5a2Y44GX55u044GZPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6YGO5Y6744OH44O844K/44Gu6Kqt44G/6L6844G/77yI5Lu75oSP77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7ku6XliY3jga7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yP5oiQ57i+Q1NW44GM44GC44KM44Gw6Kqt44G/6L6844KB44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44G+44Gb44KT77yJ44CCPC9kaXY+CiA8aW5wdXQgaWQ9ImZpbGUiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24sLmNzdixhcHBsaWNhdGlvbi9qc29uLHRleHQvY3N2Ij4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7oqLrmlq08L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWHuummrOihqOOBruiqreOBv+WPluOCiuOBq+WVj+mhjOOBjOOBguOCi+OBqOOBjeOAgemWi+WCrOWgtOOBlOOBqOOBqzFS44Gu44Oa44O844K444Gu5Lit6Lqr44KS6Kq/44G544Gm5LiL44Gr5Ye644GX44G+44GZ44CC44Kz44OU44O844GX44Gm6YCB44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImRiZ0dvIiBjbGFzcz0ic3ViIj7oqLrmlq3mg4XloLHjgpLkvZzjgos8L2J1dHRvbj48YnV0dG9uIGlkPSJkYmdDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0iZGJnT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTQwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+44Kq44OD44K644Gu6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgarjgYTjg6zjg7zjgrnjgYzjgYLjgovjgajjgY3jgIHjgIxKUkHjgYzjgb7jgaDnmbrlo7LjgZfjgabjgYTjgarjgYTjgI3jga7jgYvjgIzlj5blvpfjga7llY/poYzjgI3jgarjga7jgYvjgpLoqr/jgbnjgb7jgZnjgILlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB5oq844GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9Im9kZHNEYmciIGNsYXNzPSJzdWIiPuOCquODg+OCuuOBruiouuaWreOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ib2Rkc091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE2MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBlzwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu44Os44O844K544KS44CB44Os44O844K55YWo5L2T44Gu44Op44OD44OX77yI44OP44Ot44Oz44K/44Kk44Og77yJ44Go5ZCE6aas44Gu44Kz44O844OK44O86YCa6YGO6aCG5L2N44Gk44GN44Gn5Y+W44KK55u044GX44G+44GZ77yI44Oa44O844K544O76ISa6LOq44KS5LqI5oOz44Gr5L2/44GG44Gf44KB44Gu5rqW5YKZ77yJ44CC5L+d5a2Y5riI44G/44Gu5pel44Gv5LiK5pu444GN44GV44KM44G+44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CC44G+44Ga5paw44GX44GE5pyf6ZaT44GL44KJ5bCR44GX44Gg44GR6Kmm44GX44Gm44CB6Kqt44KB44Gm44GE44KL44GL44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImxhcFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyNi0wMS0wMSI+PGJ1dHRvbiBpZD0ibGFwR28iPuWPluOCiuebtOOBmTwvYnV0dG9uPjxidXR0b24gaWQ9ImxhcERiZyIgY2xhc3M9InN1YiI+6Kqt44G/5Y+W44KK44Gu6Ki65patPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJsYXBTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2PgogPHRleHRhcmVhIGlkPSJsYXBPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxMjBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kaXY+Cgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXY+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2PjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIC8qIOKYheOCsOODrOODvOODie+8iOagvO+8ie+8mjA95LiN5piOL+S4i+e0miAxPU9Q44O744Oq44K544OG44OD44OJIDI9RzMgMz1HMiA0PUcx44CCCiAgICDlvpPmnaXjga8gRzEvRzIvRzMvT1Ag44KS44GZ44G544Gm44CMNeOAjeOBq+a9sOOBl+OBpuOBhOOBn+OBn+OCgeOAgUcz5Yud44Gh44GMIEcxIOOBp+OCguWJsuW8leOBleOCjOOBquOBi+OBo+OBn+OAggogICAg5Yik5a6a6aCG77ya44Op44OZ44Or77yITkZLQ+W+jCBHSS9HSUkvR0lJSS9HMeOAnEcz77yJ4oaSIDHnnYDos57ph5HvvIjkuIflhobvvInihpLvvIjlr77osaHjg6zjg7zjgrnjga7jgb/vvIlHMeODrOODvOOCueWQjSAqLwogY29uc3QgRzFfTkFNRVM9L+Wkqeeah+iznnzmnInppqzoqJjlv7V844K444Oj44OR44Oz44Kr44OD44OXfOOCuOODo+ODkeODs++8o3zlrp3loZroqJjlv7V85a6J55Sw6KiY5b+1fOODtOOCo+OCr+ODiOODquOCouODnuOCpOODq3zlpKfpmKrmna986auY5p2+5a6u6KiY5b+1fOODleOCp+ODluODqeODquODvHzjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrp844K544OX44Oq44Oz44K/44O844K6fOODnuOCpOODq+ODgeODo+ODs+ODlOOCquODs+OCt+ODg+ODl3zjgqjjg6rjgrbjg5njgrnlpbPnjovmna9856eL6I+v6LOefOiPiuiKseiznnzmoZzoirHos55844Kq44O844Kv44K5fOWEqumnv+eJnemmrHzml6XmnKzjg4Djg7zjg5Pjg7x85p2x5Lqs5YSq6ae/fOeakOaciOiznnxOSEvjg57jgqTjg6t86Ziq56We44K444Ol44OZ44OK44Kk44OrfOacneaXpeadr3zjg5vjg7zjg5fjg5Xjg6svOwogY29uc3QgZ3JhZGVUaWVyPSh0ZXh0LHByaXplLGJ5TmFtZSk9Pntjb25zdCBzPVN0cmluZyh0ZXh0fHwiIikubm9ybWFsaXplKCJORktDIik7CiAgaWYoL+manOWus3zjgrjjg6Pjg7Pjg5d8SlwuP1xzP0cvaS50ZXN0KHMpKXJldHVybiAwOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUlJfDMpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAyOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUl8MikoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDM7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJfDEpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiA0OwogIGNvbnN0IHA9TnVtYmVyKHByaXplKTtpZihwPjApcmV0dXJuIHA+PTEwMDAwPzQ6cD49NTAwMD8zOnA+PTM1MDA/MjpwPj0xODAwPzE6MDsKICBpZihieU5hbWUmJkcxX05BTUVTLnRlc3QocykpcmV0dXJuIDQ7CiAgaWYoL+ODquOCueODhuODg+ODiXzjgqrjg7zjg5fjg7N877yv77ywfFxiT1BcYi8udGVzdChzKSlyZXR1cm4gMTsKICByZXR1cm4gMH07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGNvbnN0IGNsZWFuVHI9dD0+U3RyaW5nKHR8fCIiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsNn1b77yJKV0vZywiICIpLnJlcGxhY2UoLyg/Ouagl+adsXznvo7mtaZ85Zyw5pa5fOWkluWbvXzmi5vlvoUpXHMqW+ODu++9pV0/L2csIiAiKS5yZXBsYWNlKC9b44O7772lXS9nLCIgIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IudHJhaW5lcj1jbGVhblRyKG9bIuiqv+aVmeW4qyJdfHxvLnRyYWluZXJ8fCIiKTtjb25zdCBfZ3Q9U3RyaW5nKG9bIummrOWgtCJdfHxvWyLppqzloLTnirbmhYsiXXx8by5nb2luZ3x8by50cmFja19jb25kaXRpb258fCIiKTtfci5nYz0v5LiN6ImvfOeojXzph40vLnRlc3QoX2d0KT8yOi/oia8vLnRlc3QoX2d0KT8xOjA7X3IuZ3JkPWdyYWRlVGllcihTdHJpbmcob1siY2xhc3MiXXx8by5jbHN8fCIiKSsiICIrU3RyaW5nKG9bIuODrOODvOOCueWQjSJdfHxvLnJhY2VfbmFtZXx8by5yYWNlbmFtZXx8IiIpLG51bGwsZmFsc2UpO3JldHVybiBfcn0KIGZ1bmN0aW9uIHRvUm93MChvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICB7Y29uc3QgZG49ZG51bShyLmRhdGUpLGRzPWguZHN8fChoLmRzPW5ldyBTZXQoKSk7aWYoZHMuaGFzKGRuKSlyZXR1cm47ZHMuYWRkKGRuKX0gICAvLyDlkIzjgZjppqzjga/jgIHlkIzjgZjml6Xjgasx5Zue44GX44GL6LWw44KM44Gq44GE77yIQ1NW44Go5Y+W5b6X44OH44O844K/44Gu5LqM6YeN55m76Yyy44KS6Ziy44GQ77yJCiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBpZihyLmdjPjApe2NvbnN0IGdxPShoLmduPWguZ258fHt9KTtjb25zdCBnZz0oZ3Fbci5nY109Z3Fbci5nY118fFswLDBdKTtnZ1swXSsrO2dnWzFdKz10M30KICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTCxyLmdyZHx8MCxyLmNmPT1udWxsPy0xOnIuY2ZdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDimIXmoLzkuIrjgZLoo5zmraPvvJrlrabnv5LmuIjjgb/jg6Ljg4fjg6vjga/nnYDpoIbjgpLjgZ3jga7jgb7jgb7opovjgovjga7jgafjgIHkuIvkvY3jgrDjg6zjg7zjg4njgafjga7lpb3otbDjgYzph43os57jg7tHMeOBp+OCguWQjOS+oeWApOOBq+OBquOBo+OBpuOBhOOBn+OAggogICAg55u06L+RM+i1sOOBruOBhuOBoSBPUC/ph43os54o44Kv44Op44K5NSnjga7otbDjgavjgaTjgYTjgabjgIHku4rlm57jga7jgrDjg6zjg7zjg4njgajjga7lt67jgaDjgZHoo5zmraPjgZnjgovvvIjjgq/jg6njgrk05Lul5LiL44Gv44Oi44OH44Or5YG044Gu6KOc5q2j44GM44GC44KL44Gu44Gn5LqM6YeN5o6b44GR44GX44Gq44GE77yJ44CCCiAgICAgIOagvOS4iuOBku+8iOS+iyBHM+KGkkcx77yJ77ya5aW96LWw44Gu5L6h5YCk44KS5Ymy44KK5byV44GP77yI552A6aCG44GM6Imv44GE44G744Gp5aSn44GN44GP77yJCiAgICAgIOagvOS4i+OBku+8iOS+iyBHMeKGkkcy77yJ77ya5Yeh6LWw44Gu5L6h5YCk44KS5bCR44GX5oi744GZCiAgICDkv4LmlbDjga/mmqvlrprlgKTjgILikaAtMuOBruOAjOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g+OAjeOBp+OAgeijnOato+OBguOCii/jgarjgZfjgpLlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafmr5Tjgbnjgabnorroqo3jgZnjgovjgZPjgajjgIIgKi8KIGNvbnN0IEdSQURFPXtvbjp0cnVlLEtVUDouMzAsS0ROOi4xMixNSU46LS45LE1BWDouNX07CiBmdW5jdGlvbiBncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCl7CiAgaWYoIUdSQURFLm9ufHwoY29tcCYmY29tcC5ncmFkZT09PWZhbHNlKSlyZXR1cm4gMDsKICBjb25zdCBHdD1yYWNlLmdyZHx8MDtpZihHdDwyKXJldHVybiAwOwogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWh8fCFoLnJ1bnMubGVuZ3RoKXJldHVybiAwOwogIGNvbnN0IHJjPWgucnVucy5zbGljZSgtMyksVz1bWzFdLFsuNCwuNl0sWy4yLC4zLC41XV1bcmMubGVuZ3RoLTFdO2xldCBkPTA7CiAgcmMuZm9yRWFjaCgoeCxrKT0+e2NvbnN0IGZpbj14WzFdLEw9eFs0XXx8MCxHcj14WzVdfHwwO2lmKEwhPT01fHwhKGZpbj4wKSlyZXR1cm47CiAgIGNvbnN0IGdyPU1hdGgubWF4KEdyLDIpOyAgICAgICAgICAvLyBPUOODu+OCsOODrOODvOODieS4jeaYjuOBruOCr+ODqeOCuTXotbDjga8gRzMg55u45b2T44Go44GX44Gm5q+U6LyDCiAgIGlmKEd0PmdyJiZmaW48PTUpZC09V1trXSpHUkFERS5LVVAqKEd0LWdyKSooNi1maW4pLzY7CiAgIGVsc2UgaWYoR3Q8Z3ImJmZpbj49NClkKz1XW2tdKkdSQURFLktETiooZ3ItR3QpKk1hdGgubWluKDEsKGZpbi0zKS84KX0pOwogIHJldHVybiBjbGFtcChkLEdSQURFLk1JTixHUkFERS5NQVgpfQogY29uc3QgR049WyLkuI3mmI4v5LiL57SaIiwiT1Djg7tMIiwiRzMiLCJHMiIsIkcxIl07CiBmdW5jdGlvbiBncmFkZVRhZ3ModGFncyxkeixyYWNlKXtjb25zdCB0PXRhZ3Muc2xpY2UoKTsKICBpZihkejw9LS4yKXQudW5zaGlmdCh7dDpg5qC85LiK44GS5oim77yIJHtHTltyYWNlLmdyZHx8MF1977yJ77ya5LiL5L2N44Kw44Os44O844OJ44Gu5aW96LWw44Gv5Ymy5byVICR7ZHoudG9GaXhlZCgyKX1gLGM6Im8ifSk7CiAgZWxzZSBpZihkej49LjEpdC51bnNoaWZ0KHt0OmDpq5jjgrDjg6zjg7zjg4njgYvjgonjga7moLzkuIvjgZIgJHtkej49MD8iKyI6IiJ9JHtkei50b0ZpeGVkKDIpfWAsYzoiYiJ9KTsKICByZXR1cm4gdH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOODqeODs+OCr++8mueptOOCvuODvOODs+OBruW5s+Wdh+OBq+WvvuOBmeOCi+WAjeeOh+OBpyBTL0EvQi9D77yI5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgafvvIkgKi8KIGNvbnN0IEFWR19IT0xFPXtvZGRzOi4wOTEscHJveHk6LjExNX07CiBmdW5jdGlvbiByYXRpbmcocGMsbW9kZSxuKXtjb25zdCByPXBjL0FWR19IT0xFW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga30KIC8qIOeahOS4reeOh+mHjeimlu+8muWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vvvIjjgqrjg4PjgrrjgYzliIbjgYvjgovjgajjgY3jga/vvInljZjli50zMOWAjeacqua6gOOBruWkp+eptOOCkumZpOOBj+OAgumBjuWOu+OBruaknOiovOOBp+OAgeeahOS4reeOh+OBjOS4iuOBjOOCiuOAgeWbnuWPjueOh+OBjOacgOaCquOBruWkp+eptOOCkumBv+OBkeOCieOCjOOBnyAqLwogY29uc3QgRk9DVVNfTUFYX09ERFM9MzA7CiBjb25zdCBGT0NVUz17Im9kZHMiOnsibiI6MzYyNSwiaGl0IjowLjIzMiwiYmFzZUhpdCI6MC4xNzIsInBlckRheSI6MTMuNn0sInByb3h5Ijp7Im4iOjQwMjUsImhpdCI6MC4yNzIsImJhc2VIaXQiOjAuMjE3LCJwZXJEYXkiOjE1LjF9fTsgICAvLyAyMDI05bm05Lul6ZmN44Gu5qSc6Ki877ya55qE5Lit546H77yIYmFzZUhpdD3lvpPmnaXjga4x5L2N5YCZ6KOc77yJ44O76ZaL5YKs5pel44GC44Gf44KK44Gu6aCt5pWwCiBmdW5jdGlvbiBwaWNrRm9jdXMocmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zJiYocmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iUyJ8fHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IkEiKSYmKHgub2RkPT1udWxsfHx4Lm9kZDxGT0NVU19NQVhfT0REUykpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCt44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB5a++6LGh5aSWICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIGZ1bmN0aW9uIGFuYWx5emUocmFjZSxzdG9yZSxvZGRzLGNvbXAscG9wQXJyKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoOwogIGNvbnN0IHNjPVIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcCkpOwogIGNvbnN0IGR6PVIubWFwKHI9PmdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKSk7CiAgY29uc3QgemMwPU1PREVMLmNvcmU/Ui5tYXAocj0+bW9kZWxaKCJjb3JlIixmZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpKTpzYy5tYXAoeD0+eC56KTtjb25zdCB6Yz16YzAubWFwKCh6LGkpPT56K2R6W2ldKTsKICBjb25zdCBwPW5vcm1hbGl6ZVRvcDMoemMsTWF0aC5taW4oMyxOKSk7CiAgbGV0IG1rdD1udWxsLHBvcD1udWxsLG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7bWt0PXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpO3BvcD1vZGRzLm1hcChvPT4xK29kZHMuZmlsdGVyKHg9Png8bykubGVuZ3RoKTttb2RlPSJvZGRzIn0KICBlbHNlIGlmKHBvcEFyciYmcG9wQXJyLmxlbmd0aD09PU4mJnBvcEFyci5ldmVyeSh4PT54PjApKXtwb3A9cG9wQXJyLnNsaWNlKCk7bW9kZT0ib2RkcyJ9IC8vIOWun+mam+OBruS6uuawl+mghuS9jeOBoOOBkeWIhuOBi+OCi+OBqOOBje+8iOe1kOaenOODmuODvOOCuOeUseadpe+8iQogIGVsc2V7IC8vIOOCquODg+OCuuOCguS6uuawl+OCguOBquOBhOOBqOOBje+8mumojuaJi+aIkOe4vuOBvuOBp+WQq+OCgeOBn+OCueOCs+OCouOBrumghuS9jeOCkuOAjOS6uuawl+OBruS7o+eQhuOAjeOBq+OBmeOCi++8iOWun+mam+OBruS6uuawl+OBqOOBruebuOmWoiAwLjU14oaSMC42N++8iQogICBjb25zdCBweD1NT0RFTC5mdWxsP1IubWFwKHI9Pm1vZGVsWigiZnVsbCIsZmVhdHMocixzdG9yZSxyYWNlLE4sdHJ1ZSkpKTpSLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLHtqb2NrZXk6dHJ1ZSxsYXlvZmY6ZmFsc2V9KS56KTtjb25zdCBweDI9cHgubWFwKCh2LGkpPT52K2R6W2ldKTtwb3A9cHgyLm1hcCh2PT4xK3B4Mi5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIG9kZDoob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpP29kZHNbaV06bnVsbCwKICAgY2FyZWVyOigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/e246aC5uLHQzOmgudG9wMyx3aW46aC53aW59Om51bGx9KSgpLAogICByZWNlbnQ6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLnJ1bnMubWFwKHg9PnhbMV0pOltdfSkoKSwKICAgam5hbWU6ci5qbmFtZXx8IiIsanN0YXQ6KCgpPT57Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpO3JldHVybiBqJiZqLm4+PTE/e246ai5uLHJhdGU6ai50b3AzL2oubn06bnVsbH0pKCksCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICBkejpkeltpXSx0YWdzOmdyYWRlVGFncyhleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGR6W2ldLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIHJldHVybntmLG1vZGUscDA6c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpfX0KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBjb25zdCB1PXVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKSxtb2RlPXUubW9kZSxwPXUucDAsRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHksTUlORz1OdW1iZXIob3B0cy5taW5HcmQpfHwwLF9nT249R1JBREUub247R1JBREUub249IW9wdHMuZ3JhZGVPZmY7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIiwiZm9jdXMiXSxwZXI9WyJhbGwiLCJBIiwiQiIsIkMiXTsKICBjb25zdCBTPXt9O2Zvcihjb25zdCBuIG9mIG5hbWVzKXtTW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcilTW25dW3BdPXtiZXRzOjAsaGl0czowLHJldDowLHNxOjB9fQogIGNvbnN0IFNFRz17fTsgICAvLyAx5L2N5YCZ6KOc44Gu5p2h5Lu25Yil77yI5YWo5pyf6ZaT77yP5YmN5Y2K77yP5b6M5Y2K77yJCiAgY29uc3Qgc3RvcmU9bmV3IFN0b3JlKCk7bGV0IHVzZWQ9MDsKICBjb25zdCBhZGQ9KG4scCxoaXQseWVuKT0+e2NvbnN0IHg9U1tuXVtwXTt4LmJldHMrKztpZihoaXQpeC5oaXRzKys7eC5yZXQrPXllbjt4LnNxKz15ZW4qeWVufTsKICBjb25zdCBhZGRTZWc9KGxhYmVsLHAseWVuKT0+e2NvbnN0IGc9U0VHW2xhYmVsXT1TRUdbbGFiZWxdfHx7YWxsOntuOjAsaDowLHI6MCxxOjB9LEE6e246MCxoOjAscjowLHE6MH0sQjp7bjowLGg6MCxyOjAscTowfX07Zm9yKGNvbnN0IGsgb2YgWyJhbGwiLHBdKXtjb25zdCB4PWdba107eC5uKys7aWYoeWVuPjApeC5oKys7eC5yKz15ZW47eC5xKz15ZW4qeWVufX07CiAgY29uc3QgQVY9UFJPWFk/LjExNTouMDkxOwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCYmKCFNSU5HfHwoKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0uZ3JkKXx8MCk+PU1JTkcpKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1QUk9YWT9hbmFseXplKHJhY2Usc3RvcmUsbnVsbCk6KGhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSk7CiAgICAgY29uc3QgeWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBidXk9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIGJ1eSgiZm9jdXMiLHBpY2tGb2N1cyhyZXMsMSkpOwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpOwogICAgICAgaWYoIVBST1hZJiZ0Lm9kZCl7Y29uc3Qgbz10Lm9kZDthZGRTZWcobzw4PyLljZjli50g44CcOOWAjSI6bzwxNT8i5Y2Y5YudIDjjgJwxNeWAjSI6bzwzMD8i5Y2Y5YudIDE144CcMzDlgI0iOm88NjA/IuWNmOWLnSAzMOOAnDYw5YCNIjoi5Y2Y5YudIDYw5YCN44CcIixwcix5KTsKICAgICAgICBpZihoYXNPZGRzKXtjb25zdCB1Zz11cHNldEdyYWRlKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7YWRkU2VnKCLms6LkubHluqYgIit1Zy5ncmFkZSxwcix5KX19fQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIEdSQURFLm9uPV9nT247cmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue3Vwc2V0RmVhdHVyZXMsY2xlYW5UcixHUkFERSxncmFkZVRpZXIsZ3JhZGVBZGosRk9DVVMscmF0aW5nLHBpY2tGb2N1cyxBWElTLGF4aXNQcm9icyxheGlzUGlja3MsdXBzZXRHcmFkZSxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOOCouODl+ODquWxpO+8iOWGjeani+evie+8iQogKiAg44O75L+d5a2YL+WGjemWi+OBpOOBjeOBrumBjuWOu+ODh+ODvOOCv+WPluW+l+OAgeODkOODg+OCr+OCouODg+ODl+OAgeaknOiovOOBr+OAgeWLleS9nOeiuuiqjea4iOOBv+OBruWHpueQhuOCkuOBneOBruOBvuOBvuWGjeWIqeeUqAogKiAg44O75LuK6YCx5pyr44Gu5Y+W5b6X44CB6aiO5omL44O76Kq/5pWZ5bir44Gu54Wn5ZCI44CB5pyf5b6F5YCk44CB6LaF6YmE5p2/44CB5rOi5Lmx5bqm44CB5Y+W44KK6L6844G/5ZOB6LOq44Gu6KGo56S644Gv5paw6KaPCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiI7CmNvbnN0IFZFTlVFPXsiMDEiOiLmnK3luYwiLCIwMiI6IuWHvemkqCIsIjAzIjoi56aP5bO2IiwiMDQiOiLmlrDmvZ8iLCIwNSI6IuadseS6rCIsIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkifTsKY29uc3QganN0VG9kYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IHBjdD0oeCxrPTApPT54PT1udWxsfHwhTnVtYmVyLmlzRmluaXRlKHgpPyItIjooeCoxMDApLnRvRml4ZWQoaykrIiUiOwoKZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCi8qIOWQjOOBmOODrOODvOOCueOBjOOAgUNTVigxMuahgUlEKeOBqOWPluW+l+ODh+ODvOOCvyjml6Xku5gt6ZaL5YKs5aC0LVIp44Gu5Lih5pa544Gr44GC44KL44Go44CB6aas44Gu5Ye66LWw5Zue5pWw44KE55u06L+R44Gu5oiQ57i+44GM5LqM6YeN44Gr44Gq44KL44CCCiAgIOaXpeS7mOODu+mWi+WCrOWgtOODu1Lnlarlj7fjgaflkIzjgZjjg6zjg7zjgrnjgpLopovliIbjgZHjgIHmnIDliJ3jgavoqq3jgpPjgaDmlrnjgaDjgZHjgpLkvb/jgYbvvIjlj5blvpfjg4fjg7zjgr/jgpLlhYjjgavoqq3jgoDvvJ3oqr/mlZnluKvjg7vppqzloLTnirbmhYvjgarjganjgYzosYrlr4zjgarmlrnjgpLlhKrlhYjvvIkgKi8KY29uc3QgcmFjZUtleT1yPT5yLmRhdGUrInwiK3ZlbnVlT2ZJZChyLnJhY2VJZCkrInwiK3JhY2VOb09mSWQoci5yYWNlSWQpOwpjb25zdCBmaWxlT3JkZXI9ZnM9PmZzLnNsaWNlKCkuc29ydCgoYSxiKT0+KGIubGl2ZT8xOjApLShhLmxpdmU/MTowKSk7CmNsYXNzIFJhY2VEZWR1cGV7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCk7dGhpcy5kdXBzPW5ldyBTZXQoKX0KIHNraXAocil7Y29uc3Qgaz1yYWNlS2V5KHIpLGY9dGhpcy5tLmdldChrKTtpZihmPT09dW5kZWZpbmVkKXt0aGlzLm0uc2V0KGssci5yYWNlSWQpO3JldHVybiBmYWxzZX1pZihmIT09ci5yYWNlSWQpe3RoaXMuZHVwcy5hZGQoayk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQp9CmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9ZmlsZU9yZGVyKGF3YWl0IGlkYkFsbCgpKSxkZD1uZXcgUmFjZURlZHVwZSgpOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXtjb25zdCBmPWZzW2ldOwogIGlmKGYubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZi5yb3dzfHxbXSl7Y29uc3Qgcj1saXZlUm93KHgpO2lmKCFkZC5za2lwKHIpKWNiKHIpfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCByPVVFLnRvUm93KG8pO2lmKCFkZC5za2lwKHIpKWNiKHIpfQogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9CiBGRV9EVVBTPWRkLmR1cHMuc2l6ZTsKfQpsZXQgRkVfRFVQUz0wOwovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9Cgpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Cn07CgoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTt0cnl7c2V0R2F0ZShvdXQsb3V0UCl9Y2F0Y2goZSl7Y29uc29sZS5lcnJvcihlKX0KICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpO3RyeXthd2FpdCBwZWRpZ3JlZUxvYWQoKTthd2FpdCBtb2RlbHNGcm9tTWV0YSgpfWNhdGNoKGUpe30KICBhd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsW10pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbi51cGRhdGVkQXR9KTsKICBhd2FpdCBzaG93U3RhdGUoKTtCSy5pbmZvPW1hbjtia01zZyhg5b6p5YWD5a6M5LqG77yaJHtuYW1lcy5sZW5ndGh944Kw44Or44O844OX77yPJHtjbnQudG9Mb2NhbGVTdHJpbmcoKX3ku7ZgKTsKIH1jYXRjaChlKXtia01zZygi5b6p5YWD44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBmaW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQpmdW5jdGlvbiBia1NjaGVkdWxlKG1zKXsKIGlmKCFCSy5hdXRvfHwhQksucGFzc3x8QksucGFzcy5sZW5ndGg8OClyZXR1cm47CiBjbGVhclRpbWVvdXQoQksucnVuVCk7QksucnVuVD1zZXRUaW1lb3V0KCgpPT57aWYoIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKTtlbHNlIGJrU2NoZWR1bGUoMzAwMDApfSxtc3x8MzAwMCk7Cn0KZnVuY3Rpb24gYmtTYXZlU2V0dGluZ3MoKXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oInVwc2V0X2JrIixKU09OLnN0cmluZ2lmeSh7cGFzczpCSy5wYXNzLGF1dG86QksuYXV0b30pKX1jYXRjaChlKXt9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDms6LkubHluqbjga7lho3moKHmraMKICogIOebrueahO+8muazouS5seW6puOBruOAjOW9k+OBn+OCiuaWueOAjeOCkuOAgeiHquWIhuOBrumBjuWOu+ODh+ODvOOCv+OBp+eiuuOBi+OCgeOAgeS/oemgvOOBp+OBjeOCi+aVsOWtl+OBoOOBkeOCkuWHuuOBmeOAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44GrMeOBpOOBmuOBpOWGjeePvuOBl+OAgeODrOODvOOCueWJjeOBq+WIhuOBi+OCi+aDheWgseOBoOOBkeOBp+azouS5seW6puOCkuioiOeulwogKiAgIDIpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBruazouS5seeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDMpIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOmWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LDl+OCr+ODqeOCue+8ieOBquOBqeOCkui2s+OBl+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgeWQjOOBmOacn+mWk+OBp+avlOi8gwogKiAgIDQpIOWvvuaVsOaQjeWkseOBjOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAguOBneOBhuOBp+OBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBq+OBl+OBpuOAgeWun+e4vueOh+OBoOOBkeaknOiovOWApOOBq+W3ruOBl+abv+OBiOOCiwogKiAg5rOi5Lmx77ydM+edgOS7peWGheOBrummrOOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApCjnj77ooYzjg6Ljg4fjg6vjgajlkIzjgZgxNSnku6XkuIoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBVUEtFWT0ia2VpYmFfdXBzZXRfdjEiOwpjb25zdCBzaWdtPXo9PjEvKDErTWF0aC5leHAoLXopKSxsZ3Q9cD0+e3A9TWF0aC5taW4oLjk5OSxNYXRoLm1heCguMDAxLHApKTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwpmdW5jdGlvbiB3aWxzb24oayxuKXtpZighbilyZXR1cm5bMCwxXTtjb25zdCB6PTEuOTYscD1rL24sZD0xK3oqei9uLGM9cCt6KnovKDIqbiksYT16Kk1hdGguc3FydChwKigxLXApL24reip6Lyg0Km4qbikpO3JldHVyblsoYy1hKS9kLChjK2EpL2RdfQpjb25zdCBkaXN0Qj1kPT5NYXRoLm1heCgxMDAwLE1hdGgubWluKDMyMDAsTWF0aC5yb3VuZCgoZHx8MCkvMjAwKSoyMDApKTsKY29uc3QgbHZsRz0obCxnKT0+KGx8fDApKyhnPj0yPyJHIjoiIik7CgovKiDjg6zjg7zjgrnjga7pm4boqIjvvIjooYzjgpLlhajpg6jmjIHjgZ/jgZrjgavmuIjjgoDou73jgYTlvaLvvInihpIg44Os44O844K55oOF5aCxICovCmZ1bmN0aW9uIGFnZ0FkZChtYXAscil7CiBpZighci5yYWNlSWR8fCFyLmhvcnNlfHxyLmZpbmlzaD09bnVsbClyZXR1cm47CiBsZXQgYT1tYXAuZ2V0KHIucmFjZUlkKTsKIGlmKCFhKW1hcC5zZXQoci5yYWNlSWQsYT17aWQ6U3RyaW5nKHIucmFjZUlkKSxkYXRlOnIuZGF0ZSxzdXJmOnIuc3VyZixkaXN0OnIuZGlzdCxsdmw6ci5sdmx8fDAsZ3JkOnIuZ3JkfHwwLGdjOjAsTjowLHQ6W10scGY6W10sanVtcDpmYWxzZX0pOwogaWYoIWEuZ2MmJnIuZ2MpYS5nYz1yLmdjOwogYS5OKys7aWYoci5maW5pc2g8PTMmJnIucG9wPjApYS50LnB1c2goW3IuZmluaXNoLHIucG9wXSk7CiBpZihyLnBvcD4wKWEucGYucHVzaChbci5wb3Asci5maW5pc2hdKTsKIGlmKC/pmpzlrrMvLnRlc3QoU3RyaW5nKHIucmFjZU5hbWV8fCIiKSkpYS5qdW1wPXRydWU7Cn0KZnVuY3Rpb24gYWdnSW5mbyhhKXsKIGlmKCFhfHxhLk48Nnx8YS5qdW1wKXJldHVybiBudWxsOwogY29uc3Qgdj0vXlxkezEyfSQvLnRlc3QoYS5pZCk/YS5pZC5zbGljZSg0LDYpOihTdHJpbmcoYS5pZCkuc3BsaXQoIi0iKVszXXx8IiIpLG5vPS9eXGR7MTJ9JC8udGVzdChhLmlkKT9OdW1iZXIoYS5pZC5zbGljZSgxMCwxMikpOihOdW1iZXIoU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbNF0pfHwwKTsKIGNvbnN0IHQ9YS50LnNsaWNlKCkuc29ydCgoeCx5KT0+eFswXS15WzBdKTsKIGNvbnN0IHk9dC5sZW5ndGg+PTM/KHRbMF1bMV0rdFsxXVsxXSt0WzJdWzFdPj1VRS5BWElTLnVwc2V0LnRocj8xOjApOm51bGw7CiByZXR1cm57ZGF0ZTphLmRhdGUsdixubyxzdXJmOmEuc3VyZixkaXN0OmEuZGlzdCxsdmw6YS5sdmwsZ3JkOmEuZ3JkLGdjOmEuZ2N8fDAsTjphLk4seX07Cn0KCi8qIOiEmuizqu+8mjHjgrPjg7zjg4rjg7zjga7kvY3nva7jga7libLlkIjvvIgwPeWFiOmgreOAgTE95pyA5b6M5pa577yJ44CC6YCa6YGO6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM44GC44KL6aas44Gg44GRICovCmZ1bmN0aW9uIGNvcm5lckZyYWMoY29ybmVyLE4pewogaWYoIUFycmF5LmlzQXJyYXkoY29ybmVyKXx8IWNvcm5lci5sZW5ndGh8fCFOfHxOPDQpcmV0dXJuIG51bGw7CiByZXR1cm4gTWF0aC5taW4oMSxNYXRoLm1heCgwLChjb3JuZXJbMF0tMSkvKE4tMSkpKTsKfQovKiDjg6zjg7zjgrnjga7jg5rjg7zjgrnnibnlvrTph4/vvJrlhYjooYzppqzjga7lpJrjgZXjg7vohJros6rjga7jgbDjgonjgaTjgY3jgILljYrmlbDku6XkuIrjga7ppqzjgavohJros6rjg4fjg7zjgr/jgYznhKHjgZHjgozjgbDlhajpg6gwICovCmZ1bmN0aW9uIHBhY2VGZWF0KHJ1bm5lcnMsc3RvcmUpewogY29uc3QgTj1ydW5uZXJzLmxlbmd0aDtsZXQgaz0wLGxlYWQ9MCxmcm9udD0wLHN1bT0wLHN1bTI9MDsKIGZvcihjb25zdCByIG9mIHJ1bm5lcnMpewogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWgpY29udGludWU7CiAgY29uc3Qgdj1oLnJ1bnMubWFwKHg9PnhbNl0pLmZpbHRlcih4PT54IT1udWxsJiZ4Pj0wKTtpZih2Lmxlbmd0aDwyKWNvbnRpbnVlOwogIGNvbnN0IHc9di5zbGljZSgtNSksbT13LnJlZHVjZSgoYSxiKT0+YStiLDApL3cubGVuZ3RoOwogIGsrKztzdW0rPW07c3VtMis9bSptO2lmKG08PS4xNSlsZWFkKys7aWYobTw9LjMwKWZyb250Kys7CiB9CiBpZighTnx8azxOKi41KXJldHVyblswLDAsMCwwLDBdOwogY29uc3QgbWVhbj1zdW0vayxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCxzdW0yL2stbWVhbiptZWFuKSk7CiByZXR1cm5bay9OLGxlYWQvTio0LGZyb250L04qMixtZWFuLS41LHNkXTsKfQoKLyog5ZCE6aas44GuM+edgOWGheeiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYzplr7lgKTku6XkuIrjgI3jgavjgarjgovnorrnjofjgpLjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7PjgafopovnqY3jgoLjgosKICAg77yI6YeN44G/77yd56K6546Hw7coMeKIkueiuueOhynjgafjgIEz6aCt44KS6aCG44Gr5oq96YG444CC5q+O5Zue5ZCM44GY57WQ5p6c44Gr44Gq44KL44KI44GG44CB5Lmx5pWw44Gv44Os44O844K55YaF5a6544GL44KJ5rG644KB44KL77yJICovCmZ1bmN0aW9uIHNpbVVwc2V0KHAscG9wcyx0aHIpewogY29uc3QgTj1wLmxlbmd0aDtsZXQgc2VlZD0yMTY2MTM2MjYxOwogZm9yKGxldCBpPTA7aTxOO2krKylzZWVkPU1hdGguaW11bChzZWVkXihNYXRoLnJvdW5kKHBbaV0qMTAwMCkrcG9wc1tpXSo3OTE5KSwxNjc3NzYxOSk+Pj4wOwogY29uc3Qgcm5kPSgpPT57c2VlZD0oc2VlZCsweDZEMkI3OUY1KT4+PjA7bGV0IHQ9c2VlZDt0PU1hdGguaW11bCh0Xih0Pj4+MTUpLHR8MSk7dF49dCtNYXRoLmltdWwodF4odD4+PjcpLHR8NjEpO3JldHVybigodF4odD4+PjE0KSk+Pj4wKS80Mjk0OTY3Mjk2fTsKIGNvbnN0IHc9cC5tYXAoeD0+TWF0aC5tYXgoMWUtNCx4LygxLU1hdGgubWluKC45OTkseCkpKSk7CiBjb25zdCBLPTMwMDtsZXQgaGl0PTAsc3VtPTAsc3VtMj0wOwogZm9yKGxldCBrPTA7azxLO2srKyl7CiAgY29uc3QgdXNlZD1BcnJheShOKS5maWxsKGZhbHNlKTtsZXQgUz0wOwogIGZvcihsZXQgaj0wO2o8MztqKyspewogICBsZXQgdG90PTA7Zm9yKGxldCBpPTA7aTxOO2krKylpZighdXNlZFtpXSl0b3QrPXdbaV07CiAgIGxldCB4PXJuZCgpKnRvdCxwaWNrPS0xOwogICBmb3IobGV0IGk9MDtpPE47aSsrKXtpZih1c2VkW2ldKWNvbnRpbnVlO3gtPXdbaV07aWYoeDw9MCl7cGljaz1pO2JyZWFrfX0KICAgaWYocGljazwwKXtmb3IobGV0IGk9Ti0xO2k+PTA7aS0tKWlmKCF1c2VkW2ldKXtwaWNrPWk7YnJlYWt9fQogICB1c2VkW3BpY2tdPXRydWU7Uys9cG9wc1twaWNrXTsKICB9CiAgaWYoUz49dGhyKWhpdCsrO3N1bSs9UztzdW0yKz1TKlM7CiB9CiBjb25zdCBtPXN1bS9LO3JldHVybltsZ3QoKGhpdCsuNSkvKEsrMSkpLG0vMTUsTWF0aC5zcXJ0KE1hdGgubWF4KDAsc3VtMi9LLW0qbSkpLzEwXTsKfQovKiAx44Os44O844K544Gu5biC5aC06L6844G/44Gu54m55b6077ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu56K6546H44Go44CB5Lq65rCX6aCG5L2N44Gu5a6f57i+546H44KS5Y2K44CF44Gn5re344Gc44Gf56K6546HIOKGkiDjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7MgKi8KZnVuY3Rpb24gc2ltRmVhdChwUCxwb3BzLE4scHJpKXsKIGNvbnN0IHo9cFAubWFwKChwLGkpPT4uNSpsZ3QocCkrLjUqbGd0KHByaS5yYXRlKHBvcHNbaV0sTikpKTsKIHJldHVybiBzaW1VcHNldChub3JtU3VtKHosMykscG9wcyxVRS5BWElTLnVwc2V0LnRocik7Cn0KCi8qIOaknOiovOOBruWFseacieOCreODo+ODg+OCt+ODpe+8muWlvei1sOeOh+OBqOazouS5seW6puOBruaknOiovOOBr+OAgeWQjOOBmOODrOODvOOCueOBp+WQjOOBmOmHjeOBhOioiOeul++8iOmBjuWOu+aIkOe4vuODouODh+ODq+OBrueiuueOh+ODu+eJueW+tOmHj++8ieOCkuOBmeOCi+OAggogICDjg4fjg7zjgr/jga7lhoXlrrnjgYzlkIzjgZjplpPjga/ntZDmnpzjgpLkvb/jgYTlm57jgZfjgIEy44Gk55uu44Gu5qSc6Ki844KS6YCf44GP44GZ44KL77yI44OH44O844K/44GM5aSJ44KP44KL44Go6Ieq5YuV44Gn5L2c44KK55u044GZ77yJICovCmNvbnN0IFdGQz1uZXcgTWFwKCk7bGV0IFdGQ19TSUc9IiI7CmZ1bmN0aW9uIHdmU3luYyhyYWNlcyl7CiBsZXQgaD1yYWNlcy5sZW5ndGg7CiBmb3IoY29uc3QgcmMgb2YgcmFjZXMpe2g9KE1hdGguaW11bChoLDMxKStyYy5yb3dzLmxlbmd0aCl8MDtjb25zdCByMD1yYy5yb3dzWzBdO2lmKHIwKWg9KE1hdGguaW11bChoLDMxKSsocjAuZmluaXNofHwwKSo3KyhyMC5wb3B8fDApKjEzKyhyYy5kYXRlLmNoYXJDb2RlQXQoOSl8fDApKXwwfQogY29uc3Qgc2lnPXJhY2VzLmxlbmd0aCsifCIrKHJhY2VzLmxlbmd0aD9yYWNlc1tyYWNlcy5sZW5ndGgtMV0uZGF0ZToiIikrInwiK2g7CiBpZihzaWchPT1XRkNfU0lHKXtXRkMuY2xlYXIoKTtXRkNfU0lHPXNpZ30KfQpjb25zdCB3ZkdldD1pZD0+e2xldCBjPVdGQy5nZXQoaWQpO2lmKCFjKXtjPXt9O1dGQy5zZXQoaWQsYyl9cmV0dXJuIGN9OwoKLyog44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI5bCR44Gq44GE44OH44O844K/44Gv5YWo5L2T44G45a+E44Gb44KL77yJICovCmNsYXNzIFVwUHJpewogY29uc3RydWN0b3IoKXt0aGlzLmJhc2U9e246MCx1OjB9O3RoaXMubT1uZXcgTWFwKCl9CiBfayhpKXtyZXR1cm5bIlYiK2kudiwiQyIraS52KyJ8IitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCksIkwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSsifCIrbHZsRyhpLmx2bCxpLmdyZCksIk4iKyhpLm5vfHwwKSwiRyIraS5zdXJmKyJ8IisoaS5nY3x8MCldfQogYWRkKGkpe2lmKCFpfHxpLnk9PW51bGwpcmV0dXJuO3RoaXMuYmFzZS5uKys7dGhpcy5iYXNlLnUrPWkueTtmb3IoY29uc3QgayBvZiB0aGlzLl9rKGkpKXtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdTowfSk7eC5uKys7eC51Kz1pLnl9fQogZmVhdChpKXsKICBjb25zdCBiPXRoaXMuYmFzZS5uPjIwMD90aGlzLmJhc2UudS90aGlzLmJhc2UubjouMjg1LEs9NDA7CiAgY29uc3Qgc2g9KGsscGFyKT0+e2NvbnN0IHg9dGhpcy5tLmdldChrKXx8e246MCx1OjB9O3JldHVybih4LnUrSypwYXIpLyh4Lm4rSyl9OwogIGNvbnN0IFtrdixrYyxrbCxrbixrZ109dGhpcy5fayhpKSxwdj1zaChrdixiKSxwYz1zaChrYyxwdikscGw9c2goa2wsYikscG49c2goa24sYikscGc9c2goa2csYiksbGI9bGd0KGIpOwogIHJldHVybltsZ3QocHYpLWxiLGxndChwYyktbGIsbGd0KHBsKS1sYixsZ3QocG4pLWxiLGxndChwZyktbGJdOwogfQp9CgovKiDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvIjjg4vjg6Xjg7zjg4jjg7Pms5Xjg7tMMuato+WJh+WMluODu+aomea6luWMlu+8iSAqLwpmdW5jdGlvbiBzb2x2ZUxpbihBLGIpewogY29uc3Qgbj1iLmxlbmd0aCxNPUEubWFwKChyLGkpPT5bLi4ucixiW2ldXSk7CiBmb3IobGV0IGM9MDtjPG47YysrKXsKICBsZXQgcD1jO2ZvcihsZXQgcj1jKzE7cjxuO3IrKylpZihNYXRoLmFicyhNW3JdW2NdKT5NYXRoLmFicyhNW3BdW2NdKSlwPXI7CiAgW01bY10sTVtwXV09W01bcF0sTVtjXV07Y29uc3QgZD1NW2NdW2NdfHwxZS05OwogIGZvcihsZXQgaz1jO2s8PW47aysrKU1bY11ba10vPWQ7CiAgZm9yKGxldCByPTA7cjxuO3IrKylpZihyIT09Yyl7Y29uc3QgZj1NW3JdW2NdO2lmKGYpZm9yKGxldCBrPWM7azw9bjtrKyspTVtyXVtrXS09ZipNW2NdW2tdfQogfQogcmV0dXJuIE0ubWFwKHI9PnJbbl0pOwp9CmZ1bmN0aW9uIGZpdExvZ2l0KFgseSxsMil7CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbXU9QXJyYXkoZCkuZmlsbCgwKSxzZD1BcnJheShkKS5maWxsKDApOwogZm9yKGNvbnN0IHIgb2YgWClmb3IobGV0IGo9MDtqPGQ7aisrKW11W2pdKz1yW2pdL247CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspc2Rbal0rPShyW2pdLW11W2pdKSoqMi9uOwogZm9yKGxldCBqPTA7ajxkO2orKyl7c2Rbal09TWF0aC5zcXJ0KHNkW2pdKTtpZighKHNkW2pdPj0uMDUpKXNkW2pdPS4wNX0gICAvLyDjgbDjgonjgaTjgY3jgYzjgbvjgbznhKHjgYTliJfjga/jgIHlsI/jgZXjgaroqqTlt67jgaflibLjgaPjgablt6jlpKfjgarlgKTjgavjgarjgonjgarjgYTjgojjgYbjgIHkuIvpmZDjgpLoqK3jgZHjgosKIGNvbnN0IFo9WC5tYXAocj0+WzEsLi4uci5tYXAoKHYsaik9Pih2LW11W2pdKS9zZFtqXSldKSxEPWQrMSx3PUFycmF5KEQpLmZpbGwoMCk7CiBmb3IobGV0IGl0PTA7aXQ8MzA7aXQrKyl7CiAgY29uc3QgZz1BcnJheShEKS5maWxsKDApLEg9QXJyYXkuZnJvbSh7bGVuZ3RoOkR9LCgpPT5BcnJheShEKS5maWxsKDApKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCB6PVpbaV07bGV0IHM9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXMrPXdbal0qeltqXTsKICAgY29uc3QgcD1zaWdtKHMpLGU9cC15W2ldLHE9cCooMS1wKTsKICAgZm9yKGxldCBqPTA7ajxEO2orKyl7Z1tqXSs9ZSp6W2pdO2ZvcihsZXQgaz1qO2s8RDtrKyspSFtqXVtrXSs9cSp6W2pdKnpba119fQogIGZvcihsZXQgaj0xO2o8RDtqKyspe2dbal0rPWwyKndbal07SFtqXVtqXSs9bDJ9CiAgZm9yKGxldCBqPTA7ajxEO2orKylmb3IobGV0IGs9MDtrPGo7aysrKUhbal1ba109SFtrXVtqXTsKICBIWzBdWzBdKz0xZS05OwogIGNvbnN0IGR3PXNvbHZlTGluKEgsZyk7bGV0IG14PTA7Zm9yKGxldCBqPTA7ajxEO2orKyl7d1tqXS09ZHdbal07bXg9TWF0aC5tYXgobXgsTWF0aC5hYnMoZHdbal0pKX0KICBpZihteDwxZS03KWJyZWFrOwogfQogcmV0dXJue3csbXUsc2R9Owp9CmNvbnN0IHByZWRMb2dpdD0obSx4KT0+e2lmKG0udHlwZT09PSJnYm0iKXJldHVybiBnYm1Mb2dpdChtLHgpO2xldCBzPW0ud1swXTtmb3IobGV0IGo9MDtqPHgubGVuZ3RoO2orKyl7Y29uc3Qgej0oeFtqXS1tLm11W2pdKS9tLnNkW2pdO3MrPW0ud1tqKzFdKk1hdGgubWF4KC01LE1hdGgubWluKDUseikpfXJldHVybiBzfTsgICAvLyDlrabnv5LmmYLjga7nr4Tlm7LjgpLlpKfjgY3jgY/lpJbjgozjgZ/lhaXlipvjgafmmrTjgozjgarjgYTjgojjgYbCsTXjgavmipHjgYjjgosKCi8qIOipleS+oeaMh+aome+8muWvvuaVsOaQjeWkseODu+ODluODqeOCpOODpOODvOODu0FVQ+ODu+i8g+ato+iqpOW3rihFQ0UpICovCmZ1bmN0aW9uIGF1Y09mKHAseSl7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSk7bGV0IHJzPTAsbjE9MDsKIGZvcihsZXQgcj0wO3I8aWR4Lmxlbmd0aDtyKyspe2lmKHlbaWR4W3JdXSl7cnMrPXIrMTtuMSsrfX0KIGNvbnN0IG4wPXkubGVuZ3RoLW4xO3JldHVybiBuMSYmbjA/KHJzLW4xKihuMSsxKS8yKS8objEqbjApOi41Owp9CmZ1bmN0aW9uIG1ldHJpY3NPZihwLHkpewogY29uc3Qgbj15Lmxlbmd0aDtsZXQgbGw9MCxicj0wOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcT1NYXRoLm1pbigxLTFlLTksTWF0aC5tYXgoMWUtOSxwW2ldKSk7bGwtPXlbaV0/TWF0aC5sb2cocSk6TWF0aC5sb2coMS1xKTticis9KHBbaV0teVtpXSkqKjJ9CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksQj0xMDtsZXQgZWNlPTA7CiBmb3IobGV0IGI9MDtiPEI7YisrKXtjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBtcD1zLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLG15PXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCkvcy5sZW5ndGg7ZWNlKz1NYXRoLmFicyhtcC1teSkqcy5sZW5ndGgvbn0KIHJldHVybntuLGxsOmxsL24sYnJpZXI6YnIvbixhdWM6YXVjT2YocCx5KSxlY2V9Owp9CgovKiDnrYnntJrvvJrkuojmuKznorrnjofjga7pq5jjgYTpoIbjgavkuIrkvY0gMyUgLyA3JSAvIDEyJSAvIDIwJSAvIDI4JSAvIOaui+OCiu+8iFNTUy9TUy9TL0EvQi9D77yJICovCmNvbnN0IFVQX1NIQVJFPVtbIlNTUyIsLjAzXSxbIlNTIiwuMDddLFsiUyIsLjEyXSxbIkEiLC4yMF0sWyJCIiwuMjhdLFsiQyIsLjMwXV07CmZ1bmN0aW9uIG1ha2VDdXRzKHBzKXsKIGNvbnN0IHM9cHMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpO2xldCBhY2M9MDtjb25zdCBjdXRzPVtdOwogZm9yKGNvbnN0IFtnLHNoXSBvZiBVUF9TSEFSRSl7YWNjKz1zaDtpZihnPT09IkMiKXtjdXRzLnB1c2goW2csLTFdKTticmVha31jdXRzLnB1c2goW2csc1tNYXRoLm1pbihzLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzLmxlbmd0aCphY2MpLTEpKV1dKX0KIHJldHVybiBjdXRzOwp9CmNvbnN0IGdyYWRlT2Y9KGN1dHMscCk9Pntmb3IoY29uc3QgW2csY10gb2YgY3V0cylpZihwPj1jKXJldHVybiBnO3JldHVybiJDIn07CmZ1bmN0aW9uIGdyYWRlVGFibGUoY3V0cyxwcyx5cyl7CiBjb25zdCB0PXt9O1VQX1NIQVJFLmZvckVhY2goKFtnXSk9PnRbZ109e246MCxrOjB9KTsKIHBzLmZvckVhY2goKHAsaSk9Pntjb25zdCB4PXRbZ3JhZGVPZihjdXRzLHApXTt4Lm4rKzt4LmsrPXlzW2ldfSk7CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ10sdz13aWxzb24oeC5rLHgubik7eC5yYXRlPXgubj94LmsveC5uOjA7eC5sbz13WzBdO3guaGk9d1sxXX0KIHJldHVybiB0Owp9CgovKiDmlrDjg6Ljg4fjg6vjga7lhaXlipvvvJrnj77ooYzjg6Ljg4fjg6vjga7nibnlvrTph48oMTcpIO+8iyDjgqrjg4PjgrrnibnlvrTph48oNywg44Gq44GR44KM44GwMCkg77yLIOOCquODg+OCuuacieeEoSDvvIsg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546HKDMpICovCmZ1bmN0aW9uIHVwWCh1LGUpewogY29uc3Qgb2Rkcz11Lm1vZGU9PT0ib2RkcyI7CiByZXR1cm5bLi4udS5mLnNsaWNlKDEsMTgpLC4uLihvZGRzP3UuZi5zbGljZSgxOCwyNSk6WzAsMCwwLDAsMCwwLDBdKSxvZGRzPzE6MCwuLi5lXTsKfQpmdW5jdGlvbiB1cHNldEN1c3RvbShNLHUsZSxwYyxzaW0pewogaWYoIU0pcmV0dXJuIG51bGw7CiBsZXQgejtjb25zdCB6MD1sZ3QodS5wMCkseHg9KCk9PntsZXQgeD11cFgodSxlKTtpZihNLnBhY2UpeD1bLi4ueCwuLi4ocGN8fFswLDAsMCwwLDBdKV07aWYoTS5zaW0peD1bLi4ueCxzaW0/MTowLC4uLihzaW18fFswLDAsMF0pXTtyZXR1cm4geH07CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHh4KCkpOwogZWxzZSBpZihNLmtpbmQ9PT0iYmxlbmQiKXo9KHowK3ByZWRMb2dpdChNLm1vZGVsLHh4KCkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHMmJm0udmVyPT09ND9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsgICAvLyB2ZXI6Mu+8neODrOODvOOCueeVquWPt+OBrueJueW+tOmHj+OBpOOBjeOAguWPpOOBhOS/neWtmOOBr+S9v+OCj+OBquOBhAoKLyogLS0tLS0tLS0tLSDms6LkubHluqbjga7kuojmg7PliKXjgavjgIHlrp/pmpvjga7miZXmiLvjgafnorrjgYvjgoHjgosgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBsb2FkUGF5RnVsbCgpewogY29uc3QgbT1uZXcgTWFwKCk7CiB0cnl7CiAgY29uc3QgZGF5cz1hd2FpdCBQcm9taXNlLnJhY2UoW3BheUFsbCgpLG5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQoKCk9PnIoW10pLDE1MDAwKSldKTsKICBmb3IoY29uc3QgZGF5IG9mIGRheXMpZm9yKGNvbnN0IHIgb2YgKGRheS5yYWNlc3x8W10pKWlmKHIucmFjZUlkKW0uc2V0KHIucmFjZUlkLHt3aW46ci53aW58fFtdLHBsYWNlOnIucGxhY2V8fFtdfSk7CiB9Y2F0Y2goZSl7fQogcmV0dXJuIG07Cn0KY29uc3QgbWVkT2Y9YT0+e2lmKCFhLmxlbmd0aClyZXR1cm4gbnVsbDtjb25zdCBzPWEuc2xpY2UoKS5zb3J0KCh4LHkpPT54LXkpLG09TWF0aC5mbG9vcihzLmxlbmd0aC8yKTtyZXR1cm4gcy5sZW5ndGglMj9zW21dOihzW20tMV0rc1ttXSkvMn07CmNvbnN0IGF2Z09mPWE9PmEubGVuZ3RoP2EucmVkdWNlKCh4LHkpPT54K3ksMCkvYS5sZW5ndGg6bnVsbDsKLyog5LqI5oOz44Gu562J57Sa44GU44Go44Gr77ya5a6f6Zqb44Gu5rOi5Lmx546H44CB5Y2Y5Yud6YWN5b2T77yI5Yud44Gh6aas77yJ44CB6KSH5Yud6YWN5b2T77yIM+edgOWGhTPpoK3jga7lkIjoqIjvvInjgIEz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiIICovCmZ1bmN0aW9uIHBheW91dFRhYmxlKHRlc3QsZ3JhZGVPZjIscGF5KXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MCxucDowLHdpbnM6W10scGw6W10scG9wczpbXX0pOwogZm9yKGNvbnN0IHMgb2YgdGVzdCl7CiAgY29uc3QgeD10W2dyYWRlT2YyKHMpXTt4Lm4rKzt4LmsrPXMueTsKICBjb25zdCBwPXBheS5nZXQocy5yYWNlSWQpOwogIGlmKCFwfHwhcC53aW4ubGVuZ3RofHxwLnBsYWNlLmxlbmd0aDwzKWNvbnRpbnVlOwogIHgubnArKzt4LndpbnMucHVzaChwLndpblswXS55ZW4pOwogIGNvbnN0IHBsPXAucGxhY2Uuc2xpY2UoMCwzKTt4LnBsLnB1c2gocGwucmVkdWNlKChhLGIpPT5hK2IueWVuLDApKTt4LnBvcHMucHVzaChwbC5yZWR1Y2UoKGEsYik9PmErKGIucG9wfHwwKSwwKSk7CiB9CiBjb25zdCBvdXQ9e307CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ107CiAgb3V0W2ddPXtuOngubixyYXRlOngubj94LmsveC5uOjAsbnA6eC5ucCxhdmdXaW46YXZnT2YoeC53aW5zKSxtZWRXaW46bWVkT2YoeC53aW5zKSwKICAgc2hhcmUxMDAwOngubnA/eC53aW5zLmZpbHRlcih2PT52Pj0xMDAwKS5sZW5ndGgveC5ucDpudWxsLHNoYXJlMzAwMDp4Lm5wP3gud2lucy5maWx0ZXIodj0+dj49MzAwMCkubGVuZ3RoL3gubnA6bnVsbCwKICAgYXZnUGxhY2VTdW06YXZnT2YoeC5wbCksYXZnUG9wU3VtOmF2Z09mKHgucG9wcyl9O30KIHJldHVybiBvdXQ7Cn0KLyog562J57Sa44GM5LiK44GM44KL44G744Gp44CB5a6f6Zqb44Gu5omV5oi744KC5aSn44GN44GP44Gq44Gj44Gm44GE44KL44GL77yI6Zqj44KK5ZCI44GG562J57Sa44Gu5q+U6LyD44Gn44CB6YCG6Lui44GM44GE44GP44Gk44GC44KL44GL77yJICovCmZ1bmN0aW9uIHBheW91dE1vbm90b25lKHRhYil7CiBjb25zdCBncz1VUF9TSEFSRS5tYXAoKFtnXSk9PmcpLHJvd3M9Z3MubWFwKGc9PnRhYltnXSkuZmlsdGVyKHg9PngubnA+PTMwKTsKIGxldCBvaz0wLHRvdD0wOwogZm9yKGxldCBpPTA7aSsxPHJvd3MubGVuZ3RoO2krKyl7dG90Kys7Y29uc3QgYT1yb3dzW2ldLGI9cm93c1tpKzFdO2lmKChhLmF2Z1BsYWNlU3VtPz8wKT49KGIuYXZnUGxhY2VTdW0/PzApKi45NSYmKGEuYXZnUG9wU3VtPz8wKT49KGIuYXZnUG9wU3VtPz8wKSouOTUpb2srK30gICAvLyDlgbbnhLbjga7lsI/jgZXjgarpgIbou6LvvIgx5Ymy5Lul5YaF77yJ44Gv6Kix5a65CiByZXR1cm57b2ssdG90fTsKfQoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5VcHNldEZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAyMS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5ELG91dD1bXTsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBwYXlGdWxsPW9wdHMucGF5RnVsbHx8YXdhaXQgbG9hZFBheUZ1bGwoKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogd2ZTeW5jKHJhY2VzKTsKIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgVXBQcmkoKSxwcHJpPW5ldyBQb3BQcmkoKSxTPVtdOwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxhbT1uZXcgTWFwKCk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylhZ2dBZGQoYW0scik7CiAgY29uc3QgaW5mbz1hZ2dJbmZvKGFtLmdldChTdHJpbmcocmMucm93c1swXSYmcmMucm93c1swXS5yYWNlSWQpKSk7CiAgaWYoaW5mbyYmaW5mby55IT1udWxsJiZyYy5kYXRlPj1TVEFSVCl7CiAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgIGNvbnN0IGhhc09kZHM9Ui5ldmVyeShyPT5yLm9kZHM+MSksb2Q9aGFzT2Rkcz9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IHdjPXdmR2V0KHJjLnJvd3NbMF0ucmFjZUlkKTsKICAgIGlmKCF3Yy51KXtjb25zdCBhPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTt3Yy51PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhKTt3Yy51UFA9YS5wUH0KICAgIGNvbnN0IGFwPXtwUDp3Yy51UFB9LHU9d2MudTsKICAgIGNvbnN0IHBvcHM9Ui5tYXAocj0+ci5wb3ApLHBvcHNPaz1SLmxlbmd0aD49NiYmcG9wcy5ldmVyeSh2PT52PjApOwogICAgbGV0IHUwPW51bGw7aWYob2Qpe2lmKHdjLnUwPT09dW5kZWZpbmVkKXt0cnl7d2MudTA9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG51bGwsVUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsbnVsbCkpfWNhdGNoKGUpe3djLnUwPW51bGx9fXUwPXdjLnUwfSAgIC8vIOOCquODg+OCuuacquWPluW+l+OBruOBqOOBjeeUqO+8iOWQjOOBmOODrOODvOOCueOCkuOAgeOCquODg+OCuuOBquOBl+OBrueJueW+tOOBp+S9nOOBo+OBn+OCguOBru+8iQogICAgUy5wdXNoKHtkYXRlOnJjLmRhdGUscmFjZUlkOnJjLnJvd3NbMF0ucmFjZUlkLHUsdTAsZHJvcE9kZHM6KGkqNDA1MDM+Pj4wKSUxMDwzLGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSksc2ltOnBvcHNPaz9zaW1GZWF0KGFwLnBQLHBvcHMsUi5sZW5ndGgscHByaSk6bnVsbCxrZWVwOihpKjI2NTQ0MzU3NjE+Pj4wKSUxMD49Myx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pOwogIHtjb25zdCBSUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7aWYoUlIubGVuZ3RoPj02JiZSUi5ldmVyeShyPT5yLnBvcD4wKSYmIVJSLnNvbWUocj0+L+manOWusy8udGVzdChTdHJpbmcoci5yYWNlTmFtZXx8IiIpKSkpcHByaS5hZGQoUlIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLFJSLmxlbmd0aCl9CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgcmMucm93cz1udWxsOyAgIC8vIOS9v+OBhOe1guOBiOOBn+ihjOOCkuino+aUvu+8iOODoeODouODquevgOe0hO+8iQogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVMuZmlsdGVyKHM9PnMuZGF0ZTxURVNUKSx0ZXN0PVMuZmlsdGVyKHM9PnMuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25BbGw6Uy5sZW5ndGgsblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVCxiYXNlOlMubGVuZ3RoP1MucmVkdWNlKChhLHMpPT5hK3MueSwwKS9TLmxlbmd0aDowfTsKIGlmKHRlc3QubGVuZ3RoPDMwMHx8dHJhaW4ubGVuZ3RoPDE1MDApe2J1c3koZmFsc2UpO3JldHVybnsuLi5yZXMsZXJyb3I6YOaknOiovOOBq+S9v+OBiOOCi+acn+mWk+OBruODrOODvOOCueOBjOi2s+OCiuOBvuOBm+OCk++8iOWtpue/kuWBtCR7dHJhaW4ubGVuZ3RofeODu+aknOiovOWBtCR7dGVzdC5sZW5ndGh977yJ44CC5qSc6Ki844Gu6ZaL5aeL5pel44KS5pep44KB44KL44GL44CB44OH44O844K/44KS5aKX44KE44GX44Gm44GP44Gg44GV44GE44CCYH19CiBjb25zdCB5VD10ZXN0Lm1hcChzPT5zLnkpLHkwPXRyYWluLm1hcChzPT5zLnkpOwogLy8g54++6KGM44Oi44OH44Or44Gu5qSc6Ki85pyf6ZaT44Gn44Gu5oiQ57i+CiBjb25zdCBwMD10ZXN0Lm1hcChzPT5zLnUucDApLG0wPW1ldHJpY3NPZihwMCx5VCk7CiAvLyDmlrDjg6Ljg4fjg6vvvIjlrabnv5LmnJ/plpPjga7jgb/jgafkvZzjgovvvInjgILluILloLTovrzjgb/jga7nibnlvrQoc2ltKeODu+ODmuODvOOCueOBr+OAgeS9v+OBiOOCi+OBqOOBjeOBoOOBkeippuOBl+OBpuOAgeiJr+OBj+OBquOCjOOBsOi2s+OBmQogY29uc3QgeEZvcj0ocyxmbCxpc1RyYWluKT0+ewogIGxldCB4PXVwWCgoaXNUcmFpbiYmcy51MCYmcy5kcm9wT2Rkcyk/cy51MDpzLnUscy5lKTsgICAvLyDlrabnv5Ljgafjga8z5Ymy44Gu44Os44O844K544Gn44CB44Kq44OD44K66L6844G/44Gu54m55b6044KS44Kq44OD44K644Gq44GX44Gu54m55b6044Gr572u44GN5o+b44GI44CB44Kq44OD44K65pyq5Y+W5b6X44Gu44Go44GN44Gr44KC5a++5b+c44Gn44GN44KL44KI44GG44Gr44GZ44KLCiAgaWYoZmwucGFjZSl4PVsuLi54LC4uLnMucGNdOwogIGlmKGZsLnNpbSl7Y29uc3QgdXNlPXMuc2ltJiYoIWlzVHJhaW58fHMua2VlcCk7eD1bLi4ueCx1c2U/MTowLC4uLih1c2U/cy5zaW06WzAsMCwwXSldfSAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafluILloLTovrzjgb/jga7nibnlvrTjgpLpmqDjgZfjgIHkurrmsJfjgYzmnKrnorrlrprjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICByZXR1cm4geDsKIH07CiBjb25zdCBmaXQ9Zmw9PnsKICBjb25zdCBtPWZpdExvZ2l0KHRyYWluLm1hcChzPT54Rm9yKHMsZmwsdHJ1ZSkpLHkwLDMpOwogIGNvbnN0IHo9dGVzdC5tYXAocz0+cHJlZExvZ2l0KG0seEZvcihzLGZsLGZhbHNlKSkpOwogIHJldHVybntmbCxtLG1OOm1ldHJpY3NPZih6Lm1hcChzaWdtKSx5VCksbUI6bWV0cmljc09mKHoubWFwKCh2LGkpPT5zaWdtKChsZ3QocDBbaV0pK3YpLzIpKSx5VCl9OwogfTsKIGNvbnN0IFY9e2Jhc2U6Zml0KHtwYWNlOmZhbHNlLHNpbTpmYWxzZX0pfTsKIGNvbnN0IGNvdlRyPXRyYWluLmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxjb3ZUZT10ZXN0LmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxwYWNlT2s9Y292VHI+PTQwMCYmY292VGU+PTEwMDsKIGNvbnN0IHNpbVRyPXRyYWluLmZpbHRlcihzPT5zLnNpbSkubGVuZ3RoLHNpbVRlPXRlc3QuZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltT2s9c2ltVHI+PTEwMDAmJnNpbVRlPj0yMDA7CiByZXMucGFjZT17Y292VHJhaW46Y292VHIsY292VGVzdDpjb3ZUZSx1c2VkOmZhbHNlfTtyZXMuc2ltPXt0cmFpbk46c2ltVHIsdGVzdE46c2ltVGUsdXNlZDpmYWxzZX07CiBpZihzaW1PaylWLnNpbT1maXQoe3BhY2U6ZmFsc2Usc2ltOnRydWV9KTsKIGlmKHBhY2VPaylWLnBhY2U9Zml0KHtwYWNlOnRydWUsc2ltOmZhbHNlfSk7CiBpZihwYWNlT2smJnNpbU9rKVYuYm90aD1maXQoe3BhY2U6dHJ1ZSxzaW06dHJ1ZX0pOwogcmVzLm0wPW0wO3Jlcy5tTj1WLmJhc2UubU47cmVzLm1CPVYuYmFzZS5tQjsKIGlmKFYuc2ltKXJlcy5tUz1WLnNpbS5tTjtpZihWLnBhY2UpcmVzLm1QPVYucGFjZS5tTjtpZihWLmJvdGgpcmVzLm1QUz1WLmJvdGgubU47CiBsZXQgY3VyPVYuYmFzZTsKIGlmKFYuc2ltJiZjdXIubU4ubGwtVi5zaW0ubU4ubGw+PS4wMDEpY3VyPVYuc2ltOwoge2NvbnN0IGNhbmQ9Y3VyLmZsLnNpbT9WLmJvdGg6Vi5wYWNlO2lmKGNhbmQmJmN1ci5tTi5sbC1jYW5kLm1OLmxsPj0uMDAxKWN1cj1jYW5kfQogY29uc3QgZmxjPWN1ci5mbCx1c2VQYWNlPSEhZmxjLnBhY2UsdXNlU2ltPSEhZmxjLnNpbTsKIHJlcy5wYWNlLnVzZWQ9dXNlUGFjZTtyZXMuc2ltLnVzZWQ9dXNlU2ltO3Jlcy51c2VQYWNlPXVzZVBhY2U7cmVzLnVzZVNpbT11c2VTaW07CiAvLyDli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDvvIjmnKjjga7nqY3jgb/ph43jga3vvInvvJrmjqHnlKjjgZfjgZ/nibnlvrTjga7ntYTjgb/lkIjjgo/jgZvjgafjgIHjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDjgajlkIzjgZjmnJ/plpPjgafmr5TjgbnjgosKIGxldCB1c2VHYm09ZmFsc2U7CiB0cnl7CiAgY29uc3QgYzg1PU1hdGguZmxvb3IodHJhaW4ubGVuZ3RoKi44NSksZml0Uz10cmFpbi5zbGljZSgwLGM4NSksY2FsUz10cmFpbi5zbGljZShjODUpLFhjPWNhbFMubWFwKHM9PnhGb3IocyxmbGMsZmFsc2UpKSx5Yz1jYWxTLm1hcChzPT5zLnkpOwogIGNvbnN0IGdtPWF3YWl0IGdibUZpdChmaXRTLm1hcChzPT54Rm9yKHMsZmxjLHRydWUpKSxmaXRTLm1hcChzPT5zLnkpLHtyb3VuZHM6MTIwLGRlcHRoOjMsbHI6LjA2LG1pbkxlYWY6NjAsdmFsWDpYYyx2YWxZOnljLHByb2dyZXNzOmFzeW5jKGEsYjIpPT57YnVzeSh0cnVlLGDms6LkubHluqbvvJrli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDjgpLlrabnv5LkuK3igKYgJHthfS8ke2IyfWApO2F3YWl0IHNsZWVwKDApfX0pOwogIGdibUNhbGlicmF0ZShnbSxYYyx5Yyk7CiAgY29uc3Qgemc9dGVzdC5tYXAocz0+cHJlZExvZ2l0KGdtLHhGb3IocyxmbGMsZmFsc2UpKSksbU5nPW1ldHJpY3NPZih6Zy5tYXAoc2lnbSkseVQpLG1CZz1tZXRyaWNzT2YoemcubWFwKCh2LGkpPT5zaWdtKChsZ3QocDBbaV0pK3YpLzIpKSx5VCk7CiAgcmVzLm1HYm09bU5nO3Jlcy5uR2JtVHJlZXM9Z20udHJlZXMubGVuZ3RoOwogIGlmKG1OZy5sbDw9Y3VyLm1OLmxsLS4wMDEpe3VzZUdibT10cnVlO2N1cj17Zmw6ZmxjLG06Z20sbU46bU5nLG1COm1CZ319CiB9Y2F0Y2goZSl7cmVzLmdibUVycm9yPVN0cmluZyhlJiZlLm1lc3NhZ2V8fGUpfQogcmVzLnVzZUdibT11c2VHYm07CiAvLyDmjqHnlKjjga7liKTmlq3vvJrnj77ooYzjgojjgorlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuiJr+OBj+OBquOCiuOAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqAogY29uc3QgYmV0dGVyPShtLHJlZik9PihyZWYubGwtbS5sbD49LjAwMikmJihtLmF1Yz49cmVmLmF1Yy0uMDAzKTsKIGxldCBraW5kPSJvbGQiOwogY29uc3Qga2M9W1sibmV3IixjdXIubU5dLFsiYmxlbmQiLGN1ci5tQl1dLmZpbHRlcigoW2ssbV0pPT5iZXR0ZXIobSxtMCkpLnNvcnQoKGEsYik9PmFbMV0ubGwtYlsxXS5sbClbMF07CiBpZihrYylraW5kPWtjWzBdOwogY29uc3QgTTI9Y3VyLm0seHg9cz0+eEZvcihzLGZsYyxmYWxzZSk7CiByZXMua2luZD1raW5kOwogLy8g562J57Sa44Gu5YiH44KM55uu44Gv44CM5a2m57+S5YG044CN44Gu5LqI5ris44GL44KJ5rG644KB44CB5qSc6Ki85YG044Gn5a6f6Zqb44Gu5rOi5Lmx546H44KS5ris44KL77yI5q2j55u044Gq5a6f57i+546H77yJCiBjb25zdCBwcmVkVHJhaW49cz0+a2luZD09PSJvbGQiP3MudS5wMDpraW5kPT09Im5ldyI/c2lnbShwcmVkTG9naXQoTTIseHgocykpKTpzaWdtKChsZ3Qocy51LnAwKStwcmVkTG9naXQoTTIseHgocykpKS8yKTsKIGNvbnN0IGN1dHM9bWFrZUN1dHModHJhaW4ubWFwKHByZWRUcmFpbikpOwogY29uc3QgcFRlc3Q9dGVzdC5tYXAocHJlZFRyYWluKSx0YWI9Z3JhZGVUYWJsZShjdXRzLHBUZXN0LHlUKTsKIHJlcy5jdXRzPWN1dHM7cmVzLnRhYj10YWI7CiAvLyDkuojmg7Pjga7nrYnntJrjgZTjgajjgavjgIHlrp/pmpvjga7miZXmiLvjgafnorrjgYvjgoHjgovvvIjmjqHnlKjjgZfjgZ/jg6Ljg4fjg6vjgajjgIHmqJnmupbjg6Ljg4fjg6vjga7kuKHmlrnvvIkKIHtjb25zdCBpZHg9bmV3IE1hcCh0ZXN0Lm1hcCgocyxpKT0+W3MsaV0pKTsKICByZXMucGF5VGFiPXBheW91dFRhYmxlKHRlc3Qscz0+Z3JhZGVPZihjdXRzLHBUZXN0W2lkeC5nZXQocyldKSxwYXlGdWxsKTsKICByZXMucGF5VGFiU3RkPXBheW91dFRhYmxlKHRlc3Qscz0+e2NvbnN0IEc9VUUuQVhJUy51cHNldC5ncmFkZXNbcy51Lm1vZGVdO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpaWYocy51LnAwPj1jKXJldHVybiBnO3JldHVybiJDIn0scGF5RnVsbCk7CiAgcmVzLnBheU1vbm89cGF5b3V0TW9ub3RvbmUocmVzLnBheVRhYik7cmVzLnBheU1vbm9TdGQ9cGF5b3V0TW9ub3RvbmUocmVzLnBheVRhYlN0ZCk7CiAgcmVzLnBheVJhY2VzPU9iamVjdC52YWx1ZXMocmVzLnBheVRhYikucmVkdWNlKChhLHgpPT5hK3gubnAsMCk7fQogcmVzLm1vZGVsPXt2ZXI6NCxraW5kLHBhY2U6dXNlUGFjZSxzaW06dXNlU2ltLGdibTp1c2VHYm0sbW9kZWw6TTIscGF5VGFiOnJlcy5wYXlUYWIsY3V0cyxyYXRlczpPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModGFiKS5tYXAoKFtnLHhdKT0+W2cse3JhdGU6eC5yYXRlLGxvOngubG8saGk6eC5oaSxuOngubn1dKSksCiAgYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsbTAsbU46cmVzLm1OLG1COnJlcy5tQixtUDpyZXMubVB8fG51bGwsbVM6cmVzLm1TfHxudWxsLG1QUzpyZXMubVBTfHxudWxsLHBhY2VDb3Y6W2NvdlRyLGNvdlRlXSxzaW1Db3Y6W3NpbVRyLHNpbVRlXX07CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiB1cHNldFJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yI44CcJHtlc2Moci50ZXN0U3RhcnQpfeOBruWJjeaXpe+8ie+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAguWFqOS9k+OBruazouS5seeOhyAke3BjdChyLmJhc2UsMSl944CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Oi44OH44Or77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93KCLnj77ooYwiLHIubTApfSR7cm93KCLmlrDvvIjjgrPjg7zjgrnliKXjgpLov73liqDvvIkiLHIubU4pfSR7cm93KCLnj77ooYzjgajmlrDjga7lubPlnYciLHIubUIpfSR7ci5tUz9yb3coIuaWsO+8iOOCs+ODvOOCueWIpe+8i+W4guWgtOi+vOOBv+OBrueiuueOh++8iSIsci5tUyk6IiJ9JHtyLm1QP3Jvdygi5paw77yI44Kz44O844K55Yil77yL44Oa44O844K577yJIixyLm1QKToiIn0ke3IubVBTP3Jvdygi5paw77yI44GZ44G544Gm77yJIixyLm1QUyk6IiJ9JHtyLm1HYm0/cm93KCLmlrDvvIjmnKjjga7nqY3jgb/ph43jga3jg7vli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDvvIkiLHIubUdibSk6IiJ9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1yLm1HYm0/YDxkaXYgY2xhc3M9InNtYWxsIj7mnKjjga7nqY3jgb/ph43jga3vvIjli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDvvInvvJoke3IudXNlR2JtPyI8Yj7ntYTjgb/lkIjjgo/jgZvjga7lirnmnpzjgpLmi77jgYjjgabjgIHmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHmjqHnlKjjgZfjgb7jgZfjgZ/jgII8L2I+Ijoi5piO56K644Gq5pS55ZaE44GM44Gq44GL44Gj44Gf44Gf44KB44CB5o6h55So44GX44Gm44GE44G+44Gb44KT44CCIn3vvIjmnKggJHtyLm5HYm1UcmVlc33mnKzvvIk8L2Rpdj5gOiIiOwogaCs9ci5zaW0mJnIuc2ltLnRlc3ROPj0yMDA/YDxkaXYgY2xhc3M9InNtYWxsIj7luILloLTovrzjgb/jga7nibnlvrTvvIjlkITppqzjga7norrnjofjgajkurrmsJfpoIbkvY3jgYvjgonjgIHms6LkubHjgavjgarjgovnorrnjofjgpLnm7TmjqXopovnqY3jgoLjgovvvInvvJrlrabnv5LlgbQke3Iuc2ltLnRyYWluTn3jg7vmpJzoqLzlgbQke3Iuc2ltLnRlc3ROfeODrOODvOOCueOBp+S9v+OBiOOBvuOBl+OBn+OAgiR7ci51c2VTaW0/IjxiPuWKoOOBiOOCi+OBqOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBn+OCgeaOoeeUqOOBl+OBvuOBl+OBn+OAgjwvYj4iOiLliqDjgYjjgabjgoLmmI7norrjgarmlLnlloTjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHmjqHnlKjjgZfjgabjgYTjgb7jgZvjgpPjgIIifTwvZGl2PmA6YDxkaXYgY2xhc3M9InNtYWxsIj7luILloLTovrzjgb/jga7nibnlvrTvvJrkurrmsJfpoIbkvY3jgaTjgY3jga7miJDnuL7jgYzlsJHjgarjgY/jgIHmpJzoqLzjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgII8L2Rpdj5gOwogaCs9ci5wYWNlJiZyLnBhY2UudXNlZD9gPGRpdiBjbGFzcz0ic21hbGwiPuODmuODvOOCueODu+iEmuizquOBrueJueW+tOmHj++8muWtpue/kuWBtCR7ci5wYWNlLmNvdlRyYWlufeODu+aknOiovOWBtCR7ci5wYWNlLmNvdlRlc3R944Os44O844K544Gn5L2/44GI44G+44GX44Gf44CCJHtyLnVzZVBhY2U/IjxiPuODmuODvOOCueOCkuWKoOOBiOOCi+OBqOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBn+OCgeaOoeeUqOOBl+OBvuOBl+OBn+OAgjwvYj4iOiLjg5rjg7zjgrnjgpLliqDjgYjjgabjgoLmmI7norrjgarmlLnlloTjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHmjqHnlKjjgZfjgabjgYTjgb7jgZvjgpPjgIIifTwvZGl2PmA6YDxkaXYgY2xhc3M9InNtYWxsIj7jg5rjg7zjgrnjg7vohJros6rvvJrpgJrpgY7poIbkvY3jgaTjgY3jga7miJDnuL7jgYzlsJHjgarjgY/vvIjlrabnv5LlgbQke3IucGFjZT9yLnBhY2UuY292VHJhaW46MH3jg7vmpJzoqLzlgbQke3IucGFjZT9yLnBhY2UuY292VGVzdDowfeODrOODvOOCue+8ieOAgeaknOiovOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguioreWumuOBruOAjOODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBl+OAjeOCkuWun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiBjb25zdCBubT17b2xkOiLnj77ooYzjg6Ljg4fjg6vjga7jgb7jgb7vvIjmlrDjg6Ljg4fjg6vjga/mmI7norrjgavjga/oia/jgY/jgarjgonjgarjgYvjgaPjgZ/vvIkiLG5ldzoi5paw44Oi44OH44Or44KS5o6h55SoIisoci51c2VTaW0/Iu+8iOW4guWgtOi+vOOBv++8iSI6IiIpKyhyLnVzZVBhY2U/Iu+8iOODmuODvOOCuei+vOOBv++8iSI6IiIpLGJsZW5kOiLnj77ooYzjgajmlrDjga7lubPlnYfjgpLmjqHnlKgiKyhyLnVzZVNpbT8i77yI5biC5aC06L6844G/77yJIjoiIikrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIil9W3Iua2luZF07CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci5raW5kPT09Im9sZCI/InduIjoib2sifSI+PGI+57WQ5p6c77yaJHtubX08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya5a++5pWw5pCN5aSx44GMMC4wMDLku6XkuIrmlLnlloTjgZfjgIFBVUPjgYzmgqrljJbjgZfjgabjgYTjgarjgYTjgZPjgajjgII8L3NwYW4+PC9kaXY+YDsKIGgrPXBheW91dFJlcG9ydChyKTsKIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+562J57Sa44GU44Go44GuPGI+5a6f6Zqb44Gu5rOi5Lmx546HPC9iPu+8iOaknOiovOWBtOODuzk1JeOBruW5he+8ieOAguOBk+OBruaVsOWtl+OBjOOAgeazouS5seW6puOCv+ODluOBq+ihqOekuuOBleOCjOOCi+OCiOOBhuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBbZ10gb2YgVVBfU0hBUkUpe2NvbnN0IHg9ci50YWJbZ107aCs9YDx0cj48dGQ+JHtnfTwvdGQ+PHRkPiR7eC5ufTwvdGQ+PHRkPjxiPiR7cGN0KHgucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QoeC5sbyl944CcJHtwY3QoeC5oaSl9PC90ZD48L3RyPmB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBjb25zdCBtb25vPVVQX1NIQVJFLm1hcCgoW2ddKT0+ci50YWJbZ10ucmF0ZSkuZXZlcnkoKHYsaSxhKT0+aT09PTB8fHY8PWFbaS0xXSsuMDMpOwogaWYoIW1vbm8paCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuetiee0muOBrumghuOBq+Wun+e4vueOh+OBjOWNmOiqv+OBq+S4i+OBjOOBo+OBpuOBhOOBvuOBm+OCk+OAguaknOiovOWBtOOBruODrOODvOOCueaVsOOBjOWwkeOBquOBhOOBqOi1t+OBjeOBvuOBme+8iOWBtueEtuOBruevhOWbsuOBruOBk+OBqOOBjOWkmuOBhO+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBwYXlvdXRSZXBvcnQocil7CiBpZighci5wYXlUYWJ8fCFyLnBheVJhY2VzKXJldHVybic8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHlrp/pmpvjga7miZXmiLvjgafjga7norroqo3jga/jgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/vvIjjgIzpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgI3jgafmiZXmiLvjgoLlj5blvpfjgZXjgozjgb7jgZnvvInjgII8L2Rpdj4nOwogY29uc3QgeWVuPXY9PnY9PW51bGw/Ii0iOk1hdGgucm91bmQodikudG9Mb2NhbGVTdHJpbmcoKSsi5YaGIix0Ymw9KHQsdGl0bGUpPT57CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj48Yj4ke3RpdGxlfTwvYj48L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5oOz44Gu562J57SaPC90aD48dGg+44Os44O844K55pWwPC90aD48dGg+5a6f6Zqb44Gu5rOi5Lmx546HPC90aD48dGg+5Yud44Gh6aas44Gu5Y2Y5Yud6YWN5b2T77yI5Lit5aSu5YCk77yP5bmz5Z2H77yJPC90aD48dGg+5Y2Y5YudMTAwMOWGhuS7peS4ijwvdGg+PHRoPuikh+WLnTPpoK3jga7lkIjoqIjvvIjlubPlnYfvvIk8L3RoPjx0aD4z552A5YaF44Gu5Lq65rCX5ZCI6KiIPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IFtnXSBvZiBVUF9TSEFSRSl7Y29uc3QgeD10W2ddO2grPWA8dHI+PHRkPjxiPiR7Z308L2I+PC90ZD48dGQ+JHt4Lm5wfTwvdGQ+PHRkPiR7cGN0KHgucmF0ZSwxKX08L3RkPjx0ZD4ke3llbih4Lm1lZFdpbil977yPJHt5ZW4oeC5hdmdXaW4pfTwvdGQ+PHRkPiR7eC5zaGFyZTEwMDA9PW51bGw/Ii0iOnBjdCh4LnNoYXJlMTAwMCwwKX08L3RkPjx0ZD4ke3llbih4LmF2Z1BsYWNlU3VtKX08L3RkPjx0ZD4ke3guYXZnUG9wU3VtPT1udWxsPyItIjp4LmF2Z1BvcFN1bS50b0ZpeGVkKDEpfTwvdGQ+PC90cj5gfQogIHJldHVybiBoKyI8L3Rib2R5PjwvdGFibGU+PC9kaXY+In07CiBsZXQgaD1gPGgzPuS6iOaDs+OBruetiee0muOBlOOBqOOBruOAgeWun+mam+OBruaJleaIu++8iOaknOiovOWBtCAke3IucGF5UmFjZXN944Os44O844K577yJPC9oMz48ZGl2IGNsYXNzPSJzbWFsbCI+5rOi5Lmx5bqm44Gu5LqI5oOz44GM5b2T44Gf44Gj44Gm44GE44KL44Gq44KJ44CB562J57Sa44GM6auY44GE44G744Gp44CB5Yud44Gh6aas44Gu5Y2Y5Yud6YWN5b2T44O76KSH5YudM+mgreOBruWQiOioiOODuzPnnYDlhoXjga7kurrmsJflkIjoqIjjgYzlpKfjgY3jgY/jgarjgorjgb7jgZnjgII8L2Rpdj5gOwogaCs9dGJsKHIucGF5VGFiLHIua2luZD09PSJvbGQiPyLmjqHnlKjjgZfjgZ/kuojmg7PvvIjnj77ooYzjg6Ljg4fjg6vvvIkiOiLmjqHnlKjjgZfjgZ/kuojmg7PvvIjlho3moKHmraPlvozvvIkiKTsKIGNvbnN0IG09ci5wYXlNb25vOwogaCs9bS50b3Q/YDxkaXYgY2xhc3M9ImJhbm5lciAke20ub2s9PT1tLnRvdD8ib2siOiJ3biJ9Ij48Yj4ke20ub2s9PT1tLnRvdD8i562J57Sa44GM5LiK44GM44KL44G744Gp44CB5a6f6Zqb44Gu5omV5oi744KC5aSn44GN44GP44Gq44Gj44Gm44GE44G+44GZ44CCIjoi562J57Sa44GM5LiK44GM44Gj44Gm44KC5omV5oi744GM5aSn44GN44GP44Gq44KJ44Gq44GE566H5omA44GM44GC44KK44G+44GZ77yIIittLm9rKyIvIittLnRvdCsi57WE77yJ44CCIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+6Zqj44KK5ZCI44GG562J57Sa44Gu5q+U6LyD44Gn44CB6KSH5YudM+mgreOBruWQiOioiOaJleaIu+OBqDPnnYDlhoXjga7kurrmsJflkIjoqIjjga7kuKHmlrnjgYzjgIHkuIrjga7nrYnntJrjga7mlrnjgYzlpKfjgY3jgYTvvIjjgb7jgZ/jga81JeS7peWGheOBruW3ru+8iee1hOOBruaVsOOBp+OBmeOAguWNmOWLnemFjeW9k+OBruS4reWkruWApOOBr+WwkeaVsOOBruODrOODvOOCueOBoOOBqOWBtueEtuOBp+OBtuOCjOOCi+OBn+OCgeOAgeWIpOWumuOBq+OBr+S9v+OBo+OBpuOBhOOBvuOBm+OCk+OAgjwvc3Bhbj48L2Rpdj5gOiIiOwogaWYoci5raW5kIT09Im9sZCIpaCs9dGJsKHIucGF5VGFiU3RkLCLlj4LogIPvvJrmqJnmupbjg6Ljg4fjg6vjga7nrYnntJrjgaflkIzjgZjpm4boqIjjgpLjgZfjgZ/loLTlkIgiKSsoci5wYXlNb25vU3RkLnRvdD9gPGRpdiBjbGFzcz0ic21hbGwiPuaomea6luODouODh+ODq+OBruetiee0muOBruaVtOWQiO+8miR7ci5wYXlNb25vU3RkLm9rfS8ke3IucGF5TW9ub1N0ZC50b3R957WEPC9kaXY+YDoiIik7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiB1cHNldFN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0VXBzZXRNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7mqJnmupbjg6Ljg4fjg6vvvIjlrabnv5LmuIjjgb/jga7lm7rlrprjg6Ljg4fjg6vvvInjgILlrp/nuL7njofjga/lrabnv5LmmYLjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44OrIixuZXc6IuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqyIsYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+WdhyJ9W00ua2luZF07CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7bm19PC9iPuOBp+WIpOWumuS4re+8iOaknOiovOaXpSAke2VzYyhNLmF0KX3vvI/mpJzoqLwgJHtNLm5UZXN0feODrOODvOOCue+8ieOAguetiee0muOBruWun+e4vueOh+OBr+OAgeODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+a4rOOBo+OBn+WApOOBp+OBmeOAgjwvZGl2PmA7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDov73liqDjga7mnaHku7bvvJrppqzloLTnirbmhYvjg7vmnqDpoIbvvIjppqznlarjga7kvY3nva7vvInjg7voqr/mlZnluKvjg7vooYDntbEKICogIOOBmeOBueOBpuOAjOOBneOBruaXpeOCiOOCiuWJjeOBq+WIhuOBi+OBo+OBpuOBhOOCi+aDheWgseOAjeOBoOOBkeOBp+S9nOOCiuOAgeWKueaenOOBjOOBguOCi+OBqOOBjeOBoOOBke+8iOaknOiovOOBp++8ieaOoeeUqOOBmeOCi+OAggogKiAgIOODu+mmrOWgtOeKtuaFi+OBruebuOaAp++8muOBneOBrummrOOBjOOAgeWQjOOBmOmmrOWgtOeKtuaFi++8iOiJr++8j+eojemHjeOAnOS4jeiJr++8ieOBp+mBjuWOu+OBq+OBqeOCjOOBoOOBkei1sOOBo+OBn+OBiwogKiAgIOODu+aeoOmghuOBruacieWIqeS4jeWIqe+8mumWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LjgZTjgajjga7jgIHlhoXjgJzlpJbjga4z552A5YaF546H44Gu5YGP44KKCiAqICAg44O76Kq/5pWZ5bir77ya6Kq/5pWZ5bir44Gu6YGO5Y6744GuM+edgOWGheeOhwogKiAgIOODu+ihgOe1se+8mueItuODu+avjeOBrueItuOBjOOAgeWQjOOBmOiKneODgMOX6Led6Zui44Gn6YGO5Y6744Gr44Gp44KM44Gg44GR6LWw44Gj44Gf44GL77yI5Ye66aas6KGo44GL44KJ5bCR44GX44Ga44Gk6JOE56mN44CC6Kqt44KB44Gf6aas44Gg44GR77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgZ29pbmdDb2RlPXQ9Pnt0PVN0cmluZyh0fHwiIik7cmV0dXJuL+S4jeiJry8udGVzdCh0KT80Oi/nqI0vLnRlc3QodCk/Mjov6YeNLy50ZXN0KHQpPzM6L+iJry8udGVzdCh0KT8xOjB9Owpjb25zdCBnb2luZ0NhdD1nPT5nPT09MT8xOihnPj0yPzI6MCk7ICAgIC8vIDE96Imv44CBMj3nqI3ph43jgJzkuI3oia/jgIEwPeS4jeaYjgpjb25zdCBHT0lOR19OQU1FPXswOiLkuI3mmI4iLDE6IuiJryIsMjoi6YeN57O7In07CmNvbnN0IHZlbnVlRnJvbUlkPWlkPT57aWQ9U3RyaW5nKGlkfHwiIik7cmV0dXJuL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOihpZC5zcGxpdCgiLSIpWzNdfHwiIil9OwpsZXQgUEVEPXt9OyAgIC8vIOmmrOWQjSDihpIge3M654i2LGQ65q+NLG065q+N44Gu54i2feOAguWHuummrOihqOOBi+OCieWwkeOBl+OBmuOBpOiThOepjeOBmeOCiwoKLyog5p6g6aCG77yI6aas55Wq44Gu5L2N572u77yJ77ya6ZaL5YKs5aC0w5foip3jg4DDl+i3nembouOBlOOBqOOBq+OAgeWGheOAnOWkljXljLrliIbjga4z552A5YaF546HICovCmNsYXNzIERyYXdQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBfYihudW0sTil7cmV0dXJuIE4+MT9NYXRoLm1pbig0LE1hdGgubWF4KDAsTWF0aC5mbG9vcigobnVtLTEpL04qNSkpKToyfQogX2sodixzLGQpe3JldHVybiB2KyJ8IitzKyJ8IitkaXN0QihkKX0KIGFkZCh2LHMsZCxudW0sTix0Myl7CiAgaWYoIW51bXx8Tjw4KXJldHVybjsKICBjb25zdCBrPXRoaXMuX2sodixzLGQpLGI9dGhpcy5fYihudW0sTik7bGV0IGc9dGhpcy5tLmdldChrKTsKICBpZighZyl0aGlzLm0uc2V0KGssZz17bjowLHQ6MCxiOltbMCwwXSxbMCwwXSxbMCwwXSxbMCwwXSxbMCwwXV19KTsKICBnLm4rKztnLnQrPXQzO2cuYltiXVswXSsrO2cuYltiXVsxXSs9dDM7CiB9CiBmZWF0KHYscyxkLG51bSxOKXsKICBpZighbnVtfHxOPDgpcmV0dXJuIDA7CiAgY29uc3QgZz10aGlzLm0uZ2V0KHRoaXMuX2sodixzLGQpKTtpZighZ3x8Zy5uPDMwMClyZXR1cm4gMDsKICBjb25zdCBiPXRoaXMuX2IobnVtLE4pLGJhc2U9Zy50L2cubixLPTYwLFtuLHRdPWcuYltiXTsKICByZXR1cm4gbGd0KCh0K0sqYmFzZSkvKG4rSykpLWxndChiYXNlKTsKIH0KfQovKiDooYDntbHvvJrniLbjg7vmr43jga7niLbjgZTjgajjga7jgIHoip3jg4DDl+i3nembouOBp+OBruOAjOWun+mam+OBrjPnnYDlhoXmlbAgw7cg5pyf5b6F44GuM+edgOWGheaVsO+8iDMv6aCt5pWw44Gu5ZCI6KiI77yJ44CNICovCmNsYXNzIFNpcmVQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBrZXkoa2luZCx2LHNmLGQpe3JldHVybiBraW5kKyJ8Iit2KyJ8IitzZisifCIrZGlzdEIoZCl9CiBhZGQocGVkLHNmLGQsdDMsTil7CiAgaWYoIXBlZHx8Tjw4KXJldHVybjtjb25zdCBlPU1hdGgubWluKC41LDMvTik7CiAgZm9yKGNvbnN0IFtraW5kLHZdIG9mIFtbInMiLHBlZC5zXSxbIm0iLHBlZC5tXV0pewogICBpZighdiljb250aW51ZTtjb25zdCBrPXRoaXMua2V5KGtpbmQsdixzZixkKTtsZXQgeD10aGlzLm0uZ2V0KGspOwogICBpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHQ6MCxlOjB9KTt4Lm4rKzt4LnQrPXQzO3guZSs9ZTsKICB9CiB9CiBmZWF0KHBlZCxzZixkKXsKICBpZighcGVkKXJldHVyblswLDAsMCwwXTsKICBjb25zdCBnPSh2LGtpbmQpPT57aWYoIXYpcmV0dXJuWzAsMF07Y29uc3QgeD10aGlzLm0uZ2V0KHRoaXMua2V5KGtpbmQsdixzZixkKSk7aWYoIXh8fHgubjwyNSlyZXR1cm5bMCwwXTtyZXR1cm5bTWF0aC5sb2coKHgudCszKS8oeC5lKzMpKSwxXX07CiAgcmV0dXJuWy4uLmcocGVkLnMsInMiKSwuLi5nKHBlZC5tLCJtIildOwogfQp9Ci8qIDHpoK3jgbbjgpPjga7ov73liqDnibnlvrTvvIg55YCL77yJ77ya6aas5aC044Gu55u45oCn44O75pyJ54Sh77yP5p6g6aCG44Gu5YGP44KK77yP6Kq/5pWZ5bir44Gu5beu44O75pyJ54Sh77yP54i244Gu55u45oCn44O75pyJ54Sh77yP5q+N44Gu54i244Gu55u45oCn44O75pyJ54ShICovCmZ1bmN0aW9uIGV4dEZlYXRIb3JzZShyLGgscmMsY3R4LGIpewogY29uc3QgbjA9aD9oLm46MCxwUz0oKGg/aC50b3AzOjApKzMqYikvKG4wKzMpOwogbGV0IGdmaXQ9MCxnaz0wO2NvbnN0IGduPWgmJmguZ24mJnJjLmdjPjA/aC5nbltyYy5nY106bnVsbDsKIGlmKGduJiZnblswXT49Mil7Z2ZpdD0oZ25bMV0rMypwUykvKGduWzBdKzMpLXBTO2drPTF9CiBjb25zdCBkcmF3PWN0eC5kcmF3P2N0eC5kcmF3LmZlYXQocmMudixyYy5zdXJmLHJjLmRpc3Qsci5udW0scmMuTik6MDsKIGxldCB0ZT0wLHRrPTA7Y29uc3QgdHI9Y3R4LnRyJiZyLnRyYWluZXI/Y3R4LnRyLmdldChyLnRyYWluZXIpOm51bGw7CiBpZih0ciYmdHIubj49MjApe3RlPSh0ci50MysuMio0MCkvKHRyLm4rNDApLS4yO3RrPTF9CiBjb25zdCBzZj1jdHguc2lyZT9jdHguc2lyZS5mZWF0KGN0eC5wZWQmJmN0eC5wZWRbci5ob3JzZV0scmMuc3VyZixyYy5kaXN0KTpbMCwwLDAsMF07CiByZXR1cm5bZ2ZpdCxnayxkcmF3LHRlLHRrLC4uLnNmXTsKfQovKiDlsaXmrbTjgYvjgonjgIHlh7rppqzooajjgYvjgonoqq3jgpPjgaDooYDntbHjgpLok4TnqY3vvIjpgLHmnKvjga7lj5blvpfjga7jgZ/jgbPjgavmm7TmlrDjgZfjgabkv53lrZjvvIkgKi8KYXN5bmMgZnVuY3Rpb24gcGVkaWdyZWVVcGRhdGUoY2FyZHMpewogbGV0IGFkZGVkPTAsc2Vlbj0wOwogZm9yKGNvbnN0IGQgb2YgT2JqZWN0LmtleXMoY2FyZHMpKWZvcihjb25zdCBjIG9mIGNhcmRzW2RdfHxbXSlmb3IoY29uc3QgaCBvZiAoYy5ob3JzZXN8fFtdKSl7CiAgY29uc3QgbmFtZT1VRS5ubihoLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIik7aWYoIW5hbWUpY29udGludWU7CiAgaWYoaC5zaXJlfHxoLmRhbVNpcmUpe3NlZW4rKztjb25zdCBvPXtzOlVFLm5uKGguc2lyZXx8IiIpLGQ6VUUubm4oaC5kYW18fCIiKSxtOlVFLm5uKGguZGFtU2lyZXx8IiIpfTsKICAgY29uc3QgcD1QRURbbmFtZV07aWYoIXB8fHAucyE9PW8uc3x8cC5tIT09by5tKXtQRURbbmFtZV09bzthZGRlZCsrfX0KIH0KIGlmKGFkZGVkKXt0cnl7YXdhaXQgbWV0YVB1dCgicGVkIixQRUQpfWNhdGNoKGUpe319CiByZXR1cm57c2VlbixhZGRlZCx0b3RhbDpPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gcGVkaWdyZWVMb2FkKCl7dHJ5e2NvbnN0IHg9YXdhaXQgbWV0YUdldCgicGVkIik7aWYoeCYmdHlwZW9mIHg9PT0ib2JqZWN0IilQRUQ9eH1jYXRjaChlKXt9fQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOBruaknOiovOODu+WGjeagoeatowogKiAg55uu55qE77ya5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOBhuaVsOWtl+OBq+OBmeOCi+OAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB44Os44O844K55YmN44Gr5YiG44GL44KL5oOF5aCx44Gg44GR44Gn5ZCE6aas44Gu56K6546H44KS6KiI566XCiAqICAgICAgICDjg7vpgY7ljrvmiJDnuL7jgYvjgonkvZzjgovjg6Ljg4fjg6vjga7norrnjofvvIjjgqrjg4PjgrrjgpLkvb/jgo/jgarjgYTvvIkKICogICAgICAgIOODu+S6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh++8iOW4guWgtOOBruaDheWgseOAguOCquODg+OCuuWPluW+l+W+jOOBr+S6uuawl+mghuS9jeOBjOaxuuOBvuOCi++8iQogKiAgIDIpIDLjgaTjgpLntYTjgb/lkIjjgo/jgZvjgZ/mlrDjg6Ljg4fjg6vvvIjjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvInjgpLjgIHlrabnv5LlgbTjga7mnJ/plpPjgafkvZzjgosKICogICAzKSDnj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIhNT0RFTF9UUkFJTl9FTkTku6XpmY3vvInjgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgosKICogICA0KSDmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgajjgY3jgaDjgZHmjqHnlKjjgILotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7liIfjgoznm67jgoLjgIHjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgosKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5Yu+6YWN44OW44O844K544OG44Kj44Oz44Kw77yI5rWF44GE5rG65a6a5pyo44KS44CB6Kqk5beu44KS55u044GZ5ZCR44GN44Gr56mN44G/6YeN44Gt44KL44Oi44OH44Or77yJCiAqICDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDjga/jgIznibnlvrTph4/jgpLotrPjgZflkIjjgo/jgZvjgovjgI3jga7jgafjgIHntYTjgb/lkIjjgo/jgZvjga7lirnmnpzvvIjph43ppqzloLTDl+OBk+OBruihgOe1scOX44GT44Gu6Led6Zui44CBCiAqICDkurrmsJfjgajjg6Ljg4fjg6vjga7po5/jgYTpgZXjgYTmlrnjgarjganvvInjgoTjgIHmm7LjgYzjgaPjgZ/plqLkv4LjgpLlj5bjgorjgZPjgbzjgZnjgILmnKjjgpLnqY3jgb/ph43jga3jgovjgajjgIHjgZ3jgozjgonjgpLmi77jgYjjgovjgIIKICogIOaknOiovOWBtOOBp+OAgeODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sOOCiOOCiuaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBmeOCi+OAggogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmZ1bmN0aW9uIGdibVRocmVzaG9sZHMoWCxkLG5iKXsKIGNvbnN0IG49WC5sZW5ndGgsc3RlcD1NYXRoLm1heCgxLE1hdGguZmxvb3Iobi82MDAwMCkpLHRocj1bXTsKIGZvcihsZXQgaj0wO2o8ZDtqKyspewogIGNvbnN0IHY9W107Zm9yKGxldCBpPTA7aTxuO2krPXN0ZXApdi5wdXNoKFhbaV1bal0pO3Yuc29ydCgoYSxiKT0+YS1iKTsKICBjb25zdCB0PVtdO2ZvcihsZXQgcT0xO3E8bmI7cSsrKXtjb25zdCB4PXZbTWF0aC5taW4odi5sZW5ndGgtMSxNYXRoLmZsb29yKHEqdi5sZW5ndGgvbmIpKV07aWYoIXQubGVuZ3RofHx4PnRbdC5sZW5ndGgtMV0pdC5wdXNoKHgpfQogIHRoci5wdXNoKHQpOwogfQogcmV0dXJuIHRocjsKfQpjb25zdCBnYm1CaW49KHYsdCk9PntsZXQgbG89MCxoaT10Lmxlbmd0aDt3aGlsZShsbzxoaSl7Y29uc3QgbT0obG8raGkpPj4xO2lmKHY8PXRbbV0paGk9bTtlbHNlIGxvPW0rMX1yZXR1cm4gbG99OwovKiAx5pys44Gu5pyo44Gu5LqI5ris5YCkICovCmZ1bmN0aW9uIGdibVRyZWUodHIseCl7CiBsZXQgaz0wOwogd2hpbGUodHIuZltrXT49MClrPXhbdHIuZltrXV08PXRyLnRba10/dHIubFtrXTp0ci5yW2tdOwogcmV0dXJuIHRyLnZba107Cn0KLyog44Oi44OH44Or5YWo5L2T44Gu5LqI5ris77yI44Ot44K444OD44OI77yJ44CCYSxiIOOBr+OAgei8g+ato+eUqOOBruODh+ODvOOCv+OBp+WQiOOCj+OBm+OBn+ijnOatoyAqLwpmdW5jdGlvbiBnYm1Mb2dpdChtLHgpewogbGV0IHo9bS5iYXNlOwogZm9yKGNvbnN0IHRyIG9mIG0udHJlZXMpeis9Z2JtVHJlZSh0cix4KTsKIHJldHVybiBtLmEqeittLmI7Cn0KLyog5a2m57+S77yaWCDjga/nibnlvrTph4/jga7phY3liJfjga7phY3liJfjgIF5IOOBrzAvMeOAgnZhbFgvdmFsWSDjgYzjgYLjgozjgbDjgIHjgZ3jga7lr77mlbDmkI3lpLHjgYzmgqrljJbjgZfntprjgZHjgZ/jgajjgZPjgo3jgafmraLjgoHjgosgKi8KYXN5bmMgZnVuY3Rpb24gZ2JtRml0KFgseSxvKXsKIG89b3x8e307CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbmI9by5iaW5zfHwzMixkZXB0aD1vLmRlcHRofHw0LGxyPW8ubHJ8fC4wOCxyb3VuZHM9by5yb3VuZHN8fDEwMCxtaW5MZWFmPW8ubWluTGVhZnx8ODAsbDI9by5sMnx8ODsKIGNvbnN0IHRocj1nYm1UaHJlc2hvbGRzKFgsZCxuYiksQj1uZXcgVWludDhBcnJheShuKmQpOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3Qgcj1YW2ldO2ZvcihsZXQgaj0wO2o8ZDtqKyspQltpKmQral09Z2JtQmluKHJbal0sdGhyW2pdKX0KIGNvbnN0IHAwPU1hdGgubWluKC45OTksTWF0aC5tYXgoLjAwMSx5LnJlZHVjZSgoYSxiKT0+YStiLDApL24pKSxiYXNlPU1hdGgubG9nKHAwLygxLXAwKSk7CiBjb25zdCBGPW5ldyBGbG9hdDY0QXJyYXkobikuZmlsbChiYXNlKSxnPW5ldyBGbG9hdDY0QXJyYXkobiksaD1uZXcgRmxvYXQ2NEFycmF5KG4pLG5vZGU9bmV3IEludDMyQXJyYXkobik7CiBjb25zdCBoYXNWPSEhKG8udmFsWCYmby52YWxYLmxlbmd0aCksRnY9aGFzVj9uZXcgRmxvYXQ2NEFycmF5KG8udmFsWC5sZW5ndGgpLmZpbGwoYmFzZSk6bnVsbDsKIGNvbnN0IHRyZWVzPVtdO2xldCBiZXN0TEw9SW5maW5pdHksYmVzdE49MDsKIGNvbnN0IE5CSU49bmIrMTsKIGZvcihsZXQgcj0wO3I8cm91bmRzO3IrKyl7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcD0xLygxK01hdGguZXhwKC1GW2ldKSk7Z1tpXT1wLXlbaV07aFtpXT1wKigxLXApfQogIGNvbnN0IHRyPXtmOltdLHQ6W10sbDpbXSxyOltdLHY6W119LG5ld05vZGU9KCk9Pnt0ci5mLnB1c2goLTEpO3RyLnQucHVzaCgwKTt0ci5sLnB1c2goLTEpO3RyLnIucHVzaCgtMSk7dHIudi5wdXNoKDApO3JldHVybiB0ci5mLmxlbmd0aC0xfTsKICBjb25zdCByb290PW5ld05vZGUoKTtub2RlLmZpbGwocm9vdCk7CiAgbGV0IGZyb250aWVyPVtyb290XTsKICBmb3IobGV0IGx2bD0wO2x2bDxkZXB0aCYmZnJvbnRpZXIubGVuZ3RoO2x2bCsrKXsKICAgY29uc3QgaWR4T2Y9bmV3IE1hcChmcm9udGllci5tYXAoKGssaSk9PltrLGldKSksbmY9ZnJvbnRpZXIubGVuZ3RoLGhpc3Q9bmV3IEZsb2F0NjRBcnJheShuZipkKk5CSU4qMyk7CiAgIGZvcihsZXQgaT0wO2k8bjtpKyspewogICAgY29uc3QgZmk9aWR4T2YuZ2V0KG5vZGVbaV0pO2lmKGZpPT09dW5kZWZpbmVkKWNvbnRpbnVlOwogICAgY29uc3QgZ2k9Z1tpXSxoaT1oW2ldLGIwPShmaSpkKSpOQklOKjM7CiAgICBmb3IobGV0IGo9MDtqPGQ7aisrKXtjb25zdCBrPWIwKyhqKk5CSU4rQltpKmQral0pKjM7aGlzdFtrXSs9Z2k7aGlzdFtrKzFdKz1oaTtoaXN0W2srMl0rPTF9CiAgIH0KICAgY29uc3QgbmV4dEY9W107CiAgIGZvcihsZXQgZmk9MDtmaTxuZjtmaSsrKXsKICAgIGNvbnN0IGs9ZnJvbnRpZXJbZmldLGIwPShmaSpkKSpOQklOKjM7CiAgICBsZXQgRz0wLEhzPTAsQz0wO2ZvcihsZXQgYj0wO2I8TkJJTjtiKyspe0crPWhpc3RbYjArYiozXTtIcys9aGlzdFtiMCtiKjMrMV07Qys9aGlzdFtiMCtiKjMrMl19CiAgICB0ci52W2tdPS1scipHLyhIcytsMik7CiAgICBsZXQgYmVzdD0wLGJqPS0xLGJiPS0xO2NvbnN0IHBhcmVudD1HKkcvKEhzK2wyKTsKICAgIGZvcihsZXQgaj0wO2o8ZDtqKyspewogICAgIGxldCBHTD0wLEhMPTAsQ0w9MDsKICAgICBmb3IobGV0IGI9MDtiPE5CSU4tMTtiKyspewogICAgICBjb25zdCBxPWIwKyhqKk5CSU4rYikqMztHTCs9aGlzdFtxXTtITCs9aGlzdFtxKzFdO0NMKz1oaXN0W3ErMl07CiAgICAgIGlmKENMPG1pbkxlYWZ8fEMtQ0w8bWluTGVhZiljb250aW51ZTsKICAgICAgY29uc3QgZ2Fpbj1HTCpHTC8oSEwrbDIpKyhHLUdMKSooRy1HTCkvKEhzLUhMK2wyKS1wYXJlbnQ7CiAgICAgIGlmKGdhaW4+YmVzdCl7YmVzdD1nYWluO2JqPWo7YmI9Yn0KICAgICB9CiAgICB9CiAgICBpZihiaj49MCYmYmVzdD4xZS02JiZiYjx0aHJbYmpdLmxlbmd0aCl7CiAgICAgdHIuZltrXT1iajt0ci50W2tdPXRocltial1bYmJdO2NvbnN0IEw9bmV3Tm9kZSgpLFI9bmV3Tm9kZSgpO3RyLmxba109TDt0ci5yW2tdPVI7bmV4dEYucHVzaChMLFIpOwogICAgIHRyLl9iaj10ci5fYmp8fHt9O3RyLl9ialtrXT1bYmosYmJdOwogICAgfQogICB9CiAgIGlmKCFuZXh0Ri5sZW5ndGgpYnJlYWs7CiAgIGZvcihsZXQgaT0wO2k8bjtpKyspe2NvbnN0IGs9bm9kZVtpXTtpZih0ci5mW2tdPj0wKXtjb25zdCBxPXRyLl9ialtrXTtub2RlW2ldPUJbaSpkK3FbMF1dPD1xWzFdP3RyLmxba106dHIucltrXX19CiAgIC8vIOOBvuOBoOWIhuWJsuOBl+OBpuOBhOOBquOBhOiRieOBruWApOOBr+OAgeOBguOBqOOBp+WtkOOBruWApO+8iOWtkOOBjOaxuuOBvuOCi+OBvuOBp+OBr+imquOBruWApO+8ieOBqOOBl+OBpuS9v+OBhuOAguasoeOBrumajuWxpOOBruiRieOBruWApOOCkuioiOeul+OBmeOCiwogICBjb25zdCBzdW1zPW5ldyBNYXAoKTsKICAgZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3Qgaz1ub2RlW2ldO2xldCBzPXN1bXMuZ2V0KGspO2lmKCFzKXN1bXMuc2V0KGsscz1bMCwwXSk7c1swXSs9Z1tpXTtzWzFdKz1oW2ldfQogICBmb3IoY29uc3QgW2ssc10gb2Ygc3Vtcyl0ci52W2tdPS1scipzWzBdLyhzWzFdK2wyKTsKICAgZnJvbnRpZXI9bmV4dEY7CiAgfQogIGRlbGV0ZSB0ci5fYmo7CiAgZm9yKGxldCBpPTA7aTxuO2krKylGW2ldKz10ci52W25vZGVbaV1dOwogIHRyZWVzLnB1c2godHIpOwogIGlmKGhhc1YpewogICBmb3IobGV0IGk9MDtpPG8udmFsWC5sZW5ndGg7aSsrKUZ2W2ldKz1nYm1UcmVlKHRyLG8udmFsWFtpXSk7CiAgIGlmKHIlND09PTN8fHI9PT1yb3VuZHMtMSl7CiAgICBsZXQgbGw9MDtmb3IobGV0IGk9MDtpPEZ2Lmxlbmd0aDtpKyspe2NvbnN0IHA9TWF0aC5taW4oMS0xZS05LE1hdGgubWF4KDFlLTksMS8oMStNYXRoLmV4cCgtRnZbaV0pKSkpO2xsLT1vLnZhbFlbaV0/TWF0aC5sb2cocCk6TWF0aC5sb2coMS1wKX0KICAgIGxsLz1Gdi5sZW5ndGg7aWYobGw8YmVzdExMLTFlLTYpe2Jlc3RMTD1sbDtiZXN0Tj10cmVlcy5sZW5ndGh9ZWxzZSBpZih0cmVlcy5sZW5ndGgtYmVzdE4+PTE2KWJyZWFrOwogICB9CiAgfQogIGlmKHIlMz09PTImJm8ucHJvZ3Jlc3MpYXdhaXQgby5wcm9ncmVzcyhyKzEscm91bmRzKTsKIH0KIGNvbnN0IGtlZXA9aGFzViYmYmVzdE4+MD9iZXN0Tjp0cmVlcy5sZW5ndGg7CiBjb25zdCByZD12PT5NYXRoLnJvdW5kKHYqMWU1KS8xZTU7CiBjb25zdCBtPXt0eXBlOiJnYm0iLGJhc2U6cmQoYmFzZSksYToxLGI6MCx0cmVlczp0cmVlcy5zbGljZSgwLGtlZXApLm1hcCh0PT4oe2Y6dC5mLHQ6dC50Lm1hcChyZCksbDp0Lmwscjp0LnIsdjp0LnYubWFwKHJkKX0pKX07CiByZXR1cm4gbTsKfQovKiDovIPmraPvvJrjg63jgrjjg4Pjg4jjgpIgYcOXeitiIOOBq+ijnOato++8iOi8g+ato+eUqOOBruODh+ODvOOCv+OBp+OAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOCj+OBm+OCi++8iSAqLwpmdW5jdGlvbiBnYm1DYWxpYnJhdGUobSxYYyx5Yyl7CiBjb25zdCB6PVhjLm1hcCh4PT5bZ2JtTG9naXQobSx4KV0pOwogY29uc3QgZj1maXRMb2dpdCh6LHljLC41KTsKIG0uYT1NYXRoLnJvdW5kKGYud1sxXS9mLnNkWzBdKjFlNSkvMWU1O20uYj1NYXRoLnJvdW5kKChmLndbMF0tZi53WzFdKmYubXVbMF0vZi5zZFswXSkqMWU1KS8xZTU7CiByZXR1cm4gbTsKfQoKY29uc3QgUExLRVk9ImtlaWJhX3BsYWNlX3YxIjsKCi8qIOS6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh++8iOWwkeOBquOBhOODh+ODvOOCv+OBrzMv6aCt5pWw44G45a+E44Gb44KL77yJICovCmNsYXNzIFBvcFByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5tPW5ldyBNYXAoKX0KIGtleShwb3AsTil7cmV0dXJuIE1hdGgubWluKDE4LHBvcCkrInwiK01hdGgubWluKDE4LE1hdGgubWF4KDYsTikpfQogYWRkKGxpc3QsTil7CiAgZm9yKGNvbnN0IFtwb3AsZmluXSBvZiBsaXN0KXsKICAgaWYoIShwb3A+MCl8fGZpbj09bnVsbCljb250aW51ZTsKICAgY29uc3Qgaz10aGlzLmtleShwb3AsTik7bGV0IHg9dGhpcy5tLmdldChrKTtpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHQ6MH0pOwogICB4Lm4rKztpZihmaW48PTMpeC50Kys7CiAgfQogfQogcmF0ZShwb3AsTil7CiAgY29uc3QgeD10aGlzLm0uZ2V0KHRoaXMua2V5KHBvcCxOKSl8fHtuOjAsdDowfSxiYXNlPU1hdGgubWluKC45NSwzL01hdGgubWF4KE4sMykpLEs9MzA7CiAgcmV0dXJuKHgudCtLKmJhc2UpLyh4Lm4rSyk7CiB9Cn0KLyog56K6546H44Gu5ZCI6KiI44KS44Gh44KH44GG44GpdGFyZ2V044Gr44GZ44KL77yI44Ot44K444OD44OI44KS5LiA5qeY44Gr44Ga44KJ44GZ77yJICovCmZ1bmN0aW9uIG5vcm1TdW0oeix0YXJnZXQpewogbGV0IGxvPS0xNCxoaT0xNDsKIGZvcihsZXQgaXQ9MDtpdDw2MDtpdCsrKXtjb25zdCBtaWQ9KGxvK2hpKS8yO2xldCBzPTA7Zm9yKGNvbnN0IHYgb2YgeilzKz1zaWdtKHYrbWlkKTtpZihzPnRhcmdldCloaT1taWQ7ZWxzZSBsbz1taWR9CiBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4gei5tYXAodj0+c2lnbSh2K2MpKTsKfQovKiAx6aCt44Gu5YWl5Yqb77ya44Oi44OH44Or56K6546H44O75Lq65rCX44OZ44O844K544Gu5a6f57i+546H44O75Lq65rCX44Gu5L2N572u44O76aCt5pWw44O744Oi44OH44Or5YaF44Gu6aCG5L2NICovCmZ1bmN0aW9uIHBsYWNlWChwUCxwb3AsTixwcmkscmFua0ZyYWMpewogcmV0dXJuW2xndChwUCksbGd0KHByaS5yYXRlKHBvcCxOKSksKHBvcC0xKS9NYXRoLm1heCgxLE4tMSksTi8xNixyYW5rRnJhYyxwb3A9PT0xPzE6MCxwb3A8PTM/MTowXTsKfQpjb25zdCByYW5rRnJhY3M9cHM9Pntjb25zdCBvPXBzLm1hcCgocCxpKT0+aSkuc29ydCgoYSxiKT0+cHNbYl0tcHNbYV0pLHJrPUFycmF5KHBzLmxlbmd0aCk7by5mb3JFYWNoKChpLHIpPT5ya1tpXT1yL01hdGgubWF4KDEscHMubGVuZ3RoLTEpKTtyZXR1cm4gcmt9Owpjb25zdCBwb3BzRnJvbU9kZHM9b2Q9Pm9kLm1hcCh2PT4xK29kLmZpbHRlcih3PT53PHYpLmxlbmd0aCk7Cgpjb25zdCBnZXRQbGFjZU1vZGVsPSgpPT57dHJ5e2NvbnN0IG09SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShQTEtFWSl8fCJudWxsIik7cmV0dXJuIG0mJm0ua2luZD09PSJuZXciJiZtLm1vZGVsJiZtLnZlcj09PTI/bTpudWxsfWNhdGNoKGUpe3JldHVybiBudWxsfX07CgovKiDlj43lv5zjga7norroqo3nlKjvvJrkuojmuKzjga7ljLrplpPjgZTjgajjga7lrp/nuL7vvIjkv6HpoLzmgKfvvIkgKi8KZnVuY3Rpb24gcmVsaWFiaWxpdHlCaW5zKHAseSxCKXsKIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKSxuPXkubGVuZ3RoLG91dD1bXTsKIGZvcihsZXQgYj0wO2I8QjtiKyspewogIGNvbnN0IHM9aWR4LnNsaWNlKE1hdGguZmxvb3IoYipuL0IpLE1hdGguZmxvb3IoKGIrMSkqbi9CKSk7aWYoIXMubGVuZ3RoKWNvbnRpbnVlOwogIGNvbnN0IGs9cy5yZWR1Y2UoKGEsaSk9PmEreVtpXSwwKSx3PXdpbHNvbihrLHMubGVuZ3RoKTsKICBvdXQucHVzaCh7bG86cFtzWzBdXSxoaTpwW3Nbcy5sZW5ndGgtMV1dLG46cy5sZW5ndGgsbWVhbjpzLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLGFjdDprL3MubGVuZ3RoLHdsbzp3WzBdLHdoaTp3WzFdfSk7CiB9CiByZXR1cm4gb3V0Owp9CmZ1bmN0aW9uIHRocmVzaG9sZFJvdyhwLHksdCl7CiBsZXQgbj0wLGs9MDtmb3IobGV0IGk9MDtpPHAubGVuZ3RoO2krKylpZihwW2ldPj10KXtuKys7ays9eVtpXX0KIGNvbnN0IHc9d2lsc29uKGssbik7cmV0dXJue3QsbixrLHJhdGU6bj9rL246MCxsbzp3WzBdLGhpOndbMV19Owp9CgovKiAtLS0tLS0tLS0tIOeptOmmrOOCvuODvOODs++8iOS6uuawl+OBruS4i+S9je+8ieOBp+OBruaknOiovCAtLS0tLS0tLS0tCiAgIOeptOmmrO+8neS6uuawl+mghuS9jeOBjCBtYXgoNSwg6aCt5pWw44GuNDAl5YiH44KK5LiK44GSKSDku6XkuIvjga7ppqzjgILoqZXkvqEoUy9BL0IvQynjga/jgIHlrabnv5LlgbTjga7nqbTppqzjga7kuojmuKznorrnjofjga7kuIrkvY00Je+8jzEyJe+8jzMwJeOBp+WMuuWIh+OCiyAqLwphc3luYyBmdW5jdGlvbiBsb2FkUGF5TWFwKCl7CiBjb25zdCBtPW5ldyBNYXAoKTsKIHRyeXtmb3IoY29uc3QgZGF5IG9mIGF3YWl0IHBheUFsbCgpKWZvcihjb25zdCByIG9mIChkYXkucmFjZXN8fFtdKSlpZihyLnJhY2VJZCYmci5wbGFjZSltLnNldChyLnJhY2VJZCxyLnBsYWNlKX1jYXRjaChlKXt9CiByZXR1cm4gbTsKfQpmdW5jdGlvbiBob2xlRXZhbChtb2RlbCx4Zix0cmFpbix0ZXN0LHBheU1hcCx0ZXN0RGF5cyl7CiBjb25zdCBzb3J0ZWQ9W107CiBmb3IoY29uc3QgciBvZiB0cmFpbil7Y29uc3Qgdj1ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLHhmKGgpKSksMyk7ci5oLmZvckVhY2goKGgsaik9PntpZihoLmhvbGUpc29ydGVkLnB1c2godltqXSl9KX0KIHNvcnRlZC5zb3J0KChhLGIpPT5iLWEpOwogY29uc3QgcT1mPT5zb3J0ZWRbTWF0aC5taW4oc29ydGVkLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzb3J0ZWQubGVuZ3RoKmYpLTEpKV07CiBjb25zdCBjdXRzPXtTOnEoLjA0KSxBOnEoLjEyKSxCOnEoLjMwKX07CiBjb25zdCBncmFkZT1wPT5wPj1jdXRzLlM/IlMiOnA+PWN1dHMuQT8iQSI6cD49Y3V0cy5CPyJCIjoiQyI7CiBjb25zdCB0YWI9e1M6e246MCxrOjAscGI6MCxwYXk6MH0sQTp7bjowLGs6MCxwYjowLHBheTowfSxCOntuOjAsazowLHBiOjAscGF5OjB9LEM6e246MCxrOjAscGI6MCxwYXk6MH19OwogY29uc3Qgcms9e25ldzp7dDE6e246MCxrOjAscGI6MCxwYXk6MH0sdDI6e246MCxrOjAscGI6MCxwYXk6MH19LHBQOnt0MTp7bjowLGs6MCxwYjowLHBheTowfSx0Mjp7bjowLGs6MCxwYjowLHBheTowfX0sbWt0Ont0MTp7bjowLGs6MCxwYjowLHBheTowfSx0Mjp7bjowLGs6MCxwYjowLHBheTowfX19OwogbGV0IG5Ib2xlPTAsa0hvbGU9MDtjb25zdCBwSG9sZT1bXSx5SG9sZT1bXTsKIGNvbnN0IGJldD0oc3QscixoKT0+e3N0Lm4rKztzdC5rKz1oLnk7Y29uc3QgcGw9cGF5TWFwJiZwYXlNYXAuZ2V0KHIucmFjZUlkKTtpZihwbCl7c3QucGIrKztjb25zdCBoaXQ9cGwuZmluZCh4PT54Lm51bWJlcj09PWgubnVtKTtpZihoaXQpc3QucGF5Kz1oaXQueWVufX07CiBmb3IoY29uc3QgciBvZiB0ZXN0KXsKICBjb25zdCB2PW5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobW9kZWwseGYoaCkpKSwzKSxocz1bXTsKICByLmguZm9yRWFjaCgoaCxqKT0+e2lmKCFoLmhvbGUpcmV0dXJuO2hzLnB1c2goe2gscDp2W2pdfSk7YmV0KHRhYltncmFkZSh2W2pdKV0scixoKTtuSG9sZSsrO2tIb2xlKz1oLnk7cEhvbGUucHVzaCh2W2pdKTt5SG9sZS5wdXNoKGgueSl9KTsKICBjb25zdCBieT0oZik9PmhzLnNsaWNlKCkuc29ydChmKTsKICBjb25zdCBvcmRlcnM9e25ldzpieSgoYSxiKT0+Yi5wLWEucCkscFA6YnkoKGEsYik9PmIuaC5wUC1hLmgucFApLG1rdDpieSgoYSxiKT0+YS5oLnBvcC1iLmgucG9wKX07CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMob3JkZXJzKSl7b3JkZXJzW2tdLnNsaWNlKDAsMSkuZm9yRWFjaCh6PT5iZXQocmtba10udDEscix6LmgpKTtvcmRlcnNba10uc2xpY2UoMCwyKS5mb3JFYWNoKHo9PmJldChya1trXS50MixyLHouaCkpfQogfQogY29uc3QgZmluPXN0PT57Y29uc3Qgdz13aWxzb24oc3QuayxzdC5uKTtyZXR1cm57bjpzdC5uLGs6c3QuayxyYXRlOnN0Lm4/c3Quay9zdC5uOjAsbG86d1swXSxoaTp3WzFdLHBlckRheTp0ZXN0RGF5cz9zdC5uL3Rlc3REYXlzOjAscm9pOnN0LnBiP3N0LnBheS8oMTAwKnN0LnBiKTpudWxsLHBiOnN0LnBifX07CiBjb25zdCB0YWJGPXt9O2Zvcihjb25zdCBnIG9mIFsiUyIsIkEiLCJCIiwiQyJdKXRhYkZbZ109ZmluKHRhYltnXSk7CiBjb25zdCBya0Y9e307Zm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMocmspKXJrRltrXT17dDE6ZmluKHJrW2tdLnQxKSx0MjpmaW4ocmtba10udDIpfTsKIHJldHVybntjdXRzLHRhYjp0YWJGLHJhbms6cmtGLG5Ib2xlLGJhc2VSYXRlOm5Ib2xlP2tIb2xlL25Ib2xlOjAsYXVjOmF1Y09mKHBIb2xlLHlIb2xlKX07Cn0KY29uc3QgZ3JhZGVIb2xlPShjdXRzLHApPT5wPj1jdXRzLlM/IlMiOnA+PWN1dHMuQT8iQSI6cD49Y3V0cy5CPyJCIjoiQyI7CgovKiAtLS0tLS0tLS0tIOaknOiovOOBqOWGjeagoeato+OBruacrOS9kyAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHJ1blBsYWNlRml0KG9wdHMpewogb3B0cz1vcHRzfHx7fTsKIGNvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIyMDE5LTAxLTAxIixURVNUPW9wdHMudGVzdFN0YXJ0fHxNT0RFTF9UUkFJTl9FTkQ7CiBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpOwogY29uc3QgcGF5TWFwPW9wdHMucGF5TWFwfHxhd2FpdCBsb2FkUGF5TWFwKCk7CiBjb25zdCBtYXA9bmV3IE1hcCgpOwogYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiBpZihyYWNlcy5sZW5ndGg8NTAwKXtidXN5KGZhbHNlKTtyZXR1cm57ZXJyb3I6IumBjuWOu+ODh+ODvOOCv+OBjOWwkeOBquOBmeOBjuOBvuOBme+8iCIrcmFjZXMubGVuZ3RoKyLjg6zjg7zjgrnvvInjgILlhYjjgavpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgIIifX0KIHdmU3luYyhyYWNlcyk7CiBjb25zdCBzdG9yZT1uZXcgVUUuU3RvcmUoKSxwcmk9bmV3IFBvcFByaSgpLFJTPVtdLGRyYXdQPW5ldyBEcmF3UHJpKCksc2lyZVA9bmV3IFNpcmVQcmkoKSx0ck09bmV3IE1hcCgpOwogY29uc3QgY292PXtyYWNlczowLGdvaW5nUmFjZXM6MCxob3JzZXM6MCx0cmFpbmVyOjAsc2lyZTowfTsKIGZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgcmM9cmFjZXNbaV0sUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKSxOPVIubGVuZ3RoOwogIGNvbnN0IHZhbGlkPU4+PTgmJlIuZXZlcnkocj0+ci5wb3A+MCkmJlIuc29tZShyPT5yLmZpbmlzaD09PTEpOwogIGlmKHZhbGlkJiZyYy5kYXRlPj1TVEFSVCYmIS/pmpzlrrMvLnRlc3QoU3RyaW5nKFJbMF0ucmFjZU5hbWV8fCIiKSkpewogICBjb25zdCBvZD1SLmV2ZXJ5KHI9PnIub2Rkcz4xKT9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IHdjPXdmR2V0KHJjLnJvd3NbMF0ucmFjZUlkKTsgICAvLyDms6LkubHluqbjga7mpJzoqLzjgajlhbHmnIkKICAgIGlmKCF3Yy5uUCl3Yy5uUD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxudWxsKS5wUDsKICAgIGlmKG9kJiYhd2Mub1Apd2Mub1A9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpLnBPOwogICAgY29uc3QgYXA9e3BQOndjLm5QfSxhcE89b2Q/e3BPOndjLm9QfTpudWxsLHJrPXJhbmtGcmFjcyhhcC5wUCk7CiAgICBjb25zdCBjdXRIPU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKSxyY0k9e2djOlJbMF0uZ2N8fDAsdjp2ZW51ZUZyb21JZChyYy5yb3dzWzBdLnJhY2VJZCksc3VyZjpyYWNlLnN1cmYsZGlzdDpyYWNlLmRpc3QsTn0sY3R4PXtkcmF3OmRyYXdQLHRyOnRyTSxzaXJlOnNpcmVQLHBlZDpQRUR9LGJiPU1hdGgubWluKC41LDMvTik7CiAgICBjb3YucmFjZXMrKztpZihyY0kuZ2M+MCljb3YuZ29pbmdSYWNlcysrOwogICAgUlMucHVzaCh7ZGF0ZTpyYy5kYXRlLHJhY2VJZDpyYy5yb3dzWzBdLnJhY2VJZCxOLGg6Ui5tYXAoKHIsaik9Pntjb25zdCBlPWV4dEZlYXRIb3JzZShyLHN0b3JlLmguZ2V0KHIuaG9yc2UpLHJjSSxjdHgsYmIpO2Nvdi5ob3JzZXMrKztpZihlWzRdKWNvdi50cmFpbmVyKys7aWYoZVs2XXx8ZVs4XSljb3Yuc2lyZSsrO3JldHVybnt4OnBsYWNlWChhcC5wUFtqXSxyLnBvcCxOLHByaSxya1tqXSksZSx5OnIuZmluaXNoPD0zPzE6MCxwUDphcC5wUFtqXSxwcjpwcmkucmF0ZShyLnBvcCxOKSxwTzphcE8/YXBPLnBPW2pdOm51bGwsbnVtOnIubnVtLHBvcDpyLnBvcCxob2xlOnIucG9wPj1jdXRIfX0pfSk7CiAgIH1jYXRjaChlKXt9CiAgfQogIGlmKHZhbGlkKXByaS5hZGQoUi5tYXAocj0+W3IucG9wLHIuZmluaXNoXSksTik7CiAgaWYoTj49OCl7Y29uc3QgdnY9dmVudWVGcm9tSWQocmMucm93c1swXS5yYWNlSWQpO2Zvcihjb25zdCByIG9mIFIpe2NvbnN0IHQzPXIuZmluaXNoPD0zPzE6MDtkcmF3UC5hZGQodnYsUlswXS5zdXJmLFJbMF0uZGlzdCxyLm51bSxOLHQzKTtzaXJlUC5hZGQoUEVEW3IuaG9yc2VdLFJbMF0uc3VyZixSWzBdLmRpc3QsdDMsTik7aWYoci50cmFpbmVyKXtsZXQgdD10ck0uZ2V0KHIudHJhaW5lcik7aWYoIXQpdHJNLnNldChyLnRyYWluZXIsdD17bjowLHQzOjB9KTt0Lm4rKzt0LnQzKz10M319fQogIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpe3IuY2Y9Y29ybmVyRnJhYyhyLmNvcm5lcixyYy5yb3dzLmxlbmd0aCk7c3RvcmUuYWRkKHIpfQogIHJjLnJvd3M9bnVsbDsgICAvLyDkvb/jgYTntYLjgYjjgZ/ooYzjgpLop6PmlL7vvIjjg6Hjg6Ljg6rnr4DntITvvIkKICBpZihpJTMwPT09Mjkpe2J1c3kodHJ1ZSxg5pmC57O75YiX44Gr5YaN54++44GX44Gm5qSc6Ki85Lit4oCmICR7aSsxfS8ke3JhY2VzLmxlbmd0aH3jg6zjg7zjgrlgKTthd2FpdCBzbGVlcCgwKX0KIH0KIGJ1c3kodHJ1ZSwi44Oi44OH44Or44KS5q+U6LyD5Lit4oCmIik7YXdhaXQgc2xlZXAoMCk7CiBjb25zdCB0cmFpbj1SUy5maWx0ZXIocj0+ci5kYXRlPFRFU1QpLHRlc3Q9UlMuZmlsdGVyKHI9PnIuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsc3RhcnQ6U1RBUlQsdGVzdFN0YXJ0OlRFU1R9OwogaWYodHJhaW4ubGVuZ3RoPDE1MDB8fHRlc3QubGVuZ3RoPDMwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIC8vIOaWsOODouODh+ODq++8muWtpue/kuWBtOOBruOBv+OBp+S9nOOCi+OAguOAjOi/veWKoOOBruadoeS7tu+8iOmmrOWgtOODu+aeoOmghuODu+iqv+aVmeW4q+ODu+ihgOe1se+8ieOBguOCiuOAjeOBqOOAjOOBquOBl+OAjeOBrjLpgJrjgorjgpLmr5TjgbnjgosKIGNvbnN0IHk9W10sWGI9W10sWGU9W107Zm9yKGNvbnN0IHIgb2YgdHJhaW4pZm9yKGNvbnN0IGggb2Ygci5oKXt5LnB1c2goaC55KTtYYi5wdXNoKGgueCk7WGUucHVzaChbLi4uaC54LC4uLmguZV0pfQogY29uc3QgbW9kZWxCPWZpdExvZ2l0KFhiLHksNSksbW9kZWxFPWZpdExvZ2l0KFhlLHksNSk7CiBjb25zdCBmbGF0PWY9Pntjb25zdCBwPVtdLHl5PVtdO2Zvcihjb25zdCByIG9mIHRlc3Qpe2NvbnN0IHY9ZihyKTtyLmguZm9yRWFjaCgoaCxqKT0+e3AucHVzaCh2W2pdKTt5eS5wdXNoKGgueSl9KX1yZXR1cm57cCx5Onl5fX07CiBjb25zdCB4Qj1oPT5oLngseEU9aD0+Wy4uLmgueCwuLi5oLmVdOwogY29uc3QgZXZhbE09KG0seGYpPT57Y29uc3QgZD1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobSx4ZihoKSkpLDMpKTtyZXR1cm57ZCxtZXQ6bWV0cmljc09mKGQucCxkLnkpfX07CiBjb25zdCBFQj1ldmFsTShtb2RlbEIseEIpLEVFPWV2YWxNKG1vZGVsRSx4RSk7CiBjb25zdCB1c2VFeHQ9RUUubWV0LmxsPD1FQi5tZXQubGwtLjAwMTsgICAvLyDov73liqDjga7mnaHku7bjgafjgIHlr77mlbDmkI3lpLHjgYwwLjAwMeS7peS4iuiJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeS9v+OBhgogbGV0IG1vZGVsPXVzZUV4dD9tb2RlbEU6bW9kZWxCLHhmPXVzZUV4dD94RTp4QixkTmV3PXVzZUV4dD9FRS5kOkVCLmQ7CiAvLyDli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDvvIjmnKjjga7nqY3jgb/ph43jga3vvInvvJrlrabnv5LlgbTjgpLmmYLns7vliJfjgafjgIE4NSXvvIjmnKjjgpLkvZzjgovvvInvvI8xNSXvvIjml6nmnJ/ntYLkuobjgajovIPmraPvvInjgavliIbjgZHjgosKIGxldCB1c2VHYm09ZmFsc2U7CiB0cnl7CiAgY29uc3QgYzg1PU1hdGguZmxvb3IodHJhaW4ubGVuZ3RoKi44NSksZml0Uj10cmFpbi5zbGljZSgwLGM4NSksY2FsUj10cmFpbi5zbGljZShjODUpLHN0cmlkZT1NYXRoLm1heCgxLE1hdGguY2VpbChmaXRSLmxlbmd0aCoxNC8xNTAwMDApKTsKICBjb25zdCBYZz1bXSx5Zz1bXTtmaXRSLmZvckVhY2goKHIscmkpPT57aWYocmklc3RyaWRlKXJldHVybjtmb3IoY29uc3QgaCBvZiByLmgpe1hnLnB1c2goeEUoaCkpO3lnLnB1c2goaC55KX19KTsKICBjb25zdCBYYz1bXSx5Yz1bXTtmb3IoY29uc3QgciBvZiBjYWxSKWZvcihjb25zdCBoIG9mIHIuaCl7WGMucHVzaCh4RShoKSk7eWMucHVzaChoLnkpfQogIGJ1c3kodHJ1ZSwi5Yu+6YWN44OW44O844K544OG44Kj44Oz44Kw44KS5a2m57+S5Lit4oCmIik7CiAgY29uc3QgZ209YXdhaXQgZ2JtRml0KFhnLHlnLHtyb3VuZHM6OTAsZGVwdGg6NCxscjouMDksdmFsWDpYYyx2YWxZOnljLHByb2dyZXNzOmFzeW5jKGEsYjIpPT57YnVzeSh0cnVlLGDli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDjgpLlrabnv5LkuK3igKYgJHthfS8ke2IyfWApO2F3YWl0IHNsZWVwKDApfX0pOwogIGdibUNhbGlicmF0ZShnbSxYYyx5Yyk7CiAgY29uc3QgRUc9ZXZhbE0oZ20seEUpO3Jlcy5tR2JtPUVHLm1ldDtyZXMubkdibVRyZWVzPWdtLnRyZWVzLmxlbmd0aDsKICBpZihFRy5tZXQubGw8PU1hdGgubWluKEVCLm1ldC5sbCxFRS5tZXQubGwpLS4wMDEpe3VzZUdibT10cnVlO21vZGVsPWdtO3hmPXhFO2ROZXc9RUcuZH0KIH1jYXRjaChlKXtyZXMuZ2JtRXJyb3I9U3RyaW5nKGUmJmUubWVzc2FnZXx8ZSl9CiByZXMudXNlR2JtPXVzZUdibTsKIHJlcy5tQmFzZT1FQi5tZXQ7cmVzLm1FeHQ9RUUubWV0O3Jlcy51c2VFeHQ9dXNlRXh0O3Jlcy5jb3Y9ey4uLmNvdixnb2luZ1NoYXJlOmNvdi5yYWNlcz9jb3YuZ29pbmdSYWNlcy9jb3YucmFjZXM6MCx0cmFpbmVyU2hhcmU6Y292LmhvcnNlcz9jb3YudHJhaW5lci9jb3YuaG9yc2VzOjAsc2lyZVNoYXJlOmNvdi5ob3JzZXM/Y292LnNpcmUvY292LmhvcnNlczowLHBlZEhvcnNlczpPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH07CiBjb25zdCBkUFA9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucFApKSwzKSk7CiBjb25zdCBkTWs9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucHIpKSwzKSk7CiByZXMubU5ldz1tZXRyaWNzT2YoZE5ldy5wLGROZXcueSk7cmVzLm1QUD1tZXRyaWNzT2YoZFBQLnAsZFBQLnkpO3Jlcy5tTWs9bWV0cmljc09mKGRNay5wLGRNay55KTsKIC8vIOePvuihjOOBruOCquODg+OCuui+vOOBv+eiuueOhyhwTynjga/jgIHjgqrjg4PjgrrjgaTjgY3jga7miJDnuL7jgYzjgYLjgovmnJ/plpPjgaDjgZHmr5TjgbnjgonjgozjgosKIGNvbnN0IHN1Yj10ZXN0LmZpbHRlcihyPT5yLmguZXZlcnkoaD0+aC5wTyE9bnVsbCkpOwogcmVzLm5PZGRzVGVzdD1zdWIubGVuZ3RoOwogaWYoc3ViLmxlbmd0aD49MTUwKXsKICBjb25zdCBwbj1bXSxwbz1bXSx5eT1bXTtmb3IoY29uc3QgciBvZiBzdWIpe2NvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57cG4ucHVzaCh2W2pdKTtwby5wdXNoKGgucE8pO3l5LnB1c2goaC55KX0pfQogIHJlcy5tTmV3T2Rkcz1tZXRyaWNzT2YocG4seXkpO3Jlcy5tT2Rkcz1tZXRyaWNzT2YocG8seXkpOwogfQogLy8g5o6h55So44Gu5Yik5patCiBjb25zdCBtPXJlcy5tTmV3OwogbGV0IGFkb3B0PW0ubGw8cmVzLm1QUC5sbC0uMDAzJiZtLmxsPHJlcy5tTWsubGwtLjAwMzsKIGlmKGFkb3B0JiZyZXMubU9kZHMpYWRvcHQ9cmVzLm1OZXdPZGRzLmxsPD1yZXMubU9kZHMubGwtLjAwMDU7CiByZXMuYWRvcHQ9YWRvcHQ7cmVzLnZzT2Rkcz1yZXMubU9kZHM/IuavlOi8g+a4iOOBvyI6IuacquavlOi8gyI7CiAvLyDkv6HpoLzmgKfvvJrkuojmuKzjga7ljLrplpPjgZTjgajjga7lrp/pmpvjga7nmoTkuK3njocKIHJlcy5iaW5zPXJlbGlhYmlsaXR5QmlucyhkTmV3LnAsZE5ldy55LDEwKTsKIHJlcy50ZXN0RGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiByZXMuaG9sZT1ob2xlRXZhbChtb2RlbCx4Zix0cmFpbix0ZXN0LHBheU1hcCxyZXMudGVzdERheXMpOwogcmVzLnRocj1bLjUsLjcsLjgsLjg1LC44OCwuOSwuOTIsLjkzLC45NSwuOTddLm1hcCh0PT50aHJlc2hvbGRSb3coZE5ldy5wLGROZXcueSx0KSk7CiByZXMuYmluc1BQPXJlbGlhYmlsaXR5QmlucyhkUFAucCxkUFAueSwxMCk7CiAvLyDotoXpiYTmnb/vvJ3kuojmuKw5NSXku6XkuIrjga7ppqzvvIjkvZXpoK3jgafjgoLvvInjgILmpJzoqLzlgbTjgafjgIHlrp/pmpvjgavjganjgozjgaDjgZHlvZPjgZ/jgaPjgZ/jgYvjgpLoqJjpjLLjgZnjgosKIGxldCBpcm9uPW51bGw7CiB7Y29uc3Qgcm93PXRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LC45NSksZGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiAgaWYocm93Lm4+MClpcm9uPXtjdXQ6Ljk1LHJhdGU6cm93LnJhdGUsbG86cm93LmxvLG46cm93Lm4scGVyRGF5OmRheXM/cm93Lm4vZGF5czowLGxvd046cm93Lm48MTAwfTt9CiByZXMuaXJvbj1pcm9uOwogcmVzLm1vZGVsPWFkb3B0P3t2ZXI6MixraW5kOiJuZXciLGV4dDoodXNlRXh0fHx1c2VHYm0pLGdibTp1c2VHYm0sbW9kZWwsaXJvbixhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0RGF5czpyZXMudGVzdERheXMsdGVzdFN0YXJ0OlRFU1QsaG9sZUN1dHM6cmVzLmhvbGUuY3V0cyxob2xlU3RhdHM6e3RhYjpyZXMuaG9sZS50YWIscmFuazpyZXMuaG9sZS5yYW5rLGJhc2VSYXRlOnJlcy5ob2xlLmJhc2VSYXRlfSwKICBtTmV3OnJlcy5tTmV3LG1QUDpyZXMubVBQLG1NazpyZXMubU1rLG1PZGRzOnJlcy5tT2Rkc3x8bnVsbCxtTmV3T2RkczpyZXMubU5ld09kZHN8fG51bGwsdGhyOnJlcy50aHJ9Om51bGw7CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiBwbGFjZVJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CCMemgreOBlOOBqOOBq+OAjDPnnYDku6XlhoXjgI3jgpLlvZPjgabjgZ/miJDnuL7jgafjgZnvvIg46aCt5Lul5LiK44Gu44Os44O844K577yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PgogJHtyb3coIumBjuWOu+aIkOe4vuODouODh+ODq+OBruOBvyIsci5tUFApfSR7cm93KCLkurrmsJfpoIbkvY3jga7lrp/nuL7jga7jgb8iLHIubU1rKX0ke3JvdygiPGI+5paw77yI5Lih5pa544KS57WE44G/5ZCI44KP44Gb77yJPC9iPiIsci5tTmV3KX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGlmKHIubU9kZHMpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgaTjgY3jga7mpJzoqLzjg4fjg7zjgr8gJHtyLm5PZGRzVGVzdH3jg6zjg7zjgrnjgafjga7nm7TmjqXmr5TovIPvvJrnj77ooYzvvIjjgqrjg4Pjgrrovrzjgb/vvInjga7lr77mlbDmkI3lpLEgJHtmKHIubU9kZHMubGwpfSDvvI8g5pawICR7ZihyLm1OZXdPZGRzLmxsKX08L2Rpdj5gOwogZWxzZSBoKz1gPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44Kq44OD44K644Gk44GN44Gu5qSc6Ki844OH44O844K/44GM5bCR44Gq44GE44Gf44KB44CB54++6KGM44Gu44CM44Kq44OD44K66L6844G/44Gu56K6546H44CN44Go44Gu55u05o6l5q+U6LyD44Gv44Gn44GN44Gm44GE44G+44Gb44KT77yI5Lq65rCX6aCG5L2N44Gv44CB44Kq44OD44K65Y+W5b6X5b6M44Gr5rG644G+44KL5YCk44KS5L2/44Gj44Gm44GE44G+44GZ77yJ44CCPC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmFkb3B0PyJvayI6InduIn0iPjxiPue1kOaenO+8miR7ci5hZG9wdD8i5paw44Oi44OH44Or44KS5o6h55So77yI6YCx5pyr44Gu5LqI5oOz44Gu56K6546H44Gr5Y+N5pig77yJIjoi54++6KGM44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/44O75Lq65rCX6aCG5L2N44Gu44G/44Gu5Lih5pa544KI44KK44CB5a++5pWw5pCN5aSx44GMMC4wMDPku6XkuIroia/jgYTjgZPjgajjgIIke3IubU9kZHM/IuOBleOCieOBq+ePvuihjO+8iOOCquODg+OCuui+vOOBv++8ieOCiOOCiuiJr+OBhOOBk+OBqOOAgiI6IiJ9PC9zcGFuPjwvZGl2PmA7CiBoKz1leHRSZXBvcnQocik7CiBoKz1ob2xlUmVwb3J0KHIpOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7kuojmuKzjga7ljLrplpPjgZTjgajjga48Yj7lrp/pmpvjga7nmoTkuK3njoc8L2I+77yI5qSc6Ki85YG044CC5LqI5ris44Go5a6f6Zqb44GM6L+R44GE44G744Gp5q2j56K677yJPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuS6iOa4rOOBruevhOWbsjwvdGg+PHRoPumgreaVsDwvdGg+PHRoPuS6iOa4rOOBruW5s+WdhzwvdGg+PHRoPuWun+mamzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGIgb2Ygci5iaW5zKWgrPWA8dHI+PHRkPiR7cGN0KGIubG8pfeOAnCR7cGN0KGIuaGkpfTwvdGQ+PHRkPiR7Yi5ufTwvdGQ+PHRkPiR7cGN0KGIubWVhbiwxKX08L3RkPjx0ZD48Yj4ke3BjdChiLmFjdCwxKX08L2I+PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7pq5jjgYTkuojmuKzjga7lrp/nuL7vvIjmpJzoqLzlgbTvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5risPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHQgb2Ygci50aHIpaCs9YDx0cj48dGQ+JHtwY3QodC50KX3ku6XkuIo8L3RkPjx0ZD4ke3Qubn08L3RkPjx0ZD4ke3IudGVzdERheXM/KHQubi9yLnRlc3REYXlzKS50b0ZpeGVkKDIpOiItIn3poK08L3RkPjx0ZD48Yj4ke3BjdCh0LnJhdGUsMSl9PC9iPjwvdGQ+PHRkPiR7cGN0KHQubG8sMSl944CcJHtwY3QodC5oaSwxKX08L3RkPjwvdHI+YDsKIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGlmKHIuaXJvbiloKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxiPui2hemJhOadv++8iOS6iOa4rDk1JeS7peS4iuODu+mgreaVsOOBruWItumZkOOBquOBl++8ie+8mjwvYj7mpJzoqLzlgbTjgafjgIHlrp/pmpvjgaske3BjdChyLmlyb24ucmF0ZSwxKX3jgYwz552A5Lul5YaF77yIJHtyLmlyb24ubn3poK3jgIE5NSXjga7luYUgJHtwY3Qoci5pcm9uLmxvLDEpfeOAnCR7cGN0KHIuaXJvbi5oaSwxKX3jgIEx5pel44GC44Gf44KK57SEJHtyLmlyb24ucGVyRGF5LnRvRml4ZWQoMil96aCtJHtyLmlyb24ubG93Tj8i44CC6aCt5pWw44GM5bCR44Gq44KB44Gn5bmF44GM5bqD44GEIjoiIn3vvInjgIIke3IuaXJvbi5yYXRlPj0uOTU/IiI6IjxzcGFuIGNsYXNzPVwid2FyblwiPjk1JeOBq+OBr+WxiuOBhOOBpuOBhOOBvuOBm+OCk+OAgjwvc3Bhbj4ifTwvZGl2PmA7CiBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7mpJzoqLzlgbTjgavjgIHkuojmuKw5NSXku6XkuIrjga7ppqzjga/jgYTjgb7jgZvjgpPjgafjgZfjgZ/vvIjotoXpiYTmnb/jga/lh7rjgarjgYTjgIHjgb7jgZ/jga/lh7rjgabjgoLjgZTjgY/lsJHmlbDjgafjgZnvvInjgII8L2Rpdj4nOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gZXh0UmVwb3J0KHIpewogaWYoIXIubUV4dClyZXR1cm4iIjsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLGN2PXIuY292fHx7fTsKIGxldCBoPWA8aDM+6L+95Yqg44Gu5p2h5Lu277yI6aas5aC054q25oWL44O75p6g6aCG44O76Kq/5pWZ5bir44O76KGA57Wx77yJ44Gu5Yq55p6cPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+QVVD4oaRPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pjx0cj48dGQ+6L+95Yqg44Gu5p2h5Lu244Gq44GXPC90ZD48dGQ+JHtmKHIubUJhc2UubGwpfTwvdGQ+PHRkPiR7ci5tQmFzZS5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+PHRyPjx0ZD7ov73liqDjga7mnaHku7bjgYLjgoo8L3RkPjx0ZD4ke2Yoci5tRXh0LmxsKX08L3RkPjx0ZD4ke3IubUV4dC5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+JHtyLm1HYm0/YDx0cj48dGQ+6L+95Yqg44Gu5p2h5Lu244GC44KK77yL5pyo44Gu56mN44G/6YeN44GtPC90ZD48dGQ+JHtmKHIubUdibS5sbCl9PC90ZD48dGQ+JHtyLm1HYm0uYXVjLnRvRml4ZWQoMyl9PC90ZD48L3RyPmA6IiJ9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1yLm1HYm0/YDxkaXYgY2xhc3M9InNtYWxsIj7mnKjjga7nqY3jgb/ph43jga3vvIjli77phY3jg5bjg7zjgrnjg4bjgqPjg7PjgrDvvInvvJoke3IudXNlR2JtPyI8Yj7ntYTjgb/lkIjjgo/jgZvjga7lirnmnpzjgpLmi77jgYjjgabjgIHmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHmjqHnlKjjgZfjgb7jgZfjgZ/jgII8L2I+Ijoi5piO56K644Gq5pS55ZaE44GM44Gq44GL44Gj44Gf44Gf44KB44CB5o6h55So44GX44Gm44GE44G+44Gb44KT44CCIn3vvIjmnKggJHtyLm5HYm1UcmVlc33mnKzvvIk8L2Rpdj5gOiIiOwogaCs9YDxkaXYgY2xhc3M9ImJhbm5lciAke3IudXNlRXh0PyJvayI6InduIn0iPjxiPiR7ci51c2VFeHQ/Iui/veWKoOOBruadoeS7tuOCkuS9v+OBhuOBqOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBvuOBl+OBn+OAgiI6Iui/veWKoOOBruadoeS7tuOCkuWKoOOBiOOBpuOCguOAgeaYjueiuuOBquaUueWWhO+8iOWvvuaVsOaQjeWksTAuMDAx5Lul5LiK77yJ44Gv44Gq44GL44Gj44Gf44Gf44KB44CB5L2/44Gj44Gm44GE44G+44Gb44KT44CCIn08L2I+PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44OH44O844K/44Gu5YWF6Laz546H77yI5a2m57+S44O75qSc6Ki85YWo5L2T77yJ77ya6aas5aC054q25oWL44GM5YiG44GL44KL44Os44O844K5ICR7cGN0KGN2LmdvaW5nU2hhcmV8fDAsMCl977yP6Kq/5pWZ5bir44GM5YiG44GL44KL6aasICR7cGN0KGN2LnRyYWluZXJTaGFyZXx8MCwwKX3vvI/ooYDntbHjgYzliIbjgYvjgovppqwgJHtwY3QoY3Yuc2lyZVNoYXJlfHwwLDApfe+8iOiThOepjeOBl+OBn+ihgOe1sSAke2N2LnBlZEhvcnNlc3x8MH3poK3vvInvvI/lkIzjgZjjg6zjg7zjgrnjgYxDU1bjgajlj5blvpfjg4fjg7zjgr/jga7kuKHmlrnjgavjgYLjgaPjgZ8gJHtGRV9EVVBTfeODrOODvOOCueOBr+OAgemHjeikh+OCkumZpOWkluOBl+OBvuOBl+OBn+OAgiR7KGN2LmdvaW5nU2hhcmV8fDApPC4zPyLppqzloLTnirbmhYvjga/jgIHoqK3lrprjga7jgIzjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfjgI3jgafjgIHpgY7ljrvjga7miJDnuL7jgpLlj5bjgornm7TjgZnjgajlopfjgYjjgb7jgZnjgIIiOiIifSR7KGN2LnNpcmVTaGFyZXx8MCk8LjM/IiDooYDntbHjga/jgIHmr47pgLHjga7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgI3jgaflh7rppqzooajjgYvjgonlsJHjgZfjgZrjgaTok4TnqY3jgZXjgozjgb7jgZnjgIIiOiIifTwvZGl2PmA7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBob2xlUmVwb3J0KHIpewogY29uc3QgSD1yLmhvbGU7aWYoIUh8fCFILm5Ib2xlKXJldHVybiIiOwogY29uc3Qgcm9pPXg9Pngucm9pPT1udWxsPyItIjpwY3QoeC5yb2ksMCk7CiBsZXQgaD1gPGgzPueptOmmrO+8iOS6uuawl+OBruS4i+S9je+8ieOBp+OBruaIkOe4vu+8iOaknOiovOWBtO+8iTwvaDM+PGRpdiBjbGFzcz0ic21hbGwiPueptOmmrO+8neS6uuawl+mghuS9jeOBjCBtYXgoNSwg6aCt5pWw44GuNDAlKeS7peS4i+OBrummrOOAguaknOiovOWBtOOBrueptOmmrCAke0gubkhvbGV96aCt44Gu5bmz5Z2H55qE5Lit546H44GvICR7cGN0KEguYmFzZVJhdGUsMSl944CB5paw44Oi44OH44Or44Gu5LqI5ris44Gu6K2Y5Yil5Yqb77yIQVVD77yJ44GvICR7SC5hdWMudG9GaXhlZCgzKX3jgILoqZXkvqHjga/jgIHlrabnv5LlgbTjga7nqbTppqzjga7kuojmuKznorrnjofjga7kuIrkvY00Je+8nVPjgIExMiXvvJ1B44CBMzAl77ydQuOAgeOBneOCjOS7peWklu+8nUMg44Gn5Yy65YiH44KK44G+44GX44Gf77yIU++8muS6iOa4rCR7cGN0KEguY3V0cy5TLDEpfeS7peS4iuOAgUHvvJoke3BjdChILmN1dHMuQSwxKX3ku6XkuIrjgIFC77yaJHtwY3QoSC5jdXRzLkIsMSl95Lul5LiK77yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6KmV5L6hPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PHRoPuikh+WLneWbnuWPjueOhzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGcgb2YgWyJTIiwiQSIsIkIiLCJDIl0pe2NvbnN0IHg9SC50YWJbZ107aCs9YDx0cj48dGQ+PGI+JHtnfTwvYj48L3RkPjx0ZD4ke3gubn08L3RkPjx0ZD4ke3gucGVyRGF5LnRvRml4ZWQoMSl96aCtPC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvLDEpfeOAnCR7cGN0KHguaGksMSl9PC90ZD48dGQ+JHtyb2koeCl9PC90ZD48L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7jg6zjg7zjgrnjgZTjgajjgavjgIHnqbTppqzjga7kuK3jgYvjgonkuIrkvY3jgpLpgbjjgpPjgaDjgajjgY3jga7miJDnuL7vvIjnmoTkuK3njofvvI/opIfli53lm57lj47njofvvInjgILjgIzmlrDjg6Ljg4fjg6vjgI3jgYzjgIHku5bjga7pgbjjgbPmlrnjgojjgorpq5jjgYTjgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7pgbjjgbPmlrk8L3RoPjx0aD4x6aCt44Gg44GRPC90aD48dGg+5LiK5L2NMumgrTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtrLGxdIG9mIFtbIm5ldyIsIuaWsOODouODh+ODq+OBrueiuueOh+OBjOmrmOOBhOmghiJdLFsicFAiLCLpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7jgb8iXSxbIm1rdCIsIuS6uuawl+OBjOmrmOOBhOmghu+8iOW4guWgtO+8iSJdXSl7Y29uc3QgYT1ILnJhbmtba10udDEsYj1ILnJhbmtba10udDI7aCs9YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7cGN0KGEucmF0ZSwxKX0g77yPICR7cm9pKGEpfTwvdGQ+PHRkPiR7cGN0KGIucmF0ZSwxKX0g77yPICR7cm9pKGIpfTwvdGQ+PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48L2Rpdj4ke0gudGFiLlMucGI9PT0wPyc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHlm57lj47njofjga/lh7rjgZvjgabjgYTjgb7jgZvjgpPvvIjjgIzpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgI3jgafmiZXmiLvjgoLlj5blvpfjgZXjgozjgb7jgZnvvInjgII8L2Rpdj4nOic8ZGl2IGNsYXNzPSJzbWFsbCI+5Zue5Y+O546H44Gv44CBMTAw5YaG44Ga44Gk6KSH5Yud44KS6LK344Gj44Gf5aC05ZCI44Gn44GZ44CCMTAwJeOCkui2heOBiOOCi+iyt+OBhOaWueOBr+OAgeOBvuOBoOeiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvZGl2Pid9YDsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBsYWNlU3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRQbGFjZU1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8muaomea6luODouODh+ODq+OBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8mjxiPuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqzwvYj7jgafooajnpLrkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgabjgYLjgorjgb7jgZnvvInjgII8L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Oi44OH44Or44Gu54q25oWL44Gu6KaL44GI44KL5YyW44Go44CB5pON5L2c44Gu44G+44Go44KBCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KbGV0IERBVEFfTEFTVD0iIjsKYXN5bmMgZnVuY3Rpb24gcmVmcmVzaERhdGFMYXN0KCl7dHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2xldCBtPSIiO2Zvcihjb25zdCBmIG9mIGZzKWlmKGYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCYmZi5kYXRlPm0pbT1mLmRhdGU7REFUQV9MQVNUPW19Y2F0Y2goZSl7fX0KY29uc3QgZGF5c0JldHdlZW49KGEsYik9Pk1hdGgucm91bmQoKG5ldyBEYXRlKGIrIlQwMDowMDowMFoiKS1uZXcgRGF0ZShhKyJUMDA6MDA6MDBaIikpLzg2NGU1KTsKY29uc3QgS0lORF9OQU1FPXtvbGQ6Iuaomea6luODouODh+ODq+OBruOBvuOBviIsbmV3OiLlho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6siLGJsZW5kOiLmqJnmupbjgajmlrDjg6Ljg4fjg6vjga7lubPlnYcifTsKLyog5LuK5L2/44Gj44Gm44GE44KL44Oi44OH44Or44Go44CB5YaN5qSc6Ki844Gu55uu5a6J77yI5qSc6Ki844GL44KJMzXml6Xku6XkuIrjgIHjgb7jgZ/jga/mpJzoqLzlvozjgavmiJDnuL7jgYwxNOaXpeWIhuS7peS4iuWil+OBiOOBn+OCieaPkOahiO+8iSAqLwpmdW5jdGlvbiBtb2RlbFN0YXR1c0h0bWwoKXsKIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCksUE09Z2V0UGxhY2VNb2RlbCgpLFVNPWdldFVwc2V0TW9kZWwoKSxHPWdldEdhdGUoKTsKIGNvbnN0IHJvdz0obmFtZSxzdGF0ZSxkZXRhaWwsYWR2aWNlKT0+YDx0cj48dGQ+PGI+JHtuYW1lfTwvYj48L3RkPjx0ZD4ke3N0YXRlfTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtkZXRhaWx9JHthZHZpY2U/YDxicj48c3BhbiBjbGFzcz0id2FybiI+JHthZHZpY2V9PC9zcGFuPmA6IiJ9PC90ZD48L3RyPmA7CiBjb25zdCBzdGFsZT0oYXQpPT57aWYoIWF0KXJldHVybiIiO2NvbnN0IGQ9ZGF5c0JldHdlZW4oYXQsdG9kYXkpLGdhcD1EQVRBX0xBU1Q/ZGF5c0JldHdlZW4oYXQsREFUQV9MQVNUKTowO3JldHVybihkPj0zNXx8Z2FwPj0xNCk/YOaknOiovOOBi+OCiSR7ZH3ml6XvvIjjgZ3jga7lvozjga7miJDnuL4g57SEJHtNYXRoLm1heCgwLGdhcCl95pel5YiG77yJ44CC5YaN5qSc6Ki844KS44GK44GZ44GZ44KB44GX44G+44GZ44CCYDoiIn07CiBjb25zdCByb3dzPVtdOwogcm93cy5wdXNoKHJvdygi5aW96LWw546HIixQTT9g5YaN5qCh5q2j5riI44G/JHtQTS5leHQ/Iu+8iOi/veWKoOOBruadoeS7tuOBguOCiu+8iSI6IiJ9YDoi5qiZ5rqWIixQTT9g5qSc6Ki85pelICR7ZXNjKFBNLmF0KX3vvI/mpJzoqLwgJHtQTS5uVGVzdH3jg6zjg7zjgrnvvI/lr77mlbDmkI3lpLEgJHtQTS5tUFA/UE0ubVBQLmxsLnRvRml4ZWQoNCk6Ii0ife+8iOmBjuWOu+aIkOe4vuOBruOBv++8ieKGkiAke1BNLm1OZXc/UE0ubU5ldy5sbC50b0ZpeGVkKDQpOiItIn3vvIjmlrDvvIlgOiLjgIzmpJzoqLzjgI3jgr/jg5bjga7jgIzlpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraPjgI3jgafjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgonjgozjgb7jgZnjgIIiLFBNP3N0YWxlKFBNLmF0KToiIikpOwogcm93cy5wdXNoKHJvdygi5rOi5Lmx5bqmIixVTT9gJHtLSU5EX05BTUVbVU0ua2luZF18fFVNLmtpbmR9JHtVTS5zaW0/Iu+8iOW4guWgtOi+vOOBv++8iSI6IiJ9JHtVTS5wYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIifWA6Iuaomea6liIsVU0/YOaknOiovOaXpSAke2VzYyhVTS5hdCl977yP5qSc6Ki8ICR7VU0ublRlc3R944Os44O844K577yP5a++5pWw5pCN5aSxICR7VU0ubTA/VU0ubTAubGwudG9GaXhlZCg0KToiLSJ977yI5qiZ5rqW77yJ4oaSICR7VU0ua2luZD09PSJvbGQiPyhVTS5tMD9VTS5tMC5sbC50b0ZpeGVkKDQpOiItIik6KFVNLm1OP1VNLm1OLmxsLnRvRml4ZWQoNCk6Ii0iKX1gOiLjgIzmpJzoqLzjgI3jgr/jg5bjga7jgIzms6LkubHluqbjgpLmpJzoqLzjg7vlho3moKHmraPjgI3jgafjgIHlrp/pmpvjga7ms6LkubHnjofjgavlkIjjgo/jgZvjgonjgozjgb7jgZnjgIIiLFVNP3N0YWxlKFVNLmF0KToiIikpOwogY29uc3Qgb2s9RyYmRy5pdGVtcy5maWx0ZXIoeD0+eC5sb3c+PTEmJnguYmV0cz49MzAwKTsKIHJvd3MucHVzaChyb3coIuWbnuWPjueOhyIsRz8ob2smJm9rLmxlbmd0aD8iMTAwJei2heOBruiyt+OBhOaWueOBguOCiiI6IjEwMCXotoXjga/mnKrnorroqo0iKToi5pyq5qSc6Ki8IixHP2DmnIDntYLmpJzoqLwgJHtlc2MoRy5hdCl9JHtvayYmb2subGVuZ3RoPyLvvJoiK29rLm1hcCh4PT5lc2MoeC5sYWJlbCkpLmpvaW4oIuOAgSIpOiIifWA6IuOAjOaknOiovOOCkuWun+ihjOOAjeOBp+OAgeiyt+OBhOaWueOBlOOBqOOBruikh+WLneWbnuWPjueOh+OCkueiuuiqjeOBp+OBjeOBvuOBmeOAgiIsRz9zdGFsZShHLmF0KToiIikpOwogY29uc3QgZ2FwPURBVEFfTEFTVD9kYXlzQmV0d2VlbihEQVRBX0xBU1QsdG9kYXkpOm51bGw7CiByb3dzLnB1c2gocm93KCLjg4fjg7zjgr8iLERBVEFfTEFTVD9g5oiQ57i+44Gu5pyA57WC5pelICR7ZXNjKERBVEFfTEFTVCl9YDoi5pyq5Y+W5b6XIixg6JOE56mN44GX44Gf6KGA57WxICR7T2JqZWN0LmtleXMoUEVEKS5sZW5ndGh96aCtYCxnYXAhPW51bGwmJmdhcD4xMD9g5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgmA6IiIpKTsKIHJldHVybmA8dGFibGU+PHRoZWFkPjx0cj48dGg+6aCF55uuPC90aD48dGg+54q25oWLPC90aD48dGg+6Kmz57SwPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93cy5qb2luKCIiKX08L3Rib2R5PjwvdGFibGU+YDsKfQpmdW5jdGlvbiByZW5kZXJNb2RlbFN0YXR1cygpe2NvbnN0IGVsPSQoIm1zdGF0Iik7aWYoZWwpZWwuaW5uZXJIVE1MPW1vZGVsU3RhdHVzSHRtbCgpfQoKLyog4pGjIOOBnOOCk+OBtuOBiuOBvuOBi+OBm++8mumBjuWOu+ODrOODvOOCueOBruabtOaWsCDihpIg5LuK6YCx5pyr44Gu5Y+W5b6X44Go5LqI5oOzIOKGkiDjg5Djg4Pjgq/jgqLjg4Pjg5cgKi8KYXN5bmMgZnVuY3Rpb24gYWxsSW5PbmUoKXsKIGNvbnN0IG1zZz10PT57JCgiYWxsU3RhdHVzIikudGV4dENvbnRlbnQ9dH0sdDA9RGF0ZS5ub3coKTsKICQoImFsbEdvIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXsKICBTU1RPUD1mYWxzZTttc2coIjEvMyDpgY7ljrvjg6zjg7zjgrnjgpLmm7TmlrDkuK3igKbvvIjikaHvvIkiKTthd2FpdCBQcm9taXNlLnJlc29sdmUoJCgic3luY0dvIikub25jbGljaygpKTsKICBpZihTU1RPUCl7bXNnKCLikaHjgYzlgZzmraLjgZXjgozjgZ/jgZ/jgoHjgIHkuK3mlq3jgZfjgb7jgZfjgZ/jgIIiKTtyZXR1cm59CiAgbXNnKCIyLzMg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz5Lit4oCm77yI4pGg77yJIik7YXdhaXQgd2Vla2VuZEdvKCk7CiAgbGV0IGJrTm90ZT0iIjsKICBpZihCSy5wYXNzJiZCSy5wYXNzLmxlbmd0aD49OCl7bXNnKCIzLzMg44OQ44OD44Kv44Ki44OD44OX5Lit4oCm77yI4pGi77yJIik7YXdhaXQgcnVuQmFja3VwKGZhbHNlKX0KICBlbHNlIGJrTm90ZT0i44OQ44OD44Kv44Ki44OD44OX44Gv44CB44OR44K544OV44Os44O844K644GM5pyq6Kit5a6a44Gu44Gf44KB6KGM44Gj44Gm44GE44G+44Gb44KT77yI6Kit5a6a44K/44OW44Gn6Kit5a6a44Gn44GN44G+44GZ77yJ44CCIjsKICBhd2FpdCByZWZyZXNoRGF0YUxhc3QoKTtyZW5kZXJNb2RlbFN0YXR1cygpOwogIGNvbnN0IHM9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS10MCkvMTAwMCk7CiAgbXNnKGDlrozkuobvvIgke01hdGguZmxvb3Iocy82MCl95YiGJHtzJTYwfeenku+8ieOAgiR7YmtOb3RlfWApOwogfWNhdGNoKGUpe21zZygi44Ko44Op44O877yaIisoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5eyQoImFsbEdvIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KLyog5qSc6Ki844KS44G+44Go44KB44Gm5a6f6KGM77ya5aW96LWw546HIOKGkiDms6LkubHluqYg4oaSIOWbnuWPjueOh++8iOWFseacieOCreODo+ODg+OCt+ODpeOBpzLjgaTnm67ku6XpmY3jga/pgJ/jgYTvvIkgKi8KYXN5bmMgZnVuY3Rpb24gYWxsRml0KCl7CiBjb25zdCBtc2c9dD0+eyQoImFsbEZpdFN0YXR1cyIpLnRleHRDb250ZW50PXR9OwogJCgiYWxsRml0IikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXsKICBtc2coIjEvMyDlpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraPkuK3igKYiKTthd2FpdCBQcm9taXNlLnJlc29sdmUoJCgicGxSdW4iKS5vbmNsaWNrKCkpOwogIG1zZygiMi8zIOazouS5seW6puOCkuaknOiovOODu+WGjeagoeato+S4reKApiIpO2F3YWl0IFByb21pc2UucmVzb2x2ZSgkKCJ1cFJ1biIpLm9uY2xpY2soKSk7CiAgbXNnKCIzLzMg5Zue5Y+O546H44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgUHJvbWlzZS5yZXNvbHZlKCQoImJ0UnVuIikub25jbGljaygpKTsKICBhd2FpdCByZWZyZXNoRGF0YUxhc3QoKTtyZW5kZXJNb2RlbFN0YXR1cygpO21zZygi5a6M5LqG44GX44G+44GX44Gf44CC5LiL44Gu5ZCE57WQ5p6c44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCIik7CiB9Y2F0Y2goZSl7bXNnKCLjgqjjg6njg7zvvJoiKyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7JCgiYWxsRml0IikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qIOWGjeagoeato+OBrue1kOaenO+8iGxvY2FsU3RvcmFnZe+8ieOCkuOAgeODkOODg+OCr+OCouODg+ODl+WvvuixoeOBruS/neWtmOmgmOWfn++8iOODoeOCv++8ieOBq+OCguWGmeOBl+OBpuOBiuOBj+OAguODluODqeOCpuOCtuOBruODh+ODvOOCv+OCkua2iOOBl+OBpuOCguOAgeODkOODg+OCr+OCouODg+ODl+OBi+OCieaIu+OBm+OCiyAqLwphc3luYyBmdW5jdGlvbiBtb2RlbHNUb01ldGEoZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe21ldGFQdXR9LGRlcHN8fHt9KTsKIHRyeXthd2FpdCBELm1ldGFQdXQoIm1vZGVscyIse3BsOmxvY2FsU3RvcmFnZS5nZXRJdGVtKFBMS0VZKSx1cDpsb2NhbFN0b3JhZ2UuZ2V0SXRlbShVUEtFWSksZ2F0ZTpsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl9KX1jYXRjaChlKXt9Cn0KYXN5bmMgZnVuY3Rpb24gbW9kZWxzRnJvbU1ldGEoZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe21ldGFHZXR9LGRlcHN8fHt9KTsKIHRyeXtjb25zdCBtPWF3YWl0IEQubWV0YUdldCgibW9kZWxzIik7aWYoIW0pcmV0dXJuIDA7bGV0IG49MDsKICBmb3IoY29uc3QgW2ssa2V5XSBvZiBbWyJwbCIsUExLRVldLFsidXAiLFVQS0VZXSxbImdhdGUiLEdBVEVfS0VZXV0paWYobVtrXSYmIWxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkpe2xvY2FsU3RvcmFnZS5zZXRJdGVtKGtleSxtW2tdKTtuKyt9CiAgcmV0dXJuIG59Y2F0Y2goZSl7cmV0dXJuIDB9Cn0KCgovKiAtLS0tLS0tLS0tIOS/neWtmOODh+ODvOOCv+OBrueKtuazgSAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBr+acquWPluW+l+OBp+OBmeOAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgYvjgonjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IG5BbGw9MCxuVHI9MDtmb3IoY29uc3QgZiBvZiBsaXZlKWZvcihjb25zdCByIG9mIGYucm93cyl7bkFsbCsrO2lmKHIudHJhaW5lciluVHIrK30KICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OXQ1NW77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICBpZihuQWxsKWgrPWBcbuiqv+aVmeW4q+OBpOOBjeOBruaIkOe4vu+8miR7TWF0aC5yb3VuZChuVHIvbkFsbCoxMDApfSUke25Ucj09PTA/Iu+8iOOBk+OCjOOBi+OCieWPluW+l+OBmeOCi+aIkOe4vuOBq+WFpeOCiuOBvuOBme+8iSI6IiJ9YDsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KCi8qIC0tLS0tLS0tLS0g5Y+W5b6X44GX44Gf6KGMIOKGkiDlhoXpg6jjga7ooYzvvIjoqr/mlZnluKvjg7vjgrDjg6zjg7zjg4nku5jjgY3vvIkgLS0tLS0tLS0tLSAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwsCiAgcG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoeC50cmFpbmVyKSwKICByYWNlTmFtZTpTdHJpbmcoeC5yYWNlTmFtZXx8IiIpLGdjOmdvaW5nQ2F0KGdvaW5nQ29kZSh4LmdvaW5nKSksdmVudWU6dmVudWVGcm9tSWQoeC5yYWNlSWQpLAogIGx2bDooeC52ZW51ZUNvZGUmJiEvXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoeC52ZW51ZUNvZGUpKSk/LTE6KFVFLmxldmVsT2ZMYWJlbCh4LmNscyl8fFVFLmxldmVsT2ZQcml6ZSh4LnByaXplKSksCiAgZ3JkOlVFLmdyYWRlVGllcigoeC5jbHN8fCIiKSsiICIrKHguZ3JhZGV8fCIiKSx4LnByaXplLGZhbHNlKSwKICBjb3JuZXI6QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD94LmNvcm5lcjpudWxsLGxhcDpBcnJheS5pc0FycmF5KHgubGFwKSYmeC5sYXAubGVuZ3RoP3gubGFwOm51bGx9fQoKLyog5a++6LGh5pel44KI44KK5YmN44Gu5bGl5q2044Gg44GR44Gn44K544OI44Ki44KS5L2c44KL77yI6aiO5omL44O76Kq/5pWZ5bir44Gu5oiQ57i+44KC5ZCM5pmC44Gr6ZuG6KiI77yJICovCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkU3RvcmUodGFyZ2V0KXsKIGlmKFNUT1JFJiZTVE9SRV9LRVk9PT10YXJnZXQpcmV0dXJuIFNUT1JFOwogY29uc3QgZnM9ZmlsZU9yZGVyKGF3YWl0IGlkYkFsbCgpKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CC5YWI44Gr44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBmeOBi+OAgeioreWumuOBp+ODkOODg+OCr+OCouODg+ODl+OCkuW+qeWFg+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3Qgc3Q9bmV3IFVFLlN0b3JlKCk7c3QudHI9bmV3IE1hcCgpO2xldCB1c2VkPTA7Y29uc3QgQUc9bmV3IE1hcCgpLGRyYXc9bmV3IERyYXdQcmkoKSxzaXJlPW5ldyBTaXJlUHJpKCk7CiBjb25zdCB0YWtlPXI9PntpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpcmV0dXJuO2FnZ0FkZChBRyxyKTtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGU7CiAgY29uc3QgdDM9ci5maW5pc2ghPW51bGwmJnIuZmluaXNoPD0zPzE6MDsKICBpZihyLnRyYWluZXImJnIuZmluaXNoIT1udWxsKXtsZXQgdD1zdC50ci5nZXQoci50cmFpbmVyKTtpZighdClzdC50ci5zZXQoci50cmFpbmVyLHQ9e246MCx0MzowfSk7dC5uKys7dC50Mys9dDN9CiAgaWYoci5maW5pc2ghPW51bGwmJnIuTil7Y29uc3Qgdj1yLnZlbnVlfHx2ZW51ZUZyb21JZChyLnJhY2VJZCk7ZHJhdy5hZGQodixyLnN1cmYsci5kaXN0LHIubnVtLHIuTix0Myk7c2lyZS5hZGQoUEVEW3IuaG9yc2VdLHIuc3VyZixyLmRpc3QsdDMsci5OKX19OwogY29uc3QgZGQ9bmV3IFJhY2VEZWR1cGUoKTsKIGNvbnN0IHByZXA9cm93cz0+e3Jvd3M9cm93cy5maWx0ZXIocj0+IWRkLnNraXAocikpO2NvbnN0IGNudD17fTtmb3IoY29uc3QgciBvZiByb3dzKWlmKHIuZmluaXNoIT1udWxsKWNudFtyLnJhY2VJZF09KGNudFtyLnJhY2VJZF18fDApKzE7Zm9yKGNvbnN0IHIgb2Ygcm93cyl7ci5OPWNudFtyLnJhY2VJZF18fDA7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHIuTik7dGFrZShyKX19OwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXByZXAoKGZzW2ldLnJvd3N8fFtdKS5tYXAobGl2ZVJvdykpOwogIGVsc2UgcHJlcChVRS5jc3ZSb3dzKGZzW2ldLmNzdikubWFwKFVFLnRvUm93KSk7CiAgYXdhaXQgc2xlZXAoMCk7CiB9CiBjb25zdCBwcmk9bmV3IFVwUHJpKCkscHA9bmV3IFBvcFByaSgpO2Zvcihjb25zdCBhIG9mIEFHLnZhbHVlcygpKXtwcmkuYWRkKGFnZ0luZm8oYSkpO2lmKGEuTj49NiYmYS5wZi5sZW5ndGg9PT1hLk4mJiFhLmp1bXApcHAuYWRkKGEucGYsYS5OKX1zdC51cD1wcmk7c3QucHA9cHA7c3QuZHJhdz1kcmF3O3N0LnNpcmU9c2lyZTtzdC5kdXBSYWNlcz1kZC5kdXBzLnNpemU7CiBidXN5KGZhbHNlKTtTVE9SRT1zdDtTVE9SRV9LRVk9dGFyZ2V0O3N0LmNvdW50PXVzZWQ7cmV0dXJuIHN0Owp9CgovKiDlh7rppqzooajjga4x44Os44O844K5IOKGkiDop6PmnpDnlKjjga7jg6zjg7zjgrkgKi8KZnVuY3Rpb24gbWtSYWNlKGMsZCl7CiBjb25zdCBocz1jLmhvcnNlc3x8Yy5ydW5uZXJzfHxbXTsKIGNvbnN0IGd0PShjLmNsYXNzTmFtZXx8IiIpKyIgIisoYy5ncmFkZXx8IiIpKyIgIisoYy5yYWNlTmFtZXx8IiIpOwogY29uc3QgZ3JkPVVFLmdyYWRlVGllcihndCxjLnByaXplLHRydWUpOwogcmV0dXJue2RhdGU6ZCxzdXJmOlVFLnN1cmZDb2RlKGMuc3VyZmFjZSksZGlzdDpOdW1iZXIoYy5kaXN0YW5jZSl8fDAsCiAgbHZsOlVFLmxldmVsT2ZMYWJlbChjLmNsYXNzTmFtZSl8fFVFLmxldmVsT2ZMYWJlbChjLnJhY2VOYW1lKXx8KGdyZD49MT81OjApLGdyZCwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7CiAgIHJldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKGgudHJhaW5lcnx8IiIpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KQogICAuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDku4rpgLHmnKvjga7lj5blvpcKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBXSz17ZGF0ZXM6W10sY2FyZHM6e30sb2Rkczp7fSxvZGRzTm90ZXM6e30sZGlhZzpbXSxjYWxjOnt9LGF0OiIiLHN0b3JlSW5mbzpudWxsfTsKY29uc3QgcmtleT0oZCxjKT0+YCR7ZH18JHtTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKGMucmFjZU51bWJlcil8fDB9YDsKY29uc3Qgd2tNc2c9dD0+eyQoIndrU3RhdHVzIikudGV4dENvbnRlbnQ9dH07CmNvbnN0IGJhc2VVcmw9KCk9PiQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKZnVuY3Rpb24gbmV4dFdlZWtlbmQodG9kYXkpe2NvbnN0IG91dD1bXTtjb25zdCB0PW5ldyBEYXRlKHRvZGF5KyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpOwogZm9yKGxldCBpPTA7aTw4JiZvdXQubGVuZ3RoPDI7aSsrKXtjb25zdCBkPW5ldyBEYXRlKHQraSo4NjRlNSksdz1kLmdldFVUQ0RheSgpO2lmKHc9PT02fHx3PT09MClvdXQucHVzaChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkpfXJldHVybiBvdXR9Cgphc3luYyBmdW5jdGlvbiBmZXRjaENhcmRzKGJhc2UsZCx2ZW51ZUNvZGUpewogY29uc3QgcT12ZW51ZUNvZGU/YCZ2ZW51ZT0ke2VuY29kZVVSSUNvbXBvbmVudCh2ZW51ZUNvZGUpfWA6IiI7bGV0IGVycj0iIjsKIGZvcihsZXQgdD0wO3Q8Mzt0KyspewogIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0ke3F9YCk7CiAgIGlmKCFyLm9rKXtsZXQgbT0iIjt0cnl7bT0oYXdhaXQgci5qc29uKCkpLmVycm9yfHwiIn1jYXRjaHt9dGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9ICR7bX1gLnRyaW0oKSl9CiAgIGNvbnN0IHg9YXdhaXQgci5qc29uKCk7cmV0dXJue3JhY2VzOkFycmF5LmlzQXJyYXkoeCk/eDooeC5yYWNlc3x8W10pfX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CgovKiAx6ZaL5YKs5aC044G244KT44Gu5Ye66aas6KGo44CC5qyg44GR44O75aSx5pWX44GM44GC44KM44Gw44CB6Ieq5YuV44GnMeWbnuOBoOOBkeOChOOCiuebtOOBmSAqLwphc3luYyBmdW5jdGlvbiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LGlzUmV0cnkpewogY29uc3QgY29kZT1TdHJpbmcodi52ZW51ZUNvZGUpOwogV0suY2FyZHNbZF09KFdLLmNhcmRzW2RdfHxbXSkuZmlsdGVyKGM9PlN0cmluZyhjLnZlbnVlQ29kZSkhPT1jb2RlKTsKIFdLLmRpYWc9V0suZGlhZy5maWx0ZXIoeD0+ISh4LmQ9PT1kJiZ4LmNvZGU9PT1jb2RlKSk7CiB0cnl7CiAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCxjb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGJhZD1yYWNlcy5sZW5ndGgtb2subGVuZ3RoOwogIFdLLmNhcmRzW2RdLnB1c2goLi4ub2spOwogIGNvbnN0IGlzc3Vlcz1vay5maWx0ZXIoYz0+Yy5xdWFsaXR5JiYhYy5xdWFsaXR5Lm9rKS5tYXAoYz0+YCR7Yy5yYWNlTnVtYmVyfVLvvJoke2MucXVhbGl0eS5pc3N1ZXMuam9pbigi44O7Iil9YCk7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6cmFjZXMubGVuZ3RoLG9rOm9rLmxlbmd0aCxiYWQsaXNzdWVzLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOiIifSk7CiAgaWYoKGJhZD4wfHxvay5sZW5ndGg8OCkmJiFpc1JldHJ5KXthd2FpdCBzbGVlcCg4MDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfWNhdGNoKGUpewogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pOwogIGlmKCFpc1JldHJ5KXthd2FpdCBzbGVlcCgxMjAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH0KfQoKLyog44Kq44OD44K677yI5Y2Y5Yud77yL6KSH5Yud77yJ44CC5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6lIOKGkiDlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjga/jgIHml6Xku5jjg7vplovlgqzloLTjga7jg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYYgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hPZGRzRGF0ZShiYXNlLGQpewogY29uc3QgY2FyZHM9V0suY2FyZHNbZF18fFtdLG5vdGVzPVtdO1dLLm9kZHNOb3Rlcz1XSy5vZGRzTm90ZXN8fHt9OwogaWYoIWNhcmRzLmxlbmd0aCl7V0sub2Rkc05vdGVzW2RdPW5vdGVzO3JldHVybntuOjAsbm90ZXN9fQogY29uc3Qgd2l0aExpbms9Y2FyZHMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUM9bmV3IE1hcCh3aXRoTGluay5tYXAocj0+W3Iub2Rkc0NuYW1lLHJdKSk7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTx3aXRoTGluay5sZW5ndGg7aSs9NiljaHVua3MucHVzaCh3aXRoTGluay5zbGljZShpLGkrNikubWFwKHI9PnIub2Rkc0NuYW1lKSk7CiBsZXQgY2k9MCxmYWlsTj0wO2NvbnN0IHJlYXNvbnM9e307CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Qy5nZXQoaXQuY25hbWUpO2lmKHIpV0sub2Rkc1tya2V5KGQscildPXt0YW46aXQub2Rkc3x8e30scGxhY2U6aXQucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9fQogICBmb3IoY29uc3QgZiBvZiAoeC5mYWlsZWR8fFtdKSl7ZmFpbE4rKztjb25zdCBtPVN0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9CiAgfWNhdGNoKGUpe2ZhaWxOKz1jaHVua3Nba10ubGVuZ3RoO2NvbnN0IG09U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX19fTsKIGF3YWl0IFByb21pc2UuYWxsKFt3b3JrZXIoKSx3b3JrZXIoKV0pOwogY29uc3QgZGlyZWN0PWNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aDsKIG5vdGVzLnB1c2goYOWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpe+8miR7ZGlyZWN0fS8ke2NhcmRzLmxlbmd0aH3jg6zjg7zjgrnvvIjjg6rjg7Pjgq/jgYLjgoogJHt3aXRoTGluay5sZW5ndGh944CB5aSx5pWXICR7ZmFpbE5977yJYCk7CiBmb3IoY29uc3QgW20sY10gb2YgT2JqZWN0LmVudHJpZXMocmVhc29ucykpbm90ZXMucHVzaChg44CA5aSx5pWX44Gu55CG55Sx77yaJHttfe+8iCR7Y33vvIlgKTsKIGNvbnN0IG1pc3Npbmc9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYobWlzc2luZy5sZW5ndGgpewogIGZvcihjb25zdCB2IG9mIFsuLi5uZXcgU2V0KG1pc3NpbmcubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbikpewogICBjb25zdCBuZWVkPW5ldyBTZXQobWlzc2luZy5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dikubWFwKHI9Pk51bWJlcihyLnJhY2VOdW1iZXIpKSk7CiAgIHRyeXsKICAgIGNvbnN0IEw9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgY29uc3QgYWxsPUwubGlua3N8fFtdLGxpbmtzPWFsbC5maWx0ZXIoeD0+bmVlZC5oYXMoeC5yYWNlTm8pKTsKICAgIG5vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muOCquODg+OCuueUu+mdouOBjOOBguOCi+ODrOODvOOCuSAke2FsbC5tYXAoeD0+eC5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ977yI5pyq5Y+W5b6XJHtuZWVkLnNpemV944Os44O844K544Gu44GG44GhJHtsaW5rcy5sZW5ndGh944Os44O844K577yJYCk7CiAgICBpZighYWxsLmxlbmd0aClub3Rlcy5wdXNoKGDjgIDnmbrlo7LliY3jga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgILoqLrmlq3vvJoke0pTT04uc3RyaW5naWZ5KChMLmRpYWd8fFtdKS5tYXAoeD0+KHtzOnguc3RlcCxsZW46eC5odG1sTGVuZ3RoLG46eC5jbmFtZXMsazp4LmtpbmRzLG06eC5tZW51cyxlOnguZXJyb3J9KSkpLnNsaWNlKDAsMzYwKX1gKTsKICAgIGNvbnN0IGJ5Qz1uZXcgTWFwKGxpbmtzLm1hcCh4PT5beC5jbmFtZSx4LnJhY2VOb10pKTsKICAgIGZvcihsZXQgaT0wO2k8bGlua3MubGVuZ3RoO2krPTQpewogICAgIGNvbnN0IGNoPWxpbmtzLnNsaWNlKGksaSs0KS5tYXAoeD0+eC5jbmFtZSk7CiAgICAgdHJ5ewogICAgICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaC5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICAgICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgbm89YnlDLmdldChpdC5jbmFtZSk7aWYobm8pV0sub2Rkc1tgJHtkfXwke3Z9LSR7bm99YF09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgICAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKW5vdGVzLnB1c2goYOOAgOiqreOBv+WPluOCjOOBquOBi+OBo+OBn++8miR7VkVOVUVbdl18fHZ9JHtieUMuZ2V0KGYuY25hbWUpfVLvvIgke1N0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNTApfe+8iWApOwogICAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjgIDlj5blvpfjgqjjg6njg7wgJHtWRU5VRVt2XXx8dn3vvJoke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsNzApfWApfQogICAgfQogICB9Y2F0Y2goZSl7bm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977ya5aSx5pWX77yIJHtTdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDEwMCl977yJYCl9CiAgfQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKbGV0IE9ERFNfVElNRVI9bnVsbCxPRERTX1RSSUVTPTA7CmZ1bmN0aW9uIG9kZHNNaXNzaW5nKCl7bGV0IG09MCx0PTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpZm9yKGNvbnN0IGMgb2YgV0suY2FyZHNbZF18fFtdKXt0Kys7aWYoIVdLLm9kZHNbcmtleShkLGMpXSltKyt9cmV0dXJue20sdH19Ci8qIOOCquODg+OCuuOBruacquWPluW+l+OBjOaui+OBo+OBpuOBhOOBpuOAgeW9k+aXpeOBruacneOAnOWkleaWueOBquOCieOAgTXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZnvvIhKUkHjga/pgJrluLjjga7jg6zjg7zjgrnjgpLlvZPml6XmnJ3jgavnmbrlo7Lplovlp4vjgZnjgovjgZ/jgoHvvIkgKi8KZnVuY3Rpb24gc2NoZWR1bGVPZGRzUmV0cnkoKXsKIGlmKE9ERFNfVElNRVIpe2NsZWFyVGltZW91dChPRERTX1RJTUVSKTtPRERTX1RJTUVSPW51bGx9CiBjb25zdCB7bX09b2Rkc01pc3NpbmcoKSxoPW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLmdldFVUQ0hvdXJzKCk7CiBpZighbXx8T0REU19UUklFUz49MzZ8fGg8Nnx8aD49MTd8fCFXSy5kYXRlcy5pbmNsdWRlcyhqc3RUb2RheSgpKSlyZXR1cm4gZmFsc2U7CiBPRERTX1RSSUVTKys7T0REU19USU1FUj1zZXRUaW1lb3V0KCgpPT57T0REU19USU1FUj1udWxsO2lmKCEkKCJ3a0dvIikuZGlzYWJsZWQpb2Rkc09ubHkoKX0sNSo2MGUzKTtyZXR1cm4gdHJ1ZTsKfQpjb25zdCBvZGRzSGludD0oKT0+e2NvbnN0IHttfT1vZGRzTWlzc2luZygpO2lmKCFtKXJldHVybiIiO2NvbnN0IHNjaD1zY2hlZHVsZU9kZHNSZXRyeSgpO3JldHVybmBcbuacquWPluW+lyAke21944Os44O844K577ya55m65aOy5YmN44Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ77yISlJB44Gv6YCa5bi444Gu44Os44O844K544Gu44Kq44OD44K644KS5b2T5pel5pyd44Gr55m65aOy6ZaL5aeL77yJ44CCJHtzY2g/IjXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZfjgb7jgZnjgIIiOiLnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifWB9Owphc3luYyBmdW5jdGlvbiB3ZWVrZW5kR28oKXtPRERTX1RSSUVTPTA7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgdHJ5e1dLLnBlZD1hd2FpdCBwZWRpZ3JlZVVwZGF0ZShXSy5jYXJkcyl9Y2F0Y2goZSl7V0sucGVkPW51bGx9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzSGludCgpfWApOwogICQoIndrT2RkcyIpLmRpc2FibGVkPWZhbHNlO3Nob3dUYWIoInZBeGlzIik7CiB9Y2F0Y2goZSl7d2tNc2coIuOCqOODqeODvO+8miIrZS5tZXNzYWdlKTtidXN5KGZhbHNlKTtyZW5kZXJBbGwoKX0KIGZpbmFsbHl7JCgid2tHbyIpLmRpc2FibGVkPWZhbHNlfQp9CmFzeW5jIGZ1bmN0aW9uIG9kZHNPbmx5KCl7CiBpZighV0suZGF0ZXMubGVuZ3RoKXJldHVybjskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogdHJ5e2xldCBuPTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuabtOaWsOS4reKApmApO24rPShhd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKSkubn0KICBhd2FpdCBjYWxjV2Vla2VuZCgpO1dLLmF0PW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTYpO3JlbmRlckFsbCgpO3drTXNnKGDjgqrjg4Pjgrrmm7TmlrDvvIgke1dLLmF0fe+8ie+8miR7bn3jg6zjg7zjgrnliIYke29kZHNIaW50KCl9YCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCk7cmFjZS5nYz1nb2luZ0NhdChnb2luZ0NvZGUoYy5nb2luZykpO2xldCBuPXJhY2UucnVubmVycy5sZW5ndGg7Y29uc3Qgc2NyYXRjaGVkPVtdOwoge2NvbnN0IG8wPVdLLm9kZHNbcmtleShkLGMpXTsKICBpZihvMCl7Y29uc3QgbWlzcz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9PiEobzAudGFuW3IubnVtXT4xKSksaGF2ZT1yYWNlLnJ1bm5lcnMubGVuZ3RoLW1pc3MubGVuZ3RoOwogICAvLyDkuIDpg6jjga7ppqzjgaDjgZHjgqrjg4PjgrrjgYznhKHjgYTvvJ3lj5bmtojjg7vpmaTlpJbjga7lj6/og73mgKfjgYzpq5jjgYTjgILlpJbjgZfjgabjgIHjgqrjg4Pjgrrovrzjgb/jgafop6PmnpDjgZnjgovvvIjlpKfljYrjgYzmrKDjgZHjgabjgYTjgovjgarjgonlpJbjgZXjgarjgYTvvIkKICAgaWYobWlzcy5sZW5ndGgmJmhhdmU+PTYmJm1pc3MubGVuZ3RoPD1NYXRoLm1heCgzLE1hdGguZmxvb3IocmFjZS5ydW5uZXJzLmxlbmd0aCouMikpKXtzY3JhdGNoZWQucHVzaCguLi5taXNzLm1hcChyPT5yLm51bSkpO3JhY2UucnVubmVycz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9Pm8wLnRhbltyLm51bV0+MSk7bj1yYWNlLnJ1bm5lcnMubGVuZ3RofX19CiBjb25zdCBiYXNlPXtkLGNhcmQ6YyxyYWNlLG4sc2NyYXRjaGVkLGtleTpya2V5KGQsYyksdmVudWU6Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIiLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLAogIGxhYmVsOmAke2MudmVudWVOYW1lfHxjLnZlbnVlfHwiIn0ke2MucmFjZU51bWJlcnx8IiJ9UiAkeyhjLnJhY2VOYW1lJiZjLnJhY2VOYW1lIT09IuWHuummrOihqCIpP2MucmFjZU5hbWU6KGMuY2xhc3NOYW1lfHwiIil9YCxjb3Vyc2U6Yy5zdXJmYWNlJiZjLmRpc3RhbmNlP2Ake2Muc3VyZmFjZX0ke2MuZGlzdGFuY2V9bWA6IuOCs+ODvOOCueS4jeaYjiJ9OwogaWYoL+manOWusy8udGVzdCgoYy5yYWNlTmFtZXx8IiIpKyhjLmNsYXNzTmFtZXx8IiIpKSlyZXR1cm57Li4uYmFzZSxza2lwOiLpmpzlrrPjg6zjg7zjgrnjga/lr77osaHlpJbvvIjlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHvvIkifTsKIGlmKG48NilyZXR1cm57Li4uYmFzZSxza2lwOiI26aCt5pyq5rqAIn07CiBjb25zdCBvPVdLLm9kZHNbYmFzZS5rZXldLG9kZHM9bz9yYWNlLnJ1bm5lcnMubWFwKHI9Pm8udGFuW3IubnVtXSk6bnVsbCxoYXNPZGRzPSEhKG9kZHMmJm9kZHMuZXZlcnkoeD0+eD4xKSk7CiBjb25zdCBvZD1oYXNPZGRzP29kZHM6bnVsbDsKIGNvbnN0IHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTtsZXQgdWc9VUUudXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kLGFwKTsKIGNvbnN0IFVNPWdldFVwc2V0TW9kZWwoKTsKIGlmKFVNJiZzdG9yZS51cCl7dHJ5e2NvbnN0IHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKSxpbmY9e3Y6U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLGdjOnJhY2UuZ2Msc3VyZjpyYWNlLnN1cmYsZGlzdDpyYWNlLmRpc3QsbHZsOnJhY2UubHZsLGdyZDpyYWNlLmdyZCxOOm59LHNpbT0oaGFzT2RkcyYmc3RvcmUucHAmJm4+PTYpPygoKT0+e2NvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKTtyZXR1cm4gc2ltRmVhdChhcC5wUCxwb3BzLG4sc3RvcmUucHApfSkoKTpudWxsLGN1PXVwc2V0Q3VzdG9tKFVNLHUsc3RvcmUudXAuZmVhdChpbmYpLHBhY2VGZWF0KHJhY2UucnVubmVycyxzdG9yZSksc2ltKTtpZihjdSl1Zz17Li4udWcsLi4uY3UsbW9kZTp1Lm1vZGUsY3VzdG9tOnRydWV9fWNhdGNoKGUpe319CiBjb25zdCBQTT1nZXRQbGFjZU1vZGVsKCk7bGV0IHBOZXc9bnVsbDsKIHJhY2UuZ2M9Z29pbmdDYXQoZ29pbmdDb2RlKGMuZ29pbmcpKTsKIGlmKFBNJiZoYXNPZGRzJiZuPj04JiZzdG9yZS5wcCl7dHJ5ewogIGNvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKSxyaz1yYW5rRnJhY3MoYXAucFApLHJjST17Z2M6cmFjZS5nYyx2OlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxOOm59LGN0eD17ZHJhdzpzdG9yZS5kcmF3LHRyOnN0b3JlLnRyLHNpcmU6c3RvcmUuc2lyZSxwZWQ6UEVEfSxiPU1hdGgubWluKC41LDMvbik7CiAgcE5ldz1ub3JtU3VtKHJhY2UucnVubmVycy5tYXAoKHIsaSk9PntsZXQgeD1wbGFjZVgoYXAucFBbaV0scG9wc1tpXSxuLHN0b3JlLnBwLHJrW2ldKTtpZihQTS5leHQpeD1bLi4ueCwuLi5leHRGZWF0SG9yc2UocixzdG9yZS5oLmdldChyLmhvcnNlKSxyY0ksY3R4LGIpXTtyZXR1cm4gcHJlZExvZ2l0KFBNLm1vZGVsLHgpfSksMyl9Y2F0Y2goZSl7cE5ldz1udWxsfX0KIGxldCBheGlzPWhhc09kZHM/VUUuYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2QsYXApOm51bGw7CiBpZihoYXNPZGRzKXsKICBjb25zdCBwYT1wTmV3fHxhcC5wTyxpcm9uUmF0ZT0ocE5ldyYmUE0uaXJvbiYmUE0uaXJvbi5uPjApP1BNLmlyb24ucmF0ZTpVRS5BWElTLmJhbmRzWyLpiYTmnb8iXS5yYXRlOwogIGNvbnN0IGlyb249cGEubWFwKChwLGkpPT4oe2kscCx0aWVyOiLpiYTmnb8iLHJhdGU6aXJvblJhdGV9KSkuZmlsdGVyKHg9PngucD49SVJPTl9QKTsKICBjb25zdCBpc0lyb249bmV3IFNldChpcm9uLm1hcCh4PT54LmkpKSxyZWY9KGF4aXN8fFtdKS5maWx0ZXIoeD0+IWlzSXJvbi5oYXMoeC5pKSYmeC50aWVyIT09IumJhOadvyIpLm1hcCh4PT4oey4uLngscDpwYVt4LmldfSkpOwogIGF4aXM9Wy4uLmlyb24sLi4ucmVmXTsKIH0KIGNvbnN0IG0zPWhhc09kZHM/VUUudG9wM0Zyb21XaW4ob2QubWFwKHg9PjEveCkpOm51bGw7CiBjb25zdCBob3JzZXM9cmFjZS5ydW5uZXJzLm1hcCgocixpKT0+ewogIGNvbnN0IHA9cE5ldz9wTmV3W2ldOihoYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldKSxwbD1vJiZvLnBsYWNlJiZvLnBsYWNlW3IubnVtXTsKICBsZXQgbG89bnVsbCxoaT1udWxsLHNyYz1udWxsOwogIGlmKHBsJiZwbC5sZW5ndGg9PT0yJiZwbFswXT49MSl7bG89cGxbMF07aGk9cGxbMV07c3JjPSLlrp8ifQogIGVsc2UgaWYobTMpe2xvPU1hdGgubWF4KDEsMC44L01hdGgubWF4KG0zW2ldLC4wMikpO2hpPWxvO3NyYz0i5o6o5a6aIn0KICBjb25zdCB0cj1zdG9yZS50ciYmci50cmFpbmVyP3N0b3JlLnRyLmdldChyLnRyYWluZXIpOm51bGwseD1yZXNbaV07CiAgcmV0dXJue2ksbm86ci5udW0sbmFtZTpyLm5hbWUsam5hbWU6ci5qbmFtZSx0cmFpbmVyOnIudHJhaW5lcix0ck46dHI/dHIubjowLHRyUmF0ZTp0ciYmdHIubj90ci50My90ci5uOm51bGwsam46eC5qbiwKICAgcCxwU3JjOnBOZXc/IuWGjeagoeatoyI6bnVsbCxwT2xkOmhhc09kZHM/YXAucE9baV06YXAucFBbaV0sbG8saGksc3JjLGV2OmxvP3AqbG86bnVsbCxldk1pZDpsbz9wKihsbytoaSkvMjpudWxsLHdpbjpoYXNPZGRzP29kW2ldOm51bGwscG9wOngucG9wLGhvbGU6eC5ob2xlLHBjOngucGMsbW9kZTp4Lm1vZGUsbjp4Lm4sCiAgIGNhcmVlcjp4LmNhcmVlcixyZWNlbnQ6eC5yZWNlbnQsdGFnczp4LnRhZ3MscmF0aW5nOihwTmV3JiZQTS5ob2xlQ3V0cyYmeC5ob2xlKT9ncmFkZUhvbGUoUE0uaG9sZUN1dHMscCk6VUUucmF0aW5nKHgucGMseC5tb2RlLHgubikseH19KTsKIHJldHVybnsuLi5iYXNlLGhhc09kZHMscmVzLGFwLHVnLGF4aXMsaG9yc2VzLGhvbGVOZXc6ISEocE5ldyYmUE0uaG9sZUN1dHMpLHBsYWNlUmVhbDpob3JzZXMuZmlsdGVyKGg9Pmguc3JjPT09IuWunyIpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gY2FsY1dlZWtlbmQoKXsKIFdLLmNhbGM9e307CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKFdLLmRhdGVzWzBdKTsKIFdLLnN0b3JlSW5mbz17bGFzdDpzdG9yZS5sYXN0RGF0ZXx8IiIsY291bnQ6c3RvcmUuY291bnQsZHVwczpzdG9yZS5kdXBSYWNlc3x8MH07CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgY3M9Wy4uLldLLmNhcmRzW2RdXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGUpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBXSy5jYWxjW2RdPXtyYWNlczpbXX07CiAgZm9yKGxldCBpPTA7aTxjcy5sZW5ndGg7aSsrKXsKICAgdHJ5e1dLLmNhbGNbZF0ucmFjZXMucHVzaChjYWxjUmFjZShkLGNzW2ldLHN0b3JlKSl9CiAgIGNhdGNoKGUpe1dLLmNhbGNbZF0ucmFjZXMucHVzaCh7ZCxjYXJkOmNzW2ldLHNraXA6Iuino+aekOOCqOODqeODvO+8miIrZS5tZXNzYWdlLGxhYmVsOmAke2NzW2ldLnZlbnVlTmFtZXx8IiJ9JHtjc1tpXS5yYWNlTnVtYmVyfHwiIn1SYCx2ZW51ZTpjc1tpXS52ZW51ZU5hbWV8fCIiLG5vOmNzW2ldLnJhY2VOdW1iZXJ8fDAsaG9yc2VzOltdfSl9CiAgIGlmKGklND09PTMpYXdhaXQgc2xlZXAoMCk7CiAgfQogfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5qSc6Ki844Ky44O844OI77ya5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn44CB6Kqk5beu44KS5byV44GE44Gm44KC5Zue5Y+O546HMTAwJeS7peS4iuOBruiyt+OBhOaWueOBoOOBkeOAjOaknOiovOa4iOOBv+OAjQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdBVEVfS0VZPSJrZWliYV9nYXRlX3YyIjsKY29uc3QgZ2V0R2F0ZT0oKT0+e3RyeXtyZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl8fCJudWxsIil9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKY29uc3QgU1RSQVQ9e2ZvY3VzOiLnqbTppqzvvIjil47nmoTkuK3njofph43oppbvvIkiLHRvcDE6IueptOmmrDHkvY0iLHRvcDI6IueptOmmrOS4iuS9jTLpoK0iLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uCJ9OwpmdW5jdGlvbiBzZXRHYXRlKG91dCxvdXRQKXsKIGNvbnN0IGl0ZW1zPVtdOwogZm9yKGNvbnN0IFtzcmMsb10gb2YgW1si44Kq44OD44K644GC44KKIixvdXRdLFsi44Kq44OD44K644Gq44GXIixvdXRQXV0pewogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKFNUUkFUKSl7CiAgIGNvbnN0IHY9by5zdGF0c1trXTtpZighdiljb250aW51ZTsKICAgY29uc3Qgc2VnPSh2LkMmJnYuQy5iZXRzPj0zMDApP3YuQzp2LmFsbDtpZighc2VnfHwhc2VnLmJldHMpY29udGludWU7CiAgIGNvbnN0IGxvdz1zZWcucm9pLTEuOTYqc2VnLnNlOwogICBpdGVtcy5wdXNoKHtrZXk6ayxsYWJlbDpTVFJBVFtrXSsi77yIIitzcmMrIu+8iSIscm9pOnNlZy5yb2ksbG93LGJldHM6c2VnLmJldHMsaGl0OnNlZy5oaXRSYXRlLHNlZzpzZWc9PT12LkM/IuWtpue/kuW+jCI6IuWFqOacn+mWkyJ9KTsKICB9CiB9CiBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShHQVRFX0tFWSxKU09OLnN0cmluZ2lmeSh7YXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLGl0ZW1zfSkpOwogbW9kZWxzVG9NZXRhKCk7CiByZW5kZXJHYXRlKCk7Cn0KY29uc3Qgc3RyYXRPaz1rZXk9Pntjb25zdCBnPWdldEdhdGUoKTtyZXR1cm4gISEoZyYmZy5pdGVtcy5zb21lKHg9Pngua2V5PT09a2V5JiZ4Lmxvdz49MSYmeC5iZXRzPj0zMDApKX07CmNvbnN0IHN0cmF0Q2hpcD1rZXk9PnN0cmF0T2soa2V5KT8nPHNwYW4gY2xhc3M9ImNoaXAgYiI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8iTwvc3Bhbj4nOic8c3BhbiBjbGFzcz0iY2hpcCByIj7lm57lj47njocxMDAl6LaF44Gv5pyq56K66KqNPC9zcGFuPic7CmZ1bmN0aW9uIHJlbmRlckdhdGUoKXsKIHRyeXtyZW5kZXJNb2RlbFN0YXR1cygpfWNhdGNoKGUpe30KIGNvbnN0IGc9Z2V0R2F0ZSgpLGVsPSQoImdhdGUiKTsKIGlmKCFnKXtlbC5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+PGI+5Zue5Y+O546H77ya5pyq5qSc6Ki8PC9iPuOAgOOAjOaknOiovOOAjeOCv+ODluOCkuWun+ihjOOBmeOCi+OBvuOBp+OAgeOBqeOBruiyt+OBhOaWueOCguOAjDEwMCXotoXjgI3jgajjga/oqIDjgYjjgb7jgZvjgpPjgILvvIjku6XliY3jga7mpJzoqLzjgafjga/jgIHnqbTppqwx5L2N44Gu6KSH5Yud5Zue5Y+O546H44Gv57SENzLjgJw3NyXjgafjgZfjgZ/vvIk8L2Rpdj4nO3JldHVybn0KIGNvbnN0IG9rPWcuaXRlbXMuZmlsdGVyKHg9PngubG93Pj0xJiZ4LmJldHM+PTMwMCksYmVzdD1nLml0ZW1zLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi5yb2ktYS5yb2kpWzBdOwogaWYob2subGVuZ3RoKWVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG9rIj48Yj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJ77yaPC9iPiR7b2subWFwKHg9PmAke2VzYyh4LmxhYmVsKX0gJHtwY3QoeC5yb2kpfe+8iOS4i+mZkCR7cGN0KHgubG93KX3jg7ske3guYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7eC5zZWd977yJYCkuam9pbigi77yPIil9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAgumBjuWOu+OBruaIkOe4vuOBp+OBrue1kOaenOOBp+OAgeS7iuW+jOOCgue2muOBj+S/neiovOOBr+OBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj48L2Rpdj5gOwogZWxzZSBlbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBuZyI+PGI+5Zue5Y+O546HMTAwJei2heOCkueiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBr+OAgeOBvuOBoOOBguOCiuOBvuOBm+OCk+OAgjwvYj4ke2Jlc3Q/YOacgOmrmOOBp+OCgiAke2VzYyhiZXN0LmxhYmVsKX0g44GuICR7cGN0KGJlc3Qucm9pKX3vvIjoqqTlt67jgpLlvJXjgY/jgagke3BjdChiZXN0Lmxvdyl944O7JHtiZXN0LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske2Jlc3Quc2Vnfe+8ieOAgmA6IiJ9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAguS4i+OBruWAmeijnOOBr+OAjOW9k+OBn+OCiuOChOOBmeOBleODu+acn+W+heWApOOBruebruWuieOAjeOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj48L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6KGo56S6CiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgSVJPTl9QPTAuOTU7ICAgLy8g6LaF6YmE5p2/77yd6KSH5Yud5ZyP5YaF44Gr5YWl44KL56K6546H44GMOTUl5Lul5LiK44Gu6aas77yI6aCt5pWw44Gu5Yi26ZmQ44Gq44GX77yJCmNvbnN0IEdSQURFX09SREVSPVsiU1NTIiwiU1MiLCJTIiwiQSIsIkIiLCJDIl0sR1JBREVfQ09MT1I9e1NTUzoiI2I0MjMxOCIsU1M6IiNkOTJkMjAiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgZGF5TGFiZWw9ZD0+e2NvbnN0IHc9IuaXpeaciOeBq+awtOacqOmHkeWcnyJbbmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFVUQ0RheSgpXTtyZXR1cm4gYCR7ZC5zbGljZSg1KS5yZXBsYWNlKCItIiwiLyIpfSgke3d9KWB9Owpjb25zdCBjYWxjUmFjZXM9ZD0+KFdLLmNhbGNbZF0mJldLLmNhbGNbZF0ucmFjZXMpfHxbXTsKY29uc3QgYWxsUmFjZXM9KCk9PldLLmRhdGVzLmZsYXRNYXAoZD0+Y2FsY1JhY2VzKGQpKTsKY29uc3Qgbm9EYXRhPW1zZz0+YDxkaXYgY2xhc3M9InNtYWxsIj4ke21zZ3x8IuOAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgIIifTwvZGl2PmA7CgpmdW5jdGlvbiByZW5kZXJBbGwoKXtyZW5kZXJHYXRlKCk7cmVuZGVyQXhpcygpO3JlbmRlckV2KCk7cmVuZGVyVXBzZXQoKTtyZW5kZXJIb2xlKCk7cmVuZGVyUmFjZXMoKTtyZW5kZXJTdW0oKX0KCi8qIC0tLSDotoXpiYTmnb/vvIjopIfli53lnI/lhoXjga7norrnjofjgYzpq5jjgYTou7jppqzvvInvvJrln7rmupbvvIjnorrnjofjga7kuIvpmZDvvInjgpLpgbjjgbnjgosgLS0tICovCmNvbnN0IElST05fS0VZPSJrZWliYV9pcm9uX2N1dCI7Ci8qIOWfuua6luOBlOOBqOOBrumBjuWOu+OBruWun+e4vuihqO+8muWGjeagoeato+W+jOOBr+aknOiovOacn+mWk+OBruWun+e4vuOAgeOBquOBkeOCjOOBsOaomea6luODouODh+ODq+OBruaknOiovOe1kOaenO+8iOWMuuWIhuOCkuepjeOBv+S4iuOBku+8iSAqLwpmdW5jdGlvbiBpcm9uVGFibGUoKXsKIGNvbnN0IFBNeD1nZXRQbGFjZU1vZGVsKCk7CiBpZihQTXgmJlBNeC50aHImJlBNeC50ZXN0RGF5cyl7CiAgcmV0dXJue3NyYzpg5YaN5qCh5q2j5b6M44Gu5qSc6Ki85pyf6ZaT77yIJHtQTXgudGVzdERheXN96ZaL5YKs5pel77yJ44Gn44Gu5a6f57i+YCxyb3dzOlBNeC50aHIuZmlsdGVyKHQ9PnQudD49Ljg1JiZ0Lm4+MCkubWFwKHQ9Pih7Y3V0OnQudCxyYXRlOnQucmF0ZSxsbzp0LmxvLG46dC5uLHBlckRheTp0Lm4vUE14LnRlc3REYXlzfSkpLnNvcnQoKGEsYik9PmIuY3V0LWEuY3V0KX07CiB9CiBjb25zdCBCPVVFLkFYSVMuYmFuZHMscm93cz1bXTtsZXQgbj0wLGs9MCxwZD0wOwogZm9yKGNvbnN0IFtubSxjdXRdIG9mIFtbIumJhOadvyIsLjkyXSxbIua6lumJhOadvyIsLjg4XSxbIuWghei7uCIsLjg0XV0pe2NvbnN0IGI9QltubV07bis9Yi5uO2srPWIubipiLnJhdGU7cGQrPWIucGVyRGF5O2NvbnN0IHc9d2lsc29uKE1hdGgucm91bmQoayksbik7cm93cy5wdXNoKHtjdXQscmF0ZTprL24sbG86d1swXSxuLHBlckRheTpwZH0pfQogcmV0dXJue3NyYzoi5qiZ5rqW44Oi44OH44Or44Gu5qSc6Ki857WQ5p6c77yIMjAyNOW5tOS7pemZje+8iSIscm93czpyb3dzLnNvcnQoKGEsYik9PmIuY3V0LWEuY3V0KX07Cn0KY29uc3QgaXJvblN0YXQ9KHJvd3MscCk9PnJvd3MuZmluZCh4PT54LmN1dDw9cCsxZS05KXx8bnVsbDsKZnVuY3Rpb24gcmVuZGVyQXhpcygpewogY29uc3QgZWw9JCgidkF4aXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgdGI9aXJvblRhYmxlKCksY3V0cz10Yi5yb3dzLm1hcChyPT5yLmN1dCk7CiBsZXQgY3V0PSgkKCJpcm9uQ3V0IikmJk51bWJlcigkKCJpcm9uQ3V0IikudmFsdWUpKXx8MDsKIGlmKCFjdXQpe3RyeXtjdXQ9TnVtYmVyKGxvY2FsU3RvcmFnZS5nZXRJdGVtKElST05fS0VZKSl8fDB9Y2F0Y2goZSl7fX0KIGlmKCFjdXR8fCFjdXRzLmxlbmd0aCljdXQ9Y3V0cy5pbmNsdWRlcyguOTUpPy45NTooY3V0c1swXXx8LjkyKTsKIGN1dD1jdXRzLnJlZHVjZSgoYixjKT0+TWF0aC5hYnMoYy1jdXQpPE1hdGguYWJzKGItY3V0KT9jOmIsY3V0c1swXXx8Y3V0KTsgICAvLyDooajjgavjgYLjgovln7rmupbjga7jgYbjgaHjgIHjgYTjgaHjgbDjgpPov5HjgYTjgoLjga4KIHRyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShJUk9OX0tFWSxTdHJpbmcoY3V0KSl9Y2F0Y2goZSl7fQogY29uc3QgY3VyPWlyb25TdGF0KHRiLnJvd3MsY3V0KTsKIGxldCBoPWA8aDI+6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaF44Gu56K6546H44GM6auY44GE6Lu46aas77yJPC9oMj4ke3N0cmF0Q2hpcCgiYXhpcyIpfSR7cGxhY2VTdGF0dXNMaW5lKCl9CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuWfuua6lu+8muikh+WLneWcj+WGheOBrueiuueOh+OBjCA8c2VsZWN0IGlkPSJpcm9uQ3V0Ij4ke2N1dHMubWFwKGM9PmA8b3B0aW9uIHZhbHVlPSIke2N9Ij4ke3BjdChjLDApfeS7peS4ijwvb3B0aW9uPmApLmpvaW4oIiIpfTwvc2VsZWN0PiDjga7ppqzjgpLjgIHpoK3mlbDjga7liLbpmZDjgarjgZfjgaflh7rjgZfjgb7jgZk8L2Rpdj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ846aCt5Lul5LiK44Gu44Os44O844K544Gg44GR5Yik5a6a44GX44G+44GZ77yIN+mgreS7peS4i+OBr+ikh+WLneOBjDLnnYDjgb7jgafjga7jgZ/jgoHlr77osaHlpJbvvInjgII8Yj7ln7rmupbjgpLkuIvjgZLjgovjgajpoK3mlbDjga/lopfjgYjjgb7jgZnjgYzjgIHlrp/pmpvjga7nmoTkuK3njofjga/kuIvjgYzjgorjgb7jgZk8L2I+77yIJHtlc2ModGIuc3JjKX3vvInjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ln7rmupY8L3RoPjx0aD7lrp/pmpvjga7nmoTkuK3njoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjx0aD4x5pel44GC44Gf44KKPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7dGIucm93cy5tYXAocj0+YDx0ciR7ci5jdXQ9PT1jdXQ/JyBzdHlsZT0iZm9udC13ZWlnaHQ6NzAwIic6IiJ9Pjx0ZD4ke3BjdChyLmN1dCwwKX3ku6XkuIo8L3RkPjx0ZD4ke3BjdChyLnJhdGUsMSl9PC90ZD48dGQ+JHtwY3Qoci5sbywxKX3jgJw8L3RkPjx0ZD4ke3IucGVyRGF5LnRvRml4ZWQoMil96aCtPC90ZD48L3RyPmApLmpvaW4oIiIpfTwvdGJvZHk+PC90YWJsZT48L2Rpdj5gOwogaWYoY3VyKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+6YG45oqe5Lit77yIJHtwY3QoY3V0LDApfeS7peS4iu+8ie+8mumBjuWOu+OBq+Wun+mam+OBqzxiPiR7cGN0KGN1ci5yYXRlLDEpfTwvYj7jgYwz552A5Lul5YaF44CBMeaXpeOBguOBn+OCiue0hDxiPiR7Y3VyLnBlckRheS50b0ZpeGVkKDIpfemgrTwvYj7jgIIke2N1ci5yYXRlPC45NT8nPHNwYW4gY2xhc3M9Indhcm4iPjk1JeOBq+OBr+WxiuOBjeOBvuOBm+OCk+OAgjwvc3Bhbj4nOiIifTwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxwaWNrcz1bXSxyZWY9W107CiAgZm9yKGNvbnN0IHIgb2YgcnMpaWYoci5oYXNPZGRzJiZyLm4+PTgpZm9yKGNvbnN0IGhoIG9mIHIuaG9yc2VzKXsgICAvLyA36aCt5Lul5LiL44Gv6KSH5Yud44GMMuedgOOBvuOBp+OBruOBn+OCgeOAgTPnnYDlhoXjga7norrnjofjgafjga/liKTlrprjgZfjgarjgYQKICAgaWYoaGgucD49Y3V0KXBpY2tzLnB1c2goe3IsaGgsc3Q6aXJvblN0YXQodGIucm93cyxoaC5wKX0pOwogICBlbHNlIGlmKGhoLnA+PShjdXRzW2N1dHMubGVuZ3RoLTFdfHwuODQpKXJlZi5wdXNoKHtyLGhoLHN0Omlyb25TdGF0KHRiLnJvd3MsaGgucCl9KTsKICB9CiAgcGlja3Muc29ydCgoYSxiKT0+Yi5oaC5wLWEuaGgucCk7cmVmLnNvcnQoKGEsYik9PmIuaGgucC1hLmhoLnApOwogIGNvbnN0IG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aDsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl944CAPHNwYW4gY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj5blvpcgJHtuT2Rkc30vJHtycy5sZW5ndGh944Os44O844K5PC9zcGFuPjwvaDM+YDsKICBpZighbk9kZHMpe2grPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeWIpOWumuOBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgjwvZGl2Pic7Y29udGludWV9CiAgY29uc3QgY2FyZD0oeix0YWcpPT5gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5yLmxhYmVsKX08L2I+44CAPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh6LnIuY291cnNlKX3jg7ske3ouci5ufemgrTwvc3Bhbj48YnI+PGI+JHt6LmhoLm5vfeeVqiAke2VzYyh6LmhoLm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHJBIj4ke3RhZ308L3NwYW4+44CA6KSH5Yud5ZyP5YaF44Gu56K6546HICR7cGN0KHouaGgucCwxKX08YnI+CiAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+6aiO5omL77yaJHtlc2Moei5oaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKHouaGgudHJhaW5lcnx8IuS4jeaYjiIpfe+8j+WNmOWLnSAke3ouaGgud2luP3ouaGgud2luKyLlgI0iOiItIn3vvI/opIfli50gJHt6LmhoLmxvP3ouaGgubG8udG9GaXhlZCgxKSsoei5oaC5oaT56LmhoLmxvPyLjgJwiK3ouaGguaGkudG9GaXhlZCgxKToiIikrIuWAjSIrKHouaGguc3JjPT09IuaOqOWumiI/IijmjqjlrpopIjoiIik6Ii0ife+8j+OBk+OBrueiuueOh+W4r+OBrumBjuWOu+Wun+e4viAke3ouc3Q/cGN0KHouc3QucmF0ZSwxKToi6ZuG6KiI5aSWIn08L3NwYW4+PC9kaXY+YDsKICBpZihwaWNrcy5sZW5ndGgpaCs9cGlja3MubWFwKHo9PmNhcmQoeix6LmhoLnA+PS45NT8i6LaF6YmE5p2/Ijoi6Lu45YCZ6KOcIikpLmpvaW4oIiIpOwogIGVsc2UgaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+5Z+65rqW77yIJHtwY3QoY3V0LDApfeS7peS4iu+8ieOBq+ipsuW9k+OBmeOCi+mmrOOBr+OBhOOBvuOBm+OCk+OAgueEoeeQhuOBq+iyt+OCj+OBquOBhOOBruOCguS4gOOBpOOBruWIpOaWreOBp+OBmeOAgjwvZGl2PmA7CiAgaWYoIXBpY2tzLmxlbmd0aCYmcmVmLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWPguiAg++8iOWfuua6luOBq+OBr+WxiuOBi+OBquOBhOOAgeOBneOBruaXpeOBruacgOacieWKm++8ie+8mjwvZGl2PmArcmVmLnNsaWNlKDAsMikubWFwKHo9PmNhcmQoeiwi5Y+C6ICDIikpLmpvaW4oIiIpOwogfQogZWwuaW5uZXJIVE1MPWg7CiBjb25zdCBzZWw9JCgiaXJvbkN1dCIpO3NlbC52YWx1ZT1TdHJpbmcoY3V0KTtzZWwub25jaGFuZ2U9cmVuZGVyQXhpczsKfQoKLyogLS0tIOacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckV2KCl7CiBjb25zdCBlbD0kKCJ2RXYiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZXZNaW49TnVtYmVyKCQoImV2TWluIik/JCgiZXZNaW4iKS52YWx1ZToxLjA1KSxwTWluPU51bWJlcigkKCJldlAiKT8kKCJldlAiKS52YWx1ZTouMjUpOwogY29uc3Qgcm93cz1bXTsKIGZvcihjb25zdCByIG9mIGFsbFJhY2VzKCkpaWYoIXIuc2tpcCYmci5uPj04KWZvcihjb25zdCBoIG9mIHIuaG9yc2VzKWlmKGguZXYhPW51bGwmJmguZXY+PWV2TWluJiZoLnA+PXBNaW4pcm93cy5wdXNoKHtyLGh9KTsgICAvLyA36aCt5Lul5LiL44Gv6KSH5Yud44GMMuedgOOBvuOBp+OBruOBn+OCgeWvvuixoeWklgogcm93cy5zb3J0KChhLGIpPT5iLmguZXYtYS5oLmV2KTsKIGNvbnN0IG5PZGRzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoOwogbGV0IGg9YDxoMj7mnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJPC9oMj4ke3N0cmF0Q2hpcCgidmFsdWUiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7mnJ/lvoXlgKTvvJ3jgZ3jga7ppqzjgYwz552A5Lul5YaF44Gr5YWl44KL56K6546HIMOXIOikh+WLneOCquODg+OCuuOBruS4i+mZkOOAgjEuMOOCkui2heOBiOOCjOOBsOOAgeeQhuirluS4iuOBr+iyt+OBhOe2muOBkeOBpuODl+ODqeOCueOBp+OBmeOAguikh+WLneOBjDLnnYDjgb7jgafjga436aCt5Lul5LiL44Gu44Os44O844K544Gv44CB5a++6LGh5aSW44Gn44GZ44CC6KSH5Yud44Kq44OD44K644GvPGI+5a6fPC9iPu+8nUpSQeOBruWun+OCquODg+OCuuOAgTxiPuaOqOWumjwvYj7vvJ3ljZjli53jgYvjgonoqIjnrpfjgZfjgZ/nm67lronjgILnorrnjofjga7opovnqY3jgoLjgorpgZXjgYTjgYzlpKfjgY3jgY/lirnjgY/jgZ/jgoHjgIHjgIzmpJzoqLzjgI3jgacxMDAl6LaF44GM56K66KqN44GV44KM44KL44G+44Gn44Gv55uu5a6J44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuacn+W+heWApCA8c2VsZWN0IGlkPSJldk1pbiI+PG9wdGlvbiB2YWx1ZT0iMSI+MS4wMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMDUiPjEuMDXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjEiPjEuMTDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjIiPjEuMjDku6XkuIo8L29wdGlvbj48L3NlbGVjdD4g6KSH5Yud56K6546HIDxzZWxlY3QgaWQ9ImV2UCI+PG9wdGlvbiB2YWx1ZT0iMC4xNSI+MTUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC4yNSI+MjUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC40Ij40MCXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjYiPjYwJeS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBpZighbk9kZHMpe2VsLmlubmVySFRNTD1oKyc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeOAgeacn+W+heWApOOBr+ioiOeul+OBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8ieOAgjwvZGl2Pic7YmluZEV2KGV2TWluLHBNaW4pO3JldHVybn0KIGlmKCFyb3dzLmxlbmd0aCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnaHku7bjgavlkIjjgYbppqzjga/jgYTjgb7jgZvjgpPjgII8L2Rpdj4nOwogZWxzZXsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrDwvdGg+PHRoPueiuueOhzwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPuacn+W+heWApDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCB7cixoOnh9IG9mIHJvd3Muc2xpY2UoMCw0MCkpaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoci5kKSl9ICR7ZXNjKHIubGFiZWwpfTxicj48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHguam5hbWV8fCIiKX08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3gubG8udG9GaXhlZCgxKX0ke3guaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfTwvc3Bhbj48L3RkPjx0ZD48Yj4ke3guZXYudG9GaXhlZCgyKX08L2I+PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7YmluZEV2KGV2TWluLHBNaW4pOwp9CmZ1bmN0aW9uIGJpbmRFdihhLGIpe2NvbnN0IGU9JCgiZXZNaW4iKSxwPSQoImV2UCIpO2lmKCFlKXJldHVybjtlLnZhbHVlPVN0cmluZyhhKTtwLnZhbHVlPVN0cmluZyhiKTtlLm9uY2hhbmdlPXAub25jaGFuZ2U9cmVuZGVyRXZ9CgovKiAtLS0g5rOi5Lmx5bqmIC0tLSAqLwovKiDmpJzoqLzmuIjjgb/jga7jg6Ljg4fjg6vjgYzjgYLjgozjgbDjgIHjgZ3jga7nrYnntJrjgafpgY7ljrvjgavlrp/pmpvjgavlh7rjgZ/miZXmiLvvvIjljZjli53jga7kuK3lpK7lgKTjgIExMDAw5YaG5Lul5LiK44Gu5Ymy5ZCI77yJ44KS6KGo56S6ICovCmNvbnN0IHBheUNlbGw9Zz0+e2NvbnN0IE09Z2V0VXBzZXRNb2RlbCgpLHg9TSYmTS5wYXlUYWImJk0ucGF5VGFiW2ddO2lmKCF4fHwheC5ucHx8eC5tZWRXaW49PW51bGwpcmV0dXJuIi0iO3JldHVybmDljZjli53jga7kuK3lpK7lgKQgJHtNYXRoLnJvdW5kKHgubWVkV2luKS50b0xvY2FsZVN0cmluZygpfeWGhjxicj4xMDAw5YaG5Lul5LiKICR7cGN0KHguc2hhcmUxMDAwLDApfWB9OwpmdW5jdGlvbiByZW5kZXJVcHNldCgpewogY29uc3QgZWw9JCgidlVwc2V0Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPWA8aDI+44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+PGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkeOBl+OBpuOBhOOBvuOBme+8iOWFqOODrOODvOOCueW5s+WdhyDntIQyOC41Je+8ieOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+OAgeOCquODg+OCuui+vOOBv+OBruWIpOWumuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PiR7dXBzZXRTdGF0dXNMaW5lKCl9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkuZmlsdGVyKHI9PiFyLnNraXApLGNudD17fTtHUkFERV9PUkRFUi5mb3JFYWNoKGc9PmNudFtnXT0wKTtycy5mb3JFYWNoKHI9PmNudFtyLnVnLmdyYWRlXSsrKTsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz48ZGl2IGNsYXNzPSJyb3ciPiR7R1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIil9PC9kaXY+YDsKICBjb25zdCBzb3J0ZWQ9cnMuc2xpY2UoKS5zb3J0KChhLGIpPT5HUkFERV9PUkRFUi5pbmRleE9mKGEudWcuZ3JhZGUpLUdSQURFX09SREVSLmluZGV4T2YoYi51Zy5ncmFkZSl8fGIudWcucC1hLnVnLnApOwogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Os44O844K5PC90aD48dGg+562J57SaPC90aD48dGg+5LqI5risPC90aD48dGg+5a6f57i+44Gu5rOi5Lmx546HPC90aD48dGg+6YGO5Y6744Gu5omV5oi777yI562J57Sa5Yil77yJPC90aD48dGg+5Yik5a6aPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHIgb2Ygc29ydGVkKWgrPWA8dHI+PHRkPiR7ZXNjKHIubGFiZWwpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+JHtyLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoP2AgPHNwYW4gY2xhc3M9ImNoaXAgbyI+6Zmk5aSW5o6o5a6aICR7ci5zY3JhdGNoZWQuam9pbigiLCIpfeeVqjwvc3Bhbj5gOiIifTwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltyLnVnLmdyYWRlXX0iPiR7ci51Zy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtwY3Qoci51Zy5wKX08L3RkPjx0ZD4ke3IudWcuY3VzdG9tJiZyLnVnLnJhdGUhPW51bGw/YCR7cGN0KHIudWcucmF0ZSl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtwY3Qoci51Zy5sbyl944CcJHtwY3Qoci51Zy5oaSl944O7JHtyLnVnLm595Lu2PC9zcGFuPmA6TWF0aC5yb3VuZChyLnVnLnJhdGUqMTAwKSsiJSJ9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3BheUNlbGwoci51Zy5ncmFkZSl9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3IudWcubW9kZT09PSJvZGRzIj8i44Kq44OD44K66L6844G/Ijoi5o6o5a6aIn08L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOeptOmmrO+8iOWlvei1sOeOh+OBrumrmOOBhOeptOmmrOWAmeijnO+8iSAtLS0gKi8KLyog56m06aas44Gu5YCZ6KOc77ya5YaN5qCh5q2j5riI44G/77yI44Kq44OD44K65Y+W5b6X5b6M77yJ44Gq44KJ5paw44GX44GE56K6546H44Gn44CB44Gd44GG44Gn44Gq44GR44KM44Gw5b6T5p2l44Gu6KmV5L6h44Gn6YG444G2ICovCmZ1bmN0aW9uIHBpY2tIb2xlKHIsaG0pewogaWYoci5ob2xlTmV3KXsKICBjb25zdCBMPXIuaG9yc2VzLmZpbHRlcihoPT5oLmhvbGUmJmgubj49MyYmKGgud2luPT1udWxsfHxoLndpbjwzMCkpLnNvcnQoKGEsYik9PmIucC1hLnApOwogIGNvbnN0IHBrPWg9Pih7aTpoLmksbm86aC5ubyxuYW1lOmgubmFtZSxwYzpoLnAsb2RkOmgud2luLHBvcDpoLnBvcCx0YWdzOmgudGFnc3x8W119KTsKICBpZihobT09PSJTIilyZXR1cm4gTC5maWx0ZXIoaD0+aC5yYXRpbmc9PT0iUyIpLnNsaWNlKDAsMykubWFwKHBrKTsKICBpZihobT09PSJTQSIpcmV0dXJuIEwuZmlsdGVyKGg9PmgucmF0aW5nPT09IlMifHxoLnJhdGluZz09PSJBIikuc2xpY2UoMCwyKS5tYXAocGspOwogIHJldHVybiByLmhvcnNlcy5maWx0ZXIoaD0+aC5ob2xlJiZoLm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsMikubWFwKHBrKTsKIH0KIHJldHVybiBobT09PSJTIj9VRS5waWNrRm9jdXMoci5yZXMsNikuZmlsdGVyKHg9PnIuaG9yc2VzW3guaV0ucmF0aW5nPT09IlMiKS5zbGljZSgwLDMpOmhtPT09IlNBIj9VRS5waWNrRm9jdXMoci5yZXMsMik6VUUucGljayhyLnJlcywyKTsKfQpmdW5jdGlvbiBob2xlUmF0aW5nVGV4dCgpewogY29uc3QgUE09Z2V0UGxhY2VNb2RlbCgpOwogaWYoUE0mJlBNLmhvbGVDdXRzJiZQTS5ob2xlU3RhdHMpe2NvbnN0IHQ9UE0uaG9sZVN0YXRzLnRhYixjPVBNLmhvbGVDdXRzO3JldHVybmDoqZXkvqHjga88Yj7lho3moKHmraPlvozjga7opIfli53norrnjoc8L2I+44Gn5rG644KB44Gm44GE44G+44GZ77yaU++8neS6iOa4rCR7cGN0KGMuUywxKX3ku6XkuIrvvIjmpJzoqLzmnJ/plpPjga7lrp/pmpvjga7nmoTkuK3njocgJHtwY3QodC5TLnJhdGUsMSl977yJ44CBQe+8nSR7cGN0KGMuQSwxKX3ku6XkuIrvvIgke3BjdCh0LkEucmF0ZSwxKX3vvInjgIFC77ydJHtwY3QoYy5CLDEpfeS7peS4iu+8iCR7cGN0KHQuQi5yYXRlLDEpfe+8ieOAgeOBneOCjOS7peWklu+8nUPvvIgke3BjdCh0LkMucmF0ZSwxKX3vvInjgILjgIxT44O7QeOAjeihqOekuuOBr+OAgei1sOaVsDPku6XkuIrjgafljZjli50zMOWAjeacqua6gOOBrummrOOBoOOBkeOBp+OBmeOAgmB9CiByZXR1cm5g6KmV5L6h44Gv44CB56m06aas44Gu5bmz5Z2H55qE44Gq5aW96LWw546H77yI44Kq44OD44K66L6844G/OS4xJe+8j+aOqOWumjExLjUl77yJ44Gr5a++44GZ44KL5YCN546H44Gn5rG644G+44KK44G+44GZ77yaU++8nTIuMuWAjeS7peS4iu+8iOe0hDIwJeS7peS4iu+8j+aOqOWumuOBr+e0hDI1JeS7peS4iu+8ieOAgUHvvJ0xLjflgI3ku6XkuIrvvIjntIQxNS41JeS7peS4iu+8j+e0hDE5LjYl5Lul5LiK77yJ44CBQu+8nTEuM+WAjeS7peS4iuOAgUPvvJ3jgZ3jgozmnKrmuoDjgILotbDmlbDjgYzlsJHjgarjgYTppqzjga5T44O7QeOBr+OAgULjgavkuIvjgZLjgb7jgZnjgILjgIxT44O7QeOAjeihqOekuuOBr+OAgei1sOaVsDPku6XkuIrjgafljZjli50zMOWAjeacqua6gOOBrummrOOBoOOBkeOBp+OBmeOAgmA7Cn0KZnVuY3Rpb24gcmVuZGVySG9sZSgpewogY29uc3QgZWw9JCgidkhvbGUiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgSEs9ImtlaWJhX2hvbGVfbW9kZSI7bGV0IGhtPSgkKCJob2xlRm9jdXMiKSYmJCgiaG9sZUZvY3VzIikudmFsdWUpfHwoKCk9Pnt0cnl7cmV0dXJuIGxvY2FsU3RvcmFnZS5nZXRJdGVtKEhLKX1jYXRjaChlKXtyZXR1cm4gbnVsbH19KSgpfHwiU0EiO2lmKCFbIlMiLCJTQSIsImFsbCJdLmluY2x1ZGVzKGhtKSlobT0iU0EiOwogdHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKEhLLGhtKX1jYXRjaChlKXt9CiBsZXQgaD1gPGgyPueptOmmrOWAmeijnDwvaDI+JHtzdHJhdENoaXAoImZvY3VzIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+56m06aas77yd5Lq65rCX44Gu5LiL5L2N44Gu6aasPC9iPu+8iOmgreaVsOOBrue0hDblibLjgojjgorkuIvjgILkvovvvJoxNumgreeri+OBpuOBquOCiTfnlarkurrmsJfku6XkuIvjgIExMumgreeri+OBpuS7peS4i+OBquOCiTXnlarkurrmsJfku6XkuIvvvInjga7kuK3jgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM6auY44GE6aas44CC44CM5b2T44Gf44KK44KE44GZ44GV44CN44Gu55uu5a6J44Gn44CB5Zue5Y+O546H44Gv5Yil44Gn44GZ44CCJHtob2xlUmF0aW5nVGV4dCgpfTwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48c2VsZWN0IGlkPSJob2xlRm9jdXMiPjxvcHRpb24gdmFsdWU9IlMiPlPjgaDjgZHvvIjmnIDjgoLlpb3otbDnjofjgYzpq5jjgYTnqbTppqzvvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJTQSI+U+ODu0HvvIjil47nmoTkuK3njofph43oppbvvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJhbGwiPuOBmeOBueOBpu+8iOS4iuS9jTLpoK3vvIk8L29wdGlvbj48L3NlbGVjdD48L2Rpdj4KICR7aG09PT0iUyI/JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuOAjFPjgaDjgZHjgI3jga/ntZ7jgorovrzjgb/jga7ooajnpLrjgafjgZnjgILpgY7ljrvjga7mpJzoqLzvvIjmpJzoqLzjgr/jg5bvvInjga/jgIFT44O7QeOCkuOBvuOBqOOCgeOBn+aIkOe4vuOBp+mbhuioiOOBl+OBpuOBhOOCi+OBn+OCgeOAgVPjgaDjgZHjga7miJDnuL7jga/liKXjgavjga/norroqo3jgafjgY3jgabjgYTjgb7jgZvjgpPjgII8L2Rpdj4nOiIifWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApY29udGludWU7CiAgIGNvbnN0IGM9cGlja0hvbGUocixobSk7aWYoIWMubGVuZ3RoKWNvbnRpbnVlOwogICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moci5sYWJlbCl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK0ke3IuaGFzT2Rkcz8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77yJIn08L3NwYW4+YDsKICAgZm9yKGNvbnN0IHggb2YgYyl7Y29uc3QgaGg9ci5ob3JzZXNbeC5pXTsKICAgIGgrPWA8ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjZweCI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke2hoLnJhdGluZ30iPiR7aGgucmF0aW5nfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj7lpb3otbDnjocgJHtoaC5wU3JjP3BjdChoaC5wLDEpKyLvvIjlho3moKHmraPlvozjga7opIfli53norrnjofvvIkiOnBjdCh4LnBjLDEpfSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9PC9zcGFuPjxicj4KICAgICA8c3BhbiBjbGFzcz0ic21hbGwiPiR7aGguY2FyZWVyJiZoaC5jYXJlZXIubj9g6YCa566XJHtoaC5jYXJlZXIubn3otbAgM+edgOWGhSR7aGguY2FyZWVyLnQzfeWbnmA6IumAmueul++8muWxpeattOOBquOBlyJ9JHtoaC5yZWNlbnQmJmhoLnJlY2VudC5sZW5ndGg/YO+8j+ebtOi/kSAke2hoLnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGA6IiJ977yP6aiO5omL77yaJHtlc2MoaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyhoaC50cmFpbmVyfHwi5LiN5piOIil9JHtoaC50clJhdGUhPW51bGwmJmhoLnRyTj49MjA/YCgz552A5YaFJHtwY3QoaGgudHJSYXRlKX0pYDoiIn08L3NwYW4+PGJyPmArCiAgICAgKHgudGFnc3x8W10pLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfQogICBoKz0iPC9kaXY+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHM9JCgiaG9sZUZvY3VzIik7cy52YWx1ZT1obTtzLm9uY2hhbmdlPXJlbmRlckhvbGU7Cn0KCi8qIC0tLSDlhajjg6zjg7zjgrnvvIjppqzjgZTjgajjga7norrnjofjg7vjgqrjg4Pjgrrjg7vmnJ/lvoXlgKTjg7vpqI7miYvjg7voqr/mlZnluKvvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclJhY2VzKCl7CiBjb25zdCBlbD0kKCJ2UmFjZXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogbGV0IGg9IjxoMj7lhajjg6zjg7zjgrk8L2gyPiI7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApe2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtlc2Moci5sYWJlbCl977yaJHtlc2Moci5za2lwKX08L2Rpdj5gO2NvbnRpbnVlfQogICBjb25zdCBnPXIudWc7CiAgIGgrPWA8ZGV0YWlscz48c3VtbWFyeT4ke2VzYyhyLmxhYmVsKX0gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZy5ncmFkZV19Ij4ke2cuZ3JhZGV9PC9zcGFuPjwvc3VtbWFyeT48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6aas77yP6aiO5omL77yP6Kq/5pWZ5birPC90aD48dGg+5Y2Y5YudPC90aD48dGg+6KSH5YudPC90aD48dGg+56K6546HPC90aD48dGg+RVY8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IHggb2Ygci5ob3JzZXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnAtYS5wKSkKICAgIGgrPWA8dHI+PHRkPjxiPiR7eC5ub308L2I+ICR7ZXNjKHgubmFtZSl9JHt4LmhvbGUmJngucmF0aW5nIT09IkMiP2AgPHNwYW4gY2xhc3M9InJ0IHIke3gucmF0aW5nfSI+JHt4LnJhdGluZ308L3NwYW4+YDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guam5hbWU/ZXNjKHguam5hbWUpOic8c3BhbiBjbGFzcz0iYmFkIj7pqI7miYvkuI3mmI48L3NwYW4+J33vvIgke3guam4+PTU/IumBjuWOuyIreC5qbisi6aiO5LmXIjoi5bGl5q205bCRIn3vvInvvI8ke3gudHJhaW5lcj9lc2MoeC50cmFpbmVyKTonPHNwYW4gY2xhc3M9ImJhZCI+6Kq/5pWZ5bir5LiN5piOPC9zcGFuPid9JHt4LnRyUmF0ZSE9bnVsbCYmeC50ck4+PTIwPyLvvIgz552A5YaFIitwY3QoeC50clJhdGUpKyLvvIkiOiIifTwvc3Bhbj48L3RkPjx0ZD4ke3gud2luP3gud2luLnRvRml4ZWQoMSk6Ii0ifTwvdGQ+PHRkPiR7eC5sbz94LmxvLnRvRml4ZWQoMSkrKHguaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiIpOiItIn08c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5zcmN8fCIifTwvc3Bhbj48L3RkPjx0ZD4ke3BjdCh4LnApfTwvdGQ+PHRkPiR7eC5ldiE9bnVsbD9gPGIke3guZXY+PTEuMDU/JyBjbGFzcz0iZ29vZCInOiIifT4ke3guZXYudG9GaXhlZCgyKX08L2I+YDoiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+PC9kZXRhaWxzPiI7CiAgfQogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDlj5bjgorovrzjgb/nirbms4HvvIjpoK3mlbDjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgrPjg7zjgrnjg7vjgqrjg4Pjgrrjga7oqq3jgb/lj5bjgorntZDmnpzvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclN1bSgpewogY29uc3QgZWw9JCgidlN1bSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgmJiFXSy5kaWFnLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IHJzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PiFyLnNraXApOwogY29uc3QgaG9yc2VzPXJzLnJlZHVjZSgocyxyKT0+cytyLm4sMCksam1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC5qbmFtZSkubGVuZ3RoLDApLHRtaXNzPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+IWgudHJhaW5lcikubGVuZ3RoLDApOwogY29uc3Qgam1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5qbj49NSkubGVuZ3RoLDApLGhtYXRjaD1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9Pmgubj49MikubGVuZ3RoLDApOwogY29uc3Qgbm9Db3Vyc2U9cnMuZmlsdGVyKHI9PnIuY291cnNlPT09IuOCs+ODvOOCueS4jeaYjiIpLmxlbmd0aCxuT2Rkcz1ycy5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGgscFJlYWw9cnMuZmlsdGVyKHI9PnIucGxhY2VSZWFsPjApLmxlbmd0aDsKIGxldCBoPWA8aDI+5Y+W44KK6L6844G/54q25rOBPC9oMj48dGFibGU+PHRib2R5PgogPHRyPjx0ZD7op6PmnpDjgZfjgZ/jg6zjg7zjgrnvvI/lh7rotbDppqw8L3RkPjx0ZD4ke3JzLmxlbmd0aH3jg6zjg7zjgrnvvI8ke2hvcnNlc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPumojuaJi+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke2ptaXNzPyJiYWQiOiJnb29kIn0iPiR7am1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7oqr/mlZnluKvjgpLoqq3jgoHjgarjgYvjgaPjgZ/ppqw8L3RkPjx0ZCBjbGFzcz0iJHt0bWlzcz8iYmFkIjoiZ29vZCJ9Ij4ke3RtaXNzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kz44O844K544KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5PC90ZD48dGQgY2xhc3M9IiR7bm9Db3Vyc2U/ImJhZCI6Imdvb2QifSI+JHtub0NvdXJzZX08L3RkPjwvdHI+CiA8dHI+PHRkPuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBn+ODrOODvOOCuTwvdGQ+PHRkPiR7bk9kZHN977yPJHtycy5sZW5ndGh977yI6KSH5Yud44Gu5a6f44Kq44OD44K6ICR7cFJlYWx944Os44O844K577yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjppqzvvIk8L3RkPjx0ZD4ke2htYXRjaH3vvI8ke2hvcnNlc33poK3vvIgy6LWw5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjpqI7miYvvvIk8L3RkPjx0ZD4ke2ptYXRjaH3vvI8ke2hvcnNlc33poK3vvIg16aiO5LmX5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7lrabnv5Ljg4fjg7zjgr/jga7mnIDntYLml6U8L3RkPjx0ZD4ke2VzYyhXSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5sYXN0fHwiLSIpfTwvdGQ+PC90cj4KIDx0cj48dGQ+6YeN6KSH44KS6Zmk5aSW44GX44Gf44Os44O844K577yIQ1NW44Go5Y+W5b6X44OH44O844K/77yJPC90ZD48dGQ+JHsoV0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8uZHVwcyl8fDB9PC90ZD48L3RyPjwvdGJvZHk+PC90YWJsZT5gOwoge2NvbnN0IGNzPVdLLmRhdGVzLmZsYXRNYXAoZD0+V0suY2FyZHNbZF18fFtdKSxnaz1jcy5maWx0ZXIoYz0+Z29pbmdDb2RlKGMuZ29pbmcpPjApLmxlbmd0aCxocz1jcy5mbGF0TWFwKGM9PmMuaG9yc2VzfHxbXSksc2s9aHMuZmlsdGVyKHg9Pnguc2lyZXx8eC5kYW1TaXJlKS5sZW5ndGg7CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7ppqzloLTnirbmhYvvvJoke2drfS8ke2NzLmxlbmd0aH3jg6zjg7zjgrnjgafnmbrooajmuIjjgb8ke2drPyIiOiLvvIjlvZPml6Xjga7mnJ3jgavnmbrooajjgZXjgozjgb7jgZnjgILmnKrnmbrooajjga7jgajjgY3jga/jgIHppqzloLTjga7nm7jmgKfjga/kvb/jgYTjgb7jgZvjgpPvvIkife+8j+ihgOe1seOCkuiqreOCgeOBn+mmrO+8miR7c2t9LyR7aHMubGVuZ3Rofemgre+8iOiThOepjeOBl+OBn+ihgOe1sSAke09iamVjdC5rZXlzKFBFRCkubGVuZ3Rofemgre+8iSR7aHMubGVuZ3RoJiYhc2s/IuOAguWHuummrOihqOOBi+OCieihgOe1seOCkuiqreOCgeOBpuOBhOOBvuOBm+OCk++8iOioreWumuOBruOAjOiouuaWreaDheWgseOCkuS9nOOCi+OAjeOBruWHuuWKm+OBp+OAgeWun+mam+OBruODmuODvOOCuOOBruW9ouOCkueiuuiqjeOBp+OBjeOBvuOBme+8iSI6IiJ9PC9kaXY+YH0KIGNvbnN0IHNjcj1ycy5maWx0ZXIocj0+ci5zY3JhdGNoZWQmJnIuc2NyYXRjaGVkLmxlbmd0aCksam1wPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuc2tpcCYmL+manOWusy8udGVzdChyLnNraXApKTsKIGlmKHNjci5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644Gu54Sh44GE6aas44KS5Y+W5raI44O76Zmk5aSW44Go44G/44Gq44GX44Gm5aSW44GX44Gf44Os44O844K577yaJHtzY3IubWFwKHI9PmVzYyhyLmxhYmVsKSsi77yIIityLnNjcmF0Y2hlZC5qb2luKCIsIikrIueVqu+8iSIpLmpvaW4oIu+8jyIpfeOAguWun+mam+OBq+WHuui1sOOBmeOCi+mmrOOBquOCieOAgeOCquODg+OCuuOBruWPluW+l+a8j+OCjOOBp+OBmeOAgjwvZGl2PmA7CiBpZihqbXAubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+6Zqc5a6z44Os44O844K5ICR7am1wLmxlbmd0aH3ku7bjga/jgIHlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHop6PmnpDjga7lr77osaHlpJbjgavjgZfjgabjgYTjgb7jgZnjgII8L2Rpdj5gOwogY29uc3QgZ2FwPVdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3QmJldLLmRhdGVzWzBdP01hdGgucm91bmQoKG5ldyBEYXRlKFdLLmRhdGVzWzBdKS1uZXcgRGF0ZShXSy5zdG9yZUluZm8ubGFzdCkpLzg2NGU1KTpudWxsOwogaWYoZ2FwIT1udWxsJiZnYXA+MTApaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBi+OCieOAgeOCguOBhuS4gOW6puS6iOaDs+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiBpZihycy5sZW5ndGgmJmhtYXRjaDxob3JzZXMqLjQpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+6YGO5Y6744OH44O844K/44Go54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44KB44Gn44GZ44CC6Iul6aeS5oim5Lit5b+D44Gu5pel44Gv5q2j5bi444Gn44GZ44GM44CB44Gd44GG44Gn44Gq44GR44KM44Gw6aas5ZCN44Gu6KGo6KiY44GM5ZCI44Gj44Gm44GE44Gq44GE5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CCPC9kaXY+JzsKIGNvbnN0IG9uPVdLLm9kZHNOb3Rlc3x8e307CiBpZihPYmplY3Qua2V5cyhvbikubGVuZ3RoKXtoKz1gPGgzPuOCquODg+OCuuWPluW+l+OBruWGheioszwvaDM+PGRpdiBjbGFzcz0ic3RhdHVzIj4ke1dLLmRhdGVzLm1hcChkPT5gJHtkYXlMYWJlbChkKX1cbiR7KG9uW2RdfHxbXSkubWFwKGVzYykuam9pbigiXG4iKX1gKS5qb2luKCJcblxuIil9PC9kaXY+YH0KIGgrPWA8aDM+6ZaL5YKs5aC044GU44GoPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6ZaL5YKs5aC0PC90aD48dGg+44Os44O844K5PC90aD48dGg+54q25oWLPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiBXSy5kaWFnKXsKICBjb25zdCBwcm9icz1bXTtpZih4LmVycilwcm9icy5wdXNoKHguZXJyKTtpZih4LmJhZClwcm9icy5wdXNoKGDlh7rotbDppqzjgpLoqq3jgoHjgarjgYTjg6zjg7zjgrkgJHt4LmJhZH1gKTtwcm9icy5wdXNoKC4uLih4Lmlzc3Vlc3x8W10pKTsKICBoKz1gPHRyPjx0ZD4ke2VzYyhkYXlMYWJlbCh4LmQpKX0gJHtlc2MoeC5uYW1lKX08L3RkPjx0ZD4ke3gub2t9LyR7eC5yYWNlc308L3RkPjx0ZCBzdHlsZT0idGV4dC1hbGlnbjpsZWZ0Ij4ke3Byb2JzLmxlbmd0aD9gPHNwYW4gY2xhc3M9ImJhZCBzbWFsbCI+JHtwcm9icy5tYXAoZXNjKS5qb2luKCI8YnI+Iil9PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJnb29kIj7llY/poYzjgarjgZc8L3NwYW4+J30ke3guY29kZT9gIDxidXR0b24gY2xhc3M9Im1pbmkgc3ViIiBkYXRhLXJsPSIke2VzYyh4LmQpfXwke2VzYyh4LmNvZGUpfXwke2VzYyh4Lm5hbWUpfSI+5YaN5Y+W5b6XPC9idXR0b24+YDoiIn08L3RkPjwvdHI+YDsKIH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGVsLmlubmVySFRNTD1oOwogZWwucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmxdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9YXN5bmMoKT0+ewogIGNvbnN0IFtkLGNvZGUsbmFtZV09Yi5kYXRhc2V0LnJsLnNwbGl0KCJ8Iik7Yi5kaXNhYmxlZD10cnVlO3drTXNnKGAke2R9ICR7bmFtZX0g44KS5YaN5Y+W5b6X5Lit4oCmYCk7CiAgdHJ5e2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZVVybCgpLGQse3ZlbnVlQ29kZTpjb2RlLHZlbnVlTmFtZTpuYW1lfSk7YXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCk7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKTt3a01zZygi5YaN5Y+W5b6X44GX44G+44GX44GfIil9CiAgY2F0Y2goZSl7d2tNc2coIuWGjeWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KIH0pOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5pON5L2cCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gc2hvd1RhYih0KXtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudmlldyIpLmZvckVhY2godj0+di5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsdi5pZD09PXQpKTtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjdGFicyBidXR0b24iKS5mb3JFYWNoKGI9PmIuY2xhc3NMaXN0LnRvZ2dsZSgib24iLGIuZGF0YXNldC50YWI9PT10KSl9CmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5zaG93VGFiKGIuZGF0YXNldC50YWIpKTsKJCgidXBSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKICQoInVwUnVuIikuZGlzYWJsZWQ9dHJ1ZTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmpJzoqLzkuK3igKbvvIjmlbDliIbjgYvjgYvjgorjgb7jgZnvvIkiOwogdHJ5ewogIGNvbnN0IHI9YXdhaXQgcnVuVXBzZXRGaXQoe3N0YXJ0OiQoInVwU3RhcnQiKS52YWx1ZXx8IjIwMjEtMDEtMDEifSk7CiAgJCgidXBPdXQiKS5pbm5lckhUTUw9dXBzZXRSZXBvcnQocik7CiAgaWYoci5tb2RlbCl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oVVBLRVksSlNPTi5zdHJpbmdpZnkoci5tb2RlbCkpO21vZGVsc1RvTWV0YSgpO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgidXBPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJiYWQiPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5eyQoInVwUnVuIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CiQoInVwQ2xlYXIiKS5vbmNsaWNrPWFzeW5jKCk9Pntsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShVUEtFWSk7bW9kZWxzVG9NZXRhKCk7JCgidXBPdXQiKS50ZXh0Q29udGVudD0i5qiZ5rqW44Oi44OH44Or44Gr5oi744GX44G+44GX44Gf44CCIjtpZihXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9fTsKJCgicGxSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKICQoInBsUnVuIikuZGlzYWJsZWQ9dHJ1ZTskKCJwbE91dCIpLnRleHRDb250ZW50PSLmpJzoqLzkuK3igKbvvIjmlbDliIbjgYvjgYvjgorjgb7jgZnvvIkiOwogdHJ5ewogIGNvbnN0IHI9YXdhaXQgcnVuUGxhY2VGaXQoe3N0YXJ0OiQoInBsU3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEifSk7CiAgJCgicGxPdXQiKS5pbm5lckhUTUw9cGxhY2VSZXBvcnQocik7CiAgaWYoci5tb2RlbClsb2NhbFN0b3JhZ2Uuc2V0SXRlbShQTEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7ZWxzZSBpZighci5lcnJvcilsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShQTEtFWSk7CiAgbW9kZWxzVG9NZXRhKCk7CiAgaWYoIXIuZXJyb3ImJldLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJwbE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgicGxSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgicGxDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFBMS0VZKTttb2RlbHNUb01ldGEoKTskKCJwbE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJ3a0dvIikub25jbGljaz13ZWVrZW5kR287CiQoImFsbEdvIikub25jbGljaz1hbGxJbk9uZTsKJCgiYWxsRml0Iikub25jbGljaz1hbGxGaXQ7CiQoIndrT2RkcyIpLm9uY2xpY2s9b2Rkc09ubHk7CiQoImJrT25lIikub25jbGljaz1hc3luYygpPT57CiBpZihCSy5idXN5KXJldHVybjsKIGlmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXsKICBjb25zdCBwPXByb21wdCgi44OQ44OD44Kv44Ki44OD44OX55So44Gu44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8ieOCkuaxuuOCgeOBpuWFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAguW+qeWFg+OBruOBqOOBjeOBq+OCguWQjOOBmOOCguOBruOBjOW/heimgeOBp+OBmeOAgiIpOwogIGlmKCFwKXJldHVybjtCSy5wYXNzPXAudHJpbSgpO0JLLmlkPSIiO2JrU2F2ZVNldHRpbmdzKCk7JCgiYmtQYXNzIikudmFsdWU9QksucGFzczsKICBpZihCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644GvOOaWh+Wtl+S7peS4iuOBq+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJufQogfQogYXdhaXQgcnVuQmFja3VwKGZhbHNlKTsKfTsKJCgiZGJnR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IG91dD0kKCJkYmdPdXQiKSxiYXNlPWJhc2VVcmwoKTsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpe291dC52YWx1ZT0i5YWI44Gr44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiI7cmV0dXJufQogb3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOyQoImRiZ0dvIikuZGlzYWJsZWQ9dHJ1ZTtjb25zdCBsaW5lcz1bYOWPluW+l+aXpSAke1dLLmRhdGVzLmpvaW4oIiwiKX1gXTsKIHRyeXsKICBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgIGNvbnN0IGNvZGVzPVsuLi5uZXcgU2V0KChXSy5jYXJkc1tkXXx8W10pLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogICBmb3IoY29uc3QgdiBvZiBjb2Rlcyl7CiAgICBjb25zdCBycz1XSy5jYXJkc1tkXS5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dik7CiAgICBjb25zdCBxPXJzLm1hcChyPT5yLnF1YWxpdHkpLmZpbHRlcihCb29sZWFuKTsKICAgIGxpbmVzLnB1c2goYFxu4pagJHtkfSDplovlgqzloLQke3Z977yIJHtyc1swXT8udmVudWVOYW1lfHwiIn3vvInjg6zjg7zjgrkke3JzLmxlbmd0aH3vvI/jgrPjg7zjgrnkuI3mmI4ke3JzLmZpbHRlcihyPT4hKHIuc3VyZmFjZSYmci5kaXN0YW5jZSkpLmxlbmd0aH3vvI/pqI7miYvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LmpvY2tleUZpbGxlZCksMCl977yP6Kq/5pWZ5bir5qygJHtxLnJlZHVjZSgocyx4KT0+cysoeC5ob3JzZXMteC50cmFpbmVyRmlsbGVkKSwwKX1gKTsKICAgIGNvbnN0IGJhZD1ycy5maW5kKHI9PnIucXVhbGl0eSYmIXIucXVhbGl0eS5vayl8fHJzWzBdLHJuPShiYWQmJmJhZC5yYWNlTnVtYmVyKXx8MTtsaW5lcy5wdXNoKGDvvIjllY/poYzjga7jgYLjgovjg6zjg7zjgrkgJHtybn1SIOOCkuiqv+OBueOBvuOBme+8iWApO3RyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9kZWJ1Zy1lbnRyeT9kYXRlPSR7ZH0mdmVudWU9JHt2fSZyYWNlPSR7cm59YCxbMTUwMF0pO2RlbGV0ZSB4Lm9rO2xpbmVzLnB1c2goSlNPTi5zdHJpbmdpZnkoeCkpfWNhdGNoKGUpe2xpbmVzLnB1c2goIuiouuaWreOCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KICAgfQogIH0KIH1maW5hbGx5eyQoImRiZ0dvIikuZGlzYWJsZWQ9ZmFsc2V9CiBvdXQudmFsdWU9bGluZXMuam9pbigiXG4iKTsKfTsKJCgib2Rkc0RiZyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoIm9kZHNPdXQiKSxiYXNlPWJhc2VVcmwoKTsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpe291dC52YWx1ZT0i5YWI44Gr44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiI7cmV0dXJufQogb3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOyQoIm9kZHNEYmciKS5kaXNhYmxlZD10cnVlOwogY29uc3QgTD1bYOaZguWIuyAke25ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxNikucmVwbGFjZSgiVCIsIiAiKX3vvIjml6XmnKzmmYLplpPvvIlgXTsKIHRyeXsKICBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgIGNvbnN0IGNzPVdLLmNhcmRzW2RdfHxbXSx2cz1bLi4ubmV3IFNldChjcy5tYXAoYz0+U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICAgZm9yKGNvbnN0IHYgb2YgdnMpewogICAgY29uc3QgcnM9Y3MuZmlsdGVyKGM9PlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpOwogICAgY29uc3QgZ290PXJzLmZpbHRlcihjPT5XSy5vZGRzW3JrZXkoZCxjKV0pLm1hcChjPT5jLnJhY2VOdW1iZXIpLmpvaW4oIiwiKSxsaW5rPXJzLmZpbHRlcihjPT5jLm9kZHNDbmFtZSkubWFwKGM9PmMucmFjZU51bWJlcikuam9pbigiLCIpOwogICAgTC5wdXNoKGBcbuKWoCR7ZH0gJHtWRU5VRVt2XXx8dn3vvJrjg6zjg7zjgrkke3JzLmxlbmd0aH3vvI/lh7rppqzooajjgavjgqrjg4Pjgrrjgbjjga7jg6rjg7Pjgq/jgYLjgoogWyR7bGlua3x8IuOBquOBlyJ9Xe+8j+OCquODg+OCuuWPluW+l+a4iOOBvyBbJHtnb3R8fCLjgarjgZcifV1gKTsKICAgIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcy1saW5rcz9kYXRlPSR7ZH0mdmVudWU9JHt2fWAsWzE1MDBdKTsKICAgICBMLnB1c2goYCAg44Kq44OD44K655S76Z2i44Gu44Oh44OL44Ol44O844Gr44GC44KL44Os44O844K5IFskeyh4LmxpbmtzfHxbXSkubWFwKHk9PnkucmFjZU5vKS5qb2luKCIsIil8fCLjgarjgZcifV1gKTsKICAgICBmb3IoY29uc3QgZyBvZiAoeC5kaWFnfHxbXSkpTC5wdXNoKCIgICIrSlNPTi5zdHJpbmdpZnkoe3N0ZXA6Zy5zdGVwLGxlbjpnLmh0bWxMZW5ndGgsbjpnLmNuYW1lcyxraW5kczpnLmtpbmRzLG1lbnVzOmcubWVudXMscmFjZXM6Zy5yYWNlcyxlcnI6Zy5lcnJvcixzYW1wbGU6KGcuc2FtcGxlfHxbXSkuc2xpY2UoMCwzKX0pKTsKICAgIH1jYXRjaChlKXtMLnB1c2goIiAg44Oh44OL44Ol44O85Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgib2Rkc0RiZyIpLmRpc2FibGVkPWZhbHNlfQogb3V0LnZhbHVlPUwuam9pbigiXG4iKTsKfTsKJCgib2Rkc0NvcHkiKS5vbmNsaWNrPWFzeW5jKCk9Pntjb25zdCB0PSQoIm9kZHNPdXQiKS52YWx1ZTt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCk7JCgib2Rkc0NvcHkiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXskKCJvZGRzT3V0Iikuc2VsZWN0KCk7YWxlcnQoIumBuOaKnuOBl+OBvuOBl+OBn+OAguOCs+ODlOODvOOBl+OBpuOBj+OBoOOBleOBhOOAgiIpfX07CiQoImRiZ0NvcHkiKS5vbmNsaWNrPWFzeW5jKCk9Pntjb25zdCB0PSQoImRiZ091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJkYmdDb3B5IikudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7JCgiZGJnT3V0Iikuc2VsZWN0KCk7YWxlcnQoIumBuOaKnuOBl+OBvuOBl+OBn+OAguOCs+ODlOODvOOBl+OBpuOBj+OBoOOBleOBhOOAgiIpfX07CiQoImZpbGUiKS5vbmNoYW5nZT1lPT57Y29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZihmKWltcG9ydEZpbGUoZik7ZS50YXJnZXQudmFsdWU9IiJ9OwoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBl++8iOWPluW+l+a4iOOBv+OBruaXpeOCkuOAgeaWsOOBl+OBhOmgheebruOBpOOBjeOBp+WPluOCiuebtOOBme+8iQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmFzeW5jIGZ1bmN0aW9uIGxhcFJlZmV0Y2goZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe2lkYkFsbCxpZGJQdXQsbWV0YUdldCxtZXRhUHV0LGZldGNoRGF5fSxkZXBzfHx7fSk7CiBjb25zdCBiYXNlPWJhc2VVcmwoKSxhPSQoImxhcFN0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKSxtc2c9dD0+eyQoImxhcFN0YXR1cyIpLmlubmVySFRNTD10fTsKIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJsYXBHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxsYXBzOjAsY29ybmVyczowLGhvcnNlczowLGZhaWw6W10sc2tpcHBlZDowLHQwOkRhdGUubm93KCksbm9kYXRhOmZhbHNlLHN0b3BwZWQ6ZmFsc2V9O2xldCBjb25zZWM9MCx0b3RhbD0wOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBELmlkYkFsbCgpKS5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoJiZmLmRhdGU+PWEmJmYuZGF0ZTw9eWQpLnNvcnQoKHgseSk9PnguZGF0ZTx5LmRhdGU/LTE6MSk7CiAgY29uc3QgdG9kbz1bXTsKICBmb3IoY29uc3QgZiBvZiBmaWxlcyl7aWYoZi5yb3dzLnNvbWUocj0+QXJyYXkuaXNBcnJheShyLmxhcCkmJnIubGFwLmxlbmd0aCl8fGF3YWl0IEQubWV0YUdldCgibGFwZG9uZToiK2YuZGF0ZSkpe3N0LnNraXBwZWQrKztjb250aW51ZX10b2RvLnB1c2goZi5kYXRlKX0KICB0b3RhbD10b2RvLmxlbmd0aDsKICBpZighdG90YWwpe21zZyhg5Y+W44KK55u044GZ5pel44Gv44GC44KK44G+44Gb44KT77yIJHthfeS7pemZjeOBriR7ZmlsZXMubGVuZ3RofeaXpeOBr+OAgeOBmeOBueOBpuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBpOOBjeOBp+OBme+8ieOAgmApO3JldHVybn0KICBmb3IobGV0IGk9MDtpPHRvZG8ubGVuZ3RoO2krKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IGQ9dG9kb1tpXSxlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgbXNnKGAke2R977yIJHtpKzF9LyR7dG90YWx95pel77yJ44KS5Y+W5b6X5Lit4oCmXG7lj5bjgornm7TjgZcke3N0LmRheXN95pel77yP44Op44OD44OX44KS6Kqt44KB44Gf44Os44O844K5ICR7c3QubGFwc30vJHtzdC5yYWNlc33vvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgKTsKICAgdHJ5ewogICAgY29uc3Qgcj1hd2FpdCBELmZldGNoRGF5KGJhc2UsZCk7CiAgICBpZihyLmZhaWxlZE4pe3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICBjb25zdCByaWRzPW5ldyBTZXQoci5yb3dzLm1hcCh4PT54LnJhY2VJZCkpLGxhcFJhY2VzPW5ldyBTZXQoci5yb3dzLmZpbHRlcih4PT5BcnJheS5pc0FycmF5KHgubGFwKSYmeC5sYXAubGVuZ3RoKS5tYXAoeD0+eC5yYWNlSWQpKTsKICAgIGNvbnN0IGNvcm5lckhvcnNlcz1yLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg+PTIpLmxlbmd0aDsKICAgIGF3YWl0IEQuaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7CiAgICBpZihsYXBSYWNlcy5zaXplfHxjb3JuZXJIb3JzZXMpYXdhaXQgRC5tZXRhUHV0KCJsYXBkb25lOiIrZCx0cnVlKTsKICAgIHN0LmRheXMrKztzdC5yYWNlcys9cmlkcy5zaXplO3N0LmxhcHMrPWxhcFJhY2VzLnNpemU7c3QuY29ybmVycys9Y29ybmVySG9yc2VzO3N0LmhvcnNlcys9ci5yb3dzLmxlbmd0aDtjb25zZWM9MDsKICAgIGlmKHN0LmRheXM+PTImJnN0LmxhcHM9PT0wJiZzdC5jb3JuZXJzPT09MCl7c3Qubm9kYXRhPXRydWU7U1NUT1A9dHJ1ZX0KICAgfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgibGFwR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgY29uc3QgcmF0ZT0oeCx5KT0+eT9NYXRoLnJvdW5kKHgveSoxMDApKyIlIjoiLSI7CiAgbGV0IGg9YCR7c3Qubm9kYXRhPyc8c3BhbiBjbGFzcz0iYmFkIj7jg6njg4Pjg5fjgoLpgJrpgY7poIbkvY3jgoLoqq3jgoHjgb7jgZvjgpPjgafjgZfjgZ/jgILkuK3mlq3jgZfjgb7jgZfjgZ/jgII8L3NwYW4+XG7jgIzoqq3jgb/lj5bjgorjga7oqLrmlq3jgI3jgpLmirzjgZfjgIHlh7rjgZ/mlofnq6DjgpLosrzjgaPjgabjgY/jgaDjgZXjgYTjgIJcbic6KHN0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn+OAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOAgeOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjooU1NUT1A/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6IuWujOS6huOAgiIpKX1gOwogIGgrPWDlj5bjgornm7TjgZcgJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iVxu44Op44OD44OX44KS6Kqt44KB44Gf44Os44O844K577yaJHtzdC5sYXBzLnRvTG9jYWxlU3RyaW5nKCl9LyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3vvIgke3JhdGUoc3QubGFwcyxzdC5yYWNlcyl977yJXG7pgJrpgY7poIbkvY3jgpLoqq3jgoHjgZ/ppqzvvJoke3N0LmNvcm5lcnMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5ob3JzZXMudG9Mb2NhbGVTdHJpbmcoKX3vvIgke3JhdGUoc3QuY29ybmVycyxzdC5ob3JzZXMpfe+8iWA7CiAgaWYoc3QuZmFpbC5sZW5ndGgpaCs9YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn3vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHmrovjgorjgaDjgZHntprjgY3jgYvjgonvvIk8L3NwYW4+YDsKICBtc2coaCk7dHJ5e2F3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKX1jYXRjaChlKXt9CiB9CiByZXR1cm4gc3Q7Cn0KJCgibGFwR28iKS5vbmNsaWNrPSgpPT5sYXBSZWZldGNoKCk7CiQoImxhcERiZyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImxhcE91dCIpO291dC52YWx1ZT0i6Ki65pat5Lit4oCmIjsKIHRyeXsKICBjb25zdCBmaWxlcz0oYXdhaXQgaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLnNvcnQoKHgseSk9PnguZGF0ZTx5LmRhdGU/LTE6MSk7CiAgaWYoIWZpbGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlj5blvpfmuIjjgb/jga7miJDnuL7jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiAgY29uc3QgZD1maWxlc1tmaWxlcy5sZW5ndGgtMV0uZGF0ZSxkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vanJhLWRheT9kYXRlPSR7ZH1gKSxyYWNlcz1kYXkucmFjZXN8fFtdOwogIGNvbnN0IHI9cmFjZXMuZmluZCh4PT54LnJhY2VObz09PTExKXx8cmFjZXNbMF07CiAgaWYoIXIpe291dC52YWx1ZT1gJHtkfSDjga7jg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpNgO3JldHVybn0KICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlVXJsKCl9L2RlYnVnLXJlc3VsdD9jbmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChyLmNuYW1lKX1gKTtkZWxldGUgeC5vazsKICBvdXQudmFsdWU9YOaXpeS7mCAke2R9IOmWi+WCrOWgtCR7ci52ZW51ZUNvZGV9ICR7ci5yYWNlTm99UlxuYCtKU09OLnN0cmluZ2lmeSh4KTsKIH1jYXRjaChlKXtvdXQudmFsdWU9IuiouuaWreOCqOODqeODvO+8miIrZS5tZXNzYWdlfQp9OwoKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luO2Vsc2UgJCgid3VybCIpLnZhbHVlPSJodHRwczovL2tlaWJhLWFpLXBheW91dHMuaHQxOTk1MDgyMi53b3JrZXJzLmRldiI7CnJlbmRlckdhdGUoKTtyZW5kZXJBbGwoKTsKKGFzeW5jKCk9Pnt0cnl7YXdhaXQgb3BlbkRCKCk7YXdhaXQgcGVkaWdyZWVMb2FkKCk7YXdhaXQgbW9kZWxzRnJvbU1ldGEoKTthd2FpdCByZWZyZXNoRGF0YUxhc3QoKTthd2FpdCBzaG93U3RhdGUoKTtyZW5kZXJNb2RlbFN0YXR1cygpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKCjwvc2NyaXB0Pgo8L2JvZHk+PC9odG1sPgo=";
function serveApp() {
  const bin = atob(APP_HTML_BASE64);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function handleHealth(env) {
  let kv = "未設定";
  try { if (env && env.BACKUP) { await env.BACKUP.list({ limit: 1 }); kv = "OK"; } } catch (e) { kv = "エラー: " + String(e?.message || e); }
  return json({ ok: true, version: WORKER_VERSION, kv, time: new Date().toISOString() });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const p = url.pathname;
      const method = request.method.toUpperCase();
      if (method === "OPTIONS") return handleOptions();
      if (p.startsWith("/backup/")) return await handleBackup(request, env, p);
      if (method !== "GET" && method !== "HEAD") return errorResponse("GET / HEAD / OPTIONS のみ対応しています。", 405);
      if (p === "/" || p === "/index.html") return serveApp();
      if (p === "/manifest.webmanifest") return manifestResponse();
      if (p === "/icon-180.png") return iconResponse("180");
      if (p === "/icon-192.png") return iconResponse("192");
      if (p === "/icon-512.png") return iconResponse("512");
      if (p === "/health") return await handleHealth(env);
      if (p === "/race-cards") return await handleRaceCards(request);
      if (p === "/jra-days") return await handleJraDays(request);
      if (p === "/jra-day") return await handleJraDay(request);
      if (p === "/jra-results") return await handleJraResults(request);
      if (p === "/jra-odds") return await handleJraOdds(request);
      if (p === "/jra-odds-links") return await handleJraOddsLinks(request);
      if (p === "/debug-entry") return await handleDebugEntry(request);
      if (p === "/debug-result") return await handleDebugResult(request);
      return errorResponse("見つかりません: " + p, 404);
    } catch (error) {
      return errorResponse(error?.message || error, 500);
    }
  }
};
