/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-14-rebuild-18";

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
  "192": "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",
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44KS5q2j56K644Gr44GZ44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44G+44GZ44CC6YGO5Y675oiQ57i+44GL44KJ5L2c44KL56K6546H44Go44CB5Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7pgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS57WE44G/5ZCI44KP44Gb44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OBvuOBmeOAguaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OAgei2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWfuua6luOCguOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJwbFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAxOS0wMS0wMSI+PGJ1dHRvbiBpZD0icGxSdW4iPuWlvei1sOeOh+OCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InBsQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0icGxPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KIDxkaXYgaWQ9ImJ0T3V0IiBjbGFzcz0ic3RhdHVzIj7jg4fjg7zjgr/lj5blvpfjga7jgYLjgajjgaflrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9kaXY+Cgo8ZGl2IGlkPSJ2U2V0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7jg5Djg4Pjgq/jgqLjg4Pjg5foqK3lrprvvIhDbG91ZGZsYXJl44Gr5L+d5a2Y77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU244Gg44GR44KS5L2/44Gj44Gm5L+d5a2Y5YWI44KS5YiG44GR44G+44GZ77yI44OR44K544OV44Os44O844K66Ieq5L2T44Gv6YCB44KK44G+44Gb44KT77yJ44CC5ZCM44GY44OR44K544OV44Os44O844K644Gn5b6p5YWD44Gn44GN44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYmtQYXNzIiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IuODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvIkiIGF1dG9jb21wbGV0ZT0ib2ZmIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMDBweCI+PGJ1dHRvbiBpZD0iYmtTaG93IiBjbGFzcz0ic3ViIj7ooajnpLo8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iYmtBdXRvIiB0eXBlPSJjaGVja2JveCIgY2hlY2tlZD4g5aSJ5pu044GM44GC44KM44Gw6Ieq5YuV44Gn44OQ44OD44Kv44Ki44OD44OX44GZ44KLPC9sYWJlbD48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYmtOb3ciPuS7iuOBmeOBkOW3ruWIhuODkOODg+OCr+OCouODg+ODlzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrUmVzdG9yZSIgY2xhc3M9InN1YiI+44OQ44OD44Kv44Ki44OD44OX44GL44KJ5b6p5YWDPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtGdWxsIiBjbGFzcz0ic3ViIj7jgZnjgbnjgabkv53lrZjjgZfnm7TjgZk8L2J1dHRvbj48L2Rpdj4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7pgY7ljrvjg4fjg7zjgr/jga7oqq3jgb/ovrzjgb/vvIjku7vmhI/vvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuS7peWJjeOBruODkOODg+OCr+OCouODg+ODl0pTT07vvI/miJDnuL5DU1bjgYzjgYLjgozjgbDoqq3jgb/ovrzjgoHjgb7jgZnvvIjlkIzjgZjml6Xjga/ph43opIfjgZfjgb7jgZvjgpPvvInjgII8L2Rpdj4KIDxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuiouuaWrTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Ye66aas6KGo44Gu6Kqt44G/5Y+W44KK44Gr5ZWP6aGM44GM44GC44KL44Go44GN44CB6ZaL5YKs5aC044GU44Go44GrMVLjga7jg5rjg7zjgrjjga7kuK3ouqvjgpLoqr/jgbnjgabkuIvjgavlh7rjgZfjgb7jgZnjgILjgrPjg5Tjg7zjgZfjgabpgIHjgaPjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iZGJnR28iIGNsYXNzPSJzdWIiPuiouuaWreaDheWgseOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9ImRiZ0NvcHkiIGNsYXNzPSJzdWIiPuOCs+ODlOODvDwvYnV0dG9uPjwvZGl2PgogPHRleHRhcmVhIGlkPSJkYmdPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxNDBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7jgqrjg4Pjgrrjga7oqLrmlq08L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBquOBhOODrOODvOOCueOBjOOBguOCi+OBqOOBjeOAgeOAjEpSQeOBjOOBvuOBoOeZuuWjsuOBl+OBpuOBhOOBquOBhOOAjeOBruOBi+OAjOWPluW+l+OBruWVj+mhjOOAjeOBquOBruOBi+OCkuiqv+OBueOBvuOBmeOAguWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgYvjgonjgIHmirzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ib2Rkc0RiZyIgY2xhc3M9InN1YiI+44Kq44OD44K644Gu6Ki65pat44KS5L2c44KLPC9idXR0b24+PGJ1dHRvbiBpZD0ib2Rkc0NvcHkiIGNsYXNzPSJzdWIiPuOCs+ODlOODvDwvYnV0dG9uPjwvZGl2PgogPHRleHRhcmVhIGlkPSJvZGRzT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTYwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GXPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7jg6zjg7zjgrnjgpLjgIHjg6zjg7zjgrnlhajkvZPjga7jg6njg4Pjg5fvvIjjg4/jg63jg7Pjgr/jgqTjg6DvvInjgajlkITppqzjga7jgrPjg7zjg4rjg7zpgJrpgY7poIbkvY3jgaTjgY3jgaflj5bjgornm7TjgZfjgb7jgZnvvIjjg5rjg7zjgrnjg7vohJros6rjgpLkuojmg7Pjgavkvb/jgYbjgZ/jgoHjga7mupblgpnvvInjgILkv53lrZjmuIjjgb/jga7ml6Xjga/kuIrmm7jjgY3jgZXjgozjgb7jgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgILjgb7jgZrmlrDjgZfjgYTmnJ/plpPjgYvjgonlsJHjgZfjgaDjgZHoqabjgZfjgabjgIHoqq3jgoHjgabjgYTjgovjgYvjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0ibGFwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDI2LTAxLTAxIj48YnV0dG9uIGlkPSJsYXBHbyI+5Y+W44KK55u044GZPC9idXR0b24+PGJ1dHRvbiBpZD0ibGFwRGJnIiBjbGFzcz0ic3ViIj7oqq3jgb/lj5bjgorjga7oqLrmlq08L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9ImxhcFN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8dGV4dGFyZWEgaWQ9ImxhcE91dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEyMHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgo8L2Rpdj4KCjwvbWFpbj4KPGRpdiBpZD0iYnVzeSI+PGRpdj48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+PC9kaXY+CjxzY3JpcHQ+CmNvbnN0IFVFPSgoKT0+ewogLyog5a6f44OH44O844K/5qSc6Ki844Gn6YCG5Yq55p6c44Gg44Gj44Gf5oiQ5YiG77yI6aiO5omL44O76ZaT6ZqU77yJ44Gv5pei5a6a44GnT0ZGICovCiBjb25zdCBERUZBVUxUPXtqb2NrZXk6ZmFsc2UsbGF5b2ZmOmZhbHNlfTsKIGNvbnN0IGNsYW1wPSh4LGEsYik9Pk1hdGgubWF4KGEsTWF0aC5taW4oYix4KSk7CiBjb25zdCBzaWdtb2lkPXg9PjEvKDErTWF0aC5leHAoLXgpKTsKIGNvbnN0IGxvZ2l0PXA9PntwPWNsYW1wKHAsLjAwMSwuOTk5KTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwogY29uc3Qgbm49cz0+U3RyaW5nKHM/PyIiKS5ub3JtYWxpemUoIk5GS0MiKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc1x1MzAwMF0rL2csIiIpLnJlcGxhY2UoL1vjg7vvvaUu77yOXC3igJDigJHigJLigJPigJTigJUn4oCZYF0vZywiIikucmVwbGFjZSgvW+KYhuKYheKWs+KWsuKXh+KXhl0vZywiIik7CiAvKiDpqI7miYvlkI3vvJrlhYjpoK3jga7mrKflrZfjgqTjg4vjgrfjg6Pjg6vjgpLpmaTjgY3jgIHjg4fjg6Djg7zjg63ihpLjg4fjg6Ag44Gr5o+D44GI44KL77yISlJB44GuIEMu44OH44Og44O844OtIOOBqOmBjuWOu+ODh+ODvOOCv+OBriDvvKPvvI7jg4fjg6Ag44KS5LiA6Ie044GV44Gb44KL77yJICovCiBjb25zdCBqbm49cz0+e2xldCB2PW5uKFN0cmluZyhzPz8iIikucmVwbGFjZSgvXGR7Mn0oPzpcLlxkKT9ccyooPzprZ3zvvYvvvYcpL2dpLCIgIikucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDh9W++8iSldL2csIiAiKS5yZXBsYWNlKC8o5qCX5p2xfOe+jua1pikvZywiICIpKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogLyog44Kv44Op44K544Gu5q616ZqO77yaMD3kuI3mmI4gLyAtMT3lnLDmlrkgLyAxPeaWsOmmrOODu+acquWLneWIqSAvIDI9MeWLnSAvIDM9MuWLnSAvIDQ9M+WLnSAvIDU944Kq44O844OX44Oz44O76YeN6LOeICovCiBjb25zdCBsZXZlbE9mTGFiZWw9dD0+e2NvbnN0IHM9U3RyaW5nKHR8fCIiKTtpZigv5Zyw5pa5fE5BUi8udGVzdChzKSlyZXR1cm4gLTE7aWYoL+aWsOmmrHzmnKrli53liKkvLnRlc3QocykpcmV0dXJuIDE7aWYoLzHli518NTAw5LiHLy50ZXN0KHMpKXJldHVybiAyO2lmKC8y5YudfDEwMDDkuIcvLnRlc3QocykpcmV0dXJuIDM7aWYoLzPli518MTYwMOS4hy8udGVzdChzKSlyZXR1cm4gNDtpZigv44Kq44O844OX44OzfO+8r++8sHxPUHzjg6rjgrnjg4bjg4Pjg4l86YeN6LOefO+8p3xHWzEyM0ldL2kudGVzdChzKSlyZXR1cm4gNTtyZXR1cm4gMH07CiBjb25zdCBsZXZlbE9mUHJpemU9cD0+e3A9TnVtYmVyKHApO3JldHVybiAhKHA+MCk/MDpwPD03MDA/MTpwPD05MDA/MjpwPD0xMzAwPzM6cDw9MTgwMD80OjV9OwogLyog4piF44Kw44Os44O844OJ77yI5qC877yJ77yaMD3kuI3mmI4v5LiL57SaIDE9T1Djg7vjg6rjgrnjg4bjg4Pjg4kgMj1HMyAzPUcyIDQ9RzHjgIIKICAgIOW+k+adpeOBryBHMS9HMi9HMy9PUCDjgpLjgZnjgbnjgabjgIw144CN44Gr5r2w44GX44Gm44GE44Gf44Gf44KB44CBRzPli53jgaHjgYwgRzEg44Gn44KC5Ymy5byV44GV44KM44Gq44GL44Gj44Gf44CCCiAgICDliKTlrprpoIbvvJrjg6njg5njg6vvvIhORktD5b6MIEdJL0dJSS9HSUlJL0cx44CcRzPvvInihpIgMeedgOiznumHke+8iOS4h+WGhu+8ieKGku+8iOWvvuixoeODrOODvOOCueOBruOBv++8iUcx44Os44O844K55ZCNICovCiBjb25zdCBHMV9OQU1FUz0v5aSp55qH6LOefOaciemmrOiomOW/tXzjgrjjg6Pjg5Hjg7Pjgqvjg4Pjg5d844K444Oj44OR44Oz77yjfOWuneWhmuiomOW/tXzlronnlLDoqJjlv7V844O044Kj44Kv44OI44Oq44Ki44Oe44Kk44OrfOWkp+mYquadr3zpq5jmnb7lrq7oqJjlv7V844OV44Kn44OW44Op44Oq44O8fOODgeODo+ODs+ODlOOCquODs+OCunzjgrnjg5fjg6rjg7Pjgr/jg7zjgrp844Oe44Kk44Or44OB44Oj44Oz44OU44Kq44Oz44K344OD44OXfOOCqOODquOCtuODmeOCueWls+eOi+adr3znp4voj6/os5586I+K6Iqx6LOefOahnOiKseiznnzjgqrjg7zjgq/jgrl85YSq6ae/54md6aasfOaXpeacrOODgOODvOODk+ODvHzmnbHkuqzlhKrpp79855qQ5pyI6LOefE5IS+ODnuOCpOODq3zpmKrnpZ7jgrjjg6Xjg5njg4rjgqTjg6t85pyd5pel5p2vfOODm+ODvOODl+ODleODqy87CiBjb25zdCBncmFkZVRpZXI9KHRleHQscHJpemUsYnlOYW1lKT0+e2NvbnN0IHM9U3RyaW5nKHRleHR8fCIiKS5ub3JtYWxpemUoIk5GS0MiKTsKICBpZigv6Zqc5a6zfOOCuOODo+ODs+ODl3xKXC4/XHM/Ry9pLnRlc3QocykpcmV0dXJuIDA7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSUl8MykoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDI7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJSXwyKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMzsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/Okl8MSkoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDQ7CiAgY29uc3QgcD1OdW1iZXIocHJpemUpO2lmKHA+MClyZXR1cm4gcD49MTAwMDA/NDpwPj01MDAwPzM6cD49MzUwMD8yOnA+PTE4MDA/MTowOwogIGlmKGJ5TmFtZSYmRzFfTkFNRVMudGVzdChzKSlyZXR1cm4gNDsKICBpZigv44Oq44K544OG44OD44OJfOOCquODvOODl+ODs3zvvK/vvLB8XGJPUFxiLy50ZXN0KHMpKXJldHVybiAxOwogIHJldHVybiAwfTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogY29uc3QgY2xlYW5Ucj10PT5TdHJpbmcodHx8IiIpLnJlcGxhY2UoL1xzKy9nLCIgIikudHJpbSgpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw2fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKD865qCX5p2xfOe+jua1pnzlnLDmlrl85aSW5Zu9fOaLm+W+hSlccypb44O7772lXT8vZywiICIpLnJlcGxhY2UoL1vjg7vvvaVdL2csIiAiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKTsKIGZ1bmN0aW9uIHRvUm93KG8pe2NvbnN0IF9yPXRvUm93MChvKTtfci50cmFpbmVyPWNsZWFuVHIob1si6Kq/5pWZ5birIl18fG8udHJhaW5lcnx8IiIpO2NvbnN0IF9ndD1TdHJpbmcob1si6aas5aC0Il18fG9bIummrOWgtOeKtuaFiyJdfHxvLmdvaW5nfHxvLnRyYWNrX2NvbmRpdGlvbnx8IiIpO19yLmdjPS/kuI3oia9856iNfOmHjS8udGVzdChfZ3QpPzI6L+iJry8udGVzdChfZ3QpPzE6MDtfci5ncmQ9Z3JhZGVUaWVyKFN0cmluZyhvWyJjbGFzcyJdfHxvLmNsc3x8IiIpKyIgIitTdHJpbmcob1si44Os44O844K55ZCNIl18fG8ucmFjZV9uYW1lfHxvLnJhY2VuYW1lfHwiIiksbnVsbCxmYWxzZSk7cmV0dXJuIF9yfQogZnVuY3Rpb24gdG9Sb3cwKG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGpuYW1lOlN0cmluZyhvWyLpqI7miYsiXXx8by5qb2NrZXl8fCIiKS50cmltKCksZmluaXNoOmYob1si552A6aCGIl0/P28uZmluaXNoKSwKICAgZGlzdDpmKG8uY291cnNlX2xlbj8/b1si6Led6ZuiIl0/P28uZGlzdGFuY2UpfHwwLHN1cmY6c3VyZkNvZGUoby5yYWNlX3R5cGV8fG9bIuiKneODgCJdfHxvLnN1cmZhY2UpLAogICBhZ2U6YW0/TnVtYmVyKGFtWzFdKTpudWxsLG51bTpmKG9bIummrOeVqiJdKSxwb3A6ZihvWyLkurrmsJciXSksb2RkczpmKG9bIuWNmOWLnSJdKSwKICAgbHZsOigoKT0+e2NvbnN0IGlkPVN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz8iIik7aWYoL15cZHsxMn0kLy50ZXN0KGlkKSYmIWlzSnJhVmVudWUoaWQuc2xpY2UoNCw2KSkpcmV0dXJuIC0xO3JldHVybiBsZXZlbE9mTGFiZWwob1siY2xhc3MiXXx8by5jbHMpfSkoKX07CiB9CiAvKiDmiJDnuL7jgrnjg4jjgqLvvIjml6Xku5jmmIfpoIbjgasgYWRkIOOBmeOCi++8iSAqLwogZnVuY3Rpb24gU3RvcmUoKXt0aGlzLmg9bmV3IE1hcCgpO3RoaXMuaj1uZXcgTWFwKCl9CiBTdG9yZS5wcm90b3R5cGUuYWRkPWZ1bmN0aW9uKHIpewogIGlmKHIuZmluaXNoPT1udWxsfHwhci5ob3JzZSlyZXR1cm47CiAgY29uc3QgdDM9ci5maW5pc2g+PTEmJnIuZmluaXNoPD0zPzE6MDsKICBsZXQgaD10aGlzLmguZ2V0KHIuaG9yc2UpO2lmKCFoKXRoaXMuaC5zZXQoci5ob3JzZSxoPXtuOjAsdG9wMzowLHdpbjowLHN1bTowLGxhc3Q6IiIscnVuczpbXSxsdjp7fX0pOwogIGgubisrO2gudG9wMys9dDM7aWYoci5maW5pc2g9PT0xKWgud2luKys7aC5zdW0rPXIuZmluaXNoO2lmKHIuZGF0ZT5oLmxhc3QpaC5sYXN0PXIuZGF0ZTsKICBjb25zdCBMPXIubHZsfHwwOyhoLmx2W0xdPWgubHZbTF18fFswLDBdKTtoLmx2W0xdWzBdKys7aC5sdltMXVsxXSs9dDM7CiAgaWYoci5nYz4wKXtjb25zdCBncT0oaC5nbj1oLmdufHx7fSk7Y29uc3QgZ2c9KGdxW3IuZ2NdPWdxW3IuZ2NdfHxbMCwwXSk7Z2dbMF0rKztnZ1sxXSs9dDN9CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmLEwsci5ncmR8fDAsci5jZj09bnVsbD8tMTpyLmNmXSk7aWYoaC5ydW5zLmxlbmd0aD42KXtoLnJ1bnMuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtoLnJ1bnMuc2hpZnQoKX0KICBpZihyLmpvY2tleSl7bGV0IGo9dGhpcy5qLmdldChyLmpvY2tleSk7aWYoIWopdGhpcy5qLnNldChyLmpvY2tleSxqPXtuOjAsdG9wMzowfSk7ai5uKys7ai50b3AzKz10M30KIH07CiAvKiDpqI7miYvvvJrlrozlhajkuIDoh7TihpLvvIjnn63jgYTooajoqJjjgarjgonvvInliY3mlrnkuIDoh7Tjgacx5Lq644Gr57We44KM44KL44Go44GN44Gg44GR5o6h55SoICovCiBTdG9yZS5wcm90b3R5cGUuam9ja2V5PWZ1bmN0aW9uKG5hbWUpewogIGlmKCFuYW1lKXJldHVybiBudWxsOwogIGNvbnN0IGo9dGhpcy5qLmdldChuYW1lKTtpZihqKXJldHVybiBqOwogIGlmKG5hbWUubGVuZ3RoPDJ8fG5hbWUubGVuZ3RoPjQpcmV0dXJuIG51bGw7CiAgaWYoIXRoaXMuX2prfHx0aGlzLl9qa1NpemUhPT10aGlzLmouc2l6ZSl7dGhpcy5fams9Wy4uLnRoaXMuai5rZXlzKCldO3RoaXMuX2prU2l6ZT10aGlzLmouc2l6ZX0KICBjb25zdCBjPXRoaXMuX2prLmZpbHRlcihrPT5rLnN0YXJ0c1dpdGgobmFtZSl8fChuYW1lLmxlbmd0aD49MyYmay5zdGFydHNXaXRoKG5hbWUuc2xpY2UoMCwtMSkpJiZuYW1lLmxlbmd0aDw9ay5sZW5ndGgpKTsKICByZXR1cm4gYy5sZW5ndGg9PT0xP3RoaXMuai5nZXQoY1swXSk6bnVsbDsKIH07CiBjb25zdCBsYXlvZmY9KGxhc3QsdGFyZ2V0KT0+e2lmKCFsYXN0KXJldHVybiAuNTtjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjRlNTsKICByZXR1cm4gYTwyMT8uNzI6YTw2MD8uNjI6YTwxMjA/LjU1OmE8MjQwPy40ODouNDJ9OwogLyogPT09PT0g5a6f57i+44GL44KJ5a2m57+S44GX44Gf44Oi44OH44Or77yI54m55b606YeP4oaSM+edgOWGheeOh++8iSA9PT09PSAqLwogY29uc3QgRk49WyJiaWFzIiwib2Zmc2V0IiwibmxvZyIsIm5vSGlzdCIsImZTIiwiZkMiLCJhdmdGIiwicjNzaGFyZSIsInIzYXZnIiwibGFzdDEiLCJsYXN0QmlnIiwiY29uZERpZmYiLCJmaXJzdFN1cmYiLCJnYXBTaG9ydCIsImdhcExvbmciLCJnYXBWTG9uZyIsImFnZTMiLCJhZ2U0IiwiYWdlNyIsInN0ZXBVcCIsInN0ZXBEb3duIiwid2luUmF0ZSJdOwogY29uc3QgRko9WyJqUmVsIiwiamxvZyIsImpNaXNzIl07CiAvKiDkv4LmlbDjga8gdG9vbHMvZml0X21vZGVsLmpzIOOBp+Wtpue/ku+8iDIwMjDlubTjgJzjga7mmYLns7vliJfjg4fjg7zjgr/vvInjgIJ7fSDjgpLnva7mj5sgKi8KIGNvbnN0IE1PREVMPXsiY29yZSI6WzAuMDUyOTksMC45OTY5NywwLjA0OTUxLC0wLjI0NTQzLC0wLjUyODEyLDAuOTE5NDYsLTAuNTE0NzYsLTAuMzQ3ODYsLTAuNTc5MDQsLTAuNTUxMTgsMC4xNjc3MywxLjExODIsLTAuMzUzMDUsLTAuMTExMjgsLTAuMjI3MjgsLTAuNDAxMjksMC4xMzc3MSwwLjIxNjYyLC0wLjM5NjczLC0wLjM1MzA1LDAuMDA2MTcsLTAuNTk1NjRdLCJmdWxsIjpbMC40MDQzMywxLjM3MDA3LDAuMDYyNTEsLTAuMTIyNzksLTAuNTAyMzIsMC44Mjk3OCwtMC4zOTg5NSwtMC4zMDA3MiwtMC41MTU1OSwtMC41MjUzMiwwLjE1ODMyLDEuMDY2OTUsLTAuMzgzNzcsLTAuMDcyODIsLTAuMjI1NjgsLTAuMzUxLDAuMTUwMjUsMC4yMTI1MywtMC40MTMzNCwtMC4zMjMxOSwwLjAwNzI2LC0wLjkzNzkyLDAuNTM1NTcsMC4wMDM2NSwtMC4yMDYwNV19OwogZnVuY3Rpb24gZmVhdHMocixzdG9yZSxyYWNlLE4sd2l0aEopewogIGNvbnN0IGI9Y2xhbXAoMy9OLC4wOCwuNSksbGI9bG9naXQoYiksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxuPWg/aC5uOjAsTHQ9cmFjZS5sdmx8fDA7CiAgY29uc3QgcFM9KChoP2gudG9wMzowKSszKmIpLyhuKzMpLGZTPWxvZ2l0KHBTKS1sYjsKICAvLyDjgq/jg6njgrnoo5zmraPvvJrkvY7jgYTjgq/jg6njgrnvvIjlnLDmlrnjgpLlkKvjgoDvvInjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY8KICBsZXQgZkM9ZlM7CiAgaWYoaCYmTHQ+MCl7bGV0IEg9MCxNPTA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKGgubHYpKXtjb25zdCBMPU51bWJlcihrKSxbY24sY3RdPWgubHZba107Y29uc3QgZz1MPT09MD8wOihMPDA/LTI6TC1MdCk7CiAgICBIKz1jdCpjbGFtcCgxKy4zKmcsLjQsMS44KTtNKz0oY24tY3QpKmNsYW1wKDEtLjMqZywuNCwxLjgpfQogICBmQz1sb2dpdCgoSCszKmIpLyhIK00rMykpLWxifQogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10scmM9cnVucy5zbGljZSgtMyksbGFzdFI9cnVucy5sZW5ndGg/cnVuc1tydW5zLmxlbmd0aC0xXTpudWxsOwogIGNvbnN0IHIzc2hhcmU9cmMubGVuZ3RoP3JjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgvcmMubGVuZ3RoOjA7CiAgY29uc3QgcjNhdmc9cmMubGVuZ3RoP2NsYW1wKChyYy5yZWR1Y2UoKGEseCk9PmEreFsxXSwwKS9yYy5sZW5ndGgtNikvNiwtMSwyKTowOwogIGNvbnN0IGxhc3QxPWxhc3RSP2NsYW1wKChsYXN0UlsxXS02KS82LC0xLDIpOjAsbGFzdEJpZz1sYXN0UiYmbGFzdFJbMV0+PTEwPzE6MDsKICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7bGV0IGNvbmREaWZmPTAsZmlyc3RTdXJmPTA7CiAgaWYoc2MmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiYoIWRpc3R8fE1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCkpOwogICBpZihjci5sZW5ndGgpY29uZERpZmY9KGNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgrMipwUykvKGNyLmxlbmd0aCsyKS1wUzsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpZmlyc3RTdXJmPTF9CiAgbGV0IGdhcD1udWxsO2lmKGgmJmgubGFzdCYmcmFjZS5kYXRlKWdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICBjb25zdCBhPXIuYWdlfHwwOwogIGNvbnN0IHN0ZXBEPWxhc3RSJiZsYXN0Uls0XT4wJiZMdD4wP2NsYW1wKEx0LWxhc3RSWzRdLC0zLDMpOjA7CiAgY29uc3QgeD1bMSxsYixNYXRoLmxvZygxK24pLG49PT0wPzE6MCxmUyxmQyxuP2NsYW1wKChoLnN1bS9uLTYpLzYsLTEsMik6MCxyM3NoYXJlLHIzYXZnLGxhc3QxLGxhc3RCaWcsY29uZERpZmYsZmlyc3RTdXJmLAogICBnYXAhPW51bGwmJmdhcDwyMT8xOjAsZ2FwIT1udWxsJiZnYXA+MTIwPzE6MCxnYXAhPW51bGwmJmdhcD4yNDA/MTowLGE9PT0zPzE6MCxhPT09ND8xOjAsYT49Nz8xOjAsc3RlcEQ+MD9zdGVwRDowLHN0ZXBEPDA/LXN0ZXBEOjAsCiAgIG4/KChoLndpbisuMypiKS8obisxLjUpLWIpOjBdOwogIGlmKHdpdGhKKXtjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7CiAgIGlmKGomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KTt4LnB1c2gobG9naXQocEopLWxiLE1hdGgubG9nKDErai5uKSwwKX1lbHNlIHgucHVzaCgwLDAsMSl9CiAgcmV0dXJuIHg7CiB9CiBjb25zdCBkb3Q9KHcseCk9PntsZXQgej0wO2ZvcihsZXQgaT0wO2k8eC5sZW5ndGg7aSsrKXorPSh3W2ldfHwwKSp4W2ldO3JldHVybiB6fTsKIGNvbnN0IG1vZGVsWj0oa2luZCx4KT0+ZG90KE1PREVMW2tpbmRdLHgpOwogLyogMemgreOBrue0oOeCuShsb2dpdCnjgajjgr/jgrDjgIJjb21wIOOBp+aIkOWIhuOCkk9OL09GRuOBp+OBjeOCi++8iOaknOiovOeUqO+8iSAqLwogZnVuY3Rpb24gaG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wPXt9KXsKICBjb21wPU9iamVjdC5hc3NpZ24oe30sREVGQVVMVCxjb21wKTtjb25zdCB1c2U9az0+Y29tcFtrXSE9PWZhbHNlJiZjb21wW2tdIT09MDsKICBjb25zdCBiPWNsYW1wKDMvTiwuMSwuNSksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxqPXN0b3JlLmouZ2V0KHIuam9ja2V5KTsKICBjb25zdCBydW5zPWg/aC5ydW5zOltdLG49aD9oLm46MCx0YWdzPVtdO2xldCB6PTAsY29uZj0i5L2OIjsKICBjb25zdCBwSD0oKGg/aC50b3AzOjApKzQqYikvKG4rNCk7eis9bG9naXQocEgpOwogIGlmKG4+PTIpY29uZj1uPj01PyLpq5giOiLkuK0iO2Vsc2UgdGFncy5wdXNoKHt0OiLlsaXmrbTkuI3otrMiLGM6ImcifSk7CiAgaWYobj49Myl7Y29uc3QgdDM9aC50b3AzL24sdz1oLndpbi9uOwogICBpZih0Mz49LjQwJiZ3PD0uMjApdGFncy5wdXNoKHt0OmDlloTmiKblnosgM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgZWxzZSBpZih0Mz49LjQ1KXRhZ3MucHVzaCh7dDpg5a6J5a6aIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGlmKHVzZSgiYXZnIikmJmguc3VtL248PTUpeis9LjEyfQogIGNvbnN0IHJjPXJ1bnMuc2xpY2UoLTMpOwogIGlmKHVzZSgicmVjZW50IikmJnJjLmxlbmd0aD49Mil7Y29uc3QgYzM9cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxhdmc9cmMucmVkdWNlKChzLHgpPT5zK3hbMV0sMCkvcmMubGVuZ3RoOwogICB6Kz0uMjIqKGMzL3JjLmxlbmd0aC1wSCkqMztpZihjMz49Mil0YWdzLnB1c2goe3Q6YOi/kSR7cmMubGVuZ3Rofei1sOOBpyR7YzN95ZueM+edgOWGhWAsYzoiYiJ9KTsKICAgY29uc3QgbGFzdD1ydW5zW3J1bnMubGVuZ3RoLTFdOwogICBpZihsYXN0JiZsYXN0WzFdPj04JiZuPj00JiZoLnRvcDMvbj49LjM1KXt6Kz0uMTU7dGFncy5wdXNoKHt0OmDliY3otbAke2xhc3RbMV19552A44GL44KJ5be744GN6L+U44GX5L2Z5ZywYCxjOiJvIn0pfQogICBpZihhdmc8PTQmJnJjLmxlbmd0aD49Myl6Kz0uMDh9CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwOwogIGlmKHVzZSgiY29uZCIpJiZzYyYmZGlzdCYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJk1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCk7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKXt6LT0uMzU7dGFncy5wdXNoKHt0OmAke3NjPT09MT8i5Yid44Gu6IqdIjoi5Yid44Gu44OA44O844OIIn3vvIjpgY7ljrvotbDjga/liKXppqzloLTvvIlgLGM6Im8ifSl9CiAgIGlmKGNyLmxlbmd0aD49Mil7Y29uc3QgdDM9Y3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxwYz0odDMrMipwSCkvKGNyLmxlbmd0aCsyKTsKICAgIHorPWNsYW1wKDIqKHBjLXBIKSwtLjUsLjUpO2lmKHQzPj0yKXRhZ3MucHVzaCh7dDpg5ZCM5p2h5Lu244GnJHt0M30vJHtjci5sZW5ndGh95ZueM+edgOWGhWAsYzoiYiJ9KX19CiAgaWYodXNlKCJqb2NrZXkiKSYmaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpLGRqPWNsYW1wKC42Kihsb2dpdChwSiktbG9naXQoYikpLC0uNCwuNSk7CiAgIHorPWRqO2lmKGRqPj0uMjUpdGFncy5wdXNoKHt0OmDpqI7miYvlpb3oqr8gM+edgOWGhSR7TWF0aC5yb3VuZChqLnRvcDMvai5uKjEwMCl9JWAsYzoiYiJ9KX0KICBpZih1c2UoImxheW9mZiIpJiZoJiZoLmxhc3Qpe2NvbnN0IGdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICAgeis9LjYqKGxheW9mZihoLmxhc3QscmFjZS5kYXRlKS0uNSk7aWYoZ2FwPj0xODApdGFncy5wdXNoKHt0OmAke2dhcH3ml6XjgbbjgopgLGM6Im8ifSl9CiAgaWYodXNlKCJhZ2UiKSl7Y29uc3QgYT1yLmFnZXx8NTtpZihhPT09Myl6Kz0uMTA7ZWxzZSBpZihhPT09NCl6Kz0uMDU7ZWxzZSBpZihhPj04KXt6LT0uMTU7dGFncy5wdXNoKHt0OmAke2F95q2zYCxjOiJvIn0pfX0KICByZXR1cm57eix0YWdzLGNvbmYsbn07CiB9CiAvKiAyMDIz5bm05Lul6ZmN44Gu5pmC57O75YiX5qSc6Ki844Gn44GuIOe0oOOBruWlvei1sOeOh+KGkueptOOCvuODvOODs+Wun+e4vu+8iOW5s+Wdh3AsIOWun+e4vu+8iSAqLwogY29uc3QgQ0FMPVtbMCwwLjAxXSxbMC4wMjIsMC4wMTddLFswLjA0NiwwLjAyMl0sWzAuMDc1LDAuMDQ2XSxbMC4xMDUsMC4wNjhdLFswLjEzNSwwLjA4Ml0sWzAuMTY1LDAuMDk4XSxbMC4xOTMsMC4xMDNdLFswLjIyNCwwLjEzOF0sWzAuMjU5LDAuMTYxXSxbMC4zMDIsMC4xODddLFswLjM1OCwwLjIxMV0sWzAuNDU0LDAuMjI5XV07CiAvKiDjgqrjg4PjgrrjgarjgZfjg6Ljg7zjg4nvvIjkurrmsJfjga7ku6PnkIbvvJ3pqI7miYvovrzjgb/jga7lrabnv5Ljg6Ljg4fjg6vjga7poIbkvY3jgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvInjga7oo5zmraPooajjgIIyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5L2c5oiQICovCiBjb25zdCBDQUxfUFJPWFk9W1swLDAuMDEzXSxbMC4wMjIsMC4wMjFdLFswLjA0NiwwLjAyOF0sWzAuMDc1LDAuMDU2XSxbMC4xMDUsMC4wODZdLFswLjEzNSwwLjExMV0sWzAuMTY1LDAuMTM0XSxbMC4xOTMsMC4xNDZdLFswLjIyNCwwLjIwMV0sWzAuMjU5LDAuMjE5XSxbMC4zMDEsMC4yNjFdLFswLjM1NSwwLjI5Nl0sWzAuNDM5LDAuMzY3XV07CiBmdW5jdGlvbiBpbnRlcnAoVCxwKXtmb3IobGV0IGk9MTtpPFQubGVuZ3RoO2krKylpZihwPD1UW2ldWzBdKXtjb25zdFthLGJdPVRbaS0xXSxbYyxkXT1UW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBUW1QubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gY2FsaWJGb3IocCxtb2RlKXtyZXR1cm4gbW9kZT09PSJvZGRzIj9pbnRlcnAoQ0FMLHApOmludGVycChDQUxfUFJPWFkscCl9CiBmdW5jdGlvbiBjYWxpYihwKXtmb3IobGV0IGk9MTtpPENBTC5sZW5ndGg7aSsrKWlmKHA8PUNBTFtpXVswXSl7Y29uc3RbYSxiXT1DQUxbaS0xXSxbYyxkXT1DQUxbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIENBTFtDQUwubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gbm9ybWFsaXplVG9wMyh6cyx0b3RhbCl7bGV0IGxvPS04LGhpPTg7CiAgZm9yKGxldCBpPTA7aTw2MDtpKyspe2NvbnN0IGM9KGxvK2hpKS8yLHM9enMucmVkdWNlKChhLHopPT5hK3NpZ21vaWQoeitjKSwwKTtpZihzPnRvdGFsKWhpPWM7ZWxzZSBsbz1jfQogIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6cy5tYXAoej0+c2lnbW9pZCh6K2MpKX0KIC8qIEhhcnZpbGxl5rOV44Gn5Yud546H4oaSM+edgOWGheeOhyAqLwogZnVuY3Rpb24gdG9wM0Zyb21XaW4ocHcpe2NvbnN0IFQ9cHcucmVkdWNlKChhLGIpPT5hK2IsMCkscD1wdy5tYXAoeD0+eC9UKSxuPXAubGVuZ3RoLG91dD1uZXcgQXJyYXkobikuZmlsbCgwKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtsZXQgcz1wW2ldOwogICBmb3IobGV0IGo9MDtqPG47aisrKWlmKGohPT1pKXtzKz1wW2pdKnBbaV0vKDEtcFtqXSk7CiAgICBmb3IobGV0IGs9MDtrPG47aysrKWlmKGshPT1pJiZrIT09ailzKz1wW2pdKnBba10vKDEtcFtqXSkqcFtpXS8oMS1wW2pdLXBba10pfQogICBvdXRbaV09c31yZXR1cm4gb3V0fQogLyog4piF5qC85LiK44GS6KOc5q2j77ya5a2m57+S5riI44G/44Oi44OH44Or44Gv552A6aCG44KS44Gd44Gu44G+44G+6KaL44KL44Gu44Gn44CB5LiL5L2N44Kw44Os44O844OJ44Gn44Gu5aW96LWw44GM6YeN6LOe44O7RzHjgafjgoLlkIzkvqHlgKTjgavjgarjgaPjgabjgYTjgZ/jgIIKICAgIOebtOi/kTPotbDjga7jgYbjgaEgT1Av6YeN6LOeKOOCr+ODqeOCuTUp44Gu6LWw44Gr44Gk44GE44Gm44CB5LuK5Zue44Gu44Kw44Os44O844OJ44Go44Gu5beu44Gg44GR6KOc5q2j44GZ44KL77yI44Kv44Op44K5NOS7peS4i+OBr+ODouODh+ODq+WBtOOBruijnOato+OBjOOBguOCi+OBruOBp+S6jOmHjeaOm+OBkeOBl+OBquOBhO+8ieOAggogICAgICDmoLzkuIrjgZLvvIjkvosgRzPihpJHMe+8ie+8muWlvei1sOOBruS+oeWApOOCkuWJsuOCiuW8leOBj++8iOedgOmghuOBjOiJr+OBhOOBu+OBqeWkp+OBjeOBj++8iQogICAgICDmoLzkuIvjgZLvvIjkvosgRzHihpJHMu+8ie+8muWHoei1sOOBruS+oeWApOOCkuWwkeOBl+aIu+OBmQogICAg5L+C5pWw44Gv5pqr5a6a5YCk44CC4pGgLTLjga7jgIzjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzmr5TovIPjgI3jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44KS5ZCM44GY6YGO5Y6744OH44O844K/44Gn5q+U44G544Gm56K66KqN44GZ44KL44GT44Go44CCICovCiBjb25zdCBHUkFERT17b246dHJ1ZSxLVVA6LjMwLEtETjouMTIsTUlOOi0uOSxNQVg6LjV9OwogZnVuY3Rpb24gZ3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApewogIGlmKCFHUkFERS5vbnx8KGNvbXAmJmNvbXAuZ3JhZGU9PT1mYWxzZSkpcmV0dXJuIDA7CiAgY29uc3QgR3Q9cmFjZS5ncmR8fDA7aWYoR3Q8MilyZXR1cm4gMDsKICBjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO2lmKCFofHwhaC5ydW5zLmxlbmd0aClyZXR1cm4gMDsKICBjb25zdCByYz1oLnJ1bnMuc2xpY2UoLTMpLFc9W1sxXSxbLjQsLjZdLFsuMiwuMywuNV1dW3JjLmxlbmd0aC0xXTtsZXQgZD0wOwogIHJjLmZvckVhY2goKHgsayk9Pntjb25zdCBmaW49eFsxXSxMPXhbNF18fDAsR3I9eFs1XXx8MDtpZihMIT09NXx8IShmaW4+MCkpcmV0dXJuOwogICBjb25zdCBncj1NYXRoLm1heChHciwyKTsgICAgICAgICAgLy8gT1Djg7vjgrDjg6zjg7zjg4nkuI3mmI7jga7jgq/jg6njgrk16LWw44GvIEczIOebuOW9k+OBqOOBl+OBpuavlOi8gwogICBpZihHdD5nciYmZmluPD01KWQtPVdba10qR1JBREUuS1VQKihHdC1ncikqKDYtZmluKS82OwogICBlbHNlIGlmKEd0PGdyJiZmaW4+PTQpZCs9V1trXSpHUkFERS5LRE4qKGdyLUd0KSpNYXRoLm1pbigxLChmaW4tMykvOCl9KTsKICByZXR1cm4gY2xhbXAoZCxHUkFERS5NSU4sR1JBREUuTUFYKX0KIGNvbnN0IEdOPVsi5LiN5piOL+S4i+e0miIsIk9Q44O7TCIsIkczIiwiRzIiLCJHMSJdOwogZnVuY3Rpb24gZ3JhZGVUYWdzKHRhZ3MsZHoscmFjZSl7Y29uc3QgdD10YWdzLnNsaWNlKCk7CiAgaWYoZHo8PS0uMil0LnVuc2hpZnQoe3Q6YOagvOS4iuOBkuaIpu+8iCR7R05bcmFjZS5ncmR8fDBdfe+8ie+8muS4i+S9jeOCsOODrOODvOODieOBruWlvei1sOOBr+WJsuW8lSAke2R6LnRvRml4ZWQoMil9YCxjOiJvIn0pOwogIGVsc2UgaWYoZHo+PS4xKXQudW5zaGlmdCh7dDpg6auY44Kw44Os44O844OJ44GL44KJ44Gu5qC85LiL44GSICR7ZHo+PTA/IisiOiIifSR7ZHoudG9GaXhlZCgyKX1gLGM6ImIifSk7CiAgcmV0dXJuIHR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogY29uc3QgTFZOPVsi5LiN5piOIiwi5pyq5Yud5YipIiwiMeWLnSIsIjLli50iLCIz5YudIiwiT1AiXTsKIGZ1bmN0aW9uIGV4dHJhVGFncyh0YWdzLHIsc3RvcmUscmFjZSl7CiAgY29uc3QgdD10YWdzLnNsaWNlKCksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxMdD1yYWNlLmx2bHx8MDsKICBpZihoKXtjb25zdCBsYXN0PWgucnVucy5sZW5ndGg/aC5ydW5zW2gucnVucy5sZW5ndGgtMV06bnVsbDsKICAgaWYobGFzdCYmbGFzdFs0XT4wJiZMdD4wJiZsYXN0WzRdIT09THQpdC51bnNoaWZ0KGxhc3RbNF08THQ/e3Q6YOaYh+e0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6Im8ifTp7dDpg6ZmN57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoiYiJ9KTsKICAgaWYoaC5sdiYmaC5sdlstMV0pdC5wdXNoKHt0OiLlnLDmlrnjgafjga7lh7rotbDjgYLjgorvvIjlibLlvJXoqZXkvqHvvIkiLGM6ImcifSl9CiAgcmV0dXJuIHR9CiAvKiDjg6njg7Pjgq/vvJrnqbTjgr7jg7zjg7Pjga7lubPlnYfjgavlr77jgZnjgovlgI3njofjgacgUy9BL0IvQ++8iOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44Gn77yJICovCiBjb25zdCBBVkdfSE9MRT17b2RkczouMDkxLHByb3h5Oi4xMTV9OwogZnVuY3Rpb24gcmF0aW5nKHBjLG1vZGUsbil7Y29uc3Qgcj1wYy9BVkdfSE9MRVttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9CiAvKiDnmoTkuK3njofph43oppbvvJrlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O777yI44Kq44OD44K644GM5YiG44GL44KL44Go44GN44Gv77yJ5Y2Y5YudMzDlgI3mnKrmuoDjga7lpKfnqbTjgpLpmaTjgY/jgILpgY7ljrvjga7mpJzoqLzjgafjgIHnmoTkuK3njofjgYzkuIrjgYzjgorjgIHlm57lj47njofjgYzmnIDmgqrjga7lpKfnqbTjgpLpgb/jgZHjgonjgozjgZ8gKi8KIGNvbnN0IEZPQ1VTX01BWF9PRERTPTMwOwogY29uc3QgRk9DVVM9eyJvZGRzIjp7Im4iOjM2MjUsImhpdCI6MC4yMzIsImJhc2VIaXQiOjAuMTcyLCJwZXJEYXkiOjEzLjZ9LCJwcm94eSI6eyJuIjo0MDI1LCJoaXQiOjAuMjcyLCJiYXNlSGl0IjowLjIxNywicGVyRGF5IjoxNS4xfX07ICAgLy8gMjAyNOW5tOS7pemZjeOBruaknOiovO+8mueahOS4reeOh++8iGJhc2VIaXQ95b6T5p2l44GuMeS9jeWAmeijnO+8ieODu+mWi+WCrOaXpeOBguOBn+OCiuOBrumgreaVsAogZnVuY3Rpb24gcGlja0ZvY3VzKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49MyYmKHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IlMifHxyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJBIikmJih4Lm9kZD09bnVsbHx8eC5vZGQ8Rk9DVVNfTUFYX09ERFMpKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogLyog56m06aas5YCZ6KOc77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuOAgeWlvei1sOeOh+OBrumrmOOBhOmghuOBqyBrIOmgreOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+WQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeWvvuixoeWkliAqLwogZnVuY3Rpb24gcGljayhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiBmdW5jdGlvbiBhbmFseXplKHJhY2Usc3RvcmUsb2Rkcyxjb21wLHBvcEFycil7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aDsKICBjb25zdCBzYz1SLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXApKTsKICBjb25zdCBkej1SLm1hcChyPT5ncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCkpOwogIGNvbnN0IHpjMD1NT0RFTC5jb3JlP1IubWFwKHI9Pm1vZGVsWigiY29yZSIsZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKSk6c2MubWFwKHg9Pngueik7Y29uc3QgemM9emMwLm1hcCgoeixpKT0+eitkeltpXSk7CiAgY29uc3QgcD1ub3JtYWxpemVUb3AzKHpjLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9TU9ERUwuZnVsbD9SLm1hcChyPT5tb2RlbFooImZ1bGwiLGZlYXRzKHIsc3RvcmUscmFjZSxOLHRydWUpKSk6Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7Y29uc3QgcHgyPXB4Lm1hcCgodixpKT0+ditkeltpXSk7cG9wPXB4Mi5tYXAodj0+MStweDIuZmlsdGVyKHk9Pnk+dikubGVuZ3RoKX0KICBjb25zdCByYW5rPXAubWFwKHY9PjErcC5maWx0ZXIoeD0+eD52KS5sZW5ndGgpOwogIGNvbnN0IGN1dD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSk7CiAgcmV0dXJuIFIubWFwKChyLGkpPT4oe2ksbm86ci5udW18fGkrMSxuYW1lOnIubmFtZXx8ci5ob3JzZSxwOnBbaV0scGM6Y2FsaWJGb3IocFtpXSxtb2RlKSxtb2RlLAogICBqbjooc3RvcmUuam9ja2V5KHIuam9ja2V5KXx8e246MH0pLm4scmFuazpyYW5rW2ldLHBvcDpwb3BbaV0sYmFzZTpNYXRoLm1pbiguNSwzL04pLAogICBvZGQ6KG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKT9vZGRzW2ldOm51bGwsCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgZHo6ZHpbaV0sdGFnczpncmFkZVRhZ3MoZXh0cmFUYWdzKHNjW2ldLnRhZ3MscixzdG9yZSxyYWNlKSxkeltpXSxyYWNlKSxjb25mOnNjW2ldLmNvbmYsbjpzY1tpXS5uLGN1dH0pKTsKIH0KCiAvKiA9PT09PSDpiYTmnb/ou7jppqzjg7vms6LkubHluqbvvIjnqbTppqzkuojmg7Pjgajjga/liKXjga7oqIjnrpfjgILkv4LmlbDjga8gdG9vbHMvYXhpc191cHNldF9zdHVkeS5qcyDjgaflrabnv5LjgIEyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5qSc6Ki877yJID09PT09ICovCiBjb25zdCBBWElTPXsid1AiOlswLjA1MTkzLDEuMDE0ODMsMC4wNTE0OCwtMC4yMDY3NiwtMC41MzIxNiwwLjkxNDM3LC0wLjQ4NDY0LC0wLjMyMTE1LC0wLjU2ODAyLC0wLjU1MTM1LDAuMTczNDUsMS4wOTc0LC0wLjI4NDA3LC0wLjEwMzk3LC0wLjIxNjE3LC0wLjM0NjY4LDAuMTU5MTMsMC4yMjE5NiwtMC4zODczMiwtMC4zNDY1OCwwLjAwMzcsLTAuNTY2NDZdLCJ3TyI6WzAuNTQyNTksMC4xNTY2MSwwLjA1NDE0LC0wLjA0MzcxLC0wLjE0NTI0LDAuMTMxNzEsLTAuMTQxNzgsLTAuMTYyNjMsMC4wNTMxNiwtMC4wMjA5NywwLjAwMzksLTAuMjk4NjUsLTAuMzIzMjEsLTAuMDEzNjUsLTAuMDk1MTksLTAuMDc4MTgsMC4wMDA2LC0wLjAyMjkxLC0wLjExMjEzLDAuMDE3ODEsLTAuMDQ3NDUsLTAuMTA4NTIsMC4yNTcyMSwwLjYzMDcxXSwidXBzZXQiOnsidGhyIjoxNSwibW9kZWxzIjp7InByb3h5IjpbMi4yNDU1OSwwLjYzODQxLC0wLjA3MDgsLTAuMDgxNjEsLTAuMDc3NDMsMC4wOTEzNywwLjEzODQ3LDAuMDAyNzksLTAuMzg5MTksLTAuNjQyMTcsLTAuNTUzODEsLTAuMDE4MzcsLTAuNDQzMTcsLTAuNzY4MjUsLTAuNTIzOTMsLTIuNzM1NjEsLTAuMTQ5MDksMC4xMTQ3N10sIm9kZHMiOlstMC43MjM5NiwwLjQyODA4LC0wLjA3NDk5LC0wLjA2MTU0LC0wLjAwNjc1LDAuMDcyNDMsMC4wNzA4NSwtMC4wNDk3NCwtMC4xNTUyOCwtMC4zMjUxNiwtMC40MTgyNiwtMC4zMTM1MSwwLjIwNzU3LC0wLjIzOSwtMC4yNzkwMSwtMS44MjEwOCwtMC4wMDg1MiwwLjA4Mzk5LDAuMTUwMjQsMC4zNTI0MiwtMi4wMzgzOSwyLjg1NjY4LDAuMjI5MjksMC43MjA4NCwtMS45Nzc5N119LCJncmFkZXMiOnsicHJveHkiOnsiY3V0cyI6W1siU1NTIiwwLjU1MDM3XSxbIlNTIiwwLjQ4NTVdLFsiUyIsMC40MDQyNF0sWyJBIiwwLjI5ODhdLFsiQiIsMC4xODk1N10sWyJDIiwwLjAwNjI5XV0sInJhdGVzIjp7IlNTUyI6MC41NzQsIlNTIjowLjUwOSwiUyI6MC40MzMsIkEiOjAuMzQ3LCJCIjowLjI0NCwiQyI6MC4wODl9LCJhdmdTIjp7IlNTUyI6MTcuMiwiU1MiOjE1LjMsIlMiOjE0LjIsIkEiOjEzLjEsIkIiOjExLjgsIkMiOjkuOH19LCJvZGRzIjp7ImN1dHMiOltbIlNTUyIsMC42MDk2OF0sWyJTUyIsMC41MTU5NV0sWyJTIiwwLjQwODU0XSxbIkEiLDAuMjg3NjddLFsiQiIsMC4xNzM1OV0sWyJDIiwwLjAwNzY4XV0sInJhdGVzIjp7IlNTUyI6MC42NzksIlNTIjowLjU5OCwiUyI6MC40NTUsIkEiOjAuMzUyLCJCIjowLjI0NiwiQyI6MC4wNzl9LCJhdmdTIjp7IlNTUyI6MTguNSwiU1MiOjE2LjQsIlMiOjE0LjUsIkEiOjEzLjMsIkIiOjExLjgsIkMiOjkuNn19fX0sImJhbmRzIjp7IumJhOadvyI6eyJsbyI6MC45MiwiaGkiOjEsIm4iOjE2NiwicmF0ZSI6MC45NjM5LCJsbzk1IjowLjkzNTUsIm4yIjo4NywicmF0ZTIiOjAuOTc3LCJwZXJEYXkiOjAuNjJ9LCLmupbpiYTmnb8iOnsibG8iOjAuODgsImhpIjowLjkyLCJuIjoyNzksInJhdGUiOjAuODg1MywibG85NSI6MC44NDc5LCJuMiI6MTM5LCJyYXRlMiI6MC44OTkzLCJwZXJEYXkiOjEuMDR9LCLloIXou7giOnsibG8iOjAuODQsImhpIjowLjg4LCJuIjo0NzQsInJhdGUiOjAuODQxOCwibG85NSI6MC44MDg5LCJuMiI6MjI2LCJyYXRlMiI6MC44NDA3LCJwZXJEYXkiOjEuNzh9fX07CiBmdW5jdGlvbiBheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHhjPVIubWFwKHI9PmZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSk7CiAgY29uc3QgcFA9bm9ybWFsaXplVG9wMyh4Yy5tYXAoeD0+ZG90KEFYSVMud1AseCkpLE1hdGgubWluKDMsTikpOwogIGxldCBwTz1udWxsOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLG0zPXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpOwogICBwTz1ub3JtYWxpemVUb3AzKHhjLm1hcCgoeCxpKT0+ZG90KEFYSVMud08sWy4uLngsTWF0aC5sb2cocHdbaV0pLGxvZ2l0KE1hdGgubWluKC45OCxtM1tpXSkpXSkpLE1hdGgubWluKDMsTikpfQogIHJldHVybntwUCxwTyx4Y319CiAvKiDpiYTmnb/ou7jppqzvvJrjgqrjg4PjgrrjgYzjgYLjgovjg6zjg7zjgrnjgaDjgZHjgILkuojmuKznorrnjofjga7ljLrliIbjgZTjgajjgavjgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS5re744GI44KLICovCiBmdW5jdGlvbiBheGlzUGlja3MocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7aWYoIWFwLnBPKXJldHVybiBudWxsOwogIGNvbnN0IG91dD1bXTthcC5wTy5mb3JFYWNoKChwLGkpPT57CiAgIGZvcihjb25zdCBrIG9mIFsi6YmE5p2/Iiwi5rqW6YmE5p2/Iiwi5aCF6Lu4Il0pe2NvbnN0IGI9QVhJUy5iYW5kc1trXTtpZihwPj1iLmxvJiZwPChrPT09IumJhOadvyI/MS4wMTpiLmhpKSl7b3V0LnB1c2goe2kscCx0aWVyOmsscmF0ZTpiLnJhdGUsbG85NTpiLmxvOTUsbjpiLm59KTticmVha319fSk7CiAgcmV0dXJuIG91dC5zb3J0KChhLGIpPT5iLnAtYS5wKX0KIC8qIOazouS5seW6pu+8mlNTU+OAnEPjgIIz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZEgKi8KIGZ1bmN0aW9uIHVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCxwcz1hcC5wUC5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7CiAgY29uc3QgbnM9Ui5tYXAocj0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5uOjB9KSxtb250aD1OdW1iZXIoU3RyaW5nKHJhY2UuZGF0ZSkuc2xpY2UoNSw3KSl8fDAsTD1yYWNlLmx2bHx8MDsKICBjb25zdCBmPVsxLE4vMTYsTD09PTE/MTowLEw9PT0yPzE6MCxMPT09Mz8xOjAsTD09PTQ/MTowLEw9PT01PzE6MCxyYWNlLnN1cmY9PT0xPzE6MCwocmFjZS5kaXN0fHwwKS8yMDAwLAogICBucy5maWx0ZXIobj0+bj09PTApLmxlbmd0aC9OLG5zLmZpbHRlcihuPT5uPDMpLmxlbmd0aC9OLG5zLnJlZHVjZSgoYSxuKT0+YStNYXRoLmxvZygxK24pLDApL04vMywKICAgcHNbMF0scHNbMV0scHNbMl0scHMucmVkdWNlKChhLHApPT5hK3AqcCwwKSxwcy5maWx0ZXIocD0+cD4uNSkubGVuZ3RoLzMsbW9udGg+PTYmJm1vbnRoPD05PzE6MF07CiAgbGV0IG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKS5zb3J0KChhLGIpPT5iLWEpLG9kPW9kZHMuc2xpY2UoKS5zb3J0KChhLGIpPT5hLWIpOwogICBjb25zdCBlbnQ9LXB3LnJlZHVjZSgoYSxwKT0+YStwKk1hdGgubG9nKHApLDApL01hdGgubG9nKE4pOwogICBmLnB1c2gocHdbMF0scHdbMV0scHdbMF0rcHdbMV0rcHdbMl0sZW50LE1hdGgubG9nKG9kWzBdKSxNYXRoLmxvZyhvZFsxXSksb2QuZmlsdGVyKG89Pm88MTApLmxlbmd0aC9OKTttb2RlPSJvZGRzIn0KICByZXR1cm57Zixtb2RlLHAwOnNpZ21vaWQoZG90KEFYSVMudXBzZXQubW9kZWxzW21vZGVdLGYpKX19CiBmdW5jdGlvbiB1cHNldEdyYWRlKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgY29uc3QgdT11cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2RkcyxhcCksbW9kZT11Lm1vZGUscD11LnAwLEc9QVhJUy51cHNldC5ncmFkZXNbbW9kZV07CiAgbGV0IGdyYWRlPSJDIjtmb3IoY29uc3QgW2csY10gb2YgRy5jdXRzKXtpZihwPj1jKXtncmFkZT1nO2JyZWFrfX0KICByZXR1cm57Z3JhZGUscCxtb2RlLHJhdGU6Ry5yYXRlc1tncmFkZV0sYXZnUzpHLmF2Z1NbZ3JhZGVdfX0KCiAvKiDmiZXmiLvjgaTjgY3mmYLns7vliJfjg5Djg4Pjgq/jg4bjgrnjg4jjgIJyYWNlcyDjga/ml6Xku5jmmIfpoIYgW3tpZCxkYXRlLHJvd3N9XeOAgXBheUJ5SWQg44GvIHtyYWNlSWQ6e3BsYWNlOlt7bnVtYmVyLHllbn1dfX3jgIIKICAgIOeptOOCvuODvOODs+OBr+Wun+OCquODg+OCuumghuS9jeOBp+Wumue+qe+8iOODhOODvOODq+OBruOCquODg+OCuuWFpeWKm+ODouODvOODieOBqOWQjOOBmOeKtuazge+8ieOAguWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOAgiAqLwogZnVuY3Rpb24gYmFja3Rlc3QocmFjZXMscGF5QnlJZCxvcHRzKXsKICBvcHRzPW9wdHN8fHt9O2NvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIiLFNQTElUPW9wdHMuc3BsaXR8fCIiLE9PUz1vcHRzLm9vc3x8IiIsUFJPWFk9ISFvcHRzLnByb3h5LE1JTkc9TnVtYmVyKG9wdHMubWluR3JkKXx8MCxfZ09uPUdSQURFLm9uO0dSQURFLm9uPSFvcHRzLmdyYWRlT2ZmOwogIGNvbnN0IG5hbWVzPVsidG9wMSIsInRvcDIiLCJ0b3AzIiwiYWxsSG9sZSIsInZhbHVlIiwiYXhpcyIsImZvY3VzIl0scGVyPVsiYWxsIiwiQSIsIkIiLCJDIl07CiAgY29uc3QgUz17fTtmb3IoY29uc3QgbiBvZiBuYW1lcyl7U1tuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpU1tuXVtwXT17YmV0czowLGhpdHM6MCxyZXQ6MCxzcTowfX0KICBjb25zdCBTRUc9e307ICAgLy8gMeS9jeWAmeijnOOBruadoeS7tuWIpe+8iOWFqOacn+mWk++8j+WJjeWNiu+8j+W+jOWNiu+8iQogIGNvbnN0IHN0b3JlPW5ldyBTdG9yZSgpO2xldCB1c2VkPTA7CiAgY29uc3QgYWRkPShuLHAsaGl0LHllbik9Pntjb25zdCB4PVNbbl1bcF07eC5iZXRzKys7aWYoaGl0KXguaGl0cysrO3gucmV0Kz15ZW47eC5zcSs9eWVuKnllbn07CiAgY29uc3QgYWRkU2VnPShsYWJlbCxwLHllbik9Pntjb25zdCBnPVNFR1tsYWJlbF09U0VHW2xhYmVsXXx8e2FsbDp7bjowLGg6MCxyOjAscTowfSxBOntuOjAsaDowLHI6MCxxOjB9LEI6e246MCxoOjAscjowLHE6MH19O2Zvcihjb25zdCBrIG9mIFsiYWxsIixwXSl7Y29uc3QgeD1nW2tdO3gubisrO2lmKHllbj4wKXguaCsrO3gucis9eWVuO3gucSs9eWVuKnllbn19OwogIGNvbnN0IEFWPVBST1hZPy4xMTU6LjA5MTsKICBmb3IoY29uc3QgcmMgb2YgcmFjZXMpewogICAvLyDmiZXmiLvjga5JROOBr+OAjOaXpeS7mC3plovlgqzloLQtUueVquWPt+OAjeOAguODkOODg+OCr+OCouODg+ODl+OBrjEy5qGBSUTjgajjgoLjgIHlkIzjgZjlvaLlvI/jga5JROOBqOOCgue1kOOBs+S7mOOBkeOCiwogICBjb25zdCB2T2Y9L15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSg0LDYpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVszXXx8IiIsck9mPU51bWJlcigvXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDEwLDEyKTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbNF18fDApOwogICBjb25zdCBwYXk9cGF5QnlJZFtyYy5pZF18fHBheUJ5SWRbYCR7cmMuZGF0ZX0tJHt2T2Z9LSR7U3RyaW5nKHJPZikucGFkU3RhcnQoMiwiMCIpfWBdOwogICBpZihwYXkmJnBheS5wbGFjZSYmcGF5LnBsYWNlLmxlbmd0aCYmcmMuZGF0ZT49U1RBUlQmJighTUlOR3x8KChyYy5yb3dzWzBdJiZyYy5yb3dzWzBdLmdyZCl8fDApPj1NSU5HKSl7CiAgICAvLyDlh7rotbDooajjgajlkIzjgZjppqznlarpoIbjgavkuKbjgbnjgovvvIjlkIzngrnjga7jgajjgY3jga7kuKbjgbPjgafnnYDpoIbjgYzmvI/jgozjgarjgYTjgojjgYbjgavvvIkKICAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgICBjb25zdCBoYXNPZGRzPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIub2Rkcz4xKSxoYXNQb3A9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5wb3A+MCk7CiAgICBpZihQUk9YWT9SLmxlbmd0aD49NjooaGFzT2Rkc3x8aGFzUG9wKSl7CiAgICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LGx2bDpSWzBdLmx2bHx8MCxncmQ6UlswXS5ncmR8fDAscnVubmVyczpSfTsKICAgICBjb25zdCByZXM9UFJPWFk/YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwpOihoYXNPZGRzP2FuYWx5emUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTphbmFseXplKHJhY2Usc3RvcmUsbnVsbCxudWxsLFIubWFwKHI9PnIucG9wKSkpOwogICAgIGNvbnN0IHllbj1uZXcgTWFwKHBheS5wbGFjZS5tYXAoeD0+W3gubnVtYmVyLHgueWVuXSkpOwogICAgIGNvbnN0IGhvbGU9cmVzLmZpbHRlcih4PT54LmhvbGUpLnNvcnQoKGEsYik9PmIucC1hLnApOwogICAgIGlmKGhvbGUubGVuZ3RoKXsKICAgICAgdXNlZCsrO2NvbnN0IHByPVNQTElUPyhyYy5kYXRlPFNQTElUPyJBIjoiQiIpOiJBIjsKICAgICAgY29uc3QgYnV5PShuLGxpc3QpPT57Zm9yKGNvbnN0IHggb2YgbGlzdCl7Y29uc3QgeT15ZW4uZ2V0KFJbeC5pXS5udW0pfHwwO2FkZChuLCJhbGwiLHk+MCx5KTthZGQobixwcix5PjAseSk7aWYoT09TJiZyYy5kYXRlPj1PT1MpYWRkKG4sIkMiLHk+MCx5KX19OwogICAgICBidXkoImZvY3VzIixwaWNrRm9jdXMocmVzLDEpKTsKICAgICAgYnV5KCJ0b3AxIixwaWNrKHJlcywxKSk7YnV5KCJ0b3AyIixwaWNrKHJlcywyKSk7YnV5KCJ0b3AzIixwaWNrKHJlcywzKSk7YnV5KCJhbGxIb2xlIixob2xlKTsKICAgICAgaWYoIVBST1hZKWJ1eSgidmFsdWUiLGhvbGUuZmlsdGVyKHg9PngudmFsdWU+PTEuMykpOwogICAgICBpZighUFJPWFkmJmhhc09kZHMpe2NvbnN0IGFwPWF4aXNQcm9icyhyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2lmKGFwLnBPKWJ1eSgiYXhpcyIsYXAucE8ubWFwKChwLGkpPT4oe2kscH0pKS5maWx0ZXIoeD0+eC5wPj1BWElTLmJhbmRzWyLpiYTmnb8iXS5sbykpfQogICAgICBjb25zdCB0PXBpY2socmVzLDEpWzBdOwogICAgICBpZih0KXtjb25zdCB5PXllbi5nZXQoUlt0LmldLm51bSl8fDAscj10LnBjL0FWLE49Ui5sZW5ndGg7CiAgICAgICBjb25zdCByYW5rPShyPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyIpOwogICAgICAgYWRkU2VnKCLjg6njg7Pjgq8iKyh0Lm48MiYmKHJhbms9PT0iUyJ8fHJhbms9PT0iQSIpPyJCIjpyYW5rKSxwcix5KTsKICAgICAgIGFkZFNlZyhOPD0xMD8i6aCt5pWwIOOAnDEwIjpOPD0xND8i6aCt5pWwIDEx44CcMTQiOiLpoK3mlbAgMTXjgJwiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2Uuc3VyZj09PTE/IuiKnSI6cmFjZS5zdXJmPT09Mj8i44OA44O844OIIjoi44Gd44Gu5LuWIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLmx2bD4wPyLjgq/jg6njgrkgIitMVk5bcmFjZS5sdmxdOiLjgq/jg6njgrkg5LiN5piOIixwcix5KTsKICAgICAgIGFkZFNlZyh0Lm4+PTU/IuWun+e4viA16LWw5Lul5LiKIjp0Lm4+PTM/IuWun+e4viAz44CcNOi1sCI6IuWun+e4viAz6LWw5pyq5rqAIixwcix5KTsKICAgICAgIGlmKCFQUk9YWSYmdC5vZGQpe2NvbnN0IG89dC5vZGQ7YWRkU2VnKG88OD8i5Y2Y5YudIOOAnDjlgI0iOm88MTU/IuWNmOWLnSA444CcMTXlgI0iOm88MzA/IuWNmOWLnSAxNeOAnDMw5YCNIjpvPDYwPyLljZjli50gMzDjgJw2MOWAjSI6IuWNmOWLnSA2MOWAjeOAnCIscHIseSk7CiAgICAgICAgaWYoaGFzT2Rkcyl7Y29uc3QgdWc9dXBzZXRHcmFkZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2FkZFNlZygi5rOi5Lmx5bqmICIrdWcuZ3JhZGUscHIseSl9fX0KICAgICB9CiAgICB9CiAgIH0KICAgZm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgfQogIGNvbnN0IGZpbj17fTsKICBmb3IoY29uc3QgbiBvZiBuYW1lcyl7ZmluW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcil7Y29uc3QgeD1TW25dW3BdOwogICBpZigheC5iZXRzKXtmaW5bbl1bcF09e2JldHM6MH07Y29udGludWV9CiAgIGNvbnN0IG1lYW49eC5yZXQveC5iZXRzLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHguc3EveC5iZXRzLW1lYW4qbWVhbikpOwogICBmaW5bbl1bcF09e2JldHM6eC5iZXRzLGhpdFJhdGU6eC5oaXRzL3guYmV0cyxyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHguYmV0cykvMTAwfX19CiAgY29uc3Qgc2Vncz17fTsKICBmb3IoY29uc3QgW2ssZ10gb2YgT2JqZWN0LmVudHJpZXMoU0VHKSl7c2Vnc1trXT17fTtmb3IoY29uc3QgcCBvZiBbImFsbCIsIkEiLCJCIl0pe2NvbnN0IHg9Z1twXTsKICAgaWYoIXgubil7c2Vnc1trXVtwXT17YmV0czowfTtjb250aW51ZX1jb25zdCBtZWFuPXguci94Lm4sc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5xL3gubi1tZWFuKm1lYW4pKTsKICAgc2Vnc1trXVtwXT17YmV0czp4Lm4saGl0UmF0ZTp4LmgveC5uLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5uKS8xMDB9fX0KICBHUkFERS5vbj1fZ09uO3JldHVybntyYWNlczp1c2VkLHN0YXRzOmZpbixzZWdzfTsKIH0KIHJldHVybnt1cHNldEZlYXR1cmVzLGNsZWFuVHIsR1JBREUsZ3JhZGVUaWVyLGdyYWRlQWRqLEZPQ1VTLHJhdGluZyxwaWNrRm9jdXMsQVhJUyxheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDjgqLjg5fjg6rlsaTvvIjlho3mp4vnr4nvvIkKICogIOODu+S/neWtmC/lho3plovjgaTjgY3jga7pgY7ljrvjg4fjg7zjgr/lj5blvpfjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjgIHmpJzoqLzjga/jgIHli5XkvZznorroqo3muIjjgb/jga7lh6bnkIbjgpLjgZ3jga7jgb7jgb7lho3liKnnlKgKICogIOODu+S7iumAseacq+OBruWPluW+l+OAgemojuaJi+ODu+iqv+aVmeW4q+OBrueFp+WQiOOAgeacn+W+heWApOOAgei2hemJhOadv+OAgeazouS5seW6puOAgeWPluOCiui+vOOBv+WTgeizquOBruihqOekuuOBr+aWsOimjwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiOwpjb25zdCBWRU5VRT17IjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLCIwNiI6IuS4reWxsSIsIjA3Ijoi5Lit5LqsIiwiMDgiOiLkuqzpg70iLCIwOSI6IumYquelniIsIjEwIjoi5bCP5YCJIn07CmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBwY3Q9KHgsaz0wKT0+eD09bnVsbHx8IU51bWJlci5pc0Zpbml0ZSh4KT8iLSI6KHgqMTAwKS50b0ZpeGVkKGspKyIlIjsKCmZ1bmN0aW9uIG9wZW5EQigpe3JldHVybiBuZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgcj1pbmRleGVkREIub3BlbigidXBzZXRfdG9vbF9kYiIsMik7CiByLm9udXBncmFkZW5lZWRlZD1lPT57Y29uc3QgZD1lLnRhcmdldC5yZXN1bHQ7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygiZmlsZXMiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJmaWxlcyIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoIm1ldGEiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJtZXRhIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygicGF5IikpZC5jcmVhdGVPYmplY3RTdG9yZSgicGF5Iil9Owogci5vbnN1Y2Nlc3M9KCk9PntEQj1yLnJlc3VsdDtvaygpfTtyLm9uZXJyb3I9KCk9Pm5nKHIuZXJyb3IpO3Iub25ibG9ja2VkPSgpPT5uZyhuZXcgRXJyb3IoIuS7luOBruOCv+ODluOBp+S9v+eUqOS4reOBp+OBmSIpKX0pfQpjb25zdCBpZGJBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJmaWxlcyIpLm9iamVjdFN0b3JlKCJmaWxlcyIpLmdldEFsbCgpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiUHV0PShrLHYpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJmaWxlcyIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgiZmlsZXMiLGspO29rKCl9O3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgaWRiQ2xlYXI9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpLHN0PXQub2JqZWN0U3RvcmUoImZpbGVzIik7c3Qub3BlbkN1cnNvcigpLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7aWYoIVN0cmluZyhjLmtleSkuc3RhcnRzV2l0aCgibGl2ZToiKSl7bWFya0RpcnR5KCJmaWxlcyIsYy5rZXkpO2MuZGVsZXRlKCl9Yy5jb250aW51ZSgpfX07dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKCi8qIOWPluOCiui+vOOBv+a4iOOBv+OBruWFqOihjO+8iOODkOODg+OCr+OCouODg+ODl0NTVu+8i+WPluW+l+a4iOOBv+OBruaIkOe4vu+8ieOCkumghuOBq+a4oeOBmSAqLwphc3luYyBmdW5jdGlvbiBmb3JFYWNoUm93KGNiKXsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXtjb25zdCBmPWZzW2ldOwogIGlmKGYubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZi5yb3dzfHxbXSljYihsaXZlUm93KHgpKX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKWNiKFVFLnRvUm93KG8pKTsKICBpZihpJTM9PT0yKWF3YWl0IHNsZWVwKDApfQp9Ci8qIOODrOODvOOCuUlE44GL44KJ6ZaL5YKs5aC044O7UueVquWPt++8iDEy5qGB44GuSlJB5b2i5byP77yP5pel5LuYLemWi+WCrOWgtC1S5b2i5byP44Gu5Lih5a++5b+c77yJICovCmZ1bmN0aW9uIHZlbnVlT2ZJZChpZCl7cmV0dXJuIC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoNCw2KTpTdHJpbmcoaWQpLnNwbGl0KCItIilbM118fCIifQpmdW5jdGlvbiByYWNlTm9PZklkKGlkKXtyZXR1cm4gTnVtYmVyKC9eXGR7MTJ9JC8udGVzdChpZCk/aWQuc2xpY2UoMTAsMTIpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVs0XXx8MCl9CgovKiAtLS0g5Y+W44KK6L6844G/IC0tLSAqLwphc3luYyBmdW5jdGlvbiBpbXBvcnRGaWxlKGZpbGUpewogYnVzeSh0cnVlLCLjg5XjgqHjgqTjg6vjgpLoqq3jgb/ovrzjgb/kuK3igKZcbuWkp+OBjeOBhOODleOCoeOCpOODq+OBr+aVsOWNgeenkuOBi+OBi+OCiuOBvuOBmeOAgiIpO2F3YWl0IHNsZWVwKDMwKTsKIHRyeXsKICBjb25zdCB0ZXh0PWF3YWl0IGZpbGUudGV4dCgpO2xldCBpdGVtczsKICBpZigvXC5jc3YkL2kudGVzdChmaWxlLm5hbWUpKXtpdGVtcz1be3R5cGU6InJhY2UtcmVzdWx0cyIseWVhcjowLHBsYWNlOmZpbGUubmFtZSxjc3Y6dGV4dH1dfQogIGVsc2V7Y29uc3Qgaj1KU09OLnBhcnNlKHRleHQpO2l0ZW1zPUFycmF5LmlzQXJyYXkoaik/ajooai5maWxlc3x8W2pdKX0KICBpdGVtcz1pdGVtcy5maWx0ZXIoeD0+eCYmdHlwZW9mIHguY3N2PT09InN0cmluZyIpOwogIGlmKCFpdGVtcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCJjc3bjgpLlkKvjgoDjg4fjg7zjgr/jgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgILjg5Djg4Pjgq/jgqLjg4Pjg5dKU09O44GL44CBQ1NW44KS6YG444KT44Gn44GP44Gg44GV44GE44CCIik7CiAgYXdhaXQgaWRiQ2xlYXIoKTtsZXQgbj0wOwogIGZvcihsZXQgaT0wO2k8aXRlbXMubGVuZ3RoO2krKyl7Y29uc3QgaXQ9aXRlbXNbaV07YXdhaXQgaWRiUHV0KGAke2l0LnllYXJ8fDB9OiR7aXQucGxhY2V9OiR7aX1gLHt5ZWFyOml0LnllYXIscGxhY2U6aXQucGxhY2UscGxhY2VOYW1lOml0LnBsYWNlTmFtZSxjc3Y6aXQuY3N2fSk7CiAgIG4rPU1hdGgubWF4KDAsaXQuY3N2LnNwbGl0KCJcbiIpLmxlbmd0aC0xKTskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PWDkv53lrZjkuK3igKYgJHtpKzF9LyR7aXRlbXMubGVuZ3RofWA7YXdhaXQgc2xlZXAoMCl9CiAgU1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluOCiui+vOOBv+WujOS6hu+8miR7aXRlbXMubGVuZ3RofeODleOCoeOCpOODq++8j+e0hCR7bi50b0xvY2FsZVN0cmluZygpfeihjDwvc3Bhbj5gOwogIGJrU2NoZWR1bGUoKTsKIH1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5Y+W44KK6L6844G/44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7YnVzeShmYWxzZSl9Cn0KCmNvbnN0IHBheUFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oInBheSIpLm9iamVjdFN0b3JlKCJwYXkiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IHBheVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oInBheSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoInBheSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgicGF5IixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IG1ldGFHZXQ9az0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oIm1ldGEiKS5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHQpO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgbWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJtZXRhIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCx3YWl0c0FyZyl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdhaXRzQXJnfHx3aW5kb3cuX19XQUlUU3x8WzQwMDAsMTIwMDAsMzAwMDAsNjAwMDBdOwogZm9yKGxldCB0PTA7dDw9d2FpdHMubGVuZ3RoO3QrKyl7CiAgdHJ5ewogICBjb25zdCByPWF3YWl0IGZldGNoKHVybCk7Y29uc3QgdHh0PWF3YWl0IHIudGV4dCgpO2xldCB4PXt9O3RyeXt4PUpTT04ucGFyc2UodHh0KX1jYXRjaChlKXt9CiAgIGlmKCFyLm9rfHx4Lm9rPT09ZmFsc2Upe2NvbnN0IGU9bmV3IEVycm9yKHguZXJyb3J8fGBIVFRQICR7ci5zdGF0dXN9YCsodHh0JiYheC5lcnJvcj9g77yIJHt0eHQucmVwbGFjZSgvXHMrL2csIiAiKS5zbGljZSgwLDUwKX3vvIlgOiIiKSk7ZS5zdGF0dXM9ci5zdGF0dXM7dGhyb3cgZX0KICAgcmV0dXJuIHg7CiAgfWNhdGNoKGUpewogICBlcnI9ZS5tZXNzYWdlO2NvbnN0IHJldHJ5PSFlLnN0YXR1c3x8ZS5zdGF0dXM+PTUwMHx8ZS5zdGF0dXM9PT00Mjk7CiAgIGlmKCFyZXRyeXx8dD09PXdhaXRzLmxlbmd0aClicmVhazsKICAgaWYoU1lOQ0lORykkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YOa3t+mbkeOBruOBn+OCgSR7TWF0aC5yb3VuZCh3YWl0c1t0XS8xMDAwKX3np5LlvoXjgaPjgablho3oqabooYzjgZfjgb7jgZnigKbvvIgke2Vycn3vvIlgOwogICBhd2FpdCBzbGVlcCh3YWl0c1t0XSk7CiAgfQogfQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QgTU9ERUxfVFJBSU5fRU5EPSIyMDI2LTA2LTIyIjsgICAvLyDnj77lnKjjga7jg6Ljg4fjg6vjga/jgIHjgZPjga7ml6XjgojjgorliY3jga7miJDnuL7jgaflrabnv5IKY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH0KfTsKCgovKiAtLS0g5omV5oi744Gu5pu444GN5Ye644GX44O76Kqt44G/6L6844G/IC0tLSAqLwokKCJwYXlFeHAiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpcmV0dXJuIGFsZXJ0KCLmiZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgIIiKTsKIGNvbnN0IGE9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYSIpO2EuaHJlZj1VUkwuY3JlYXRlT2JqZWN0VVJMKG5ldyBCbG9iKFtKU09OLnN0cmluZ2lmeShwcyldLHt0eXBlOiJhcHBsaWNhdGlvbi9qc29uIn0pKTsKIGEuZG93bmxvYWQ9YGtlaWJhX3BheW91dHNfJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCl9Lmpzb25gO2EuY2xpY2soKTtzZXRUaW1lb3V0KCgpPT5VUkwucmV2b2tlT2JqZWN0VVJMKGEuaHJlZiksMTAwMCl9OwokKCJwYXlJbXAiKS5vbmNoYW5nZT1hc3luYyBlPT57CiBjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKCFmKXJldHVybjsKIHRyeXtjb25zdCBqPUpTT04ucGFyc2UoYXdhaXQgZi50ZXh0KCkpO2NvbnN0IGFycj1BcnJheS5pc0FycmF5KGopP2o6KGoucmFjZXM/W2pdOltdKTsKICBjb25zdCBieURhdGU9bmV3IE1hcCgpOwogIGZvcihjb25zdCB4IG9mIGFycil7aWYoeCYmQXJyYXkuaXNBcnJheSh4LnJhY2VzKSYmeC5kYXRlKWJ5RGF0ZS5zZXQoeC5kYXRlLHtkYXRlOnguZGF0ZSxyYWNlczp4LnJhY2VzLGZhaWxlZDp4LmZhaWxlZHx8MH0pfQogIGZvcihjb25zdFtkLHJdb2YgYnlEYXRlKWF3YWl0IHBheVB1dChkLHIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH1jYXRjaChlcnIpeyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kqt44G/6L6844G/44Ko44Op44O877yaJHtlc2MoZXJyLm1lc3NhZ2UpfTwvc3Bhbj5gfQogZS50YXJnZXQudmFsdWU9IiI7Cn07CgoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTsKICBidXN5KHRydWUsIuOCquODg+OCuuacquWFpeWKm+OBruWgtOWQiOOCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXRQPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkQscHJveHk6dHJ1ZX0pO2J1c3koZmFsc2UpO3RyeXtzZXRHYXRlKG91dCxvdXRQKX1jYXRjaChlKXtjb25zb2xlLmVycm9yKGUpfQogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgre+8iOWfuua6lu+8iSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu477yIMC45MuS7peS4iuODu+OCquODg+OCuuaZgu+8iSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgY29uc3QgdGJsPShvLHRpdGxlKT0+ewogICBsZXQgdD1gPGI+JHt0aXRsZX08L2I+PGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke28ucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjx0aD7lrabnv5Llvow8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IHY9by5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgIHQrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQy5iZXRzP2Ake3BjdCh2LkMucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsodi5DLnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3YuQy5iZXRzLnRvTG9jYWxlU3RyaW5nKCl977yJPC9zcGFuPmA6Ii0ifTwvdGQ+PC90cj5gfQogICByZXR1cm4gdCsiPC90Ym9keT48L3RhYmxlPiJ9OwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtzdGFydH3jgJzvvI/liY3ljYrvvJ0ke3NwbGl0feOCiOOCiuWJjeOAgeW+jOWNiu+8neS7pemZje+8j+WQhDEwMOWGhjwvZGl2Pjxicj5gK3RibChvdXQsIuKRoCDjgqrjg4PjgrrlhaXlipvmmYLvvIjlrp/pmpvjga7kurrmsJfjgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvIkiKSsiPGJyPiIrdGJsKG91dFAsIuKRoSDjgqrjg4PjgrrmnKrlhaXlipvmmYLvvIjjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICAvLyDmnaHku7bliKXvvIjjg4Tjg7zjg6sx5L2N44Gu5Zue5Y+O546H77yJCiAgY29uc3Qgc2VnUm93cz1PYmplY3QuZW50cmllcyhvdXQuc2VncykuZmlsdGVyKChbLHZdKT0+di5hbGwuYmV0cz49MzAwKS5zb3J0KChhLGIpPT5hWzBdPGJbMF0/LTE6MSk7CiAgaWYoc2VnUm93cy5sZW5ndGgpe2grPWA8YnI+PGI+4pGiIOODhOODvOODqzHkvY3jga7mnaHku7bliKXvvIjikaDjga7loLTlkIjvvIk8L2I+PGRpdiBjbGFzcz0ic21hbGwiPuizvOWFpTMwMOWbnuS7peS4iuOBruadoeS7tuOBruOBv+OAguWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBi+OCkuimi+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7mnaHku7Y8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgW2ssdl0gb2Ygc2VnUm93cyloKz1gPHRyPjx0ZD4ke2VzYyhrKX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT4ifQogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuimi+aWue+8muOAjOWtpue/kuW+jOOAjeOBr+OAgeODouODh+ODq+OBruWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iCR7TU9ERUxfVFJBSU5fRU5EfeS7pemZje+8ieOBp+OAgeacgOOCguS/oemgvOOBp+OBjeOCi+WIl+OBp+OBmeOAguOBneOCjOS7peWJjeOBruacn+mWk+OBr+OAgeODouODh+ODq+OBjOetlOOBiOOCkuimi+OBpuOBhOOCi+OBn+OCgeOAgeOChOOChOiJr+OBj+WHuuOBvuOBmeOAguWbnuWPjueOh+OBruOAjMKx44CN44GvOTUl44Gu6Kqk5beu44Gu5bmF44Gn44CBMTAwJeOCkuS4i+WbnuOCi+S4i+mZkOOBquOCieWIqeebiuOBqOOBr+iogOOBiOOBvuOBm+OCk+OAguadoeS7tuWIpeOBr+OAgeaOouOBmeOBu+OBqeWBtueEtuOBrumrmOOBhOadoeS7tuOCkuaLvuOBhOOChOOBmeOBhOOBruOBp+OAgeWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBruOCguOBruOBoOOBkeOCkuWPguiAg+OBq+OBl+OBpuOBj+OBoOOBleOBhOOAguWmmeWRs++8iOW4guWgtOOBqOOBruW3ru+8ieOBr+OAgeaknOiovOOBp+Wfuua6luOCiOOCiuaCquOBi+OBo+OBn+OBn+OCgeOAgeWIpOaWreOBq+OBr+S9v+OCj+OBquOBhOOBp+OBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgovKiAtLS0g4pGgLTMg44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD77yI6YeN6LOe44Gu44G/44O75ZCM44GY6YGO5Y6744OH44O844K/44Gn6KOc5q2j44GC44KKL+OBquOBl++8iSAtLS0gKi8KJCgiYnRHcmFkZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogdHJ5ewogIGNvbnN0IHBzPWF3YWl0IHBheUFsbCgpO2lmKCFwcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr4pGg44Gn5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHBheUJ5SWQ9e307cHMuZm9yRWFjaChwPT4ocC5yYWNlc3x8W10pLmZvckVhY2goeD0+e3BheUJ5SWRbeC5yYWNlSWRdPXh9KSk7CiAgY29uc3Qgc3RhcnQ9JCgiYnRTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSIscGRhdGVzPXBzLm1hcChwPT5wLmRhdGUpLmZpbHRlcihkPT5kPj1zdGFydCkuc29ydCgpOwogIGlmKCFwZGF0ZXMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumWi+Wni+aXpeS7pemZjeOBruaJleaIu+OBjOOBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj4nO3JldHVybn0KICBidXN5KHRydWUsIuaIkOe4vuOCkuiqreOBv+i+vOOBv+S4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBtYXA9bmV3IE1hcCgpO2xldCBncmFkZWQ9MDsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgcmFjZXMuZm9yRWFjaCh4PT57aWYoKHgucm93c1swXS5ncmR8fDApPj0yKWdyYWRlZCsrfSk7CiAgaWYoIWdyYWRlZCl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga7kuK3jgavjgIFHMeOAnEcz44Go5Yik5Yil44Gn44GN44KL44Os44O844K544GM44GC44KK44G+44Gb44KT77yI44Kv44Op44K56KGo6KiY44O7MeedgOiznumHkeOBjOeEoeOBhO+8ieOAguOCsOODrOODvOODieijnOato+OBruWKueaenOOBr+aknOiovOOBp+OBjeOBvuOBm+OCk+OAguKRpOOBruWun+ihjOaZguOBr+ODrOODvOOCueWQjeODu+WHuummrOihqOOBruOCsOODrOODvOODieihqOiomOOBp+ijnOato+OBleOCjOOBvuOBmeOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBiYXNlPXtzdGFydCxzcGxpdDoiIixvb3M6TU9ERUxfVFJBSU5fRU5ELG1pbkdyZDoyfTsKICBidXN5KHRydWUsIuijnOato+OBguOCii/jgarjgZfjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb249VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCxiYXNlKSxvZmY9VUUuYmFja3Rlc3QocmFjZXMscGF5QnlJZCx7Li4uYmFzZSxncmFkZU9mZjp0cnVlfSk7YnVzeShmYWxzZSk7CiAgY29uc3QgTD17dG9wMToi44OE44O844OrMeS9jSIsdG9wMjoi5LiK5L2NMumgrSIsdG9wMzoi5LiK5L2NM+mgrSIsYWxsSG9sZToi56m044K+44O844Oz5YWo6aCtIixmb2N1czoi4peO55qE5Lit546H6YeN6KaW44GuMeS9jSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7eC5iZXRzfe+8iTwvc3Bhbj5gOiItIjsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoe+8mumHjeiznu+8iEcx44CcRzPvvIkke29uLnJhY2VzfeODrOODvOOCueOAguWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+OAgeijnOato+OBguOCii/jgarjgZfjga7nmoTkuK3njofjg7vlm57lj47njocoOTUl5bmFKeOCkuavlOi8g+OBl+OBpuOBhOOBvuOBmeOAguS7tuaVsOOBjOWwkeOBquOBhOOBqOW3ruOBr+WBtueEtuOBruevhOWbsuOBp+OBme+8iOWbnuWPjueOh+OBrsKx5bmF44GM6YeN44Gq44KL44Gq44KJ5beu44Gv5Yik5pat44Gn44GN44G+44Gb44KT77yJ44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPueahOS4reeOhyDjgYLjgoo8L3RoPjx0aD7nmoTkuK3njocg44Gq44GXPC90aD48dGg+5Zue5Y+O546HIOOBguOCijwvdGg+PHRoPuWbnuWPjueOhyDjgarjgZc8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3QgYT1vbi5zdGF0c1trXS5hbGwsYj1vZmYuc3RhdHNba10uYWxsO2lmKCFhfHwhYS5iZXRzKWNvbnRpbnVlOwogICBoKz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHsoYS5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHtiJiZiLmJldHM/KGIuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSkrIiUiOiItIn08L3RkPjx0ZD48Yj4ke2MoYSl9PC9iPjwvdGQ+PHRkPiR7YyhiKX08L3RkPjwvdHI+YH0KICAkKCJidE91dCIpLmlubmVySFRNTD1oKyI8L3Rib2R5PjwvdGFibGU+IjsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOiHquWLleODkOODg+OCr+OCouODg+ODl++8iENsb3VkZmxhcmUgS1bvvIkKICog44O744OH44O844K/44GM5aSJ44KP44Gj44Gf44Kw44Or44O844OX77yIY3N2LeW5tO+8j2xpdmUt5bm05pyI77yPcGF5LeW5tOaciO+8j21ldGHvvInjgaDjgZHjgpLjgIFnemlw44GX44Gm6YCB44KLCiAqIOODu+S/neWtmOWFiOOBruitmOWIpeOBr+OAgeODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgZ3jga7jgoLjga7jga/pgIHjgonjgarjgYTvvIkKICog44O75b6p5YWD44Gv44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn44CC5ZCM44GY44Kt44O844Gu44OH44O844K/44Gv5LiK5pu444GN44GV44KM44KLCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgQks9e3Bhc3M6IiIsYXV0bzp0cnVlLGRpcnR5Om5ldyBTZXQoKSxidXN5OmZhbHNlLGlkOiIiLHNhdmVUOm51bGwscnVuVDpudWxsLGluZm86bnVsbCxtc2c6IiIsZXJyOmZhbHNlfTsKY29uc3QgcmF3TWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgcmF3UHV0TWFueT1yZWNzPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgc3Q9Wy4uLm5ldyBTZXQocmVjcy5tYXAocj0+ci5zKSldO2lmKCFzdC5sZW5ndGgpcmV0dXJuIG9rKCk7Y29uc3QgdD1EQi50cmFuc2FjdGlvbihzdCwicmVhZHdyaXRlIik7Zm9yKGNvbnN0IHIgb2YgcmVjcyl0Lm9iamVjdFN0b3JlKHIucykucHV0KHIudixyLmspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYlJhbmdlPShzdG9yZSxyYW5nZSk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBvdXQ9W107Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLm9wZW5DdXJzb3IocmFuZ2UpO3Eub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtvdXQucHVzaCh7czpzdG9yZSxrOmMua2V5LHY6Yy52YWx1ZX0pO2MuY29udGludWUoKX1lbHNlIG9rKG91dCl9O3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiS2V5cz1zdG9yZT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGxLZXlzKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpmdW5jdGlvbiBncm91cE9mKHN0b3JlLGtleSl7CiBrZXk9U3RyaW5nKGtleSk7CiBpZihzdG9yZT09PSJmaWxlcyIpe2lmKGtleS5zdGFydHNXaXRoKCJsaXZlOiIpKXJldHVybiAibGl2ZS0iK2tleS5zbGljZSg1LDEyKTtjb25zdCB5PWtleS5zcGxpdCgiOiIpWzBdO3JldHVybiAvXigwfDIwXGRcZCkkLy50ZXN0KHkpPyJjc3YtIit5OiJjc3YtMCJ9CiBpZihzdG9yZT09PSJwYXkiKXJldHVybiAicGF5LSIra2V5LnNsaWNlKDAsNyk7CiByZXR1cm4gIm1ldGEiOwp9CmZ1bmN0aW9uIG1hcmtEaXJ0eShzdG9yZSxrZXkpewogaWYoc3RvcmU9PT0ibWV0YSImJihrZXk9PT0iZGlydHkifHxrZXk9PT0iYmFja3VwIikpcmV0dXJuOwogQksuZGlydHkuYWRkKGdyb3VwT2Yoc3RvcmUsa2V5KSk7CiBjbGVhclRpbWVvdXQoQksuc2F2ZVQpO0JLLnNhdmVUPXNldFRpbWVvdXQoKCk9PntyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTtia1JlbmRlcigpfSw4MDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlYWRHcm91cChuYW1lKXsKIGxldCBtOwogaWYobmFtZT09PSJtZXRhIilyZXR1cm4oYXdhaXQgaWRiUmFuZ2UoIm1ldGEiKSkuZmlsdGVyKHI9PnIuayE9PSJkaXJ0eSImJnIuayE9PSJiYWNrdXAiKTsKIGlmKG09bmFtZS5tYXRjaCgvXmNzdi0oXGQrKSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfTpgLGAke21bMV19O2ApKTsKIGlmKG09bmFtZS5tYXRjaCgvXmxpdmUtKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgbGl2ZToke21bMV19LTAwYCxgbGl2ZToke21bMV19LTk5YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ecGF5LShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJwYXkiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19LTAwYCxgJHttWzFdfS05OWApKTsKIHJldHVybltdOwp9CmFzeW5jIGZ1bmN0aW9uIGFsbEdyb3VwcygpewogY29uc3QgZz1uZXcgU2V0KCk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJmaWxlcyIpKWcuYWRkKGdyb3VwT2YoImZpbGVzIixrKSk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJwYXkiKSlnLmFkZChncm91cE9mKCJwYXkiLGspKTsKIGlmKChhd2FpdCBpZGJLZXlzKCJtZXRhIikpLnNvbWUoaz0+ayE9PSJkaXJ0eSImJmshPT0iYmFja3VwIikpZy5hZGQoIm1ldGEiKTsKIHJldHVyblsuLi5nXTsKfQphc3luYyBmdW5jdGlvbiBneihzdHIpewogY29uc3QgcmF3PW5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpOwogaWYodHlwZW9mIENvbXByZXNzaW9uU3RyZWFtPT09InVuZGVmaW5lZCIpcmV0dXJue2J1ZjpyYXcsZW5jOiJyYXcifTsKIGNvbnN0IGNzPW5ldyBDb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9Y3Mud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShyYXcpO3cuY2xvc2UoKTsKIHJldHVybntidWY6bmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKSxlbmM6Imd6aXAifTsKfQphc3luYyBmdW5jdGlvbiBndW56aXAoYnVmLGVuYyl7CiBpZihlbmM9PT0icmF3IilyZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zik7CiBjb25zdCBkcz1uZXcgRGVjb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9ZHMud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShidWYpO3cuY2xvc2UoKTsKIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYXdhaXQgbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKTsKfQphc3luYyBmdW5jdGlvbiBia01ha2VJZCgpewogaWYoISh3aW5kb3cuY3J5cHRvJiZjcnlwdG8uc3VidGxlKSl0aHJvdyBuZXcgRXJyb3IoIuOBk+OBrueSsOWig+OBp+OBr+S9v+OBiOOBvuOBm+OCk++8iGh0dHBzIOOBp+mWi+OBj+W/heimgeOBjOOBguOCiuOBvuOBme+8iSIpOwogY29uc3QgZD1hd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgiU0hBLTI1NiIsbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKCJrZWliYS11cHNldC1iYWNrdXA6djE6IitCSy5wYXNzKSk7CiByZXR1cm5bLi4ubmV3IFVpbnQ4QXJyYXkoZCldLm1hcChiPT5iLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCIwIikpLmpvaW4oIiIpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrRmV0Y2gocGF0aCxvcHQpewogaWYoIUJLLmlkKUJLLmlkPWF3YWl0IGJrTWFrZUlkKCk7CiByZXR1cm4gZmV0Y2goJCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpK3BhdGgsT2JqZWN0LmFzc2lnbih7fSxvcHQse2hlYWRlcnM6T2JqZWN0LmFzc2lnbih7IngtYmFja3VwLWlkIjpCSy5pZH0sKG9wdCYmb3B0LmhlYWRlcnMpfHx7fSl9KSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtKU09OKHBhdGgsb3B0KXsKIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChwYXRoLG9wdCksdD1hd2FpdCByLnRleHQoKTtsZXQgaj17fTt0cnl7aj1KU09OLnBhcnNlKHQpfWNhdGNoKGUpe30KIGlmKCFyLm9rfHxqLm9rPT09ZmFsc2UpdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fCgiSFRUUCAiK3Iuc3RhdHVzKSk7cmV0dXJuIGo7Cn0KZnVuY3Rpb24gYmtNc2codCxpc0Vycil7QksubXNnPXR8fCIiO0JLLmVycj0hIWlzRXJyO2JrUmVuZGVyKCl9CmZ1bmN0aW9uIGJrUmVuZGVyKCl7CiBjb25zdCBlbD0kKCJia1N0YXR1cyIpO2lmKCFlbClyZXR1cm47CiBjb25zdCBtPUJLLmluZm8sanN0PW1zPT5uZXcgRGF0ZShtcys5KjM2MDBlMykudG9JU09TdHJpbmcoKS5yZXBsYWNlKCJUIiwiICIpLnNsaWNlKDAsMTYpOwogbGV0IHN1bT0iIjsKIGlmKCFCSy5wYXNzKXN1bT0i44OR44K544OV44Os44O844K644KS6Kit5a6a44GZ44KL44Go44CB6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44GM5pyJ5Yq544Gr44Gq44KK44G+44GZ44CCIjsKIGVsc2UgaWYobSYmbS5leGlzdHMpe2NvbnN0IGNzPU9iamVjdC52YWx1ZXMobS5jaHVua3N8fHt9KTtzdW09YOacgOe1guODkOODg+OCr+OCouODg+ODl++8miR7anN0KG0udXBkYXRlZEF0KX3vvIgke2NzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8keyhjcy5yZWR1Y2UoKHMsYyk9PnMrYy5zaXplLDApLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgfQogZWxzZSBzdW09IuODkOODg+OCr+OCouODg+ODl+OBr+OBvuOBoOOBguOCiuOBvuOBm+OCk+OAgiI7CiBpZihCSy5wYXNzKXN1bSs9YO+8j+acqumAgeS/oeOBruWkieabtO+8miR7QksuZGlydHkuc2l6ZX3jgrDjg6vjg7zjg5cke0JLLmF1dG8/Iu+8iOiHquWLleOBp+mAgeOCiuOBvuOBme+8iSI6Iu+8iOiHquWLleODkOODg+OCr+OCouODg+ODl+OBr+OCquODle+8iSJ9YDsKIGVsLmlubmVySFRNTD0oQksubXNnP2A8c3BhbiBjbGFzcz0iJHtCSy5lcnI/Indhcm4iOiJnb29kIn0iPiR7ZXNjKEJLLm1zZyl9PC9zcGFuPlxuYDoiIikrZXNjKHN1bSk7Cn0KZnVuY3Rpb24gYmtOZWVkUGFzcygpe2lmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644KSOOaWh+Wtl+S7peS4iuOBp+WFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQphc3luYyBmdW5jdGlvbiBia1JlZnJlc2gobWFuKXsKIHRyeXtCSy5pbmZvPW1hbnx8YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iil9Y2F0Y2goZSl7QksuaW5mbz1udWxsO2lmKCFCSy5tc2cpYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeOBp+OBjeOBvuOBm+OCk++8miIrZS5tZXNzYWdlLHRydWUpfQogYmtSZW5kZXIoKTsKfQphc3luYyBmdW5jdGlvbiBydW5CYWNrdXAoZnVsbCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlO2NvbnN0IGluZmxpZ2h0PW5ldyBTZXQoQksuZGlydHkpO0JLLmRpcnR5LmNsZWFyKCk7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKSxoYXZlPW1hbi5leGlzdHM/KG1hbi5jaHVua3N8fHt9KTp7fTsKICBjb25zdCBuYW1lcz0oZnVsbHx8IW1hbi5leGlzdHMpP2F3YWl0IGFsbEdyb3VwcygpOlsuLi5pbmZsaWdodF07CiAgaWYoIW5hbWVzLmxlbmd0aCl7YmtNc2coIuWkieabtOOBr+OBguOCiuOBvuOBm+OCk+OAgiIpO2F3YWl0IGJrUmVmcmVzaChtYW4pO3JldHVybn0KICBjb25zdCBjaHVua3M9T2JqZWN0LmFzc2lnbih7fSxoYXZlKTtsZXQgc2VudD0wLGJ5dGVzPTA7CiAgZm9yKGxldCBpPTA7aTxuYW1lcy5sZW5ndGg7aSsrKXsKICAgY29uc3QgbmFtZT1uYW1lc1tpXTtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5Lit4oCmICR7aSsxfS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHJlY3M9YXdhaXQgcmVhZEdyb3VwKG5hbWUpOwogICBpZighcmVjcy5sZW5ndGgpe2lmKGNodW5rc1tuYW1lXSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3NbbmFtZV19Y29udGludWV9CiAgIGNvbnN0IHJhdz1KU09OLnN0cmluZ2lmeSh7ZzpuYW1lLHJlY3N9KSx7YnVmLGVuY309YXdhaXQgZ3oocmF3KTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJQVVQiLGJvZHk6YnVmfSk7CiAgIGlmKCFyLm9rKXtsZXQgZT0iIjt0cnl7ZT0oYXdhaXQgci5qc29uKCkpLmVycm9yfWNhdGNoKF8pe310aHJvdyBuZXcgRXJyb3IoZXx8KCJIVFRQICIrci5zdGF0dXMpKX0KICAgY2h1bmtzW25hbWVdPXtzaXplOmJ1Zi5ieXRlTGVuZ3RoLHJhd1NpemU6cmF3Lmxlbmd0aCxuOnJlY3MubGVuZ3RoLGVuYyxhdDpEYXRlLm5vdygpfTtzZW50Kys7Ynl0ZXMrPWJ1Zi5ieXRlTGVuZ3RoOwogIH0KICBpZihmdWxsfHwhbWFuLmV4aXN0cyl7Zm9yKGNvbnN0IG4gb2YgT2JqZWN0LmtleXMoaGF2ZSkpaWYoIW5hbWVzLmluY2x1ZGVzKG4pKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobil9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuXX19CiAgY29uc3QgbWFuaWZlc3Q9e3Y6MSx1cGRhdGVkQXQ6RGF0ZS5ub3coKSxjaHVua3N9OwogIGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIse21ldGhvZDoiUFVUIixib2R5OkpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxoZWFkZXJzOnsiY29udGVudC10eXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgbWFuaWZlc3QuZXhpc3RzPXRydWU7YXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbmlmZXN0LnVwZGF0ZWRBdH0pOwogIEJLLmluZm89bWFuaWZlc3Q7YmtNc2coYOODkOODg+OCr+OCouODg+ODl+WujOS6hu+8miR7c2VudH3jgrDjg6vjg7zjg5fjgpLpgIHkv6HvvIgkeyhieXRlcy8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYCk7CiB9Y2F0Y2goZSl7CiAgZm9yKGNvbnN0IG4gb2YgaW5mbGlnaHQpQksuZGlydHkuYWRkKG4pO3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pOwogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKTsKIH1maW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQphc3luYyBmdW5jdGlvbiBydW5SZXN0b3JlKCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iik7CiAgaWYoIW1hbi5leGlzdHMpe2JrTXNnKCLjgZPjga7jg5Hjgrnjg5Xjg6zjg7zjgrrjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjga/opovjgaTjgYvjgorjgb7jgZvjgpPvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTvvInjgIIiLHRydWUpO3JldHVybn0KICBjb25zdCBuYW1lcz1PYmplY3Qua2V5cyhtYW4uY2h1bmtzfHx7fSk7bGV0IG49MCxjbnQ9MDsKICBmb3IoY29uc3QgbmFtZSBvZiBuYW1lcyl7CiAgIGJrTXNnKGDlvqnlhYPkuK3igKYgJHsrK259LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCk7CiAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgJHtuYW1lfSDjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPvvIhIVFRQICR7ci5zdGF0dXN977yJYCk7CiAgIGNvbnN0IG89SlNPTi5wYXJzZShhd2FpdCBndW56aXAobmV3IFVpbnQ4QXJyYXkoYXdhaXQgci5hcnJheUJ1ZmZlcigpKSxtYW4uY2h1bmtzW25hbWVdLmVuY3x8Imd6aXAiKSk7CiAgIGF3YWl0IHJhd1B1dE1hbnkoby5yZWNzKTtjbnQrPW8ucmVjcy5sZW5ndGg7CiAgfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiO0JBQ0tVUF9EQVRFUz1udWxsO0JLLmRpcnR5LmNsZWFyKCk7CiAgYXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFtdKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW4udXBkYXRlZEF0fSk7CiAgYXdhaXQgc2hvd1N0YXRlKCk7QksuaW5mbz1tYW47YmtNc2coYOW+qeWFg+WujOS6hu+8miR7bmFtZXMubGVuZ3RofeOCsOODq+ODvOODl++8jyR7Y250LnRvTG9jYWxlU3RyaW5nKCl95Lu2YCk7CiB9Y2F0Y2goZSl7YmtNc2coIuW+qeWFg+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpfQogZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KZnVuY3Rpb24gYmtTY2hlZHVsZShtcyl7CiBpZighQksuYXV0b3x8IUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpcmV0dXJuOwogY2xlYXJUaW1lb3V0KEJLLnJ1blQpO0JLLnJ1blQ9c2V0VGltZW91dCgoKT0+e2lmKCFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSk7ZWxzZSBia1NjaGVkdWxlKDMwMDAwKX0sbXN8fDMwMDApOwp9CmZ1bmN0aW9uIGJrU2F2ZVNldHRpbmdzKCl7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9iayIsSlNPTi5zdHJpbmdpZnkoe3Bhc3M6QksucGFzcyxhdXRvOkJLLmF1dG99KSl9Y2F0Y2goZSl7fX0KYXN5bmMgZnVuY3Rpb24gYmtJbml0KCl7CiB0cnl7Y29uc3Qgbz1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9iayIpfHwie30iKTtCSy5wYXNzPW8ucGFzc3x8IiI7QksuYXV0bz1vLmF1dG8hPT1mYWxzZX1jYXRjaChlKXt9CiAkKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOyQoImJrQXV0byIpLmNoZWNrZWQ9QksuYXV0bzsKICQoImJrUGFzcyIpLm9uY2hhbmdlPSgpPT57QksucGFzcz0kKCJia1Bhc3MiKS52YWx1ZS50cmltKCk7QksuaWQ9IiI7QksuaW5mbz1udWxsO0JLLm1zZz0iIjtia1NhdmVTZXR0aW5ncygpO2lmKEJLLnBhc3MubGVuZ3RoPj04KWJrUmVmcmVzaCgpO2Vsc2UgYmtSZW5kZXIoKX07CiAkKCJia1Nob3ciKS5vbmNsaWNrPSgpPT57Y29uc3QgcD0kKCJia1Bhc3MiKTtwLnR5cGU9cC50eXBlPT09InBhc3N3b3JkIj8idGV4dCI6InBhc3N3b3JkIjskKCJia1Nob3ciKS50ZXh0Q29udGVudD1wLnR5cGU9PT0icGFzc3dvcmQiPyLooajnpLoiOiLpmqDjgZkifTsKICQoImJrQXV0byIpLm9uY2hhbmdlPSgpPT57QksuYXV0bz0kKCJia0F1dG8iKS5jaGVja2VkO2JrU2F2ZVNldHRpbmdzKCk7YmtSZW5kZXIoKTtpZihCSy5hdXRvKWJrU2NoZWR1bGUoMjAwMCl9OwogJCgiYmtOb3ciKS5vbmNsaWNrPSgpPT5ydW5CYWNrdXAoZmFsc2UpOwogJCgiYmtGdWxsIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBmeOBueOBpuOBruODh+ODvOOCv+OCkuOAgeOBguOCieOBn+OCgeOBpuS/neWtmOOBl+ebtOOBl+OBvuOBmeOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1bkJhY2t1cCh0cnVlKX07CiAkKCJia1Jlc3RvcmUiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GT44Gu56uv5pyr44Gu44OH44O844K/44KS44CB44OQ44OD44Kv44Ki44OD44OX44Gu5YaF5a6544Gn5LiK5pu444GN44GX44G+44GZ77yI44OQ44OD44Kv44Ki44OD44OX44Gr44GC44KL44OH44O844K/44Gg44GR44GM5a++6LGh44Gn44GZ77yJ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuUmVzdG9yZSgpfTsKIHRyeXtjb25zdCBkPWF3YWl0IG1ldGFHZXQoImRpcnR5Iik7aWYoQXJyYXkuaXNBcnJheShkKSlkLmZvckVhY2goeD0+QksuZGlydHkuYWRkKHgpKX1jYXRjaChlKXt9CiB0cnl7aWYobmF2aWdhdG9yLnN0b3JhZ2UmJm5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QpbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCgpLmNhdGNoKCgpPT57fSl9Y2F0Y2goZSl7fQogYmtSZW5kZXIoKTsKIGlmKEJLLnBhc3MubGVuZ3RoPj04KXthd2FpdCBia1JlZnJlc2goKTtpZihCSy5kaXJ0eS5zaXplKWJrU2NoZWR1bGUoNTAwMCl9CiBzZXRJbnRlcnZhbCgoKT0+e2lmKEJLLmF1dG8mJkJLLnBhc3MubGVuZ3RoPj04JiZCSy5kaXJ0eS5zaXplJiYhQksuYnVzeSYmIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKX0sd2luZG93Ll9fQktfVElDS3x8OTAwMDAwKTsKfQoKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5rOi5Lmx5bqm44Gu5YaN5qCh5q2jCiAqICDnm67nmoTvvJrms6LkubHluqbjga7jgIzlvZPjgZ/jgormlrnjgI3jgpLjgIHoh6rliIbjga7pgY7ljrvjg4fjg7zjgr/jgafnorrjgYvjgoHjgIHkv6HpoLzjgafjgY3jgovmlbDlrZfjgaDjgZHjgpLlh7rjgZnjgIIKICogIOOChOOCi+OBk+OBqO+8mgogKiAgIDEpIOmBjuWOu+OBruODrOODvOOCueOCkuaZguezu+WIl+OBqzHjgaTjgZrjgaTlho3nj77jgZfjgIHjg6zjg7zjgrnliY3jgavliIbjgYvjgovmg4XloLHjgaDjgZHjgafms6LkubHluqbjgpLoqIjnrpcKICogICAyKSDnj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIhNT0RFTF9UUkFJTl9FTkTku6XpmY3vvInjgafjgIHlrp/pmpvjga7ms6LkubHnjofjgajnqoHjgY3lkIjjgo/jgZvjgosKICogICAzKSDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjofvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjgarjganjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIHlkIzjgZjmnJ/plpPjgafmr5TovIMKICogICA0KSDlr77mlbDmkI3lpLHjgYzmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgajjgY3jgaDjgZHmjqHnlKjjgILjgZ3jgYbjgafjgarjgZHjgozjgbDnj77ooYzjga7jgb7jgb7jgavjgZfjgabjgIHlrp/nuL7njofjgaDjgZHmpJzoqLzlgKTjgavlt67jgZfmm7/jgYjjgosKICogIOazouS5se+8nTPnnYDku6XlhoXjga7ppqzjga7kurrmsJfjga7lkIjoqIjjgYzplr7lgKQo54++6KGM44Oi44OH44Or44Go5ZCM44GYMTUp5Lul5LiKCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgVVBLRVk9ImtlaWJhX3Vwc2V0X3YxIjsKY29uc3Qgc2lnbT16PT4xLygxK01hdGguZXhwKC16KSksbGd0PXA9PntwPU1hdGgubWluKC45OTksTWF0aC5tYXgoLjAwMSxwKSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKZnVuY3Rpb24gd2lsc29uKGssbil7aWYoIW4pcmV0dXJuWzAsMV07Y29uc3Qgej0xLjk2LHA9ay9uLGQ9MSt6KnovbixjPXAreip6LygyKm4pLGE9eipNYXRoLnNxcnQocCooMS1wKS9uK3oqei8oNCpuKm4pKTtyZXR1cm5bKGMtYSkvZCwoYythKS9kXX0KY29uc3QgZGlzdEI9ZD0+TWF0aC5tYXgoMTAwMCxNYXRoLm1pbigzMjAwLE1hdGgucm91bmQoKGR8fDApLzIwMCkqMjAwKSk7CmNvbnN0IGx2bEc9KGwsZyk9PihsfHwwKSsoZz49Mj8iRyI6IiIpOwoKLyog44Os44O844K544Gu6ZuG6KiI77yI6KGM44KS5YWo6YOo5oyB44Gf44Ga44Gr5riI44KA6Lu944GE5b2i77yJ4oaSIOODrOODvOOCueaDheWgsSAqLwpmdW5jdGlvbiBhZ2dBZGQobWFwLHIpewogaWYoIXIucmFjZUlkfHwhci5ob3JzZXx8ci5maW5pc2g9PW51bGwpcmV0dXJuOwogbGV0IGE9bWFwLmdldChyLnJhY2VJZCk7CiBpZighYSltYXAuc2V0KHIucmFjZUlkLGE9e2lkOlN0cmluZyhyLnJhY2VJZCksZGF0ZTpyLmRhdGUsc3VyZjpyLnN1cmYsZGlzdDpyLmRpc3QsbHZsOnIubHZsfHwwLGdyZDpyLmdyZHx8MCxnYzowLE46MCx0OltdLHBmOltdLGp1bXA6ZmFsc2V9KTsKIGlmKCFhLmdjJiZyLmdjKWEuZ2M9ci5nYzsKIGEuTisrO2lmKHIuZmluaXNoPD0zJiZyLnBvcD4wKWEudC5wdXNoKFtyLmZpbmlzaCxyLnBvcF0pOwogaWYoci5wb3A+MClhLnBmLnB1c2goW3IucG9wLHIuZmluaXNoXSk7CiBpZigv6Zqc5a6zLy50ZXN0KFN0cmluZyhyLnJhY2VOYW1lfHwiIikpKWEuanVtcD10cnVlOwp9CmZ1bmN0aW9uIGFnZ0luZm8oYSl7CiBpZighYXx8YS5OPDZ8fGEuanVtcClyZXR1cm4gbnVsbDsKIGNvbnN0IHY9L15cZHsxMn0kLy50ZXN0KGEuaWQpP2EuaWQuc2xpY2UoNCw2KTooU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbM118fCIiKSxubz0vXlxkezEyfSQvLnRlc3QoYS5pZCk/TnVtYmVyKGEuaWQuc2xpY2UoMTAsMTIpKTooTnVtYmVyKFN0cmluZyhhLmlkKS5zcGxpdCgiLSIpWzRdKXx8MCk7CiBjb25zdCB0PWEudC5zbGljZSgpLnNvcnQoKHgseSk9PnhbMF0teVswXSk7CiBjb25zdCB5PXQubGVuZ3RoPj0zPyh0WzBdWzFdK3RbMV1bMV0rdFsyXVsxXT49VUUuQVhJUy51cHNldC50aHI/MTowKTpudWxsOwogcmV0dXJue2RhdGU6YS5kYXRlLHYsbm8sc3VyZjphLnN1cmYsZGlzdDphLmRpc3QsbHZsOmEubHZsLGdyZDphLmdyZCxnYzphLmdjfHwwLE46YS5OLHl9Owp9CgovKiDohJros6rvvJox44Kz44O844OK44O844Gu5L2N572u44Gu5Ymy5ZCI77yIMD3lhYjpoK3jgIExPeacgOW+jOaWue+8ieOAgumAmumBjumghuS9jeOBpOOBjeOBruaIkOe4vuOBjOOBguOCi+mmrOOBoOOBkSAqLwpmdW5jdGlvbiBjb3JuZXJGcmFjKGNvcm5lcixOKXsKIGlmKCFBcnJheS5pc0FycmF5KGNvcm5lcil8fCFjb3JuZXIubGVuZ3RofHwhTnx8Tjw0KXJldHVybiBudWxsOwogcmV0dXJuIE1hdGgubWluKDEsTWF0aC5tYXgoMCwoY29ybmVyWzBdLTEpLyhOLTEpKSk7Cn0KLyog44Os44O844K544Gu44Oa44O844K554m55b606YeP77ya5YWI6KGM6aas44Gu5aSa44GV44O76ISa6LOq44Gu44Gw44KJ44Gk44GN44CC5Y2K5pWw5Lul5LiK44Gu6aas44Gr6ISa6LOq44OH44O844K/44GM54Sh44GR44KM44Gw5YWo6YOoMCAqLwpmdW5jdGlvbiBwYWNlRmVhdChydW5uZXJzLHN0b3JlKXsKIGNvbnN0IE49cnVubmVycy5sZW5ndGg7bGV0IGs9MCxsZWFkPTAsZnJvbnQ9MCxzdW09MCxzdW0yPTA7CiBmb3IoY29uc3QgciBvZiBydW5uZXJzKXsKICBjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO2lmKCFoKWNvbnRpbnVlOwogIGNvbnN0IHY9aC5ydW5zLm1hcCh4PT54WzZdKS5maWx0ZXIoeD0+eCE9bnVsbCYmeD49MCk7aWYodi5sZW5ndGg8Miljb250aW51ZTsKICBjb25zdCB3PXYuc2xpY2UoLTUpLG09dy5yZWR1Y2UoKGEsYik9PmErYiwwKS93Lmxlbmd0aDsKICBrKys7c3VtKz1tO3N1bTIrPW0qbTtpZihtPD0uMTUpbGVhZCsrO2lmKG08PS4zMClmcm9udCsrOwogfQogaWYoIU58fGs8TiouNSlyZXR1cm5bMCwwLDAsMCwwXTsKIGNvbnN0IG1lYW49c3VtL2ssc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAsc3VtMi9rLW1lYW4qbWVhbikpOwogcmV0dXJuW2svTixsZWFkL04qNCxmcm9udC9OKjIsbWVhbi0uNSxzZF07Cn0KCi8qIOWQhOmmrOOBrjPnnYDlhoXnorrnjofjgajkurrmsJfpoIbkvY3jgYvjgonjgIHjgIwz552A5Lul5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GM6Za+5YCk5Lul5LiK44CN44Gr44Gq44KL56K6546H44KS44K344Of44Ol44Os44O844K344On44Oz44Gn6KaL56mN44KC44KLCiAgIO+8iOmHjeOBv++8neeiuueOh8O3KDHiiJLnorrnjocp44Gn44CBM+mgreOCkumghuOBq+aKvemBuOOAguavjuWbnuWQjOOBmOe1kOaenOOBq+OBquOCi+OCiOOBhuOAgeS5seaVsOOBr+ODrOODvOOCueWGheWuueOBi+OCieaxuuOCgeOCi++8iSAqLwpmdW5jdGlvbiBzaW1VcHNldChwLHBvcHMsdGhyKXsKIGNvbnN0IE49cC5sZW5ndGg7bGV0IHNlZWQ9MjE2NjEzNjI2MTsKIGZvcihsZXQgaT0wO2k8TjtpKyspc2VlZD1NYXRoLmltdWwoc2VlZF4oTWF0aC5yb3VuZChwW2ldKjEwMDApK3BvcHNbaV0qNzkxOSksMTY3Nzc2MTkpPj4+MDsKIGNvbnN0IHJuZD0oKT0+e3NlZWQ9KHNlZWQrMHg2RDJCNzlGNSk+Pj4wO2xldCB0PXNlZWQ7dD1NYXRoLmltdWwodF4odD4+PjE1KSx0fDEpO3RePXQrTWF0aC5pbXVsKHReKHQ+Pj43KSx0fDYxKTtyZXR1cm4oKHReKHQ+Pj4xNCkpPj4+MCkvNDI5NDk2NzI5Nn07CiBjb25zdCB3PXAubWFwKHg9Pk1hdGgubWF4KDFlLTQseC8oMS1NYXRoLm1pbiguOTk5LHgpKSkpOwogY29uc3QgSz0zMDA7bGV0IGhpdD0wLHN1bT0wLHN1bTI9MDsKIGZvcihsZXQgaz0wO2s8SztrKyspewogIGNvbnN0IHVzZWQ9QXJyYXkoTikuZmlsbChmYWxzZSk7bGV0IFM9MDsKICBmb3IobGV0IGo9MDtqPDM7aisrKXsKICAgbGV0IHRvdD0wO2ZvcihsZXQgaT0wO2k8TjtpKyspaWYoIXVzZWRbaV0pdG90Kz13W2ldOwogICBsZXQgeD1ybmQoKSp0b3QscGljaz0tMTsKICAgZm9yKGxldCBpPTA7aTxOO2krKyl7aWYodXNlZFtpXSljb250aW51ZTt4LT13W2ldO2lmKHg8PTApe3BpY2s9aTticmVha319CiAgIGlmKHBpY2s8MCl7Zm9yKGxldCBpPU4tMTtpPj0wO2ktLSlpZighdXNlZFtpXSl7cGljaz1pO2JyZWFrfX0KICAgdXNlZFtwaWNrXT10cnVlO1MrPXBvcHNbcGlja107CiAgfQogIGlmKFM+PXRociloaXQrKztzdW0rPVM7c3VtMis9UypTOwogfQogY29uc3QgbT1zdW0vSztyZXR1cm5bbGd0KChoaXQrLjUpLyhLKzEpKSxtLzE1LE1hdGguc3FydChNYXRoLm1heCgwLHN1bTIvSy1tKm0pKS8xMF07Cn0KLyogMeODrOODvOOCueOBruW4guWgtOi+vOOBv+OBrueJueW+tO+8mumBjuWOu+aIkOe4vuODouODh+ODq+OBrueiuueOh+OBqOOAgeS6uuawl+mghuS9jeOBruWun+e4vueOh+OCkuWNiuOAheOBp+a3t+OBnOOBn+eiuueOhyDihpIg44K344Of44Ol44Os44O844K344On44OzICovCmZ1bmN0aW9uIHNpbUZlYXQocFAscG9wcyxOLHByaSl7CiBjb25zdCB6PXBQLm1hcCgocCxpKT0+LjUqbGd0KHApKy41KmxndChwcmkucmF0ZShwb3BzW2ldLE4pKSk7CiByZXR1cm4gc2ltVXBzZXQobm9ybVN1bSh6LDMpLHBvcHMsVUUuQVhJUy51cHNldC50aHIpOwp9CgovKiDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga/lhajkvZPjgbjlr4TjgZvjgovvvIkgKi8KY2xhc3MgVXBQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMuYmFzZT17bjowLHU6MH07dGhpcy5tPW5ldyBNYXAoKX0KIF9rKGkpe3JldHVyblsiViIraS52LCJDIitpLnYrInwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSwiTCIraS5zdXJmKyJ8IitkaXN0QihpLmRpc3QpKyJ8IitsdmxHKGkubHZsLGkuZ3JkKSwiTiIrKGkubm98fDApLCJHIitpLnN1cmYrInwiKyhpLmdjfHwwKV19CiBhZGQoaSl7aWYoIWl8fGkueT09bnVsbClyZXR1cm47dGhpcy5iYXNlLm4rKzt0aGlzLmJhc2UudSs9aS55O2Zvcihjb25zdCBrIG9mIHRoaXMuX2soaSkpe2xldCB4PXRoaXMubS5nZXQoayk7aWYoIXgpdGhpcy5tLnNldChrLHg9e246MCx1OjB9KTt4Lm4rKzt4LnUrPWkueX19CiBmZWF0KGkpewogIGNvbnN0IGI9dGhpcy5iYXNlLm4+MjAwP3RoaXMuYmFzZS51L3RoaXMuYmFzZS5uOi4yODUsSz00MDsKICBjb25zdCBzaD0oayxwYXIpPT57Y29uc3QgeD10aGlzLm0uZ2V0KGspfHx7bjowLHU6MH07cmV0dXJuKHgudStLKnBhcikvKHgubitLKX07CiAgY29uc3QgW2t2LGtjLGtsLGtuLGtnXT10aGlzLl9rKGkpLHB2PXNoKGt2LGIpLHBjPXNoKGtjLHB2KSxwbD1zaChrbCxiKSxwbj1zaChrbixiKSxwZz1zaChrZyxiKSxsYj1sZ3QoYik7CiAgcmV0dXJuW2xndChwdiktbGIsbGd0KHBjKS1sYixsZ3QocGwpLWxiLGxndChwbiktbGIsbGd0KHBnKS1sYl07CiB9Cn0KCi8qIOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8iOODi+ODpeODvOODiOODs+azleODu0wy5q2j5YmH5YyW44O75qiZ5rqW5YyW77yJICovCmZ1bmN0aW9uIHNvbHZlTGluKEEsYil7CiBjb25zdCBuPWIubGVuZ3RoLE09QS5tYXAoKHIsaSk9PlsuLi5yLGJbaV1dKTsKIGZvcihsZXQgYz0wO2M8bjtjKyspewogIGxldCBwPWM7Zm9yKGxldCByPWMrMTtyPG47cisrKWlmKE1hdGguYWJzKE1bcl1bY10pPk1hdGguYWJzKE1bcF1bY10pKXA9cjsKICBbTVtjXSxNW3BdXT1bTVtwXSxNW2NdXTtjb25zdCBkPU1bY11bY118fDFlLTk7CiAgZm9yKGxldCBrPWM7azw9bjtrKyspTVtjXVtrXS89ZDsKICBmb3IobGV0IHI9MDtyPG47cisrKWlmKHIhPT1jKXtjb25zdCBmPU1bcl1bY107aWYoZilmb3IobGV0IGs9YztrPD1uO2srKylNW3JdW2tdLT1mKk1bY11ba119CiB9CiByZXR1cm4gTS5tYXAocj0+cltuXSk7Cn0KZnVuY3Rpb24gZml0TG9naXQoWCx5LGwyKXsKIGNvbnN0IG49WC5sZW5ndGgsZD1YWzBdLmxlbmd0aCxtdT1BcnJheShkKS5maWxsKDApLHNkPUFycmF5KGQpLmZpbGwoMCk7CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspbXVbal0rPXJbal0vbjsKIGZvcihjb25zdCByIG9mIFgpZm9yKGxldCBqPTA7ajxkO2orKylzZFtqXSs9KHJbal0tbXVbal0pKioyL247CiBmb3IobGV0IGo9MDtqPGQ7aisrKXtzZFtqXT1NYXRoLnNxcnQoc2Rbal0pO2lmKCEoc2Rbal0+PS4wNSkpc2Rbal09LjA1fSAgIC8vIOOBsOOCieOBpOOBjeOBjOOBu+OBvOeEoeOBhOWIl+OBr+OAgeWwj+OBleOBquiqpOW3ruOBp+WJsuOBo+OBpuW3qOWkp+OBquWApOOBq+OBquOCieOBquOBhOOCiOOBhuOAgeS4i+mZkOOCkuioreOBkeOCiwogY29uc3QgWj1YLm1hcChyPT5bMSwuLi5yLm1hcCgodixqKT0+KHYtbXVbal0pL3NkW2pdKV0pLEQ9ZCsxLHc9QXJyYXkoRCkuZmlsbCgwKTsKIGZvcihsZXQgaXQ9MDtpdDwzMDtpdCsrKXsKICBjb25zdCBnPUFycmF5KEQpLmZpbGwoMCksSD1BcnJheS5mcm9tKHtsZW5ndGg6RH0sKCk9PkFycmF5KEQpLmZpbGwoMCkpOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2NvbnN0IHo9WltpXTtsZXQgcz0wO2ZvcihsZXQgaj0wO2o8RDtqKyspcys9d1tqXSp6W2pdOwogICBjb25zdCBwPXNpZ20ocyksZT1wLXlbaV0scT1wKigxLXApOwogICBmb3IobGV0IGo9MDtqPEQ7aisrKXtnW2pdKz1lKnpbal07Zm9yKGxldCBrPWo7azxEO2srKylIW2pdW2tdKz1xKnpbal0qeltrXX19CiAgZm9yKGxldCBqPTE7ajxEO2orKyl7Z1tqXSs9bDIqd1tqXTtIW2pdW2pdKz1sMn0KICBmb3IobGV0IGo9MDtqPEQ7aisrKWZvcihsZXQgaz0wO2s8ajtrKyspSFtqXVtrXT1IW2tdW2pdOwogIEhbMF1bMF0rPTFlLTk7CiAgY29uc3QgZHc9c29sdmVMaW4oSCxnKTtsZXQgbXg9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXt3W2pdLT1kd1tqXTtteD1NYXRoLm1heChteCxNYXRoLmFicyhkd1tqXSkpfQogIGlmKG14PDFlLTcpYnJlYWs7CiB9CiByZXR1cm57dyxtdSxzZH07Cn0KY29uc3QgcHJlZExvZ2l0PShtLHgpPT57bGV0IHM9bS53WzBdO2ZvcihsZXQgaj0wO2o8eC5sZW5ndGg7aisrKXtjb25zdCB6PSh4W2pdLW0ubXVbal0pL20uc2Rbal07cys9bS53W2orMV0qTWF0aC5tYXgoLTUsTWF0aC5taW4oNSx6KSl9cmV0dXJuIHN9OyAgIC8vIOWtpue/kuaZguOBruevhOWbsuOCkuWkp+OBjeOBj+WkluOCjOOBn+WFpeWKm+OBp+aatOOCjOOBquOBhOOCiOOBhsKxNeOBq+aKkeOBiOOCiwoKLyog6KmV5L6h5oyH5qiZ77ya5a++5pWw5pCN5aSx44O744OW44Op44Kk44Ok44O844O7QVVD44O76LyD5q2j6Kqk5beuKEVDRSkgKi8KZnVuY3Rpb24gYXVjT2YocCx5KXsKIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKTtsZXQgcnM9MCxuMT0wOwogZm9yKGxldCByPTA7cjxpZHgubGVuZ3RoO3IrKyl7aWYoeVtpZHhbcl1dKXtycys9cisxO24xKyt9fQogY29uc3QgbjA9eS5sZW5ndGgtbjE7cmV0dXJuIG4xJiZuMD8ocnMtbjEqKG4xKzEpLzIpLyhuMSpuMCk6LjU7Cn0KZnVuY3Rpb24gbWV0cmljc09mKHAseSl7CiBjb25zdCBuPXkubGVuZ3RoO2xldCBsbD0wLGJyPTA7CiBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCBxPU1hdGgubWluKDEtMWUtOSxNYXRoLm1heCgxZS05LHBbaV0pKTtsbC09eVtpXT9NYXRoLmxvZyhxKTpNYXRoLmxvZygxLXEpO2JyKz0ocFtpXS15W2ldKSoqMn0KIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKSxCPTEwO2xldCBlY2U9MDsKIGZvcihsZXQgYj0wO2I8QjtiKyspe2NvbnN0IHM9aWR4LnNsaWNlKE1hdGguZmxvb3IoYipuL0IpLE1hdGguZmxvb3IoKGIrMSkqbi9CKSk7aWYoIXMubGVuZ3RoKWNvbnRpbnVlOwogIGNvbnN0IG1wPXMucmVkdWNlKChhLGkpPT5hK3BbaV0sMCkvcy5sZW5ndGgsbXk9cy5yZWR1Y2UoKGEsaSk9PmEreVtpXSwwKS9zLmxlbmd0aDtlY2UrPU1hdGguYWJzKG1wLW15KSpzLmxlbmd0aC9ufQogcmV0dXJue24sbGw6bGwvbixicmllcjpici9uLGF1YzphdWNPZihwLHkpLGVjZX07Cn0KCi8qIOetiee0mu+8muS6iOa4rOeiuueOh+OBrumrmOOBhOmghuOBq+S4iuS9jSAzJSAvIDclIC8gMTIlIC8gMjAlIC8gMjglIC8g5q6L44KK77yIU1NTL1NTL1MvQS9CL0PvvIkgKi8KY29uc3QgVVBfU0hBUkU9W1siU1NTIiwuMDNdLFsiU1MiLC4wN10sWyJTIiwuMTJdLFsiQSIsLjIwXSxbIkIiLC4yOF0sWyJDIiwuMzBdXTsKZnVuY3Rpb24gbWFrZUN1dHMocHMpewogY29uc3Qgcz1wcy5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7bGV0IGFjYz0wO2NvbnN0IGN1dHM9W107CiBmb3IoY29uc3QgW2csc2hdIG9mIFVQX1NIQVJFKXthY2MrPXNoO2lmKGc9PT0iQyIpe2N1dHMucHVzaChbZywtMV0pO2JyZWFrfWN1dHMucHVzaChbZyxzW01hdGgubWluKHMubGVuZ3RoLTEsTWF0aC5tYXgoMCxNYXRoLnJvdW5kKHMubGVuZ3RoKmFjYyktMSkpXV0pfQogcmV0dXJuIGN1dHM7Cn0KY29uc3QgZ3JhZGVPZj0oY3V0cyxwKT0+e2Zvcihjb25zdCBbZyxjXSBvZiBjdXRzKWlmKHA+PWMpcmV0dXJuIGc7cmV0dXJuIkMifTsKZnVuY3Rpb24gZ3JhZGVUYWJsZShjdXRzLHBzLHlzKXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MH0pOwogcHMuZm9yRWFjaCgocCxpKT0+e2NvbnN0IHg9dFtncmFkZU9mKGN1dHMscCldO3gubisrO3guays9eXNbaV19KTsKIGZvcihjb25zdCBnIGluIHQpe2NvbnN0IHg9dFtnXSx3PXdpbHNvbih4LmsseC5uKTt4LnJhdGU9eC5uP3guay94Lm46MDt4LmxvPXdbMF07eC5oaT13WzFdfQogcmV0dXJuIHQ7Cn0KCi8qIOaWsOODouODh+ODq+OBruWFpeWKm++8muePvuihjOODouODh+ODq+OBrueJueW+tOmHjygxNykg77yLIOOCquODg+OCuueJueW+tOmHjyg3LCDjgarjgZHjgozjgbAwKSDvvIsg44Kq44OD44K65pyJ54ShIO+8iyDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjocoMykgKi8KZnVuY3Rpb24gdXBYKHUsZSl7CiBjb25zdCBvZGRzPXUubW9kZT09PSJvZGRzIjsKIHJldHVyblsuLi51LmYuc2xpY2UoMSwxOCksLi4uKG9kZHM/dS5mLnNsaWNlKDE4LDI1KTpbMCwwLDAsMCwwLDAsMF0pLG9kZHM/MTowLC4uLmVdOwp9CmZ1bmN0aW9uIHVwc2V0Q3VzdG9tKE0sdSxlLHBjLHNpbSl7CiBpZighTSlyZXR1cm4gbnVsbDsKIGxldCB6O2NvbnN0IHowPWxndCh1LnAwKSx4eD0oKT0+e2xldCB4PXVwWCh1LGUpO2lmKE0ucGFjZSl4PVsuLi54LC4uLihwY3x8WzAsMCwwLDAsMF0pXTtpZihNLnNpbSl4PVsuLi54LHNpbT8xOjAsLi4uKHNpbXx8WzAsMCwwXSldO3JldHVybiB4fTsKIGlmKE0ua2luZD09PSJvbGQiKXo9ejA7CiBlbHNlIGlmKE0ua2luZD09PSJuZXciKXo9cHJlZExvZ2l0KE0ubW9kZWwseHgoKSk7CiBlbHNlIGlmKE0ua2luZD09PSJibGVuZCIpej0oejArcHJlZExvZ2l0KE0ubW9kZWwseHgoKSkpLzI7CiBlbHNlIHJldHVybiBudWxsOwogY29uc3QgcD1zaWdtKHopLGc9Z3JhZGVPZihNLmN1dHMscCkscj1NLnJhdGVzJiZNLnJhdGVzW2ddfHx7fTsKIHJldHVybntncmFkZTpnLHAscmF0ZTpyLnJhdGU/P251bGwsbG86ci5sbz8/bnVsbCxoaTpyLmhpPz9udWxsLG46ci5uPz8wfTsKfQpjb25zdCBnZXRVcHNldE1vZGVsPSgpPT57dHJ5e2NvbnN0IG09SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShVUEtFWSl8fCJudWxsIik7cmV0dXJuIG0mJm0uY3V0cyYmbS52ZXI9PT00P206bnVsbH1jYXRjaChlKXtyZXR1cm4gbnVsbH19OyAgIC8vIHZlcjoy77yd44Os44O844K555Wq5Y+344Gu54m55b606YeP44Gk44GN44CC5Y+k44GE5L+d5a2Y44Gv5L2/44KP44Gq44GECgovKiAtLS0tLS0tLS0tIOazouS5seW6puOBruS6iOaDs+WIpeOBq+OAgeWun+mam+OBruaJleaIu+OBp+eiuuOBi+OCgeOCiyAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRQYXlGdWxsKCl7CiBjb25zdCBtPW5ldyBNYXAoKTsKIHRyeXsKICBjb25zdCBkYXlzPWF3YWl0IFByb21pc2UucmFjZShbcGF5QWxsKCksbmV3IFByb21pc2Uocj0+c2V0VGltZW91dCgoKT0+cihbXSksMTUwMDApKV0pOwogIGZvcihjb25zdCBkYXkgb2YgZGF5cylmb3IoY29uc3QgciBvZiAoZGF5LnJhY2VzfHxbXSkpaWYoci5yYWNlSWQpbS5zZXQoci5yYWNlSWQse3dpbjpyLndpbnx8W10scGxhY2U6ci5wbGFjZXx8W119KTsKIH1jYXRjaChlKXt9CiByZXR1cm4gbTsKfQpjb25zdCBtZWRPZj1hPT57aWYoIWEubGVuZ3RoKXJldHVybiBudWxsO2NvbnN0IHM9YS5zbGljZSgpLnNvcnQoKHgseSk9PngteSksbT1NYXRoLmZsb29yKHMubGVuZ3RoLzIpO3JldHVybiBzLmxlbmd0aCUyP3NbbV06KHNbbS0xXStzW21dKS8yfTsKY29uc3QgYXZnT2Y9YT0+YS5sZW5ndGg/YS5yZWR1Y2UoKHgseSk9PngreSwwKS9hLmxlbmd0aDpudWxsOwovKiDkuojmg7Pjga7nrYnntJrjgZTjgajjgavvvJrlrp/pmpvjga7ms6LkubHnjofjgIHljZjli53phY3lvZPvvIjli53jgaHppqzvvInjgIHopIfli53phY3lvZPvvIgz552A5YaFM+mgreOBruWQiOioiO+8ieOAgTPnnYDlhoXjga7kurrmsJfjga7lkIjoqIggKi8KZnVuY3Rpb24gcGF5b3V0VGFibGUodGVzdCxncmFkZU9mMixwYXkpewogY29uc3QgdD17fTtVUF9TSEFSRS5mb3JFYWNoKChbZ10pPT50W2ddPXtuOjAsazowLG5wOjAsd2luczpbXSxwbDpbXSxwb3BzOltdfSk7CiBmb3IoY29uc3QgcyBvZiB0ZXN0KXsKICBjb25zdCB4PXRbZ3JhZGVPZjIocyldO3gubisrO3guays9cy55OwogIGNvbnN0IHA9cGF5LmdldChzLnJhY2VJZCk7CiAgaWYoIXB8fCFwLndpbi5sZW5ndGh8fHAucGxhY2UubGVuZ3RoPDMpY29udGludWU7CiAgeC5ucCsrO3gud2lucy5wdXNoKHAud2luWzBdLnllbik7CiAgY29uc3QgcGw9cC5wbGFjZS5zbGljZSgwLDMpO3gucGwucHVzaChwbC5yZWR1Y2UoKGEsYik9PmErYi55ZW4sMCkpO3gucG9wcy5wdXNoKHBsLnJlZHVjZSgoYSxiKT0+YSsoYi5wb3B8fDApLDApKTsKIH0KIGNvbnN0IG91dD17fTsKIGZvcihjb25zdCBnIGluIHQpe2NvbnN0IHg9dFtnXTsKICBvdXRbZ109e246eC5uLHJhdGU6eC5uP3guay94Lm46MCxucDp4Lm5wLGF2Z1dpbjphdmdPZih4LndpbnMpLG1lZFdpbjptZWRPZih4LndpbnMpLAogICBzaGFyZTEwMDA6eC5ucD94LndpbnMuZmlsdGVyKHY9PnY+PTEwMDApLmxlbmd0aC94Lm5wOm51bGwsc2hhcmUzMDAwOngubnA/eC53aW5zLmZpbHRlcih2PT52Pj0zMDAwKS5sZW5ndGgveC5ucDpudWxsLAogICBhdmdQbGFjZVN1bTphdmdPZih4LnBsKSxhdmdQb3BTdW06YXZnT2YoeC5wb3BzKX07fQogcmV0dXJuIG91dDsKfQovKiDnrYnntJrjgYzkuIrjgYzjgovjgbvjganjgIHlrp/pmpvjga7miZXmiLvjgoLlpKfjgY3jgY/jgarjgaPjgabjgYTjgovjgYvvvIjpmqPjgorlkIjjgYbnrYnntJrjga7mr5TovIPjgafjgIHpgIbou6LjgYzjgYTjgY/jgaTjgYLjgovjgYvvvIkgKi8KZnVuY3Rpb24gcGF5b3V0TW9ub3RvbmUodGFiKXsKIGNvbnN0IGdzPVVQX1NIQVJFLm1hcCgoW2ddKT0+Zykscm93cz1ncy5tYXAoZz0+dGFiW2ddKS5maWx0ZXIoeD0+eC5ucD49MzApOwogbGV0IG9rPTAsdG90PTA7CiBmb3IobGV0IGk9MDtpKzE8cm93cy5sZW5ndGg7aSsrKXt0b3QrKztjb25zdCBhPXJvd3NbaV0sYj1yb3dzW2krMV07aWYoKGEuYXZnUGxhY2VTdW0/PzApPj0oYi5hdmdQbGFjZVN1bT8/MCkqLjk1JiYoYS5hdmdQb3BTdW0/PzApPj0oYi5hdmdQb3BTdW0/PzApKi45NSlvaysrfSAgIC8vIOWBtueEtuOBruWwj+OBleOBqumAhui7ou+8iDHlibLku6XlhoXvvInjga/oqLHlrrkKIHJldHVybntvayx0b3R9Owp9CgovKiAtLS0tLS0tLS0tIOaknOiovOOBqOWGjeagoeato+OBruacrOS9kyAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHJ1blVwc2V0Rml0KG9wdHMpewogb3B0cz1vcHRzfHx7fTsKIGNvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIyMDIxLTAxLTAxIixURVNUPW9wdHMudGVzdFN0YXJ0fHxNT0RFTF9UUkFJTl9FTkQsb3V0PVtdOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IHBheUZ1bGw9b3B0cy5wYXlGdWxsfHxhd2FpdCBsb2FkUGF5RnVsbCgpOwogY29uc3QgbWFwPW5ldyBNYXAoKTsKIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogaWYocmFjZXMubGVuZ3RoPDUwMCl7YnVzeShmYWxzZSk7cmV0dXJue2Vycm9yOiLpgY7ljrvjg4fjg7zjgr/jgYzlsJHjgarjgZnjgY7jgb7jgZnvvIgiK3JhY2VzLmxlbmd0aCsi44Os44O844K577yJ44CC5YWI44Gr6YGO5Y6744Os44O844K544KS5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCIn19CiBjb25zdCBzdG9yZT1uZXcgVUUuU3RvcmUoKSxwcmk9bmV3IFVwUHJpKCkscHByaT1uZXcgUG9wUHJpKCksUz1bXTsKIGZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgcmM9cmFjZXNbaV0sYW09bmV3IE1hcCgpO2Zvcihjb25zdCByIG9mIHJjLnJvd3MpYWdnQWRkKGFtLHIpOwogIGNvbnN0IGluZm89YWdnSW5mbyhhbS5nZXQoU3RyaW5nKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0ucmFjZUlkKSkpOwogIGlmKGluZm8mJmluZm8ueSE9bnVsbCYmcmMuZGF0ZT49U1RBUlQpewogICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICBjb25zdCBoYXNPZGRzPVIuZXZlcnkocj0+ci5vZGRzPjEpLG9kPWhhc09kZHM/Ui5tYXAocj0+ci5vZGRzKTpudWxsOwogICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICB0cnl7CiAgICBjb25zdCBhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCksdT1VRS51cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2QsYXApOwogICAgY29uc3QgcG9wcz1SLm1hcChyPT5yLnBvcCkscG9wc09rPVIubGVuZ3RoPj02JiZwb3BzLmV2ZXJ5KHY9PnY+MCk7CiAgICBsZXQgdTA9bnVsbDtpZihvZCl7dHJ5e3UwPVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxudWxsLFVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG51bGwpKX1jYXRjaChlKXt9fSAgIC8vIOOCquODg+OCuuacquWPluW+l+OBruOBqOOBjeeUqO+8iOWQjOOBmOODrOODvOOCueOCkuOAgeOCquODg+OCuuOBquOBl+OBrueJueW+tOOBp+S9nOOBo+OBn+OCguOBru+8iQogICAgUy5wdXNoKHtkYXRlOnJjLmRhdGUscmFjZUlkOnJjLnJvd3NbMF0ucmFjZUlkLHUsdTAsZHJvcE9kZHM6KGkqNDA1MDM+Pj4wKSUxMDwzLGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSksc2ltOnBvcHNPaz9zaW1GZWF0KGFwLnBQLHBvcHMsUi5sZW5ndGgscHByaSk6bnVsbCxrZWVwOihpKjI2NTQ0MzU3NjE+Pj4wKSUxMD49Myx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pOwogIHtjb25zdCBSUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7aWYoUlIubGVuZ3RoPj02JiZSUi5ldmVyeShyPT5yLnBvcD4wKSYmIVJSLnNvbWUocj0+L+manOWusy8udGVzdChTdHJpbmcoci5yYWNlTmFtZXx8IiIpKSkpcHByaS5hZGQoUlIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLFJSLmxlbmd0aCl9CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgaWYoaSUzMD09PTI5KXtidXN5KHRydWUsYOaZguezu+WIl+OBq+WGjeePvuOBl+OBpuaknOiovOS4reKApiAke2krMX0vJHtyYWNlcy5sZW5ndGh944Os44O844K5YCk7YXdhaXQgc2xlZXAoMCl9CiB9CiBidXN5KHRydWUsIuODouODh+ODq+OCkuavlOi8g+S4reKApiIpO2F3YWl0IHNsZWVwKDApOwogY29uc3QgdHJhaW49Uy5maWx0ZXIocz0+cy5kYXRlPFRFU1QpLHRlc3Q9Uy5maWx0ZXIocz0+cy5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17bkFsbDpTLmxlbmd0aCxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHN0YXJ0OlNUQVJULHRlc3RTdGFydDpURVNULGJhc2U6Uy5sZW5ndGg/Uy5yZWR1Y2UoKGEscyk9PmErcy55LDApL1MubGVuZ3RoOjB9OwogaWYodGVzdC5sZW5ndGg8MzAwfHx0cmFpbi5sZW5ndGg8MTUwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL5pyf6ZaT44Gu44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIGNvbnN0IHlUPXRlc3QubWFwKHM9PnMueSkseTA9dHJhaW4ubWFwKHM9PnMueSk7CiAvLyDnj77ooYzjg6Ljg4fjg6vjga7mpJzoqLzmnJ/plpPjgafjga7miJDnuL4KIGNvbnN0IHAwPXRlc3QubWFwKHM9PnMudS5wMCksbTA9bWV0cmljc09mKHAwLHlUKTsKIC8vIOaWsOODouODh+ODq++8iOWtpue/kuacn+mWk+OBruOBv+OBp+S9nOOCi++8ieOAguW4guWgtOi+vOOBv+OBrueJueW+tChzaW0p44O744Oa44O844K544Gv44CB5L2/44GI44KL44Go44GN44Gg44GR6Kmm44GX44Gm44CB6Imv44GP44Gq44KM44Gw6Laz44GZCiBjb25zdCB4Rm9yPShzLGZsLGlzVHJhaW4pPT57CiAgbGV0IHg9dXBYKChpc1RyYWluJiZzLnUwJiZzLmRyb3BPZGRzKT9zLnUwOnMudSxzLmUpOyAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafjgIHjgqrjg4Pjgrrovrzjgb/jga7nibnlvrTjgpLjgqrjg4PjgrrjgarjgZfjga7nibnlvrTjgavnva7jgY3mj5vjgYjjgIHjgqrjg4PjgrrmnKrlj5blvpfjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICBpZihmbC5wYWNlKXg9Wy4uLngsLi4ucy5wY107CiAgaWYoZmwuc2ltKXtjb25zdCB1c2U9cy5zaW0mJighaXNUcmFpbnx8cy5rZWVwKTt4PVsuLi54LHVzZT8xOjAsLi4uKHVzZT9zLnNpbTpbMCwwLDBdKV19ICAgLy8g5a2m57+S44Gn44GvM+WJsuOBruODrOODvOOCueOBp+W4guWgtOi+vOOBv+OBrueJueW+tOOCkumaoOOBl+OAgeS6uuawl+OBjOacqueiuuWumuOBruOBqOOBjeOBq+OCguWvvuW/nOOBp+OBjeOCi+OCiOOBhuOBq+OBmeOCiwogIHJldHVybiB4OwogfTsKIGNvbnN0IGZpdD1mbD0+ewogIGNvbnN0IG09Zml0TG9naXQodHJhaW4ubWFwKHM9PnhGb3IocyxmbCx0cnVlKSkseTAsMyk7CiAgY29uc3Qgej10ZXN0Lm1hcChzPT5wcmVkTG9naXQobSx4Rm9yKHMsZmwsZmFsc2UpKSk7CiAgcmV0dXJue2ZsLG0sbU46bWV0cmljc09mKHoubWFwKHNpZ20pLHlUKSxtQjptZXRyaWNzT2Yoei5tYXAoKHYsaSk9PnNpZ20oKGxndChwMFtpXSkrdikvMikpLHlUKX07CiB9OwogY29uc3QgVj17YmFzZTpmaXQoe3BhY2U6ZmFsc2Usc2ltOmZhbHNlfSl9OwogY29uc3QgY292VHI9dHJhaW4uZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLGNvdlRlPXRlc3QuZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLHBhY2VPaz1jb3ZUcj49NDAwJiZjb3ZUZT49MTAwOwogY29uc3Qgc2ltVHI9dHJhaW4uZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltVGU9dGVzdC5maWx0ZXIocz0+cy5zaW0pLmxlbmd0aCxzaW1Paz1zaW1Ucj49MTAwMCYmc2ltVGU+PTIwMDsKIHJlcy5wYWNlPXtjb3ZUcmFpbjpjb3ZUcixjb3ZUZXN0OmNvdlRlLHVzZWQ6ZmFsc2V9O3Jlcy5zaW09e3RyYWluTjpzaW1Ucix0ZXN0TjpzaW1UZSx1c2VkOmZhbHNlfTsKIGlmKHNpbU9rKVYuc2ltPWZpdCh7cGFjZTpmYWxzZSxzaW06dHJ1ZX0pOwogaWYocGFjZU9rKVYucGFjZT1maXQoe3BhY2U6dHJ1ZSxzaW06ZmFsc2V9KTsKIGlmKHBhY2VPayYmc2ltT2spVi5ib3RoPWZpdCh7cGFjZTp0cnVlLHNpbTp0cnVlfSk7CiByZXMubTA9bTA7cmVzLm1OPVYuYmFzZS5tTjtyZXMubUI9Vi5iYXNlLm1COwogaWYoVi5zaW0pcmVzLm1TPVYuc2ltLm1OO2lmKFYucGFjZSlyZXMubVA9Vi5wYWNlLm1OO2lmKFYuYm90aClyZXMubVBTPVYuYm90aC5tTjsKIGxldCBjdXI9Vi5iYXNlOwogaWYoVi5zaW0mJmN1ci5tTi5sbC1WLnNpbS5tTi5sbD49LjAwMSljdXI9Vi5zaW07CiB7Y29uc3QgY2FuZD1jdXIuZmwuc2ltP1YuYm90aDpWLnBhY2U7aWYoY2FuZCYmY3VyLm1OLmxsLWNhbmQubU4ubGw+PS4wMDEpY3VyPWNhbmR9CiBjb25zdCBmbGM9Y3VyLmZsLHVzZVBhY2U9ISFmbGMucGFjZSx1c2VTaW09ISFmbGMuc2ltOwogcmVzLnBhY2UudXNlZD11c2VQYWNlO3Jlcy5zaW0udXNlZD11c2VTaW07cmVzLnVzZVBhY2U9dXNlUGFjZTtyZXMudXNlU2ltPXVzZVNpbTsKIC8vIOaOoeeUqOOBruWIpOaWre+8muePvuihjOOCiOOCiuWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK6Imv44GP44Gq44KK44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44GoCiBjb25zdCBiZXR0ZXI9KG0scmVmKT0+KHJlZi5sbC1tLmxsPj0uMDAyKSYmKG0uYXVjPj1yZWYuYXVjLS4wMDMpOwogbGV0IGtpbmQ9Im9sZCI7CiBjb25zdCBrYz1bWyJuZXciLGN1ci5tTl0sWyJibGVuZCIsY3VyLm1CXV0uZmlsdGVyKChbayxtXSk9PmJldHRlcihtLG0wKSkuc29ydCgoYSxiKT0+YVsxXS5sbC1iWzFdLmxsKVswXTsKIGlmKGtjKWtpbmQ9a2NbMF07CiBjb25zdCBNMj1jdXIubSx4eD1zPT54Rm9yKHMsZmxjLGZhbHNlKTsKIHJlcy5raW5kPWtpbmQ7CiAvLyDnrYnntJrjga7liIfjgoznm67jga/jgIzlrabnv5LlgbTjgI3jga7kuojmuKzjgYvjgonmsbrjgoHjgIHmpJzoqLzlgbTjgaflrp/pmpvjga7ms6LkubHnjofjgpLmuKzjgovvvIjmraPnm7Tjgarlrp/nuL7njofvvIkKIGNvbnN0IHByZWRUcmFpbj1zPT5raW5kPT09Im9sZCI/cy51LnAwOmtpbmQ9PT0ibmV3Ij9zaWdtKHByZWRMb2dpdChNMix4eChzKSkpOnNpZ20oKGxndChzLnUucDApK3ByZWRMb2dpdChNMix4eChzKSkpLzIpOwogY29uc3QgY3V0cz1tYWtlQ3V0cyh0cmFpbi5tYXAocHJlZFRyYWluKSk7CiBjb25zdCBwVGVzdD10ZXN0Lm1hcChwcmVkVHJhaW4pLHRhYj1ncmFkZVRhYmxlKGN1dHMscFRlc3QseVQpOwogcmVzLmN1dHM9Y3V0cztyZXMudGFiPXRhYjsKIC8vIOS6iOaDs+OBruetiee0muOBlOOBqOOBq+OAgeWun+mam+OBruaJleaIu+OBp+eiuuOBi+OCgeOCi++8iOaOoeeUqOOBl+OBn+ODouODh+ODq+OBqOOAgeaomea6luODouODh+ODq+OBruS4oeaWue+8iQoge2NvbnN0IGlkeD1uZXcgTWFwKHRlc3QubWFwKChzLGkpPT5bcyxpXSkpOwogIHJlcy5wYXlUYWI9cGF5b3V0VGFibGUodGVzdCxzPT5ncmFkZU9mKGN1dHMscFRlc3RbaWR4LmdldChzKV0pLHBheUZ1bGwpOwogIHJlcy5wYXlUYWJTdGQ9cGF5b3V0VGFibGUodGVzdCxzPT57Y29uc3QgRz1VRS5BWElTLnVwc2V0LmdyYWRlc1tzLnUubW9kZV07Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cylpZihzLnUucDA+PWMpcmV0dXJuIGc7cmV0dXJuIkMifSxwYXlGdWxsKTsKICByZXMucGF5TW9ubz1wYXlvdXRNb25vdG9uZShyZXMucGF5VGFiKTtyZXMucGF5TW9ub1N0ZD1wYXlvdXRNb25vdG9uZShyZXMucGF5VGFiU3RkKTsKICByZXMucGF5UmFjZXM9T2JqZWN0LnZhbHVlcyhyZXMucGF5VGFiKS5yZWR1Y2UoKGEseCk9PmEreC5ucCwwKTt9CiByZXMubW9kZWw9e3Zlcjo0LGtpbmQscGFjZTp1c2VQYWNlLHNpbTp1c2VTaW0sbW9kZWw6TTIscGF5VGFiOnJlcy5wYXlUYWIsY3V0cyxyYXRlczpPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModGFiKS5tYXAoKFtnLHhdKT0+W2cse3JhdGU6eC5yYXRlLGxvOngubG8saGk6eC5oaSxuOngubn1dKSksCiAgYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsbTAsbU46cmVzLm1OLG1COnJlcy5tQixtUDpyZXMubVB8fG51bGwsbVM6cmVzLm1TfHxudWxsLG1QUzpyZXMubVBTfHxudWxsLHBhY2VDb3Y6W2NvdlRyLGNvdlRlXSxzaW1Db3Y6W3NpbVRyLHNpbVRlXX07CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiB1cHNldFJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yI44CcJHtlc2Moci50ZXN0U3RhcnQpfeOBruWJjeaXpe+8ie+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAguWFqOS9k+OBruazouS5seeOhyAke3BjdChyLmJhc2UsMSl944CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Oi44OH44Or77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93KCLnj77ooYwiLHIubTApfSR7cm93KCLmlrDvvIjjgrPjg7zjgrnliKXjgpLov73liqDvvIkiLHIubU4pfSR7cm93KCLnj77ooYzjgajmlrDjga7lubPlnYciLHIubUIpfSR7ci5tUz9yb3coIuaWsO+8iOOCs+ODvOOCueWIpe+8i+W4guWgtOi+vOOBv+OBrueiuueOh++8iSIsci5tUyk6IiJ9JHtyLm1QP3Jvdygi5paw77yI44Kz44O844K55Yil77yL44Oa44O844K577yJIixyLm1QKToiIn0ke3IubVBTP3Jvdygi5paw77yI44GZ44G544Gm77yJIixyLm1QUyk6IiJ9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1yLnNpbSYmci5zaW0udGVzdE4+PTIwMD9gPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8iOWQhOmmrOOBrueiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeazouS5seOBq+OBquOCi+eiuueOh+OCkuebtOaOpeimi+epjeOCguOCi++8ie+8muWtpue/kuWBtCR7ci5zaW0udHJhaW5OfeODu+aknOiovOWBtCR7ci5zaW0udGVzdE5944Os44O844K544Gn5L2/44GI44G+44GX44Gf44CCJHtyLnVzZVNpbT8iPGI+5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8muS6uuawl+mghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj+OAgeaknOiovOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAgjwvZGl2PmA7CiBoKz1yLnBhY2UmJnIucGFjZS51c2VkP2A8ZGl2IGNsYXNzPSJzbWFsbCI+44Oa44O844K544O76ISa6LOq44Gu54m55b606YeP77ya5a2m57+S5YG0JHtyLnBhY2UuY292VHJhaW5944O75qSc6Ki85YG0JHtyLnBhY2UuY292VGVzdH3jg6zjg7zjgrnjgafkvb/jgYjjgb7jgZfjgZ/jgIIke3IudXNlUGFjZT8iPGI+44Oa44O844K544KS5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuODmuODvOOCueOCkuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuODmuODvOOCueODu+iEmuizqu+8mumAmumBjumghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj++8iOWtpue/kuWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUcmFpbjowfeODu+aknOiovOWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUZXN0OjB944Os44O844K577yJ44CB5qSc6Ki844Gn44GN44G+44Gb44KT44Gn44GX44Gf44CC6Kit5a6a44Gu44CM44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX44CN44KS5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODq+OBruOBvuOBvu+8iOaWsOODouODh+ODq+OBr+aYjueiuuOBq+OBr+iJr+OBj+OBquOCieOBquOBi+OBo+OBn++8iSIsbmV3OiLmlrDjg6Ljg4fjg6vjgpLmjqHnlKgiKyhyLnVzZVNpbT8i77yI5biC5aC06L6844G/77yJIjoiIikrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIiksYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+Wdh+OCkuaOoeeUqCIrKHIudXNlU2ltPyLvvIjluILloLTovrzjgb/vvIkiOiIiKSsoci51c2VQYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIiKX1bci5raW5kXTsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmtpbmQ9PT0ib2xkIj8id24iOiJvayJ9Ij48Yj7ntZDmnpzvvJoke25tfTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mjqHnlKjmnaHku7bvvJrlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuaUueWWhOOBl+OAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqOOAgjwvc3Bhbj48L2Rpdj5gOwogaCs9cGF5b3V0UmVwb3J0KHIpOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7nrYnntJrjgZTjgajjga48Yj7lrp/pmpvjga7ms6LkubHnjoc8L2I+77yI5qSc6Ki85YG044O7OTUl44Gu5bmF77yJ44CC44GT44Gu5pWw5a2X44GM44CB5rOi5Lmx5bqm44K/44OW44Gr6KGo56S644GV44KM44KL44KI44GG44Gr44Gq44KK44G+44GZ44CCPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuetiee0mjwvdGg+PHRoPuODrOODvOOCueaVsDwvdGg+PHRoPuWun+mam+OBruazouS5seeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtnXSBvZiBVUF9TSEFSRSl7Y29uc3QgeD1yLnRhYltnXTtoKz1gPHRyPjx0ZD4ke2d9PC90ZD48dGQ+JHt4Lm59PC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvKX3jgJwke3BjdCh4LmhpKX08L3RkPjwvdHI+YH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGNvbnN0IG1vbm89VVBfU0hBUkUubWFwKChbZ10pPT5yLnRhYltnXS5yYXRlKS5ldmVyeSgodixpLGEpPT5pPT09MHx8djw9YVtpLTFdKy4wMyk7CiBpZighbW9ubyloKz0nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+562J57Sa44Gu6aCG44Gr5a6f57i+546H44GM5Y2Y6Kq/44Gr5LiL44GM44Gj44Gm44GE44G+44Gb44KT44CC5qSc6Ki85YG044Gu44Os44O844K55pWw44GM5bCR44Gq44GE44Go6LW344GN44G+44GZ77yI5YG254S244Gu56+E5Zuy44Gu44GT44Go44GM5aSa44GE77yJ44CCPC9kaXY+JzsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBheW91dFJlcG9ydChyKXsKIGlmKCFyLnBheVRhYnx8IXIucGF5UmFjZXMpcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOWPluW+l+OBp+OBjeOBpuOBhOOBquOBhOOBn+OCgeOAgeWun+mam+OBruaJleaIu+OBp+OBrueiuuiqjeOBr+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn++8iOOAjOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OAjeOBp+aJleaIu+OCguWPluW+l+OBleOCjOOBvuOBme+8ieOAgjwvZGl2Pic7CiBjb25zdCB5ZW49dj0+dj09bnVsbD8iLSI6TWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygpKyLlhoYiLHRibD0odCx0aXRsZSk9PnsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7dGl0bGV9PC9iPjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7kuojmg7Pjga7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD7li53jgaHppqzjga7ljZjli53phY3lvZPvvIjkuK3lpK7lgKTvvI/lubPlnYfvvIk8L3RoPjx0aD7ljZjli50xMDAw5YaG5Lul5LiKPC90aD48dGg+6KSH5YudM+mgreOBruWQiOioiO+8iOW5s+Wdh++8iTwvdGg+PHRoPjPnnYDlhoXjga7kurrmsJflkIjoqIg8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgW2ddIG9mIFVQX1NIQVJFKXtjb25zdCB4PXRbZ107aCs9YDx0cj48dGQ+PGI+JHtnfTwvYj48L3RkPjx0ZD4ke3gubnB9PC90ZD48dGQ+JHtwY3QoeC5yYXRlLDEpfTwvdGQ+PHRkPiR7eWVuKHgubWVkV2luKX3vvI8ke3llbih4LmF2Z1dpbil9PC90ZD48dGQ+JHt4LnNoYXJlMTAwMD09bnVsbD8iLSI6cGN0KHguc2hhcmUxMDAwLDApfTwvdGQ+PHRkPiR7eWVuKHguYXZnUGxhY2VTdW0pfTwvdGQ+PHRkPiR7eC5hdmdQb3BTdW09PW51bGw/Ii0iOnguYXZnUG9wU3VtLnRvRml4ZWQoMSl9PC90ZD48L3RyPmB9CiAgcmV0dXJuIGgrIjwvdGJvZHk+PC90YWJsZT48L2Rpdj4ifTsKIGxldCBoPWA8aDM+5LqI5oOz44Gu562J57Sa44GU44Go44Gu44CB5a6f6Zqb44Gu5omV5oi777yI5qSc6Ki85YG0ICR7ci5wYXlSYWNlc33jg6zjg7zjgrnvvIk8L2gzPjxkaXYgY2xhc3M9InNtYWxsIj7ms6LkubHluqbjga7kuojmg7PjgYzlvZPjgZ/jgaPjgabjgYTjgovjgarjgonjgIHnrYnntJrjgYzpq5jjgYTjgbvjganjgIHli53jgaHppqzjga7ljZjli53phY3lvZPjg7vopIfli50z6aCt44Gu5ZCI6KiI44O7M+edgOWGheOBruS6uuawl+WQiOioiOOBjOWkp+OBjeOBj+OBquOCiuOBvuOBmeOAgjwvZGl2PmA7CiBoKz10Ymwoci5wYXlUYWIsci5raW5kPT09Im9sZCI/IuaOoeeUqOOBl+OBn+S6iOaDs++8iOePvuihjOODouODh+ODq++8iSI6IuaOoeeUqOOBl+OBn+S6iOaDs++8iOWGjeagoeato+W+jO+8iSIpOwogY29uc3QgbT1yLnBheU1vbm87CiBoKz1tLnRvdD9gPGRpdiBjbGFzcz0iYmFubmVyICR7bS5vaz09PW0udG90PyJvayI6InduIn0iPjxiPiR7bS5vaz09PW0udG90PyLnrYnntJrjgYzkuIrjgYzjgovjgbvjganjgIHlrp/pmpvjga7miZXmiLvjgoLlpKfjgY3jgY/jgarjgaPjgabjgYTjgb7jgZnjgIIiOiLnrYnntJrjgYzkuIrjgYzjgaPjgabjgoLmiZXmiLvjgYzlpKfjgY3jgY/jgarjgonjgarjgYTnrofmiYDjgYzjgYLjgorjgb7jgZnvvIgiK20ub2srIi8iK20udG90KyLntYTvvInjgIIifTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7pmqPjgorlkIjjgYbnrYnntJrjga7mr5TovIPjgafjgIHopIfli50z6aCt44Gu5ZCI6KiI5omV5oi744GoM+edgOWGheOBruS6uuawl+WQiOioiOOBruS4oeaWueOBjOOAgeS4iuOBruetiee0muOBruaWueOBjOWkp+OBjeOBhO+8iOOBvuOBn+OBrzUl5Lul5YaF44Gu5beu77yJ57WE44Gu5pWw44Gn44GZ44CC5Y2Y5Yud6YWN5b2T44Gu5Lit5aSu5YCk44Gv5bCR5pWw44Gu44Os44O844K544Gg44Go5YG254S244Gn44G244KM44KL44Gf44KB44CB5Yik5a6a44Gr44Gv5L2/44Gj44Gm44GE44G+44Gb44KT44CCPC9zcGFuPjwvZGl2PmA6IiI7CiBpZihyLmtpbmQhPT0ib2xkIiloKz10Ymwoci5wYXlUYWJTdGQsIuWPguiAg++8muaomea6luODouODh+ODq+OBruetiee0muOBp+WQjOOBmOmbhuioiOOCkuOBl+OBn+WgtOWQiCIpKyhyLnBheU1vbm9TdGQudG90P2A8ZGl2IGNsYXNzPSJzbWFsbCI+5qiZ5rqW44Oi44OH44Or44Gu562J57Sa44Gu5pW05ZCI77yaJHtyLnBheU1vbm9TdGQub2t9LyR7ci5wYXlNb25vU3RkLnRvdH3ntYQ8L2Rpdj5gOiIiKTsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHVwc2V0U3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRVcHNldE1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuaomea6luODouODh+ODq++8iOWtpue/kua4iOOBv+OBruWbuuWumuODouODh+ODq++8ieOAguWun+e4vueOh+OBr+Wtpue/kuaZguOBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiBjb25zdCBubT17b2xkOiLnj77ooYzjg6Ljg4fjg6siLG5ldzoi5YaN5qCh5q2j44GX44Gf5paw44Oi44OH44OrIixibGVuZDoi54++6KGM44Go5paw44Gu5bmz5Z2HIn1bTS5raW5kXTsKIHJldHVybmA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+JHtubX08L2I+44Gn5Yik5a6a5Lit77yI5qSc6Ki85pelICR7ZXNjKE0uYXQpfe+8j+aknOiovCAke00ublRlc3R944Os44O844K577yJ44CC562J57Sa44Gu5a6f57i+546H44Gv44CB44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn5ris44Gj44Gf5YCk44Gn44GZ44CCPC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOi/veWKoOOBruadoeS7tu+8mummrOWgtOeKtuaFi+ODu+aeoOmghu+8iOmmrOeVquOBruS9jee9ru+8ieODu+iqv+aVmeW4q+ODu+ihgOe1sQogKiAg44GZ44G544Gm44CM44Gd44Gu5pel44KI44KK5YmN44Gr5YiG44GL44Gj44Gm44GE44KL5oOF5aCx44CN44Gg44GR44Gn5L2c44KK44CB5Yq55p6c44GM44GC44KL44Go44GN44Gg44GR77yI5qSc6Ki844Gn77yJ5o6h55So44GZ44KL44CCCiAqICAg44O76aas5aC054q25oWL44Gu55u45oCn77ya44Gd44Gu6aas44GM44CB5ZCM44GY6aas5aC054q25oWL77yI6Imv77yP56iN6YeN44Cc5LiN6Imv77yJ44Gn6YGO5Y6744Gr44Gp44KM44Gg44GR6LWw44Gj44Gf44GLCiAqICAg44O75p6g6aCG44Gu5pyJ5Yip5LiN5Yip77ya6ZaL5YKs5aC0w5foip3jg4DDl+i3nembouOBlOOBqOOBruOAgeWGheOAnOWkluOBrjPnnYDlhoXnjofjga7lgY/jgooKICogICDjg7voqr/mlZnluKvvvJroqr/mlZnluKvjga7pgY7ljrvjga4z552A5YaF546HCiAqICAg44O76KGA57Wx77ya54i244O75q+N44Gu54i244GM44CB5ZCM44GY6Iqd44OAw5fot53pm6LjgafpgY7ljrvjgavjganjgozjgaDjgZHotbDjgaPjgZ/jgYvvvIjlh7rppqzooajjgYvjgonlsJHjgZfjgZrjgaTok4TnqY3jgILoqq3jgoHjgZ/ppqzjgaDjgZHvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBnb2luZ0NvZGU9dD0+e3Q9U3RyaW5nKHR8fCIiKTtyZXR1cm4v5LiN6ImvLy50ZXN0KHQpPzQ6L+eojS8udGVzdCh0KT8yOi/ph40vLnRlc3QodCk/Mzov6ImvLy50ZXN0KHQpPzE6MH07CmNvbnN0IGdvaW5nQ2F0PWc9Pmc9PT0xPzE6KGc+PTI/MjowKTsgICAgLy8gMT3oia/jgIEyPeeojemHjeOAnOS4jeiJr+OAgTA95LiN5piOCmNvbnN0IEdPSU5HX05BTUU9ezA6IuS4jeaYjiIsMToi6ImvIiwyOiLph43ns7sifTsKY29uc3QgdmVudWVGcm9tSWQ9aWQ9PntpZD1TdHJpbmcoaWR8fCIiKTtyZXR1cm4vXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6KGlkLnNwbGl0KCItIilbM118fCIiKX07CmxldCBQRUQ9e307ICAgLy8g6aas5ZCNIOKGkiB7czrniLYsZDrmr40sbTrmr43jga7niLZ944CC5Ye66aas6KGo44GL44KJ5bCR44GX44Ga44Gk6JOE56mN44GZ44KLCgovKiDmnqDpoIbvvIjppqznlarjga7kvY3nva7vvInvvJrplovlgqzloLTDl+iKneODgMOX6Led6Zui44GU44Go44Gr44CB5YaF44Cc5aSWNeWMuuWIhuOBrjPnnYDlhoXnjocgKi8KY2xhc3MgRHJhd1ByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5tPW5ldyBNYXAoKX0KIF9iKG51bSxOKXtyZXR1cm4gTj4xP01hdGgubWluKDQsTWF0aC5tYXgoMCxNYXRoLmZsb29yKChudW0tMSkvTio1KSkpOjJ9CiBfayh2LHMsZCl7cmV0dXJuIHYrInwiK3MrInwiK2Rpc3RCKGQpfQogYWRkKHYscyxkLG51bSxOLHQzKXsKICBpZighbnVtfHxOPDgpcmV0dXJuOwogIGNvbnN0IGs9dGhpcy5fayh2LHMsZCksYj10aGlzLl9iKG51bSxOKTtsZXQgZz10aGlzLm0uZ2V0KGspOwogIGlmKCFnKXRoaXMubS5zZXQoayxnPXtuOjAsdDowLGI6W1swLDBdLFswLDBdLFswLDBdLFswLDBdLFswLDBdXX0pOwogIGcubisrO2cudCs9dDM7Zy5iW2JdWzBdKys7Zy5iW2JdWzFdKz10MzsKIH0KIGZlYXQodixzLGQsbnVtLE4pewogIGlmKCFudW18fE48OClyZXR1cm4gMDsKICBjb25zdCBnPXRoaXMubS5nZXQodGhpcy5fayh2LHMsZCkpO2lmKCFnfHxnLm48MzAwKXJldHVybiAwOwogIGNvbnN0IGI9dGhpcy5fYihudW0sTiksYmFzZT1nLnQvZy5uLEs9NjAsW24sdF09Zy5iW2JdOwogIHJldHVybiBsZ3QoKHQrSypiYXNlKS8obitLKSktbGd0KGJhc2UpOwogfQp9Ci8qIOihgOe1se+8mueItuODu+avjeOBrueItuOBlOOBqOOBruOAgeiKneODgMOX6Led6Zui44Gn44Gu44CM5a6f6Zqb44GuM+edgOWGheaVsCDDtyDmnJ/lvoXjga4z552A5YaF5pWw77yIMy/poK3mlbDjga7lkIjoqIjvvInjgI0gKi8KY2xhc3MgU2lyZVByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5tPW5ldyBNYXAoKX0KIGtleShraW5kLHYsc2YsZCl7cmV0dXJuIGtpbmQrInwiK3YrInwiK3NmKyJ8IitkaXN0QihkKX0KIGFkZChwZWQsc2YsZCx0MyxOKXsKICBpZighcGVkfHxOPDgpcmV0dXJuO2NvbnN0IGU9TWF0aC5taW4oLjUsMy9OKTsKICBmb3IoY29uc3QgW2tpbmQsdl0gb2YgW1sicyIscGVkLnNdLFsibSIscGVkLm1dXSl7CiAgIGlmKCF2KWNvbnRpbnVlO2NvbnN0IGs9dGhpcy5rZXkoa2luZCx2LHNmLGQpO2xldCB4PXRoaXMubS5nZXQoayk7CiAgIGlmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdDowLGU6MH0pO3gubisrO3gudCs9dDM7eC5lKz1lOwogIH0KIH0KIGZlYXQocGVkLHNmLGQpewogIGlmKCFwZWQpcmV0dXJuWzAsMCwwLDBdOwogIGNvbnN0IGc9KHYsa2luZCk9PntpZighdilyZXR1cm5bMCwwXTtjb25zdCB4PXRoaXMubS5nZXQodGhpcy5rZXkoa2luZCx2LHNmLGQpKTtpZigheHx8eC5uPDI1KXJldHVyblswLDBdO3JldHVybltNYXRoLmxvZygoeC50KzMpLyh4LmUrMykpLDFdfTsKICByZXR1cm5bLi4uZyhwZWQucywicyIpLC4uLmcocGVkLm0sIm0iKV07CiB9Cn0KLyogMemgreOBtuOCk+OBrui/veWKoOeJueW+tO+8iDnlgIvvvInvvJrppqzloLTjga7nm7jmgKfjg7vmnInnhKHvvI/mnqDpoIbjga7lgY/jgorvvI/oqr/mlZnluKvjga7lt67jg7vmnInnhKHvvI/niLbjga7nm7jmgKfjg7vmnInnhKHvvI/mr43jga7niLbjga7nm7jmgKfjg7vmnInnhKEgKi8KZnVuY3Rpb24gZXh0RmVhdEhvcnNlKHIsaCxyYyxjdHgsYil7CiBjb25zdCBuMD1oP2gubjowLHBTPSgoaD9oLnRvcDM6MCkrMypiKS8objArMyk7CiBsZXQgZ2ZpdD0wLGdrPTA7Y29uc3QgZ249aCYmaC5nbiYmcmMuZ2M+MD9oLmduW3JjLmdjXTpudWxsOwogaWYoZ24mJmduWzBdPj0yKXtnZml0PShnblsxXSszKnBTKS8oZ25bMF0rMyktcFM7Z2s9MX0KIGNvbnN0IGRyYXc9Y3R4LmRyYXc/Y3R4LmRyYXcuZmVhdChyYy52LHJjLnN1cmYscmMuZGlzdCxyLm51bSxyYy5OKTowOwogbGV0IHRlPTAsdGs9MDtjb25zdCB0cj1jdHgudHImJnIudHJhaW5lcj9jdHgudHIuZ2V0KHIudHJhaW5lcik6bnVsbDsKIGlmKHRyJiZ0ci5uPj0yMCl7dGU9KHRyLnQzKy4yKjQwKS8odHIubis0MCktLjI7dGs9MX0KIGNvbnN0IHNmPWN0eC5zaXJlP2N0eC5zaXJlLmZlYXQoY3R4LnBlZCYmY3R4LnBlZFtyLmhvcnNlXSxyYy5zdXJmLHJjLmRpc3QpOlswLDAsMCwwXTsKIHJldHVybltnZml0LGdrLGRyYXcsdGUsdGssLi4uc2ZdOwp9Ci8qIOWxpeattOOBi+OCieOAgeWHuummrOihqOOBi+OCieiqreOCk+OBoOihgOe1seOCkuiThOepje+8iOmAseacq+OBruWPluW+l+OBruOBn+OBs+OBq+abtOaWsOOBl+OBpuS/neWtmO+8iSAqLwphc3luYyBmdW5jdGlvbiBwZWRpZ3JlZVVwZGF0ZShjYXJkcyl7CiBsZXQgYWRkZWQ9MCxzZWVuPTA7CiBmb3IoY29uc3QgZCBvZiBPYmplY3Qua2V5cyhjYXJkcykpZm9yKGNvbnN0IGMgb2YgY2FyZHNbZF18fFtdKWZvcihjb25zdCBoIG9mIChjLmhvcnNlc3x8W10pKXsKICBjb25zdCBuYW1lPVVFLm5uKGguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiKTtpZighbmFtZSljb250aW51ZTsKICBpZihoLnNpcmV8fGguZGFtU2lyZSl7c2VlbisrO2NvbnN0IG89e3M6VUUubm4oaC5zaXJlfHwiIiksZDpVRS5ubihoLmRhbXx8IiIpLG06VUUubm4oaC5kYW1TaXJlfHwiIil9OwogICBjb25zdCBwPVBFRFtuYW1lXTtpZighcHx8cC5zIT09by5zfHxwLm0hPT1vLm0pe1BFRFtuYW1lXT1vO2FkZGVkKyt9fQogfQogaWYoYWRkZWQpe3RyeXthd2FpdCBtZXRhUHV0KCJwZWQiLFBFRCl9Y2F0Y2goZSl7fX0KIHJldHVybntzZWVuLGFkZGVkLHRvdGFsOk9iamVjdC5rZXlzKFBFRCkubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBwZWRpZ3JlZUxvYWQoKXt0cnl7Y29uc3QgeD1hd2FpdCBtZXRhR2V0KCJwZWQiKTtpZih4JiZ0eXBlb2YgeD09PSJvYmplY3QiKVBFRD14fWNhdGNoKGUpe319CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44Gu5qSc6Ki844O75YaN5qCh5q2jCiAqICDnm67nmoTvvJrlkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44GG5pWw5a2X44Gr44GZ44KL44CCCiAqICDjgoTjgovjgZPjgajvvJoKICogICAxKSDpgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHjg6zjg7zjgrnliY3jgavliIbjgYvjgovmg4XloLHjgaDjgZHjgaflkITppqzjga7norrnjofjgpLoqIjnrpcKICogICAgICAgIOODu+mBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+ODouODh+ODq+OBrueiuueOh++8iOOCquODg+OCuuOCkuS9v+OCj+OBquOBhO+8iQogKiAgICAgICAg44O75Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7jgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H77yI5biC5aC044Gu5oOF5aCx44CC44Kq44OD44K65Y+W5b6X5b6M44Gv5Lq65rCX6aCG5L2N44GM5rG644G+44KL77yJCiAqICAgMikgMuOBpOOCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq++8iOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8ieOCkuOAgeWtpue/kuWBtOOBruacn+mWk+OBp+S9nOOCiwogKiAgIDMpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDQpIOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAgui2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWIh+OCjOebruOCguOAgeOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFBMS0VZPSJrZWliYV9wbGFjZV92MSI7CgovKiDkurrmsJfpoIbkvY3Dl+mgreaVsOOBlOOBqOOBruOAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga8zL+mgreaVsOOBuOWvhOOBm+OCi++8iSAqLwpjbGFzcyBQb3BQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBrZXkocG9wLE4pe3JldHVybiBNYXRoLm1pbigxOCxwb3ApKyJ8IitNYXRoLm1pbigxOCxNYXRoLm1heCg2LE4pKX0KIGFkZChsaXN0LE4pewogIGZvcihjb25zdCBbcG9wLGZpbl0gb2YgbGlzdCl7CiAgIGlmKCEocG9wPjApfHxmaW49PW51bGwpY29udGludWU7CiAgIGNvbnN0IGs9dGhpcy5rZXkocG9wLE4pO2xldCB4PXRoaXMubS5nZXQoayk7aWYoIXgpdGhpcy5tLnNldChrLHg9e246MCx0OjB9KTsKICAgeC5uKys7aWYoZmluPD0zKXgudCsrOwogIH0KIH0KIHJhdGUocG9wLE4pewogIGNvbnN0IHg9dGhpcy5tLmdldCh0aGlzLmtleShwb3AsTikpfHx7bjowLHQ6MH0sYmFzZT1NYXRoLm1pbiguOTUsMy9NYXRoLm1heChOLDMpKSxLPTMwOwogIHJldHVybih4LnQrSypiYXNlKS8oeC5uK0spOwogfQp9Ci8qIOeiuueOh+OBruWQiOioiOOCkuOBoeOCh+OBhuOBqXRhcmdldOOBq+OBmeOCi++8iOODreOCuOODg+ODiOOCkuS4gOanmOOBq+OBmuOCieOBme+8iSAqLwpmdW5jdGlvbiBub3JtU3VtKHosdGFyZ2V0KXsKIGxldCBsbz0tMTQsaGk9MTQ7CiBmb3IobGV0IGl0PTA7aXQ8NjA7aXQrKyl7Y29uc3QgbWlkPShsbytoaSkvMjtsZXQgcz0wO2Zvcihjb25zdCB2IG9mIHopcys9c2lnbSh2K21pZCk7aWYocz50YXJnZXQpaGk9bWlkO2Vsc2UgbG89bWlkfQogY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHoubWFwKHY9PnNpZ20oditjKSk7Cn0KLyogMemgreOBruWFpeWKm++8muODouODh+ODq+eiuueOh+ODu+S6uuawl+ODmeODvOOCueOBruWun+e4vueOh+ODu+S6uuawl+OBruS9jee9ruODu+mgreaVsOODu+ODouODh+ODq+WGheOBrumghuS9jSAqLwpmdW5jdGlvbiBwbGFjZVgocFAscG9wLE4scHJpLHJhbmtGcmFjKXsKIHJldHVybltsZ3QocFApLGxndChwcmkucmF0ZShwb3AsTikpLChwb3AtMSkvTWF0aC5tYXgoMSxOLTEpLE4vMTYscmFua0ZyYWMscG9wPT09MT8xOjAscG9wPD0zPzE6MF07Cn0KY29uc3QgcmFua0ZyYWNzPXBzPT57Y29uc3Qgbz1wcy5tYXAoKHAsaSk9PmkpLnNvcnQoKGEsYik9PnBzW2JdLXBzW2FdKSxyaz1BcnJheShwcy5sZW5ndGgpO28uZm9yRWFjaCgoaSxyKT0+cmtbaV09ci9NYXRoLm1heCgxLHBzLmxlbmd0aC0xKSk7cmV0dXJuIHJrfTsKY29uc3QgcG9wc0Zyb21PZGRzPW9kPT5vZC5tYXAodj0+MStvZC5maWx0ZXIodz0+dzx2KS5sZW5ndGgpOwoKY29uc3QgZ2V0UGxhY2VNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oUExLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmtpbmQ9PT0ibmV3IiYmbS5tb2RlbCYmbS52ZXI9PT0yP206bnVsbH1jYXRjaChlKXtyZXR1cm4gbnVsbH19OwoKLyog5Y+N5b+c44Gu56K66KqN55So77ya5LqI5ris44Gu5Yy66ZaT44GU44Go44Gu5a6f57i+77yI5L+h6aC85oCn77yJICovCmZ1bmN0aW9uIHJlbGlhYmlsaXR5QmlucyhwLHksQil7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksbj15Lmxlbmd0aCxvdXQ9W107CiBmb3IobGV0IGI9MDtiPEI7YisrKXsKICBjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBrPXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCksdz13aWxzb24oayxzLmxlbmd0aCk7CiAgb3V0LnB1c2goe2xvOnBbc1swXV0saGk6cFtzW3MubGVuZ3RoLTFdXSxuOnMubGVuZ3RoLG1lYW46cy5yZWR1Y2UoKGEsaSk9PmErcFtpXSwwKS9zLmxlbmd0aCxhY3Q6ay9zLmxlbmd0aCx3bG86d1swXSx3aGk6d1sxXX0pOwogfQogcmV0dXJuIG91dDsKfQpmdW5jdGlvbiB0aHJlc2hvbGRSb3cocCx5LHQpewogbGV0IG49MCxrPTA7Zm9yKGxldCBpPTA7aTxwLmxlbmd0aDtpKyspaWYocFtpXT49dCl7bisrO2srPXlbaV19CiBjb25zdCB3PXdpbHNvbihrLG4pO3JldHVybnt0LG4sayxyYXRlOm4/ay9uOjAsbG86d1swXSxoaTp3WzFdfTsKfQoKLyogLS0tLS0tLS0tLSDnqbTppqzjgr7jg7zjg7PvvIjkurrmsJfjga7kuIvkvY3vvInjgafjga7mpJzoqLwgLS0tLS0tLS0tLQogICDnqbTppqzvvJ3kurrmsJfpoIbkvY3jgYwgbWF4KDUsIOmgreaVsOOBrjQwJeWIh+OCiuS4iuOBkikg5Lul5LiL44Gu6aas44CC6KmV5L6hKFMvQS9CL0Mp44Gv44CB5a2m57+S5YG044Gu56m06aas44Gu5LqI5ris56K6546H44Gu5LiK5L2NNCXvvI8xMiXvvI8zMCXjgafljLrliIfjgosgKi8KYXN5bmMgZnVuY3Rpb24gbG9hZFBheU1hcCgpewogY29uc3QgbT1uZXcgTWFwKCk7CiB0cnl7Zm9yKGNvbnN0IGRheSBvZiBhd2FpdCBwYXlBbGwoKSlmb3IoY29uc3QgciBvZiAoZGF5LnJhY2VzfHxbXSkpaWYoci5yYWNlSWQmJnIucGxhY2UpbS5zZXQoci5yYWNlSWQsci5wbGFjZSl9Y2F0Y2goZSl7fQogcmV0dXJuIG07Cn0KZnVuY3Rpb24gaG9sZUV2YWwobW9kZWwseGYsdHJhaW4sdGVzdCxwYXlNYXAsdGVzdERheXMpewogY29uc3Qgc29ydGVkPVtdOwogZm9yKGNvbnN0IHIgb2YgdHJhaW4pe2NvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57aWYoaC5ob2xlKXNvcnRlZC5wdXNoKHZbal0pfSl9CiBzb3J0ZWQuc29ydCgoYSxiKT0+Yi1hKTsKIGNvbnN0IHE9Zj0+c29ydGVkW01hdGgubWluKHNvcnRlZC5sZW5ndGgtMSxNYXRoLm1heCgwLE1hdGgucm91bmQoc29ydGVkLmxlbmd0aCpmKS0xKSldOwogY29uc3QgY3V0cz17UzpxKC4wNCksQTpxKC4xMiksQjpxKC4zMCl9OwogY29uc3QgZ3JhZGU9cD0+cD49Y3V0cy5TPyJTIjpwPj1jdXRzLkE/IkEiOnA+PWN1dHMuQj8iQiI6IkMiOwogY29uc3QgdGFiPXtTOntuOjAsazowLHBiOjAscGF5OjB9LEE6e246MCxrOjAscGI6MCxwYXk6MH0sQjp7bjowLGs6MCxwYjowLHBheTowfSxDOntuOjAsazowLHBiOjAscGF5OjB9fTsKIGNvbnN0IHJrPXtuZXc6e3QxOntuOjAsazowLHBiOjAscGF5OjB9LHQyOntuOjAsazowLHBiOjAscGF5OjB9fSxwUDp7dDE6e246MCxrOjAscGI6MCxwYXk6MH0sdDI6e246MCxrOjAscGI6MCxwYXk6MH19LG1rdDp7dDE6e246MCxrOjAscGI6MCxwYXk6MH0sdDI6e246MCxrOjAscGI6MCxwYXk6MH19fTsKIGxldCBuSG9sZT0wLGtIb2xlPTA7Y29uc3QgcEhvbGU9W10seUhvbGU9W107CiBjb25zdCBiZXQ9KHN0LHIsaCk9PntzdC5uKys7c3Quays9aC55O2NvbnN0IHBsPXBheU1hcCYmcGF5TWFwLmdldChyLnJhY2VJZCk7aWYocGwpe3N0LnBiKys7Y29uc3QgaGl0PXBsLmZpbmQoeD0+eC5udW1iZXI9PT1oLm51bSk7aWYoaGl0KXN0LnBheSs9aGl0Lnllbn19OwogZm9yKGNvbnN0IHIgb2YgdGVzdCl7CiAgY29uc3Qgdj1ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLHhmKGgpKSksMyksaHM9W107CiAgci5oLmZvckVhY2goKGgsaik9PntpZighaC5ob2xlKXJldHVybjtocy5wdXNoKHtoLHA6dltqXX0pO2JldCh0YWJbZ3JhZGUodltqXSldLHIsaCk7bkhvbGUrKztrSG9sZSs9aC55O3BIb2xlLnB1c2godltqXSk7eUhvbGUucHVzaChoLnkpfSk7CiAgY29uc3QgYnk9KGYpPT5ocy5zbGljZSgpLnNvcnQoZik7CiAgY29uc3Qgb3JkZXJzPXtuZXc6YnkoKGEsYik9PmIucC1hLnApLHBQOmJ5KChhLGIpPT5iLmgucFAtYS5oLnBQKSxta3Q6YnkoKGEsYik9PmEuaC5wb3AtYi5oLnBvcCl9OwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKG9yZGVycykpe29yZGVyc1trXS5zbGljZSgwLDEpLmZvckVhY2goej0+YmV0KHJrW2tdLnQxLHIsei5oKSk7b3JkZXJzW2tdLnNsaWNlKDAsMikuZm9yRWFjaCh6PT5iZXQocmtba10udDIscix6LmgpKX0KIH0KIGNvbnN0IGZpbj1zdD0+e2NvbnN0IHc9d2lsc29uKHN0Lmssc3Qubik7cmV0dXJue246c3QubixrOnN0LmsscmF0ZTpzdC5uP3N0Lmsvc3QubjowLGxvOndbMF0saGk6d1sxXSxwZXJEYXk6dGVzdERheXM/c3Qubi90ZXN0RGF5czowLHJvaTpzdC5wYj9zdC5wYXkvKDEwMCpzdC5wYik6bnVsbCxwYjpzdC5wYn19OwogY29uc3QgdGFiRj17fTtmb3IoY29uc3QgZyBvZiBbIlMiLCJBIiwiQiIsIkMiXSl0YWJGW2ddPWZpbih0YWJbZ10pOwogY29uc3QgcmtGPXt9O2Zvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKHJrKSlya0Zba109e3QxOmZpbihya1trXS50MSksdDI6ZmluKHJrW2tdLnQyKX07CiByZXR1cm57Y3V0cyx0YWI6dGFiRixyYW5rOnJrRixuSG9sZSxiYXNlUmF0ZTpuSG9sZT9rSG9sZS9uSG9sZTowLGF1YzphdWNPZihwSG9sZSx5SG9sZSl9Owp9CmNvbnN0IGdyYWRlSG9sZT0oY3V0cyxwKT0+cD49Y3V0cy5TPyJTIjpwPj1jdXRzLkE/IkEiOnA+PWN1dHMuQj8iQiI6IkMiOwoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5QbGFjZUZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAxOS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5EOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IHBheU1hcD1vcHRzLnBheU1hcHx8YXdhaXQgbG9hZFBheU1hcCgpOwogY29uc3QgbWFwPW5ldyBNYXAoKTsKIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogaWYocmFjZXMubGVuZ3RoPDUwMCl7YnVzeShmYWxzZSk7cmV0dXJue2Vycm9yOiLpgY7ljrvjg4fjg7zjgr/jgYzlsJHjgarjgZnjgY7jgb7jgZnvvIgiK3JhY2VzLmxlbmd0aCsi44Os44O844K577yJ44CC5YWI44Gr6YGO5Y6744Os44O844K544KS5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCIn19CiBjb25zdCBzdG9yZT1uZXcgVUUuU3RvcmUoKSxwcmk9bmV3IFBvcFByaSgpLFJTPVtdLGRyYXdQPW5ldyBEcmF3UHJpKCksc2lyZVA9bmV3IFNpcmVQcmkoKSx0ck09bmV3IE1hcCgpOwogY29uc3QgY292PXtyYWNlczowLGdvaW5nUmFjZXM6MCxob3JzZXM6MCx0cmFpbmVyOjAsc2lyZTowfTsKIGZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgcmM9cmFjZXNbaV0sUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKSxOPVIubGVuZ3RoOwogIGNvbnN0IHZhbGlkPU4+PTgmJlIuZXZlcnkocj0+ci5wb3A+MCkmJlIuc29tZShyPT5yLmZpbmlzaD09PTEpOwogIGlmKHZhbGlkJiZyYy5kYXRlPj1TVEFSVCYmIS/pmpzlrrMvLnRlc3QoU3RyaW5nKFJbMF0ucmFjZU5hbWV8fCIiKSkpewogICBjb25zdCBvZD1SLmV2ZXJ5KHI9PnIub2Rkcz4xKT9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG51bGwpLGFwTz1vZD9VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk6bnVsbCxyaz1yYW5rRnJhY3MoYXAucFApOwogICAgY29uc3QgY3V0SD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSkscmNJPXtnYzpSWzBdLmdjfHwwLHY6dmVudWVGcm9tSWQocmMucm93c1swXS5yYWNlSWQpLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LE59LGN0eD17ZHJhdzpkcmF3UCx0cjp0ck0sc2lyZTpzaXJlUCxwZWQ6UEVEfSxiYj1NYXRoLm1pbiguNSwzL04pOwogICAgY292LnJhY2VzKys7aWYocmNJLmdjPjApY292LmdvaW5nUmFjZXMrKzsKICAgIFJTLnB1c2goe2RhdGU6cmMuZGF0ZSxyYWNlSWQ6cmMucm93c1swXS5yYWNlSWQsTixoOlIubWFwKChyLGopPT57Y29uc3QgZT1leHRGZWF0SG9yc2UocixzdG9yZS5oLmdldChyLmhvcnNlKSxyY0ksY3R4LGJiKTtjb3YuaG9yc2VzKys7aWYoZVs0XSljb3YudHJhaW5lcisrO2lmKGVbNl18fGVbOF0pY292LnNpcmUrKztyZXR1cm57eDpwbGFjZVgoYXAucFBbal0sci5wb3AsTixwcmkscmtbal0pLGUseTpyLmZpbmlzaDw9Mz8xOjAscFA6YXAucFBbal0scHI6cHJpLnJhdGUoci5wb3AsTikscE86YXBPP2FwTy5wT1tqXTpudWxsLG51bTpyLm51bSxwb3A6ci5wb3AsaG9sZTpyLnBvcD49Y3V0SH19KX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBpZih2YWxpZClwcmkuYWRkKFIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLE4pOwogIGlmKE4+PTgpe2NvbnN0IHZ2PXZlbnVlRnJvbUlkKHJjLnJvd3NbMF0ucmFjZUlkKTtmb3IoY29uc3QgciBvZiBSKXtjb25zdCB0Mz1yLmZpbmlzaDw9Mz8xOjA7ZHJhd1AuYWRkKHZ2LFJbMF0uc3VyZixSWzBdLmRpc3Qsci5udW0sTix0Myk7c2lyZVAuYWRkKFBFRFtyLmhvcnNlXSxSWzBdLnN1cmYsUlswXS5kaXN0LHQzLE4pO2lmKHIudHJhaW5lcil7bGV0IHQ9dHJNLmdldChyLnRyYWluZXIpO2lmKCF0KXRyTS5zZXQoci50cmFpbmVyLHQ9e246MCx0MzowfSk7dC5uKys7dC50Mys9dDN9fX0KICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXtyLmNmPWNvcm5lckZyYWMoci5jb3JuZXIscmMucm93cy5sZW5ndGgpO3N0b3JlLmFkZChyKX0KICBpZihpJTMwPT09Mjkpe2J1c3kodHJ1ZSxg5pmC57O75YiX44Gr5YaN54++44GX44Gm5qSc6Ki85Lit4oCmICR7aSsxfS8ke3JhY2VzLmxlbmd0aH3jg6zjg7zjgrlgKTthd2FpdCBzbGVlcCgwKX0KIH0KIGJ1c3kodHJ1ZSwi44Oi44OH44Or44KS5q+U6LyD5Lit4oCmIik7YXdhaXQgc2xlZXAoMCk7CiBjb25zdCB0cmFpbj1SUy5maWx0ZXIocj0+ci5kYXRlPFRFU1QpLHRlc3Q9UlMuZmlsdGVyKHI9PnIuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsc3RhcnQ6U1RBUlQsdGVzdFN0YXJ0OlRFU1R9OwogaWYodHJhaW4ubGVuZ3RoPDE1MDB8fHRlc3QubGVuZ3RoPDMwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIC8vIOaWsOODouODh+ODq++8muWtpue/kuWBtOOBruOBv+OBp+S9nOOCi+OAguOAjOi/veWKoOOBruadoeS7tu+8iOmmrOWgtOODu+aeoOmghuODu+iqv+aVmeW4q+ODu+ihgOe1se+8ieOBguOCiuOAjeOBqOOAjOOBquOBl+OAjeOBrjLpgJrjgorjgpLmr5TjgbnjgosKIGNvbnN0IHk9W10sWGI9W10sWGU9W107Zm9yKGNvbnN0IHIgb2YgdHJhaW4pZm9yKGNvbnN0IGggb2Ygci5oKXt5LnB1c2goaC55KTtYYi5wdXNoKGgueCk7WGUucHVzaChbLi4uaC54LC4uLmguZV0pfQogY29uc3QgbW9kZWxCPWZpdExvZ2l0KFhiLHksNSksbW9kZWxFPWZpdExvZ2l0KFhlLHksNSk7CiBjb25zdCBmbGF0PWY9Pntjb25zdCBwPVtdLHl5PVtdO2Zvcihjb25zdCByIG9mIHRlc3Qpe2NvbnN0IHY9ZihyKTtyLmguZm9yRWFjaCgoaCxqKT0+e3AucHVzaCh2W2pdKTt5eS5wdXNoKGgueSl9KX1yZXR1cm57cCx5Onl5fX07CiBjb25zdCB4Qj1oPT5oLngseEU9aD0+Wy4uLmgueCwuLi5oLmVdOwogY29uc3QgZXZhbE09KG0seGYpPT57Y29uc3QgZD1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobSx4ZihoKSkpLDMpKTtyZXR1cm57ZCxtZXQ6bWV0cmljc09mKGQucCxkLnkpfX07CiBjb25zdCBFQj1ldmFsTShtb2RlbEIseEIpLEVFPWV2YWxNKG1vZGVsRSx4RSk7CiBjb25zdCB1c2VFeHQ9RUUubWV0LmxsPD1FQi5tZXQubGwtLjAwMTsgICAvLyDov73liqDjga7mnaHku7bjgafjgIHlr77mlbDmkI3lpLHjgYwwLjAwMeS7peS4iuiJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeS9v+OBhgogY29uc3QgbW9kZWw9dXNlRXh0P21vZGVsRTptb2RlbEIseGY9dXNlRXh0P3hFOnhCLGROZXc9dXNlRXh0P0VFLmQ6RUIuZDsKIHJlcy5tQmFzZT1FQi5tZXQ7cmVzLm1FeHQ9RUUubWV0O3Jlcy51c2VFeHQ9dXNlRXh0O3Jlcy5jb3Y9ey4uLmNvdixnb2luZ1NoYXJlOmNvdi5yYWNlcz9jb3YuZ29pbmdSYWNlcy9jb3YucmFjZXM6MCx0cmFpbmVyU2hhcmU6Y292LmhvcnNlcz9jb3YudHJhaW5lci9jb3YuaG9yc2VzOjAsc2lyZVNoYXJlOmNvdi5ob3JzZXM/Y292LnNpcmUvY292LmhvcnNlczowLHBlZEhvcnNlczpPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH07CiBjb25zdCBkUFA9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucFApKSwzKSk7CiBjb25zdCBkTWs9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucHIpKSwzKSk7CiByZXMubU5ldz1tZXRyaWNzT2YoZE5ldy5wLGROZXcueSk7cmVzLm1QUD1tZXRyaWNzT2YoZFBQLnAsZFBQLnkpO3Jlcy5tTWs9bWV0cmljc09mKGRNay5wLGRNay55KTsKIC8vIOePvuihjOOBruOCquODg+OCuui+vOOBv+eiuueOhyhwTynjga/jgIHjgqrjg4PjgrrjgaTjgY3jga7miJDnuL7jgYzjgYLjgovmnJ/plpPjgaDjgZHmr5TjgbnjgonjgozjgosKIGNvbnN0IHN1Yj10ZXN0LmZpbHRlcihyPT5yLmguZXZlcnkoaD0+aC5wTyE9bnVsbCkpOwogcmVzLm5PZGRzVGVzdD1zdWIubGVuZ3RoOwogaWYoc3ViLmxlbmd0aD49MTUwKXsKICBjb25zdCBwbj1bXSxwbz1bXSx5eT1bXTtmb3IoY29uc3QgciBvZiBzdWIpe2NvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57cG4ucHVzaCh2W2pdKTtwby5wdXNoKGgucE8pO3l5LnB1c2goaC55KX0pfQogIHJlcy5tTmV3T2Rkcz1tZXRyaWNzT2YocG4seXkpO3Jlcy5tT2Rkcz1tZXRyaWNzT2YocG8seXkpOwogfQogLy8g5o6h55So44Gu5Yik5patCiBjb25zdCBtPXJlcy5tTmV3OwogbGV0IGFkb3B0PW0ubGw8cmVzLm1QUC5sbC0uMDAzJiZtLmxsPHJlcy5tTWsubGwtLjAwMzsKIGlmKGFkb3B0JiZyZXMubU9kZHMpYWRvcHQ9cmVzLm1OZXdPZGRzLmxsPD1yZXMubU9kZHMubGwtLjAwMDU7CiByZXMuYWRvcHQ9YWRvcHQ7cmVzLnZzT2Rkcz1yZXMubU9kZHM/IuavlOi8g+a4iOOBvyI6IuacquavlOi8gyI7CiAvLyDkv6HpoLzmgKfvvJrkuojmuKzjga7ljLrplpPjgZTjgajjga7lrp/pmpvjga7nmoTkuK3njocKIHJlcy5iaW5zPXJlbGlhYmlsaXR5QmlucyhkTmV3LnAsZE5ldy55LDEwKTsKIHJlcy50ZXN0RGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiByZXMuaG9sZT1ob2xlRXZhbChtb2RlbCx4Zix0cmFpbix0ZXN0LHBheU1hcCxyZXMudGVzdERheXMpOwogcmVzLnRocj1bLjUsLjcsLjgsLjg1LC44OCwuOSwuOTIsLjkzLC45NSwuOTddLm1hcCh0PT50aHJlc2hvbGRSb3coZE5ldy5wLGROZXcueSx0KSk7CiByZXMuYmluc1BQPXJlbGlhYmlsaXR5QmlucyhkUFAucCxkUFAueSwxMCk7CiAvLyDotoXpiYTmnb/vvJ3kuojmuKw5NSXku6XkuIrjga7ppqzvvIjkvZXpoK3jgafjgoLvvInjgILmpJzoqLzlgbTjgafjgIHlrp/pmpvjgavjganjgozjgaDjgZHlvZPjgZ/jgaPjgZ/jgYvjgpLoqJjpjLLjgZnjgosKIGxldCBpcm9uPW51bGw7CiB7Y29uc3Qgcm93PXRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LC45NSksZGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiAgaWYocm93Lm4+MClpcm9uPXtjdXQ6Ljk1LHJhdGU6cm93LnJhdGUsbG86cm93LmxvLG46cm93Lm4scGVyRGF5OmRheXM/cm93Lm4vZGF5czowLGxvd046cm93Lm48MTAwfTt9CiByZXMuaXJvbj1pcm9uOwogcmVzLm1vZGVsPWFkb3B0P3t2ZXI6MixraW5kOiJuZXciLGV4dDp1c2VFeHQsbW9kZWwsaXJvbixhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0RGF5czpyZXMudGVzdERheXMsdGVzdFN0YXJ0OlRFU1QsaG9sZUN1dHM6cmVzLmhvbGUuY3V0cyxob2xlU3RhdHM6e3RhYjpyZXMuaG9sZS50YWIscmFuazpyZXMuaG9sZS5yYW5rLGJhc2VSYXRlOnJlcy5ob2xlLmJhc2VSYXRlfSwKICBtTmV3OnJlcy5tTmV3LG1QUDpyZXMubVBQLG1NazpyZXMubU1rLG1PZGRzOnJlcy5tT2Rkc3x8bnVsbCxtTmV3T2RkczpyZXMubU5ld09kZHN8fG51bGwsdGhyOnJlcy50aHJ9Om51bGw7CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiBwbGFjZVJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CCMemgreOBlOOBqOOBq+OAjDPnnYDku6XlhoXjgI3jgpLlvZPjgabjgZ/miJDnuL7jgafjgZnvvIg46aCt5Lul5LiK44Gu44Os44O844K577yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PgogJHtyb3coIumBjuWOu+aIkOe4vuODouODh+ODq+OBruOBvyIsci5tUFApfSR7cm93KCLkurrmsJfpoIbkvY3jga7lrp/nuL7jga7jgb8iLHIubU1rKX0ke3JvdygiPGI+5paw77yI5Lih5pa544KS57WE44G/5ZCI44KP44Gb77yJPC9iPiIsci5tTmV3KX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGlmKHIubU9kZHMpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgaTjgY3jga7mpJzoqLzjg4fjg7zjgr8gJHtyLm5PZGRzVGVzdH3jg6zjg7zjgrnjgafjga7nm7TmjqXmr5TovIPvvJrnj77ooYzvvIjjgqrjg4Pjgrrovrzjgb/vvInjga7lr77mlbDmkI3lpLEgJHtmKHIubU9kZHMubGwpfSDvvI8g5pawICR7ZihyLm1OZXdPZGRzLmxsKX08L2Rpdj5gOwogZWxzZSBoKz1gPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44Kq44OD44K644Gk44GN44Gu5qSc6Ki844OH44O844K/44GM5bCR44Gq44GE44Gf44KB44CB54++6KGM44Gu44CM44Kq44OD44K66L6844G/44Gu56K6546H44CN44Go44Gu55u05o6l5q+U6LyD44Gv44Gn44GN44Gm44GE44G+44Gb44KT77yI5Lq65rCX6aCG5L2N44Gv44CB44Kq44OD44K65Y+W5b6X5b6M44Gr5rG644G+44KL5YCk44KS5L2/44Gj44Gm44GE44G+44GZ77yJ44CCPC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmFkb3B0PyJvayI6InduIn0iPjxiPue1kOaenO+8miR7ci5hZG9wdD8i5paw44Oi44OH44Or44KS5o6h55So77yI6YCx5pyr44Gu5LqI5oOz44Gu56K6546H44Gr5Y+N5pig77yJIjoi54++6KGM44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/44O75Lq65rCX6aCG5L2N44Gu44G/44Gu5Lih5pa544KI44KK44CB5a++5pWw5pCN5aSx44GMMC4wMDPku6XkuIroia/jgYTjgZPjgajjgIIke3IubU9kZHM/IuOBleOCieOBq+ePvuihjO+8iOOCquODg+OCuui+vOOBv++8ieOCiOOCiuiJr+OBhOOBk+OBqOOAgiI6IiJ9PC9zcGFuPjwvZGl2PmA7CiBoKz1leHRSZXBvcnQocik7CiBoKz1ob2xlUmVwb3J0KHIpOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7kuojmuKzjga7ljLrplpPjgZTjgajjga48Yj7lrp/pmpvjga7nmoTkuK3njoc8L2I+77yI5qSc6Ki85YG044CC5LqI5ris44Go5a6f6Zqb44GM6L+R44GE44G744Gp5q2j56K677yJPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuS6iOa4rOOBruevhOWbsjwvdGg+PHRoPumgreaVsDwvdGg+PHRoPuS6iOa4rOOBruW5s+WdhzwvdGg+PHRoPuWun+mamzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGIgb2Ygci5iaW5zKWgrPWA8dHI+PHRkPiR7cGN0KGIubG8pfeOAnCR7cGN0KGIuaGkpfTwvdGQ+PHRkPiR7Yi5ufTwvdGQ+PHRkPiR7cGN0KGIubWVhbiwxKX08L3RkPjx0ZD48Yj4ke3BjdChiLmFjdCwxKX08L2I+PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7pq5jjgYTkuojmuKzjga7lrp/nuL7vvIjmpJzoqLzlgbTvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5risPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHQgb2Ygci50aHIpaCs9YDx0cj48dGQ+JHtwY3QodC50KX3ku6XkuIo8L3RkPjx0ZD4ke3Qubn08L3RkPjx0ZD4ke3IudGVzdERheXM/KHQubi9yLnRlc3REYXlzKS50b0ZpeGVkKDIpOiItIn3poK08L3RkPjx0ZD48Yj4ke3BjdCh0LnJhdGUsMSl9PC9iPjwvdGQ+PHRkPiR7cGN0KHQubG8sMSl944CcJHtwY3QodC5oaSwxKX08L3RkPjwvdHI+YDsKIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGlmKHIuaXJvbiloKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxiPui2hemJhOadv++8iOS6iOa4rDk1JeS7peS4iuODu+mgreaVsOOBruWItumZkOOBquOBl++8ie+8mjwvYj7mpJzoqLzlgbTjgafjgIHlrp/pmpvjgaske3BjdChyLmlyb24ucmF0ZSwxKX3jgYwz552A5Lul5YaF77yIJHtyLmlyb24ubn3poK3jgIE5NSXjga7luYUgJHtwY3Qoci5pcm9uLmxvLDEpfeOAnCR7cGN0KHIuaXJvbi5oaSwxKX3jgIEx5pel44GC44Gf44KK57SEJHtyLmlyb24ucGVyRGF5LnRvRml4ZWQoMil96aCtJHtyLmlyb24ubG93Tj8i44CC6aCt5pWw44GM5bCR44Gq44KB44Gn5bmF44GM5bqD44GEIjoiIn3vvInjgIIke3IuaXJvbi5yYXRlPj0uOTU/IiI6IjxzcGFuIGNsYXNzPVwid2FyblwiPjk1JeOBq+OBr+WxiuOBhOOBpuOBhOOBvuOBm+OCk+OAgjwvc3Bhbj4ifTwvZGl2PmA7CiBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7mpJzoqLzlgbTjgavjgIHkuojmuKw5NSXku6XkuIrjga7ppqzjga/jgYTjgb7jgZvjgpPjgafjgZfjgZ/vvIjotoXpiYTmnb/jga/lh7rjgarjgYTjgIHjgb7jgZ/jga/lh7rjgabjgoLjgZTjgY/lsJHmlbDjgafjgZnvvInjgII8L2Rpdj4nOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gZXh0UmVwb3J0KHIpewogaWYoIXIubUV4dClyZXR1cm4iIjsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLGN2PXIuY292fHx7fTsKIGxldCBoPWA8aDM+6L+95Yqg44Gu5p2h5Lu277yI6aas5aC054q25oWL44O75p6g6aCG44O76Kq/5pWZ5bir44O76KGA57Wx77yJ44Gu5Yq55p6cPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+QVVD4oaRPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pjx0cj48dGQ+6L+95Yqg44Gu5p2h5Lu244Gq44GXPC90ZD48dGQ+JHtmKHIubUJhc2UubGwpfTwvdGQ+PHRkPiR7ci5tQmFzZS5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+PHRyPjx0ZD7ov73liqDjga7mnaHku7bjgYLjgoo8L3RkPjx0ZD4ke2Yoci5tRXh0LmxsKX08L3RkPjx0ZD4ke3IubUV4dC5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci51c2VFeHQ/Im9rIjoid24ifSI+PGI+JHtyLnVzZUV4dD8i6L+95Yqg44Gu5p2h5Lu244KS5L2/44GG44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB44CB5o6h55So44GX44G+44GX44Gf44CCIjoi6L+95Yqg44Gu5p2h5Lu244KS5Yqg44GI44Gm44KC44CB5piO56K644Gq5pS55ZaE77yI5a++5pWw5pCN5aSxMC4wMDHku6XkuIrvvInjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHkvb/jgaPjgabjgYTjgb7jgZvjgpPjgIIifTwvYj48L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jg4fjg7zjgr/jga7lhYXotrPnjofvvIjlrabnv5Ljg7vmpJzoqLzlhajkvZPvvInvvJrppqzloLTnirbmhYvjgYzliIbjgYvjgovjg6zjg7zjgrkgJHtwY3QoY3YuZ29pbmdTaGFyZXx8MCwwKX3vvI/oqr/mlZnluKvjgYzliIbjgYvjgovppqwgJHtwY3QoY3YudHJhaW5lclNoYXJlfHwwLDApfe+8j+ihgOe1seOBjOWIhuOBi+OCi+mmrCAke3BjdChjdi5zaXJlU2hhcmV8fDAsMCl977yI6JOE56mN44GX44Gf6KGA57WxICR7Y3YucGVkSG9yc2VzfHwwfemgre+8ieOAgiR7KGN2LmdvaW5nU2hhcmV8fDApPC4zPyLppqzloLTnirbmhYvjga/jgIHoqK3lrprjga7jgIzjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfjgI3jgafjgIHpgY7ljrvjga7miJDnuL7jgpLlj5bjgornm7TjgZnjgajlopfjgYjjgb7jgZnjgIIiOiIifSR7KGN2LnNpcmVTaGFyZXx8MCk8LjM/IiDooYDntbHjga/jgIHmr47pgLHjga7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgI3jgaflh7rppqzooajjgYvjgonlsJHjgZfjgZrjgaTok4TnqY3jgZXjgozjgb7jgZnjgIIiOiIifTwvZGl2PmA7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBob2xlUmVwb3J0KHIpewogY29uc3QgSD1yLmhvbGU7aWYoIUh8fCFILm5Ib2xlKXJldHVybiIiOwogY29uc3Qgcm9pPXg9Pngucm9pPT1udWxsPyItIjpwY3QoeC5yb2ksMCk7CiBsZXQgaD1gPGgzPueptOmmrO+8iOS6uuawl+OBruS4i+S9je+8ieOBp+OBruaIkOe4vu+8iOaknOiovOWBtO+8iTwvaDM+PGRpdiBjbGFzcz0ic21hbGwiPueptOmmrO+8neS6uuawl+mghuS9jeOBjCBtYXgoNSwg6aCt5pWw44GuNDAlKeS7peS4i+OBrummrOOAguaknOiovOWBtOOBrueptOmmrCAke0gubkhvbGV96aCt44Gu5bmz5Z2H55qE5Lit546H44GvICR7cGN0KEguYmFzZVJhdGUsMSl944CB5paw44Oi44OH44Or44Gu5LqI5ris44Gu6K2Y5Yil5Yqb77yIQVVD77yJ44GvICR7SC5hdWMudG9GaXhlZCgzKX3jgILoqZXkvqHjga/jgIHlrabnv5LlgbTjga7nqbTppqzjga7kuojmuKznorrnjofjga7kuIrkvY00Je+8nVPjgIExMiXvvJ1B44CBMzAl77ydQuOAgeOBneOCjOS7peWklu+8nUMg44Gn5Yy65YiH44KK44G+44GX44Gf77yIU++8muS6iOa4rCR7cGN0KEguY3V0cy5TLDEpfeS7peS4iuOAgUHvvJoke3BjdChILmN1dHMuQSwxKX3ku6XkuIrjgIFC77yaJHtwY3QoSC5jdXRzLkIsMSl95Lul5LiK77yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6KmV5L6hPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PHRoPuikh+WLneWbnuWPjueOhzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGcgb2YgWyJTIiwiQSIsIkIiLCJDIl0pe2NvbnN0IHg9SC50YWJbZ107aCs9YDx0cj48dGQ+PGI+JHtnfTwvYj48L3RkPjx0ZD4ke3gubn08L3RkPjx0ZD4ke3gucGVyRGF5LnRvRml4ZWQoMSl96aCtPC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvLDEpfeOAnCR7cGN0KHguaGksMSl9PC90ZD48dGQ+JHtyb2koeCl9PC90ZD48L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7jg6zjg7zjgrnjgZTjgajjgavjgIHnqbTppqzjga7kuK3jgYvjgonkuIrkvY3jgpLpgbjjgpPjgaDjgajjgY3jga7miJDnuL7vvIjnmoTkuK3njofvvI/opIfli53lm57lj47njofvvInjgILjgIzmlrDjg6Ljg4fjg6vjgI3jgYzjgIHku5bjga7pgbjjgbPmlrnjgojjgorpq5jjgYTjgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7pgbjjgbPmlrk8L3RoPjx0aD4x6aCt44Gg44GRPC90aD48dGg+5LiK5L2NMumgrTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtrLGxdIG9mIFtbIm5ldyIsIuaWsOODouODh+ODq+OBrueiuueOh+OBjOmrmOOBhOmghiJdLFsicFAiLCLpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7jgb8iXSxbIm1rdCIsIuS6uuawl+OBjOmrmOOBhOmghu+8iOW4guWgtO+8iSJdXSl7Y29uc3QgYT1ILnJhbmtba10udDEsYj1ILnJhbmtba10udDI7aCs9YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7cGN0KGEucmF0ZSwxKX0g77yPICR7cm9pKGEpfTwvdGQ+PHRkPiR7cGN0KGIucmF0ZSwxKX0g77yPICR7cm9pKGIpfTwvdGQ+PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48L2Rpdj4ke0gudGFiLlMucGI9PT0wPyc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHlm57lj47njofjga/lh7rjgZvjgabjgYTjgb7jgZvjgpPvvIjjgIzpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgI3jgafmiZXmiLvjgoLlj5blvpfjgZXjgozjgb7jgZnvvInjgII8L2Rpdj4nOic8ZGl2IGNsYXNzPSJzbWFsbCI+5Zue5Y+O546H44Gv44CBMTAw5YaG44Ga44Gk6KSH5Yud44KS6LK344Gj44Gf5aC05ZCI44Gn44GZ44CCMTAwJeOCkui2heOBiOOCi+iyt+OBhOaWueOBr+OAgeOBvuOBoOeiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvZGl2Pid9YDsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBsYWNlU3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRQbGFjZU1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8muaomea6luODouODh+ODq+OBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8mjxiPuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqzwvYj7jgafooajnpLrkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgabjgYLjgorjgb7jgZnvvInjgII8L2Rpdj5gOwp9CgoKLyogLS0tLS0tLS0tLSDkv53lrZjjg4fjg7zjgr/jga7nirbms4EgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga/mnKrlj5blvpfjgafjgZnjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44GL44KJ44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBuQWxsPTAsblRyPTA7Zm9yKGNvbnN0IGYgb2YgbGl2ZSlmb3IoY29uc3QgciBvZiBmLnJvd3Mpe25BbGwrKztpZihyLnRyYWluZXIpblRyKyt9CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl0NTVu+8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgaWYobkFsbCloKz1gXG7oqr/mlZnluKvjgaTjgY3jga7miJDnuL7vvJoke01hdGgucm91bmQoblRyL25BbGwqMTAwKX0lJHtuVHI9PT0wPyLvvIjjgZPjgozjgYvjgonlj5blvpfjgZnjgovmiJDnuL7jgavlhaXjgorjgb7jgZnvvIkiOiIifWA7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9CgovKiAtLS0tLS0tLS0tIOWPluW+l+OBl+OBn+ihjCDihpIg5YaF6YOo44Gu6KGM77yI6Kq/5pWZ5bir44O744Kw44Os44O844OJ5LuY44GN77yJIC0tLS0tLS0tLS0gKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLAogIHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKHgudHJhaW5lciksCiAgcmFjZU5hbWU6U3RyaW5nKHgucmFjZU5hbWV8fCIiKSxnYzpnb2luZ0NhdChnb2luZ0NvZGUoeC5nb2luZykpLHZlbnVlOnZlbnVlRnJvbUlkKHgucmFjZUlkKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSksCiAgY29ybmVyOkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg/eC5jb3JuZXI6bnVsbCxsYXA6QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aD94LmxhcDpudWxsfX0KCi8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCi++8iOmojuaJi+ODu+iqv+aVmeW4q+OBruaIkOe4vuOCguWQjOaZguOBq+mbhuioiO+8iSAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgILlhYjjgavjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44Gn44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtzdC50cj1uZXcgTWFwKCk7bGV0IHVzZWQ9MDtjb25zdCBBRz1uZXcgTWFwKCksZHJhdz1uZXcgRHJhd1ByaSgpLHNpcmU9bmV3IFNpcmVQcmkoKTsKIGNvbnN0IHRha2U9cj0+e2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0fHwhci5ob3JzZSlyZXR1cm47YWdnQWRkKEFHLHIpO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZTsKICBjb25zdCB0Mz1yLmZpbmlzaCE9bnVsbCYmci5maW5pc2g8PTM/MTowOwogIGlmKHIudHJhaW5lciYmci5maW5pc2ghPW51bGwpe2xldCB0PXN0LnRyLmdldChyLnRyYWluZXIpO2lmKCF0KXN0LnRyLnNldChyLnRyYWluZXIsdD17bjowLHQzOjB9KTt0Lm4rKzt0LnQzKz10M30KICBpZihyLmZpbmlzaCE9bnVsbCYmci5OKXtjb25zdCB2PXIudmVudWV8fHZlbnVlRnJvbUlkKHIucmFjZUlkKTtkcmF3LmFkZCh2LHIuc3VyZixyLmRpc3Qsci5udW0sci5OLHQzKTtzaXJlLmFkZChQRURbci5ob3JzZV0sci5zdXJmLHIuZGlzdCx0MyxyLk4pfX07CiBjb25zdCBwcmVwPXJvd3M9Pntjb25zdCBjbnQ9e307Zm9yKGNvbnN0IHIgb2Ygcm93cylpZihyLmZpbmlzaCE9bnVsbCljbnRbci5yYWNlSWRdPShjbnRbci5yYWNlSWRdfHwwKSsxO2Zvcihjb25zdCByIG9mIHJvd3Mpe3IuTj1jbnRbci5yYWNlSWRdfHwwO3IuY2Y9Y29ybmVyRnJhYyhyLmNvcm5lcixyLk4pO3Rha2Uocil9fTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSlwcmVwKChmc1tpXS5yb3dzfHxbXSkubWFwKGxpdmVSb3cpKTsKICBlbHNlIHByZXAoVUUuY3N2Um93cyhmc1tpXS5jc3YpLm1hcChVRS50b1JvdykpOwogIGF3YWl0IHNsZWVwKDApOwogfQogY29uc3QgcHJpPW5ldyBVcFByaSgpLHBwPW5ldyBQb3BQcmkoKTtmb3IoY29uc3QgYSBvZiBBRy52YWx1ZXMoKSl7cHJpLmFkZChhZ2dJbmZvKGEpKTtpZihhLk4+PTYmJmEucGYubGVuZ3RoPT09YS5OJiYhYS5qdW1wKXBwLmFkZChhLnBmLGEuTil9c3QudXA9cHJpO3N0LnBwPXBwO3N0LmRyYXc9ZHJhdztzdC5zaXJlPXNpcmU7CiBidXN5KGZhbHNlKTtTVE9SRT1zdDtTVE9SRV9LRVk9dGFyZ2V0O3N0LmNvdW50PXVzZWQ7cmV0dXJuIHN0Owp9CgovKiDlh7rppqzooajjga4x44Os44O844K5IOKGkiDop6PmnpDnlKjjga7jg6zjg7zjgrkgKi8KZnVuY3Rpb24gbWtSYWNlKGMsZCl7CiBjb25zdCBocz1jLmhvcnNlc3x8Yy5ydW5uZXJzfHxbXTsKIGNvbnN0IGd0PShjLmNsYXNzTmFtZXx8IiIpKyIgIisoYy5ncmFkZXx8IiIpKyIgIisoYy5yYWNlTmFtZXx8IiIpOwogY29uc3QgZ3JkPVVFLmdyYWRlVGllcihndCxjLnByaXplLHRydWUpOwogcmV0dXJue2RhdGU6ZCxzdXJmOlVFLnN1cmZDb2RlKGMuc3VyZmFjZSksZGlzdDpOdW1iZXIoYy5kaXN0YW5jZSl8fDAsCiAgbHZsOlVFLmxldmVsT2ZMYWJlbChjLmNsYXNzTmFtZSl8fFVFLmxldmVsT2ZMYWJlbChjLnJhY2VOYW1lKXx8KGdyZD49MT81OjApLGdyZCwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7CiAgIHJldHVybntuYW1lLGhvcnNlOlVFLm5uKG5hbWUpLGpvY2tleTpVRS5qbm4oaC5qb2NrZXl8fCIiKSxqbmFtZTpTdHJpbmcoaC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKGgudHJhaW5lcnx8IiIpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KQogICAuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDku4rpgLHmnKvjga7lj5blvpcKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBXSz17ZGF0ZXM6W10sY2FyZHM6e30sb2Rkczp7fSxvZGRzTm90ZXM6e30sZGlhZzpbXSxjYWxjOnt9LGF0OiIiLHN0b3JlSW5mbzpudWxsfTsKY29uc3QgcmtleT0oZCxjKT0+YCR7ZH18JHtTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKGMucmFjZU51bWJlcil8fDB9YDsKY29uc3Qgd2tNc2c9dD0+eyQoIndrU3RhdHVzIikudGV4dENvbnRlbnQ9dH07CmNvbnN0IGJhc2VVcmw9KCk9PiQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKZnVuY3Rpb24gbmV4dFdlZWtlbmQodG9kYXkpe2NvbnN0IG91dD1bXTtjb25zdCB0PW5ldyBEYXRlKHRvZGF5KyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpOwogZm9yKGxldCBpPTA7aTw4JiZvdXQubGVuZ3RoPDI7aSsrKXtjb25zdCBkPW5ldyBEYXRlKHQraSo4NjRlNSksdz1kLmdldFVUQ0RheSgpO2lmKHc9PT02fHx3PT09MClvdXQucHVzaChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkpfXJldHVybiBvdXR9Cgphc3luYyBmdW5jdGlvbiBmZXRjaENhcmRzKGJhc2UsZCx2ZW51ZUNvZGUpewogY29uc3QgcT12ZW51ZUNvZGU/YCZ2ZW51ZT0ke2VuY29kZVVSSUNvbXBvbmVudCh2ZW51ZUNvZGUpfWA6IiI7bGV0IGVycj0iIjsKIGZvcihsZXQgdD0wO3Q8Mzt0KyspewogIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0ke3F9YCk7CiAgIGlmKCFyLm9rKXtsZXQgbT0iIjt0cnl7bT0oYXdhaXQgci5qc29uKCkpLmVycm9yfHwiIn1jYXRjaHt9dGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9ICR7bX1gLnRyaW0oKSl9CiAgIGNvbnN0IHg9YXdhaXQgci5qc29uKCk7cmV0dXJue3JhY2VzOkFycmF5LmlzQXJyYXkoeCk/eDooeC5yYWNlc3x8W10pfX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CgovKiAx6ZaL5YKs5aC044G244KT44Gu5Ye66aas6KGo44CC5qyg44GR44O75aSx5pWX44GM44GC44KM44Gw44CB6Ieq5YuV44GnMeWbnuOBoOOBkeOChOOCiuebtOOBmSAqLwphc3luYyBmdW5jdGlvbiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LGlzUmV0cnkpewogY29uc3QgY29kZT1TdHJpbmcodi52ZW51ZUNvZGUpOwogV0suY2FyZHNbZF09KFdLLmNhcmRzW2RdfHxbXSkuZmlsdGVyKGM9PlN0cmluZyhjLnZlbnVlQ29kZSkhPT1jb2RlKTsKIFdLLmRpYWc9V0suZGlhZy5maWx0ZXIoeD0+ISh4LmQ9PT1kJiZ4LmNvZGU9PT1jb2RlKSk7CiB0cnl7CiAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCxjb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGJhZD1yYWNlcy5sZW5ndGgtb2subGVuZ3RoOwogIFdLLmNhcmRzW2RdLnB1c2goLi4ub2spOwogIGNvbnN0IGlzc3Vlcz1vay5maWx0ZXIoYz0+Yy5xdWFsaXR5JiYhYy5xdWFsaXR5Lm9rKS5tYXAoYz0+YCR7Yy5yYWNlTnVtYmVyfVLvvJoke2MucXVhbGl0eS5pc3N1ZXMuam9pbigi44O7Iil9YCk7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6cmFjZXMubGVuZ3RoLG9rOm9rLmxlbmd0aCxiYWQsaXNzdWVzLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOiIifSk7CiAgaWYoKGJhZD4wfHxvay5sZW5ndGg8OCkmJiFpc1JldHJ5KXthd2FpdCBzbGVlcCg4MDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfWNhdGNoKGUpewogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pOwogIGlmKCFpc1JldHJ5KXthd2FpdCBzbGVlcCgxMjAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH0KfQoKLyog44Kq44OD44K677yI5Y2Y5Yud77yL6KSH5Yud77yJ44CC5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6lIOKGkiDlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjga/jgIHml6Xku5jjg7vplovlgqzloLTjga7jg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYYgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hPZGRzRGF0ZShiYXNlLGQpewogY29uc3QgY2FyZHM9V0suY2FyZHNbZF18fFtdLG5vdGVzPVtdO1dLLm9kZHNOb3Rlcz1XSy5vZGRzTm90ZXN8fHt9OwogaWYoIWNhcmRzLmxlbmd0aCl7V0sub2Rkc05vdGVzW2RdPW5vdGVzO3JldHVybntuOjAsbm90ZXN9fQogY29uc3Qgd2l0aExpbms9Y2FyZHMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUM9bmV3IE1hcCh3aXRoTGluay5tYXAocj0+W3Iub2Rkc0NuYW1lLHJdKSk7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTx3aXRoTGluay5sZW5ndGg7aSs9NiljaHVua3MucHVzaCh3aXRoTGluay5zbGljZShpLGkrNikubWFwKHI9PnIub2Rkc0NuYW1lKSk7CiBsZXQgY2k9MCxmYWlsTj0wO2NvbnN0IHJlYXNvbnM9e307CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Qy5nZXQoaXQuY25hbWUpO2lmKHIpV0sub2Rkc1tya2V5KGQscildPXt0YW46aXQub2Rkc3x8e30scGxhY2U6aXQucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9fQogICBmb3IoY29uc3QgZiBvZiAoeC5mYWlsZWR8fFtdKSl7ZmFpbE4rKztjb25zdCBtPVN0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9CiAgfWNhdGNoKGUpe2ZhaWxOKz1jaHVua3Nba10ubGVuZ3RoO2NvbnN0IG09U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX19fTsKIGF3YWl0IFByb21pc2UuYWxsKFt3b3JrZXIoKSx3b3JrZXIoKV0pOwogY29uc3QgZGlyZWN0PWNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aDsKIG5vdGVzLnB1c2goYOWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpe+8miR7ZGlyZWN0fS8ke2NhcmRzLmxlbmd0aH3jg6zjg7zjgrnvvIjjg6rjg7Pjgq/jgYLjgoogJHt3aXRoTGluay5sZW5ndGh944CB5aSx5pWXICR7ZmFpbE5977yJYCk7CiBmb3IoY29uc3QgW20sY10gb2YgT2JqZWN0LmVudHJpZXMocmVhc29ucykpbm90ZXMucHVzaChg44CA5aSx5pWX44Gu55CG55Sx77yaJHttfe+8iCR7Y33vvIlgKTsKIGNvbnN0IG1pc3Npbmc9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYobWlzc2luZy5sZW5ndGgpewogIGZvcihjb25zdCB2IG9mIFsuLi5uZXcgU2V0KG1pc3NpbmcubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbikpewogICBjb25zdCBuZWVkPW5ldyBTZXQobWlzc2luZy5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dikubWFwKHI9Pk51bWJlcihyLnJhY2VOdW1iZXIpKSk7CiAgIHRyeXsKICAgIGNvbnN0IEw9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgY29uc3QgYWxsPUwubGlua3N8fFtdLGxpbmtzPWFsbC5maWx0ZXIoeD0+bmVlZC5oYXMoeC5yYWNlTm8pKTsKICAgIG5vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muOCquODg+OCuueUu+mdouOBjOOBguOCi+ODrOODvOOCuSAke2FsbC5tYXAoeD0+eC5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ977yI5pyq5Y+W5b6XJHtuZWVkLnNpemV944Os44O844K544Gu44GG44GhJHtsaW5rcy5sZW5ndGh944Os44O844K577yJYCk7CiAgICBpZighYWxsLmxlbmd0aClub3Rlcy5wdXNoKGDjgIDnmbrlo7LliY3jga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgILoqLrmlq3vvJoke0pTT04uc3RyaW5naWZ5KChMLmRpYWd8fFtdKS5tYXAoeD0+KHtzOnguc3RlcCxsZW46eC5odG1sTGVuZ3RoLG46eC5jbmFtZXMsazp4LmtpbmRzLG06eC5tZW51cyxlOnguZXJyb3J9KSkpLnNsaWNlKDAsMzYwKX1gKTsKICAgIGNvbnN0IGJ5Qz1uZXcgTWFwKGxpbmtzLm1hcCh4PT5beC5jbmFtZSx4LnJhY2VOb10pKTsKICAgIGZvcihsZXQgaT0wO2k8bGlua3MubGVuZ3RoO2krPTQpewogICAgIGNvbnN0IGNoPWxpbmtzLnNsaWNlKGksaSs0KS5tYXAoeD0+eC5jbmFtZSk7CiAgICAgdHJ5ewogICAgICBjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaC5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICAgICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgbm89YnlDLmdldChpdC5jbmFtZSk7aWYobm8pV0sub2Rkc1tgJHtkfXwke3Z9LSR7bm99YF09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgICAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKW5vdGVzLnB1c2goYOOAgOiqreOBv+WPluOCjOOBquOBi+OBo+OBn++8miR7VkVOVUVbdl18fHZ9JHtieUMuZ2V0KGYuY25hbWUpfVLvvIgke1N0cmluZyhmLnJlYXNvbnx8IiIpLnNsaWNlKDAsNTApfe+8iWApOwogICAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjgIDlj5blvpfjgqjjg6njg7wgJHtWRU5VRVt2XXx8dn3vvJoke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsNzApfWApfQogICAgfQogICB9Y2F0Y2goZSl7bm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977ya5aSx5pWX77yIJHtTdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDEwMCl977yJYCl9CiAgfQogfQogY29uc3Qgc3RpbGw9Y2FyZHMuZmlsdGVyKHI9PiFXSy5vZGRzW3JrZXkoZCxyKV0pOwogaWYoc3RpbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOCquODg+OCuuacquWPluW+l++8miR7c3RpbGwubWFwKHI9PihyLnZlbnVlTmFtZXx8IiIpK3IucmFjZU51bWJlcisiUiIpLmpvaW4oIuOAgSIpfe+8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+iqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCk++8iWApOwogV0sub2Rkc05vdGVzW2RdPW5vdGVzOwogcmV0dXJue246Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoLG5vdGVzfTsKfQoKbGV0IE9ERFNfVElNRVI9bnVsbCxPRERTX1RSSUVTPTA7CmZ1bmN0aW9uIG9kZHNNaXNzaW5nKCl7bGV0IG09MCx0PTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpZm9yKGNvbnN0IGMgb2YgV0suY2FyZHNbZF18fFtdKXt0Kys7aWYoIVdLLm9kZHNbcmtleShkLGMpXSltKyt9cmV0dXJue20sdH19Ci8qIOOCquODg+OCuuOBruacquWPluW+l+OBjOaui+OBo+OBpuOBhOOBpuOAgeW9k+aXpeOBruacneOAnOWkleaWueOBquOCieOAgTXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZnvvIhKUkHjga/pgJrluLjjga7jg6zjg7zjgrnjgpLlvZPml6XmnJ3jgavnmbrlo7Lplovlp4vjgZnjgovjgZ/jgoHvvIkgKi8KZnVuY3Rpb24gc2NoZWR1bGVPZGRzUmV0cnkoKXsKIGlmKE9ERFNfVElNRVIpe2NsZWFyVGltZW91dChPRERTX1RJTUVSKTtPRERTX1RJTUVSPW51bGx9CiBjb25zdCB7bX09b2Rkc01pc3NpbmcoKSxoPW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLmdldFVUQ0hvdXJzKCk7CiBpZighbXx8T0REU19UUklFUz49MzZ8fGg8Nnx8aD49MTd8fCFXSy5kYXRlcy5pbmNsdWRlcyhqc3RUb2RheSgpKSlyZXR1cm4gZmFsc2U7CiBPRERTX1RSSUVTKys7T0REU19USU1FUj1zZXRUaW1lb3V0KCgpPT57T0REU19USU1FUj1udWxsO2lmKCEkKCJ3a0dvIikuZGlzYWJsZWQpb2Rkc09ubHkoKX0sNSo2MGUzKTtyZXR1cm4gdHJ1ZTsKfQpjb25zdCBvZGRzSGludD0oKT0+e2NvbnN0IHttfT1vZGRzTWlzc2luZygpO2lmKCFtKXJldHVybiIiO2NvbnN0IHNjaD1zY2hlZHVsZU9kZHNSZXRyeSgpO3JldHVybmBcbuacquWPluW+lyAke21944Os44O844K577ya55m65aOy5YmN44Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ77yISlJB44Gv6YCa5bi444Gu44Os44O844K544Gu44Kq44OD44K644KS5b2T5pel5pyd44Gr55m65aOy6ZaL5aeL77yJ44CCJHtzY2g/IjXliIbjgZTjgajjgavoh6rli5Xjgaflj5bjgornm7TjgZfjgb7jgZnjgIIiOiLnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifWB9Owphc3luYyBmdW5jdGlvbiB3ZWVrZW5kR28oKXtPRERTX1RSSUVTPTA7CiBjb25zdCBiYXNlPWJhc2VVcmwoKTskKCJ3a0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogV0suZGF0ZXM9W107V0suY2FyZHM9e307V0sub2Rkcz17fTtXSy5kaWFnPVtdO1dLLmNhbGM9e307CiB0cnl7CiAgd2tNc2coIumWi+WCrOaXpeOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCk7bGV0IGRhdGVzPVtdOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHt0b2RheX0mbGlzdD0xYCxbMTUwMF0pO2RhdGVzPSh4LmF2YWlsYWJsZURhdGVzfHxbXSkuZmlsdGVyKGQ9PmQ+PXRvZGF5KX1jYXRjaChlKXt9CiAgaWYoIWRhdGVzLmxlbmd0aClkYXRlcz1uZXh0V2Vla2VuZCh0b2RheSk7CiAgZGF0ZXM9Wy4uLm5ldyBTZXQoZGF0ZXMpXS5zb3J0KCkuc2xpY2UoMCwzKTsKICBmb3IoY29uc3QgZCBvZiBkYXRlcyl7CiAgIHdrTXNnKGAke2R9IOmWi+WCrOWgtOOCkueiuuiqjeS4reKApmApOwogICBsZXQgdmVudWVzPVtdOwogICB0cnl7dmVudWVzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZH0mbGlzdD0xYCxbMTUwMF0pKS52ZW51ZXN8fFtdfQogICBjYXRjaChlKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs5aC05LiA6KanKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7Y29udGludWV9CiAgIGlmKCF2ZW51ZXMubGVuZ3RoKXtXSy5kaWFnLnB1c2goe2QsY29kZToiIixuYW1lOiIo6ZaL5YKs44Gq44GXKSIscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6IuOBk+OBruaXpeOBruWHuummrOihqOOBr+acquWFrOmWi+OAgeOBvuOBn+OBr+mWi+WCrOOBjOOBguOCiuOBvuOBm+OCkyJ9KTtjb250aW51ZX0KICAgV0suY2FyZHNbZF09W107CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7d2tNc2coYCR7ZH0gJHt2LnZlbnVlTmFtZXx8di52ZW51ZUNvZGV9IOOBruWHuummrOihqOOCkuWPluW+l+S4reKApu+8iCR7KFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWApO2F3YWl0IGxvYWRWZW51ZUludG8oYmFzZSxkLHYpfQogICBpZigoV0suY2FyZHNbZF18fFtdKS5sZW5ndGgpV0suZGF0ZXMucHVzaChkKTsKICB9CiAgaWYoIVdLLmRhdGVzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuWHuummrOihqOOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguOAjOWPluOCiui+vOOBv+eKtuazgeOAjeOCv+ODluOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogIGxldCBvZGRzTj0wLHRvdGFsPTA7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuWPluW+l+S4reKApmApO29kZHNOKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlLGQpKS5uO3RvdGFsKz1XSy5jYXJkc1tkXS5sZW5ndGh9CiAgdHJ5e1dLLnBlZD1hd2FpdCBwZWRpZ3JlZVVwZGF0ZShXSy5jYXJkcyl9Y2F0Y2goZSl7V0sucGVkPW51bGx9CiAgd2tNc2coIumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBl+OBpuOAgeWFqOODrOODvOOCueOCkuino+aekOS4reKApiIpOwogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7CiAgcmVuZGVyQWxsKCk7CiAgY29uc3QgbnI9V0suZGF0ZXMucmVkdWNlKChzLGQpPT5zK1dLLmNhcmRzW2RdLmxlbmd0aCwwKTsKICB3a01zZyhg5a6M5LqG77yIJHtXSy5hdH3vvInvvJoke1dLLmRhdGVzLmpvaW4oIuOAgSIpfe+8jyR7bnJ944Os44O844K577yP44Kq44OD44K6ICR7b2Rkc05944Os44O844K5JHtvZGRzSGludCgpfWApOwogICQoIndrT2RkcyIpLmRpc2FibGVkPWZhbHNlO3Nob3dUYWIoInZBeGlzIik7CiB9Y2F0Y2goZSl7d2tNc2coIuOCqOODqeODvO+8miIrZS5tZXNzYWdlKTtidXN5KGZhbHNlKTtyZW5kZXJBbGwoKX0KIGZpbmFsbHl7JCgid2tHbyIpLmRpc2FibGVkPWZhbHNlfQp9CmFzeW5jIGZ1bmN0aW9uIG9kZHNPbmx5KCl7CiBpZighV0suZGF0ZXMubGVuZ3RoKXJldHVybjskKCJ3a09kZHMiKS5kaXNhYmxlZD10cnVlOwogdHJ5e2xldCBuPTA7Zm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpe3drTXNnKGAke2R9IOOCquODg+OCuuOCkuabtOaWsOS4reKApmApO24rPShhd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKSkubn0KICBhd2FpdCBjYWxjV2Vla2VuZCgpO1dLLmF0PW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTYpO3JlbmRlckFsbCgpO3drTXNnKGDjgqrjg4Pjgrrmm7TmlrDvvIgke1dLLmF0fe+8ie+8miR7bn3jg6zjg7zjgrnliIYke29kZHNIaW50KCl9YCl9CiBjYXRjaChlKXt3a01zZygi5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2UpfWZpbmFsbHl7JCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDop6PmnpDvvIgx44Os44O844K577yJ77ya6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuiA9IOacn+W+heWApOOAgeazouS5seW6puOAgemJhOadvwogKiAg6KSH5Yud56K6546H77ya44Kq44OD44K644GC44KK4oaS5biC5aC05oOF5aCx44KC5L2/44GG5a2m57+S5riI44G/44Oi44OH44OrKHBPKe+8j+OBquOBl+KGkumBjuWOu+aIkOe4vuOBruOBv+OBruODouODh+ODqyhwUCkKICogIOikh+WLneOCquODg+OCuu+8mkpSQeOBruikh+WLneOCquODg+OCuu+8iOS4i+mZkOOAnOS4iumZkO+8ieOAguiqreOCgeOBquOBhOOBqOOBjeOBr+WNmOWLneOBi+OCieaOqOWumu+8iMOX6KGo56S677yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KZnVuY3Rpb24gY2FsY1JhY2UoZCxjLHN0b3JlKXsKIGNvbnN0IHJhY2U9bWtSYWNlKGMsZCk7cmFjZS5nYz1nb2luZ0NhdChnb2luZ0NvZGUoYy5nb2luZykpO2xldCBuPXJhY2UucnVubmVycy5sZW5ndGg7Y29uc3Qgc2NyYXRjaGVkPVtdOwoge2NvbnN0IG8wPVdLLm9kZHNbcmtleShkLGMpXTsKICBpZihvMCl7Y29uc3QgbWlzcz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9PiEobzAudGFuW3IubnVtXT4xKSksaGF2ZT1yYWNlLnJ1bm5lcnMubGVuZ3RoLW1pc3MubGVuZ3RoOwogICAvLyDkuIDpg6jjga7ppqzjgaDjgZHjgqrjg4PjgrrjgYznhKHjgYTvvJ3lj5bmtojjg7vpmaTlpJbjga7lj6/og73mgKfjgYzpq5jjgYTjgILlpJbjgZfjgabjgIHjgqrjg4Pjgrrovrzjgb/jgafop6PmnpDjgZnjgovvvIjlpKfljYrjgYzmrKDjgZHjgabjgYTjgovjgarjgonlpJbjgZXjgarjgYTvvIkKICAgaWYobWlzcy5sZW5ndGgmJmhhdmU+PTYmJm1pc3MubGVuZ3RoPD1NYXRoLm1heCgzLE1hdGguZmxvb3IocmFjZS5ydW5uZXJzLmxlbmd0aCouMikpKXtzY3JhdGNoZWQucHVzaCguLi5taXNzLm1hcChyPT5yLm51bSkpO3JhY2UucnVubmVycz1yYWNlLnJ1bm5lcnMuZmlsdGVyKHI9Pm8wLnRhbltyLm51bV0+MSk7bj1yYWNlLnJ1bm5lcnMubGVuZ3RofX19CiBjb25zdCBiYXNlPXtkLGNhcmQ6YyxyYWNlLG4sc2NyYXRjaGVkLGtleTpya2V5KGQsYyksdmVudWU6Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIiLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLAogIGxhYmVsOmAke2MudmVudWVOYW1lfHxjLnZlbnVlfHwiIn0ke2MucmFjZU51bWJlcnx8IiJ9UiAkeyhjLnJhY2VOYW1lJiZjLnJhY2VOYW1lIT09IuWHuummrOihqCIpP2MucmFjZU5hbWU6KGMuY2xhc3NOYW1lfHwiIil9YCxjb3Vyc2U6Yy5zdXJmYWNlJiZjLmRpc3RhbmNlP2Ake2Muc3VyZmFjZX0ke2MuZGlzdGFuY2V9bWA6IuOCs+ODvOOCueS4jeaYjiJ9OwogaWYoL+manOWusy8udGVzdCgoYy5yYWNlTmFtZXx8IiIpKyhjLmNsYXNzTmFtZXx8IiIpKSlyZXR1cm57Li4uYmFzZSxza2lwOiLpmpzlrrPjg6zjg7zjgrnjga/lr77osaHlpJbvvIjlubPlnLDnlKjjga7jg6Ljg4fjg6vjga7jgZ/jgoHvvIkifTsKIGlmKG48NilyZXR1cm57Li4uYmFzZSxza2lwOiI26aCt5pyq5rqAIn07CiBjb25zdCBvPVdLLm9kZHNbYmFzZS5rZXldLG9kZHM9bz9yYWNlLnJ1bm5lcnMubWFwKHI9Pm8udGFuW3IubnVtXSk6bnVsbCxoYXNPZGRzPSEhKG9kZHMmJm9kZHMuZXZlcnkoeD0+eD4xKSk7CiBjb25zdCBvZD1oYXNPZGRzP29kZHM6bnVsbDsKIGNvbnN0IHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTtsZXQgdWc9VUUudXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kLGFwKTsKIGNvbnN0IFVNPWdldFVwc2V0TW9kZWwoKTsKIGlmKFVNJiZzdG9yZS51cCl7dHJ5e2NvbnN0IHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKSxpbmY9e3Y6U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpLG5vOk51bWJlcihjLnJhY2VOdW1iZXIpfHwwLGdjOnJhY2UuZ2Msc3VyZjpyYWNlLnN1cmYsZGlzdDpyYWNlLmRpc3QsbHZsOnJhY2UubHZsLGdyZDpyYWNlLmdyZCxOOm59LHNpbT0oaGFzT2RkcyYmc3RvcmUucHAmJm4+PTYpPygoKT0+e2NvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKTtyZXR1cm4gc2ltRmVhdChhcC5wUCxwb3BzLG4sc3RvcmUucHApfSkoKTpudWxsLGN1PXVwc2V0Q3VzdG9tKFVNLHUsc3RvcmUudXAuZmVhdChpbmYpLHBhY2VGZWF0KHJhY2UucnVubmVycyxzdG9yZSksc2ltKTtpZihjdSl1Zz17Li4udWcsLi4uY3UsbW9kZTp1Lm1vZGUsY3VzdG9tOnRydWV9fWNhdGNoKGUpe319CiBjb25zdCBQTT1nZXRQbGFjZU1vZGVsKCk7bGV0IHBOZXc9bnVsbDsKIHJhY2UuZ2M9Z29pbmdDYXQoZ29pbmdDb2RlKGMuZ29pbmcpKTsKIGlmKFBNJiZoYXNPZGRzJiZuPj04JiZzdG9yZS5wcCl7dHJ5ewogIGNvbnN0IHBvcHM9cG9wc0Zyb21PZGRzKG9kKSxyaz1yYW5rRnJhY3MoYXAucFApLHJjST17Z2M6cmFjZS5nYyx2OlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxOOm59LGN0eD17ZHJhdzpzdG9yZS5kcmF3LHRyOnN0b3JlLnRyLHNpcmU6c3RvcmUuc2lyZSxwZWQ6UEVEfSxiPU1hdGgubWluKC41LDMvbik7CiAgcE5ldz1ub3JtU3VtKHJhY2UucnVubmVycy5tYXAoKHIsaSk9PntsZXQgeD1wbGFjZVgoYXAucFBbaV0scG9wc1tpXSxuLHN0b3JlLnBwLHJrW2ldKTtpZihQTS5leHQpeD1bLi4ueCwuLi5leHRGZWF0SG9yc2UocixzdG9yZS5oLmdldChyLmhvcnNlKSxyY0ksY3R4LGIpXTtyZXR1cm4gcHJlZExvZ2l0KFBNLm1vZGVsLHgpfSksMyl9Y2F0Y2goZSl7cE5ldz1udWxsfX0KIGxldCBheGlzPWhhc09kZHM/VUUuYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2QsYXApOm51bGw7CiBpZihoYXNPZGRzKXsKICBjb25zdCBwYT1wTmV3fHxhcC5wTyxpcm9uUmF0ZT0ocE5ldyYmUE0uaXJvbiYmUE0uaXJvbi5uPjApP1BNLmlyb24ucmF0ZTpVRS5BWElTLmJhbmRzWyLpiYTmnb8iXS5yYXRlOwogIGNvbnN0IGlyb249cGEubWFwKChwLGkpPT4oe2kscCx0aWVyOiLpiYTmnb8iLHJhdGU6aXJvblJhdGV9KSkuZmlsdGVyKHg9PngucD49SVJPTl9QKTsKICBjb25zdCBpc0lyb249bmV3IFNldChpcm9uLm1hcCh4PT54LmkpKSxyZWY9KGF4aXN8fFtdKS5maWx0ZXIoeD0+IWlzSXJvbi5oYXMoeC5pKSYmeC50aWVyIT09IumJhOadvyIpLm1hcCh4PT4oey4uLngscDpwYVt4LmldfSkpOwogIGF4aXM9Wy4uLmlyb24sLi4ucmVmXTsKIH0KIGNvbnN0IG0zPWhhc09kZHM/VUUudG9wM0Zyb21XaW4ob2QubWFwKHg9PjEveCkpOm51bGw7CiBjb25zdCBob3JzZXM9cmFjZS5ydW5uZXJzLm1hcCgocixpKT0+ewogIGNvbnN0IHA9cE5ldz9wTmV3W2ldOihoYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldKSxwbD1vJiZvLnBsYWNlJiZvLnBsYWNlW3IubnVtXTsKICBsZXQgbG89bnVsbCxoaT1udWxsLHNyYz1udWxsOwogIGlmKHBsJiZwbC5sZW5ndGg9PT0yJiZwbFswXT49MSl7bG89cGxbMF07aGk9cGxbMV07c3JjPSLlrp8ifQogIGVsc2UgaWYobTMpe2xvPU1hdGgubWF4KDEsMC44L01hdGgubWF4KG0zW2ldLC4wMikpO2hpPWxvO3NyYz0i5o6o5a6aIn0KICBjb25zdCB0cj1zdG9yZS50ciYmci50cmFpbmVyP3N0b3JlLnRyLmdldChyLnRyYWluZXIpOm51bGwseD1yZXNbaV07CiAgcmV0dXJue2ksbm86ci5udW0sbmFtZTpyLm5hbWUsam5hbWU6ci5qbmFtZSx0cmFpbmVyOnIudHJhaW5lcix0ck46dHI/dHIubjowLHRyUmF0ZTp0ciYmdHIubj90ci50My90ci5uOm51bGwsam46eC5qbiwKICAgcCxwU3JjOnBOZXc/IuWGjeagoeatoyI6bnVsbCxwT2xkOmhhc09kZHM/YXAucE9baV06YXAucFBbaV0sbG8saGksc3JjLGV2OmxvP3AqbG86bnVsbCxldk1pZDpsbz9wKihsbytoaSkvMjpudWxsLHdpbjpoYXNPZGRzP29kW2ldOm51bGwscG9wOngucG9wLGhvbGU6eC5ob2xlLHBjOngucGMsbW9kZTp4Lm1vZGUsbjp4Lm4sCiAgIGNhcmVlcjp4LmNhcmVlcixyZWNlbnQ6eC5yZWNlbnQsdGFnczp4LnRhZ3MscmF0aW5nOihwTmV3JiZQTS5ob2xlQ3V0cyYmeC5ob2xlKT9ncmFkZUhvbGUoUE0uaG9sZUN1dHMscCk6VUUucmF0aW5nKHgucGMseC5tb2RlLHgubikseH19KTsKIHJldHVybnsuLi5iYXNlLGhhc09kZHMscmVzLGFwLHVnLGF4aXMsaG9yc2VzLGhvbGVOZXc6ISEocE5ldyYmUE0uaG9sZUN1dHMpLHBsYWNlUmVhbDpob3JzZXMuZmlsdGVyKGg9Pmguc3JjPT09IuWunyIpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gY2FsY1dlZWtlbmQoKXsKIFdLLmNhbGM9e307CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKFdLLmRhdGVzWzBdKTsKIFdLLnN0b3JlSW5mbz17bGFzdDpzdG9yZS5sYXN0RGF0ZXx8IiIsY291bnQ6c3RvcmUuY291bnR9OwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IGNzPVsuLi5XSy5jYXJkc1tkXV0uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlQ29kZSkpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAgV0suY2FsY1tkXT17cmFjZXM6W119OwogIGZvcihsZXQgaT0wO2k8Y3MubGVuZ3RoO2krKyl7CiAgIHRyeXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goY2FsY1JhY2UoZCxjc1tpXSxzdG9yZSkpfQogICBjYXRjaChlKXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goe2QsY2FyZDpjc1tpXSxza2lwOiLop6PmnpDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSxsYWJlbDpgJHtjc1tpXS52ZW51ZU5hbWV8fCIifSR7Y3NbaV0ucmFjZU51bWJlcnx8IiJ9UmAsdmVudWU6Y3NbaV0udmVudWVOYW1lfHwiIixubzpjc1tpXS5yYWNlTnVtYmVyfHwwLGhvcnNlczpbXX0pfQogICBpZihpJTQ9PT0zKWF3YWl0IHNsZWVwKDApOwogIH0KIH0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaknOiovOOCsuODvOODiO+8muWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+OAgeiqpOW3ruOCkuW8leOBhOOBpuOCguWbnuWPjueOhzEwMCXku6XkuIrjga7osrfjgYTmlrnjgaDjgZHjgIzmpJzoqLzmuIjjgb/jgI0KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBHQVRFX0tFWT0ia2VpYmFfZ2F0ZV92MiI7CmNvbnN0IGdldEdhdGU9KCk9Pnt0cnl7cmV0dXJuIEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oR0FURV9LRVkpfHwibnVsbCIpfWNhdGNoKGUpe3JldHVybiBudWxsfX07CmNvbnN0IFNUUkFUPXtmb2N1czoi56m06aas77yI4peO55qE5Lit546H6YeN6KaW77yJIix0b3AxOiLnqbTppqwx5L2NIix0b3AyOiLnqbTppqzkuIrkvY0y6aCtIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7gifTsKZnVuY3Rpb24gc2V0R2F0ZShvdXQsb3V0UCl7CiBjb25zdCBpdGVtcz1bXTsKIGZvcihjb25zdCBbc3JjLG9dIG9mIFtbIuOCquODg+OCuuOBguOCiiIsb3V0XSxbIuOCquODg+OCuuOBquOBlyIsb3V0UF1dKXsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhTVFJBVCkpewogICBjb25zdCB2PW8uc3RhdHNba107aWYoIXYpY29udGludWU7CiAgIGNvbnN0IHNlZz0odi5DJiZ2LkMuYmV0cz49MzAwKT92LkM6di5hbGw7aWYoIXNlZ3x8IXNlZy5iZXRzKWNvbnRpbnVlOwogICBjb25zdCBsb3c9c2VnLnJvaS0xLjk2KnNlZy5zZTsKICAgaXRlbXMucHVzaCh7a2V5OmssbGFiZWw6U1RSQVRba10rIu+8iCIrc3JjKyLvvIkiLHJvaTpzZWcucm9pLGxvdyxiZXRzOnNlZy5iZXRzLGhpdDpzZWcuaGl0UmF0ZSxzZWc6c2VnPT09di5DPyLlrabnv5LlvowiOiLlhajmnJ/plpMifSk7CiAgfQogfQogbG9jYWxTdG9yYWdlLnNldEl0ZW0oR0FURV9LRVksSlNPTi5zdHJpbmdpZnkoe2F0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxpdGVtc30pKTsKIHJlbmRlckdhdGUoKTsKfQpjb25zdCBzdHJhdE9rPWtleT0+e2NvbnN0IGc9Z2V0R2F0ZSgpO3JldHVybiAhIShnJiZnLml0ZW1zLnNvbWUoeD0+eC5rZXk9PT1rZXkmJngubG93Pj0xJiZ4LmJldHM+PTMwMCkpfTsKY29uc3Qgc3RyYXRDaGlwPWtleT0+c3RyYXRPayhrZXkpPyc8c3BhbiBjbGFzcz0iY2hpcCBiIj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJPC9zcGFuPic6JzxzcGFuIGNsYXNzPSJjaGlwIHIiPuWbnuWPjueOhzEwMCXotoXjga/mnKrnorroqo08L3NwYW4+JzsKZnVuY3Rpb24gcmVuZGVyR2F0ZSgpewogY29uc3QgZz1nZXRHYXRlKCksZWw9JCgiZ2F0ZSIpOwogaWYoIWcpe2VsLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj48Yj7lm57lj47njofvvJrmnKrmpJzoqLw8L2I+44CA44CM5qSc6Ki844CN44K/44OW44KS5a6f6KGM44GZ44KL44G+44Gn44CB44Gp44Gu6LK344GE5pa544KC44CMMTAwJei2heOAjeOBqOOBr+iogOOBiOOBvuOBm+OCk+OAgu+8iOS7peWJjeOBruaknOiovOOBp+OBr+OAgeeptOmmrDHkvY3jga7opIfli53lm57lj47njofjga/ntIQ3MuOAnDc3JeOBp+OBl+OBn++8iTwvZGl2Pic7cmV0dXJufQogY29uc3Qgb2s9Zy5pdGVtcy5maWx0ZXIoeD0+eC5sb3c+PTEmJnguYmV0cz49MzAwKSxiZXN0PWcuaXRlbXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnJvaS1hLnJvaSlbMF07CiBpZihvay5sZW5ndGgpZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgb2siPjxiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvInvvJo8L2I+JHtvay5tYXAoeD0+YCR7ZXNjKHgubGFiZWwpfSAke3BjdCh4LnJvaSl977yI5LiL6ZmQJHtwY3QoeC5sb3cpfeODuyR7eC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHt4LnNlZ33vvIlgKS5qb2luKCLvvI8iKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC6YGO5Y6744Gu5oiQ57i+44Gn44Gu57WQ5p6c44Gn44CB5LuK5b6M44KC57aa44GP5L+d6Ki844Gv44GC44KK44G+44Gb44KT44CCPC9zcGFuPjwvZGl2PmA7CiBlbHNlIGVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG5nIj48Yj7lm57lj47njocxMDAl6LaF44KS56K66KqN44Gn44GN44Gf6LK344GE5pa544Gv44CB44G+44Gg44GC44KK44G+44Gb44KT44CCPC9iPiR7YmVzdD9g5pyA6auY44Gn44KCICR7ZXNjKGJlc3QubGFiZWwpfSDjga4gJHtwY3QoYmVzdC5yb2kpfe+8iOiqpOW3ruOCkuW8leOBj+OBqCR7cGN0KGJlc3QubG93KX3jg7ske2Jlc3QuYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7YmVzdC5zZWd977yJ44CCYDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mpJzoqLzml6UgJHtlc2MoZy5hdCl944CC5LiL44Gu5YCZ6KOc44Gv44CM5b2T44Gf44KK44KE44GZ44GV44O75pyf5b6F5YCk44Gu55uu5a6J44CN44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9zcGFuPjwvZGl2PmA7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDooajnpLoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBJUk9OX1A9MC45NTsgICAvLyDotoXpiYTmnb/vvJ3opIfli53lnI/lhoXjgavlhaXjgovnorrnjofjgYw5NSXku6XkuIrjga7ppqzvvIjpoK3mlbDjga7liLbpmZDjgarjgZfvvIkKY29uc3QgR1JBREVfT1JERVI9WyJTU1MiLCJTUyIsIlMiLCJBIiwiQiIsIkMiXSxHUkFERV9DT0xPUj17U1NTOiIjYjQyMzE4IixTUzoiI2Q5MmQyMCIsUzoiI2Y3OTAwOSIsQToiIzE2NjdkOSIsQjoiIzY2NzA4NSIsQzoiIzk4YTJiMyJ9Owpjb25zdCBkYXlMYWJlbD1kPT57Y29uc3Qgdz0i5pel5pyI54Gr5rC05pyo6YeR5ZyfIltuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VVRDRGF5KCldO3JldHVybiBgJHtkLnNsaWNlKDUpLnJlcGxhY2UoIi0iLCIvIil9KCR7d30pYH07CmNvbnN0IGNhbGNSYWNlcz1kPT4oV0suY2FsY1tkXSYmV0suY2FsY1tkXS5yYWNlcyl8fFtdOwpjb25zdCBhbGxSYWNlcz0oKT0+V0suZGF0ZXMuZmxhdE1hcChkPT5jYWxjUmFjZXMoZCkpOwpjb25zdCBub0RhdGE9bXNnPT5gPGRpdiBjbGFzcz0ic21hbGwiPiR7bXNnfHwi44CM4pGgIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+OBmeOCi+OAjeOCkuaKvOOBmeOBqOihqOekuuOBleOCjOOBvuOBmeOAgiJ9PC9kaXY+YDsKCmZ1bmN0aW9uIHJlbmRlckFsbCgpe3JlbmRlckdhdGUoKTtyZW5kZXJBeGlzKCk7cmVuZGVyRXYoKTtyZW5kZXJVcHNldCgpO3JlbmRlckhvbGUoKTtyZW5kZXJSYWNlcygpO3JlbmRlclN1bSgpfQoKLyogLS0tIOi2hemJhOadv++8iOikh+WLneWcj+WGheOBrueiuueOh+OBjOmrmOOBhOi7uOmmrO+8ie+8muWfuua6lu+8iOeiuueOh+OBruS4i+mZkO+8ieOCkumBuOOBueOCiyAtLS0gKi8KY29uc3QgSVJPTl9LRVk9ImtlaWJhX2lyb25fY3V0IjsKLyog5Z+65rqW44GU44Go44Gu6YGO5Y6744Gu5a6f57i+6KGo77ya5YaN5qCh5q2j5b6M44Gv5qSc6Ki85pyf6ZaT44Gu5a6f57i+44CB44Gq44GR44KM44Gw5qiZ5rqW44Oi44OH44Or44Gu5qSc6Ki857WQ5p6c77yI5Yy65YiG44KS56mN44G/5LiK44GS77yJICovCmZ1bmN0aW9uIGlyb25UYWJsZSgpewogY29uc3QgUE14PWdldFBsYWNlTW9kZWwoKTsKIGlmKFBNeCYmUE14LnRociYmUE14LnRlc3REYXlzKXsKICByZXR1cm57c3JjOmDlho3moKHmraPlvozjga7mpJzoqLzmnJ/plpPvvIgke1BNeC50ZXN0RGF5c33plovlgqzml6XvvInjgafjga7lrp/nuL5gLHJvd3M6UE14LnRoci5maWx0ZXIodD0+dC50Pj0uODUmJnQubj4wKS5tYXAodD0+KHtjdXQ6dC50LHJhdGU6dC5yYXRlLGxvOnQubG8sbjp0Lm4scGVyRGF5OnQubi9QTXgudGVzdERheXN9KSkuc29ydCgoYSxiKT0+Yi5jdXQtYS5jdXQpfTsKIH0KIGNvbnN0IEI9VUUuQVhJUy5iYW5kcyxyb3dzPVtdO2xldCBuPTAsaz0wLHBkPTA7CiBmb3IoY29uc3QgW25tLGN1dF0gb2YgW1si6YmE5p2/IiwuOTJdLFsi5rqW6YmE5p2/IiwuODhdLFsi5aCF6Lu4IiwuODRdXSl7Y29uc3QgYj1CW25tXTtuKz1iLm47ays9Yi5uKmIucmF0ZTtwZCs9Yi5wZXJEYXk7Y29uc3Qgdz13aWxzb24oTWF0aC5yb3VuZChrKSxuKTtyb3dzLnB1c2goe2N1dCxyYXRlOmsvbixsbzp3WzBdLG4scGVyRGF5OnBkfSl9CiByZXR1cm57c3JjOiLmqJnmupbjg6Ljg4fjg6vjga7mpJzoqLzntZDmnpzvvIgyMDI05bm05Lul6ZmN77yJIixyb3dzOnJvd3Muc29ydCgoYSxiKT0+Yi5jdXQtYS5jdXQpfTsKfQpjb25zdCBpcm9uU3RhdD0ocm93cyxwKT0+cm93cy5maW5kKHg9PnguY3V0PD1wKzFlLTkpfHxudWxsOwpmdW5jdGlvbiByZW5kZXJBeGlzKCl7CiBjb25zdCBlbD0kKCJ2QXhpcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCB0Yj1pcm9uVGFibGUoKSxjdXRzPXRiLnJvd3MubWFwKHI9PnIuY3V0KTsKIGxldCBjdXQ9KCQoImlyb25DdXQiKSYmTnVtYmVyKCQoImlyb25DdXQiKS52YWx1ZSkpfHwwOwogaWYoIWN1dCl7dHJ5e2N1dD1OdW1iZXIobG9jYWxTdG9yYWdlLmdldEl0ZW0oSVJPTl9LRVkpKXx8MH1jYXRjaChlKXt9fQogaWYoIWN1dHx8IWN1dHMubGVuZ3RoKWN1dD1jdXRzLmluY2x1ZGVzKC45NSk/Ljk1OihjdXRzWzBdfHwuOTIpOwogY3V0PWN1dHMucmVkdWNlKChiLGMpPT5NYXRoLmFicyhjLWN1dCk8TWF0aC5hYnMoYi1jdXQpP2M6YixjdXRzWzBdfHxjdXQpOyAgIC8vIOihqOOBq+OBguOCi+Wfuua6luOBruOBhuOBoeOAgeOBhOOBoeOBsOOCk+i/keOBhOOCguOBrgogdHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKElST05fS0VZLFN0cmluZyhjdXQpKX1jYXRjaChlKXt9CiBjb25zdCBjdXI9aXJvblN0YXQodGIucm93cyxjdXQpOwogbGV0IGg9YDxoMj7otoXpiYTmnb/vvIjopIfli53lnI/lhoXjga7norrnjofjgYzpq5jjgYTou7jppqzvvIk8L2gyPiR7c3RyYXRDaGlwKCJheGlzIil9JHtwbGFjZVN0YXR1c0xpbmUoKX0KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+5Z+65rqW77ya6KSH5Yud5ZyP5YaF44Gu56K6546H44GMIDxzZWxlY3QgaWQ9Imlyb25DdXQiPiR7Y3V0cy5tYXAoYz0+YDxvcHRpb24gdmFsdWU9IiR7Y30iPiR7cGN0KGMsMCl95Lul5LiKPC9vcHRpb24+YCkuam9pbigiIil9PC9zZWxlY3Q+IOOBrummrOOCkuOAgemgreaVsOOBruWItumZkOOBquOBl+OBp+WHuuOBl+OBvuOBmTwvZGl2PgogPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBoOOBkeWIpOWumuOBl+OBvuOBmeOAgjxiPuWfuua6luOCkuS4i+OBkuOCi+OBqOmgreaVsOOBr+Wil+OBiOOBvuOBmeOBjOOAgeWun+mam+OBrueahOS4reeOh+OBr+S4i+OBjOOCiuOBvuOBmTwvYj7vvIgke2VzYyh0Yi5zcmMpfe+8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuWfuua6ljwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PHRoPjHml6XjgYLjgZ/jgoo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+JHt0Yi5yb3dzLm1hcChyPT5gPHRyJHtyLmN1dD09PWN1dD8nIHN0eWxlPSJmb250LXdlaWdodDo3MDAiJzoiIn0+PHRkPiR7cGN0KHIuY3V0LDApfeS7peS4ijwvdGQ+PHRkPiR7cGN0KHIucmF0ZSwxKX08L3RkPjx0ZD4ke3BjdChyLmxvLDEpfeOAnDwvdGQ+PHRkPiR7ci5wZXJEYXkudG9GaXhlZCgyKX3poK08L3RkPjwvdHI+YCkuam9pbigiIil9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBpZihjdXIpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pgbjmip7kuK3vvIgke3BjdChjdXQsMCl95Lul5LiK77yJ77ya6YGO5Y6744Gr5a6f6Zqb44GrPGI+JHtwY3QoY3VyLnJhdGUsMSl9PC9iPuOBjDPnnYDku6XlhoXjgIEx5pel44GC44Gf44KK57SEPGI+JHtjdXIucGVyRGF5LnRvRml4ZWQoMil96aCtPC9iPuOAgiR7Y3VyLnJhdGU8Ljk1Pyc8c3BhbiBjbGFzcz0id2FybiI+OTUl44Gr44Gv5bGK44GN44G+44Gb44KT44CCPC9zcGFuPic6IiJ9PC9kaXY+YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkuZmlsdGVyKHI9PiFyLnNraXApLHBpY2tzPVtdLHJlZj1bXTsKICBmb3IoY29uc3QgciBvZiBycylpZihyLmhhc09kZHMpZm9yKGNvbnN0IGhoIG9mIHIuaG9yc2VzKXsKICAgaWYoaGgucD49Y3V0KXBpY2tzLnB1c2goe3IsaGgsc3Q6aXJvblN0YXQodGIucm93cyxoaC5wKX0pOwogICBlbHNlIGlmKGhoLnA+PShjdXRzW2N1dHMubGVuZ3RoLTFdfHwuODQpKXJlZi5wdXNoKHtyLGhoLHN0Omlyb25TdGF0KHRiLnJvd3MsaGgucCl9KTsKICB9CiAgcGlja3Muc29ydCgoYSxiKT0+Yi5oaC5wLWEuaGgucCk7cmVmLnNvcnQoKGEsYik9PmIuaGgucC1hLmhoLnApOwogIGNvbnN0IG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aDsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl944CAPHNwYW4gY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj5blvpcgJHtuT2Rkc30vJHtycy5sZW5ndGh944Os44O844K5PC9zcGFuPjwvaDM+YDsKICBpZighbk9kZHMpe2grPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeWIpOWumuOBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgjwvZGl2Pic7Y29udGludWV9CiAgY29uc3QgY2FyZD0oeix0YWcpPT5gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5yLmxhYmVsKX08L2I+44CAPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh6LnIuY291cnNlKX3jg7ske3ouci5ufemgrTwvc3Bhbj48YnI+PGI+JHt6LmhoLm5vfeeVqiAke2VzYyh6LmhoLm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHJBIj4ke3RhZ308L3NwYW4+44CA6KSH5Yud5ZyP5YaF44Gu56K6546HICR7cGN0KHouaGgucCwxKX08YnI+CiAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+6aiO5omL77yaJHtlc2Moei5oaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKHouaGgudHJhaW5lcnx8IuS4jeaYjiIpfe+8j+WNmOWLnSAke3ouaGgud2luP3ouaGgud2luKyLlgI0iOiItIn3vvI/opIfli50gJHt6LmhoLmxvP3ouaGgubG8udG9GaXhlZCgxKSsoei5oaC5oaT56LmhoLmxvPyLjgJwiK3ouaGguaGkudG9GaXhlZCgxKToiIikrIuWAjSIrKHouaGguc3JjPT09IuaOqOWumiI/IijmjqjlrpopIjoiIik6Ii0ife+8j+OBk+OBrueiuueOh+W4r+OBrumBjuWOu+Wun+e4viAke3ouc3Q/cGN0KHouc3QucmF0ZSwxKToi6ZuG6KiI5aSWIn08L3NwYW4+PC9kaXY+YDsKICBpZihwaWNrcy5sZW5ndGgpaCs9cGlja3MubWFwKHo9PmNhcmQoeix6LmhoLnA+PS45NT8i6LaF6YmE5p2/Ijoi6Lu45YCZ6KOcIikpLmpvaW4oIiIpOwogIGVsc2UgaCs9YDxkaXYgY2xhc3M9ImJhbm5lciB3biI+5Z+65rqW77yIJHtwY3QoY3V0LDApfeS7peS4iu+8ieOBq+ipsuW9k+OBmeOCi+mmrOOBr+OBhOOBvuOBm+OCk+OAgueEoeeQhuOBq+iyt+OCj+OBquOBhOOBruOCguS4gOOBpOOBruWIpOaWreOBp+OBmeOAgjwvZGl2PmA7CiAgaWYoIXBpY2tzLmxlbmd0aCYmcmVmLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWPguiAg++8iOWfuua6luOBq+OBr+WxiuOBi+OBquOBhOOAgeOBneOBruaXpeOBruacgOacieWKm++8ie+8mjwvZGl2PmArcmVmLnNsaWNlKDAsMikubWFwKHo9PmNhcmQoeiwi5Y+C6ICDIikpLmpvaW4oIiIpOwogfQogZWwuaW5uZXJIVE1MPWg7CiBjb25zdCBzZWw9JCgiaXJvbkN1dCIpO3NlbC52YWx1ZT1TdHJpbmcoY3V0KTtzZWwub25jaGFuZ2U9cmVuZGVyQXhpczsKfQoKLyogLS0tIOacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckV2KCl7CiBjb25zdCBlbD0kKCJ2RXYiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZXZNaW49TnVtYmVyKCQoImV2TWluIik/JCgiZXZNaW4iKS52YWx1ZToxLjA1KSxwTWluPU51bWJlcigkKCJldlAiKT8kKCJldlAiKS52YWx1ZTouMjUpOwogY29uc3Qgcm93cz1bXTsKIGZvcihjb25zdCByIG9mIGFsbFJhY2VzKCkpaWYoIXIuc2tpcClmb3IoY29uc3QgaCBvZiByLmhvcnNlcylpZihoLmV2IT1udWxsJiZoLmV2Pj1ldk1pbiYmaC5wPj1wTWluKXJvd3MucHVzaCh7cixofSk7CiByb3dzLnNvcnQoKGEsYik9PmIuaC5ldi1hLmguZXYpOwogY29uc3Qgbk9kZHM9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIk8L2gyPiR7c3RyYXRDaGlwKCJ2YWx1ZSIpfQogPGRpdiBjbGFzcz0ic21hbGwiPuacn+W+heWApO+8neOBneOBrummrOOBjDPnnYDku6XlhoXjgavlhaXjgovnorrnjocgw5cg6KSH5Yud44Kq44OD44K644Gu5LiL6ZmQ44CCMS4w44KS6LaF44GI44KM44Gw44CB55CG6KuW5LiK44Gv6LK344GE57aa44GR44Gm44OX44Op44K544Gn44GZ44CC6KSH5Yud44Kq44OD44K644GvPGI+5a6fPC9iPu+8nUpSQeOBruWun+OCquODg+OCuuOAgTxiPuaOqOWumjwvYj7vvJ3ljZjli53jgYvjgonoqIjnrpfjgZfjgZ/nm67lronjgILnorrnjofjga7opovnqY3jgoLjgorpgZXjgYTjgYzlpKfjgY3jgY/lirnjgY/jgZ/jgoHjgIHjgIzmpJzoqLzjgI3jgacxMDAl6LaF44GM56K66KqN44GV44KM44KL44G+44Gn44Gv55uu5a6J44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuacn+W+heWApCA8c2VsZWN0IGlkPSJldk1pbiI+PG9wdGlvbiB2YWx1ZT0iMSI+MS4wMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMDUiPjEuMDXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjEiPjEuMTDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjIiPjEuMjDku6XkuIo8L29wdGlvbj48L3NlbGVjdD4g6KSH5Yud56K6546HIDxzZWxlY3QgaWQ9ImV2UCI+PG9wdGlvbiB2YWx1ZT0iMC4xNSI+MTUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC4yNSI+MjUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC40Ij40MCXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjYiPjYwJeS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBpZighbk9kZHMpe2VsLmlubmVySFRNTD1oKyc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeOAgeacn+W+heWApOOBr+ioiOeul+OBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8ieOAgjwvZGl2Pic7YmluZEV2KGV2TWluLHBNaW4pO3JldHVybn0KIGlmKCFyb3dzLmxlbmd0aCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnaHku7bjgavlkIjjgYbppqzjga/jgYTjgb7jgZvjgpPjgII8L2Rpdj4nOwogZWxzZXsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrDwvdGg+PHRoPueiuueOhzwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPuacn+W+heWApDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCB7cixoOnh9IG9mIHJvd3Muc2xpY2UoMCw0MCkpaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoci5kKSl9ICR7ZXNjKHIubGFiZWwpfTxicj48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHguam5hbWV8fCIiKX08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3gubG8udG9GaXhlZCgxKX0ke3guaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfTwvc3Bhbj48L3RkPjx0ZD48Yj4ke3guZXYudG9GaXhlZCgyKX08L2I+PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7YmluZEV2KGV2TWluLHBNaW4pOwp9CmZ1bmN0aW9uIGJpbmRFdihhLGIpe2NvbnN0IGU9JCgiZXZNaW4iKSxwPSQoImV2UCIpO2lmKCFlKXJldHVybjtlLnZhbHVlPVN0cmluZyhhKTtwLnZhbHVlPVN0cmluZyhiKTtlLm9uY2hhbmdlPXAub25jaGFuZ2U9cmVuZGVyRXZ9CgovKiAtLS0g5rOi5Lmx5bqmIC0tLSAqLwovKiDmpJzoqLzmuIjjgb/jga7jg6Ljg4fjg6vjgYzjgYLjgozjgbDjgIHjgZ3jga7nrYnntJrjgafpgY7ljrvjgavlrp/pmpvjgavlh7rjgZ/miZXmiLvvvIjljZjli53jga7kuK3lpK7lgKTjgIExMDAw5YaG5Lul5LiK44Gu5Ymy5ZCI77yJ44KS6KGo56S6ICovCmNvbnN0IHBheUNlbGw9Zz0+e2NvbnN0IE09Z2V0VXBzZXRNb2RlbCgpLHg9TSYmTS5wYXlUYWImJk0ucGF5VGFiW2ddO2lmKCF4fHwheC5ucHx8eC5tZWRXaW49PW51bGwpcmV0dXJuIi0iO3JldHVybmDljZjli53jga7kuK3lpK7lgKQgJHtNYXRoLnJvdW5kKHgubWVkV2luKS50b0xvY2FsZVN0cmluZygpfeWGhjxicj4xMDAw5YaG5Lul5LiKICR7cGN0KHguc2hhcmUxMDAwLDApfWB9OwpmdW5jdGlvbiByZW5kZXJVcHNldCgpewogY29uc3QgZWw9JCgidlVwc2V0Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPWA8aDI+44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+PGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkeOBl+OBpuOBhOOBvuOBme+8iOWFqOODrOODvOOCueW5s+WdhyDntIQyOC41Je+8ieOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+OAgeOCquODg+OCuui+vOOBv+OBruWIpOWumuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PiR7dXBzZXRTdGF0dXNMaW5lKCl9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkuZmlsdGVyKHI9PiFyLnNraXApLGNudD17fTtHUkFERV9PUkRFUi5mb3JFYWNoKGc9PmNudFtnXT0wKTtycy5mb3JFYWNoKHI9PmNudFtyLnVnLmdyYWRlXSsrKTsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz48ZGl2IGNsYXNzPSJyb3ciPiR7R1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIil9PC9kaXY+YDsKICBjb25zdCBzb3J0ZWQ9cnMuc2xpY2UoKS5zb3J0KChhLGIpPT5HUkFERV9PUkRFUi5pbmRleE9mKGEudWcuZ3JhZGUpLUdSQURFX09SREVSLmluZGV4T2YoYi51Zy5ncmFkZSl8fGIudWcucC1hLnVnLnApOwogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Os44O844K5PC90aD48dGg+562J57SaPC90aD48dGg+5LqI5risPC90aD48dGg+5a6f57i+44Gu5rOi5Lmx546HPC90aD48dGg+6YGO5Y6744Gu5omV5oi777yI562J57Sa5Yil77yJPC90aD48dGg+5Yik5a6aPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHIgb2Ygc29ydGVkKWgrPWA8dHI+PHRkPiR7ZXNjKHIubGFiZWwpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+JHtyLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoP2AgPHNwYW4gY2xhc3M9ImNoaXAgbyI+6Zmk5aSW5o6o5a6aICR7ci5zY3JhdGNoZWQuam9pbigiLCIpfeeVqjwvc3Bhbj5gOiIifTwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltyLnVnLmdyYWRlXX0iPiR7ci51Zy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtwY3Qoci51Zy5wKX08L3RkPjx0ZD4ke3IudWcuY3VzdG9tJiZyLnVnLnJhdGUhPW51bGw/YCR7cGN0KHIudWcucmF0ZSl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtwY3Qoci51Zy5sbyl944CcJHtwY3Qoci51Zy5oaSl944O7JHtyLnVnLm595Lu2PC9zcGFuPmA6TWF0aC5yb3VuZChyLnVnLnJhdGUqMTAwKSsiJSJ9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3BheUNlbGwoci51Zy5ncmFkZSl9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3IudWcubW9kZT09PSJvZGRzIj8i44Kq44OD44K66L6844G/Ijoi5o6o5a6aIn08L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOeptOmmrO+8iOWlvei1sOeOh+OBrumrmOOBhOeptOmmrOWAmeijnO+8iSAtLS0gKi8KLyog56m06aas44Gu5YCZ6KOc77ya5YaN5qCh5q2j5riI44G/77yI44Kq44OD44K65Y+W5b6X5b6M77yJ44Gq44KJ5paw44GX44GE56K6546H44Gn44CB44Gd44GG44Gn44Gq44GR44KM44Gw5b6T5p2l44Gu6KmV5L6h44Gn6YG444G2ICovCmZ1bmN0aW9uIHBpY2tIb2xlKHIsaG0pewogaWYoci5ob2xlTmV3KXsKICBjb25zdCBMPXIuaG9yc2VzLmZpbHRlcihoPT5oLmhvbGUmJmgubj49MyYmKGgud2luPT1udWxsfHxoLndpbjwzMCkpLnNvcnQoKGEsYik9PmIucC1hLnApOwogIGNvbnN0IHBrPWg9Pih7aTpoLmksbm86aC5ubyxuYW1lOmgubmFtZSxwYzpoLnAsb2RkOmgud2luLHBvcDpoLnBvcCx0YWdzOmgudGFnc3x8W119KTsKICBpZihobT09PSJTIilyZXR1cm4gTC5maWx0ZXIoaD0+aC5yYXRpbmc9PT0iUyIpLnNsaWNlKDAsMykubWFwKHBrKTsKICBpZihobT09PSJTQSIpcmV0dXJuIEwuZmlsdGVyKGg9PmgucmF0aW5nPT09IlMifHxoLnJhdGluZz09PSJBIikuc2xpY2UoMCwyKS5tYXAocGspOwogIHJldHVybiByLmhvcnNlcy5maWx0ZXIoaD0+aC5ob2xlJiZoLm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsMikubWFwKHBrKTsKIH0KIHJldHVybiBobT09PSJTIj9VRS5waWNrRm9jdXMoci5yZXMsNikuZmlsdGVyKHg9PnIuaG9yc2VzW3guaV0ucmF0aW5nPT09IlMiKS5zbGljZSgwLDMpOmhtPT09IlNBIj9VRS5waWNrRm9jdXMoci5yZXMsMik6VUUucGljayhyLnJlcywyKTsKfQpmdW5jdGlvbiBob2xlUmF0aW5nVGV4dCgpewogY29uc3QgUE09Z2V0UGxhY2VNb2RlbCgpOwogaWYoUE0mJlBNLmhvbGVDdXRzJiZQTS5ob2xlU3RhdHMpe2NvbnN0IHQ9UE0uaG9sZVN0YXRzLnRhYixjPVBNLmhvbGVDdXRzO3JldHVybmDoqZXkvqHjga88Yj7lho3moKHmraPlvozjga7opIfli53norrnjoc8L2I+44Gn5rG644KB44Gm44GE44G+44GZ77yaU++8neS6iOa4rCR7cGN0KGMuUywxKX3ku6XkuIrvvIjmpJzoqLzmnJ/plpPjga7lrp/pmpvjga7nmoTkuK3njocgJHtwY3QodC5TLnJhdGUsMSl977yJ44CBQe+8nSR7cGN0KGMuQSwxKX3ku6XkuIrvvIgke3BjdCh0LkEucmF0ZSwxKX3vvInjgIFC77ydJHtwY3QoYy5CLDEpfeS7peS4iu+8iCR7cGN0KHQuQi5yYXRlLDEpfe+8ieOAgeOBneOCjOS7peWklu+8nUPvvIgke3BjdCh0LkMucmF0ZSwxKX3vvInjgILjgIxT44O7QeOAjeihqOekuuOBr+OAgei1sOaVsDPku6XkuIrjgafljZjli50zMOWAjeacqua6gOOBrummrOOBoOOBkeOBp+OBmeOAgmB9CiByZXR1cm5g6KmV5L6h44Gv44CB56m06aas44Gu5bmz5Z2H55qE44Gq5aW96LWw546H77yI44Kq44OD44K66L6844G/OS4xJe+8j+aOqOWumjExLjUl77yJ44Gr5a++44GZ44KL5YCN546H44Gn5rG644G+44KK44G+44GZ77yaU++8nTIuMuWAjeS7peS4iu+8iOe0hDIwJeS7peS4iu+8j+aOqOWumuOBr+e0hDI1JeS7peS4iu+8ieOAgUHvvJ0xLjflgI3ku6XkuIrvvIjntIQxNS41JeS7peS4iu+8j+e0hDE5LjYl5Lul5LiK77yJ44CBQu+8nTEuM+WAjeS7peS4iuOAgUPvvJ3jgZ3jgozmnKrmuoDjgILotbDmlbDjgYzlsJHjgarjgYTppqzjga5T44O7QeOBr+OAgULjgavkuIvjgZLjgb7jgZnjgILjgIxT44O7QeOAjeihqOekuuOBr+OAgei1sOaVsDPku6XkuIrjgafljZjli50zMOWAjeacqua6gOOBrummrOOBoOOBkeOBp+OBmeOAgmA7Cn0KZnVuY3Rpb24gcmVuZGVySG9sZSgpewogY29uc3QgZWw9JCgidkhvbGUiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgSEs9ImtlaWJhX2hvbGVfbW9kZSI7bGV0IGhtPSgkKCJob2xlRm9jdXMiKSYmJCgiaG9sZUZvY3VzIikudmFsdWUpfHwoKCk9Pnt0cnl7cmV0dXJuIGxvY2FsU3RvcmFnZS5nZXRJdGVtKEhLKX1jYXRjaChlKXtyZXR1cm4gbnVsbH19KSgpfHwiU0EiO2lmKCFbIlMiLCJTQSIsImFsbCJdLmluY2x1ZGVzKGhtKSlobT0iU0EiOwogdHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKEhLLGhtKX1jYXRjaChlKXt9CiBsZXQgaD1gPGgyPueptOmmrOWAmeijnDwvaDI+JHtzdHJhdENoaXAoImZvY3VzIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+56m06aas77yd5Lq65rCX44Gu5LiL5L2N44Gu6aasPC9iPu+8iOmgreaVsOOBrue0hDblibLjgojjgorkuIvjgILkvovvvJoxNumgreeri+OBpuOBquOCiTfnlarkurrmsJfku6XkuIvjgIExMumgreeri+OBpuS7peS4i+OBquOCiTXnlarkurrmsJfku6XkuIvvvInjga7kuK3jgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM6auY44GE6aas44CC44CM5b2T44Gf44KK44KE44GZ44GV44CN44Gu55uu5a6J44Gn44CB5Zue5Y+O546H44Gv5Yil44Gn44GZ44CCJHtob2xlUmF0aW5nVGV4dCgpfTwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj48c2VsZWN0IGlkPSJob2xlRm9jdXMiPjxvcHRpb24gdmFsdWU9IlMiPlPjgaDjgZHvvIjmnIDjgoLlpb3otbDnjofjgYzpq5jjgYTnqbTppqzvvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJTQSI+U+ODu0HvvIjil47nmoTkuK3njofph43oppbvvIk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJhbGwiPuOBmeOBueOBpu+8iOS4iuS9jTLpoK3vvIk8L29wdGlvbj48L3NlbGVjdD48L2Rpdj4KICR7aG09PT0iUyI/JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuOAjFPjgaDjgZHjgI3jga/ntZ7jgorovrzjgb/jga7ooajnpLrjgafjgZnjgILpgY7ljrvjga7mpJzoqLzvvIjmpJzoqLzjgr/jg5bvvInjga/jgIFT44O7QeOCkuOBvuOBqOOCgeOBn+aIkOe4vuOBp+mbhuioiOOBl+OBpuOBhOOCi+OBn+OCgeOAgVPjgaDjgZHjga7miJDnuL7jga/liKXjgavjga/norroqo3jgafjgY3jgabjgYTjgb7jgZvjgpPjgII8L2Rpdj4nOiIifWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApY29udGludWU7CiAgIGNvbnN0IGM9cGlja0hvbGUocixobSk7aWYoIWMubGVuZ3RoKWNvbnRpbnVlOwogICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moci5sYWJlbCl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK0ke3IuaGFzT2Rkcz8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77yJIn08L3NwYW4+YDsKICAgZm9yKGNvbnN0IHggb2YgYyl7Y29uc3QgaGg9ci5ob3JzZXNbeC5pXTsKICAgIGgrPWA8ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjZweCI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke2hoLnJhdGluZ30iPiR7aGgucmF0aW5nfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj7lpb3otbDnjocgJHtoaC5wU3JjP3BjdChoaC5wLDEpKyLvvIjlho3moKHmraPlvozjga7opIfli53norrnjofvvIkiOnBjdCh4LnBjLDEpfSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9PC9zcGFuPjxicj4KICAgICA8c3BhbiBjbGFzcz0ic21hbGwiPiR7aGguY2FyZWVyJiZoaC5jYXJlZXIubj9g6YCa566XJHtoaC5jYXJlZXIubn3otbAgM+edgOWGhSR7aGguY2FyZWVyLnQzfeWbnmA6IumAmueul++8muWxpeattOOBquOBlyJ9JHtoaC5yZWNlbnQmJmhoLnJlY2VudC5sZW5ndGg/YO+8j+ebtOi/kSAke2hoLnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGA6IiJ977yP6aiO5omL77yaJHtlc2MoaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyhoaC50cmFpbmVyfHwi5LiN5piOIil9JHtoaC50clJhdGUhPW51bGwmJmhoLnRyTj49MjA/YCgz552A5YaFJHtwY3QoaGgudHJSYXRlKX0pYDoiIn08L3NwYW4+PGJyPmArCiAgICAgKHgudGFnc3x8W10pLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfQogICBoKz0iPC9kaXY+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHM9JCgiaG9sZUZvY3VzIik7cy52YWx1ZT1obTtzLm9uY2hhbmdlPXJlbmRlckhvbGU7Cn0KCi8qIC0tLSDlhajjg6zjg7zjgrnvvIjppqzjgZTjgajjga7norrnjofjg7vjgqrjg4Pjgrrjg7vmnJ/lvoXlgKTjg7vpqI7miYvjg7voqr/mlZnluKvvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclJhY2VzKCl7CiBjb25zdCBlbD0kKCJ2UmFjZXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogbGV0IGg9IjxoMj7lhajjg6zjg7zjgrk8L2gyPiI7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApe2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtlc2Moci5sYWJlbCl977yaJHtlc2Moci5za2lwKX08L2Rpdj5gO2NvbnRpbnVlfQogICBjb25zdCBnPXIudWc7CiAgIGgrPWA8ZGV0YWlscz48c3VtbWFyeT4ke2VzYyhyLmxhYmVsKX0gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZy5ncmFkZV19Ij4ke2cuZ3JhZGV9PC9zcGFuPjwvc3VtbWFyeT48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6aas77yP6aiO5omL77yP6Kq/5pWZ5birPC90aD48dGg+5Y2Y5YudPC90aD48dGg+6KSH5YudPC90aD48dGg+56K6546HPC90aD48dGg+RVY8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IHggb2Ygci5ob3JzZXMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLnAtYS5wKSkKICAgIGgrPWA8dHI+PHRkPjxiPiR7eC5ub308L2I+ICR7ZXNjKHgubmFtZSl9JHt4LmhvbGUmJngucmF0aW5nIT09IkMiP2AgPHNwYW4gY2xhc3M9InJ0IHIke3gucmF0aW5nfSI+JHt4LnJhdGluZ308L3NwYW4+YDoiIn08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guam5hbWU/ZXNjKHguam5hbWUpOic8c3BhbiBjbGFzcz0iYmFkIj7pqI7miYvkuI3mmI48L3NwYW4+J33vvIgke3guam4+PTU/IumBjuWOuyIreC5qbisi6aiO5LmXIjoi5bGl5q205bCRIn3vvInvvI8ke3gudHJhaW5lcj9lc2MoeC50cmFpbmVyKTonPHNwYW4gY2xhc3M9ImJhZCI+6Kq/5pWZ5bir5LiN5piOPC9zcGFuPid9JHt4LnRyUmF0ZSE9bnVsbCYmeC50ck4+PTIwPyLvvIgz552A5YaFIitwY3QoeC50clJhdGUpKyLvvIkiOiIifTwvc3Bhbj48L3RkPjx0ZD4ke3gud2luP3gud2luLnRvRml4ZWQoMSk6Ii0ifTwvdGQ+PHRkPiR7eC5sbz94LmxvLnRvRml4ZWQoMSkrKHguaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiIpOiItIn08c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5zcmN8fCIifTwvc3Bhbj48L3RkPjx0ZD4ke3BjdCh4LnApfTwvdGQ+PHRkPiR7eC5ldiE9bnVsbD9gPGIke3guZXY+PTEuMDU/JyBjbGFzcz0iZ29vZCInOiIifT4ke3guZXYudG9GaXhlZCgyKX08L2I+YDoiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+PC9kZXRhaWxzPiI7CiAgfQogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDlj5bjgorovrzjgb/nirbms4HvvIjpoK3mlbDjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgrPjg7zjgrnjg7vjgqrjg4Pjgrrjga7oqq3jgb/lj5bjgorntZDmnpzvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlclN1bSgpewogY29uc3QgZWw9JCgidlN1bSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgmJiFXSy5kaWFnLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IHJzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PiFyLnNraXApOwogY29uc3QgaG9yc2VzPXJzLnJlZHVjZSgocyxyKT0+cytyLm4sMCksam1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC5qbmFtZSkubGVuZ3RoLDApLHRtaXNzPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+IWgudHJhaW5lcikubGVuZ3RoLDApOwogY29uc3Qgam1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5qbj49NSkubGVuZ3RoLDApLGhtYXRjaD1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9Pmgubj49MikubGVuZ3RoLDApOwogY29uc3Qgbm9Db3Vyc2U9cnMuZmlsdGVyKHI9PnIuY291cnNlPT09IuOCs+ODvOOCueS4jeaYjiIpLmxlbmd0aCxuT2Rkcz1ycy5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGgscFJlYWw9cnMuZmlsdGVyKHI9PnIucGxhY2VSZWFsPjApLmxlbmd0aDsKIGxldCBoPWA8aDI+5Y+W44KK6L6844G/54q25rOBPC9oMj48dGFibGU+PHRib2R5PgogPHRyPjx0ZD7op6PmnpDjgZfjgZ/jg6zjg7zjgrnvvI/lh7rotbDppqw8L3RkPjx0ZD4ke3JzLmxlbmd0aH3jg6zjg7zjgrnvvI8ke2hvcnNlc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPumojuaJi+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke2ptaXNzPyJiYWQiOiJnb29kIn0iPiR7am1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7oqr/mlZnluKvjgpLoqq3jgoHjgarjgYvjgaPjgZ/ppqw8L3RkPjx0ZCBjbGFzcz0iJHt0bWlzcz8iYmFkIjoiZ29vZCJ9Ij4ke3RtaXNzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kz44O844K544KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5PC90ZD48dGQgY2xhc3M9IiR7bm9Db3Vyc2U/ImJhZCI6Imdvb2QifSI+JHtub0NvdXJzZX08L3RkPjwvdHI+CiA8dHI+PHRkPuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBn+ODrOODvOOCuTwvdGQ+PHRkPiR7bk9kZHN977yPJHtycy5sZW5ndGh977yI6KSH5Yud44Gu5a6f44Kq44OD44K6ICR7cFJlYWx944Os44O844K577yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjppqzvvIk8L3RkPjx0ZD4ke2htYXRjaH3vvI8ke2hvcnNlc33poK3vvIgy6LWw5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7pgY7ljrvjg4fjg7zjgr/jgajjga7nhaflkIjvvIjpqI7miYvvvIk8L3RkPjx0ZD4ke2ptYXRjaH3vvI8ke2hvcnNlc33poK3vvIg16aiO5LmX5Lul5LiK77yJPC90ZD48L3RyPgogPHRyPjx0ZD7lrabnv5Ljg4fjg7zjgr/jga7mnIDntYLml6U8L3RkPjx0ZD4ke2VzYyhXSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5sYXN0fHwiLSIpfTwvdGQ+PC90cj48L3Rib2R5PjwvdGFibGU+YDsKIHtjb25zdCBjcz1XSy5kYXRlcy5mbGF0TWFwKGQ9PldLLmNhcmRzW2RdfHxbXSksZ2s9Y3MuZmlsdGVyKGM9PmdvaW5nQ29kZShjLmdvaW5nKT4wKS5sZW5ndGgsaHM9Y3MuZmxhdE1hcChjPT5jLmhvcnNlc3x8W10pLHNrPWhzLmZpbHRlcih4PT54LnNpcmV8fHguZGFtU2lyZSkubGVuZ3RoOwogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+6aas5aC054q25oWL77yaJHtna30vJHtjcy5sZW5ndGh944Os44O844K544Gn55m66KGo5riI44G/JHtnaz8iIjoi77yI5b2T5pel44Gu5pyd44Gr55m66KGo44GV44KM44G+44GZ44CC5pyq55m66KGo44Gu44Go44GN44Gv44CB6aas5aC044Gu55u45oCn44Gv5L2/44GE44G+44Gb44KT77yJIn3vvI/ooYDntbHjgpLoqq3jgoHjgZ/ppqzvvJoke3NrfS8ke2hzLmxlbmd0aH3poK3vvIjok4TnqY3jgZfjgZ/ooYDntbEgJHtPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH3poK3vvIkke2hzLmxlbmd0aCYmIXNrPyLjgILlh7rppqzooajjgYvjgonooYDntbHjgpLoqq3jgoHjgabjgYTjgb7jgZvjgpPvvIjoqK3lrprjga7jgIzoqLrmlq3mg4XloLHjgpLkvZzjgovjgI3jga7lh7rlipvjgafjgIHlrp/pmpvjga7jg5rjg7zjgrjjga7lvaLjgpLnorroqo3jgafjgY3jgb7jgZnvvIkiOiIifTwvZGl2PmB9CiBjb25zdCBzY3I9cnMuZmlsdGVyKHI9PnIuc2NyYXRjaGVkJiZyLnNjcmF0Y2hlZC5sZW5ndGgpLGptcD1hbGxSYWNlcygpLmZpbHRlcihyPT5yLnNraXAmJi/pmpzlrrMvLnRlc3Qoci5za2lwKSk7CiBpZihzY3IubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBrueEoeOBhOmmrOOCkuWPlua2iOODu+mZpOWkluOBqOOBv+OBquOBl+OBpuWkluOBl+OBn+ODrOODvOOCue+8miR7c2NyLm1hcChyPT5lc2Moci5sYWJlbCkrIu+8iCIrci5zY3JhdGNoZWQuam9pbigiLCIpKyLnlarvvIkiKS5qb2luKCLvvI8iKX3jgILlrp/pmpvjgavlh7rotbDjgZnjgovppqzjgarjgonjgIHjgqrjg4Pjgrrjga7lj5blvpfmvI/jgozjgafjgZnjgII8L2Rpdj5gOwogaWYoam1wLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPumanOWus+ODrOODvOOCuSAke2ptcC5sZW5ndGh95Lu244Gv44CB5bmz5Zyw55So44Gu44Oi44OH44Or44Gu44Gf44KB6Kej5p6Q44Gu5a++6LGh5aSW44Gr44GX44Gm44GE44G+44GZ44CCPC9kaXY+YDsKIGNvbnN0IGdhcD1XSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5sYXN0JiZXSy5kYXRlc1swXT9NYXRoLnJvdW5kKChuZXcgRGF0ZShXSy5kYXRlc1swXSktbmV3IERhdGUoV0suc3RvcmVJbmZvLmxhc3QpKS84NjRlNSk6bnVsbDsKIGlmKGdhcCE9bnVsbCYmZ2FwPjEwKWgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuacgOaWsOOBruaIkOe4vuOBjCR7Z2FwfeaXpeWIhuWFpeOBo+OBpuOBhOOBvuOBm+OCk+OAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgYvjgonjgIHjgoLjgYbkuIDluqbkuojmg7PjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogaWYocnMubGVuZ3RoJiZobWF0Y2g8aG9yc2VzKi40KWgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBp+OBjeOBn+mmrOOBjOWwkeOBquOCgeOBp+OBmeOAguiLpemnkuaIpuS4reW/g+OBruaXpeOBr+ato+W4uOOBp+OBmeOBjOOAgeOBneOBhuOBp+OBquOBkeOCjOOBsOmmrOWQjeOBruihqOiomOOBjOWQiOOBo+OBpuOBhOOBquOBhOWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAgjwvZGl2Pic7CiBjb25zdCBvbj1XSy5vZGRzTm90ZXN8fHt9OwogaWYoT2JqZWN0LmtleXMob24pLmxlbmd0aCl7aCs9YDxoMz7jgqrjg4Pjgrrlj5blvpfjga7lhoXoqLM8L2gzPjxkaXYgY2xhc3M9InN0YXR1cyI+JHtXSy5kYXRlcy5tYXAoZD0+YCR7ZGF5TGFiZWwoZCl9XG4keyhvbltkXXx8W10pLm1hcChlc2MpLmpvaW4oIlxuIil9YCkuam9pbigiXG5cbiIpfTwvZGl2PmB9CiBoKz1gPGgzPumWi+WCrOWgtOOBlOOBqDwvaDM+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPumWi+WCrOWgtDwvdGg+PHRoPuODrOODvOOCuTwvdGg+PHRoPueKtuaFizwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHggb2YgV0suZGlhZyl7CiAgY29uc3QgcHJvYnM9W107aWYoeC5lcnIpcHJvYnMucHVzaCh4LmVycik7aWYoeC5iYWQpcHJvYnMucHVzaChg5Ye66LWw6aas44KS6Kqt44KB44Gq44GE44Os44O844K5ICR7eC5iYWR9YCk7cHJvYnMucHVzaCguLi4oeC5pc3N1ZXN8fFtdKSk7CiAgaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoeC5kKSl9ICR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHt4Lm9rfS8ke3gucmFjZXN9PC90ZD48dGQgc3R5bGU9InRleHQtYWxpZ246bGVmdCI+JHtwcm9icy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJiYWQgc21hbGwiPiR7cHJvYnMubWFwKGVzYykuam9pbigiPGJyPiIpfTwvc3Bhbj5gOic8c3BhbiBjbGFzcz0iZ29vZCI+5ZWP6aGM44Gq44GXPC9zcGFuPid9JHt4LmNvZGU/YCA8YnV0dG9uIGNsYXNzPSJtaW5pIHN1YiIgZGF0YS1ybD0iJHtlc2MoeC5kKX18JHtlc2MoeC5jb2RlKX18JHtlc2MoeC5uYW1lKX0iPuWGjeWPluW+lzwvYnV0dG9uPmA6IiJ9PC90ZD48L3RyPmA7CiB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBlbC5pbm5lckhUTUw9aDsKIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXJsXSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPWFzeW5jKCk9PnsKICBjb25zdCBbZCxjb2RlLG5hbWVdPWIuZGF0YXNldC5ybC5zcGxpdCgifCIpO2IuZGlzYWJsZWQ9dHJ1ZTt3a01zZyhgJHtkfSAke25hbWV9IOOCkuWGjeWPluW+l+S4reKApmApOwogIHRyeXthd2FpdCBsb2FkVmVudWVJbnRvKGJhc2VVcmwoKSxkLHt2ZW51ZUNvZGU6Y29kZSx2ZW51ZU5hbWU6bmFtZX0pO2F3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZVVybCgpLGQpO2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCk7d2tNc2coIuWGjeWPluW+l+OBl+OBvuOBl+OBnyIpfQogIGNhdGNoKGUpe3drTXNnKCLlho3lj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiB9KTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaTjeS9nAogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmZ1bmN0aW9uIHNob3dUYWIodCl7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiLnZpZXciKS5mb3JFYWNoKHY9PnYuY2xhc3NMaXN0LnRvZ2dsZSgib24iLHYuaWQ9PT10KSk7ZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLmNsYXNzTGlzdC50b2dnbGUoIm9uIixiLmRhdGFzZXQudGFiPT09dCkpfQpkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjdGFicyBidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+c2hvd1RhYihiLmRhdGFzZXQudGFiKSk7CiQoInVwUnVuIikub25jbGljaz1hc3luYygpPT57CiAkKCJ1cFJ1biIpLmRpc2FibGVkPXRydWU7JCgidXBPdXQiKS50ZXh0Q29udGVudD0i5qSc6Ki85Lit4oCm77yI5pWw5YiG44GL44GL44KK44G+44GZ77yJIjsKIHRyeXsKICBjb25zdCByPWF3YWl0IHJ1blVwc2V0Rml0KHtzdGFydDokKCJ1cFN0YXJ0IikudmFsdWV8fCIyMDIxLTAxLTAxIn0pOwogICQoInVwT3V0IikuaW5uZXJIVE1MPXVwc2V0UmVwb3J0KHIpOwogIGlmKHIubW9kZWwpe2xvY2FsU3RvcmFnZS5zZXRJdGVtKFVQS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtpZihXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9fQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInVwT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJ1cFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJ1cENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oVVBLRVkpOyQoInVwT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luODouODh+ODq+OBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoInBsUnVuIikub25jbGljaz1hc3luYygpPT57CiAkKCJwbFJ1biIpLmRpc2FibGVkPXRydWU7JCgicGxPdXQiKS50ZXh0Q29udGVudD0i5qSc6Ki85Lit4oCm77yI5pWw5YiG44GL44GL44KK44G+44GZ77yJIjsKIHRyeXsKICBjb25zdCByPWF3YWl0IHJ1blBsYWNlRml0KHtzdGFydDokKCJwbFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIn0pOwogICQoInBsT3V0IikuaW5uZXJIVE1MPXBsYWNlUmVwb3J0KHIpOwogIGlmKHIubW9kZWwpbG9jYWxTdG9yYWdlLnNldEl0ZW0oUExLRVksSlNPTi5zdHJpbmdpZnkoci5tb2RlbCkpO2Vsc2UgaWYoIXIuZXJyb3IpbG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oUExLRVkpOwogIGlmKCFyLmVycm9yJiZXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgicGxPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJiYWQiPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5eyQoInBsUnVuIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CiQoInBsQ2xlYXIiKS5vbmNsaWNrPWFzeW5jKCk9Pntsb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShQTEtFWSk7JCgicGxPdXQiKS50ZXh0Q29udGVudD0i5qiZ5rqW44Gr5oi744GX44G+44GX44Gf44CCIjtpZihXSy5kYXRlcy5sZW5ndGgpe2F3YWl0IGNhbGNXZWVrZW5kKCk7cmVuZGVyQWxsKCl9fTsKJCgid2tHbyIpLm9uY2xpY2s9d2Vla2VuZEdvOwokKCJ3a09kZHMiKS5vbmNsaWNrPW9kZHNPbmx5OwokKCJia09uZSIpLm9uY2xpY2s9YXN5bmMoKT0+ewogaWYoQksuYnVzeSlyZXR1cm47CiBpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7CiAgY29uc3QgcD1wcm9tcHQoIuODkOODg+OCr+OCouODg+ODl+eUqOOBruODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvInjgpLmsbrjgoHjgablhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgILlvqnlhYPjga7jgajjgY3jgavjgoLlkIzjgZjjgoLjga7jgYzlv4XopoHjgafjgZnjgIIiKTsKICBpZighcClyZXR1cm47QksucGFzcz1wLnRyaW0oKTtCSy5pZD0iIjtia1NhdmVTZXR0aW5ncygpOyQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7CiAgaWYoQksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOBrzjmloflrZfku6XkuIrjgavjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybn0KIH0KIGF3YWl0IHJ1bkJhY2t1cChmYWxzZSk7Cn07CiQoImRiZ0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgiZGJnT3V0IiksYmFzZT1iYXNlVXJsKCk7CiBpZighV0suZGF0ZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KIG91dC52YWx1ZT0i6Ki65pat5Lit4oCmIjskKCJkYmdHbyIpLmRpc2FibGVkPXRydWU7Y29uc3QgbGluZXM9W2Dlj5blvpfml6UgJHtXSy5kYXRlcy5qb2luKCIsIil9YF07CiB0cnl7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogICBjb25zdCBjb2Rlcz1bLi4ubmV3IFNldCgoV0suY2FyZHNbZF18fFtdKS5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICAgZm9yKGNvbnN0IHYgb2YgY29kZXMpewogICAgY29uc3QgcnM9V0suY2FyZHNbZF0uZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpOwogICAgY29uc3QgcT1ycy5tYXAocj0+ci5xdWFsaXR5KS5maWx0ZXIoQm9vbGVhbik7CiAgICBsaW5lcy5wdXNoKGBcbuKWoCR7ZH0g6ZaL5YKs5aC0JHt2fe+8iCR7cnNbMF0/LnZlbnVlTmFtZXx8IiJ977yJ44Os44O844K5JHtycy5sZW5ndGh977yP44Kz44O844K55LiN5piOJHtycy5maWx0ZXIocj0+IShyLnN1cmZhY2UmJnIuZGlzdGFuY2UpKS5sZW5ndGh977yP6aiO5omL5qygJHtxLnJlZHVjZSgocyx4KT0+cysoeC5ob3JzZXMteC5qb2NrZXlGaWxsZWQpLDApfe+8j+iqv+aVmeW4q+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXgudHJhaW5lckZpbGxlZCksMCl9YCk7CiAgICBjb25zdCBiYWQ9cnMuZmluZChyPT5yLnF1YWxpdHkmJiFyLnF1YWxpdHkub2spfHxyc1swXSxybj0oYmFkJiZiYWQucmFjZU51bWJlcil8fDE7bGluZXMucHVzaChg77yI5ZWP6aGM44Gu44GC44KL44Os44O844K5ICR7cm59UiDjgpLoqr/jgbnjgb7jgZnvvIlgKTt0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vZGVidWctZW50cnk/ZGF0ZT0ke2R9JnZlbnVlPSR7dn0mcmFjZT0ke3JufWAsWzE1MDBdKTtkZWxldGUgeC5vaztsaW5lcy5wdXNoKEpTT04uc3RyaW5naWZ5KHgpKX1jYXRjaChlKXtsaW5lcy5wdXNoKCLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJkYmdHbyIpLmRpc2FibGVkPWZhbHNlfQogb3V0LnZhbHVlPWxpbmVzLmpvaW4oIlxuIik7Cn07CiQoIm9kZHNEYmciKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IG91dD0kKCJvZGRzT3V0IiksYmFzZT1iYXNlVXJsKCk7CiBpZighV0suZGF0ZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWFiOOBq+OAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KIG91dC52YWx1ZT0i6Ki65pat5Lit4oCmIjskKCJvZGRzRGJnIikuZGlzYWJsZWQ9dHJ1ZTsKIGNvbnN0IEw9W2DmmYLliLsgJHtuZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTYpLnJlcGxhY2UoIlQiLCIgIil977yI5pel5pys5pmC6ZaT77yJYF07CiB0cnl7CiAgZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogICBjb25zdCBjcz1XSy5jYXJkc1tkXXx8W10sdnM9Wy4uLm5ldyBTZXQoY3MubWFwKGM9PlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIHZzKXsKICAgIGNvbnN0IHJzPWNzLmZpbHRlcihjPT5TdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IGdvdD1ycy5maWx0ZXIoYz0+V0sub2Rkc1tya2V5KGQsYyldKS5tYXAoYz0+Yy5yYWNlTnVtYmVyKS5qb2luKCIsIiksbGluaz1ycy5maWx0ZXIoYz0+Yy5vZGRzQ25hbWUpLm1hcChjPT5jLnJhY2VOdW1iZXIpLmpvaW4oIiwiKTsKICAgIEwucHVzaChgXG7ilqAke2R9ICR7VkVOVUVbdl18fHZ977ya44Os44O844K5JHtycy5sZW5ndGh977yP5Ye66aas6KGo44Gr44Kq44OD44K644G444Gu44Oq44Oz44Kv44GC44KKIFske2xpbmt8fCLjgarjgZcifV3vvI/jgqrjg4Pjgrrlj5blvpfmuIjjgb8gWyR7Z290fHwi44Gq44GXIn1dYCk7CiAgICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHMtbGlua3M/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICAgTC5wdXNoKGAgIOOCquODg+OCuueUu+mdouOBruODoeODi+ODpeODvOOBq+OBguOCi+ODrOODvOOCuSBbJHsoeC5saW5rc3x8W10pLm1hcCh5PT55LnJhY2VObykuam9pbigiLCIpfHwi44Gq44GXIn1dYCk7CiAgICAgZm9yKGNvbnN0IGcgb2YgKHguZGlhZ3x8W10pKUwucHVzaCgiICAiK0pTT04uc3RyaW5naWZ5KHtzdGVwOmcuc3RlcCxsZW46Zy5odG1sTGVuZ3RoLG46Zy5jbmFtZXMsa2luZHM6Zy5raW5kcyxtZW51czpnLm1lbnVzLHJhY2VzOmcucmFjZXMsZXJyOmcuZXJyb3Isc2FtcGxlOihnLnNhbXBsZXx8W10pLnNsaWNlKDAsMyl9KSk7CiAgICB9Y2F0Y2goZSl7TC5wdXNoKCIgIOODoeODi+ODpeODvOWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KICAgfQogIH0KIH1maW5hbGx5eyQoIm9kZHNEYmciKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1MLmpvaW4oIlxuIik7Cn07CiQoIm9kZHNDb3B5Iikub25jbGljaz1hc3luYygpPT57Y29uc3QgdD0kKCJvZGRzT3V0IikudmFsdWU7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpOyQoIm9kZHNDb3B5IikudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7JCgib2Rkc091dCIpLnNlbGVjdCgpO2FsZXJ0KCLpgbjmip7jgZfjgb7jgZfjgZ/jgILjgrPjg5Tjg7zjgZfjgabjgY/jgaDjgZXjgYTjgIIiKX19OwokKCJkYmdDb3B5Iikub25jbGljaz1hc3luYygpPT57Y29uc3QgdD0kKCJkYmdPdXQiKS52YWx1ZTt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCk7JCgiZGJnQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoImRiZ091dCIpLnNlbGVjdCgpO2FsZXJ0KCLpgbjmip7jgZfjgb7jgZfjgZ/jgILjgrPjg5Tjg7zjgZfjgabjgY/jgaDjgZXjgYTjgIIiKX19OwokKCJmaWxlIikub25jaGFuZ2U9ZT0+e2NvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoZilpbXBvcnRGaWxlKGYpO2UudGFyZ2V0LnZhbHVlPSIifTsKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfvvIjlj5blvpfmuIjjgb/jga7ml6XjgpLjgIHmlrDjgZfjgYTpoIXnm67jgaTjgY3jgaflj5bjgornm7TjgZnvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwphc3luYyBmdW5jdGlvbiBsYXBSZWZldGNoKGRlcHMpewogY29uc3QgRD1PYmplY3QuYXNzaWduKHtpZGJBbGwsaWRiUHV0LG1ldGFHZXQsbWV0YVB1dCxmZXRjaERheX0sZGVwc3x8e30pOwogY29uc3QgYmFzZT1iYXNlVXJsKCksYT0kKCJsYXBTdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCksbXNnPXQ9PnskKCJsYXBTdGF0dXMiKS5pbm5lckhUTUw9dH07CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgibGFwR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsbGFwczowLGNvcm5lcnM6MCxob3JzZXM6MCxmYWlsOltdLHNraXBwZWQ6MCx0MDpEYXRlLm5vdygpLG5vZGF0YTpmYWxzZSxzdG9wcGVkOmZhbHNlfTtsZXQgY29uc2VjPTAsdG90YWw9MDsKIHRyeXsKICBjb25zdCBmaWxlcz0oYXdhaXQgRC5pZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCYmZi5kYXRlPj1hJiZmLmRhdGU8PXlkKS5zb3J0KCh4LHkpPT54LmRhdGU8eS5kYXRlPy0xOjEpOwogIGNvbnN0IHRvZG89W107CiAgZm9yKGNvbnN0IGYgb2YgZmlsZXMpe2lmKGYucm93cy5zb21lKHI9PkFycmF5LmlzQXJyYXkoci5sYXApJiZyLmxhcC5sZW5ndGgpfHxhd2FpdCBELm1ldGFHZXQoImxhcGRvbmU6IitmLmRhdGUpKXtzdC5za2lwcGVkKys7Y29udGludWV9dG9kby5wdXNoKGYuZGF0ZSl9CiAgdG90YWw9dG9kby5sZW5ndGg7CiAgaWYoIXRvdGFsKXttc2coYOWPluOCiuebtOOBmeaXpeOBr+OBguOCiuOBvuOBm+OCk++8iCR7YX3ku6XpmY3jga4ke2ZpbGVzLmxlbmd0aH3ml6Xjga/jgIHjgZnjgbnjgabjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jgaTjgY3jgafjgZnvvInjgIJgKTtyZXR1cm59CiAgZm9yKGxldCBpPTA7aTx0b2RvLmxlbmd0aDtpKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBkPXRvZG9baV0sZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgIG1zZyhgJHtkfe+8iCR7aSsxfS8ke3RvdGFsfeaXpe+8ieOCkuWPluW+l+S4reKAplxu5Y+W44KK55u044GXJHtzdC5kYXlzfeaXpe+8j+ODqeODg+ODl+OCkuiqreOCgeOBn+ODrOODvOOCuSAke3N0LmxhcHN9LyR7c3QucmFjZXN977yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYCk7CiAgIHRyeXsKICAgIGNvbnN0IHI9YXdhaXQgRC5mZXRjaERheShiYXNlLGQpOwogICAgaWYoci5mYWlsZWROKXtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgY29uc3Qgcmlkcz1uZXcgU2V0KHIucm93cy5tYXAoeD0+eC5yYWNlSWQpKSxsYXBSYWNlcz1uZXcgU2V0KHIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aCkubWFwKHg9PngucmFjZUlkKSk7CiAgICBjb25zdCBjb3JuZXJIb3JzZXM9ci5yb3dzLmZpbHRlcih4PT5BcnJheS5pc0FycmF5KHguY29ybmVyKSYmeC5jb3JuZXIubGVuZ3RoPj0yKS5sZW5ndGg7CiAgICBhd2FpdCBELmlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pOwogICAgaWYobGFwUmFjZXMuc2l6ZXx8Y29ybmVySG9yc2VzKWF3YWl0IEQubWV0YVB1dCgibGFwZG9uZToiK2QsdHJ1ZSk7CiAgICBzdC5kYXlzKys7c3QucmFjZXMrPXJpZHMuc2l6ZTtzdC5sYXBzKz1sYXBSYWNlcy5zaXplO3N0LmNvcm5lcnMrPWNvcm5lckhvcnNlcztzdC5ob3JzZXMrPXIucm93cy5sZW5ndGg7Y29uc2VjPTA7CiAgICBpZihzdC5kYXlzPj0yJiZzdC5sYXBzPT09MCYmc3QuY29ybmVycz09PTApe3N0Lm5vZGF0YT10cnVlO1NTVE9QPXRydWV9CiAgIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICBhd2FpdCBzbGVlcCg0MDApOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoImxhcEdvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogIGNvbnN0IHJhdGU9KHgseSk9Pnk/TWF0aC5yb3VuZCh4L3kqMTAwKSsiJSI6Ii0iOwogIGxldCBoPWAke3N0Lm5vZGF0YT8nPHNwYW4gY2xhc3M9ImJhZCI+44Op44OD44OX44KC6YCa6YGO6aCG5L2N44KC6Kqt44KB44G+44Gb44KT44Gn44GX44Gf44CC5Lit5pat44GX44G+44GX44Gf44CCPC9zcGFuPlxu44CM6Kqt44G/5Y+W44KK44Gu6Ki65pat44CN44KS5oq844GX44CB5Ye644Gf5paH56ug44KS6LK844Gj44Gm44GP44Gg44GV44GE44CCXG4nOihzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/jgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgIHjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6KFNTVE9QPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOiLlrozkuobjgIIiKSl9YDsKICBoKz1g5Y+W44KK55u044GXICR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlcbuODqeODg+ODl+OCkuiqreOCgeOBn+ODrOODvOOCue+8miR7c3QubGFwcy50b0xvY2FsZVN0cmluZygpfS8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl977yIJHtyYXRlKHN0LmxhcHMsc3QucmFjZXMpfe+8iVxu6YCa6YGO6aCG5L2N44KS6Kqt44KB44Gf6aas77yaJHtzdC5jb3JuZXJzLnRvTG9jYWxlU3RyaW5nKCl9LyR7c3QuaG9yc2VzLnRvTG9jYWxlU3RyaW5nKCl977yIJHtyYXRlKHN0LmNvcm5lcnMsc3QuaG9yc2VzKX3vvIlgOwogIGlmKHN0LmZhaWwubGVuZ3RoKWgrPWBcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ977yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5q6L44KK44Gg44GR57aa44GN44GL44KJ77yJPC9zcGFuPmA7CiAgbXNnKGgpO3RyeXthd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCl9Y2F0Y2goZSl7fQogfQogcmV0dXJuIHN0Owp9CiQoImxhcEdvIikub25jbGljaz0oKT0+bGFwUmVmZXRjaCgpOwokKCJsYXBEYmciKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IG91dD0kKCJsYXBPdXQiKTtvdXQudmFsdWU9IuiouuaWreS4reKApiI7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IGlkYkFsbCgpKS5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5zb3J0KCh4LHkpPT54LmRhdGU8eS5kYXRlPy0xOjEpOwogIGlmKCFmaWxlcy5sZW5ndGgpe291dC52YWx1ZT0i5Y+W5b6X5riI44G/44Gu5oiQ57i+44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiI7cmV0dXJufQogIGNvbnN0IGQ9ZmlsZXNbZmlsZXMubGVuZ3RoLTFdLmRhdGUsZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlVXJsKCl9L2pyYS1kYXk/ZGF0ZT0ke2R9YCkscmFjZXM9ZGF5LnJhY2VzfHxbXTsKICBjb25zdCByPXJhY2VzLmZpbmQoeD0+eC5yYWNlTm89PT0xMSl8fHJhY2VzWzBdOwogIGlmKCFyKXtvdXQudmFsdWU9YCR7ZH0g44Gu44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTYDtyZXR1cm59CiAgY29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9kZWJ1Zy1yZXN1bHQ/Y25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQoci5jbmFtZSl9YCk7ZGVsZXRlIHgub2s7CiAgb3V0LnZhbHVlPWDml6Xku5ggJHtkfSDplovlgqzloLQke3IudmVudWVDb2RlfSAke3IucmFjZU5vfVJcbmArSlNPTi5zdHJpbmdpZnkoeCk7CiB9Y2F0Y2goZSl7b3V0LnZhbHVlPSLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KfTsKCmlmKC9eaHR0cHM/Oi8udGVzdChsb2NhdGlvbi5wcm90b2NvbCkpJCgid3VybCIpLnZhbHVlPWxvY2F0aW9uLm9yaWdpbjtlbHNlICQoInd1cmwiKS52YWx1ZT0iaHR0cHM6Ly9rZWliYS1haS1wYXlvdXRzLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiOwpyZW5kZXJHYXRlKCk7cmVuZGVyQWxsKCk7Cihhc3luYygpPT57dHJ5e2F3YWl0IG9wZW5EQigpO2F3YWl0IHBlZGlncmVlTG9hZCgpO2F3YWl0IHNob3dTdGF0ZSgpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKCjwvc2NyaXB0Pgo8L2JvZHk+PC9odG1sPgo=";
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
