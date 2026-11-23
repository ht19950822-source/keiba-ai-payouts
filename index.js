/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-21-rebuild-20";

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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGJ1dHRvbiBpZD0iYWxsR28iIGNsYXNzPSJiaWciIHN0eWxlPSJiYWNrZ3JvdW5kOiMxMzczMzMiPuKRoyDjgZzjgpPjgbbjgYrjgb7jgYvjgZvvvIjikaHihpLikaDihpLikaLjgpLpoIbnlarjgavlrp/ooYzvvIk8L2J1dHRvbj4KIDxkaXYgaWQ9ImFsbFN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5q+O6YCx44Gu5pu05paw44KSMeWbnuOBp+ihjOOBhOOBvuOBme+8mumBjuWOu+ODrOODvOOCueOBruabtOaWsCDihpIg5LuK6YCx5pyr44Gu5Y+W5b6X44Go5LqI5oOzIOKGkiDjg5Djg4Pjgq/jgqLjg4Pjg5fvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroqK3lrprmuIjjgb/jga7loLTlkIjvvInjgII8L2Rpdj4KIDxkaXYgaWQ9ImJrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KIDxkaXYgaWQ9ImRhdGFTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8L2Rpdj4KCjxkaXYgY2xhc3M9InRhYnMiIGlkPSJ0YWJzIj4KIDxidXR0b24gZGF0YS10YWI9InZBeGlzIiBjbGFzcz0ib24iPui2hemJhOadvzwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idkV2Ij7mnJ/lvoXlgKQ8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZVcHNldCI+5rOi5Lmx5bqmPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2SG9sZSI+56m06aasPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2UmFjZXMiPuWFqOODrOODvOOCuTwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlN1bSI+5Y+W44KK6L6844G/54q25rOBPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2VGVzdCI+5qSc6Ki8PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U2V0Ij7oqK3lrpo8L2J1dHRvbj4KPC9kaXY+Cgo8ZGl2IGlkPSJnYXRlIj48L2Rpdj4KCjxkaXYgaWQ9InZBeGlzIiBjbGFzcz0idmlldyBvbiBjYXJkIj48ZGl2IGNsYXNzPSJzbWFsbCI+44CM5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCPC9kaXY+PC9kaXY+CjxkaXYgaWQ9InZFdiIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZVcHNldCIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZIb2xlIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlJhY2VzIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlN1bSIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+Cgo8ZGl2IGlkPSJ2VGVzdCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44Oi44OH44Or44Gu54q25oWLPC9oMj4KIDxkaXYgaWQ9Im1zdGF0IiBjbGFzcz0id3JhcCI+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImFsbEZpdCIgY2xhc3M9InN1YiI+5qSc6Ki844KS44G+44Go44KB44Gm5a6f6KGM77yI5aW96LWw546H4oaS5rOi5Lmx5bqm4oaS5Zue5Y+O546H77yJPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJhbGxGaXRTdGF0dXMiIGNsYXNzPSJzbWFsbCI+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5Zue5Y+O546H44Gu5qSc6Ki877yI5omV5oi744Gk44GN44O75pmC57O75YiX77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHjgIzjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHjgI3jgpLkvb/jgYbjg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnvvIjlkITjg6zjg7zjgrkxMDDlhobvvInjgILjgZPjgZPjgac8Yj7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjga7lm57lj47njofjgYwxMDAl44KS6LaF44GI44CB6Kqk5beu44Gu5bmF44KS5byV44GE44Gm44KCMTAwJeS7peS4ijwvYj7jgajnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjgaDjgZHjgYzjgIHnlLvpnaLkuIrjgafjgIzmpJzoqLzmuIjjgb/jgI3jgavjgarjgorjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0iYnRTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPjxidXR0b24gaWQ9ImJ0UnVuIj7mpJzoqLzjgpLlrp/ooYw8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYnRHcmFkZSIgY2xhc3M9InN1YiI+6YeN6LOe44Gg44GR77ya44Kw44Os44O844OJ6KOc5q2j44GC44KKL+OBquOBl+OCkuavlOi8gzwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuazouS5seW6puOBruS/oemgvOW6puOCkuS4iuOBkuOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB5rOi5Lmx5bqm44Gu5LqI5ris44Go5a6f6Zqb44Gu5rOi5Lmx546H44KS56qB44GN5ZCI44KP44Gb44G+44GZ44CC44Kz44O844K55Yil77yI6ZaL5YKs5aC0w5foip3jg4DDl+i3nembosOX44Kv44Op44K577yJ44Gu6YGO5Y675rOi5Lmx546H44KS6Laz44GX44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+avlOOBueOBpuOAgeaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OBvuOBmeOAguiJr+OBj+OBquOCieOBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBp+OAgeetiee0muOBlOOBqOOBruWun+e4vueOh+OBoOOBkeOCkuaknOiovOOBl+OBn+aVsOWtl+OBq+W3ruOBl+abv+OBiOOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJ1cFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMS0wMS0wMSI+PGJ1dHRvbiBpZD0idXBSdW4iPuazouS5seW6puOCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InVwQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0idXBPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOCkuato+eiuuOBq+OBmeOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOCj+OBm+OBvuOBmeOAgumBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+eiuueOh+OBqOOAgeS6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgTxiPuePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWkzwvYj7jgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILmmI7norrjgavoia/jgYTjgajjgY3jgaDjgZHmjqHnlKjjgZfjgIHotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7ln7rmupbjgoLjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+5qSc6Ki844Gu6ZaL5aeL5pelIDxpbnB1dCBpZD0icGxTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMTktMDEtMDEiPjxidXR0b24gaWQ9InBsUnVuIj7lpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraM8L2J1dHRvbj48YnV0dG9uIGlkPSJwbENsZWFyIiBjbGFzcz0ic3ViIj7mqJnmupbjgavmiLvjgZk8L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9InBsT3V0IiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzvvIjpgY7ljrvjg6zjg7zjgrnjga7lj5blvpflvozjgavlrp/ooYzjgILmlbDliIbjgYvjgYvjgorjgb7jgZnvvIk8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0icGF5RXhwIiBjbGFzcz0ic3ViIj7miZXmiLvjgpLmm7jjgY3lh7rjgZc8L2J1dHRvbj48bGFiZWwgY2xhc3M9InNtYWxsIj7oqq3jgb/ovrzjgb8gPGlucHV0IGlkPSJwYXlJbXAiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24iPjwvbGFiZWw+PC9kaXY+CiA8ZGl2IGlkPSJidE91dCIgY2xhc3M9InN0YXR1cyI+44OH44O844K/5Y+W5b6X44Gu44GC44Go44Gn5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjwvZGl2PgoKPGRpdiBpZD0idlNldCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44OQ44OD44Kv44Ki44OD44OX6Kit5a6a77yIQ2xvdWRmbGFyZeOBq+S/neWtmO+8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+44OR44K544OV44Os44O844K644GuU0hBLTI1NuOBoOOBkeOCkuS9v+OBo+OBpuS/neWtmOWFiOOCkuWIhuOBkeOBvuOBme+8iOODkeOCueODleODrOODvOOCuuiHquS9k+OBr+mAgeOCiuOBvuOBm+OCk++8ieOAguWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+W+qeWFg+OBp+OBjeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9ImJrUGFzcyIgdHlwZT0icGFzc3dvcmQiIHBsYWNlaG9sZGVyPSLjg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJIiBhdXRvY29tcGxldGU9Im9mZiIgc3R5bGU9ImZsZXg6MTttaW4td2lkdGg6MjAwcHgiPjxidXR0b24gaWQ9ImJrU2hvdyIgY2xhc3M9InN1YiI+6KGo56S6PC9idXR0b24+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxsYWJlbD48aW5wdXQgaWQ9ImJrQXV0byIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOWkieabtOOBjOOBguOCjOOBsOiHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBmeOCizwvbGFiZWw+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJrTm93Ij7ku4rjgZnjgZDlt67liIbjg5Djg4Pjgq/jgqLjg4Pjg5c8L2J1dHRvbj48YnV0dG9uIGlkPSJia1Jlc3RvcmUiIGNsYXNzPSJzdWIiPuODkOODg+OCr+OCouODg+ODl+OBi+OCieW+qeWFgzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrRnVsbCIgY2xhc3M9InN1YiI+44GZ44G544Gm5L+d5a2Y44GX55u044GZPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6YGO5Y6744OH44O844K/44Gu6Kqt44G/6L6844G/77yI5Lu75oSP77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7ku6XliY3jga7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yP5oiQ57i+Q1NW44GM44GC44KM44Gw6Kqt44G/6L6844KB44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44G+44Gb44KT77yJ44CCPC9kaXY+CiA8aW5wdXQgaWQ9ImZpbGUiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24sLmNzdixhcHBsaWNhdGlvbi9qc29uLHRleHQvY3N2Ij4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7oqLrmlq08L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWHuummrOihqOOBruiqreOBv+WPluOCiuOBq+WVj+mhjOOBjOOBguOCi+OBqOOBjeOAgemWi+WCrOWgtOOBlOOBqOOBqzFS44Gu44Oa44O844K444Gu5Lit6Lqr44KS6Kq/44G544Gm5LiL44Gr5Ye644GX44G+44GZ44CC44Kz44OU44O844GX44Gm6YCB44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImRiZ0dvIiBjbGFzcz0ic3ViIj7oqLrmlq3mg4XloLHjgpLkvZzjgos8L2J1dHRvbj48YnV0dG9uIGlkPSJkYmdDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0iZGJnT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTQwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+44Kq44OD44K644Gu6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgarjgYTjg6zjg7zjgrnjgYzjgYLjgovjgajjgY3jgIHjgIxKUkHjgYzjgb7jgaDnmbrlo7LjgZfjgabjgYTjgarjgYTjgI3jga7jgYvjgIzlj5blvpfjga7llY/poYzjgI3jgarjga7jgYvjgpLoqr/jgbnjgb7jgZnjgILlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB5oq844GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9Im9kZHNEYmciIGNsYXNzPSJzdWIiPuOCquODg+OCuuOBruiouuaWreOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ib2Rkc091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE2MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBlzwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu44Os44O844K544KS44CB44Os44O844K55YWo5L2T44Gu44Op44OD44OX77yI44OP44Ot44Oz44K/44Kk44Og77yJ44Go5ZCE6aas44Gu44Kz44O844OK44O86YCa6YGO6aCG5L2N44Gk44GN44Gn5Y+W44KK55u044GX44G+44GZ77yI44Oa44O844K544O76ISa6LOq44KS5LqI5oOz44Gr5L2/44GG44Gf44KB44Gu5rqW5YKZ77yJ44CC5L+d5a2Y5riI44G/44Gu5pel44Gv5LiK5pu444GN44GV44KM44G+44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CC44G+44Ga5paw44GX44GE5pyf6ZaT44GL44KJ5bCR44GX44Gg44GR6Kmm44GX44Gm44CB6Kqt44KB44Gm44GE44KL44GL44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImxhcFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyNi0wMS0wMSI+PGJ1dHRvbiBpZD0ibGFwR28iPuWPluOCiuebtOOBmTwvYnV0dG9uPjxidXR0b24gaWQ9ImxhcERiZyIgY2xhc3M9InN1YiI+6Kqt44G/5Y+W44KK44Gu6Ki65patPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJsYXBTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2PgogPHRleHRhcmVhIGlkPSJsYXBPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxMjBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kaXY+Cgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXY+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2PjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIC8qIOKYheOCsOODrOODvOODie+8iOagvO+8ie+8mjA95LiN5piOL+S4i+e0miAxPU9Q44O744Oq44K544OG44OD44OJIDI9RzMgMz1HMiA0PUcx44CCCiAgICDlvpPmnaXjga8gRzEvRzIvRzMvT1Ag44KS44GZ44G544Gm44CMNeOAjeOBq+a9sOOBl+OBpuOBhOOBn+OBn+OCgeOAgUcz5Yud44Gh44GMIEcxIOOBp+OCguWJsuW8leOBleOCjOOBquOBi+OBo+OBn+OAggogICAg5Yik5a6a6aCG77ya44Op44OZ44Or77yITkZLQ+W+jCBHSS9HSUkvR0lJSS9HMeOAnEcz77yJ4oaSIDHnnYDos57ph5HvvIjkuIflhobvvInihpLvvIjlr77osaHjg6zjg7zjgrnjga7jgb/vvIlHMeODrOODvOOCueWQjSAqLwogY29uc3QgRzFfTkFNRVM9L+Wkqeeah+iznnzmnInppqzoqJjlv7V844K444Oj44OR44Oz44Kr44OD44OXfOOCuOODo+ODkeODs++8o3zlrp3loZroqJjlv7V85a6J55Sw6KiY5b+1fOODtOOCo+OCr+ODiOODquOCouODnuOCpOODq3zlpKfpmKrmna986auY5p2+5a6u6KiY5b+1fOODleOCp+ODluODqeODquODvHzjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrp844K544OX44Oq44Oz44K/44O844K6fOODnuOCpOODq+ODgeODo+ODs+ODlOOCquODs+OCt+ODg+ODl3zjgqjjg6rjgrbjg5njgrnlpbPnjovmna9856eL6I+v6LOefOiPiuiKseiznnzmoZzoirHos55844Kq44O844Kv44K5fOWEqumnv+eJnemmrHzml6XmnKzjg4Djg7zjg5Pjg7x85p2x5Lqs5YSq6ae/fOeakOaciOiznnxOSEvjg57jgqTjg6t86Ziq56We44K444Ol44OZ44OK44Kk44OrfOacneaXpeadr3zjg5vjg7zjg5fjg5Xjg6svOwogY29uc3QgZ3JhZGVUaWVyPSh0ZXh0LHByaXplLGJ5TmFtZSk9Pntjb25zdCBzPVN0cmluZyh0ZXh0fHwiIikubm9ybWFsaXplKCJORktDIik7CiAgaWYoL+manOWus3zjgrjjg6Pjg7Pjg5d8SlwuP1xzP0cvaS50ZXN0KHMpKXJldHVybiAwOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUlJfDMpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAyOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUl8MikoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDM7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJfDEpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiA0OwogIGNvbnN0IHA9TnVtYmVyKHByaXplKTtpZihwPjApcmV0dXJuIHA+PTEwMDAwPzQ6cD49NTAwMD8zOnA+PTM1MDA/MjpwPj0xODAwPzE6MDsKICBpZihieU5hbWUmJkcxX05BTUVTLnRlc3QocykpcmV0dXJuIDQ7CiAgaWYoL+ODquOCueODhuODg+ODiXzjgqrjg7zjg5fjg7N877yv77ywfFxiT1BcYi8udGVzdChzKSlyZXR1cm4gMTsKICByZXR1cm4gMH07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGNvbnN0IGNsZWFuVHI9dD0+U3RyaW5nKHR8fCIiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsNn1b77yJKV0vZywiICIpLnJlcGxhY2UoLyg/Ouagl+adsXznvo7mtaZ85Zyw5pa5fOWkluWbvXzmi5vlvoUpXHMqW+ODu++9pV0/L2csIiAiKS5yZXBsYWNlKC9b44O7772lXS9nLCIgIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IudHJhaW5lcj1jbGVhblRyKG9bIuiqv+aVmeW4qyJdfHxvLnRyYWluZXJ8fCIiKTtjb25zdCBfZ3Q9U3RyaW5nKG9bIummrOWgtCJdfHxvWyLppqzloLTnirbmhYsiXXx8by5nb2luZ3x8by50cmFja19jb25kaXRpb258fCIiKTtfci5nYz0v5LiN6ImvfOeojXzph40vLnRlc3QoX2d0KT8yOi/oia8vLnRlc3QoX2d0KT8xOjA7X3IuZ3JkPWdyYWRlVGllcihTdHJpbmcob1siY2xhc3MiXXx8by5jbHN8fCIiKSsiICIrU3RyaW5nKG9bIuODrOODvOOCueWQjSJdfHxvLnJhY2VfbmFtZXx8by5yYWNlbmFtZXx8IiIpLG51bGwsZmFsc2UpO3JldHVybiBfcn0KIGZ1bmN0aW9uIHRvUm93MChvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICB7Y29uc3QgZG49ZG51bShyLmRhdGUpLGRzPWguZHN8fChoLmRzPW5ldyBTZXQoKSk7aWYoZHMuaGFzKGRuKSlyZXR1cm47ZHMuYWRkKGRuKX0gICAvLyDlkIzjgZjppqzjga/jgIHlkIzjgZjml6Xjgasx5Zue44GX44GL6LWw44KM44Gq44GE77yIQ1NW44Go5Y+W5b6X44OH44O844K/44Gu5LqM6YeN55m76Yyy44KS6Ziy44GQ77yJCiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBpZihyLmdjPjApe2NvbnN0IGdxPShoLmduPWguZ258fHt9KTtjb25zdCBnZz0oZ3Fbci5nY109Z3Fbci5nY118fFswLDBdKTtnZ1swXSsrO2dnWzFdKz10M30KICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTCxyLmdyZHx8MCxyLmNmPT1udWxsPy0xOnIuY2ZdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDimIXmoLzkuIrjgZLoo5zmraPvvJrlrabnv5LmuIjjgb/jg6Ljg4fjg6vjga/nnYDpoIbjgpLjgZ3jga7jgb7jgb7opovjgovjga7jgafjgIHkuIvkvY3jgrDjg6zjg7zjg4njgafjga7lpb3otbDjgYzph43os57jg7tHMeOBp+OCguWQjOS+oeWApOOBq+OBquOBo+OBpuOBhOOBn+OAggogICAg55u06L+RM+i1sOOBruOBhuOBoSBPUC/ph43os54o44Kv44Op44K5NSnjga7otbDjgavjgaTjgYTjgabjgIHku4rlm57jga7jgrDjg6zjg7zjg4njgajjga7lt67jgaDjgZHoo5zmraPjgZnjgovvvIjjgq/jg6njgrk05Lul5LiL44Gv44Oi44OH44Or5YG044Gu6KOc5q2j44GM44GC44KL44Gu44Gn5LqM6YeN5o6b44GR44GX44Gq44GE77yJ44CCCiAgICAgIOagvOS4iuOBku+8iOS+iyBHM+KGkkcx77yJ77ya5aW96LWw44Gu5L6h5YCk44KS5Ymy44KK5byV44GP77yI552A6aCG44GM6Imv44GE44G744Gp5aSn44GN44GP77yJCiAgICAgIOagvOS4i+OBku+8iOS+iyBHMeKGkkcy77yJ77ya5Yeh6LWw44Gu5L6h5YCk44KS5bCR44GX5oi744GZCiAgICDkv4LmlbDjga/mmqvlrprlgKTjgILikaAtMuOBruOAjOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g+OAjeOBp+OAgeijnOato+OBguOCii/jgarjgZfjgpLlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafmr5Tjgbnjgabnorroqo3jgZnjgovjgZPjgajjgIIgKi8KIGNvbnN0IEdSQURFPXtvbjp0cnVlLEtVUDouMzAsS0ROOi4xMixNSU46LS45LE1BWDouNX07CiBmdW5jdGlvbiBncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCl7CiAgaWYoIUdSQURFLm9ufHwoY29tcCYmY29tcC5ncmFkZT09PWZhbHNlKSlyZXR1cm4gMDsKICBjb25zdCBHdD1yYWNlLmdyZHx8MDtpZihHdDwyKXJldHVybiAwOwogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWh8fCFoLnJ1bnMubGVuZ3RoKXJldHVybiAwOwogIGNvbnN0IHJjPWgucnVucy5zbGljZSgtMyksVz1bWzFdLFsuNCwuNl0sWy4yLC4zLC41XV1bcmMubGVuZ3RoLTFdO2xldCBkPTA7CiAgcmMuZm9yRWFjaCgoeCxrKT0+e2NvbnN0IGZpbj14WzFdLEw9eFs0XXx8MCxHcj14WzVdfHwwO2lmKEwhPT01fHwhKGZpbj4wKSlyZXR1cm47CiAgIGNvbnN0IGdyPU1hdGgubWF4KEdyLDIpOyAgICAgICAgICAvLyBPUOODu+OCsOODrOODvOODieS4jeaYjuOBruOCr+ODqeOCuTXotbDjga8gRzMg55u45b2T44Go44GX44Gm5q+U6LyDCiAgIGlmKEd0PmdyJiZmaW48PTUpZC09V1trXSpHUkFERS5LVVAqKEd0LWdyKSooNi1maW4pLzY7CiAgIGVsc2UgaWYoR3Q8Z3ImJmZpbj49NClkKz1XW2tdKkdSQURFLktETiooZ3ItR3QpKk1hdGgubWluKDEsKGZpbi0zKS84KX0pOwogIHJldHVybiBjbGFtcChkLEdSQURFLk1JTixHUkFERS5NQVgpfQogY29uc3QgR049WyLkuI3mmI4v5LiL57SaIiwiT1Djg7tMIiwiRzMiLCJHMiIsIkcxIl07CiBmdW5jdGlvbiBncmFkZVRhZ3ModGFncyxkeixyYWNlKXtjb25zdCB0PXRhZ3Muc2xpY2UoKTsKICBpZihkejw9LS4yKXQudW5zaGlmdCh7dDpg5qC85LiK44GS5oim77yIJHtHTltyYWNlLmdyZHx8MF1977yJ77ya5LiL5L2N44Kw44Os44O844OJ44Gu5aW96LWw44Gv5Ymy5byVICR7ZHoudG9GaXhlZCgyKX1gLGM6Im8ifSk7CiAgZWxzZSBpZihkej49LjEpdC51bnNoaWZ0KHt0OmDpq5jjgrDjg6zjg7zjg4njgYvjgonjga7moLzkuIvjgZIgJHtkej49MD8iKyI6IiJ9JHtkei50b0ZpeGVkKDIpfWAsYzoiYiJ9KTsKICByZXR1cm4gdH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOODqeODs+OCr++8mueptOOCvuODvOODs+OBruW5s+Wdh+OBq+WvvuOBmeOCi+WAjeeOh+OBpyBTL0EvQi9D77yI5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgafvvIkgKi8KIGNvbnN0IEFWR19IT0xFPXtvZGRzOi4wOTEscHJveHk6LjExNX07CiBmdW5jdGlvbiByYXRpbmcocGMsbW9kZSxuKXtjb25zdCByPXBjL0FWR19IT0xFW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga30KIC8qIOeahOS4reeOh+mHjeimlu+8muWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vvvIjjgqrjg4PjgrrjgYzliIbjgYvjgovjgajjgY3jga/vvInljZjli50zMOWAjeacqua6gOOBruWkp+eptOOCkumZpOOBj+OAgumBjuWOu+OBruaknOiovOOBp+OAgeeahOS4reeOh+OBjOS4iuOBjOOCiuOAgeWbnuWPjueOh+OBjOacgOaCquOBruWkp+eptOOCkumBv+OBkeOCieOCjOOBnyAqLwogY29uc3QgRk9DVVNfTUFYX09ERFM9MzA7CiBjb25zdCBGT0NVUz17Im9kZHMiOnsibiI6MzYyNSwiaGl0IjowLjIzMiwiYmFzZUhpdCI6MC4xNzIsInBlckRheSI6MTMuNn0sInByb3h5Ijp7Im4iOjQwMjUsImhpdCI6MC4yNzIsImJhc2VIaXQiOjAuMjE3LCJwZXJEYXkiOjE1LjF9fTsgICAvLyAyMDI05bm05Lul6ZmN44Gu5qSc6Ki877ya55qE5Lit546H77yIYmFzZUhpdD3lvpPmnaXjga4x5L2N5YCZ6KOc77yJ44O76ZaL5YKs5pel44GC44Gf44KK44Gu6aCt5pWwCiBmdW5jdGlvbiBwaWNrRm9jdXMocmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zJiYocmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iUyJ8fHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IkEiKSYmKHgub2RkPT1udWxsfHx4Lm9kZDxGT0NVU19NQVhfT0REUykpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCt44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB5a++6LGh5aSWICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIGZ1bmN0aW9uIGFuYWx5emUocmFjZSxzdG9yZSxvZGRzLGNvbXAscG9wQXJyKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoOwogIGNvbnN0IHNjPVIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcCkpOwogIGNvbnN0IGR6PVIubWFwKHI9PmdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKSk7CiAgY29uc3QgemMwPU1PREVMLmNvcmU/Ui5tYXAocj0+bW9kZWxaKCJjb3JlIixmZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpKTpzYy5tYXAoeD0+eC56KTtjb25zdCB6Yz16YzAubWFwKCh6LGkpPT56K2R6W2ldKTsKICBjb25zdCBwPW5vcm1hbGl6ZVRvcDMoemMsTWF0aC5taW4oMyxOKSk7CiAgbGV0IG1rdD1udWxsLHBvcD1udWxsLG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7bWt0PXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpO3BvcD1vZGRzLm1hcChvPT4xK29kZHMuZmlsdGVyKHg9Png8bykubGVuZ3RoKTttb2RlPSJvZGRzIn0KICBlbHNlIGlmKHBvcEFyciYmcG9wQXJyLmxlbmd0aD09PU4mJnBvcEFyci5ldmVyeSh4PT54PjApKXtwb3A9cG9wQXJyLnNsaWNlKCk7bW9kZT0ib2RkcyJ9IC8vIOWun+mam+OBruS6uuawl+mghuS9jeOBoOOBkeWIhuOBi+OCi+OBqOOBje+8iOe1kOaenOODmuODvOOCuOeUseadpe+8iQogIGVsc2V7IC8vIOOCquODg+OCuuOCguS6uuawl+OCguOBquOBhOOBqOOBje+8mumojuaJi+aIkOe4vuOBvuOBp+WQq+OCgeOBn+OCueOCs+OCouOBrumghuS9jeOCkuOAjOS6uuawl+OBruS7o+eQhuOAjeOBq+OBmeOCi++8iOWun+mam+OBruS6uuawl+OBqOOBruebuOmWoiAwLjU14oaSMC42N++8iQogICBjb25zdCBweD1NT0RFTC5mdWxsP1IubWFwKHI9Pm1vZGVsWigiZnVsbCIsZmVhdHMocixzdG9yZSxyYWNlLE4sdHJ1ZSkpKTpSLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLHtqb2NrZXk6dHJ1ZSxsYXlvZmY6ZmFsc2V9KS56KTtjb25zdCBweDI9cHgubWFwKCh2LGkpPT52K2R6W2ldKTtwb3A9cHgyLm1hcCh2PT4xK3B4Mi5maWx0ZXIoeT0+eT52KS5sZW5ndGgpfQogIGNvbnN0IHJhbms9cC5tYXAodj0+MStwLmZpbHRlcih4PT54PnYpLmxlbmd0aCk7CiAgY29uc3QgY3V0PU1hdGgubWF4KDUsTWF0aC5jZWlsKE4qLjQpKTsKICByZXR1cm4gUi5tYXAoKHIsaSk9Pih7aSxubzpyLm51bXx8aSsxLG5hbWU6ci5uYW1lfHxyLmhvcnNlLHA6cFtpXSxwYzpjYWxpYkZvcihwW2ldLG1vZGUpLG1vZGUsCiAgIGpuOihzdG9yZS5qb2NrZXkoci5qb2NrZXkpfHx7bjowfSkubixyYW5rOnJhbmtbaV0scG9wOnBvcFtpXSxiYXNlOk1hdGgubWluKC41LDMvTiksCiAgIG9kZDoob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpP29kZHNbaV06bnVsbCwKICAgY2FyZWVyOigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/e246aC5uLHQzOmgudG9wMyx3aW46aC53aW59Om51bGx9KSgpLAogICByZWNlbnQ6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLnJ1bnMubWFwKHg9PnhbMV0pOltdfSkoKSwKICAgam5hbWU6ci5qbmFtZXx8IiIsanN0YXQ6KCgpPT57Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpO3JldHVybiBqJiZqLm4+PTE/e246ai5uLHJhdGU6ai50b3AzL2oubn06bnVsbH0pKCksCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICBkejpkeltpXSx0YWdzOmdyYWRlVGFncyhleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGR6W2ldLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIHJldHVybntmLG1vZGUscDA6c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpfX0KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBjb25zdCB1PXVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZGRzLGFwKSxtb2RlPXUubW9kZSxwPXUucDAsRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHksTUlORz1OdW1iZXIob3B0cy5taW5HcmQpfHwwLF9nT249R1JBREUub247R1JBREUub249IW9wdHMuZ3JhZGVPZmY7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIiwiZm9jdXMiXSxwZXI9WyJhbGwiLCJBIiwiQiIsIkMiXTsKICBjb25zdCBTPXt9O2Zvcihjb25zdCBuIG9mIG5hbWVzKXtTW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcilTW25dW3BdPXtiZXRzOjAsaGl0czowLHJldDowLHNxOjB9fQogIGNvbnN0IFNFRz17fTsgICAvLyAx5L2N5YCZ6KOc44Gu5p2h5Lu25Yil77yI5YWo5pyf6ZaT77yP5YmN5Y2K77yP5b6M5Y2K77yJCiAgY29uc3Qgc3RvcmU9bmV3IFN0b3JlKCk7bGV0IHVzZWQ9MDsKICBjb25zdCBhZGQ9KG4scCxoaXQseWVuKT0+e2NvbnN0IHg9U1tuXVtwXTt4LmJldHMrKztpZihoaXQpeC5oaXRzKys7eC5yZXQrPXllbjt4LnNxKz15ZW4qeWVufTsKICBjb25zdCBhZGRTZWc9KGxhYmVsLHAseWVuKT0+e2NvbnN0IGc9U0VHW2xhYmVsXT1TRUdbbGFiZWxdfHx7YWxsOntuOjAsaDowLHI6MCxxOjB9LEE6e246MCxoOjAscjowLHE6MH0sQjp7bjowLGg6MCxyOjAscTowfX07Zm9yKGNvbnN0IGsgb2YgWyJhbGwiLHBdKXtjb25zdCB4PWdba107eC5uKys7aWYoeWVuPjApeC5oKys7eC5yKz15ZW47eC5xKz15ZW4qeWVufX07CiAgY29uc3QgQVY9UFJPWFk/LjExNTouMDkxOwogIGZvcihjb25zdCByYyBvZiByYWNlcyl7CiAgIC8vIOaJleaIu+OBrklE44Gv44CM5pel5LuYLemWi+WCrOWgtC1S55Wq5Y+344CN44CC44OQ44OD44Kv44Ki44OD44OX44GuMTLmoYFJROOBqOOCguOAgeWQjOOBmOW9ouW8j+OBrklE44Go44KC57WQ44Gz5LuY44GR44KLCiAgIGNvbnN0IHZPZj0vXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDQsNik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzNdfHwiIixyT2Y9TnVtYmVyKC9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoMTAsMTIpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVs0XXx8MCk7CiAgIGNvbnN0IHBheT1wYXlCeUlkW3JjLmlkXXx8cGF5QnlJZFtgJHtyYy5kYXRlfS0ke3ZPZn0tJHtTdHJpbmcock9mKS5wYWRTdGFydCgyLCIwIil9YF07CiAgIGlmKHBheSYmcGF5LnBsYWNlJiZwYXkucGxhY2UubGVuZ3RoJiZyYy5kYXRlPj1TVEFSVCYmKCFNSU5HfHwoKHJjLnJvd3NbMF0mJnJjLnJvd3NbMF0uZ3JkKXx8MCk+PU1JTkcpKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICAgIGNvbnN0IHJlcz1QUk9YWT9hbmFseXplKHJhY2Usc3RvcmUsbnVsbCk6KGhhc09kZHM/YW5hbHl6ZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpOmFuYWx5emUocmFjZSxzdG9yZSxudWxsLG51bGwsUi5tYXAocj0+ci5wb3ApKSk7CiAgICAgY29uc3QgeWVuPW5ldyBNYXAocGF5LnBsYWNlLm1hcCh4PT5beC5udW1iZXIseC55ZW5dKSk7CiAgICAgY29uc3QgaG9sZT1yZXMuZmlsdGVyKHg9PnguaG9sZSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgICAgaWYoaG9sZS5sZW5ndGgpewogICAgICB1c2VkKys7Y29uc3QgcHI9U1BMSVQ/KHJjLmRhdGU8U1BMSVQ/IkEiOiJCIik6IkEiOwogICAgICBjb25zdCBidXk9KG4sbGlzdCk9Pntmb3IoY29uc3QgeCBvZiBsaXN0KXtjb25zdCB5PXllbi5nZXQoUlt4LmldLm51bSl8fDA7YWRkKG4sImFsbCIseT4wLHkpO2FkZChuLHByLHk+MCx5KTtpZihPT1MmJnJjLmRhdGU+PU9PUylhZGQobiwiQyIseT4wLHkpfX07CiAgICAgIGJ1eSgiZm9jdXMiLHBpY2tGb2N1cyhyZXMsMSkpOwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpOwogICAgICAgaWYoIVBST1hZJiZ0Lm9kZCl7Y29uc3Qgbz10Lm9kZDthZGRTZWcobzw4PyLljZjli50g44CcOOWAjSI6bzwxNT8i5Y2Y5YudIDjjgJwxNeWAjSI6bzwzMD8i5Y2Y5YudIDE144CcMzDlgI0iOm88NjA/IuWNmOWLnSAzMOOAnDYw5YCNIjoi5Y2Y5YudIDYw5YCN44CcIixwcix5KTsKICAgICAgICBpZihoYXNPZGRzKXtjb25zdCB1Zz11cHNldEdyYWRlKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7YWRkU2VnKCLms6LkubHluqYgIit1Zy5ncmFkZSxwcix5KX19fQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIEdSQURFLm9uPV9nT247cmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue3Vwc2V0RmVhdHVyZXMsY2xlYW5UcixHUkFERSxncmFkZVRpZXIsZ3JhZGVBZGosRk9DVVMscmF0aW5nLHBpY2tGb2N1cyxBWElTLGF4aXNQcm9icyxheGlzUGlja3MsdXBzZXRHcmFkZSxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOOCouODl+ODquWxpO+8iOWGjeani+evie+8iQogKiAg44O75L+d5a2YL+WGjemWi+OBpOOBjeOBrumBjuWOu+ODh+ODvOOCv+WPluW+l+OAgeODkOODg+OCr+OCouODg+ODl+OAgeaknOiovOOBr+OAgeWLleS9nOeiuuiqjea4iOOBv+OBruWHpueQhuOCkuOBneOBruOBvuOBvuWGjeWIqeeUqAogKiAg44O75LuK6YCx5pyr44Gu5Y+W5b6X44CB6aiO5omL44O76Kq/5pWZ5bir44Gu54Wn5ZCI44CB5pyf5b6F5YCk44CB6LaF6YmE5p2/44CB5rOi5Lmx5bqm44CB5Y+W44KK6L6844G/5ZOB6LOq44Gu6KGo56S644Gv5paw6KaPCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiI7CmNvbnN0IFZFTlVFPXsiMDEiOiLmnK3luYwiLCIwMiI6IuWHvemkqCIsIjAzIjoi56aP5bO2IiwiMDQiOiLmlrDmvZ8iLCIwNSI6IuadseS6rCIsIjA2Ijoi5Lit5bGxIiwiMDciOiLkuK3kuqwiLCIwOCI6IuS6rOmDvSIsIjA5Ijoi6Ziq56WeIiwiMTAiOiLlsI/lgIkifTsKY29uc3QganN0VG9kYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmNvbnN0IHBjdD0oeCxrPTApPT54PT1udWxsfHwhTnVtYmVyLmlzRmluaXRlKHgpPyItIjooeCoxMDApLnRvRml4ZWQoaykrIiUiOwoKZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCi8qIOWQjOOBmOODrOODvOOCueOBjOOAgUNTVigxMuahgUlEKeOBqOWPluW+l+ODh+ODvOOCvyjml6Xku5gt6ZaL5YKs5aC0LVIp44Gu5Lih5pa544Gr44GC44KL44Go44CB6aas44Gu5Ye66LWw5Zue5pWw44KE55u06L+R44Gu5oiQ57i+44GM5LqM6YeN44Gr44Gq44KL44CCCiAgIOaXpeS7mOODu+mWi+WCrOWgtOODu1Lnlarlj7fjgaflkIzjgZjjg6zjg7zjgrnjgpLopovliIbjgZHjgIHmnIDliJ3jgavoqq3jgpPjgaDmlrnjgaDjgZHjgpLkvb/jgYbvvIjlj5blvpfjg4fjg7zjgr/jgpLlhYjjgavoqq3jgoDvvJ3oqr/mlZnluKvjg7vppqzloLTnirbmhYvjgarjganjgYzosYrlr4zjgarmlrnjgpLlhKrlhYjvvIkgKi8KY29uc3QgcmFjZUtleT1yPT5yLmRhdGUrInwiK3ZlbnVlT2ZJZChyLnJhY2VJZCkrInwiK3JhY2VOb09mSWQoci5yYWNlSWQpOwpjb25zdCBmaWxlT3JkZXI9ZnM9PmZzLnNsaWNlKCkuc29ydCgoYSxiKT0+KGIubGl2ZT8xOjApLShhLmxpdmU/MTowKSk7CmNsYXNzIFJhY2VEZWR1cGV7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCk7dGhpcy5kdXBzPW5ldyBTZXQoKX0KIHNraXAocil7Y29uc3Qgaz1yYWNlS2V5KHIpLGY9dGhpcy5tLmdldChrKTtpZihmPT09dW5kZWZpbmVkKXt0aGlzLm0uc2V0KGssci5yYWNlSWQpO3JldHVybiBmYWxzZX1pZihmIT09ci5yYWNlSWQpe3RoaXMuZHVwcy5hZGQoayk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQp9CmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9ZmlsZU9yZGVyKGF3YWl0IGlkYkFsbCgpKSxkZD1uZXcgUmFjZURlZHVwZSgpOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXtjb25zdCBmPWZzW2ldOwogIGlmKGYubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZi5yb3dzfHxbXSl7Y29uc3Qgcj1saXZlUm93KHgpO2lmKCFkZC5za2lwKHIpKWNiKHIpfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCByPVVFLnRvUm93KG8pO2lmKCFkZC5za2lwKHIpKWNiKHIpfQogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9CiBGRV9EVVBTPWRkLmR1cHMuc2l6ZTsKfQpsZXQgRkVfRFVQUz0wOwovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9Cgpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Cn07CgoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTt0cnl7c2V0R2F0ZShvdXQsb3V0UCl9Y2F0Y2goZSl7Y29uc29sZS5lcnJvcihlKX0KICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpO3RyeXthd2FpdCBwZWRpZ3JlZUxvYWQoKTthd2FpdCBtb2RlbHNGcm9tTWV0YSgpfWNhdGNoKGUpe30KICBhd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsW10pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbi51cGRhdGVkQXR9KTsKICBhd2FpdCBzaG93U3RhdGUoKTtCSy5pbmZvPW1hbjtia01zZyhg5b6p5YWD5a6M5LqG77yaJHtuYW1lcy5sZW5ndGh944Kw44Or44O844OX77yPJHtjbnQudG9Mb2NhbGVTdHJpbmcoKX3ku7ZgKTsKIH1jYXRjaChlKXtia01zZygi5b6p5YWD44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBmaW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQpmdW5jdGlvbiBia1NjaGVkdWxlKG1zKXsKIGlmKCFCSy5hdXRvfHwhQksucGFzc3x8QksucGFzcy5sZW5ndGg8OClyZXR1cm47CiBjbGVhclRpbWVvdXQoQksucnVuVCk7QksucnVuVD1zZXRUaW1lb3V0KCgpPT57aWYoIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKTtlbHNlIGJrU2NoZWR1bGUoMzAwMDApfSxtc3x8MzAwMCk7Cn0KZnVuY3Rpb24gYmtTYXZlU2V0dGluZ3MoKXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oInVwc2V0X2JrIixKU09OLnN0cmluZ2lmeSh7cGFzczpCSy5wYXNzLGF1dG86QksuYXV0b30pKX1jYXRjaChlKXt9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDms6LkubHluqbjga7lho3moKHmraMKICogIOebrueahO+8muazouS5seW6puOBruOAjOW9k+OBn+OCiuaWueOAjeOCkuOAgeiHquWIhuOBrumBjuWOu+ODh+ODvOOCv+OBp+eiuuOBi+OCgeOAgeS/oemgvOOBp+OBjeOCi+aVsOWtl+OBoOOBkeOCkuWHuuOBmeOAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44GrMeOBpOOBmuOBpOWGjeePvuOBl+OAgeODrOODvOOCueWJjeOBq+WIhuOBi+OCi+aDheWgseOBoOOBkeOBp+azouS5seW6puOCkuioiOeulwogKiAgIDIpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBruazouS5seeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDMpIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOmWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LDl+OCr+ODqeOCue+8ieOBquOBqeOCkui2s+OBl+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgeWQjOOBmOacn+mWk+OBp+avlOi8gwogKiAgIDQpIOWvvuaVsOaQjeWkseOBjOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAguOBneOBhuOBp+OBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBq+OBl+OBpuOAgeWun+e4vueOh+OBoOOBkeaknOiovOWApOOBq+W3ruOBl+abv+OBiOOCiwogKiAg5rOi5Lmx77ydM+edgOS7peWGheOBrummrOOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApCjnj77ooYzjg6Ljg4fjg6vjgajlkIzjgZgxNSnku6XkuIoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBVUEtFWT0ia2VpYmFfdXBzZXRfdjEiOwpjb25zdCBzaWdtPXo9PjEvKDErTWF0aC5leHAoLXopKSxsZ3Q9cD0+e3A9TWF0aC5taW4oLjk5OSxNYXRoLm1heCguMDAxLHApKTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwpmdW5jdGlvbiB3aWxzb24oayxuKXtpZighbilyZXR1cm5bMCwxXTtjb25zdCB6PTEuOTYscD1rL24sZD0xK3oqei9uLGM9cCt6KnovKDIqbiksYT16Kk1hdGguc3FydChwKigxLXApL24reip6Lyg0Km4qbikpO3JldHVyblsoYy1hKS9kLChjK2EpL2RdfQpjb25zdCBkaXN0Qj1kPT5NYXRoLm1heCgxMDAwLE1hdGgubWluKDMyMDAsTWF0aC5yb3VuZCgoZHx8MCkvMjAwKSoyMDApKTsKY29uc3QgbHZsRz0obCxnKT0+KGx8fDApKyhnPj0yPyJHIjoiIik7CgovKiDjg6zjg7zjgrnjga7pm4boqIjvvIjooYzjgpLlhajpg6jmjIHjgZ/jgZrjgavmuIjjgoDou73jgYTlvaLvvInihpIg44Os44O844K55oOF5aCxICovCmZ1bmN0aW9uIGFnZ0FkZChtYXAscil7CiBpZighci5yYWNlSWR8fCFyLmhvcnNlfHxyLmZpbmlzaD09bnVsbClyZXR1cm47CiBsZXQgYT1tYXAuZ2V0KHIucmFjZUlkKTsKIGlmKCFhKW1hcC5zZXQoci5yYWNlSWQsYT17aWQ6U3RyaW5nKHIucmFjZUlkKSxkYXRlOnIuZGF0ZSxzdXJmOnIuc3VyZixkaXN0OnIuZGlzdCxsdmw6ci5sdmx8fDAsZ3JkOnIuZ3JkfHwwLGdjOjAsTjowLHQ6W10scGY6W10sanVtcDpmYWxzZX0pOwogaWYoIWEuZ2MmJnIuZ2MpYS5nYz1yLmdjOwogYS5OKys7aWYoci5maW5pc2g8PTMmJnIucG9wPjApYS50LnB1c2goW3IuZmluaXNoLHIucG9wXSk7CiBpZihyLnBvcD4wKWEucGYucHVzaChbci5wb3Asci5maW5pc2hdKTsKIGlmKC/pmpzlrrMvLnRlc3QoU3RyaW5nKHIucmFjZU5hbWV8fCIiKSkpYS5qdW1wPXRydWU7Cn0KZnVuY3Rpb24gYWdnSW5mbyhhKXsKIGlmKCFhfHxhLk48Nnx8YS5qdW1wKXJldHVybiBudWxsOwogY29uc3Qgdj0vXlxkezEyfSQvLnRlc3QoYS5pZCk/YS5pZC5zbGljZSg0LDYpOihTdHJpbmcoYS5pZCkuc3BsaXQoIi0iKVszXXx8IiIpLG5vPS9eXGR7MTJ9JC8udGVzdChhLmlkKT9OdW1iZXIoYS5pZC5zbGljZSgxMCwxMikpOihOdW1iZXIoU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbNF0pfHwwKTsKIGNvbnN0IHQ9YS50LnNsaWNlKCkuc29ydCgoeCx5KT0+eFswXS15WzBdKTsKIGNvbnN0IHk9dC5sZW5ndGg+PTM/KHRbMF1bMV0rdFsxXVsxXSt0WzJdWzFdPj1VRS5BWElTLnVwc2V0LnRocj8xOjApOm51bGw7CiByZXR1cm57ZGF0ZTphLmRhdGUsdixubyxzdXJmOmEuc3VyZixkaXN0OmEuZGlzdCxsdmw6YS5sdmwsZ3JkOmEuZ3JkLGdjOmEuZ2N8fDAsTjphLk4seX07Cn0KCi8qIOiEmuizqu+8mjHjgrPjg7zjg4rjg7zjga7kvY3nva7jga7libLlkIjvvIgwPeWFiOmgreOAgTE95pyA5b6M5pa577yJ44CC6YCa6YGO6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM44GC44KL6aas44Gg44GRICovCmZ1bmN0aW9uIGNvcm5lckZyYWMoY29ybmVyLE4pewogaWYoIUFycmF5LmlzQXJyYXkoY29ybmVyKXx8IWNvcm5lci5sZW5ndGh8fCFOfHxOPDQpcmV0dXJuIG51bGw7CiByZXR1cm4gTWF0aC5taW4oMSxNYXRoLm1heCgwLChjb3JuZXJbMF0tMSkvKE4tMSkpKTsKfQovKiDjg6zjg7zjgrnjga7jg5rjg7zjgrnnibnlvrTph4/vvJrlhYjooYzppqzjga7lpJrjgZXjg7vohJros6rjga7jgbDjgonjgaTjgY3jgILljYrmlbDku6XkuIrjga7ppqzjgavohJros6rjg4fjg7zjgr/jgYznhKHjgZHjgozjgbDlhajpg6gwICovCmZ1bmN0aW9uIHBhY2VGZWF0KHJ1bm5lcnMsc3RvcmUpewogY29uc3QgTj1ydW5uZXJzLmxlbmd0aDtsZXQgaz0wLGxlYWQ9MCxmcm9udD0wLHN1bT0wLHN1bTI9MDsKIGZvcihjb25zdCByIG9mIHJ1bm5lcnMpewogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWgpY29udGludWU7CiAgY29uc3Qgdj1oLnJ1bnMubWFwKHg9PnhbNl0pLmZpbHRlcih4PT54IT1udWxsJiZ4Pj0wKTtpZih2Lmxlbmd0aDwyKWNvbnRpbnVlOwogIGNvbnN0IHc9di5zbGljZSgtNSksbT13LnJlZHVjZSgoYSxiKT0+YStiLDApL3cubGVuZ3RoOwogIGsrKztzdW0rPW07c3VtMis9bSptO2lmKG08PS4xNSlsZWFkKys7aWYobTw9LjMwKWZyb250Kys7CiB9CiBpZighTnx8azxOKi41KXJldHVyblswLDAsMCwwLDBdOwogY29uc3QgbWVhbj1zdW0vayxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCxzdW0yL2stbWVhbiptZWFuKSk7CiByZXR1cm5bay9OLGxlYWQvTio0LGZyb250L04qMixtZWFuLS41LHNkXTsKfQoKLyog5ZCE6aas44GuM+edgOWGheeiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYzplr7lgKTku6XkuIrjgI3jgavjgarjgovnorrnjofjgpLjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7PjgafopovnqY3jgoLjgosKICAg77yI6YeN44G/77yd56K6546Hw7coMeKIkueiuueOhynjgafjgIEz6aCt44KS6aCG44Gr5oq96YG444CC5q+O5Zue5ZCM44GY57WQ5p6c44Gr44Gq44KL44KI44GG44CB5Lmx5pWw44Gv44Os44O844K55YaF5a6544GL44KJ5rG644KB44KL77yJICovCmZ1bmN0aW9uIHNpbVVwc2V0KHAscG9wcyx0aHIpewogY29uc3QgTj1wLmxlbmd0aDtsZXQgc2VlZD0yMTY2MTM2MjYxOwogZm9yKGxldCBpPTA7aTxOO2krKylzZWVkPU1hdGguaW11bChzZWVkXihNYXRoLnJvdW5kKHBbaV0qMTAwMCkrcG9wc1tpXSo3OTE5KSwxNjc3NzYxOSk+Pj4wOwogY29uc3Qgcm5kPSgpPT57c2VlZD0oc2VlZCsweDZEMkI3OUY1KT4+PjA7bGV0IHQ9c2VlZDt0PU1hdGguaW11bCh0Xih0Pj4+MTUpLHR8MSk7dF49dCtNYXRoLmltdWwodF4odD4+PjcpLHR8NjEpO3JldHVybigodF4odD4+PjE0KSk+Pj4wKS80Mjk0OTY3Mjk2fTsKIGNvbnN0IHc9cC5tYXAoeD0+TWF0aC5tYXgoMWUtNCx4LygxLU1hdGgubWluKC45OTkseCkpKSk7CiBjb25zdCBLPTMwMDtsZXQgaGl0PTAsc3VtPTAsc3VtMj0wOwogZm9yKGxldCBrPTA7azxLO2srKyl7CiAgY29uc3QgdXNlZD1BcnJheShOKS5maWxsKGZhbHNlKTtsZXQgUz0wOwogIGZvcihsZXQgaj0wO2o8MztqKyspewogICBsZXQgdG90PTA7Zm9yKGxldCBpPTA7aTxOO2krKylpZighdXNlZFtpXSl0b3QrPXdbaV07CiAgIGxldCB4PXJuZCgpKnRvdCxwaWNrPS0xOwogICBmb3IobGV0IGk9MDtpPE47aSsrKXtpZih1c2VkW2ldKWNvbnRpbnVlO3gtPXdbaV07aWYoeDw9MCl7cGljaz1pO2JyZWFrfX0KICAgaWYocGljazwwKXtmb3IobGV0IGk9Ti0xO2k+PTA7aS0tKWlmKCF1c2VkW2ldKXtwaWNrPWk7YnJlYWt9fQogICB1c2VkW3BpY2tdPXRydWU7Uys9cG9wc1twaWNrXTsKICB9CiAgaWYoUz49dGhyKWhpdCsrO3N1bSs9UztzdW0yKz1TKlM7CiB9CiBjb25zdCBtPXN1bS9LO3JldHVybltsZ3QoKGhpdCsuNSkvKEsrMSkpLG0vMTUsTWF0aC5zcXJ0KE1hdGgubWF4KDAsc3VtMi9LLW0qbSkpLzEwXTsKfQovKiAx44Os44O844K544Gu5biC5aC06L6844G/44Gu54m55b6077ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu56K6546H44Go44CB5Lq65rCX6aCG5L2N44Gu5a6f57i+546H44KS5Y2K44CF44Gn5re344Gc44Gf56K6546HIOKGkiDjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7MgKi8KZnVuY3Rpb24gc2ltRmVhdChwUCxwb3BzLE4scHJpKXsKIGNvbnN0IHo9cFAubWFwKChwLGkpPT4uNSpsZ3QocCkrLjUqbGd0KHByaS5yYXRlKHBvcHNbaV0sTikpKTsKIHJldHVybiBzaW1VcHNldChub3JtU3VtKHosMykscG9wcyxVRS5BWElTLnVwc2V0LnRocik7Cn0KCi8qIOaknOiovOOBruWFseacieOCreODo+ODg+OCt+ODpe+8muWlvei1sOeOh+OBqOazouS5seW6puOBruaknOiovOOBr+OAgeWQjOOBmOODrOODvOOCueOBp+WQjOOBmOmHjeOBhOioiOeul++8iOmBjuWOu+aIkOe4vuODouODh+ODq+OBrueiuueOh+ODu+eJueW+tOmHj++8ieOCkuOBmeOCi+OAggogICDjg4fjg7zjgr/jga7lhoXlrrnjgYzlkIzjgZjplpPjga/ntZDmnpzjgpLkvb/jgYTlm57jgZfjgIEy44Gk55uu44Gu5qSc6Ki844KS6YCf44GP44GZ44KL77yI44OH44O844K/44GM5aSJ44KP44KL44Go6Ieq5YuV44Gn5L2c44KK55u044GZ77yJICovCmNvbnN0IFdGQz1uZXcgTWFwKCk7bGV0IFdGQ19TSUc9IiI7CmZ1bmN0aW9uIHdmU3luYyhyYWNlcyl7CiBsZXQgaD1yYWNlcy5sZW5ndGg7CiBmb3IoY29uc3QgcmMgb2YgcmFjZXMpe2g9KE1hdGguaW11bChoLDMxKStyYy5yb3dzLmxlbmd0aCl8MDtjb25zdCByMD1yYy5yb3dzWzBdO2lmKHIwKWg9KE1hdGguaW11bChoLDMxKSsocjAuZmluaXNofHwwKSo3KyhyMC5wb3B8fDApKjEzKyhyYy5kYXRlLmNoYXJDb2RlQXQoOSl8fDApKXwwfQogY29uc3Qgc2lnPXJhY2VzLmxlbmd0aCsifCIrKHJhY2VzLmxlbmd0aD9yYWNlc1tyYWNlcy5sZW5ndGgtMV0uZGF0ZToiIikrInwiK2g7CiBpZihzaWchPT1XRkNfU0lHKXtXRkMuY2xlYXIoKTtXRkNfU0lHPXNpZ30KfQpjb25zdCB3ZkdldD1pZD0+e2xldCBjPVdGQy5nZXQoaWQpO2lmKCFjKXtjPXt9O1dGQy5zZXQoaWQsYyl9cmV0dXJuIGN9OwoKLyog44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI5bCR44Gq44GE44OH44O844K/44Gv5YWo5L2T44G45a+E44Gb44KL77yJICovCmNsYXNzIFVwUHJpewogY29uc3RydWN0b3IoKXt0aGlzLmJhc2U9e246MCx1OjB9O3RoaXMubT1uZXcgTWFwKCl9CiBfayhpKXtyZXR1cm5bIlYiK2kudiwiQyIraS52KyJ8IitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCksIkwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSsifCIrbHZsRyhpLmx2bCxpLmdyZCksIk4iKyhpLm5vfHwwKSwiRyIraS5zdXJmKyJ8IisoaS5nY3x8MCldfQogYWRkKGkpe2lmKCFpfHxpLnk9PW51bGwpcmV0dXJuO3RoaXMuYmFzZS5uKys7dGhpcy5iYXNlLnUrPWkueTtmb3IoY29uc3QgayBvZiB0aGlzLl9rKGkpKXtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdTowfSk7eC5uKys7eC51Kz1pLnl9fQogZmVhdChpKXsKICBjb25zdCBiPXRoaXMuYmFzZS5uPjIwMD90aGlzLmJhc2UudS90aGlzLmJhc2UubjouMjg1LEs9NDA7CiAgY29uc3Qgc2g9KGsscGFyKT0+e2NvbnN0IHg9dGhpcy5tLmdldChrKXx8e246MCx1OjB9O3JldHVybih4LnUrSypwYXIpLyh4Lm4rSyl9OwogIGNvbnN0IFtrdixrYyxrbCxrbixrZ109dGhpcy5fayhpKSxwdj1zaChrdixiKSxwYz1zaChrYyxwdikscGw9c2goa2wsYikscG49c2goa24sYikscGc9c2goa2csYiksbGI9bGd0KGIpOwogIHJldHVybltsZ3QocHYpLWxiLGxndChwYyktbGIsbGd0KHBsKS1sYixsZ3QocG4pLWxiLGxndChwZyktbGJdOwogfQp9CgovKiDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvIjjg4vjg6Xjg7zjg4jjg7Pms5Xjg7tMMuato+WJh+WMluODu+aomea6luWMlu+8iSAqLwpmdW5jdGlvbiBzb2x2ZUxpbihBLGIpewogY29uc3Qgbj1iLmxlbmd0aCxNPUEubWFwKChyLGkpPT5bLi4ucixiW2ldXSk7CiBmb3IobGV0IGM9MDtjPG47YysrKXsKICBsZXQgcD1jO2ZvcihsZXQgcj1jKzE7cjxuO3IrKylpZihNYXRoLmFicyhNW3JdW2NdKT5NYXRoLmFicyhNW3BdW2NdKSlwPXI7CiAgW01bY10sTVtwXV09W01bcF0sTVtjXV07Y29uc3QgZD1NW2NdW2NdfHwxZS05OwogIGZvcihsZXQgaz1jO2s8PW47aysrKU1bY11ba10vPWQ7CiAgZm9yKGxldCByPTA7cjxuO3IrKylpZihyIT09Yyl7Y29uc3QgZj1NW3JdW2NdO2lmKGYpZm9yKGxldCBrPWM7azw9bjtrKyspTVtyXVtrXS09ZipNW2NdW2tdfQogfQogcmV0dXJuIE0ubWFwKHI9PnJbbl0pOwp9CmZ1bmN0aW9uIGZpdExvZ2l0KFgseSxsMil7CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbXU9QXJyYXkoZCkuZmlsbCgwKSxzZD1BcnJheShkKS5maWxsKDApOwogZm9yKGNvbnN0IHIgb2YgWClmb3IobGV0IGo9MDtqPGQ7aisrKW11W2pdKz1yW2pdL247CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspc2Rbal0rPShyW2pdLW11W2pdKSoqMi9uOwogZm9yKGxldCBqPTA7ajxkO2orKyl7c2Rbal09TWF0aC5zcXJ0KHNkW2pdKTtpZighKHNkW2pdPj0uMDUpKXNkW2pdPS4wNX0gICAvLyDjgbDjgonjgaTjgY3jgYzjgbvjgbznhKHjgYTliJfjga/jgIHlsI/jgZXjgaroqqTlt67jgaflibLjgaPjgablt6jlpKfjgarlgKTjgavjgarjgonjgarjgYTjgojjgYbjgIHkuIvpmZDjgpLoqK3jgZHjgosKIGNvbnN0IFo9WC5tYXAocj0+WzEsLi4uci5tYXAoKHYsaik9Pih2LW11W2pdKS9zZFtqXSldKSxEPWQrMSx3PUFycmF5KEQpLmZpbGwoMCk7CiBmb3IobGV0IGl0PTA7aXQ8MzA7aXQrKyl7CiAgY29uc3QgZz1BcnJheShEKS5maWxsKDApLEg9QXJyYXkuZnJvbSh7bGVuZ3RoOkR9LCgpPT5BcnJheShEKS5maWxsKDApKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCB6PVpbaV07bGV0IHM9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXMrPXdbal0qeltqXTsKICAgY29uc3QgcD1zaWdtKHMpLGU9cC15W2ldLHE9cCooMS1wKTsKICAgZm9yKGxldCBqPTA7ajxEO2orKyl7Z1tqXSs9ZSp6W2pdO2ZvcihsZXQgaz1qO2s8RDtrKyspSFtqXVtrXSs9cSp6W2pdKnpba119fQogIGZvcihsZXQgaj0xO2o8RDtqKyspe2dbal0rPWwyKndbal07SFtqXVtqXSs9bDJ9CiAgZm9yKGxldCBqPTA7ajxEO2orKylmb3IobGV0IGs9MDtrPGo7aysrKUhbal1ba109SFtrXVtqXTsKICBIWzBdWzBdKz0xZS05OwogIGNvbnN0IGR3PXNvbHZlTGluKEgsZyk7bGV0IG14PTA7Zm9yKGxldCBqPTA7ajxEO2orKyl7d1tqXS09ZHdbal07bXg9TWF0aC5tYXgobXgsTWF0aC5hYnMoZHdbal0pKX0KICBpZihteDwxZS03KWJyZWFrOwogfQogcmV0dXJue3csbXUsc2R9Owp9CmNvbnN0IHByZWRMb2dpdD0obSx4KT0+e2xldCBzPW0ud1swXTtmb3IobGV0IGo9MDtqPHgubGVuZ3RoO2orKyl7Y29uc3Qgej0oeFtqXS1tLm11W2pdKS9tLnNkW2pdO3MrPW0ud1tqKzFdKk1hdGgubWF4KC01LE1hdGgubWluKDUseikpfXJldHVybiBzfTsgICAvLyDlrabnv5LmmYLjga7nr4Tlm7LjgpLlpKfjgY3jgY/lpJbjgozjgZ/lhaXlipvjgafmmrTjgozjgarjgYTjgojjgYbCsTXjgavmipHjgYjjgosKCi8qIOipleS+oeaMh+aome+8muWvvuaVsOaQjeWkseODu+ODluODqeOCpOODpOODvOODu0FVQ+ODu+i8g+ato+iqpOW3rihFQ0UpICovCmZ1bmN0aW9uIGF1Y09mKHAseSl7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSk7bGV0IHJzPTAsbjE9MDsKIGZvcihsZXQgcj0wO3I8aWR4Lmxlbmd0aDtyKyspe2lmKHlbaWR4W3JdXSl7cnMrPXIrMTtuMSsrfX0KIGNvbnN0IG4wPXkubGVuZ3RoLW4xO3JldHVybiBuMSYmbjA/KHJzLW4xKihuMSsxKS8yKS8objEqbjApOi41Owp9CmZ1bmN0aW9uIG1ldHJpY3NPZihwLHkpewogY29uc3Qgbj15Lmxlbmd0aDtsZXQgbGw9MCxicj0wOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcT1NYXRoLm1pbigxLTFlLTksTWF0aC5tYXgoMWUtOSxwW2ldKSk7bGwtPXlbaV0/TWF0aC5sb2cocSk6TWF0aC5sb2coMS1xKTticis9KHBbaV0teVtpXSkqKjJ9CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksQj0xMDtsZXQgZWNlPTA7CiBmb3IobGV0IGI9MDtiPEI7YisrKXtjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBtcD1zLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLG15PXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCkvcy5sZW5ndGg7ZWNlKz1NYXRoLmFicyhtcC1teSkqcy5sZW5ndGgvbn0KIHJldHVybntuLGxsOmxsL24sYnJpZXI6YnIvbixhdWM6YXVjT2YocCx5KSxlY2V9Owp9CgovKiDnrYnntJrvvJrkuojmuKznorrnjofjga7pq5jjgYTpoIbjgavkuIrkvY0gMyUgLyA3JSAvIDEyJSAvIDIwJSAvIDI4JSAvIOaui+OCiu+8iFNTUy9TUy9TL0EvQi9D77yJICovCmNvbnN0IFVQX1NIQVJFPVtbIlNTUyIsLjAzXSxbIlNTIiwuMDddLFsiUyIsLjEyXSxbIkEiLC4yMF0sWyJCIiwuMjhdLFsiQyIsLjMwXV07CmZ1bmN0aW9uIG1ha2VDdXRzKHBzKXsKIGNvbnN0IHM9cHMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpO2xldCBhY2M9MDtjb25zdCBjdXRzPVtdOwogZm9yKGNvbnN0IFtnLHNoXSBvZiBVUF9TSEFSRSl7YWNjKz1zaDtpZihnPT09IkMiKXtjdXRzLnB1c2goW2csLTFdKTticmVha31jdXRzLnB1c2goW2csc1tNYXRoLm1pbihzLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzLmxlbmd0aCphY2MpLTEpKV1dKX0KIHJldHVybiBjdXRzOwp9CmNvbnN0IGdyYWRlT2Y9KGN1dHMscCk9Pntmb3IoY29uc3QgW2csY10gb2YgY3V0cylpZihwPj1jKXJldHVybiBnO3JldHVybiJDIn07CmZ1bmN0aW9uIGdyYWRlVGFibGUoY3V0cyxwcyx5cyl7CiBjb25zdCB0PXt9O1VQX1NIQVJFLmZvckVhY2goKFtnXSk9PnRbZ109e246MCxrOjB9KTsKIHBzLmZvckVhY2goKHAsaSk9Pntjb25zdCB4PXRbZ3JhZGVPZihjdXRzLHApXTt4Lm4rKzt4LmsrPXlzW2ldfSk7CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ10sdz13aWxzb24oeC5rLHgubik7eC5yYXRlPXgubj94LmsveC5uOjA7eC5sbz13WzBdO3guaGk9d1sxXX0KIHJldHVybiB0Owp9CgovKiDmlrDjg6Ljg4fjg6vjga7lhaXlipvvvJrnj77ooYzjg6Ljg4fjg6vjga7nibnlvrTph48oMTcpIO+8iyDjgqrjg4PjgrrnibnlvrTph48oNywg44Gq44GR44KM44GwMCkg77yLIOOCquODg+OCuuacieeEoSDvvIsg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546HKDMpICovCmZ1bmN0aW9uIHVwWCh1LGUpewogY29uc3Qgb2Rkcz11Lm1vZGU9PT0ib2RkcyI7CiByZXR1cm5bLi4udS5mLnNsaWNlKDEsMTgpLC4uLihvZGRzP3UuZi5zbGljZSgxOCwyNSk6WzAsMCwwLDAsMCwwLDBdKSxvZGRzPzE6MCwuLi5lXTsKfQpmdW5jdGlvbiB1cHNldEN1c3RvbShNLHUsZSxwYyxzaW0pewogaWYoIU0pcmV0dXJuIG51bGw7CiBsZXQgejtjb25zdCB6MD1sZ3QodS5wMCkseHg9KCk9PntsZXQgeD11cFgodSxlKTtpZihNLnBhY2UpeD1bLi4ueCwuLi4ocGN8fFswLDAsMCwwLDBdKV07aWYoTS5zaW0peD1bLi4ueCxzaW0/MTowLC4uLihzaW18fFswLDAsMF0pXTtyZXR1cm4geH07CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHh4KCkpOwogZWxzZSBpZihNLmtpbmQ9PT0iYmxlbmQiKXo9KHowK3ByZWRMb2dpdChNLm1vZGVsLHh4KCkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHMmJm0udmVyPT09ND9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsgICAvLyB2ZXI6Mu+8neODrOODvOOCueeVquWPt+OBrueJueW+tOmHj+OBpOOBjeOAguWPpOOBhOS/neWtmOOBr+S9v+OCj+OBquOBhAoKLyogLS0tLS0tLS0tLSDms6LkubHluqbjga7kuojmg7PliKXjgavjgIHlrp/pmpvjga7miZXmiLvjgafnorrjgYvjgoHjgosgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBsb2FkUGF5RnVsbCgpewogY29uc3QgbT1uZXcgTWFwKCk7CiB0cnl7CiAgY29uc3QgZGF5cz1hd2FpdCBQcm9taXNlLnJhY2UoW3BheUFsbCgpLG5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQoKCk9PnIoW10pLDE1MDAwKSldKTsKICBmb3IoY29uc3QgZGF5IG9mIGRheXMpZm9yKGNvbnN0IHIgb2YgKGRheS5yYWNlc3x8W10pKWlmKHIucmFjZUlkKW0uc2V0KHIucmFjZUlkLHt3aW46ci53aW58fFtdLHBsYWNlOnIucGxhY2V8fFtdfSk7CiB9Y2F0Y2goZSl7fQogcmV0dXJuIG07Cn0KY29uc3QgbWVkT2Y9YT0+e2lmKCFhLmxlbmd0aClyZXR1cm4gbnVsbDtjb25zdCBzPWEuc2xpY2UoKS5zb3J0KCh4LHkpPT54LXkpLG09TWF0aC5mbG9vcihzLmxlbmd0aC8yKTtyZXR1cm4gcy5sZW5ndGglMj9zW21dOihzW20tMV0rc1ttXSkvMn07CmNvbnN0IGF2Z09mPWE9PmEubGVuZ3RoP2EucmVkdWNlKCh4LHkpPT54K3ksMCkvYS5sZW5ndGg6bnVsbDsKLyog5LqI5oOz44Gu562J57Sa44GU44Go44Gr77ya5a6f6Zqb44Gu5rOi5Lmx546H44CB5Y2Y5Yud6YWN5b2T77yI5Yud44Gh6aas77yJ44CB6KSH5Yud6YWN5b2T77yIM+edgOWGhTPpoK3jga7lkIjoqIjvvInjgIEz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiIICovCmZ1bmN0aW9uIHBheW91dFRhYmxlKHRlc3QsZ3JhZGVPZjIscGF5KXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MCxucDowLHdpbnM6W10scGw6W10scG9wczpbXX0pOwogZm9yKGNvbnN0IHMgb2YgdGVzdCl7CiAgY29uc3QgeD10W2dyYWRlT2YyKHMpXTt4Lm4rKzt4LmsrPXMueTsKICBjb25zdCBwPXBheS5nZXQocy5yYWNlSWQpOwogIGlmKCFwfHwhcC53aW4ubGVuZ3RofHxwLnBsYWNlLmxlbmd0aDwzKWNvbnRpbnVlOwogIHgubnArKzt4LndpbnMucHVzaChwLndpblswXS55ZW4pOwogIGNvbnN0IHBsPXAucGxhY2Uuc2xpY2UoMCwzKTt4LnBsLnB1c2gocGwucmVkdWNlKChhLGIpPT5hK2IueWVuLDApKTt4LnBvcHMucHVzaChwbC5yZWR1Y2UoKGEsYik9PmErKGIucG9wfHwwKSwwKSk7CiB9CiBjb25zdCBvdXQ9e307CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ107CiAgb3V0W2ddPXtuOngubixyYXRlOngubj94LmsveC5uOjAsbnA6eC5ucCxhdmdXaW46YXZnT2YoeC53aW5zKSxtZWRXaW46bWVkT2YoeC53aW5zKSwKICAgc2hhcmUxMDAwOngubnA/eC53aW5zLmZpbHRlcih2PT52Pj0xMDAwKS5sZW5ndGgveC5ucDpudWxsLHNoYXJlMzAwMDp4Lm5wP3gud2lucy5maWx0ZXIodj0+dj49MzAwMCkubGVuZ3RoL3gubnA6bnVsbCwKICAgYXZnUGxhY2VTdW06YXZnT2YoeC5wbCksYXZnUG9wU3VtOmF2Z09mKHgucG9wcyl9O30KIHJldHVybiBvdXQ7Cn0KLyog562J57Sa44GM5LiK44GM44KL44G744Gp44CB5a6f6Zqb44Gu5omV5oi744KC5aSn44GN44GP44Gq44Gj44Gm44GE44KL44GL77yI6Zqj44KK5ZCI44GG562J57Sa44Gu5q+U6LyD44Gn44CB6YCG6Lui44GM44GE44GP44Gk44GC44KL44GL77yJICovCmZ1bmN0aW9uIHBheW91dE1vbm90b25lKHRhYil7CiBjb25zdCBncz1VUF9TSEFSRS5tYXAoKFtnXSk9PmcpLHJvd3M9Z3MubWFwKGc9PnRhYltnXSkuZmlsdGVyKHg9PngubnA+PTMwKTsKIGxldCBvaz0wLHRvdD0wOwogZm9yKGxldCBpPTA7aSsxPHJvd3MubGVuZ3RoO2krKyl7dG90Kys7Y29uc3QgYT1yb3dzW2ldLGI9cm93c1tpKzFdO2lmKChhLmF2Z1BsYWNlU3VtPz8wKT49KGIuYXZnUGxhY2VTdW0/PzApKi45NSYmKGEuYXZnUG9wU3VtPz8wKT49KGIuYXZnUG9wU3VtPz8wKSouOTUpb2srK30gICAvLyDlgbbnhLbjga7lsI/jgZXjgarpgIbou6LvvIgx5Ymy5Lul5YaF77yJ44Gv6Kix5a65CiByZXR1cm57b2ssdG90fTsKfQoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5VcHNldEZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAyMS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5ELG91dD1bXTsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBwYXlGdWxsPW9wdHMucGF5RnVsbHx8YXdhaXQgbG9hZFBheUZ1bGwoKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogd2ZTeW5jKHJhY2VzKTsKIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgVXBQcmkoKSxwcHJpPW5ldyBQb3BQcmkoKSxTPVtdOwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxhbT1uZXcgTWFwKCk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylhZ2dBZGQoYW0scik7CiAgY29uc3QgaW5mbz1hZ2dJbmZvKGFtLmdldChTdHJpbmcocmMucm93c1swXSYmcmMucm93c1swXS5yYWNlSWQpKSk7CiAgaWYoaW5mbyYmaW5mby55IT1udWxsJiZyYy5kYXRlPj1TVEFSVCl7CiAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgIGNvbnN0IGhhc09kZHM9Ui5ldmVyeShyPT5yLm9kZHM+MSksb2Q9aGFzT2Rkcz9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IHdjPXdmR2V0KHJjLnJvd3NbMF0ucmFjZUlkKTsKICAgIGlmKCF3Yy51KXtjb25zdCBhPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTt3Yy51PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhKTt3Yy51UFA9YS5wUH0KICAgIGNvbnN0IGFwPXtwUDp3Yy51UFB9LHU9d2MudTsKICAgIGNvbnN0IHBvcHM9Ui5tYXAocj0+ci5wb3ApLHBvcHNPaz1SLmxlbmd0aD49NiYmcG9wcy5ldmVyeSh2PT52PjApOwogICAgbGV0IHUwPW51bGw7aWYob2Qpe2lmKHdjLnUwPT09dW5kZWZpbmVkKXt0cnl7d2MudTA9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG51bGwsVUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsbnVsbCkpfWNhdGNoKGUpe3djLnUwPW51bGx9fXUwPXdjLnUwfSAgIC8vIOOCquODg+OCuuacquWPluW+l+OBruOBqOOBjeeUqO+8iOWQjOOBmOODrOODvOOCueOCkuOAgeOCquODg+OCuuOBquOBl+OBrueJueW+tOOBp+S9nOOBo+OBn+OCguOBru+8iQogICAgUy5wdXNoKHtkYXRlOnJjLmRhdGUscmFjZUlkOnJjLnJvd3NbMF0ucmFjZUlkLHUsdTAsZHJvcE9kZHM6KGkqNDA1MDM+Pj4wKSUxMDwzLGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSksc2ltOnBvcHNPaz9zaW1GZWF0KGFwLnBQLHBvcHMsUi5sZW5ndGgscHByaSk6bnVsbCxrZWVwOihpKjI2NTQ0MzU3NjE+Pj4wKSUxMD49Myx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pOwogIHtjb25zdCBSUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7aWYoUlIubGVuZ3RoPj02JiZSUi5ldmVyeShyPT5yLnBvcD4wKSYmIVJSLnNvbWUocj0+L+manOWusy8udGVzdChTdHJpbmcoci5yYWNlTmFtZXx8IiIpKSkpcHByaS5hZGQoUlIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLFJSLmxlbmd0aCl9CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgcmMucm93cz1udWxsOyAgIC8vIOS9v+OBhOe1guOBiOOBn+ihjOOCkuino+aUvu+8iOODoeODouODquevgOe0hO+8iQogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVMuZmlsdGVyKHM9PnMuZGF0ZTxURVNUKSx0ZXN0PVMuZmlsdGVyKHM9PnMuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25BbGw6Uy5sZW5ndGgsblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVCxiYXNlOlMubGVuZ3RoP1MucmVkdWNlKChhLHMpPT5hK3MueSwwKS9TLmxlbmd0aDowfTsKIGlmKHRlc3QubGVuZ3RoPDMwMHx8dHJhaW4ubGVuZ3RoPDE1MDApe2J1c3koZmFsc2UpO3JldHVybnsuLi5yZXMsZXJyb3I6YOaknOiovOOBq+S9v+OBiOOCi+acn+mWk+OBruODrOODvOOCueOBjOi2s+OCiuOBvuOBm+OCk++8iOWtpue/kuWBtCR7dHJhaW4ubGVuZ3RofeODu+aknOiovOWBtCR7dGVzdC5sZW5ndGh977yJ44CC5qSc6Ki844Gu6ZaL5aeL5pel44KS5pep44KB44KL44GL44CB44OH44O844K/44KS5aKX44KE44GX44Gm44GP44Gg44GV44GE44CCYH19CiBjb25zdCB5VD10ZXN0Lm1hcChzPT5zLnkpLHkwPXRyYWluLm1hcChzPT5zLnkpOwogLy8g54++6KGM44Oi44OH44Or44Gu5qSc6Ki85pyf6ZaT44Gn44Gu5oiQ57i+CiBjb25zdCBwMD10ZXN0Lm1hcChzPT5zLnUucDApLG0wPW1ldHJpY3NPZihwMCx5VCk7CiAvLyDmlrDjg6Ljg4fjg6vvvIjlrabnv5LmnJ/plpPjga7jgb/jgafkvZzjgovvvInjgILluILloLTovrzjgb/jga7nibnlvrQoc2ltKeODu+ODmuODvOOCueOBr+OAgeS9v+OBiOOCi+OBqOOBjeOBoOOBkeippuOBl+OBpuOAgeiJr+OBj+OBquOCjOOBsOi2s+OBmQogY29uc3QgeEZvcj0ocyxmbCxpc1RyYWluKT0+ewogIGxldCB4PXVwWCgoaXNUcmFpbiYmcy51MCYmcy5kcm9wT2Rkcyk/cy51MDpzLnUscy5lKTsgICAvLyDlrabnv5Ljgafjga8z5Ymy44Gu44Os44O844K544Gn44CB44Kq44OD44K66L6844G/44Gu54m55b6044KS44Kq44OD44K644Gq44GX44Gu54m55b6044Gr572u44GN5o+b44GI44CB44Kq44OD44K65pyq5Y+W5b6X44Gu44Go44GN44Gr44KC5a++5b+c44Gn44GN44KL44KI44GG44Gr44GZ44KLCiAgaWYoZmwucGFjZSl4PVsuLi54LC4uLnMucGNdOwogIGlmKGZsLnNpbSl7Y29uc3QgdXNlPXMuc2ltJiYoIWlzVHJhaW58fHMua2VlcCk7eD1bLi4ueCx1c2U/MTowLC4uLih1c2U/cy5zaW06WzAsMCwwXSldfSAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafluILloLTovrzjgb/jga7nibnlvrTjgpLpmqDjgZfjgIHkurrmsJfjgYzmnKrnorrlrprjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICByZXR1cm4geDsKIH07CiBjb25zdCBmaXQ9Zmw9PnsKICBjb25zdCBtPWZpdExvZ2l0KHRyYWluLm1hcChzPT54Rm9yKHMsZmwsdHJ1ZSkpLHkwLDMpOwogIGNvbnN0IHo9dGVzdC5tYXAocz0+cHJlZExvZ2l0KG0seEZvcihzLGZsLGZhbHNlKSkpOwogIHJldHVybntmbCxtLG1OOm1ldHJpY3NPZih6Lm1hcChzaWdtKSx5VCksbUI6bWV0cmljc09mKHoubWFwKCh2LGkpPT5zaWdtKChsZ3QocDBbaV0pK3YpLzIpKSx5VCl9OwogfTsKIGNvbnN0IFY9e2Jhc2U6Zml0KHtwYWNlOmZhbHNlLHNpbTpmYWxzZX0pfTsKIGNvbnN0IGNvdlRyPXRyYWluLmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxjb3ZUZT10ZXN0LmZpbHRlcihzPT5zLnBjWzBdPjApLmxlbmd0aCxwYWNlT2s9Y292VHI+PTQwMCYmY292VGU+PTEwMDsKIGNvbnN0IHNpbVRyPXRyYWluLmZpbHRlcihzPT5zLnNpbSkubGVuZ3RoLHNpbVRlPXRlc3QuZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltT2s9c2ltVHI+PTEwMDAmJnNpbVRlPj0yMDA7CiByZXMucGFjZT17Y292VHJhaW46Y292VHIsY292VGVzdDpjb3ZUZSx1c2VkOmZhbHNlfTtyZXMuc2ltPXt0cmFpbk46c2ltVHIsdGVzdE46c2ltVGUsdXNlZDpmYWxzZX07CiBpZihzaW1PaylWLnNpbT1maXQoe3BhY2U6ZmFsc2Usc2ltOnRydWV9KTsKIGlmKHBhY2VPaylWLnBhY2U9Zml0KHtwYWNlOnRydWUsc2ltOmZhbHNlfSk7CiBpZihwYWNlT2smJnNpbU9rKVYuYm90aD1maXQoe3BhY2U6dHJ1ZSxzaW06dHJ1ZX0pOwogcmVzLm0wPW0wO3Jlcy5tTj1WLmJhc2UubU47cmVzLm1CPVYuYmFzZS5tQjsKIGlmKFYuc2ltKXJlcy5tUz1WLnNpbS5tTjtpZihWLnBhY2UpcmVzLm1QPVYucGFjZS5tTjtpZihWLmJvdGgpcmVzLm1QUz1WLmJvdGgubU47CiBsZXQgY3VyPVYuYmFzZTsKIGlmKFYuc2ltJiZjdXIubU4ubGwtVi5zaW0ubU4ubGw+PS4wMDEpY3VyPVYuc2ltOwoge2NvbnN0IGNhbmQ9Y3VyLmZsLnNpbT9WLmJvdGg6Vi5wYWNlO2lmKGNhbmQmJmN1ci5tTi5sbC1jYW5kLm1OLmxsPj0uMDAxKWN1cj1jYW5kfQogY29uc3QgZmxjPWN1ci5mbCx1c2VQYWNlPSEhZmxjLnBhY2UsdXNlU2ltPSEhZmxjLnNpbTsKIHJlcy5wYWNlLnVzZWQ9dXNlUGFjZTtyZXMuc2ltLnVzZWQ9dXNlU2ltO3Jlcy51c2VQYWNlPXVzZVBhY2U7cmVzLnVzZVNpbT11c2VTaW07CiAvLyDmjqHnlKjjga7liKTmlq3vvJrnj77ooYzjgojjgorlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuiJr+OBj+OBquOCiuOAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqAogY29uc3QgYmV0dGVyPShtLHJlZik9PihyZWYubGwtbS5sbD49LjAwMikmJihtLmF1Yz49cmVmLmF1Yy0uMDAzKTsKIGxldCBraW5kPSJvbGQiOwogY29uc3Qga2M9W1sibmV3IixjdXIubU5dLFsiYmxlbmQiLGN1ci5tQl1dLmZpbHRlcigoW2ssbV0pPT5iZXR0ZXIobSxtMCkpLnNvcnQoKGEsYik9PmFbMV0ubGwtYlsxXS5sbClbMF07CiBpZihrYylraW5kPWtjWzBdOwogY29uc3QgTTI9Y3VyLm0seHg9cz0+eEZvcihzLGZsYyxmYWxzZSk7CiByZXMua2luZD1raW5kOwogLy8g562J57Sa44Gu5YiH44KM55uu44Gv44CM5a2m57+S5YG044CN44Gu5LqI5ris44GL44KJ5rG644KB44CB5qSc6Ki85YG044Gn5a6f6Zqb44Gu5rOi5Lmx546H44KS5ris44KL77yI5q2j55u044Gq5a6f57i+546H77yJCiBjb25zdCBwcmVkVHJhaW49cz0+a2luZD09PSJvbGQiP3MudS5wMDpraW5kPT09Im5ldyI/c2lnbShwcmVkTG9naXQoTTIseHgocykpKTpzaWdtKChsZ3Qocy51LnAwKStwcmVkTG9naXQoTTIseHgocykpKS8yKTsKIGNvbnN0IGN1dHM9bWFrZUN1dHModHJhaW4ubWFwKHByZWRUcmFpbikpOwogY29uc3QgcFRlc3Q9dGVzdC5tYXAocHJlZFRyYWluKSx0YWI9Z3JhZGVUYWJsZShjdXRzLHBUZXN0LHlUKTsKIHJlcy5jdXRzPWN1dHM7cmVzLnRhYj10YWI7CiAvLyDkuojmg7Pjga7nrYnntJrjgZTjgajjgavjgIHlrp/pmpvjga7miZXmiLvjgafnorrjgYvjgoHjgovvvIjmjqHnlKjjgZfjgZ/jg6Ljg4fjg6vjgajjgIHmqJnmupbjg6Ljg4fjg6vjga7kuKHmlrnvvIkKIHtjb25zdCBpZHg9bmV3IE1hcCh0ZXN0Lm1hcCgocyxpKT0+W3MsaV0pKTsKICByZXMucGF5VGFiPXBheW91dFRhYmxlKHRlc3Qscz0+Z3JhZGVPZihjdXRzLHBUZXN0W2lkeC5nZXQocyldKSxwYXlGdWxsKTsKICByZXMucGF5VGFiU3RkPXBheW91dFRhYmxlKHRlc3Qscz0+e2NvbnN0IEc9VUUuQVhJUy51cHNldC5ncmFkZXNbcy51Lm1vZGVdO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpaWYocy51LnAwPj1jKXJldHVybiBnO3JldHVybiJDIn0scGF5RnVsbCk7CiAgcmVzLnBheU1vbm89cGF5b3V0TW9ub3RvbmUocmVzLnBheVRhYik7cmVzLnBheU1vbm9TdGQ9cGF5b3V0TW9ub3RvbmUocmVzLnBheVRhYlN0ZCk7CiAgcmVzLnBheVJhY2VzPU9iamVjdC52YWx1ZXMocmVzLnBheVRhYikucmVkdWNlKChhLHgpPT5hK3gubnAsMCk7fQogcmVzLm1vZGVsPXt2ZXI6NCxraW5kLHBhY2U6dXNlUGFjZSxzaW06dXNlU2ltLG1vZGVsOk0yLHBheVRhYjpyZXMucGF5VGFiLGN1dHMscmF0ZXM6T2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHRhYikubWFwKChbZyx4XSk9PltnLHtyYXRlOngucmF0ZSxsbzp4LmxvLGhpOnguaGksbjp4Lm59XSkpLAogIGF0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHRlc3RTdGFydDpURVNULG0wLG1OOnJlcy5tTixtQjpyZXMubUIsbVA6cmVzLm1QfHxudWxsLG1TOnJlcy5tU3x8bnVsbCxtUFM6cmVzLm1QU3x8bnVsbCxwYWNlQ292Oltjb3ZUcixjb3ZUZV0sc2ltQ292OltzaW1UcixzaW1UZV19OwogYnVzeShmYWxzZSk7cmV0dXJuIHJlczsKfQoKZnVuY3Rpb24gdXBzZXRSZXBvcnQocil7CiBpZihyLmVycm9yKXJldHVybmA8c3BhbiBjbGFzcz0iYmFkIj4ke2VzYyhyLmVycm9yKX08L3NwYW4+YDsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLHJvdz0obCxtKT0+YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7ZihtLmxsKX08L3RkPjx0ZD4ke2YobS5icmllcil9PC90ZD48dGQ+JHttLmF1Yy50b0ZpeGVkKDMpfTwvdGQ+PHRkPiR7KG0uZWNlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48L3RyPmA7CiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuWBtCAke3IublRyYWlufeODrOODvOOCue+8iOOAnCR7ZXNjKHIudGVzdFN0YXJ0KX3jga7liY3ml6XvvInvvI/mpJzoqLzlgbQgJHtyLm5UZXN0feODrOODvOOCue+8iCR7ZXNjKHIudGVzdFN0YXJ0KX3ku6XpmY3vvJ3nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvInjgILlhajkvZPjga7ms6LkubHnjocgJHtwY3Qoci5iYXNlLDEpfeOAgjwvZGl2PgogPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODouODh+ODq++8iOaknOiovOWBtO+8iTwvdGg+PHRoPuWvvuaVsOaQjeWkseKGkzwvdGg+PHRoPuiqpOW3ruKGkzwvdGg+PHRoPkFVQ+KGkTwvdGg+PHRoPui8g+ato+iqpOW3ruKGkzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4ke3Jvdygi54++6KGMIixyLm0wKX0ke3Jvdygi5paw77yI44Kz44O844K55Yil44KS6L+95Yqg77yJIixyLm1OKX0ke3Jvdygi54++6KGM44Go5paw44Gu5bmz5Z2HIixyLm1CKX0ke3IubVM/cm93KCLmlrDvvIjjgrPjg7zjgrnliKXvvIvluILloLTovrzjgb/jga7norrnjofvvIkiLHIubVMpOiIifSR7ci5tUD9yb3coIuaWsO+8iOOCs+ODvOOCueWIpe+8i+ODmuODvOOCue+8iSIsci5tUCk6IiJ9JHtyLm1QUz9yb3coIuaWsO+8iOOBmeOBueOBpu+8iSIsci5tUFMpOiIifTwvdGJvZHk+PC90YWJsZT48L2Rpdj5gOwogaCs9ci5zaW0mJnIuc2ltLnRlc3ROPj0yMDA/YDxkaXYgY2xhc3M9InNtYWxsIj7luILloLTovrzjgb/jga7nibnlvrTvvIjlkITppqzjga7norrnjofjgajkurrmsJfpoIbkvY3jgYvjgonjgIHms6LkubHjgavjgarjgovnorrnjofjgpLnm7TmjqXopovnqY3jgoLjgovvvInvvJrlrabnv5LlgbQke3Iuc2ltLnRyYWluTn3jg7vmpJzoqLzlgbQke3Iuc2ltLnRlc3ROfeODrOODvOOCueOBp+S9v+OBiOOBvuOBl+OBn+OAgiR7ci51c2VTaW0/IjxiPuWKoOOBiOOCi+OBqOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBn+OCgeaOoeeUqOOBl+OBvuOBl+OBn+OAgjwvYj4iOiLliqDjgYjjgabjgoLmmI7norrjgarmlLnlloTjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHmjqHnlKjjgZfjgabjgYTjgb7jgZvjgpPjgIIifTwvZGl2PmA6YDxkaXYgY2xhc3M9InNtYWxsIj7luILloLTovrzjgb/jga7nibnlvrTvvJrkurrmsJfpoIbkvY3jgaTjgY3jga7miJDnuL7jgYzlsJHjgarjgY/jgIHmpJzoqLzjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgII8L2Rpdj5gOwogaCs9ci5wYWNlJiZyLnBhY2UudXNlZD9gPGRpdiBjbGFzcz0ic21hbGwiPuODmuODvOOCueODu+iEmuizquOBrueJueW+tOmHj++8muWtpue/kuWBtCR7ci5wYWNlLmNvdlRyYWlufeODu+aknOiovOWBtCR7ci5wYWNlLmNvdlRlc3R944Os44O844K544Gn5L2/44GI44G+44GX44Gf44CCJHtyLnVzZVBhY2U/IjxiPuODmuODvOOCueOCkuWKoOOBiOOCi+OBqOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBn+OCgeaOoeeUqOOBl+OBvuOBl+OBn+OAgjwvYj4iOiLjg5rjg7zjgrnjgpLliqDjgYjjgabjgoLmmI7norrjgarmlLnlloTjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHmjqHnlKjjgZfjgabjgYTjgb7jgZvjgpPjgIIifTwvZGl2PmA6YDxkaXYgY2xhc3M9InNtYWxsIj7jg5rjg7zjgrnjg7vohJros6rvvJrpgJrpgY7poIbkvY3jgaTjgY3jga7miJDnuL7jgYzlsJHjgarjgY/vvIjlrabnv5LlgbQke3IucGFjZT9yLnBhY2UuY292VHJhaW46MH3jg7vmpJzoqLzlgbQke3IucGFjZT9yLnBhY2UuY292VGVzdDowfeODrOODvOOCue+8ieOAgeaknOiovOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAguioreWumuOBruOAjOODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBl+OAjeOCkuWun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiBjb25zdCBubT17b2xkOiLnj77ooYzjg6Ljg4fjg6vjga7jgb7jgb7vvIjmlrDjg6Ljg4fjg6vjga/mmI7norrjgavjga/oia/jgY/jgarjgonjgarjgYvjgaPjgZ/vvIkiLG5ldzoi5paw44Oi44OH44Or44KS5o6h55SoIisoci51c2VTaW0/Iu+8iOW4guWgtOi+vOOBv++8iSI6IiIpKyhyLnVzZVBhY2U/Iu+8iOODmuODvOOCuei+vOOBv++8iSI6IiIpLGJsZW5kOiLnj77ooYzjgajmlrDjga7lubPlnYfjgpLmjqHnlKgiKyhyLnVzZVNpbT8i77yI5biC5aC06L6844G/77yJIjoiIikrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIil9W3Iua2luZF07CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci5raW5kPT09Im9sZCI/InduIjoib2sifSI+PGI+57WQ5p6c77yaJHtubX08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya5a++5pWw5pCN5aSx44GMMC4wMDLku6XkuIrmlLnlloTjgZfjgIFBVUPjgYzmgqrljJbjgZfjgabjgYTjgarjgYTjgZPjgajjgII8L3NwYW4+PC9kaXY+YDsKIGgrPXBheW91dFJlcG9ydChyKTsKIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+562J57Sa44GU44Go44GuPGI+5a6f6Zqb44Gu5rOi5Lmx546HPC9iPu+8iOaknOiovOWBtOODuzk1JeOBruW5he+8ieOAguOBk+OBruaVsOWtl+OBjOOAgeazouS5seW6puOCv+ODluOBq+ihqOekuuOBleOCjOOCi+OCiOOBhuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBbZ10gb2YgVVBfU0hBUkUpe2NvbnN0IHg9ci50YWJbZ107aCs9YDx0cj48dGQ+JHtnfTwvdGQ+PHRkPiR7eC5ufTwvdGQ+PHRkPjxiPiR7cGN0KHgucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QoeC5sbyl944CcJHtwY3QoeC5oaSl9PC90ZD48L3RyPmB9CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBjb25zdCBtb25vPVVQX1NIQVJFLm1hcCgoW2ddKT0+ci50YWJbZ10ucmF0ZSkuZXZlcnkoKHYsaSxhKT0+aT09PTB8fHY8PWFbaS0xXSsuMDMpOwogaWYoIW1vbm8paCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuetiee0muOBrumghuOBq+Wun+e4vueOh+OBjOWNmOiqv+OBq+S4i+OBjOOBo+OBpuOBhOOBvuOBm+OCk+OAguaknOiovOWBtOOBruODrOODvOOCueaVsOOBjOWwkeOBquOBhOOBqOi1t+OBjeOBvuOBme+8iOWBtueEtuOBruevhOWbsuOBruOBk+OBqOOBjOWkmuOBhO+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBwYXlvdXRSZXBvcnQocil7CiBpZighci5wYXlUYWJ8fCFyLnBheVJhY2VzKXJldHVybic8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHlrp/pmpvjga7miZXmiLvjgafjga7norroqo3jga/jgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/vvIjjgIzpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgI3jgafmiZXmiLvjgoLlj5blvpfjgZXjgozjgb7jgZnvvInjgII8L2Rpdj4nOwogY29uc3QgeWVuPXY9PnY9PW51bGw/Ii0iOk1hdGgucm91bmQodikudG9Mb2NhbGVTdHJpbmcoKSsi5YaGIix0Ymw9KHQsdGl0bGUpPT57CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj48Yj4ke3RpdGxlfTwvYj48L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5oOz44Gu562J57SaPC90aD48dGg+44Os44O844K55pWwPC90aD48dGg+5a6f6Zqb44Gu5rOi5Lmx546HPC90aD48dGg+5Yud44Gh6aas44Gu5Y2Y5Yud6YWN5b2T77yI5Lit5aSu5YCk77yP5bmz5Z2H77yJPC90aD48dGg+5Y2Y5YudMTAwMOWGhuS7peS4ijwvdGg+PHRoPuikh+WLnTPpoK3jga7lkIjoqIjvvIjlubPlnYfvvIk8L3RoPjx0aD4z552A5YaF44Gu5Lq65rCX5ZCI6KiIPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IFtnXSBvZiBVUF9TSEFSRSl7Y29uc3QgeD10W2ddO2grPWA8dHI+PHRkPjxiPiR7Z308L2I+PC90ZD48dGQ+JHt4Lm5wfTwvdGQ+PHRkPiR7cGN0KHgucmF0ZSwxKX08L3RkPjx0ZD4ke3llbih4Lm1lZFdpbil977yPJHt5ZW4oeC5hdmdXaW4pfTwvdGQ+PHRkPiR7eC5zaGFyZTEwMDA9PW51bGw/Ii0iOnBjdCh4LnNoYXJlMTAwMCwwKX08L3RkPjx0ZD4ke3llbih4LmF2Z1BsYWNlU3VtKX08L3RkPjx0ZD4ke3guYXZnUG9wU3VtPT1udWxsPyItIjp4LmF2Z1BvcFN1bS50b0ZpeGVkKDEpfTwvdGQ+PC90cj5gfQogIHJldHVybiBoKyI8L3Rib2R5PjwvdGFibGU+PC9kaXY+In07CiBsZXQgaD1gPGgzPuS6iOaDs+OBruetiee0muOBlOOBqOOBruOAgeWun+mam+OBruaJleaIu++8iOaknOiovOWBtCAke3IucGF5UmFjZXN944Os44O844K577yJPC9oMz48ZGl2IGNsYXNzPSJzbWFsbCI+5rOi5Lmx5bqm44Gu5LqI5oOz44GM5b2T44Gf44Gj44Gm44GE44KL44Gq44KJ44CB562J57Sa44GM6auY44GE44G744Gp44CB5Yud44Gh6aas44Gu5Y2Y5Yud6YWN5b2T44O76KSH5YudM+mgreOBruWQiOioiOODuzPnnYDlhoXjga7kurrmsJflkIjoqIjjgYzlpKfjgY3jgY/jgarjgorjgb7jgZnjgII8L2Rpdj5gOwogaCs9dGJsKHIucGF5VGFiLHIua2luZD09PSJvbGQiPyLmjqHnlKjjgZfjgZ/kuojmg7PvvIjnj77ooYzjg6Ljg4fjg6vvvIkiOiLmjqHnlKjjgZfjgZ/kuojmg7PvvIjlho3moKHmraPlvozvvIkiKTsKIGNvbnN0IG09ci5wYXlNb25vOwogaCs9bS50b3Q/YDxkaXYgY2xhc3M9ImJhbm5lciAke20ub2s9PT1tLnRvdD8ib2siOiJ3biJ9Ij48Yj4ke20ub2s9PT1tLnRvdD8i562J57Sa44GM5LiK44GM44KL44G744Gp44CB5a6f6Zqb44Gu5omV5oi744KC5aSn44GN44GP44Gq44Gj44Gm44GE44G+44GZ44CCIjoi562J57Sa44GM5LiK44GM44Gj44Gm44KC5omV5oi744GM5aSn44GN44GP44Gq44KJ44Gq44GE566H5omA44GM44GC44KK44G+44GZ77yIIittLm9rKyIvIittLnRvdCsi57WE77yJ44CCIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+6Zqj44KK5ZCI44GG562J57Sa44Gu5q+U6LyD44Gn44CB6KSH5YudM+mgreOBruWQiOioiOaJleaIu+OBqDPnnYDlhoXjga7kurrmsJflkIjoqIjjga7kuKHmlrnjgYzjgIHkuIrjga7nrYnntJrjga7mlrnjgYzlpKfjgY3jgYTvvIjjgb7jgZ/jga81JeS7peWGheOBruW3ru+8iee1hOOBruaVsOOBp+OBmeOAguWNmOWLnemFjeW9k+OBruS4reWkruWApOOBr+WwkeaVsOOBruODrOODvOOCueOBoOOBqOWBtueEtuOBp+OBtuOCjOOCi+OBn+OCgeOAgeWIpOWumuOBq+OBr+S9v+OBo+OBpuOBhOOBvuOBm+OCk+OAgjwvc3Bhbj48L2Rpdj5gOiIiOwogaWYoci5raW5kIT09Im9sZCIpaCs9dGJsKHIucGF5VGFiU3RkLCLlj4LogIPvvJrmqJnmupbjg6Ljg4fjg6vjga7nrYnntJrjgaflkIzjgZjpm4boqIjjgpLjgZfjgZ/loLTlkIgiKSsoci5wYXlNb25vU3RkLnRvdD9gPGRpdiBjbGFzcz0ic21hbGwiPuaomea6luODouODh+ODq+OBruetiee0muOBruaVtOWQiO+8miR7ci5wYXlNb25vU3RkLm9rfS8ke3IucGF5TW9ub1N0ZC50b3R957WEPC9kaXY+YDoiIik7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiB1cHNldFN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0VXBzZXRNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7mqJnmupbjg6Ljg4fjg6vvvIjlrabnv5LmuIjjgb/jga7lm7rlrprjg6Ljg4fjg6vvvInjgILlrp/nuL7njofjga/lrabnv5LmmYLjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44OrIixuZXc6IuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqyIsYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+WdhyJ9W00ua2luZF07CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7bm19PC9iPuOBp+WIpOWumuS4re+8iOaknOiovOaXpSAke2VzYyhNLmF0KX3vvI/mpJzoqLwgJHtNLm5UZXN0feODrOODvOOCue+8ieOAguetiee0muOBruWun+e4vueOh+OBr+OAgeODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+a4rOOBo+OBn+WApOOBp+OBmeOAgjwvZGl2PmA7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDov73liqDjga7mnaHku7bvvJrppqzloLTnirbmhYvjg7vmnqDpoIbvvIjppqznlarjga7kvY3nva7vvInjg7voqr/mlZnluKvjg7vooYDntbEKICogIOOBmeOBueOBpuOAjOOBneOBruaXpeOCiOOCiuWJjeOBq+WIhuOBi+OBo+OBpuOBhOOCi+aDheWgseOAjeOBoOOBkeOBp+S9nOOCiuOAgeWKueaenOOBjOOBguOCi+OBqOOBjeOBoOOBke+8iOaknOiovOOBp++8ieaOoeeUqOOBmeOCi+OAggogKiAgIOODu+mmrOWgtOeKtuaFi+OBruebuOaAp++8muOBneOBrummrOOBjOOAgeWQjOOBmOmmrOWgtOeKtuaFi++8iOiJr++8j+eojemHjeOAnOS4jeiJr++8ieOBp+mBjuWOu+OBq+OBqeOCjOOBoOOBkei1sOOBo+OBn+OBiwogKiAgIOODu+aeoOmghuOBruacieWIqeS4jeWIqe+8mumWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LjgZTjgajjga7jgIHlhoXjgJzlpJbjga4z552A5YaF546H44Gu5YGP44KKCiAqICAg44O76Kq/5pWZ5bir77ya6Kq/5pWZ5bir44Gu6YGO5Y6744GuM+edgOWGheeOhwogKiAgIOODu+ihgOe1se+8mueItuODu+avjeOBrueItuOBjOOAgeWQjOOBmOiKneODgMOX6Led6Zui44Gn6YGO5Y6744Gr44Gp44KM44Gg44GR6LWw44Gj44Gf44GL77yI5Ye66aas6KGo44GL44KJ5bCR44GX44Ga44Gk6JOE56mN44CC6Kqt44KB44Gf6aas44Gg44GR77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgZ29pbmdDb2RlPXQ9Pnt0PVN0cmluZyh0fHwiIik7cmV0dXJuL+S4jeiJry8udGVzdCh0KT80Oi/nqI0vLnRlc3QodCk/Mjov6YeNLy50ZXN0KHQpPzM6L+iJry8udGVzdCh0KT8xOjB9Owpjb25zdCBnb2luZ0NhdD1nPT5nPT09MT8xOihnPj0yPzI6MCk7ICAgIC8vIDE96Imv44CBMj3nqI3ph43jgJzkuI3oia/jgIEwPeS4jeaYjgpjb25zdCBHT0lOR19OQU1FPXswOiLkuI3mmI4iLDE6IuiJryIsMjoi6YeN57O7In07CmNvbnN0IHZlbnVlRnJvbUlkPWlkPT57aWQ9U3RyaW5nKGlkfHwiIik7cmV0dXJuL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOihpZC5zcGxpdCgiLSIpWzNdfHwiIil9OwpsZXQgUEVEPXt9OyAgIC8vIOmmrOWQjSDihpIge3M654i2LGQ65q+NLG065q+N44Gu54i2feOAguWHuummrOihqOOBi+OCieWwkeOBl+OBmuOBpOiThOepjeOBmeOCiwoKLyog5p6g6aCG77yI6aas55Wq44Gu5L2N572u77yJ77ya6ZaL5YKs5aC0w5foip3jg4DDl+i3nembouOBlOOBqOOBq+OAgeWGheOAnOWkljXljLrliIbjga4z552A5YaF546HICovCmNsYXNzIERyYXdQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBfYihudW0sTil7cmV0dXJuIE4+MT9NYXRoLm1pbig0LE1hdGgubWF4KDAsTWF0aC5mbG9vcigobnVtLTEpL04qNSkpKToyfQogX2sodixzLGQpe3JldHVybiB2KyJ8IitzKyJ8IitkaXN0QihkKX0KIGFkZCh2LHMsZCxudW0sTix0Myl7CiAgaWYoIW51bXx8Tjw4KXJldHVybjsKICBjb25zdCBrPXRoaXMuX2sodixzLGQpLGI9dGhpcy5fYihudW0sTik7bGV0IGc9dGhpcy5tLmdldChrKTsKICBpZighZyl0aGlzLm0uc2V0KGssZz17bjowLHQ6MCxiOltbMCwwXSxbMCwwXSxbMCwwXSxbMCwwXSxbMCwwXV19KTsKICBnLm4rKztnLnQrPXQzO2cuYltiXVswXSsrO2cuYltiXVsxXSs9dDM7CiB9CiBmZWF0KHYscyxkLG51bSxOKXsKICBpZighbnVtfHxOPDgpcmV0dXJuIDA7CiAgY29uc3QgZz10aGlzLm0uZ2V0KHRoaXMuX2sodixzLGQpKTtpZighZ3x8Zy5uPDMwMClyZXR1cm4gMDsKICBjb25zdCBiPXRoaXMuX2IobnVtLE4pLGJhc2U9Zy50L2cubixLPTYwLFtuLHRdPWcuYltiXTsKICByZXR1cm4gbGd0KCh0K0sqYmFzZSkvKG4rSykpLWxndChiYXNlKTsKIH0KfQovKiDooYDntbHvvJrniLbjg7vmr43jga7niLbjgZTjgajjga7jgIHoip3jg4DDl+i3nembouOBp+OBruOAjOWun+mam+OBrjPnnYDlhoXmlbAgw7cg5pyf5b6F44GuM+edgOWGheaVsO+8iDMv6aCt5pWw44Gu5ZCI6KiI77yJ44CNICovCmNsYXNzIFNpcmVQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBrZXkoa2luZCx2LHNmLGQpe3JldHVybiBraW5kKyJ8Iit2KyJ8IitzZisifCIrZGlzdEIoZCl9CiBhZGQocGVkLHNmLGQsdDMsTil7CiAgaWYoIXBlZHx8Tjw4KXJldHVybjtjb25zdCBlPU1hdGgubWluKC41LDMvTik7CiAgZm9yKGNvbnN0IFtraW5kLHZdIG9mIFtbInMiLHBlZC5zXSxbIm0iLHBlZC5tXV0pewogICBpZighdiljb250aW51ZTtjb25zdCBrPXRoaXMua2V5KGtpbmQsdixzZixkKTtsZXQgeD10aGlzLm0uZ2V0KGspOwogICBpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHQ6MCxlOjB9KTt4Lm4rKzt4LnQrPXQzO3guZSs9ZTsKICB9CiB9CiBmZWF0KHBlZCxzZixkKXsKICBpZighcGVkKXJldHVyblswLDAsMCwwXTsKICBjb25zdCBnPSh2LGtpbmQpPT57aWYoIXYpcmV0dXJuWzAsMF07Y29uc3QgeD10aGlzLm0uZ2V0KHRoaXMua2V5KGtpbmQsdixzZixkKSk7aWYoIXh8fHgubjwyNSlyZXR1cm5bMCwwXTtyZXR1cm5bTWF0aC5sb2coKHgudCszKS8oeC5lKzMpKSwxXX07CiAgcmV0dXJuWy4uLmcocGVkLnMsInMiKSwuLi5nKHBlZC5tLCJtIildOwogfQp9Ci8qIDHpoK3jgbbjgpPjga7ov73liqDnibnlvrTvvIg55YCL77yJ77ya6aas5aC044Gu55u45oCn44O75pyJ54Sh77yP5p6g6aCG44Gu5YGP44KK77yP6Kq/5pWZ5bir44Gu5beu44O75pyJ54Sh77yP54i244Gu55u45oCn44O75pyJ54Sh77yP5q+N44Gu54i244Gu55u45oCn44O75pyJ54ShICovCmZ1bmN0aW9uIGV4dEZlYXRIb3JzZShyLGgscmMsY3R4LGIpewogY29uc3QgbjA9aD9oLm46MCxwUz0oKGg/aC50b3AzOjApKzMqYikvKG4wKzMpOwogbGV0IGdmaXQ9MCxnaz0wO2NvbnN0IGduPWgmJmguZ24mJnJjLmdjPjA/aC5nbltyYy5nY106bnVsbDsKIGlmKGduJiZnblswXT49Mil7Z2ZpdD0oZ25bMV0rMypwUykvKGduWzBdKzMpLXBTO2drPTF9CiBjb25zdCBkcmF3PWN0eC5kcmF3P2N0eC5kcmF3LmZlYXQocmMudixyYy5zdXJmLHJjLmRpc3Qsci5udW0scmMuTik6MDsKIGxldCB0ZT0wLHRrPTA7Y29uc3QgdHI9Y3R4LnRyJiZyLnRyYWluZXI/Y3R4LnRyLmdldChyLnRyYWluZXIpOm51bGw7CiBpZih0ciYmdHIubj49MjApe3RlPSh0ci50MysuMio0MCkvKHRyLm4rNDApLS4yO3RrPTF9CiBjb25zdCBzZj1jdHguc2lyZT9jdHguc2lyZS5mZWF0KGN0eC5wZWQmJmN0eC5wZWRbci5ob3JzZV0scmMuc3VyZixyYy5kaXN0KTpbMCwwLDAsMF07CiByZXR1cm5bZ2ZpdCxnayxkcmF3LHRlLHRrLC4uLnNmXTsKfQovKiDlsaXmrbTjgYvjgonjgIHlh7rppqzooajjgYvjgonoqq3jgpPjgaDooYDntbHjgpLok4TnqY3vvIjpgLHmnKvjga7lj5blvpfjga7jgZ/jgbPjgavmm7TmlrDjgZfjgabkv53lrZjvvIkgKi8KYXN5bmMgZnVuY3Rpb24gcGVkaWdyZWVVcGRhdGUoY2FyZHMpewogbGV0IGFkZGVkPTAsc2Vlbj0wOwogZm9yKGNvbnN0IGQgb2YgT2JqZWN0LmtleXMoY2FyZHMpKWZvcihjb25zdCBjIG9mIGNhcmRzW2RdfHxbXSlmb3IoY29uc3QgaCBvZiAoYy5ob3JzZXN8fFtdKSl7CiAgY29uc3QgbmFtZT1VRS5ubihoLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIik7aWYoIW5hbWUpY29udGludWU7CiAgaWYoaC5zaXJlfHxoLmRhbVNpcmUpe3NlZW4rKztjb25zdCBvPXtzOlVFLm5uKGguc2lyZXx8IiIpLGQ6VUUubm4oaC5kYW18fCIiKSxtOlVFLm5uKGguZGFtU2lyZXx8IiIpfTsKICAgY29uc3QgcD1QRURbbmFtZV07aWYoIXB8fHAucyE9PW8uc3x8cC5tIT09by5tKXtQRURbbmFtZV09bzthZGRlZCsrfX0KIH0KIGlmKGFkZGVkKXt0cnl7YXdhaXQgbWV0YVB1dCgicGVkIixQRUQpfWNhdGNoKGUpe319CiByZXR1cm57c2VlbixhZGRlZCx0b3RhbDpPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH07Cn0KYXN5bmMgZnVuY3Rpb24gcGVkaWdyZWVMb2FkKCl7dHJ5e2NvbnN0IHg9YXdhaXQgbWV0YUdldCgicGVkIik7aWYoeCYmdHlwZW9mIHg9PT0ib2JqZWN0IilQRUQ9eH1jYXRjaChlKXt9fQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOBruaknOiovOODu+WGjeagoeatowogKiAg55uu55qE77ya5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOBhuaVsOWtl+OBq+OBmeOCi+OAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB44Os44O844K55YmN44Gr5YiG44GL44KL5oOF5aCx44Gg44GR44Gn5ZCE6aas44Gu56K6546H44KS6KiI566XCiAqICAgICAgICDjg7vpgY7ljrvmiJDnuL7jgYvjgonkvZzjgovjg6Ljg4fjg6vjga7norrnjofvvIjjgqrjg4PjgrrjgpLkvb/jgo/jgarjgYTvvIkKICogICAgICAgIOODu+S6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh++8iOW4guWgtOOBruaDheWgseOAguOCquODg+OCuuWPluW+l+W+jOOBr+S6uuawl+mghuS9jeOBjOaxuuOBvuOCi++8iQogKiAgIDIpIDLjgaTjgpLntYTjgb/lkIjjgo/jgZvjgZ/mlrDjg6Ljg4fjg6vvvIjjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvInjgpLjgIHlrabnv5LlgbTjga7mnJ/plpPjgafkvZzjgosKICogICAzKSDnj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIhNT0RFTF9UUkFJTl9FTkTku6XpmY3vvInjgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgosKICogICA0KSDmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgajjgY3jgaDjgZHmjqHnlKjjgILotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7liIfjgoznm67jgoLjgIHjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgosKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBQTEtFWT0ia2VpYmFfcGxhY2VfdjEiOwoKLyog5Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7jgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H77yI5bCR44Gq44GE44OH44O844K/44GvMy/poK3mlbDjgbjlr4TjgZvjgovvvIkgKi8KY2xhc3MgUG9wUHJpewogY29uc3RydWN0b3IoKXt0aGlzLm09bmV3IE1hcCgpfQoga2V5KHBvcCxOKXtyZXR1cm4gTWF0aC5taW4oMTgscG9wKSsifCIrTWF0aC5taW4oMTgsTWF0aC5tYXgoNixOKSl9CiBhZGQobGlzdCxOKXsKICBmb3IoY29uc3QgW3BvcCxmaW5dIG9mIGxpc3QpewogICBpZighKHBvcD4wKXx8ZmluPT1udWxsKWNvbnRpbnVlOwogICBjb25zdCBrPXRoaXMua2V5KHBvcCxOKTtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdDowfSk7CiAgIHgubisrO2lmKGZpbjw9Myl4LnQrKzsKICB9CiB9CiByYXRlKHBvcCxOKXsKICBjb25zdCB4PXRoaXMubS5nZXQodGhpcy5rZXkocG9wLE4pKXx8e246MCx0OjB9LGJhc2U9TWF0aC5taW4oLjk1LDMvTWF0aC5tYXgoTiwzKSksSz0zMDsKICByZXR1cm4oeC50K0sqYmFzZSkvKHgubitLKTsKIH0KfQovKiDnorrnjofjga7lkIjoqIjjgpLjgaHjgofjgYbjgal0YXJnZXTjgavjgZnjgovvvIjjg63jgrjjg4Pjg4jjgpLkuIDmp5jjgavjgZrjgonjgZnvvIkgKi8KZnVuY3Rpb24gbm9ybVN1bSh6LHRhcmdldCl7CiBsZXQgbG89LTE0LGhpPTE0OwogZm9yKGxldCBpdD0wO2l0PDYwO2l0Kyspe2NvbnN0IG1pZD0obG8raGkpLzI7bGV0IHM9MDtmb3IoY29uc3QgdiBvZiB6KXMrPXNpZ20odittaWQpO2lmKHM+dGFyZ2V0KWhpPW1pZDtlbHNlIGxvPW1pZH0KIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6Lm1hcCh2PT5zaWdtKHYrYykpOwp9Ci8qIDHpoK3jga7lhaXlipvvvJrjg6Ljg4fjg6vnorrnjofjg7vkurrmsJfjg5njg7zjgrnjga7lrp/nuL7njofjg7vkurrmsJfjga7kvY3nva7jg7vpoK3mlbDjg7vjg6Ljg4fjg6vlhoXjga7poIbkvY0gKi8KZnVuY3Rpb24gcGxhY2VYKHBQLHBvcCxOLHByaSxyYW5rRnJhYyl7CiByZXR1cm5bbGd0KHBQKSxsZ3QocHJpLnJhdGUocG9wLE4pKSwocG9wLTEpL01hdGgubWF4KDEsTi0xKSxOLzE2LHJhbmtGcmFjLHBvcD09PTE/MTowLHBvcDw9Mz8xOjBdOwp9CmNvbnN0IHJhbmtGcmFjcz1wcz0+e2NvbnN0IG89cHMubWFwKChwLGkpPT5pKS5zb3J0KChhLGIpPT5wc1tiXS1wc1thXSkscms9QXJyYXkocHMubGVuZ3RoKTtvLmZvckVhY2goKGkscik9PnJrW2ldPXIvTWF0aC5tYXgoMSxwcy5sZW5ndGgtMSkpO3JldHVybiBya307CmNvbnN0IHBvcHNGcm9tT2Rkcz1vZD0+b2QubWFwKHY9PjErb2QuZmlsdGVyKHc9Pnc8dikubGVuZ3RoKTsKCmNvbnN0IGdldFBsYWNlTW9kZWw9KCk9Pnt0cnl7Y29uc3QgbT1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKFBMS0VZKXx8Im51bGwiKTtyZXR1cm4gbSYmbS5raW5kPT09Im5ldyImJm0ubW9kZWwmJm0udmVyPT09Mj9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKCi8qIOWPjeW/nOOBrueiuuiqjeeUqO+8muS6iOa4rOOBruWMuumWk+OBlOOBqOOBruWun+e4vu+8iOS/oemgvOaAp++8iSAqLwpmdW5jdGlvbiByZWxpYWJpbGl0eUJpbnMocCx5LEIpewogY29uc3QgaWR4PXAubWFwKChfLGkpPT5pKS5zb3J0KChhLGIpPT5wW2FdLXBbYl0pLG49eS5sZW5ndGgsb3V0PVtdOwogZm9yKGxldCBiPTA7YjxCO2IrKyl7CiAgY29uc3Qgcz1pZHguc2xpY2UoTWF0aC5mbG9vcihiKm4vQiksTWF0aC5mbG9vcigoYisxKSpuL0IpKTtpZighcy5sZW5ndGgpY29udGludWU7CiAgY29uc3Qgaz1zLnJlZHVjZSgoYSxpKT0+YSt5W2ldLDApLHc9d2lsc29uKGsscy5sZW5ndGgpOwogIG91dC5wdXNoKHtsbzpwW3NbMF1dLGhpOnBbc1tzLmxlbmd0aC0xXV0sbjpzLmxlbmd0aCxtZWFuOnMucmVkdWNlKChhLGkpPT5hK3BbaV0sMCkvcy5sZW5ndGgsYWN0Omsvcy5sZW5ndGgsd2xvOndbMF0sd2hpOndbMV19KTsKIH0KIHJldHVybiBvdXQ7Cn0KZnVuY3Rpb24gdGhyZXNob2xkUm93KHAseSx0KXsKIGxldCBuPTAsaz0wO2ZvcihsZXQgaT0wO2k8cC5sZW5ndGg7aSsrKWlmKHBbaV0+PXQpe24rKztrKz15W2ldfQogY29uc3Qgdz13aWxzb24oayxuKTtyZXR1cm57dCxuLGsscmF0ZTpuP2svbjowLGxvOndbMF0saGk6d1sxXX07Cn0KCi8qIC0tLS0tLS0tLS0g56m06aas44K+44O844Oz77yI5Lq65rCX44Gu5LiL5L2N77yJ44Gn44Gu5qSc6Ki8IC0tLS0tLS0tLS0KICAg56m06aas77yd5Lq65rCX6aCG5L2N44GMIG1heCg1LCDpoK3mlbDjga40MCXliIfjgorkuIrjgZIpIOS7peS4i+OBrummrOOAguipleS+oShTL0EvQi9DKeOBr+OAgeWtpue/kuWBtOOBrueptOmmrOOBruS6iOa4rOeiuueOh+OBruS4iuS9jTQl77yPMTIl77yPMzAl44Gn5Yy65YiH44KLICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRQYXlNYXAoKXsKIGNvbnN0IG09bmV3IE1hcCgpOwogdHJ5e2Zvcihjb25zdCBkYXkgb2YgYXdhaXQgcGF5QWxsKCkpZm9yKGNvbnN0IHIgb2YgKGRheS5yYWNlc3x8W10pKWlmKHIucmFjZUlkJiZyLnBsYWNlKW0uc2V0KHIucmFjZUlkLHIucGxhY2UpfWNhdGNoKGUpe30KIHJldHVybiBtOwp9CmZ1bmN0aW9uIGhvbGVFdmFsKG1vZGVsLHhmLHRyYWluLHRlc3QscGF5TWFwLHRlc3REYXlzKXsKIGNvbnN0IHNvcnRlZD1bXTsKIGZvcihjb25zdCByIG9mIHRyYWluKXtjb25zdCB2PW5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobW9kZWwseGYoaCkpKSwzKTtyLmguZm9yRWFjaCgoaCxqKT0+e2lmKGguaG9sZSlzb3J0ZWQucHVzaCh2W2pdKX0pfQogc29ydGVkLnNvcnQoKGEsYik9PmItYSk7CiBjb25zdCBxPWY9PnNvcnRlZFtNYXRoLm1pbihzb3J0ZWQubGVuZ3RoLTEsTWF0aC5tYXgoMCxNYXRoLnJvdW5kKHNvcnRlZC5sZW5ndGgqZiktMSkpXTsKIGNvbnN0IGN1dHM9e1M6cSguMDQpLEE6cSguMTIpLEI6cSguMzApfTsKIGNvbnN0IGdyYWRlPXA9PnA+PWN1dHMuUz8iUyI6cD49Y3V0cy5BPyJBIjpwPj1jdXRzLkI/IkIiOiJDIjsKIGNvbnN0IHRhYj17Uzp7bjowLGs6MCxwYjowLHBheTowfSxBOntuOjAsazowLHBiOjAscGF5OjB9LEI6e246MCxrOjAscGI6MCxwYXk6MH0sQzp7bjowLGs6MCxwYjowLHBheTowfX07CiBjb25zdCByaz17bmV3Ont0MTp7bjowLGs6MCxwYjowLHBheTowfSx0Mjp7bjowLGs6MCxwYjowLHBheTowfX0scFA6e3QxOntuOjAsazowLHBiOjAscGF5OjB9LHQyOntuOjAsazowLHBiOjAscGF5OjB9fSxta3Q6e3QxOntuOjAsazowLHBiOjAscGF5OjB9LHQyOntuOjAsazowLHBiOjAscGF5OjB9fX07CiBsZXQgbkhvbGU9MCxrSG9sZT0wO2NvbnN0IHBIb2xlPVtdLHlIb2xlPVtdOwogY29uc3QgYmV0PShzdCxyLGgpPT57c3QubisrO3N0LmsrPWgueTtjb25zdCBwbD1wYXlNYXAmJnBheU1hcC5nZXQoci5yYWNlSWQpO2lmKHBsKXtzdC5wYisrO2NvbnN0IGhpdD1wbC5maW5kKHg9PngubnVtYmVyPT09aC5udW0pO2lmKGhpdClzdC5wYXkrPWhpdC55ZW59fTsKIGZvcihjb25zdCByIG9mIHRlc3QpewogIGNvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpLGhzPVtdOwogIHIuaC5mb3JFYWNoKChoLGopPT57aWYoIWguaG9sZSlyZXR1cm47aHMucHVzaCh7aCxwOnZbal19KTtiZXQodGFiW2dyYWRlKHZbal0pXSxyLGgpO25Ib2xlKys7a0hvbGUrPWgueTtwSG9sZS5wdXNoKHZbal0pO3lIb2xlLnB1c2goaC55KX0pOwogIGNvbnN0IGJ5PShmKT0+aHMuc2xpY2UoKS5zb3J0KGYpOwogIGNvbnN0IG9yZGVycz17bmV3OmJ5KChhLGIpPT5iLnAtYS5wKSxwUDpieSgoYSxiKT0+Yi5oLnBQLWEuaC5wUCksbWt0OmJ5KChhLGIpPT5hLmgucG9wLWIuaC5wb3ApfTsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhvcmRlcnMpKXtvcmRlcnNba10uc2xpY2UoMCwxKS5mb3JFYWNoKHo9PmJldChya1trXS50MSxyLHouaCkpO29yZGVyc1trXS5zbGljZSgwLDIpLmZvckVhY2goej0+YmV0KHJrW2tdLnQyLHIsei5oKSl9CiB9CiBjb25zdCBmaW49c3Q9Pntjb25zdCB3PXdpbHNvbihzdC5rLHN0Lm4pO3JldHVybntuOnN0Lm4sazpzdC5rLHJhdGU6c3Qubj9zdC5rL3N0Lm46MCxsbzp3WzBdLGhpOndbMV0scGVyRGF5OnRlc3REYXlzP3N0Lm4vdGVzdERheXM6MCxyb2k6c3QucGI/c3QucGF5LygxMDAqc3QucGIpOm51bGwscGI6c3QucGJ9fTsKIGNvbnN0IHRhYkY9e307Zm9yKGNvbnN0IGcgb2YgWyJTIiwiQSIsIkIiLCJDIl0pdGFiRltnXT1maW4odGFiW2ddKTsKIGNvbnN0IHJrRj17fTtmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhyaykpcmtGW2tdPXt0MTpmaW4ocmtba10udDEpLHQyOmZpbihya1trXS50Mil9OwogcmV0dXJue2N1dHMsdGFiOnRhYkYscmFuazpya0YsbkhvbGUsYmFzZVJhdGU6bkhvbGU/a0hvbGUvbkhvbGU6MCxhdWM6YXVjT2YocEhvbGUseUhvbGUpfTsKfQpjb25zdCBncmFkZUhvbGU9KGN1dHMscCk9PnA+PWN1dHMuUz8iUyI6cD49Y3V0cy5BPyJBIjpwPj1jdXRzLkI/IkIiOiJDIjsKCi8qIC0tLS0tLS0tLS0g5qSc6Ki844Go5YaN5qCh5q2j44Gu5pys5L2TIC0tLS0tLS0tLS0gKi8KYXN5bmMgZnVuY3Rpb24gcnVuUGxhY2VGaXQob3B0cyl7CiBvcHRzPW9wdHN8fHt9OwogY29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IjIwMTktMDEtMDEiLFRFU1Q9b3B0cy50ZXN0U3RhcnR8fE1PREVMX1RSQUlOX0VORDsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBwYXlNYXA9b3B0cy5wYXlNYXB8fGF3YWl0IGxvYWRQYXlNYXAoKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogd2ZTeW5jKHJhY2VzKTsKIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgUG9wUHJpKCksUlM9W10sZHJhd1A9bmV3IERyYXdQcmkoKSxzaXJlUD1uZXcgU2lyZVByaSgpLHRyTT1uZXcgTWFwKCk7CiBjb25zdCBjb3Y9e3JhY2VzOjAsZ29pbmdSYWNlczowLGhvcnNlczowLHRyYWluZXI6MCxzaXJlOjB9OwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpLE49Ui5sZW5ndGg7CiAgY29uc3QgdmFsaWQ9Tj49OCYmUi5ldmVyeShyPT5yLnBvcD4wKSYmUi5zb21lKHI9PnIuZmluaXNoPT09MSk7CiAgaWYodmFsaWQmJnJjLmRhdGU+PVNUQVJUJiYhL+manOWusy8udGVzdChTdHJpbmcoUlswXS5yYWNlTmFtZXx8IiIpKSl7CiAgIGNvbnN0IG9kPVIuZXZlcnkocj0+ci5vZGRzPjEpP1IubWFwKHI9PnIub2Rkcyk6bnVsbDsKICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LGx2bDpSWzBdLmx2bHx8MCxncmQ6UlswXS5ncmR8fDAscnVubmVyczpSfTsKICAgdHJ5ewogICAgY29uc3Qgd2M9d2ZHZXQocmMucm93c1swXS5yYWNlSWQpOyAgIC8vIOazouS5seW6puOBruaknOiovOOBqOWFseaciQogICAgaWYoIXdjLm5QKXdjLm5QPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG51bGwpLnBQOwogICAgaWYob2QmJiF3Yy5vUCl3Yy5vUD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCkucE87CiAgICBjb25zdCBhcD17cFA6d2MublB9LGFwTz1vZD97cE86d2Mub1B9Om51bGwscms9cmFua0ZyYWNzKGFwLnBQKTsKICAgIGNvbnN0IGN1dEg9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpLHJjST17Z2M6UlswXS5nY3x8MCx2OnZlbnVlRnJvbUlkKHJjLnJvd3NbMF0ucmFjZUlkKSxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxOfSxjdHg9e2RyYXc6ZHJhd1AsdHI6dHJNLHNpcmU6c2lyZVAscGVkOlBFRH0sYmI9TWF0aC5taW4oLjUsMy9OKTsKICAgIGNvdi5yYWNlcysrO2lmKHJjSS5nYz4wKWNvdi5nb2luZ1JhY2VzKys7CiAgICBSUy5wdXNoKHtkYXRlOnJjLmRhdGUscmFjZUlkOnJjLnJvd3NbMF0ucmFjZUlkLE4saDpSLm1hcCgocixqKT0+e2NvbnN0IGU9ZXh0RmVhdEhvcnNlKHIsc3RvcmUuaC5nZXQoci5ob3JzZSkscmNJLGN0eCxiYik7Y292LmhvcnNlcysrO2lmKGVbNF0pY292LnRyYWluZXIrKztpZihlWzZdfHxlWzhdKWNvdi5zaXJlKys7cmV0dXJue3g6cGxhY2VYKGFwLnBQW2pdLHIucG9wLE4scHJpLHJrW2pdKSxlLHk6ci5maW5pc2g8PTM/MTowLHBQOmFwLnBQW2pdLHByOnByaS5yYXRlKHIucG9wLE4pLHBPOmFwTz9hcE8ucE9bal06bnVsbCxudW06ci5udW0scG9wOnIucG9wLGhvbGU6ci5wb3A+PWN1dEh9fSl9KTsKICAgfWNhdGNoKGUpe30KICB9CiAgaWYodmFsaWQpcHJpLmFkZChSLm1hcChyPT5bci5wb3Asci5maW5pc2hdKSxOKTsKICBpZihOPj04KXtjb25zdCB2dj12ZW51ZUZyb21JZChyYy5yb3dzWzBdLnJhY2VJZCk7Zm9yKGNvbnN0IHIgb2YgUil7Y29uc3QgdDM9ci5maW5pc2g8PTM/MTowO2RyYXdQLmFkZCh2dixSWzBdLnN1cmYsUlswXS5kaXN0LHIubnVtLE4sdDMpO3NpcmVQLmFkZChQRURbci5ob3JzZV0sUlswXS5zdXJmLFJbMF0uZGlzdCx0MyxOKTtpZihyLnRyYWluZXIpe2xldCB0PXRyTS5nZXQoci50cmFpbmVyKTtpZighdCl0ck0uc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO3QudDMrPXQzfX19CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgcmMucm93cz1udWxsOyAgIC8vIOS9v+OBhOe1guOBiOOBn+ihjOOCkuino+aUvu+8iOODoeODouODquevgOe0hO+8iQogIGlmKGklMzA9PT0yOSl7YnVzeSh0cnVlLGDmmYLns7vliJfjgavlho3nj77jgZfjgabmpJzoqLzkuK3igKYgJHtpKzF9LyR7cmFjZXMubGVuZ3RofeODrOODvOOCuWApO2F3YWl0IHNsZWVwKDApfQogfQogYnVzeSh0cnVlLCLjg6Ljg4fjg6vjgpLmr5TovIPkuK3igKYiKTthd2FpdCBzbGVlcCgwKTsKIGNvbnN0IHRyYWluPVJTLmZpbHRlcihyPT5yLmRhdGU8VEVTVCksdGVzdD1SUy5maWx0ZXIocj0+ci5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17blRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCxzdGFydDpTVEFSVCx0ZXN0U3RhcnQ6VEVTVH07CiBpZih0cmFpbi5sZW5ndGg8MTUwMHx8dGVzdC5sZW5ndGg8MzAwKXtidXN5KGZhbHNlKTtyZXR1cm57Li4ucmVzLGVycm9yOmDmpJzoqLzjgavkvb/jgYjjgovjg6zjg7zjgrnjgYzotrPjgorjgb7jgZvjgpPvvIjlrabnv5LlgbQke3RyYWluLmxlbmd0aH3jg7vmpJzoqLzlgbQke3Rlc3QubGVuZ3Rofe+8ieOAguaknOiovOOBrumWi+Wni+aXpeOCkuaXqeOCgeOCi+OBi+OAgeODh+ODvOOCv+OCkuWil+OChOOBl+OBpuOBj+OBoOOBleOBhOOAgmB9fQogLy8g5paw44Oi44OH44Or77ya5a2m57+S5YG044Gu44G/44Gn5L2c44KL44CC44CM6L+95Yqg44Gu5p2h5Lu277yI6aas5aC044O75p6g6aCG44O76Kq/5pWZ5bir44O76KGA57Wx77yJ44GC44KK44CN44Go44CM44Gq44GX44CN44GuMumAmuOCiuOCkuavlOOBueOCiwogY29uc3QgeT1bXSxYYj1bXSxYZT1bXTtmb3IoY29uc3QgciBvZiB0cmFpbilmb3IoY29uc3QgaCBvZiByLmgpe3kucHVzaChoLnkpO1hiLnB1c2goaC54KTtYZS5wdXNoKFsuLi5oLngsLi4uaC5lXSl9CiBjb25zdCBtb2RlbEI9Zml0TG9naXQoWGIseSw1KSxtb2RlbEU9Zml0TG9naXQoWGUseSw1KTsKIGNvbnN0IGZsYXQ9Zj0+e2NvbnN0IHA9W10seXk9W107Zm9yKGNvbnN0IHIgb2YgdGVzdCl7Y29uc3Qgdj1mKHIpO3IuaC5mb3JFYWNoKChoLGopPT57cC5wdXNoKHZbal0pO3l5LnB1c2goaC55KX0pfXJldHVybntwLHk6eXl9fTsKIGNvbnN0IHhCPWg9PmgueCx4RT1oPT5bLi4uaC54LC4uLmguZV07CiBjb25zdCBldmFsTT0obSx4Zik9Pntjb25zdCBkPWZsYXQocj0+bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtLHhmKGgpKSksMykpO3JldHVybntkLG1ldDptZXRyaWNzT2YoZC5wLGQueSl9fTsKIGNvbnN0IEVCPWV2YWxNKG1vZGVsQix4QiksRUU9ZXZhbE0obW9kZWxFLHhFKTsKIGNvbnN0IHVzZUV4dD1FRS5tZXQubGw8PUVCLm1ldC5sbC0uMDAxOyAgIC8vIOi/veWKoOOBruadoeS7tuOBp+OAgeWvvuaVsOaQjeWkseOBjDAuMDAx5Lul5LiK6Imv44GP44Gq44Gj44Gf44Go44GN44Gg44GR5L2/44GGCiBjb25zdCBtb2RlbD11c2VFeHQ/bW9kZWxFOm1vZGVsQix4Zj11c2VFeHQ/eEU6eEIsZE5ldz11c2VFeHQ/RUUuZDpFQi5kOwogcmVzLm1CYXNlPUVCLm1ldDtyZXMubUV4dD1FRS5tZXQ7cmVzLnVzZUV4dD11c2VFeHQ7cmVzLmNvdj17Li4uY292LGdvaW5nU2hhcmU6Y292LnJhY2VzP2Nvdi5nb2luZ1JhY2VzL2Nvdi5yYWNlczowLHRyYWluZXJTaGFyZTpjb3YuaG9yc2VzP2Nvdi50cmFpbmVyL2Nvdi5ob3JzZXM6MCxzaXJlU2hhcmU6Y292LmhvcnNlcz9jb3Yuc2lyZS9jb3YuaG9yc2VzOjAscGVkSG9yc2VzOk9iamVjdC5rZXlzKFBFRCkubGVuZ3RofTsKIGNvbnN0IGRQUD1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5sZ3QoaC5wUCkpLDMpKTsKIGNvbnN0IGRNaz1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5sZ3QoaC5wcikpLDMpKTsKIHJlcy5tTmV3PW1ldHJpY3NPZihkTmV3LnAsZE5ldy55KTtyZXMubVBQPW1ldHJpY3NPZihkUFAucCxkUFAueSk7cmVzLm1Naz1tZXRyaWNzT2YoZE1rLnAsZE1rLnkpOwogLy8g54++6KGM44Gu44Kq44OD44K66L6844G/56K6546HKHBPKeOBr+OAgeOCquODg+OCuuOBpOOBjeOBruaIkOe4vuOBjOOBguOCi+acn+mWk+OBoOOBkeavlOOBueOCieOCjOOCiwogY29uc3Qgc3ViPXRlc3QuZmlsdGVyKHI9PnIuaC5ldmVyeShoPT5oLnBPIT1udWxsKSk7CiByZXMubk9kZHNUZXN0PXN1Yi5sZW5ndGg7CiBpZihzdWIubGVuZ3RoPj0xNTApewogIGNvbnN0IHBuPVtdLHBvPVtdLHl5PVtdO2Zvcihjb25zdCByIG9mIHN1Yil7Y29uc3Qgdj1ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLHhmKGgpKSksMyk7ci5oLmZvckVhY2goKGgsaik9Pntwbi5wdXNoKHZbal0pO3BvLnB1c2goaC5wTyk7eXkucHVzaChoLnkpfSl9CiAgcmVzLm1OZXdPZGRzPW1ldHJpY3NPZihwbix5eSk7cmVzLm1PZGRzPW1ldHJpY3NPZihwbyx5eSk7CiB9CiAvLyDmjqHnlKjjga7liKTmlq0KIGNvbnN0IG09cmVzLm1OZXc7CiBsZXQgYWRvcHQ9bS5sbDxyZXMubVBQLmxsLS4wMDMmJm0ubGw8cmVzLm1Nay5sbC0uMDAzOwogaWYoYWRvcHQmJnJlcy5tT2RkcylhZG9wdD1yZXMubU5ld09kZHMubGw8PXJlcy5tT2Rkcy5sbC0uMDAwNTsKIHJlcy5hZG9wdD1hZG9wdDtyZXMudnNPZGRzPXJlcy5tT2Rkcz8i5q+U6LyD5riI44G/Ijoi5pyq5q+U6LyDIjsKIC8vIOS/oemgvOaAp++8muS6iOa4rOOBruWMuumWk+OBlOOBqOOBruWun+mam+OBrueahOS4reeOhwogcmVzLmJpbnM9cmVsaWFiaWxpdHlCaW5zKGROZXcucCxkTmV3LnksMTApOwogcmVzLnRlc3REYXlzPW5ldyBTZXQodGVzdC5tYXAocj0+ci5kYXRlKSkuc2l6ZTsKIHJlcy5ob2xlPWhvbGVFdmFsKG1vZGVsLHhmLHRyYWluLHRlc3QscGF5TWFwLHJlcy50ZXN0RGF5cyk7CiByZXMudGhyPVsuNSwuNywuOCwuODUsLjg4LC45LC45MiwuOTMsLjk1LC45N10ubWFwKHQ9PnRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LHQpKTsKIHJlcy5iaW5zUFA9cmVsaWFiaWxpdHlCaW5zKGRQUC5wLGRQUC55LDEwKTsKIC8vIOi2hemJhOadv++8neS6iOa4rDk1JeS7peS4iuOBrummrO+8iOS9lemgreOBp+OCgu+8ieOAguaknOiovOWBtOOBp+OAgeWun+mam+OBq+OBqeOCjOOBoOOBkeW9k+OBn+OBo+OBn+OBi+OCkuiomOmMsuOBmeOCiwogbGV0IGlyb249bnVsbDsKIHtjb25zdCByb3c9dGhyZXNob2xkUm93KGROZXcucCxkTmV3LnksLjk1KSxkYXlzPW5ldyBTZXQodGVzdC5tYXAocj0+ci5kYXRlKSkuc2l6ZTsKICBpZihyb3cubj4wKWlyb249e2N1dDouOTUscmF0ZTpyb3cucmF0ZSxsbzpyb3cubG8sbjpyb3cubixwZXJEYXk6ZGF5cz9yb3cubi9kYXlzOjAsbG93Tjpyb3cubjwxMDB9O30KIHJlcy5pcm9uPWlyb247CiByZXMubW9kZWw9YWRvcHQ/e3ZlcjoyLGtpbmQ6Im5ldyIsZXh0OnVzZUV4dCxtb2RlbCxpcm9uLGF0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHRlc3REYXlzOnJlcy50ZXN0RGF5cyx0ZXN0U3RhcnQ6VEVTVCxob2xlQ3V0czpyZXMuaG9sZS5jdXRzLGhvbGVTdGF0czp7dGFiOnJlcy5ob2xlLnRhYixyYW5rOnJlcy5ob2xlLnJhbmssYmFzZVJhdGU6cmVzLmhvbGUuYmFzZVJhdGV9LAogIG1OZXc6cmVzLm1OZXcsbVBQOnJlcy5tUFAsbU1rOnJlcy5tTWssbU9kZHM6cmVzLm1PZGRzfHxudWxsLG1OZXdPZGRzOnJlcy5tTmV3T2Rkc3x8bnVsbCx0aHI6cmVzLnRocn06bnVsbDsKIGJ1c3koZmFsc2UpO3JldHVybiByZXM7Cn0KCmZ1bmN0aW9uIHBsYWNlUmVwb3J0KHIpewogaWYoci5lcnJvcilyZXR1cm5gPHNwYW4gY2xhc3M9ImJhZCI+JHtlc2Moci5lcnJvcil9PC9zcGFuPmA7CiBjb25zdCBmPXg9PngudG9GaXhlZCg0KSxyb3c9KGwsbSk9PmA8dHI+PHRkPiR7bH08L3RkPjx0ZD4ke2YobS5sbCl9PC90ZD48dGQ+JHtmKG0uYnJpZXIpfTwvdGQ+PHRkPiR7bS5hdWMudG9GaXhlZCgzKX08L3RkPjx0ZD4keyhtLmVjZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PC90cj5gOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lrabnv5LlgbQgJHtyLm5UcmFpbn3jg6zjg7zjgrnvvI/mpJzoqLzlgbQgJHtyLm5UZXN0feODrOODvOOCue+8iCR7ZXNjKHIudGVzdFN0YXJ0KX3ku6XpmY3vvJ3nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvInjgIIx6aCt44GU44Go44Gr44CMM+edgOS7peWGheOAjeOCkuW9k+OBpuOBn+aIkOe4vuOBp+OBme+8iDjpoK3ku6XkuIrjga7jg6zjg7zjgrnvvInjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7norrnjofjga7jgoLjgajvvIjmpJzoqLzlgbTvvIk8L3RoPjx0aD7lr77mlbDmkI3lpLHihpM8L3RoPjx0aD7oqqTlt67ihpM8L3RoPjx0aD5BVUPihpE8L3RoPjx0aD7ovIPmraPoqqTlt67ihpM8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+CiAke3Jvdygi6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/IixyLm1QUCl9JHtyb3coIuS6uuawl+mghuS9jeOBruWun+e4vuOBruOBvyIsci5tTWspfSR7cm93KCI8Yj7mlrDvvIjkuKHmlrnjgpLntYTjgb/lkIjjgo/jgZvvvIk8L2I+IixyLm1OZXcpfTwvdGJvZHk+PC90YWJsZT48L2Rpdj5gOwogaWYoci5tT2RkcyloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBpOOBjeOBruaknOiovOODh+ODvOOCvyAke3Iubk9kZHNUZXN0feODrOODvOOCueOBp+OBruebtOaOpeavlOi8g++8muePvuihjO+8iOOCquODg+OCuui+vOOBv++8ieOBruWvvuaVsOaQjeWksSAke2Yoci5tT2Rkcy5sbCl9IO+8jyDmlrAgJHtmKHIubU5ld09kZHMubGwpfTwvZGl2PmA7CiBlbHNlIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7jgqrjg4PjgrrjgaTjgY3jga7mpJzoqLzjg4fjg7zjgr/jgYzlsJHjgarjgYTjgZ/jgoHjgIHnj77ooYzjga7jgIzjgqrjg4Pjgrrovrzjgb/jga7norrnjofjgI3jgajjga7nm7TmjqXmr5TovIPjga/jgafjgY3jgabjgYTjgb7jgZvjgpPvvIjkurrmsJfpoIbkvY3jga/jgIHjgqrjg4Pjgrrlj5blvpflvozjgavmsbrjgb7jgovlgKTjgpLkvb/jgaPjgabjgYTjgb7jgZnvvInjgII8L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9ImJhbm5lciAke3IuYWRvcHQ/Im9rIjoid24ifSI+PGI+57WQ5p6c77yaJHtyLmFkb3B0PyLmlrDjg6Ljg4fjg6vjgpLmjqHnlKjvvIjpgLHmnKvjga7kuojmg7Pjga7norrnjofjgavlj43mmKDvvIkiOiLnj77ooYzjga7jgb7jgb7vvIjmlrDjg6Ljg4fjg6vjga/mmI7norrjgavjga/oia/jgY/jgarjgonjgarjgYvjgaPjgZ/vvIkifTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mjqHnlKjmnaHku7bvvJrpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7jgb/jg7vkurrmsJfpoIbkvY3jga7jgb/jga7kuKHmlrnjgojjgorjgIHlr77mlbDmkI3lpLHjgYwwLjAwM+S7peS4iuiJr+OBhOOBk+OBqOOAgiR7ci5tT2Rkcz8i44GV44KJ44Gr54++6KGM77yI44Kq44OD44K66L6844G/77yJ44KI44KK6Imv44GE44GT44Go44CCIjoiIn08L3NwYW4+PC9kaXY+YDsKIGgrPWV4dFJlcG9ydChyKTsKIGgrPWhvbGVSZXBvcnQocik7CiBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuS6iOa4rOOBruWMuumWk+OBlOOBqOOBrjxiPuWun+mam+OBrueahOS4reeOhzwvYj7vvIjmpJzoqLzlgbTjgILkuojmuKzjgajlrp/pmpvjgYzov5HjgYTjgbvjganmraPnorrvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5ris44Gu56+E5ZuyPC90aD48dGg+6aCt5pWwPC90aD48dGg+5LqI5ris44Gu5bmz5Z2HPC90aD48dGg+5a6f6ZqbPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgYiBvZiByLmJpbnMpaCs9YDx0cj48dGQ+JHtwY3QoYi5sbyl944CcJHtwY3QoYi5oaSl9PC90ZD48dGQ+JHtiLm59PC90ZD48dGQ+JHtwY3QoYi5tZWFuLDEpfTwvdGQ+PHRkPjxiPiR7cGN0KGIuYWN0LDEpfTwvYj48L3RkPjwvdHI+YDsKIGgrPWA8L3Rib2R5PjwvdGFibGU+PC9kaXY+PGRpdiBjbGFzcz0ic21hbGwiPumrmOOBhOS6iOa4rOOBruWun+e4vu+8iOaknOiovOWBtO+8iTwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7kuojmuKw8L3RoPjx0aD7poK3mlbA8L3RoPjx0aD4x5pel44GC44Gf44KKPC90aD48dGg+5a6f6Zqb44Gu55qE5Lit546HPC90aD48dGg+OTUl44Gu5bmFPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgdCBvZiByLnRociloKz1gPHRyPjx0ZD4ke3BjdCh0LnQpfeS7peS4ijwvdGQ+PHRkPiR7dC5ufTwvdGQ+PHRkPiR7ci50ZXN0RGF5cz8odC5uL3IudGVzdERheXMpLnRvRml4ZWQoMik6Ii0ifemgrTwvdGQ+PHRkPjxiPiR7cGN0KHQucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QodC5sbywxKX3jgJwke3BjdCh0LmhpLDEpfTwvdGQ+PC90cj5gOwogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogaWYoci5pcm9uKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+6LaF6YmE5p2/77yI5LqI5risOTUl5Lul5LiK44O76aCt5pWw44Gu5Yi26ZmQ44Gq44GX77yJ77yaPC9iPuaknOiovOWBtOOBp+OAgeWun+mam+OBqyR7cGN0KHIuaXJvbi5yYXRlLDEpfeOBjDPnnYDku6XlhoXvvIgke3IuaXJvbi5ufemgreOAgTk1JeOBruW5hSAke3BjdChyLmlyb24ubG8sMSl944CcJHtwY3Qoci5pcm9uLmhpLDEpfeOAgTHml6XjgYLjgZ/jgorntIQke3IuaXJvbi5wZXJEYXkudG9GaXhlZCgyKX3poK0ke3IuaXJvbi5sb3dOPyLjgILpoK3mlbDjgYzlsJHjgarjgoHjgafluYXjgYzluoPjgYQiOiIife+8ieOAgiR7ci5pcm9uLnJhdGU+PS45NT8iIjoiPHNwYW4gY2xhc3M9XCJ3YXJuXCI+OTUl44Gr44Gv5bGK44GE44Gm44GE44G+44Gb44KT44CCPC9zcGFuPiJ9PC9kaXY+YDsKIGVsc2UgaCs9JzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuaknOiovOWBtOOBq+OAgeS6iOa4rDk1JeS7peS4iuOBrummrOOBr+OBhOOBvuOBm+OCk+OBp+OBl+OBn++8iOi2hemJhOadv+OBr+WHuuOBquOBhOOAgeOBvuOBn+OBr+WHuuOBpuOCguOBlOOBj+WwkeaVsOOBp+OBme+8ieOAgjwvZGl2Pic7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBleHRSZXBvcnQocil7CiBpZighci5tRXh0KXJldHVybiIiOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCksY3Y9ci5jb3Z8fHt9OwogbGV0IGg9YDxoMz7ov73liqDjga7mnaHku7bvvIjppqzloLTnirbmhYvjg7vmnqDpoIbjg7voqr/mlZnluKvjg7vooYDntbHvvInjga7lirnmnpw8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7norrnjofjga7jgoLjgajvvIjmpJzoqLzlgbTvvIk8L3RoPjx0aD7lr77mlbDmkI3lpLHihpM8L3RoPjx0aD5BVUPihpE8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+PHRyPjx0ZD7ov73liqDjga7mnaHku7bjgarjgZc8L3RkPjx0ZD4ke2Yoci5tQmFzZS5sbCl9PC90ZD48dGQ+JHtyLm1CYXNlLmF1Yy50b0ZpeGVkKDMpfTwvdGQ+PC90cj48dHI+PHRkPui/veWKoOOBruadoeS7tuOBguOCijwvdGQ+PHRkPiR7ZihyLm1FeHQubGwpfTwvdGQ+PHRkPiR7ci5tRXh0LmF1Yy50b0ZpeGVkKDMpfTwvdGQ+PC90cj48L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLnVzZUV4dD8ib2siOiJ3biJ9Ij48Yj4ke3IudXNlRXh0PyLov73liqDjga7mnaHku7bjgpLkvb/jgYbjgajmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHjgIHmjqHnlKjjgZfjgb7jgZfjgZ/jgIIiOiLov73liqDjga7mnaHku7bjgpLliqDjgYjjgabjgoLjgIHmmI7norrjgarmlLnlloTvvIjlr77mlbDmkI3lpLEwLjAwMeS7peS4iu+8ieOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeS9v+OBo+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9iPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuODh+ODvOOCv+OBruWFhei2s+eOh++8iOWtpue/kuODu+aknOiovOWFqOS9k++8ie+8mummrOWgtOeKtuaFi+OBjOWIhuOBi+OCi+ODrOODvOOCuSAke3BjdChjdi5nb2luZ1NoYXJlfHwwLDApfe+8j+iqv+aVmeW4q+OBjOWIhuOBi+OCi+mmrCAke3BjdChjdi50cmFpbmVyU2hhcmV8fDAsMCl977yP6KGA57Wx44GM5YiG44GL44KL6aasICR7cGN0KGN2LnNpcmVTaGFyZXx8MCwwKX3vvIjok4TnqY3jgZfjgZ/ooYDntbEgJHtjdi5wZWRIb3JzZXN8fDB96aCt77yJ77yP5ZCM44GY44Os44O844K544GMQ1NW44Go5Y+W5b6X44OH44O844K/44Gu5Lih5pa544Gr44GC44Gj44GfICR7RkVfRFVQU33jg6zjg7zjgrnjga/jgIHph43opIfjgpLpmaTlpJbjgZfjgb7jgZfjgZ/jgIIkeyhjdi5nb2luZ1NoYXJlfHwwKTwuMz8i6aas5aC054q25oWL44Gv44CB6Kit5a6a44Gu44CM44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX44CN44Gn44CB6YGO5Y6744Gu5oiQ57i+44KS5Y+W44KK55u044GZ44Go5aKX44GI44G+44GZ44CCIjoiIn0keyhjdi5zaXJlU2hhcmV8fDApPC4zPyIg6KGA57Wx44Gv44CB5q+O6YCx44Gu44CM5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44CN44Gn5Ye66aas6KGo44GL44KJ5bCR44GX44Ga44Gk6JOE56mN44GV44KM44G+44GZ44CCIjoiIn08L2Rpdj5gOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gaG9sZVJlcG9ydChyKXsKIGNvbnN0IEg9ci5ob2xlO2lmKCFIfHwhSC5uSG9sZSlyZXR1cm4iIjsKIGNvbnN0IHJvaT14PT54LnJvaT09bnVsbD8iLSI6cGN0KHgucm9pLDApOwogbGV0IGg9YDxoMz7nqbTppqzvvIjkurrmsJfjga7kuIvkvY3vvInjgafjga7miJDnuL7vvIjmpJzoqLzlgbTvvIk8L2gzPjxkaXYgY2xhc3M9InNtYWxsIj7nqbTppqzvvJ3kurrmsJfpoIbkvY3jgYwgbWF4KDUsIOmgreaVsOOBrjQwJSnku6XkuIvjga7ppqzjgILmpJzoqLzlgbTjga7nqbTppqwgJHtILm5Ib2xlfemgreOBruW5s+Wdh+eahOS4reeOh+OBryAke3BjdChILmJhc2VSYXRlLDEpfeOAgeaWsOODouODh+ODq+OBruS6iOa4rOOBruitmOWIpeWKm++8iEFVQ++8ieOBryAke0guYXVjLnRvRml4ZWQoMyl944CC6KmV5L6h44Gv44CB5a2m57+S5YG044Gu56m06aas44Gu5LqI5ris56K6546H44Gu5LiK5L2NNCXvvJ1T44CBMTIl77ydQeOAgTMwJe+8nULjgIHjgZ3jgozku6XlpJbvvJ1DIOOBp+WMuuWIh+OCiuOBvuOBl+OBn++8iFPvvJrkuojmuKwke3BjdChILmN1dHMuUywxKX3ku6XkuIrjgIFB77yaJHtwY3QoSC5jdXRzLkEsMSl95Lul5LiK44CBQu+8miR7cGN0KEguY3V0cy5CLDEpfeS7peS4iu+8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuipleS+oTwvdGg+PHRoPumgreaVsDwvdGg+PHRoPjHml6XjgYLjgZ/jgoo8L3RoPjx0aD7lrp/pmpvjga7nmoTkuK3njoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjx0aD7opIfli53lm57lj47njoc8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBnIG9mIFsiUyIsIkEiLCJCIiwiQyJdKXtjb25zdCB4PUgudGFiW2ddO2grPWA8dHI+PHRkPjxiPiR7Z308L2I+PC90ZD48dGQ+JHt4Lm59PC90ZD48dGQ+JHt4LnBlckRheS50b0ZpeGVkKDEpfemgrTwvdGQ+PHRkPjxiPiR7cGN0KHgucmF0ZSwxKX08L2I+PC90ZD48dGQ+JHtwY3QoeC5sbywxKX3jgJwke3BjdCh4LmhpLDEpfTwvdGQ+PHRkPiR7cm9pKHgpfTwvdGQ+PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48L2Rpdj48ZGl2IGNsYXNzPSJzbWFsbCI+44Os44O844K544GU44Go44Gr44CB56m06aas44Gu5Lit44GL44KJ5LiK5L2N44KS6YG444KT44Gg44Go44GN44Gu5oiQ57i+77yI55qE5Lit546H77yP6KSH5Yud5Zue5Y+O546H77yJ44CC44CM5paw44Oi44OH44Or44CN44GM44CB5LuW44Gu6YG444Gz5pa544KI44KK6auY44GE44GL44KS6KaL44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6YG444Gz5pa5PC90aD48dGg+MemgreOBoOOBkTwvdGg+PHRoPuS4iuS9jTLpoK08L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCBbayxsXSBvZiBbWyJuZXciLCLmlrDjg6Ljg4fjg6vjga7norrnjofjgYzpq5jjgYTpoIYiXSxbInBQIiwi6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/Il0sWyJta3QiLCLkurrmsJfjgYzpq5jjgYTpoIbvvIjluILloLTvvIkiXV0pe2NvbnN0IGE9SC5yYW5rW2tdLnQxLGI9SC5yYW5rW2tdLnQyO2grPWA8dHI+PHRkPiR7bH08L3RkPjx0ZD4ke3BjdChhLnJhdGUsMSl9IO+8jyAke3JvaShhKX08L3RkPjx0ZD4ke3BjdChiLnJhdGUsMSl9IO+8jyAke3JvaShiKX08L3RkPjwvdHI+YH0KIGgrPWA8L3Rib2R5PjwvdGFibGU+PC9kaXY+JHtILnRhYi5TLnBiPT09MD8nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+5omV5oi744OH44O844K/44GM5Y+W5b6X44Gn44GN44Gm44GE44Gq44GE44Gf44KB44CB5Zue5Y+O546H44Gv5Ye644Gb44Gm44GE44G+44Gb44KT77yI44CM6YGO5Y6744Os44O844K544KS5Y+W5b6X44CN44Gn5omV5oi744KC5Y+W5b6X44GV44KM44G+44GZ77yJ44CCPC9kaXY+JzonPGRpdiBjbGFzcz0ic21hbGwiPuWbnuWPjueOh+OBr+OAgTEwMOWGhuOBmuOBpOikh+WLneOCkuiyt+OBo+OBn+WgtOWQiOOBp+OBmeOAgjEwMCXjgpLotoXjgYjjgovosrfjgYTmlrnjga/jgIHjgb7jgaDnorroqo3jgafjgY3jgabjgYTjgb7jgZvjgpPjgII8L2Rpdj4nfWA7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBwbGFjZVN0YXR1c0xpbmUoKXsKIGNvbnN0IE09Z2V0UGxhY2VNb2RlbCgpOwogaWYoIU0pcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjofvvJrmqJnmupbjg6Ljg4fjg6vjga7mlbDlrZfjgafjgZnjgILjgIzmpJzoqLzjgI3jgr/jg5bjgafjgIHoh6rliIbjga7jg4fjg7zjgr/jgafjga7mpJzoqLzjg7vlho3moKHmraPjgYzjgafjgY3jgb7jgZnjgII8L2Rpdj4nOwogcmV0dXJuYDxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjofvvJo8Yj7lho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6s8L2I+44Gn6KGo56S65Lit77yI5qSc6Ki85pelICR7ZXNjKE0uYXQpfe+8j+aknOiovCAke00ublRlc3R944Os44O844K544CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44Gm44GC44KK44G+44GZ77yJ44CCPC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOODouODh+ODq+OBrueKtuaFi+OBruimi+OBiOOCi+WMluOBqOOAgeaTjeS9nOOBruOBvuOBqOOCgQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmxldCBEQVRBX0xBU1Q9IiI7CmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hEYXRhTGFzdCgpe3RyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtsZXQgbT0iIjtmb3IoY29uc3QgZiBvZiBmcylpZihmLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgmJmYuZGF0ZT5tKW09Zi5kYXRlO0RBVEFfTEFTVD1tfWNhdGNoKGUpe319CmNvbnN0IGRheXNCZXR3ZWVuPShhLGIpPT5NYXRoLnJvdW5kKChuZXcgRGF0ZShiKyJUMDA6MDA6MDBaIiktbmV3IERhdGUoYSsiVDAwOjAwOjAwWiIpKS84NjRlNSk7CmNvbnN0IEtJTkRfTkFNRT17b2xkOiLmqJnmupbjg6Ljg4fjg6vjga7jgb7jgb4iLG5ldzoi5YaN5qCh5q2j44GX44Gf5paw44Oi44OH44OrIixibGVuZDoi5qiZ5rqW44Go5paw44Oi44OH44Or44Gu5bmz5Z2HIn07Ci8qIOS7iuS9v+OBo+OBpuOBhOOCi+ODouODh+ODq+OBqOOAgeWGjeaknOiovOOBruebruWuie+8iOaknOiovOOBi+OCiTM15pel5Lul5LiK44CB44G+44Gf44Gv5qSc6Ki85b6M44Gr5oiQ57i+44GMMTTml6XliIbku6XkuIrlopfjgYjjgZ/jgonmj5DmoYjvvIkgKi8KZnVuY3Rpb24gbW9kZWxTdGF0dXNIdG1sKCl7CiBjb25zdCB0b2RheT1qc3RUb2RheSgpLFBNPWdldFBsYWNlTW9kZWwoKSxVTT1nZXRVcHNldE1vZGVsKCksRz1nZXRHYXRlKCk7CiBjb25zdCByb3c9KG5hbWUsc3RhdGUsZGV0YWlsLGFkdmljZSk9PmA8dHI+PHRkPjxiPiR7bmFtZX08L2I+PC90ZD48dGQ+JHtzdGF0ZX08L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7ZGV0YWlsfSR7YWR2aWNlP2A8YnI+PHNwYW4gY2xhc3M9Indhcm4iPiR7YWR2aWNlfTwvc3Bhbj5gOiIifTwvdGQ+PC90cj5gOwogY29uc3Qgc3RhbGU9KGF0KT0+e2lmKCFhdClyZXR1cm4iIjtjb25zdCBkPWRheXNCZXR3ZWVuKGF0LHRvZGF5KSxnYXA9REFUQV9MQVNUP2RheXNCZXR3ZWVuKGF0LERBVEFfTEFTVCk6MDtyZXR1cm4oZD49MzV8fGdhcD49MTQpP2DmpJzoqLzjgYvjgokke2R95pel77yI44Gd44Gu5b6M44Gu5oiQ57i+IOe0hCR7TWF0aC5tYXgoMCxnYXApfeaXpeWIhu+8ieOAguWGjeaknOiovOOCkuOBiuOBmeOBmeOCgeOBl+OBvuOBmeOAgmA6IiJ9OwogY29uc3Qgcm93cz1bXTsKIHJvd3MucHVzaChyb3coIuWlvei1sOeOhyIsUE0/YOWGjeagoeato+a4iOOBvyR7UE0uZXh0PyLvvIjov73liqDjga7mnaHku7bjgYLjgorvvIkiOiIifWA6Iuaomea6liIsUE0/YOaknOiovOaXpSAke2VzYyhQTS5hdCl977yP5qSc6Ki8ICR7UE0ublRlc3R944Os44O844K577yP5a++5pWw5pCN5aSxICR7UE0ubVBQP1BNLm1QUC5sbC50b0ZpeGVkKDQpOiItIn3vvIjpgY7ljrvmiJDnuL7jga7jgb/vvInihpIgJHtQTS5tTmV3P1BNLm1OZXcubGwudG9GaXhlZCg0KToiLSJ977yI5paw77yJYDoi44CM5qSc6Ki844CN44K/44OW44Gu44CM5aW96LWw546H44KS5qSc6Ki844O75YaN5qCh5q2j44CN44Gn44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44KJ44KM44G+44GZ44CCIixQTT9zdGFsZShQTS5hdCk6IiIpKTsKIHJvd3MucHVzaChyb3coIuazouS5seW6piIsVU0/YCR7S0lORF9OQU1FW1VNLmtpbmRdfHxVTS5raW5kfSR7VU0uc2ltPyLvvIjluILloLTovrzjgb/vvIkiOiIifSR7VU0ucGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIn1gOiLmqJnmupYiLFVNP2DmpJzoqLzml6UgJHtlc2MoVU0uYXQpfe+8j+aknOiovCAke1VNLm5UZXN0feODrOODvOOCue+8j+WvvuaVsOaQjeWksSAke1VNLm0wP1VNLm0wLmxsLnRvRml4ZWQoNCk6Ii0ife+8iOaomea6lu+8ieKGkiAke1VNLmtpbmQ9PT0ib2xkIj8oVU0ubTA/VU0ubTAubGwudG9GaXhlZCg0KToiLSIpOihVTS5tTj9VTS5tTi5sbC50b0ZpeGVkKDQpOiItIil9YDoi44CM5qSc6Ki844CN44K/44OW44Gu44CM5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2j44CN44Gn44CB5a6f6Zqb44Gu5rOi5Lmx546H44Gr5ZCI44KP44Gb44KJ44KM44G+44GZ44CCIixVTT9zdGFsZShVTS5hdCk6IiIpKTsKIGNvbnN0IG9rPUcmJkcuaXRlbXMuZmlsdGVyKHg9PngubG93Pj0xJiZ4LmJldHM+PTMwMCk7CiByb3dzLnB1c2gocm93KCLlm57lj47njociLEc/KG9rJiZvay5sZW5ndGg/IjEwMCXotoXjga7osrfjgYTmlrnjgYLjgooiOiIxMDAl6LaF44Gv5pyq56K66KqNIik6IuacquaknOiovCIsRz9g5pyA57WC5qSc6Ki8ICR7ZXNjKEcuYXQpfSR7b2smJm9rLmxlbmd0aD8i77yaIitvay5tYXAoeD0+ZXNjKHgubGFiZWwpKS5qb2luKCLjgIEiKToiIn1gOiLjgIzmpJzoqLzjgpLlrp/ooYzjgI3jgafjgIHosrfjgYTmlrnjgZTjgajjga7opIfli53lm57lj47njofjgpLnorroqo3jgafjgY3jgb7jgZnjgIIiLEc/c3RhbGUoRy5hdCk6IiIpKTsKIGNvbnN0IGdhcD1EQVRBX0xBU1Q/ZGF5c0JldHdlZW4oREFUQV9MQVNULHRvZGF5KTpudWxsOwogcm93cy5wdXNoKHJvdygi44OH44O844K/IixEQVRBX0xBU1Q/YOaIkOe4vuOBruacgOe1guaXpSAke2VzYyhEQVRBX0xBU1QpfWA6IuacquWPluW+lyIsYOiThOepjeOBl+OBn+ihgOe1sSAke09iamVjdC5rZXlzKFBFRCkubGVuZ3RofemgrWAsZ2FwIT1udWxsJiZnYXA+MTA/YOacgOaWsOOBruaIkOe4vuOBjCR7Z2FwfeaXpeWIhuWFpeOBo+OBpuOBhOOBvuOBm+OCk+OAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJgOiIiKSk7CiByZXR1cm5gPHRhYmxlPjx0aGVhZD48dHI+PHRoPumgheebrjwvdGg+PHRoPueKtuaFizwvdGg+PHRoPuips+e0sDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4ke3Jvd3Muam9pbigiIil9PC90Ym9keT48L3RhYmxlPmA7Cn0KZnVuY3Rpb24gcmVuZGVyTW9kZWxTdGF0dXMoKXtjb25zdCBlbD0kKCJtc3RhdCIpO2lmKGVsKWVsLmlubmVySFRNTD1tb2RlbFN0YXR1c0h0bWwoKX0KCi8qIOKRoyDjgZzjgpPjgbbjgYrjgb7jgYvjgZvvvJrpgY7ljrvjg6zjg7zjgrnjga7mm7TmlrAg4oaSIOS7iumAseacq+OBruWPluW+l+OBqOS6iOaDsyDihpIg44OQ44OD44Kv44Ki44OD44OXICovCmFzeW5jIGZ1bmN0aW9uIGFsbEluT25lKCl7CiBjb25zdCBtc2c9dD0+eyQoImFsbFN0YXR1cyIpLnRleHRDb250ZW50PXR9LHQwPURhdGUubm93KCk7CiAkKCJhbGxHbyIpLmRpc2FibGVkPXRydWU7CiB0cnl7CiAgU1NUT1A9ZmFsc2U7bXNnKCIxLzMg6YGO5Y6744Os44O844K544KS5pu05paw5Lit4oCm77yI4pGh77yJIik7YXdhaXQgUHJvbWlzZS5yZXNvbHZlKCQoInN5bmNHbyIpLm9uY2xpY2soKSk7CiAgaWYoU1NUT1Ape21zZygi4pGh44GM5YGc5q2i44GV44KM44Gf44Gf44KB44CB5Lit5pat44GX44G+44GX44Gf44CCIik7cmV0dXJufQogIG1zZygiMi8zIOS7iumAseacq+OBruODrOODvOOCueOCkuWPluW+l+OBl+OBpuS6iOaDs+S4reKApu+8iOKRoO+8iSIpO2F3YWl0IHdlZWtlbmRHbygpOwogIGxldCBia05vdGU9IiI7CiAgaWYoQksucGFzcyYmQksucGFzcy5sZW5ndGg+PTgpe21zZygiMy8zIOODkOODg+OCr+OCouODg+ODl+S4reKApu+8iOKRou+8iSIpO2F3YWl0IHJ1bkJhY2t1cChmYWxzZSl9CiAgZWxzZSBia05vdGU9IuODkOODg+OCr+OCouODg+ODl+OBr+OAgeODkeOCueODleODrOODvOOCuuOBjOacquioreWumuOBruOBn+OCgeihjOOBo+OBpuOBhOOBvuOBm+OCk++8iOioreWumuOCv+ODluOBp+ioreWumuOBp+OBjeOBvuOBme+8ieOAgiI7CiAgYXdhaXQgcmVmcmVzaERhdGFMYXN0KCk7cmVuZGVyTW9kZWxTdGF0dXMoKTsKICBjb25zdCBzPU1hdGgucm91bmQoKERhdGUubm93KCktdDApLzEwMDApOwogIG1zZyhg5a6M5LqG77yIJHtNYXRoLmZsb29yKHMvNjApfeWIhiR7cyU2MH3np5LvvInjgIIke2JrTm90ZX1gKTsKIH1jYXRjaChlKXttc2coIuOCqOODqeODvO+8miIrKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXskKCJhbGxHbyIpLmRpc2FibGVkPWZhbHNlfQp9Ci8qIOaknOiovOOCkuOBvuOBqOOCgeOBpuWun+ihjO+8muWlvei1sOeOhyDihpIg5rOi5Lmx5bqmIOKGkiDlm57lj47njofvvIjlhbHmnInjgq3jg6Pjg4Pjgrfjg6Xjgacy44Gk55uu5Lul6ZmN44Gv6YCf44GE77yJICovCmFzeW5jIGZ1bmN0aW9uIGFsbEZpdCgpewogY29uc3QgbXNnPXQ9PnskKCJhbGxGaXRTdGF0dXMiKS50ZXh0Q29udGVudD10fTsKICQoImFsbEZpdCIpLmRpc2FibGVkPXRydWU7CiB0cnl7CiAgbXNnKCIxLzMg5aW96LWw546H44KS5qSc6Ki844O75YaN5qCh5q2j5Lit4oCmIik7YXdhaXQgUHJvbWlzZS5yZXNvbHZlKCQoInBsUnVuIikub25jbGljaygpKTsKICBtc2coIjIvMyDms6LkubHluqbjgpLmpJzoqLzjg7vlho3moKHmraPkuK3igKYiKTthd2FpdCBQcm9taXNlLnJlc29sdmUoJCgidXBSdW4iKS5vbmNsaWNrKCkpOwogIG1zZygiMy8zIOWbnuWPjueOh+OCkuaknOiovOS4reKApiIpO2F3YWl0IFByb21pc2UucmVzb2x2ZSgkKCJidFJ1biIpLm9uY2xpY2soKSk7CiAgYXdhaXQgcmVmcmVzaERhdGFMYXN0KCk7cmVuZGVyTW9kZWxTdGF0dXMoKTttc2coIuWujOS6huOBl+OBvuOBl+OBn+OAguS4i+OBruWQhOe1kOaenOOCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogfWNhdGNoKGUpe21zZygi44Ko44Op44O877yaIisoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5eyQoImFsbEZpdCIpLmRpc2FibGVkPWZhbHNlfQp9CgovKiDlho3moKHmraPjga7ntZDmnpzvvIhsb2NhbFN0b3JhZ2XvvInjgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5flr77osaHjga7kv53lrZjpoJjln5/vvIjjg6Hjgr/vvInjgavjgoLlhpnjgZfjgabjgYrjgY/jgILjg5bjg6njgqbjgrbjga7jg4fjg7zjgr/jgpLmtojjgZfjgabjgoLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjgYvjgonmiLvjgZvjgosgKi8KYXN5bmMgZnVuY3Rpb24gbW9kZWxzVG9NZXRhKGRlcHMpewogY29uc3QgRD1PYmplY3QuYXNzaWduKHttZXRhUHV0fSxkZXBzfHx7fSk7CiB0cnl7YXdhaXQgRC5tZXRhUHV0KCJtb2RlbHMiLHtwbDpsb2NhbFN0b3JhZ2UuZ2V0SXRlbShQTEtFWSksdXA6bG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpLGdhdGU6bG9jYWxTdG9yYWdlLmdldEl0ZW0oR0FURV9LRVkpfSl9Y2F0Y2goZSl7fQp9CmFzeW5jIGZ1bmN0aW9uIG1vZGVsc0Zyb21NZXRhKGRlcHMpewogY29uc3QgRD1PYmplY3QuYXNzaWduKHttZXRhR2V0fSxkZXBzfHx7fSk7CiB0cnl7Y29uc3QgbT1hd2FpdCBELm1ldGFHZXQoIm1vZGVscyIpO2lmKCFtKXJldHVybiAwO2xldCBuPTA7CiAgZm9yKGNvbnN0IFtrLGtleV0gb2YgW1sicGwiLFBMS0VZXSxbInVwIixVUEtFWV0sWyJnYXRlIixHQVRFX0tFWV1dKWlmKG1ba10mJiFsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShrZXksbVtrXSk7bisrfQogIHJldHVybiBufWNhdGNoKGUpe3JldHVybiAwfQp9CgoKLyogLS0tLS0tLS0tLSDkv53lrZjjg4fjg7zjgr/jga7nirbms4EgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga/mnKrlj5blvpfjgafjgZnjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44GL44KJ44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBuQWxsPTAsblRyPTA7Zm9yKGNvbnN0IGYgb2YgbGl2ZSlmb3IoY29uc3QgciBvZiBmLnJvd3Mpe25BbGwrKztpZihyLnRyYWluZXIpblRyKyt9CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl0NTVu+8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgaWYobkFsbCloKz1gXG7oqr/mlZnluKvjgaTjgY3jga7miJDnuL7vvJoke01hdGgucm91bmQoblRyL25BbGwqMTAwKX0lJHtuVHI9PT0wPyLvvIjjgZPjgozjgYvjgonlj5blvpfjgZnjgovmiJDnuL7jgavlhaXjgorjgb7jgZnvvIkiOiIifWA7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9CgovKiAtLS0tLS0tLS0tIOWPluW+l+OBl+OBn+ihjCDihpIg5YaF6YOo44Gu6KGM77yI6Kq/5pWZ5bir44O744Kw44Os44O844OJ5LuY44GN77yJIC0tLS0tLS0tLS0gKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLAogIHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKHgudHJhaW5lciksCiAgcmFjZU5hbWU6U3RyaW5nKHgucmFjZU5hbWV8fCIiKSxnYzpnb2luZ0NhdChnb2luZ0NvZGUoeC5nb2luZykpLHZlbnVlOnZlbnVlRnJvbUlkKHgucmFjZUlkKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSksCiAgY29ybmVyOkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg/eC5jb3JuZXI6bnVsbCxsYXA6QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aD94LmxhcDpudWxsfX0KCi8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCi++8iOmojuaJi+ODu+iqv+aVmeW4q+OBruaIkOe4vuOCguWQjOaZguOBq+mbhuioiO+8iSAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWZpbGVPcmRlcihhd2FpdCBpZGJBbGwoKSk7aWYoIWZzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIumBjuWOu+ODh+ODvOOCv+OBjOacqueZu+mMsuOBp+OBmeOAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO3N0LnRyPW5ldyBNYXAoKTtsZXQgdXNlZD0wO2NvbnN0IEFHPW5ldyBNYXAoKSxkcmF3PW5ldyBEcmF3UHJpKCksc2lyZT1uZXcgU2lyZVByaSgpOwogY29uc3QgdGFrZT1yPT57aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKXJldHVybjthZ2dBZGQoQUcscik7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlOwogIGNvbnN0IHQzPXIuZmluaXNoIT1udWxsJiZyLmZpbmlzaDw9Mz8xOjA7CiAgaWYoci50cmFpbmVyJiZyLmZpbmlzaCE9bnVsbCl7bGV0IHQ9c3QudHIuZ2V0KHIudHJhaW5lcik7aWYoIXQpc3QudHIuc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO3QudDMrPXQzfQogIGlmKHIuZmluaXNoIT1udWxsJiZyLk4pe2NvbnN0IHY9ci52ZW51ZXx8dmVudWVGcm9tSWQoci5yYWNlSWQpO2RyYXcuYWRkKHYsci5zdXJmLHIuZGlzdCxyLm51bSxyLk4sdDMpO3NpcmUuYWRkKFBFRFtyLmhvcnNlXSxyLnN1cmYsci5kaXN0LHQzLHIuTil9fTsKIGNvbnN0IGRkPW5ldyBSYWNlRGVkdXBlKCk7CiBjb25zdCBwcmVwPXJvd3M9Pntyb3dzPXJvd3MuZmlsdGVyKHI9PiFkZC5za2lwKHIpKTtjb25zdCBjbnQ9e307Zm9yKGNvbnN0IHIgb2Ygcm93cylpZihyLmZpbmlzaCE9bnVsbCljbnRbci5yYWNlSWRdPShjbnRbci5yYWNlSWRdfHwwKSsxO2Zvcihjb25zdCByIG9mIHJvd3Mpe3IuTj1jbnRbci5yYWNlSWRdfHwwO3IuY2Y9Y29ybmVyRnJhYyhyLmNvcm5lcixyLk4pO3Rha2Uocil9fTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSlwcmVwKChmc1tpXS5yb3dzfHxbXSkubWFwKGxpdmVSb3cpKTsKICBlbHNlIHByZXAoVUUuY3N2Um93cyhmc1tpXS5jc3YpLm1hcChVRS50b1JvdykpOwogIGF3YWl0IHNsZWVwKDApOwogfQogY29uc3QgcHJpPW5ldyBVcFByaSgpLHBwPW5ldyBQb3BQcmkoKTtmb3IoY29uc3QgYSBvZiBBRy52YWx1ZXMoKSl7cHJpLmFkZChhZ2dJbmZvKGEpKTtpZihhLk4+PTYmJmEucGYubGVuZ3RoPT09YS5OJiYhYS5qdW1wKXBwLmFkZChhLnBmLGEuTil9c3QudXA9cHJpO3N0LnBwPXBwO3N0LmRyYXc9ZHJhdztzdC5zaXJlPXNpcmU7c3QuZHVwUmFjZXM9ZGQuZHVwcy5zaXplOwogYnVzeShmYWxzZSk7U1RPUkU9c3Q7U1RPUkVfS0VZPXRhcmdldDtzdC5jb3VudD11c2VkO3JldHVybiBzdDsKfQoKLyog5Ye66aas6KGo44GuMeODrOODvOOCuSDihpIg6Kej5p6Q55So44Gu44Os44O844K5ICovCmZ1bmN0aW9uIG1rUmFjZShjLGQpewogY29uc3QgaHM9Yy5ob3JzZXN8fGMucnVubmVyc3x8W107CiBjb25zdCBndD0oYy5jbGFzc05hbWV8fCIiKSsiICIrKGMuZ3JhZGV8fCIiKSsiICIrKGMucmFjZU5hbWV8fCIiKTsKIGNvbnN0IGdyZD1VRS5ncmFkZVRpZXIoZ3QsYy5wcml6ZSx0cnVlKTsKIHJldHVybntkYXRlOmQsc3VyZjpVRS5zdXJmQ29kZShjLnN1cmZhY2UpLGRpc3Q6TnVtYmVyKGMuZGlzdGFuY2UpfHwwLAogIGx2bDpVRS5sZXZlbE9mTGFiZWwoYy5jbGFzc05hbWUpfHxVRS5sZXZlbE9mTGFiZWwoYy5yYWNlTmFtZSl8fChncmQ+PTE/NTowKSxncmQsCiAgcnVubmVyczpocy5tYXAoKGgsaSk9Pntjb25zdCBuYW1lPWguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiOwogICByZXR1cm57bmFtZSxob3JzZTpVRS5ubihuYW1lKSxqb2NrZXk6VUUuam5uKGguam9ja2V5fHwiIiksam5hbWU6U3RyaW5nKGguam9ja2V5fHwiIikudHJpbSgpLHRyYWluZXI6VUUuY2xlYW5UcihoLnRyYWluZXJ8fCIiKSxhZ2U6aC5hZ2V8fG51bGwsbnVtOmguaG9yc2VOdW1iZXJ8fGgubnVtYmVyfHxpKzF9fSkKICAgLnNvcnQoKHgseSk9Pih4Lm51bXx8MCktKHkubnVtfHwwKSl9Owp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5LuK6YCx5pyr44Gu5Y+W5b6XCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgV0s9e2RhdGVzOltdLGNhcmRzOnt9LG9kZHM6e30sb2Rkc05vdGVzOnt9LGRpYWc6W10sY2FsYzp7fSxhdDoiIixzdG9yZUluZm86bnVsbH07CmNvbnN0IHJrZXk9KGQsYyk9PmAke2R9fCR7U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihjLnJhY2VOdW1iZXIpfHwwfWA7CmNvbnN0IHdrTXNnPXQ9PnskKCJ3a1N0YXR1cyIpLnRleHRDb250ZW50PXR9Owpjb25zdCBiYXNlVXJsPSgpPT4kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CmZ1bmN0aW9uIG5leHRXZWVrZW5kKHRvZGF5KXtjb25zdCBvdXQ9W107Y29uc3QgdD1uZXcgRGF0ZSh0b2RheSsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKTsKIGZvcihsZXQgaT0wO2k8OCYmb3V0Lmxlbmd0aDwyO2krKyl7Y29uc3QgZD1uZXcgRGF0ZSh0K2kqODY0ZTUpLHc9ZC5nZXRVVENEYXkoKTtpZih3PT09Nnx8dz09PTApb3V0LnB1c2goZC50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApKX1yZXR1cm4gb3V0fQoKYXN5bmMgZnVuY3Rpb24gZmV0Y2hDYXJkcyhiYXNlLGQsdmVudWVDb2RlKXsKIGNvbnN0IHE9dmVudWVDb2RlP2AmdmVudWU9JHtlbmNvZGVVUklDb21wb25lbnQodmVudWVDb2RlKX1gOiIiO2xldCBlcnI9IiI7CiBmb3IobGV0IHQ9MDt0PDM7dCsrKXsKICB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JHtxfWApOwogICBpZighci5vayl7bGV0IG09IiI7dHJ5e209KGF3YWl0IHIuanNvbigpKS5lcnJvcnx8IiJ9Y2F0Y2h7fXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfSAke219YC50cmltKCkpfQogICBjb25zdCB4PWF3YWl0IHIuanNvbigpO3JldHVybntyYWNlczpBcnJheS5pc0FycmF5KHgpP3g6KHgucmFjZXN8fFtdKX19CiAgY2F0Y2goZSl7ZXJyPWUubWVzc2FnZTthd2FpdCBzbGVlcCgxMjAwKih0KzEpKX0KIH0KIHRocm93IG5ldyBFcnJvcihlcnJ8fCLlj5blvpfjgafjgY3jgb7jgZvjgpMiKTsKfQoKLyogMemWi+WCrOWgtOOBtuOCk+OBruWHuummrOihqOOAguasoOOBkeODu+WkseaVl+OBjOOBguOCjOOBsOOAgeiHquWLleOBpzHlm57jgaDjgZHjgoTjgornm7TjgZkgKi8KYXN5bmMgZnVuY3Rpb24gbG9hZFZlbnVlSW50byhiYXNlLGQsdixpc1JldHJ5KXsKIGNvbnN0IGNvZGU9U3RyaW5nKHYudmVudWVDb2RlKTsKIFdLLmNhcmRzW2RdPShXSy5jYXJkc1tkXXx8W10pLmZpbHRlcihjPT5TdHJpbmcoYy52ZW51ZUNvZGUpIT09Y29kZSk7CiBXSy5kaWFnPVdLLmRpYWcuZmlsdGVyKHg9PiEoeC5kPT09ZCYmeC5jb2RlPT09Y29kZSkpOwogdHJ5ewogIGNvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsY29kZSk7CiAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKSxiYWQ9cmFjZXMubGVuZ3RoLW9rLmxlbmd0aDsKICBXSy5jYXJkc1tkXS5wdXNoKC4uLm9rKTsKICBjb25zdCBpc3N1ZXM9b2suZmlsdGVyKGM9PmMucXVhbGl0eSYmIWMucXVhbGl0eS5vaykubWFwKGM9PmAke2MucmFjZU51bWJlcn1S77yaJHtjLnF1YWxpdHkuaXNzdWVzLmpvaW4oIuODuyIpfWApOwogIFdLLmRpYWcucHVzaCh7ZCxjb2RlLG5hbWU6di52ZW51ZU5hbWV8fFZFTlVFW2NvZGVdfHxjb2RlLHJhY2VzOnJhY2VzLmxlbmd0aCxvazpvay5sZW5ndGgsYmFkLGlzc3VlcyxlcnI6IXJhY2VzLmxlbmd0aD8i44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIjoiIn0pOwogIGlmKChiYWQ+MHx8b2subGVuZ3RoPDgpJiYhaXNSZXRyeSl7YXdhaXQgc2xlZXAoODAwKTtyZXR1cm4gbG9hZFZlbnVlSW50byhiYXNlLGQsdix0cnVlKX0KIH1jYXRjaChlKXsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjplLm1lc3NhZ2V9KTsKICBpZighaXNSZXRyeSl7YXdhaXQgc2xlZXAoMTIwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Cn0KCi8qIOOCquODg+OCuu+8iOWNmOWLne+8i+ikh+WLne+8ieOAguWHuummrOihqOOBruODquODs+OCr+OBi+OCieebtOaOpSDihpIg5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544Gv44CB5pel5LuY44O76ZaL5YKs5aC044Gu44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GGICovCmFzeW5jIGZ1bmN0aW9uIGZldGNoT2Rkc0RhdGUoYmFzZSxkKXsKIGNvbnN0IGNhcmRzPVdLLmNhcmRzW2RdfHxbXSxub3Rlcz1bXTtXSy5vZGRzTm90ZXM9V0sub2Rkc05vdGVzfHx7fTsKIGlmKCFjYXJkcy5sZW5ndGgpe1dLLm9kZHNOb3Rlc1tkXT1ub3RlcztyZXR1cm57bjowLG5vdGVzfX0KIGNvbnN0IHdpdGhMaW5rPWNhcmRzLmZpbHRlcihyPT5yLm9kZHNDbmFtZSksYnlDPW5ldyBNYXAod2l0aExpbmsubWFwKHI9PltyLm9kZHNDbmFtZSxyXSkpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8d2l0aExpbmsubGVuZ3RoO2krPTYpY2h1bmtzLnB1c2god2l0aExpbmsuc2xpY2UoaSxpKzYpLm1hcChyPT5yLm9kZHNDbmFtZSkpOwogbGV0IGNpPTAsZmFpbE49MDtjb25zdCByZWFzb25zPXt9OwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShjaTxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWNpKys7CiAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgcj1ieUMuZ2V0KGl0LmNuYW1lKTtpZihyKVdLLm9kZHNbcmtleShkLHIpXT17dGFuOml0Lm9kZHN8fHt9LHBsYWNlOml0LnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfX0KICAgZm9yKGNvbnN0IGYgb2YgKHguZmFpbGVkfHxbXSkpe2ZhaWxOKys7Y29uc3QgbT1TdHJpbmcoZi5yZWFzb258fCIiKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfQogIH1jYXRjaChlKXtmYWlsTis9Y2h1bmtzW2tdLmxlbmd0aDtjb25zdCBtPVN0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsNjApO3JlYXNvbnNbbV09KHJlYXNvbnNbbV18fDApKzF9fX07CiBhd2FpdCBQcm9taXNlLmFsbChbd29ya2VyKCksd29ya2VyKCldKTsKIGNvbnN0IGRpcmVjdD1jYXJkcy5maWx0ZXIocj0+V0sub2Rkc1tya2V5KGQscildKS5sZW5ndGg7CiBub3Rlcy5wdXNoKGDlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqXvvJoke2RpcmVjdH0vJHtjYXJkcy5sZW5ndGh944Os44O844K577yI44Oq44Oz44Kv44GC44KKICR7d2l0aExpbmsubGVuZ3RofeOAgeWkseaVlyAke2ZhaWxOfe+8iWApOwogZm9yKGNvbnN0IFttLGNdIG9mIE9iamVjdC5lbnRyaWVzKHJlYXNvbnMpKW5vdGVzLnB1c2goYOOAgOWkseaVl+OBrueQhueUse+8miR7bX3vvIgke2N977yJYCk7CiBjb25zdCBtaXNzaW5nPWNhcmRzLmZpbHRlcihyPT4hV0sub2Rkc1tya2V5KGQscildKTsKIGlmKG1pc3NpbmcubGVuZ3RoKXsKICBmb3IoY29uc3QgdiBvZiBbLi4ubmV3IFNldChtaXNzaW5nLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pKXsKICAgY29uc3QgbmVlZD1uZXcgU2V0KG1pc3NpbmcuZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpLm1hcChyPT5OdW1iZXIoci5yYWNlTnVtYmVyKSkpOwogICB0cnl7CiAgICBjb25zdCBMPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcy1saW5rcz9kYXRlPSR7ZH0mdmVudWU9JHt2fWAsWzE1MDBdKTsKICAgIGNvbnN0IGFsbD1MLmxpbmtzfHxbXSxsaW5rcz1hbGwuZmlsdGVyKHg9Pm5lZWQuaGFzKHgucmFjZU5vKSk7CiAgICBub3Rlcy5wdXNoKGDjg6Hjg4vjg6Xjg7zntYznlLEgJHtWRU5VRVt2XXx8dn3vvJrjgqrjg4PjgrrnlLvpnaLjgYzjgYLjgovjg6zjg7zjgrkgJHthbGwubWFwKHg9PngucmFjZU5vKS5qb2luKCIsIil8fCLjgarjgZcife+8iOacquWPluW+lyR7bmVlZC5zaXplfeODrOODvOOCueOBruOBhuOBoSR7bGlua3MubGVuZ3RofeODrOODvOOCue+8iWApOwogICAgaWYoIWFsbC5sZW5ndGgpbm90ZXMucHVzaChg44CA55m65aOy5YmN44Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CC6Ki65pat77yaJHtKU09OLnN0cmluZ2lmeSgoTC5kaWFnfHxbXSkubWFwKHg9Pih7czp4LnN0ZXAsbGVuOnguaHRtbExlbmd0aCxuOnguY25hbWVzLGs6eC5raW5kcyxtOngubWVudXMsZTp4LmVycm9yfSkpKS5zbGljZSgwLDM2MCl9YCk7CiAgICBjb25zdCBieUM9bmV3IE1hcChsaW5rcy5tYXAoeD0+W3guY25hbWUseC5yYWNlTm9dKSk7CiAgICBmb3IobGV0IGk9MDtpPGxpbmtzLmxlbmd0aDtpKz00KXsKICAgICBjb25zdCBjaD1saW5rcy5zbGljZShpLGkrNCkubWFwKHg9PnguY25hbWUpOwogICAgIHRyeXsKICAgICAgY29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2gubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IG5vPWJ5Qy5nZXQoaXQuY25hbWUpO2lmKG5vKVdLLm9kZHNbYCR7ZH18JHt2fS0ke25vfWBdPXt0YW46aXQub2Rkc3x8e30scGxhY2U6aXQucGxhY2V8fHt9LGF0OkRhdGUubm93KCl9fQogICAgICBmb3IoY29uc3QgZiBvZiAoeC5mYWlsZWR8fFtdKSlub3Rlcy5wdXNoKGDjgIDoqq3jgb/lj5bjgozjgarjgYvjgaPjgZ/vvJoke1ZFTlVFW3ZdfHx2fSR7YnlDLmdldChmLmNuYW1lKX1S77yIJHtTdHJpbmcoZi5yZWFzb258fCIiKS5zbGljZSgwLDUwKX3vvIlgKTsKICAgICB9Y2F0Y2goZSl7bm90ZXMucHVzaChg44CA5Y+W5b6X44Ko44Op44O8ICR7VkVOVUVbdl18fHZ977yaJHtTdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDcwKX1gKX0KICAgIH0KICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOODoeODi+ODpeODvOe1jOeUsSAke1ZFTlVFW3ZdfHx2fe+8muWkseaVl++8iCR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCwxMDApfe+8iWApfQogIH0KIH0KIGNvbnN0IHN0aWxsPWNhcmRzLmZpbHRlcihyPT4hV0sub2Rkc1tya2V5KGQscildKTsKIGlmKHN0aWxsLmxlbmd0aClub3Rlcy5wdXNoKGDjgqrjg4PjgrrmnKrlj5blvpfvvJoke3N0aWxsLm1hcChyPT4oci52ZW51ZU5hbWV8fCIiKStyLnJhY2VOdW1iZXIrIlIiKS5qb2luKCLjgIEiKX3vvIjnmbrlo7LliY3jgIHjgb7jgZ/jga/oqq3jgb/lj5bjgozjgabjgYTjgb7jgZvjgpPvvIlgKTsKIFdLLm9kZHNOb3Rlc1tkXT1ub3RlczsKIHJldHVybntuOmNhcmRzLmZpbHRlcihyPT5XSy5vZGRzW3JrZXkoZCxyKV0pLmxlbmd0aCxub3Rlc307Cn0KCmxldCBPRERTX1RJTUVSPW51bGwsT0REU19UUklFUz0wOwpmdW5jdGlvbiBvZGRzTWlzc2luZygpe2xldCBtPTAsdD0wO2Zvcihjb25zdCBkIG9mIFdLLmRhdGVzKWZvcihjb25zdCBjIG9mIFdLLmNhcmRzW2RdfHxbXSl7dCsrO2lmKCFXSy5vZGRzW3JrZXkoZCxjKV0pbSsrfXJldHVybnttLHR9fQovKiDjgqrjg4Pjgrrjga7mnKrlj5blvpfjgYzmrovjgaPjgabjgYTjgabjgIHlvZPml6Xjga7mnJ3jgJzlpJXmlrnjgarjgonjgIE15YiG44GU44Go44Gr6Ieq5YuV44Gn5Y+W44KK55u044GZ77yISlJB44Gv6YCa5bi444Gu44Os44O844K544KS5b2T5pel5pyd44Gr55m65aOy6ZaL5aeL44GZ44KL44Gf44KB77yJICovCmZ1bmN0aW9uIHNjaGVkdWxlT2Rkc1JldHJ5KCl7CiBpZihPRERTX1RJTUVSKXtjbGVhclRpbWVvdXQoT0REU19USU1FUik7T0REU19USU1FUj1udWxsfQogY29uc3Qge219PW9kZHNNaXNzaW5nKCksaD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS5nZXRVVENIb3VycygpOwogaWYoIW18fE9ERFNfVFJJRVM+PTM2fHxoPDZ8fGg+PTE3fHwhV0suZGF0ZXMuaW5jbHVkZXMoanN0VG9kYXkoKSkpcmV0dXJuIGZhbHNlOwogT0REU19UUklFUysrO09ERFNfVElNRVI9c2V0VGltZW91dCgoKT0+e09ERFNfVElNRVI9bnVsbDtpZighJCgid2tHbyIpLmRpc2FibGVkKW9kZHNPbmx5KCl9LDUqNjBlMyk7cmV0dXJuIHRydWU7Cn0KY29uc3Qgb2Rkc0hpbnQ9KCk9Pntjb25zdCB7bX09b2Rkc01pc3NpbmcoKTtpZighbSlyZXR1cm4iIjtjb25zdCBzY2g9c2NoZWR1bGVPZGRzUmV0cnkoKTtyZXR1cm5gXG7mnKrlj5blvpcgJHttfeODrOODvOOCue+8mueZuuWjsuWJjeOBruWPr+iDveaAp+OBjOOBguOCiuOBvuOBme+8iEpSQeOBr+mAmuW4uOOBruODrOODvOOCueOBruOCquODg+OCuuOCkuW9k+aXpeacneOBq+eZuuWjsumWi+Wni++8ieOAgiR7c2NoPyI15YiG44GU44Go44Gr6Ieq5YuV44Gn5Y+W44KK55u044GX44G+44GZ44CCIjoi55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIn1gfTsKYXN5bmMgZnVuY3Rpb24gd2Vla2VuZEdvKCl7T0REU19UUklFUz0wOwogY29uc3QgYmFzZT1iYXNlVXJsKCk7JCgid2tHbyIpLmRpc2FibGVkPXRydWU7JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIFdLLmRhdGVzPVtdO1dLLmNhcmRzPXt9O1dLLm9kZHM9e307V0suZGlhZz1bXTtXSy5jYWxjPXt9OwogdHJ5ewogIHdrTXNnKCLplovlgqzml6XjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCB0b2RheT1qc3RUb2RheSgpO2xldCBkYXRlcz1bXTsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7dG9kYXl9Jmxpc3Q9MWAsWzE1MDBdKTtkYXRlcz0oeC5hdmFpbGFibGVEYXRlc3x8W10pLmZpbHRlcihkPT5kPj10b2RheSl9Y2F0Y2goZSl7fQogIGlmKCFkYXRlcy5sZW5ndGgpZGF0ZXM9bmV4dFdlZWtlbmQodG9kYXkpOwogIGRhdGVzPVsuLi5uZXcgU2V0KGRhdGVzKV0uc29ydCgpLnNsaWNlKDAsMyk7CiAgZm9yKGNvbnN0IGQgb2YgZGF0ZXMpewogICB3a01zZyhgJHtkfSDplovlgqzloLTjgpLnorroqo3kuK3igKZgKTsKICAgbGV0IHZlbnVlcz1bXTsKICAgdHJ5e3ZlbnVlcz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2R9Jmxpc3Q9MWAsWzE1MDBdKSkudmVudWVzfHxbXX0KICAgY2F0Y2goZSl7V0suZGlhZy5wdXNoKHtkLGNvZGU6IiIsbmFtZToiKOmWi+WCrOWgtOS4gOimpykiLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOmUubWVzc2FnZX0pO2NvbnRpbnVlfQogICBpZighdmVudWVzLmxlbmd0aCl7V0suZGlhZy5wdXNoKHtkLGNvZGU6IiIsbmFtZToiKOmWi+WCrOOBquOBlykiLHJhY2VzOjAsb2s6MCxiYWQ6MCxpc3N1ZXM6W10sZXJyOiLjgZPjga7ml6Xjga7lh7rppqzooajjga/mnKrlhazplovjgIHjgb7jgZ/jga/plovlgqzjgYzjgYLjgorjgb7jgZvjgpMifSk7Y29udGludWV9CiAgIFdLLmNhcmRzW2RdPVtdOwogICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpe3drTXNnKGAke2R9ICR7di52ZW51ZU5hbWV8fHYudmVudWVDb2RlfSDjga7lh7rppqzooajjgpLlj5blvpfkuK3igKbvvIgkeyhXSy5jYXJkc1tkXXx8W10pLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfmuIjjgb/vvIlgKTthd2FpdCBsb2FkVmVudWVJbnRvKGJhc2UsZCx2KX0KICAgaWYoKFdLLmNhcmRzW2RdfHxbXSkubGVuZ3RoKVdLLmRhdGVzLnB1c2goZCk7CiAgfQogIGlmKCFXSy5kYXRlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLlh7rppqzooajjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgILjgIzlj5bjgorovrzjgb/nirbms4HjgI3jgr/jg5bjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKICBsZXQgb2Rkc049MCx0b3RhbD0wOwogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLlj5blvpfkuK3igKZgKTtvZGRzTis9KGF3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZSxkKSkubjt0b3RhbCs9V0suY2FyZHNbZF0ubGVuZ3RofQogIHRyeXtXSy5wZWQ9YXdhaXQgcGVkaWdyZWVVcGRhdGUoV0suY2FyZHMpfWNhdGNoKGUpe1dLLnBlZD1udWxsfQogIHdrTXNnKCLpgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgZfjgabjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDkuK3igKYiKTsKICBhd2FpdCBjYWxjV2Vla2VuZCgpO1dLLmF0PW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTYpOwogIHJlbmRlckFsbCgpOwogIGNvbnN0IG5yPVdLLmRhdGVzLnJlZHVjZSgocyxkKT0+cytXSy5jYXJkc1tkXS5sZW5ndGgsMCk7CiAgd2tNc2coYOWujOS6hu+8iCR7V0suYXR977yJ77yaJHtXSy5kYXRlcy5qb2luKCLjgIEiKX3vvI8ke25yfeODrOODvOOCue+8j+OCquODg+OCuiAke29kZHNOfeODrOODvOOCuSR7b2Rkc0hpbnQoKX1gKTsKICAkKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZTtzaG93VGFiKCJ2QXhpcyIpOwogfWNhdGNoKGUpe3drTXNnKCLjgqjjg6njg7zvvJoiK2UubWVzc2FnZSk7YnVzeShmYWxzZSk7cmVuZGVyQWxsKCl9CiBmaW5hbGx5eyQoIndrR28iKS5kaXNhYmxlZD1mYWxzZX0KfQphc3luYyBmdW5jdGlvbiBvZGRzT25seSgpewogaWYoIVdLLmRhdGVzLmxlbmd0aClyZXR1cm47JCgid2tPZGRzIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXtsZXQgbj0wO2Zvcihjb25zdCBkIG9mIFdLLmRhdGVzKXt3a01zZyhgJHtkfSDjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKZgKTtuKz0oYXdhaXQgZmV0Y2hPZGRzRGF0ZShiYXNlVXJsKCksZCkpLm59CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTtyZW5kZXJBbGwoKTt3a01zZyhg44Kq44OD44K65pu05paw77yIJHtXSy5hdH3vvInvvJoke25944Os44O844K55YiGJHtvZGRzSGludCgpfWApfQogY2F0Y2goZSl7d2tNc2coIuabtOaWsOOCqOODqeODvO+8miIrZS5tZXNzYWdlKX1maW5hbGx5eyQoIndrT2RkcyIpLmRpc2FibGVkPWZhbHNlfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6Kej5p6Q77yIMeODrOODvOOCue+8ie+8muikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrogPSDmnJ/lvoXlgKTjgIHms6LkubHluqbjgIHpiYTmnb8KICogIOikh+WLneeiuueOh++8muOCquODg+OCuuOBguOCiuKGkuW4guWgtOaDheWgseOCguS9v+OBhuWtpue/kua4iOOBv+ODouODh+ODqyhwTynvvI/jgarjgZfihpLpgY7ljrvmiJDnuL7jga7jgb/jga7jg6Ljg4fjg6socFApCiAqICDopIfli53jgqrjg4PjgrrvvJpKUkHjga7opIfli53jgqrjg4PjgrrvvIjkuIvpmZDjgJzkuIrpmZDvvInjgILoqq3jgoHjgarjgYTjgajjgY3jga/ljZjli53jgYvjgonmjqjlrprvvIjDl+ihqOekuu+8iQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmZ1bmN0aW9uIGNhbGNSYWNlKGQsYyxzdG9yZSl7CiBjb25zdCByYWNlPW1rUmFjZShjLGQpO3JhY2UuZ2M9Z29pbmdDYXQoZ29pbmdDb2RlKGMuZ29pbmcpKTtsZXQgbj1yYWNlLnJ1bm5lcnMubGVuZ3RoO2NvbnN0IHNjcmF0Y2hlZD1bXTsKIHtjb25zdCBvMD1XSy5vZGRzW3JrZXkoZCxjKV07CiAgaWYobzApe2NvbnN0IG1pc3M9cmFjZS5ydW5uZXJzLmZpbHRlcihyPT4hKG8wLnRhbltyLm51bV0+MSkpLGhhdmU9cmFjZS5ydW5uZXJzLmxlbmd0aC1taXNzLmxlbmd0aDsKICAgLy8g5LiA6YOo44Gu6aas44Gg44GR44Kq44OD44K644GM54Sh44GE77yd5Y+W5raI44O76Zmk5aSW44Gu5Y+v6IO95oCn44GM6auY44GE44CC5aSW44GX44Gm44CB44Kq44OD44K66L6844G/44Gn6Kej5p6Q44GZ44KL77yI5aSn5Y2K44GM5qyg44GR44Gm44GE44KL44Gq44KJ5aSW44GV44Gq44GE77yJCiAgIGlmKG1pc3MubGVuZ3RoJiZoYXZlPj02JiZtaXNzLmxlbmd0aDw9TWF0aC5tYXgoMyxNYXRoLmZsb29yKHJhY2UucnVubmVycy5sZW5ndGgqLjIpKSl7c2NyYXRjaGVkLnB1c2goLi4ubWlzcy5tYXAocj0+ci5udW0pKTtyYWNlLnJ1bm5lcnM9cmFjZS5ydW5uZXJzLmZpbHRlcihyPT5vMC50YW5bci5udW1dPjEpO249cmFjZS5ydW5uZXJzLmxlbmd0aH19fQogY29uc3QgYmFzZT17ZCxjYXJkOmMscmFjZSxuLHNjcmF0Y2hlZCxrZXk6cmtleShkLGMpLHZlbnVlOmMudmVudWVOYW1lfHxjLnZlbnVlfHwiIixubzpOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MCwKICBsYWJlbDpgJHtjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiJ9JHtjLnJhY2VOdW1iZXJ8fCIifVIgJHsoYy5yYWNlTmFtZSYmYy5yYWNlTmFtZSE9PSLlh7rppqzooagiKT9jLnJhY2VOYW1lOihjLmNsYXNzTmFtZXx8IiIpfWAsY291cnNlOmMuc3VyZmFjZSYmYy5kaXN0YW5jZT9gJHtjLnN1cmZhY2V9JHtjLmRpc3RhbmNlfW1gOiLjgrPjg7zjgrnkuI3mmI4ifTsKIGlmKC/pmpzlrrMvLnRlc3QoKGMucmFjZU5hbWV8fCIiKSsoYy5jbGFzc05hbWV8fCIiKSkpcmV0dXJuey4uLmJhc2Usc2tpcDoi6Zqc5a6z44Os44O844K544Gv5a++6LGh5aSW77yI5bmz5Zyw55So44Gu44Oi44OH44Or44Gu44Gf44KB77yJIn07CiBpZihuPDYpcmV0dXJuey4uLmJhc2Usc2tpcDoiNumgreacqua6gCJ9OwogY29uc3Qgbz1XSy5vZGRzW2Jhc2Uua2V5XSxvZGRzPW8/cmFjZS5ydW5uZXJzLm1hcChyPT5vLnRhbltyLm51bV0pOm51bGwsaGFzT2Rkcz0hIShvZGRzJiZvZGRzLmV2ZXJ5KHg9Png+MSkpOwogY29uc3Qgb2Q9aGFzT2Rkcz9vZGRzOm51bGw7CiBjb25zdCByZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk7bGV0IHVnPVVFLnVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZCxhcCk7CiBjb25zdCBVTT1nZXRVcHNldE1vZGVsKCk7CiBpZihVTSYmc3RvcmUudXApe3RyeXtjb25zdCB1PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhcCksaW5mPXt2OlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSxubzpOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MCxnYzpyYWNlLmdjLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LGx2bDpyYWNlLmx2bCxncmQ6cmFjZS5ncmQsTjpufSxzaW09KGhhc09kZHMmJnN0b3JlLnBwJiZuPj02KT8oKCk9Pntjb25zdCBwb3BzPXBvcHNGcm9tT2RkcyhvZCk7cmV0dXJuIHNpbUZlYXQoYXAucFAscG9wcyxuLHN0b3JlLnBwKX0pKCk6bnVsbCxjdT11cHNldEN1c3RvbShVTSx1LHN0b3JlLnVwLmZlYXQoaW5mKSxwYWNlRmVhdChyYWNlLnJ1bm5lcnMsc3RvcmUpLHNpbSk7aWYoY3UpdWc9ey4uLnVnLC4uLmN1LG1vZGU6dS5tb2RlLGN1c3RvbTp0cnVlfX1jYXRjaChlKXt9fQogY29uc3QgUE09Z2V0UGxhY2VNb2RlbCgpO2xldCBwTmV3PW51bGw7CiByYWNlLmdjPWdvaW5nQ2F0KGdvaW5nQ29kZShjLmdvaW5nKSk7CiBpZihQTSYmaGFzT2RkcyYmbj49OCYmc3RvcmUucHApe3RyeXsKICBjb25zdCBwb3BzPXBvcHNGcm9tT2RkcyhvZCkscms9cmFua0ZyYWNzKGFwLnBQKSxyY0k9e2djOnJhY2UuZ2MsdjpTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIiksc3VyZjpyYWNlLnN1cmYsZGlzdDpyYWNlLmRpc3QsTjpufSxjdHg9e2RyYXc6c3RvcmUuZHJhdyx0cjpzdG9yZS50cixzaXJlOnN0b3JlLnNpcmUscGVkOlBFRH0sYj1NYXRoLm1pbiguNSwzL24pOwogIHBOZXc9bm9ybVN1bShyYWNlLnJ1bm5lcnMubWFwKChyLGkpPT57bGV0IHg9cGxhY2VYKGFwLnBQW2ldLHBvcHNbaV0sbixzdG9yZS5wcCxya1tpXSk7aWYoUE0uZXh0KXg9Wy4uLngsLi4uZXh0RmVhdEhvcnNlKHIsc3RvcmUuaC5nZXQoci5ob3JzZSkscmNJLGN0eCxiKV07cmV0dXJuIHByZWRMb2dpdChQTS5tb2RlbCx4KX0pLDMpfWNhdGNoKGUpe3BOZXc9bnVsbH19CiBsZXQgYXhpcz1oYXNPZGRzP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogaWYoaGFzT2Rkcyl7CiAgY29uc3QgcGE9cE5ld3x8YXAucE8saXJvblJhdGU9KHBOZXcmJlBNLmlyb24mJlBNLmlyb24ubj4wKT9QTS5pcm9uLnJhdGU6VUUuQVhJUy5iYW5kc1si6YmE5p2/Il0ucmF0ZTsKICBjb25zdCBpcm9uPXBhLm1hcCgocCxpKT0+KHtpLHAsdGllcjoi6YmE5p2/IixyYXRlOmlyb25SYXRlfSkpLmZpbHRlcih4PT54LnA+PUlST05fUCk7CiAgY29uc3QgaXNJcm9uPW5ldyBTZXQoaXJvbi5tYXAoeD0+eC5pKSkscmVmPShheGlzfHxbXSkuZmlsdGVyKHg9PiFpc0lyb24uaGFzKHguaSkmJngudGllciE9PSLpiYTmnb8iKS5tYXAoeD0+KHsuLi54LHA6cGFbeC5pXX0pKTsKICBheGlzPVsuLi5pcm9uLC4uLnJlZl07CiB9CiBjb25zdCBtMz1oYXNPZGRzP1VFLnRvcDNGcm9tV2luKG9kLm1hcCh4PT4xL3gpKTpudWxsOwogY29uc3QgaG9yc2VzPXJhY2UucnVubmVycy5tYXAoKHIsaSk9PnsKICBjb25zdCBwPXBOZXc/cE5ld1tpXTooaGFzT2Rkcz9hcC5wT1tpXTphcC5wUFtpXSkscGw9byYmby5wbGFjZSYmby5wbGFjZVtyLm51bV07CiAgbGV0IGxvPW51bGwsaGk9bnVsbCxzcmM9bnVsbDsKICBpZihwbCYmcGwubGVuZ3RoPT09MiYmcGxbMF0+PTEpe2xvPXBsWzBdO2hpPXBsWzFdO3NyYz0i5a6fIn0KICBlbHNlIGlmKG0zKXtsbz1NYXRoLm1heCgxLDAuOC9NYXRoLm1heChtM1tpXSwuMDIpKTtoaT1sbztzcmM9IuaOqOWumiJ9CiAgY29uc3QgdHI9c3RvcmUudHImJnIudHJhaW5lcj9zdG9yZS50ci5nZXQoci50cmFpbmVyKTpudWxsLHg9cmVzW2ldOwogIHJldHVybntpLG5vOnIubnVtLG5hbWU6ci5uYW1lLGpuYW1lOnIuam5hbWUsdHJhaW5lcjpyLnRyYWluZXIsdHJOOnRyP3RyLm46MCx0clJhdGU6dHImJnRyLm4/dHIudDMvdHIubjpudWxsLGpuOnguam4sCiAgIHAscFNyYzpwTmV3PyLlho3moKHmraMiOm51bGwscE9sZDpoYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldLGxvLGhpLHNyYyxldjpsbz9wKmxvOm51bGwsZXZNaWQ6bG8/cCoobG8raGkpLzI6bnVsbCx3aW46aGFzT2Rkcz9vZFtpXTpudWxsLHBvcDp4LnBvcCxob2xlOnguaG9sZSxwYzp4LnBjLG1vZGU6eC5tb2RlLG46eC5uLAogICBjYXJlZXI6eC5jYXJlZXIscmVjZW50OngucmVjZW50LHRhZ3M6eC50YWdzLHJhdGluZzoocE5ldyYmUE0uaG9sZUN1dHMmJnguaG9sZSk/Z3JhZGVIb2xlKFBNLmhvbGVDdXRzLHApOlVFLnJhdGluZyh4LnBjLHgubW9kZSx4Lm4pLHh9fSk7CiByZXR1cm57Li4uYmFzZSxoYXNPZGRzLHJlcyxhcCx1ZyxheGlzLGhvcnNlcyxob2xlTmV3OiEhKHBOZXcmJlBNLmhvbGVDdXRzKSxwbGFjZVJlYWw6aG9yc2VzLmZpbHRlcihoPT5oLnNyYz09PSLlrp8iKS5sZW5ndGh9Owp9CmFzeW5jIGZ1bmN0aW9uIGNhbGNXZWVrZW5kKCl7CiBXSy5jYWxjPXt9OwogY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShXSy5kYXRlc1swXSk7CiBXSy5zdG9yZUluZm89e2xhc3Q6c3RvcmUubGFzdERhdGV8fCIiLGNvdW50OnN0b3JlLmNvdW50LGR1cHM6c3RvcmUuZHVwUmFjZXN8fDB9OwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IGNzPVsuLi5XSy5jYXJkc1tkXV0uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiLnZlbnVlQ29kZSkpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAgV0suY2FsY1tkXT17cmFjZXM6W119OwogIGZvcihsZXQgaT0wO2k8Y3MubGVuZ3RoO2krKyl7CiAgIHRyeXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goY2FsY1JhY2UoZCxjc1tpXSxzdG9yZSkpfQogICBjYXRjaChlKXtXSy5jYWxjW2RdLnJhY2VzLnB1c2goe2QsY2FyZDpjc1tpXSxza2lwOiLop6PmnpDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSxsYWJlbDpgJHtjc1tpXS52ZW51ZU5hbWV8fCIifSR7Y3NbaV0ucmFjZU51bWJlcnx8IiJ9UmAsdmVudWU6Y3NbaV0udmVudWVOYW1lfHwiIixubzpjc1tpXS5yYWNlTnVtYmVyfHwwLGhvcnNlczpbXX0pfQogICBpZihpJTQ9PT0zKWF3YWl0IHNsZWVwKDApOwogIH0KIH0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOaknOiovOOCsuODvOODiO+8muWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBp+OAgeiqpOW3ruOCkuW8leOBhOOBpuOCguWbnuWPjueOhzEwMCXku6XkuIrjga7osrfjgYTmlrnjgaDjgZHjgIzmpJzoqLzmuIjjgb/jgI0KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBHQVRFX0tFWT0ia2VpYmFfZ2F0ZV92MiI7CmNvbnN0IGdldEdhdGU9KCk9Pnt0cnl7cmV0dXJuIEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oR0FURV9LRVkpfHwibnVsbCIpfWNhdGNoKGUpe3JldHVybiBudWxsfX07CmNvbnN0IFNUUkFUPXtmb2N1czoi56m06aas77yI4peO55qE5Lit546H6YeN6KaW77yJIix0b3AxOiLnqbTppqwx5L2NIix0b3AyOiLnqbTppqzkuIrkvY0y6aCtIix2YWx1ZToi5aaZ5ZGzMS4z5YCN5Lul5LiKIixheGlzOiLpiYTmnb/ou7gifTsKZnVuY3Rpb24gc2V0R2F0ZShvdXQsb3V0UCl7CiBjb25zdCBpdGVtcz1bXTsKIGZvcihjb25zdCBbc3JjLG9dIG9mIFtbIuOCquODg+OCuuOBguOCiiIsb3V0XSxbIuOCquODg+OCuuOBquOBlyIsb3V0UF1dKXsKICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhTVFJBVCkpewogICBjb25zdCB2PW8uc3RhdHNba107aWYoIXYpY29udGludWU7CiAgIGNvbnN0IHNlZz0odi5DJiZ2LkMuYmV0cz49MzAwKT92LkM6di5hbGw7aWYoIXNlZ3x8IXNlZy5iZXRzKWNvbnRpbnVlOwogICBjb25zdCBsb3c9c2VnLnJvaS0xLjk2KnNlZy5zZTsKICAgaXRlbXMucHVzaCh7a2V5OmssbGFiZWw6U1RSQVRba10rIu+8iCIrc3JjKyLvvIkiLHJvaTpzZWcucm9pLGxvdyxiZXRzOnNlZy5iZXRzLGhpdDpzZWcuaGl0UmF0ZSxzZWc6c2VnPT09di5DPyLlrabnv5LlvowiOiLlhajmnJ/plpMifSk7CiAgfQogfQogbG9jYWxTdG9yYWdlLnNldEl0ZW0oR0FURV9LRVksSlNPTi5zdHJpbmdpZnkoe2F0Om5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSxpdGVtc30pKTsKIG1vZGVsc1RvTWV0YSgpOwogcmVuZGVyR2F0ZSgpOwp9CmNvbnN0IHN0cmF0T2s9a2V5PT57Y29uc3QgZz1nZXRHYXRlKCk7cmV0dXJuICEhKGcmJmcuaXRlbXMuc29tZSh4PT54LmtleT09PWtleSYmeC5sb3c+PTEmJnguYmV0cz49MzAwKSl9Owpjb25zdCBzdHJhdENoaXA9a2V5PT5zdHJhdE9rKGtleSk/JzxzcGFuIGNsYXNzPSJjaGlwIGIiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvIk8L3NwYW4+JzonPHNwYW4gY2xhc3M9ImNoaXAgciI+5Zue5Y+O546HMTAwJei2heOBr+acqueiuuiqjTwvc3Bhbj4nOwpmdW5jdGlvbiByZW5kZXJHYXRlKCl7CiB0cnl7cmVuZGVyTW9kZWxTdGF0dXMoKX1jYXRjaChlKXt9CiBjb25zdCBnPWdldEdhdGUoKSxlbD0kKCJnYXRlIik7CiBpZighZyl7ZWwuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPjxiPuWbnuWPjueOh++8muacquaknOiovDwvYj7jgIDjgIzmpJzoqLzjgI3jgr/jg5bjgpLlrp/ooYzjgZnjgovjgb7jgafjgIHjganjga7osrfjgYTmlrnjgoLjgIwxMDAl6LaF44CN44Go44Gv6KiA44GI44G+44Gb44KT44CC77yI5Lul5YmN44Gu5qSc6Ki844Gn44Gv44CB56m06aasMeS9jeOBruikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzcl44Gn44GX44Gf77yJPC9kaXY+JztyZXR1cm59CiBjb25zdCBvaz1nLml0ZW1zLmZpbHRlcih4PT54Lmxvdz49MSYmeC5iZXRzPj0zMDApLGJlc3Q9Zy5pdGVtcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucm9pLWEucm9pKVswXTsKIGlmKG9rLmxlbmd0aCllbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBvayI+PGI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8ie+8mjwvYj4ke29rLm1hcCh4PT5gJHtlc2MoeC5sYWJlbCl9ICR7cGN0KHgucm9pKX3vvIjkuIvpmZAke3BjdCh4Lmxvdyl944O7JHt4LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske3guc2Vnfe+8iWApLmpvaW4oIu+8jyIpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILpgY7ljrvjga7miJDnuL7jgafjga7ntZDmnpzjgafjgIHku4rlvozjgoLntprjgY/kv53oqLzjga/jgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+PC9kaXY+YDsKIGVsc2UgZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgbmciPjxiPuWbnuWPjueOhzEwMCXotoXjgpLnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjga/jgIHjgb7jgaDjgYLjgorjgb7jgZvjgpPjgII8L2I+JHtiZXN0P2DmnIDpq5jjgafjgoIgJHtlc2MoYmVzdC5sYWJlbCl9IOOBriAke3BjdChiZXN0LnJvaSl977yI6Kqk5beu44KS5byV44GP44GoJHtwY3QoYmVzdC5sb3cpfeODuyR7YmVzdC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHtiZXN0LnNlZ33vvInjgIJgOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILkuIvjga7lgJnoo5zjga/jgIzlvZPjgZ/jgorjgoTjgZnjgZXjg7vmnJ/lvoXlgKTjga7nm67lronjgI3jgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+PC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOihqOekugogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IElST05fUD0wLjk1OyAgIC8vIOi2hemJhOadv++8neikh+WLneWcj+WGheOBq+WFpeOCi+eiuueOh+OBjDk1JeS7peS4iuOBrummrO+8iOmgreaVsOOBruWItumZkOOBquOBl++8iQpjb25zdCBHUkFERV9PUkRFUj1bIlNTUyIsIlNTIiwiUyIsIkEiLCJCIiwiQyJdLEdSQURFX0NPTE9SPXtTU1M6IiNiNDIzMTgiLFNTOiIjZDkyZDIwIixTOiIjZjc5MDA5IixBOiIjMTY2N2Q5IixCOiIjNjY3MDg1IixDOiIjOThhMmIzIn07CmNvbnN0IGRheUxhYmVsPWQ9Pntjb25zdCB3PSLml6XmnIjngavmsLTmnKjph5HlnJ8iW25ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRVVENEYXkoKV07cmV0dXJuIGAke2Quc2xpY2UoNSkucmVwbGFjZSgiLSIsIi8iKX0oJHt3fSlgfTsKY29uc3QgY2FsY1JhY2VzPWQ9PihXSy5jYWxjW2RdJiZXSy5jYWxjW2RdLnJhY2VzKXx8W107CmNvbnN0IGFsbFJhY2VzPSgpPT5XSy5kYXRlcy5mbGF0TWFwKGQ9PmNhbGNSYWNlcyhkKSk7CmNvbnN0IG5vRGF0YT1tc2c9PmA8ZGl2IGNsYXNzPSJzbWFsbCI+JHttc2d8fCLjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCIn08L2Rpdj5gOwoKZnVuY3Rpb24gcmVuZGVyQWxsKCl7cmVuZGVyR2F0ZSgpO3JlbmRlckF4aXMoKTtyZW5kZXJFdigpO3JlbmRlclVwc2V0KCk7cmVuZGVySG9sZSgpO3JlbmRlclJhY2VzKCk7cmVuZGVyU3VtKCl9CgovKiAtLS0g6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaF44Gu56K6546H44GM6auY44GE6Lu46aas77yJ77ya5Z+65rqW77yI56K6546H44Gu5LiL6ZmQ77yJ44KS6YG444G544KLIC0tLSAqLwpjb25zdCBJUk9OX0tFWT0ia2VpYmFfaXJvbl9jdXQiOwovKiDln7rmupbjgZTjgajjga7pgY7ljrvjga7lrp/nuL7ooajvvJrlho3moKHmraPlvozjga/mpJzoqLzmnJ/plpPjga7lrp/nuL7jgIHjgarjgZHjgozjgbDmqJnmupbjg6Ljg4fjg6vjga7mpJzoqLzntZDmnpzvvIjljLrliIbjgpLnqY3jgb/kuIrjgZLvvIkgKi8KZnVuY3Rpb24gaXJvblRhYmxlKCl7CiBjb25zdCBQTXg9Z2V0UGxhY2VNb2RlbCgpOwogaWYoUE14JiZQTXgudGhyJiZQTXgudGVzdERheXMpewogIHJldHVybntzcmM6YOWGjeagoeato+W+jOOBruaknOiovOacn+mWk++8iCR7UE14LnRlc3REYXlzfemWi+WCrOaXpe+8ieOBp+OBruWun+e4vmAscm93czpQTXgudGhyLmZpbHRlcih0PT50LnQ+PS44NSYmdC5uPjApLm1hcCh0PT4oe2N1dDp0LnQscmF0ZTp0LnJhdGUsbG86dC5sbyxuOnQubixwZXJEYXk6dC5uL1BNeC50ZXN0RGF5c30pKS5zb3J0KChhLGIpPT5iLmN1dC1hLmN1dCl9OwogfQogY29uc3QgQj1VRS5BWElTLmJhbmRzLHJvd3M9W107bGV0IG49MCxrPTAscGQ9MDsKIGZvcihjb25zdCBbbm0sY3V0XSBvZiBbWyLpiYTmnb8iLC45Ml0sWyLmupbpiYTmnb8iLC44OF0sWyLloIXou7giLC44NF1dKXtjb25zdCBiPUJbbm1dO24rPWIubjtrKz1iLm4qYi5yYXRlO3BkKz1iLnBlckRheTtjb25zdCB3PXdpbHNvbihNYXRoLnJvdW5kKGspLG4pO3Jvd3MucHVzaCh7Y3V0LHJhdGU6ay9uLGxvOndbMF0sbixwZXJEYXk6cGR9KX0KIHJldHVybntzcmM6Iuaomea6luODouODh+ODq+OBruaknOiovOe1kOaenO+8iDIwMjTlubTku6XpmY3vvIkiLHJvd3M6cm93cy5zb3J0KChhLGIpPT5iLmN1dC1hLmN1dCl9Owp9CmNvbnN0IGlyb25TdGF0PShyb3dzLHApPT5yb3dzLmZpbmQoeD0+eC5jdXQ8PXArMWUtOSl8fG51bGw7CmZ1bmN0aW9uIHJlbmRlckF4aXMoKXsKIGNvbnN0IGVsPSQoInZBeGlzIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IHRiPWlyb25UYWJsZSgpLGN1dHM9dGIucm93cy5tYXAocj0+ci5jdXQpOwogbGV0IGN1dD0oJCgiaXJvbkN1dCIpJiZOdW1iZXIoJCgiaXJvbkN1dCIpLnZhbHVlKSl8fDA7CiBpZighY3V0KXt0cnl7Y3V0PU51bWJlcihsb2NhbFN0b3JhZ2UuZ2V0SXRlbShJUk9OX0tFWSkpfHwwfWNhdGNoKGUpe319CiBpZighY3V0fHwhY3V0cy5sZW5ndGgpY3V0PWN1dHMuaW5jbHVkZXMoLjk1KT8uOTU6KGN1dHNbMF18fC45Mik7CiBjdXQ9Y3V0cy5yZWR1Y2UoKGIsYyk9Pk1hdGguYWJzKGMtY3V0KTxNYXRoLmFicyhiLWN1dCk/YzpiLGN1dHNbMF18fGN1dCk7ICAgLy8g6KGo44Gr44GC44KL5Z+65rqW44Gu44GG44Gh44CB44GE44Gh44Gw44KT6L+R44GE44KC44GuCiB0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oSVJPTl9LRVksU3RyaW5nKGN1dCkpfWNhdGNoKGUpe30KIGNvbnN0IGN1cj1pcm9uU3RhdCh0Yi5yb3dzLGN1dCk7CiBsZXQgaD1gPGgyPui2hemJhOadv++8iOikh+WLneWcj+WGheOBrueiuueOh+OBjOmrmOOBhOi7uOmmrO+8iTwvaDI+JHtzdHJhdENoaXAoImF4aXMiKX0ke3BsYWNlU3RhdHVzTGluZSgpfQogPGRpdiBjbGFzcz0icm93IHNtYWxsIj7ln7rmupbvvJropIfli53lnI/lhoXjga7norrnjofjgYwgPHNlbGVjdCBpZD0iaXJvbkN1dCI+JHtjdXRzLm1hcChjPT5gPG9wdGlvbiB2YWx1ZT0iJHtjfSI+JHtwY3QoYywwKX3ku6XkuIo8L29wdGlvbj5gKS5qb2luKCIiKX08L3NlbGVjdD4g44Gu6aas44KS44CB6aCt5pWw44Gu5Yi26ZmQ44Gq44GX44Gn5Ye644GX44G+44GZPC9kaXY+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gg44GR5Yik5a6a44GX44G+44GZ44CCPGI+5Z+65rqW44KS5LiL44GS44KL44Go6aCt5pWw44Gv5aKX44GI44G+44GZ44GM44CB5a6f6Zqb44Gu55qE5Lit546H44Gv5LiL44GM44KK44G+44GZPC9iPu+8iCR7ZXNjKHRiLnNyYyl977yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5Z+65rqWPC90aD48dGg+5a6f6Zqb44Gu55qE5Lit546HPC90aD48dGg+OTUl44Gu5bmFPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4ke3RiLnJvd3MubWFwKHI9PmA8dHIke3IuY3V0PT09Y3V0Pycgc3R5bGU9ImZvbnQtd2VpZ2h0OjcwMCInOiIifT48dGQ+JHtwY3Qoci5jdXQsMCl95Lul5LiKPC90ZD48dGQ+JHtwY3Qoci5yYXRlLDEpfTwvdGQ+PHRkPiR7cGN0KHIubG8sMSl944CcPC90ZD48dGQ+JHtyLnBlckRheS50b0ZpeGVkKDIpfemgrTwvdGQ+PC90cj5gKS5qb2luKCIiKX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGlmKGN1ciloKz1gPGRpdiBjbGFzcz0ic21hbGwiPumBuOaKnuS4re+8iCR7cGN0KGN1dCwwKX3ku6XkuIrvvInvvJrpgY7ljrvjgavlrp/pmpvjgas8Yj4ke3BjdChjdXIucmF0ZSwxKX08L2I+44GMM+edgOS7peWGheOAgTHml6XjgYLjgZ/jgorntIQ8Yj4ke2N1ci5wZXJEYXkudG9GaXhlZCgyKX3poK08L2I+44CCJHtjdXIucmF0ZTwuOTU/JzxzcGFuIGNsYXNzPSJ3YXJuIj45NSXjgavjga/lsYrjgY3jgb7jgZvjgpPjgII8L3NwYW4+JzoiIn08L2Rpdj5gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKS5maWx0ZXIocj0+IXIuc2tpcCkscGlja3M9W10scmVmPVtdOwogIGZvcihjb25zdCByIG9mIHJzKWlmKHIuaGFzT2Rkcylmb3IoY29uc3QgaGggb2Ygci5ob3JzZXMpewogICBpZihoaC5wPj1jdXQpcGlja3MucHVzaCh7cixoaCxzdDppcm9uU3RhdCh0Yi5yb3dzLGhoLnApfSk7CiAgIGVsc2UgaWYoaGgucD49KGN1dHNbY3V0cy5sZW5ndGgtMV18fC44NCkpcmVmLnB1c2goe3IsaGgsc3Q6aXJvblN0YXQodGIucm93cyxoaC5wKX0pOwogIH0KICBwaWNrcy5zb3J0KChhLGIpPT5iLmhoLnAtYS5oaC5wKTtyZWYuc29ydCgoYSxiKT0+Yi5oaC5wLWEuaGgucCk7CiAgY29uc3Qgbk9kZHM9cnMuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoOwogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX3jgIA8c3BhbiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuWPluW+lyAke25PZGRzfS8ke3JzLmxlbmd0aH3jg6zjg7zjgrk8L3NwYW4+PC9oMz5gOwogIGlmKCFuT2Rkcyl7aCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN44KS5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+Jztjb250aW51ZX0KICBjb25zdCBjYXJkPSh6LHRhZyk9PmA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyh6LnIubGFiZWwpfTwvYj7jgIA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHouci5jb3Vyc2UpfeODuyR7ei5yLm596aCtPC9zcGFuPjxicj48Yj4ke3ouaGgubm9955WqICR7ZXNjKHouaGgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgckEiPiR7dGFnfTwvc3Bhbj7jgIDopIfli53lnI/lhoXjga7norrnjocgJHtwY3Qoei5oaC5wLDEpfTxicj4KICAgPHNwYW4gY2xhc3M9InNtYWxsIj7pqI7miYvvvJoke2VzYyh6LmhoLmpuYW1lfHwi5LiN5piOIil977yP6Kq/5pWZ5bir77yaJHtlc2Moei5oaC50cmFpbmVyfHwi5LiN5piOIil977yP5Y2Y5YudICR7ei5oaC53aW4/ei5oaC53aW4rIuWAjSI6Ii0ife+8j+ikh+WLnSAke3ouaGgubG8/ei5oaC5sby50b0ZpeGVkKDEpKyh6LmhoLmhpPnouaGgubG8/IuOAnCIrei5oaC5oaS50b0ZpeGVkKDEpOiIiKSsi5YCNIisoei5oaC5zcmM9PT0i5o6o5a6aIj8iKOaOqOWumikiOiIiKToiLSJ977yP44GT44Gu56K6546H5biv44Gu6YGO5Y675a6f57i+ICR7ei5zdD9wY3Qoei5zdC5yYXRlLDEpOiLpm4boqIjlpJYifTwvc3Bhbj48L2Rpdj5gOwogIGlmKHBpY2tzLmxlbmd0aCloKz1waWNrcy5tYXAoej0+Y2FyZCh6LHouaGgucD49Ljk1PyLotoXpiYTmnb8iOiLou7jlgJnoo5wiKSkuam9pbigiIik7CiAgZWxzZSBoKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7ln7rmupbvvIgke3BjdChjdXQsMCl95Lul5LiK77yJ44Gr6Kmy5b2T44GZ44KL6aas44Gv44GE44G+44Gb44KT44CC54Sh55CG44Gr6LK344KP44Gq44GE44Gu44KC5LiA44Gk44Gu5Yik5pat44Gn44GZ44CCPC9kaXY+YDsKICBpZighcGlja3MubGVuZ3RoJiZyZWYubGVuZ3RoKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+C6ICD77yI5Z+65rqW44Gr44Gv5bGK44GL44Gq44GE44CB44Gd44Gu5pel44Gu5pyA5pyJ5Yqb77yJ77yaPC9kaXY+YCtyZWYuc2xpY2UoMCwyKS5tYXAoej0+Y2FyZCh6LCLlj4LogIMiKSkuam9pbigiIik7CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHNlbD0kKCJpcm9uQ3V0Iik7c2VsLnZhbHVlPVN0cmluZyhjdXQpO3NlbC5vbmNoYW5nZT1yZW5kZXJBeGlzOwp9CgovKiAtLS0g5pyf5b6F5YCk77yI6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuu+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyRXYoKXsKIGNvbnN0IGVsPSQoInZFdiIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBldk1pbj1OdW1iZXIoJCgiZXZNaW4iKT8kKCJldk1pbiIpLnZhbHVlOjEuMDUpLHBNaW49TnVtYmVyKCQoImV2UCIpPyQoImV2UCIpLnZhbHVlOi4yNSk7CiBjb25zdCByb3dzPVtdOwogZm9yKGNvbnN0IHIgb2YgYWxsUmFjZXMoKSlpZighci5za2lwKWZvcihjb25zdCBoIG9mIHIuaG9yc2VzKWlmKGguZXYhPW51bGwmJmguZXY+PWV2TWluJiZoLnA+PXBNaW4pcm93cy5wdXNoKHtyLGh9KTsKIHJvd3Muc29ydCgoYSxiKT0+Yi5oLmV2LWEuaC5ldik7CiBjb25zdCBuT2Rkcz1hbGxSYWNlcygpLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aDsKIGxldCBoPWA8aDI+5pyf5b6F5YCk77yI6KSH5Yud56K6546HIMOXIOikh+WLneOCquODg+OCuu+8iTwvaDI+JHtzdHJhdENoaXAoInZhbHVlIil9CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5pyf5b6F5YCk77yd44Gd44Gu6aas44GMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyDDlyDopIfli53jgqrjg4Pjgrrjga7kuIvpmZDjgIIxLjDjgpLotoXjgYjjgozjgbDjgIHnkIboq5bkuIrjga/osrfjgYTntprjgZHjgabjg5fjg6njgrnjgafjgZnjgILopIfli53jgqrjg4Pjgrrjga88Yj7lrp88L2I+77ydSlJB44Gu5a6f44Kq44OD44K644CBPGI+5o6o5a6aPC9iPu+8neWNmOWLneOBi+OCieioiOeul+OBl+OBn+ebruWuieOAgueiuueOh+OBruimi+epjeOCguOCiumBleOBhOOBjOWkp+OBjeOBj+WKueOBj+OBn+OCgeOAgeOAjOaknOiovOOAjeOBpzEwMCXotoXjgYznorroqo3jgZXjgozjgovjgb7jgafjga/nm67lronjgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+5pyf5b6F5YCkIDxzZWxlY3QgaWQ9ImV2TWluIj48b3B0aW9uIHZhbHVlPSIxIj4xLjAw5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4wNSI+MS4wNeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMSI+MS4xMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMiI+MS4yMOS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PiDopIfli53norrnjocgPHNlbGVjdCBpZD0iZXZQIj48b3B0aW9uIHZhbHVlPSIwLjE1Ij4xNSXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjI1Ij4yNSXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjQiPjQwJeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuNiI+NjAl5Lul5LiKPC9vcHRpb24+PC9zZWxlY3Q+PC9kaXY+YDsKIGlmKCFuT2Rkcyl7ZWwuaW5uZXJIVE1MPWgrJzxkaXYgY2xhc3M9ImJhbm5lciB3biI+44Kq44OD44K644GM5pyq5Y+W5b6X44Gu44Gf44KB44CB5pyf5b6F5YCk44Gv6KiI566X44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CM44Kq44OD44K644Gg44GR5pu05paw44CN77yJ44CCPC9kaXY+JztiaW5kRXYoZXZNaW4scE1pbik7cmV0dXJufQogaWYoIXJvd3MubGVuZ3RoKWgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuadoeS7tuOBq+WQiOOBhummrOOBr+OBhOOBvuOBm+OCk+OAgjwvZGl2Pic7CiBlbHNlewogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6aasPC90aD48dGg+56K6546HPC90aD48dGg+6KSH5YudPC90aD48dGg+5pyf5b6F5YCkPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHtyLGg6eH0gb2Ygcm93cy5zbGljZSgwLDQwKSloKz1gPHRyPjx0ZD4ke2VzYyhkYXlMYWJlbChyLmQpKX0gJHtlc2Moci5sYWJlbCl9PGJyPjxiPiR7eC5ub33nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2MoeC5qbmFtZXx8IiIpfTwvc3Bhbj48L3RkPjx0ZD4ke3BjdCh4LnApfTwvdGQ+PHRkPiR7eC5sby50b0ZpeGVkKDEpfSR7eC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIn08c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5zcmN9PC9zcGFuPjwvdGQ+PHRkPjxiPiR7eC5ldi50b0ZpeGVkKDIpfTwvYj48L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDtiaW5kRXYoZXZNaW4scE1pbik7Cn0KZnVuY3Rpb24gYmluZEV2KGEsYil7Y29uc3QgZT0kKCJldk1pbiIpLHA9JCgiZXZQIik7aWYoIWUpcmV0dXJuO2UudmFsdWU9U3RyaW5nKGEpO3AudmFsdWU9U3RyaW5nKGIpO2Uub25jaGFuZ2U9cC5vbmNoYW5nZT1yZW5kZXJFdn0KCi8qIC0tLSDms6LkubHluqYgLS0tICovCi8qIOaknOiovOa4iOOBv+OBruODouODh+ODq+OBjOOBguOCjOOBsOOAgeOBneOBruetiee0muOBp+mBjuWOu+OBq+Wun+mam+OBq+WHuuOBn+aJleaIu++8iOWNmOWLneOBruS4reWkruWApOOAgTEwMDDlhobku6XkuIrjga7libLlkIjvvInjgpLooajnpLogKi8KY29uc3QgcGF5Q2VsbD1nPT57Y29uc3QgTT1nZXRVcHNldE1vZGVsKCkseD1NJiZNLnBheVRhYiYmTS5wYXlUYWJbZ107aWYoIXh8fCF4Lm5wfHx4Lm1lZFdpbj09bnVsbClyZXR1cm4iLSI7cmV0dXJuYOWNmOWLneOBruS4reWkruWApCAke01hdGgucm91bmQoeC5tZWRXaW4pLnRvTG9jYWxlU3RyaW5nKCl95YaGPGJyPjEwMDDlhobku6XkuIogJHtwY3QoeC5zaGFyZTEwMDAsMCl9YH07CmZ1bmN0aW9uIHJlbmRlclVwc2V0KCl7CiBjb25zdCBlbD0kKCJ2VXBzZXQiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogbGV0IGg9YDxoMj7jg6zjg7zjgrnjga7ms6LkubHluqbvvIhTU1PjgJxD77yJPC9oMj48ZGl2IGNsYXNzPSJzbWFsbCI+44CMM+edgOS7peWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44CN44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GR44GX44Gm44GE44G+44GZ77yI5YWo44Os44O844K55bmz5Z2HIOe0hDI4LjUl77yJ44CC44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gv44CB44Kq44OD44K66L6844G/44Gu5Yik5a6a44Gr44Gq44KK44G+44GZ44CCPC9kaXY+JHt1cHNldFN0YXR1c0xpbmUoKX1gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGNvbnN0IHJzPWNhbGNSYWNlcyhkKS5maWx0ZXIocj0+IXIuc2tpcCksY250PXt9O0dSQURFX09SREVSLmZvckVhY2goZz0+Y250W2ddPTApO3JzLmZvckVhY2gocj0+Y250W3IudWcuZ3JhZGVdKyspOwogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPjxkaXYgY2xhc3M9InJvdyI+JHtHUkFERV9PUkRFUi5tYXAoZz0+YDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnXX0iPiR7Z30gJHtjbnRbZ119PC9zcGFuPmApLmpvaW4oIiAiKX08L2Rpdj5gOwogIGNvbnN0IHNvcnRlZD1ycy5zbGljZSgpLnNvcnQoKGEsYik9PkdSQURFX09SREVSLmluZGV4T2YoYS51Zy5ncmFkZSktR1JBREVfT1JERVIuaW5kZXhPZihiLnVnLmdyYWRlKXx8Yi51Zy5wLWEudWcucCk7CiAgaCs9YDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nrYnntJo8L3RoPjx0aD7kuojmuKw8L3RoPjx0aD7lrp/nuL7jga7ms6LkubHnjoc8L3RoPjx0aD7pgY7ljrvjga7miZXmiLvvvIjnrYnntJrliKXvvIk8L3RoPjx0aD7liKTlrpo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgciBvZiBzb3J0ZWQpaCs9YDx0cj48dGQ+JHtlc2Moci5sYWJlbCl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrTwvc3Bhbj4ke3Iuc2NyYXRjaGVkJiZyLnNjcmF0Y2hlZC5sZW5ndGg/YCA8c3BhbiBjbGFzcz0iY2hpcCBvIj7pmaTlpJbmjqjlrpogJHtyLnNjcmF0Y2hlZC5qb2luKCIsIil955WqPC9zcGFuPmA6IiJ9PC90ZD48dGQ+PHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW3IudWcuZ3JhZGVdfSI+JHtyLnVnLmdyYWRlfTwvc3Bhbj48L3RkPjx0ZD4ke3BjdChyLnVnLnApfTwvdGQ+PHRkPiR7ci51Zy5jdXN0b20mJnIudWcucmF0ZSE9bnVsbD9gJHtwY3Qoci51Zy5yYXRlKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke3BjdChyLnVnLmxvKX3jgJwke3BjdChyLnVnLmhpKX3jg7ske3IudWcubn3ku7Y8L3NwYW4+YDpNYXRoLnJvdW5kKHIudWcucmF0ZSoxMDApKyIlIn08L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7cGF5Q2VsbChyLnVnLmdyYWRlKX08L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7ci51Zy5tb2RlPT09Im9kZHMiPyLjgqrjg4Pjgrrovrzjgb8iOiLmjqjlrpoifTwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g56m06aas77yI5aW96LWw546H44Gu6auY44GE56m06aas5YCZ6KOc77yJIC0tLSAqLwovKiDnqbTppqzjga7lgJnoo5zvvJrlho3moKHmraPmuIjjgb/vvIjjgqrjg4Pjgrrlj5blvpflvozvvInjgarjgonmlrDjgZfjgYTnorrnjofjgafjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDlvpPmnaXjga7oqZXkvqHjgafpgbjjgbYgKi8KZnVuY3Rpb24gcGlja0hvbGUocixobSl7CiBpZihyLmhvbGVOZXcpewogIGNvbnN0IEw9ci5ob3JzZXMuZmlsdGVyKGg9PmguaG9sZSYmaC5uPj0zJiYoaC53aW49PW51bGx8fGgud2luPDMwKSkuc29ydCgoYSxiKT0+Yi5wLWEucCk7CiAgY29uc3QgcGs9aD0+KHtpOmguaSxubzpoLm5vLG5hbWU6aC5uYW1lLHBjOmgucCxvZGQ6aC53aW4scG9wOmgucG9wLHRhZ3M6aC50YWdzfHxbXX0pOwogIGlmKGhtPT09IlMiKXJldHVybiBMLmZpbHRlcihoPT5oLnJhdGluZz09PSJTIikuc2xpY2UoMCwzKS5tYXAocGspOwogIGlmKGhtPT09IlNBIilyZXR1cm4gTC5maWx0ZXIoaD0+aC5yYXRpbmc9PT0iUyJ8fGgucmF0aW5nPT09IkEiKS5zbGljZSgwLDIpLm1hcChwayk7CiAgcmV0dXJuIHIuaG9yc2VzLmZpbHRlcihoPT5oLmhvbGUmJmgubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCwyKS5tYXAocGspOwogfQogcmV0dXJuIGhtPT09IlMiP1VFLnBpY2tGb2N1cyhyLnJlcyw2KS5maWx0ZXIoeD0+ci5ob3JzZXNbeC5pXS5yYXRpbmc9PT0iUyIpLnNsaWNlKDAsMyk6aG09PT0iU0EiP1VFLnBpY2tGb2N1cyhyLnJlcywyKTpVRS5waWNrKHIucmVzLDIpOwp9CmZ1bmN0aW9uIGhvbGVSYXRpbmdUZXh0KCl7CiBjb25zdCBQTT1nZXRQbGFjZU1vZGVsKCk7CiBpZihQTSYmUE0uaG9sZUN1dHMmJlBNLmhvbGVTdGF0cyl7Y29uc3QgdD1QTS5ob2xlU3RhdHMudGFiLGM9UE0uaG9sZUN1dHM7cmV0dXJuYOipleS+oeOBrzxiPuWGjeagoeato+W+jOOBruikh+WLneeiuueOhzwvYj7jgafmsbrjgoHjgabjgYTjgb7jgZnvvJpT77yd5LqI5risJHtwY3QoYy5TLDEpfeS7peS4iu+8iOaknOiovOacn+mWk+OBruWun+mam+OBrueahOS4reeOhyAke3BjdCh0LlMucmF0ZSwxKX3vvInjgIFB77ydJHtwY3QoYy5BLDEpfeS7peS4iu+8iCR7cGN0KHQuQS5yYXRlLDEpfe+8ieOAgULvvJ0ke3BjdChjLkIsMSl95Lul5LiK77yIJHtwY3QodC5CLnJhdGUsMSl977yJ44CB44Gd44KM5Lul5aSW77ydQ++8iCR7cGN0KHQuQy5yYXRlLDEpfe+8ieOAguOAjFPjg7tB44CN6KGo56S644Gv44CB6LWw5pWwM+S7peS4iuOBp+WNmOWLnTMw5YCN5pyq5rqA44Gu6aas44Gg44GR44Gn44GZ44CCYH0KIHJldHVybmDoqZXkvqHjga/jgIHnqbTppqzjga7lubPlnYfnmoTjgarlpb3otbDnjofvvIjjgqrjg4Pjgrrovrzjgb85LjEl77yP5o6o5a6aMTEuNSXvvInjgavlr77jgZnjgovlgI3njofjgafmsbrjgb7jgorjgb7jgZnvvJpT77ydMi4y5YCN5Lul5LiK77yI57SEMjAl5Lul5LiK77yP5o6o5a6a44Gv57SEMjUl5Lul5LiK77yJ44CBQe+8nTEuN+WAjeS7peS4iu+8iOe0hDE1LjUl5Lul5LiK77yP57SEMTkuNiXku6XkuIrvvInjgIFC77ydMS4z5YCN5Lul5LiK44CBQ++8neOBneOCjOacqua6gOOAgui1sOaVsOOBjOWwkeOBquOBhOmmrOOBrlPjg7tB44Gv44CBQuOBq+S4i+OBkuOBvuOBmeOAguOAjFPjg7tB44CN6KGo56S644Gv44CB6LWw5pWwM+S7peS4iuOBp+WNmOWLnTMw5YCN5pyq5rqA44Gu6aas44Gg44GR44Gn44GZ44CCYDsKfQpmdW5jdGlvbiByZW5kZXJIb2xlKCl7CiBjb25zdCBlbD0kKCJ2SG9sZSIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBISz0ia2VpYmFfaG9sZV9tb2RlIjtsZXQgaG09KCQoImhvbGVGb2N1cyIpJiYkKCJob2xlRm9jdXMiKS52YWx1ZSl8fCgoKT0+e3RyeXtyZXR1cm4gbG9jYWxTdG9yYWdlLmdldEl0ZW0oSEspfWNhdGNoKGUpe3JldHVybiBudWxsfX0pKCl8fCJTQSI7aWYoIVsiUyIsIlNBIiwiYWxsIl0uaW5jbHVkZXMoaG0pKWhtPSJTQSI7CiB0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oSEssaG0pfWNhdGNoKGUpe30KIGxldCBoPWA8aDI+56m06aas5YCZ6KOcPC9oMj4ke3N0cmF0Q2hpcCgiZm9jdXMiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj48Yj7nqbTppqzvvJ3kurrmsJfjga7kuIvkvY3jga7ppqw8L2I+77yI6aCt5pWw44Gu57SENuWJsuOCiOOCiuS4i+OAguS+i++8mjE26aCt56uL44Gm44Gq44KJN+eVquS6uuawl+S7peS4i+OAgTEy6aCt56uL44Gm5Lul5LiL44Gq44KJNeeVquS6uuawl+S7peS4i++8ieOBruS4reOBp+OAgTPnnYDku6XlhoXjgavlhaXjgovnorrnjofjgYzpq5jjgYTppqzjgILjgIzlvZPjgZ/jgorjgoTjgZnjgZXjgI3jga7nm67lronjgafjgIHlm57lj47njofjga/liKXjgafjgZnjgIIke2hvbGVSYXRpbmdUZXh0KCl9PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxzZWxlY3QgaWQ9ImhvbGVGb2N1cyI+PG9wdGlvbiB2YWx1ZT0iUyI+U+OBoOOBke+8iOacgOOCguWlvei1sOeOh+OBjOmrmOOBhOeptOmmrO+8iTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IlNBIj5T44O7Qe+8iOKXjueahOS4reeOh+mHjeimlu+8iTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9ImFsbCI+44GZ44G544Gm77yI5LiK5L2NMumgre+8iTwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PgogJHtobT09PSJTIj8nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44CMU+OBoOOBkeOAjeOBr+e1nuOCiui+vOOBv+OBruihqOekuuOBp+OBmeOAgumBjuWOu+OBruaknOiovO+8iOaknOiovOOCv+ODlu+8ieOBr+OAgVPjg7tB44KS44G+44Go44KB44Gf5oiQ57i+44Gn6ZuG6KiI44GX44Gm44GE44KL44Gf44KB44CBU+OBoOOBkeOBruaIkOe4vuOBr+WIpeOBq+OBr+eiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvZGl2Pic6IiJ9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCljb250aW51ZTsKICAgY29uc3QgYz1waWNrSG9sZShyLGhtKTtpZighYy5sZW5ndGgpY29udGludWU7CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhyLmxhYmVsKX08L2I+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrSR7ci5oYXNPZGRzPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvIkifTwvc3Bhbj5gOwogICBmb3IoY29uc3QgeCBvZiBjKXtjb25zdCBoaD1yLmhvcnNlc1t4LmldOwogICAgaCs9YDxkaXYgc3R5bGU9Im1hcmdpbi10b3A6NnB4Ij48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7aGgucmF0aW5nfSI+JHtoaC5yYXRpbmd9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyAke2hoLnBTcmM/cGN0KGhoLnAsMSkrIu+8iOWGjeagoeato+W+jOOBruikh+WLneeiuueOh++8iSI6cGN0KHgucGMsMSl9JHt4Lm9kZD9g77yP5Y2Y5YudJHt4Lm9kZH3lgI0oJHt4LnBvcH3nlarkurrmsJcpYDoiIn08L3NwYW4+PGJyPgogICAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtoaC5jYXJlZXImJmhoLmNhcmVlci5uP2DpgJrnrpcke2hoLmNhcmVlci5ufei1sCAz552A5YaFJHtoaC5jYXJlZXIudDN95ZueYDoi6YCa566X77ya5bGl5q2044Gq44GXIn0ke2hoLnJlY2VudCYmaGgucmVjZW50Lmxlbmd0aD9g77yP55u06L+RICR7aGgucmVjZW50LnNsaWNlKC01KS5qb2luKCItIil9552AYDoiIn3vvI/pqI7miYvvvJoke2VzYyhoaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKGhoLnRyYWluZXJ8fCLkuI3mmI4iKX0ke2hoLnRyUmF0ZSE9bnVsbCYmaGgudHJOPj0yMD9gKDPnnYDlhoUke3BjdChoaC50clJhdGUpfSlgOiIifTwvc3Bhbj48YnI+YCsKICAgICAoeC50YWdzfHxbXSkuc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9CiAgIGgrPSI8L2Rpdj4iOwogIH0KIH0KIGVsLmlubmVySFRNTD1oOwogY29uc3Qgcz0kKCJob2xlRm9jdXMiKTtzLnZhbHVlPWhtO3Mub25jaGFuZ2U9cmVuZGVySG9sZTsKfQoKLyogLS0tIOWFqOODrOODvOOCue+8iOmmrOOBlOOBqOOBrueiuueOh+ODu+OCquODg+OCuuODu+acn+W+heWApOODu+mojuaJi+ODu+iqv+aVmeW4q++8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyUmFjZXMoKXsKIGNvbnN0IGVsPSQoInZSYWNlcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD0iPGgyPuWFqOODrOODvOOCuTwvaDI+IjsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCl7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj4ke2VzYyhyLmxhYmVsKX3vvJoke2VzYyhyLnNraXApfTwvZGl2PmA7Y29udGludWV9CiAgIGNvbnN0IGc9ci51ZzsKICAgaCs9YDxkZXRhaWxzPjxzdW1tYXJ5PiR7ZXNjKHIubGFiZWwpfSA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+IDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnLmdyYWRlXX0iPiR7Zy5ncmFkZX08L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqzvvI/pqI7miYvvvI/oqr/mlZnluKs8L3RoPjx0aD7ljZjli508L3RoPjx0aD7opIfli508L3RoPjx0aD7norrnjoc8L3RoPjx0aD5FVjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgeCBvZiByLmhvcnNlcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucC1hLnApKQogICAgaCs9YDx0cj48dGQ+PGI+JHt4Lm5vfTwvYj4gJHtlc2MoeC5uYW1lKX0ke3guaG9sZSYmeC5yYXRpbmchPT0iQyI/YCA8c3BhbiBjbGFzcz0icnQgciR7eC5yYXRpbmd9Ij4ke3gucmF0aW5nfTwvc3Bhbj5gOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5qbmFtZT9lc2MoeC5qbmFtZSk6JzxzcGFuIGNsYXNzPSJiYWQiPumojuaJi+S4jeaYjjwvc3Bhbj4nfe+8iCR7eC5qbj49NT8i6YGO5Y67Iit4LmpuKyLpqI7kuZciOiLlsaXmrbTlsJEife+8ie+8jyR7eC50cmFpbmVyP2VzYyh4LnRyYWluZXIpOic8c3BhbiBjbGFzcz0iYmFkIj7oqr/mlZnluKvkuI3mmI48L3NwYW4+J30ke3gudHJSYXRlIT1udWxsJiZ4LnRyTj49MjA/Iu+8iDPnnYDlhoUiK3BjdCh4LnRyUmF0ZSkrIu+8iSI6IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7eC53aW4/eC53aW4udG9GaXhlZCgxKToiLSJ9PC90ZD48dGQ+JHt4LmxvP3gubG8udG9GaXhlZCgxKSsoeC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIik6Ii0ifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY3x8IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmV2IT1udWxsP2A8YiR7eC5ldj49MS4wNT8nIGNsYXNzPSJnb29kIic6IiJ9PiR7eC5ldi50b0ZpeGVkKDIpfTwvYj5gOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2RldGFpbHM+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOWPluOCiui+vOOBv+eKtuazge+8iOmgreaVsOODu+mojuaJi+ODu+iqv+aVmeW4q+ODu+OCs+ODvOOCueODu+OCquODg+OCuuOBruiqreOBv+WPluOCiue1kOaenO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyU3VtKCl7CiBjb25zdCBlbD0kKCJ2U3VtIik7aWYoIVdLLmRhdGVzLmxlbmd0aCYmIVdLLmRpYWcubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgcnM9YWxsUmFjZXMoKS5maWx0ZXIocj0+IXIuc2tpcCk7CiBjb25zdCBob3JzZXM9cnMucmVkdWNlKChzLHIpPT5zK3IubiwwKSxqbWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLmpuYW1lKS5sZW5ndGgsMCksdG1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC50cmFpbmVyKS5sZW5ndGgsMCk7CiBjb25zdCBqbWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLmpuPj01KS5sZW5ndGgsMCksaG1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5uPj0yKS5sZW5ndGgsMCk7CiBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+ci5jb3Vyc2U9PT0i44Kz44O844K55LiN5piOIikubGVuZ3RoLG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aCxwUmVhbD1ycy5maWx0ZXIocj0+ci5wbGFjZVJlYWw+MCkubGVuZ3RoOwogbGV0IGg9YDxoMj7lj5bjgorovrzjgb/nirbms4E8L2gyPjx0YWJsZT48dGJvZHk+CiA8dHI+PHRkPuino+aekOOBl+OBn+ODrOODvOOCue+8j+WHuui1sOmmrDwvdGQ+PHRkPiR7cnMubGVuZ3RofeODrOODvOOCue+8jyR7aG9yc2VzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6aiO5omL44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7am1pc3M/ImJhZCI6Imdvb2QifSI+JHtqbWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuiqv+aVmeW4q+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke3RtaXNzPyJiYWQiOiJnb29kIn0iPiR7dG1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7jgrPjg7zjgrnjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrk8L3RkPjx0ZCBjbGFzcz0iJHtub0NvdXJzZT8iYmFkIjoiZ29vZCJ9Ij4ke25vQ291cnNlfTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gf44Os44O844K5PC90ZD48dGQ+JHtuT2Rkc33vvI8ke3JzLmxlbmd0aH3vvIjopIfli53jga7lrp/jgqrjg4PjgrogJHtwUmVhbH3jg6zjg7zjgrnvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmmrO+8iTwvdGQ+PHRkPiR7aG1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDLotbDku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmojuaJi++8iTwvdGQ+PHRkPiR7am1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDXpqI7kuZfku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpTwvdGQ+PHRkPiR7ZXNjKFdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3R8fCItIil9PC90ZD48L3RyPgogPHRyPjx0ZD7ph43opIfjgpLpmaTlpJbjgZfjgZ/jg6zjg7zjgrnvvIhDU1bjgajlj5blvpfjg4fjg7zjgr/vvIk8L3RkPjx0ZD4keyhXSy5zdG9yZUluZm8mJldLLnN0b3JlSW5mby5kdXBzKXx8MH08L3RkPjwvdHI+PC90Ym9keT48L3RhYmxlPmA7CiB7Y29uc3QgY3M9V0suZGF0ZXMuZmxhdE1hcChkPT5XSy5jYXJkc1tkXXx8W10pLGdrPWNzLmZpbHRlcihjPT5nb2luZ0NvZGUoYy5nb2luZyk+MCkubGVuZ3RoLGhzPWNzLmZsYXRNYXAoYz0+Yy5ob3JzZXN8fFtdKSxzaz1ocy5maWx0ZXIoeD0+eC5zaXJlfHx4LmRhbVNpcmUpLmxlbmd0aDsKICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPummrOWgtOeKtuaFi++8miR7Z2t9LyR7Y3MubGVuZ3RofeODrOODvOOCueOBp+eZuuihqOa4iOOBvyR7Z2s/IiI6Iu+8iOW9k+aXpeOBruacneOBq+eZuuihqOOBleOCjOOBvuOBmeOAguacqueZuuihqOOBruOBqOOBjeOBr+OAgemmrOWgtOOBruebuOaAp+OBr+S9v+OBhOOBvuOBm+OCk++8iSJ977yP6KGA57Wx44KS6Kqt44KB44Gf6aas77yaJHtza30vJHtocy5sZW5ndGh96aCt77yI6JOE56mN44GX44Gf6KGA57WxICR7T2JqZWN0LmtleXMoUEVEKS5sZW5ndGh96aCt77yJJHtocy5sZW5ndGgmJiFzaz8i44CC5Ye66aas6KGo44GL44KJ6KGA57Wx44KS6Kqt44KB44Gm44GE44G+44Gb44KT77yI6Kit5a6a44Gu44CM6Ki65pat5oOF5aCx44KS5L2c44KL44CN44Gu5Ye65Yqb44Gn44CB5a6f6Zqb44Gu44Oa44O844K444Gu5b2i44KS56K66KqN44Gn44GN44G+44GZ77yJIjoiIn08L2Rpdj5gfQogY29uc3Qgc2NyPXJzLmZpbHRlcihyPT5yLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoKSxqbXA9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5za2lwJiYv6Zqc5a6zLy50ZXN0KHIuc2tpcCkpOwogaWYoc2NyLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4Pjgrrjga7nhKHjgYTppqzjgpLlj5bmtojjg7vpmaTlpJbjgajjgb/jgarjgZfjgablpJbjgZfjgZ/jg6zjg7zjgrnvvJoke3Njci5tYXAocj0+ZXNjKHIubGFiZWwpKyLvvIgiK3Iuc2NyYXRjaGVkLmpvaW4oIiwiKSsi55Wq77yJIikuam9pbigi77yPIil944CC5a6f6Zqb44Gr5Ye66LWw44GZ44KL6aas44Gq44KJ44CB44Kq44OD44K644Gu5Y+W5b6X5ryP44KM44Gn44GZ44CCPC9kaXY+YDsKIGlmKGptcC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pmpzlrrPjg6zjg7zjgrkgJHtqbXAubGVuZ3RofeS7tuOBr+OAgeW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCgeino+aekOOBruWvvuixoeWkluOBq+OBl+OBpuOBhOOBvuOBmeOAgjwvZGl2PmA7CiBjb25zdCBnYXA9V0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdCYmV0suZGF0ZXNbMF0/TWF0aC5yb3VuZCgobmV3IERhdGUoV0suZGF0ZXNbMF0pLW5ldyBEYXRlKFdLLnN0b3JlSW5mby5sYXN0KSkvODY0ZTUpOm51bGw7CiBpZihnYXAhPW51bGwmJmdhcD4xMCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB44KC44GG5LiA5bqm5LqI5oOz44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGlmKHJzLmxlbmd0aCYmaG1hdGNoPGhvcnNlcyouNCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7pgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgZ/ppqzjgYzlsJHjgarjgoHjgafjgZnjgILoi6Xpp5LmiKbkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3jga7ooajoqJjjgYzlkIjjgaPjgabjgYTjgarjgYTlj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgb249V0sub2Rkc05vdGVzfHx7fTsKIGlmKE9iamVjdC5rZXlzKG9uKS5sZW5ndGgpe2grPWA8aDM+44Kq44OD44K65Y+W5b6X44Gu5YaF6KizPC9oMz48ZGl2IGNsYXNzPSJzdGF0dXMiPiR7V0suZGF0ZXMubWFwKGQ9PmAke2RheUxhYmVsKGQpfVxuJHsob25bZF18fFtdKS5tYXAoZXNjKS5qb2luKCJcbiIpfWApLmpvaW4oIlxuXG4iKX08L2Rpdj5gfQogaCs9YDxoMz7plovlgqzloLTjgZTjgag8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7plovlgqzloLQ8L3RoPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nirbmhYs8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIFdLLmRpYWcpewogIGNvbnN0IHByb2JzPVtdO2lmKHguZXJyKXByb2JzLnB1c2goeC5lcnIpO2lmKHguYmFkKXByb2JzLnB1c2goYOWHuui1sOmmrOOCkuiqreOCgeOBquOBhOODrOODvOOCuSAke3guYmFkfWApO3Byb2JzLnB1c2goLi4uKHguaXNzdWVzfHxbXSkpOwogIGgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHguZCkpfSAke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7eC5va30vJHt4LnJhY2VzfTwvdGQ+PHRkIHN0eWxlPSJ0ZXh0LWFsaWduOmxlZnQiPiR7cHJvYnMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iYmFkIHNtYWxsIj4ke3Byb2JzLm1hcChlc2MpLmpvaW4oIjxicj4iKX08L3NwYW4+YDonPHNwYW4gY2xhc3M9Imdvb2QiPuWVj+mhjOOBquOBlzwvc3Bhbj4nfSR7eC5jb2RlP2AgPGJ1dHRvbiBjbGFzcz0ibWluaSBzdWIiIGRhdGEtcmw9IiR7ZXNjKHguZCl9fCR7ZXNjKHguY29kZSl9fCR7ZXNjKHgubmFtZSl9Ij7lho3lj5blvpc8L2J1dHRvbj5gOiIifTwvdGQ+PC90cj5gOwogfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogZWwuaW5uZXJIVE1MPWg7CiBlbC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1ybF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz1hc3luYygpPT57CiAgY29uc3QgW2QsY29kZSxuYW1lXT1iLmRhdGFzZXQucmwuc3BsaXQoInwiKTtiLmRpc2FibGVkPXRydWU7d2tNc2coYCR7ZH0gJHtuYW1lfSDjgpLlho3lj5blvpfkuK3igKZgKTsKICB0cnl7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlVXJsKCksZCx7dmVudWVDb2RlOmNvZGUsdmVudWVOYW1lOm5hbWV9KTthd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKTthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpO3drTXNnKCLlho3lj5blvpfjgZfjgb7jgZfjgZ8iKX0KICBjYXRjaChlKXt3a01zZygi5YaN5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogfSk7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmk43kvZwKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBzaG93VGFiKHQpe2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIi52aWV3IikuZm9yRWFjaCh2PT52LmNsYXNzTGlzdC50b2dnbGUoIm9uIix2LmlkPT09dCkpO2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsYi5kYXRhc2V0LnRhYj09PXQpKX0KZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnNob3dUYWIoYi5kYXRhc2V0LnRhYikpOwokKCJ1cFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidXBSdW4iKS5kaXNhYmxlZD10cnVlOyQoInVwT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5VcHNldEZpdCh7c3RhcnQ6JCgidXBTdGFydCIpLnZhbHVlfHwiMjAyMS0wMS0wMSJ9KTsKICAkKCJ1cE91dCIpLmlubmVySFRNTD11cHNldFJlcG9ydChyKTsKICBpZihyLm1vZGVsKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShVUEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7bW9kZWxzVG9NZXRhKCk7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJ1cE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgidXBSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidXBDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFVQS0VZKTttb2RlbHNUb01ldGEoKTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjg6Ljg4fjg6vjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJwbFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgicGxSdW4iKS5kaXNhYmxlZD10cnVlOyQoInBsT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5QbGFjZUZpdCh7c3RhcnQ6JCgicGxTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSJ9KTsKICAkKCJwbE91dCIpLmlubmVySFRNTD1wbGFjZVJlcG9ydChyKTsKICBpZihyLm1vZGVsKWxvY2FsU3RvcmFnZS5zZXRJdGVtKFBMS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtlbHNlIGlmKCFyLmVycm9yKWxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFBMS0VZKTsKICBtb2RlbHNUb01ldGEoKTsKICBpZighci5lcnJvciYmV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInBsT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJwbFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJwbENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oUExLRVkpO21vZGVsc1RvTWV0YSgpOyQoInBsT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luOBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoIndrR28iKS5vbmNsaWNrPXdlZWtlbmRHbzsKJCgiYWxsR28iKS5vbmNsaWNrPWFsbEluT25lOwokKCJhbGxGaXQiKS5vbmNsaWNrPWFsbEZpdDsKJCgid2tPZGRzIikub25jbGljaz1vZGRzT25seTsKJCgiYmtPbmUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKEJLLmJ1c3kpcmV0dXJuOwogaWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpewogIGNvbnN0IHA9cHJvbXB0KCLjg5Djg4Pjgq/jgqLjg4Pjg5fnlKjjga7jg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJ44KS5rG644KB44Gm5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CC5b6p5YWD44Gu44Go44GN44Gr44KC5ZCM44GY44KC44Gu44GM5b+F6KaB44Gn44GZ44CCIik7CiAgaWYoIXApcmV0dXJuO0JLLnBhc3M9cC50cmltKCk7QksuaWQ9IiI7YmtTYXZlU2V0dGluZ3MoKTskKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOwogIGlmKEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjga845paH5a2X5Lul5LiK44Gr44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm59CiB9CiBhd2FpdCBydW5CYWNrdXAoZmFsc2UpOwp9OwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgiZGJnR28iKS5kaXNhYmxlZD10cnVlO2NvbnN0IGxpbmVzPVtg5Y+W5b6X5pelICR7V0suZGF0ZXMuam9pbigiLCIpfWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY29kZXM9Wy4uLm5ldyBTZXQoKFdLLmNhcmRzW2RdfHxbXSkubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIGNvZGVzKXsKICAgIGNvbnN0IHJzPVdLLmNhcmRzW2RdLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IHE9cnMubWFwKHI9PnIucXVhbGl0eSkuZmlsdGVyKEJvb2xlYW4pOwogICAgbGluZXMucHVzaChgXG7ilqAke2R9IOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3Rofe+8j+mojuaJi+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXguam9ja2V5RmlsbGVkKSwwKX3vvI/oqr/mlZnluKvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LnRyYWluZXJGaWxsZWQpLDApfWApOwogICAgY29uc3QgYmFkPXJzLmZpbmQocj0+ci5xdWFsaXR5JiYhci5xdWFsaXR5Lm9rKXx8cnNbMF0scm49KGJhZCYmYmFkLnJhY2VOdW1iZXIpfHwxO2xpbmVzLnB1c2goYO+8iOWVj+mhjOOBruOBguOCi+ODrOODvOOCuSAke3JufVIg44KS6Kq/44G544G+44GZ77yJYCk7dHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2RlYnVnLWVudHJ5P2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9JnJhY2U9JHtybn1gLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9Y2F0Y2goZSl7bGluZXMucHVzaCgi6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJvZGRzRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgib2Rkc091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgib2Rkc0RiZyIpLmRpc2FibGVkPXRydWU7CiBjb25zdCBMPVtg5pmC5Yi7ICR7bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDE2KS5yZXBsYWNlKCJUIiwiICIpfe+8iOaXpeacrOaZgumWk++8iWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY3M9V0suY2FyZHNbZF18fFtdLHZzPVsuLi5uZXcgU2V0KGNzLm1hcChjPT5TdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogICBmb3IoY29uc3QgdiBvZiB2cyl7CiAgICBjb25zdCBycz1jcy5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dik7CiAgICBjb25zdCBnb3Q9cnMuZmlsdGVyKGM9PldLLm9kZHNbcmtleShkLGMpXSkubWFwKGM9PmMucmFjZU51bWJlcikuam9pbigiLCIpLGxpbms9cnMuZmlsdGVyKGM9PmMub2Rkc0NuYW1lKS5tYXAoYz0+Yy5yYWNlTnVtYmVyKS5qb2luKCIsIik7CiAgICBMLnB1c2goYFxu4pagJHtkfSAke1ZFTlVFW3ZdfHx2fe+8muODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+WHuummrOihqOOBq+OCquODg+OCuuOBuOOBruODquODs+OCr+OBguOCiiBbJHtsaW5rfHwi44Gq44GXIn1d77yP44Kq44OD44K65Y+W5b6X5riI44G/IFske2dvdHx8IuOBquOBlyJ9XWApOwogICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgIEwucHVzaChgICDjgqrjg4PjgrrnlLvpnaLjga7jg6Hjg4vjg6Xjg7zjgavjgYLjgovjg6zjg7zjgrkgWyR7KHgubGlua3N8fFtdKS5tYXAoeT0+eS5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ9XWApOwogICAgIGZvcihjb25zdCBnIG9mICh4LmRpYWd8fFtdKSlMLnB1c2goIiAgIitKU09OLnN0cmluZ2lmeSh7c3RlcDpnLnN0ZXAsbGVuOmcuaHRtbExlbmd0aCxuOmcuY25hbWVzLGtpbmRzOmcua2luZHMsbWVudXM6Zy5tZW51cyxyYWNlczpnLnJhY2VzLGVycjpnLmVycm9yLHNhbXBsZTooZy5zYW1wbGV8fFtdKS5zbGljZSgwLDMpfSkpOwogICAgfWNhdGNoKGUpe0wucHVzaCgiICDjg6Hjg4vjg6Xjg7zlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJvZGRzRGJnIikuZGlzYWJsZWQ9ZmFsc2V9CiBvdXQudmFsdWU9TC5qb2luKCJcbiIpOwp9OwokKCJvZGRzQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgib2Rkc091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJvZGRzQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoIm9kZHNPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZGJnQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgiZGJnT3V0IikudmFsdWU7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpOyQoImRiZ0NvcHkiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXskKCJkYmdPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKTtlLnRhcmdldC52YWx1ZT0iIn07CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX77yI5Y+W5b6X5riI44G/44Gu5pel44KS44CB5paw44GX44GE6aCF55uu44Gk44GN44Gn5Y+W44KK55u044GZ77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KYXN5bmMgZnVuY3Rpb24gbGFwUmVmZXRjaChkZXBzKXsKIGNvbnN0IEQ9T2JqZWN0LmFzc2lnbih7aWRiQWxsLGlkYlB1dCxtZXRhR2V0LG1ldGFQdXQsZmV0Y2hEYXl9LGRlcHN8fHt9KTsKIGNvbnN0IGJhc2U9YmFzZVVybCgpLGE9JCgibGFwU3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpLG1zZz10PT57JCgibGFwU3RhdHVzIikuaW5uZXJIVE1MPXR9OwogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoImxhcEdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLGxhcHM6MCxjb3JuZXJzOjAsaG9yc2VzOjAsZmFpbDpbXSxza2lwcGVkOjAsdDA6RGF0ZS5ub3coKSxub2RhdGE6ZmFsc2Usc3RvcHBlZDpmYWxzZX07bGV0IGNvbnNlYz0wLHRvdGFsPTA7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IEQuaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgmJmYuZGF0ZT49YSYmZi5kYXRlPD15ZCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBjb25zdCB0b2RvPVtdOwogIGZvcihjb25zdCBmIG9mIGZpbGVzKXtpZihmLnJvd3Muc29tZShyPT5BcnJheS5pc0FycmF5KHIubGFwKSYmci5sYXAubGVuZ3RoKXx8YXdhaXQgRC5tZXRhR2V0KCJsYXBkb25lOiIrZi5kYXRlKSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfXRvZG8ucHVzaChmLmRhdGUpfQogIHRvdGFsPXRvZG8ubGVuZ3RoOwogIGlmKCF0b3RhbCl7bXNnKGDlj5bjgornm7TjgZnml6Xjga/jgYLjgorjgb7jgZvjgpPvvIgke2F95Lul6ZmN44GuJHtmaWxlcy5sZW5ndGh95pel44Gv44CB44GZ44G544Gm44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gk44GN44Gn44GZ77yJ44CCYCk7cmV0dXJufQogIGZvcihsZXQgaT0wO2k8dG9kby5sZW5ndGg7aSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgZD10b2RvW2ldLGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICBtc2coYCR7ZH3vvIgke2krMX0vJHt0b3RhbH3ml6XvvInjgpLlj5blvpfkuK3igKZcbuWPluOCiuebtOOBlyR7c3QuZGF5c33ml6XvvI/jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrkgJHtzdC5sYXBzfS8ke3N0LnJhY2Vzfe+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmApOwogICB0cnl7CiAgICBjb25zdCByPWF3YWl0IEQuZmV0Y2hEYXkoYmFzZSxkKTsKICAgIGlmKHIuZmFpbGVkTil7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgIGNvbnN0IHJpZHM9bmV3IFNldChyLnJvd3MubWFwKHg9PngucmFjZUlkKSksbGFwUmFjZXM9bmV3IFNldChyLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGgpLm1hcCh4PT54LnJhY2VJZCkpOwogICAgY29uc3QgY29ybmVySG9yc2VzPXIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD49MikubGVuZ3RoOwogICAgYXdhaXQgRC5pZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTsKICAgIGlmKGxhcFJhY2VzLnNpemV8fGNvcm5lckhvcnNlcylhd2FpdCBELm1ldGFQdXQoImxhcGRvbmU6IitkLHRydWUpOwogICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yaWRzLnNpemU7c3QubGFwcys9bGFwUmFjZXMuc2l6ZTtzdC5jb3JuZXJzKz1jb3JuZXJIb3JzZXM7c3QuaG9yc2VzKz1yLnJvd3MubGVuZ3RoO2NvbnNlYz0wOwogICAgaWYoc3QuZGF5cz49MiYmc3QubGFwcz09PTAmJnN0LmNvcm5lcnM9PT0wKXtzdC5ub2RhdGE9dHJ1ZTtTU1RPUD10cnVlfQogICB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgYXdhaXQgc2xlZXAoNDAwKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJsYXBHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICBjb25zdCByYXRlPSh4LHkpPT55P01hdGgucm91bmQoeC95KjEwMCkrIiUiOiItIjsKICBsZXQgaD1gJHtzdC5ub2RhdGE/JzxzcGFuIGNsYXNzPSJiYWQiPuODqeODg+ODl+OCgumAmumBjumghuS9jeOCguiqreOCgeOBvuOBm+OCk+OBp+OBl+OBn+OAguS4reaWreOBl+OBvuOBl+OBn+OAgjwvc3Bhbj5cbuOAjOiqreOBv+WPluOCiuOBruiouuaWreOAjeOCkuaKvOOBl+OAgeWHuuOBn+aWh+eroOOCkuiyvOOBo+OBpuOBj+OBoOOBleOBhOOAglxuJzooc3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOihTU1RPUD8i5YGc5q2i44GX44G+44GX44Gf44CCIjoi5a6M5LqG44CCIikpfWA7CiAgaCs9YOWPluOCiuebtOOBlyAke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJXG7jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrnvvJoke3N0LmxhcHMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5sYXBzLHN0LnJhY2VzKX3vvIlcbumAmumBjumghuS9jeOCkuiqreOCgeOBn+mmrO+8miR7c3QuY29ybmVycy50b0xvY2FsZVN0cmluZygpfS8ke3N0LmhvcnNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5jb3JuZXJzLHN0LmhvcnNlcyl977yJYDsKICBpZihzdC5mYWlsLmxlbmd0aCloKz1gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIife+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeaui+OCiuOBoOOBkee2muOBjeOBi+OCie+8iTwvc3Bhbj5gOwogIG1zZyhoKTt0cnl7YXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpfWNhdGNoKGUpe30KIH0KIHJldHVybiBzdDsKfQokKCJsYXBHbyIpLm9uY2xpY2s9KCk9PmxhcFJlZmV0Y2goKTsKJCgibGFwRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgibGFwT3V0Iik7b3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBpZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBpZighZmlsZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWPluW+l+a4iOOBv+OBruaIkOe4vuOBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KICBjb25zdCBkPWZpbGVzW2ZpbGVzLmxlbmd0aC0xXS5kYXRlLGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9qcmEtZGF5P2RhdGU9JHtkfWApLHJhY2VzPWRheS5yYWNlc3x8W107CiAgY29uc3Qgcj1yYWNlcy5maW5kKHg9PngucmFjZU5vPT09MTEpfHxyYWNlc1swXTsKICBpZighcil7b3V0LnZhbHVlPWAke2R9IOOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk2A7cmV0dXJufQogIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vZGVidWctcmVzdWx0P2NuYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHIuY25hbWUpfWApO2RlbGV0ZSB4Lm9rOwogIG91dC52YWx1ZT1g5pel5LuYICR7ZH0g6ZaL5YKs5aC0JHtyLnZlbnVlQ29kZX0gJHtyLnJhY2VOb31SXG5gK0pTT04uc3RyaW5naWZ5KHgpOwogfWNhdGNoKGUpe291dC52YWx1ZT0i6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgppZigvXmh0dHBzPzovLnRlc3QobG9jYXRpb24ucHJvdG9jb2wpKSQoInd1cmwiKS52YWx1ZT1sb2NhdGlvbi5vcmlnaW47ZWxzZSAkKCJ3dXJsIikudmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2IjsKcmVuZGVyR2F0ZSgpO3JlbmRlckFsbCgpOwooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBwZWRpZ3JlZUxvYWQoKTthd2FpdCBtb2RlbHNGcm9tTWV0YSgpO2F3YWl0IHJlZnJlc2hEYXRhTGFzdCgpO2F3YWl0IHNob3dTdGF0ZSgpO3JlbmRlck1vZGVsU3RhdHVzKCk7YXdhaXQgYmtJbml0KCl9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS/neWtmOmgmOWfn+OCkumWi+OBkeOBvuOBm+OCk++8miR7ZXNjKGUubWVzc2FnZSl9XG7vvIjjg5fjg6njgqTjg5njg7zjg4jjg5bjg6njgqbjgrrjgafjga/kvb/jgYjjgarjgYTjgZPjgajjgYzjgYLjgorjgb7jgZnvvIk8L3NwYW4+YH19KSgpOwoKPC9zY3JpcHQ+CjwvYm9keT48L2h0bWw+Cg==";
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
