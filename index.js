/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-14-rebuild-19";

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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGJ1dHRvbiBpZD0iYWxsR28iIGNsYXNzPSJiaWciIHN0eWxlPSJiYWNrZ3JvdW5kOiMxMzczMzMiPuKRoyDjgZzjgpPjgbbjgYrjgb7jgYvjgZvvvIjikaHihpLikaDihpLikaLjgpLpoIbnlarjgavlrp/ooYzvvIk8L2J1dHRvbj4KIDxkaXYgaWQ9ImFsbFN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5q+O6YCx44Gu5pu05paw44KSMeWbnuOBp+ihjOOBhOOBvuOBme+8mumBjuWOu+ODrOODvOOCueOBruabtOaWsCDihpIg5LuK6YCx5pyr44Gu5Y+W5b6X44Go5LqI5oOzIOKGkiDjg5Djg4Pjgq/jgqLjg4Pjg5fvvIjjg5Hjgrnjg5Xjg6zjg7zjgrroqK3lrprmuIjjgb/jga7loLTlkIjvvInjgII8L2Rpdj4KIDxkaXYgaWQ9ImJrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KIDxkaXYgaWQ9ImRhdGFTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8L2Rpdj4KCjxkaXYgY2xhc3M9InRhYnMiIGlkPSJ0YWJzIj4KIDxidXR0b24gZGF0YS10YWI9InZBeGlzIiBjbGFzcz0ib24iPui2hemJhOadvzwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idkV2Ij7mnJ/lvoXlgKQ8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZVcHNldCI+5rOi5Lmx5bqmPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2SG9sZSI+56m06aasPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2UmFjZXMiPuWFqOODrOODvOOCuTwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlN1bSI+5Y+W44KK6L6844G/54q25rOBPC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2VGVzdCI+5qSc6Ki8PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U2V0Ij7oqK3lrpo8L2J1dHRvbj4KPC9kaXY+Cgo8ZGl2IGlkPSJnYXRlIj48L2Rpdj4KCjxkaXYgaWQ9InZBeGlzIiBjbGFzcz0idmlldyBvbiBjYXJkIj48ZGl2IGNsYXNzPSJzbWFsbCI+44CM5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCPC9kaXY+PC9kaXY+CjxkaXYgaWQ9InZFdiIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZVcHNldCIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+CjxkaXYgaWQ9InZIb2xlIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlJhY2VzIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlN1bSIgY2xhc3M9InZpZXcgY2FyZCI+PC9kaXY+Cgo8ZGl2IGlkPSJ2VGVzdCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44Oi44OH44Or44Gu54q25oWLPC9oMj4KIDxkaXYgaWQ9Im1zdGF0IiBjbGFzcz0id3JhcCI+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImFsbEZpdCIgY2xhc3M9InN1YiI+5qSc6Ki844KS44G+44Go44KB44Gm5a6f6KGM77yI5aW96LWw546H4oaS5rOi5Lmx5bqm4oaS5Zue5Y+O546H77yJPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJhbGxGaXRTdGF0dXMiIGNsYXNzPSJzbWFsbCI+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5Zue5Y+O546H44Gu5qSc6Ki877yI5omV5oi744Gk44GN44O75pmC57O75YiX77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHjgIzjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHjgI3jgpLkvb/jgYbjg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnvvIjlkITjg6zjg7zjgrkxMDDlhobvvInjgILjgZPjgZPjgac8Yj7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjga7lm57lj47njofjgYwxMDAl44KS6LaF44GI44CB6Kqk5beu44Gu5bmF44KS5byV44GE44Gm44KCMTAwJeS7peS4ijwvYj7jgajnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjgaDjgZHjgYzjgIHnlLvpnaLkuIrjgafjgIzmpJzoqLzmuIjjgb/jgI3jgavjgarjgorjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0iYnRTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPjxidXR0b24gaWQ9ImJ0UnVuIj7mpJzoqLzjgpLlrp/ooYw8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYnRHcmFkZSIgY2xhc3M9InN1YiI+6YeN6LOe44Gg44GR77ya44Kw44Os44O844OJ6KOc5q2j44GC44KKL+OBquOBl+OCkuavlOi8gzwvYnV0dG9uPjwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuazouS5seW6puOBruS/oemgvOW6puOCkuS4iuOBkuOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44Gr5YaN54++44GX44CB5rOi5Lmx5bqm44Gu5LqI5ris44Go5a6f6Zqb44Gu5rOi5Lmx546H44KS56qB44GN5ZCI44KP44Gb44G+44GZ44CC44Kz44O844K55Yil77yI6ZaL5YKs5aC0w5foip3jg4DDl+i3nembosOX44Kv44Op44K577yJ44Gu6YGO5Y675rOi5Lmx546H44KS6Laz44GX44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+avlOOBueOBpuOAgeaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OBvuOBmeOAguiJr+OBj+OBquOCieOBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBp+OAgeetiee0muOBlOOBqOOBruWun+e4vueOh+OBoOOBkeOCkuaknOiovOOBl+OBn+aVsOWtl+OBq+W3ruOBl+abv+OBiOOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJ1cFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMS0wMS0wMSI+PGJ1dHRvbiBpZD0idXBSdW4iPuazouS5seW6puOCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InVwQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0idXBPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuWlvei1sOeOh++8iOikh+WLneWcj+WGheeOh++8ieOCkuato+eiuuOBq+OBmeOCi++8iOWGjeagoeato++8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5ZCE6aas44Gu44CMM+edgOS7peWGheOBq+WFpeOCi+eiuueOhyglKeOAjeOCkuOAgeWun+mam+OBrueahOS4reeOh+OBq+WQiOOCj+OBm+OBvuOBmeOAgumBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+eiuueOh+OBqOOAgeS6uuawl+mghuS9jcOX6aCt5pWw44GU44Go44Gu6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgTxiPuePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWkzwvYj7jgafjgIHlrp/pmpvjga7nmoTkuK3njofjgajnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILmmI7norrjgavoia/jgYTjgajjgY3jgaDjgZHmjqHnlKjjgZfjgIHotoXpiYTmnb/vvIg5NSXku6XkuIrvvInjga7ln7rmupbjgoLjgZPjga7mnJ/plpPjga7lrp/nuL7jgYvjgonmsbrjgoHjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+5qSc6Ki844Gu6ZaL5aeL5pelIDxpbnB1dCBpZD0icGxTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMTktMDEtMDEiPjxidXR0b24gaWQ9InBsUnVuIj7lpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraM8L2J1dHRvbj48YnV0dG9uIGlkPSJwbENsZWFyIiBjbGFzcz0ic3ViIj7mqJnmupbjgavmiLvjgZk8L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9InBsT3V0IiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzvvIjpgY7ljrvjg6zjg7zjgrnjga7lj5blvpflvozjgavlrp/ooYzjgILmlbDliIbjgYvjgYvjgorjgb7jgZnvvIk8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0icGF5RXhwIiBjbGFzcz0ic3ViIj7miZXmiLvjgpLmm7jjgY3lh7rjgZc8L2J1dHRvbj48bGFiZWwgY2xhc3M9InNtYWxsIj7oqq3jgb/ovrzjgb8gPGlucHV0IGlkPSJwYXlJbXAiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24iPjwvbGFiZWw+PC9kaXY+CiA8ZGl2IGlkPSJidE91dCIgY2xhc3M9InN0YXR1cyI+44OH44O844K/5Y+W5b6X44Gu44GC44Go44Gn5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjwvZGl2PgoKPGRpdiBpZD0idlNldCIgY2xhc3M9InZpZXcgY2FyZCI+CiA8aDI+44OQ44OD44Kv44Ki44OD44OX6Kit5a6a77yIQ2xvdWRmbGFyZeOBq+S/neWtmO+8iTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+44OR44K544OV44Os44O844K644GuU0hBLTI1NuOBoOOBkeOCkuS9v+OBo+OBpuS/neWtmOWFiOOCkuWIhuOBkeOBvuOBme+8iOODkeOCueODleODrOODvOOCuuiHquS9k+OBr+mAgeOCiuOBvuOBm+OCk++8ieOAguWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+W+qeWFg+OBp+OBjeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9ImJrUGFzcyIgdHlwZT0icGFzc3dvcmQiIHBsYWNlaG9sZGVyPSLjg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJIiBhdXRvY29tcGxldGU9Im9mZiIgc3R5bGU9ImZsZXg6MTttaW4td2lkdGg6MjAwcHgiPjxidXR0b24gaWQ9ImJrU2hvdyIgY2xhc3M9InN1YiI+6KGo56S6PC9idXR0b24+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxsYWJlbD48aW5wdXQgaWQ9ImJrQXV0byIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOWkieabtOOBjOOBguOCjOOBsOiHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBmeOCizwvbGFiZWw+PC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJrTm93Ij7ku4rjgZnjgZDlt67liIbjg5Djg4Pjgq/jgqLjg4Pjg5c8L2J1dHRvbj48YnV0dG9uIGlkPSJia1Jlc3RvcmUiIGNsYXNzPSJzdWIiPuODkOODg+OCr+OCouODg+ODl+OBi+OCieW+qeWFgzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrRnVsbCIgY2xhc3M9InN1YiI+44GZ44G544Gm5L+d5a2Y44GX55u044GZPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+6YGO5Y6744OH44O844K/44Gu6Kqt44G/6L6844G/77yI5Lu75oSP77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7ku6XliY3jga7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yP5oiQ57i+Q1NW44GM44GC44KM44Gw6Kqt44G/6L6844KB44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44G+44Gb44KT77yJ44CCPC9kaXY+CiA8aW5wdXQgaWQ9ImZpbGUiIHR5cGU9ImZpbGUiIGFjY2VwdD0iLmpzb24sLmNzdixhcHBsaWNhdGlvbi9qc29uLHRleHQvY3N2Ij4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7oqLrmlq08L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWHuummrOihqOOBruiqreOBv+WPluOCiuOBq+WVj+mhjOOBjOOBguOCi+OBqOOBjeOAgemWi+WCrOWgtOOBlOOBqOOBqzFS44Gu44Oa44O844K444Gu5Lit6Lqr44KS6Kq/44G544Gm5LiL44Gr5Ye644GX44G+44GZ44CC44Kz44OU44O844GX44Gm6YCB44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImRiZ0dvIiBjbGFzcz0ic3ViIj7oqLrmlq3mg4XloLHjgpLkvZzjgos8L2J1dHRvbj48YnV0dG9uIGlkPSJkYmdDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0iZGJnT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTQwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+44Kq44OD44K644Gu6Ki65patPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgarjgYTjg6zjg7zjgrnjgYzjgYLjgovjgajjgY3jgIHjgIxKUkHjgYzjgb7jgaDnmbrlo7LjgZfjgabjgYTjgarjgYTjgI3jga7jgYvjgIzlj5blvpfjga7llY/poYzjgI3jgarjga7jgYvjgpLoqr/jgbnjgb7jgZnjgILlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB5oq844GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9Im9kZHNEYmciIGNsYXNzPSJzdWIiPuOCquODg+OCuuOBruiouuaWreOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ib2Rkc091dCIgcmVhZG9ubHkgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjE2MHB4O2ZvbnQtc2l6ZToxMnB4Ij48L3RleHRhcmVhPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuODqeODg+ODl+ODu+mAmumBjumghuS9jeOBruWPluOCiuebtOOBlzwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu44Os44O844K544KS44CB44Os44O844K55YWo5L2T44Gu44Op44OD44OX77yI44OP44Ot44Oz44K/44Kk44Og77yJ44Go5ZCE6aas44Gu44Kz44O844OK44O86YCa6YGO6aCG5L2N44Gk44GN44Gn5Y+W44KK55u044GX44G+44GZ77yI44Oa44O844K544O76ISa6LOq44KS5LqI5oOz44Gr5L2/44GG44Gf44KB44Gu5rqW5YKZ77yJ44CC5L+d5a2Y5riI44G/44Gu5pel44Gv5LiK5pu444GN44GV44KM44G+44GZ44CC5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZ44CC44G+44Ga5paw44GX44GE5pyf6ZaT44GL44KJ5bCR44GX44Gg44GR6Kmm44GX44Gm44CB6Kqt44KB44Gm44GE44KL44GL44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPumWi+Wni+aXpSA8aW5wdXQgaWQ9ImxhcFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyNi0wMS0wMSI+PGJ1dHRvbiBpZD0ibGFwR28iPuWPluOCiuebtOOBmTwvYnV0dG9uPjxidXR0b24gaWQ9ImxhcERiZyIgY2xhc3M9InN1YiI+6Kqt44G/5Y+W44KK44Gu6Ki65patPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJsYXBTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2PgogPHRleHRhcmVhIGlkPSJsYXBPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxMjBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kaXY+Cgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXY+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2PjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIC8qIOKYheOCsOODrOODvOODie+8iOagvO+8ie+8mjA95LiN5piOL+S4i+e0miAxPU9Q44O744Oq44K544OG44OD44OJIDI9RzMgMz1HMiA0PUcx44CCCiAgICDlvpPmnaXjga8gRzEvRzIvRzMvT1Ag44KS44GZ44G544Gm44CMNeOAjeOBq+a9sOOBl+OBpuOBhOOBn+OBn+OCgeOAgUcz5Yud44Gh44GMIEcxIOOBp+OCguWJsuW8leOBleOCjOOBquOBi+OBo+OBn+OAggogICAg5Yik5a6a6aCG77ya44Op44OZ44Or77yITkZLQ+W+jCBHSS9HSUkvR0lJSS9HMeOAnEcz77yJ4oaSIDHnnYDos57ph5HvvIjkuIflhobvvInihpLvvIjlr77osaHjg6zjg7zjgrnjga7jgb/vvIlHMeODrOODvOOCueWQjSAqLwogY29uc3QgRzFfTkFNRVM9L+Wkqeeah+iznnzmnInppqzoqJjlv7V844K444Oj44OR44Oz44Kr44OD44OXfOOCuOODo+ODkeODs++8o3zlrp3loZroqJjlv7V85a6J55Sw6KiY5b+1fOODtOOCo+OCr+ODiOODquOCouODnuOCpOODq3zlpKfpmKrmna986auY5p2+5a6u6KiY5b+1fOODleOCp+ODluODqeODquODvHzjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrp844K544OX44Oq44Oz44K/44O844K6fOODnuOCpOODq+ODgeODo+ODs+ODlOOCquODs+OCt+ODg+ODl3zjgqjjg6rjgrbjg5njgrnlpbPnjovmna9856eL6I+v6LOefOiPiuiKseiznnzmoZzoirHos55844Kq44O844Kv44K5fOWEqumnv+eJnemmrHzml6XmnKzjg4Djg7zjg5Pjg7x85p2x5Lqs5YSq6ae/fOeakOaciOiznnxOSEvjg57jgqTjg6t86Ziq56We44K444Ol44OZ44OK44Kk44OrfOacneaXpeadr3zjg5vjg7zjg5fjg5Xjg6svOwogY29uc3QgZ3JhZGVUaWVyPSh0ZXh0LHByaXplLGJ5TmFtZSk9Pntjb25zdCBzPVN0cmluZyh0ZXh0fHwiIikubm9ybWFsaXplKCJORktDIik7CiAgaWYoL+manOWus3zjgrjjg6Pjg7Pjg5d8SlwuP1xzP0cvaS50ZXN0KHMpKXJldHVybiAwOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUlJfDMpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAyOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SUl8MikoPyFbQS1aYS16MC05XSkvLnRlc3QocykpcmV0dXJuIDM7CiAgaWYoLyg/Ol58W15BLVphLXpdKUcoPzpJfDEpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiA0OwogIGNvbnN0IHA9TnVtYmVyKHByaXplKTtpZihwPjApcmV0dXJuIHA+PTEwMDAwPzQ6cD49NTAwMD8zOnA+PTM1MDA/MjpwPj0xODAwPzE6MDsKICBpZihieU5hbWUmJkcxX05BTUVTLnRlc3QocykpcmV0dXJuIDQ7CiAgaWYoL+ODquOCueODhuODg+ODiXzjgqrjg7zjg5fjg7N877yv77ywfFxiT1BcYi8udGVzdChzKSlyZXR1cm4gMTsKICByZXR1cm4gMH07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGNvbnN0IGNsZWFuVHI9dD0+U3RyaW5nKHR8fCIiKS5yZXBsYWNlKC9ccysvZywiICIpLnRyaW0oKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsNn1b77yJKV0vZywiICIpLnJlcGxhY2UoLyg/Ouagl+adsXznvo7mtaZ85Zyw5pa5fOWkluWbvXzmi5vlvoUpXHMqW+ODu++9pV0/L2csIiAiKS5yZXBsYWNlKC9b44O7772lXS9nLCIgIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCk7CiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IudHJhaW5lcj1jbGVhblRyKG9bIuiqv+aVmeW4qyJdfHxvLnRyYWluZXJ8fCIiKTtjb25zdCBfZ3Q9U3RyaW5nKG9bIummrOWgtCJdfHxvWyLppqzloLTnirbmhYsiXXx8by5nb2luZ3x8by50cmFja19jb25kaXRpb258fCIiKTtfci5nYz0v5LiN6ImvfOeojXzph40vLnRlc3QoX2d0KT8yOi/oia8vLnRlc3QoX2d0KT8xOjA7X3IuZ3JkPWdyYWRlVGllcihTdHJpbmcob1siY2xhc3MiXXx8by5jbHN8fCIiKSsiICIrU3RyaW5nKG9bIuODrOODvOOCueWQjSJdfHxvLnJhY2VfbmFtZXx8by5yYWNlbmFtZXx8IiIpLG51bGwsZmFsc2UpO3JldHVybiBfcn0KIGZ1bmN0aW9uIHRvUm93MChvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICBoLm4rKztoLnRvcDMrPXQzO2lmKHIuZmluaXNoPT09MSloLndpbisrO2guc3VtKz1yLmZpbmlzaDtpZihyLmRhdGU+aC5sYXN0KWgubGFzdD1yLmRhdGU7CiAgY29uc3QgTD1yLmx2bHx8MDsoaC5sdltMXT1oLmx2W0xdfHxbMCwwXSk7aC5sdltMXVswXSsrO2gubHZbTF1bMV0rPXQzOwogIGlmKHIuZ2M+MCl7Y29uc3QgZ3E9KGguZ249aC5nbnx8e30pO2NvbnN0IGdnPShncVtyLmdjXT1ncVtyLmdjXXx8WzAsMF0pO2dnWzBdKys7Z2dbMV0rPXQzfQogIGgucnVucy5wdXNoKFtkbnVtKHIuZGF0ZSksci5maW5pc2gsci5kaXN0LHIuc3VyZixMLHIuZ3JkfHwwLHIuY2Y9PW51bGw/LTE6ci5jZl0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOKYheagvOS4iuOBkuijnOato++8muWtpue/kua4iOOBv+ODouODh+ODq+OBr+edgOmghuOCkuOBneOBruOBvuOBvuimi+OCi+OBruOBp+OAgeS4i+S9jeOCsOODrOODvOODieOBp+OBruWlvei1sOOBjOmHjeiznuODu0cx44Gn44KC5ZCM5L6h5YCk44Gr44Gq44Gj44Gm44GE44Gf44CCCiAgICDnm7Tov5Ez6LWw44Gu44GG44GhIE9QL+mHjeiznijjgq/jg6njgrk1KeOBrui1sOOBq+OBpOOBhOOBpuOAgeS7iuWbnuOBruOCsOODrOODvOODieOBqOOBruW3ruOBoOOBkeijnOato+OBmeOCi++8iOOCr+ODqeOCuTTku6XkuIvjga/jg6Ljg4fjg6vlgbTjga7oo5zmraPjgYzjgYLjgovjga7jgafkuozph43mjpvjgZHjgZfjgarjgYTvvInjgIIKICAgICAg5qC85LiK44GS77yI5L6LIEcz4oaSRzHvvInvvJrlpb3otbDjga7kvqHlgKTjgpLlibLjgorlvJXjgY/vvIjnnYDpoIbjgYzoia/jgYTjgbvjganlpKfjgY3jgY/vvIkKICAgICAg5qC85LiL44GS77yI5L6LIEcx4oaSRzLvvInvvJrlh6HotbDjga7kvqHlgKTjgpLlsJHjgZfmiLvjgZkKICAgIOS/guaVsOOBr+aaq+WumuWApOOAguKRoC0y44Gu44CM44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD44CN44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OCkuWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+avlOOBueOBpueiuuiqjeOBmeOCi+OBk+OBqOOAgiAqLwogY29uc3QgR1JBREU9e29uOnRydWUsS1VQOi4zMCxLRE46LjEyLE1JTjotLjksTUFYOi41fTsKIGZ1bmN0aW9uIGdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKXsKICBpZighR1JBREUub258fChjb21wJiZjb21wLmdyYWRlPT09ZmFsc2UpKXJldHVybiAwOwogIGNvbnN0IEd0PXJhY2UuZ3JkfHwwO2lmKEd0PDIpcmV0dXJuIDA7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaHx8IWgucnVucy5sZW5ndGgpcmV0dXJuIDA7CiAgY29uc3QgcmM9aC5ydW5zLnNsaWNlKC0zKSxXPVtbMV0sWy40LC42XSxbLjIsLjMsLjVdXVtyYy5sZW5ndGgtMV07bGV0IGQ9MDsKICByYy5mb3JFYWNoKCh4LGspPT57Y29uc3QgZmluPXhbMV0sTD14WzRdfHwwLEdyPXhbNV18fDA7aWYoTCE9PTV8fCEoZmluPjApKXJldHVybjsKICAgY29uc3QgZ3I9TWF0aC5tYXgoR3IsMik7ICAgICAgICAgIC8vIE9Q44O744Kw44Os44O844OJ5LiN5piO44Gu44Kv44Op44K5Nei1sOOBryBHMyDnm7jlvZPjgajjgZfjgabmr5TovIMKICAgaWYoR3Q+Z3ImJmZpbjw9NSlkLT1XW2tdKkdSQURFLktVUCooR3QtZ3IpKig2LWZpbikvNjsKICAgZWxzZSBpZihHdDxnciYmZmluPj00KWQrPVdba10qR1JBREUuS0ROKihnci1HdCkqTWF0aC5taW4oMSwoZmluLTMpLzgpfSk7CiAgcmV0dXJuIGNsYW1wKGQsR1JBREUuTUlOLEdSQURFLk1BWCl9CiBjb25zdCBHTj1bIuS4jeaYji/kuIvntJoiLCJPUOODu0wiLCJHMyIsIkcyIiwiRzEiXTsKIGZ1bmN0aW9uIGdyYWRlVGFncyh0YWdzLGR6LHJhY2Upe2NvbnN0IHQ9dGFncy5zbGljZSgpOwogIGlmKGR6PD0tLjIpdC51bnNoaWZ0KHt0OmDmoLzkuIrjgZLmiKbvvIgke0dOW3JhY2UuZ3JkfHwwXX3vvInvvJrkuIvkvY3jgrDjg6zjg7zjg4njga7lpb3otbDjga/libLlvJUgJHtkei50b0ZpeGVkKDIpfWAsYzoibyJ9KTsKICBlbHNlIGlmKGR6Pj0uMSl0LnVuc2hpZnQoe3Q6YOmrmOOCsOODrOODvOODieOBi+OCieOBruagvOS4i+OBkiAke2R6Pj0wPyIrIjoiIn0ke2R6LnRvRml4ZWQoMil9YCxjOiJiIn0pOwogIHJldHVybiB0fQogLyog44Os44O844K56Kej5p6Q44CCb2RkcyDjga/ku7vmhI/vvIjlhajpoK3liIbvvInjgIIgKi8KIGNvbnN0IExWTj1bIuS4jeaYjiIsIuacquWLneWIqSIsIjHli50iLCIy5YudIiwiM+WLnSIsIk9QIl07CiBmdW5jdGlvbiBleHRyYVRhZ3ModGFncyxyLHN0b3JlLHJhY2UpewogIGNvbnN0IHQ9dGFncy5zbGljZSgpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksTHQ9cmFjZS5sdmx8fDA7CiAgaWYoaCl7Y29uc3QgbGFzdD1oLnJ1bnMubGVuZ3RoP2gucnVuc1toLnJ1bnMubGVuZ3RoLTFdOm51bGw7CiAgIGlmKGxhc3QmJmxhc3RbNF0+MCYmTHQ+MCYmbGFzdFs0XSE9PUx0KXQudW5zaGlmdChsYXN0WzRdPEx0P3t0OmDmmIfntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJvIn06e3Q6YOmZjee0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6ImIifSk7CiAgIGlmKGgubHYmJmgubHZbLTFdKXQucHVzaCh7dDoi5Zyw5pa544Gn44Gu5Ye66LWw44GC44KK77yI5Ymy5byV6KmV5L6h77yJIixjOiJnIn0pfQogIHJldHVybiB0fQogLyog44Op44Oz44Kv77ya56m044K+44O844Oz44Gu5bmz5Z2H44Gr5a++44GZ44KL5YCN546H44GnIFMvQS9CL0PvvIjlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBp++8iSAqLwogY29uc3QgQVZHX0hPTEU9e29kZHM6LjA5MSxwcm94eTouMTE1fTsKIGZ1bmN0aW9uIHJhdGluZyhwYyxtb2RlLG4pe2NvbnN0IHI9cGMvQVZHX0hPTEVbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il07bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfQogLyog55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQeODu++8iOOCquODg+OCuuOBjOWIhuOBi+OCi+OBqOOBjeOBr++8ieWNmOWLnTMw5YCN5pyq5rqA44Gu5aSn56m044KS6Zmk44GP44CC6YGO5Y6744Gu5qSc6Ki844Gn44CB55qE5Lit546H44GM5LiK44GM44KK44CB5Zue5Y+O546H44GM5pyA5oKq44Gu5aSn56m044KS6YG/44GR44KJ44KM44GfICovCiBjb25zdCBGT0NVU19NQVhfT0REUz0zMDsKIGNvbnN0IEZPQ1VTPXsib2RkcyI6eyJuIjozNjI1LCJoaXQiOjAuMjMyLCJiYXNlSGl0IjowLjE3MiwicGVyRGF5IjoxMy42fSwicHJveHkiOnsibiI6NDAyNSwiaGl0IjowLjI3MiwiYmFzZUhpdCI6MC4yMTcsInBlckRheSI6MTUuMX19OyAgIC8vIDIwMjTlubTku6XpmY3jga7mpJzoqLzvvJrnmoTkuK3njofvvIhiYXNlSGl0PeW+k+adpeOBrjHkvY3lgJnoo5zvvInjg7vplovlgqzml6XjgYLjgZ/jgorjga7poK3mlbAKIGZ1bmN0aW9uIHBpY2tGb2N1cyhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMmJihyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJTInx8cmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iQSIpJiYoeC5vZGQ9PW51bGx8fHgub2RkPEZPQ1VTX01BWF9PRERTKSkuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIC8qIOeptOmmrOWAmeijnO+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLjgIHlpb3otbDnjofjga7pq5jjgYTpoIbjgasgayDpoK3jgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHlr77osaHlpJYgKi8KIGZ1bmN0aW9uIHBpY2socmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgZHo9Ui5tYXAocj0+Z3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApKTsKICBjb25zdCB6YzA9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopO2NvbnN0IHpjPXpjMC5tYXAoKHosaSk9PnorZHpbaV0pOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO2NvbnN0IHB4Mj1weC5tYXAoKHYsaSk9PnYrZHpbaV0pO3BvcD1weDIubWFwKHY9PjErcHgyLmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgb2RkOihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSk/b2Rkc1tpXTpudWxsLAogICBjYXJlZXI6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD97bjpoLm4sdDM6aC50b3AzLHdpbjpoLndpbn06bnVsbH0pKCksCiAgIHJlY2VudDooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gucnVucy5tYXAoeD0+eFsxXSk6W119KSgpLAogICBqbmFtZTpyLmpuYW1lfHwiIixqc3RhdDooKCk9Pntjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7cmV0dXJuIGomJmoubj49MT97bjpqLm4scmF0ZTpqLnRvcDMvai5ufTpudWxsfSkoKSwKICAgaG9sZTpOPj02JiZwb3BbaV0+PWN1dCxta3Q6bWt0P21rdFtpXTpudWxsLHZhbHVlOm1rdD9jYWxpYkZvcihwW2ldLCJvZGRzIikvbWt0W2ldOm51bGwsCiAgIGR6OmR6W2ldLHRhZ3M6Z3JhZGVUYWdzKGV4dHJhVGFncyhzY1tpXS50YWdzLHIsc3RvcmUscmFjZSksZHpbaV0scmFjZSksY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyogPT09PT0g6YmE5p2/6Lu46aas44O75rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X44CC5L+C5pWw44GvIHRvb2xzL2F4aXNfdXBzZXRfc3R1ZHkuanMg44Gn5a2m57+S44CBMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+aknOiovO+8iSA9PT09PSAqLwogY29uc3QgQVhJUz17IndQIjpbMC4wNTE5MywxLjAxNDgzLDAuMDUxNDgsLTAuMjA2NzYsLTAuNTMyMTYsMC45MTQzNywtMC40ODQ2NCwtMC4zMjExNSwtMC41NjgwMiwtMC41NTEzNSwwLjE3MzQ1LDEuMDk3NCwtMC4yODQwNywtMC4xMDM5NywtMC4yMTYxNywtMC4zNDY2OCwwLjE1OTEzLDAuMjIxOTYsLTAuMzg3MzIsLTAuMzQ2NTgsMC4wMDM3LC0wLjU2NjQ2XSwid08iOlswLjU0MjU5LDAuMTU2NjEsMC4wNTQxNCwtMC4wNDM3MSwtMC4xNDUyNCwwLjEzMTcxLC0wLjE0MTc4LC0wLjE2MjYzLDAuMDUzMTYsLTAuMDIwOTcsMC4wMDM5LC0wLjI5ODY1LC0wLjMyMzIxLC0wLjAxMzY1LC0wLjA5NTE5LC0wLjA3ODE4LDAuMDAwNiwtMC4wMjI5MSwtMC4xMTIxMywwLjAxNzgxLC0wLjA0NzQ1LC0wLjEwODUyLDAuMjU3MjEsMC42MzA3MV0sInVwc2V0Ijp7InRociI6MTUsIm1vZGVscyI6eyJwcm94eSI6WzIuMjQ1NTksMC42Mzg0MSwtMC4wNzA4LC0wLjA4MTYxLC0wLjA3NzQzLDAuMDkxMzcsMC4xMzg0NywwLjAwMjc5LC0wLjM4OTE5LC0wLjY0MjE3LC0wLjU1MzgxLC0wLjAxODM3LC0wLjQ0MzE3LC0wLjc2ODI1LC0wLjUyMzkzLC0yLjczNTYxLC0wLjE0OTA5LDAuMTE0NzddLCJvZGRzIjpbLTAuNzIzOTYsMC40MjgwOCwtMC4wNzQ5OSwtMC4wNjE1NCwtMC4wMDY3NSwwLjA3MjQzLDAuMDcwODUsLTAuMDQ5NzQsLTAuMTU1MjgsLTAuMzI1MTYsLTAuNDE4MjYsLTAuMzEzNTEsMC4yMDc1NywtMC4yMzksLTAuMjc5MDEsLTEuODIxMDgsLTAuMDA4NTIsMC4wODM5OSwwLjE1MDI0LDAuMzUyNDIsLTIuMDM4MzksMi44NTY2OCwwLjIyOTI5LDAuNzIwODQsLTEuOTc3OTddfSwiZ3JhZGVzIjp7InByb3h5Ijp7ImN1dHMiOltbIlNTUyIsMC41NTAzN10sWyJTUyIsMC40ODU1XSxbIlMiLDAuNDA0MjRdLFsiQSIsMC4yOTg4XSxbIkIiLDAuMTg5NTddLFsiQyIsMC4wMDYyOV1dLCJyYXRlcyI6eyJTU1MiOjAuNTc0LCJTUyI6MC41MDksIlMiOjAuNDMzLCJBIjowLjM0NywiQiI6MC4yNDQsIkMiOjAuMDg5fSwiYXZnUyI6eyJTU1MiOjE3LjIsIlNTIjoxNS4zLCJTIjoxNC4yLCJBIjoxMy4xLCJCIjoxMS44LCJDIjo5Ljh9fSwib2RkcyI6eyJjdXRzIjpbWyJTU1MiLDAuNjA5NjhdLFsiU1MiLDAuNTE1OTVdLFsiUyIsMC40MDg1NF0sWyJBIiwwLjI4NzY3XSxbIkIiLDAuMTczNTldLFsiQyIsMC4wMDc2OF1dLCJyYXRlcyI6eyJTU1MiOjAuNjc5LCJTUyI6MC41OTgsIlMiOjAuNDU1LCJBIjowLjM1MiwiQiI6MC4yNDYsIkMiOjAuMDc5fSwiYXZnUyI6eyJTU1MiOjE4LjUsIlNTIjoxNi40LCJTIjoxNC41LCJBIjoxMy4zLCJCIjoxMS44LCJDIjo5LjZ9fX19LCJiYW5kcyI6eyLpiYTmnb8iOnsibG8iOjAuOTIsImhpIjoxLCJuIjoxNjYsInJhdGUiOjAuOTYzOSwibG85NSI6MC45MzU1LCJuMiI6ODcsInJhdGUyIjowLjk3NywicGVyRGF5IjowLjYyfSwi5rqW6YmE5p2/Ijp7ImxvIjowLjg4LCJoaSI6MC45MiwibiI6Mjc5LCJyYXRlIjowLjg4NTMsImxvOTUiOjAuODQ3OSwibjIiOjEzOSwicmF0ZTIiOjAuODk5MywicGVyRGF5IjoxLjA0fSwi5aCF6Lu4Ijp7ImxvIjowLjg0LCJoaSI6MC44OCwibiI6NDc0LCJyYXRlIjowLjg0MTgsImxvOTUiOjAuODA4OSwibjIiOjIyNiwicmF0ZTIiOjAuODQwNywicGVyRGF5IjoxLjc4fX19OwogZnVuY3Rpb24gYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyl7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCx4Yz1SLm1hcChyPT5mZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpOwogIGNvbnN0IHBQPW5vcm1hbGl6ZVRvcDMoeGMubWFwKHg9PmRvdChBWElTLndQLHgpKSxNYXRoLm1pbigzLE4pKTsKICBsZXQgcE89bnVsbDsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKSxtMz10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTsKICAgcE89bm9ybWFsaXplVG9wMyh4Yy5tYXAoKHgsaSk9PmRvdChBWElTLndPLFsuLi54LE1hdGgubG9nKHB3W2ldKSxsb2dpdChNYXRoLm1pbiguOTgsbTNbaV0pKV0pKSxNYXRoLm1pbigzLE4pKX0KICByZXR1cm57cFAscE8seGN9fQogLyog6YmE5p2/6Lu46aas77ya44Kq44OD44K644GM44GC44KL44Os44O844K544Gg44GR44CC5LqI5ris56K6546H44Gu5Yy65YiG44GU44Go44Gr44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkua3u+OBiOOCiyAqLwogZnVuY3Rpb24gYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpO2lmKCFhcC5wTylyZXR1cm4gbnVsbDsKICBjb25zdCBvdXQ9W107YXAucE8uZm9yRWFjaCgocCxpKT0+ewogICBmb3IoY29uc3QgayBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBiPUFYSVMuYmFuZHNba107aWYocD49Yi5sbyYmcDwoaz09PSLpiYTmnb8iPzEuMDE6Yi5oaSkpe291dC5wdXNoKHtpLHAsdGllcjprLHJhdGU6Yi5yYXRlLGxvOTU6Yi5sbzk1LG46Yi5ufSk7YnJlYWt9fX0pOwogIHJldHVybiBvdXQuc29ydCgoYSxiKT0+Yi5wLWEucCl9CiAvKiDms6LkubHluqbvvJpTU1PjgJxD44CCM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GRICovCiBmdW5jdGlvbiB1cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpOwogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgscHM9YXAucFAuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpOwogIGNvbnN0IG5zPVIubWFwKHI9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gubjowfSksbW9udGg9TnVtYmVyKFN0cmluZyhyYWNlLmRhdGUpLnNsaWNlKDUsNykpfHwwLEw9cmFjZS5sdmx8fDA7CiAgY29uc3QgZj1bMSxOLzE2LEw9PT0xPzE6MCxMPT09Mj8xOjAsTD09PTM/MTowLEw9PT00PzE6MCxMPT09NT8xOjAscmFjZS5zdXJmPT09MT8xOjAsKHJhY2UuZGlzdHx8MCkvMjAwMCwKICAgbnMuZmlsdGVyKG49Pm49PT0wKS5sZW5ndGgvTixucy5maWx0ZXIobj0+bjwzKS5sZW5ndGgvTixucy5yZWR1Y2UoKGEsbik9PmErTWF0aC5sb2coMStuKSwwKS9OLzMsCiAgIHBzWzBdLHBzWzFdLHBzWzJdLHBzLnJlZHVjZSgoYSxwKT0+YStwKnAsMCkscHMuZmlsdGVyKHA9PnA+LjUpLmxlbmd0aC8zLG1vbnRoPj02JiZtb250aDw9OT8xOjBdOwogIGxldCBtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCkuc29ydCgoYSxiKT0+Yi1hKSxvZD1vZGRzLnNsaWNlKCkuc29ydCgoYSxiKT0+YS1iKTsKICAgY29uc3QgZW50PS1wdy5yZWR1Y2UoKGEscCk9PmErcCpNYXRoLmxvZyhwKSwwKS9NYXRoLmxvZyhOKTsKICAgZi5wdXNoKHB3WzBdLHB3WzFdLHB3WzBdK3B3WzFdK3B3WzJdLGVudCxNYXRoLmxvZyhvZFswXSksTWF0aC5sb2cob2RbMV0pLG9kLmZpbHRlcihvPT5vPDEwKS5sZW5ndGgvTik7bW9kZT0ib2RkcyJ9CiAgcmV0dXJue2YsbW9kZSxwMDpzaWdtb2lkKGRvdChBWElTLnVwc2V0Lm1vZGVsc1ttb2RlXSxmKSl9fQogZnVuY3Rpb24gdXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kZHMsYXApewogIGNvbnN0IHU9dXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApLG1vZGU9dS5tb2RlLHA9dS5wMCxHPUFYSVMudXBzZXQuZ3JhZGVzW21vZGVdOwogIGxldCBncmFkZT0iQyI7Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cyl7aWYocD49Yyl7Z3JhZGU9ZzticmVha319CiAgcmV0dXJue2dyYWRlLHAsbW9kZSxyYXRlOkcucmF0ZXNbZ3JhZGVdLGF2Z1M6Ry5hdmdTW2dyYWRlXX19CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIixPT1M9b3B0cy5vb3N8fCIiLFBST1hZPSEhb3B0cy5wcm94eSxNSU5HPU51bWJlcihvcHRzLm1pbkdyZCl8fDAsX2dPbj1HUkFERS5vbjtHUkFERS5vbj0hb3B0cy5ncmFkZU9mZjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSIsImF4aXMiLCJmb2N1cyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUJiYoIU1JTkd8fCgocmMucm93c1swXSYmcmMucm93c1swXS5ncmQpfHwwKT49TUlORykpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJmb2N1cyIscGlja0ZvY3VzKHJlcywxKSk7CiAgICAgIGJ1eSgidG9wMSIscGljayhyZXMsMSkpO2J1eSgidG9wMiIscGljayhyZXMsMikpO2J1eSgidG9wMyIscGljayhyZXMsMykpO2J1eSgiYWxsSG9sZSIsaG9sZSk7CiAgICAgIGlmKCFQUk9YWSlidXkoInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICAgaWYoIVBST1hZJiZoYXNPZGRzKXtjb25zdCBhcD1heGlzUHJvYnMocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTtpZihhcC5wTylidXkoImF4aXMiLGFwLnBPLm1hcCgocCxpKT0+KHtpLHB9KSkuZmlsdGVyKHg9PngucD49QVhJUy5iYW5kc1si6YmE5p2/Il0ubG8pKX0KICAgICAgY29uc3QgdD1waWNrKHJlcywxKVswXTsKICAgICAgaWYodCl7Y29uc3QgeT15ZW4uZ2V0KFJbdC5pXS5udW0pfHwwLHI9dC5wYy9BVixOPVIubGVuZ3RoOwogICAgICAgY29uc3QgcmFuaz0ocj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiKTsKICAgICAgIGFkZFNlZygi44Op44Oz44KvIisodC5uPDImJihyYW5rPT09IlMifHxyYW5rPT09IkEiKT8iQiI6cmFuaykscHIseSk7CiAgICAgICBhZGRTZWcoTjw9MTA/IumgreaVsCDjgJwxMCI6Tjw9MTQ/IumgreaVsCAxMeOAnDE0Ijoi6aCt5pWwIDE144CcIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLnN1cmY9PT0xPyLoip0iOnJhY2Uuc3VyZj09PTI/IuODgOODvOODiCI6IuOBneOBruS7liIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5sdmw+MD8i44Kv44Op44K5ICIrTFZOW3JhY2UubHZsXToi44Kv44Op44K5IOS4jeaYjiIscHIseSk7CiAgICAgICBhZGRTZWcodC5uPj01PyLlrp/nuL4gNei1sOS7peS4iiI6dC5uPj0zPyLlrp/nuL4gM+OAnDTotbAiOiLlrp/nuL4gM+i1sOacqua6gCIscHIseSk7CiAgICAgICBpZighUFJPWFkmJnQub2RkKXtjb25zdCBvPXQub2RkO2FkZFNlZyhvPDg/IuWNmOWLnSDjgJw45YCNIjpvPDE1PyLljZjli50gOOOAnDE15YCNIjpvPDMwPyLljZjli50gMTXjgJwzMOWAjSI6bzw2MD8i5Y2Y5YudIDMw44CcNjDlgI0iOiLljZjli50gNjDlgI3jgJwiLHByLHkpOwogICAgICAgIGlmKGhhc09kZHMpe2NvbnN0IHVnPXVwc2V0R3JhZGUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTthZGRTZWcoIuazouS5seW6piAiK3VnLmdyYWRlLHByLHkpfX19CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIGNvbnN0IHNlZ3M9e307CiAgZm9yKGNvbnN0IFtrLGddIG9mIE9iamVjdC5lbnRyaWVzKFNFRykpe3NlZ3Nba109e307Zm9yKGNvbnN0IHAgb2YgWyJhbGwiLCJBIiwiQiJdKXtjb25zdCB4PWdbcF07CiAgIGlmKCF4Lm4pe3NlZ3Nba11bcF09e2JldHM6MH07Y29udGludWV9Y29uc3QgbWVhbj14LnIveC5uLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHgucS94Lm4tbWVhbiptZWFuKSk7CiAgIHNlZ3Nba11bcF09e2JldHM6eC5uLGhpdFJhdGU6eC5oL3gubixyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHgubikvMTAwfX19CiAgR1JBREUub249X2dPbjtyZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57dXBzZXRGZWF0dXJlcyxjbGVhblRyLEdSQURFLGdyYWRlVGllcixncmFkZUFkaixGT0NVUyxyYXRpbmcscGlja0ZvY3VzLEFYSVMsYXhpc1Byb2JzLGF4aXNQaWNrcyx1cHNldEdyYWRlLHBpY2ssZmVhdHMsTU9ERUwsRk4sRkosbGV2ZWxPZkxhYmVsLGxldmVsT2ZQcml6ZSxiYWNrdGVzdCxjYWxpYixjYWxpYkZvcixqbm4sbm4sdG9Sb3csY3N2Um93cyxTdG9yZSxhbmFseXplLGhvcnNlU2NvcmUsbm9ybWFsaXplVG9wMyx0b3AzRnJvbVdpbixzdXJmQ29kZSxwYXJzZURhdGV9Owp9KSgpOwoKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Ki44OX44Oq5bGk77yI5YaN5qeL56+J77yJCiAqICDjg7vkv53lrZgv5YaN6ZaL44Gk44GN44Gu6YGO5Y6744OH44O844K/5Y+W5b6X44CB44OQ44OD44Kv44Ki44OD44OX44CB5qSc6Ki844Gv44CB5YuV5L2c56K66KqN5riI44G/44Gu5Yem55CG44KS44Gd44Gu44G+44G+5YaN5Yip55SoCiAqICDjg7vku4rpgLHmnKvjga7lj5blvpfjgIHpqI7miYvjg7voqr/mlZnluKvjga7nhaflkIjjgIHmnJ/lvoXlgKTjgIHotoXpiYTmnb/jgIHms6LkubHluqbjgIHlj5bjgorovrzjgb/lk4Hos6rjga7ooajnpLrjga/mlrDopo8KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCAkPWlkPT5kb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7CmNvbnN0IGVzYz1zPT5TdHJpbmcocz8/IiIpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeyImIjoiJmFtcDsiLCI8IjoiJmx0OyIsIj4iOiImZ3Q7IiwnIic6IiZxdW90OyIsIiciOiImIzM5OyJ9W21dKSk7CmNvbnN0IHNsZWVwPShtcz0wKT0+bmV3IFByb21pc2Uocj0+c2V0VGltZW91dChyLG1zKSk7CmZ1bmN0aW9uIGJ1c3kob24sbXNnPSLlh6bnkIbkuK3igKYiKXskKCJidXN5Iikuc3R5bGUuZGlzcGxheT1vbj8iZmxleCI6Im5vbmUiOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9bXNnfQpsZXQgREI9bnVsbCxTVE9SRT1udWxsLFNUT1JFX0tFWT0iIjsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9Owpjb25zdCBqc3RUb2RheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgcGN0PSh4LGs9MCk9Png9PW51bGx8fCFOdW1iZXIuaXNGaW5pdGUoeCk/Ii0iOih4KjEwMCkudG9GaXhlZChrKSsiJSI7CgpmdW5jdGlvbiBvcGVuREIoKXtyZXR1cm4gbmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHI9aW5kZXhlZERCLm9wZW4oInVwc2V0X3Rvb2xfZGIiLDIpOwogci5vbnVwZ3JhZGVuZWVkZWQ9ZT0+e2NvbnN0IGQ9ZS50YXJnZXQucmVzdWx0O2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoImZpbGVzIikpZC5jcmVhdGVPYmplY3RTdG9yZSgiZmlsZXMiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpZC5jcmVhdGVPYmplY3RTdG9yZSgibWV0YSIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoInBheSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoInBheSIpfTsKIHIub25zdWNjZXNzPSgpPT57REI9ci5yZXN1bHQ7b2soKX07ci5vbmVycm9yPSgpPT5uZyhyLmVycm9yKTtyLm9uYmxvY2tlZD0oKT0+bmcobmV3IEVycm9yKCLku5bjga7jgr/jg5bjgafkvb/nlKjkuK3jgafjgZkiKSl9KX0KY29uc3QgaWRiQWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigiZmlsZXMiKS5vYmplY3RTdG9yZSgiZmlsZXMiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYlB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgiZmlsZXMiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoImZpbGVzIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6Iikpe21hcmtEaXJ0eSgiZmlsZXMiLGMua2V5KTtjLmRlbGV0ZSgpfWMuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9Cgpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Cn07CgoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTt0cnl7c2V0R2F0ZShvdXQsb3V0UCl9Y2F0Y2goZSl7Y29uc29sZS5lcnJvcihlKX0KICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpO3RyeXthd2FpdCBwZWRpZ3JlZUxvYWQoKTthd2FpdCBtb2RlbHNGcm9tTWV0YSgpfWNhdGNoKGUpe30KICBhd2FpdCByYXdNZXRhUHV0KCJkaXJ0eSIsW10pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbi51cGRhdGVkQXR9KTsKICBhd2FpdCBzaG93U3RhdGUoKTtCSy5pbmZvPW1hbjtia01zZyhg5b6p5YWD5a6M5LqG77yaJHtuYW1lcy5sZW5ndGh944Kw44Or44O844OX77yPJHtjbnQudG9Mb2NhbGVTdHJpbmcoKX3ku7ZgKTsKIH1jYXRjaChlKXtia01zZygi5b6p5YWD44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSl9CiBmaW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQpmdW5jdGlvbiBia1NjaGVkdWxlKG1zKXsKIGlmKCFCSy5hdXRvfHwhQksucGFzc3x8QksucGFzcy5sZW5ndGg8OClyZXR1cm47CiBjbGVhclRpbWVvdXQoQksucnVuVCk7QksucnVuVD1zZXRUaW1lb3V0KCgpPT57aWYoIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKTtlbHNlIGJrU2NoZWR1bGUoMzAwMDApfSxtc3x8MzAwMCk7Cn0KZnVuY3Rpb24gYmtTYXZlU2V0dGluZ3MoKXt0cnl7bG9jYWxTdG9yYWdlLnNldEl0ZW0oInVwc2V0X2JrIixKU09OLnN0cmluZ2lmeSh7cGFzczpCSy5wYXNzLGF1dG86QksuYXV0b30pKX1jYXRjaChlKXt9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDms6LkubHluqbjga7lho3moKHmraMKICogIOebrueahO+8muazouS5seW6puOBruOAjOW9k+OBn+OCiuaWueOAjeOCkuOAgeiHquWIhuOBrumBjuWOu+ODh+ODvOOCv+OBp+eiuuOBi+OCgeOAgeS/oemgvOOBp+OBjeOCi+aVsOWtl+OBoOOBkeOCkuWHuuOBmeOAggogKiAg44KE44KL44GT44Go77yaCiAqICAgMSkg6YGO5Y6744Gu44Os44O844K544KS5pmC57O75YiX44GrMeOBpOOBmuOBpOWGjeePvuOBl+OAgeODrOODvOOCueWJjeOBq+WIhuOBi+OCi+aDheWgseOBoOOBkeOBp+azouS5seW6puOCkuioiOeulwogKiAgIDIpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBruazouS5seeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDMpIOOCs+ODvOOCueWIpeOBrumBjuWOu+azouS5seeOh++8iOmWi+WCrOWgtMOX6Iqd44OAw5fot53pm6LDl+OCr+ODqeOCue+8ieOBquOBqeOCkui2s+OBl+OBn+aWsOODouODh+ODq+OCkuS9nOOCiuOAgeWQjOOBmOacn+mWk+OBp+avlOi8gwogKiAgIDQpIOWvvuaVsOaQjeWkseOBjOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAguOBneOBhuOBp+OBquOBkeOCjOOBsOePvuihjOOBruOBvuOBvuOBq+OBl+OBpuOAgeWun+e4vueOh+OBoOOBkeaknOiovOWApOOBq+W3ruOBl+abv+OBiOOCiwogKiAg5rOi5Lmx77ydM+edgOS7peWGheOBrummrOOBruS6uuawl+OBruWQiOioiOOBjOmWvuWApCjnj77ooYzjg6Ljg4fjg6vjgajlkIzjgZgxNSnku6XkuIoKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBVUEtFWT0ia2VpYmFfdXBzZXRfdjEiOwpjb25zdCBzaWdtPXo9PjEvKDErTWF0aC5leHAoLXopKSxsZ3Q9cD0+e3A9TWF0aC5taW4oLjk5OSxNYXRoLm1heCguMDAxLHApKTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwpmdW5jdGlvbiB3aWxzb24oayxuKXtpZighbilyZXR1cm5bMCwxXTtjb25zdCB6PTEuOTYscD1rL24sZD0xK3oqei9uLGM9cCt6KnovKDIqbiksYT16Kk1hdGguc3FydChwKigxLXApL24reip6Lyg0Km4qbikpO3JldHVyblsoYy1hKS9kLChjK2EpL2RdfQpjb25zdCBkaXN0Qj1kPT5NYXRoLm1heCgxMDAwLE1hdGgubWluKDMyMDAsTWF0aC5yb3VuZCgoZHx8MCkvMjAwKSoyMDApKTsKY29uc3QgbHZsRz0obCxnKT0+KGx8fDApKyhnPj0yPyJHIjoiIik7CgovKiDjg6zjg7zjgrnjga7pm4boqIjvvIjooYzjgpLlhajpg6jmjIHjgZ/jgZrjgavmuIjjgoDou73jgYTlvaLvvInihpIg44Os44O844K55oOF5aCxICovCmZ1bmN0aW9uIGFnZ0FkZChtYXAscil7CiBpZighci5yYWNlSWR8fCFyLmhvcnNlfHxyLmZpbmlzaD09bnVsbClyZXR1cm47CiBsZXQgYT1tYXAuZ2V0KHIucmFjZUlkKTsKIGlmKCFhKW1hcC5zZXQoci5yYWNlSWQsYT17aWQ6U3RyaW5nKHIucmFjZUlkKSxkYXRlOnIuZGF0ZSxzdXJmOnIuc3VyZixkaXN0OnIuZGlzdCxsdmw6ci5sdmx8fDAsZ3JkOnIuZ3JkfHwwLGdjOjAsTjowLHQ6W10scGY6W10sanVtcDpmYWxzZX0pOwogaWYoIWEuZ2MmJnIuZ2MpYS5nYz1yLmdjOwogYS5OKys7aWYoci5maW5pc2g8PTMmJnIucG9wPjApYS50LnB1c2goW3IuZmluaXNoLHIucG9wXSk7CiBpZihyLnBvcD4wKWEucGYucHVzaChbci5wb3Asci5maW5pc2hdKTsKIGlmKC/pmpzlrrMvLnRlc3QoU3RyaW5nKHIucmFjZU5hbWV8fCIiKSkpYS5qdW1wPXRydWU7Cn0KZnVuY3Rpb24gYWdnSW5mbyhhKXsKIGlmKCFhfHxhLk48Nnx8YS5qdW1wKXJldHVybiBudWxsOwogY29uc3Qgdj0vXlxkezEyfSQvLnRlc3QoYS5pZCk/YS5pZC5zbGljZSg0LDYpOihTdHJpbmcoYS5pZCkuc3BsaXQoIi0iKVszXXx8IiIpLG5vPS9eXGR7MTJ9JC8udGVzdChhLmlkKT9OdW1iZXIoYS5pZC5zbGljZSgxMCwxMikpOihOdW1iZXIoU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbNF0pfHwwKTsKIGNvbnN0IHQ9YS50LnNsaWNlKCkuc29ydCgoeCx5KT0+eFswXS15WzBdKTsKIGNvbnN0IHk9dC5sZW5ndGg+PTM/KHRbMF1bMV0rdFsxXVsxXSt0WzJdWzFdPj1VRS5BWElTLnVwc2V0LnRocj8xOjApOm51bGw7CiByZXR1cm57ZGF0ZTphLmRhdGUsdixubyxzdXJmOmEuc3VyZixkaXN0OmEuZGlzdCxsdmw6YS5sdmwsZ3JkOmEuZ3JkLGdjOmEuZ2N8fDAsTjphLk4seX07Cn0KCi8qIOiEmuizqu+8mjHjgrPjg7zjg4rjg7zjga7kvY3nva7jga7libLlkIjvvIgwPeWFiOmgreOAgTE95pyA5b6M5pa577yJ44CC6YCa6YGO6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM44GC44KL6aas44Gg44GRICovCmZ1bmN0aW9uIGNvcm5lckZyYWMoY29ybmVyLE4pewogaWYoIUFycmF5LmlzQXJyYXkoY29ybmVyKXx8IWNvcm5lci5sZW5ndGh8fCFOfHxOPDQpcmV0dXJuIG51bGw7CiByZXR1cm4gTWF0aC5taW4oMSxNYXRoLm1heCgwLChjb3JuZXJbMF0tMSkvKE4tMSkpKTsKfQovKiDjg6zjg7zjgrnjga7jg5rjg7zjgrnnibnlvrTph4/vvJrlhYjooYzppqzjga7lpJrjgZXjg7vohJros6rjga7jgbDjgonjgaTjgY3jgILljYrmlbDku6XkuIrjga7ppqzjgavohJros6rjg4fjg7zjgr/jgYznhKHjgZHjgozjgbDlhajpg6gwICovCmZ1bmN0aW9uIHBhY2VGZWF0KHJ1bm5lcnMsc3RvcmUpewogY29uc3QgTj1ydW5uZXJzLmxlbmd0aDtsZXQgaz0wLGxlYWQ9MCxmcm9udD0wLHN1bT0wLHN1bTI9MDsKIGZvcihjb25zdCByIG9mIHJ1bm5lcnMpewogIGNvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7aWYoIWgpY29udGludWU7CiAgY29uc3Qgdj1oLnJ1bnMubWFwKHg9PnhbNl0pLmZpbHRlcih4PT54IT1udWxsJiZ4Pj0wKTtpZih2Lmxlbmd0aDwyKWNvbnRpbnVlOwogIGNvbnN0IHc9di5zbGljZSgtNSksbT13LnJlZHVjZSgoYSxiKT0+YStiLDApL3cubGVuZ3RoOwogIGsrKztzdW0rPW07c3VtMis9bSptO2lmKG08PS4xNSlsZWFkKys7aWYobTw9LjMwKWZyb250Kys7CiB9CiBpZighTnx8azxOKi41KXJldHVyblswLDAsMCwwLDBdOwogY29uc3QgbWVhbj1zdW0vayxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCxzdW0yL2stbWVhbiptZWFuKSk7CiByZXR1cm5bay9OLGxlYWQvTio0LGZyb250L04qMixtZWFuLS41LHNkXTsKfQoKLyog5ZCE6aas44GuM+edgOWGheeiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYzplr7lgKTku6XkuIrjgI3jgavjgarjgovnorrnjofjgpLjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7PjgafopovnqY3jgoLjgosKICAg77yI6YeN44G/77yd56K6546Hw7coMeKIkueiuueOhynjgafjgIEz6aCt44KS6aCG44Gr5oq96YG444CC5q+O5Zue5ZCM44GY57WQ5p6c44Gr44Gq44KL44KI44GG44CB5Lmx5pWw44Gv44Os44O844K55YaF5a6544GL44KJ5rG644KB44KL77yJICovCmZ1bmN0aW9uIHNpbVVwc2V0KHAscG9wcyx0aHIpewogY29uc3QgTj1wLmxlbmd0aDtsZXQgc2VlZD0yMTY2MTM2MjYxOwogZm9yKGxldCBpPTA7aTxOO2krKylzZWVkPU1hdGguaW11bChzZWVkXihNYXRoLnJvdW5kKHBbaV0qMTAwMCkrcG9wc1tpXSo3OTE5KSwxNjc3NzYxOSk+Pj4wOwogY29uc3Qgcm5kPSgpPT57c2VlZD0oc2VlZCsweDZEMkI3OUY1KT4+PjA7bGV0IHQ9c2VlZDt0PU1hdGguaW11bCh0Xih0Pj4+MTUpLHR8MSk7dF49dCtNYXRoLmltdWwodF4odD4+PjcpLHR8NjEpO3JldHVybigodF4odD4+PjE0KSk+Pj4wKS80Mjk0OTY3Mjk2fTsKIGNvbnN0IHc9cC5tYXAoeD0+TWF0aC5tYXgoMWUtNCx4LygxLU1hdGgubWluKC45OTkseCkpKSk7CiBjb25zdCBLPTMwMDtsZXQgaGl0PTAsc3VtPTAsc3VtMj0wOwogZm9yKGxldCBrPTA7azxLO2srKyl7CiAgY29uc3QgdXNlZD1BcnJheShOKS5maWxsKGZhbHNlKTtsZXQgUz0wOwogIGZvcihsZXQgaj0wO2o8MztqKyspewogICBsZXQgdG90PTA7Zm9yKGxldCBpPTA7aTxOO2krKylpZighdXNlZFtpXSl0b3QrPXdbaV07CiAgIGxldCB4PXJuZCgpKnRvdCxwaWNrPS0xOwogICBmb3IobGV0IGk9MDtpPE47aSsrKXtpZih1c2VkW2ldKWNvbnRpbnVlO3gtPXdbaV07aWYoeDw9MCl7cGljaz1pO2JyZWFrfX0KICAgaWYocGljazwwKXtmb3IobGV0IGk9Ti0xO2k+PTA7aS0tKWlmKCF1c2VkW2ldKXtwaWNrPWk7YnJlYWt9fQogICB1c2VkW3BpY2tdPXRydWU7Uys9cG9wc1twaWNrXTsKICB9CiAgaWYoUz49dGhyKWhpdCsrO3N1bSs9UztzdW0yKz1TKlM7CiB9CiBjb25zdCBtPXN1bS9LO3JldHVybltsZ3QoKGhpdCsuNSkvKEsrMSkpLG0vMTUsTWF0aC5zcXJ0KE1hdGgubWF4KDAsc3VtMi9LLW0qbSkpLzEwXTsKfQovKiAx44Os44O844K544Gu5biC5aC06L6844G/44Gu54m55b6077ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu56K6546H44Go44CB5Lq65rCX6aCG5L2N44Gu5a6f57i+546H44KS5Y2K44CF44Gn5re344Gc44Gf56K6546HIOKGkiDjgrfjg5/jg6Xjg6zjg7zjgrfjg6fjg7MgKi8KZnVuY3Rpb24gc2ltRmVhdChwUCxwb3BzLE4scHJpKXsKIGNvbnN0IHo9cFAubWFwKChwLGkpPT4uNSpsZ3QocCkrLjUqbGd0KHByaS5yYXRlKHBvcHNbaV0sTikpKTsKIHJldHVybiBzaW1VcHNldChub3JtU3VtKHosMykscG9wcyxVRS5BWElTLnVwc2V0LnRocik7Cn0KCi8qIOaknOiovOOBruWFseacieOCreODo+ODg+OCt+ODpe+8muWlvei1sOeOh+OBqOazouS5seW6puOBruaknOiovOOBr+OAgeWQjOOBmOODrOODvOOCueOBp+WQjOOBmOmHjeOBhOioiOeul++8iOmBjuWOu+aIkOe4vuODouODh+ODq+OBrueiuueOh+ODu+eJueW+tOmHj++8ieOCkuOBmeOCi+OAggogICDjg4fjg7zjgr/jga7lhoXlrrnjgYzlkIzjgZjplpPjga/ntZDmnpzjgpLkvb/jgYTlm57jgZfjgIEy44Gk55uu44Gu5qSc6Ki844KS6YCf44GP44GZ44KL77yI44OH44O844K/44GM5aSJ44KP44KL44Go6Ieq5YuV44Gn5L2c44KK55u044GZ77yJICovCmNvbnN0IFdGQz1uZXcgTWFwKCk7bGV0IFdGQ19TSUc9IiI7CmZ1bmN0aW9uIHdmU3luYyhyYWNlcyl7CiBsZXQgaD1yYWNlcy5sZW5ndGg7CiBmb3IoY29uc3QgcmMgb2YgcmFjZXMpe2g9KE1hdGguaW11bChoLDMxKStyYy5yb3dzLmxlbmd0aCl8MDtjb25zdCByMD1yYy5yb3dzWzBdO2lmKHIwKWg9KE1hdGguaW11bChoLDMxKSsocjAuZmluaXNofHwwKSo3KyhyMC5wb3B8fDApKjEzKyhyYy5kYXRlLmNoYXJDb2RlQXQoOSl8fDApKXwwfQogY29uc3Qgc2lnPXJhY2VzLmxlbmd0aCsifCIrKHJhY2VzLmxlbmd0aD9yYWNlc1tyYWNlcy5sZW5ndGgtMV0uZGF0ZToiIikrInwiK2g7CiBpZihzaWchPT1XRkNfU0lHKXtXRkMuY2xlYXIoKTtXRkNfU0lHPXNpZ30KfQpjb25zdCB3ZkdldD1pZD0+e2xldCBjPVdGQy5nZXQoaWQpO2lmKCFjKXtjPXt9O1dGQy5zZXQoaWQsYyl9cmV0dXJuIGN9OwoKLyog44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI5bCR44Gq44GE44OH44O844K/44Gv5YWo5L2T44G45a+E44Gb44KL77yJICovCmNsYXNzIFVwUHJpewogY29uc3RydWN0b3IoKXt0aGlzLmJhc2U9e246MCx1OjB9O3RoaXMubT1uZXcgTWFwKCl9CiBfayhpKXtyZXR1cm5bIlYiK2kudiwiQyIraS52KyJ8IitpLnN1cmYrInwiK2Rpc3RCKGkuZGlzdCksIkwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSsifCIrbHZsRyhpLmx2bCxpLmdyZCksIk4iKyhpLm5vfHwwKSwiRyIraS5zdXJmKyJ8IisoaS5nY3x8MCldfQogYWRkKGkpe2lmKCFpfHxpLnk9PW51bGwpcmV0dXJuO3RoaXMuYmFzZS5uKys7dGhpcy5iYXNlLnUrPWkueTtmb3IoY29uc3QgayBvZiB0aGlzLl9rKGkpKXtsZXQgeD10aGlzLm0uZ2V0KGspO2lmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdTowfSk7eC5uKys7eC51Kz1pLnl9fQogZmVhdChpKXsKICBjb25zdCBiPXRoaXMuYmFzZS5uPjIwMD90aGlzLmJhc2UudS90aGlzLmJhc2UubjouMjg1LEs9NDA7CiAgY29uc3Qgc2g9KGsscGFyKT0+e2NvbnN0IHg9dGhpcy5tLmdldChrKXx8e246MCx1OjB9O3JldHVybih4LnUrSypwYXIpLyh4Lm4rSyl9OwogIGNvbnN0IFtrdixrYyxrbCxrbixrZ109dGhpcy5fayhpKSxwdj1zaChrdixiKSxwYz1zaChrYyxwdikscGw9c2goa2wsYikscG49c2goa24sYikscGc9c2goa2csYiksbGI9bGd0KGIpOwogIHJldHVybltsZ3QocHYpLWxiLGxndChwYyktbGIsbGd0KHBsKS1sYixsZ3QocG4pLWxiLGxndChwZyktbGJdOwogfQp9CgovKiDjg63jgrjjgrnjg4bjgqPjg4Pjgq/lm57luLDvvIjjg4vjg6Xjg7zjg4jjg7Pms5Xjg7tMMuato+WJh+WMluODu+aomea6luWMlu+8iSAqLwpmdW5jdGlvbiBzb2x2ZUxpbihBLGIpewogY29uc3Qgbj1iLmxlbmd0aCxNPUEubWFwKChyLGkpPT5bLi4ucixiW2ldXSk7CiBmb3IobGV0IGM9MDtjPG47YysrKXsKICBsZXQgcD1jO2ZvcihsZXQgcj1jKzE7cjxuO3IrKylpZihNYXRoLmFicyhNW3JdW2NdKT5NYXRoLmFicyhNW3BdW2NdKSlwPXI7CiAgW01bY10sTVtwXV09W01bcF0sTVtjXV07Y29uc3QgZD1NW2NdW2NdfHwxZS05OwogIGZvcihsZXQgaz1jO2s8PW47aysrKU1bY11ba10vPWQ7CiAgZm9yKGxldCByPTA7cjxuO3IrKylpZihyIT09Yyl7Y29uc3QgZj1NW3JdW2NdO2lmKGYpZm9yKGxldCBrPWM7azw9bjtrKyspTVtyXVtrXS09ZipNW2NdW2tdfQogfQogcmV0dXJuIE0ubWFwKHI9PnJbbl0pOwp9CmZ1bmN0aW9uIGZpdExvZ2l0KFgseSxsMil7CiBjb25zdCBuPVgubGVuZ3RoLGQ9WFswXS5sZW5ndGgsbXU9QXJyYXkoZCkuZmlsbCgwKSxzZD1BcnJheShkKS5maWxsKDApOwogZm9yKGNvbnN0IHIgb2YgWClmb3IobGV0IGo9MDtqPGQ7aisrKW11W2pdKz1yW2pdL247CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspc2Rbal0rPShyW2pdLW11W2pdKSoqMi9uOwogZm9yKGxldCBqPTA7ajxkO2orKyl7c2Rbal09TWF0aC5zcXJ0KHNkW2pdKTtpZighKHNkW2pdPj0uMDUpKXNkW2pdPS4wNX0gICAvLyDjgbDjgonjgaTjgY3jgYzjgbvjgbznhKHjgYTliJfjga/jgIHlsI/jgZXjgaroqqTlt67jgaflibLjgaPjgablt6jlpKfjgarlgKTjgavjgarjgonjgarjgYTjgojjgYbjgIHkuIvpmZDjgpLoqK3jgZHjgosKIGNvbnN0IFo9WC5tYXAocj0+WzEsLi4uci5tYXAoKHYsaik9Pih2LW11W2pdKS9zZFtqXSldKSxEPWQrMSx3PUFycmF5KEQpLmZpbGwoMCk7CiBmb3IobGV0IGl0PTA7aXQ8MzA7aXQrKyl7CiAgY29uc3QgZz1BcnJheShEKS5maWxsKDApLEg9QXJyYXkuZnJvbSh7bGVuZ3RoOkR9LCgpPT5BcnJheShEKS5maWxsKDApKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCB6PVpbaV07bGV0IHM9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXMrPXdbal0qeltqXTsKICAgY29uc3QgcD1zaWdtKHMpLGU9cC15W2ldLHE9cCooMS1wKTsKICAgZm9yKGxldCBqPTA7ajxEO2orKyl7Z1tqXSs9ZSp6W2pdO2ZvcihsZXQgaz1qO2s8RDtrKyspSFtqXVtrXSs9cSp6W2pdKnpba119fQogIGZvcihsZXQgaj0xO2o8RDtqKyspe2dbal0rPWwyKndbal07SFtqXVtqXSs9bDJ9CiAgZm9yKGxldCBqPTA7ajxEO2orKylmb3IobGV0IGs9MDtrPGo7aysrKUhbal1ba109SFtrXVtqXTsKICBIWzBdWzBdKz0xZS05OwogIGNvbnN0IGR3PXNvbHZlTGluKEgsZyk7bGV0IG14PTA7Zm9yKGxldCBqPTA7ajxEO2orKyl7d1tqXS09ZHdbal07bXg9TWF0aC5tYXgobXgsTWF0aC5hYnMoZHdbal0pKX0KICBpZihteDwxZS03KWJyZWFrOwogfQogcmV0dXJue3csbXUsc2R9Owp9CmNvbnN0IHByZWRMb2dpdD0obSx4KT0+e2xldCBzPW0ud1swXTtmb3IobGV0IGo9MDtqPHgubGVuZ3RoO2orKyl7Y29uc3Qgej0oeFtqXS1tLm11W2pdKS9tLnNkW2pdO3MrPW0ud1tqKzFdKk1hdGgubWF4KC01LE1hdGgubWluKDUseikpfXJldHVybiBzfTsgICAvLyDlrabnv5LmmYLjga7nr4Tlm7LjgpLlpKfjgY3jgY/lpJbjgozjgZ/lhaXlipvjgafmmrTjgozjgarjgYTjgojjgYbCsTXjgavmipHjgYjjgosKCi8qIOipleS+oeaMh+aome+8muWvvuaVsOaQjeWkseODu+ODluODqeOCpOODpOODvOODu0FVQ+ODu+i8g+ato+iqpOW3rihFQ0UpICovCmZ1bmN0aW9uIGF1Y09mKHAseSl7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSk7bGV0IHJzPTAsbjE9MDsKIGZvcihsZXQgcj0wO3I8aWR4Lmxlbmd0aDtyKyspe2lmKHlbaWR4W3JdXSl7cnMrPXIrMTtuMSsrfX0KIGNvbnN0IG4wPXkubGVuZ3RoLW4xO3JldHVybiBuMSYmbjA/KHJzLW4xKihuMSsxKS8yKS8objEqbjApOi41Owp9CmZ1bmN0aW9uIG1ldHJpY3NPZihwLHkpewogY29uc3Qgbj15Lmxlbmd0aDtsZXQgbGw9MCxicj0wOwogZm9yKGxldCBpPTA7aTxuO2krKyl7Y29uc3QgcT1NYXRoLm1pbigxLTFlLTksTWF0aC5tYXgoMWUtOSxwW2ldKSk7bGwtPXlbaV0/TWF0aC5sb2cocSk6TWF0aC5sb2coMS1xKTticis9KHBbaV0teVtpXSkqKjJ9CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksQj0xMDtsZXQgZWNlPTA7CiBmb3IobGV0IGI9MDtiPEI7YisrKXtjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBtcD1zLnJlZHVjZSgoYSxpKT0+YStwW2ldLDApL3MubGVuZ3RoLG15PXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCkvcy5sZW5ndGg7ZWNlKz1NYXRoLmFicyhtcC1teSkqcy5sZW5ndGgvbn0KIHJldHVybntuLGxsOmxsL24sYnJpZXI6YnIvbixhdWM6YXVjT2YocCx5KSxlY2V9Owp9CgovKiDnrYnntJrvvJrkuojmuKznorrnjofjga7pq5jjgYTpoIbjgavkuIrkvY0gMyUgLyA3JSAvIDEyJSAvIDIwJSAvIDI4JSAvIOaui+OCiu+8iFNTUy9TUy9TL0EvQi9D77yJICovCmNvbnN0IFVQX1NIQVJFPVtbIlNTUyIsLjAzXSxbIlNTIiwuMDddLFsiUyIsLjEyXSxbIkEiLC4yMF0sWyJCIiwuMjhdLFsiQyIsLjMwXV07CmZ1bmN0aW9uIG1ha2VDdXRzKHBzKXsKIGNvbnN0IHM9cHMuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpO2xldCBhY2M9MDtjb25zdCBjdXRzPVtdOwogZm9yKGNvbnN0IFtnLHNoXSBvZiBVUF9TSEFSRSl7YWNjKz1zaDtpZihnPT09IkMiKXtjdXRzLnB1c2goW2csLTFdKTticmVha31jdXRzLnB1c2goW2csc1tNYXRoLm1pbihzLmxlbmd0aC0xLE1hdGgubWF4KDAsTWF0aC5yb3VuZChzLmxlbmd0aCphY2MpLTEpKV1dKX0KIHJldHVybiBjdXRzOwp9CmNvbnN0IGdyYWRlT2Y9KGN1dHMscCk9Pntmb3IoY29uc3QgW2csY10gb2YgY3V0cylpZihwPj1jKXJldHVybiBnO3JldHVybiJDIn07CmZ1bmN0aW9uIGdyYWRlVGFibGUoY3V0cyxwcyx5cyl7CiBjb25zdCB0PXt9O1VQX1NIQVJFLmZvckVhY2goKFtnXSk9PnRbZ109e246MCxrOjB9KTsKIHBzLmZvckVhY2goKHAsaSk9Pntjb25zdCB4PXRbZ3JhZGVPZihjdXRzLHApXTt4Lm4rKzt4LmsrPXlzW2ldfSk7CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ10sdz13aWxzb24oeC5rLHgubik7eC5yYXRlPXgubj94LmsveC5uOjA7eC5sbz13WzBdO3guaGk9d1sxXX0KIHJldHVybiB0Owp9CgovKiDmlrDjg6Ljg4fjg6vjga7lhaXlipvvvJrnj77ooYzjg6Ljg4fjg6vjga7nibnlvrTph48oMTcpIO+8iyDjgqrjg4PjgrrnibnlvrTph48oNywg44Gq44GR44KM44GwMCkg77yLIOOCquODg+OCuuacieeEoSDvvIsg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546HKDMpICovCmZ1bmN0aW9uIHVwWCh1LGUpewogY29uc3Qgb2Rkcz11Lm1vZGU9PT0ib2RkcyI7CiByZXR1cm5bLi4udS5mLnNsaWNlKDEsMTgpLC4uLihvZGRzP3UuZi5zbGljZSgxOCwyNSk6WzAsMCwwLDAsMCwwLDBdKSxvZGRzPzE6MCwuLi5lXTsKfQpmdW5jdGlvbiB1cHNldEN1c3RvbShNLHUsZSxwYyxzaW0pewogaWYoIU0pcmV0dXJuIG51bGw7CiBsZXQgejtjb25zdCB6MD1sZ3QodS5wMCkseHg9KCk9PntsZXQgeD11cFgodSxlKTtpZihNLnBhY2UpeD1bLi4ueCwuLi4ocGN8fFswLDAsMCwwLDBdKV07aWYoTS5zaW0peD1bLi4ueCxzaW0/MTowLC4uLihzaW18fFswLDAsMF0pXTtyZXR1cm4geH07CiBpZihNLmtpbmQ9PT0ib2xkIil6PXowOwogZWxzZSBpZihNLmtpbmQ9PT0ibmV3Iil6PXByZWRMb2dpdChNLm1vZGVsLHh4KCkpOwogZWxzZSBpZihNLmtpbmQ9PT0iYmxlbmQiKXo9KHowK3ByZWRMb2dpdChNLm1vZGVsLHh4KCkpKS8yOwogZWxzZSByZXR1cm4gbnVsbDsKIGNvbnN0IHA9c2lnbSh6KSxnPWdyYWRlT2YoTS5jdXRzLHApLHI9TS5yYXRlcyYmTS5yYXRlc1tnXXx8e307CiByZXR1cm57Z3JhZGU6ZyxwLHJhdGU6ci5yYXRlPz9udWxsLGxvOnIubG8/P251bGwsaGk6ci5oaT8/bnVsbCxuOnIubj8/MH07Cn0KY29uc3QgZ2V0VXBzZXRNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oVVBLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmN1dHMmJm0udmVyPT09ND9tOm51bGx9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsgICAvLyB2ZXI6Mu+8neODrOODvOOCueeVquWPt+OBrueJueW+tOmHj+OBpOOBjeOAguWPpOOBhOS/neWtmOOBr+S9v+OCj+OBquOBhAoKLyogLS0tLS0tLS0tLSDms6LkubHluqbjga7kuojmg7PliKXjgavjgIHlrp/pmpvjga7miZXmiLvjgafnorrjgYvjgoHjgosgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBsb2FkUGF5RnVsbCgpewogY29uc3QgbT1uZXcgTWFwKCk7CiB0cnl7CiAgY29uc3QgZGF5cz1hd2FpdCBQcm9taXNlLnJhY2UoW3BheUFsbCgpLG5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQoKCk9PnIoW10pLDE1MDAwKSldKTsKICBmb3IoY29uc3QgZGF5IG9mIGRheXMpZm9yKGNvbnN0IHIgb2YgKGRheS5yYWNlc3x8W10pKWlmKHIucmFjZUlkKW0uc2V0KHIucmFjZUlkLHt3aW46ci53aW58fFtdLHBsYWNlOnIucGxhY2V8fFtdfSk7CiB9Y2F0Y2goZSl7fQogcmV0dXJuIG07Cn0KY29uc3QgbWVkT2Y9YT0+e2lmKCFhLmxlbmd0aClyZXR1cm4gbnVsbDtjb25zdCBzPWEuc2xpY2UoKS5zb3J0KCh4LHkpPT54LXkpLG09TWF0aC5mbG9vcihzLmxlbmd0aC8yKTtyZXR1cm4gcy5sZW5ndGglMj9zW21dOihzW20tMV0rc1ttXSkvMn07CmNvbnN0IGF2Z09mPWE9PmEubGVuZ3RoP2EucmVkdWNlKCh4LHkpPT54K3ksMCkvYS5sZW5ndGg6bnVsbDsKLyog5LqI5oOz44Gu562J57Sa44GU44Go44Gr77ya5a6f6Zqb44Gu5rOi5Lmx546H44CB5Y2Y5Yud6YWN5b2T77yI5Yud44Gh6aas77yJ44CB6KSH5Yud6YWN5b2T77yIM+edgOWGhTPpoK3jga7lkIjoqIjvvInjgIEz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiIICovCmZ1bmN0aW9uIHBheW91dFRhYmxlKHRlc3QsZ3JhZGVPZjIscGF5KXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MCxucDowLHdpbnM6W10scGw6W10scG9wczpbXX0pOwogZm9yKGNvbnN0IHMgb2YgdGVzdCl7CiAgY29uc3QgeD10W2dyYWRlT2YyKHMpXTt4Lm4rKzt4LmsrPXMueTsKICBjb25zdCBwPXBheS5nZXQocy5yYWNlSWQpOwogIGlmKCFwfHwhcC53aW4ubGVuZ3RofHxwLnBsYWNlLmxlbmd0aDwzKWNvbnRpbnVlOwogIHgubnArKzt4LndpbnMucHVzaChwLndpblswXS55ZW4pOwogIGNvbnN0IHBsPXAucGxhY2Uuc2xpY2UoMCwzKTt4LnBsLnB1c2gocGwucmVkdWNlKChhLGIpPT5hK2IueWVuLDApKTt4LnBvcHMucHVzaChwbC5yZWR1Y2UoKGEsYik9PmErKGIucG9wfHwwKSwwKSk7CiB9CiBjb25zdCBvdXQ9e307CiBmb3IoY29uc3QgZyBpbiB0KXtjb25zdCB4PXRbZ107CiAgb3V0W2ddPXtuOngubixyYXRlOngubj94LmsveC5uOjAsbnA6eC5ucCxhdmdXaW46YXZnT2YoeC53aW5zKSxtZWRXaW46bWVkT2YoeC53aW5zKSwKICAgc2hhcmUxMDAwOngubnA/eC53aW5zLmZpbHRlcih2PT52Pj0xMDAwKS5sZW5ndGgveC5ucDpudWxsLHNoYXJlMzAwMDp4Lm5wP3gud2lucy5maWx0ZXIodj0+dj49MzAwMCkubGVuZ3RoL3gubnA6bnVsbCwKICAgYXZnUGxhY2VTdW06YXZnT2YoeC5wbCksYXZnUG9wU3VtOmF2Z09mKHgucG9wcyl9O30KIHJldHVybiBvdXQ7Cn0KLyog562J57Sa44GM5LiK44GM44KL44G744Gp44CB5a6f6Zqb44Gu5omV5oi744KC5aSn44GN44GP44Gq44Gj44Gm44GE44KL44GL77yI6Zqj44KK5ZCI44GG562J57Sa44Gu5q+U6LyD44Gn44CB6YCG6Lui44GM44GE44GP44Gk44GC44KL44GL77yJICovCmZ1bmN0aW9uIHBheW91dE1vbm90b25lKHRhYil7CiBjb25zdCBncz1VUF9TSEFSRS5tYXAoKFtnXSk9PmcpLHJvd3M9Z3MubWFwKGc9PnRhYltnXSkuZmlsdGVyKHg9PngubnA+PTMwKTsKIGxldCBvaz0wLHRvdD0wOwogZm9yKGxldCBpPTA7aSsxPHJvd3MubGVuZ3RoO2krKyl7dG90Kys7Y29uc3QgYT1yb3dzW2ldLGI9cm93c1tpKzFdO2lmKChhLmF2Z1BsYWNlU3VtPz8wKT49KGIuYXZnUGxhY2VTdW0/PzApKi45NSYmKGEuYXZnUG9wU3VtPz8wKT49KGIuYXZnUG9wU3VtPz8wKSouOTUpb2srK30gICAvLyDlgbbnhLbjga7lsI/jgZXjgarpgIbou6LvvIgx5Ymy5Lul5YaF77yJ44Gv6Kix5a65CiByZXR1cm57b2ssdG90fTsKfQoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5VcHNldEZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAyMS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5ELG91dD1bXTsKIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7CiBjb25zdCBwYXlGdWxsPW9wdHMucGF5RnVsbHx8YXdhaXQgbG9hZFBheUZ1bGwoKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogd2ZTeW5jKHJhY2VzKTsKIGNvbnN0IHN0b3JlPW5ldyBVRS5TdG9yZSgpLHByaT1uZXcgVXBQcmkoKSxwcHJpPW5ldyBQb3BQcmkoKSxTPVtdOwogZm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSsrKXsKICBjb25zdCByYz1yYWNlc1tpXSxhbT1uZXcgTWFwKCk7Zm9yKGNvbnN0IHIgb2YgcmMucm93cylhZ2dBZGQoYW0scik7CiAgY29uc3QgaW5mbz1hZ2dJbmZvKGFtLmdldChTdHJpbmcocmMucm93c1swXSYmcmMucm93c1swXS5yYWNlSWQpKSk7CiAgaWYoaW5mbyYmaW5mby55IT1udWxsJiZyYy5kYXRlPj1TVEFSVCl7CiAgIGNvbnN0IFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSk7CiAgIGNvbnN0IGhhc09kZHM9Ui5ldmVyeShyPT5yLm9kZHM+MSksb2Q9aGFzT2Rkcz9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IHdjPXdmR2V0KHJjLnJvd3NbMF0ucmFjZUlkKTsKICAgIGlmKCF3Yy51KXtjb25zdCBhPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTt3Yy51PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhKTt3Yy51UFA9YS5wUH0KICAgIGNvbnN0IGFwPXtwUDp3Yy51UFB9LHU9d2MudTsKICAgIGNvbnN0IHBvcHM9Ui5tYXAocj0+ci5wb3ApLHBvcHNPaz1SLmxlbmd0aD49NiYmcG9wcy5ldmVyeSh2PT52PjApOwogICAgbGV0IHUwPW51bGw7aWYob2Qpe2lmKHdjLnUwPT09dW5kZWZpbmVkKXt0cnl7d2MudTA9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG51bGwsVUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsbnVsbCkpfWNhdGNoKGUpe3djLnUwPW51bGx9fXUwPXdjLnUwfSAgIC8vIOOCquODg+OCuuacquWPluW+l+OBruOBqOOBjeeUqO+8iOWQjOOBmOODrOODvOOCueOCkuOAgeOCquODg+OCuuOBquOBl+OBrueJueW+tOOBp+S9nOOBo+OBn+OCguOBru+8iQogICAgUy5wdXNoKHtkYXRlOnJjLmRhdGUscmFjZUlkOnJjLnJvd3NbMF0ucmFjZUlkLHUsdTAsZHJvcE9kZHM6KGkqNDA1MDM+Pj4wKSUxMDwzLGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSksc2ltOnBvcHNPaz9zaW1GZWF0KGFwLnBQLHBvcHMsUi5sZW5ndGgscHByaSk6bnVsbCxrZWVwOihpKjI2NTQ0MzU3NjE+Pj4wKSUxMD49Myx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pOwogIHtjb25zdCBSUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7aWYoUlIubGVuZ3RoPj02JiZSUi5ldmVyeShyPT5yLnBvcD4wKSYmIVJSLnNvbWUocj0+L+manOWusy8udGVzdChTdHJpbmcoci5yYWNlTmFtZXx8IiIpKSkpcHByaS5hZGQoUlIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLFJSLmxlbmd0aCl9CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgaWYoaSUzMD09PTI5KXtidXN5KHRydWUsYOaZguezu+WIl+OBq+WGjeePvuOBl+OBpuaknOiovOS4reKApiAke2krMX0vJHtyYWNlcy5sZW5ndGh944Os44O844K5YCk7YXdhaXQgc2xlZXAoMCl9CiB9CiBidXN5KHRydWUsIuODouODh+ODq+OCkuavlOi8g+S4reKApiIpO2F3YWl0IHNsZWVwKDApOwogY29uc3QgdHJhaW49Uy5maWx0ZXIocz0+cy5kYXRlPFRFU1QpLHRlc3Q9Uy5maWx0ZXIocz0+cy5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17bkFsbDpTLmxlbmd0aCxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHN0YXJ0OlNUQVJULHRlc3RTdGFydDpURVNULGJhc2U6Uy5sZW5ndGg/Uy5yZWR1Y2UoKGEscyk9PmErcy55LDApL1MubGVuZ3RoOjB9OwogaWYodGVzdC5sZW5ndGg8MzAwfHx0cmFpbi5sZW5ndGg8MTUwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL5pyf6ZaT44Gu44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIGNvbnN0IHlUPXRlc3QubWFwKHM9PnMueSkseTA9dHJhaW4ubWFwKHM9PnMueSk7CiAvLyDnj77ooYzjg6Ljg4fjg6vjga7mpJzoqLzmnJ/plpPjgafjga7miJDnuL4KIGNvbnN0IHAwPXRlc3QubWFwKHM9PnMudS5wMCksbTA9bWV0cmljc09mKHAwLHlUKTsKIC8vIOaWsOODouODh+ODq++8iOWtpue/kuacn+mWk+OBruOBv+OBp+S9nOOCi++8ieOAguW4guWgtOi+vOOBv+OBrueJueW+tChzaW0p44O744Oa44O844K544Gv44CB5L2/44GI44KL44Go44GN44Gg44GR6Kmm44GX44Gm44CB6Imv44GP44Gq44KM44Gw6Laz44GZCiBjb25zdCB4Rm9yPShzLGZsLGlzVHJhaW4pPT57CiAgbGV0IHg9dXBYKChpc1RyYWluJiZzLnUwJiZzLmRyb3BPZGRzKT9zLnUwOnMudSxzLmUpOyAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafjgIHjgqrjg4Pjgrrovrzjgb/jga7nibnlvrTjgpLjgqrjg4PjgrrjgarjgZfjga7nibnlvrTjgavnva7jgY3mj5vjgYjjgIHjgqrjg4PjgrrmnKrlj5blvpfjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICBpZihmbC5wYWNlKXg9Wy4uLngsLi4ucy5wY107CiAgaWYoZmwuc2ltKXtjb25zdCB1c2U9cy5zaW0mJighaXNUcmFpbnx8cy5rZWVwKTt4PVsuLi54LHVzZT8xOjAsLi4uKHVzZT9zLnNpbTpbMCwwLDBdKV19ICAgLy8g5a2m57+S44Gn44GvM+WJsuOBruODrOODvOOCueOBp+W4guWgtOi+vOOBv+OBrueJueW+tOOCkumaoOOBl+OAgeS6uuawl+OBjOacqueiuuWumuOBruOBqOOBjeOBq+OCguWvvuW/nOOBp+OBjeOCi+OCiOOBhuOBq+OBmeOCiwogIHJldHVybiB4OwogfTsKIGNvbnN0IGZpdD1mbD0+ewogIGNvbnN0IG09Zml0TG9naXQodHJhaW4ubWFwKHM9PnhGb3IocyxmbCx0cnVlKSkseTAsMyk7CiAgY29uc3Qgej10ZXN0Lm1hcChzPT5wcmVkTG9naXQobSx4Rm9yKHMsZmwsZmFsc2UpKSk7CiAgcmV0dXJue2ZsLG0sbU46bWV0cmljc09mKHoubWFwKHNpZ20pLHlUKSxtQjptZXRyaWNzT2Yoei5tYXAoKHYsaSk9PnNpZ20oKGxndChwMFtpXSkrdikvMikpLHlUKX07CiB9OwogY29uc3QgVj17YmFzZTpmaXQoe3BhY2U6ZmFsc2Usc2ltOmZhbHNlfSl9OwogY29uc3QgY292VHI9dHJhaW4uZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLGNvdlRlPXRlc3QuZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLHBhY2VPaz1jb3ZUcj49NDAwJiZjb3ZUZT49MTAwOwogY29uc3Qgc2ltVHI9dHJhaW4uZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltVGU9dGVzdC5maWx0ZXIocz0+cy5zaW0pLmxlbmd0aCxzaW1Paz1zaW1Ucj49MTAwMCYmc2ltVGU+PTIwMDsKIHJlcy5wYWNlPXtjb3ZUcmFpbjpjb3ZUcixjb3ZUZXN0OmNvdlRlLHVzZWQ6ZmFsc2V9O3Jlcy5zaW09e3RyYWluTjpzaW1Ucix0ZXN0TjpzaW1UZSx1c2VkOmZhbHNlfTsKIGlmKHNpbU9rKVYuc2ltPWZpdCh7cGFjZTpmYWxzZSxzaW06dHJ1ZX0pOwogaWYocGFjZU9rKVYucGFjZT1maXQoe3BhY2U6dHJ1ZSxzaW06ZmFsc2V9KTsKIGlmKHBhY2VPayYmc2ltT2spVi5ib3RoPWZpdCh7cGFjZTp0cnVlLHNpbTp0cnVlfSk7CiByZXMubTA9bTA7cmVzLm1OPVYuYmFzZS5tTjtyZXMubUI9Vi5iYXNlLm1COwogaWYoVi5zaW0pcmVzLm1TPVYuc2ltLm1OO2lmKFYucGFjZSlyZXMubVA9Vi5wYWNlLm1OO2lmKFYuYm90aClyZXMubVBTPVYuYm90aC5tTjsKIGxldCBjdXI9Vi5iYXNlOwogaWYoVi5zaW0mJmN1ci5tTi5sbC1WLnNpbS5tTi5sbD49LjAwMSljdXI9Vi5zaW07CiB7Y29uc3QgY2FuZD1jdXIuZmwuc2ltP1YuYm90aDpWLnBhY2U7aWYoY2FuZCYmY3VyLm1OLmxsLWNhbmQubU4ubGw+PS4wMDEpY3VyPWNhbmR9CiBjb25zdCBmbGM9Y3VyLmZsLHVzZVBhY2U9ISFmbGMucGFjZSx1c2VTaW09ISFmbGMuc2ltOwogcmVzLnBhY2UudXNlZD11c2VQYWNlO3Jlcy5zaW0udXNlZD11c2VTaW07cmVzLnVzZVBhY2U9dXNlUGFjZTtyZXMudXNlU2ltPXVzZVNpbTsKIC8vIOaOoeeUqOOBruWIpOaWre+8muePvuihjOOCiOOCiuWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK6Imv44GP44Gq44KK44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44GoCiBjb25zdCBiZXR0ZXI9KG0scmVmKT0+KHJlZi5sbC1tLmxsPj0uMDAyKSYmKG0uYXVjPj1yZWYuYXVjLS4wMDMpOwogbGV0IGtpbmQ9Im9sZCI7CiBjb25zdCBrYz1bWyJuZXciLGN1ci5tTl0sWyJibGVuZCIsY3VyLm1CXV0uZmlsdGVyKChbayxtXSk9PmJldHRlcihtLG0wKSkuc29ydCgoYSxiKT0+YVsxXS5sbC1iWzFdLmxsKVswXTsKIGlmKGtjKWtpbmQ9a2NbMF07CiBjb25zdCBNMj1jdXIubSx4eD1zPT54Rm9yKHMsZmxjLGZhbHNlKTsKIHJlcy5raW5kPWtpbmQ7CiAvLyDnrYnntJrjga7liIfjgoznm67jga/jgIzlrabnv5LlgbTjgI3jga7kuojmuKzjgYvjgonmsbrjgoHjgIHmpJzoqLzlgbTjgaflrp/pmpvjga7ms6LkubHnjofjgpLmuKzjgovvvIjmraPnm7Tjgarlrp/nuL7njofvvIkKIGNvbnN0IHByZWRUcmFpbj1zPT5raW5kPT09Im9sZCI/cy51LnAwOmtpbmQ9PT0ibmV3Ij9zaWdtKHByZWRMb2dpdChNMix4eChzKSkpOnNpZ20oKGxndChzLnUucDApK3ByZWRMb2dpdChNMix4eChzKSkpLzIpOwogY29uc3QgY3V0cz1tYWtlQ3V0cyh0cmFpbi5tYXAocHJlZFRyYWluKSk7CiBjb25zdCBwVGVzdD10ZXN0Lm1hcChwcmVkVHJhaW4pLHRhYj1ncmFkZVRhYmxlKGN1dHMscFRlc3QseVQpOwogcmVzLmN1dHM9Y3V0cztyZXMudGFiPXRhYjsKIC8vIOS6iOaDs+OBruetiee0muOBlOOBqOOBq+OAgeWun+mam+OBruaJleaIu+OBp+eiuuOBi+OCgeOCi++8iOaOoeeUqOOBl+OBn+ODouODh+ODq+OBqOOAgeaomea6luODouODh+ODq+OBruS4oeaWue+8iQoge2NvbnN0IGlkeD1uZXcgTWFwKHRlc3QubWFwKChzLGkpPT5bcyxpXSkpOwogIHJlcy5wYXlUYWI9cGF5b3V0VGFibGUodGVzdCxzPT5ncmFkZU9mKGN1dHMscFRlc3RbaWR4LmdldChzKV0pLHBheUZ1bGwpOwogIHJlcy5wYXlUYWJTdGQ9cGF5b3V0VGFibGUodGVzdCxzPT57Y29uc3QgRz1VRS5BWElTLnVwc2V0LmdyYWRlc1tzLnUubW9kZV07Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cylpZihzLnUucDA+PWMpcmV0dXJuIGc7cmV0dXJuIkMifSxwYXlGdWxsKTsKICByZXMucGF5TW9ubz1wYXlvdXRNb25vdG9uZShyZXMucGF5VGFiKTtyZXMucGF5TW9ub1N0ZD1wYXlvdXRNb25vdG9uZShyZXMucGF5VGFiU3RkKTsKICByZXMucGF5UmFjZXM9T2JqZWN0LnZhbHVlcyhyZXMucGF5VGFiKS5yZWR1Y2UoKGEseCk9PmEreC5ucCwwKTt9CiByZXMubW9kZWw9e3Zlcjo0LGtpbmQscGFjZTp1c2VQYWNlLHNpbTp1c2VTaW0sbW9kZWw6TTIscGF5VGFiOnJlcy5wYXlUYWIsY3V0cyxyYXRlczpPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModGFiKS5tYXAoKFtnLHhdKT0+W2cse3JhdGU6eC5yYXRlLGxvOngubG8saGk6eC5oaSxuOngubn1dKSksCiAgYXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLG5UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsdGVzdFN0YXJ0OlRFU1QsbTAsbU46cmVzLm1OLG1COnJlcy5tQixtUDpyZXMubVB8fG51bGwsbVM6cmVzLm1TfHxudWxsLG1QUzpyZXMubVBTfHxudWxsLHBhY2VDb3Y6W2NvdlRyLGNvdlRlXSxzaW1Db3Y6W3NpbVRyLHNpbVRlXX07CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiB1cHNldFJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yI44CcJHtlc2Moci50ZXN0U3RhcnQpfeOBruWJjeaXpe+8ie+8j+aknOiovOWBtCAke3IublRlc3R944Os44O844K577yIJHtlc2Moci50ZXN0U3RhcnQpfeS7pemZje+8neePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8ieOAguWFqOS9k+OBruazouS5seeOhyAke3BjdChyLmJhc2UsMSl944CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Oi44OH44Or77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93KCLnj77ooYwiLHIubTApfSR7cm93KCLmlrDvvIjjgrPjg7zjgrnliKXjgpLov73liqDvvIkiLHIubU4pfSR7cm93KCLnj77ooYzjgajmlrDjga7lubPlnYciLHIubUIpfSR7ci5tUz9yb3coIuaWsO+8iOOCs+ODvOOCueWIpe+8i+W4guWgtOi+vOOBv+OBrueiuueOh++8iSIsci5tUyk6IiJ9JHtyLm1QP3Jvdygi5paw77yI44Kz44O844K55Yil77yL44Oa44O844K577yJIixyLm1QKToiIn0ke3IubVBTP3Jvdygi5paw77yI44GZ44G544Gm77yJIixyLm1QUyk6IiJ9PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1yLnNpbSYmci5zaW0udGVzdE4+PTIwMD9gPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8iOWQhOmmrOOBrueiuueOh+OBqOS6uuawl+mghuS9jeOBi+OCieOAgeazouS5seOBq+OBquOCi+eiuueOh+OCkuebtOaOpeimi+epjeOCguOCi++8ie+8muWtpue/kuWBtCR7ci5zaW0udHJhaW5OfeODu+aknOiovOWBtCR7ci5zaW0udGVzdE5944Os44O844K544Gn5L2/44GI44G+44GX44Gf44CCJHtyLnVzZVNpbT8iPGI+5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuW4guWgtOi+vOOBv+OBrueJueW+tO+8muS6uuawl+mghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj+OAgeaknOiovOOBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn+OAgjwvZGl2PmA7CiBoKz1yLnBhY2UmJnIucGFjZS51c2VkP2A8ZGl2IGNsYXNzPSJzbWFsbCI+44Oa44O844K544O76ISa6LOq44Gu54m55b606YeP77ya5a2m57+S5YG0JHtyLnBhY2UuY292VHJhaW5944O75qSc6Ki85YG0JHtyLnBhY2UuY292VGVzdH3jg6zjg7zjgrnjgafkvb/jgYjjgb7jgZfjgZ/jgIIke3IudXNlUGFjZT8iPGI+44Oa44O844K544KS5Yqg44GI44KL44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB5o6h55So44GX44G+44GX44Gf44CCPC9iPiI6IuODmuODvOOCueOCkuWKoOOBiOOBpuOCguaYjueiuuOBquaUueWWhOOBr+OBquOBi+OBo+OBn+OBn+OCgeOAgeaOoeeUqOOBl+OBpuOBhOOBvuOBm+OCk+OAgiJ9PC9kaXY+YDpgPGRpdiBjbGFzcz0ic21hbGwiPuODmuODvOOCueODu+iEmuizqu+8mumAmumBjumghuS9jeOBpOOBjeOBruaIkOe4vuOBjOWwkeOBquOBj++8iOWtpue/kuWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUcmFpbjowfeODu+aknOiovOWBtCR7ci5wYWNlP3IucGFjZS5jb3ZUZXN0OjB944Os44O844K577yJ44CB5qSc6Ki844Gn44GN44G+44Gb44KT44Gn44GX44Gf44CC6Kit5a6a44Gu44CM44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX44CN44KS5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODq+OBruOBvuOBvu+8iOaWsOODouODh+ODq+OBr+aYjueiuuOBq+OBr+iJr+OBj+OBquOCieOBquOBi+OBo+OBn++8iSIsbmV3OiLmlrDjg6Ljg4fjg6vjgpLmjqHnlKgiKyhyLnVzZVNpbT8i77yI5biC5aC06L6844G/77yJIjoiIikrKHIudXNlUGFjZT8i77yI44Oa44O844K56L6844G/77yJIjoiIiksYmxlbmQ6IuePvuihjOOBqOaWsOOBruW5s+Wdh+OCkuaOoeeUqCIrKHIudXNlU2ltPyLvvIjluILloLTovrzjgb/vvIkiOiIiKSsoci51c2VQYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIiKX1bci5raW5kXTsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmtpbmQ9PT0ib2xkIj8id24iOiJvayJ9Ij48Yj7ntZDmnpzvvJoke25tfTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7mjqHnlKjmnaHku7bvvJrlr77mlbDmkI3lpLHjgYwwLjAwMuS7peS4iuaUueWWhOOBl+OAgUFVQ+OBjOaCquWMluOBl+OBpuOBhOOBquOBhOOBk+OBqOOAgjwvc3Bhbj48L2Rpdj5gOwogaCs9cGF5b3V0UmVwb3J0KHIpOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7nrYnntJrjgZTjgajjga48Yj7lrp/pmpvjga7ms6LkubHnjoc8L2I+77yI5qSc6Ki85YG044O7OTUl44Gu5bmF77yJ44CC44GT44Gu5pWw5a2X44GM44CB5rOi5Lmx5bqm44K/44OW44Gr6KGo56S644GV44KM44KL44KI44GG44Gr44Gq44KK44G+44GZ44CCPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuetiee0mjwvdGg+PHRoPuODrOODvOOCueaVsDwvdGg+PHRoPuWun+mam+OBruazouS5seeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtnXSBvZiBVUF9TSEFSRSl7Y29uc3QgeD1yLnRhYltnXTtoKz1gPHRyPjx0ZD4ke2d9PC90ZD48dGQ+JHt4Lm59PC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvKX3jgJwke3BjdCh4LmhpKX08L3RkPjwvdHI+YH0KIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGNvbnN0IG1vbm89VVBfU0hBUkUubWFwKChbZ10pPT5yLnRhYltnXS5yYXRlKS5ldmVyeSgodixpLGEpPT5pPT09MHx8djw9YVtpLTFdKy4wMyk7CiBpZighbW9ubyloKz0nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+562J57Sa44Gu6aCG44Gr5a6f57i+546H44GM5Y2Y6Kq/44Gr5LiL44GM44Gj44Gm44GE44G+44Gb44KT44CC5qSc6Ki85YG044Gu44Os44O844K55pWw44GM5bCR44Gq44GE44Go6LW344GN44G+44GZ77yI5YG254S244Gu56+E5Zuy44Gu44GT44Go44GM5aSa44GE77yJ44CCPC9kaXY+JzsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBheW91dFJlcG9ydChyKXsKIGlmKCFyLnBheVRhYnx8IXIucGF5UmFjZXMpcmV0dXJuJzxkaXYgY2xhc3M9InNtYWxsIHdhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOWPluW+l+OBp+OBjeOBpuOBhOOBquOBhOOBn+OCgeOAgeWun+mam+OBruaJleaIu+OBp+OBrueiuuiqjeOBr+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn++8iOOAjOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OAjeOBp+aJleaIu+OCguWPluW+l+OBleOCjOOBvuOBme+8ieOAgjwvZGl2Pic7CiBjb25zdCB5ZW49dj0+dj09bnVsbD8iLSI6TWF0aC5yb3VuZCh2KS50b0xvY2FsZVN0cmluZygpKyLlhoYiLHRibD0odCx0aXRsZSk9PnsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPjxiPiR7dGl0bGV9PC9iPjwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7kuojmg7Pjga7nrYnntJo8L3RoPjx0aD7jg6zjg7zjgrnmlbA8L3RoPjx0aD7lrp/pmpvjga7ms6LkubHnjoc8L3RoPjx0aD7li53jgaHppqzjga7ljZjli53phY3lvZPvvIjkuK3lpK7lgKTvvI/lubPlnYfvvIk8L3RoPjx0aD7ljZjli50xMDAw5YaG5Lul5LiKPC90aD48dGg+6KSH5YudM+mgreOBruWQiOioiO+8iOW5s+Wdh++8iTwvdGg+PHRoPjPnnYDlhoXjga7kurrmsJflkIjoqIg8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3QgW2ddIG9mIFVQX1NIQVJFKXtjb25zdCB4PXRbZ107aCs9YDx0cj48dGQ+PGI+JHtnfTwvYj48L3RkPjx0ZD4ke3gubnB9PC90ZD48dGQ+JHtwY3QoeC5yYXRlLDEpfTwvdGQ+PHRkPiR7eWVuKHgubWVkV2luKX3vvI8ke3llbih4LmF2Z1dpbil9PC90ZD48dGQ+JHt4LnNoYXJlMTAwMD09bnVsbD8iLSI6cGN0KHguc2hhcmUxMDAwLDApfTwvdGQ+PHRkPiR7eWVuKHguYXZnUGxhY2VTdW0pfTwvdGQ+PHRkPiR7eC5hdmdQb3BTdW09PW51bGw/Ii0iOnguYXZnUG9wU3VtLnRvRml4ZWQoMSl9PC90ZD48L3RyPmB9CiAgcmV0dXJuIGgrIjwvdGJvZHk+PC90YWJsZT48L2Rpdj4ifTsKIGxldCBoPWA8aDM+5LqI5oOz44Gu562J57Sa44GU44Go44Gu44CB5a6f6Zqb44Gu5omV5oi777yI5qSc6Ki85YG0ICR7ci5wYXlSYWNlc33jg6zjg7zjgrnvvIk8L2gzPjxkaXYgY2xhc3M9InNtYWxsIj7ms6LkubHluqbjga7kuojmg7PjgYzlvZPjgZ/jgaPjgabjgYTjgovjgarjgonjgIHnrYnntJrjgYzpq5jjgYTjgbvjganjgIHli53jgaHppqzjga7ljZjli53phY3lvZPjg7vopIfli50z6aCt44Gu5ZCI6KiI44O7M+edgOWGheOBruS6uuawl+WQiOioiOOBjOWkp+OBjeOBj+OBquOCiuOBvuOBmeOAgjwvZGl2PmA7CiBoKz10Ymwoci5wYXlUYWIsci5raW5kPT09Im9sZCI/IuaOoeeUqOOBl+OBn+S6iOaDs++8iOePvuihjOODouODh+ODq++8iSI6IuaOoeeUqOOBl+OBn+S6iOaDs++8iOWGjeagoeato+W+jO+8iSIpOwogY29uc3QgbT1yLnBheU1vbm87CiBoKz1tLnRvdD9gPGRpdiBjbGFzcz0iYmFubmVyICR7bS5vaz09PW0udG90PyJvayI6InduIn0iPjxiPiR7bS5vaz09PW0udG90PyLnrYnntJrjgYzkuIrjgYzjgovjgbvjganjgIHlrp/pmpvjga7miZXmiLvjgoLlpKfjgY3jgY/jgarjgaPjgabjgYTjgb7jgZnjgIIiOiLnrYnntJrjgYzkuIrjgYzjgaPjgabjgoLmiZXmiLvjgYzlpKfjgY3jgY/jgarjgonjgarjgYTnrofmiYDjgYzjgYLjgorjgb7jgZnvvIgiK20ub2srIi8iK20udG90KyLntYTvvInjgIIifTwvYj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj7pmqPjgorlkIjjgYbnrYnntJrjga7mr5TovIPjgafjgIHopIfli50z6aCt44Gu5ZCI6KiI5omV5oi744GoM+edgOWGheOBruS6uuawl+WQiOioiOOBruS4oeaWueOBjOOAgeS4iuOBruetiee0muOBruaWueOBjOWkp+OBjeOBhO+8iOOBvuOBn+OBrzUl5Lul5YaF44Gu5beu77yJ57WE44Gu5pWw44Gn44GZ44CC5Y2Y5Yud6YWN5b2T44Gu5Lit5aSu5YCk44Gv5bCR5pWw44Gu44Os44O844K544Gg44Go5YG254S244Gn44G244KM44KL44Gf44KB44CB5Yik5a6a44Gr44Gv5L2/44Gj44Gm44GE44G+44Gb44KT44CCPC9zcGFuPjwvZGl2PmA6IiI7CiBpZihyLmtpbmQhPT0ib2xkIiloKz10Ymwoci5wYXlUYWJTdGQsIuWPguiAg++8muaomea6luODouODh+ODq+OBruetiee0muOBp+WQjOOBmOmbhuioiOOCkuOBl+OBn+WgtOWQiCIpKyhyLnBheU1vbm9TdGQudG90P2A8ZGl2IGNsYXNzPSJzbWFsbCI+5qiZ5rqW44Oi44OH44Or44Gu562J57Sa44Gu5pW05ZCI77yaJHtyLnBheU1vbm9TdGQub2t9LyR7ci5wYXlNb25vU3RkLnRvdH3ntYQ8L2Rpdj5gOiIiKTsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHVwc2V0U3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRVcHNldE1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuaomea6luODouODh+ODq++8iOWtpue/kua4iOOBv+OBruWbuuWumuODouODh+ODq++8ieOAguWun+e4vueOh+OBr+Wtpue/kuaZguOBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiBjb25zdCBubT17b2xkOiLnj77ooYzjg6Ljg4fjg6siLG5ldzoi5YaN5qCh5q2j44GX44Gf5paw44Oi44OH44OrIixibGVuZDoi54++6KGM44Go5paw44Gu5bmz5Z2HIn1bTS5raW5kXTsKIHJldHVybmA8ZGl2IGNsYXNzPSJzbWFsbCI+PGI+JHtubX08L2I+44Gn5Yik5a6a5Lit77yI5qSc6Ki85pelICR7ZXNjKE0uYXQpfe+8j+aknOiovCAke00ublRlc3R944Os44O844K577yJ44CC562J57Sa44Gu5a6f57i+546H44Gv44CB44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn5ris44Gj44Gf5YCk44Gn44GZ44CCPC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOi/veWKoOOBruadoeS7tu+8mummrOWgtOeKtuaFi+ODu+aeoOmghu+8iOmmrOeVquOBruS9jee9ru+8ieODu+iqv+aVmeW4q+ODu+ihgOe1sQogKiAg44GZ44G544Gm44CM44Gd44Gu5pel44KI44KK5YmN44Gr5YiG44GL44Gj44Gm44GE44KL5oOF5aCx44CN44Gg44GR44Gn5L2c44KK44CB5Yq55p6c44GM44GC44KL44Go44GN44Gg44GR77yI5qSc6Ki844Gn77yJ5o6h55So44GZ44KL44CCCiAqICAg44O76aas5aC054q25oWL44Gu55u45oCn77ya44Gd44Gu6aas44GM44CB5ZCM44GY6aas5aC054q25oWL77yI6Imv77yP56iN6YeN44Cc5LiN6Imv77yJ44Gn6YGO5Y6744Gr44Gp44KM44Gg44GR6LWw44Gj44Gf44GLCiAqICAg44O75p6g6aCG44Gu5pyJ5Yip5LiN5Yip77ya6ZaL5YKs5aC0w5foip3jg4DDl+i3nembouOBlOOBqOOBruOAgeWGheOAnOWkluOBrjPnnYDlhoXnjofjga7lgY/jgooKICogICDjg7voqr/mlZnluKvvvJroqr/mlZnluKvjga7pgY7ljrvjga4z552A5YaF546HCiAqICAg44O76KGA57Wx77ya54i244O75q+N44Gu54i244GM44CB5ZCM44GY6Iqd44OAw5fot53pm6LjgafpgY7ljrvjgavjganjgozjgaDjgZHotbDjgaPjgZ/jgYvvvIjlh7rppqzooajjgYvjgonlsJHjgZfjgZrjgaTok4TnqY3jgILoqq3jgoHjgZ/ppqzjgaDjgZHvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCBnb2luZ0NvZGU9dD0+e3Q9U3RyaW5nKHR8fCIiKTtyZXR1cm4v5LiN6ImvLy50ZXN0KHQpPzQ6L+eojS8udGVzdCh0KT8yOi/ph40vLnRlc3QodCk/Mzov6ImvLy50ZXN0KHQpPzE6MH07CmNvbnN0IGdvaW5nQ2F0PWc9Pmc9PT0xPzE6KGc+PTI/MjowKTsgICAgLy8gMT3oia/jgIEyPeeojemHjeOAnOS4jeiJr+OAgTA95LiN5piOCmNvbnN0IEdPSU5HX05BTUU9ezA6IuS4jeaYjiIsMToi6ImvIiwyOiLph43ns7sifTsKY29uc3QgdmVudWVGcm9tSWQ9aWQ9PntpZD1TdHJpbmcoaWR8fCIiKTtyZXR1cm4vXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6KGlkLnNwbGl0KCItIilbM118fCIiKX07CmxldCBQRUQ9e307ICAgLy8g6aas5ZCNIOKGkiB7czrniLYsZDrmr40sbTrmr43jga7niLZ944CC5Ye66aas6KGo44GL44KJ5bCR44GX44Ga44Gk6JOE56mN44GZ44KLCgovKiDmnqDpoIbvvIjppqznlarjga7kvY3nva7vvInvvJrplovlgqzloLTDl+iKneODgMOX6Led6Zui44GU44Go44Gr44CB5YaF44Cc5aSWNeWMuuWIhuOBrjPnnYDlhoXnjocgKi8KY2xhc3MgRHJhd1ByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5tPW5ldyBNYXAoKX0KIF9iKG51bSxOKXtyZXR1cm4gTj4xP01hdGgubWluKDQsTWF0aC5tYXgoMCxNYXRoLmZsb29yKChudW0tMSkvTio1KSkpOjJ9CiBfayh2LHMsZCl7cmV0dXJuIHYrInwiK3MrInwiK2Rpc3RCKGQpfQogYWRkKHYscyxkLG51bSxOLHQzKXsKICBpZighbnVtfHxOPDgpcmV0dXJuOwogIGNvbnN0IGs9dGhpcy5fayh2LHMsZCksYj10aGlzLl9iKG51bSxOKTtsZXQgZz10aGlzLm0uZ2V0KGspOwogIGlmKCFnKXRoaXMubS5zZXQoayxnPXtuOjAsdDowLGI6W1swLDBdLFswLDBdLFswLDBdLFswLDBdLFswLDBdXX0pOwogIGcubisrO2cudCs9dDM7Zy5iW2JdWzBdKys7Zy5iW2JdWzFdKz10MzsKIH0KIGZlYXQodixzLGQsbnVtLE4pewogIGlmKCFudW18fE48OClyZXR1cm4gMDsKICBjb25zdCBnPXRoaXMubS5nZXQodGhpcy5fayh2LHMsZCkpO2lmKCFnfHxnLm48MzAwKXJldHVybiAwOwogIGNvbnN0IGI9dGhpcy5fYihudW0sTiksYmFzZT1nLnQvZy5uLEs9NjAsW24sdF09Zy5iW2JdOwogIHJldHVybiBsZ3QoKHQrSypiYXNlKS8obitLKSktbGd0KGJhc2UpOwogfQp9Ci8qIOihgOe1se+8mueItuODu+avjeOBrueItuOBlOOBqOOBruOAgeiKneODgMOX6Led6Zui44Gn44Gu44CM5a6f6Zqb44GuM+edgOWGheaVsCDDtyDmnJ/lvoXjga4z552A5YaF5pWw77yIMy/poK3mlbDjga7lkIjoqIjvvInjgI0gKi8KY2xhc3MgU2lyZVByaXsKIGNvbnN0cnVjdG9yKCl7dGhpcy5tPW5ldyBNYXAoKX0KIGtleShraW5kLHYsc2YsZCl7cmV0dXJuIGtpbmQrInwiK3YrInwiK3NmKyJ8IitkaXN0QihkKX0KIGFkZChwZWQsc2YsZCx0MyxOKXsKICBpZighcGVkfHxOPDgpcmV0dXJuO2NvbnN0IGU9TWF0aC5taW4oLjUsMy9OKTsKICBmb3IoY29uc3QgW2tpbmQsdl0gb2YgW1sicyIscGVkLnNdLFsibSIscGVkLm1dXSl7CiAgIGlmKCF2KWNvbnRpbnVlO2NvbnN0IGs9dGhpcy5rZXkoa2luZCx2LHNmLGQpO2xldCB4PXRoaXMubS5nZXQoayk7CiAgIGlmKCF4KXRoaXMubS5zZXQoayx4PXtuOjAsdDowLGU6MH0pO3gubisrO3gudCs9dDM7eC5lKz1lOwogIH0KIH0KIGZlYXQocGVkLHNmLGQpewogIGlmKCFwZWQpcmV0dXJuWzAsMCwwLDBdOwogIGNvbnN0IGc9KHYsa2luZCk9PntpZighdilyZXR1cm5bMCwwXTtjb25zdCB4PXRoaXMubS5nZXQodGhpcy5rZXkoa2luZCx2LHNmLGQpKTtpZigheHx8eC5uPDI1KXJldHVyblswLDBdO3JldHVybltNYXRoLmxvZygoeC50KzMpLyh4LmUrMykpLDFdfTsKICByZXR1cm5bLi4uZyhwZWQucywicyIpLC4uLmcocGVkLm0sIm0iKV07CiB9Cn0KLyogMemgreOBtuOCk+OBrui/veWKoOeJueW+tO+8iDnlgIvvvInvvJrppqzloLTjga7nm7jmgKfjg7vmnInnhKHvvI/mnqDpoIbjga7lgY/jgorvvI/oqr/mlZnluKvjga7lt67jg7vmnInnhKHvvI/niLbjga7nm7jmgKfjg7vmnInnhKHvvI/mr43jga7niLbjga7nm7jmgKfjg7vmnInnhKEgKi8KZnVuY3Rpb24gZXh0RmVhdEhvcnNlKHIsaCxyYyxjdHgsYil7CiBjb25zdCBuMD1oP2gubjowLHBTPSgoaD9oLnRvcDM6MCkrMypiKS8objArMyk7CiBsZXQgZ2ZpdD0wLGdrPTA7Y29uc3QgZ249aCYmaC5nbiYmcmMuZ2M+MD9oLmduW3JjLmdjXTpudWxsOwogaWYoZ24mJmduWzBdPj0yKXtnZml0PShnblsxXSszKnBTKS8oZ25bMF0rMyktcFM7Z2s9MX0KIGNvbnN0IGRyYXc9Y3R4LmRyYXc/Y3R4LmRyYXcuZmVhdChyYy52LHJjLnN1cmYscmMuZGlzdCxyLm51bSxyYy5OKTowOwogbGV0IHRlPTAsdGs9MDtjb25zdCB0cj1jdHgudHImJnIudHJhaW5lcj9jdHgudHIuZ2V0KHIudHJhaW5lcik6bnVsbDsKIGlmKHRyJiZ0ci5uPj0yMCl7dGU9KHRyLnQzKy4yKjQwKS8odHIubis0MCktLjI7dGs9MX0KIGNvbnN0IHNmPWN0eC5zaXJlP2N0eC5zaXJlLmZlYXQoY3R4LnBlZCYmY3R4LnBlZFtyLmhvcnNlXSxyYy5zdXJmLHJjLmRpc3QpOlswLDAsMCwwXTsKIHJldHVybltnZml0LGdrLGRyYXcsdGUsdGssLi4uc2ZdOwp9Ci8qIOWxpeattOOBi+OCieOAgeWHuummrOihqOOBi+OCieiqreOCk+OBoOihgOe1seOCkuiThOepje+8iOmAseacq+OBruWPluW+l+OBruOBn+OBs+OBq+abtOaWsOOBl+OBpuS/neWtmO+8iSAqLwphc3luYyBmdW5jdGlvbiBwZWRpZ3JlZVVwZGF0ZShjYXJkcyl7CiBsZXQgYWRkZWQ9MCxzZWVuPTA7CiBmb3IoY29uc3QgZCBvZiBPYmplY3Qua2V5cyhjYXJkcykpZm9yKGNvbnN0IGMgb2YgY2FyZHNbZF18fFtdKWZvcihjb25zdCBoIG9mIChjLmhvcnNlc3x8W10pKXsKICBjb25zdCBuYW1lPVVFLm5uKGguaG9yc2VOYW1lfHxoLmhvcnNlfHxoLm5hbWV8fCIiKTtpZighbmFtZSljb250aW51ZTsKICBpZihoLnNpcmV8fGguZGFtU2lyZSl7c2VlbisrO2NvbnN0IG89e3M6VUUubm4oaC5zaXJlfHwiIiksZDpVRS5ubihoLmRhbXx8IiIpLG06VUUubm4oaC5kYW1TaXJlfHwiIil9OwogICBjb25zdCBwPVBFRFtuYW1lXTtpZighcHx8cC5zIT09by5zfHxwLm0hPT1vLm0pe1BFRFtuYW1lXT1vO2FkZGVkKyt9fQogfQogaWYoYWRkZWQpe3RyeXthd2FpdCBtZXRhUHV0KCJwZWQiLFBFRCl9Y2F0Y2goZSl7fX0KIHJldHVybntzZWVuLGFkZGVkLHRvdGFsOk9iamVjdC5rZXlzKFBFRCkubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBwZWRpZ3JlZUxvYWQoKXt0cnl7Y29uc3QgeD1hd2FpdCBtZXRhR2V0KCJwZWQiKTtpZih4JiZ0eXBlb2YgeD09PSJvYmplY3QiKVBFRD14fWNhdGNoKGUpe319CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44Gu5qSc6Ki844O75YaN5qCh5q2jCiAqICDnm67nmoTvvJrlkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44GG5pWw5a2X44Gr44GZ44KL44CCCiAqICDjgoTjgovjgZPjgajvvJoKICogICAxKSDpgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHjg6zjg7zjgrnliY3jgavliIbjgYvjgovmg4XloLHjgaDjgZHjgaflkITppqzjga7norrnjofjgpLoqIjnrpcKICogICAgICAgIOODu+mBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+ODouODh+ODq+OBrueiuueOh++8iOOCquODg+OCuuOCkuS9v+OCj+OBquOBhO+8iQogKiAgICAgICAg44O75Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7jgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H77yI5biC5aC044Gu5oOF5aCx44CC44Kq44OD44K65Y+W5b6X5b6M44Gv5Lq65rCX6aCG5L2N44GM5rG644G+44KL77yJCiAqICAgMikgMuOBpOOCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq++8iOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8ieOCkuOAgeWtpue/kuWBtOOBruacn+mWk+OBp+S9nOOCiwogKiAgIDMpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDQpIOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAgui2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWIh+OCjOebruOCguOAgeOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFBMS0VZPSJrZWliYV9wbGFjZV92MSI7CgovKiDkurrmsJfpoIbkvY3Dl+mgreaVsOOBlOOBqOOBruOAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga8zL+mgreaVsOOBuOWvhOOBm+OCi++8iSAqLwpjbGFzcyBQb3BQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBrZXkocG9wLE4pe3JldHVybiBNYXRoLm1pbigxOCxwb3ApKyJ8IitNYXRoLm1pbigxOCxNYXRoLm1heCg2LE4pKX0KIGFkZChsaXN0LE4pewogIGZvcihjb25zdCBbcG9wLGZpbl0gb2YgbGlzdCl7CiAgIGlmKCEocG9wPjApfHxmaW49PW51bGwpY29udGludWU7CiAgIGNvbnN0IGs9dGhpcy5rZXkocG9wLE4pO2xldCB4PXRoaXMubS5nZXQoayk7aWYoIXgpdGhpcy5tLnNldChrLHg9e246MCx0OjB9KTsKICAgeC5uKys7aWYoZmluPD0zKXgudCsrOwogIH0KIH0KIHJhdGUocG9wLE4pewogIGNvbnN0IHg9dGhpcy5tLmdldCh0aGlzLmtleShwb3AsTikpfHx7bjowLHQ6MH0sYmFzZT1NYXRoLm1pbiguOTUsMy9NYXRoLm1heChOLDMpKSxLPTMwOwogIHJldHVybih4LnQrSypiYXNlKS8oeC5uK0spOwogfQp9Ci8qIOeiuueOh+OBruWQiOioiOOCkuOBoeOCh+OBhuOBqXRhcmdldOOBq+OBmeOCi++8iOODreOCuOODg+ODiOOCkuS4gOanmOOBq+OBmuOCieOBme+8iSAqLwpmdW5jdGlvbiBub3JtU3VtKHosdGFyZ2V0KXsKIGxldCBsbz0tMTQsaGk9MTQ7CiBmb3IobGV0IGl0PTA7aXQ8NjA7aXQrKyl7Y29uc3QgbWlkPShsbytoaSkvMjtsZXQgcz0wO2Zvcihjb25zdCB2IG9mIHopcys9c2lnbSh2K21pZCk7aWYocz50YXJnZXQpaGk9bWlkO2Vsc2UgbG89bWlkfQogY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHoubWFwKHY9PnNpZ20oditjKSk7Cn0KLyogMemgreOBruWFpeWKm++8muODouODh+ODq+eiuueOh+ODu+S6uuawl+ODmeODvOOCueOBruWun+e4vueOh+ODu+S6uuawl+OBruS9jee9ruODu+mgreaVsOODu+ODouODh+ODq+WGheOBrumghuS9jSAqLwpmdW5jdGlvbiBwbGFjZVgocFAscG9wLE4scHJpLHJhbmtGcmFjKXsKIHJldHVybltsZ3QocFApLGxndChwcmkucmF0ZShwb3AsTikpLChwb3AtMSkvTWF0aC5tYXgoMSxOLTEpLE4vMTYscmFua0ZyYWMscG9wPT09MT8xOjAscG9wPD0zPzE6MF07Cn0KY29uc3QgcmFua0ZyYWNzPXBzPT57Y29uc3Qgbz1wcy5tYXAoKHAsaSk9PmkpLnNvcnQoKGEsYik9PnBzW2JdLXBzW2FdKSxyaz1BcnJheShwcy5sZW5ndGgpO28uZm9yRWFjaCgoaSxyKT0+cmtbaV09ci9NYXRoLm1heCgxLHBzLmxlbmd0aC0xKSk7cmV0dXJuIHJrfTsKY29uc3QgcG9wc0Zyb21PZGRzPW9kPT5vZC5tYXAodj0+MStvZC5maWx0ZXIodz0+dzx2KS5sZW5ndGgpOwoKY29uc3QgZ2V0UGxhY2VNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oUExLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmtpbmQ9PT0ibmV3IiYmbS5tb2RlbCYmbS52ZXI9PT0yP206bnVsbH1jYXRjaChlKXtyZXR1cm4gbnVsbH19OwoKLyog5Y+N5b+c44Gu56K66KqN55So77ya5LqI5ris44Gu5Yy66ZaT44GU44Go44Gu5a6f57i+77yI5L+h6aC85oCn77yJICovCmZ1bmN0aW9uIHJlbGlhYmlsaXR5QmlucyhwLHksQil7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksbj15Lmxlbmd0aCxvdXQ9W107CiBmb3IobGV0IGI9MDtiPEI7YisrKXsKICBjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBrPXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCksdz13aWxzb24oayxzLmxlbmd0aCk7CiAgb3V0LnB1c2goe2xvOnBbc1swXV0saGk6cFtzW3MubGVuZ3RoLTFdXSxuOnMubGVuZ3RoLG1lYW46cy5yZWR1Y2UoKGEsaSk9PmErcFtpXSwwKS9zLmxlbmd0aCxhY3Q6ay9zLmxlbmd0aCx3bG86d1swXSx3aGk6d1sxXX0pOwogfQogcmV0dXJuIG91dDsKfQpmdW5jdGlvbiB0aHJlc2hvbGRSb3cocCx5LHQpewogbGV0IG49MCxrPTA7Zm9yKGxldCBpPTA7aTxwLmxlbmd0aDtpKyspaWYocFtpXT49dCl7bisrO2srPXlbaV19CiBjb25zdCB3PXdpbHNvbihrLG4pO3JldHVybnt0LG4sayxyYXRlOm4/ay9uOjAsbG86d1swXSxoaTp3WzFdfTsKfQoKLyogLS0tLS0tLS0tLSDnqbTppqzjgr7jg7zjg7PvvIjkurrmsJfjga7kuIvkvY3vvInjgafjga7mpJzoqLwgLS0tLS0tLS0tLQogICDnqbTppqzvvJ3kurrmsJfpoIbkvY3jgYwgbWF4KDUsIOmgreaVsOOBrjQwJeWIh+OCiuS4iuOBkikg5Lul5LiL44Gu6aas44CC6KmV5L6hKFMvQS9CL0Mp44Gv44CB5a2m57+S5YG044Gu56m06aas44Gu5LqI5ris56K6546H44Gu5LiK5L2NNCXvvI8xMiXvvI8zMCXjgafljLrliIfjgosgKi8KYXN5bmMgZnVuY3Rpb24gbG9hZFBheU1hcCgpewogY29uc3QgbT1uZXcgTWFwKCk7CiB0cnl7Zm9yKGNvbnN0IGRheSBvZiBhd2FpdCBwYXlBbGwoKSlmb3IoY29uc3QgciBvZiAoZGF5LnJhY2VzfHxbXSkpaWYoci5yYWNlSWQmJnIucGxhY2UpbS5zZXQoci5yYWNlSWQsci5wbGFjZSl9Y2F0Y2goZSl7fQogcmV0dXJuIG07Cn0KZnVuY3Rpb24gaG9sZUV2YWwobW9kZWwseGYsdHJhaW4sdGVzdCxwYXlNYXAsdGVzdERheXMpewogY29uc3Qgc29ydGVkPVtdOwogZm9yKGNvbnN0IHIgb2YgdHJhaW4pe2NvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57aWYoaC5ob2xlKXNvcnRlZC5wdXNoKHZbal0pfSl9CiBzb3J0ZWQuc29ydCgoYSxiKT0+Yi1hKTsKIGNvbnN0IHE9Zj0+c29ydGVkW01hdGgubWluKHNvcnRlZC5sZW5ndGgtMSxNYXRoLm1heCgwLE1hdGgucm91bmQoc29ydGVkLmxlbmd0aCpmKS0xKSldOwogY29uc3QgY3V0cz17UzpxKC4wNCksQTpxKC4xMiksQjpxKC4zMCl9OwogY29uc3QgZ3JhZGU9cD0+cD49Y3V0cy5TPyJTIjpwPj1jdXRzLkE/IkEiOnA+PWN1dHMuQj8iQiI6IkMiOwogY29uc3QgdGFiPXtTOntuOjAsazowLHBiOjAscGF5OjB9LEE6e246MCxrOjAscGI6MCxwYXk6MH0sQjp7bjowLGs6MCxwYjowLHBheTowfSxDOntuOjAsazowLHBiOjAscGF5OjB9fTsKIGNvbnN0IHJrPXtuZXc6e3QxOntuOjAsazowLHBiOjAscGF5OjB9LHQyOntuOjAsazowLHBiOjAscGF5OjB9fSxwUDp7dDE6e246MCxrOjAscGI6MCxwYXk6MH0sdDI6e246MCxrOjAscGI6MCxwYXk6MH19LG1rdDp7dDE6e246MCxrOjAscGI6MCxwYXk6MH0sdDI6e246MCxrOjAscGI6MCxwYXk6MH19fTsKIGxldCBuSG9sZT0wLGtIb2xlPTA7Y29uc3QgcEhvbGU9W10seUhvbGU9W107CiBjb25zdCBiZXQ9KHN0LHIsaCk9PntzdC5uKys7c3Quays9aC55O2NvbnN0IHBsPXBheU1hcCYmcGF5TWFwLmdldChyLnJhY2VJZCk7aWYocGwpe3N0LnBiKys7Y29uc3QgaGl0PXBsLmZpbmQoeD0+eC5udW1iZXI9PT1oLm51bSk7aWYoaGl0KXN0LnBheSs9aGl0Lnllbn19OwogZm9yKGNvbnN0IHIgb2YgdGVzdCl7CiAgY29uc3Qgdj1ub3JtU3VtKHIuaC5tYXAoaD0+cHJlZExvZ2l0KG1vZGVsLHhmKGgpKSksMyksaHM9W107CiAgci5oLmZvckVhY2goKGgsaik9PntpZighaC5ob2xlKXJldHVybjtocy5wdXNoKHtoLHA6dltqXX0pO2JldCh0YWJbZ3JhZGUodltqXSldLHIsaCk7bkhvbGUrKztrSG9sZSs9aC55O3BIb2xlLnB1c2godltqXSk7eUhvbGUucHVzaChoLnkpfSk7CiAgY29uc3QgYnk9KGYpPT5ocy5zbGljZSgpLnNvcnQoZik7CiAgY29uc3Qgb3JkZXJzPXtuZXc6YnkoKGEsYik9PmIucC1hLnApLHBQOmJ5KChhLGIpPT5iLmgucFAtYS5oLnBQKSxta3Q6YnkoKGEsYik9PmEuaC5wb3AtYi5oLnBvcCl9OwogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKG9yZGVycykpe29yZGVyc1trXS5zbGljZSgwLDEpLmZvckVhY2goej0+YmV0KHJrW2tdLnQxLHIsei5oKSk7b3JkZXJzW2tdLnNsaWNlKDAsMikuZm9yRWFjaCh6PT5iZXQocmtba10udDIscix6LmgpKX0KIH0KIGNvbnN0IGZpbj1zdD0+e2NvbnN0IHc9d2lsc29uKHN0Lmssc3Qubik7cmV0dXJue246c3QubixrOnN0LmsscmF0ZTpzdC5uP3N0Lmsvc3QubjowLGxvOndbMF0saGk6d1sxXSxwZXJEYXk6dGVzdERheXM/c3Qubi90ZXN0RGF5czowLHJvaTpzdC5wYj9zdC5wYXkvKDEwMCpzdC5wYik6bnVsbCxwYjpzdC5wYn19OwogY29uc3QgdGFiRj17fTtmb3IoY29uc3QgZyBvZiBbIlMiLCJBIiwiQiIsIkMiXSl0YWJGW2ddPWZpbih0YWJbZ10pOwogY29uc3QgcmtGPXt9O2Zvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKHJrKSlya0Zba109e3QxOmZpbihya1trXS50MSksdDI6ZmluKHJrW2tdLnQyKX07CiByZXR1cm57Y3V0cyx0YWI6dGFiRixyYW5rOnJrRixuSG9sZSxiYXNlUmF0ZTpuSG9sZT9rSG9sZS9uSG9sZTowLGF1YzphdWNPZihwSG9sZSx5SG9sZSl9Owp9CmNvbnN0IGdyYWRlSG9sZT0oY3V0cyxwKT0+cD49Y3V0cy5TPyJTIjpwPj1jdXRzLkE/IkEiOnA+PWN1dHMuQj8iQiI6IkMiOwoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5QbGFjZUZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAxOS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5EOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IHBheU1hcD1vcHRzLnBheU1hcHx8YXdhaXQgbG9hZFBheU1hcCgpOwogY29uc3QgbWFwPW5ldyBNYXAoKTsKIGF3YWl0IGZvckVhY2hSb3cocj0+e2lmKCFyLmRhdGV8fCFyLnJhY2VJZClyZXR1cm47Y29uc3Qgaz1yLmRhdGUrInwiK3IucmFjZUlkO2xldCB4PW1hcC5nZXQoayk7aWYoIXgpbWFwLnNldChrLHg9e2lkOnIucmFjZUlkLGRhdGU6ci5kYXRlLHJvd3M6W119KTt4LnJvd3MucHVzaChyKX0pOwogY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogaWYocmFjZXMubGVuZ3RoPDUwMCl7YnVzeShmYWxzZSk7cmV0dXJue2Vycm9yOiLpgY7ljrvjg4fjg7zjgr/jgYzlsJHjgarjgZnjgY7jgb7jgZnvvIgiK3JhY2VzLmxlbmd0aCsi44Os44O844K577yJ44CC5YWI44Gr6YGO5Y6744Os44O844K544KS5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCIn19CiB3ZlN5bmMocmFjZXMpOwogY29uc3Qgc3RvcmU9bmV3IFVFLlN0b3JlKCkscHJpPW5ldyBQb3BQcmkoKSxSUz1bXSxkcmF3UD1uZXcgRHJhd1ByaSgpLHNpcmVQPW5ldyBTaXJlUHJpKCksdHJNPW5ldyBNYXAoKTsKIGNvbnN0IGNvdj17cmFjZXM6MCxnb2luZ1JhY2VzOjAsaG9yc2VzOjAsdHJhaW5lcjowLHNpcmU6MH07CiBmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKyspewogIGNvbnN0IHJjPXJhY2VzW2ldLFI9cmMucm93cy5maWx0ZXIocj0+ci5ob3JzZSYmci5maW5pc2ghPW51bGwpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSksTj1SLmxlbmd0aDsKICBjb25zdCB2YWxpZD1OPj04JiZSLmV2ZXJ5KHI9PnIucG9wPjApJiZSLnNvbWUocj0+ci5maW5pc2g9PT0xKTsKICBpZih2YWxpZCYmcmMuZGF0ZT49U1RBUlQmJiEv6Zqc5a6zLy50ZXN0KFN0cmluZyhSWzBdLnJhY2VOYW1lfHwiIikpKXsKICAgY29uc3Qgb2Q9Ui5ldmVyeShyPT5yLm9kZHM+MSk/Ui5tYXAocj0+ci5vZGRzKTpudWxsOwogICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLGdyZDpSWzBdLmdyZHx8MCxydW5uZXJzOlJ9OwogICB0cnl7CiAgICBjb25zdCB3Yz13ZkdldChyYy5yb3dzWzBdLnJhY2VJZCk7ICAgLy8g5rOi5Lmx5bqm44Gu5qSc6Ki844Go5YWx5pyJCiAgICBpZighd2MublApd2MublA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsbnVsbCkucFA7CiAgICBpZihvZCYmIXdjLm9QKXdjLm9QPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKS5wTzsKICAgIGNvbnN0IGFwPXtwUDp3Yy5uUH0sYXBPPW9kP3twTzp3Yy5vUH06bnVsbCxyaz1yYW5rRnJhY3MoYXAucFApOwogICAgY29uc3QgY3V0SD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSkscmNJPXtnYzpSWzBdLmdjfHwwLHY6dmVudWVGcm9tSWQocmMucm93c1swXS5yYWNlSWQpLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LE59LGN0eD17ZHJhdzpkcmF3UCx0cjp0ck0sc2lyZTpzaXJlUCxwZWQ6UEVEfSxiYj1NYXRoLm1pbiguNSwzL04pOwogICAgY292LnJhY2VzKys7aWYocmNJLmdjPjApY292LmdvaW5nUmFjZXMrKzsKICAgIFJTLnB1c2goe2RhdGU6cmMuZGF0ZSxyYWNlSWQ6cmMucm93c1swXS5yYWNlSWQsTixoOlIubWFwKChyLGopPT57Y29uc3QgZT1leHRGZWF0SG9yc2UocixzdG9yZS5oLmdldChyLmhvcnNlKSxyY0ksY3R4LGJiKTtjb3YuaG9yc2VzKys7aWYoZVs0XSljb3YudHJhaW5lcisrO2lmKGVbNl18fGVbOF0pY292LnNpcmUrKztyZXR1cm57eDpwbGFjZVgoYXAucFBbal0sci5wb3AsTixwcmkscmtbal0pLGUseTpyLmZpbmlzaDw9Mz8xOjAscFA6YXAucFBbal0scHI6cHJpLnJhdGUoci5wb3AsTikscE86YXBPP2FwTy5wT1tqXTpudWxsLG51bTpyLm51bSxwb3A6ci5wb3AsaG9sZTpyLnBvcD49Y3V0SH19KX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBpZih2YWxpZClwcmkuYWRkKFIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLE4pOwogIGlmKE4+PTgpe2NvbnN0IHZ2PXZlbnVlRnJvbUlkKHJjLnJvd3NbMF0ucmFjZUlkKTtmb3IoY29uc3QgciBvZiBSKXtjb25zdCB0Mz1yLmZpbmlzaDw9Mz8xOjA7ZHJhd1AuYWRkKHZ2LFJbMF0uc3VyZixSWzBdLmRpc3Qsci5udW0sTix0Myk7c2lyZVAuYWRkKFBFRFtyLmhvcnNlXSxSWzBdLnN1cmYsUlswXS5kaXN0LHQzLE4pO2lmKHIudHJhaW5lcil7bGV0IHQ9dHJNLmdldChyLnRyYWluZXIpO2lmKCF0KXRyTS5zZXQoci50cmFpbmVyLHQ9e246MCx0MzowfSk7dC5uKys7dC50Mys9dDN9fX0KICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXtyLmNmPWNvcm5lckZyYWMoci5jb3JuZXIscmMucm93cy5sZW5ndGgpO3N0b3JlLmFkZChyKX0KICBpZihpJTMwPT09Mjkpe2J1c3kodHJ1ZSxg5pmC57O75YiX44Gr5YaN54++44GX44Gm5qSc6Ki85Lit4oCmICR7aSsxfS8ke3JhY2VzLmxlbmd0aH3jg6zjg7zjgrlgKTthd2FpdCBzbGVlcCgwKX0KIH0KIGJ1c3kodHJ1ZSwi44Oi44OH44Or44KS5q+U6LyD5Lit4oCmIik7YXdhaXQgc2xlZXAoMCk7CiBjb25zdCB0cmFpbj1SUy5maWx0ZXIocj0+ci5kYXRlPFRFU1QpLHRlc3Q9UlMuZmlsdGVyKHI9PnIuZGF0ZT49VEVTVCk7CiBjb25zdCByZXM9e25UcmFpbjp0cmFpbi5sZW5ndGgsblRlc3Q6dGVzdC5sZW5ndGgsc3RhcnQ6U1RBUlQsdGVzdFN0YXJ0OlRFU1R9OwogaWYodHJhaW4ubGVuZ3RoPDE1MDB8fHRlc3QubGVuZ3RoPDMwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIC8vIOaWsOODouODh+ODq++8muWtpue/kuWBtOOBruOBv+OBp+S9nOOCi+OAguOAjOi/veWKoOOBruadoeS7tu+8iOmmrOWgtOODu+aeoOmghuODu+iqv+aVmeW4q+ODu+ihgOe1se+8ieOBguOCiuOAjeOBqOOAjOOBquOBl+OAjeOBrjLpgJrjgorjgpLmr5TjgbnjgosKIGNvbnN0IHk9W10sWGI9W10sWGU9W107Zm9yKGNvbnN0IHIgb2YgdHJhaW4pZm9yKGNvbnN0IGggb2Ygci5oKXt5LnB1c2goaC55KTtYYi5wdXNoKGgueCk7WGUucHVzaChbLi4uaC54LC4uLmguZV0pfQogY29uc3QgbW9kZWxCPWZpdExvZ2l0KFhiLHksNSksbW9kZWxFPWZpdExvZ2l0KFhlLHksNSk7CiBjb25zdCBmbGF0PWY9Pntjb25zdCBwPVtdLHl5PVtdO2Zvcihjb25zdCByIG9mIHRlc3Qpe2NvbnN0IHY9ZihyKTtyLmguZm9yRWFjaCgoaCxqKT0+e3AucHVzaCh2W2pdKTt5eS5wdXNoKGgueSl9KX1yZXR1cm57cCx5Onl5fX07CiBjb25zdCB4Qj1oPT5oLngseEU9aD0+Wy4uLmgueCwuLi5oLmVdOwogY29uc3QgZXZhbE09KG0seGYpPT57Y29uc3QgZD1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobSx4ZihoKSkpLDMpKTtyZXR1cm57ZCxtZXQ6bWV0cmljc09mKGQucCxkLnkpfX07CiBjb25zdCBFQj1ldmFsTShtb2RlbEIseEIpLEVFPWV2YWxNKG1vZGVsRSx4RSk7CiBjb25zdCB1c2VFeHQ9RUUubWV0LmxsPD1FQi5tZXQubGwtLjAwMTsgICAvLyDov73liqDjga7mnaHku7bjgafjgIHlr77mlbDmkI3lpLHjgYwwLjAwMeS7peS4iuiJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeS9v+OBhgogY29uc3QgbW9kZWw9dXNlRXh0P21vZGVsRTptb2RlbEIseGY9dXNlRXh0P3hFOnhCLGROZXc9dXNlRXh0P0VFLmQ6RUIuZDsKIHJlcy5tQmFzZT1FQi5tZXQ7cmVzLm1FeHQ9RUUubWV0O3Jlcy51c2VFeHQ9dXNlRXh0O3Jlcy5jb3Y9ey4uLmNvdixnb2luZ1NoYXJlOmNvdi5yYWNlcz9jb3YuZ29pbmdSYWNlcy9jb3YucmFjZXM6MCx0cmFpbmVyU2hhcmU6Y292LmhvcnNlcz9jb3YudHJhaW5lci9jb3YuaG9yc2VzOjAsc2lyZVNoYXJlOmNvdi5ob3JzZXM/Y292LnNpcmUvY292LmhvcnNlczowLHBlZEhvcnNlczpPYmplY3Qua2V5cyhQRUQpLmxlbmd0aH07CiBjb25zdCBkUFA9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucFApKSwzKSk7CiBjb25zdCBkTWs9ZmxhdChyPT5ub3JtU3VtKHIuaC5tYXAoaD0+bGd0KGgucHIpKSwzKSk7CiByZXMubU5ldz1tZXRyaWNzT2YoZE5ldy5wLGROZXcueSk7cmVzLm1QUD1tZXRyaWNzT2YoZFBQLnAsZFBQLnkpO3Jlcy5tTWs9bWV0cmljc09mKGRNay5wLGRNay55KTsKIC8vIOePvuihjOOBruOCquODg+OCuui+vOOBv+eiuueOhyhwTynjga/jgIHjgqrjg4PjgrrjgaTjgY3jga7miJDnuL7jgYzjgYLjgovmnJ/plpPjgaDjgZHmr5TjgbnjgonjgozjgosKIGNvbnN0IHN1Yj10ZXN0LmZpbHRlcihyPT5yLmguZXZlcnkoaD0+aC5wTyE9bnVsbCkpOwogcmVzLm5PZGRzVGVzdD1zdWIubGVuZ3RoOwogaWYoc3ViLmxlbmd0aD49MTUwKXsKICBjb25zdCBwbj1bXSxwbz1bXSx5eT1bXTtmb3IoY29uc3QgciBvZiBzdWIpe2NvbnN0IHY9bm9ybVN1bShyLmgubWFwKGg9PnByZWRMb2dpdChtb2RlbCx4ZihoKSkpLDMpO3IuaC5mb3JFYWNoKChoLGopPT57cG4ucHVzaCh2W2pdKTtwby5wdXNoKGgucE8pO3l5LnB1c2goaC55KX0pfQogIHJlcy5tTmV3T2Rkcz1tZXRyaWNzT2YocG4seXkpO3Jlcy5tT2Rkcz1tZXRyaWNzT2YocG8seXkpOwogfQogLy8g5o6h55So44Gu5Yik5patCiBjb25zdCBtPXJlcy5tTmV3OwogbGV0IGFkb3B0PW0ubGw8cmVzLm1QUC5sbC0uMDAzJiZtLmxsPHJlcy5tTWsubGwtLjAwMzsKIGlmKGFkb3B0JiZyZXMubU9kZHMpYWRvcHQ9cmVzLm1OZXdPZGRzLmxsPD1yZXMubU9kZHMubGwtLjAwMDU7CiByZXMuYWRvcHQ9YWRvcHQ7cmVzLnZzT2Rkcz1yZXMubU9kZHM/IuavlOi8g+a4iOOBvyI6IuacquavlOi8gyI7CiAvLyDkv6HpoLzmgKfvvJrkuojmuKzjga7ljLrplpPjgZTjgajjga7lrp/pmpvjga7nmoTkuK3njocKIHJlcy5iaW5zPXJlbGlhYmlsaXR5QmlucyhkTmV3LnAsZE5ldy55LDEwKTsKIHJlcy50ZXN0RGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiByZXMuaG9sZT1ob2xlRXZhbChtb2RlbCx4Zix0cmFpbix0ZXN0LHBheU1hcCxyZXMudGVzdERheXMpOwogcmVzLnRocj1bLjUsLjcsLjgsLjg1LC44OCwuOSwuOTIsLjkzLC45NSwuOTddLm1hcCh0PT50aHJlc2hvbGRSb3coZE5ldy5wLGROZXcueSx0KSk7CiByZXMuYmluc1BQPXJlbGlhYmlsaXR5QmlucyhkUFAucCxkUFAueSwxMCk7CiAvLyDotoXpiYTmnb/vvJ3kuojmuKw5NSXku6XkuIrjga7ppqzvvIjkvZXpoK3jgafjgoLvvInjgILmpJzoqLzlgbTjgafjgIHlrp/pmpvjgavjganjgozjgaDjgZHlvZPjgZ/jgaPjgZ/jgYvjgpLoqJjpjLLjgZnjgosKIGxldCBpcm9uPW51bGw7CiB7Y29uc3Qgcm93PXRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LC45NSksZGF5cz1uZXcgU2V0KHRlc3QubWFwKHI9PnIuZGF0ZSkpLnNpemU7CiAgaWYocm93Lm4+MClpcm9uPXtjdXQ6Ljk1LHJhdGU6cm93LnJhdGUsbG86cm93LmxvLG46cm93Lm4scGVyRGF5OmRheXM/cm93Lm4vZGF5czowLGxvd046cm93Lm48MTAwfTt9CiByZXMuaXJvbj1pcm9uOwogcmVzLm1vZGVsPWFkb3B0P3t2ZXI6MixraW5kOiJuZXciLGV4dDp1c2VFeHQsbW9kZWwsaXJvbixhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0RGF5czpyZXMudGVzdERheXMsdGVzdFN0YXJ0OlRFU1QsaG9sZUN1dHM6cmVzLmhvbGUuY3V0cyxob2xlU3RhdHM6e3RhYjpyZXMuaG9sZS50YWIscmFuazpyZXMuaG9sZS5yYW5rLGJhc2VSYXRlOnJlcy5ob2xlLmJhc2VSYXRlfSwKICBtTmV3OnJlcy5tTmV3LG1QUDpyZXMubVBQLG1NazpyZXMubU1rLG1PZGRzOnJlcy5tT2Rkc3x8bnVsbCxtTmV3T2RkczpyZXMubU5ld09kZHN8fG51bGwsdGhyOnJlcy50aHJ9Om51bGw7CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiBwbGFjZVJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CCMemgreOBlOOBqOOBq+OAjDPnnYDku6XlhoXjgI3jgpLlvZPjgabjgZ/miJDnuL7jgafjgZnvvIg46aCt5Lul5LiK44Gu44Os44O844K577yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PgogJHtyb3coIumBjuWOu+aIkOe4vuODouODh+ODq+OBruOBvyIsci5tUFApfSR7cm93KCLkurrmsJfpoIbkvY3jga7lrp/nuL7jga7jgb8iLHIubU1rKX0ke3JvdygiPGI+5paw77yI5Lih5pa544KS57WE44G/5ZCI44KP44Gb77yJPC9iPiIsci5tTmV3KX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGlmKHIubU9kZHMpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgaTjgY3jga7mpJzoqLzjg4fjg7zjgr8gJHtyLm5PZGRzVGVzdH3jg6zjg7zjgrnjgafjga7nm7TmjqXmr5TovIPvvJrnj77ooYzvvIjjgqrjg4Pjgrrovrzjgb/vvInjga7lr77mlbDmkI3lpLEgJHtmKHIubU9kZHMubGwpfSDvvI8g5pawICR7ZihyLm1OZXdPZGRzLmxsKX08L2Rpdj5gOwogZWxzZSBoKz1gPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44Kq44OD44K644Gk44GN44Gu5qSc6Ki844OH44O844K/44GM5bCR44Gq44GE44Gf44KB44CB54++6KGM44Gu44CM44Kq44OD44K66L6844G/44Gu56K6546H44CN44Go44Gu55u05o6l5q+U6LyD44Gv44Gn44GN44Gm44GE44G+44Gb44KT77yI5Lq65rCX6aCG5L2N44Gv44CB44Kq44OD44K65Y+W5b6X5b6M44Gr5rG644G+44KL5YCk44KS5L2/44Gj44Gm44GE44G+44GZ77yJ44CCPC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmFkb3B0PyJvayI6InduIn0iPjxiPue1kOaenO+8miR7ci5hZG9wdD8i5paw44Oi44OH44Or44KS5o6h55So77yI6YCx5pyr44Gu5LqI5oOz44Gu56K6546H44Gr5Y+N5pig77yJIjoi54++6KGM44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/44O75Lq65rCX6aCG5L2N44Gu44G/44Gu5Lih5pa544KI44KK44CB5a++5pWw5pCN5aSx44GMMC4wMDPku6XkuIroia/jgYTjgZPjgajjgIIke3IubU9kZHM/IuOBleOCieOBq+ePvuihjO+8iOOCquODg+OCuui+vOOBv++8ieOCiOOCiuiJr+OBhOOBk+OBqOOAgiI6IiJ9PC9zcGFuPjwvZGl2PmA7CiBoKz1leHRSZXBvcnQocik7CiBoKz1ob2xlUmVwb3J0KHIpOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7kuojmuKzjga7ljLrplpPjgZTjgajjga48Yj7lrp/pmpvjga7nmoTkuK3njoc8L2I+77yI5qSc6Ki85YG044CC5LqI5ris44Go5a6f6Zqb44GM6L+R44GE44G744Gp5q2j56K677yJPC9kaXY+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuS6iOa4rOOBruevhOWbsjwvdGg+PHRoPumgreaVsDwvdGg+PHRoPuS6iOa4rOOBruW5s+WdhzwvdGg+PHRoPuWun+mamzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGIgb2Ygci5iaW5zKWgrPWA8dHI+PHRkPiR7cGN0KGIubG8pfeOAnCR7cGN0KGIuaGkpfTwvdGQ+PHRkPiR7Yi5ufTwvdGQ+PHRkPiR7cGN0KGIubWVhbiwxKX08L3RkPjx0ZD48Yj4ke3BjdChiLmFjdCwxKX08L2I+PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7pq5jjgYTkuojmuKzjga7lrp/nuL7vvIjmpJzoqLzlgbTvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5risPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHQgb2Ygci50aHIpaCs9YDx0cj48dGQ+JHtwY3QodC50KX3ku6XkuIo8L3RkPjx0ZD4ke3Qubn08L3RkPjx0ZD4ke3IudGVzdERheXM/KHQubi9yLnRlc3REYXlzKS50b0ZpeGVkKDIpOiItIn3poK08L3RkPjx0ZD48Yj4ke3BjdCh0LnJhdGUsMSl9PC9iPjwvdGQ+PHRkPiR7cGN0KHQubG8sMSl944CcJHtwY3QodC5oaSwxKX08L3RkPjwvdHI+YDsKIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIGlmKHIuaXJvbiloKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxiPui2hemJhOadv++8iOS6iOa4rDk1JeS7peS4iuODu+mgreaVsOOBruWItumZkOOBquOBl++8ie+8mjwvYj7mpJzoqLzlgbTjgafjgIHlrp/pmpvjgaske3BjdChyLmlyb24ucmF0ZSwxKX3jgYwz552A5Lul5YaF77yIJHtyLmlyb24ubn3poK3jgIE5NSXjga7luYUgJHtwY3Qoci5pcm9uLmxvLDEpfeOAnCR7cGN0KHIuaXJvbi5oaSwxKX3jgIEx5pel44GC44Gf44KK57SEJHtyLmlyb24ucGVyRGF5LnRvRml4ZWQoMil96aCtJHtyLmlyb24ubG93Tj8i44CC6aCt5pWw44GM5bCR44Gq44KB44Gn5bmF44GM5bqD44GEIjoiIn3vvInjgIIke3IuaXJvbi5yYXRlPj0uOTU/IiI6IjxzcGFuIGNsYXNzPVwid2FyblwiPjk1JeOBq+OBr+WxiuOBhOOBpuOBhOOBvuOBm+OCk+OAgjwvc3Bhbj4ifTwvZGl2PmA7CiBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7mpJzoqLzlgbTjgavjgIHkuojmuKw5NSXku6XkuIrjga7ppqzjga/jgYTjgb7jgZvjgpPjgafjgZfjgZ/vvIjotoXpiYTmnb/jga/lh7rjgarjgYTjgIHjgb7jgZ/jga/lh7rjgabjgoLjgZTjgY/lsJHmlbDjgafjgZnvvInjgII8L2Rpdj4nOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gZXh0UmVwb3J0KHIpewogaWYoIXIubUV4dClyZXR1cm4iIjsKIGNvbnN0IGY9eD0+eC50b0ZpeGVkKDQpLGN2PXIuY292fHx7fTsKIGxldCBoPWA8aDM+6L+95Yqg44Gu5p2h5Lu277yI6aas5aC054q25oWL44O75p6g6aCG44O76Kq/5pWZ5bir44O76KGA57Wx77yJ44Gu5Yq55p6cPC9oMz48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+QVVD4oaRPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pjx0cj48dGQ+6L+95Yqg44Gu5p2h5Lu244Gq44GXPC90ZD48dGQ+JHtmKHIubUJhc2UubGwpfTwvdGQ+PHRkPiR7ci5tQmFzZS5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+PHRyPjx0ZD7ov73liqDjga7mnaHku7bjgYLjgoo8L3RkPjx0ZD4ke2Yoci5tRXh0LmxsKX08L3RkPjx0ZD4ke3IubUV4dC5hdWMudG9GaXhlZCgzKX08L3RkPjwvdHI+PC90Ym9keT48L3RhYmxlPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0iYmFubmVyICR7ci51c2VFeHQ/Im9rIjoid24ifSI+PGI+JHtyLnVzZUV4dD8i6L+95Yqg44Gu5p2h5Lu244KS5L2/44GG44Go5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Gf44KB44CB5o6h55So44GX44G+44GX44Gf44CCIjoi6L+95Yqg44Gu5p2h5Lu244KS5Yqg44GI44Gm44KC44CB5piO56K644Gq5pS55ZaE77yI5a++5pWw5pCN5aSxMC4wMDHku6XkuIrvvInjga/jgarjgYvjgaPjgZ/jgZ/jgoHjgIHkvb/jgaPjgabjgYTjgb7jgZvjgpPjgIIifTwvYj48L2Rpdj5gOwogaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jg4fjg7zjgr/jga7lhYXotrPnjofvvIjlrabnv5Ljg7vmpJzoqLzlhajkvZPvvInvvJrppqzloLTnirbmhYvjgYzliIbjgYvjgovjg6zjg7zjgrkgJHtwY3QoY3YuZ29pbmdTaGFyZXx8MCwwKX3vvI/oqr/mlZnluKvjgYzliIbjgYvjgovppqwgJHtwY3QoY3YudHJhaW5lclNoYXJlfHwwLDApfe+8j+ihgOe1seOBjOWIhuOBi+OCi+mmrCAke3BjdChjdi5zaXJlU2hhcmV8fDAsMCl977yI6JOE56mN44GX44Gf6KGA57WxICR7Y3YucGVkSG9yc2VzfHwwfemgre+8ieOAgiR7KGN2LmdvaW5nU2hhcmV8fDApPC4zPyLppqzloLTnirbmhYvjga/jgIHoqK3lrprjga7jgIzjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfjgI3jgafjgIHpgY7ljrvjga7miJDnuL7jgpLlj5bjgornm7TjgZnjgajlopfjgYjjgb7jgZnjgIIiOiIifSR7KGN2LnNpcmVTaGFyZXx8MCk8LjM/IiDooYDntbHjga/jgIHmr47pgLHjga7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgI3jgaflh7rppqzooajjgYvjgonlsJHjgZfjgZrjgaTok4TnqY3jgZXjgozjgb7jgZnjgIIiOiIifTwvZGl2PmA7CiByZXR1cm4gaDsKfQpmdW5jdGlvbiBob2xlUmVwb3J0KHIpewogY29uc3QgSD1yLmhvbGU7aWYoIUh8fCFILm5Ib2xlKXJldHVybiIiOwogY29uc3Qgcm9pPXg9Pngucm9pPT1udWxsPyItIjpwY3QoeC5yb2ksMCk7CiBsZXQgaD1gPGgzPueptOmmrO+8iOS6uuawl+OBruS4i+S9je+8ieOBp+OBruaIkOe4vu+8iOaknOiovOWBtO+8iTwvaDM+PGRpdiBjbGFzcz0ic21hbGwiPueptOmmrO+8neS6uuawl+mghuS9jeOBjCBtYXgoNSwg6aCt5pWw44GuNDAlKeS7peS4i+OBrummrOOAguaknOiovOWBtOOBrueptOmmrCAke0gubkhvbGV96aCt44Gu5bmz5Z2H55qE5Lit546H44GvICR7cGN0KEguYmFzZVJhdGUsMSl944CB5paw44Oi44OH44Or44Gu5LqI5ris44Gu6K2Y5Yil5Yqb77yIQVVD77yJ44GvICR7SC5hdWMudG9GaXhlZCgzKX3jgILoqZXkvqHjga/jgIHlrabnv5LlgbTjga7nqbTppqzjga7kuojmuKznorrnjofjga7kuIrkvY00Je+8nVPjgIExMiXvvJ1B44CBMzAl77ydQuOAgeOBneOCjOS7peWklu+8nUMg44Gn5Yy65YiH44KK44G+44GX44Gf77yIU++8muS6iOa4rCR7cGN0KEguY3V0cy5TLDEpfeS7peS4iuOAgUHvvJoke3BjdChILmN1dHMuQSwxKX3ku6XkuIrjgIFC77yaJHtwY3QoSC5jdXRzLkIsMSl95Lul5LiK77yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+6KmV5L6hPC90aD48dGg+6aCt5pWwPC90aD48dGg+MeaXpeOBguOBn+OCijwvdGg+PHRoPuWun+mam+OBrueahOS4reeOhzwvdGg+PHRoPjk1JeOBruW5hTwvdGg+PHRoPuikh+WLneWbnuWPjueOhzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IGcgb2YgWyJTIiwiQSIsIkIiLCJDIl0pe2NvbnN0IHg9SC50YWJbZ107aCs9YDx0cj48dGQ+PGI+JHtnfTwvYj48L3RkPjx0ZD4ke3gubn08L3RkPjx0ZD4ke3gucGVyRGF5LnRvRml4ZWQoMSl96aCtPC90ZD48dGQ+PGI+JHtwY3QoeC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh4LmxvLDEpfeOAnCR7cGN0KHguaGksMSl9PC90ZD48dGQ+JHtyb2koeCl9PC90ZD48L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7jg6zjg7zjgrnjgZTjgajjgavjgIHnqbTppqzjga7kuK3jgYvjgonkuIrkvY3jgpLpgbjjgpPjgaDjgajjgY3jga7miJDnuL7vvIjnmoTkuK3njofvvI/opIfli53lm57lj47njofvvInjgILjgIzmlrDjg6Ljg4fjg6vjgI3jgYzjgIHku5bjga7pgbjjgbPmlrnjgojjgorpq5jjgYTjgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7pgbjjgbPmlrk8L3RoPjx0aD4x6aCt44Gg44GRPC90aD48dGg+5LiK5L2NMumgrTwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IFtrLGxdIG9mIFtbIm5ldyIsIuaWsOODouODh+ODq+OBrueiuueOh+OBjOmrmOOBhOmghiJdLFsicFAiLCLpgY7ljrvmiJDnuL7jg6Ljg4fjg6vjga7jgb8iXSxbIm1rdCIsIuS6uuawl+OBjOmrmOOBhOmghu+8iOW4guWgtO+8iSJdXSl7Y29uc3QgYT1ILnJhbmtba10udDEsYj1ILnJhbmtba10udDI7aCs9YDx0cj48dGQ+JHtsfTwvdGQ+PHRkPiR7cGN0KGEucmF0ZSwxKX0g77yPICR7cm9pKGEpfTwvdGQ+PHRkPiR7cGN0KGIucmF0ZSwxKX0g77yPICR7cm9pKGIpfTwvdGQ+PC90cj5gfQogaCs9YDwvdGJvZHk+PC90YWJsZT48L2Rpdj4ke0gudGFiLlMucGI9PT0wPyc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzlj5blvpfjgafjgY3jgabjgYTjgarjgYTjgZ/jgoHjgIHlm57lj47njofjga/lh7rjgZvjgabjgYTjgb7jgZvjgpPvvIjjgIzpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgI3jgafmiZXmiLvjgoLlj5blvpfjgZXjgozjgb7jgZnvvInjgII8L2Rpdj4nOic8ZGl2IGNsYXNzPSJzbWFsbCI+5Zue5Y+O546H44Gv44CBMTAw5YaG44Ga44Gk6KSH5Yud44KS6LK344Gj44Gf5aC05ZCI44Gn44GZ44CCMTAwJeOCkui2heOBiOOCi+iyt+OBhOaWueOBr+OAgeOBvuOBoOeiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvZGl2Pid9YDsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBsYWNlU3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRQbGFjZU1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8muaomea6luODouODh+ODq+OBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8mjxiPuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqzwvYj7jgafooajnpLrkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgabjgYLjgorjgb7jgZnvvInjgII8L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Oi44OH44Or44Gu54q25oWL44Gu6KaL44GI44KL5YyW44Go44CB5pON5L2c44Gu44G+44Go44KBCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KbGV0IERBVEFfTEFTVD0iIjsKYXN5bmMgZnVuY3Rpb24gcmVmcmVzaERhdGFMYXN0KCl7dHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2xldCBtPSIiO2Zvcihjb25zdCBmIG9mIGZzKWlmKGYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCYmZi5kYXRlPm0pbT1mLmRhdGU7REFUQV9MQVNUPW19Y2F0Y2goZSl7fX0KY29uc3QgZGF5c0JldHdlZW49KGEsYik9Pk1hdGgucm91bmQoKG5ldyBEYXRlKGIrIlQwMDowMDowMFoiKS1uZXcgRGF0ZShhKyJUMDA6MDA6MDBaIikpLzg2NGU1KTsKY29uc3QgS0lORF9OQU1FPXtvbGQ6Iuaomea6luODouODh+ODq+OBruOBvuOBviIsbmV3OiLlho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6siLGJsZW5kOiLmqJnmupbjgajmlrDjg6Ljg4fjg6vjga7lubPlnYcifTsKLyog5LuK5L2/44Gj44Gm44GE44KL44Oi44OH44Or44Go44CB5YaN5qSc6Ki844Gu55uu5a6J77yI5qSc6Ki844GL44KJMzXml6Xku6XkuIrjgIHjgb7jgZ/jga/mpJzoqLzlvozjgavmiJDnuL7jgYwxNOaXpeWIhuS7peS4iuWil+OBiOOBn+OCieaPkOahiO+8iSAqLwpmdW5jdGlvbiBtb2RlbFN0YXR1c0h0bWwoKXsKIGNvbnN0IHRvZGF5PWpzdFRvZGF5KCksUE09Z2V0UGxhY2VNb2RlbCgpLFVNPWdldFVwc2V0TW9kZWwoKSxHPWdldEdhdGUoKTsKIGNvbnN0IHJvdz0obmFtZSxzdGF0ZSxkZXRhaWwsYWR2aWNlKT0+YDx0cj48dGQ+PGI+JHtuYW1lfTwvYj48L3RkPjx0ZD4ke3N0YXRlfTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtkZXRhaWx9JHthZHZpY2U/YDxicj48c3BhbiBjbGFzcz0id2FybiI+JHthZHZpY2V9PC9zcGFuPmA6IiJ9PC90ZD48L3RyPmA7CiBjb25zdCBzdGFsZT0oYXQpPT57aWYoIWF0KXJldHVybiIiO2NvbnN0IGQ9ZGF5c0JldHdlZW4oYXQsdG9kYXkpLGdhcD1EQVRBX0xBU1Q/ZGF5c0JldHdlZW4oYXQsREFUQV9MQVNUKTowO3JldHVybihkPj0zNXx8Z2FwPj0xNCk/YOaknOiovOOBi+OCiSR7ZH3ml6XvvIjjgZ3jga7lvozjga7miJDnuL4g57SEJHtNYXRoLm1heCgwLGdhcCl95pel5YiG77yJ44CC5YaN5qSc6Ki844KS44GK44GZ44GZ44KB44GX44G+44GZ44CCYDoiIn07CiBjb25zdCByb3dzPVtdOwogcm93cy5wdXNoKHJvdygi5aW96LWw546HIixQTT9g5YaN5qCh5q2j5riI44G/JHtQTS5leHQ/Iu+8iOi/veWKoOOBruadoeS7tuOBguOCiu+8iSI6IiJ9YDoi5qiZ5rqWIixQTT9g5qSc6Ki85pelICR7ZXNjKFBNLmF0KX3vvI/mpJzoqLwgJHtQTS5uVGVzdH3jg6zjg7zjgrnvvI/lr77mlbDmkI3lpLEgJHtQTS5tUFA/UE0ubVBQLmxsLnRvRml4ZWQoNCk6Ii0ife+8iOmBjuWOu+aIkOe4vuOBruOBv++8ieKGkiAke1BNLm1OZXc/UE0ubU5ldy5sbC50b0ZpeGVkKDQpOiItIn3vvIjmlrDvvIlgOiLjgIzmpJzoqLzjgI3jgr/jg5bjga7jgIzlpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraPjgI3jgafjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgonjgozjgb7jgZnjgIIiLFBNP3N0YWxlKFBNLmF0KToiIikpOwogcm93cy5wdXNoKHJvdygi5rOi5Lmx5bqmIixVTT9gJHtLSU5EX05BTUVbVU0ua2luZF18fFVNLmtpbmR9JHtVTS5zaW0/Iu+8iOW4guWgtOi+vOOBv++8iSI6IiJ9JHtVTS5wYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIifWA6Iuaomea6liIsVU0/YOaknOiovOaXpSAke2VzYyhVTS5hdCl977yP5qSc6Ki8ICR7VU0ublRlc3R944Os44O844K577yP5a++5pWw5pCN5aSxICR7VU0ubTA/VU0ubTAubGwudG9GaXhlZCg0KToiLSJ977yI5qiZ5rqW77yJ4oaSICR7VU0ua2luZD09PSJvbGQiPyhVTS5tMD9VTS5tMC5sbC50b0ZpeGVkKDQpOiItIik6KFVNLm1OP1VNLm1OLmxsLnRvRml4ZWQoNCk6Ii0iKX1gOiLjgIzmpJzoqLzjgI3jgr/jg5bjga7jgIzms6LkubHluqbjgpLmpJzoqLzjg7vlho3moKHmraPjgI3jgafjgIHlrp/pmpvjga7ms6LkubHnjofjgavlkIjjgo/jgZvjgonjgozjgb7jgZnjgIIiLFVNP3N0YWxlKFVNLmF0KToiIikpOwogY29uc3Qgb2s9RyYmRy5pdGVtcy5maWx0ZXIoeD0+eC5sb3c+PTEmJnguYmV0cz49MzAwKTsKIHJvd3MucHVzaChyb3coIuWbnuWPjueOhyIsRz8ob2smJm9rLmxlbmd0aD8iMTAwJei2heOBruiyt+OBhOaWueOBguOCiiI6IjEwMCXotoXjga/mnKrnorroqo0iKToi5pyq5qSc6Ki8IixHP2DmnIDntYLmpJzoqLwgJHtlc2MoRy5hdCl9JHtvayYmb2subGVuZ3RoPyLvvJoiK29rLm1hcCh4PT5lc2MoeC5sYWJlbCkpLmpvaW4oIuOAgSIpOiIifWA6IuOAjOaknOiovOOCkuWun+ihjOOAjeOBp+OAgeiyt+OBhOaWueOBlOOBqOOBruikh+WLneWbnuWPjueOh+OCkueiuuiqjeOBp+OBjeOBvuOBmeOAgiIsRz9zdGFsZShHLmF0KToiIikpOwogY29uc3QgZ2FwPURBVEFfTEFTVD9kYXlzQmV0d2VlbihEQVRBX0xBU1QsdG9kYXkpOm51bGw7CiByb3dzLnB1c2gocm93KCLjg4fjg7zjgr8iLERBVEFfTEFTVD9g5oiQ57i+44Gu5pyA57WC5pelICR7ZXNjKERBVEFfTEFTVCl9YDoi5pyq5Y+W5b6XIixg6JOE56mN44GX44Gf6KGA57WxICR7T2JqZWN0LmtleXMoUEVEKS5sZW5ndGh96aCtYCxnYXAhPW51bGwmJmdhcD4xMD9g5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgmA6IiIpKTsKIHJldHVybmA8dGFibGU+PHRoZWFkPjx0cj48dGg+6aCF55uuPC90aD48dGg+54q25oWLPC90aD48dGg+6Kmz57SwPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7cm93cy5qb2luKCIiKX08L3Rib2R5PjwvdGFibGU+YDsKfQpmdW5jdGlvbiByZW5kZXJNb2RlbFN0YXR1cygpe2NvbnN0IGVsPSQoIm1zdGF0Iik7aWYoZWwpZWwuaW5uZXJIVE1MPW1vZGVsU3RhdHVzSHRtbCgpfQoKLyog4pGjIOOBnOOCk+OBtuOBiuOBvuOBi+OBm++8mumBjuWOu+ODrOODvOOCueOBruabtOaWsCDihpIg5LuK6YCx5pyr44Gu5Y+W5b6X44Go5LqI5oOzIOKGkiDjg5Djg4Pjgq/jgqLjg4Pjg5cgKi8KYXN5bmMgZnVuY3Rpb24gYWxsSW5PbmUoKXsKIGNvbnN0IG1zZz10PT57JCgiYWxsU3RhdHVzIikudGV4dENvbnRlbnQ9dH0sdDA9RGF0ZS5ub3coKTsKICQoImFsbEdvIikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXsKICBTU1RPUD1mYWxzZTttc2coIjEvMyDpgY7ljrvjg6zjg7zjgrnjgpLmm7TmlrDkuK3igKbvvIjikaHvvIkiKTthd2FpdCBQcm9taXNlLnJlc29sdmUoJCgic3luY0dvIikub25jbGljaygpKTsKICBpZihTU1RPUCl7bXNnKCLikaHjgYzlgZzmraLjgZXjgozjgZ/jgZ/jgoHjgIHkuK3mlq3jgZfjgb7jgZfjgZ/jgIIiKTtyZXR1cm59CiAgbXNnKCIyLzMg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz5Lit4oCm77yI4pGg77yJIik7YXdhaXQgd2Vla2VuZEdvKCk7CiAgbGV0IGJrTm90ZT0iIjsKICBpZihCSy5wYXNzJiZCSy5wYXNzLmxlbmd0aD49OCl7bXNnKCIzLzMg44OQ44OD44Kv44Ki44OD44OX5Lit4oCm77yI4pGi77yJIik7YXdhaXQgcnVuQmFja3VwKGZhbHNlKX0KICBlbHNlIGJrTm90ZT0i44OQ44OD44Kv44Ki44OD44OX44Gv44CB44OR44K544OV44Os44O844K644GM5pyq6Kit5a6a44Gu44Gf44KB6KGM44Gj44Gm44GE44G+44Gb44KT77yI6Kit5a6a44K/44OW44Gn6Kit5a6a44Gn44GN44G+44GZ77yJ44CCIjsKICBhd2FpdCByZWZyZXNoRGF0YUxhc3QoKTtyZW5kZXJNb2RlbFN0YXR1cygpOwogIGNvbnN0IHM9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS10MCkvMTAwMCk7CiAgbXNnKGDlrozkuobvvIgke01hdGguZmxvb3Iocy82MCl95YiGJHtzJTYwfeenku+8ieOAgiR7YmtOb3RlfWApOwogfWNhdGNoKGUpe21zZygi44Ko44Op44O877yaIisoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5eyQoImFsbEdvIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KLyog5qSc6Ki844KS44G+44Go44KB44Gm5a6f6KGM77ya5aW96LWw546HIOKGkiDms6LkubHluqYg4oaSIOWbnuWPjueOh++8iOWFseacieOCreODo+ODg+OCt+ODpeOBpzLjgaTnm67ku6XpmY3jga/pgJ/jgYTvvIkgKi8KYXN5bmMgZnVuY3Rpb24gYWxsRml0KCl7CiBjb25zdCBtc2c9dD0+eyQoImFsbEZpdFN0YXR1cyIpLnRleHRDb250ZW50PXR9OwogJCgiYWxsRml0IikuZGlzYWJsZWQ9dHJ1ZTsKIHRyeXsKICBtc2coIjEvMyDlpb3otbDnjofjgpLmpJzoqLzjg7vlho3moKHmraPkuK3igKYiKTthd2FpdCBQcm9taXNlLnJlc29sdmUoJCgicGxSdW4iKS5vbmNsaWNrKCkpOwogIG1zZygiMi8zIOazouS5seW6puOCkuaknOiovOODu+WGjeagoeato+S4reKApiIpO2F3YWl0IFByb21pc2UucmVzb2x2ZSgkKCJ1cFJ1biIpLm9uY2xpY2soKSk7CiAgbXNnKCIzLzMg5Zue5Y+O546H44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgUHJvbWlzZS5yZXNvbHZlKCQoImJ0UnVuIikub25jbGljaygpKTsKICBhd2FpdCByZWZyZXNoRGF0YUxhc3QoKTtyZW5kZXJNb2RlbFN0YXR1cygpO21zZygi5a6M5LqG44GX44G+44GX44Gf44CC5LiL44Gu5ZCE57WQ5p6c44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCIik7CiB9Y2F0Y2goZSl7bXNnKCLjgqjjg6njg7zvvJoiKyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7JCgiYWxsRml0IikuZGlzYWJsZWQ9ZmFsc2V9Cn0KCi8qIOWGjeagoeato+OBrue1kOaenO+8iGxvY2FsU3RvcmFnZe+8ieOCkuOAgeODkOODg+OCr+OCouODg+ODl+WvvuixoeOBruS/neWtmOmgmOWfn++8iOODoeOCv++8ieOBq+OCguWGmeOBl+OBpuOBiuOBj+OAguODluODqeOCpuOCtuOBruODh+ODvOOCv+OCkua2iOOBl+OBpuOCguOAgeODkOODg+OCr+OCouODg+ODl+OBi+OCieaIu+OBm+OCiyAqLwphc3luYyBmdW5jdGlvbiBtb2RlbHNUb01ldGEoZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe21ldGFQdXR9LGRlcHN8fHt9KTsKIHRyeXthd2FpdCBELm1ldGFQdXQoIm1vZGVscyIse3BsOmxvY2FsU3RvcmFnZS5nZXRJdGVtKFBMS0VZKSx1cDpsb2NhbFN0b3JhZ2UuZ2V0SXRlbShVUEtFWSksZ2F0ZTpsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl9KX1jYXRjaChlKXt9Cn0KYXN5bmMgZnVuY3Rpb24gbW9kZWxzRnJvbU1ldGEoZGVwcyl7CiBjb25zdCBEPU9iamVjdC5hc3NpZ24oe21ldGFHZXR9LGRlcHN8fHt9KTsKIHRyeXtjb25zdCBtPWF3YWl0IEQubWV0YUdldCgibW9kZWxzIik7aWYoIW0pcmV0dXJuIDA7bGV0IG49MDsKICBmb3IoY29uc3QgW2ssa2V5XSBvZiBbWyJwbCIsUExLRVldLFsidXAiLFVQS0VZXSxbImdhdGUiLEdBVEVfS0VZXV0paWYobVtrXSYmIWxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkpe2xvY2FsU3RvcmFnZS5zZXRJdGVtKGtleSxtW2tdKTtuKyt9CiAgcmV0dXJuIG59Y2F0Y2goZSl7cmV0dXJuIDB9Cn0KCgovKiAtLS0tLS0tLS0tIOS/neWtmOODh+ODvOOCv+OBrueKtuazgSAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPumBjuWOu+ODh+ODvOOCv+OBr+acquWPluW+l+OBp+OBmeOAguOAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgYvjgonjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IG5BbGw9MCxuVHI9MDtmb3IoY29uc3QgZiBvZiBsaXZlKWZvcihjb25zdCByIG9mIGYucm93cyl7bkFsbCsrO2lmKHIudHJhaW5lciluVHIrK30KICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OXQ1NW77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICBpZihuQWxsKWgrPWBcbuiqv+aVmeW4q+OBpOOBjeOBruaIkOe4vu+8miR7TWF0aC5yb3VuZChuVHIvbkFsbCoxMDApfSUke25Ucj09PTA/Iu+8iOOBk+OCjOOBi+OCieWPluW+l+OBmeOCi+aIkOe4vuOBq+WFpeOCiuOBvuOBme+8iSI6IiJ9YDsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KCi8qIC0tLS0tLS0tLS0g5Y+W5b6X44GX44Gf6KGMIOKGkiDlhoXpg6jjga7ooYzvvIjoqr/mlZnluKvjg7vjgrDjg6zjg7zjg4nku5jjgY3vvIkgLS0tLS0tLS0tLSAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwsCiAgcG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoeC50cmFpbmVyKSwKICByYWNlTmFtZTpTdHJpbmcoeC5yYWNlTmFtZXx8IiIpLGdjOmdvaW5nQ2F0KGdvaW5nQ29kZSh4LmdvaW5nKSksdmVudWU6dmVudWVGcm9tSWQoeC5yYWNlSWQpLAogIGx2bDooeC52ZW51ZUNvZGUmJiEvXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoeC52ZW51ZUNvZGUpKSk/LTE6KFVFLmxldmVsT2ZMYWJlbCh4LmNscyl8fFVFLmxldmVsT2ZQcml6ZSh4LnByaXplKSksCiAgZ3JkOlVFLmdyYWRlVGllcigoeC5jbHN8fCIiKSsiICIrKHguZ3JhZGV8fCIiKSx4LnByaXplLGZhbHNlKSwKICBjb3JuZXI6QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD94LmNvcm5lcjpudWxsLGxhcDpBcnJheS5pc0FycmF5KHgubGFwKSYmeC5sYXAubGVuZ3RoP3gubGFwOm51bGx9fQoKLyog5a++6LGh5pel44KI44KK5YmN44Gu5bGl5q2044Gg44GR44Gn44K544OI44Ki44KS5L2c44KL77yI6aiO5omL44O76Kq/5pWZ5bir44Gu5oiQ57i+44KC5ZCM5pmC44Gr6ZuG6KiI77yJICovCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkU3RvcmUodGFyZ2V0KXsKIGlmKFNUT1JFJiZTVE9SRV9LRVk9PT10YXJnZXQpcmV0dXJuIFNUT1JFOwogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7aWYoIWZzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIumBjuWOu+ODh+ODvOOCv+OBjOacqueZu+mMsuOBp+OBmeOAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZnjgYvjgIHoqK3lrprjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLlvqnlhYPjgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO3N0LnRyPW5ldyBNYXAoKTtsZXQgdXNlZD0wO2NvbnN0IEFHPW5ldyBNYXAoKSxkcmF3PW5ldyBEcmF3UHJpKCksc2lyZT1uZXcgU2lyZVByaSgpOwogY29uc3QgdGFrZT1yPT57aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKXJldHVybjthZ2dBZGQoQUcscik7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlOwogIGNvbnN0IHQzPXIuZmluaXNoIT1udWxsJiZyLmZpbmlzaDw9Mz8xOjA7CiAgaWYoci50cmFpbmVyJiZyLmZpbmlzaCE9bnVsbCl7bGV0IHQ9c3QudHIuZ2V0KHIudHJhaW5lcik7aWYoIXQpc3QudHIuc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO3QudDMrPXQzfQogIGlmKHIuZmluaXNoIT1udWxsJiZyLk4pe2NvbnN0IHY9ci52ZW51ZXx8dmVudWVGcm9tSWQoci5yYWNlSWQpO2RyYXcuYWRkKHYsci5zdXJmLHIuZGlzdCxyLm51bSxyLk4sdDMpO3NpcmUuYWRkKFBFRFtyLmhvcnNlXSxyLnN1cmYsci5kaXN0LHQzLHIuTil9fTsKIGNvbnN0IHByZXA9cm93cz0+e2NvbnN0IGNudD17fTtmb3IoY29uc3QgciBvZiByb3dzKWlmKHIuZmluaXNoIT1udWxsKWNudFtyLnJhY2VJZF09KGNudFtyLnJhY2VJZF18fDApKzE7Zm9yKGNvbnN0IHIgb2Ygcm93cyl7ci5OPWNudFtyLnJhY2VJZF18fDA7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHIuTik7dGFrZShyKX19OwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXByZXAoKGZzW2ldLnJvd3N8fFtdKS5tYXAobGl2ZVJvdykpOwogIGVsc2UgcHJlcChVRS5jc3ZSb3dzKGZzW2ldLmNzdikubWFwKFVFLnRvUm93KSk7CiAgYXdhaXQgc2xlZXAoMCk7CiB9CiBjb25zdCBwcmk9bmV3IFVwUHJpKCkscHA9bmV3IFBvcFByaSgpO2Zvcihjb25zdCBhIG9mIEFHLnZhbHVlcygpKXtwcmkuYWRkKGFnZ0luZm8oYSkpO2lmKGEuTj49NiYmYS5wZi5sZW5ndGg9PT1hLk4mJiFhLmp1bXApcHAuYWRkKGEucGYsYS5OKX1zdC51cD1wcmk7c3QucHA9cHA7c3QuZHJhdz1kcmF3O3N0LnNpcmU9c2lyZTsKIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7c3QuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIOWHuummrOihqOOBrjHjg6zjg7zjgrkg4oaSIOino+aekOeUqOOBruODrOODvOOCuSAqLwpmdW5jdGlvbiBta1JhY2UoYyxkKXsKIGNvbnN0IGhzPWMuaG9yc2VzfHxjLnJ1bm5lcnN8fFtdOwogY29uc3QgZ3Q9KGMuY2xhc3NOYW1lfHwiIikrIiAiKyhjLmdyYWRlfHwiIikrIiAiKyhjLnJhY2VOYW1lfHwiIik7CiBjb25zdCBncmQ9VUUuZ3JhZGVUaWVyKGd0LGMucHJpemUsdHJ1ZSk7CiByZXR1cm57ZGF0ZTpkLHN1cmY6VUUuc3VyZkNvZGUoYy5zdXJmYWNlKSxkaXN0Ok51bWJlcihjLmRpc3RhbmNlKXx8MCwKICBsdmw6VUUubGV2ZWxPZkxhYmVsKGMuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKGMucmFjZU5hbWUpfHwoZ3JkPj0xPzU6MCksZ3JkLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjsKICAgcmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoaC50cmFpbmVyfHwiIiksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pCiAgIC5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOS7iumAseacq+OBruWPluW+lwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFdLPXtkYXRlczpbXSxjYXJkczp7fSxvZGRzOnt9LG9kZHNOb3Rlczp7fSxkaWFnOltdLGNhbGM6e30sYXQ6IiIsc3RvcmVJbmZvOm51bGx9Owpjb25zdCBya2V5PShkLGMpPT5gJHtkfXwke1N0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MH1gOwpjb25zdCB3a01zZz10PT57JCgid2tTdGF0dXMiKS50ZXh0Q29udGVudD10fTsKY29uc3QgYmFzZVVybD0oKT0+JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwpmdW5jdGlvbiBuZXh0V2Vla2VuZCh0b2RheSl7Y29uc3Qgb3V0PVtdO2NvbnN0IHQ9bmV3IERhdGUodG9kYXkrIlQwMDowMDowMFoiKS5nZXRUaW1lKCk7CiBmb3IobGV0IGk9MDtpPDgmJm91dC5sZW5ndGg8MjtpKyspe2NvbnN0IGQ9bmV3IERhdGUodCtpKjg2NGU1KSx3PWQuZ2V0VVRDRGF5KCk7aWYodz09PTZ8fHc9PT0wKW91dC5wdXNoKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSl9cmV0dXJuIG91dH0KCmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSl9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KCi8qIDHplovlgqzloLTjgbbjgpPjga7lh7rppqzooajjgILmrKDjgZHjg7vlpLHmlZfjgYzjgYLjgozjgbDjgIHoh6rli5Xjgacx5Zue44Gg44GR44KE44KK55u044GZICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsaXNSZXRyeSl7CiBjb25zdCBjb2RlPVN0cmluZyh2LnZlbnVlQ29kZSk7CiBXSy5jYXJkc1tkXT0oV0suY2FyZHNbZF18fFtdKS5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlKSE9PWNvZGUpOwogV0suZGlhZz1XSy5kaWFnLmZpbHRlcih4PT4hKHguZD09PWQmJnguY29kZT09PWNvZGUpKTsKIHRyeXsKICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLGNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksYmFkPXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV0suY2FyZHNbZF0ucHVzaCguLi5vayk7CiAgY29uc3QgaXNzdWVzPW9rLmZpbHRlcihjPT5jLnF1YWxpdHkmJiFjLnF1YWxpdHkub2spLm1hcChjPT5gJHtjLnJhY2VOdW1iZXJ9Uu+8miR7Yy5xdWFsaXR5Lmlzc3Vlcy5qb2luKCLjg7siKX1gKTsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczpyYWNlcy5sZW5ndGgsb2s6b2subGVuZ3RoLGJhZCxpc3N1ZXMsZXJyOiFyYWNlcy5sZW5ndGg/IuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyI6IiJ9KTsKICBpZigoYmFkPjB8fG9rLmxlbmd0aDw4KSYmIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDgwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Y2F0Y2goZSl7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7CiAgaWYoIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDEyMDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfQp9CgovKiDjgqrjg4PjgrrvvIjljZjli53vvIvopIfli53vvInjgILlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqUg4oaSIOWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOBr+OAgeaXpeS7mOODu+mWi+WCrOWgtOOBruODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhiAqLwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHNEYXRlKGJhc2UsZCl7CiBjb25zdCBjYXJkcz1XSy5jYXJkc1tkXXx8W10sbm90ZXM9W107V0sub2Rkc05vdGVzPVdLLm9kZHNOb3Rlc3x8e307CiBpZighY2FyZHMubGVuZ3RoKXtXSy5vZGRzTm90ZXNbZF09bm90ZXM7cmV0dXJue246MCxub3Rlc319CiBjb25zdCB3aXRoTGluaz1jYXJkcy5maWx0ZXIocj0+ci5vZGRzQ25hbWUpLGJ5Qz1uZXcgTWFwKHdpdGhMaW5rLm1hcChyPT5bci5vZGRzQ25hbWUscl0pKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHdpdGhMaW5rLmxlbmd0aDtpKz02KWNodW5rcy5wdXNoKHdpdGhMaW5rLnNsaWNlKGksaSs2KS5tYXAocj0+ci5vZGRzQ25hbWUpKTsKIGxldCBjaT0wLGZhaWxOPTA7Y29uc3QgcmVhc29ucz17fTsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoY2k8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1jaSsrOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IHI9YnlDLmdldChpdC5jbmFtZSk7aWYocilXSy5vZGRzW3JrZXkoZCxyKV09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKXtmYWlsTisrO2NvbnN0IG09U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX0KICB9Y2F0Y2goZSl7ZmFpbE4rPWNodW5rc1trXS5sZW5ndGg7Y29uc3QgbT1TdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiBjb25zdCBkaXJlY3Q9Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoOwogbm90ZXMucHVzaChg5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6l77yaJHtkaXJlY3R9LyR7Y2FyZHMubGVuZ3RofeODrOODvOOCue+8iOODquODs+OCr+OBguOCiiAke3dpdGhMaW5rLmxlbmd0aH3jgIHlpLHmlZcgJHtmYWlsTn3vvIlgKTsKIGZvcihjb25zdCBbbSxjXSBvZiBPYmplY3QuZW50cmllcyhyZWFzb25zKSlub3Rlcy5wdXNoKGDjgIDlpLHmlZfjga7nkIbnlLHvvJoke21977yIJHtjfe+8iWApOwogY29uc3QgbWlzc2luZz1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihtaXNzaW5nLmxlbmd0aCl7CiAgZm9yKGNvbnN0IHYgb2YgWy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKSl7CiAgIGNvbnN0IG5lZWQ9bmV3IFNldChtaXNzaW5nLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KS5tYXAocj0+TnVtYmVyKHIucmFjZU51bWJlcikpKTsKICAgdHJ5ewogICAgY29uc3QgTD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHMtbGlua3M/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBjb25zdCBhbGw9TC5saW5rc3x8W10sbGlua3M9YWxsLmZpbHRlcih4PT5uZWVkLmhhcyh4LnJhY2VObykpOwogICAgbm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977ya44Kq44OD44K655S76Z2i44GM44GC44KL44Os44O844K5ICR7YWxsLm1hcCh4PT54LnJhY2VObykuam9pbigiLCIpfHwi44Gq44GXIn3vvIjmnKrlj5blvpcke25lZWQuc2l6ZX3jg6zjg7zjgrnjga7jgYbjgaEke2xpbmtzLmxlbmd0aH3jg6zjg7zjgrnvvIlgKTsKICAgIGlmKCFhbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOAgOeZuuWjsuWJjeOBruWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAguiouuaWre+8miR7SlNPTi5zdHJpbmdpZnkoKEwuZGlhZ3x8W10pLm1hcCh4PT4oe3M6eC5zdGVwLGxlbjp4Lmh0bWxMZW5ndGgsbjp4LmNuYW1lcyxrOngua2luZHMsbTp4Lm1lbnVzLGU6eC5lcnJvcn0pKSkuc2xpY2UoMCwzNjApfWApOwogICAgY29uc3QgYnlDPW5ldyBNYXAobGlua3MubWFwKHg9Plt4LmNuYW1lLHgucmFjZU5vXSkpOwogICAgZm9yKGxldCBpPTA7aTxsaW5rcy5sZW5ndGg7aSs9NCl7CiAgICAgY29uc3QgY2g9bGlua3Muc2xpY2UoaSxpKzQpLm1hcCh4PT54LmNuYW1lKTsKICAgICB0cnl7CiAgICAgIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2NuYW1lcz0ke2NoLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgICAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCBubz1ieUMuZ2V0KGl0LmNuYW1lKTtpZihubylXSy5vZGRzW2Ake2R9fCR7dn0tJHtub31gXT17dGFuOml0Lm9kZHN8fHt9LHBsYWNlOml0LnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfX0KICAgICAgZm9yKGNvbnN0IGYgb2YgKHguZmFpbGVkfHxbXSkpbm90ZXMucHVzaChg44CA6Kqt44G/5Y+W44KM44Gq44GL44Gj44Gf77yaJHtWRU5VRVt2XXx8dn0ke2J5Qy5nZXQoZi5jbmFtZSl9Uu+8iCR7U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw1MCl977yJYCk7CiAgICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOOAgOWPluW+l+OCqOODqeODvCAke1ZFTlVFW3ZdfHx2fe+8miR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw3MCl9YCl9CiAgICB9CiAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjg6Hjg4vjg6Xjg7zntYznlLEgJHtWRU5VRVt2XXx8dn3vvJrlpLHmlZfvvIgke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsMTAwKX3vvIlgKX0KICB9CiB9CiBjb25zdCBzdGlsbD1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihzdGlsbC5sZW5ndGgpbm90ZXMucHVzaChg44Kq44OD44K65pyq5Y+W5b6X77yaJHtzdGlsbC5tYXAocj0+KHIudmVudWVOYW1lfHwiIikrci5yYWNlTnVtYmVyKyJSIikuam9pbigi44CBIil977yI55m65aOy5YmN44CB44G+44Gf44Gv6Kqt44G/5Y+W44KM44Gm44GE44G+44Gb44KT77yJYCk7CiBXSy5vZGRzTm90ZXNbZF09bm90ZXM7CiByZXR1cm57bjpjYXJkcy5maWx0ZXIocj0+V0sub2Rkc1tya2V5KGQscildKS5sZW5ndGgsbm90ZXN9Owp9CgpsZXQgT0REU19USU1FUj1udWxsLE9ERFNfVFJJRVM9MDsKZnVuY3Rpb24gb2Rkc01pc3NpbmcoKXtsZXQgbT0wLHQ9MDtmb3IoY29uc3QgZCBvZiBXSy5kYXRlcylmb3IoY29uc3QgYyBvZiBXSy5jYXJkc1tkXXx8W10pe3QrKztpZighV0sub2Rkc1tya2V5KGQsYyldKW0rK31yZXR1cm57bSx0fX0KLyog44Kq44OD44K644Gu5pyq5Y+W5b6X44GM5q6L44Gj44Gm44GE44Gm44CB5b2T5pel44Gu5pyd44Cc5aSV5pa544Gq44KJ44CBNeWIhuOBlOOBqOOBq+iHquWLleOBp+WPluOCiuebtOOBme+8iEpSQeOBr+mAmuW4uOOBruODrOODvOOCueOCkuW9k+aXpeacneOBq+eZuuWjsumWi+Wni+OBmeOCi+OBn+OCge+8iSAqLwpmdW5jdGlvbiBzY2hlZHVsZU9kZHNSZXRyeSgpewogaWYoT0REU19USU1FUil7Y2xlYXJUaW1lb3V0KE9ERFNfVElNRVIpO09ERFNfVElNRVI9bnVsbH0KIGNvbnN0IHttfT1vZGRzTWlzc2luZygpLGg9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykuZ2V0VVRDSG91cnMoKTsKIGlmKCFtfHxPRERTX1RSSUVTPj0zNnx8aDw2fHxoPj0xN3x8IVdLLmRhdGVzLmluY2x1ZGVzKGpzdFRvZGF5KCkpKXJldHVybiBmYWxzZTsKIE9ERFNfVFJJRVMrKztPRERTX1RJTUVSPXNldFRpbWVvdXQoKCk9PntPRERTX1RJTUVSPW51bGw7aWYoISQoIndrR28iKS5kaXNhYmxlZClvZGRzT25seSgpfSw1KjYwZTMpO3JldHVybiB0cnVlOwp9CmNvbnN0IG9kZHNIaW50PSgpPT57Y29uc3Qge219PW9kZHNNaXNzaW5nKCk7aWYoIW0pcmV0dXJuIiI7Y29uc3Qgc2NoPXNjaGVkdWxlT2Rkc1JldHJ5KCk7cmV0dXJuYFxu5pyq5Y+W5b6XICR7bX3jg6zjg7zjgrnvvJrnmbrlo7LliY3jga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnvvIhKUkHjga/pgJrluLjjga7jg6zjg7zjgrnjga7jgqrjg4PjgrrjgpLlvZPml6XmnJ3jgavnmbrlo7Lplovlp4vvvInjgIIke3NjaD8iNeWIhuOBlOOBqOOBq+iHquWLleOBp+WPluOCiuebtOOBl+OBvuOBmeOAgiI6IueZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiJ9YH07CmFzeW5jIGZ1bmN0aW9uIHdlZWtlbmRHbygpe09ERFNfVFJJRVM9MDsKIGNvbnN0IGJhc2U9YmFzZVVybCgpOyQoIndrR28iKS5kaXNhYmxlZD10cnVlOyQoIndrT2RkcyIpLmRpc2FibGVkPXRydWU7CiBXSy5kYXRlcz1bXTtXSy5jYXJkcz17fTtXSy5vZGRzPXt9O1dLLmRpYWc9W107V0suY2FsYz17fTsKIHRyeXsKICB3a01zZygi6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgdG9kYXk9anN0VG9kYXkoKTtsZXQgZGF0ZXM9W107CiAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke3RvZGF5fSZsaXN0PTFgLFsxNTAwXSk7ZGF0ZXM9KHguYXZhaWxhYmxlRGF0ZXN8fFtdKS5maWx0ZXIoZD0+ZD49dG9kYXkpfWNhdGNoKGUpe30KICBpZighZGF0ZXMubGVuZ3RoKWRhdGVzPW5leHRXZWVrZW5kKHRvZGF5KTsKICBkYXRlcz1bLi4ubmV3IFNldChkYXRlcyldLnNvcnQoKS5zbGljZSgwLDMpOwogIGZvcihjb25zdCBkIG9mIGRhdGVzKXsKICAgd2tNc2coYCR7ZH0g6ZaL5YKs5aC044KS56K66KqN5Lit4oCmYCk7CiAgIGxldCB2ZW51ZXM9W107CiAgIHRyeXt2ZW51ZXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtkfSZsaXN0PTFgLFsxNTAwXSkpLnZlbnVlc3x8W119CiAgIGNhdGNoKGUpe1dLLmRpYWcucHVzaCh7ZCxjb2RlOiIiLG5hbWU6IijplovlgqzloLTkuIDopqcpIixyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjplLm1lc3NhZ2V9KTtjb250aW51ZX0KICAgaWYoIXZlbnVlcy5sZW5ndGgpe1dLLmRpYWcucHVzaCh7ZCxjb2RlOiIiLG5hbWU6IijplovlgqzjgarjgZcpIixyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjoi44GT44Gu5pel44Gu5Ye66aas6KGo44Gv5pyq5YWs6ZaL44CB44G+44Gf44Gv6ZaL5YKs44GM44GC44KK44G+44Gb44KTIn0pO2NvbnRpbnVlfQogICBXSy5jYXJkc1tkXT1bXTsKICAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXt3a01zZyhgJHtkfSAke3YudmVudWVOYW1lfHx2LnZlbnVlQ29kZX0g44Gu5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCm77yIJHsoV0suY2FyZHNbZF18fFtdKS5sZW5ndGh944Os44O844K55Y+W5b6X5riI44G/77yJYCk7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlLGQsdil9CiAgIGlmKChXSy5jYXJkc1tkXXx8W10pLmxlbmd0aClXSy5kYXRlcy5wdXNoKGQpOwogIH0KICBpZighV0suZGF0ZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi5Ye66aas6KGo44KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf44CC44CM5Y+W44KK6L6844G/54q25rOB44CN44K/44OW44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCIik7CiAgbGV0IG9kZHNOPTAsdG90YWw9MDsKICBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7d2tNc2coYCR7ZH0g44Kq44OD44K644KS5Y+W5b6X5Lit4oCmYCk7b2Rkc04rPShhd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2UsZCkpLm47dG90YWwrPVdLLmNhcmRzW2RdLmxlbmd0aH0KICB0cnl7V0sucGVkPWF3YWl0IHBlZGlncmVlVXBkYXRlKFdLLmNhcmRzKX1jYXRjaChlKXtXSy5wZWQ9bnVsbH0KICB3a01zZygi6YGO5Y6744OH44O844K/44Go54Wn5ZCI44GX44Gm44CB5YWo44Os44O844K544KS6Kej5p6Q5Lit4oCmIik7CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTsKICByZW5kZXJBbGwoKTsKICBjb25zdCBucj1XSy5kYXRlcy5yZWR1Y2UoKHMsZCk9PnMrV0suY2FyZHNbZF0ubGVuZ3RoLDApOwogIHdrTXNnKGDlrozkuobvvIgke1dLLmF0fe+8ie+8miR7V0suZGF0ZXMuam9pbigi44CBIil977yPJHtucn3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtvZGRzTn3jg6zjg7zjgrkke29kZHNIaW50KCl9YCk7CiAgJCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2U7c2hvd1RhYigidkF4aXMiKTsKIH1jYXRjaChlKXt3a01zZygi44Ko44Op44O877yaIitlLm1lc3NhZ2UpO2J1c3koZmFsc2UpO3JlbmRlckFsbCgpfQogZmluYWxseXskKCJ3a0dvIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KYXN5bmMgZnVuY3Rpb24gb2Rkc09ubHkoKXsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpcmV0dXJuOyQoIndrT2RkcyIpLmRpc2FibGVkPXRydWU7CiB0cnl7bGV0IG49MDtmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7d2tNc2coYCR7ZH0g44Kq44OD44K644KS5pu05paw5Lit4oCmYCk7bis9KGF3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZVVybCgpLGQpKS5ufQogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7cmVuZGVyQWxsKCk7d2tNc2coYOOCquODg+OCuuabtOaWsO+8iCR7V0suYXR977yJ77yaJHtufeODrOODvOOCueWIhiR7b2Rkc0hpbnQoKX1gKX0KIGNhdGNoKGUpe3drTXNnKCLmm7TmlrDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9ZmluYWxseXskKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZX0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOino+aekO+8iDHjg6zjg7zjgrnvvInvvJropIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K6ID0g5pyf5b6F5YCk44CB5rOi5Lmx5bqm44CB6YmE5p2/CiAqICDopIfli53norrnjofvvJrjgqrjg4PjgrrjgYLjgorihpLluILloLTmg4XloLHjgoLkvb/jgYblrabnv5LmuIjjgb/jg6Ljg4fjg6socE8p77yP44Gq44GX4oaS6YGO5Y675oiQ57i+44Gu44G/44Gu44Oi44OH44OrKHBQKQogKiAg6KSH5Yud44Kq44OD44K677yaSlJB44Gu6KSH5Yud44Kq44OD44K677yI5LiL6ZmQ44Cc5LiK6ZmQ77yJ44CC6Kqt44KB44Gq44GE44Go44GN44Gv5Y2Y5Yud44GL44KJ5o6o5a6a77yIw5fooajnpLrvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBjYWxjUmFjZShkLGMsc3RvcmUpewogY29uc3QgcmFjZT1ta1JhY2UoYyxkKTtyYWNlLmdjPWdvaW5nQ2F0KGdvaW5nQ29kZShjLmdvaW5nKSk7bGV0IG49cmFjZS5ydW5uZXJzLmxlbmd0aDtjb25zdCBzY3JhdGNoZWQ9W107CiB7Y29uc3QgbzA9V0sub2Rkc1tya2V5KGQsYyldOwogIGlmKG8wKXtjb25zdCBtaXNzPXJhY2UucnVubmVycy5maWx0ZXIocj0+IShvMC50YW5bci5udW1dPjEpKSxoYXZlPXJhY2UucnVubmVycy5sZW5ndGgtbWlzcy5sZW5ndGg7CiAgIC8vIOS4gOmDqOOBrummrOOBoOOBkeOCquODg+OCuuOBjOeEoeOBhO+8neWPlua2iOODu+mZpOWkluOBruWPr+iDveaAp+OBjOmrmOOBhOOAguWkluOBl+OBpuOAgeOCquODg+OCuui+vOOBv+OBp+ino+aekOOBmeOCi++8iOWkp+WNiuOBjOasoOOBkeOBpuOBhOOCi+OBquOCieWkluOBleOBquOBhO+8iQogICBpZihtaXNzLmxlbmd0aCYmaGF2ZT49NiYmbWlzcy5sZW5ndGg8PU1hdGgubWF4KDMsTWF0aC5mbG9vcihyYWNlLnJ1bm5lcnMubGVuZ3RoKi4yKSkpe3NjcmF0Y2hlZC5wdXNoKC4uLm1pc3MubWFwKHI9PnIubnVtKSk7cmFjZS5ydW5uZXJzPXJhY2UucnVubmVycy5maWx0ZXIocj0+bzAudGFuW3IubnVtXT4xKTtuPXJhY2UucnVubmVycy5sZW5ndGh9fX0KIGNvbnN0IGJhc2U9e2QsY2FyZDpjLHJhY2UsbixzY3JhdGNoZWQsa2V5OnJrZXkoZCxjKSx2ZW51ZTpjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiIsbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsCiAgbGFiZWw6YCR7Yy52ZW51ZU5hbWV8fGMudmVudWV8fCIifSR7Yy5yYWNlTnVtYmVyfHwiIn1SICR7KGMucmFjZU5hbWUmJmMucmFjZU5hbWUhPT0i5Ye66aas6KGoIik/Yy5yYWNlTmFtZTooYy5jbGFzc05hbWV8fCIiKX1gLGNvdXJzZTpjLnN1cmZhY2UmJmMuZGlzdGFuY2U/YCR7Yy5zdXJmYWNlfSR7Yy5kaXN0YW5jZX1tYDoi44Kz44O844K55LiN5piOIn07CiBpZigv6Zqc5a6zLy50ZXN0KChjLnJhY2VOYW1lfHwiIikrKGMuY2xhc3NOYW1lfHwiIikpKXJldHVybnsuLi5iYXNlLHNraXA6IumanOWus+ODrOODvOOCueOBr+WvvuixoeWklu+8iOW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCge+8iSJ9OwogaWYobjw2KXJldHVybnsuLi5iYXNlLHNraXA6IjbpoK3mnKrmuoAifTsKIGNvbnN0IG89V0sub2Rkc1tiYXNlLmtleV0sb2Rkcz1vP3JhY2UucnVubmVycy5tYXAocj0+by50YW5bci5udW1dKTpudWxsLGhhc09kZHM9ISEob2RkcyYmb2Rkcy5ldmVyeSh4PT54PjEpKTsKIGNvbnN0IG9kPWhhc09kZHM/b2RkczpudWxsOwogY29uc3QgcmVzPVVFLmFuYWx5emUocmFjZSxzdG9yZSxvZCksYXA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpO2xldCB1Zz1VRS51cHNldEdyYWRlKHJhY2Usc3RvcmUsb2QsYXApOwogY29uc3QgVU09Z2V0VXBzZXRNb2RlbCgpOwogaWYoVU0mJnN0b3JlLnVwKXt0cnl7Y29uc3QgdT1VRS51cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2QsYXApLGluZj17djpTdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIiksbm86TnVtYmVyKGMucmFjZU51bWJlcil8fDAsZ2M6cmFjZS5nYyxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxsdmw6cmFjZS5sdmwsZ3JkOnJhY2UuZ3JkLE46bn0sc2ltPShoYXNPZGRzJiZzdG9yZS5wcCYmbj49Nik/KCgpPT57Y29uc3QgcG9wcz1wb3BzRnJvbU9kZHMob2QpO3JldHVybiBzaW1GZWF0KGFwLnBQLHBvcHMsbixzdG9yZS5wcCl9KSgpOm51bGwsY3U9dXBzZXRDdXN0b20oVU0sdSxzdG9yZS51cC5mZWF0KGluZikscGFjZUZlYXQocmFjZS5ydW5uZXJzLHN0b3JlKSxzaW0pO2lmKGN1KXVnPXsuLi51ZywuLi5jdSxtb2RlOnUubW9kZSxjdXN0b206dHJ1ZX19Y2F0Y2goZSl7fX0KIGNvbnN0IFBNPWdldFBsYWNlTW9kZWwoKTtsZXQgcE5ldz1udWxsOwogcmFjZS5nYz1nb2luZ0NhdChnb2luZ0NvZGUoYy5nb2luZykpOwogaWYoUE0mJmhhc09kZHMmJm4+PTgmJnN0b3JlLnBwKXt0cnl7CiAgY29uc3QgcG9wcz1wb3BzRnJvbU9kZHMob2QpLHJrPXJhbmtGcmFjcyhhcC5wUCkscmNJPXtnYzpyYWNlLmdjLHY6U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpLHN1cmY6cmFjZS5zdXJmLGRpc3Q6cmFjZS5kaXN0LE46bn0sY3R4PXtkcmF3OnN0b3JlLmRyYXcsdHI6c3RvcmUudHIsc2lyZTpzdG9yZS5zaXJlLHBlZDpQRUR9LGI9TWF0aC5taW4oLjUsMy9uKTsKICBwTmV3PW5vcm1TdW0ocmFjZS5ydW5uZXJzLm1hcCgocixpKT0+e2xldCB4PXBsYWNlWChhcC5wUFtpXSxwb3BzW2ldLG4sc3RvcmUucHAscmtbaV0pO2lmKFBNLmV4dCl4PVsuLi54LC4uLmV4dEZlYXRIb3JzZShyLHN0b3JlLmguZ2V0KHIuaG9yc2UpLHJjSSxjdHgsYildO3JldHVybiBwcmVkTG9naXQoUE0ubW9kZWwseCl9KSwzKX1jYXRjaChlKXtwTmV3PW51bGx9fQogbGV0IGF4aXM9aGFzT2Rkcz9VRS5heGlzUGlja3MocmFjZSxzdG9yZSxvZCxhcCk6bnVsbDsKIGlmKGhhc09kZHMpewogIGNvbnN0IHBhPXBOZXd8fGFwLnBPLGlyb25SYXRlPShwTmV3JiZQTS5pcm9uJiZQTS5pcm9uLm4+MCk/UE0uaXJvbi5yYXRlOlVFLkFYSVMuYmFuZHNbIumJhOadvyJdLnJhdGU7CiAgY29uc3QgaXJvbj1wYS5tYXAoKHAsaSk9Pih7aSxwLHRpZXI6IumJhOadvyIscmF0ZTppcm9uUmF0ZX0pKS5maWx0ZXIoeD0+eC5wPj1JUk9OX1ApOwogIGNvbnN0IGlzSXJvbj1uZXcgU2V0KGlyb24ubWFwKHg9PnguaSkpLHJlZj0oYXhpc3x8W10pLmZpbHRlcih4PT4haXNJcm9uLmhhcyh4LmkpJiZ4LnRpZXIhPT0i6YmE5p2/IikubWFwKHg9Pih7Li4ueCxwOnBhW3guaV19KSk7CiAgYXhpcz1bLi4uaXJvbiwuLi5yZWZdOwogfQogY29uc3QgbTM9aGFzT2Rkcz9VRS50b3AzRnJvbVdpbihvZC5tYXAoeD0+MS94KSk6bnVsbDsKIGNvbnN0IGhvcnNlcz1yYWNlLnJ1bm5lcnMubWFwKChyLGkpPT57CiAgY29uc3QgcD1wTmV3P3BOZXdbaV06KGhhc09kZHM/YXAucE9baV06YXAucFBbaV0pLHBsPW8mJm8ucGxhY2UmJm8ucGxhY2Vbci5udW1dOwogIGxldCBsbz1udWxsLGhpPW51bGwsc3JjPW51bGw7CiAgaWYocGwmJnBsLmxlbmd0aD09PTImJnBsWzBdPj0xKXtsbz1wbFswXTtoaT1wbFsxXTtzcmM9IuWunyJ9CiAgZWxzZSBpZihtMyl7bG89TWF0aC5tYXgoMSwwLjgvTWF0aC5tYXgobTNbaV0sLjAyKSk7aGk9bG87c3JjPSLmjqjlrpoifQogIGNvbnN0IHRyPXN0b3JlLnRyJiZyLnRyYWluZXI/c3RvcmUudHIuZ2V0KHIudHJhaW5lcik6bnVsbCx4PXJlc1tpXTsKICByZXR1cm57aSxubzpyLm51bSxuYW1lOnIubmFtZSxqbmFtZTpyLmpuYW1lLHRyYWluZXI6ci50cmFpbmVyLHRyTjp0cj90ci5uOjAsdHJSYXRlOnRyJiZ0ci5uP3RyLnQzL3RyLm46bnVsbCxqbjp4LmpuLAogICBwLHBTcmM6cE5ldz8i5YaN5qCh5q2jIjpudWxsLHBPbGQ6aGFzT2Rkcz9hcC5wT1tpXTphcC5wUFtpXSxsbyxoaSxzcmMsZXY6bG8/cCpsbzpudWxsLGV2TWlkOmxvP3AqKGxvK2hpKS8yOm51bGwsd2luOmhhc09kZHM/b2RbaV06bnVsbCxwb3A6eC5wb3AsaG9sZTp4LmhvbGUscGM6eC5wYyxtb2RlOngubW9kZSxuOngubiwKICAgY2FyZWVyOnguY2FyZWVyLHJlY2VudDp4LnJlY2VudCx0YWdzOngudGFncyxyYXRpbmc6KHBOZXcmJlBNLmhvbGVDdXRzJiZ4LmhvbGUpP2dyYWRlSG9sZShQTS5ob2xlQ3V0cyxwKTpVRS5yYXRpbmcoeC5wYyx4Lm1vZGUseC5uKSx4fX0pOwogcmV0dXJuey4uLmJhc2UsaGFzT2RkcyxyZXMsYXAsdWcsYXhpcyxob3JzZXMsaG9sZU5ldzohIShwTmV3JiZQTS5ob2xlQ3V0cykscGxhY2VSZWFsOmhvcnNlcy5maWx0ZXIoaD0+aC5zcmM9PT0i5a6fIikubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBjYWxjV2Vla2VuZCgpewogV0suY2FsYz17fTsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoV0suZGF0ZXNbMF0pOwogV0suc3RvcmVJbmZvPXtsYXN0OnN0b3JlLmxhc3REYXRlfHwiIixjb3VudDpzdG9yZS5jb3VudH07CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgY3M9Wy4uLldLLmNhcmRzW2RdXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGUpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBXSy5jYWxjW2RdPXtyYWNlczpbXX07CiAgZm9yKGxldCBpPTA7aTxjcy5sZW5ndGg7aSsrKXsKICAgdHJ5e1dLLmNhbGNbZF0ucmFjZXMucHVzaChjYWxjUmFjZShkLGNzW2ldLHN0b3JlKSl9CiAgIGNhdGNoKGUpe1dLLmNhbGNbZF0ucmFjZXMucHVzaCh7ZCxjYXJkOmNzW2ldLHNraXA6Iuino+aekOOCqOODqeODvO+8miIrZS5tZXNzYWdlLGxhYmVsOmAke2NzW2ldLnZlbnVlTmFtZXx8IiJ9JHtjc1tpXS5yYWNlTnVtYmVyfHwiIn1SYCx2ZW51ZTpjc1tpXS52ZW51ZU5hbWV8fCIiLG5vOmNzW2ldLnJhY2VOdW1iZXJ8fDAsaG9yc2VzOltdfSl9CiAgIGlmKGklND09PTMpYXdhaXQgc2xlZXAoMCk7CiAgfQogfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5qSc6Ki844Ky44O844OI77ya5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn44CB6Kqk5beu44KS5byV44GE44Gm44KC5Zue5Y+O546HMTAwJeS7peS4iuOBruiyt+OBhOaWueOBoOOBkeOAjOaknOiovOa4iOOBv+OAjQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdBVEVfS0VZPSJrZWliYV9nYXRlX3YyIjsKY29uc3QgZ2V0R2F0ZT0oKT0+e3RyeXtyZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl8fCJudWxsIil9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKY29uc3QgU1RSQVQ9e2ZvY3VzOiLnqbTppqzvvIjil47nmoTkuK3njofph43oppbvvIkiLHRvcDE6IueptOmmrDHkvY0iLHRvcDI6IueptOmmrOS4iuS9jTLpoK0iLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uCJ9OwpmdW5jdGlvbiBzZXRHYXRlKG91dCxvdXRQKXsKIGNvbnN0IGl0ZW1zPVtdOwogZm9yKGNvbnN0IFtzcmMsb10gb2YgW1si44Kq44OD44K644GC44KKIixvdXRdLFsi44Kq44OD44K644Gq44GXIixvdXRQXV0pewogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKFNUUkFUKSl7CiAgIGNvbnN0IHY9by5zdGF0c1trXTtpZighdiljb250aW51ZTsKICAgY29uc3Qgc2VnPSh2LkMmJnYuQy5iZXRzPj0zMDApP3YuQzp2LmFsbDtpZighc2VnfHwhc2VnLmJldHMpY29udGludWU7CiAgIGNvbnN0IGxvdz1zZWcucm9pLTEuOTYqc2VnLnNlOwogICBpdGVtcy5wdXNoKHtrZXk6ayxsYWJlbDpTVFJBVFtrXSsi77yIIitzcmMrIu+8iSIscm9pOnNlZy5yb2ksbG93LGJldHM6c2VnLmJldHMsaGl0OnNlZy5oaXRSYXRlLHNlZzpzZWc9PT12LkM/IuWtpue/kuW+jCI6IuWFqOacn+mWkyJ9KTsKICB9CiB9CiBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShHQVRFX0tFWSxKU09OLnN0cmluZ2lmeSh7YXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLGl0ZW1zfSkpOwogbW9kZWxzVG9NZXRhKCk7CiByZW5kZXJHYXRlKCk7Cn0KY29uc3Qgc3RyYXRPaz1rZXk9Pntjb25zdCBnPWdldEdhdGUoKTtyZXR1cm4gISEoZyYmZy5pdGVtcy5zb21lKHg9Pngua2V5PT09a2V5JiZ4Lmxvdz49MSYmeC5iZXRzPj0zMDApKX07CmNvbnN0IHN0cmF0Q2hpcD1rZXk9PnN0cmF0T2soa2V5KT8nPHNwYW4gY2xhc3M9ImNoaXAgYiI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8iTwvc3Bhbj4nOic8c3BhbiBjbGFzcz0iY2hpcCByIj7lm57lj47njocxMDAl6LaF44Gv5pyq56K66KqNPC9zcGFuPic7CmZ1bmN0aW9uIHJlbmRlckdhdGUoKXsKIHRyeXtyZW5kZXJNb2RlbFN0YXR1cygpfWNhdGNoKGUpe30KIGNvbnN0IGc9Z2V0R2F0ZSgpLGVsPSQoImdhdGUiKTsKIGlmKCFnKXtlbC5pbm5lckhUTUw9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+PGI+5Zue5Y+O546H77ya5pyq5qSc6Ki8PC9iPuOAgOOAjOaknOiovOOAjeOCv+ODluOCkuWun+ihjOOBmeOCi+OBvuOBp+OAgeOBqeOBruiyt+OBhOaWueOCguOAjDEwMCXotoXjgI3jgajjga/oqIDjgYjjgb7jgZvjgpPjgILvvIjku6XliY3jga7mpJzoqLzjgafjga/jgIHnqbTppqwx5L2N44Gu6KSH5Yud5Zue5Y+O546H44Gv57SENzLjgJw3NyXjgafjgZfjgZ/vvIk8L2Rpdj4nO3JldHVybn0KIGNvbnN0IG9rPWcuaXRlbXMuZmlsdGVyKHg9PngubG93Pj0xJiZ4LmJldHM+PTMwMCksYmVzdD1nLml0ZW1zLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi5yb2ktYS5yb2kpWzBdOwogaWYob2subGVuZ3RoKWVsLmlubmVySFRNTD1gPGRpdiBjbGFzcz0iYmFubmVyIG9rIj48Yj7mpJzoqLzmuIjjgb/vvIjlm57lj47njocxMDAl6LaF77yJ77yaPC9iPiR7b2subWFwKHg9PmAke2VzYyh4LmxhYmVsKX0gJHtwY3QoeC5yb2kpfe+8iOS4i+mZkCR7cGN0KHgubG93KX3jg7ske3guYmV0cy50b0xvY2FsZVN0cmluZygpfeWbnuODuyR7eC5zZWd977yJYCkuam9pbigi77yPIil9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAgumBjuWOu+OBruaIkOe4vuOBp+OBrue1kOaenOOBp+OAgeS7iuW+jOOCgue2muOBj+S/neiovOOBr+OBguOCiuOBvuOBm+OCk+OAgjwvc3Bhbj48L2Rpdj5gOwogZWxzZSBlbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBuZyI+PGI+5Zue5Y+O546HMTAwJei2heOCkueiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBr+OAgeOBvuOBoOOBguOCiuOBvuOBm+OCk+OAgjwvYj4ke2Jlc3Q/YOacgOmrmOOBp+OCgiAke2VzYyhiZXN0LmxhYmVsKX0g44GuICR7cGN0KGJlc3Qucm9pKX3vvIjoqqTlt67jgpLlvJXjgY/jgagke3BjdChiZXN0Lmxvdyl944O7JHtiZXN0LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske2Jlc3Quc2Vnfe+8ieOAgmA6IiJ9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5qSc6Ki85pelICR7ZXNjKGcuYXQpfeOAguS4i+OBruWAmeijnOOBr+OAjOW9k+OBn+OCiuOChOOBmeOBleODu+acn+W+heWApOOBruebruWuieOAjeOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj48L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog6KGo56S6CiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgSVJPTl9QPTAuOTU7ICAgLy8g6LaF6YmE5p2/77yd6KSH5Yud5ZyP5YaF44Gr5YWl44KL56K6546H44GMOTUl5Lul5LiK44Gu6aas77yI6aCt5pWw44Gu5Yi26ZmQ44Gq44GX77yJCmNvbnN0IEdSQURFX09SREVSPVsiU1NTIiwiU1MiLCJTIiwiQSIsIkIiLCJDIl0sR1JBREVfQ09MT1I9e1NTUzoiI2I0MjMxOCIsU1M6IiNkOTJkMjAiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgZGF5TGFiZWw9ZD0+e2NvbnN0IHc9IuaXpeaciOeBq+awtOacqOmHkeWcnyJbbmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFVUQ0RheSgpXTtyZXR1cm4gYCR7ZC5zbGljZSg1KS5yZXBsYWNlKCItIiwiLyIpfSgke3d9KWB9Owpjb25zdCBjYWxjUmFjZXM9ZD0+KFdLLmNhbGNbZF0mJldLLmNhbGNbZF0ucmFjZXMpfHxbXTsKY29uc3QgYWxsUmFjZXM9KCk9PldLLmRhdGVzLmZsYXRNYXAoZD0+Y2FsY1JhY2VzKGQpKTsKY29uc3Qgbm9EYXRhPW1zZz0+YDxkaXYgY2xhc3M9InNtYWxsIj4ke21zZ3x8IuOAjOKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgIIifTwvZGl2PmA7CgpmdW5jdGlvbiByZW5kZXJBbGwoKXtyZW5kZXJHYXRlKCk7cmVuZGVyQXhpcygpO3JlbmRlckV2KCk7cmVuZGVyVXBzZXQoKTtyZW5kZXJIb2xlKCk7cmVuZGVyUmFjZXMoKTtyZW5kZXJTdW0oKX0KCi8qIC0tLSDotoXpiYTmnb/vvIjopIfli53lnI/lhoXjga7norrnjofjgYzpq5jjgYTou7jppqzvvInvvJrln7rmupbvvIjnorrnjofjga7kuIvpmZDvvInjgpLpgbjjgbnjgosgLS0tICovCmNvbnN0IElST05fS0VZPSJrZWliYV9pcm9uX2N1dCI7Ci8qIOWfuua6luOBlOOBqOOBrumBjuWOu+OBruWun+e4vuihqO+8muWGjeagoeato+W+jOOBr+aknOiovOacn+mWk+OBruWun+e4vuOAgeOBquOBkeOCjOOBsOaomea6luODouODh+ODq+OBruaknOiovOe1kOaenO+8iOWMuuWIhuOCkuepjeOBv+S4iuOBku+8iSAqLwpmdW5jdGlvbiBpcm9uVGFibGUoKXsKIGNvbnN0IFBNeD1nZXRQbGFjZU1vZGVsKCk7CiBpZihQTXgmJlBNeC50aHImJlBNeC50ZXN0RGF5cyl7CiAgcmV0dXJue3NyYzpg5YaN5qCh5q2j5b6M44Gu5qSc6Ki85pyf6ZaT77yIJHtQTXgudGVzdERheXN96ZaL5YKs5pel77yJ44Gn44Gu5a6f57i+YCxyb3dzOlBNeC50aHIuZmlsdGVyKHQ9PnQudD49Ljg1JiZ0Lm4+MCkubWFwKHQ9Pih7Y3V0OnQudCxyYXRlOnQucmF0ZSxsbzp0LmxvLG46dC5uLHBlckRheTp0Lm4vUE14LnRlc3REYXlzfSkpLnNvcnQoKGEsYik9PmIuY3V0LWEuY3V0KX07CiB9CiBjb25zdCBCPVVFLkFYSVMuYmFuZHMscm93cz1bXTtsZXQgbj0wLGs9MCxwZD0wOwogZm9yKGNvbnN0IFtubSxjdXRdIG9mIFtbIumJhOadvyIsLjkyXSxbIua6lumJhOadvyIsLjg4XSxbIuWghei7uCIsLjg0XV0pe2NvbnN0IGI9QltubV07bis9Yi5uO2srPWIubipiLnJhdGU7cGQrPWIucGVyRGF5O2NvbnN0IHc9d2lsc29uKE1hdGgucm91bmQoayksbik7cm93cy5wdXNoKHtjdXQscmF0ZTprL24sbG86d1swXSxuLHBlckRheTpwZH0pfQogcmV0dXJue3NyYzoi5qiZ5rqW44Oi44OH44Or44Gu5qSc6Ki857WQ5p6c77yIMjAyNOW5tOS7pemZje+8iSIscm93czpyb3dzLnNvcnQoKGEsYik9PmIuY3V0LWEuY3V0KX07Cn0KY29uc3QgaXJvblN0YXQ9KHJvd3MscCk9PnJvd3MuZmluZCh4PT54LmN1dDw9cCsxZS05KXx8bnVsbDsKZnVuY3Rpb24gcmVuZGVyQXhpcygpewogY29uc3QgZWw9JCgidkF4aXMiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgdGI9aXJvblRhYmxlKCksY3V0cz10Yi5yb3dzLm1hcChyPT5yLmN1dCk7CiBsZXQgY3V0PSgkKCJpcm9uQ3V0IikmJk51bWJlcigkKCJpcm9uQ3V0IikudmFsdWUpKXx8MDsKIGlmKCFjdXQpe3RyeXtjdXQ9TnVtYmVyKGxvY2FsU3RvcmFnZS5nZXRJdGVtKElST05fS0VZKSl8fDB9Y2F0Y2goZSl7fX0KIGlmKCFjdXR8fCFjdXRzLmxlbmd0aCljdXQ9Y3V0cy5pbmNsdWRlcyguOTUpPy45NTooY3V0c1swXXx8LjkyKTsKIGN1dD1jdXRzLnJlZHVjZSgoYixjKT0+TWF0aC5hYnMoYy1jdXQpPE1hdGguYWJzKGItY3V0KT9jOmIsY3V0c1swXXx8Y3V0KTsgICAvLyDooajjgavjgYLjgovln7rmupbjga7jgYbjgaHjgIHjgYTjgaHjgbDjgpPov5HjgYTjgoLjga4KIHRyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShJUk9OX0tFWSxTdHJpbmcoY3V0KSl9Y2F0Y2goZSl7fQogY29uc3QgY3VyPWlyb25TdGF0KHRiLnJvd3MsY3V0KTsKIGxldCBoPWA8aDI+6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaF44Gu56K6546H44GM6auY44GE6Lu46aas77yJPC9oMj4ke3N0cmF0Q2hpcCgiYXhpcyIpfSR7cGxhY2VTdGF0dXNMaW5lKCl9CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuWfuua6lu+8muikh+WLneWcj+WGheOBrueiuueOh+OBjCA8c2VsZWN0IGlkPSJpcm9uQ3V0Ij4ke2N1dHMubWFwKGM9PmA8b3B0aW9uIHZhbHVlPSIke2N9Ij4ke3BjdChjLDApfeS7peS4ijwvb3B0aW9uPmApLmpvaW4oIiIpfTwvc2VsZWN0PiDjga7ppqzjgpLjgIHpoK3mlbDjga7liLbpmZDjgarjgZfjgaflh7rjgZfjgb7jgZk8L2Rpdj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgaDjgZHliKTlrprjgZfjgb7jgZnjgII8Yj7ln7rmupbjgpLkuIvjgZLjgovjgajpoK3mlbDjga/lopfjgYjjgb7jgZnjgYzjgIHlrp/pmpvjga7nmoTkuK3njofjga/kuIvjgYzjgorjgb7jgZk8L2I+77yIJHtlc2ModGIuc3JjKX3vvInjgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ln7rmupY8L3RoPjx0aD7lrp/pmpvjga7nmoTkuK3njoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjx0aD4x5pel44GC44Gf44KKPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PiR7dGIucm93cy5tYXAocj0+YDx0ciR7ci5jdXQ9PT1jdXQ/JyBzdHlsZT0iZm9udC13ZWlnaHQ6NzAwIic6IiJ9Pjx0ZD4ke3BjdChyLmN1dCwwKX3ku6XkuIo8L3RkPjx0ZD4ke3BjdChyLnJhdGUsMSl9PC90ZD48dGQ+JHtwY3Qoci5sbywxKX3jgJw8L3RkPjx0ZD4ke3IucGVyRGF5LnRvRml4ZWQoMil96aCtPC90ZD48L3RyPmApLmpvaW4oIiIpfTwvdGJvZHk+PC90YWJsZT48L2Rpdj5gOwogaWYoY3VyKWgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+6YG45oqe5Lit77yIJHtwY3QoY3V0LDApfeS7peS4iu+8ie+8mumBjuWOu+OBq+Wun+mam+OBqzxiPiR7cGN0KGN1ci5yYXRlLDEpfTwvYj7jgYwz552A5Lul5YaF44CBMeaXpeOBguOBn+OCiue0hDxiPiR7Y3VyLnBlckRheS50b0ZpeGVkKDIpfemgrTwvYj7jgIIke2N1ci5yYXRlPC45NT8nPHNwYW4gY2xhc3M9Indhcm4iPjk1JeOBq+OBr+WxiuOBjeOBvuOBm+OCk+OAgjwvc3Bhbj4nOiIifTwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxwaWNrcz1bXSxyZWY9W107CiAgZm9yKGNvbnN0IHIgb2YgcnMpaWYoci5oYXNPZGRzKWZvcihjb25zdCBoaCBvZiByLmhvcnNlcyl7CiAgIGlmKGhoLnA+PWN1dClwaWNrcy5wdXNoKHtyLGhoLHN0Omlyb25TdGF0KHRiLnJvd3MsaGgucCl9KTsKICAgZWxzZSBpZihoaC5wPj0oY3V0c1tjdXRzLmxlbmd0aC0xXXx8Ljg0KSlyZWYucHVzaCh7cixoaCxzdDppcm9uU3RhdCh0Yi5yb3dzLGhoLnApfSk7CiAgfQogIHBpY2tzLnNvcnQoKGEsYik9PmIuaGgucC1hLmhoLnApO3JlZi5zb3J0KChhLGIpPT5iLmhoLnAtYS5oaC5wKTsKICBjb25zdCBuT2Rkcz1ycy5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGg7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfeOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+W5b6XICR7bk9kZHN9LyR7cnMubGVuZ3RofeODrOODvOOCuTwvc3Bhbj48L2gzPmA7CiAgaWYoIW5PZGRzKXtoKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHliKTlrprjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTvvInjgII8L2Rpdj4nO2NvbnRpbnVlfQogIGNvbnN0IGNhcmQ9KHosdGFnKT0+YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHouci5sYWJlbCl9PC9iPuOAgDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moei5yLmNvdXJzZSl944O7JHt6LnIubn3poK08L3NwYW4+PGJyPjxiPiR7ei5oaC5ub33nlaogJHtlc2Moei5oaC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByQSI+JHt0YWd9PC9zcGFuPuOAgOikh+WLneWcj+WGheOBrueiuueOhyAke3BjdCh6LmhoLnAsMSl9PGJyPgogICA8c3BhbiBjbGFzcz0ic21hbGwiPumojuaJi++8miR7ZXNjKHouaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyh6LmhoLnRyYWluZXJ8fCLkuI3mmI4iKX3vvI/ljZjli50gJHt6LmhoLndpbj96LmhoLndpbisi5YCNIjoiLSJ977yP6KSH5YudICR7ei5oaC5sbz96LmhoLmxvLnRvRml4ZWQoMSkrKHouaGguaGk+ei5oaC5sbz8i44CcIit6LmhoLmhpLnRvRml4ZWQoMSk6IiIpKyLlgI0iKyh6LmhoLnNyYz09PSLmjqjlrpoiPyIo5o6o5a6aKSI6IiIpOiItIn3vvI/jgZPjga7norrnjofluK/jga7pgY7ljrvlrp/nuL4gJHt6LnN0P3BjdCh6LnN0LnJhdGUsMSk6IumbhuioiOWkliJ9PC9zcGFuPjwvZGl2PmA7CiAgaWYocGlja3MubGVuZ3RoKWgrPXBpY2tzLm1hcCh6PT5jYXJkKHosei5oaC5wPj0uOTU/Iui2hemJhOadvyI6Iui7uOWAmeijnCIpKS5qb2luKCIiKTsKICBlbHNlIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuWfuua6lu+8iCR7cGN0KGN1dCwwKX3ku6XkuIrvvInjgavoqbLlvZPjgZnjgovppqzjga/jgYTjgb7jgZvjgpPjgILnhKHnkIbjgavosrfjgo/jgarjgYTjga7jgoLkuIDjgaTjga7liKTmlq3jgafjgZnjgII8L2Rpdj5gOwogIGlmKCFwaWNrcy5sZW5ndGgmJnJlZi5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lj4LogIPvvIjln7rmupbjgavjga/lsYrjgYvjgarjgYTjgIHjgZ3jga7ml6Xjga7mnIDmnInlipvvvInvvJo8L2Rpdj5gK3JlZi5zbGljZSgwLDIpLm1hcCh6PT5jYXJkKHosIuWPguiAgyIpKS5qb2luKCIiKTsKIH0KIGVsLmlubmVySFRNTD1oOwogY29uc3Qgc2VsPSQoImlyb25DdXQiKTtzZWwudmFsdWU9U3RyaW5nKGN1dCk7c2VsLm9uY2hhbmdlPXJlbmRlckF4aXM7Cn0KCi8qIC0tLSDmnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJFdigpewogY29uc3QgZWw9JCgidkV2Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IGV2TWluPU51bWJlcigkKCJldk1pbiIpPyQoImV2TWluIikudmFsdWU6MS4wNSkscE1pbj1OdW1iZXIoJCgiZXZQIik/JCgiZXZQIikudmFsdWU6LjI1KTsKIGNvbnN0IHJvd3M9W107CiBmb3IoY29uc3QgciBvZiBhbGxSYWNlcygpKWlmKCFyLnNraXApZm9yKGNvbnN0IGggb2Ygci5ob3JzZXMpaWYoaC5ldiE9bnVsbCYmaC5ldj49ZXZNaW4mJmgucD49cE1pbilyb3dzLnB1c2goe3IsaH0pOwogcm93cy5zb3J0KChhLGIpPT5iLmguZXYtYS5oLmV2KTsKIGNvbnN0IG5PZGRzPWFsbFJhY2VzKCkuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoOwogbGV0IGg9YDxoMj7mnJ/lvoXlgKTvvIjopIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K677yJPC9oMj4ke3N0cmF0Q2hpcCgidmFsdWUiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7mnJ/lvoXlgKTvvJ3jgZ3jga7ppqzjgYwz552A5Lul5YaF44Gr5YWl44KL56K6546HIMOXIOikh+WLneOCquODg+OCuuOBruS4i+mZkOOAgjEuMOOCkui2heOBiOOCjOOBsOOAgeeQhuirluS4iuOBr+iyt+OBhOe2muOBkeOBpuODl+ODqeOCueOBp+OBmeOAguikh+WLneOCquODg+OCuuOBrzxiPuWunzwvYj7vvJ1KUkHjga7lrp/jgqrjg4PjgrrjgIE8Yj7mjqjlrpo8L2I+77yd5Y2Y5Yud44GL44KJ6KiI566X44GX44Gf55uu5a6J44CC56K6546H44Gu6KaL56mN44KC44KK6YGV44GE44GM5aSn44GN44GP5Yq544GP44Gf44KB44CB44CM5qSc6Ki844CN44GnMTAwJei2heOBjOeiuuiqjeOBleOCjOOCi+OBvuOBp+OBr+ebruWuieOBqOOBl+OBpuS9v+OBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mnJ/lvoXlgKQgPHNlbGVjdCBpZD0iZXZNaW4iPjxvcHRpb24gdmFsdWU9IjEiPjEuMDDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjA1Ij4xLjA15Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4xIj4xLjEw5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMS4yIj4xLjIw5Lul5LiKPC9vcHRpb24+PC9zZWxlY3Q+IOikh+WLneeiuueOhyA8c2VsZWN0IGlkPSJldlAiPjxvcHRpb24gdmFsdWU9IjAuMTUiPjE1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuMjUiPjI1JeS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjAuNCI+NDAl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC42Ij42MCXku6XkuIo8L29wdGlvbj48L3NlbGVjdD48L2Rpdj5gOwogaWYoIW5PZGRzKXtlbC5pbm5lckhUTUw9aCsnPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHjgIHmnJ/lvoXlgKTjga/oqIjnrpfjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3vvInjgII8L2Rpdj4nO2JpbmRFdihldk1pbixwTWluKTtyZXR1cm59CiBpZighcm93cy5sZW5ndGgpaCs9JzxkaXYgY2xhc3M9ImJhbm5lciB3biI+5p2h5Lu244Gr5ZCI44GG6aas44Gv44GE44G+44Gb44KT44CCPC9kaXY+JzsKIGVsc2V7CiAgaCs9YDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqw8L3RoPjx0aD7norrnjoc8L3RoPjx0aD7opIfli508L3RoPjx0aD7mnJ/lvoXlgKQ8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICBmb3IoY29uc3Qge3IsaDp4fSBvZiByb3dzLnNsaWNlKDAsNDApKWgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHIuZCkpfSAke2VzYyhyLmxhYmVsKX08YnI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh4LmpuYW1lfHwiIil9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmxvLnRvRml4ZWQoMSl9JHt4LmhpPngubG8/IuOAnCIreC5oaS50b0ZpeGVkKDEpOiIifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY308L3NwYW4+PC90ZD48dGQ+PGI+JHt4LmV2LnRvRml4ZWQoMil9PC9iPjwvdGQ+PC90cj5gOwogIGgrPSI8L3Rib2R5PjwvdGFibGU+PC9kaXY+IjsKIH0KIGVsLmlubmVySFRNTD1oO2JpbmRFdihldk1pbixwTWluKTsKfQpmdW5jdGlvbiBiaW5kRXYoYSxiKXtjb25zdCBlPSQoImV2TWluIikscD0kKCJldlAiKTtpZighZSlyZXR1cm47ZS52YWx1ZT1TdHJpbmcoYSk7cC52YWx1ZT1TdHJpbmcoYik7ZS5vbmNoYW5nZT1wLm9uY2hhbmdlPXJlbmRlckV2fQoKLyogLS0tIOazouS5seW6piAtLS0gKi8KLyog5qSc6Ki85riI44G/44Gu44Oi44OH44Or44GM44GC44KM44Gw44CB44Gd44Gu562J57Sa44Gn6YGO5Y6744Gr5a6f6Zqb44Gr5Ye644Gf5omV5oi777yI5Y2Y5Yud44Gu5Lit5aSu5YCk44CBMTAwMOWGhuS7peS4iuOBruWJsuWQiO+8ieOCkuihqOekuiAqLwpjb25zdCBwYXlDZWxsPWc9Pntjb25zdCBNPWdldFVwc2V0TW9kZWwoKSx4PU0mJk0ucGF5VGFiJiZNLnBheVRhYltnXTtpZigheHx8IXgubnB8fHgubWVkV2luPT1udWxsKXJldHVybiItIjtyZXR1cm5g5Y2Y5Yud44Gu5Lit5aSu5YCkICR7TWF0aC5yb3VuZCh4Lm1lZFdpbikudG9Mb2NhbGVTdHJpbmcoKX3lhoY8YnI+MTAwMOWGhuS7peS4iiAke3BjdCh4LnNoYXJlMTAwMCwwKX1gfTsKZnVuY3Rpb24gcmVuZGVyVXBzZXQoKXsKIGNvbnN0IGVsPSQoInZVcHNldCIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD1gPGgyPuODrOODvOOCueOBruazouS5seW6pu+8iFNTU+OAnEPvvIk8L2gyPjxkaXYgY2xhc3M9InNtYWxsIj7jgIwz552A5Lul5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgI3jgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZHjgZfjgabjgYTjgb7jgZnvvIjlhajjg6zjg7zjgrnlubPlnYcg57SEMjguNSXvvInjgILjgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjga/jgIHjgqrjg4Pjgrrovrzjgb/jga7liKTlrprjgavjgarjgorjgb7jgZnjgII8L2Rpdj4ke3Vwc2V0U3RhdHVzTGluZSgpfWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLmZpbHRlcihyPT4hci5za2lwKSxjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7cnMuZm9yRWFjaChyPT5jbnRbci51Zy5ncmFkZV0rKyk7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+PGRpdiBjbGFzcz0icm93Ij4ke0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpfTwvZGl2PmA7CiAgY29uc3Qgc29ydGVkPXJzLnNsaWNlKCkuc29ydCgoYSxiKT0+R1JBREVfT1JERVIuaW5kZXhPZihhLnVnLmdyYWRlKS1HUkFERV9PUkRFUi5pbmRleE9mKGIudWcuZ3JhZGUpfHxiLnVnLnAtYS51Zy5wKTsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPuetiee0mjwvdGg+PHRoPuS6iOa4rDwvdGg+PHRoPuWun+e4vuOBruazouS5seeOhzwvdGg+PHRoPumBjuWOu+OBruaJleaIu++8iOetiee0muWIpe+8iTwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCByIG9mIHNvcnRlZCloKz1gPHRyPjx0ZD4ke2VzYyhyLmxhYmVsKX08YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtPC9zcGFuPiR7ci5zY3JhdGNoZWQmJnIuc2NyYXRjaGVkLmxlbmd0aD9gIDxzcGFuIGNsYXNzPSJjaGlwIG8iPumZpOWkluaOqOWumiAke3Iuc2NyYXRjaGVkLmpvaW4oIiwiKX3nlao8L3NwYW4+YDoiIn08L3RkPjx0ZD48c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1Jbci51Zy5ncmFkZV19Ij4ke3IudWcuZ3JhZGV9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHIudWcucCl9PC90ZD48dGQ+JHtyLnVnLmN1c3RvbSYmci51Zy5yYXRlIT1udWxsP2Ake3BjdChyLnVnLnJhdGUpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7cGN0KHIudWcubG8pfeOAnCR7cGN0KHIudWcuaGkpfeODuyR7ci51Zy5ufeS7tjwvc3Bhbj5gOk1hdGgucm91bmQoci51Zy5yYXRlKjEwMCkrIiUifTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtwYXlDZWxsKHIudWcuZ3JhZGUpfTwvdGQ+PHRkIGNsYXNzPSJzbWFsbCI+JHtyLnVnLm1vZGU9PT0ib2RkcyI/IuOCquODg+OCuui+vOOBvyI6IuaOqOWumiJ9PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7Cn0KCi8qIC0tLSDnqbTppqzvvIjlpb3otbDnjofjga7pq5jjgYTnqbTppqzlgJnoo5zvvIkgLS0tICovCi8qIOeptOmmrOOBruWAmeijnO+8muWGjeagoeato+a4iOOBv++8iOOCquODg+OCuuWPluW+l+W+jO+8ieOBquOCieaWsOOBl+OBhOeiuueOh+OBp+OAgeOBneOBhuOBp+OBquOBkeOCjOOBsOW+k+adpeOBruipleS+oeOBp+mBuOOBtiAqLwpmdW5jdGlvbiBwaWNrSG9sZShyLGhtKXsKIGlmKHIuaG9sZU5ldyl7CiAgY29uc3QgTD1yLmhvcnNlcy5maWx0ZXIoaD0+aC5ob2xlJiZoLm4+PTMmJihoLndpbj09bnVsbHx8aC53aW48MzApKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICBjb25zdCBwaz1oPT4oe2k6aC5pLG5vOmgubm8sbmFtZTpoLm5hbWUscGM6aC5wLG9kZDpoLndpbixwb3A6aC5wb3AsdGFnczpoLnRhZ3N8fFtdfSk7CiAgaWYoaG09PT0iUyIpcmV0dXJuIEwuZmlsdGVyKGg9PmgucmF0aW5nPT09IlMiKS5zbGljZSgwLDMpLm1hcChwayk7CiAgaWYoaG09PT0iU0EiKXJldHVybiBMLmZpbHRlcihoPT5oLnJhdGluZz09PSJTInx8aC5yYXRpbmc9PT0iQSIpLnNsaWNlKDAsMikubWFwKHBrKTsKICByZXR1cm4gci5ob3JzZXMuZmlsdGVyKGg9PmguaG9sZSYmaC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLDIpLm1hcChwayk7CiB9CiByZXR1cm4gaG09PT0iUyI/VUUucGlja0ZvY3VzKHIucmVzLDYpLmZpbHRlcih4PT5yLmhvcnNlc1t4LmldLnJhdGluZz09PSJTIikuc2xpY2UoMCwzKTpobT09PSJTQSI/VUUucGlja0ZvY3VzKHIucmVzLDIpOlVFLnBpY2soci5yZXMsMik7Cn0KZnVuY3Rpb24gaG9sZVJhdGluZ1RleHQoKXsKIGNvbnN0IFBNPWdldFBsYWNlTW9kZWwoKTsKIGlmKFBNJiZQTS5ob2xlQ3V0cyYmUE0uaG9sZVN0YXRzKXtjb25zdCB0PVBNLmhvbGVTdGF0cy50YWIsYz1QTS5ob2xlQ3V0cztyZXR1cm5g6KmV5L6h44GvPGI+5YaN5qCh5q2j5b6M44Gu6KSH5Yud56K6546HPC9iPuOBp+axuuOCgeOBpuOBhOOBvuOBme+8mlPvvJ3kuojmuKwke3BjdChjLlMsMSl95Lul5LiK77yI5qSc6Ki85pyf6ZaT44Gu5a6f6Zqb44Gu55qE5Lit546HICR7cGN0KHQuUy5yYXRlLDEpfe+8ieOAgUHvvJ0ke3BjdChjLkEsMSl95Lul5LiK77yIJHtwY3QodC5BLnJhdGUsMSl977yJ44CBQu+8nSR7cGN0KGMuQiwxKX3ku6XkuIrvvIgke3BjdCh0LkIucmF0ZSwxKX3vvInjgIHjgZ3jgozku6XlpJbvvJ1D77yIJHtwY3QodC5DLnJhdGUsMSl977yJ44CC44CMU+ODu0HjgI3ooajnpLrjga/jgIHotbDmlbAz5Lul5LiK44Gn5Y2Y5YudMzDlgI3mnKrmuoDjga7ppqzjgaDjgZHjgafjgZnjgIJgfQogcmV0dXJuYOipleS+oeOBr+OAgeeptOmmrOOBruW5s+Wdh+eahOOBquWlvei1sOeOh++8iOOCquODg+OCuui+vOOBvzkuMSXvvI/mjqjlrpoxMS41Je+8ieOBq+WvvuOBmeOCi+WAjeeOh+OBp+axuuOBvuOCiuOBvuOBme+8mlPvvJ0yLjLlgI3ku6XkuIrvvIjntIQyMCXku6XkuIrvvI/mjqjlrprjga/ntIQyNSXku6XkuIrvvInjgIFB77ydMS435YCN5Lul5LiK77yI57SEMTUuNSXku6XkuIrvvI/ntIQxOS42JeS7peS4iu+8ieOAgULvvJ0xLjPlgI3ku6XkuIrjgIFD77yd44Gd44KM5pyq5rqA44CC6LWw5pWw44GM5bCR44Gq44GE6aas44GuU+ODu0Hjga/jgIFC44Gr5LiL44GS44G+44GZ44CC44CMU+ODu0HjgI3ooajnpLrjga/jgIHotbDmlbAz5Lul5LiK44Gn5Y2Y5YudMzDlgI3mnKrmuoDjga7ppqzjgaDjgZHjgafjgZnjgIJgOwp9CmZ1bmN0aW9uIHJlbmRlckhvbGUoKXsKIGNvbnN0IGVsPSQoInZIb2xlIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGNvbnN0IEhLPSJrZWliYV9ob2xlX21vZGUiO2xldCBobT0oJCgiaG9sZUZvY3VzIikmJiQoImhvbGVGb2N1cyIpLnZhbHVlKXx8KCgpPT57dHJ5e3JldHVybiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShISyl9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fSkoKXx8IlNBIjtpZighWyJTIiwiU0EiLCJhbGwiXS5pbmNsdWRlcyhobSkpaG09IlNBIjsKIHRyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShISyxobSl9Y2F0Y2goZSl7fQogbGV0IGg9YDxoMj7nqbTppqzlgJnoo5w8L2gyPiR7c3RyYXRDaGlwKCJmb2N1cyIpfQogPGRpdiBjbGFzcz0ic21hbGwiPjxiPueptOmmrO+8neS6uuawl+OBruS4i+S9jeOBrummrDwvYj7vvIjpoK3mlbDjga7ntIQ25Ymy44KI44KK5LiL44CC5L6L77yaMTbpoK3nq4vjgabjgarjgok355Wq5Lq65rCX5Lul5LiL44CBMTLpoK3nq4vjgabku6XkuIvjgarjgok155Wq5Lq65rCX5Lul5LiL77yJ44Gu5Lit44Gn44CBM+edgOS7peWGheOBq+WFpeOCi+eiuueOh+OBjOmrmOOBhOmmrOOAguOAjOW9k+OBn+OCiuOChOOBmeOBleOAjeOBruebruWuieOBp+OAgeWbnuWPjueOh+OBr+WIpeOBp+OBmeOAgiR7aG9sZVJhdGluZ1RleHQoKX08L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PHNlbGVjdCBpZD0iaG9sZUZvY3VzIj48b3B0aW9uIHZhbHVlPSJTIj5T44Gg44GR77yI5pyA44KC5aW96LWw546H44GM6auY44GE56m06aas77yJPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iU0EiPlPjg7tB77yI4peO55qE5Lit546H6YeN6KaW77yJPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iYWxsIj7jgZnjgbnjgabvvIjkuIrkvY0y6aCt77yJPC9vcHRpb24+PC9zZWxlY3Q+PC9kaXY+CiAke2htPT09IlMiPyc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7jgIxT44Gg44GR44CN44Gv57We44KK6L6844G/44Gu6KGo56S644Gn44GZ44CC6YGO5Y6744Gu5qSc6Ki877yI5qSc6Ki844K/44OW77yJ44Gv44CBU+ODu0HjgpLjgb7jgajjgoHjgZ/miJDnuL7jgafpm4boqIjjgZfjgabjgYTjgovjgZ/jgoHjgIFT44Gg44GR44Gu5oiQ57i+44Gv5Yil44Gr44Gv56K66KqN44Gn44GN44Gm44GE44G+44Gb44KT44CCPC9kaXY+JzoiIn1gOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPmA7CiAgZm9yKGNvbnN0IHIgb2YgY2FsY1JhY2VzKGQpKXsKICAgaWYoci5za2lwKWNvbnRpbnVlOwogICBjb25zdCBjPXBpY2tIb2xlKHIsaG0pO2lmKCFjLmxlbmd0aCljb250aW51ZTsKICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHIubGFiZWwpfTwvYj4gPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyLmNvdXJzZSl944O7JHtyLm596aCtJHtyLmhhc09kZHM/IiI6Iu+8iOOCquODg+OCuuacquWPluW+l++8iSJ9PC9zcGFuPmA7CiAgIGZvcihjb25zdCB4IG9mIGMpe2NvbnN0IGhoPXIuaG9yc2VzW3guaV07CiAgICBoKz1gPGRpdiBzdHlsZT0ibWFyZ2luLXRvcDo2cHgiPjxiPiR7eC5ub33nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByJHtoaC5yYXRpbmd9Ij4ke2hoLnJhdGluZ308L3NwYW4+IDxzcGFuIGNsYXNzPSJzbWFsbCI+5aW96LWw546HICR7aGgucFNyYz9wY3QoaGgucCwxKSsi77yI5YaN5qCh5q2j5b6M44Gu6KSH5Yud56K6546H77yJIjpwY3QoeC5wYywxKX0ke3gub2RkP2DvvI/ljZjli50ke3gub2RkfeWAjSgke3gucG9wfeeVquS6uuawlylgOiIifTwvc3Bhbj48YnI+CiAgICAgPHNwYW4gY2xhc3M9InNtYWxsIj4ke2hoLmNhcmVlciYmaGguY2FyZWVyLm4/YOmAmueulyR7aGguY2FyZWVyLm596LWwIDPnnYDlhoUke2hoLmNhcmVlci50M33lm55gOiLpgJrnrpfvvJrlsaXmrbTjgarjgZcifSR7aGgucmVjZW50JiZoaC5yZWNlbnQubGVuZ3RoP2DvvI/nm7Tov5EgJHtoaC5yZWNlbnQuc2xpY2UoLTUpLmpvaW4oIi0iKX3nnYBgOiIife+8j+mojuaJi++8miR7ZXNjKGhoLmpuYW1lfHwi5LiN5piOIil977yP6Kq/5pWZ5bir77yaJHtlc2MoaGgudHJhaW5lcnx8IuS4jeaYjiIpfSR7aGgudHJSYXRlIT1udWxsJiZoaC50ck4+PTIwP2AoM+edgOWGhSR7cGN0KGhoLnRyUmF0ZSl9KWA6IiJ9PC9zcGFuPjxicj5gKwogICAgICh4LnRhZ3N8fFtdKS5zbGljZSgwLDMpLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKStgPC9kaXY+YH0KICAgaCs9IjwvZGl2PiI7CiAgfQogfQogZWwuaW5uZXJIVE1MPWg7CiBjb25zdCBzPSQoImhvbGVGb2N1cyIpO3MudmFsdWU9aG07cy5vbmNoYW5nZT1yZW5kZXJIb2xlOwp9CgovKiAtLS0g5YWo44Os44O844K577yI6aas44GU44Go44Gu56K6546H44O744Kq44OD44K644O75pyf5b6F5YCk44O76aiO5omL44O76Kq/5pWZ5bir77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJSYWNlcygpewogY29uc3QgZWw9JCgidlJhY2VzIik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPSI8aDI+5YWo44Os44O844K5PC9oMj4iOwogZm9yKGNvbnN0IGQgb2YgV0suZGF0ZXMpewogIGgrPWA8aDM+JHtkYXlMYWJlbChkKX08L2gzPmA7CiAgZm9yKGNvbnN0IHIgb2YgY2FsY1JhY2VzKGQpKXsKICAgaWYoci5za2lwKXtoKz1gPGRpdiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIubGFiZWwpfe+8miR7ZXNjKHIuc2tpcCl9PC9kaXY+YDtjb250aW51ZX0KICAgY29uc3QgZz1yLnVnOwogICBoKz1gPGRldGFpbHM+PHN1bW1hcnk+JHtlc2Moci5sYWJlbCl9IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2Moci5jb3Vyc2UpfeODuyR7ci5ufemgrTwvc3Bhbj4gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2cuZ3JhZGVdfSI+JHtnLmdyYWRlfTwvc3Bhbj48L3N1bW1hcnk+PGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrO+8j+mojuaJi++8j+iqv+aVmeW4qzwvdGg+PHRoPuWNmOWLnTwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPueiuueOhzwvdGg+PHRoPkVWPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCB4IG9mIHIuaG9yc2VzLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi5wLWEucCkpCiAgICBoKz1gPHRyPjx0ZD48Yj4ke3gubm99PC9iPiAke2VzYyh4Lm5hbWUpfSR7eC5ob2xlJiZ4LnJhdGluZyE9PSJDIj9gIDxzcGFuIGNsYXNzPSJydCByJHt4LnJhdGluZ30iPiR7eC5yYXRpbmd9PC9zcGFuPmA6IiJ9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LmpuYW1lP2VzYyh4LmpuYW1lKTonPHNwYW4gY2xhc3M9ImJhZCI+6aiO5omL5LiN5piOPC9zcGFuPid977yIJHt4LmpuPj01PyLpgY7ljrsiK3guam4rIumojuS5lyI6IuWxpeattOWwkSJ977yJ77yPJHt4LnRyYWluZXI/ZXNjKHgudHJhaW5lcik6JzxzcGFuIGNsYXNzPSJiYWQiPuiqv+aVmeW4q+S4jeaYjjwvc3Bhbj4nfSR7eC50clJhdGUhPW51bGwmJngudHJOPj0yMD8i77yIM+edgOWGhSIrcGN0KHgudHJSYXRlKSsi77yJIjoiIn08L3NwYW4+PC90ZD48dGQ+JHt4Lndpbj94Lndpbi50b0ZpeGVkKDEpOiItIn08L3RkPjx0ZD4ke3gubG8/eC5sby50b0ZpeGVkKDEpKyh4LmhpPngubG8/IuOAnCIreC5oaS50b0ZpeGVkKDEpOiIiKToiLSJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfHwiIn08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3guZXYhPW51bGw/YDxiJHt4LmV2Pj0xLjA1PycgY2xhc3M9Imdvb2QiJzoiIn0+JHt4LmV2LnRvRml4ZWQoMil9PC9iPmA6Ii0ifTwvdGQ+PC90cj5gOwogICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PjwvZGV0YWlscz4iOwogIH0KIH0KIGVsLmlubmVySFRNTD1oOwp9CgovKiAtLS0g5Y+W44KK6L6844G/54q25rOB77yI6aCt5pWw44O76aiO5omL44O76Kq/5pWZ5bir44O744Kz44O844K544O744Kq44OD44K644Gu6Kqt44G/5Y+W44KK57WQ5p6c77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJTdW0oKXsKIGNvbnN0IGVsPSQoInZTdW0iKTtpZighV0suZGF0ZXMubGVuZ3RoJiYhV0suZGlhZy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBycz1hbGxSYWNlcygpLmZpbHRlcihyPT4hci5za2lwKTsKIGNvbnN0IGhvcnNlcz1ycy5yZWR1Y2UoKHMscik9PnMrci5uLDApLGptaXNzPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+IWguam5hbWUpLmxlbmd0aCwwKSx0bWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLnRyYWluZXIpLmxlbmd0aCwwKTsKIGNvbnN0IGptYXRjaD1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9Pmguam4+PTUpLmxlbmd0aCwwKSxobWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLm4+PTIpLmxlbmd0aCwwKTsKIGNvbnN0IG5vQ291cnNlPXJzLmZpbHRlcihyPT5yLmNvdXJzZT09PSLjgrPjg7zjgrnkuI3mmI4iKS5sZW5ndGgsbk9kZHM9cnMuZmlsdGVyKHI9PnIuaGFzT2RkcykubGVuZ3RoLHBSZWFsPXJzLmZpbHRlcihyPT5yLnBsYWNlUmVhbD4wKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuWPluOCiui+vOOBv+eKtuazgTwvaDI+PHRhYmxlPjx0Ym9keT4KIDx0cj48dGQ+6Kej5p6Q44GX44Gf44Os44O844K577yP5Ye66LWw6aasPC90ZD48dGQ+JHtycy5sZW5ndGh944Os44O844K577yPJHtob3JzZXN96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7pqI7miYvjgpLoqq3jgoHjgarjgYvjgaPjgZ/ppqw8L3RkPjx0ZCBjbGFzcz0iJHtqbWlzcz8iYmFkIjoiZ29vZCJ9Ij4ke2ptaXNzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6Kq/5pWZ5bir44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7dG1pc3M/ImJhZCI6Imdvb2QifSI+JHt0bWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuOCs+ODvOOCueOCkuiqreOCgeOBquOBi+OBo+OBn+ODrOODvOOCuTwvdGQ+PHRkIGNsYXNzPSIke25vQ291cnNlPyJiYWQiOiJnb29kIn0iPiR7bm9Db3Vyc2V9PC90ZD48L3RyPgogPHRyPjx0ZD7jgqrjg4PjgrrjgpLlj5blvpfjgafjgY3jgZ/jg6zjg7zjgrk8L3RkPjx0ZD4ke25PZGRzfe+8jyR7cnMubGVuZ3Rofe+8iOikh+WLneOBruWun+OCquODg+OCuiAke3BSZWFsfeODrOODvOOCue+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+6YGO5Y6744OH44O844K/44Go44Gu54Wn5ZCI77yI6aas77yJPC90ZD48dGQ+JHtobWF0Y2h977yPJHtob3JzZXN96aCt77yIMui1sOS7peS4iu+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+6YGO5Y6744OH44O844K/44Go44Gu54Wn5ZCI77yI6aiO5omL77yJPC90ZD48dGQ+JHtqbWF0Y2h977yPJHtob3JzZXN96aCt77yINemojuS5l+S7peS4iu+8iTwvdGQ+PC90cj4KIDx0cj48dGQ+5a2m57+S44OH44O844K/44Gu5pyA57WC5pelPC90ZD48dGQ+JHtlc2MoV0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdHx8Ii0iKX08L3RkPjwvdHI+PC90Ym9keT48L3RhYmxlPmA7CiB7Y29uc3QgY3M9V0suZGF0ZXMuZmxhdE1hcChkPT5XSy5jYXJkc1tkXXx8W10pLGdrPWNzLmZpbHRlcihjPT5nb2luZ0NvZGUoYy5nb2luZyk+MCkubGVuZ3RoLGhzPWNzLmZsYXRNYXAoYz0+Yy5ob3JzZXN8fFtdKSxzaz1ocy5maWx0ZXIoeD0+eC5zaXJlfHx4LmRhbVNpcmUpLmxlbmd0aDsKICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPummrOWgtOeKtuaFi++8miR7Z2t9LyR7Y3MubGVuZ3RofeODrOODvOOCueOBp+eZuuihqOa4iOOBvyR7Z2s/IiI6Iu+8iOW9k+aXpeOBruacneOBq+eZuuihqOOBleOCjOOBvuOBmeOAguacqueZuuihqOOBruOBqOOBjeOBr+OAgemmrOWgtOOBruebuOaAp+OBr+S9v+OBhOOBvuOBm+OCk++8iSJ977yP6KGA57Wx44KS6Kqt44KB44Gf6aas77yaJHtza30vJHtocy5sZW5ndGh96aCt77yI6JOE56mN44GX44Gf6KGA57WxICR7T2JqZWN0LmtleXMoUEVEKS5sZW5ndGh96aCt77yJJHtocy5sZW5ndGgmJiFzaz8i44CC5Ye66aas6KGo44GL44KJ6KGA57Wx44KS6Kqt44KB44Gm44GE44G+44Gb44KT77yI6Kit5a6a44Gu44CM6Ki65pat5oOF5aCx44KS5L2c44KL44CN44Gu5Ye65Yqb44Gn44CB5a6f6Zqb44Gu44Oa44O844K444Gu5b2i44KS56K66KqN44Gn44GN44G+44GZ77yJIjoiIn08L2Rpdj5gfQogY29uc3Qgc2NyPXJzLmZpbHRlcihyPT5yLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoKSxqbXA9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5za2lwJiYv6Zqc5a6zLy50ZXN0KHIuc2tpcCkpOwogaWYoc2NyLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4Pjgrrjga7nhKHjgYTppqzjgpLlj5bmtojjg7vpmaTlpJbjgajjgb/jgarjgZfjgablpJbjgZfjgZ/jg6zjg7zjgrnvvJoke3Njci5tYXAocj0+ZXNjKHIubGFiZWwpKyLvvIgiK3Iuc2NyYXRjaGVkLmpvaW4oIiwiKSsi55Wq77yJIikuam9pbigi77yPIil944CC5a6f6Zqb44Gr5Ye66LWw44GZ44KL6aas44Gq44KJ44CB44Kq44OD44K644Gu5Y+W5b6X5ryP44KM44Gn44GZ44CCPC9kaXY+YDsKIGlmKGptcC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pmpzlrrPjg6zjg7zjgrkgJHtqbXAubGVuZ3RofeS7tuOBr+OAgeW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCgeino+aekOOBruWvvuixoeWkluOBq+OBl+OBpuOBhOOBvuOBmeOAgjwvZGl2PmA7CiBjb25zdCBnYXA9V0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdCYmV0suZGF0ZXNbMF0/TWF0aC5yb3VuZCgobmV3IERhdGUoV0suZGF0ZXNbMF0pLW5ldyBEYXRlKFdLLnN0b3JlSW5mby5sYXN0KSkvODY0ZTUpOm51bGw7CiBpZihnYXAhPW51bGwmJmdhcD4xMCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB44KC44GG5LiA5bqm5LqI5oOz44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGlmKHJzLmxlbmd0aCYmaG1hdGNoPGhvcnNlcyouNCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7pgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgZ/ppqzjgYzlsJHjgarjgoHjgafjgZnjgILoi6Xpp5LmiKbkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3jga7ooajoqJjjgYzlkIjjgaPjgabjgYTjgarjgYTlj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgb249V0sub2Rkc05vdGVzfHx7fTsKIGlmKE9iamVjdC5rZXlzKG9uKS5sZW5ndGgpe2grPWA8aDM+44Kq44OD44K65Y+W5b6X44Gu5YaF6KizPC9oMz48ZGl2IGNsYXNzPSJzdGF0dXMiPiR7V0suZGF0ZXMubWFwKGQ9PmAke2RheUxhYmVsKGQpfVxuJHsob25bZF18fFtdKS5tYXAoZXNjKS5qb2luKCJcbiIpfWApLmpvaW4oIlxuXG4iKX08L2Rpdj5gfQogaCs9YDxoMz7plovlgqzloLTjgZTjgag8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7plovlgqzloLQ8L3RoPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nirbmhYs8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIFdLLmRpYWcpewogIGNvbnN0IHByb2JzPVtdO2lmKHguZXJyKXByb2JzLnB1c2goeC5lcnIpO2lmKHguYmFkKXByb2JzLnB1c2goYOWHuui1sOmmrOOCkuiqreOCgeOBquOBhOODrOODvOOCuSAke3guYmFkfWApO3Byb2JzLnB1c2goLi4uKHguaXNzdWVzfHxbXSkpOwogIGgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHguZCkpfSAke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7eC5va30vJHt4LnJhY2VzfTwvdGQ+PHRkIHN0eWxlPSJ0ZXh0LWFsaWduOmxlZnQiPiR7cHJvYnMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iYmFkIHNtYWxsIj4ke3Byb2JzLm1hcChlc2MpLmpvaW4oIjxicj4iKX08L3NwYW4+YDonPHNwYW4gY2xhc3M9Imdvb2QiPuWVj+mhjOOBquOBlzwvc3Bhbj4nfSR7eC5jb2RlP2AgPGJ1dHRvbiBjbGFzcz0ibWluaSBzdWIiIGRhdGEtcmw9IiR7ZXNjKHguZCl9fCR7ZXNjKHguY29kZSl9fCR7ZXNjKHgubmFtZSl9Ij7lho3lj5blvpc8L2J1dHRvbj5gOiIifTwvdGQ+PC90cj5gOwogfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogZWwuaW5uZXJIVE1MPWg7CiBlbC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1ybF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz1hc3luYygpPT57CiAgY29uc3QgW2QsY29kZSxuYW1lXT1iLmRhdGFzZXQucmwuc3BsaXQoInwiKTtiLmRpc2FibGVkPXRydWU7d2tNc2coYCR7ZH0gJHtuYW1lfSDjgpLlho3lj5blvpfkuK3igKZgKTsKICB0cnl7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlVXJsKCksZCx7dmVudWVDb2RlOmNvZGUsdmVudWVOYW1lOm5hbWV9KTthd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKTthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpO3drTXNnKCLlho3lj5blvpfjgZfjgb7jgZfjgZ8iKX0KICBjYXRjaChlKXt3a01zZygi5YaN5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogfSk7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmk43kvZwKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBzaG93VGFiKHQpe2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIi52aWV3IikuZm9yRWFjaCh2PT52LmNsYXNzTGlzdC50b2dnbGUoIm9uIix2LmlkPT09dCkpO2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsYi5kYXRhc2V0LnRhYj09PXQpKX0KZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnNob3dUYWIoYi5kYXRhc2V0LnRhYikpOwokKCJ1cFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidXBSdW4iKS5kaXNhYmxlZD10cnVlOyQoInVwT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5VcHNldEZpdCh7c3RhcnQ6JCgidXBTdGFydCIpLnZhbHVlfHwiMjAyMS0wMS0wMSJ9KTsKICAkKCJ1cE91dCIpLmlubmVySFRNTD11cHNldFJlcG9ydChyKTsKICBpZihyLm1vZGVsKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShVUEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7bW9kZWxzVG9NZXRhKCk7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJ1cE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgidXBSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidXBDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFVQS0VZKTttb2RlbHNUb01ldGEoKTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjg6Ljg4fjg6vjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJwbFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgicGxSdW4iKS5kaXNhYmxlZD10cnVlOyQoInBsT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5QbGFjZUZpdCh7c3RhcnQ6JCgicGxTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSJ9KTsKICAkKCJwbE91dCIpLmlubmVySFRNTD1wbGFjZVJlcG9ydChyKTsKICBpZihyLm1vZGVsKWxvY2FsU3RvcmFnZS5zZXRJdGVtKFBMS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtlbHNlIGlmKCFyLmVycm9yKWxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFBMS0VZKTsKICBtb2RlbHNUb01ldGEoKTsKICBpZighci5lcnJvciYmV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInBsT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJwbFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJwbENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oUExLRVkpO21vZGVsc1RvTWV0YSgpOyQoInBsT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luOBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoIndrR28iKS5vbmNsaWNrPXdlZWtlbmRHbzsKJCgiYWxsR28iKS5vbmNsaWNrPWFsbEluT25lOwokKCJhbGxGaXQiKS5vbmNsaWNrPWFsbEZpdDsKJCgid2tPZGRzIikub25jbGljaz1vZGRzT25seTsKJCgiYmtPbmUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKEJLLmJ1c3kpcmV0dXJuOwogaWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpewogIGNvbnN0IHA9cHJvbXB0KCLjg5Djg4Pjgq/jgqLjg4Pjg5fnlKjjga7jg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJ44KS5rG644KB44Gm5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CC5b6p5YWD44Gu44Go44GN44Gr44KC5ZCM44GY44KC44Gu44GM5b+F6KaB44Gn44GZ44CCIik7CiAgaWYoIXApcmV0dXJuO0JLLnBhc3M9cC50cmltKCk7QksuaWQ9IiI7YmtTYXZlU2V0dGluZ3MoKTskKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOwogIGlmKEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjga845paH5a2X5Lul5LiK44Gr44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm59CiB9CiBhd2FpdCBydW5CYWNrdXAoZmFsc2UpOwp9OwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgiZGJnR28iKS5kaXNhYmxlZD10cnVlO2NvbnN0IGxpbmVzPVtg5Y+W5b6X5pelICR7V0suZGF0ZXMuam9pbigiLCIpfWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY29kZXM9Wy4uLm5ldyBTZXQoKFdLLmNhcmRzW2RdfHxbXSkubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIGNvZGVzKXsKICAgIGNvbnN0IHJzPVdLLmNhcmRzW2RdLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IHE9cnMubWFwKHI9PnIucXVhbGl0eSkuZmlsdGVyKEJvb2xlYW4pOwogICAgbGluZXMucHVzaChgXG7ilqAke2R9IOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3Rofe+8j+mojuaJi+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXguam9ja2V5RmlsbGVkKSwwKX3vvI/oqr/mlZnluKvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LnRyYWluZXJGaWxsZWQpLDApfWApOwogICAgY29uc3QgYmFkPXJzLmZpbmQocj0+ci5xdWFsaXR5JiYhci5xdWFsaXR5Lm9rKXx8cnNbMF0scm49KGJhZCYmYmFkLnJhY2VOdW1iZXIpfHwxO2xpbmVzLnB1c2goYO+8iOWVj+mhjOOBruOBguOCi+ODrOODvOOCuSAke3JufVIg44KS6Kq/44G544G+44GZ77yJYCk7dHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2RlYnVnLWVudHJ5P2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9JnJhY2U9JHtybn1gLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9Y2F0Y2goZSl7bGluZXMucHVzaCgi6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJvZGRzRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgib2Rkc091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgib2Rkc0RiZyIpLmRpc2FibGVkPXRydWU7CiBjb25zdCBMPVtg5pmC5Yi7ICR7bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDE2KS5yZXBsYWNlKCJUIiwiICIpfe+8iOaXpeacrOaZgumWk++8iWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY3M9V0suY2FyZHNbZF18fFtdLHZzPVsuLi5uZXcgU2V0KGNzLm1hcChjPT5TdHJpbmcoYy52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogICBmb3IoY29uc3QgdiBvZiB2cyl7CiAgICBjb25zdCBycz1jcy5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpPT09dik7CiAgICBjb25zdCBnb3Q9cnMuZmlsdGVyKGM9PldLLm9kZHNbcmtleShkLGMpXSkubWFwKGM9PmMucmFjZU51bWJlcikuam9pbigiLCIpLGxpbms9cnMuZmlsdGVyKGM9PmMub2Rkc0NuYW1lKS5tYXAoYz0+Yy5yYWNlTnVtYmVyKS5qb2luKCIsIik7CiAgICBMLnB1c2goYFxu4pagJHtkfSAke1ZFTlVFW3ZdfHx2fe+8muODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+WHuummrOihqOOBq+OCquODg+OCuuOBuOOBruODquODs+OCr+OBguOCiiBbJHtsaW5rfHwi44Gq44GXIn1d77yP44Kq44OD44K65Y+W5b6X5riI44G/IFske2dvdHx8IuOBquOBlyJ9XWApOwogICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzLWxpbmtzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgIEwucHVzaChgICDjgqrjg4PjgrrnlLvpnaLjga7jg6Hjg4vjg6Xjg7zjgavjgYLjgovjg6zjg7zjgrkgWyR7KHgubGlua3N8fFtdKS5tYXAoeT0+eS5yYWNlTm8pLmpvaW4oIiwiKXx8IuOBquOBlyJ9XWApOwogICAgIGZvcihjb25zdCBnIG9mICh4LmRpYWd8fFtdKSlMLnB1c2goIiAgIitKU09OLnN0cmluZ2lmeSh7c3RlcDpnLnN0ZXAsbGVuOmcuaHRtbExlbmd0aCxuOmcuY25hbWVzLGtpbmRzOmcua2luZHMsbWVudXM6Zy5tZW51cyxyYWNlczpnLnJhY2VzLGVycjpnLmVycm9yLHNhbXBsZTooZy5zYW1wbGV8fFtdKS5zbGljZSgwLDMpfSkpOwogICAgfWNhdGNoKGUpe0wucHVzaCgiICDjg6Hjg4vjg6Xjg7zlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgIH0KICB9CiB9ZmluYWxseXskKCJvZGRzRGJnIikuZGlzYWJsZWQ9ZmFsc2V9CiBvdXQudmFsdWU9TC5qb2luKCJcbiIpOwp9OwokKCJvZGRzQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgib2Rkc091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJvZGRzQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoIm9kZHNPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZGJnQ29weSIpLm9uY2xpY2s9YXN5bmMoKT0+e2NvbnN0IHQ9JCgiZGJnT3V0IikudmFsdWU7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHQpOyQoImRiZ0NvcHkiKS50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXskKCJkYmdPdXQiKS5zZWxlY3QoKTthbGVydCgi6YG45oqe44GX44G+44GX44Gf44CC44Kz44OU44O844GX44Gm44GP44Gg44GV44GE44CCIil9fTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKTtlLnRhcmdldC52YWx1ZT0iIn07CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gu5Y+W44KK55u044GX77yI5Y+W5b6X5riI44G/44Gu5pel44KS44CB5paw44GX44GE6aCF55uu44Gk44GN44Gn5Y+W44KK55u044GZ77yJCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KYXN5bmMgZnVuY3Rpb24gbGFwUmVmZXRjaChkZXBzKXsKIGNvbnN0IEQ9T2JqZWN0LmFzc2lnbih7aWRiQWxsLGlkYlB1dCxtZXRhR2V0LG1ldGFQdXQsZmV0Y2hEYXl9LGRlcHN8fHt9KTsKIGNvbnN0IGJhc2U9YmFzZVVybCgpLGE9JCgibGFwU3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpLG1zZz10PT57JCgibGFwU3RhdHVzIikuaW5uZXJIVE1MPXR9OwogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoImxhcEdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLGxhcHM6MCxjb3JuZXJzOjAsaG9yc2VzOjAsZmFpbDpbXSxza2lwcGVkOjAsdDA6RGF0ZS5ub3coKSxub2RhdGE6ZmFsc2Usc3RvcHBlZDpmYWxzZX07bGV0IGNvbnNlYz0wLHRvdGFsPTA7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IEQuaWRiQWxsKCkpLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgmJmYuZGF0ZT49YSYmZi5kYXRlPD15ZCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBjb25zdCB0b2RvPVtdOwogIGZvcihjb25zdCBmIG9mIGZpbGVzKXtpZihmLnJvd3Muc29tZShyPT5BcnJheS5pc0FycmF5KHIubGFwKSYmci5sYXAubGVuZ3RoKXx8YXdhaXQgRC5tZXRhR2V0KCJsYXBkb25lOiIrZi5kYXRlKSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfXRvZG8ucHVzaChmLmRhdGUpfQogIHRvdGFsPXRvZG8ubGVuZ3RoOwogIGlmKCF0b3RhbCl7bXNnKGDlj5bjgornm7TjgZnml6Xjga/jgYLjgorjgb7jgZvjgpPvvIgke2F95Lul6ZmN44GuJHtmaWxlcy5sZW5ndGh95pel44Gv44CB44GZ44G544Gm44Op44OD44OX44O76YCa6YGO6aCG5L2N44Gk44GN44Gn44GZ77yJ44CCYCk7cmV0dXJufQogIGZvcihsZXQgaT0wO2k8dG9kby5sZW5ndGg7aSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgZD10b2RvW2ldLGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICBtc2coYCR7ZH3vvIgke2krMX0vJHt0b3RhbH3ml6XvvInjgpLlj5blvpfkuK3igKZcbuWPluOCiuebtOOBlyR7c3QuZGF5c33ml6XvvI/jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrkgJHtzdC5sYXBzfS8ke3N0LnJhY2Vzfe+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmApOwogICB0cnl7CiAgICBjb25zdCByPWF3YWl0IEQuZmV0Y2hEYXkoYmFzZSxkKTsKICAgIGlmKHIuZmFpbGVkTil7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgIGNvbnN0IHJpZHM9bmV3IFNldChyLnJvd3MubWFwKHg9PngucmFjZUlkKSksbGFwUmFjZXM9bmV3IFNldChyLnJvd3MuZmlsdGVyKHg9PkFycmF5LmlzQXJyYXkoeC5sYXApJiZ4LmxhcC5sZW5ndGgpLm1hcCh4PT54LnJhY2VJZCkpOwogICAgY29uc3QgY29ybmVySG9yc2VzPXIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmNvcm5lcikmJnguY29ybmVyLmxlbmd0aD49MikubGVuZ3RoOwogICAgYXdhaXQgRC5pZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTsKICAgIGlmKGxhcFJhY2VzLnNpemV8fGNvcm5lckhvcnNlcylhd2FpdCBELm1ldGFQdXQoImxhcGRvbmU6IitkLHRydWUpOwogICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yaWRzLnNpemU7c3QubGFwcys9bGFwUmFjZXMuc2l6ZTtzdC5jb3JuZXJzKz1jb3JuZXJIb3JzZXM7c3QuaG9yc2VzKz1yLnJvd3MubGVuZ3RoO2NvbnNlYz0wOwogICAgaWYoc3QuZGF5cz49MiYmc3QubGFwcz09PTAmJnN0LmNvcm5lcnM9PT0wKXtzdC5ub2RhdGE9dHJ1ZTtTU1RPUD10cnVlfQogICB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgYXdhaXQgc2xlZXAoNDAwKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJsYXBHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICBjb25zdCByYXRlPSh4LHkpPT55P01hdGgucm91bmQoeC95KjEwMCkrIiUiOiItIjsKICBsZXQgaD1gJHtzdC5ub2RhdGE/JzxzcGFuIGNsYXNzPSJiYWQiPuODqeODg+ODl+OCgumAmumBjumghuS9jeOCguiqreOCgeOBvuOBm+OCk+OBp+OBl+OBn+OAguS4reaWreOBl+OBvuOBl+OBn+OAgjwvc3Bhbj5cbuOAjOiqreOBv+WPluOCiuOBruiouuaWreOAjeOCkuaKvOOBl+OAgeWHuuOBn+aWh+eroOOCkuiyvOOBo+OBpuOBj+OBoOOBleOBhOOAglxuJzooc3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOihTU1RPUD8i5YGc5q2i44GX44G+44GX44Gf44CCIjoi5a6M5LqG44CCIikpfWA7CiAgaCs9YOWPluOCiuebtOOBlyAke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJXG7jg6njg4Pjg5fjgpLoqq3jgoHjgZ/jg6zjg7zjgrnvvJoke3N0LmxhcHMudG9Mb2NhbGVTdHJpbmcoKX0vJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5sYXBzLHN0LnJhY2VzKX3vvIlcbumAmumBjumghuS9jeOCkuiqreOCgeOBn+mmrO+8miR7c3QuY29ybmVycy50b0xvY2FsZVN0cmluZygpfS8ke3N0LmhvcnNlcy50b0xvY2FsZVN0cmluZygpfe+8iCR7cmF0ZShzdC5jb3JuZXJzLHN0LmhvcnNlcyl977yJYDsKICBpZihzdC5mYWlsLmxlbmd0aCloKz1gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIife+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeaui+OCiuOBoOOBkee2muOBjeOBi+OCie+8iTwvc3Bhbj5gOwogIG1zZyhoKTt0cnl7YXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpfWNhdGNoKGUpe30KIH0KIHJldHVybiBzdDsKfQokKCJsYXBHbyIpLm9uY2xpY2s9KCk9PmxhcFJlZmV0Y2goKTsKJCgibGFwRGJnIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgibGFwT3V0Iik7b3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOwogdHJ5ewogIGNvbnN0IGZpbGVzPShhd2FpdCBpZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkuc29ydCgoeCx5KT0+eC5kYXRlPHkuZGF0ZT8tMToxKTsKICBpZighZmlsZXMubGVuZ3RoKXtvdXQudmFsdWU9IuWPluW+l+a4iOOBv+OBruaIkOe4vuOBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+OAjOKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KICBjb25zdCBkPWZpbGVzW2ZpbGVzLmxlbmd0aC0xXS5kYXRlLGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9qcmEtZGF5P2RhdGU9JHtkfWApLHJhY2VzPWRheS5yYWNlc3x8W107CiAgY29uc3Qgcj1yYWNlcy5maW5kKHg9PngucmFjZU5vPT09MTEpfHxyYWNlc1swXTsKICBpZighcil7b3V0LnZhbHVlPWAke2R9IOOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk2A7cmV0dXJufQogIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2VVcmwoKX0vZGVidWctcmVzdWx0P2NuYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHIuY25hbWUpfWApO2RlbGV0ZSB4Lm9rOwogIG91dC52YWx1ZT1g5pel5LuYICR7ZH0g6ZaL5YKs5aC0JHtyLnZlbnVlQ29kZX0gJHtyLnJhY2VOb31SXG5gK0pTT04uc3RyaW5naWZ5KHgpOwogfWNhdGNoKGUpe291dC52YWx1ZT0i6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgppZigvXmh0dHBzPzovLnRlc3QobG9jYXRpb24ucHJvdG9jb2wpKSQoInd1cmwiKS52YWx1ZT1sb2NhdGlvbi5vcmlnaW47ZWxzZSAkKCJ3dXJsIikudmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2IjsKcmVuZGVyR2F0ZSgpO3JlbmRlckFsbCgpOwooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBwZWRpZ3JlZUxvYWQoKTthd2FpdCBtb2RlbHNGcm9tTWV0YSgpO2F3YWl0IHJlZnJlc2hEYXRhTGFzdCgpO2F3YWl0IHNob3dTdGF0ZSgpO3JlbmRlck1vZGVsU3RhdHVzKCk7YXdhaXQgYmtJbml0KCl9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuS/neWtmOmgmOWfn+OCkumWi+OBkeOBvuOBm+OCk++8miR7ZXNjKGUubWVzc2FnZSl9XG7vvIjjg5fjg6njgqTjg5njg7zjg4jjg5bjg6njgqbjgrrjgafjga/kvb/jgYjjgarjgYTjgZPjgajjgYzjgYLjgorjgb7jgZnvvIk8L3NwYW4+YH19KSgpOwoKPC9zY3JpcHQ+CjwvYm9keT48L2h0bWw+Cg==";
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
