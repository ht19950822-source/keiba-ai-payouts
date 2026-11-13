/* =========================================================
 * 競馬AI Worker（再構築版）
 *  - JRAの出馬表・結果・払戻・オッズの取得（動作確認済みの取得部分を整理して再利用）
 *  - 自動バックアップ（KV: BACKUP）
 *  - 画面（/）。計算は端末のブラウザ側で行うため、Workerは軽く保つ
 * ======================================================= */
const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-14-rebuild-13";

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
    const have = [...seeds.values()].filter(r => r.date === date && (!venueFilter || r.venueCode === venueFilter)).length;
    if (have < 12) {
      menuInfo = await discoverJRAEntryLinksViaMenu(date, diagnostics, venueFilter);
      for (const link of menuInfo.links) seeds.set(link.cname, link);
    }
  }

  const baseSeeds = [...seeds.values()];
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
        matches.set(`${race.date}-${race.venueCode}-${race.raceNo}`, {
          ...race,
          entryInfo: extractJRAEntryInfo(html),
          htmlLength: html.length
        });
      }

      for (const link of links) {
        if (visited.has(link.cname) || queued.has(link.cname)) continue;
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
    trackCondition: "",
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
    const rowSummary = horseRows.slice(0, 24).map(t => { const h = parseJRAEntryHorseRow(t); return h ? h.horseNumber + "|" + h.horseName + "|J:" + (h.jockey || "-") + "|T:" + (h.trainer || "-") : "×解析不可:" + (extractEntryHorseName(t) || "名前なし") + "|" + t.replace(/\s+/g, " ").slice(0, 160); });
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnq7bppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56u26aasQUk8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOTstLW9rOiMxMzczMzM7LS13bjojYzI2YTAwOy0tbmc6I2I0MjMxOH0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMDstLW9rOiM1YWMxN2E7LS13bjojZjBhNjRhOy0tbmc6I2ZmOGE4MH19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWY7cGFkZGluZy1ib3R0b206ZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20sMCl9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6Y2FsYygxMnB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC10b3AsMCkpIDE2cHggMTJweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE4cHh9Cm1haW57bWF4LXdpZHRoOjkyMHB4O21hcmdpbjphdXRvO3BhZGRpbmc6MTBweH0Kc2VjdGlvbiwuY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjE0cHg7bWFyZ2luOjEwcHggMDtib3gtc2hhZG93OjAgMXB4IDRweCAjMDAwMX0KaDJ7Zm9udC1zaXplOjE2cHg7bWFyZ2luOjAgMCA4cHh9aDN7Zm9udC1zaXplOjE0cHg7bWFyZ2luOjEycHggMCA2cHh9CmJ1dHRvbntib3JkZXI6MDtib3JkZXItcmFkaXVzOjlweDtwYWRkaW5nOjExcHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLXByKTtjb2xvcjojZmZmO2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW46NHB4IDRweCA0cHggMDtmb250LXNpemU6MTRweH0KYnV0dG9uOmRpc2FibGVke29wYWNpdHk6LjR9YnV0dG9uLnN1YntiYWNrZ3JvdW5kOiM2NjcwODV9YnV0dG9uLmJpZ3tkaXNwbGF5OmJsb2NrO3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxNnB4O21hcmdpbjo4cHggMH0KYnV0dG9uLm1pbml7cGFkZGluZzo1cHggOXB4O2ZvbnQtc2l6ZToxMnB4O21hcmdpbjoycHggNHB4IDJweCAwfQppbnB1dCxzZWxlY3R7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCV9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXA7Zm9udC1zaXplOjEzcHh9Ci5nb29ke2NvbG9yOnZhcigtLW9rKTtmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6dmFyKC0td24pO2ZvbnQtd2VpZ2h0OjcwMH0uYmFke2NvbG9yOnZhcigtLW5nKTtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodDt2ZXJ0aWNhbC1hbGlnbjp0b3B9CnRoOmZpcnN0LWNoaWxkLHRkOmZpcnN0LWNoaWxke3RleHQtYWxpZ246bGVmdH0KLndyYXB7b3ZlcmZsb3cteDphdXRvfQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9Ci50YWJze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nOjRweCAwO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjV9Ci50YWJzIGJ1dHRvbnt3aGl0ZS1zcGFjZTpub3dyYXA7YmFja2dyb3VuZDojNjY3MDg1O21hcmdpbjowfS50YWJzIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOnZhcigtLXByKX0KLmNhbmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OXB4O21hcmdpbjo4cHggMH0KLmNoaXB7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC1zaXplOjEycHg7Ym9yZGVyLXJhZGl1czo5OTlweDtwYWRkaW5nOjJweCA4cHg7bWFyZ2luOjNweCA0cHggMCAwO2JhY2tncm91bmQ6I2VlZjFmNTtjb2xvcjojMzQ0MDU0fQouY2hpcC5ie2JhY2tncm91bmQ6I2UwZjJlNjtjb2xvcjojMTM3MzMzfS5jaGlwLm97YmFja2dyb3VuZDojZmZlZmNmO2NvbG9yOiM5YTVhMDB9LmNoaXAucntiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6I2I0MjMxOH0KLnJ0e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjAgN3B4O2NvbG9yOiNmZmY7YmFja2dyb3VuZDojOThhMmIzfQoucnQuclN7YmFja2dyb3VuZDojZDkyZDIwfS5ydC5yQXtiYWNrZ3JvdW5kOiNmNzkwMDl9LnJ0LnJCe2JhY2tncm91bmQ6IzE2NjdkOX0KLmJhbm5lcntib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O21hcmdpbjo4cHggMDtmb250LXNpemU6MTNweH0KLmJhbm5lci5uZ3tiYWNrZ3JvdW5kOiNmZGU0ZTE7Y29sb3I6IzdhMjcxYX0uYmFubmVyLm9re2JhY2tncm91bmQ6I2RjZjVlMztjb2xvcjojMGI1YTI1fS5iYW5uZXIud257YmFja2dyb3VuZDojZmZmMWQ2O2NvbG9yOiM3YTRhMDB9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYmFubmVyLm5ne2JhY2tncm91bmQ6IzNiMTcxNDtjb2xvcjojZmZiNGE4fS5iYW5uZXIub2t7YmFja2dyb3VuZDojMTIzMDFiO2NvbG9yOiM4YmUwYTZ9LmJhbm5lci53bntiYWNrZ3JvdW5kOiMzODI4MGE7Y29sb3I6I2ZmZDI4YX0uY2hpcHtiYWNrZ3JvdW5kOiMyYjM0M2U7Y29sb3I6I2NmZDZkZX19CmRldGFpbHM+c3VtbWFyeXtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7cGFkZGluZzo2cHggMH0KLnZpZXd7ZGlzcGxheTpub25lfS52aWV3Lm9ue2Rpc3BsYXk6YmxvY2t9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nq7bppqxBSSA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxMnB4Ij7lho3mp4vnr4nniYg8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgoKPGRpdiBjbGFzcz0iY2FyZCI+CiA8aDI+44Ov44Oz44Oc44K/44Oz5pON5L2cPC9oMj4KIDxidXR0b24gaWQ9IndrR28iIGNsYXNzPSJiaWciPuKRoCDku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgos8L2J1dHRvbj4KIDxkaXYgaWQ9IndrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYzjgILmirzjgZnjgajjgIHlh7rppqzooajjg7vpqI7miYvjg7voqr/mlZnluKvjg7vjgqrjg4PjgrrjgpLlj5blvpfjgZfjgIHlhajjg6zjg7zjgrnjgpLop6PmnpDjgZfjgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0id2tPZGRzIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7jgqrjg4PjgrrjgaDjgZHmm7TmlrA8L2J1dHRvbj48L2Rpdj4KCiA8YnV0dG9uIGlkPSJzeW5jR28iIGNsYXNzPSJiaWciPuKRoSDpgY7ljrvjg6zjg7zjgrnjgpLlj5blvpfjgZnjgos8L2J1dHRvbj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY1N0b3AiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWBnOatojwvYnV0dG9uPjxzcGFuIGNsYXNzPSJzbWFsbCI+5q2i44KB44Gm44KC57aa44GN44GL44KJ5YaN6ZaL44Gn44GN44G+44GZPC9zcGFuPjwvZGl2PgogPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CiA8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuacn+mWk+ODu+aOpee2muWFiOOCkuWkieOBiOOCizwvc3VtbWFyeT4KICA8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KICA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iIj48L2Rpdj4KIDwvZGV0YWlscz4KCiA8YnV0dG9uIGlkPSJia09uZSIgY2xhc3M9ImJpZyI+4pGiIOODkOODg+OCr+OCouODg+ODl+OCkuS9nOaIkOOBmeOCizwvYnV0dG9uPgogPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2PgogPGRpdiBpZD0iZGF0YVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+56K66KqN5Lit4oCmPC9kaXY+CjwvZGl2PgoKPGRpdiBjbGFzcz0idGFicyIgaWQ9InRhYnMiPgogPGJ1dHRvbiBkYXRhLXRhYj0idkF4aXMiIGNsYXNzPSJvbiI+6LaF6YmE5p2/PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2RXYiPuacn+W+heWApDwvYnV0dG9uPgogPGJ1dHRvbiBkYXRhLXRhYj0idlVwc2V0Ij7ms6LkubHluqY8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZIb2xlIj7nqbTppqw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZSYWNlcyI+5YWo44Os44O844K5PC9idXR0b24+CiA8YnV0dG9uIGRhdGEtdGFiPSJ2U3VtIj7lj5bjgorovrzjgb/nirbms4E8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZUZXN0Ij7mpJzoqLw8L2J1dHRvbj4KIDxidXR0b24gZGF0YS10YWI9InZTZXQiPuioreWumjwvYnV0dG9uPgo8L2Rpdj4KCjxkaXYgaWQ9ImdhdGUiPjwvZGl2PgoKPGRpdiBpZD0idkF4aXMiIGNsYXNzPSJ2aWV3IG9uIGNhcmQiPjxkaXYgY2xhc3M9InNtYWxsIj7jgIzku4rpgLHmnKvjga7jg6zjg7zjgrnjgpLlj5blvpfjgZfjgabkuojmg7PjgZnjgovjgI3jgpLmirzjgZnjgajooajnpLrjgZXjgozjgb7jgZnjgII8L2Rpdj48L2Rpdj4KPGRpdiBpZD0idkV2IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idlVwc2V0IiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KPGRpdiBpZD0idkhvbGUiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2UmFjZXMiIGNsYXNzPSJ2aWV3IGNhcmQiPjwvZGl2Pgo8ZGl2IGlkPSJ2U3VtIiBjbGFzcz0idmlldyBjYXJkIj48L2Rpdj4KCjxkaXYgaWQ9InZUZXN0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7lm57lj47njofjga7mpJzoqLzvvIjmiZXmiLvjgaTjgY3jg7vmmYLns7vliJfvvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruaIkOe4vuOBqOaJleaIu+OBp+OAgeOAjOOBneOBruaXpeOCiOOCiuWJjeOBruaIkOe4vuOBoOOBkeOAjeOCkuS9v+OBhuODkOODg+OCr+ODhuOCueODiOOCkuOBl+OBvuOBme+8iOWQhOODrOODvOOCuTEwMOWGhu+8ieOAguOBk+OBk+OBpzxiPuWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk+OBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgIHoqqTlt67jga7luYXjgpLlvJXjgYTjgabjgoIxMDAl5Lul5LiKPC9iPuOBqOeiuuiqjeOBp+OBjeOBn+iyt+OBhOaWueOBoOOBkeOBjOOAgeeUu+mdouS4iuOBp+OAjOaknOiovOa4iOOBv+OAjeOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJidEdyYWRlIiBjbGFzcz0ic3ViIj7ph43os57jgaDjgZHvvJrjgrDjg6zjg7zjg4noo5zmraPjgYLjgoov44Gq44GX44KS5q+U6LyDPC9idXR0b24+PC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5rOi5Lmx5bqm44Gu5L+h6aC85bqm44KS5LiK44GS44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7pgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHms6LkubHluqbjga7kuojmuKzjgajlrp/pmpvjga7ms6LkubHnjofjgpLnqoHjgY3lkIjjgo/jgZvjgb7jgZnjgILjgrPjg7zjgrnliKXvvIjplovlgqzloLTDl+iKneODgMOX6Led6Zuiw5fjgq/jg6njgrnvvInjga7pgY7ljrvms6LkubHnjofjgpLotrPjgZfjgZ/mlrDjg6Ljg4fjg6vjgpLkvZzjgorjgIE8Yj7nj77ooYzjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpM8L2I+44Gn5q+U44G544Gm44CB5piO56K644Gr6Imv44GE44Go44GN44Gg44GR5o6h55So44GX44G+44GZ44CC6Imv44GP44Gq44KJ44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gn44CB562J57Sa44GU44Go44Gu5a6f57i+546H44Gg44GR44KS5qSc6Ki844GX44Gf5pWw5a2X44Gr5beu44GX5pu/44GI44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPuaknOiovOOBrumWi+Wni+aXpSA8aW5wdXQgaWQ9InVwU3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIxLTAxLTAxIj48YnV0dG9uIGlkPSJ1cFJ1biI+5rOi5Lmx5bqm44KS5qSc6Ki844O75YaN5qCh5q2jPC9idXR0b24+PGJ1dHRvbiBpZD0idXBDbGVhciIgY2xhc3M9InN1YiI+5qiZ5rqW44Gr5oi744GZPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJ1cE91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGM77yI6YGO5Y6744Os44O844K544Gu5Y+W5b6X5b6M44Gr5a6f6KGM44CC5pWw5YiG44GL44GL44KK44G+44GZ77yJPC9kaXY+CiA8aDIgc3R5bGU9Im1hcmdpbi10b3A6MTRweCI+5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44KS5q2j56K644Gr44GZ44KL77yI5YaN5qCh5q2j77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7lkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44KP44Gb44G+44GZ44CC6YGO5Y675oiQ57i+44GL44KJ5L2c44KL56K6546H44Go44CB5Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7pgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS57WE44G/5ZCI44KP44Gb44Gf5paw44Oi44OH44Or44KS5L2c44KK44CBPGI+54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaTPC9iPuOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OBvuOBmeOAguaYjueiuuOBq+iJr+OBhOOBqOOBjeOBoOOBkeaOoeeUqOOBl+OAgei2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWfuua6luOCguOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7mpJzoqLzjga7plovlp4vml6UgPGlucHV0IGlkPSJwbFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAxOS0wMS0wMSI+PGJ1dHRvbiBpZD0icGxSdW4iPuWlvei1sOeOh+OCkuaknOiovOODu+WGjeagoeatozwvYnV0dG9uPjxidXR0b24gaWQ9InBsQ2xlYXIiIGNsYXNzPSJzdWIiPuaomea6luOBq+aIu+OBmTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0icGxPdXQiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjO+8iOmBjuWOu+ODrOODvOOCueOBruWPluW+l+W+jOOBq+Wun+ihjOOAguaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iTwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KIDxkaXYgaWQ9ImJ0T3V0IiBjbGFzcz0ic3RhdHVzIj7jg4fjg7zjgr/lj5blvpfjga7jgYLjgajjgaflrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPC9kaXY+Cgo8ZGl2IGlkPSJ2U2V0IiBjbGFzcz0idmlldyBjYXJkIj4KIDxoMj7jg5Djg4Pjgq/jgqLjg4Pjg5foqK3lrprvvIhDbG91ZGZsYXJl44Gr5L+d5a2Y77yJPC9oMj4KIDxkaXYgY2xhc3M9InNtYWxsIj7jg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU244Gg44GR44KS5L2/44Gj44Gm5L+d5a2Y5YWI44KS5YiG44GR44G+44GZ77yI44OR44K544OV44Os44O844K66Ieq5L2T44Gv6YCB44KK44G+44Gb44KT77yJ44CC5ZCM44GY44OR44K544OV44Os44O844K644Gn5b6p5YWD44Gn44GN44G+44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYmtQYXNzIiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IuODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvIkiIGF1dG9jb21wbGV0ZT0ib2ZmIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMDBweCI+PGJ1dHRvbiBpZD0iYmtTaG93IiBjbGFzcz0ic3ViIj7ooajnpLo8L2J1dHRvbj48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iYmtBdXRvIiB0eXBlPSJjaGVja2JveCIgY2hlY2tlZD4g5aSJ5pu044GM44GC44KM44Gw6Ieq5YuV44Gn44OQ44OD44Kv44Ki44OD44OX44GZ44KLPC9sYWJlbD48L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYmtOb3ciPuS7iuOBmeOBkOW3ruWIhuODkOODg+OCr+OCouODg+ODlzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrUmVzdG9yZSIgY2xhc3M9InN1YiI+44OQ44OD44Kv44Ki44OD44OX44GL44KJ5b6p5YWDPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtGdWxsIiBjbGFzcz0ic3ViIj7jgZnjgbnjgabkv53lrZjjgZfnm7TjgZk8L2J1dHRvbj48L2Rpdj4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7pgY7ljrvjg4fjg7zjgr/jga7oqq3jgb/ovrzjgb/vvIjku7vmhI/vvIk8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuS7peWJjeOBruODkOODg+OCr+OCouODg+ODl0pTT07vvI/miJDnuL5DU1bjgYzjgYLjgozjgbDoqq3jgb/ovrzjgoHjgb7jgZnvvIjlkIzjgZjml6Xjga/ph43opIfjgZfjgb7jgZvjgpPvvInjgII8L2Rpdj4KIDxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgogPGgyIHN0eWxlPSJtYXJnaW4tdG9wOjE0cHgiPuiouuaWrTwvaDI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5Ye66aas6KGo44Gu6Kqt44G/5Y+W44KK44Gr5ZWP6aGM44GM44GC44KL44Go44GN44CB6ZaL5YKs5aC044GU44Go44GrMVLjga7jg5rjg7zjgrjjga7kuK3ouqvjgpLoqr/jgbnjgabkuIvjgavlh7rjgZfjgb7jgZnjgILjgrPjg5Tjg7zjgZfjgabpgIHjgaPjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iZGJnR28iIGNsYXNzPSJzdWIiPuiouuaWreaDheWgseOCkuS9nOOCizwvYnV0dG9uPjxidXR0b24gaWQ9ImRiZ0NvcHkiIGNsYXNzPSJzdWIiPuOCs+ODlOODvDwvYnV0dG9uPjwvZGl2PgogPHRleHRhcmVhIGlkPSJkYmdPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxNDBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KIDxoMiBzdHlsZT0ibWFyZ2luLXRvcDoxNHB4Ij7jg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZc8L2gyPgogPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+a4iOOBv+OBruODrOODvOOCueOCkuOAgeODrOODvOOCueWFqOS9k+OBruODqeODg+ODl++8iOODj+ODreODs+OCv+OCpOODoO+8ieOBqOWQhOmmrOOBruOCs+ODvOODiuODvOmAmumBjumghuS9jeOBpOOBjeOBp+WPluOCiuebtOOBl+OBvuOBme+8iOODmuODvOOCueODu+iEmuizquOCkuS6iOaDs+OBq+S9v+OBhuOBn+OCgeOBrua6luWCme+8ieOAguS/neWtmOa4iOOBv+OBruaXpeOBr+S4iuabuOOBjeOBleOCjOOBvuOBmeOAguatouOCgeOBpuOCgue2muOBjeOBi+OCieWGjemWi+OBp+OBjeOBvuOBmeOAguOBvuOBmuaWsOOBl+OBhOacn+mWk+OBi+OCieWwkeOBl+OBoOOBkeippuOBl+OBpuOAgeiqreOCgeOBpuOBhOOCi+OBi+OCkueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJsYXBTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjYtMDEtMDEiPjxidXR0b24gaWQ9ImxhcEdvIj7lj5bjgornm7TjgZk8L2J1dHRvbj48YnV0dG9uIGlkPSJsYXBEYmciIGNsYXNzPSJzdWIiPuiqreOBv+WPluOCiuOBruiouuaWrTwvYnV0dG9uPjwvZGl2PgogPGRpdiBpZD0ibGFwU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYw8L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ibGFwT3V0IiByZWFkb25seSBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTIwcHg7Zm9udC1zaXplOjEycHgiPjwvdGV4dGFyZWE+CjwvZGl2PgoKPC9tYWluPgo8ZGl2IGlkPSJidXN5Ij48ZGl2PjxkaXYgaWQ9ImJ1c3lUZXh0Ij7lh6bnkIbkuK3igKY8L2Rpdj48L2Rpdj48L2Rpdj4KPHNjcmlwdD4KY29uc3QgVUU9KCgpPT57CiAvKiDlrp/jg4fjg7zjgr/mpJzoqLzjgafpgIblirnmnpzjgaDjgaPjgZ/miJDliIbvvIjpqI7miYvjg7vplpPpmpTvvInjga/ml6LlrprjgadPRkYgKi8KIGNvbnN0IERFRkFVTFQ9e2pvY2tleTpmYWxzZSxsYXlvZmY6ZmFsc2V9OwogY29uc3QgY2xhbXA9KHgsYSxiKT0+TWF0aC5tYXgoYSxNYXRoLm1pbihiLHgpKTsKIGNvbnN0IHNpZ21vaWQ9eD0+MS8oMStNYXRoLmV4cCgteCkpOwogY29uc3QgbG9naXQ9cD0+e3A9Y2xhbXAocCwuMDAxLC45OTkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CiBjb25zdCBubj1zPT5TdHJpbmcocz8/IiIpLm5vcm1hbGl6ZSgiTkZLQyIpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW1xzXHUzMDAwXSsvZywiIikucmVwbGFjZSgvW+ODu++9pS7vvI5cLeKAkOKAkeKAkuKAk+KAlOKAlSfigJlgXS9nLCIiKS5yZXBsYWNlKC9b4piG4piF4paz4pay4peH4peGXS9nLCIiKTsKIC8qIOmojuaJi+WQje+8muWFiOmgreOBruasp+Wtl+OCpOODi+OCt+ODo+ODq+OCkumZpOOBjeOAgeODh+ODoOODvOODreKGkuODh+ODoCDjgavmj4PjgYjjgovvvIhKUkHjga4gQy7jg4fjg6Djg7zjg60g44Go6YGO5Y6744OH44O844K/44GuIO+8o++8juODh+ODoCDjgpLkuIDoh7TjgZXjgZvjgovvvIkgKi8KIGNvbnN0IGpubj1zPT57bGV0IHY9bm4oU3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9cZHsyfSg/OlwuXGQpP1xzKig/OmtnfO+9i++9hykvZ2ksIiAiKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsOH1b77yJKV0vZywiICIpLnJlcGxhY2UoLyjmoJfmnbF8576O5rWmKS9nLCIgIikpO3Y9di5yZXBsYWNlKC9eW2Etel0oPz1b44KhLeODtuODvF0pLywiIik7dj12LnJlcGxhY2UoL17jg4fjg6Djg7zjg60vLCLjg4fjg6AiKTtyZXR1cm4gdn07CiAvKiDjgq/jg6njgrnjga7mrrXpmo7vvJowPeS4jeaYjiAvIC0xPeWcsOaWuSAvIDE95paw6aas44O75pyq5Yud5YipIC8gMj0x5YudIC8gMz0y5YudIC8gND0z5YudIC8gNT3jgqrjg7zjg5fjg7Pjg7vph43os54gKi8KIGNvbnN0IGxldmVsT2ZMYWJlbD10PT57Y29uc3Qgcz1TdHJpbmcodHx8IiIpO2lmKC/lnLDmlrl8TkFSLy50ZXN0KHMpKXJldHVybiAtMTtpZigv5paw6aasfOacquWLneWIqS8udGVzdChzKSlyZXR1cm4gMTtpZigvMeWLnXw1MDDkuIcvLnRlc3QocykpcmV0dXJuIDI7aWYoLzLli518MTAwMOS4hy8udGVzdChzKSlyZXR1cm4gMztpZigvM+WLnXwxNjAw5LiHLy50ZXN0KHMpKXJldHVybiA0O2lmKC/jgqrjg7zjg5fjg7N877yv77ywfE9QfOODquOCueODhuODg+ODiXzph43os55877ynfEdbMTIzSV0vaS50ZXN0KHMpKXJldHVybiA1O3JldHVybiAwfTsKIGNvbnN0IGxldmVsT2ZQcml6ZT1wPT57cD1OdW1iZXIocCk7cmV0dXJuICEocD4wKT8wOnA8PTcwMD8xOnA8PTkwMD8yOnA8PTEzMDA/MzpwPD0xODAwPzQ6NX07CiAvKiDimIXjgrDjg6zjg7zjg4nvvIjmoLzvvInvvJowPeS4jeaYji/kuIvntJogMT1PUOODu+ODquOCueODhuODg+ODiSAyPUczIDM9RzIgND1HMeOAggogICAg5b6T5p2l44GvIEcxL0cyL0czL09QIOOCkuOBmeOBueOBpuOAjDXjgI3jgavmvbDjgZfjgabjgYTjgZ/jgZ/jgoHjgIFHM+WLneOBoeOBjCBHMSDjgafjgoLlibLlvJXjgZXjgozjgarjgYvjgaPjgZ/jgIIKICAgIOWIpOWumumghu+8muODqeODmeODq++8iE5GS0PlvowgR0kvR0lJL0dJSUkvRzHjgJxHM++8ieKGkiAx552A6LOe6YeR77yI5LiH5YaG77yJ4oaS77yI5a++6LGh44Os44O844K544Gu44G/77yJRzHjg6zjg7zjgrnlkI0gKi8KIGNvbnN0IEcxX05BTUVTPS/lpKnnmofos5585pyJ6aas6KiY5b+1fOOCuOODo+ODkeODs+OCq+ODg+ODl3zjgrjjg6Pjg5Hjg7PvvKN85a6d5aGa6KiY5b+1fOWuieeUsOiomOW/tXzjg7TjgqPjgq/jg4jjg6rjgqLjg57jgqTjg6t85aSn6Ziq5p2vfOmrmOadvuWuruiomOW/tXzjg5Xjgqfjg5bjg6njg6rjg7x844OB44Oj44Oz44OU44Kq44Oz44K6fOOCueODl+ODquODs+OCv+ODvOOCunzjg57jgqTjg6vjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrfjg4Pjg5d844Ko44Oq44K244OZ44K55aWz546L5p2vfOeni+iPr+iznnzoj4roirHos5585qGc6Iqx6LOefOOCquODvOOCr+OCuXzlhKrpp7/niZ3ppqx85pel5pys44OA44O844OT44O8fOadseS6rOWEqumnv3znmpDmnIjos558TkhL44Oe44Kk44OrfOmYquelnuOCuOODpeODmeODiuOCpOODq3zmnJ3ml6Xmna9844Ob44O844OX44OV44OrLzsKIGNvbnN0IGdyYWRlVGllcj0odGV4dCxwcml6ZSxieU5hbWUpPT57Y29uc3Qgcz1TdHJpbmcodGV4dHx8IiIpLm5vcm1hbGl6ZSgiTkZLQyIpOwogIGlmKC/pmpzlrrN844K444Oj44Oz44OXfEpcLj9ccz9HL2kudGVzdChzKSlyZXR1cm4gMDsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/OklJSXwzKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMjsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/OklJfDIpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAzOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SXwxKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gNDsKICBjb25zdCBwPU51bWJlcihwcml6ZSk7aWYocD4wKXJldHVybiBwPj0xMDAwMD80OnA+PTUwMDA/MzpwPj0zNTAwPzI6cD49MTgwMD8xOjA7CiAgaWYoYnlOYW1lJiZHMV9OQU1FUy50ZXN0KHMpKXJldHVybiA0OwogIGlmKC/jg6rjgrnjg4bjg4Pjg4l844Kq44O844OX44OzfO+8r++8sHxcYk9QXGIvLnRlc3QocykpcmV0dXJuIDE7CiAgcmV0dXJuIDB9OwogY29uc3QgaXNKcmFWZW51ZT1jPT4vXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoY3x8IiIpKTsKIGNvbnN0IHN1cmZDb2RlPXM9PntzPVN0cmluZyhzfHwiIik7cmV0dXJuIC/oip18dHVyZi9pLnRlc3Qocyk/MTov44OAfGRpcnQvaS50ZXN0KHMpPzI6L+manHxqdW1wL2kudGVzdChzKT8zOjB9OwogY29uc3QgZG51bT1kPT5OdW1iZXIoU3RyaW5nKGR8fCIiKS5yZXBsYWNlKC9cRC9nLCIiKS5zbGljZSgwLDgpKXx8MDsKIGZ1bmN0aW9uIHBhcnNlRGF0ZShzKXsKICBzPVN0cmluZyhzfHwiIik7bGV0IG09cy5tYXRjaCgvKFxkezR9KVxEezAsNH0oXGR7MSwyfSlcRHswLDR9KFxkezEsMn0pLyk7CiAgaWYoIW0pcmV0dXJuIiI7cmV0dXJuIGAke21bMV19LSR7bVsyXS5wYWRTdGFydCgyLCIwIil9LSR7bVszXS5wYWRTdGFydCgyLCIwIil9YDsKIH0KIGZ1bmN0aW9uIGNzdlJvd3ModGV4dCl7CiAgY29uc3QgbGluZXM9U3RyaW5nKHRleHR8fCIiKS5yZXBsYWNlKC9eXHVGRUZGLywiIikuc3BsaXQoL1xyP1xuLykuZmlsdGVyKHg9PngudHJpbSgpKTsKICBpZighbGluZXMubGVuZ3RoKXJldHVybltdOwogIGNvbnN0IHNwbGl0PWw9Pntjb25zdCBhPVtdO2xldCBjPSIiLHE9ZmFsc2U7Zm9yKGxldCBpPTA7aTxsLmxlbmd0aDtpKyspe2NvbnN0IGNoPWxbaV07CiAgIGlmKGNoPT09JyInKXtpZihxJiZsW2krMV09PT0nIicpe2MrPSciJztpKyt9ZWxzZSBxPSFxfWVsc2UgaWYoY2g9PT0iLCImJiFxKXthLnB1c2goYyk7Yz0iIn1lbHNlIGMrPWNofWEucHVzaChjKTtyZXR1cm4gYX07CiAgY29uc3QgaGVhZD1zcGxpdChsaW5lc1swXSkubWFwKHg9PngudHJpbSgpKTtjb25zdCBvdXQ9W107CiAgZm9yKGxldCBpPTE7aTxsaW5lcy5sZW5ndGg7aSsrKXtjb25zdCBhPXNwbGl0KGxpbmVzW2ldKSxvPXt9O2ZvcihsZXQgaj0wO2o8aGVhZC5sZW5ndGg7aisrKW9baGVhZFtqXV09YVtqXT8/IiI7b3V0LnB1c2gobyl9CiAgcmV0dXJuIG91dDsKIH0KIGNvbnN0IGY9dj0+e2NvbnN0IG49cGFyc2VGbG9hdChTdHJpbmcodj8/IiIpLnJlcGxhY2UoLywvZywiIikpO3JldHVybiBOdW1iZXIuaXNGaW5pdGUobik/bjpudWxsfTsKIC8qIOODkOODg+OCr+OCouODg+ODly9DU1bjga4x6KGM4oaS6Lu96YeP6KGMICovCiBjb25zdCBjbGVhblRyPXQ9PlN0cmluZyh0fHwiIikucmVwbGFjZSgvXHMrL2csIiAiKS50cmltKCkucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDZ9W++8iSldL2csIiAiKS5yZXBsYWNlKC8oPzrmoJfmnbF8576O5rWmfOWcsOaWuXzlpJblm7185oub5b6FKVxzKlvjg7vvvaVdPy9nLCIgIikucmVwbGFjZSgvW+ODu++9pV0vZywiICIpLnJlcGxhY2UoL1xzKy9nLCIgIikudHJpbSgpOwogZnVuY3Rpb24gdG9Sb3cobyl7Y29uc3QgX3I9dG9Sb3cwKG8pO19yLnRyYWluZXI9Y2xlYW5UcihvWyLoqr/mlZnluKsiXXx8by50cmFpbmVyfHwiIik7X3IuZ3JkPWdyYWRlVGllcihTdHJpbmcob1siY2xhc3MiXXx8by5jbHN8fCIiKSsiICIrU3RyaW5nKG9bIuODrOODvOOCueWQjSJdfHxvLnJhY2VfbmFtZXx8by5yYWNlbmFtZXx8IiIpLG51bGwsZmFsc2UpO3JldHVybiBfcn0KIGZ1bmN0aW9uIHRvUm93MChvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICBoLm4rKztoLnRvcDMrPXQzO2lmKHIuZmluaXNoPT09MSloLndpbisrO2guc3VtKz1yLmZpbmlzaDtpZihyLmRhdGU+aC5sYXN0KWgubGFzdD1yLmRhdGU7CiAgY29uc3QgTD1yLmx2bHx8MDsoaC5sdltMXT1oLmx2W0xdfHxbMCwwXSk7aC5sdltMXVswXSsrO2gubHZbTF1bMV0rPXQzOwogIGgucnVucy5wdXNoKFtkbnVtKHIuZGF0ZSksci5maW5pc2gsci5kaXN0LHIuc3VyZixMLHIuZ3JkfHwwLHIuY2Y9PW51bGw/LTE6ci5jZl0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOKYheagvOS4iuOBkuijnOato++8muWtpue/kua4iOOBv+ODouODh+ODq+OBr+edgOmghuOCkuOBneOBruOBvuOBvuimi+OCi+OBruOBp+OAgeS4i+S9jeOCsOODrOODvOODieOBp+OBruWlvei1sOOBjOmHjeiznuODu0cx44Gn44KC5ZCM5L6h5YCk44Gr44Gq44Gj44Gm44GE44Gf44CCCiAgICDnm7Tov5Ez6LWw44Gu44GG44GhIE9QL+mHjeiznijjgq/jg6njgrk1KeOBrui1sOOBq+OBpOOBhOOBpuOAgeS7iuWbnuOBruOCsOODrOODvOODieOBqOOBruW3ruOBoOOBkeijnOato+OBmeOCi++8iOOCr+ODqeOCuTTku6XkuIvjga/jg6Ljg4fjg6vlgbTjga7oo5zmraPjgYzjgYLjgovjga7jgafkuozph43mjpvjgZHjgZfjgarjgYTvvInjgIIKICAgICAg5qC85LiK44GS77yI5L6LIEcz4oaSRzHvvInvvJrlpb3otbDjga7kvqHlgKTjgpLlibLjgorlvJXjgY/vvIjnnYDpoIbjgYzoia/jgYTjgbvjganlpKfjgY3jgY/vvIkKICAgICAg5qC85LiL44GS77yI5L6LIEcx4oaSRzLvvInvvJrlh6HotbDjga7kvqHlgKTjgpLlsJHjgZfmiLvjgZkKICAgIOS/guaVsOOBr+aaq+WumuWApOOAguKRoC0y44Gu44CM44Kw44Os44O844OJ6KOc5q2j44Gu5Yq55p6c5q+U6LyD44CN44Gn44CB6KOc5q2j44GC44KKL+OBquOBl+OCkuWQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+avlOOBueOBpueiuuiqjeOBmeOCi+OBk+OBqOOAgiAqLwogY29uc3QgR1JBREU9e29uOnRydWUsS1VQOi4zMCxLRE46LjEyLE1JTjotLjksTUFYOi41fTsKIGZ1bmN0aW9uIGdyYWRlQWRqKHIsc3RvcmUscmFjZSxjb21wKXsKICBpZighR1JBREUub258fChjb21wJiZjb21wLmdyYWRlPT09ZmFsc2UpKXJldHVybiAwOwogIGNvbnN0IEd0PXJhY2UuZ3JkfHwwO2lmKEd0PDIpcmV0dXJuIDA7CiAgY29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtpZighaHx8IWgucnVucy5sZW5ndGgpcmV0dXJuIDA7CiAgY29uc3QgcmM9aC5ydW5zLnNsaWNlKC0zKSxXPVtbMV0sWy40LC42XSxbLjIsLjMsLjVdXVtyYy5sZW5ndGgtMV07bGV0IGQ9MDsKICByYy5mb3JFYWNoKCh4LGspPT57Y29uc3QgZmluPXhbMV0sTD14WzRdfHwwLEdyPXhbNV18fDA7aWYoTCE9PTV8fCEoZmluPjApKXJldHVybjsKICAgY29uc3QgZ3I9TWF0aC5tYXgoR3IsMik7ICAgICAgICAgIC8vIE9Q44O744Kw44Os44O844OJ5LiN5piO44Gu44Kv44Op44K5Nei1sOOBryBHMyDnm7jlvZPjgajjgZfjgabmr5TovIMKICAgaWYoR3Q+Z3ImJmZpbjw9NSlkLT1XW2tdKkdSQURFLktVUCooR3QtZ3IpKig2LWZpbikvNjsKICAgZWxzZSBpZihHdDxnciYmZmluPj00KWQrPVdba10qR1JBREUuS0ROKihnci1HdCkqTWF0aC5taW4oMSwoZmluLTMpLzgpfSk7CiAgcmV0dXJuIGNsYW1wKGQsR1JBREUuTUlOLEdSQURFLk1BWCl9CiBjb25zdCBHTj1bIuS4jeaYji/kuIvntJoiLCJPUOODu0wiLCJHMyIsIkcyIiwiRzEiXTsKIGZ1bmN0aW9uIGdyYWRlVGFncyh0YWdzLGR6LHJhY2Upe2NvbnN0IHQ9dGFncy5zbGljZSgpOwogIGlmKGR6PD0tLjIpdC51bnNoaWZ0KHt0OmDmoLzkuIrjgZLmiKbvvIgke0dOW3JhY2UuZ3JkfHwwXX3vvInvvJrkuIvkvY3jgrDjg6zjg7zjg4njga7lpb3otbDjga/libLlvJUgJHtkei50b0ZpeGVkKDIpfWAsYzoibyJ9KTsKICBlbHNlIGlmKGR6Pj0uMSl0LnVuc2hpZnQoe3Q6YOmrmOOCsOODrOODvOODieOBi+OCieOBruagvOS4i+OBkiAke2R6Pj0wPyIrIjoiIn0ke2R6LnRvRml4ZWQoMil9YCxjOiJiIn0pOwogIHJldHVybiB0fQogLyog44Os44O844K56Kej5p6Q44CCb2RkcyDjga/ku7vmhI/vvIjlhajpoK3liIbvvInjgIIgKi8KIGNvbnN0IExWTj1bIuS4jeaYjiIsIuacquWLneWIqSIsIjHli50iLCIy5YudIiwiM+WLnSIsIk9QIl07CiBmdW5jdGlvbiBleHRyYVRhZ3ModGFncyxyLHN0b3JlLHJhY2UpewogIGNvbnN0IHQ9dGFncy5zbGljZSgpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksTHQ9cmFjZS5sdmx8fDA7CiAgaWYoaCl7Y29uc3QgbGFzdD1oLnJ1bnMubGVuZ3RoP2gucnVuc1toLnJ1bnMubGVuZ3RoLTFdOm51bGw7CiAgIGlmKGxhc3QmJmxhc3RbNF0+MCYmTHQ+MCYmbGFzdFs0XSE9PUx0KXQudW5zaGlmdChsYXN0WzRdPEx0P3t0OmDmmIfntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJvIn06e3Q6YOmZjee0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6ImIifSk7CiAgIGlmKGgubHYmJmgubHZbLTFdKXQucHVzaCh7dDoi5Zyw5pa544Gn44Gu5Ye66LWw44GC44KK77yI5Ymy5byV6KmV5L6h77yJIixjOiJnIn0pfQogIHJldHVybiB0fQogLyog44Op44Oz44Kv77ya56m044K+44O844Oz44Gu5bmz5Z2H44Gr5a++44GZ44KL5YCN546H44GnIFMvQS9CL0PvvIjlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBp++8iSAqLwogY29uc3QgQVZHX0hPTEU9e29kZHM6LjA5MSxwcm94eTouMTE1fTsKIGZ1bmN0aW9uIHJhdGluZyhwYyxtb2RlLG4pe2NvbnN0IHI9cGMvQVZHX0hPTEVbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il07bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfQogLyog55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQeODu++8iOOCquODg+OCuuOBjOWIhuOBi+OCi+OBqOOBjeOBr++8ieWNmOWLnTMw5YCN5pyq5rqA44Gu5aSn56m044KS6Zmk44GP44CC6YGO5Y6744Gu5qSc6Ki844Gn44CB55qE5Lit546H44GM5LiK44GM44KK44CB5Zue5Y+O546H44GM5pyA5oKq44Gu5aSn56m044KS6YG/44GR44KJ44KM44GfICovCiBjb25zdCBGT0NVU19NQVhfT0REUz0zMDsKIGNvbnN0IEZPQ1VTPXsib2RkcyI6eyJuIjozNjI1LCJoaXQiOjAuMjMyLCJiYXNlSGl0IjowLjE3MiwicGVyRGF5IjoxMy42fSwicHJveHkiOnsibiI6NDAyNSwiaGl0IjowLjI3MiwiYmFzZUhpdCI6MC4yMTcsInBlckRheSI6MTUuMX19OyAgIC8vIDIwMjTlubTku6XpmY3jga7mpJzoqLzvvJrnmoTkuK3njofvvIhiYXNlSGl0PeW+k+adpeOBrjHkvY3lgJnoo5zvvInjg7vplovlgqzml6XjgYLjgZ/jgorjga7poK3mlbAKIGZ1bmN0aW9uIHBpY2tGb2N1cyhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMmJihyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJTInx8cmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iQSIpJiYoeC5vZGQ9PW51bGx8fHgub2RkPEZPQ1VTX01BWF9PRERTKSkuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIC8qIOeptOmmrOWAmeijnO+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLjgIHlpb3otbDnjofjga7pq5jjgYTpoIbjgasgayDpoK3jgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHlr77osaHlpJYgKi8KIGZ1bmN0aW9uIHBpY2socmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogZnVuY3Rpb24gYW5hbHl6ZShyYWNlLHN0b3JlLG9kZHMsY29tcCxwb3BBcnIpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGg7CiAgY29uc3Qgc2M9Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wKSk7CiAgY29uc3QgZHo9Ui5tYXAocj0+Z3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApKTsKICBjb25zdCB6YzA9TU9ERUwuY29yZT9SLm1hcChyPT5tb2RlbFooImNvcmUiLGZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSkpOnNjLm1hcCh4PT54LnopO2NvbnN0IHpjPXpjMC5tYXAoKHosaSk9PnorZHpbaV0pOwogIGNvbnN0IHA9bm9ybWFsaXplVG9wMyh6YyxNYXRoLm1pbigzLE4pKTsKICBsZXQgbWt0PW51bGwscG9wPW51bGwsbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXtta3Q9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7cG9wPW9kZHMubWFwKG89PjErb2Rkcy5maWx0ZXIoeD0+eDxvKS5sZW5ndGgpO21vZGU9Im9kZHMifQogIGVsc2UgaWYocG9wQXJyJiZwb3BBcnIubGVuZ3RoPT09TiYmcG9wQXJyLmV2ZXJ5KHg9Png+MCkpe3BvcD1wb3BBcnIuc2xpY2UoKTttb2RlPSJvZGRzIn0gLy8g5a6f6Zqb44Gu5Lq65rCX6aCG5L2N44Gg44GR5YiG44GL44KL44Go44GN77yI57WQ5p6c44Oa44O844K455Sx5p2l77yJCiAgZWxzZXsgLy8g44Kq44OD44K644KC5Lq65rCX44KC44Gq44GE44Go44GN77ya6aiO5omL5oiQ57i+44G+44Gn5ZCr44KB44Gf44K544Kz44Ki44Gu6aCG5L2N44KS44CM5Lq65rCX44Gu5Luj55CG44CN44Gr44GZ44KL77yI5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46ZaiIDAuNTXihpIwLjY377yJCiAgIGNvbnN0IHB4PU1PREVMLmZ1bGw/Ui5tYXAocj0+bW9kZWxaKCJmdWxsIixmZWF0cyhyLHN0b3JlLHJhY2UsTix0cnVlKSkpOlIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4se2pvY2tleTp0cnVlLGxheW9mZjpmYWxzZX0pLnopO2NvbnN0IHB4Mj1weC5tYXAoKHYsaSk9PnYrZHpbaV0pO3BvcD1weDIubWFwKHY9PjErcHgyLmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgb2RkOihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSk/b2Rkc1tpXTpudWxsLAogICBjYXJlZXI6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD97bjpoLm4sdDM6aC50b3AzLHdpbjpoLndpbn06bnVsbH0pKCksCiAgIHJlY2VudDooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gucnVucy5tYXAoeD0+eFsxXSk6W119KSgpLAogICBqbmFtZTpyLmpuYW1lfHwiIixqc3RhdDooKCk9Pntjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7cmV0dXJuIGomJmoubj49MT97bjpqLm4scmF0ZTpqLnRvcDMvai5ufTpudWxsfSkoKSwKICAgaG9sZTpOPj02JiZwb3BbaV0+PWN1dCxta3Q6bWt0P21rdFtpXTpudWxsLHZhbHVlOm1rdD9jYWxpYkZvcihwW2ldLCJvZGRzIikvbWt0W2ldOm51bGwsCiAgIGR6OmR6W2ldLHRhZ3M6Z3JhZGVUYWdzKGV4dHJhVGFncyhzY1tpXS50YWdzLHIsc3RvcmUscmFjZSksZHpbaV0scmFjZSksY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyogPT09PT0g6YmE5p2/6Lu46aas44O75rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X44CC5L+C5pWw44GvIHRvb2xzL2F4aXNfdXBzZXRfc3R1ZHkuanMg44Gn5a2m57+S44CBMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+aknOiovO+8iSA9PT09PSAqLwogY29uc3QgQVhJUz17IndQIjpbMC4wNTE5MywxLjAxNDgzLDAuMDUxNDgsLTAuMjA2NzYsLTAuNTMyMTYsMC45MTQzNywtMC40ODQ2NCwtMC4zMjExNSwtMC41NjgwMiwtMC41NTEzNSwwLjE3MzQ1LDEuMDk3NCwtMC4yODQwNywtMC4xMDM5NywtMC4yMTYxNywtMC4zNDY2OCwwLjE1OTEzLDAuMjIxOTYsLTAuMzg3MzIsLTAuMzQ2NTgsMC4wMDM3LC0wLjU2NjQ2XSwid08iOlswLjU0MjU5LDAuMTU2NjEsMC4wNTQxNCwtMC4wNDM3MSwtMC4xNDUyNCwwLjEzMTcxLC0wLjE0MTc4LC0wLjE2MjYzLDAuMDUzMTYsLTAuMDIwOTcsMC4wMDM5LC0wLjI5ODY1LC0wLjMyMzIxLC0wLjAxMzY1LC0wLjA5NTE5LC0wLjA3ODE4LDAuMDAwNiwtMC4wMjI5MSwtMC4xMTIxMywwLjAxNzgxLC0wLjA0NzQ1LC0wLjEwODUyLDAuMjU3MjEsMC42MzA3MV0sInVwc2V0Ijp7InRociI6MTUsIm1vZGVscyI6eyJwcm94eSI6WzIuMjQ1NTksMC42Mzg0MSwtMC4wNzA4LC0wLjA4MTYxLC0wLjA3NzQzLDAuMDkxMzcsMC4xMzg0NywwLjAwMjc5LC0wLjM4OTE5LC0wLjY0MjE3LC0wLjU1MzgxLC0wLjAxODM3LC0wLjQ0MzE3LC0wLjc2ODI1LC0wLjUyMzkzLC0yLjczNTYxLC0wLjE0OTA5LDAuMTE0NzddLCJvZGRzIjpbLTAuNzIzOTYsMC40MjgwOCwtMC4wNzQ5OSwtMC4wNjE1NCwtMC4wMDY3NSwwLjA3MjQzLDAuMDcwODUsLTAuMDQ5NzQsLTAuMTU1MjgsLTAuMzI1MTYsLTAuNDE4MjYsLTAuMzEzNTEsMC4yMDc1NywtMC4yMzksLTAuMjc5MDEsLTEuODIxMDgsLTAuMDA4NTIsMC4wODM5OSwwLjE1MDI0LDAuMzUyNDIsLTIuMDM4MzksMi44NTY2OCwwLjIyOTI5LDAuNzIwODQsLTEuOTc3OTddfSwiZ3JhZGVzIjp7InByb3h5Ijp7ImN1dHMiOltbIlNTUyIsMC41NTAzN10sWyJTUyIsMC40ODU1XSxbIlMiLDAuNDA0MjRdLFsiQSIsMC4yOTg4XSxbIkIiLDAuMTg5NTddLFsiQyIsMC4wMDYyOV1dLCJyYXRlcyI6eyJTU1MiOjAuNTc0LCJTUyI6MC41MDksIlMiOjAuNDMzLCJBIjowLjM0NywiQiI6MC4yNDQsIkMiOjAuMDg5fSwiYXZnUyI6eyJTU1MiOjE3LjIsIlNTIjoxNS4zLCJTIjoxNC4yLCJBIjoxMy4xLCJCIjoxMS44LCJDIjo5Ljh9fSwib2RkcyI6eyJjdXRzIjpbWyJTU1MiLDAuNjA5NjhdLFsiU1MiLDAuNTE1OTVdLFsiUyIsMC40MDg1NF0sWyJBIiwwLjI4NzY3XSxbIkIiLDAuMTczNTldLFsiQyIsMC4wMDc2OF1dLCJyYXRlcyI6eyJTU1MiOjAuNjc5LCJTUyI6MC41OTgsIlMiOjAuNDU1LCJBIjowLjM1MiwiQiI6MC4yNDYsIkMiOjAuMDc5fSwiYXZnUyI6eyJTU1MiOjE4LjUsIlNTIjoxNi40LCJTIjoxNC41LCJBIjoxMy4zLCJCIjoxMS44LCJDIjo5LjZ9fX19LCJiYW5kcyI6eyLpiYTmnb8iOnsibG8iOjAuOTIsImhpIjoxLCJuIjoxNjYsInJhdGUiOjAuOTYzOSwibG85NSI6MC45MzU1LCJuMiI6ODcsInJhdGUyIjowLjk3NywicGVyRGF5IjowLjYyfSwi5rqW6YmE5p2/Ijp7ImxvIjowLjg4LCJoaSI6MC45MiwibiI6Mjc5LCJyYXRlIjowLjg4NTMsImxvOTUiOjAuODQ3OSwibjIiOjEzOSwicmF0ZTIiOjAuODk5MywicGVyRGF5IjoxLjA0fSwi5aCF6Lu4Ijp7ImxvIjowLjg0LCJoaSI6MC44OCwibiI6NDc0LCJyYXRlIjowLjg0MTgsImxvOTUiOjAuODA4OSwibjIiOjIyNiwicmF0ZTIiOjAuODQwNywicGVyRGF5IjoxLjc4fX19OwogZnVuY3Rpb24gYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyl7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCx4Yz1SLm1hcChyPT5mZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpOwogIGNvbnN0IHBQPW5vcm1hbGl6ZVRvcDMoeGMubWFwKHg9PmRvdChBWElTLndQLHgpKSxNYXRoLm1pbigzLE4pKTsKICBsZXQgcE89bnVsbDsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKSxtMz10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTsKICAgcE89bm9ybWFsaXplVG9wMyh4Yy5tYXAoKHgsaSk9PmRvdChBWElTLndPLFsuLi54LE1hdGgubG9nKHB3W2ldKSxsb2dpdChNYXRoLm1pbiguOTgsbTNbaV0pKV0pKSxNYXRoLm1pbigzLE4pKX0KICByZXR1cm57cFAscE8seGN9fQogLyog6YmE5p2/6Lu46aas77ya44Kq44OD44K644GM44GC44KL44Os44O844K544Gg44GR44CC5LqI5ris56K6546H44Gu5Yy65YiG44GU44Go44Gr44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkua3u+OBiOOCiyAqLwogZnVuY3Rpb24gYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpO2lmKCFhcC5wTylyZXR1cm4gbnVsbDsKICBjb25zdCBvdXQ9W107YXAucE8uZm9yRWFjaCgocCxpKT0+ewogICBmb3IoY29uc3QgayBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBiPUFYSVMuYmFuZHNba107aWYocD49Yi5sbyYmcDwoaz09PSLpiYTmnb8iPzEuMDE6Yi5oaSkpe291dC5wdXNoKHtpLHAsdGllcjprLHJhdGU6Yi5yYXRlLGxvOTU6Yi5sbzk1LG46Yi5ufSk7YnJlYWt9fX0pOwogIHJldHVybiBvdXQuc29ydCgoYSxiKT0+Yi5wLWEucCl9CiAvKiDms6LkubHluqbvvJpTU1PjgJxD44CCM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GRICovCiBmdW5jdGlvbiB1cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpOwogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgscHM9YXAucFAuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpOwogIGNvbnN0IG5zPVIubWFwKHI9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gubjowfSksbW9udGg9TnVtYmVyKFN0cmluZyhyYWNlLmRhdGUpLnNsaWNlKDUsNykpfHwwLEw9cmFjZS5sdmx8fDA7CiAgY29uc3QgZj1bMSxOLzE2LEw9PT0xPzE6MCxMPT09Mj8xOjAsTD09PTM/MTowLEw9PT00PzE6MCxMPT09NT8xOjAscmFjZS5zdXJmPT09MT8xOjAsKHJhY2UuZGlzdHx8MCkvMjAwMCwKICAgbnMuZmlsdGVyKG49Pm49PT0wKS5sZW5ndGgvTixucy5maWx0ZXIobj0+bjwzKS5sZW5ndGgvTixucy5yZWR1Y2UoKGEsbik9PmErTWF0aC5sb2coMStuKSwwKS9OLzMsCiAgIHBzWzBdLHBzWzFdLHBzWzJdLHBzLnJlZHVjZSgoYSxwKT0+YStwKnAsMCkscHMuZmlsdGVyKHA9PnA+LjUpLmxlbmd0aC8zLG1vbnRoPj02JiZtb250aDw9OT8xOjBdOwogIGxldCBtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCkuc29ydCgoYSxiKT0+Yi1hKSxvZD1vZGRzLnNsaWNlKCkuc29ydCgoYSxiKT0+YS1iKTsKICAgY29uc3QgZW50PS1wdy5yZWR1Y2UoKGEscCk9PmErcCpNYXRoLmxvZyhwKSwwKS9NYXRoLmxvZyhOKTsKICAgZi5wdXNoKHB3WzBdLHB3WzFdLHB3WzBdK3B3WzFdK3B3WzJdLGVudCxNYXRoLmxvZyhvZFswXSksTWF0aC5sb2cob2RbMV0pLG9kLmZpbHRlcihvPT5vPDEwKS5sZW5ndGgvTik7bW9kZT0ib2RkcyJ9CiAgcmV0dXJue2YsbW9kZSxwMDpzaWdtb2lkKGRvdChBWElTLnVwc2V0Lm1vZGVsc1ttb2RlXSxmKSl9fQogZnVuY3Rpb24gdXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kZHMsYXApewogIGNvbnN0IHU9dXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kZHMsYXApLG1vZGU9dS5tb2RlLHA9dS5wMCxHPUFYSVMudXBzZXQuZ3JhZGVzW21vZGVdOwogIGxldCBncmFkZT0iQyI7Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cyl7aWYocD49Yyl7Z3JhZGU9ZzticmVha319CiAgcmV0dXJue2dyYWRlLHAsbW9kZSxyYXRlOkcucmF0ZXNbZ3JhZGVdLGF2Z1M6Ry5hdmdTW2dyYWRlXX19CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIixPT1M9b3B0cy5vb3N8fCIiLFBST1hZPSEhb3B0cy5wcm94eSxNSU5HPU51bWJlcihvcHRzLm1pbkdyZCl8fDAsX2dPbj1HUkFERS5vbjtHUkFERS5vbj0hb3B0cy5ncmFkZU9mZjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSIsImF4aXMiLCJmb2N1cyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUJiYoIU1JTkd8fCgocmMucm93c1swXSYmcmMucm93c1swXS5ncmQpfHwwKT49TUlORykpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJmb2N1cyIscGlja0ZvY3VzKHJlcywxKSk7CiAgICAgIGJ1eSgidG9wMSIscGljayhyZXMsMSkpO2J1eSgidG9wMiIscGljayhyZXMsMikpO2J1eSgidG9wMyIscGljayhyZXMsMykpO2J1eSgiYWxsSG9sZSIsaG9sZSk7CiAgICAgIGlmKCFQUk9YWSlidXkoInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICAgaWYoIVBST1hZJiZoYXNPZGRzKXtjb25zdCBhcD1heGlzUHJvYnMocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTtpZihhcC5wTylidXkoImF4aXMiLGFwLnBPLm1hcCgocCxpKT0+KHtpLHB9KSkuZmlsdGVyKHg9PngucD49QVhJUy5iYW5kc1si6YmE5p2/Il0ubG8pKX0KICAgICAgY29uc3QgdD1waWNrKHJlcywxKVswXTsKICAgICAgaWYodCl7Y29uc3QgeT15ZW4uZ2V0KFJbdC5pXS5udW0pfHwwLHI9dC5wYy9BVixOPVIubGVuZ3RoOwogICAgICAgY29uc3QgcmFuaz0ocj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiKTsKICAgICAgIGFkZFNlZygi44Op44Oz44KvIisodC5uPDImJihyYW5rPT09IlMifHxyYW5rPT09IkEiKT8iQiI6cmFuaykscHIseSk7CiAgICAgICBhZGRTZWcoTjw9MTA/IumgreaVsCDjgJwxMCI6Tjw9MTQ/IumgreaVsCAxMeOAnDE0Ijoi6aCt5pWwIDE144CcIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLnN1cmY9PT0xPyLoip0iOnJhY2Uuc3VyZj09PTI/IuODgOODvOODiCI6IuOBneOBruS7liIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5sdmw+MD8i44Kv44Op44K5ICIrTFZOW3JhY2UubHZsXToi44Kv44Op44K5IOS4jeaYjiIscHIseSk7CiAgICAgICBhZGRTZWcodC5uPj01PyLlrp/nuL4gNei1sOS7peS4iiI6dC5uPj0zPyLlrp/nuL4gM+OAnDTotbAiOiLlrp/nuL4gM+i1sOacqua6gCIscHIseSk7CiAgICAgICBpZighUFJPWFkmJnQub2RkKXtjb25zdCBvPXQub2RkO2FkZFNlZyhvPDg/IuWNmOWLnSDjgJw45YCNIjpvPDE1PyLljZjli50gOOOAnDE15YCNIjpvPDMwPyLljZjli50gMTXjgJwzMOWAjSI6bzw2MD8i5Y2Y5YudIDMw44CcNjDlgI0iOiLljZjli50gNjDlgI3jgJwiLHByLHkpOwogICAgICAgIGlmKGhhc09kZHMpe2NvbnN0IHVnPXVwc2V0R3JhZGUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTthZGRTZWcoIuazouS5seW6piAiK3VnLmdyYWRlLHByLHkpfX19CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIGNvbnN0IHNlZ3M9e307CiAgZm9yKGNvbnN0IFtrLGddIG9mIE9iamVjdC5lbnRyaWVzKFNFRykpe3NlZ3Nba109e307Zm9yKGNvbnN0IHAgb2YgWyJhbGwiLCJBIiwiQiJdKXtjb25zdCB4PWdbcF07CiAgIGlmKCF4Lm4pe3NlZ3Nba11bcF09e2JldHM6MH07Y29udGludWV9Y29uc3QgbWVhbj14LnIveC5uLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHgucS94Lm4tbWVhbiptZWFuKSk7CiAgIHNlZ3Nba11bcF09e2JldHM6eC5uLGhpdFJhdGU6eC5oL3gubixyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHgubikvMTAwfX19CiAgR1JBREUub249X2dPbjtyZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57dXBzZXRGZWF0dXJlcyxjbGVhblRyLEdSQURFLGdyYWRlVGllcixncmFkZUFkaixGT0NVUyxyYXRpbmcscGlja0ZvY3VzLEFYSVMsYXhpc1Byb2JzLGF4aXNQaWNrcyx1cHNldEdyYWRlLHBpY2ssZmVhdHMsTU9ERUwsRk4sRkosbGV2ZWxPZkxhYmVsLGxldmVsT2ZQcml6ZSxiYWNrdGVzdCxjYWxpYixjYWxpYkZvcixqbm4sbm4sdG9Sb3csY3N2Um93cyxTdG9yZSxhbmFseXplLGhvcnNlU2NvcmUsbm9ybWFsaXplVG9wMyx0b3AzRnJvbVdpbixzdXJmQ29kZSxwYXJzZURhdGV9Owp9KSgpOwoKCgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog44Ki44OX44Oq5bGk77yI5YaN5qeL56+J77yJCiAqICDjg7vkv53lrZgv5YaN6ZaL44Gk44GN44Gu6YGO5Y6744OH44O844K/5Y+W5b6X44CB44OQ44OD44Kv44Ki44OD44OX44CB5qSc6Ki844Gv44CB5YuV5L2c56K66KqN5riI44G/44Gu5Yem55CG44KS44Gd44Gu44G+44G+5YaN5Yip55SoCiAqICDjg7vku4rpgLHmnKvjga7lj5blvpfjgIHpqI7miYvjg7voqr/mlZnluKvjga7nhaflkIjjgIHmnJ/lvoXlgKTjgIHotoXpiYTmnb/jgIHms6LkubHluqbjgIHlj5bjgorovrzjgb/lk4Hos6rjga7ooajnpLrjga/mlrDopo8KICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpjb25zdCAkPWlkPT5kb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7CmNvbnN0IGVzYz1zPT5TdHJpbmcocz8/IiIpLnJlcGxhY2UoL1smPD4iJ10vZyxtPT4oeyImIjoiJmFtcDsiLCI8IjoiJmx0OyIsIj4iOiImZ3Q7IiwnIic6IiZxdW90OyIsIiciOiImIzM5OyJ9W21dKSk7CmNvbnN0IHNsZWVwPShtcz0wKT0+bmV3IFByb21pc2Uocj0+c2V0VGltZW91dChyLG1zKSk7CmZ1bmN0aW9uIGJ1c3kob24sbXNnPSLlh6bnkIbkuK3igKYiKXskKCJidXN5Iikuc3R5bGUuZGlzcGxheT1vbj8iZmxleCI6Im5vbmUiOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9bXNnfQpsZXQgREI9bnVsbCxTVE9SRT1udWxsLFNUT1JFX0tFWT0iIjsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9Owpjb25zdCBqc3RUb2RheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgcGN0PSh4LGs9MCk9Png9PW51bGx8fCFOdW1iZXIuaXNGaW5pdGUoeCk/Ii0iOih4KjEwMCkudG9GaXhlZChrKSsiJSI7CgpmdW5jdGlvbiBvcGVuREIoKXtyZXR1cm4gbmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHI9aW5kZXhlZERCLm9wZW4oInVwc2V0X3Rvb2xfZGIiLDIpOwogci5vbnVwZ3JhZGVuZWVkZWQ9ZT0+e2NvbnN0IGQ9ZS50YXJnZXQucmVzdWx0O2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoImZpbGVzIikpZC5jcmVhdGVPYmplY3RTdG9yZSgiZmlsZXMiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpZC5jcmVhdGVPYmplY3RTdG9yZSgibWV0YSIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoInBheSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoInBheSIpfTsKIHIub25zdWNjZXNzPSgpPT57REI9ci5yZXN1bHQ7b2soKX07ci5vbmVycm9yPSgpPT5uZyhyLmVycm9yKTtyLm9uYmxvY2tlZD0oKT0+bmcobmV3IEVycm9yKCLku5bjga7jgr/jg5bjgafkvb/nlKjkuK3jgafjgZkiKSl9KX0KY29uc3QgaWRiQWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigiZmlsZXMiKS5vYmplY3RTdG9yZSgiZmlsZXMiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYlB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgiZmlsZXMiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoImZpbGVzIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6Iikpe21hcmtEaXJ0eSgiZmlsZXMiLGMua2V5KTtjLmRlbGV0ZSgpfWMuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9Cgpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKCi8qIC0tLSDikaAg44OH44O844K/5Y+W5b6X77ya6YGO5Y675oiQ57i+77yI5Lq65rCX44Gk44GN77yJ77yL5omV5oi744KS44CB6ZaL5YKs5pel44GU44Go44Gr5Y+W5b6X44GX44Gm5L+d5a2YIC0tLSAqLwpjb25zdCBTWU5DX0JBVENIPTQsU1lOQ19QQVJBTExFTD0yOwpsZXQgU1NUT1A9ZmFsc2UsQkFDS1VQX0RBVEVTPW51bGw7CiQoInN5bmNTdG9wIikub25jbGljaz0oKT0+e1NTVE9QPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlfTsKJCgic2VuZCIpLnZhbHVlPWpzdFllc3RlcmRheSgpOwphc3luYyBmdW5jdGlvbiBiYWNrdXBEYXRlcygpewogaWYoQkFDS1VQX0RBVEVTKXJldHVybiBCQUNLVVBfREFURVM7CiBjb25zdCBzPW5ldyBTZXQoKSxmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihjb25zdCBmIG9mIGZzKXtpZihmLmxpdmUpY29udGludWU7Zm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpe2NvbnN0IGQ9VUUucGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pO2lmKGQpcy5hZGQoZCl9YXdhaXQgc2xlZXAoMCl9CiByZXR1cm4gQkFDS1VQX0RBVEVTPXM7Cn0KYXN5bmMgZnVuY3Rpb24gZmV0Y2hEYXkoYmFzZSxkKXsKIGNvbnN0IGRheT1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheT9kYXRlPSR7ZH1gKTsKIGNvbnN0IHJhY2VzPWRheS5yYWNlc3x8W107aWYoIXJhY2VzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyIpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krPVNZTkNfQkFUQ0gpY2h1bmtzLnB1c2gocmFjZXMuc2xpY2UoaSxpK1NZTkNfQkFUQ0gpLm1hcCh4PT54LmNuYW1lKSk7CiBjb25zdCByb3dzPVtdLHBheW91dHM9W107bGV0IGlkeD0wLGZhaWxlZE49MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoaWR4PGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9aWR4Kys7CiAgY29uc3QgcmVzPWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtcmVzdWx0cz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWApOwogIHJvd3MucHVzaCguLi4ocmVzLnJvd3N8fFtdKSk7cGF5b3V0cy5wdXNoKC4uLihyZXMucGF5b3V0c3x8W10pKTtmYWlsZWROKz0ocmVzLmZhaWxlZHx8W10pLmxlbmd0aH19OwogYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7bGVuZ3RoOk1hdGgubWluKFNZTkNfUEFSQUxMRUwsY2h1bmtzLmxlbmd0aCl9LHdvcmtlcikpOwogY29uc3QgZ290PW5ldyBTZXQocm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplOwogZmFpbGVkTj1NYXRoLm1heChmYWlsZWROLHJhY2VzLmxlbmd0aC1nb3QpOwogcmV0dXJue3Jvd3MscGF5b3V0cyxmYWlsZWROLHJhY2VzOnJhY2VzLmxlbmd0aH07Cn0KJCgic3luY0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IGE9JCgic3N0YXJ0IikudmFsdWV8fCIyMDIzLTAxLTAxIix5ZD1qc3RZZXN0ZXJkYXkoKTtsZXQgYj0kKCJzZW5kIikudmFsdWV8fHlkO2lmKGI+eWQpYj15ZDsKIGlmKGE+Yil7JCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLplovlp4vml6XjgYzntYLkuobml6XjgojjgorlvozjgafjgZnjgIIiO3JldHVybn0KIFNTVE9QPWZhbHNlO1NZTkNJTkc9dHJ1ZTskKCJzeW5jR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsc2tpcHBlZDowLGZhaWw6W10sdDA6RGF0ZS5ub3coKX07bGV0IGNvbnNlYz0wOwogdHJ5ewogICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i5L+d5a2Y5riI44G/44OH44O844K/44KS56K66KqN5Lit4oCmIjsKICBjb25zdCBmaWxlcz1hd2FpdCBpZGJBbGwoKSxoYXZlTGl2ZT1uZXcgU2V0KGZpbGVzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpLm1hcChmPT5mLmRhdGUpKTsKICBjb25zdCBoYXZlUGF5PW5ldyBTZXQoKGF3YWl0IHBheUFsbCgpKS5maWx0ZXIocD0+IXAuZmFpbGVkKS5tYXAocD0+cC5kYXRlKSk7CiAgY29uc3QgYms9YXdhaXQgYmFja3VwRGF0ZXMoKTsKICBjb25zdCBtb250aHM9bW9udGhzQmV0d2VlbihhLGIpLGN1ck1vbnRoPXlkLnNsaWNlKDAsNyk7CiAgZm9yKGxldCBtaT0wO21pPG1vbnRocy5sZW5ndGg7bWkrKyl7CiAgIGlmKFNTVE9QKWJyZWFrO2NvbnN0IG1vbnRoPW1vbnRoc1ttaV07CiAgIGlmKG1vbnRoPGN1ck1vbnRoJiZhd2FpdCBtZXRhR2V0KCJtb250aDoiK21vbnRoKSl7Y29udGludWV9CiAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHttb250aH3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvInplovlgqzml6XjgpLnorroqo3kuK3igKYg5Y+W5b6X5riI44G/JHtzdC5kYXlzfeaXpWA7CiAgIGxldCBkYXlzO3RyeXtkYXlzPShhd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLWRheXM/bW9udGg9JHttb250aH1gKSkuZGF5c3x8W107Y29uc2VjPTB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKGAke21vbnRofe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgZGF5cz1kYXlzLmZpbHRlcihkPT5kPj1hJiZkPD1iKTtsZXQgbW9udGhPaz10cnVlOwogICBmb3IoY29uc3QgZCBvZiBkYXlzKXsKICAgIGlmKFNTVE9QKXttb250aE9rPWZhbHNlO2JyZWFrfQogICAgY29uc3QgbmVlZFJvd3M9IWhhdmVMaXZlLmhhcyhkKSYmIWJrLmhhcyhkKSxuZWVkUGF5PSFoYXZlUGF5LmhhcyhkKTsKICAgIGlmKCFuZWVkUm93cyYmIW5lZWRQYXkpe3N0LnNraXBwZWQrKztjb250aW51ZX0KICAgIGNvbnN0IGVsPU1hdGgucm91bmQoKERhdGUubm93KCktc3QudDApLzEwMDApOwogICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOCkuWPluW+l+S4re+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iVxu5Y+W5b6XJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvI/lpLHmlZcke3N0LmZhaWwubGVuZ3Rofe+8j+e1jOmBjiR7TWF0aC5mbG9vcihlbC82MCl95YiGJHtlbCU2MH3np5JgOwogICAgdHJ5ewogICAgIGNvbnN0IHI9YXdhaXQgZmV0Y2hEYXkoYmFzZSxkKTsKICAgICBpZihyLmZhaWxlZE4pe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yIJHtyLmZhaWxlZE59UuWkseaVl++8iWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX1jb250aW51ZX0KICAgICBpZihuZWVkUm93cyl7YXdhaXQgaWRiUHV0KGBsaXZlOiR7ZH1gLHtsaXZlOnRydWUsZGF0ZTpkLHJvd3M6ci5yb3dzfSk7aGF2ZUxpdmUuYWRkKGQpfQogICAgIGF3YWl0IHBheVB1dChkLHtkYXRlOmQscmFjZXM6ci5wYXlvdXRzLGZhaWxlZDowfSk7aGF2ZVBheS5hZGQoZCk7CiAgICAgc3QuZGF5cysrO3N0LnJhY2VzKz1yLnJhY2VzO2NvbnNlYz0wOwogICAgfWNhdGNoKGUpe21vbnRoT2s9ZmFsc2U7c3QuZmFpbC5wdXNoKGAke2R977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfX0KICAgIGF3YWl0IHNsZWVwKDQwMCk7CiAgIH0KICAgaWYobW9udGhPayYmbW9udGg8Y3VyTW9udGgpYXdhaXQgbWV0YVB1dCgibW9udGg6Iittb250aCx0cnVlKTsKICB9CiB9Y2F0Y2goZSl7c3QuZmFpbC5wdXNoKFN0cmluZyhlLm1lc3NhZ2V8fGUpKX0KIGZpbmFsbHl7CiAgU1lOQ0lORz1mYWxzZTtTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjskKCJzeW5jR28iKS5kaXNhYmxlZD1mYWxzZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWU7CiAgJCgic3luY1N0YXR1cyIpLmlubmVySFRNTD1gJHtzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/vvIhDbG91ZGZsYXJl5YG044Gu5re36ZuR44O75Yi26ZmQ44Gu5Y+v6IO95oCn77yJ44CC5bCR44GX5pmC6ZaT44KS44GK44GE44Gm44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE44CCXG4iOiIifSR7U1NUT1AmJiFzdC5zdG9wcGVkPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOihzdC5zdG9wcGVkPyIiOiLlrozkuobjgIIiKX3ku4rlm57jga7lj5blvpfvvJoke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8iOS/neWtmOa4iOOBv+OBp+OCueOCreODg+ODlyAke3N0LnNraXBwZWR95pel77yJYCsoc3QuZmFpbC5sZW5ndGg/YFxuPHNwYW4gY2xhc3M9Indhcm4iPuWkseaVlyAke3N0LmZhaWwubGVuZ3RofeS7tu+8miR7ZXNjKHN0LmZhaWwuc2xpY2UoMCw0KS5qb2luKCLjgIEiKSl9JHtzdC5mYWlsLmxlbmd0aD40PyIg4oCmIjoiIn1cbu+8iOOCguOBhuS4gOW6puaKvOOBmeOBqOOAgeWkseaVl+OBl+OBn+aXpeOBoOOBkeOChOOCiuebtOOBl+OBvuOBme+8iTwvc3Bhbj5gOiIiKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Cn07CgoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTt0cnl7c2V0R2F0ZShvdXQsb3V0UCl9Y2F0Y2goZSl7Y29uc29sZS5lcnJvcihlKX0KICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpOwogIGF3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbXSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuLnVwZGF0ZWRBdH0pOwogIGF3YWl0IHNob3dTdGF0ZSgpO0JLLmluZm89bWFuO2JrTXNnKGDlvqnlhYPlrozkuobvvJoke25hbWVzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8ke2NudC50b0xvY2FsZVN0cmluZygpfeS7tmApOwogfWNhdGNoKGUpe2JrTXNnKCLlvqnlhYPjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKX0KIGZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmZ1bmN0aW9uIGJrU2NoZWR1bGUobXMpewogaWYoIUJLLmF1dG98fCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXJldHVybjsKIGNsZWFyVGltZW91dChCSy5ydW5UKTtCSy5ydW5UPXNldFRpbWVvdXQoKCk9PntpZighU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpO2Vsc2UgYmtTY2hlZHVsZSgzMDAwMCl9LG1zfHwzMDAwKTsKfQpmdW5jdGlvbiBia1NhdmVTZXR0aW5ncygpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfYmsiLEpTT04uc3RyaW5naWZ5KHtwYXNzOkJLLnBhc3MsYXV0bzpCSy5hdXRvfSkpfWNhdGNoKGUpe319CmFzeW5jIGZ1bmN0aW9uIGJrSW5pdCgpewogdHJ5e2NvbnN0IG89SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgidXBzZXRfYmsiKXx8Int9Iik7QksucGFzcz1vLnBhc3N8fCIiO0JLLmF1dG89by5hdXRvIT09ZmFsc2V9Y2F0Y2goZSl7fQogJCgiYmtQYXNzIikudmFsdWU9QksucGFzczskKCJia0F1dG8iKS5jaGVja2VkPUJLLmF1dG87CiAkKCJia1Bhc3MiKS5vbmNoYW5nZT0oKT0+e0JLLnBhc3M9JCgiYmtQYXNzIikudmFsdWUudHJpbSgpO0JLLmlkPSIiO0JLLmluZm89bnVsbDtCSy5tc2c9IiI7YmtTYXZlU2V0dGluZ3MoKTtpZihCSy5wYXNzLmxlbmd0aD49OClia1JlZnJlc2goKTtlbHNlIGJrUmVuZGVyKCl9OwogJCgiYmtTaG93Iikub25jbGljaz0oKT0+e2NvbnN0IHA9JCgiYmtQYXNzIik7cC50eXBlPXAudHlwZT09PSJwYXNzd29yZCI/InRleHQiOiJwYXNzd29yZCI7JCgiYmtTaG93IikudGV4dENvbnRlbnQ9cC50eXBlPT09InBhc3N3b3JkIj8i6KGo56S6Ijoi6Zqg44GZIn07CiAkKCJia0F1dG8iKS5vbmNoYW5nZT0oKT0+e0JLLmF1dG89JCgiYmtBdXRvIikuY2hlY2tlZDtia1NhdmVTZXR0aW5ncygpO2JrUmVuZGVyKCk7aWYoQksuYXV0bylia1NjaGVkdWxlKDIwMDApfTsKICQoImJrTm93Iikub25jbGljaz0oKT0+cnVuQmFja3VwKGZhbHNlKTsKICQoImJrRnVsbCIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZnjgbnjgabjga7jg4fjg7zjgr/jgpLjgIHjgYLjgonjgZ/jgoHjgabkv53lrZjjgZfnm7TjgZfjgb7jgZnjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5CYWNrdXAodHJ1ZSl9OwogJCgiYmtSZXN0b3JlIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBk+OBruerr+acq+OBruODh+ODvOOCv+OCkuOAgeODkOODg+OCr+OCouODg+ODl+OBruWGheWuueOBp+S4iuabuOOBjeOBl+OBvuOBme+8iOODkOODg+OCr+OCouODg+ODl+OBq+OBguOCi+ODh+ODvOOCv+OBoOOBkeOBjOWvvuixoeOBp+OBme+8ieOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1blJlc3RvcmUoKX07CiB0cnl7Y29uc3QgZD1hd2FpdCBtZXRhR2V0KCJkaXJ0eSIpO2lmKEFycmF5LmlzQXJyYXkoZCkpZC5mb3JFYWNoKHg9PkJLLmRpcnR5LmFkZCh4KSl9Y2F0Y2goZSl7fQogdHJ5e2lmKG5hdmlnYXRvci5zdG9yYWdlJiZuYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KW5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QoKS5jYXRjaCgoKT0+e30pfWNhdGNoKGUpe30KIGJrUmVuZGVyKCk7CiBpZihCSy5wYXNzLmxlbmd0aD49OCl7YXdhaXQgYmtSZWZyZXNoKCk7aWYoQksuZGlydHkuc2l6ZSlia1NjaGVkdWxlKDUwMDApfQogc2V0SW50ZXJ2YWwoKCk9PntpZihCSy5hdXRvJiZCSy5wYXNzLmxlbmd0aD49OCYmQksuZGlydHkuc2l6ZSYmIUJLLmJ1c3kmJiFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSl9LHdpbmRvdy5fX0JLX1RJQ0t8fDkwMDAwMCk7Cn0KCgoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOazouS5seW6puOBruWGjeagoeatowogKiAg55uu55qE77ya5rOi5Lmx5bqm44Gu44CM5b2T44Gf44KK5pa544CN44KS44CB6Ieq5YiG44Gu6YGO5Y6744OH44O844K/44Gn56K644GL44KB44CB5L+h6aC844Gn44GN44KL5pWw5a2X44Gg44GR44KS5Ye644GZ44CCCiAqICDjgoTjgovjgZPjgajvvJoKICogICAxKSDpgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgasx44Gk44Ga44Gk5YaN54++44GX44CB44Os44O844K55YmN44Gr5YiG44GL44KL5oOF5aCx44Gg44GR44Gn5rOi5Lmx5bqm44KS6KiI566XCiAqICAgMikg54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yITU9ERUxfVFJBSU5fRU5E5Lul6ZmN77yJ44Gn44CB5a6f6Zqb44Gu5rOi5Lmx546H44Go56qB44GN5ZCI44KP44Gb44KLCiAqICAgMykg44Kz44O844K55Yil44Gu6YGO5Y675rOi5Lmx546H77yI6ZaL5YKs5aC0w5foip3jg4DDl+i3nembosOX44Kv44Op44K577yJ44Gq44Gp44KS6Laz44GX44Gf5paw44Oi44OH44Or44KS5L2c44KK44CB5ZCM44GY5pyf6ZaT44Gn5q+U6LyDCiAqICAgNCkg5a++5pWw5pCN5aSx44GM5piO56K644Gr6Imv44GP44Gq44Gj44Gf44Go44GN44Gg44GR5o6h55So44CC44Gd44GG44Gn44Gq44GR44KM44Gw54++6KGM44Gu44G+44G+44Gr44GX44Gm44CB5a6f57i+546H44Gg44GR5qSc6Ki85YCk44Gr5beu44GX5pu/44GI44KLCiAqICDms6LkubHvvJ0z552A5Lul5YaF44Gu6aas44Gu5Lq65rCX44Gu5ZCI6KiI44GM6Za+5YCkKOePvuihjOODouODh+ODq+OBqOWQjOOBmDE1KeS7peS4igogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFVQS0VZPSJrZWliYV91cHNldF92MSI7CmNvbnN0IHNpZ209ej0+MS8oMStNYXRoLmV4cCgteikpLGxndD1wPT57cD1NYXRoLm1pbiguOTk5LE1hdGgubWF4KC4wMDEscCkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CmZ1bmN0aW9uIHdpbHNvbihrLG4pe2lmKCFuKXJldHVyblswLDFdO2NvbnN0IHo9MS45NixwPWsvbixkPTEreip6L24sYz1wK3oqei8oMipuKSxhPXoqTWF0aC5zcXJ0KHAqKDEtcCkvbit6KnovKDQqbipuKSk7cmV0dXJuWyhjLWEpL2QsKGMrYSkvZF19CmNvbnN0IGRpc3RCPWQ9Pk1hdGgubWF4KDEwMDAsTWF0aC5taW4oMzIwMCxNYXRoLnJvdW5kKChkfHwwKS8yMDApKjIwMCkpOwpjb25zdCBsdmxHPShsLGcpPT4obHx8MCkrKGc+PTI/IkciOiIiKTsKCi8qIOODrOODvOOCueOBrumbhuioiO+8iOihjOOCkuWFqOmDqOaMgeOBn+OBmuOBq+a4iOOCgOi7veOBhOW9ou+8ieKGkiDjg6zjg7zjgrnmg4XloLEgKi8KZnVuY3Rpb24gYWdnQWRkKG1hcCxyKXsKIGlmKCFyLnJhY2VJZHx8IXIuaG9yc2V8fHIuZmluaXNoPT1udWxsKXJldHVybjsKIGxldCBhPW1hcC5nZXQoci5yYWNlSWQpOwogaWYoIWEpbWFwLnNldChyLnJhY2VJZCxhPXtpZDpTdHJpbmcoci5yYWNlSWQpLGRhdGU6ci5kYXRlLHN1cmY6ci5zdXJmLGRpc3Q6ci5kaXN0LGx2bDpyLmx2bHx8MCxncmQ6ci5ncmR8fDAsTjowLHQ6W10scGY6W10sanVtcDpmYWxzZX0pOwogYS5OKys7aWYoci5maW5pc2g8PTMmJnIucG9wPjApYS50LnB1c2goW3IuZmluaXNoLHIucG9wXSk7CiBpZihyLnBvcD4wKWEucGYucHVzaChbci5wb3Asci5maW5pc2hdKTsKIGlmKC/pmpzlrrMvLnRlc3QoU3RyaW5nKHIucmFjZU5hbWV8fCIiKSkpYS5qdW1wPXRydWU7Cn0KZnVuY3Rpb24gYWdnSW5mbyhhKXsKIGlmKCFhfHxhLk48Nnx8YS5qdW1wKXJldHVybiBudWxsOwogY29uc3Qgdj0vXlxkezEyfSQvLnRlc3QoYS5pZCk/YS5pZC5zbGljZSg0LDYpOihTdHJpbmcoYS5pZCkuc3BsaXQoIi0iKVszXXx8IiIpLG5vPS9eXGR7MTJ9JC8udGVzdChhLmlkKT9OdW1iZXIoYS5pZC5zbGljZSgxMCwxMikpOihOdW1iZXIoU3RyaW5nKGEuaWQpLnNwbGl0KCItIilbNF0pfHwwKTsKIGNvbnN0IHQ9YS50LnNsaWNlKCkuc29ydCgoeCx5KT0+eFswXS15WzBdKTsKIGNvbnN0IHk9dC5sZW5ndGg+PTM/KHRbMF1bMV0rdFsxXVsxXSt0WzJdWzFdPj1VRS5BWElTLnVwc2V0LnRocj8xOjApOm51bGw7CiByZXR1cm57ZGF0ZTphLmRhdGUsdixubyxzdXJmOmEuc3VyZixkaXN0OmEuZGlzdCxsdmw6YS5sdmwsZ3JkOmEuZ3JkLE46YS5OLHl9Owp9CgovKiDohJros6rvvJox44Kz44O844OK44O844Gu5L2N572u44Gu5Ymy5ZCI77yIMD3lhYjpoK3jgIExPeacgOW+jOaWue+8ieOAgumAmumBjumghuS9jeOBpOOBjeOBruaIkOe4vuOBjOOBguOCi+mmrOOBoOOBkSAqLwpmdW5jdGlvbiBjb3JuZXJGcmFjKGNvcm5lcixOKXsKIGlmKCFBcnJheS5pc0FycmF5KGNvcm5lcil8fCFjb3JuZXIubGVuZ3RofHwhTnx8Tjw0KXJldHVybiBudWxsOwogcmV0dXJuIE1hdGgubWluKDEsTWF0aC5tYXgoMCwoY29ybmVyWzBdLTEpLyhOLTEpKSk7Cn0KLyog44Os44O844K544Gu44Oa44O844K554m55b606YeP77ya5YWI6KGM6aas44Gu5aSa44GV44O76ISa6LOq44Gu44Gw44KJ44Gk44GN44CC5Y2K5pWw5Lul5LiK44Gu6aas44Gr6ISa6LOq44OH44O844K/44GM54Sh44GR44KM44Gw5YWo6YOoMCAqLwpmdW5jdGlvbiBwYWNlRmVhdChydW5uZXJzLHN0b3JlKXsKIGNvbnN0IE49cnVubmVycy5sZW5ndGg7bGV0IGs9MCxsZWFkPTAsZnJvbnQ9MCxzdW09MCxzdW0yPTA7CiBmb3IoY29uc3QgciBvZiBydW5uZXJzKXsKICBjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO2lmKCFoKWNvbnRpbnVlOwogIGNvbnN0IHY9aC5ydW5zLm1hcCh4PT54WzZdKS5maWx0ZXIoeD0+eCE9bnVsbCYmeD49MCk7aWYodi5sZW5ndGg8Miljb250aW51ZTsKICBjb25zdCB3PXYuc2xpY2UoLTUpLG09dy5yZWR1Y2UoKGEsYik9PmErYiwwKS93Lmxlbmd0aDsKICBrKys7c3VtKz1tO3N1bTIrPW0qbTtpZihtPD0uMTUpbGVhZCsrO2lmKG08PS4zMClmcm9udCsrOwogfQogaWYoIU58fGs8TiouNSlyZXR1cm5bMCwwLDAsMCwwXTsKIGNvbnN0IG1lYW49c3VtL2ssc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAsc3VtMi9rLW1lYW4qbWVhbikpOwogcmV0dXJuW2svTixsZWFkL04qNCxmcm9udC9OKjIsbWVhbi0uNSxzZF07Cn0KCi8qIOWQhOmmrOOBrjPnnYDlhoXnorrnjofjgajkurrmsJfpoIbkvY3jgYvjgonjgIHjgIwz552A5Lul5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GM6Za+5YCk5Lul5LiK44CN44Gr44Gq44KL56K6546H44KS44K344Of44Ol44Os44O844K344On44Oz44Gn6KaL56mN44KC44KLCiAgIO+8iOmHjeOBv++8neeiuueOh8O3KDHiiJLnorrnjocp44Gn44CBM+mgreOCkumghuOBq+aKvemBuOOAguavjuWbnuWQjOOBmOe1kOaenOOBq+OBquOCi+OCiOOBhuOAgeS5seaVsOOBr+ODrOODvOOCueWGheWuueOBi+OCieaxuuOCgeOCi++8iSAqLwpmdW5jdGlvbiBzaW1VcHNldChwLHBvcHMsdGhyKXsKIGNvbnN0IE49cC5sZW5ndGg7bGV0IHNlZWQ9MjE2NjEzNjI2MTsKIGZvcihsZXQgaT0wO2k8TjtpKyspc2VlZD1NYXRoLmltdWwoc2VlZF4oTWF0aC5yb3VuZChwW2ldKjEwMDApK3BvcHNbaV0qNzkxOSksMTY3Nzc2MTkpPj4+MDsKIGNvbnN0IHJuZD0oKT0+e3NlZWQ9KHNlZWQrMHg2RDJCNzlGNSk+Pj4wO2xldCB0PXNlZWQ7dD1NYXRoLmltdWwodF4odD4+PjE1KSx0fDEpO3RePXQrTWF0aC5pbXVsKHReKHQ+Pj43KSx0fDYxKTtyZXR1cm4oKHReKHQ+Pj4xNCkpPj4+MCkvNDI5NDk2NzI5Nn07CiBjb25zdCB3PXAubWFwKHg9Pk1hdGgubWF4KDFlLTQseC8oMS1NYXRoLm1pbiguOTk5LHgpKSkpOwogY29uc3QgSz0zMDA7bGV0IGhpdD0wLHN1bT0wLHN1bTI9MDsKIGZvcihsZXQgaz0wO2s8SztrKyspewogIGNvbnN0IHVzZWQ9QXJyYXkoTikuZmlsbChmYWxzZSk7bGV0IFM9MDsKICBmb3IobGV0IGo9MDtqPDM7aisrKXsKICAgbGV0IHRvdD0wO2ZvcihsZXQgaT0wO2k8TjtpKyspaWYoIXVzZWRbaV0pdG90Kz13W2ldOwogICBsZXQgeD1ybmQoKSp0b3QscGljaz0tMTsKICAgZm9yKGxldCBpPTA7aTxOO2krKyl7aWYodXNlZFtpXSljb250aW51ZTt4LT13W2ldO2lmKHg8PTApe3BpY2s9aTticmVha319CiAgIGlmKHBpY2s8MCl7Zm9yKGxldCBpPU4tMTtpPj0wO2ktLSlpZighdXNlZFtpXSl7cGljaz1pO2JyZWFrfX0KICAgdXNlZFtwaWNrXT10cnVlO1MrPXBvcHNbcGlja107CiAgfQogIGlmKFM+PXRociloaXQrKztzdW0rPVM7c3VtMis9UypTOwogfQogY29uc3QgbT1zdW0vSztyZXR1cm5bbGd0KChoaXQrLjUpLyhLKzEpKSxtLzE1LE1hdGguc3FydChNYXRoLm1heCgwLHN1bTIvSy1tKm0pKS8xMF07Cn0KLyogMeODrOODvOOCueOBruW4guWgtOi+vOOBv+OBrueJueW+tO+8mumBjuWOu+aIkOe4vuODouODh+ODq+OBrueiuueOh+OBqOOAgeS6uuawl+mghuS9jeOBruWun+e4vueOh+OCkuWNiuOAheOBp+a3t+OBnOOBn+eiuueOhyDihpIg44K344Of44Ol44Os44O844K344On44OzICovCmZ1bmN0aW9uIHNpbUZlYXQocFAscG9wcyxOLHByaSl7CiBjb25zdCB6PXBQLm1hcCgocCxpKT0+LjUqbGd0KHApKy41KmxndChwcmkucmF0ZShwb3BzW2ldLE4pKSk7CiByZXR1cm4gc2ltVXBzZXQobm9ybVN1bSh6LDMpLHBvcHMsVUUuQVhJUy51cHNldC50aHIpOwp9CgovKiDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga/lhajkvZPjgbjlr4TjgZvjgovvvIkgKi8KY2xhc3MgVXBQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMuYmFzZT17bjowLHU6MH07dGhpcy5tPW5ldyBNYXAoKX0KIF9rKGkpe3JldHVyblsiViIraS52LCJDIitpLnYrInwiK2kuc3VyZisifCIrZGlzdEIoaS5kaXN0KSwiTCIraS5zdXJmKyJ8IitkaXN0QihpLmRpc3QpKyJ8IitsdmxHKGkubHZsLGkuZ3JkKSwiTiIrKGkubm98fDApXX0KIGFkZChpKXtpZighaXx8aS55PT1udWxsKXJldHVybjt0aGlzLmJhc2UubisrO3RoaXMuYmFzZS51Kz1pLnk7Zm9yKGNvbnN0IGsgb2YgdGhpcy5fayhpKSl7bGV0IHg9dGhpcy5tLmdldChrKTtpZigheCl0aGlzLm0uc2V0KGsseD17bjowLHU6MH0pO3gubisrO3gudSs9aS55fX0KIGZlYXQoaSl7CiAgY29uc3QgYj10aGlzLmJhc2Uubj4yMDA/dGhpcy5iYXNlLnUvdGhpcy5iYXNlLm46LjI4NSxLPTQwOwogIGNvbnN0IHNoPShrLHBhcik9Pntjb25zdCB4PXRoaXMubS5nZXQoayl8fHtuOjAsdTowfTtyZXR1cm4oeC51K0sqcGFyKS8oeC5uK0spfTsKICBjb25zdCBba3Ysa2Msa2wsa25dPXRoaXMuX2soaSkscHY9c2goa3YsYikscGM9c2goa2MscHYpLHBsPXNoKGtsLGIpLHBuPXNoKGtuLGIpLGxiPWxndChiKTsKICByZXR1cm5bbGd0KHB2KS1sYixsZ3QocGMpLWxiLGxndChwbCktbGIsbGd0KHBuKS1sYl07CiB9Cn0KCi8qIOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8iOODi+ODpeODvOODiOODs+azleODu0wy5q2j5YmH5YyW44O75qiZ5rqW5YyW77yJICovCmZ1bmN0aW9uIHNvbHZlTGluKEEsYil7CiBjb25zdCBuPWIubGVuZ3RoLE09QS5tYXAoKHIsaSk9PlsuLi5yLGJbaV1dKTsKIGZvcihsZXQgYz0wO2M8bjtjKyspewogIGxldCBwPWM7Zm9yKGxldCByPWMrMTtyPG47cisrKWlmKE1hdGguYWJzKE1bcl1bY10pPk1hdGguYWJzKE1bcF1bY10pKXA9cjsKICBbTVtjXSxNW3BdXT1bTVtwXSxNW2NdXTtjb25zdCBkPU1bY11bY118fDFlLTk7CiAgZm9yKGxldCBrPWM7azw9bjtrKyspTVtjXVtrXS89ZDsKICBmb3IobGV0IHI9MDtyPG47cisrKWlmKHIhPT1jKXtjb25zdCBmPU1bcl1bY107aWYoZilmb3IobGV0IGs9YztrPD1uO2srKylNW3JdW2tdLT1mKk1bY11ba119CiB9CiByZXR1cm4gTS5tYXAocj0+cltuXSk7Cn0KZnVuY3Rpb24gZml0TG9naXQoWCx5LGwyKXsKIGNvbnN0IG49WC5sZW5ndGgsZD1YWzBdLmxlbmd0aCxtdT1BcnJheShkKS5maWxsKDApLHNkPUFycmF5KGQpLmZpbGwoMCk7CiBmb3IoY29uc3QgciBvZiBYKWZvcihsZXQgaj0wO2o8ZDtqKyspbXVbal0rPXJbal0vbjsKIGZvcihjb25zdCByIG9mIFgpZm9yKGxldCBqPTA7ajxkO2orKylzZFtqXSs9KHJbal0tbXVbal0pKioyL247CiBmb3IobGV0IGo9MDtqPGQ7aisrKXtzZFtqXT1NYXRoLnNxcnQoc2Rbal0pO2lmKCEoc2Rbal0+PS4wNSkpc2Rbal09LjA1fSAgIC8vIOOBsOOCieOBpOOBjeOBjOOBu+OBvOeEoeOBhOWIl+OBr+OAgeWwj+OBleOBquiqpOW3ruOBp+WJsuOBo+OBpuW3qOWkp+OBquWApOOBq+OBquOCieOBquOBhOOCiOOBhuOAgeS4i+mZkOOCkuioreOBkeOCiwogY29uc3QgWj1YLm1hcChyPT5bMSwuLi5yLm1hcCgodixqKT0+KHYtbXVbal0pL3NkW2pdKV0pLEQ9ZCsxLHc9QXJyYXkoRCkuZmlsbCgwKTsKIGZvcihsZXQgaXQ9MDtpdDwzMDtpdCsrKXsKICBjb25zdCBnPUFycmF5KEQpLmZpbGwoMCksSD1BcnJheS5mcm9tKHtsZW5ndGg6RH0sKCk9PkFycmF5KEQpLmZpbGwoMCkpOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2NvbnN0IHo9WltpXTtsZXQgcz0wO2ZvcihsZXQgaj0wO2o8RDtqKyspcys9d1tqXSp6W2pdOwogICBjb25zdCBwPXNpZ20ocyksZT1wLXlbaV0scT1wKigxLXApOwogICBmb3IobGV0IGo9MDtqPEQ7aisrKXtnW2pdKz1lKnpbal07Zm9yKGxldCBrPWo7azxEO2srKylIW2pdW2tdKz1xKnpbal0qeltrXX19CiAgZm9yKGxldCBqPTE7ajxEO2orKyl7Z1tqXSs9bDIqd1tqXTtIW2pdW2pdKz1sMn0KICBmb3IobGV0IGo9MDtqPEQ7aisrKWZvcihsZXQgaz0wO2s8ajtrKyspSFtqXVtrXT1IW2tdW2pdOwogIEhbMF1bMF0rPTFlLTk7CiAgY29uc3QgZHc9c29sdmVMaW4oSCxnKTtsZXQgbXg9MDtmb3IobGV0IGo9MDtqPEQ7aisrKXt3W2pdLT1kd1tqXTtteD1NYXRoLm1heChteCxNYXRoLmFicyhkd1tqXSkpfQogIGlmKG14PDFlLTcpYnJlYWs7CiB9CiByZXR1cm57dyxtdSxzZH07Cn0KY29uc3QgcHJlZExvZ2l0PShtLHgpPT57bGV0IHM9bS53WzBdO2ZvcihsZXQgaj0wO2o8eC5sZW5ndGg7aisrKXtjb25zdCB6PSh4W2pdLW0ubXVbal0pL20uc2Rbal07cys9bS53W2orMV0qTWF0aC5tYXgoLTUsTWF0aC5taW4oNSx6KSl9cmV0dXJuIHN9OyAgIC8vIOWtpue/kuaZguOBruevhOWbsuOCkuWkp+OBjeOBj+WkluOCjOOBn+WFpeWKm+OBp+aatOOCjOOBquOBhOOCiOOBhsKxNeOBq+aKkeOBiOOCiwoKLyog6KmV5L6h5oyH5qiZ77ya5a++5pWw5pCN5aSx44O744OW44Op44Kk44Ok44O844O7QVVD44O76LyD5q2j6Kqk5beuKEVDRSkgKi8KZnVuY3Rpb24gYXVjT2YocCx5KXsKIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKTtsZXQgcnM9MCxuMT0wOwogZm9yKGxldCByPTA7cjxpZHgubGVuZ3RoO3IrKyl7aWYoeVtpZHhbcl1dKXtycys9cisxO24xKyt9fQogY29uc3QgbjA9eS5sZW5ndGgtbjE7cmV0dXJuIG4xJiZuMD8ocnMtbjEqKG4xKzEpLzIpLyhuMSpuMCk6LjU7Cn0KZnVuY3Rpb24gbWV0cmljc09mKHAseSl7CiBjb25zdCBuPXkubGVuZ3RoO2xldCBsbD0wLGJyPTA7CiBmb3IobGV0IGk9MDtpPG47aSsrKXtjb25zdCBxPU1hdGgubWluKDEtMWUtOSxNYXRoLm1heCgxZS05LHBbaV0pKTtsbC09eVtpXT9NYXRoLmxvZyhxKTpNYXRoLmxvZygxLXEpO2JyKz0ocFtpXS15W2ldKSoqMn0KIGNvbnN0IGlkeD1wLm1hcCgoXyxpKT0+aSkuc29ydCgoYSxiKT0+cFthXS1wW2JdKSxCPTEwO2xldCBlY2U9MDsKIGZvcihsZXQgYj0wO2I8QjtiKyspe2NvbnN0IHM9aWR4LnNsaWNlKE1hdGguZmxvb3IoYipuL0IpLE1hdGguZmxvb3IoKGIrMSkqbi9CKSk7aWYoIXMubGVuZ3RoKWNvbnRpbnVlOwogIGNvbnN0IG1wPXMucmVkdWNlKChhLGkpPT5hK3BbaV0sMCkvcy5sZW5ndGgsbXk9cy5yZWR1Y2UoKGEsaSk9PmEreVtpXSwwKS9zLmxlbmd0aDtlY2UrPU1hdGguYWJzKG1wLW15KSpzLmxlbmd0aC9ufQogcmV0dXJue24sbGw6bGwvbixicmllcjpici9uLGF1YzphdWNPZihwLHkpLGVjZX07Cn0KCi8qIOetiee0mu+8muS6iOa4rOeiuueOh+OBrumrmOOBhOmghuOBq+S4iuS9jSAzJSAvIDclIC8gMTIlIC8gMjAlIC8gMjglIC8g5q6L44KK77yIU1NTL1NTL1MvQS9CL0PvvIkgKi8KY29uc3QgVVBfU0hBUkU9W1siU1NTIiwuMDNdLFsiU1MiLC4wN10sWyJTIiwuMTJdLFsiQSIsLjIwXSxbIkIiLC4yOF0sWyJDIiwuMzBdXTsKZnVuY3Rpb24gbWFrZUN1dHMocHMpewogY29uc3Qgcz1wcy5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7bGV0IGFjYz0wO2NvbnN0IGN1dHM9W107CiBmb3IoY29uc3QgW2csc2hdIG9mIFVQX1NIQVJFKXthY2MrPXNoO2lmKGc9PT0iQyIpe2N1dHMucHVzaChbZywtMV0pO2JyZWFrfWN1dHMucHVzaChbZyxzW01hdGgubWluKHMubGVuZ3RoLTEsTWF0aC5tYXgoMCxNYXRoLnJvdW5kKHMubGVuZ3RoKmFjYyktMSkpXV0pfQogcmV0dXJuIGN1dHM7Cn0KY29uc3QgZ3JhZGVPZj0oY3V0cyxwKT0+e2Zvcihjb25zdCBbZyxjXSBvZiBjdXRzKWlmKHA+PWMpcmV0dXJuIGc7cmV0dXJuIkMifTsKZnVuY3Rpb24gZ3JhZGVUYWJsZShjdXRzLHBzLHlzKXsKIGNvbnN0IHQ9e307VVBfU0hBUkUuZm9yRWFjaCgoW2ddKT0+dFtnXT17bjowLGs6MH0pOwogcHMuZm9yRWFjaCgocCxpKT0+e2NvbnN0IHg9dFtncmFkZU9mKGN1dHMscCldO3gubisrO3guays9eXNbaV19KTsKIGZvcihjb25zdCBnIGluIHQpe2NvbnN0IHg9dFtnXSx3PXdpbHNvbih4LmsseC5uKTt4LnJhdGU9eC5uP3guay94Lm46MDt4LmxvPXdbMF07eC5oaT13WzFdfQogcmV0dXJuIHQ7Cn0KCi8qIOaWsOODouODh+ODq+OBruWFpeWKm++8muePvuihjOODouODh+ODq+OBrueJueW+tOmHjygxNykg77yLIOOCquODg+OCuueJueW+tOmHjyg3LCDjgarjgZHjgozjgbAwKSDvvIsg44Kq44OD44K65pyJ54ShIO+8iyDjgrPjg7zjgrnliKXjga7pgY7ljrvms6LkubHnjocoMykgKi8KZnVuY3Rpb24gdXBYKHUsZSl7CiBjb25zdCBvZGRzPXUubW9kZT09PSJvZGRzIjsKIHJldHVyblsuLi51LmYuc2xpY2UoMSwxOCksLi4uKG9kZHM/dS5mLnNsaWNlKDE4LDI1KTpbMCwwLDAsMCwwLDAsMF0pLG9kZHM/MTowLC4uLmVdOwp9CmZ1bmN0aW9uIHVwc2V0Q3VzdG9tKE0sdSxlLHBjLHNpbSl7CiBpZighTSlyZXR1cm4gbnVsbDsKIGxldCB6O2NvbnN0IHowPWxndCh1LnAwKSx4eD0oKT0+e2xldCB4PXVwWCh1LGUpO2lmKE0ucGFjZSl4PVsuLi54LC4uLihwY3x8WzAsMCwwLDAsMF0pXTtpZihNLnNpbSl4PVsuLi54LHNpbT8xOjAsLi4uKHNpbXx8WzAsMCwwXSldO3JldHVybiB4fTsKIGlmKE0ua2luZD09PSJvbGQiKXo9ejA7CiBlbHNlIGlmKE0ua2luZD09PSJuZXciKXo9cHJlZExvZ2l0KE0ubW9kZWwseHgoKSk7CiBlbHNlIGlmKE0ua2luZD09PSJibGVuZCIpej0oejArcHJlZExvZ2l0KE0ubW9kZWwseHgoKSkpLzI7CiBlbHNlIHJldHVybiBudWxsOwogY29uc3QgcD1zaWdtKHopLGc9Z3JhZGVPZihNLmN1dHMscCkscj1NLnJhdGVzJiZNLnJhdGVzW2ddfHx7fTsKIHJldHVybntncmFkZTpnLHAscmF0ZTpyLnJhdGU/P251bGwsbG86ci5sbz8/bnVsbCxoaTpyLmhpPz9udWxsLG46ci5uPz8wfTsKfQpjb25zdCBnZXRVcHNldE1vZGVsPSgpPT57dHJ5e2NvbnN0IG09SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShVUEtFWSl8fCJudWxsIik7cmV0dXJuIG0mJm0uY3V0cyYmbS52ZXI9PT0zP206bnVsbH1jYXRjaChlKXtyZXR1cm4gbnVsbH19OyAgIC8vIHZlcjoy77yd44Os44O844K555Wq5Y+344Gu54m55b606YeP44Gk44GN44CC5Y+k44GE5L+d5a2Y44Gv5L2/44KP44Gq44GECgovKiAtLS0tLS0tLS0tIOaknOiovOOBqOWGjeagoeato+OBruacrOS9kyAtLS0tLS0tLS0tICovCmFzeW5jIGZ1bmN0aW9uIHJ1blVwc2V0Rml0KG9wdHMpewogb3B0cz1vcHRzfHx7fTsKIGNvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIyMDIxLTAxLTAxIixURVNUPW9wdHMudGVzdFN0YXJ0fHxNT0RFTF9UUkFJTl9FTkQsb3V0PVtdOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogY29uc3Qgc3RvcmU9bmV3IFVFLlN0b3JlKCkscHJpPW5ldyBVcFByaSgpLHBwcmk9bmV3IFBvcFByaSgpLFM9W107CiBmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKyspewogIGNvbnN0IHJjPXJhY2VzW2ldLGFtPW5ldyBNYXAoKTtmb3IoY29uc3QgciBvZiByYy5yb3dzKWFnZ0FkZChhbSxyKTsKICBjb25zdCBpbmZvPWFnZ0luZm8oYW0uZ2V0KFN0cmluZyhyYy5yb3dzWzBdJiZyYy5yb3dzWzBdLnJhY2VJZCkpKTsKICBpZihpbmZvJiZpbmZvLnkhPW51bGwmJnJjLmRhdGU+PVNUQVJUKXsKICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgY29uc3QgaGFzT2Rkcz1SLmV2ZXJ5KHI9PnIub2Rkcz4xKSxvZD1oYXNPZGRzP1IubWFwKHI9PnIub2Rkcyk6bnVsbDsKICAgY29uc3QgcmFjZT17ZGF0ZTpyYy5kYXRlLHN1cmY6UlswXS5zdXJmLGRpc3Q6UlswXS5kaXN0LGx2bDpSWzBdLmx2bHx8MCxncmQ6UlswXS5ncmR8fDAscnVubmVyczpSfTsKICAgdHJ5ewogICAgY29uc3QgYXA9VUUuYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2QpLHU9VUUudXBzZXRGZWF0dXJlcyhyYWNlLHN0b3JlLG9kLGFwKTsKICAgIGNvbnN0IHBvcHM9Ui5tYXAocj0+ci5wb3ApLHBvcHNPaz1SLmxlbmd0aD49NiYmcG9wcy5ldmVyeSh2PT52PjApOwogICAgbGV0IHUwPW51bGw7aWYob2Qpe3RyeXt1MD1VRS51cHNldEZlYXR1cmVzKHJhY2Usc3RvcmUsbnVsbCxVRS5heGlzUHJvYnMocmFjZSxzdG9yZSxudWxsKSl9Y2F0Y2goZSl7fX0gICAvLyDjgqrjg4PjgrrmnKrlj5blvpfjga7jgajjgY3nlKjvvIjlkIzjgZjjg6zjg7zjgrnjgpLjgIHjgqrjg4PjgrrjgarjgZfjga7nibnlvrTjgafkvZzjgaPjgZ/jgoLjga7vvIkKICAgIFMucHVzaCh7ZGF0ZTpyYy5kYXRlLHUsdTAsZHJvcE9kZHM6KGkqNDA1MDM+Pj4wKSUxMDwzLGU6cHJpLmZlYXQoaW5mbykscGM6cGFjZUZlYXQoUixzdG9yZSksc2ltOnBvcHNPaz9zaW1GZWF0KGFwLnBQLHBvcHMsUi5sZW5ndGgscHByaSk6bnVsbCxrZWVwOihpKjI2NTQ0MzU3NjE+Pj4wKSUxMD49Myx5OmluZm8ueX0pOwogICB9Y2F0Y2goZSl7fQogIH0KICBwcmkuYWRkKGluZm8pOwogIHtjb25zdCBSUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCk7aWYoUlIubGVuZ3RoPj02JiZSUi5ldmVyeShyPT5yLnBvcD4wKSYmIVJSLnNvbWUocj0+L+manOWusy8udGVzdChTdHJpbmcoci5yYWNlTmFtZXx8IiIpKSkpcHByaS5hZGQoUlIubWFwKHI9PltyLnBvcCxyLmZpbmlzaF0pLFJSLmxlbmd0aCl9CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgaWYoaSUzMD09PTI5KXtidXN5KHRydWUsYOaZguezu+WIl+OBq+WGjeePvuOBl+OBpuaknOiovOS4reKApiAke2krMX0vJHtyYWNlcy5sZW5ndGh944Os44O844K5YCk7YXdhaXQgc2xlZXAoMCl9CiB9CiBidXN5KHRydWUsIuODouODh+ODq+OCkuavlOi8g+S4reKApiIpO2F3YWl0IHNsZWVwKDApOwogY29uc3QgdHJhaW49Uy5maWx0ZXIocz0+cy5kYXRlPFRFU1QpLHRlc3Q9Uy5maWx0ZXIocz0+cy5kYXRlPj1URVNUKTsKIGNvbnN0IHJlcz17bkFsbDpTLmxlbmd0aCxuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHN0YXJ0OlNUQVJULHRlc3RTdGFydDpURVNULGJhc2U6Uy5sZW5ndGg/Uy5yZWR1Y2UoKGEscyk9PmErcy55LDApL1MubGVuZ3RoOjB9OwogaWYodGVzdC5sZW5ndGg8MzAwfHx0cmFpbi5sZW5ndGg8MTUwMCl7YnVzeShmYWxzZSk7cmV0dXJuey4uLnJlcyxlcnJvcjpg5qSc6Ki844Gr5L2/44GI44KL5pyf6ZaT44Gu44Os44O844K544GM6Laz44KK44G+44Gb44KT77yI5a2m57+S5YG0JHt0cmFpbi5sZW5ndGh944O75qSc6Ki85YG0JHt0ZXN0Lmxlbmd0aH3vvInjgILmpJzoqLzjga7plovlp4vml6XjgpLml6njgoHjgovjgYvjgIHjg4fjg7zjgr/jgpLlopfjgoTjgZfjgabjgY/jgaDjgZXjgYTjgIJgfX0KIGNvbnN0IHlUPXRlc3QubWFwKHM9PnMueSkseTA9dHJhaW4ubWFwKHM9PnMueSk7CiAvLyDnj77ooYzjg6Ljg4fjg6vjga7mpJzoqLzmnJ/plpPjgafjga7miJDnuL4KIGNvbnN0IHAwPXRlc3QubWFwKHM9PnMudS5wMCksbTA9bWV0cmljc09mKHAwLHlUKTsKIC8vIOaWsOODouODh+ODq++8iOWtpue/kuacn+mWk+OBruOBv+OBp+S9nOOCi++8ieOAguW4guWgtOi+vOOBv+OBrueJueW+tChzaW0p44O744Oa44O844K544Gv44CB5L2/44GI44KL44Go44GN44Gg44GR6Kmm44GX44Gm44CB6Imv44GP44Gq44KM44Gw6Laz44GZCiBjb25zdCB4Rm9yPShzLGZsLGlzVHJhaW4pPT57CiAgbGV0IHg9dXBYKChpc1RyYWluJiZzLnUwJiZzLmRyb3BPZGRzKT9zLnUwOnMudSxzLmUpOyAgIC8vIOWtpue/kuOBp+OBrzPlibLjga7jg6zjg7zjgrnjgafjgIHjgqrjg4Pjgrrovrzjgb/jga7nibnlvrTjgpLjgqrjg4PjgrrjgarjgZfjga7nibnlvrTjgavnva7jgY3mj5vjgYjjgIHjgqrjg4PjgrrmnKrlj5blvpfjga7jgajjgY3jgavjgoLlr77lv5zjgafjgY3jgovjgojjgYbjgavjgZnjgosKICBpZihmbC5wYWNlKXg9Wy4uLngsLi4ucy5wY107CiAgaWYoZmwuc2ltKXtjb25zdCB1c2U9cy5zaW0mJighaXNUcmFpbnx8cy5rZWVwKTt4PVsuLi54LHVzZT8xOjAsLi4uKHVzZT9zLnNpbTpbMCwwLDBdKV19ICAgLy8g5a2m57+S44Gn44GvM+WJsuOBruODrOODvOOCueOBp+W4guWgtOi+vOOBv+OBrueJueW+tOOCkumaoOOBl+OAgeS6uuawl+OBjOacqueiuuWumuOBruOBqOOBjeOBq+OCguWvvuW/nOOBp+OBjeOCi+OCiOOBhuOBq+OBmeOCiwogIHJldHVybiB4OwogfTsKIGNvbnN0IGZpdD1mbD0+ewogIGNvbnN0IG09Zml0TG9naXQodHJhaW4ubWFwKHM9PnhGb3IocyxmbCx0cnVlKSkseTAsMyk7CiAgY29uc3Qgej10ZXN0Lm1hcChzPT5wcmVkTG9naXQobSx4Rm9yKHMsZmwsZmFsc2UpKSk7CiAgcmV0dXJue2ZsLG0sbU46bWV0cmljc09mKHoubWFwKHNpZ20pLHlUKSxtQjptZXRyaWNzT2Yoei5tYXAoKHYsaSk9PnNpZ20oKGxndChwMFtpXSkrdikvMikpLHlUKX07CiB9OwogY29uc3QgVj17YmFzZTpmaXQoe3BhY2U6ZmFsc2Usc2ltOmZhbHNlfSl9OwogY29uc3QgY292VHI9dHJhaW4uZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLGNvdlRlPXRlc3QuZmlsdGVyKHM9PnMucGNbMF0+MCkubGVuZ3RoLHBhY2VPaz1jb3ZUcj49NDAwJiZjb3ZUZT49MTAwOwogY29uc3Qgc2ltVHI9dHJhaW4uZmlsdGVyKHM9PnMuc2ltKS5sZW5ndGgsc2ltVGU9dGVzdC5maWx0ZXIocz0+cy5zaW0pLmxlbmd0aCxzaW1Paz1zaW1Ucj49MTAwMCYmc2ltVGU+PTIwMDsKIHJlcy5wYWNlPXtjb3ZUcmFpbjpjb3ZUcixjb3ZUZXN0OmNvdlRlLHVzZWQ6ZmFsc2V9O3Jlcy5zaW09e3RyYWluTjpzaW1Ucix0ZXN0TjpzaW1UZSx1c2VkOmZhbHNlfTsKIGlmKHNpbU9rKVYuc2ltPWZpdCh7cGFjZTpmYWxzZSxzaW06dHJ1ZX0pOwogaWYocGFjZU9rKVYucGFjZT1maXQoe3BhY2U6dHJ1ZSxzaW06ZmFsc2V9KTsKIGlmKHBhY2VPayYmc2ltT2spVi5ib3RoPWZpdCh7cGFjZTp0cnVlLHNpbTp0cnVlfSk7CiByZXMubTA9bTA7cmVzLm1OPVYuYmFzZS5tTjtyZXMubUI9Vi5iYXNlLm1COwogaWYoVi5zaW0pcmVzLm1TPVYuc2ltLm1OO2lmKFYucGFjZSlyZXMubVA9Vi5wYWNlLm1OO2lmKFYuYm90aClyZXMubVBTPVYuYm90aC5tTjsKIGxldCBjdXI9Vi5iYXNlOwogaWYoVi5zaW0mJmN1ci5tTi5sbC1WLnNpbS5tTi5sbD49LjAwMSljdXI9Vi5zaW07CiB7Y29uc3QgY2FuZD1jdXIuZmwuc2ltP1YuYm90aDpWLnBhY2U7aWYoY2FuZCYmY3VyLm1OLmxsLWNhbmQubU4ubGw+PS4wMDEpY3VyPWNhbmR9CiBjb25zdCBmbGM9Y3VyLmZsLHVzZVBhY2U9ISFmbGMucGFjZSx1c2VTaW09ISFmbGMuc2ltOwogcmVzLnBhY2UudXNlZD11c2VQYWNlO3Jlcy5zaW0udXNlZD11c2VTaW07cmVzLnVzZVBhY2U9dXNlUGFjZTtyZXMudXNlU2ltPXVzZVNpbTsKIC8vIOaOoeeUqOOBruWIpOaWre+8muePvuihjOOCiOOCiuWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK6Imv44GP44Gq44KK44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44GoCiBjb25zdCBiZXR0ZXI9KG0scmVmKT0+KHJlZi5sbC1tLmxsPj0uMDAyKSYmKG0uYXVjPj1yZWYuYXVjLS4wMDMpOwogbGV0IGtpbmQ9Im9sZCI7CiBjb25zdCBrYz1bWyJuZXciLGN1ci5tTl0sWyJibGVuZCIsY3VyLm1CXV0uZmlsdGVyKChbayxtXSk9PmJldHRlcihtLG0wKSkuc29ydCgoYSxiKT0+YVsxXS5sbC1iWzFdLmxsKVswXTsKIGlmKGtjKWtpbmQ9a2NbMF07CiBjb25zdCBNMj1jdXIubSx4eD1zPT54Rm9yKHMsZmxjLGZhbHNlKTsKIHJlcy5raW5kPWtpbmQ7CiAvLyDnrYnntJrjga7liIfjgoznm67jga/jgIzlrabnv5LlgbTjgI3jga7kuojmuKzjgYvjgonmsbrjgoHjgIHmpJzoqLzlgbTjgaflrp/pmpvjga7ms6LkubHnjofjgpLmuKzjgovvvIjmraPnm7Tjgarlrp/nuL7njofvvIkKIGNvbnN0IHByZWRUcmFpbj1zPT5raW5kPT09Im9sZCI/cy51LnAwOmtpbmQ9PT0ibmV3Ij9zaWdtKHByZWRMb2dpdChNMix4eChzKSkpOnNpZ20oKGxndChzLnUucDApK3ByZWRMb2dpdChNMix4eChzKSkpLzIpOwogY29uc3QgY3V0cz1tYWtlQ3V0cyh0cmFpbi5tYXAocHJlZFRyYWluKSk7CiBjb25zdCBwVGVzdD10ZXN0Lm1hcChwcmVkVHJhaW4pLHRhYj1ncmFkZVRhYmxlKGN1dHMscFRlc3QseVQpOwogcmVzLmN1dHM9Y3V0cztyZXMudGFiPXRhYjsKIHJlcy5tb2RlbD17dmVyOjMsa2luZCxwYWNlOnVzZVBhY2Usc2ltOnVzZVNpbSxtb2RlbDpNMixjdXRzLHJhdGVzOk9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh0YWIpLm1hcCgoW2cseF0pPT5bZyx7cmF0ZTp4LnJhdGUsbG86eC5sbyxoaTp4LmhpLG46eC5ufV0pKSwKICBhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0U3RhcnQ6VEVTVCxtMCxtTjpyZXMubU4sbUI6cmVzLm1CLG1QOnJlcy5tUHx8bnVsbCxtUzpyZXMubVN8fG51bGwsbVBTOnJlcy5tUFN8fG51bGwscGFjZUNvdjpbY292VHIsY292VGVdLHNpbUNvdjpbc2ltVHIsc2ltVGVdfTsKIGJ1c3koZmFsc2UpO3JldHVybiByZXM7Cn0KCmZ1bmN0aW9uIHVwc2V0UmVwb3J0KHIpewogaWYoci5lcnJvcilyZXR1cm5gPHNwYW4gY2xhc3M9ImJhZCI+JHtlc2Moci5lcnJvcil9PC9zcGFuPmA7CiBjb25zdCBmPXg9PngudG9GaXhlZCg0KSxyb3c9KGwsbSk9PmA8dHI+PHRkPiR7bH08L3RkPjx0ZD4ke2YobS5sbCl9PC90ZD48dGQ+JHtmKG0uYnJpZXIpfTwvdGQ+PHRkPiR7bS5hdWMudG9GaXhlZCgzKX08L3RkPjx0ZD4keyhtLmVjZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PC90cj5gOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lrabnv5LlgbQgJHtyLm5UcmFpbn3jg6zjg7zjgrnvvIjjgJwke2VzYyhyLnRlc3RTdGFydCl944Gu5YmN5pel77yJ77yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CC5YWo5L2T44Gu5rOi5Lmx546HICR7cGN0KHIuYmFzZSwxKX3jgII8L2Rpdj4KIDxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6Ljg4fjg6vvvIjmpJzoqLzlgbTvvIk8L3RoPjx0aD7lr77mlbDmkI3lpLHihpM8L3RoPjx0aD7oqqTlt67ihpM8L3RoPjx0aD5BVUPihpE8L3RoPjx0aD7ovIPmraPoqqTlt67ihpM8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+JHtyb3coIuePvuihjCIsci5tMCl9JHtyb3coIuaWsO+8iOOCs+ODvOOCueWIpeOCkui/veWKoO+8iSIsci5tTil9JHtyb3coIuePvuihjOOBqOaWsOOBruW5s+WdhyIsci5tQil9JHtyLm1TP3Jvdygi5paw77yI44Kz44O844K55Yil77yL5biC5aC06L6844G/44Gu56K6546H77yJIixyLm1TKToiIn0ke3IubVA/cm93KCLmlrDvvIjjgrPjg7zjgrnliKXvvIvjg5rjg7zjgrnvvIkiLHIubVApOiIifSR7ci5tUFM/cm93KCLmlrDvvIjjgZnjgbnjgabvvIkiLHIubVBTKToiIn08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGgrPXIuc2ltJiZyLnNpbS50ZXN0Tj49MjAwP2A8ZGl2IGNsYXNzPSJzbWFsbCI+5biC5aC06L6844G/44Gu54m55b6077yI5ZCE6aas44Gu56K6546H44Go5Lq65rCX6aCG5L2N44GL44KJ44CB5rOi5Lmx44Gr44Gq44KL56K6546H44KS55u05o6l6KaL56mN44KC44KL77yJ77ya5a2m57+S5YG0JHtyLnNpbS50cmFpbk5944O75qSc6Ki85YG0JHtyLnNpbS50ZXN0Tn3jg6zjg7zjgrnjgafkvb/jgYjjgb7jgZfjgZ/jgIIke3IudXNlU2ltPyI8Yj7liqDjgYjjgovjgajmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHmjqHnlKjjgZfjgb7jgZfjgZ/jgII8L2I+Ijoi5Yqg44GI44Gm44KC5piO56K644Gq5pS55ZaE44Gv44Gq44GL44Gj44Gf44Gf44KB44CB5o6h55So44GX44Gm44GE44G+44Gb44KT44CCIn08L2Rpdj5gOmA8ZGl2IGNsYXNzPSJzbWFsbCI+5biC5aC06L6844G/44Gu54m55b6077ya5Lq65rCX6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM5bCR44Gq44GP44CB5qSc6Ki844Gn44GN44G+44Gb44KT44Gn44GX44Gf44CCPC9kaXY+YDsKIGgrPXIucGFjZSYmci5wYWNlLnVzZWQ/YDxkaXYgY2xhc3M9InNtYWxsIj7jg5rjg7zjgrnjg7vohJros6rjga7nibnlvrTph4/vvJrlrabnv5LlgbQke3IucGFjZS5jb3ZUcmFpbn3jg7vmpJzoqLzlgbQke3IucGFjZS5jb3ZUZXN0feODrOODvOOCueOBp+S9v+OBiOOBvuOBl+OBn+OAgiR7ci51c2VQYWNlPyI8Yj7jg5rjg7zjgrnjgpLliqDjgYjjgovjgajmmI7norrjgavoia/jgY/jgarjgaPjgZ/jgZ/jgoHmjqHnlKjjgZfjgb7jgZfjgZ/jgII8L2I+Ijoi44Oa44O844K544KS5Yqg44GI44Gm44KC5piO56K644Gq5pS55ZaE44Gv44Gq44GL44Gj44Gf44Gf44KB44CB5o6h55So44GX44Gm44GE44G+44Gb44KT44CCIn08L2Rpdj5gOmA8ZGl2IGNsYXNzPSJzbWFsbCI+44Oa44O844K544O76ISa6LOq77ya6YCa6YGO6aCG5L2N44Gk44GN44Gu5oiQ57i+44GM5bCR44Gq44GP77yI5a2m57+S5YG0JHtyLnBhY2U/ci5wYWNlLmNvdlRyYWluOjB944O75qSc6Ki85YG0JHtyLnBhY2U/ci5wYWNlLmNvdlRlc3Q6MH3jg6zjg7zjgrnvvInjgIHmpJzoqLzjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgILoqK3lrprjga7jgIzjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfjgI3jgpLlrp/ooYzjgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogY29uc3Qgbm09e29sZDoi54++6KGM44Oi44OH44Or44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIixuZXc6IuaWsOODouODh+ODq+OCkuaOoeeUqCIrKHIudXNlU2ltPyLvvIjluILloLTovrzjgb/vvIkiOiIiKSsoci51c2VQYWNlPyLvvIjjg5rjg7zjgrnovrzjgb/vvIkiOiIiKSxibGVuZDoi54++6KGM44Go5paw44Gu5bmz5Z2H44KS5o6h55SoIisoci51c2VTaW0/Iu+8iOW4guWgtOi+vOOBv++8iSI6IiIpKyhyLnVzZVBhY2U/Iu+8iOODmuODvOOCuei+vOOBv++8iSI6IiIpfVtyLmtpbmRdOwogaCs9YDxkaXYgY2xhc3M9ImJhbm5lciAke3Iua2luZD09PSJvbGQiPyJ3biI6Im9rIn0iPjxiPue1kOaenO+8miR7bm19PC9iPjxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaOoeeUqOadoeS7tu+8muWvvuaVsOaQjeWkseOBjDAuMDAy5Lul5LiK5pS55ZaE44GX44CBQVVD44GM5oKq5YyW44GX44Gm44GE44Gq44GE44GT44Go44CCPC9zcGFuPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuetiee0muOBlOOBqOOBrjxiPuWun+mam+OBruazouS5seeOhzwvYj7vvIjmpJzoqLzlgbTjg7s5NSXjga7luYXvvInjgILjgZPjga7mlbDlrZfjgYzjgIHms6LkubHluqbjgr/jg5bjgavooajnpLrjgZXjgozjgovjgojjgYbjgavjgarjgorjgb7jgZnjgII8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+562J57SaPC90aD48dGg+44Os44O844K55pWwPC90aD48dGg+5a6f6Zqb44Gu5rOi5Lmx546HPC90aD48dGg+OTUl44Gu5bmFPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgW2ddIG9mIFVQX1NIQVJFKXtjb25zdCB4PXIudGFiW2ddO2grPWA8dHI+PHRkPiR7Z308L3RkPjx0ZD4ke3gubn08L3RkPjx0ZD48Yj4ke3BjdCh4LnJhdGUsMSl9PC9iPjwvdGQ+PHRkPiR7cGN0KHgubG8pfeOAnCR7cGN0KHguaGkpfTwvdGQ+PC90cj5gfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogY29uc3QgbW9ubz1VUF9TSEFSRS5tYXAoKFtnXSk9PnIudGFiW2ddLnJhdGUpLmV2ZXJ5KCh2LGksYSk9Pmk9PT0wfHx2PD1hW2ktMV0rLjAzKTsKIGlmKCFtb25vKWgrPSc8ZGl2IGNsYXNzPSJzbWFsbCB3YXJuIj7nrYnntJrjga7poIbjgavlrp/nuL7njofjgYzljZjoqr/jgavkuIvjgYzjgaPjgabjgYTjgb7jgZvjgpPjgILmpJzoqLzlgbTjga7jg6zjg7zjgrnmlbDjgYzlsJHjgarjgYTjgajotbfjgY3jgb7jgZnvvIjlgbbnhLbjga7nr4Tlm7Ljga7jgZPjgajjgYzlpJrjgYTvvInjgII8L2Rpdj4nOwogcmV0dXJuIGg7Cn0KZnVuY3Rpb24gdXBzZXRTdGF0dXNMaW5lKCl7CiBjb25zdCBNPWdldFVwc2V0TW9kZWwoKTsKIGlmKCFNKXJldHVybic8ZGl2IGNsYXNzPSJzbWFsbCI+5qiZ5rqW44Oi44OH44Or77yI5a2m57+S5riI44G/44Gu5Zu65a6a44Oi44OH44Or77yJ44CC5a6f57i+546H44Gv5a2m57+S5pmC44Gu5pWw5a2X44Gn44GZ44CC44CM5qSc6Ki844CN44K/44OW44Gn44CB6Ieq5YiG44Gu44OH44O844K/44Gn44Gu5qSc6Ki844O75YaN5qCh5q2j44GM44Gn44GN44G+44GZ44CCPC9kaXY+JzsKIGNvbnN0IG5tPXtvbGQ6IuePvuihjOODouODh+ODqyIsbmV3OiLlho3moKHmraPjgZfjgZ/mlrDjg6Ljg4fjg6siLGJsZW5kOiLnj77ooYzjgajmlrDjga7lubPlnYcifVtNLmtpbmRdOwogcmV0dXJuYDxkaXYgY2xhc3M9InNtYWxsIj48Yj4ke25tfTwvYj7jgafliKTlrprkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnvvInjgILnrYnntJrjga7lrp/nuL7njofjga/jgIHjg6Ljg4fjg6vjgYzlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPjgafmuKzjgaPjgZ/lgKTjgafjgZnjgII8L2Rpdj5gOwp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5aW96LWw546H77yI6KSH5Yud5ZyP5YaF546H77yJ44Gu5qSc6Ki844O75YaN5qCh5q2jCiAqICDnm67nmoTvvJrlkITppqzjga7jgIwz552A5Lul5YaF44Gr5YWl44KL56K6546HKCUp44CN44KS44CB5a6f6Zqb44Gu55qE5Lit546H44Gr5ZCI44GG5pWw5a2X44Gr44GZ44KL44CCCiAqICDjgoTjgovjgZPjgajvvJoKICogICAxKSDpgY7ljrvjga7jg6zjg7zjgrnjgpLmmYLns7vliJfjgavlho3nj77jgZfjgIHjg6zjg7zjgrnliY3jgavliIbjgYvjgovmg4XloLHjgaDjgZHjgaflkITppqzjga7norrnjofjgpLoqIjnrpcKICogICAgICAgIOODu+mBjuWOu+aIkOe4vuOBi+OCieS9nOOCi+ODouODh+ODq+OBrueiuueOh++8iOOCquODg+OCuuOCkuS9v+OCj+OBquOBhO+8iQogKiAgICAgICAg44O75Lq65rCX6aCG5L2Nw5fpoK3mlbDjgZTjgajjga7jgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H77yI5biC5aC044Gu5oOF5aCx44CC44Kq44OD44K65Y+W5b6X5b6M44Gv5Lq65rCX6aCG5L2N44GM5rG644G+44KL77yJCiAqICAgMikgMuOBpOOCkue1hOOBv+WQiOOCj+OBm+OBn+aWsOODouODh+ODq++8iOODreOCuOOCueODhuOCo+ODg+OCr+WbnuW4sO+8ieOCkuOAgeWtpue/kuWBtOOBruacn+mWk+OBp+S9nOOCiwogKiAgIDMpIOePvuihjOODouODh+ODq+OBjOWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iE1PREVMX1RSQUlOX0VOROS7pemZje+8ieOBp+OAgeWun+mam+OBrueahOS4reeOh+OBqOeqgeOBjeWQiOOCj+OBm+OCiwogKiAgIDQpIOaYjueiuuOBq+iJr+OBj+OBquOBo+OBn+OBqOOBjeOBoOOBkeaOoeeUqOOAgui2hemJhOadv++8iDk1JeS7peS4iu+8ieOBruWIh+OCjOebruOCguOAgeOBk+OBruacn+mWk+OBruWun+e4vuOBi+OCieaxuuOCgeOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFBMS0VZPSJrZWliYV9wbGFjZV92MSI7CgovKiDkurrmsJfpoIbkvY3Dl+mgreaVsOOBlOOBqOOBruOAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofvvIjlsJHjgarjgYTjg4fjg7zjgr/jga8zL+mgreaVsOOBuOWvhOOBm+OCi++8iSAqLwpjbGFzcyBQb3BQcml7CiBjb25zdHJ1Y3Rvcigpe3RoaXMubT1uZXcgTWFwKCl9CiBrZXkocG9wLE4pe3JldHVybiBNYXRoLm1pbigxOCxwb3ApKyJ8IitNYXRoLm1pbigxOCxNYXRoLm1heCg2LE4pKX0KIGFkZChsaXN0LE4pewogIGZvcihjb25zdCBbcG9wLGZpbl0gb2YgbGlzdCl7CiAgIGlmKCEocG9wPjApfHxmaW49PW51bGwpY29udGludWU7CiAgIGNvbnN0IGs9dGhpcy5rZXkocG9wLE4pO2xldCB4PXRoaXMubS5nZXQoayk7aWYoIXgpdGhpcy5tLnNldChrLHg9e246MCx0OjB9KTsKICAgeC5uKys7aWYoZmluPD0zKXgudCsrOwogIH0KIH0KIHJhdGUocG9wLE4pewogIGNvbnN0IHg9dGhpcy5tLmdldCh0aGlzLmtleShwb3AsTikpfHx7bjowLHQ6MH0sYmFzZT1NYXRoLm1pbiguOTUsMy9NYXRoLm1heChOLDMpKSxLPTMwOwogIHJldHVybih4LnQrSypiYXNlKS8oeC5uK0spOwogfQp9Ci8qIOeiuueOh+OBruWQiOioiOOCkuOBoeOCh+OBhuOBqXRhcmdldOOBq+OBmeOCi++8iOODreOCuOODg+ODiOOCkuS4gOanmOOBq+OBmuOCieOBme+8iSAqLwpmdW5jdGlvbiBub3JtU3VtKHosdGFyZ2V0KXsKIGxldCBsbz0tMTQsaGk9MTQ7CiBmb3IobGV0IGl0PTA7aXQ8NjA7aXQrKyl7Y29uc3QgbWlkPShsbytoaSkvMjtsZXQgcz0wO2Zvcihjb25zdCB2IG9mIHopcys9c2lnbSh2K21pZCk7aWYocz50YXJnZXQpaGk9bWlkO2Vsc2UgbG89bWlkfQogY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHoubWFwKHY9PnNpZ20oditjKSk7Cn0KLyogMemgreOBruWFpeWKm++8muODouODh+ODq+eiuueOh+ODu+S6uuawl+ODmeODvOOCueOBruWun+e4vueOh+ODu+S6uuawl+OBruS9jee9ruODu+mgreaVsOODu+ODouODh+ODq+WGheOBrumghuS9jSAqLwpmdW5jdGlvbiBwbGFjZVgocFAscG9wLE4scHJpLHJhbmtGcmFjKXsKIHJldHVybltsZ3QocFApLGxndChwcmkucmF0ZShwb3AsTikpLChwb3AtMSkvTWF0aC5tYXgoMSxOLTEpLE4vMTYscmFua0ZyYWMscG9wPT09MT8xOjAscG9wPD0zPzE6MF07Cn0KY29uc3QgcmFua0ZyYWNzPXBzPT57Y29uc3Qgbz1wcy5tYXAoKHAsaSk9PmkpLnNvcnQoKGEsYik9PnBzW2JdLXBzW2FdKSxyaz1BcnJheShwcy5sZW5ndGgpO28uZm9yRWFjaCgoaSxyKT0+cmtbaV09ci9NYXRoLm1heCgxLHBzLmxlbmd0aC0xKSk7cmV0dXJuIHJrfTsKY29uc3QgcG9wc0Zyb21PZGRzPW9kPT5vZC5tYXAodj0+MStvZC5maWx0ZXIodz0+dzx2KS5sZW5ndGgpOwoKY29uc3QgZ2V0UGxhY2VNb2RlbD0oKT0+e3RyeXtjb25zdCBtPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oUExLRVkpfHwibnVsbCIpO3JldHVybiBtJiZtLmtpbmQ9PT0ibmV3IiYmbS5tb2RlbCYmbS52ZXI9PT0xP206bnVsbH1jYXRjaChlKXtyZXR1cm4gbnVsbH19OwoKLyog5Y+N5b+c44Gu56K66KqN55So77ya5LqI5ris44Gu5Yy66ZaT44GU44Go44Gu5a6f57i+77yI5L+h6aC85oCn77yJICovCmZ1bmN0aW9uIHJlbGlhYmlsaXR5QmlucyhwLHksQil7CiBjb25zdCBpZHg9cC5tYXAoKF8saSk9PmkpLnNvcnQoKGEsYik9PnBbYV0tcFtiXSksbj15Lmxlbmd0aCxvdXQ9W107CiBmb3IobGV0IGI9MDtiPEI7YisrKXsKICBjb25zdCBzPWlkeC5zbGljZShNYXRoLmZsb29yKGIqbi9CKSxNYXRoLmZsb29yKChiKzEpKm4vQikpO2lmKCFzLmxlbmd0aCljb250aW51ZTsKICBjb25zdCBrPXMucmVkdWNlKChhLGkpPT5hK3lbaV0sMCksdz13aWxzb24oayxzLmxlbmd0aCk7CiAgb3V0LnB1c2goe2xvOnBbc1swXV0saGk6cFtzW3MubGVuZ3RoLTFdXSxuOnMubGVuZ3RoLG1lYW46cy5yZWR1Y2UoKGEsaSk9PmErcFtpXSwwKS9zLmxlbmd0aCxhY3Q6ay9zLmxlbmd0aCx3bG86d1swXSx3aGk6d1sxXX0pOwogfQogcmV0dXJuIG91dDsKfQpmdW5jdGlvbiB0aHJlc2hvbGRSb3cocCx5LHQpewogbGV0IG49MCxrPTA7Zm9yKGxldCBpPTA7aTxwLmxlbmd0aDtpKyspaWYocFtpXT49dCl7bisrO2srPXlbaV19CiBjb25zdCB3PXdpbHNvbihrLG4pO3JldHVybnt0LG4sayxyYXRlOm4/ay9uOjAsbG86d1swXSxoaTp3WzFdfTsKfQoKLyogLS0tLS0tLS0tLSDmpJzoqLzjgajlho3moKHmraPjga7mnKzkvZMgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBydW5QbGFjZUZpdChvcHRzKXsKIG9wdHM9b3B0c3x8e307CiBjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiMjAxOS0wMS0wMSIsVEVTVD1vcHRzLnRlc3RTdGFydHx8TU9ERUxfVFJBSU5fRU5EOwogYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTsKIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKIGNvbnN0IHJhY2VzPVsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsYik9PmEuZGF0ZTxiLmRhdGU/LTE6YS5kYXRlPmIuZGF0ZT8xOmEuaWQ8Yi5pZD8tMToxKTsKIGlmKHJhY2VzLmxlbmd0aDw1MDApe2J1c3koZmFsc2UpO3JldHVybntlcnJvcjoi6YGO5Y6744OH44O844K/44GM5bCR44Gq44GZ44GO44G+44GZ77yIIityYWNlcy5sZW5ndGgrIuODrOODvOOCue+8ieOAguWFiOOBq+mBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgiJ9fQogY29uc3Qgc3RvcmU9bmV3IFVFLlN0b3JlKCkscHJpPW5ldyBQb3BQcmkoKSxSUz1bXTsKIGZvcihsZXQgaT0wO2k8cmFjZXMubGVuZ3RoO2krKyl7CiAgY29uc3QgcmM9cmFjZXNbaV0sUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKSxOPVIubGVuZ3RoOwogIGNvbnN0IHZhbGlkPU4+PTgmJlIuZXZlcnkocj0+ci5wb3A+MCkmJlIuc29tZShyPT5yLmZpbmlzaD09PTEpOwogIGlmKHZhbGlkJiZyYy5kYXRlPj1TVEFSVCYmIS/pmpzlrrMvLnRlc3QoU3RyaW5nKFJbMF0ucmFjZU5hbWV8fCIiKSkpewogICBjb25zdCBvZD1SLmV2ZXJ5KHI9PnIub2Rkcz4xKT9SLm1hcChyPT5yLm9kZHMpOm51bGw7CiAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgIHRyeXsKICAgIGNvbnN0IGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG51bGwpLGFwTz1vZD9VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk6bnVsbCxyaz1yYW5rRnJhY3MoYXAucFApOwogICAgUlMucHVzaCh7ZGF0ZTpyYy5kYXRlLE4saDpSLm1hcCgocixqKT0+KHt4OnBsYWNlWChhcC5wUFtqXSxyLnBvcCxOLHByaSxya1tqXSkseTpyLmZpbmlzaDw9Mz8xOjAscFA6YXAucFBbal0scHI6cHJpLnJhdGUoci5wb3AsTikscE86YXBPP2FwTy5wT1tqXTpudWxsfSkpfSk7CiAgIH1jYXRjaChlKXt9CiAgfQogIGlmKHZhbGlkKXByaS5hZGQoUi5tYXAocj0+W3IucG9wLHIuZmluaXNoXSksTik7CiAgZm9yKGNvbnN0IHIgb2YgcmMucm93cyl7ci5jZj1jb3JuZXJGcmFjKHIuY29ybmVyLHJjLnJvd3MubGVuZ3RoKTtzdG9yZS5hZGQocil9CiAgaWYoaSUzMD09PTI5KXtidXN5KHRydWUsYOaZguezu+WIl+OBq+WGjeePvuOBl+OBpuaknOiovOS4reKApiAke2krMX0vJHtyYWNlcy5sZW5ndGh944Os44O844K5YCk7YXdhaXQgc2xlZXAoMCl9CiB9CiBidXN5KHRydWUsIuODouODh+ODq+OCkuavlOi8g+S4reKApiIpO2F3YWl0IHNsZWVwKDApOwogY29uc3QgdHJhaW49UlMuZmlsdGVyKHI9PnIuZGF0ZTxURVNUKSx0ZXN0PVJTLmZpbHRlcihyPT5yLmRhdGU+PVRFU1QpOwogY29uc3QgcmVzPXtuVHJhaW46dHJhaW4ubGVuZ3RoLG5UZXN0OnRlc3QubGVuZ3RoLHN0YXJ0OlNUQVJULHRlc3RTdGFydDpURVNUfTsKIGlmKHRyYWluLmxlbmd0aDwxNTAwfHx0ZXN0Lmxlbmd0aDwzMDApe2J1c3koZmFsc2UpO3JldHVybnsuLi5yZXMsZXJyb3I6YOaknOiovOOBq+S9v+OBiOOCi+ODrOODvOOCueOBjOi2s+OCiuOBvuOBm+OCk++8iOWtpue/kuWBtCR7dHJhaW4ubGVuZ3RofeODu+aknOiovOWBtCR7dGVzdC5sZW5ndGh977yJ44CC5qSc6Ki844Gu6ZaL5aeL5pel44KS5pep44KB44KL44GL44CB44OH44O844K/44KS5aKX44KE44GX44Gm44GP44Gg44GV44GE44CCYH19CiAvLyDmlrDjg6Ljg4fjg6vvvJrlrabnv5LlgbTjga7jgb/jgafkvZzjgosKIGNvbnN0IFg9W10seT1bXTtmb3IoY29uc3QgciBvZiB0cmFpbilmb3IoY29uc3QgaCBvZiByLmgpe1gucHVzaChoLngpO3kucHVzaChoLnkpfQogY29uc3QgbW9kZWw9Zml0TG9naXQoWCx5LDUpOwogY29uc3QgZmxhdD1mPT57Y29uc3QgcD1bXSx5eT1bXTtmb3IoY29uc3QgciBvZiB0ZXN0KXtjb25zdCB2PWYocik7ci5oLmZvckVhY2goKGgsaik9PntwLnB1c2godltqXSk7eXkucHVzaChoLnkpfSl9cmV0dXJue3AseTp5eX19OwogY29uc3QgZE5ldz1mbGF0KHI9Pm5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobW9kZWwsaC54KSksMykpOwogY29uc3QgZFBQPWZsYXQocj0+bm9ybVN1bShyLmgubWFwKGg9PmxndChoLnBQKSksMykpOwogY29uc3QgZE1rPWZsYXQocj0+bm9ybVN1bShyLmgubWFwKGg9PmxndChoLnByKSksMykpOwogcmVzLm1OZXc9bWV0cmljc09mKGROZXcucCxkTmV3LnkpO3Jlcy5tUFA9bWV0cmljc09mKGRQUC5wLGRQUC55KTtyZXMubU1rPW1ldHJpY3NPZihkTWsucCxkTWsueSk7CiAvLyDnj77ooYzjga7jgqrjg4Pjgrrovrzjgb/norrnjococE8p44Gv44CB44Kq44OD44K644Gk44GN44Gu5oiQ57i+44GM44GC44KL5pyf6ZaT44Gg44GR5q+U44G544KJ44KM44KLCiBjb25zdCBzdWI9dGVzdC5maWx0ZXIocj0+ci5oLmV2ZXJ5KGg9PmgucE8hPW51bGwpKTsKIHJlcy5uT2Rkc1Rlc3Q9c3ViLmxlbmd0aDsKIGlmKHN1Yi5sZW5ndGg+PTE1MCl7CiAgY29uc3QgcG49W10scG89W10seXk9W107Zm9yKGNvbnN0IHIgb2Ygc3ViKXtjb25zdCB2PW5vcm1TdW0oci5oLm1hcChoPT5wcmVkTG9naXQobW9kZWwsaC54KSksMyk7ci5oLmZvckVhY2goKGgsaik9Pntwbi5wdXNoKHZbal0pO3BvLnB1c2goaC5wTyk7eXkucHVzaChoLnkpfSl9CiAgcmVzLm1OZXdPZGRzPW1ldHJpY3NPZihwbix5eSk7cmVzLm1PZGRzPW1ldHJpY3NPZihwbyx5eSk7CiB9CiAvLyDmjqHnlKjjga7liKTmlq0KIGNvbnN0IG09cmVzLm1OZXc7CiBsZXQgYWRvcHQ9bS5sbDxyZXMubVBQLmxsLS4wMDMmJm0ubGw8cmVzLm1Nay5sbC0uMDAzOwogaWYoYWRvcHQmJnJlcy5tT2RkcylhZG9wdD1yZXMubU5ld09kZHMubGw8PXJlcy5tT2Rkcy5sbC0uMDAwNTsKIHJlcy5hZG9wdD1hZG9wdDtyZXMudnNPZGRzPXJlcy5tT2Rkcz8i5q+U6LyD5riI44G/Ijoi5pyq5q+U6LyDIjsKIC8vIOS/oemgvOaAp++8muS6iOa4rOOBruWMuumWk+OBlOOBqOOBruWun+mam+OBrueahOS4reeOhwogcmVzLmJpbnM9cmVsaWFiaWxpdHlCaW5zKGROZXcucCxkTmV3LnksMTApOwogcmVzLnRocj1bLjUsLjcsLjgsLjksLjkyLC45NV0ubWFwKHQ9PnRocmVzaG9sZFJvdyhkTmV3LnAsZE5ldy55LHQpKTsKIHJlcy5iaW5zUFA9cmVsaWFiaWxpdHlCaW5zKGRQUC5wLGRQUC55LDEwKTsKIC8vIOi2hemJhOadv++8neS6iOa4rDk1JeS7peS4iuOBrummrO+8iOS9lemgreOBp+OCgu+8ieOAguaknOiovOWBtOOBp+OAgeWun+mam+OBq+OBqeOCjOOBoOOBkeW9k+OBn+OBo+OBn+OBi+OCkuiomOmMsuOBmeOCiwogbGV0IGlyb249bnVsbDsKIHtjb25zdCByb3c9dGhyZXNob2xkUm93KGROZXcucCxkTmV3LnksLjk1KSxkYXlzPW5ldyBTZXQodGVzdC5tYXAocj0+ci5kYXRlKSkuc2l6ZTsKICBpZihyb3cubj4wKWlyb249e2N1dDouOTUscmF0ZTpyb3cucmF0ZSxsbzpyb3cubG8sbjpyb3cubixwZXJEYXk6ZGF5cz9yb3cubi9kYXlzOjAsbG93Tjpyb3cubjwxMDB9O30KIHJlcy5pcm9uPWlyb247CiByZXMubW9kZWw9YWRvcHQ/e3ZlcjoxLGtpbmQ6Im5ldyIsbW9kZWwsaXJvbixhdDpuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCksblRyYWluOnRyYWluLmxlbmd0aCxuVGVzdDp0ZXN0Lmxlbmd0aCx0ZXN0U3RhcnQ6VEVTVCwKICBtTmV3OnJlcy5tTmV3LG1QUDpyZXMubVBQLG1NazpyZXMubU1rLG1PZGRzOnJlcy5tT2Rkc3x8bnVsbCxtTmV3T2RkczpyZXMubU5ld09kZHN8fG51bGwsdGhyOnJlcy50aHJ9Om51bGw7CiBidXN5KGZhbHNlKTtyZXR1cm4gcmVzOwp9CgpmdW5jdGlvbiBwbGFjZVJlcG9ydChyKXsKIGlmKHIuZXJyb3IpcmV0dXJuYDxzcGFuIGNsYXNzPSJiYWQiPiR7ZXNjKHIuZXJyb3IpfTwvc3Bhbj5gOwogY29uc3QgZj14PT54LnRvRml4ZWQoNCkscm93PShsLG0pPT5gPHRyPjx0ZD4ke2x9PC90ZD48dGQ+JHtmKG0ubGwpfTwvdGQ+PHRkPiR7ZihtLmJyaWVyKX08L3RkPjx0ZD4ke20uYXVjLnRvRml4ZWQoMyl9PC90ZD48dGQ+JHsobS5lY2UqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjwvdHI+YDsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S5YG0ICR7ci5uVHJhaW5944Os44O844K577yP5qSc6Ki85YG0ICR7ci5uVGVzdH3jg6zjg7zjgrnvvIgke2VzYyhyLnRlc3RTdGFydCl95Lul6ZmN77yd54++6KGM44Oi44OH44Or44GM5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJ44CCMemgreOBlOOBqOOBq+OAjDPnnYDku6XlhoXjgI3jgpLlvZPjgabjgZ/miJDnuL7jgafjgZnvvIg46aCt5Lul5LiK44Gu44Os44O844K577yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+56K6546H44Gu44KC44Go77yI5qSc6Ki85YG077yJPC90aD48dGg+5a++5pWw5pCN5aSx4oaTPC90aD48dGg+6Kqk5beu4oaTPC90aD48dGg+QVVD4oaRPC90aD48dGg+6LyD5q2j6Kqk5beu4oaTPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PgogJHtyb3coIumBjuWOu+aIkOe4vuODouODh+ODq+OBruOBvyIsci5tUFApfSR7cm93KCLkurrmsJfpoIbkvY3jga7lrp/nuL7jga7jgb8iLHIubU1rKX0ke3JvdygiPGI+5paw77yI5Lih5pa544KS57WE44G/5ZCI44KP44Gb77yJPC9iPiIsci5tTmV3KX08L3Rib2R5PjwvdGFibGU+PC9kaXY+YDsKIGlmKHIubU9kZHMpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgaTjgY3jga7mpJzoqLzjg4fjg7zjgr8gJHtyLm5PZGRzVGVzdH3jg6zjg7zjgrnjgafjga7nm7TmjqXmr5TovIPvvJrnj77ooYzvvIjjgqrjg4Pjgrrovrzjgb/vvInjga7lr77mlbDmkI3lpLEgJHtmKHIubU9kZHMubGwpfSDvvI8g5pawICR7ZihyLm1OZXdPZGRzLmxsKX08L2Rpdj5gOwogZWxzZSBoKz1gPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+44Kq44OD44K644Gk44GN44Gu5qSc6Ki844OH44O844K/44GM5bCR44Gq44GE44Gf44KB44CB54++6KGM44Gu44CM44Kq44OD44K66L6844G/44Gu56K6546H44CN44Go44Gu55u05o6l5q+U6LyD44Gv44Gn44GN44Gm44GE44G+44Gb44KT77yI5Lq65rCX6aCG5L2N44Gv44CB44Kq44OD44K65Y+W5b6X5b6M44Gr5rG644G+44KL5YCk44KS5L2/44Gj44Gm44GE44G+44GZ77yJ44CCPC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJiYW5uZXIgJHtyLmFkb3B0PyJvayI6InduIn0iPjxiPue1kOaenO+8miR7ci5hZG9wdD8i5paw44Oi44OH44Or44KS5o6h55So77yI6YCx5pyr44Gu5LqI5oOz44Gu56K6546H44Gr5Y+N5pig77yJIjoi54++6KGM44Gu44G+44G+77yI5paw44Oi44OH44Or44Gv5piO56K644Gr44Gv6Imv44GP44Gq44KJ44Gq44GL44Gj44Gf77yJIn08L2I+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+5o6h55So5p2h5Lu277ya6YGO5Y675oiQ57i+44Oi44OH44Or44Gu44G/44O75Lq65rCX6aCG5L2N44Gu44G/44Gu5Lih5pa544KI44KK44CB5a++5pWw5pCN5aSx44GMMC4wMDPku6XkuIroia/jgYTjgZPjgajjgIIke3IubU9kZHM/IuOBleOCieOBq+ePvuihjO+8iOOCquODg+OCuui+vOOBv++8ieOCiOOCiuiJr+OBhOOBk+OBqOOAgiI6IiJ9PC9zcGFuPjwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuS6iOa4rOOBruWMuumWk+OBlOOBqOOBrjxiPuWun+mam+OBrueahOS4reeOhzwvYj7vvIjmpJzoqLzlgbTjgILkuojmuKzjgajlrp/pmpvjgYzov5HjgYTjgbvjganmraPnorrvvIk8L2Rpdj48ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+5LqI5ris44Gu56+E5ZuyPC90aD48dGg+6aCt5pWwPC90aD48dGg+5LqI5ris44Gu5bmz5Z2HPC90aD48dGg+5a6f6ZqbPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgYiBvZiByLmJpbnMpaCs9YDx0cj48dGQ+JHtwY3QoYi5sbyl944CcJHtwY3QoYi5oaSl9PC90ZD48dGQ+JHtiLm59PC90ZD48dGQ+JHtwY3QoYi5tZWFuLDEpfTwvdGQ+PHRkPjxiPiR7cGN0KGIuYWN0LDEpfTwvYj48L3RkPjwvdHI+YDsKIGgrPWA8L3Rib2R5PjwvdGFibGU+PC9kaXY+PGRpdiBjbGFzcz0ic21hbGwiPumrmOOBhOS6iOa4rOOBruWun+e4vu+8iOaknOiovOWBtO+8iTwvZGl2PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7kuojmuKw8L3RoPjx0aD7poK3mlbA8L3RoPjx0aD7lrp/pmpvjga7nmoTkuK3njoc8L3RoPjx0aD45NSXjga7luYU8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB0IG9mIHIudGhyKWgrPWA8dHI+PHRkPiR7cGN0KHQudCl95Lul5LiKPC90ZD48dGQ+JHt0Lm59PC90ZD48dGQ+PGI+JHtwY3QodC5yYXRlLDEpfTwvYj48L3RkPjx0ZD4ke3BjdCh0LmxvLDEpfeOAnCR7cGN0KHQuaGksMSl9PC90ZD48L3RyPmA7CiBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiBpZihyLmlyb24paCs9YDxkaXYgY2xhc3M9InNtYWxsIj48Yj7otoXpiYTmnb/vvIjkuojmuKw5NSXku6XkuIrjg7vpoK3mlbDjga7liLbpmZDjgarjgZfvvInvvJo8L2I+5qSc6Ki85YG044Gn44CB5a6f6Zqb44GrJHtwY3Qoci5pcm9uLnJhdGUsMSl944GMM+edgOS7peWGhe+8iCR7ci5pcm9uLm596aCt44CBOTUl44Gu5bmFICR7cGN0KHIuaXJvbi5sbywxKX3jgJwke3BjdChyLmlyb24uaGksMSl944CBMeaXpeOBguOBn+OCiue0hCR7ci5pcm9uLnBlckRheS50b0ZpeGVkKDIpfemgrSR7ci5pcm9uLmxvd04/IuOAgumgreaVsOOBjOWwkeOBquOCgeOBp+W5heOBjOW6g+OBhCI6IiJ977yJ44CCJHtyLmlyb24ucmF0ZT49Ljk1PyIiOiI8c3BhbiBjbGFzcz1cIndhcm5cIj45NSXjgavjga/lsYrjgYTjgabjgYTjgb7jgZvjgpPjgII8L3NwYW4+In08L2Rpdj5gOwogZWxzZSBoKz0nPGRpdiBjbGFzcz0ic21hbGwgd2FybiI+5qSc6Ki85YG044Gr44CB5LqI5risOTUl5Lul5LiK44Gu6aas44Gv44GE44G+44Gb44KT44Gn44GX44Gf77yI6LaF6YmE5p2/44Gv5Ye644Gq44GE44CB44G+44Gf44Gv5Ye644Gm44KC44GU44GP5bCR5pWw44Gn44GZ77yJ44CCPC9kaXY+JzsKIHJldHVybiBoOwp9CmZ1bmN0aW9uIHBsYWNlU3RhdHVzTGluZSgpewogY29uc3QgTT1nZXRQbGFjZU1vZGVsKCk7CiBpZighTSlyZXR1cm4nPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8muaomea6luODouODh+ODq+OBruaVsOWtl+OBp+OBmeOAguOAjOaknOiovOOAjeOCv+ODluOBp+OAgeiHquWIhuOBruODh+ODvOOCv+OBp+OBruaknOiovOODu+WGjeagoeato+OBjOOBp+OBjeOBvuOBmeOAgjwvZGl2Pic7CiByZXR1cm5gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOh++8mjxiPuWGjeagoeato+OBl+OBn+aWsOODouODh+ODqzwvYj7jgafooajnpLrkuK3vvIjmpJzoqLzml6UgJHtlc2MoTS5hdCl977yP5qSc6Ki8ICR7TS5uVGVzdH3jg6zjg7zjgrnjgIHlrp/pmpvjga7nmoTkuK3njofjgavlkIjjgo/jgZvjgabjgYLjgorjgb7jgZnvvInjgII8L2Rpdj5gOwp9CgoKLyogLS0tLS0tLS0tLSDkv53lrZjjg4fjg7zjgr/jga7nirbms4EgLS0tLS0tLS0tLSAqLwphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7pgY7ljrvjg4fjg7zjgr/jga/mnKrlj5blvpfjgafjgZnjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44GL44KJ44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IGxkPWxpdmUubWFwKGY9PmYuZGF0ZSkuc29ydCgpLG5SYWNlcz1saXZlLnJlZHVjZSgocyxmKT0+cytuZXcgU2V0KGYucm93cy5tYXAocj0+ci5yYWNlSWQpKS5zaXplLDApOwogIGxldCBuQWxsPTAsblRyPTA7Zm9yKGNvbnN0IGYgb2YgbGl2ZSlmb3IoY29uc3QgciBvZiBmLnJvd3Mpe25BbGwrKztpZihyLnRyYWluZXIpblRyKyt9CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl0NTVu+8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgaWYobkFsbCloKz1gXG7oqr/mlZnluKvjgaTjgY3jga7miJDnuL7vvJoke01hdGgucm91bmQoblRyL25BbGwqMTAwKX0lJHtuVHI9PT0wPyLvvIjjgZPjgozjgYvjgonlj5blvpfjgZnjgovmiJDnuL7jgavlhaXjgorjgb7jgZnvvIkiOiIifWA7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9CgovKiAtLS0tLS0tLS0tIOWPluW+l+OBl+OBn+ihjCDihpIg5YaF6YOo44Gu6KGM77yI6Kq/5pWZ5bir44O744Kw44Os44O844OJ5LuY44GN77yJIC0tLS0tLS0tLS0gKi8KZnVuY3Rpb24gbGl2ZVJvdyh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLAogIHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksdHJhaW5lcjpVRS5jbGVhblRyKHgudHJhaW5lciksCiAgcmFjZU5hbWU6U3RyaW5nKHgucmFjZU5hbWV8fCIiKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpLAogIGdyZDpVRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSksCiAgY29ybmVyOkFycmF5LmlzQXJyYXkoeC5jb3JuZXIpJiZ4LmNvcm5lci5sZW5ndGg/eC5jb3JuZXI6bnVsbCxsYXA6QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aD94LmxhcDpudWxsfX0KCi8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCi++8iOmojuaJi+ODu+iqv+aVmeW4q+OBruaIkOe4vuOCguWQjOaZguOBq+mbhuioiO+8iSAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgILlhYjjgavjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GZ44GL44CB6Kit5a6a44Gn44OQ44OD44Kv44Ki44OD44OX44KS5b6p5YWD44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtzdC50cj1uZXcgTWFwKCk7bGV0IHVzZWQ9MDtjb25zdCBBRz1uZXcgTWFwKCk7CiBjb25zdCB0YWtlPXI9PntpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpcmV0dXJuO2FnZ0FkZChBRyxyKTtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGU7CiAgaWYoci50cmFpbmVyJiZyLmZpbmlzaCE9bnVsbCl7bGV0IHQ9c3QudHIuZ2V0KHIudHJhaW5lcik7aWYoIXQpc3QudHIuc2V0KHIudHJhaW5lcix0PXtuOjAsdDM6MH0pO3QubisrO2lmKHIuZmluaXNoPD0zKXQudDMrK319OwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtjb25zdCByd3M9ZnNbaV0ucm93c3x8W10sY250PXt9O2Zvcihjb25zdCB4IG9mIHJ3cyljbnRbeC5yYWNlSWRdPShjbnRbeC5yYWNlSWRdfHwwKSsxO2Zvcihjb25zdCB4IG9mIHJ3cyl7Y29uc3Qgcj1saXZlUm93KHgpO3IuY2Y9Y29ybmVyRnJhYyh4LmNvcm5lcixjbnRbeC5yYWNlSWRdKTt0YWtlKHIpfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl0YWtlKFVFLnRvUm93KG8pKTsKICBhd2FpdCBzbGVlcCgwKTsKIH0KIGNvbnN0IHByaT1uZXcgVXBQcmkoKSxwcD1uZXcgUG9wUHJpKCk7Zm9yKGNvbnN0IGEgb2YgQUcudmFsdWVzKCkpe3ByaS5hZGQoYWdnSW5mbyhhKSk7aWYoYS5OPj02JiZhLnBmLmxlbmd0aD09PWEuTiYmIWEuanVtcClwcC5hZGQoYS5wZixhLk4pfXN0LnVwPXByaTtzdC5wcD1wcDsKIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7c3QuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIOWHuummrOihqOOBrjHjg6zjg7zjgrkg4oaSIOino+aekOeUqOOBruODrOODvOOCuSAqLwpmdW5jdGlvbiBta1JhY2UoYyxkKXsKIGNvbnN0IGhzPWMuaG9yc2VzfHxjLnJ1bm5lcnN8fFtdOwogY29uc3QgZ3Q9KGMuY2xhc3NOYW1lfHwiIikrIiAiKyhjLmdyYWRlfHwiIikrIiAiKyhjLnJhY2VOYW1lfHwiIik7CiBjb25zdCBncmQ9VUUuZ3JhZGVUaWVyKGd0LGMucHJpemUsdHJ1ZSk7CiByZXR1cm57ZGF0ZTpkLHN1cmY6VUUuc3VyZkNvZGUoYy5zdXJmYWNlKSxkaXN0Ok51bWJlcihjLmRpc3RhbmNlKXx8MCwKICBsdmw6VUUubGV2ZWxPZkxhYmVsKGMuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKGMucmFjZU5hbWUpfHwoZ3JkPj0xPzU6MCksZ3JkLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjsKICAgcmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSx0cmFpbmVyOlVFLmNsZWFuVHIoaC50cmFpbmVyfHwiIiksYWdlOmguYWdlfHxudWxsLG51bTpoLmhvcnNlTnVtYmVyfHxoLm51bWJlcnx8aSsxfX0pCiAgIC5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOS7iumAseacq+OBruWPluW+lwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IFdLPXtkYXRlczpbXSxjYXJkczp7fSxvZGRzOnt9LG9kZHNOb3Rlczp7fSxkaWFnOltdLGNhbGM6e30sYXQ6IiIsc3RvcmVJbmZvOm51bGx9Owpjb25zdCBya2V5PShkLGMpPT5gJHtkfXwke1N0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MH1gOwpjb25zdCB3a01zZz10PT57JCgid2tTdGF0dXMiKS50ZXh0Q29udGVudD10fTsKY29uc3QgYmFzZVVybD0oKT0+JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwpmdW5jdGlvbiBuZXh0V2Vla2VuZCh0b2RheSl7Y29uc3Qgb3V0PVtdO2NvbnN0IHQ9bmV3IERhdGUodG9kYXkrIlQwMDowMDowMFoiKS5nZXRUaW1lKCk7CiBmb3IobGV0IGk9MDtpPDgmJm91dC5sZW5ndGg8MjtpKyspe2NvbnN0IGQ9bmV3IERhdGUodCtpKjg2NGU1KSx3PWQuZ2V0VVRDRGF5KCk7aWYodz09PTZ8fHc9PT0wKW91dC5wdXNoKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSl9cmV0dXJuIG91dH0KCmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSl9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KCi8qIDHplovlgqzloLTjgbbjgpPjga7lh7rppqzooajjgILmrKDjgZHjg7vlpLHmlZfjgYzjgYLjgozjgbDjgIHoh6rli5Xjgacx5Zue44Gg44GR44KE44KK55u044GZICovCmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsaXNSZXRyeSl7CiBjb25zdCBjb2RlPVN0cmluZyh2LnZlbnVlQ29kZSk7CiBXSy5jYXJkc1tkXT0oV0suY2FyZHNbZF18fFtdKS5maWx0ZXIoYz0+U3RyaW5nKGMudmVudWVDb2RlKSE9PWNvZGUpOwogV0suZGlhZz1XSy5kaWFnLmZpbHRlcih4PT4hKHguZD09PWQmJnguY29kZT09PWNvZGUpKTsKIHRyeXsKICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLGNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksYmFkPXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV0suY2FyZHNbZF0ucHVzaCguLi5vayk7CiAgY29uc3QgaXNzdWVzPW9rLmZpbHRlcihjPT5jLnF1YWxpdHkmJiFjLnF1YWxpdHkub2spLm1hcChjPT5gJHtjLnJhY2VOdW1iZXJ9Uu+8miR7Yy5xdWFsaXR5Lmlzc3Vlcy5qb2luKCLjg7siKX1gKTsKICBXSy5kaWFnLnB1c2goe2QsY29kZSxuYW1lOnYudmVudWVOYW1lfHxWRU5VRVtjb2RlXXx8Y29kZSxyYWNlczpyYWNlcy5sZW5ndGgsb2s6b2subGVuZ3RoLGJhZCxpc3N1ZXMsZXJyOiFyYWNlcy5sZW5ndGg/IuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyI6IiJ9KTsKICBpZigoYmFkPjB8fG9rLmxlbmd0aDw4KSYmIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDgwMCk7cmV0dXJuIGxvYWRWZW51ZUludG8oYmFzZSxkLHYsdHJ1ZSl9CiB9Y2F0Y2goZSl7CiAgV0suZGlhZy5wdXNoKHtkLGNvZGUsbmFtZTp2LnZlbnVlTmFtZXx8VkVOVUVbY29kZV18fGNvZGUscmFjZXM6MCxvazowLGJhZDowLGlzc3VlczpbXSxlcnI6ZS5tZXNzYWdlfSk7CiAgaWYoIWlzUmV0cnkpe2F3YWl0IHNsZWVwKDEyMDApO3JldHVybiBsb2FkVmVudWVJbnRvKGJhc2UsZCx2LHRydWUpfQogfQp9CgovKiDjgqrjg4PjgrrvvIjljZjli53vvIvopIfli53vvInjgILlh7rppqzooajjga7jg6rjg7Pjgq/jgYvjgonnm7TmjqUg4oaSIOWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOBr+OAgeaXpeS7mOODu+mWi+WCrOWgtOOBruODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhiAqLwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHNEYXRlKGJhc2UsZCl7CiBjb25zdCBjYXJkcz1XSy5jYXJkc1tkXXx8W10sbm90ZXM9W107V0sub2Rkc05vdGVzPVdLLm9kZHNOb3Rlc3x8e307CiBpZighY2FyZHMubGVuZ3RoKXtXSy5vZGRzTm90ZXNbZF09bm90ZXM7cmV0dXJue246MCxub3Rlc319CiBjb25zdCB3aXRoTGluaz1jYXJkcy5maWx0ZXIocj0+ci5vZGRzQ25hbWUpLGJ5Qz1uZXcgTWFwKHdpdGhMaW5rLm1hcChyPT5bci5vZGRzQ25hbWUscl0pKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHdpdGhMaW5rLmxlbmd0aDtpKz02KWNodW5rcy5wdXNoKHdpdGhMaW5rLnNsaWNlKGksaSs2KS5tYXAocj0+ci5vZGRzQ25hbWUpKTsKIGxldCBjaT0wLGZhaWxOPTA7Y29uc3QgcmVhc29ucz17fTsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoY2k8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1jaSsrOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IHI9YnlDLmdldChpdC5jbmFtZSk7aWYocilXSy5vZGRzW3JrZXkoZCxyKV09e3RhbjppdC5vZGRzfHx7fSxwbGFjZTppdC5wbGFjZXx8e30sYXQ6RGF0ZS5ub3coKX19CiAgIGZvcihjb25zdCBmIG9mICh4LmZhaWxlZHx8W10pKXtmYWlsTisrO2NvbnN0IG09U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw2MCk7cmVhc29uc1ttXT0ocmVhc29uc1ttXXx8MCkrMX0KICB9Y2F0Y2goZSl7ZmFpbE4rPWNodW5rc1trXS5sZW5ndGg7Y29uc3QgbT1TdHJpbmcoZS5tZXNzYWdlfHxlKS5zbGljZSgwLDYwKTtyZWFzb25zW21dPShyZWFzb25zW21dfHwwKSsxfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiBjb25zdCBkaXJlY3Q9Y2FyZHMuZmlsdGVyKHI9PldLLm9kZHNbcmtleShkLHIpXSkubGVuZ3RoOwogbm90ZXMucHVzaChg5Ye66aas6KGo44Gu44Oq44Oz44Kv44GL44KJ55u05o6l77yaJHtkaXJlY3R9LyR7Y2FyZHMubGVuZ3RofeODrOODvOOCue+8iOODquODs+OCr+OBguOCiiAke3dpdGhMaW5rLmxlbmd0aH3jgIHlpLHmlZcgJHtmYWlsTn3vvIlgKTsKIGZvcihjb25zdCBbbSxjXSBvZiBPYmplY3QuZW50cmllcyhyZWFzb25zKSlub3Rlcy5wdXNoKGDjgIDlpLHmlZfjga7nkIbnlLHvvJoke21977yIJHtjfe+8iWApOwogY29uc3QgbWlzc2luZz1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihtaXNzaW5nLmxlbmd0aCl7CiAgZm9yKGNvbnN0IHYgb2YgWy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKSl7CiAgIGNvbnN0IG5lZWQ9bmV3IFNldChtaXNzaW5nLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KS5tYXAocj0+TnVtYmVyKHIucmFjZU51bWJlcikpKTsKICAgdHJ5ewogICAgY29uc3QgTD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHMtbGlua3M/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBjb25zdCBhbGw9TC5saW5rc3x8W10sbGlua3M9YWxsLmZpbHRlcih4PT5uZWVkLmhhcyh4LnJhY2VObykpOwogICAgbm90ZXMucHVzaChg44Oh44OL44Ol44O857WM55SxICR7VkVOVUVbdl18fHZ977ya44Kq44OD44K655S76Z2i44GM44GC44KL44Os44O844K5ICR7YWxsLm1hcCh4PT54LnJhY2VObykuam9pbigiLCIpfHwi44Gq44GXIn3vvIjmnKrlj5blvpcke25lZWQuc2l6ZX3jg6zjg7zjgrnjga7jgYbjgaEke2xpbmtzLmxlbmd0aH3jg6zjg7zjgrnvvIlgKTsKICAgIGlmKCFhbGwubGVuZ3RoKW5vdGVzLnB1c2goYOOAgOeZuuWjsuWJjeOBruWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAguiouuaWre+8miR7SlNPTi5zdHJpbmdpZnkoKEwuZGlhZ3x8W10pLm1hcCh4PT4oe3M6eC5zdGVwLGxlbjp4Lmh0bWxMZW5ndGgsbjp4LmNuYW1lcyxrOngua2luZHMsbTp4Lm1lbnVzLGU6eC5lcnJvcn0pKSkuc2xpY2UoMCwzNjApfWApOwogICAgY29uc3QgYnlDPW5ldyBNYXAobGlua3MubWFwKHg9Plt4LmNuYW1lLHgucmFjZU5vXSkpOwogICAgZm9yKGxldCBpPTA7aTxsaW5rcy5sZW5ndGg7aSs9NCl7CiAgICAgY29uc3QgY2g9bGlua3Muc2xpY2UoaSxpKzQpLm1hcCh4PT54LmNuYW1lKTsKICAgICB0cnl7CiAgICAgIGNvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2NuYW1lcz0ke2NoLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgICAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCBubz1ieUMuZ2V0KGl0LmNuYW1lKTtpZihubylXSy5vZGRzW2Ake2R9fCR7dn0tJHtub31gXT17dGFuOml0Lm9kZHN8fHt9LHBsYWNlOml0LnBsYWNlfHx7fSxhdDpEYXRlLm5vdygpfX0KICAgICAgZm9yKGNvbnN0IGYgb2YgKHguZmFpbGVkfHxbXSkpbm90ZXMucHVzaChg44CA6Kqt44G/5Y+W44KM44Gq44GL44Gj44Gf77yaJHtWRU5VRVt2XXx8dn0ke2J5Qy5nZXQoZi5jbmFtZSl9Uu+8iCR7U3RyaW5nKGYucmVhc29ufHwiIikuc2xpY2UoMCw1MCl977yJYCk7CiAgICAgfWNhdGNoKGUpe25vdGVzLnB1c2goYOOAgOWPluW+l+OCqOODqeODvCAke1ZFTlVFW3ZdfHx2fe+8miR7U3RyaW5nKGUubWVzc2FnZXx8ZSkuc2xpY2UoMCw3MCl9YCl9CiAgICB9CiAgIH1jYXRjaChlKXtub3Rlcy5wdXNoKGDjg6Hjg4vjg6Xjg7zntYznlLEgJHtWRU5VRVt2XXx8dn3vvJrlpLHmlZfvvIgke1N0cmluZyhlLm1lc3NhZ2V8fGUpLnNsaWNlKDAsMTAwKX3vvIlgKX0KICB9CiB9CiBjb25zdCBzdGlsbD1jYXJkcy5maWx0ZXIocj0+IVdLLm9kZHNbcmtleShkLHIpXSk7CiBpZihzdGlsbC5sZW5ndGgpbm90ZXMucHVzaChg44Kq44OD44K65pyq5Y+W5b6X77yaJHtzdGlsbC5tYXAocj0+KHIudmVudWVOYW1lfHwiIikrci5yYWNlTnVtYmVyKyJSIikuam9pbigi44CBIil977yI55m65aOy5YmN44CB44G+44Gf44Gv6Kqt44G/5Y+W44KM44Gm44GE44G+44Gb44KT77yJYCk7CiBXSy5vZGRzTm90ZXNbZF09bm90ZXM7CiByZXR1cm57bjpjYXJkcy5maWx0ZXIocj0+V0sub2Rkc1tya2V5KGQscildKS5sZW5ndGgsbm90ZXN9Owp9CgpsZXQgT0REU19USU1FUj1udWxsLE9ERFNfVFJJRVM9MDsKZnVuY3Rpb24gb2Rkc01pc3NpbmcoKXtsZXQgbT0wLHQ9MDtmb3IoY29uc3QgZCBvZiBXSy5kYXRlcylmb3IoY29uc3QgYyBvZiBXSy5jYXJkc1tkXXx8W10pe3QrKztpZighV0sub2Rkc1tya2V5KGQsYyldKW0rK31yZXR1cm57bSx0fX0KLyog44Kq44OD44K644Gu5pyq5Y+W5b6X44GM5q6L44Gj44Gm44GE44Gm44CB5b2T5pel44Gu5pyd44Cc5aSV5pa544Gq44KJ44CBNeWIhuOBlOOBqOOBq+iHquWLleOBp+WPluOCiuebtOOBme+8iEpSQeOBr+mAmuW4uOOBruODrOODvOOCueOCkuW9k+aXpeacneOBq+eZuuWjsumWi+Wni+OBmeOCi+OBn+OCge+8iSAqLwpmdW5jdGlvbiBzY2hlZHVsZU9kZHNSZXRyeSgpewogaWYoT0REU19USU1FUil7Y2xlYXJUaW1lb3V0KE9ERFNfVElNRVIpO09ERFNfVElNRVI9bnVsbH0KIGNvbnN0IHttfT1vZGRzTWlzc2luZygpLGg9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykuZ2V0VVRDSG91cnMoKTsKIGlmKCFtfHxPRERTX1RSSUVTPj0zNnx8aDw2fHxoPj0xN3x8IVdLLmRhdGVzLmluY2x1ZGVzKGpzdFRvZGF5KCkpKXJldHVybiBmYWxzZTsKIE9ERFNfVFJJRVMrKztPRERTX1RJTUVSPXNldFRpbWVvdXQoKCk9PntPRERTX1RJTUVSPW51bGw7aWYoISQoIndrR28iKS5kaXNhYmxlZClvZGRzT25seSgpfSw1KjYwZTMpO3JldHVybiB0cnVlOwp9CmNvbnN0IG9kZHNIaW50PSgpPT57Y29uc3Qge219PW9kZHNNaXNzaW5nKCk7aWYoIW0pcmV0dXJuIiI7Y29uc3Qgc2NoPXNjaGVkdWxlT2Rkc1JldHJ5KCk7cmV0dXJuYFxu5pyq5Y+W5b6XICR7bX3jg6zjg7zjgrnvvJrnmbrlo7LliY3jga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnvvIhKUkHjga/pgJrluLjjga7jg6zjg7zjgrnjga7jgqrjg4PjgrrjgpLlvZPml6XmnJ3jgavnmbrlo7Lplovlp4vvvInjgIIke3NjaD8iNeWIhuOBlOOBqOOBq+iHquWLleOBp+WPluOCiuebtOOBl+OBvuOBmeOAgiI6IueZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiJ9YH07CmFzeW5jIGZ1bmN0aW9uIHdlZWtlbmRHbygpe09ERFNfVFJJRVM9MDsKIGNvbnN0IGJhc2U9YmFzZVVybCgpOyQoIndrR28iKS5kaXNhYmxlZD10cnVlOyQoIndrT2RkcyIpLmRpc2FibGVkPXRydWU7CiBXSy5kYXRlcz1bXTtXSy5jYXJkcz17fTtXSy5vZGRzPXt9O1dLLmRpYWc9W107V0suY2FsYz17fTsKIHRyeXsKICB3a01zZygi6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgdG9kYXk9anN0VG9kYXkoKTtsZXQgZGF0ZXM9W107CiAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke3RvZGF5fSZsaXN0PTFgLFsxNTAwXSk7ZGF0ZXM9KHguYXZhaWxhYmxlRGF0ZXN8fFtdKS5maWx0ZXIoZD0+ZD49dG9kYXkpfWNhdGNoKGUpe30KICBpZighZGF0ZXMubGVuZ3RoKWRhdGVzPW5leHRXZWVrZW5kKHRvZGF5KTsKICBkYXRlcz1bLi4ubmV3IFNldChkYXRlcyldLnNvcnQoKS5zbGljZSgwLDMpOwogIGZvcihjb25zdCBkIG9mIGRhdGVzKXsKICAgd2tNc2coYCR7ZH0g6ZaL5YKs5aC044KS56K66KqN5Lit4oCmYCk7CiAgIGxldCB2ZW51ZXM9W107CiAgIHRyeXt2ZW51ZXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtkfSZsaXN0PTFgLFsxNTAwXSkpLnZlbnVlc3x8W119CiAgIGNhdGNoKGUpe1dLLmRpYWcucHVzaCh7ZCxjb2RlOiIiLG5hbWU6IijplovlgqzloLTkuIDopqcpIixyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjplLm1lc3NhZ2V9KTtjb250aW51ZX0KICAgaWYoIXZlbnVlcy5sZW5ndGgpe1dLLmRpYWcucHVzaCh7ZCxjb2RlOiIiLG5hbWU6IijplovlgqzjgarjgZcpIixyYWNlczowLG9rOjAsYmFkOjAsaXNzdWVzOltdLGVycjoi44GT44Gu5pel44Gu5Ye66aas6KGo44Gv5pyq5YWs6ZaL44CB44G+44Gf44Gv6ZaL5YKs44GM44GC44KK44G+44Gb44KTIn0pO2NvbnRpbnVlfQogICBXSy5jYXJkc1tkXT1bXTsKICAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXt3a01zZyhgJHtkfSAke3YudmVudWVOYW1lfHx2LnZlbnVlQ29kZX0g44Gu5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCm77yIJHsoV0suY2FyZHNbZF18fFtdKS5sZW5ndGh944Os44O844K55Y+W5b6X5riI44G/77yJYCk7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlLGQsdil9CiAgIGlmKChXSy5jYXJkc1tkXXx8W10pLmxlbmd0aClXSy5kYXRlcy5wdXNoKGQpOwogIH0KICBpZighV0suZGF0ZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi5Ye66aas6KGo44KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf44CC44CM5Y+W44KK6L6844G/54q25rOB44CN44K/44OW44KS56K66KqN44GX44Gm44GP44Gg44GV44GE44CCIik7CiAgbGV0IG9kZHNOPTAsdG90YWw9MDsKICBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7d2tNc2coYCR7ZH0g44Kq44OD44K644KS5Y+W5b6X5Lit4oCmYCk7b2Rkc04rPShhd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2UsZCkpLm47dG90YWwrPVdLLmNhcmRzW2RdLmxlbmd0aH0KICB3a01zZygi6YGO5Y6744OH44O844K/44Go54Wn5ZCI44GX44Gm44CB5YWo44Os44O844K544KS6Kej5p6Q5Lit4oCmIik7CiAgYXdhaXQgY2FsY1dlZWtlbmQoKTtXSy5hdD1uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDExLDE2KTsKICByZW5kZXJBbGwoKTsKICBjb25zdCBucj1XSy5kYXRlcy5yZWR1Y2UoKHMsZCk9PnMrV0suY2FyZHNbZF0ubGVuZ3RoLDApOwogIHdrTXNnKGDlrozkuobvvIgke1dLLmF0fe+8ie+8miR7V0suZGF0ZXMuam9pbigi44CBIil977yPJHtucn3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtvZGRzTn3jg6zjg7zjgrkke29kZHNIaW50KCl9YCk7CiAgJCgid2tPZGRzIikuZGlzYWJsZWQ9ZmFsc2U7c2hvd1RhYigidkF4aXMiKTsKIH1jYXRjaChlKXt3a01zZygi44Ko44Op44O877yaIitlLm1lc3NhZ2UpO2J1c3koZmFsc2UpO3JlbmRlckFsbCgpfQogZmluYWxseXskKCJ3a0dvIikuZGlzYWJsZWQ9ZmFsc2V9Cn0KYXN5bmMgZnVuY3Rpb24gb2Rkc09ubHkoKXsKIGlmKCFXSy5kYXRlcy5sZW5ndGgpcmV0dXJuOyQoIndrT2RkcyIpLmRpc2FibGVkPXRydWU7CiB0cnl7bGV0IG49MDtmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7d2tNc2coYCR7ZH0g44Kq44OD44K644KS5pu05paw5Lit4oCmYCk7bis9KGF3YWl0IGZldGNoT2Rkc0RhdGUoYmFzZVVybCgpLGQpKS5ufQogIGF3YWl0IGNhbGNXZWVrZW5kKCk7V0suYXQ9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxNik7cmVuZGVyQWxsKCk7d2tNc2coYOOCquODg+OCuuabtOaWsO+8iCR7V0suYXR977yJ77yaJHtufeODrOODvOOCueWIhiR7b2Rkc0hpbnQoKX1gKX0KIGNhdGNoKGUpe3drTXNnKCLmm7TmlrDjgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9ZmluYWxseXskKCJ3a09kZHMiKS5kaXNhYmxlZD1mYWxzZX0KfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOino+aekO+8iDHjg6zjg7zjgrnvvInvvJropIfli53norrnjocgw5cg6KSH5Yud44Kq44OD44K6ID0g5pyf5b6F5YCk44CB5rOi5Lmx5bqm44CB6YmE5p2/CiAqICDopIfli53norrnjofvvJrjgqrjg4PjgrrjgYLjgorihpLluILloLTmg4XloLHjgoLkvb/jgYblrabnv5LmuIjjgb/jg6Ljg4fjg6socE8p77yP44Gq44GX4oaS6YGO5Y675oiQ57i+44Gu44G/44Gu44Oi44OH44OrKHBQKQogKiAg6KSH5Yud44Kq44OD44K677yaSlJB44Gu6KSH5Yud44Kq44OD44K677yI5LiL6ZmQ44Cc5LiK6ZmQ77yJ44CC6Kqt44KB44Gq44GE44Go44GN44Gv5Y2Y5Yud44GL44KJ5o6o5a6a77yIw5fooajnpLrvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBjYWxjUmFjZShkLGMsc3RvcmUpewogY29uc3QgcmFjZT1ta1JhY2UoYyxkKTtsZXQgbj1yYWNlLnJ1bm5lcnMubGVuZ3RoO2NvbnN0IHNjcmF0Y2hlZD1bXTsKIHtjb25zdCBvMD1XSy5vZGRzW3JrZXkoZCxjKV07CiAgaWYobzApe2NvbnN0IG1pc3M9cmFjZS5ydW5uZXJzLmZpbHRlcihyPT4hKG8wLnRhbltyLm51bV0+MSkpLGhhdmU9cmFjZS5ydW5uZXJzLmxlbmd0aC1taXNzLmxlbmd0aDsKICAgLy8g5LiA6YOo44Gu6aas44Gg44GR44Kq44OD44K644GM54Sh44GE77yd5Y+W5raI44O76Zmk5aSW44Gu5Y+v6IO95oCn44GM6auY44GE44CC5aSW44GX44Gm44CB44Kq44OD44K66L6844G/44Gn6Kej5p6Q44GZ44KL77yI5aSn5Y2K44GM5qyg44GR44Gm44GE44KL44Gq44KJ5aSW44GV44Gq44GE77yJCiAgIGlmKG1pc3MubGVuZ3RoJiZoYXZlPj02JiZtaXNzLmxlbmd0aDw9TWF0aC5tYXgoMyxNYXRoLmZsb29yKHJhY2UucnVubmVycy5sZW5ndGgqLjIpKSl7c2NyYXRjaGVkLnB1c2goLi4ubWlzcy5tYXAocj0+ci5udW0pKTtyYWNlLnJ1bm5lcnM9cmFjZS5ydW5uZXJzLmZpbHRlcihyPT5vMC50YW5bci5udW1dPjEpO249cmFjZS5ydW5uZXJzLmxlbmd0aH19fQogY29uc3QgYmFzZT17ZCxjYXJkOmMscmFjZSxuLHNjcmF0Y2hlZCxrZXk6cmtleShkLGMpLHZlbnVlOmMudmVudWVOYW1lfHxjLnZlbnVlfHwiIixubzpOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MCwKICBsYWJlbDpgJHtjLnZlbnVlTmFtZXx8Yy52ZW51ZXx8IiJ9JHtjLnJhY2VOdW1iZXJ8fCIifVIgJHsoYy5yYWNlTmFtZSYmYy5yYWNlTmFtZSE9PSLlh7rppqzooagiKT9jLnJhY2VOYW1lOihjLmNsYXNzTmFtZXx8IiIpfWAsY291cnNlOmMuc3VyZmFjZSYmYy5kaXN0YW5jZT9gJHtjLnN1cmZhY2V9JHtjLmRpc3RhbmNlfW1gOiLjgrPjg7zjgrnkuI3mmI4ifTsKIGlmKC/pmpzlrrMvLnRlc3QoKGMucmFjZU5hbWV8fCIiKSsoYy5jbGFzc05hbWV8fCIiKSkpcmV0dXJuey4uLmJhc2Usc2tpcDoi6Zqc5a6z44Os44O844K544Gv5a++6LGh5aSW77yI5bmz5Zyw55So44Gu44Oi44OH44Or44Gu44Gf44KB77yJIn07CiBpZihuPDYpcmV0dXJuey4uLmJhc2Usc2tpcDoiNumgreacqua6gCJ9OwogY29uc3Qgbz1XSy5vZGRzW2Jhc2Uua2V5XSxvZGRzPW8/cmFjZS5ydW5uZXJzLm1hcChyPT5vLnRhbltyLm51bV0pOm51bGwsaGFzT2Rkcz0hIShvZGRzJiZvZGRzLmV2ZXJ5KHg9Png+MSkpOwogY29uc3Qgb2Q9aGFzT2Rkcz9vZGRzOm51bGw7CiBjb25zdCByZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk7bGV0IHVnPVVFLnVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZCxhcCk7CiBjb25zdCBVTT1nZXRVcHNldE1vZGVsKCk7CiBpZihVTSYmc3RvcmUudXApe3RyeXtjb25zdCB1PVVFLnVwc2V0RmVhdHVyZXMocmFjZSxzdG9yZSxvZCxhcCksaW5mPXt2OlN0cmluZyhjLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSxubzpOdW1iZXIoYy5yYWNlTnVtYmVyKXx8MCxzdXJmOnJhY2Uuc3VyZixkaXN0OnJhY2UuZGlzdCxsdmw6cmFjZS5sdmwsZ3JkOnJhY2UuZ3JkLE46bn0sc2ltPShoYXNPZGRzJiZzdG9yZS5wcCYmbj49Nik/KCgpPT57Y29uc3QgcG9wcz1wb3BzRnJvbU9kZHMob2QpO3JldHVybiBzaW1GZWF0KGFwLnBQLHBvcHMsbixzdG9yZS5wcCl9KSgpOm51bGwsY3U9dXBzZXRDdXN0b20oVU0sdSxzdG9yZS51cC5mZWF0KGluZikscGFjZUZlYXQocmFjZS5ydW5uZXJzLHN0b3JlKSxzaW0pO2lmKGN1KXVnPXsuLi51ZywuLi5jdSxtb2RlOnUubW9kZSxjdXN0b206dHJ1ZX19Y2F0Y2goZSl7fX0KIGNvbnN0IFBNPWdldFBsYWNlTW9kZWwoKTtsZXQgcE5ldz1udWxsOwogaWYoUE0mJmhhc09kZHMmJm4+PTgmJnN0b3JlLnBwKXt0cnl7Y29uc3QgcG9wcz1wb3BzRnJvbU9kZHMob2QpLHJrPXJhbmtGcmFjcyhhcC5wUCk7cE5ldz1ub3JtU3VtKHJhY2UucnVubmVycy5tYXAoKHIsaSk9PnByZWRMb2dpdChQTS5tb2RlbCxwbGFjZVgoYXAucFBbaV0scG9wc1tpXSxuLHN0b3JlLnBwLHJrW2ldKSkpLDMpfWNhdGNoKGUpe3BOZXc9bnVsbH19CiBsZXQgYXhpcz1oYXNPZGRzP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogaWYoaGFzT2Rkcyl7CiAgY29uc3QgcGE9cE5ld3x8YXAucE8saXJvblJhdGU9KHBOZXcmJlBNLmlyb24mJlBNLmlyb24ubj4wKT9QTS5pcm9uLnJhdGU6VUUuQVhJUy5iYW5kc1si6YmE5p2/Il0ucmF0ZTsKICBjb25zdCBpcm9uPXBhLm1hcCgocCxpKT0+KHtpLHAsdGllcjoi6YmE5p2/IixyYXRlOmlyb25SYXRlfSkpLmZpbHRlcih4PT54LnA+PUlST05fUCk7CiAgY29uc3QgaXNJcm9uPW5ldyBTZXQoaXJvbi5tYXAoeD0+eC5pKSkscmVmPShheGlzfHxbXSkuZmlsdGVyKHg9PiFpc0lyb24uaGFzKHguaSkmJngudGllciE9PSLpiYTmnb8iKS5tYXAoeD0+KHsuLi54LHA6cGFbeC5pXX0pKTsKICBheGlzPVsuLi5pcm9uLC4uLnJlZl07CiB9CiBjb25zdCBtMz1oYXNPZGRzP1VFLnRvcDNGcm9tV2luKG9kLm1hcCh4PT4xL3gpKTpudWxsOwogY29uc3QgaG9yc2VzPXJhY2UucnVubmVycy5tYXAoKHIsaSk9PnsKICBjb25zdCBwPXBOZXc/cE5ld1tpXTooaGFzT2Rkcz9hcC5wT1tpXTphcC5wUFtpXSkscGw9byYmby5wbGFjZSYmby5wbGFjZVtyLm51bV07CiAgbGV0IGxvPW51bGwsaGk9bnVsbCxzcmM9bnVsbDsKICBpZihwbCYmcGwubGVuZ3RoPT09MiYmcGxbMF0+PTEpe2xvPXBsWzBdO2hpPXBsWzFdO3NyYz0i5a6fIn0KICBlbHNlIGlmKG0zKXtsbz1NYXRoLm1heCgxLDAuOC9NYXRoLm1heChtM1tpXSwuMDIpKTtoaT1sbztzcmM9IuaOqOWumiJ9CiAgY29uc3QgdHI9c3RvcmUudHImJnIudHJhaW5lcj9zdG9yZS50ci5nZXQoci50cmFpbmVyKTpudWxsLHg9cmVzW2ldOwogIHJldHVybntpLG5vOnIubnVtLG5hbWU6ci5uYW1lLGpuYW1lOnIuam5hbWUsdHJhaW5lcjpyLnRyYWluZXIsdHJOOnRyP3RyLm46MCx0clJhdGU6dHImJnRyLm4/dHIudDMvdHIubjpudWxsLGpuOnguam4sCiAgIHAscFNyYzpwTmV3PyLlho3moKHmraMiOm51bGwscE9sZDpoYXNPZGRzP2FwLnBPW2ldOmFwLnBQW2ldLGxvLGhpLHNyYyxldjpsbz9wKmxvOm51bGwsZXZNaWQ6bG8/cCoobG8raGkpLzI6bnVsbCx3aW46aGFzT2Rkcz9vZFtpXTpudWxsLHBvcDp4LnBvcCxob2xlOnguaG9sZSxwYzp4LnBjLG1vZGU6eC5tb2RlLG46eC5uLAogICBjYXJlZXI6eC5jYXJlZXIscmVjZW50OngucmVjZW50LHRhZ3M6eC50YWdzLHJhdGluZzpVRS5yYXRpbmcoeC5wYyx4Lm1vZGUseC5uKSx4fX0pOwogcmV0dXJuey4uLmJhc2UsaGFzT2RkcyxyZXMsYXAsdWcsYXhpcyxob3JzZXMscGxhY2VSZWFsOmhvcnNlcy5maWx0ZXIoaD0+aC5zcmM9PT0i5a6fIikubGVuZ3RofTsKfQphc3luYyBmdW5jdGlvbiBjYWxjV2Vla2VuZCgpewogV0suY2FsYz17fTsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoV0suZGF0ZXNbMF0pOwogV0suc3RvcmVJbmZvPXtsYXN0OnN0b3JlLmxhc3REYXRlfHwiIixjb3VudDpzdG9yZS5jb3VudH07CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgY3M9Wy4uLldLLmNhcmRzW2RdXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGUpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlKSl8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBXSy5jYWxjW2RdPXtyYWNlczpbXX07CiAgZm9yKGxldCBpPTA7aTxjcy5sZW5ndGg7aSsrKXsKICAgdHJ5e1dLLmNhbGNbZF0ucmFjZXMucHVzaChjYWxjUmFjZShkLGNzW2ldLHN0b3JlKSl9CiAgIGNhdGNoKGUpe1dLLmNhbGNbZF0ucmFjZXMucHVzaCh7ZCxjYXJkOmNzW2ldLHNraXA6Iuino+aekOOCqOODqeODvO+8miIrZS5tZXNzYWdlLGxhYmVsOmAke2NzW2ldLnZlbnVlTmFtZXx8IiJ9JHtjc1tpXS5yYWNlTnVtYmVyfHwiIn1SYCx2ZW51ZTpjc1tpXS52ZW51ZU5hbWV8fCIiLG5vOmNzW2ldLnJhY2VOdW1iZXJ8fDAsaG9yc2VzOltdfSl9CiAgIGlmKGklND09PTMpYXdhaXQgc2xlZXAoMCk7CiAgfQogfQp9CgovKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KICog5qSc6Ki844Ky44O844OI77ya5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT44Gn44CB6Kqk5beu44KS5byV44GE44Gm44KC5Zue5Y+O546HMTAwJeS7peS4iuOBruiyt+OBhOaWueOBoOOBkeOAjOaknOiovOa4iOOBv+OAjQogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEdBVEVfS0VZPSJrZWliYV9nYXRlX3YyIjsKY29uc3QgZ2V0R2F0ZT0oKT0+e3RyeXtyZXR1cm4gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShHQVRFX0tFWSl8fCJudWxsIil9Y2F0Y2goZSl7cmV0dXJuIG51bGx9fTsKY29uc3QgU1RSQVQ9e2ZvY3VzOiLnqbTppqzvvIjil47nmoTkuK3njofph43oppbvvIkiLHRvcDE6IueptOmmrDHkvY0iLHRvcDI6IueptOmmrOS4iuS9jTLpoK0iLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uCJ9OwpmdW5jdGlvbiBzZXRHYXRlKG91dCxvdXRQKXsKIGNvbnN0IGl0ZW1zPVtdOwogZm9yKGNvbnN0IFtzcmMsb10gb2YgW1si44Kq44OD44K644GC44KKIixvdXRdLFsi44Kq44OD44K644Gq44GXIixvdXRQXV0pewogIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKFNUUkFUKSl7CiAgIGNvbnN0IHY9by5zdGF0c1trXTtpZighdiljb250aW51ZTsKICAgY29uc3Qgc2VnPSh2LkMmJnYuQy5iZXRzPj0zMDApP3YuQzp2LmFsbDtpZighc2VnfHwhc2VnLmJldHMpY29udGludWU7CiAgIGNvbnN0IGxvdz1zZWcucm9pLTEuOTYqc2VnLnNlOwogICBpdGVtcy5wdXNoKHtrZXk6ayxsYWJlbDpTVFJBVFtrXSsi77yIIitzcmMrIu+8iSIscm9pOnNlZy5yb2ksbG93LGJldHM6c2VnLmJldHMsaGl0OnNlZy5oaXRSYXRlLHNlZzpzZWc9PT12LkM/IuWtpue/kuW+jCI6IuWFqOacn+mWkyJ9KTsKICB9CiB9CiBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShHQVRFX0tFWSxKU09OLnN0cmluZ2lmeSh7YXQ6bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApLGl0ZW1zfSkpOwogcmVuZGVyR2F0ZSgpOwp9CmNvbnN0IHN0cmF0T2s9a2V5PT57Y29uc3QgZz1nZXRHYXRlKCk7cmV0dXJuICEhKGcmJmcuaXRlbXMuc29tZSh4PT54LmtleT09PWtleSYmeC5sb3c+PTEmJnguYmV0cz49MzAwKSl9Owpjb25zdCBzdHJhdENoaXA9a2V5PT5zdHJhdE9rKGtleSk/JzxzcGFuIGNsYXNzPSJjaGlwIGIiPuaknOiovOa4iOOBv++8iOWbnuWPjueOhzEwMCXotoXvvIk8L3NwYW4+JzonPHNwYW4gY2xhc3M9ImNoaXAgciI+5Zue5Y+O546HMTAwJei2heOBr+acqueiuuiqjTwvc3Bhbj4nOwpmdW5jdGlvbiByZW5kZXJHYXRlKCl7CiBjb25zdCBnPWdldEdhdGUoKSxlbD0kKCJnYXRlIik7CiBpZighZyl7ZWwuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPjxiPuWbnuWPjueOh++8muacquaknOiovDwvYj7jgIDjgIzmpJzoqLzjgI3jgr/jg5bjgpLlrp/ooYzjgZnjgovjgb7jgafjgIHjganjga7osrfjgYTmlrnjgoLjgIwxMDAl6LaF44CN44Go44Gv6KiA44GI44G+44Gb44KT44CC77yI5Lul5YmN44Gu5qSc6Ki844Gn44Gv44CB56m06aasMeS9jeOBruikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzcl44Gn44GX44Gf77yJPC9kaXY+JztyZXR1cm59CiBjb25zdCBvaz1nLml0ZW1zLmZpbHRlcih4PT54Lmxvdz49MSYmeC5iZXRzPj0zMDApLGJlc3Q9Zy5pdGVtcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucm9pLWEucm9pKVswXTsKIGlmKG9rLmxlbmd0aCllbC5pbm5lckhUTUw9YDxkaXYgY2xhc3M9ImJhbm5lciBvayI+PGI+5qSc6Ki85riI44G/77yI5Zue5Y+O546HMTAwJei2he+8ie+8mjwvYj4ke29rLm1hcCh4PT5gJHtlc2MoeC5sYWJlbCl9ICR7cGN0KHgucm9pKX3vvIjkuIvpmZAke3BjdCh4Lmxvdyl944O7JHt4LmJldHMudG9Mb2NhbGVTdHJpbmcoKX3lm57jg7ske3guc2Vnfe+8iWApLmpvaW4oIu+8jyIpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILpgY7ljrvjga7miJDnuL7jgafjga7ntZDmnpzjgafjgIHku4rlvozjgoLntprjgY/kv53oqLzjga/jgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+PC9kaXY+YDsKIGVsc2UgZWwuaW5uZXJIVE1MPWA8ZGl2IGNsYXNzPSJiYW5uZXIgbmciPjxiPuWbnuWPjueOhzEwMCXotoXjgpLnorroqo3jgafjgY3jgZ/osrfjgYTmlrnjga/jgIHjgb7jgaDjgYLjgorjgb7jgZvjgpPjgII8L2I+JHtiZXN0P2DmnIDpq5jjgafjgoIgJHtlc2MoYmVzdC5sYWJlbCl9IOOBriAke3BjdChiZXN0LnJvaSl977yI6Kqk5beu44KS5byV44GP44GoJHtwY3QoYmVzdC5sb3cpfeODuyR7YmVzdC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl95Zue44O7JHtiZXN0LnNlZ33vvInjgIJgOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPuaknOiovOaXpSAke2VzYyhnLmF0KX3jgILkuIvjga7lgJnoo5zjga/jgIzlvZPjgZ/jgorjgoTjgZnjgZXjg7vmnJ/lvoXlgKTjga7nm67lronjgI3jgajjgZfjgabkvb/jgaPjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+PC9kaXY+YDsKfQoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOihqOekugogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IElST05fUD0wLjk1OyAgIC8vIOi2hemJhOadv++8neikh+WLneWcj+WGheOBq+WFpeOCi+eiuueOh+OBjDk1JeS7peS4iuOBrummrO+8iOmgreaVsOOBruWItumZkOOBquOBl++8iQpjb25zdCBHUkFERV9PUkRFUj1bIlNTUyIsIlNTIiwiUyIsIkEiLCJCIiwiQyJdLEdSQURFX0NPTE9SPXtTU1M6IiNiNDIzMTgiLFNTOiIjZDkyZDIwIixTOiIjZjc5MDA5IixBOiIjMTY2N2Q5IixCOiIjNjY3MDg1IixDOiIjOThhMmIzIn07CmNvbnN0IGRheUxhYmVsPWQ9Pntjb25zdCB3PSLml6XmnIjngavmsLTmnKjph5HlnJ8iW25ldyBEYXRlKGQrIlQwMDowMDowMFoiKS5nZXRVVENEYXkoKV07cmV0dXJuIGAke2Quc2xpY2UoNSkucmVwbGFjZSgiLSIsIi8iKX0oJHt3fSlgfTsKY29uc3QgY2FsY1JhY2VzPWQ9PihXSy5jYWxjW2RdJiZXSy5jYWxjW2RdLnJhY2VzKXx8W107CmNvbnN0IGFsbFJhY2VzPSgpPT5XSy5kYXRlcy5mbGF0TWFwKGQ9PmNhbGNSYWNlcyhkKSk7CmNvbnN0IG5vRGF0YT1tc2c9PmA8ZGl2IGNsYXNzPSJzbWFsbCI+JHttc2d8fCLjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GZ44Go6KGo56S644GV44KM44G+44GZ44CCIn08L2Rpdj5gOwoKZnVuY3Rpb24gcmVuZGVyQWxsKCl7cmVuZGVyR2F0ZSgpO3JlbmRlckF4aXMoKTtyZW5kZXJFdigpO3JlbmRlclVwc2V0KCk7cmVuZGVySG9sZSgpO3JlbmRlclJhY2VzKCk7cmVuZGVyU3VtKCl9CgovKiAtLS0g6LaF6YmE5p2/77yI6KSH5Yud5ZyP5YaF44Gu5LqI5ris56K6546H44GM6auY44GE6Lu46aas77yJIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJBeGlzKCl7CiBjb25zdCBlbD0kKCJ2QXhpcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBjb25zdCBCPVVFLkFYSVMuYmFuZHM7CiBjb25zdCBQTXg9Z2V0UGxhY2VNb2RlbCgpLGlyb25OZXc9UE14JiZQTXguaXJvbiYmUE14Lmlyb24ubj4wOwogbGV0IGg9YDxoMj7otoXpiYTmnb/vvIjopIfli53lnI/lhoUg57SEOTUl5Lul5LiK77yJPC9oMj4ke3N0cmF0Q2hpcCgiYXhpcyIpfSR7cGxhY2VTdGF0dXNMaW5lKCl9CiAke2lyb25OZXc/YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgaDjgZHliKTlrprjgZfjgb7jgZnjgILopIfli53lnI/lhoXjga7norrnjofjgYw8Yj45NSXku6XkuIo8L2I+44Gu6aas44KS44CB6aCt5pWw44Gu5Yi26ZmQ44Gq44GX44Gn5Ye644GX44G+44GZ44CC5YaN5qCh5q2j5b6M44Gu5qSc6Ki844Gn44Gv44CB5LqI5risOTUl5Lul5LiK44Gu6aas44Gv5a6f6Zqb44GrPGI+JHtwY3QoUE14Lmlyb24ucmF0ZSwxKX08L2I+44GMM+edgOS7peWGhe+8iCR7UE14Lmlyb24ubn3poK3jgIHoqqTlt67jgpLlvJXjgYTjgabjgoIke3BjdChQTXguaXJvbi5sbywxKX3jgIEx5pel44GC44Gf44KK57SEJHtQTXguaXJvbi5wZXJEYXkudG9GaXhlZCgyKX3poK3vvInjgafjgZfjgZ/jgII8L2Rpdj5gOmA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gg44GR5Yik5a6a44GX44G+44GZ44CC6KSH5Yud5ZyP5YaF44Gu56K6546H44GMPGI+OTUl5Lul5LiKPC9iPuOBrummrOOCkuOAgemgreaVsOOBruWItumZkOOBquOBl+OBp+WHuuOBl+OBvuOBmeOAguWPguiAg++8muaomea6luODouODh+ODq+OBp+S6iOa4rCR7cGN0KEJbIumJhOadvyJdLmxvKX3ku6XkuIrjga7ljLrliIbjga/jgIHpgY7ljrvjgavlrp/pmpvjgaske3BjdChCWyLpiYTmnb8iXS5yYXRlLDEpfeOBjDPnnYDku6XlhoXvvIgke0JbIumJhOadvyJdLm596aCt44CB6Kqk5beu44KS5byV44GE44Gm44KCJHtwY3QoQlsi6YmE5p2/Il0ubG85NSwxKX3vvInjgafjgZfjgZ/jgII8L2Rpdj5gfWA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgY29uc3QgcnM9Y2FsY1JhY2VzKGQpLHBpY2tzPVtdOwogIGZvcihjb25zdCByIG9mIHJzKWlmKHIuYXhpcylmb3IoY29uc3QgeCBvZiByLmF4aXMpcGlja3MucHVzaCh7cix4LGhoOnIuaG9yc2VzW3guaV19KTsKICBwaWNrcy5zb3J0KChhLGIpPT5iLngucC1hLngucCk7CiAgY29uc3Qgbk9kZHM9cnMuZmlsdGVyKHI9PiFyLnNraXAmJnIuaGFzT2RkcykubGVuZ3RoLG5BbGw9cnMuZmlsdGVyKHI9PiFyLnNraXApLmxlbmd0aDsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl944CAPHNwYW4gY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj5blvpcgJHtuT2Rkc30vJHtuQWxsfeODrOODvOOCuTwvc3Bhbj48L2gzPmA7CiAgaWYoIW5PZGRzKXtoKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4PjgrrjgYzmnKrlj5blvpfjga7jgZ/jgoHliKTlrprjgafjgY3jgb7jgZvjgpPvvIjnmbrlo7Lplovlp4vlvozjgavjgIzjgqrjg4PjgrrjgaDjgZHmm7TmlrDjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTvvInjgII8L2Rpdj4nO2NvbnRpbnVlfQogIGNvbnN0IGlyb249cGlja3MuZmlsdGVyKHo9PnoueC50aWVyPT09IumJhOadvyIpOwogIGNvbnN0IHJlc3Q9cGlja3MuZmlsdGVyKHo9PnoueC50aWVyIT09IumJhOadvyIpLnNsaWNlKDAsMik7CiAgY29uc3QgY2FyZD0oeix0YWcpPT5gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moei5yLmxhYmVsKX08L2I+44CAPHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyh6LnIuY291cnNlKX3jg7ske3ouci5ufemgrTwvc3Bhbj48YnI+PGI+JHt6LmhoLm5vfeeVqiAke2VzYyh6LmhoLm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHJBIj4ke3RhZ308L3NwYW4+44CA5LqI5risICR7cGN0KHoueC5wKX08YnI+CiAgIDxzcGFuIGNsYXNzPSJzbWFsbCI+6aiO5omL77yaJHtlc2Moei5oaC5qbmFtZXx8IuS4jeaYjiIpfe+8j+iqv+aVmeW4q++8miR7ZXNjKHouaGgudHJhaW5lcnx8IuS4jeaYjiIpfe+8j+WNmOWLnSAke3ouaGgud2luP3ouaGgud2luKyLlgI0iOiItIn3vvI/opIfli50gJHt6LmhoLmxvP3ouaGgubG8udG9GaXhlZCgxKSsoei5oaC5oaT56LmhoLmxvPyLjgJwiK3ouaGguaGkudG9GaXhlZCgxKToiIikrIuWAjSIrKHouaGguc3JjPT09IuaOqOWumiI/IijmjqjlrpopIjoiIik6Ii0ife+8j+OBk+OBruWMuuWIhuOBrumBjuWOu+Wun+e4viAke3BjdCh6LngucmF0ZSwxKX08L3NwYW4+PC9kaXY+YDsKICBpZihpcm9uLmxlbmd0aCloKz1pcm9uLm1hcCh6PT5jYXJkKHosIui2hemJhOadvyIpKS5qb2luKCIiKTsKICBlbHNlIGgrPSc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPui2hemJhOadv++8iOS6iOa4rDk1JeS7peS4iu+8ieOBq+ipsuW9k+OBmeOCi+mmrOOBr+OBhOOBvuOBm+OCk+OAgueEoeeQhuOBq+iyt+OCj+OBquOBhOOBruOCguS4gOOBpOOBruWIpOaWreOBp+OBmeOAgjwvZGl2Pic7CiAgaWYoIWlyb24ubGVuZ3RoJiZyZXN0Lmxlbmd0aCloKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWPguiAg++8iDk1JeOBq+OBr+WxiuOBi+OBquOBhOi7uOWAmeijnO+8ie+8mjwvZGl2PmArcmVzdC5tYXAoej0+Y2FyZCh6LHoueC50aWVyKSkuam9pbigiIik7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIkgLS0tICovCmZ1bmN0aW9uIHJlbmRlckV2KCl7CiBjb25zdCBlbD0kKCJ2RXYiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZXZNaW49TnVtYmVyKCQoImV2TWluIik/JCgiZXZNaW4iKS52YWx1ZToxLjA1KSxwTWluPU51bWJlcigkKCJldlAiKT8kKCJldlAiKS52YWx1ZTouMjUpOwogY29uc3Qgcm93cz1bXTsKIGZvcihjb25zdCByIG9mIGFsbFJhY2VzKCkpaWYoIXIuc2tpcClmb3IoY29uc3QgaCBvZiByLmhvcnNlcylpZihoLmV2IT1udWxsJiZoLmV2Pj1ldk1pbiYmaC5wPj1wTWluKXJvd3MucHVzaCh7cixofSk7CiByb3dzLnNvcnQoKGEsYik9PmIuaC5ldi1hLmguZXYpOwogY29uc3Qgbk9kZHM9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5oYXNPZGRzKS5sZW5ndGg7CiBsZXQgaD1gPGgyPuacn+W+heWApO+8iOikh+WLneeiuueOhyDDlyDopIfli53jgqrjg4PjgrrvvIk8L2gyPiR7c3RyYXRDaGlwKCJ2YWx1ZSIpfQogPGRpdiBjbGFzcz0ic21hbGwiPuacn+W+heWApO+8neOBneOBrummrOOBjDPnnYDku6XlhoXjgavlhaXjgovnorrnjocgw5cg6KSH5Yud44Kq44OD44K644Gu5LiL6ZmQ44CCMS4w44KS6LaF44GI44KM44Gw44CB55CG6KuW5LiK44Gv6LK344GE57aa44GR44Gm44OX44Op44K544Gn44GZ44CC6KSH5Yud44Kq44OD44K644GvPGI+5a6fPC9iPu+8nUpSQeOBruWun+OCquODg+OCuuOAgTxiPuaOqOWumjwvYj7vvJ3ljZjli53jgYvjgonoqIjnrpfjgZfjgZ/nm67lronjgILnorrnjofjga7opovnqY3jgoLjgorpgZXjgYTjgYzlpKfjgY3jgY/lirnjgY/jgZ/jgoHjgIHjgIzmpJzoqLzjgI3jgacxMDAl6LaF44GM56K66KqN44GV44KM44KL44G+44Gn44Gv55uu5a6J44Go44GX44Gm5L2/44Gj44Gm44GP44Gg44GV44GE44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuacn+W+heWApCA8c2VsZWN0IGlkPSJldk1pbiI+PG9wdGlvbiB2YWx1ZT0iMSI+MS4wMOS7peS4ijwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjEuMDUiPjEuMDXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjEiPjEuMTDku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIxLjIiPjEuMjDku6XkuIo8L29wdGlvbj48L3NlbGVjdD4g6KSH5Yud56K6546HIDxzZWxlY3QgaWQ9ImV2UCI+PG9wdGlvbiB2YWx1ZT0iMC4xNSI+MTUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC4yNSI+MjUl5Lul5LiKPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMC40Ij40MCXku6XkuIo8L29wdGlvbj48b3B0aW9uIHZhbHVlPSIwLjYiPjYwJeS7peS4ijwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBpZighbk9kZHMpe2VsLmlubmVySFRNTD1oKyc8ZGl2IGNsYXNzPSJiYW5uZXIgd24iPuOCquODg+OCuuOBjOacquWPluW+l+OBruOBn+OCgeOAgeacn+W+heWApOOBr+ioiOeul+OBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAjOOCquODg+OCuuOBoOOBkeabtOaWsOOAje+8ieOAgjwvZGl2Pic7YmluZEV2KGV2TWluLHBNaW4pO3JldHVybn0KIGlmKCFyb3dzLmxlbmd0aCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnaHku7bjgavlkIjjgYbppqzjga/jgYTjgb7jgZvjgpPjgII8L2Rpdj4nOwogZWxzZXsKICBoKz1gPGRpdiBjbGFzcz0id3JhcCI+PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrDwvdGg+PHRoPueiuueOhzwvdGg+PHRoPuikh+WLnTwvdGg+PHRoPuacn+W+heWApDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogIGZvcihjb25zdCB7cixoOnh9IG9mIHJvd3Muc2xpY2UoMCw0MCkpaCs9YDx0cj48dGQ+JHtlc2MoZGF5TGFiZWwoci5kKSl9ICR7ZXNjKHIubGFiZWwpfTxicj48Yj4ke3gubm9955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHguam5hbWV8fCIiKX08L3NwYW4+PC90ZD48dGQ+JHtwY3QoeC5wKX08L3RkPjx0ZD4ke3gubG8udG9GaXhlZCgxKX0ke3guaGk+eC5sbz8i44CcIit4LmhpLnRvRml4ZWQoMSk6IiJ9PHNwYW4gY2xhc3M9InNtYWxsIj4ke3guc3JjfTwvc3Bhbj48L3RkPjx0ZD48Yj4ke3guZXYudG9GaXhlZCgyKX08L2I+PC90ZD48L3RyPmA7CiAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogfQogZWwuaW5uZXJIVE1MPWg7YmluZEV2KGV2TWluLHBNaW4pOwp9CmZ1bmN0aW9uIGJpbmRFdihhLGIpe2NvbnN0IGU9JCgiZXZNaW4iKSxwPSQoImV2UCIpO2lmKCFlKXJldHVybjtlLnZhbHVlPVN0cmluZyhhKTtwLnZhbHVlPVN0cmluZyhiKTtlLm9uY2hhbmdlPXAub25jaGFuZ2U9cmVuZGVyRXZ9CgovKiAtLS0g5rOi5Lmx5bqmIC0tLSAqLwpmdW5jdGlvbiByZW5kZXJVcHNldCgpewogY29uc3QgZWw9JCgidlVwc2V0Iik7aWYoIVdLLmRhdGVzLmxlbmd0aCl7ZWwuaW5uZXJIVE1MPW5vRGF0YSgpO3JldHVybn0KIGxldCBoPWA8aDI+44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+PGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDku6XlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkeOBl+OBpuOBhOOBvuOBme+8iOWFqOODrOODvOOCueW5s+WdhyDntIQyOC41Je+8ieOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+OAgeOCquODg+OCuui+vOOBv+OBruWIpOWumuOBq+OBquOCiuOBvuOBmeOAgjwvZGl2PiR7dXBzZXRTdGF0dXNMaW5lKCl9YDsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBjb25zdCBycz1jYWxjUmFjZXMoZCkuZmlsdGVyKHI9PiFyLnNraXApLGNudD17fTtHUkFERV9PUkRFUi5mb3JFYWNoKGc9PmNudFtnXT0wKTtycy5mb3JFYWNoKHI9PmNudFtyLnVnLmdyYWRlXSsrKTsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz48ZGl2IGNsYXNzPSJyb3ciPiR7R1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIil9PC9kaXY+YDsKICBjb25zdCBzb3J0ZWQ9cnMuc2xpY2UoKS5zb3J0KChhLGIpPT5HUkFERV9PUkRFUi5pbmRleE9mKGEudWcuZ3JhZGUpLUdSQURFX09SREVSLmluZGV4T2YoYi51Zy5ncmFkZSl8fGIudWcucC1hLnVnLnApOwogIGgrPWA8ZGl2IGNsYXNzPSJ3cmFwIj48dGFibGU+PHRoZWFkPjx0cj48dGg+44Os44O844K5PC90aD48dGg+562J57SaPC90aD48dGg+5LqI5risPC90aD48dGg+5a6f57i+44Gu5rOi5Lmx546HPC90aD48dGg+5Yik5a6aPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IHIgb2Ygc29ydGVkKWgrPWA8dHI+PHRkPiR7ZXNjKHIubGFiZWwpfTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+JHtyLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoP2AgPHNwYW4gY2xhc3M9ImNoaXAgbyI+6Zmk5aSW5o6o5a6aICR7ci5zY3JhdGNoZWQuam9pbigiLCIpfeeVqjwvc3Bhbj5gOiIifTwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltyLnVnLmdyYWRlXX0iPiR7ci51Zy5ncmFkZX08L3NwYW4+PC90ZD48dGQ+JHtwY3Qoci51Zy5wKX08L3RkPjx0ZD4ke3IudWcuY3VzdG9tJiZyLnVnLnJhdGUhPW51bGw/YCR7cGN0KHIudWcucmF0ZSl9PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtwY3Qoci51Zy5sbyl944CcJHtwY3Qoci51Zy5oaSl944O7JHtyLnVnLm595Lu2PC9zcGFuPmA6TWF0aC5yb3VuZChyLnVnLnJhdGUqMTAwKSsiJSJ9PC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3IudWcubW9kZT09PSJvZGRzIj8i44Kq44OD44K66L6844G/Ijoi5o6o5a6aIn08L3RkPjwvdHI+YDsKICBoKz0iPC90Ym9keT48L3RhYmxlPjwvZGl2PiI7CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOeptOmmrO+8iOWlvei1sOeOh+OBrumrmOOBhOeptOmmrOWAmeijnO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVySG9sZSgpewogY29uc3QgZWw9JCgidkhvbGUiKTtpZighV0suZGF0ZXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgZm9jdXM9JCgiaG9sZUZvY3VzIik/JCgiaG9sZUZvY3VzIikudmFsdWU9PT0iMSI6dHJ1ZTsKIGxldCBoPWA8aDI+56m06aas5YCZ6KOcPC9oMj4ke3N0cmF0Q2hpcCgiZm9jdXMiKX0KIDxkaXYgY2xhc3M9InNtYWxsIj7nqbTjgr7jg7zjg7PvvIjkurrmsJfoloTvvInjga7kuK3jgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM6auY44GE6aas44CC44CM5b2T44Gf44KK44KE44GZ44GV44CN44Gu55uu5a6J44Gn44CB5Zue5Y+O546H44Gv5Yil44Gn44GZ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxzZWxlY3QgaWQ9ImhvbGVGb2N1cyI+PG9wdGlvbiB2YWx1ZT0iMSI+4peO55qE5Lit546H6YeN6KaW77yI44Op44Oz44KvUy9B44Gu44G/77yJPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMCI+44GZ44G544Gm77yI5LiK5L2NMumgre+8iTwvb3B0aW9uPjwvc2VsZWN0PjwvZGl2PmA7CiBmb3IoY29uc3QgZCBvZiBXSy5kYXRlcyl7CiAgaCs9YDxoMz4ke2RheUxhYmVsKGQpfTwvaDM+YDsKICBmb3IoY29uc3QgciBvZiBjYWxjUmFjZXMoZCkpewogICBpZihyLnNraXApY29udGludWU7CiAgIGNvbnN0IGM9Zm9jdXM/VUUucGlja0ZvY3VzKHIucmVzLDIpOlVFLnBpY2soci5yZXMsMik7aWYoIWMubGVuZ3RoKWNvbnRpbnVlOwogICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2Moci5sYWJlbCl9PC9iPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK0ke3IuaGFzT2Rkcz8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77yJIn08L3NwYW4+YDsKICAgZm9yKGNvbnN0IHggb2YgYyl7Y29uc3QgaGg9ci5ob3JzZXNbeC5pXTsKICAgIGgrPWA8ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjZweCI+PGI+JHt4Lm5vfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke2hoLnJhdGluZ30iPiR7aGgucmF0aW5nfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj7lpb3otbDnjocgJHtoaC5wU3JjP3BjdChoaC5wLDEpKyLvvIjlho3moKHmraPlvozjga7opIfli53norrnjofvvIkiOnBjdCh4LnBjLDEpfSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9PC9zcGFuPjxicj4KICAgICA8c3BhbiBjbGFzcz0ic21hbGwiPiR7aGguY2FyZWVyJiZoaC5jYXJlZXIubj9g6YCa566XJHtoaC5jYXJlZXIubn3otbAgM+edgOWGhSR7aGguY2FyZWVyLnQzfeWbnmA6IumAmueul++8muWxpeattOOBquOBlyJ9JHtoaC5yZWNlbnQmJmhoLnJlY2VudC5sZW5ndGg/YO+8j+ebtOi/kSAke2hoLnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGA6IiJ977yP6aiO5omL77yaJHtlc2MoaGguam5hbWV8fCLkuI3mmI4iKX3vvI/oqr/mlZnluKvvvJoke2VzYyhoaC50cmFpbmVyfHwi5LiN5piOIil9JHtoaC50clJhdGUhPW51bGwmJmhoLnRyTj49MjA/YCgz552A5YaFJHtwY3QoaGgudHJSYXRlKX0pYDoiIn08L3NwYW4+PGJyPmArCiAgICAgKHgudGFnc3x8W10pLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfQogICBoKz0iPC9kaXY+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKIGNvbnN0IHM9JCgiaG9sZUZvY3VzIik7cy52YWx1ZT1mb2N1cz8iMSI6IjAiO3Mub25jaGFuZ2U9cmVuZGVySG9sZTsKfQoKLyogLS0tIOWFqOODrOODvOOCue+8iOmmrOOBlOOBqOOBrueiuueOh+ODu+OCquODg+OCuuODu+acn+W+heWApOODu+mojuaJi+ODu+iqv+aVmeW4q++8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyUmFjZXMoKXsKIGNvbnN0IGVsPSQoInZSYWNlcyIpO2lmKCFXSy5kYXRlcy5sZW5ndGgpe2VsLmlubmVySFRNTD1ub0RhdGEoKTtyZXR1cm59CiBsZXQgaD0iPGgyPuWFqOODrOODvOOCuTwvaDI+IjsKIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICBoKz1gPGgzPiR7ZGF5TGFiZWwoZCl9PC9oMz5gOwogIGZvcihjb25zdCByIG9mIGNhbGNSYWNlcyhkKSl7CiAgIGlmKHIuc2tpcCl7aCs9YDxkaXYgY2xhc3M9InNtYWxsIj4ke2VzYyhyLmxhYmVsKX3vvJoke2VzYyhyLnNraXApfTwvZGl2PmA7Y29udGludWV9CiAgIGNvbnN0IGc9ci51ZzsKICAgaCs9YDxkZXRhaWxzPjxzdW1tYXJ5PiR7ZXNjKHIubGFiZWwpfSA8c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHIuY291cnNlKX3jg7ske3Iubn3poK08L3NwYW4+IDxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUltnLmdyYWRlXX0iPiR7Zy5ncmFkZX08L3NwYW4+PC9zdW1tYXJ5PjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqzvvI/pqI7miYvvvI/oqr/mlZnluKs8L3RoPjx0aD7ljZjli508L3RoPjx0aD7opIfli508L3RoPjx0aD7norrnjoc8L3RoPjx0aD5FVjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgeCBvZiByLmhvcnNlcy5zbGljZSgpLnNvcnQoKGEsYik9PmIucC1hLnApKQogICAgaCs9YDx0cj48dGQ+PGI+JHt4Lm5vfTwvYj4gJHtlc2MoeC5uYW1lKX0ke3guaG9sZSYmeC5yYXRpbmchPT0iQyI/YCA8c3BhbiBjbGFzcz0icnQgciR7eC5yYXRpbmd9Ij4ke3gucmF0aW5nfTwvc3Bhbj5gOiIifTxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7eC5qbmFtZT9lc2MoeC5qbmFtZSk6JzxzcGFuIGNsYXNzPSJiYWQiPumojuaJi+S4jeaYjjwvc3Bhbj4nfe+8iCR7eC5qbj49NT8i6YGO5Y67Iit4LmpuKyLpqI7kuZciOiLlsaXmrbTlsJEife+8ie+8jyR7eC50cmFpbmVyP2VzYyh4LnRyYWluZXIpOic8c3BhbiBjbGFzcz0iYmFkIj7oqr/mlZnluKvkuI3mmI48L3NwYW4+J30ke3gudHJSYXRlIT1udWxsJiZ4LnRyTj49MjA/Iu+8iDPnnYDlhoUiK3BjdCh4LnRyUmF0ZSkrIu+8iSI6IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7eC53aW4/eC53aW4udG9GaXhlZCgxKToiLSJ9PC90ZD48dGQ+JHt4LmxvP3gubG8udG9GaXhlZCgxKSsoeC5oaT54LmxvPyLjgJwiK3guaGkudG9GaXhlZCgxKToiIik6Ii0ifTxzcGFuIGNsYXNzPSJzbWFsbCI+JHt4LnNyY3x8IiJ9PC9zcGFuPjwvdGQ+PHRkPiR7cGN0KHgucCl9PC90ZD48dGQ+JHt4LmV2IT1udWxsP2A8YiR7eC5ldj49MS4wNT8nIGNsYXNzPSJnb29kIic6IiJ9PiR7eC5ldi50b0ZpeGVkKDIpfTwvYj5gOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj48L2RldGFpbHM+IjsKICB9CiB9CiBlbC5pbm5lckhUTUw9aDsKfQoKLyogLS0tIOWPluOCiui+vOOBv+eKtuazge+8iOmgreaVsOODu+mojuaJi+ODu+iqv+aVmeW4q+ODu+OCs+ODvOOCueODu+OCquODg+OCuuOBruiqreOBv+WPluOCiue1kOaenO+8iSAtLS0gKi8KZnVuY3Rpb24gcmVuZGVyU3VtKCl7CiBjb25zdCBlbD0kKCJ2U3VtIik7aWYoIVdLLmRhdGVzLmxlbmd0aCYmIVdLLmRpYWcubGVuZ3RoKXtlbC5pbm5lckhUTUw9bm9EYXRhKCk7cmV0dXJufQogY29uc3QgcnM9YWxsUmFjZXMoKS5maWx0ZXIocj0+IXIuc2tpcCk7CiBjb25zdCBob3JzZXM9cnMucmVkdWNlKChzLHIpPT5zK3IubiwwKSxqbWlzcz1ycy5yZWR1Y2UoKHMscik9PnMrci5ob3JzZXMuZmlsdGVyKGg9PiFoLmpuYW1lKS5sZW5ndGgsMCksdG1pc3M9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT4haC50cmFpbmVyKS5sZW5ndGgsMCk7CiBjb25zdCBqbWF0Y2g9cnMucmVkdWNlKChzLHIpPT5zK3IuaG9yc2VzLmZpbHRlcihoPT5oLmpuPj01KS5sZW5ndGgsMCksaG1hdGNoPXJzLnJlZHVjZSgocyxyKT0+cytyLmhvcnNlcy5maWx0ZXIoaD0+aC5uPj0yKS5sZW5ndGgsMCk7CiBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+ci5jb3Vyc2U9PT0i44Kz44O844K55LiN5piOIikubGVuZ3RoLG5PZGRzPXJzLmZpbHRlcihyPT5yLmhhc09kZHMpLmxlbmd0aCxwUmVhbD1ycy5maWx0ZXIocj0+ci5wbGFjZVJlYWw+MCkubGVuZ3RoOwogbGV0IGg9YDxoMj7lj5bjgorovrzjgb/nirbms4E8L2gyPjx0YWJsZT48dGJvZHk+CiA8dHI+PHRkPuino+aekOOBl+OBn+ODrOODvOOCue+8j+WHuui1sOmmrDwvdGQ+PHRkPiR7cnMubGVuZ3RofeODrOODvOOCue+8jyR7aG9yc2VzfemgrTwvdGQ+PC90cj4KIDx0cj48dGQ+6aiO5omL44KS6Kqt44KB44Gq44GL44Gj44Gf6aasPC90ZD48dGQgY2xhc3M9IiR7am1pc3M/ImJhZCI6Imdvb2QifSI+JHtqbWlzc33poK08L3RkPjwvdHI+CiA8dHI+PHRkPuiqv+aVmeW4q+OCkuiqreOCgeOBquOBi+OBo+OBn+mmrDwvdGQ+PHRkIGNsYXNzPSIke3RtaXNzPyJiYWQiOiJnb29kIn0iPiR7dG1pc3N96aCtPC90ZD48L3RyPgogPHRyPjx0ZD7jgrPjg7zjgrnjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrk8L3RkPjx0ZCBjbGFzcz0iJHtub0NvdXJzZT8iYmFkIjoiZ29vZCJ9Ij4ke25vQ291cnNlfTwvdGQ+PC90cj4KIDx0cj48dGQ+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gf44Os44O844K5PC90ZD48dGQ+JHtuT2Rkc33vvI8ke3JzLmxlbmd0aH3vvIjopIfli53jga7lrp/jgqrjg4PjgrogJHtwUmVhbH3jg6zjg7zjgrnvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmmrO+8iTwvdGQ+PHRkPiR7aG1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDLotbDku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPumBjuWOu+ODh+ODvOOCv+OBqOOBrueFp+WQiO+8iOmojuaJi++8iTwvdGQ+PHRkPiR7am1hdGNofe+8jyR7aG9yc2Vzfemgre+8iDXpqI7kuZfku6XkuIrvvIk8L3RkPjwvdHI+CiA8dHI+PHRkPuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpTwvdGQ+PHRkPiR7ZXNjKFdLLnN0b3JlSW5mbyYmV0suc3RvcmVJbmZvLmxhc3R8fCItIil9PC90ZD48L3RyPjwvdGJvZHk+PC90YWJsZT5gOwogY29uc3Qgc2NyPXJzLmZpbHRlcihyPT5yLnNjcmF0Y2hlZCYmci5zY3JhdGNoZWQubGVuZ3RoKSxqbXA9YWxsUmFjZXMoKS5maWx0ZXIocj0+ci5za2lwJiYv6Zqc5a6zLy50ZXN0KHIuc2tpcCkpOwogaWYoc2NyLmxlbmd0aCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7jgqrjg4Pjgrrjga7nhKHjgYTppqzjgpLlj5bmtojjg7vpmaTlpJbjgajjgb/jgarjgZfjgablpJbjgZfjgZ/jg6zjg7zjgrnvvJoke3Njci5tYXAocj0+ZXNjKHIubGFiZWwpKyLvvIgiK3Iuc2NyYXRjaGVkLmpvaW4oIiwiKSsi55Wq77yJIikuam9pbigi77yPIil944CC5a6f6Zqb44Gr5Ye66LWw44GZ44KL6aas44Gq44KJ44CB44Kq44OD44K644Gu5Y+W5b6X5ryP44KM44Gn44GZ44CCPC9kaXY+YDsKIGlmKGptcC5sZW5ndGgpaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7pmpzlrrPjg6zjg7zjgrkgJHtqbXAubGVuZ3RofeS7tuOBr+OAgeW5s+WcsOeUqOOBruODouODh+ODq+OBruOBn+OCgeino+aekOOBruWvvuixoeWkluOBq+OBl+OBpuOBhOOBvuOBmeOAgjwvZGl2PmA7CiBjb25zdCBnYXA9V0suc3RvcmVJbmZvJiZXSy5zdG9yZUluZm8ubGFzdCYmV0suZGF0ZXNbMF0/TWF0aC5yb3VuZCgobmV3IERhdGUoV0suZGF0ZXNbMF0pLW5ldyBEYXRlKFdLLnN0b3JlSW5mby5sYXN0KSkvODY0ZTUpOm51bGw7CiBpZihnYXAhPW51bGwmJmdhcD4xMCloKz1gPGRpdiBjbGFzcz0iYmFubmVyIHduIj7mnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILjgIzikaEg6YGO5Y6744Os44O844K544KS5Y+W5b6X44GZ44KL44CN44KS5oq844GX44Gm44GL44KJ44CB44KC44GG5LiA5bqm5LqI5oOz44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKIGlmKHJzLmxlbmd0aCYmaG1hdGNoPGhvcnNlcyouNCloKz0nPGRpdiBjbGFzcz0iYmFubmVyIHduIj7pgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgZ/ppqzjgYzlsJHjgarjgoHjgafjgZnjgILoi6Xpp5LmiKbkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3jga7ooajoqJjjgYzlkIjjgaPjgabjgYTjgarjgYTlj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOwogY29uc3Qgb249V0sub2Rkc05vdGVzfHx7fTsKIGlmKE9iamVjdC5rZXlzKG9uKS5sZW5ndGgpe2grPWA8aDM+44Kq44OD44K65Y+W5b6X44Gu5YaF6KizPC9oMz48ZGl2IGNsYXNzPSJzdGF0dXMiPiR7V0suZGF0ZXMubWFwKGQ9PmAke2RheUxhYmVsKGQpfVxuJHsob25bZF18fFtdKS5tYXAoZXNjKS5qb2luKCJcbiIpfWApLmpvaW4oIlxuXG4iKX08L2Rpdj5gfQogaCs9YDxoMz7plovlgqzloLTjgZTjgag8L2gzPjxkaXYgY2xhc3M9IndyYXAiPjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7plovlgqzloLQ8L3RoPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD7nirbmhYs8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIFdLLmRpYWcpewogIGNvbnN0IHByb2JzPVtdO2lmKHguZXJyKXByb2JzLnB1c2goeC5lcnIpO2lmKHguYmFkKXByb2JzLnB1c2goYOWHuui1sOmmrOOCkuiqreOCgeOBquOBhOODrOODvOOCuSAke3guYmFkfWApO3Byb2JzLnB1c2goLi4uKHguaXNzdWVzfHxbXSkpOwogIGgrPWA8dHI+PHRkPiR7ZXNjKGRheUxhYmVsKHguZCkpfSAke2VzYyh4Lm5hbWUpfTwvdGQ+PHRkPiR7eC5va30vJHt4LnJhY2VzfTwvdGQ+PHRkIHN0eWxlPSJ0ZXh0LWFsaWduOmxlZnQiPiR7cHJvYnMubGVuZ3RoP2A8c3BhbiBjbGFzcz0iYmFkIHNtYWxsIj4ke3Byb2JzLm1hcChlc2MpLmpvaW4oIjxicj4iKX08L3NwYW4+YDonPHNwYW4gY2xhc3M9Imdvb2QiPuWVj+mhjOOBquOBlzwvc3Bhbj4nfSR7eC5jb2RlP2AgPGJ1dHRvbiBjbGFzcz0ibWluaSBzdWIiIGRhdGEtcmw9IiR7ZXNjKHguZCl9fCR7ZXNjKHguY29kZSl9fCR7ZXNjKHgubmFtZSl9Ij7lho3lj5blvpc8L2J1dHRvbj5gOiIifTwvdGQ+PC90cj5gOwogfQogaCs9IjwvdGJvZHk+PC90YWJsZT48L2Rpdj4iOwogZWwuaW5uZXJIVE1MPWg7CiBlbC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1ybF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz1hc3luYygpPT57CiAgY29uc3QgW2QsY29kZSxuYW1lXT1iLmRhdGFzZXQucmwuc3BsaXQoInwiKTtiLmRpc2FibGVkPXRydWU7d2tNc2coYCR7ZH0gJHtuYW1lfSDjgpLlho3lj5blvpfkuK3igKZgKTsKICB0cnl7YXdhaXQgbG9hZFZlbnVlSW50byhiYXNlVXJsKCksZCx7dmVudWVDb2RlOmNvZGUsdmVudWVOYW1lOm5hbWV9KTthd2FpdCBmZXRjaE9kZHNEYXRlKGJhc2VVcmwoKSxkKTthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpO3drTXNnKCLlho3lj5blvpfjgZfjgb7jgZfjgZ8iKX0KICBjYXRjaChlKXt3a01zZygi5YaN5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogfSk7Cn0KCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDmk43kvZwKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwpmdW5jdGlvbiBzaG93VGFiKHQpe2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIi52aWV3IikuZm9yRWFjaCh2PT52LmNsYXNzTGlzdC50b2dnbGUoIm9uIix2LmlkPT09dCkpO2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoIiN0YWJzIGJ1dHRvbiIpLmZvckVhY2goYj0+Yi5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsYi5kYXRhc2V0LnRhYj09PXQpKX0KZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI3RhYnMgYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnNob3dUYWIoYi5kYXRhc2V0LnRhYikpOwokKCJ1cFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidXBSdW4iKS5kaXNhYmxlZD10cnVlOyQoInVwT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5VcHNldEZpdCh7c3RhcnQ6JCgidXBTdGFydCIpLnZhbHVlfHwiMjAyMS0wMS0wMSJ9KTsKICAkKCJ1cE91dCIpLmlubmVySFRNTD11cHNldFJlcG9ydChyKTsKICBpZihyLm1vZGVsKXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShVUEtFWSxKU09OLnN0cmluZ2lmeShyLm1vZGVsKSk7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX0KIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJ1cE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9ImJhZCI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KIGZpbmFsbHl7JCgidXBSdW4iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidXBDbGVhciIpLm9uY2xpY2s9YXN5bmMoKT0+e2xvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFVQS0VZKTskKCJ1cE91dCIpLnRleHRDb250ZW50PSLmqJnmupbjg6Ljg4fjg6vjgavmiLvjgZfjgb7jgZfjgZ/jgIIiO2lmKFdLLmRhdGVzLmxlbmd0aCl7YXdhaXQgY2FsY1dlZWtlbmQoKTtyZW5kZXJBbGwoKX19OwokKCJwbFJ1biIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgicGxSdW4iKS5kaXNhYmxlZD10cnVlOyQoInBsT3V0IikudGV4dENvbnRlbnQ9IuaknOiovOS4reKApu+8iOaVsOWIhuOBi+OBi+OCiuOBvuOBme+8iSI7CiB0cnl7CiAgY29uc3Qgcj1hd2FpdCBydW5QbGFjZUZpdCh7c3RhcnQ6JCgicGxTdGFydCIpLnZhbHVlfHwiMjAxOS0wMS0wMSJ9KTsKICAkKCJwbE91dCIpLmlubmVySFRNTD1wbGFjZVJlcG9ydChyKTsKICBpZihyLm1vZGVsKWxvY2FsU3RvcmFnZS5zZXRJdGVtKFBMS0VZLEpTT04uc3RyaW5naWZ5KHIubW9kZWwpKTtlbHNlIGlmKCFyLmVycm9yKWxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKFBMS0VZKTsKICBpZighci5lcnJvciYmV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfQogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoInBsT3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iYmFkIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXskKCJwbFJ1biIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJwbENsZWFyIikub25jbGljaz1hc3luYygpPT57bG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oUExLRVkpOyQoInBsT3V0IikudGV4dENvbnRlbnQ9Iuaomea6luOBq+aIu+OBl+OBvuOBl+OBn+OAgiI7aWYoV0suZGF0ZXMubGVuZ3RoKXthd2FpdCBjYWxjV2Vla2VuZCgpO3JlbmRlckFsbCgpfX07CiQoIndrR28iKS5vbmNsaWNrPXdlZWtlbmRHbzsKJCgid2tPZGRzIikub25jbGljaz1vZGRzT25seTsKJCgiYmtPbmUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKEJLLmJ1c3kpcmV0dXJuOwogaWYoIUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpewogIGNvbnN0IHA9cHJvbXB0KCLjg5Djg4Pjgq/jgqLjg4Pjg5fnlKjjga7jg5Hjgrnjg5Xjg6zjg7zjgrrvvIg45paH5a2X5Lul5LiK77yJ44KS5rG644KB44Gm5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CC5b6p5YWD44Gu44Go44GN44Gr44KC5ZCM44GY44KC44Gu44GM5b+F6KaB44Gn44GZ44CCIik7CiAgaWYoIXApcmV0dXJuO0JLLnBhc3M9cC50cmltKCk7QksuaWQ9IiI7YmtTYXZlU2V0dGluZ3MoKTskKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOwogIGlmKEJLLnBhc3MubGVuZ3RoPDgpe2JrTXNnKCLjg5Hjgrnjg5Xjg6zjg7zjgrrjga845paH5a2X5Lul5LiK44Gr44GX44Gm44GP44Gg44GV44GE44CCIix0cnVlKTtyZXR1cm59CiB9CiBhd2FpdCBydW5CYWNrdXAoZmFsc2UpOwp9OwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpLGJhc2U9YmFzZVVybCgpOwogaWYoIVdLLmRhdGVzLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzikaAg5LuK6YCx5pyr44Gu44Os44O844K544KS5Y+W5b6X44GX44Gm5LqI5oOz44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBvdXQudmFsdWU9IuiouuaWreS4reKApiI7JCgiZGJnR28iKS5kaXNhYmxlZD10cnVlO2NvbnN0IGxpbmVzPVtg5Y+W5b6X5pelICR7V0suZGF0ZXMuam9pbigiLCIpfWBdOwogdHJ5ewogIGZvcihjb25zdCBkIG9mIFdLLmRhdGVzKXsKICAgY29uc3QgY29kZXM9Wy4uLm5ldyBTZXQoKFdLLmNhcmRzW2RdfHxbXSkubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgIGZvcihjb25zdCB2IG9mIGNvZGVzKXsKICAgIGNvbnN0IHJzPVdLLmNhcmRzW2RdLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgIGNvbnN0IHE9cnMubWFwKHI9PnIucXVhbGl0eSkuZmlsdGVyKEJvb2xlYW4pOwogICAgbGluZXMucHVzaChgXG7ilqAke2R9IOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3Rofe+8j+mojuaJi+asoCR7cS5yZWR1Y2UoKHMseCk9PnMrKHguaG9yc2VzLXguam9ja2V5RmlsbGVkKSwwKX3vvI/oqr/mlZnluKvmrKAke3EucmVkdWNlKChzLHgpPT5zKyh4LmhvcnNlcy14LnRyYWluZXJGaWxsZWQpLDApfWApOwogICAgY29uc3QgYmFkPXJzLmZpbmQocj0+ci5xdWFsaXR5JiYhci5xdWFsaXR5Lm9rKXx8cnNbMF0scm49KGJhZCYmYmFkLnJhY2VOdW1iZXIpfHwxO2xpbmVzLnB1c2goYO+8iOWVj+mhjOOBruOBguOCi+ODrOODvOOCuSAke3JufVIg44KS6Kq/44G544G+44GZ77yJYCk7dHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2RlYnVnLWVudHJ5P2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9JnJhY2U9JHtybn1gLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9Y2F0Y2goZSl7bGluZXMucHVzaCgi6Ki65pat44Ko44Op44O877yaIitlLm1lc3NhZ2UpfQogICB9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJkYmdDb3B5Iikub25jbGljaz1hc3luYygpPT57Y29uc3QgdD0kKCJkYmdPdXQiKS52YWx1ZTt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCk7JCgiZGJnQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoImRiZ091dCIpLnNlbGVjdCgpO2FsZXJ0KCLpgbjmip7jgZfjgb7jgZfjgZ/jgILjgrPjg5Tjg7zjgZfjgabjgY/jgaDjgZXjgYTjgIIiKX19OwokKCJmaWxlIikub25jaGFuZ2U9ZT0+e2NvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoZilpbXBvcnRGaWxlKGYpO2UudGFyZ2V0LnZhbHVlPSIifTsKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jga7lj5bjgornm7TjgZfvvIjlj5blvpfmuIjjgb/jga7ml6XjgpLjgIHmlrDjgZfjgYTpoIXnm67jgaTjgY3jgaflj5bjgornm7TjgZnvvIkKICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqLwphc3luYyBmdW5jdGlvbiBsYXBSZWZldGNoKGRlcHMpewogY29uc3QgRD1PYmplY3QuYXNzaWduKHtpZGJBbGwsaWRiUHV0LG1ldGFHZXQsbWV0YVB1dCxmZXRjaERheX0sZGVwc3x8e30pOwogY29uc3QgYmFzZT1iYXNlVXJsKCksYT0kKCJsYXBTdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCksbXNnPXQ9PnskKCJsYXBTdGF0dXMiKS5pbm5lckhUTUw9dH07CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgibGFwR28iKS5kaXNhYmxlZD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9ZmFsc2U7CiBjb25zdCBzdD17ZGF5czowLHJhY2VzOjAsbGFwczowLGNvcm5lcnM6MCxob3JzZXM6MCxmYWlsOltdLHNraXBwZWQ6MCx0MDpEYXRlLm5vdygpLG5vZGF0YTpmYWxzZSxzdG9wcGVkOmZhbHNlfTtsZXQgY29uc2VjPTAsdG90YWw9MDsKIHRyeXsKICBjb25zdCBmaWxlcz0oYXdhaXQgRC5pZGJBbGwoKSkuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCYmZi5kYXRlPj1hJiZmLmRhdGU8PXlkKS5zb3J0KCh4LHkpPT54LmRhdGU8eS5kYXRlPy0xOjEpOwogIGNvbnN0IHRvZG89W107CiAgZm9yKGNvbnN0IGYgb2YgZmlsZXMpe2lmKGYucm93cy5zb21lKHI9PkFycmF5LmlzQXJyYXkoci5sYXApJiZyLmxhcC5sZW5ndGgpfHxhd2FpdCBELm1ldGFHZXQoImxhcGRvbmU6IitmLmRhdGUpKXtzdC5za2lwcGVkKys7Y29udGludWV9dG9kby5wdXNoKGYuZGF0ZSl9CiAgdG90YWw9dG9kby5sZW5ndGg7CiAgaWYoIXRvdGFsKXttc2coYOWPluOCiuebtOOBmeaXpeOBr+OBguOCiuOBvuOBm+OCk++8iCR7YX3ku6XpmY3jga4ke2ZpbGVzLmxlbmd0aH3ml6Xjga/jgIHjgZnjgbnjgabjg6njg4Pjg5fjg7vpgJrpgY7poIbkvY3jgaTjgY3jgafjgZnvvInjgIJgKTtyZXR1cm59CiAgZm9yKGxldCBpPTA7aTx0b2RvLmxlbmd0aDtpKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBkPXRvZG9baV0sZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgIG1zZyhgJHtkfe+8iCR7aSsxfS8ke3RvdGFsfeaXpe+8ieOCkuWPluW+l+S4reKAplxu5Y+W44KK55u044GXJHtzdC5kYXlzfeaXpe+8j+ODqeODg+ODl+OCkuiqreOCgeOBn+ODrOODvOOCuSAke3N0LmxhcHN9LyR7c3QucmFjZXN977yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYCk7CiAgIHRyeXsKICAgIGNvbnN0IHI9YXdhaXQgRC5mZXRjaERheShiYXNlLGQpOwogICAgaWYoci5mYWlsZWROKXtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgY29uc3Qgcmlkcz1uZXcgU2V0KHIucm93cy5tYXAoeD0+eC5yYWNlSWQpKSxsYXBSYWNlcz1uZXcgU2V0KHIucm93cy5maWx0ZXIoeD0+QXJyYXkuaXNBcnJheSh4LmxhcCkmJngubGFwLmxlbmd0aCkubWFwKHg9PngucmFjZUlkKSk7CiAgICBjb25zdCBjb3JuZXJIb3JzZXM9ci5yb3dzLmZpbHRlcih4PT5BcnJheS5pc0FycmF5KHguY29ybmVyKSYmeC5jb3JuZXIubGVuZ3RoPj0yKS5sZW5ndGg7CiAgICBhd2FpdCBELmlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pOwogICAgaWYobGFwUmFjZXMuc2l6ZXx8Y29ybmVySG9yc2VzKWF3YWl0IEQubWV0YVB1dCgibGFwZG9uZToiK2QsdHJ1ZSk7CiAgICBzdC5kYXlzKys7c3QucmFjZXMrPXJpZHMuc2l6ZTtzdC5sYXBzKz1sYXBSYWNlcy5zaXplO3N0LmNvcm5lcnMrPWNvcm5lckhvcnNlcztzdC5ob3JzZXMrPXIucm93cy5sZW5ndGg7Y29uc2VjPTA7CiAgICBpZihzdC5kYXlzPj0yJiZzdC5sYXBzPT09MCYmc3QuY29ybmVycz09PTApe3N0Lm5vZGF0YT10cnVlO1NTVE9QPXRydWV9CiAgIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICBhd2FpdCBzbGVlcCg0MDApOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoImxhcEdvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogIGNvbnN0IHJhdGU9KHgseSk9Pnk/TWF0aC5yb3VuZCh4L3kqMTAwKSsiJSI6Ii0iOwogIGxldCBoPWAke3N0Lm5vZGF0YT8nPHNwYW4gY2xhc3M9ImJhZCI+44Op44OD44OX44KC6YCa6YGO6aCG5L2N44KC6Kqt44KB44G+44Gb44KT44Gn44GX44Gf44CC5Lit5pat44GX44G+44GX44Gf44CCPC9zcGFuPlxu44CM6Kqt44G/5Y+W44KK44Gu6Ki65pat44CN44KS5oq844GX44CB5Ye644Gf5paH56ug44KS6LK844Gj44Gm44GP44Gg44GV44GE44CCXG4nOihzdC5zdG9wcGVkPyLpgKPntprjgZfjgablpLHmlZfjgZfjgZ/jgZ/jgoHkuK3mlq3jgZfjgb7jgZfjgZ/jgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgIHjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6KFNTVE9QPyLlgZzmraLjgZfjgb7jgZfjgZ/jgIIiOiLlrozkuobjgIIiKSl9YDsKICBoKz1g5Y+W44KK55u044GXICR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlcbuODqeODg+ODl+OCkuiqreOCgeOBn+ODrOODvOOCue+8miR7c3QubGFwcy50b0xvY2FsZVN0cmluZygpfS8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl977yIJHtyYXRlKHN0LmxhcHMsc3QucmFjZXMpfe+8iVxu6YCa6YGO6aCG5L2N44KS6Kqt44KB44Gf6aas77yaJHtzdC5jb3JuZXJzLnRvTG9jYWxlU3RyaW5nKCl9LyR7c3QuaG9yc2VzLnRvTG9jYWxlU3RyaW5nKCl977yIJHtyYXRlKHN0LmNvcm5lcnMsc3QuaG9yc2VzKX3vvIlgOwogIGlmKHN0LmZhaWwubGVuZ3RoKWgrPWBcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ977yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5q6L44KK44Gg44GR57aa44GN44GL44KJ77yJPC9zcGFuPmA7CiAgbXNnKGgpO3RyeXthd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCl9Y2F0Y2goZSl7fQogfQogcmV0dXJuIHN0Owp9CiQoImxhcEdvIikub25jbGljaz0oKT0+bGFwUmVmZXRjaCgpOwokKCJsYXBEYmciKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IG91dD0kKCJsYXBPdXQiKTtvdXQudmFsdWU9IuiouuaWreS4reKApiI7CiB0cnl7CiAgY29uc3QgZmlsZXM9KGF3YWl0IGlkYkFsbCgpKS5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5zb3J0KCh4LHkpPT54LmRhdGU8eS5kYXRlPy0xOjEpOwogIGlmKCFmaWxlcy5sZW5ndGgpe291dC52YWx1ZT0i5Y+W5b6X5riI44G/44Gu5oiQ57i+44GM44GC44KK44G+44Gb44KT44CC5YWI44Gr44CM4pGhIOmBjuWOu+ODrOODvOOCueOCkuWPluW+l+OBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiI7cmV0dXJufQogIGNvbnN0IGQ9ZmlsZXNbZmlsZXMubGVuZ3RoLTFdLmRhdGUsZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlVXJsKCl9L2pyYS1kYXk/ZGF0ZT0ke2R9YCkscmFjZXM9ZGF5LnJhY2VzfHxbXTsKICBjb25zdCByPXJhY2VzLmZpbmQoeD0+eC5yYWNlTm89PT0xMSl8fHJhY2VzWzBdOwogIGlmKCFyKXtvdXQudmFsdWU9YCR7ZH0g44Gu44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTYDtyZXR1cm59CiAgY29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZVVybCgpfS9kZWJ1Zy1yZXN1bHQ/Y25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQoci5jbmFtZSl9YCk7ZGVsZXRlIHgub2s7CiAgb3V0LnZhbHVlPWDml6Xku5ggJHtkfSDplovlgqzloLQke3IudmVudWVDb2RlfSAke3IucmFjZU5vfVJcbmArSlNPTi5zdHJpbmdpZnkoeCk7CiB9Y2F0Y2goZSl7b3V0LnZhbHVlPSLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KfTsKCmlmKC9eaHR0cHM/Oi8udGVzdChsb2NhdGlvbi5wcm90b2NvbCkpJCgid3VybCIpLnZhbHVlPWxvY2F0aW9uLm9yaWdpbjtlbHNlICQoInd1cmwiKS52YWx1ZT0iaHR0cHM6Ly9rZWliYS1haS1wYXlvdXRzLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiOwpyZW5kZXJHYXRlKCk7cmVuZGVyQWxsKCk7Cihhc3luYygpPT57dHJ5e2F3YWl0IG9wZW5EQigpO2F3YWl0IHNob3dTdGF0ZSgpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKCjwvc2NyaXB0Pgo8L2JvZHk+PC9odG1sPgo=";
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
