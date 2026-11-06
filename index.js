/* =========================================================
 * 競馬AI Cloudflare Workers
 * src/index.js
 *
 * 第1回 / 10
 * 基本設定・共通関数
 * ======================================================= */

const JRA_BASE =
  "https://www.jra.go.jp";

const WORKER_VERSION =
  "2026-11-07-grade-fix-1";

const HISTORICAL_DATA_START =
  "2019-01-01";


/* 開催場コード */

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

function getDateString(
  year,
  month,
  day
) {

  return (

    String(year)
      .padStart(4, "0") +

    "-" +

    String(month)
      .padStart(2, "0") +

    "-" +

    String(day)
      .padStart(2, "0")

  );

}


/* =========================================================
 * 月の日数
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

async function fetchJRAHtml(
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

function toAbsoluteJraUrl(
  href
) {

  let value =
    String(
      href || ""
    );

  if (!value) {
    return "";
  }

  value =
    value.replace(
      /&amp;/gi,
      "&"
    );

  value =
    value.replace(
      /\\u0026/g,
      "&"
    );

  if (
    value.startsWith("//")
  ) {

    return (
      "https:" +
      value
    );

  }

  if (
    value.startsWith("/")
  ) {

    return (
      JRA_BASE +
      value
    );

  }

  return value;

}
/* =========================================================
 * 第2回 / 10
 * JRAレースリンク取得・CNAME解析
 * ======================================================= */


/* =========================================================
 * JRA内部CNAME抽出
 *
 * 開催日ページなどに埋め込まれている
 * pw01srl / pw01sde のCNAMEを取得する。
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

function extractJRALinks(html, baseUrl = JRA_BASE) {

  const links = [];
  const seen = new Set();

  if (!html) {
    return links;
  }

  /*
   * JRAのHTMLには、レース結果ページへのURLが
   * hrefだけでなく、JavaScriptや属性内に
   * CNAMEとして埋め込まれている場合がある。
   *
   * そのため accessS.html の完全一致ではなく
   * CNAMEそのものを検索する。
   */

  const cnamePattern =
    /CNAME\s*=\s*["']?([^"'&<>\s#]+)["']?/gi;

  let match;

  while (
    (match = cnamePattern.exec(html)) !== null
  ) {

    let cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/%26/gi, "&")
        .trim();

    /*
     * CNAMEの途中に余計な文字が付いている場合を除去
     */
    cname =
      cname.split('"')[0]
           .split("'")[0]
           .split(">")[0]
           .split("<")[0];

    if (
      !/^pw01sde\d+/i.test(cname)
    ) {
      continue;
    }

    const url =
      `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

    if (!seen.has(url)) {

      seen.add(url);

      links.push(url);

    }

  }

  /*
   * 念のため通常のURL形式も拾う
   */
  const urlPattern =
    /(?:https?:\/\/[^"'<>\\s]+)?\/JRADB\/accessS\.html\?CNAME=([^"'<>\\s]+)/gi;

  while (
    (match = urlPattern.exec(html)) !== null
  ) {

    const cname =
      match[1]
        .replace(/&amp;/gi, "&")
        .replace(/["'<>\s]+$/, "");

    if (
      !/^pw01sde\d+/i.test(cname)
    ) {
      continue;
    }

    const url =
      `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

    if (!seen.has(url)) {

      seen.add(url);

      links.push(url);

    }

  }

  return links;
}


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

function getJRARaceLinksFromPage(html, baseUrl, targetDate = null) {
  const rawLinks = extractJRALinks(html, baseUrl);

  const parsed = rawLinks
    .map(parseJRACname)
    .filter(Boolean);

  const filtered = targetDate
    ? parsed.filter(x => x.date === targetDate)
    : parsed;

  const seen = new Set();

  return filtered.filter(x => {
    const key = `${x.venueCode}-${x.raceNo}-${x.date}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}


async function getJRARaceLinksFromBase(
  date,
  venueCode,
  meetingDate
) {
  const year = date.slice(0, 4);

  const baseCandidates = [
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde100${venueCode}${meetingDate}`,
    `https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde100${venueCode}${year}${meetingDate.slice(4)}`
  ];

  for (const url of baseCandidates) {
    try {
      const html = await fetchJRAHtml(url);

      if (!html || html.length < 1000) continue;

      const links = getJRARaceLinksFromPage(
        html,
        url,
        date
      );

      if (links.length > 0) {
        return links;
      }
    } catch {}
  }

  return [];
}


/* =========================================================
 * コース情報
 * ======================================================= */

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

    corner:
      extractCornerInfo(
        row
      ),

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

async function fetchOneJRARace(
  date,
  venueCode,
  venueName,
  race
) {

  if (
    !race ||
    !race.url
  ) {

    throw new Error(
      "レースURLがありません。"
    );

  }


  const html =
    await fetchJRAHtml(
      race.url
    );


  const parsed =
    extractJRAResultInfo(
      html
    );


  return {

    date,

    venue:
      venueName,

    venueCode,

    raceNumber:
  race.raceNumber ??
  race.raceNo,

    raceName:
      parsed.raceName,

    surface:
      parsed.surface,

    distance:
      parsed.distance,

    weather:
      parsed.weather,

    trackCondition:
      parsed.trackCondition,

    horses:
      parsed.horses,

    rowCount:
      parsed.horses.length,

    url:
      race.url

  };

}


/* =========================================================
 * レース結果 → 学習用フラットデータ
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

function makeModelInput(
  horse
) {

  return {

    frame:
      horse.frame,

    number:
      horse.horseNumber,

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

    /*
     * popularityは意図的に入れない。
     */

  };

}


/* =========================================================
 * AI入力チェック
 * ======================================================= */

function validateModelInput(
  input
) {

  if (!input) {
    return false;
  }


  /*
   * 人気・オッズを
   * モデル入力に入れない。
   */

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "popularity"
    )
  ) {

    delete input.popularity;

  }


  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "odds"
    )
  ) {

    delete input.odds;

  }


  return true;

}


/* =========================================================
 * 勝率正規化
 * ======================================================= */

function normalizeWinProbabilities(
  values
) {

  const numbers =
    values.map(
      value =>
        Number.isFinite(
          Number(value)
        )
          ? Math.max(
              0,
              Number(value)
            )
          : 0
    );


  const total =
    numbers.reduce(
      (
        sum,
        value
      ) =>
        sum + value,

      0

    );


  if (
    total <= 0
  ) {

    const equal =
      numbers.length
        ? 1 / numbers.length
        : 0;


    return numbers.map(
      () =>
        equal
    );

  }


  return numbers.map(
    value =>
      value / total
  );

}


/* =========================================================
 * 予想スコア → 勝率
 * ======================================================= */

function scoresToWinProbabilities(
  scores
) {

  const safeScores = scores.map(score => {
    const value = Number(score);
    return Number.isFinite(value) ? value : 0;
  });

  if (safeScores.length === 0) return [];

  // スコアの単純割り算では点数差が勝率にほとんど反映されないため、softmaxで相対差を反映。
  // 温度12は暫定値。過去レースの時系列バックテストで校正するまでは確率の精度を保証しない。
  const temperature = 12;
  const maxScore = Math.max(...safeScores);
  const weights = safeScores.map(score => Math.exp((score - maxScore) / temperature));
  return normalizeWinProbabilities(weights);

}
/* =========================================================
 * 第4回 / 10
 * 過去走・モデル計算
 * ======================================================= */


/* =========================================================
 * 日付順ソート
 * ======================================================= */

function sortRowsChronologically(
  rows
) {

  return [...(
    rows || []
  )].sort(
    (a, b) => {

      const dateA =
        String(
          a.date || ""
        );

      const dateB =
        String(
          b.date || ""
        );

      if (
        dateA !== dateB
      ) {

        return dateA.localeCompare(
          dateB
        );

      }

      const raceA =
        Number(
          a.raceNumber || 0
        );

      const raceB =
        Number(
          b.raceNumber || 0
        );

      return raceA - raceB;

    }
  );

}


/* =========================================================
 * 馬名の正規化
 * ======================================================= */

function normalizeHorseName(
  name
) {

  return normalizeText(
    name
  )
    .replace(
      /\s+/g,
      ""
    );

}


/* =========================================================
 * 同一馬の過去走取得
 *
 * 現在のレースより前だけを使用する。
 * ======================================================= */

function getPastRuns(
  rows,
  horseName,
  currentDate
) {

  const target =
    normalizeHorseName(
      horseName
    );

  const date =
    String(
      currentDate || ""
    );


  if (
    !target ||
    !date
  ) {

    return [];

  }


  return sortRowsChronologically(
    (rows || [])
      .filter(
        row => {

          const rowHorse =
            normalizeHorseName(
              row.horse
            );

          return (
            rowHorse === target &&
            String(
              row.date || ""
            ) < date
          );

        }
      )
  );

}


/* =========================================================
 * 平均値
 * ======================================================= */

function average(
  values
) {

  const numbers =
    (values || [])
      .map(
        Number
      )
      .filter(
        Number.isFinite
      );


  if (
    numbers.length === 0
  ) {

    return null;

  }


  return (
    numbers.reduce(
      (
        sum,
        value
      ) =>
        sum + value,

      0
    ) /
    numbers.length
  );

}


/* =========================================================
 * 過去走特徴量
 * ======================================================= */

function buildPastRunFeatures(
  pastRuns
) {

  const runs =
    pastRuns || [];


  const recent =
    runs.slice(
      -5
    );


  const finishes =
    recent
      .map(
        row =>
          Number(
            row.finish
          )
      )
      .filter(
        Number.isFinite
      );


  const distances =
    recent
      .map(
        row =>
          Number(
            row.distance
          )
      )
      .filter(
        Number.isFinite
      );


  const last3Fs =
    recent
      .map(
        row =>
          Number(
            row.estimatedLast3F
          )
      )
      .filter(
        Number.isFinite
      );


  const wins =
    finishes.filter(
      value =>
        value === 1
    ).length;


  const top3 =
    finishes.filter(
      value =>
        value <= 3
    ).length;


  const averageFinish =
    average(
      finishes
    );


  const averageLast3F =
    average(
      last3Fs
    );


  const averageDistance =
    average(
      distances
    );


  return {

    pastRunCount:
      runs.length,

    recentRunCount:
      recent.length,

    wins,

    top3,

    winRate:
      recent.length
        ? wins / recent.length
        : 0,

    top3Rate:
      recent.length
        ? top3 / recent.length
        : 0,

    averageFinish,

    averageLast3F,

    averageDistance

  };

}


/* =========================================================
 * コース適性
 * ======================================================= */

function calculateCourseScore(
  horse,
  race,
  pastRuns
) {

  let score = 50;


  const surface =
    normalizeText(
      race.surface
    );


  const distance =
    Number(
      race.distance
    );


  const matchingSurface =
    pastRuns.filter(
      row =>
        surface &&
        normalizeText(
          row.surface
        ) === surface
    );


  if (
    matchingSurface.length > 0
  ) {

    score += Math.min(
      15,
      matchingSurface.length * 3
    );

  }


  if (
    Number.isFinite(
      distance
    )
  ) {

    const matchingDistance =
      pastRuns.filter(
        row => {

          const d =
            Number(
              row.distance
            );

          return (
            Number.isFinite(d) &&
            Math.abs(
              d - distance
            ) <= 200
          );

        }
      );


    score += Math.min(
      15,
      matchingDistance.length * 3
    );

  }


  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}


/* =========================================================
 * 安定性スコア
 * ======================================================= */

function calculateConsistencyScore(
  features
) {

  if (
    !features ||
    !features.recentRunCount
  ) {

    return 50;

  }


  let score = 50;


  if (
    features.averageFinish != null
  ) {

    if (
      features.averageFinish <= 3
    ) {

      score += 25;

    } else if (
      features.averageFinish <= 5
    ) {

      score += 15;

    } else if (
      features.averageFinish <= 8
    ) {

      score += 5;

    } else if (
      features.averageFinish >= 12
    ) {

      score -= 15;

    }

  }


  score +=
    features.top3Rate *
    25;


  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

}


/* =========================================================
 * 馬ごとのモデルスコア
 * ======================================================= */

function calculateHorseScore(
  horse,
  race,
  pastRuns
) {

  const features =
    buildPastRunFeatures(
      pastRuns
    );


  const courseScore =
    calculateCourseScore(
      horse,
      race,
      pastRuns
    );


  const consistencyScore =
    calculateConsistencyScore(
      features
    );


  // 近走成績を「平均着順」だけに寄せず、勝率・複勝圏率・直近の内容を分けて評価する。
  // オッズ・人気は一切参照しない。これは学習済み確率ではなく、検証前の暫定スコア。
  const recentRuns = (pastRuns || []).slice(-5);
  const validFinishes = recentRuns
    .map(row => Number(row.finish))
    .filter(value => Number.isFinite(value) && value > 0);
  const avgFinish = validFinishes.length
    ? validFinishes.reduce((sum, value) => sum + value, 0) / validFinishes.length
    : null;
  const recentWinRate = validFinishes.length
    ? validFinishes.filter(value => value === 1).length / validFinishes.length
    : 0;
  const recentTop3Rate = validFinishes.length
    ? validFinishes.filter(value => value <= 3).length / validFinishes.length
    : 0;

  let recentFormScore = 50;
  if (avgFinish !== null) {
    // 着順の差を滑らかに反映し、1～3着と二桁着順の差が埋もれにくいようにする。
    recentFormScore = Math.max(5, Math.min(95, 78 - (avgFinish - 1) * 6.5));
  }
  const winScore = recentWinRate * 100;
  const top3Score = recentTop3Rate * 100;
  const recentScore = validFinishes.length
    ? Math.max(5, Math.min(95, 78 - (validFinishes[validFinishes.length - 1] - 1) * 6.5))
    : 50;

  let score =
    recentFormScore * 0.30 +
    winScore * 0.15 +
    top3Score * 0.15 +
    recentScore * 0.10 +
    consistencyScore * 0.15 +
    courseScore * 0.15;

  if (features.recentRunCount === 0) {
    // 履歴なしは、履歴のある馬と同等に見せず中立より少し低めに置く。
    score = 42;
  }


  /*
   * AI入力には
   * オッズ・人気を一切使用しない。
   */


  return Math.max(
    1,
    Math.min(
      99,
      Math.round(
        score
      )
    )
  );

}


/* =========================================================
 * レース全体を予想
 * ======================================================= */

function predictRace(
  race,
  historicalRows
) {

  const horses =
    race.horses || [];


  const scored =
    horses.map(
      horse => {

        const pastRuns =
          getPastRuns(
            historicalRows,
            horse.horseName ||
              horse.horse,
            race.date
          );


        const score =
          calculateHorseScore(
            horse,
            race,
            pastRuns
          );


        return {

          ...horse,

          score,

          pastRuns:
            pastRuns.length,

          modelInput:
            makeModelInput(
              horse
            )

        };

      }
    );


  const probabilities =
    scoresToWinProbabilities(
      scored.map(
        horse =>
          horse.score
      )
    );


  return scored.map(
    (
      horse,
      index
    ) => ({

      ...horse,

      winProbability:
        probabilities[index],

      winPercent:
        Number(
          (
            probabilities[index] *
            100
          ).toFixed(2)
        )

    })
  );

}


/* =========================================================
 * 3着内率の簡易推定
 * ======================================================= */

function addPlaceProbabilities(
  horses
) {

  const sorted =
    [...(
      horses || []
    )].sort(
      (a, b) =>
        b.winProbability -
        a.winProbability
    );


  return sorted.map(
    (
      horse,
      index
    ) => {

      const win =
        Number(
          horse.winProbability ||
          0
        );


      const positionFactor =
        Math.max(
          0.35,
          1 -
          index * 0.12
        );


      const second =
        win *
        0.82 *
        positionFactor;


      const third =
        win *
        0.68 *
        positionFactor;


      const inTheMoney =
        Math.min(
          0.98,
          win +
          second +
          third
        );


      return {

        ...horse,

        secondProbability:
          second,

        thirdProbability:
          third,

        inTheMoneyProbability:
          inTheMoney,

        secondPercent:
          Number(
            (
              second *
              100
            ).toFixed(2)
          ),

        thirdPercent:
          Number(
            (
              third *
              100
            ).toFixed(2)
          ),

        inTheMoneyPercent:
          Number(
            (
              inTheMoney *
              100
            ).toFixed(2)
          )

      };

    }

  );

}
/* =========================================================
 * 第5回 / 10
 * 過去データ保存・読み込み
 * ======================================================= */


/* =========================================================
 * Cloudflare KVが使える場合の読み込み
 * ======================================================= */

/* =========================================================
 * 履歴KV取得
 *
 * 旧形式:
 *   history_rows
 *
 * 新形式:
 *   history_day_YYYY-MM-DD
 *
 * 既存データを残したまま、新方式を追加する。
 * ======================================================= */

function getHistoryKV(env) {
  return (
    env?.HISTORY ||
    env?.KEIBA_HISTORY ||
    env?.DATA ||
    null
  );
}


/* =========================================================
 * 1日分の履歴キー
 * ======================================================= */

function makeHistoryDayKey(date) {
  if (!isValidDateString(date)) {
    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );
  }

  return `history_day_${date}`;
}


/* =========================================================
 * 1日分の履歴を保存
 * ======================================================= */

async function saveHistoryDay(env, date, rows) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.put !== "function"
  ) {
    throw new Error(
      "HISTORY KV binding not configured"
    );
  }

  const safeRows =
    Array.isArray(rows)
      ? deduplicateHistoryRows(rows)
      : [];

  const key =
    makeHistoryDayKey(date);

  await kv.put(
    key,
    JSON.stringify(safeRows)
  );

  return {
    saved: true,
    key,
    rows: safeRows.length
  };
}


/* =========================================================
 * 1日分の履歴を取得
 * ======================================================= */

async function loadHistoryDay(env, date) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.get !== "function"
  ) {
    return [];
  }

  const key =
    makeHistoryDayKey(date);

  try {
    const data =
      await kv.get(
        key,
        "json"
      );

    return Array.isArray(data)
      ? data
      : [];

  } catch (error) {

    console.error(
      `history day load error: ${key}`,
      error
    );

    return [];
  }
}


/* =========================================================
 * 保存済み履歴を取得
 *
 * 既存の history_rows も読み込む。
 * 新方式の history_day_YYYY-MM-DD も読み込む。
 *
 * ※インポート処理そのものでは使用しない。
 * ======================================================= */

async function loadStoredHistory(env) {
  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.get !== "function"
  ) {
    return [];
  }

  const allRows = [];

  /* -------------------------------------------------------
   * 旧形式 history_rows
   * ----------------------------------------------------- */

  try {
    const oldData =
      await kv.get(
        "history_rows",
        "json"
      );

    if (Array.isArray(oldData)) {
      allRows.push(...oldData);
    }

  } catch (error) {

    console.error(
      "history_rows load error",
      error
    );
  }


  /* -------------------------------------------------------
   * 新形式 history_day_YYYY-MM-DD
   *
   * KV list が利用できる場合のみ取得する。
   * ----------------------------------------------------- */

  if (typeof kv.list === "function") {

    try {

      let cursor = undefined;

      do {

        const result =
          await kv.list({
            prefix: "history_day_",
            ...(cursor
              ? { cursor }
              : {})
          });

        const keys =
          Array.isArray(result?.keys)
            ? result.keys
            : [];

        for (const item of keys) {

          const key =
            item?.name;

          if (
            !key ||
            key === "history_rows"
          ) {
            continue;
          }

          try {

            const data =
              await kv.get(
                key,
                "json"
              );

            if (Array.isArray(data)) {
              allRows.push(...data);
            }

          } catch (error) {

            console.error(
              `history day load error: ${key}`,
              error
            );
          }
        }

        cursor =
          result?.list_complete
            ? undefined
            : result?.cursor;

      } while (cursor);

    } catch (error) {

      console.error(
        "history day list error",
        error
      );
    }
  }


  return deduplicateHistoryRows(
    allRows
  );
}


/* =========================================================
 * Cloudflare KVへ保存
 *
 * 旧形式との互換性のため残す。
 *
 * 新しいインポート処理では、
 * saveHistoryDay() を使用する。
 * ======================================================= */

async function saveStoredHistory(
  env,
  rows
) {

  const kv = getHistoryKV(env);

  if (
    !kv ||
    typeof kv.put !== "function"
  ) {

    return {
      saved: false,
      reason:
        "KV binding not configured"
    };
  }

  try {

    const safeRows =
      Array.isArray(rows)
        ? rows
        : [];

    await kv.put(
      "history_rows",
      JSON.stringify(
        safeRows
      )
    );

    return {

      saved: true,

      rows:
        safeRows.length

    };

  } catch (error) {

    console.error(
      "history save error",
      error
    );

    return {

      saved: false,

      reason:
        String(
          error?.message ||
          error
        )

    };
  }
}


/* =========================================================
 * 重複除去
 * ======================================================= */

function deduplicateHistoryRows(
  rows
) {

  const map =
    new Map();

  for (
    const row of
      rows || []
  ) {

    const date =
      String(
        row.date || ""
      );

    const venue =
      String(
        row.venueCode || ""
      );

    const race =
      String(
        row.raceNumber || ""
      );

    const number =
      String(
        row.number || ""
      );

    const horse =
      normalizeHorseName(
        row.horse
      );

    const key =
      [
        date,
        venue,
        race,
        number,
        horse
      ].join("|");

    if (
      !map.has(key)
    ) {

      map.set(
        key,
        row
      );
    }
  }

  return Array.from(
    map.values()
  );
}


/* =========================================================
 * 保存データの期間
 * ======================================================= */

function getHistoryPeriod(
  rows
) {

  const dates =
    (rows || [])
      .map(
        row =>
          String(
            row.date || ""
          )
      )
      .filter(
        isValidDateString
      )
      .sort();

  if (
    dates.length === 0
  ) {

    return {
      start: null,
      end: null
    };
  }

  return {

    start:
      dates[0],

    end:
      dates[
        dates.length - 1
      ]

  };
}


/* =========================================================
 * レース数
 * ======================================================= */

function countHistoryRaces(
  rows
) {

  const races =
    new Set();

  for (
    const row of
      rows || []
  ) {

    if (
      !row.date ||
      !row.venueCode ||
      !row.raceNumber
    ) {
      continue;
    }

    races.add(
      makeRaceId(
        row.date,
        row.venueCode,
        row.raceNumber
      )
    );
  }

  return races.size;
}


/* =========================================================
 * 馬数
 * ======================================================= */

function countHistoryHorses(
  rows
) {

  const horses =
    new Set();

  for (
    const row of
      rows || []
  ) {

    const name =
      normalizeHorseName(
        row.horse
      );

    if (name) {
      horses.add(name);
    }
  }

  return horses.size;
}


/* =========================================================
 * 履歴統計
 * ======================================================= */

function getHistoryStats(
  rows
) {

  const safeRows =
    Array.isArray(rows)
      ? rows
      : [];

  const period =
    getHistoryPeriod(
      safeRows
    );

  return {

    rows:
      safeRows.length,

    races:
      countHistoryRaces(
        safeRows
      ),

    horses:
      countHistoryHorses(
        safeRows
      ),

    start:
      period.start,

    end:
      period.end

  };
}


/* =========================================================
 * JRA結果URL取得
 * ======================================================= */

async function discoverJRAResultUrlsByDate(date) {

  if (!isValidDateString(date)) {

    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );
  }

  const races =
    await discoverJRARacesForDate(
      date
    );

  return races.map(race => ({

    date,

    venueCode:
      race.venueCode,

    venueName:
      race.venue ||
      race.venueName ||
      HISTORY_VENUES[
        race.venueCode
      ],

    venue:
      race.venue ||
      race.venueName ||
      HISTORY_VENUES[
        race.venueCode
      ],

    raceNo:
      race.raceNumber ||
      race.raceNo,

    raceNumber:
      race.raceNumber ||
      race.raceNo,

    url:
      race.url ||
      race.resultUrl ||
      null

  }));
}


/* =========================================================
 * 1日分の履歴をインポート
 *
 * ★重要
 *
 * ここでは過去の全履歴を読み込まない。
 *
 * JRA
 * ↓
 * 当日の全レース
 * ↓
 * 当日のrows
 * ↓
 * history_day_YYYY-MM-DD
 *
 * ======================================================= */

async function importHistoryDay(env, date) {
  if (!isValidDateString(date)) {
    throw new Error("date は YYYY-MM-DD 形式で指定してください");
  }

  const raceUrls = await discoverJRAResultUrlsByDate(date);
  const existingRows = await loadHistoryDay(env, date);
  const newRows = [];
  const failedRaces = [];

  if (raceUrls.length === 0) {
    return {
      ok: existingRows.length > 0,
      source: "JRA",
      date,
      discoveredRaces: 0,
      importedRaces: 0,
      importedRows: 0,
      totalRows: existingRows.length,
      storage: {
        saved: false,
        preserved: existingRows.length > 0,
        reason: "JRAのレースURLが見つかりませんでした。既存データは変更していません。"
      },
      failedRaces: [{ reason: "JRAのレースURLが見つかりませんでした" }]
    };
  }

  for (const race of raceUrls) {
    try {
      const result = await fetchOneJRARace(
        race.date,
        race.venueCode,
        race.venueName,
        race
      );

      if (!result || !Array.isArray(result.horses) || result.horses.length === 0) {
        failedRaces.push({
          venue: race.venueName,
          venueCode: race.venueCode,
          raceNo: race.raceNo,
          reason: "結果データが0頭"
        });
        continue;
      }

      const rows = raceResultToRows(result);
      if (Array.isArray(rows) && rows.length > 0) {
        newRows.push(...rows);
      } else {
        failedRaces.push({
          venue: race.venueName,
          venueCode: race.venueCode,
          raceNo: race.raceNo,
          reason: "結果行への変換が0件"
        });
      }
    } catch (error) {
      failedRaces.push({
        venue: race.venueName,
        venueCode: race.venueCode,
        raceNo: race.raceNo,
        reason: String(error?.message || error)
      });
      console.error(
        `履歴取得失敗: ${date} ${race.venueName} ${race.raceNo}R`,
        error
      );
    }
  }

  const freshRows = deduplicateHistoryRows(newRows);
  const dayRows = deduplicateHistoryRows([...existingRows, ...freshRows]);

  // 空の取得結果で、既存の保存済みデータを上書きしない。
  if (freshRows.length === 0) {
    return {
      ok: dayRows.length > 0,
      source: "JRA",
      date,
      discoveredRaces: raceUrls.length,
      importedRaces: 0,
      importedRows: 0,
      totalRows: dayRows.length,
      storage: {
        saved: false,
        preserved: dayRows.length > 0,
        reason: "新しい結果行を取得できなかったため、既存データを変更していません。"
      },
      failedRaces
    };
  }

  const saveResult = await saveHistoryDay(env, date, dayRows);
  const importedRaces = new Set(
    freshRows.map(row => `${row.date}-${row.venueCode}-${row.raceNumber}`)
  ).size;

  return {
    ok: saveResult.saved === true,
    source: "JRA",
    date,
    discoveredRaces: raceUrls.length,
    importedRaces,
    importedRows: freshRows.length,
    totalRows: dayRows.length,
    storage: saveResult,
    failedRaces
  };
}

/* =========================================================
 * 履歴取得の期間チェック
 * ======================================================= */

function normalizePeriod(from, to) {
  const start = from || HISTORICAL_DATA_START;
  const end = to || todayJST();

  if (!isValidDateString(start) || !isValidDateString(end)) {
    throw new Error("期間は YYYY-MM-DD 形式で指定してください");
  }

  if (start > end) {
    throw new Error("開始日は終了日以前にしてください");
  }

  return {
    from: start,
    to: end
  };
}

/* =========================================================
 * 日付列挙
 * ======================================================= */

function enumerateDates(
  from,
  to
) {

  const dates = [];


  let current =
    new Date(
      `${from}T00:00:00Z`
    );


  const end =
    new Date(
      `${to}T00:00:00Z`
    );


  while (
    current <= end
  ) {

    dates.push(
      current
        .toISOString()
        .slice(
          0,
          10
        )
    );


    current =
      new Date(
        current.getTime() +
        86400000
      );

  }


  return dates;

}


/* =========================================================
 * 月初・月末
 * ======================================================= */

function getMonthRange(
  year,
  month
) {

  const y =
    Number(year);


  const m =
    Number(month);


  const lastDay =
    getDaysInMonth(
      y,
      m
    );


  return {

    from:
      getDateString(
        y,
        m,
        1
      ),

    to:
      getDateString(
        y,
        m,
        lastDay
      )

  };

}
/* =========================================================
 * 第6回 / 10
 * 履歴取得・テスト用API
 * ======================================================= */


/* =========================================================
 * 指定期間の履歴インポート
 * ======================================================= */

async function importHistoryPeriod(env, from, to, maxDays = 31) {
  const period = normalizePeriod(from, to);

  const dates = enumerateDates(
    period.from,
    period.to
  );

  if (dates.length > maxDays) {
    throw new Error(
      `一度に取得できるのは${maxDays}日までです`
    );
  }

  const results = [];

  for (const date of dates) {
    try {
      const result = await importHistoryDay(
        env,
        date
      );

      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        date,
        error: String(error?.message || error)
      });
    }
  }

  const storedRows = await loadStoredHistory(env);
  const stats = getHistoryStats(storedRows);

  return {
    ok: true,
    from: period.from,
    to: period.to,
    days: results,
    totalRows: stats.rows,
    totalRaces: stats.races
  };
}

/* =========================================================
 * 履歴状態
 * ======================================================= */

async function handleHistoryStatus(
  env
) {

  const rows =
    await loadStoredHistory(
      env
    );


  return json({

    ok: true,

    source:
      "JRA",

    historicalDataStart:
      HISTORICAL_DATA_START,

    stats:
      getHistoryStats(
        rows
      )

  });

}


/* =========================================================
 * 履歴インポートAPI
 *
 * /import-history?date=2019-01-05
 *
 * または
 *
 * /import-history?from=2019-01-01&to=2019-01-05
 * ======================================================= */

async function handleImportHistory(request, env) {
  const url = new URL(request.url);

  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  try {
    if (date) {
      const result = await importHistoryDay(env, date);
      return json(result);
    }

    if (from || to) {
      const result = await importHistoryPeriod(
        env,
        from,
        to
      );
      return json(result);
    }

    return errorResponse(
      "date または from / to を指定してください",
      400
    );
  } catch (error) {
    return errorResponse(
      String(error?.message || error),
      500
    );
  }
}

/* =========================================================
 * JRA 2019年1月5日テスト
 * ======================================================= */

async function testJRA20190105(env) {

  const date = "2019-01-05";

  const venueCode = "06";
  const venue = "中山";
  const raceNo = 3;

  const meetingDate = "20190101";
  const dateKey = "20190105";

  const raceNoText =
    String(raceNo).padStart(2, "0");

  const cname =
    `pw01sde100${venueCode}${meetingDate}${raceNoText}${dateKey}`;

  const url =
    `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

  const html =
    await fetchJRAHtml(url);

  const info =
    extractJRAResultInfo(html);

  const rows =
    info &&
    Array.isArray(info.horses)
      ? info.horses
      : [];

  return {

    ok: true,

    source: "JRA",

    test: "testJRA20190105",

    date,

    venueCode,

    venue,

    raceNo,

    url,

    htmlLength:
      html.length,

    rowCount:
      rows.length,

    rows:
      rows.slice(0, 5)

  };

}

/* =========================================================
 * 2019年1月履歴テスト
 * ======================================================= */

async function testHistory2019January(env) {

  const date = "2019-01-05";

  const venues = [
    {
      venueCode: "06",
      venue: "中山"
    },
    {
      venueCode: "08",
      venue: "京都"
    }
  ];

  const results = [];

  let totalRaces = 0;
  let totalRows = 0;

  for (const venueInfo of venues) {

    let raceCount = 0;
    let rowCount = 0;

    for (let raceNo = 1; raceNo <= 12; raceNo++) {

      try {

        /*
         * JRAのレース結果ページを直接生成する。
         *
         * 2019-01-05
         * 中山 = 06
         * 京都 = 08
         *
         * JRA CNAME:
         * pw01sde1006201901010320190105
         *
         * 形式:
         * pw01sde100
         * + venueCode
         * + meetingDate
         * + raceNo
         * + raceDate
         */

        const meetingDate = "20190101";
        const dateKey = date.replace(/-/g, "");

        const raceNoText =
          String(raceNo).padStart(2, "0");

        const cname =
          `pw01sde100${venueInfo.venueCode}${meetingDate}${raceNoText}${dateKey}`;

        const url =
          `${JRA_BASE}/JRADB/accessS.html?CNAME=${cname}`;

        const html =
          await fetchJRAHtml(url);

        if (!html || html.length < 1000) {
          continue;
        }

        const info =
          extractJRAResultInfo(
            html,
            {
              date,
              venueCode: venueInfo.venueCode,
              venue: venueInfo.venue,
              raceNo,
              url
            }
          );

        if (
          info &&
          Array.isArray(info.horses) &&
          info.horses.length > 0
        ) {
          raceCount++;
          rowCount += info.horses.length;
        }

      } catch (error) {

        console.error(
          "testHistory2019January race error",
          {
            date,
            venueCode:
              venueInfo.venueCode,
            raceNo,
            error:
              String(
                error.message ||
                error
              )
          }
        );

      }

    }

    totalRaces += raceCount;
    totalRows += rowCount;

    results.push({

      date,

      venueCode:
        venueInfo.venueCode,

      venue:
        venueInfo.venue,

      raceCount,

      rowCount

    });

  }

  return {

    ok: true,

    source:
      "JRA",

    test:
      "testHistory2019January",

    period:
      date,

    totalRaces,

    totalRows,

    results

  };

}

/* =========================================================
 * 2019-01-05 完全取得テスト
 * ======================================================= */

async function testJRAFullDay(
  env
) {

  const date =
    "2019-01-05";


  const results = [];


  for (
    const venueCode of
      [
        "06",
        "08"
      ]
  ) {

    try {

      const seedUrl =
        `${JRA_BASE}/JRADB/accessD.html?CNAME=pw01dde1001201901${date.replace(/-/g, "")}`;


      const seedHtml = await fetchJRAHtml(seedUrl);
      const races = getJRARaceLinksFromPage(
        seedHtml,
        seedUrl,
        date
      ).filter(race =>
        race.venueCode === venueCode &&
        race.raceNo >= 1 &&
        race.raceNo <= 12
      ).map(info => ({
        info,
        link: info.url
      }));


      const unique =
        new Map();


      for (
        const item of
          races
      ) {

        unique.set(
          item.info.raceNo,
          item
        );

      }


      let rowCount = 0;


      for (
        const item of
          unique.values()
      ) {

        try {

          const race =
            await fetchOneJRARace(
              date,
              venueCode,
              HISTORY_VENUES[
                venueCode
              ],
              {
                ...item.info,
                url:
                  item.link
              }
            );


          rowCount +=
            race.rowCount;

        } catch (_) {

          /* 1レース失敗は
             全体を止めない */

        }

      }


      results.push({

        date,

        venueCode,

        venue:
          HISTORY_VENUES[
            venueCode
          ],

        raceCount:
          unique.size,

        rowCount

      });

    } catch (
      error
    ) {

      results.push({

        date,

        venueCode,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }


  return {

    ok: true,

    source:
      "JRA",

    test:
      "testJRAFullDay",

    period:
      date,

    totalRaces:
      results.reduce(
        (
          sum,
          item
        ) =>
          sum +
          Number(
            item.raceCount || 0
          ),
        0
      ),

    totalRows:
      results.reduce(
        (
          sum,
          item
        ) =>
          sum +
          Number(
            item.rowCount || 0
          ),
        0
      ),

    results

  };

}


/* =========================================================
 * 保存データから指定日のレース取得
 * ======================================================= */

async function getStoredRaces(
  env,
  date
) {

  const rows =
    await loadStoredHistory(
      env
    );


  const map =
    new Map();


  for (
    const row of
      rows
  ) {

    if (
      String(
        row.date || ""
      ) !== date
    ) {

      continue;

    }


    const key =
      makeRaceId(
        row.date,
        row.venueCode,
        row.raceNumber
      );


    if (
      !map.has(key)
    ) {

      map.set(
        key,
        {

          raceId:
            key,

          date:
            row.date,

          venue:
            row.place,

          venueCode:
            row.venueCode,

          raceNumber:
            row.raceNumber,

          raceName:
            row.raceName,

          surface:
            row.surface,

          distance:
            row.distance,

          weather:
            row.weather,

          going:
            row.going,

          horses: []

        }
      );

    }


    map.get(
      key
    ).horses.push({

      finishPosition:
        row.finish,

      frame:
        row.frame,

      horseNumber:
        row.number,

      horseName:
        row.horse,

      age:
        row.age,

      sex:
        row.sex,

      weight:
        row.weight,

      jockey:
        row.jockey,

      trainer:
        row.trainer,

      horseWeight:
        row.horseWeight,

      horseWeightChange:
        row.horseWeightChange,

      time:
        row.time,

      estimatedLast3F:
        row.estimatedLast3F,

      corner:
        row.corner,

      popularity:
        row.popularity

    });

  }


  return Array.from(
    map.values()
  );

}
/* =========================================================
 * 第7回 / 10
 * 次回レース・レースカードAPI
 * ======================================================= */


/* =========================================================
 * 今日以降のJRA開催候補日
 * ======================================================= */

function getUpcomingDates(
  startDate,
  days = 14
) {

  const result = [];


  if (
    !isValidDateString(
      startDate
    )
  ) {

    return result;

  }


  const start =
    new Date(
      `${startDate}T00:00:00Z`
    );


  for (
    let i = 0;
    i < days;
    i++
  ) {

    const date =
      new Date(
        start.getTime() +
        i * 86400000
      );


    result.push(
      date
        .toISOString()
        .slice(
          0,
          10
        )
    );

  }


  return result;

}


/* =========================================================
 * 指定日のJRA開催情報取得
 * ======================================================= */

/* =========================================================
 * JRA POST取得
 *
 * JRAの過去レース検索では
 * CNAMEをPOSTで送るページがあるため使用する。
 * ======================================================= */

/* =========================================================
 * JRA POST取得
 * ======================================================= */

async function fetchJRAHtmlPost(
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

async function discoverJRARacesForDate(
  date
) {

  if (
    !isValidDateString(
      date
    )
  ) {

    throw new Error(
      "date は YYYY-MM-DD 形式で指定してください"
    );

  }


  const [
    year,
    month
  ] =
    date
      .split("-")
      .map(Number);


  /*
   * -------------------------------------------------------
   * 1.
   * 指定年月の開催日ページを取得
   * -----------------------------------------------------
   */

  const meetingCnames =
    await discoverJRAMeetingPages(
      year,
      month
    );


  const allFound =
    new Map();


  /*
   * -------------------------------------------------------
   * 2.
   * 各開催日ページを調査
   *
   * 通常は月内の開催日ページが
   * 数十件程度。
   * -----------------------------------------------------
   */

  for (
    const meetingCname
      of meetingCnames
  ) {

    try {

      const html =
        await fetchJRAHtmlPost(
          "/JRADB/accessS.html",
          meetingCname
        );


      if (
        !html ||
        html.length < 500
      ) {
        continue;
      }


      /*
       * この開催日ページから
       * レース結果CNAMEを取得
       */

      const raceCnames =
        extractJRAInternalCnames(
          html,
          "pw01sde"
        );


      for (
        const cname
          of raceCnames
      ) {

        try {

          const url =
            `${JRA_BASE}/JRADB/accessS.html?CNAME=` +
            encodeURIComponent(
              cname
            );


          const race =
            parseJRACname(
              url
            );


          if (!race) {
            continue;
          }


          /*
           * 指定日以外は除外
           */

          if (
            race.date !== date
          ) {
            continue;
          }


          /*
           * 開催場コード確認
           */

          if (
            !HISTORY_VENUES[
              race.venueCode
            ]
          ) {
            continue;
          }


          /*
           * レース番号確認
           */

          if (
            race.raceNo < 1 ||
            race.raceNo > 12
          ) {
            continue;
          }


          const key =
            makeRaceId(
              date,
              race.venueCode,
              race.raceNo
            );


          if (
            !allFound.has(key)
          ) {

            allFound.set(
              key,
              {

                ...race,

                venue:
                  HISTORY_VENUES[
                    race.venueCode
                  ],

                venueName:
                  HISTORY_VENUES[
                    race.venueCode
                  ],

                cname

              }
            );

          }

        } catch (error) {

          console.error(
            "race cname parse error",
            {
              cname,
              error:
                String(
                  error?.message ||
                  error
                )
            }
          );

        }

      }

    } catch (error) {

      console.error(
        "meeting discovery error",
        {
          meetingCname,

          error:
            String(
              error?.message ||
              error
            )
        }
      );

    }

  }


  /*
   * -------------------------------------------------------
   * 3.
   * レース番号順に整理
   * -----------------------------------------------------
   */

  return Array.from(
    allFound.values()
  )
    .filter(
      race =>
        race.date === date &&
        HISTORY_VENUES[
          race.venueCode
        ]
    )
    .sort(
      (a, b) => {

        const venueCompare =
          String(
            a.venueCode
          ).localeCompare(
            String(
              b.venueCode
            )
          );


        if (
          venueCompare !== 0
        ) {
          return venueCompare;
        }


        return (
          Number(
            a.raceNo
          ) -
          Number(
            b.raceNo
          )
        );

      }
    );

}
/* =========================================================
 * 次回開催日の探索
 * ======================================================= */


/* =========================================================
 * JRA出馬表リンク発見・解析（過去結果処理とは独立）
 *
 * 出馬表CNAMEの末尾コードはJRA側が発行する値のため、
 * レース番号から推測せず、公式ページ上のリンクから取得する。
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

function parseJRAEntryHorseRow(row) {
  const horseName = extractEntryHorseName(row);
  if (!horseName) return null;

  const cells = getEntryCells(row);
  let numberText = getCellTextAny(row, ["num", "umaban", "horse_num", "horseNumber", "HorseNum", "Umaban"]);
  if (!numberText) {
    // 枠番セルには画像のalt属性しかないことがあるため、先頭4セルの数値を調べる。
    for (const cell of cells.slice(0, 4)) {
      const value = String(cell.text || "").replace(/[^0-9]/g, "");
      const n = Number(value);
      if (value && Number.isInteger(n) && n >= 1 && n <= 18) {
        numberText = String(n);
        break;
      }
    }
  }
  const horseNumber = toNumberOrNull(numberText);
  if (horseNumber == null || horseNumber < 1 || horseNumber > 18) return null;

  const weightText = getCellTextAny(row, ["weight", "futan", "burden_weight"]);
  let jockey = getCellTextAny(row, ["jockey", "kisyu", "rider"]);
  if (!jockey) {
    const jockeyCell = cells.find(cell => /(?:jockey|kisyu|rider|Kisyu)/i.test(cell.attrs));
    jockey = jockeyCell?.text || "";
  }
  const jockeyRaw = jockey;
  jockey = cleanJockeyText(jockey.replace(/^[☆★▲△\s]+/, "").trim());
  const ageText = getCellTextAny(row, ["age", "sex_age", "sexage"]);
  const ageMatch = ageText.match(/([牡牝セ騙])\s*(\d+)/);
  const sex = ageMatch ? ageMatch[1] : "";
  const age = ageMatch ? Number(ageMatch[2]) : null;
  const trainer = getCellTextAny(row, ["trainer", "chokyo"]);

  return {
    finishPosition: null,
    frame: extractFrameNumber(row),
    horseNumber,
    horseName,
    sex,
    age,
    weight: toNumberOrNull(weightText.replace(/[^\d.]/g, "")),
    jockey,
    jockeyRaw,
    trainer,
    time: "",
    estimatedLast3F: null,
    horseWeight: null,
    horseWeightChange: null,
    corner: [],
    popularity: null
  };
}

/* 出馬表ページに載っている、そのレースの単勝・複勝オッズ画面（pw151ou…）へのリンクを拾う */
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

  const tbodies = String(html || "").match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
  for (const tbody of tbodies) {
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  // Some JRA page variants place the entries in a table without tbody.
  if (result.horses.length === 0) {
    const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const horse = parseJRAEntryHorseRow(row);
      if (horse && horse.horseNumber != null) result.horses.push(horse);
    }
  }

  const seen = new Set();
  result.horses = result.horses.filter(horse => {
    if (seen.has(horse.horseNumber)) return false;
    seen.add(horse.horseNumber);
    return true;
  }).sort((a, b) => a.horseNumber - b.horseNumber);

  return result;
}

async function findNextJRARaces() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const startDate = jst.toISOString().slice(0, 10);

  const allRaces = await discoverJRAEntryRacesForDate();
  const upcoming = allRaces.filter(race => race.date >= startDate);
  if (upcoming.length === 0) return { date: null, races: [] };

  const nextDate = upcoming
    .map(race => race.date)
    .sort((a, b) => a.localeCompare(b))[0];

  return {
    date: nextDate,
    races: upcoming.filter(race => race.date === nextDate)
  };
}


async function handleNextRace() {

  try {

    const result =
      await findNextJRARaces();


    return json({

      ok: true,

      source:
        "JRA",

      date:
        result.date,

      raceCount:
        result.races.length,

      races:
        result.races.map(
          race => ({

            date:
              race.date,

            venue:
              race.venue,

            venueCode:
              race.venueCode,

            raceNumber:
              race.raceNumber ?? race.raceNo,

            url:
              race.url

          })
        )

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * 指定日のレースカード取得
 * ======================================================= */

/* 指定日の開催場一覧だけを軽く調べる（出馬表本体は取らない） */
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

async function handleRaceCards(request) {
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


async function handleVenues(
  request
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  if (
    date &&
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "dateが正しくありません。",
      400
    );

  }


  try {

    const races =
      date
        ? await discoverJRARacesForDate(
            date
          )
        : [];


    const venues =
      new Map();


    for (
      const race of
        races
    ) {

      if (
        !venues.has(
          race.venueCode
        )
      ) {

        venues.set(
          race.venueCode,
          {

            venueCode:
              race.venueCode,

            venue:
              race.venue,

            raceCount:
              0

          }
        );

      }


      venues.get(
        race.venueCode
      ).raceCount++;

    }


    return json({

      ok: true,

      source:
        "JRA",

      date,

      venues:
        Array.from(
          venues.values()
        )

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}
/* =========================================================
 * 第8回 / 10
 * レース予想API・確率計算
 * ======================================================= */


/* =========================================================
 * レース結果を予想用形式へ変換
 * ======================================================= */

function convertRaceForPrediction(
  race
) {

  return {

    date:
      race.date,

    venue:
      race.venue,

    venueCode:
      race.venueCode,

    raceNumber:
      race.raceNumber,

    raceName:
      race.raceName,

    surface:
      race.surface,

    distance:
      race.distance,

    weather:
      race.weather,

    trackCondition:
      race.trackCondition ||
      race.going,

    horses:
      race.horses || []

  };

}


/* =========================================================
 * 逃げ馬候補
 * ======================================================= */

function estimateFrontRunner(
  horses
) {

  if (
    !Array.isArray(
      horses
    ) ||
    horses.length === 0
  ) {

    return null;

  }


  /*
   * 過去のコーナー位置を利用。
   *
   * 先頭に近い数字が多い馬を
   * 逃げ候補として評価する。
   */

  const candidates =
    horses.map(
      horse => {

        const corners =
          Array.isArray(
            horse.corner
          )
            ? horse.corner
            : [];


        let frontScore = 0;


        for (
          const corner of
            corners
        ) {

          const numbers =
            String(
              corner
            )
              .match(
                /\d+/g
              ) || [];


          if (
            numbers.length === 0
          ) {

            continue;

          }


          const first =
            Number(
              numbers[0]
            );


          if (
            first === 1
          ) {

            frontScore += 5;

          } else if (
            first === 2
          ) {

            frontScore += 4;

          } else if (
            first <= 4
          ) {

            frontScore += 3;

          } else if (
            first <= 6
          ) {

            frontScore += 1;

          }

        }


        return {

          horse,

          frontScore

        };

      }
    );


  candidates.sort(
    (a, b) =>
      b.frontScore -
      a.frontScore
  );


  return candidates[0] || null;

}


/* =========================================================
 * 想定ペース
 * ======================================================= */

function estimatePace(
  horses
) {

  if (
    !Array.isArray(
      horses
    ) ||
    horses.length === 0
  ) {

    return "不明";

  }


  const scores =
    horses.map(
      horse => {

        const corners =
          Array.isArray(
            horse.corner
          )
            ? horse.corner
            : [];


        let score = 0;


        for (
          const corner of
            corners
        ) {

          const numbers =
            String(
              corner
            )
              .match(
                /\d+/g
              ) || [];


          if (
            numbers.length === 0
          ) {

            continue;

          }


          const first =
            Number(
              numbers[0]
            );


          if (
            first === 1
          ) {

            score += 5;

          } else if (
            first <= 3
          ) {

            score += 3;

          } else if (
            first <= 5
          ) {

            score += 1;

          }

        }


        return score;

      }
    );


  const frontCount =
    scores.filter(
      score =>
        score >= 5
    ).length;


  if (
    frontCount >= 4
  ) {

    return "ハイ";

  }


  if (
    frontCount <= 1
  ) {

    return "スロー";

  }


  return "ミドル";

}


/* =========================================================
 * 予想結果整形
 * ======================================================= */

function buildPredictionResult(
  race,
  historicalRows
) {

  const prediction =
    predictRace(
      race,
      historicalRows
    );


  const withPlaces =
    addPlaceProbabilities(
      prediction
    );


  const sorted =
    [...withPlaces].sort(
      (a, b) =>
        b.winProbability -
        a.winProbability
    );


  const front =
    estimateFrontRunner(
      race.horses || []
    );


  return {

    date:
      race.date,

    venue:
      race.venue,

    venueCode:
      race.venueCode,

    raceNumber:
      race.raceNumber,

    raceName:
      race.raceName,

    surface:
      race.surface,

    distance:
      race.distance,

    weather:
      race.weather,

    trackCondition:
      race.trackCondition,

    expectedPace:
      estimatePace(
        race.horses || []
      ),

    frontRunner:
      front
        ? {

            horseNumber:
              front.horse.horseNumber,

            horseName:
              front.horse.horseName,

            score:
              front.frontScore

          }
        : null,

    horses:
      sorted.map(
        horse => ({

          horseNumber:
            horse.horseNumber,

          horseName:
            horse.horseName,

          frame:
            horse.frame,

          score:
            horse.score,

          winPercent:
            horse.winPercent,

          secondPercent:
            horse.secondPercent,

          thirdPercent:
            horse.thirdPercent,

          inTheMoneyPercent:
            horse.inTheMoneyPercent,

          pastRuns:
            horse.pastRuns

        })
      )

  };

}


/* =========================================================
 * 単一レース予想
 *
 * /predict?date=...&venue=06&race=1
 * ======================================================= */

async function handlePredict(
  request,
  env
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  const venueCode =
    url.searchParams.get(
      "venue"
    );


  const raceNumber =
    Number(
      url.searchParams.get(
        "race"
      )
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "date=YYYY-MM-DD を指定してください。",
      400
    );

  }


  if (
    !venueCode
  ) {

    return errorResponse(
      "venueを指定してください。",
      400
    );

  }


  if (
    !Number.isFinite(
      raceNumber
    ) ||
    raceNumber < 1 ||
    raceNumber > 12
  ) {

    return errorResponse(
      "raceは1〜12で指定してください。",
      400
    );

  }


  try {

    const races =
      await discoverJRARacesForDate(
        date
      );


    const target =
      races.find(
        race =>
          race.venueCode ===
            venueCode &&
          race.raceNumber ===
            raceNumber
      );


    if (!target) {

      return errorResponse(
        "指定されたレースが見つかりません。",
        404
      );

    }


    const html =
      await fetchJRAHtml(
        target.url
      );


    const parsed =
      extractJRAResultInfo(
        html
      );


    const race =
      convertRaceForPrediction({

        date,

        venue:
          target.venue,

        venueCode,

        raceNumber,

        raceName:
          parsed.raceName,

        surface:
          parsed.surface,

        distance:
          parsed.distance,

        weather:
          parsed.weather,

        trackCondition:
          parsed.trackCondition,

        horses:
          parsed.horses

      });


    const historicalRows =
      await loadStoredHistory(
        env
      );


    const result =
      buildPredictionResult(
        race,
        historicalRows
      );


    return json({

      ok: true,

      source:
        "JRA",

      model: {

        oddsUsed:
          false,

        popularityUsed:
          false,

        historicalDataStart:
          HISTORICAL_DATA_START

      },

      prediction:
        result

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * 指定日の全レース予想
 *
 * /predict-day?date=YYYY-MM-DD
 * ======================================================= */

async function handlePredictDay(
  request,
  env
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "date=YYYY-MM-DD を指定してください。",
      400
    );

  }


  try {

    const races =
      await discoverJRARacesForDate(
        date
      );


    const historicalRows =
      await loadStoredHistory(
        env
      );


    const predictions = [];


    for (
      const target of
        races
    ) {

      try {

        const html =
          await fetchJRAHtml(
            target.url
          );


        const parsed =
          extractJRAResultInfo(
            html
          );


        const race =
          convertRaceForPrediction({

            date,

            venue:
              target.venue,

            venueCode:
              target.venueCode,

            raceNumber:
              target.raceNumber,

            raceName:
              parsed.raceName,

            surface:
              parsed.surface,

            distance:
              parsed.distance,

            weather:
              parsed.weather,

            trackCondition:
              parsed.trackCondition,

            horses:
              parsed.horses

          });


        predictions.push(
          buildPredictionResult(
            race,
            historicalRows
          )
        );

      } catch (
        error
      ) {

        predictions.push({

          date,

          venue:
            target.venue,

          venueCode:
            target.venueCode,

          raceNumber:
            target.raceNumber,

          error:
            String(
              error.message ||
              error
            )

        });

      }

    }


    return json({

      ok: true,

      source:
        "JRA",

      date,

      raceCount:
        predictions.length,

      predictions

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}
/* =========================================================
 * 第9回 / 10
 * 結果API・デバッグAPI・ヘルスチェック
 * ======================================================= */


/* =========================================================
 * 指定日の結果取得
 *
 * /race-results?date=YYYY-MM-DD
 * ======================================================= */


function historyRowsToCSV(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return "";

  // Frontend-compatible names: the HTML recognizes race_id/raceId, horse/horse_name,
  // horse_no, and finish. The stored Worker rows use raceId, number, horse, and finish.
  const columns = [
    "date", "race_id", "venue", "venueCode", "raceNumber", "horse_no",
    "frame", "horse", "sex", "age", "jockey", "finish", "time",
    "popularity", "surface", "distance", "going", "trainer"
  ];

  const valueFor = (row, key) => {
    switch (key) {
      case "race_id": return row.raceId ?? row.race_id ?? "";
      case "venue": return row.place ?? row.venue ?? "";
      case "horse_no": return row.number ?? row.horse_no ?? row.horseNumber ?? "";
      case "horse": return row.horse ?? row.horseName ?? row.horse_name ?? "";
      case "finish": return row.finish ?? row.finishPosition ?? "";
      case "surface": return row.surface ?? row.race_type ?? "";
      case "going": return row.going ?? row.trackCondition ?? row.ground_state ?? "";
      default: return row[key] ?? "";
    }
  };

  const escapeCSV = value => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.join(","),
    ...list.map(row => columns.map(key => escapeCSV(valueFor(row, key))).join(","))
  ].join("\r\n");
}


const HISTORY_CSV_DIRS = {
  "01": "01_sapporo", "02": "02_hakodate", "03": "03_fukushima",
  "04": "04_nigata", "05": "05_tokyo", "06": "06_nakayama",
  "07": "07_chukyo", "08": "08_kyoto", "09": "09_hanshin", "10": "10_kokura"
};

async function fetchHistoryCSVWithRetry(url, attempts = 3) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "keiba-ai-cloudflare", "Accept": "text/plain,application/vnd.github+json" },
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      lastStatus = response.status;
      if (response.ok) return { response, status: response.status };
      if (response.status === 404) return { response: null, status: 404 };
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    } catch (_) {
      lastStatus = 503;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return { response: null, status: lastStatus || 503 };
}

async function fetchExternalHistoryCSV(year, venueCode) {
  const dir = HISTORY_CSV_DIRS[venueCode];
  const csvUrl = `https://raw.githubusercontent.com/keibamar/keiba_ai_ver2.0/master/data/RaceResults/${dir}/${year}_race_results.csv`;
  const direct = await fetchHistoryCSVWithRetry(csvUrl);
  if (direct.response) {
    const csv = await direct.response.text();
    if (csv.trim().length > 20) return new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
    return errorResponse("GitHubの年次CSVが空でした。", 502);
  }

  // 京都は2021・2022年に開催がないため、空データを正常に返す。
  if (venueCode === "08" && (year === 2021 || year === 2022) && direct.status === 404) {
    return new Response("着順,枠番,馬番,馬名,性齢,斤量,騎手,タイム,着差,単勝,人気,馬体重,調教師,course_len,weather,race_type,ground_state,date,class,horse_id,jockey_id,通過,上り\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  }

  // 年次CSVがない場合は、GitHub上のレース別CSVを少ない並列数で再構成する。
  if (direct.status === 404) {
    const apiUrl = `https://api.github.com/repos/keibamar/keiba_ai_ver2.0/contents/data/RaceResults/${dir}/${year}`;
    const listing = await fetchHistoryCSVWithRetry(apiUrl, 2);
    if (listing.response) {
      let files;
      try { files = (await listing.response.json()).filter(item => item.type === "file" && /\.csv$/i.test(item.name)); }
      catch (_) { files = []; }
      const chunks = [];
      for (let i = 0; i < files.length; i += 4) {
        const batch = files.slice(i, i + 4);
        const got = await Promise.all(batch.map(async item => {
          const result = await fetchHistoryCSVWithRetry(item.download_url, 2);
          if (!result.response) return "";
          try { return await result.response.text(); } catch (_) { return ""; }
        }));
        chunks.push(...got.filter(csv => csv.trim().length > 20));
      }
      if (chunks.length) {
        let header = ""; const rows = [];
        for (const csv of chunks) {
          const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
          if (!header && lines[0]) header = lines[0];
          rows.push(...lines.slice(1).filter(Boolean));
        }
        if (header && rows.length) return new Response(`${header}\n${rows.join("\n")}\n`, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
      }
    }
  }
  return errorResponse(`過去データを取得できませんでした（GitHub HTTP ${direct.status}）。時間をおいて再試行してください。`, direct.status === 404 ? 404 : 502);
}

async function handleRaceResults(
  request,
  env
) {
  const url = new URL(request.url);

  const date =
    url.searchParams.get("date");

  const yearParam =
    url.searchParams.get("year");

  const placeParam =
    url.searchParams.get("place");


  /*
   * ==================================================
   * date=YYYY-MM-DD
   *
   * 指定日のレースを取得
   * ==================================================
   */

  if (date) {

    if (!isValidDateString(date)) {

      return errorResponse(
        "date=YYYY-MM-DD を指定してください。",
        400
      );

    }

    try {

      const storedRaces =
        await getStoredRaces(
          env,
          date
        );

      if (
        storedRaces.length > 0
      ) {

        return json({
          ok: true,
          source: "JRA",
          date,
          sourceType: "stored",
          raceCount:
            storedRaces.length,
          races:
            storedRaces
        });

      }


      /*
       * 今回実際に成功した
       * 自動発見処理を使用
       */

      const races =
        await discoverJRARacesForDate(
          date
        );

      const results = [];


      for (
        const race of races
      ) {

        try {

          const result =
            await fetchOneJRARace(
              date,
              race.venueCode,
              race.venueName ||
                HISTORY_VENUES[
                  race.venueCode
                ] ||
                race.venueCode,
              race
            );

          if (result) {

            results.push(
              result
            );

          }

        } catch (error) {

          console.error(
            "レース取得失敗",
            {
              date,
              venueCode:
                race.venueCode,
              raceNo:
                race.raceNo,
              error:
                String(
                  error.message ||
                  error
                )
            }
          );

        }

      }


      return json({
        ok: true,
        source: "JRA",
        date,
        sourceType: "jra",
        raceCount:
          results.length,
        races:
          results
      });


    } catch (error) {

      return errorResponse(
        error.message ||
          String(error),
        500
      );

    }

  }


  /*
   * ==================================================
   * year=YYYY&place=XX
   *
   * 保存済み履歴をCSVとして返す
   * ==================================================
   */

  if (
    yearParam ||
    placeParam
  ) {

    const year =
      Number(yearParam);


    if (
      !Number.isInteger(year) ||
      year < 2019 ||
      year >
        new Date().getFullYear()
    ) {

      return errorResponse(
        "year は2019年以降の西暦4桁で指定してください。",
        400
      );

    }


    let venueCode =
      null;


    if (placeParam) {

      const normalizedPlace =
        String(
          placeParam
        ).trim();


      if (
        HISTORY_VENUES[
          normalizedPlace
        ]
      ) {

        venueCode =
          normalizedPlace;

      } else {

        const found =
          Object.entries(
            HISTORY_VENUES
          ).find(
            ([code, name]) =>
              name ===
              normalizedPlace
          );

        if (found) {

          venueCode =
            found[0];

        }

      }

    }


    if (!venueCode) {

      return errorResponse(
        "place は01〜10、または開催場名を指定してください。",
        400
      );

    }


    // 学習用の過去結果CSVはGitHubの年次データを返す。
    // KVに一部だけ保存された履歴を全年度データと誤認しない。
    return await fetchExternalHistoryCSV(year, venueCode);

  }


  return errorResponse(
    "date=YYYY-MM-DD または year=YYYY&place=01〜10 を指定してください。",
    400
  );
}


/* =========================================================
 * 指定レースのデバッグ
 *
 * /debug-race?date=...&venue=06&race=1
 * ======================================================= */

async function handleDebugRace(
  request
) {

  const url =
    new URL(
      request.url
    );


  const date =
    url.searchParams.get(
      "date"
    );


  const venueCode =
    url.searchParams.get(
      "venue"
    );


  const raceNumber =
    Number(
      url.searchParams.get(
        "race"
      )
    );


  if (
    !isValidDateString(
      date
    )
  ) {

    return errorResponse(
      "dateが正しくありません。",
      400
    );

  }


  if (
    !venueCode
  ) {

    return errorResponse(
      "venueがありません。",
      400
    );

  }


  if (
    !Number.isFinite(
      raceNumber
    )
  ) {

    return errorResponse(
      "raceが正しくありません。",
      400
    );

  }


  try {

    const races =
      await discoverJRAEntryRacesForDate(
        date
      );


    const target =
  races.find(
    race =>
      String(race.venueCode) ===
        String(venueCode) &&
      Number(race.raceNumber ?? race.raceNo) ===
        raceNumber
  );

    if (!target) {

      return errorResponse(
        "レースが見つかりません。",
        404
      );

    }


    const parsed =
      target.entryInfo ||
      { raceName: "", surface: "", distance: null, weather: "", trackCondition: "", horses: [] };


    return json({

      ok: true,

      source:
        "JRA",

      request: {

        date,

        venueCode,

        raceNumber

      },

      race: {

        venue:
          target.venue,

        raceName:
          parsed.raceName,

        surface:
          parsed.surface,

        distance:
          parsed.distance,

        weather:
          parsed.weather,

        trackCondition:
          parsed.trackCondition,

        horseCount:
          parsed.horses.length,

        horses:
          parsed.horses

      },

      debug: {

        url:
          target.url,

        htmlLength:
          target.htmlLength || null,

        cnameParsed:
          parseJRAEntryCname(target.cname)

      }

    });

  } catch (
    error
  ) {

    return errorResponse(
      error.message ||
        error,
      500
    );

  }

}


/* =========================================================
 * JRA取得テスト
 * ======================================================= */

async function testJRAResult() {

  const date =
    "2019-01-05";


  const races =
    await discoverJRARacesForDate(
      date
    );


  const first =
    races[0];


  if (!first) {

    return {

      ok: false,

      source:
        "JRA",

      error:
        "レースを発見できませんでした。"

    };

  }


  const html =
    await fetchJRAHtml(
      first.url
    );


  const parsed =
    extractJRAResultInfo(
      html
    );


  return {

    ok: true,

    source:
      "JRA",

    test:
      "testJRAResult",

    date,

    venue:
      first.venue,

    venueCode:
      first.venueCode,

    raceNumber:
      first.raceNumber,

    raceName:
      parsed.raceName,

    surface:
      parsed.surface,

    distance:
      parsed.distance,

    horseCount:
      parsed.horses.length,

    htmlLength:
      html.length

  };

}


/* =========================================================
 * 2019-01-05保存テスト
 * ======================================================= */

async function testJRAStore(env) {

  const result =
    await importHistoryDay(
      env,
      "2019-01-20",
      "06"
    );

  const rows =
    await loadStoredHistory(env);

  return {
    ok: true,
    source: "JRA",
    test: "testJRAStore",
    import: result,
    stats:
      getHistoryStats(rows)
  };
}


async function testJRAAutoDiscover(
  env,
  date = "2019-01-20"
) {

  if (
    !isValidDateString(date)
  ) {

    return {
      ok: false,
      error:
        "dateが正しくありません。"
    };

  }

 /*
 * ==================================================
 * 1.
 * 2019-01-19の実在ページから同日のレースを発見
 * ==================================================
 */

  const seedUrls = [
  {
    venueCode: "06",
    venueName: "中山",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1006201901060620190119%2F1A"
  },
  {
    venueCode: "08",
    venueName: "京都",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1008201901060620190119%2FAE"
  },
  {
    venueCode: "07",
    venueName: "中京",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1007201901010620190119%2F25"
  }
];

const firstFound =
  new Map();
for (
  const seed of seedUrls
) {

  /*
   * seed URL自身を入口として登録
   */
  const seedRace =
    parseJRACname(
      seed.url
    );

  if (
    seedRace &&
    seedRace.date === date
  ) {

    seedRace.venueName =
      seed.venueName;

    const seedKey =
      makeRaceId(
        date,
        seedRace.venueCode,
        seedRace.raceNo
      );

    firstFound.set(
      seedKey,
      seedRace
    );

  }

  /*
   * seedページ内のレースリンクを探索
   */
  try {

    const html =
      await fetchJRAHtml(
        seed.url
      );

    if (
      !html ||
      html.length < 1000
    ) {
      continue;
    }

    const rawLinks =
      extractJRALinks(
        html,
        seed.url
      );

    const parsed =
      rawLinks
        .map(
          parseJRACname
        )
        .filter(
          Boolean
        );

    for (
      const race of parsed
    ) {

      if (
        race.date !== date
      ) {
        continue;
      }

      const key =
        makeRaceId(
          date,
          race.venueCode,
          race.raceNo
        );

      if (
        !firstFound.has(key)
      ) {

        firstFound.set(
          key,
          race
        );

      }

    }

  } catch (
    error
  ) {

    console.error(
      "first discovery error",
      {
        seed:
          seed.url,

        error:
          String(
            error.message ||
            error
          )
      }
    );

  }

}

  /*
   * ==================================================
   * 2.
   * 発見した1/6のページを開き、
   * 「pw01sde」だけでなく
   * 「sw01sde」も直接探す。
   *
   * JRAにはPC版と別形式の結果ページが存在するため、
   * ここではCNAME文字列を直接解析する。
   * ==================================================
   */

  const allFound =
    new Map();

  for (
    const race of
      firstFound.values()
  ) {

    try {

      const html =
        await fetchJRAHtml(
          race.url
        );

      if (
        !html ||
        html.length < 1000
      ) {
        continue;
      }

      /*
       * 自分自身
       */

      const selfKey =
        makeRaceId(
          date,
          race.venueCode,
          race.raceNo
        );

      allFound.set(
        selfKey,
        race
      );

      /*
       * ==================================================
       * HTML内のCNAMEを直接取得
       *
       * pw01sde / sw01sde の両方を見る
       * ==================================================
       */

      const cnamePattern =
        /(?:pw01sde|sw01sde)\d{4}\d{8}\d{2}\d{8}(?:\/[A-Za-z0-9]+)?/gi;

      const cnameSet =
        new Set();

      let match;

      while (
        (match =
          cnamePattern.exec(
            html
          )) !== null
      ) {

        cnameSet.add(
          match[0]
        );

      }

      /*
       * 発見したCNAMEを解析
       */

      for (
        const cname of
          cnameSet
      ) {

        const m =
          cname.match(
            /(?:pw01sde|sw01sde)(\d{4})(\d{8})(\d{2})(\d{8})(?:\/([^\/]+))?$/i
          );

        if (!m) {
          continue;
        }

        const venueCode =
          m[1].slice(-2);

        const actualDate =
          `${m[4].slice(0, 4)}-` +
          `${m[4].slice(4, 6)}-` +
          `${m[4].slice(6, 8)}`;

        if (
          actualDate !== date
        ) {
          continue;
        }

        const raceNo =
          Number(
            m[3]
          );

        if (
          !Number.isFinite(
            raceNo
          ) ||
          raceNo < 1 ||
          raceNo > 12
        ) {
          continue;
        }

        /*
         * PC版URLに統一する。
         *
         * sw01sdeで発見した場合でも、
         * 同じCNAMEをpw01sdeに置き換えて
         * 結果ページとして確認する。
         */

        const pwCname =
          cname.replace(
            /^sw01sde/i,
            "pw01sde"
          );

        const url =
          `${JRA_BASE}/JRADB/accessS.html` +
          `?CNAME=${pwCname}`;

        const key =
          makeRaceId(
            date,
            venueCode,
            raceNo
          );

        if (
          !allFound.has(key)
        ) {

          allFound.set(
            key,
            {

              type:
                "result",

              venueCode,

              meetingDate:
                m[2],

              raceNo,

              date:
                actualDate,

              url

            }

          );

        }

      }

    } catch (
      error
    ) {

      console.error(
        "same-day discovery error",
        {
          url:
            race.url,

          error:
            String(
              error.message ||
              error
            )
        }
      );

    }

  }

  /*
   * ==================================================
   * 3.
   * 整理
   * ==================================================
   */

  const races =
    Array.from(
      allFound.values()
    ).sort(
      (
        a,
        b
      ) => {

        if (
          String(
            a.venueCode
          ) !==
          String(
            b.venueCode
          )
        ) {

          return String(
            a.venueCode
          ).localeCompare(
            String(
              b.venueCode
            )
          );

        }

        return (
          Number(
            a.raceNo
          ) -
          Number(
            b.raceNo
          )
        );

      }
    );

  /*
   * ==================================================
   * 4.
   * 競馬場ごとのレース番号
   * ==================================================
   */

  const venueRaces =
    {};

  for (
    const race of
      races
  ) {

    if (
      !venueRaces[
        race.venueCode
      ]
    ) {

      venueRaces[
        race.venueCode
      ] = [];

    }

    venueRaces[
      race.venueCode
    ].push(
      race.raceNo
    );

  }

  return {

    ok: true,

    source:
      "JRA",

    date,

    method:
      "実在ページからpw01sde/sw01sdeのCNAMEを探索",

    firstDiscoveryCount:
      firstFound.size,

    finalFoundCount:
      races.length,

    venueRaces,

    venues:
      Object.keys(
        venueRaces
      ),

    races:
      races.map(
        x => ({

          venueCode:
            x.venueCode,

          venueName:
            HISTORY_VENUES[
              x.venueCode
            ] ||
            x.venueCode,

          meetingDate:
            x.meetingDate,

          raceNo:
            x.raceNo,

          date:
            x.date,

          url:
            x.url

        })
      )

  };

}

/* =========================================================
 * AIモデル情報
 * ======================================================= */

function getModelInfo() {

  return {

    version:
      WORKER_VERSION,

    historicalDataStart:
      HISTORICAL_DATA_START,

    inputPolicy: {

      odds:
        false,

      popularity:
        false,

      futureResults:
        false

    },

    probability: {

      normalizedWithinRace:
        true

    },

    ev: {

      enabled:
        false,

      note:
        "オッズを手入力した場合のみ別計算する設計"

    }

  };

}


/* =========================================================
 * ヘルスチェック
 * ======================================================= */

async function handleHealth(env) {

  return json({

    ok: true,

    service:
      "keiba-ai-cloudflare-worker",

    version:
      WORKER_VERSION,

    source:
      "JRA",

    jra:
      JRA_BASE,

    historicalDataStart:
      HISTORICAL_DATA_START,

    historyKVConfigured:
      !!getHistoryKV(env),

    model:
      getModelInfo(),

    routes: [

      "/health",

      "/next-race",

      "/race-cards",

      "/race-results",

      "/predict",

      "/predict-day",

      "/venues",

      "/history-status",

      "/import-history",

      "/debug-race",

      "/test-jra",

      "/test-jra-store",

      "/test-history-2019",

      "/test-jra-full-day"

    ]

  });

}
/* =========================================================
 * 第10回 / 10
 * 最終ルーター
 * ======================================================= */


/* =========================================================
 * 同梱Webアプリ（Netlifyの再デプロイ停止を回避）
 * ======================================================= */
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnqbTppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56m06aas5aW96LWw44OE44O844OrPC90aXRsZT4KPHN0eWxlPgo6cm9vdHstLWJnOiNmM2Y1Zjc7LS1jYXJkOiNmZmY7LS10eDojMTcyMDJhOy0tc3ViOiM1ZDY4NzU7LS1sbjojZTVlN2ViOy0taGQ6IzEwMTgyODstLXByOiMxNjY3ZDl9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXs6cm9vdHstLWJnOiMwZjE0MWE7LS1jYXJkOiMxYTIxMjk7LS10eDojZThlY2YxOy0tc3ViOiM5YWE2YjI7LS1sbjojMmIzNDNlOy0taGQ6IzA1MDgwYzstLXByOiM0YjhlZjB9fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWZ9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6MTRweCAxNnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTlweH0KbWFpbnttYXgtd2lkdGg6OTAwcHg7bWFyZ2luOmF1dG87cGFkZGluZzoxMHB4fQpzZWN0aW9ue2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MTRweDttYXJnaW46MTBweCAwO2JveC1zaGFkb3c6MCAxcHggNHB4ICMwMDAxfQpoMntmb250LXNpemU6MTZweDttYXJnaW46MCAwIDhweH0KYnV0dG9ue2JvcmRlcjowO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTFweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tcHIpO2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo0cHggNHB4IDRweCAwO2ZvbnQtc2l6ZToxNHB4fQpidXR0b246ZGlzYWJsZWR7b3BhY2l0eTouNH1idXR0b24uc3Vie2JhY2tncm91bmQ6IzY2NzA4NX0KaW5wdXQsc2VsZWN0LHRleHRhcmVhe3BhZGRpbmc6OXB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6OHB4O2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtc2l6ZToxNXB4O21heC13aWR0aDoxMDAlO2JveC1zaXppbmc6Ym9yZGVyLWJveH0KdGV4dGFyZWF7d2lkdGg6MTAwJTttaW4taGVpZ2h0OjEyMHB4O2ZvbnQtZmFtaWx5OmluaGVyaXR9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5nb29ke2NvbG9yOiMxMzczMzM7Zm9udC13ZWlnaHQ6NzAwfS53YXJue2NvbG9yOiNjMjZhMDA7Zm9udC13ZWlnaHQ6NzAwfQp0YWJsZXt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTNweH10aCx0ZHtwYWRkaW5nOjZweCAzcHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbG4pO3RleHQtYWxpZ246cmlnaHR9CnRoOm50aC1jaGlsZCgtbisyKSx0ZDpudGgtY2hpbGQoLW4rMil7dGV4dC1hbGlnbjpsZWZ0fQouY2FuZHtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxuKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzo5cHg7bWFyZ2luOjhweCAwfQouY2hpcHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXNpemU6MTJweDtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6MnB4IDhweDttYXJnaW46M3B4IDRweCAwIDA7YmFja2dyb3VuZDojZWVmMWY1O2NvbG9yOiMzNDQwNTR9Ci5jaGlwLmJ7YmFja2dyb3VuZDojZTBmMmU2O2NvbG9yOiMxMzczMzN9LmNoaXAub3tiYWNrZ3JvdW5kOiNmZmVmY2Y7Y29sb3I6IzlhNWEwMH0uY2hpcC5ne2JhY2tncm91bmQ6I2U2ZTllZTtjb2xvcjojNWQ2ODc1fQoucnR7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC13ZWlnaHQ6ODAwO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MCA3cHg7Y29sb3I6I2ZmZjtiYWNrZ3JvdW5kOiM5OGEyYjN9Ci5ydC5yU3tiYWNrZ3JvdW5kOiNkOTJkMjB9LnJ0LnJBe2JhY2tncm91bmQ6I2Y3OTAwOX0ucnQuckJ7YmFja2dyb3VuZDojMTY2N2Q5fQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nqbTppqzlpb3otbDjg4Tjg7zjg6sgPHNwYW4gc3R5bGU9ImZvbnQtd2VpZ2h0OjQwMDtmb250LXNpemU6MTNweCI+5Y2Y5L2T54mIIHYxPC9zcGFuPjwvaGVhZGVyPgo8bWFpbj4KPHNlY3Rpb24+CjxoMj7imIUg5pys5pel44Gu5aW96LWw56m06aasPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuODnOOCv+ODszHjgaTjgafjgIzlh7rppqzooajjga7lj5blvpcg4oaSIOOCquODg+OCuu+8iOWPluOCjOOCjOOBsO+8ieKGkiDlhajjg6zjg7zjgrnjga7nqbTppqzlgJnoo5zjgI3jgpLooajnpLrjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0ic21hbGwiPuKaoCDpgY7ljrvjga7mpJzoqLzvvIgyMDIz5bm044Cc44CB5omV5oi744Gk44GN77yJ77ya56m06aasMeS9jeWAmeijnOOBrjxiPuikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzclPC9iPu+8iDEwMCXmnKrmuoDvvInjgafjgZfjgZ/jgILlvZPjgZ/jgorjgoTjgZnjgZXjga7nm67lronjgajjgZfjgabjgYrkvb/jgYTjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9InRkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJ0b2RheUdvIj7lpb3otbDnqbTppqzjgpLooajnpLo8L2J1dHRvbj48YnV0dG9uIGlkPSJ0b2RheVVwZCIgY2xhc3M9InN1YiI+5pyA5paw44Gu5oiQ57i+44Gr5pu05pawPC9idXR0b24+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iZm9jdXNPbiIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOKXjueahOS4reeOh+mHjeimlu+8iOODqeODs+OCr1MvQeOBoOOBkeihqOekuuOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+WNmOWLnTMw5YCN5pyq5rqA77yJPC9sYWJlbD48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJhdXRvT2RkcyIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOOCquODg+OCuuOCkuiHquWLleOBp+abtOaWsOOBmeOCizwvbGFiZWw+IDxzZWxlY3QgaWQ9ImF1dG9NaW4iPjxvcHRpb24gdmFsdWU9IjMiPjPliIY8L29wdGlvbj48b3B0aW9uIHZhbHVlPSI1IiBzZWxlY3RlZD415YiGPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEw5YiGPC9vcHRpb24+PC9zZWxlY3Q+IOOBlOOBqCA8c3BhbiBpZD0iYXV0b0luZm8iPjwvc3Bhbj48L2Rpdj4KPGRldGFpbHMgY2xhc3M9InNtYWxsIj48c3VtbWFyeT7oqq3jgb/lj5bjgozjgarjgYTjg6zjg7zjgrnjgYzjgYLjgovjgajjgY3vvIjoqLrmlq3mg4XloLHvvIk8L3N1bW1hcnk+CjxkaXYgY2xhc3M9InNtYWxsIj7jgIzjgrPjg7zjgrnkuI3mmI7jgI3jgoTjgIHjgqrjg4PjgrrjgYzlj5bjgozjgarjgYTplovlgqzloLTjgYzjgYLjgovjgajjgY3jgavmirzjgZfjgabjgY/jgaDjgZXjgYTjgILlkITplovlgqzloLTjga4xUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuOAgeS4i+OBruashOOBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpuOAgeOBneOBruOBvuOBvumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImRiZ0dvIiBjbGFzcz0ic3ViIj7oqLrmlq3mg4XloLHjgpLkvZzjgos8L2J1dHRvbj48YnV0dG9uIGlkPSJkYmdDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KPHRleHRhcmVhIGlkPSJkYmdPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxNTBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kZXRhaWxzPgo8ZGl2IGlkPSJ0b2RheVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn44CM5aW96LWw56m06aas44KS6KGo56S644CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CC5oiQ57i+44GM5Y+k44GE44Go44GN44Gv5YWI44Gr44CM5pyA5paw44Gu5oiQ57i+44Gr5pu05paw44CN44KS5oq844GX44G+44GZ44CCPC9kaXY+CjxkaXYgaWQ9InRvZGF5T3V0Ij48L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAg44OH44O844K/5Y+W5b6X77yI44GT44Gu44Ki44OX44Oq44Gg44GR44Gn5a6M57WQ77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPkpSQeWFrOW8j+OBi+OCieOAgemBjuWOu+OBruaIkOe4vu+8iOS6uuawl+OBpOOBje+8ieOBqOikh+WLneODu+WNmOWLneOBruaJleaIu+OCkuWPluW+l+OBl+OBpuOAgeOBk+OBruerr+acq+OBq+S/neWtmOOBl+OBvuOBmeOAguWFg+OBruOCouODl+ODquOChOODkOODg+OCr+OCouODg+ODl+OBr+S4jeimgeOBp+OBmeOAguatouOCgeOBpuOCgue2muOBjeOBi+OCieWGjemWi+OBp+OBjeOBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iaHR0cHM6Ly9rZWliYS1haS1wYXlvdXRzLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJzeW5jR28iPumBjuWOu+aIkOe4vuOBqOaJleaIu+OCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9InN5bmNTdG9wIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7lgZzmraI8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CjxkaXYgaWQ9ImRhdGFTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuODkOODg+OCr+OCouODg+ODl0pTT07vvI9DU1bjgYvjgonoqq3jgb/ovrzjgoDvvIjku7vmhI/vvIk8L3N1bW1hcnk+CjxkaXYgY2xhc3M9InNtYWxsIj7lhYPjgqLjg5fjg6rjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYzjgYLjgozjgbDjgIHlj5blvpfjgpLnnIHnlaXjgafjgY3jgb7jgZnvvIjlkIzjgZjml6Xjga/ph43opIfjgZfjgablj5bjgorovrzjgb/jgb7jgZvjgpPvvInjgII8L2Rpdj4KPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CjwvZGV0YWlscz4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAtMSDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJl44Gr5L+d5a2Y77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+OBl+OBn+aIkOe4vuODu+aJleaIu+OCkuOAgeOBguOBquOBn+OBrkNsb3VkZmxhcmXvvIhLVu+8ieOBq+iHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBl+OBvuOBmeOAgjxiPuODh+ODvOOCv+OBjOWkieOCj+OCi+OBqOOAgee0hDPnp5LlvozjgavlpInjgo/jgaPjgZ/pg6jliIbjgaDjgZHjgpLpgIHjgorjgb7jgZnjgII8L2I+44OW44Op44Km44K244Gu44OH44O844K/44GM5raI44GI44Gm44KC44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn5b6p5YWD44Gn44GN44G+44GZ77yI5Yil44Gu56uv5pyr44Gr44KC5b6p5YWD44Gn44GN44G+44GZ77yJ44CC44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB5L+h44GX44G+44Gb44KT44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxsYWJlbD48aW5wdXQgaWQ9ImJrQXV0byIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOWkieabtOOBjOOBguOCjOOBsOiHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBmeOCizwvbGFiZWw+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYmtOb3ciPuS7iuOBmeOBkOODkOODg+OCr+OCouODg+ODlzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrUmVzdG9yZSIgY2xhc3M9InN1YiI+44OQ44OD44Kv44Ki44OD44OX44GL44KJ5b6p5YWDPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtGdWxsIiBjbGFzcz0ic3ViIj7jgZnjgbnjgabkv53lrZjjgZfnm7TjgZk8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovDwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHmmYLns7vliJfvvIjjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHvvInjga7jg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnjgILnqbTjgr7jg7zjg7Pjga/lrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgIHlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgajku67lrprjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJ0R3JhZGUiIGNsYXNzPSJzdWIiPumHjeiznuOBoOOBke+8muOCsOODrOODvOODieijnOato+OBguOCii/jgarjgZfjgpLmr5TovIM8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoSDjg6zjg7zjgrnjgpLpgbjjgbY8L2gyPgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InRhYldvcmtlciIgY2xhc3M9InN1YiI+5Ye66aas6KGo44KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0idGFiTWFudWFsIiBjbGFzcz0ic3ViIj7miYvlhaXlips8L2J1dHRvbj48YnV0dG9uIGlkPSJ0YWJQYXN0IiBjbGFzcz0ic3ViIj7pgY7ljrvjg6zjg7zjgrnjgafoqabjgZk8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0icGFuZVdvcmtlciIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5pei5a2Y44GuV29ya2Vy44GuIC9yYWNlLWNhcmRzIOOCkuiqreOBv+WPluOCi+OBoOOBkeOBp+OBme+8iOWkieabtOOBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9IndkYXRlIiB0eXBlPSJkYXRlIj48L2Rpdj4KIDxidXR0b24gaWQ9IndnZXQiPumWi+WCrOODu+ODrOODvOOCueOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNHZXQiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuOCquODg+OCuuOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9IndhbGwiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWFqOODrOODvOOCueS4gOaLrOino+aekDwvYnV0dG9uPjxkaXYgaWQ9IndzdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWPluW+lzwvZGl2PjxkaXYgaWQ9IndsaXN0Ij48L2Rpdj48ZGl2IGlkPSJhbGxvdXQiPjwvZGl2Pgo8L2Rpdj4KPGRpdiBpZD0icGFuZU1hbnVhbCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+MeihjOOBq+OAjOmmrOeVqiDppqzlkI3jgI3jgILku7vmhI/jgafmnIDlvozjgavljZjli53jgqrjg4PjgrrjgILkvovvvJo8YnI+MSDil4vil4vil4vil4sgMy40PGJyPjIg4paz4paz4paz4pazPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0ibWRhdGUiIHR5cGU9ImRhdGUiPjxzZWxlY3QgaWQ9Im1zdXJmIj48b3B0aW9uIHZhbHVlPSIxIj7oip08L29wdGlvbj48b3B0aW9uIHZhbHVlPSIyIj7jg4Djg7zjg4g8L29wdGlvbj48L3NlbGVjdD48aW5wdXQgaWQ9Im1kaXN0IiB0eXBlPSJudW1iZXIiIHN0ZXA9IjEwMCIgdmFsdWU9IjE2MDAiIHN0eWxlPSJ3aWR0aDo5MHB4Ij5tPC9kaXY+CiA8dGV4dGFyZWEgaWQ9Im10ZXh0IiBwbGFjZWhvbGRlcj0iMSDppqzlkI0mIzEwOzIg6aas5ZCNIj48L3RleHRhcmVhPgogPGJ1dHRvbiBpZD0ibWdvIj7jgZPjga7jg6zjg7zjgrnjgpLkvb/jgYY8L2J1dHRvbj4KPC9kaXY+CjxkaXYgaWQ9InBhbmVQYXN0IiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj7kv53lrZjmuIjjgb/jga7pgY7ljrvjg6zjg7zjgrnjgpLjgIHjgZ3jga7ml6XjgojjgorliY3jga7jg4fjg7zjgr/jgaDjgZHjgafkuojmg7PjgZfjgb7jgZnjgILlrp/pmpvjga7nnYDpoIbjgpLkuKbjgbnjgabnorroqo3jgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJwZGF0ZSIgdHlwZT0iZGF0ZSI+PGJ1dHRvbiBpZD0icGdldCI+44Gd44Gu5pel44Gu44Os44O844K55LiA6KanPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJwc3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7ml6Xku5jjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj48ZGl2IGlkPSJwbGlzdCI+PC9kaXY+CjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoiDnqbTppqzlpb3otbDjgpLop6PmnpA8L2gyPgo8ZGl2IGlkPSJyYWNlbGFiZWwiIGNsYXNzPSJzbWFsbCI+44Os44O844K544KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjxidXR0b24gaWQ9InJ1biIgZGlzYWJsZWQ+6Kej5p6Q44GZ44KLPC9idXR0b24+CjxkaXYgaWQ9Im91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGjIOOBk+OBruODhOODvOODq+OBq+OBpOOBhOOBpjwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj4KPGI+5aW96LWw546HPC9iPu+8nTPnnYDlhoXjgavlhaXjgovnorrnjofjga7mjqjlrprjgILpgY7ljrvjga7lrp/nuL7jg4fjg7zjgr/jgYvjgonph43jgb/jgpLlrabnv5LjgZfjgZ/jg6Ljg4fjg6vjgafoqIjnrpfjgZfjgb7jgZnvvIjpgJrnrpfjga4z552A5YaF546H44O744Kv44Op44K56KOc5q2j44GX44Gf5oiQ57i+44O755u06L+RM+i1sOODu+acgOe1guedgOmghuODu+WQjOadoeS7tuOBruWun+e4vuODu+mWk+malOODu+W5tOm9ouODu+aYh+e0mumZjee0muODu+WIneOBruiKneODgOabv+OCj+OCiu+8ieOAgjxicj4KPGI+44Kv44Op44K5PC9iPu+8muacquWLneWIqe+8jzHli53vvI8y5Yud77yPM+WLne+8j+OCquODvOODl+ODs+OCkuWMuuWIpeOBl+OAgeS9juOBhOOCr+ODqeOCueOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjeOBvuOBmeOAguWcsOaWueOBruODh+ODvOOCv+OBjOWQq+OBvuOCjOOCi+WgtOWQiOOBr+OAgeOBleOCieOBq+WJsuOCiuW8leOBjeOBvuOBme+8iEpSQeOBruWFrOW8j+OCteOCpOODiOOBq+OBr+WcsOaWueOBruaIkOe4vuOBjOOBquOBhOOBn+OCgeOAgeS4reWkruOBruOBv+OBruWxpeattOOBp+OBme+8ieOAgjxicj4KPGI+MuOBpOOBruODouODvOODiTwvYj7vvJo8YnI+CuODu+OCquODg+OCuuacquWFpeWKm++8mueptOOCvuODvOODs+OCkuOAjOODhOODvOODq+aOqOWumuOBruS6uuawl++8iOmojuaJi+aIkOe4vui+vOOBv++8ieOAjeOBp+WIpOWumuOAguWun+mam+OBruS6uuawl+OBqOOBruebuOmWouOBrzAuNzjjgafjgZnjgII8YnI+CuODu+OCquODg+OCuuWFpeWKm++8iOOBvuOBn+OBr+mBjuWOu+ODrOODvOOCueOBruS6uuawl+mghuS9je+8ie+8mueptOOCvuODvOODs+OCkuWun+mam+OBruS6uuawl+OBp+WIpOWumuOBl+OBvuOBmeOAguacrOadpeOBruS9v+OBhOaWueOBp+OBmeOAguW4guWgtOOBqOOBruW3ruOCguWHuuOBl+OBvuOBmeOBjOOAgeaknOiovOOBp+OBr+W9k+OBn+OCiuOBq+e1kOOBs+S7mOOBi+OBquOBi+OBo+OBn+OBn+OCgeWPguiAg+eoi+W6puOBq+OBl+OBpuOBj+OBoOOBleOBhOOAgjxicj4KPGI+6KGo56S644Gu6Kqt44G/5pa5PC9iPu+8muWlvei1sOeOh+OBr+OAgeOBneOBrummrOOBruOAjOeptOOCvuODvOODs+WGheOBp+OBruWun+e4vuODmeODvOOCueOBrueiuueOh+OAjeOBp+OBmeOAguWxpeattOOBruOBquOBhOmmrOOCguOAgemgreaVsOOBjOWkmuOBkeOCjOOBsOe0hDLlibLjgavjgarjgorjgb7jgZnvvIgxNemgreeri+OBpuOBpzPpoK3jgYwz552A5YaF44Gr5YWl44KL44Gf44KB77yJ44CC6KmV5L6h44Op44Oz44Kv44Gv44CB56m044K+44O844Oz44Gu5bmz5Z2H44Gu5L2V5YCN44GL44Gn5rG644KB44Gm44GE44G+44GZ44CCPGJyPgo8Yj7mpJzoqLzvvIgyMDI05bm05Lul6ZmN44O75a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJPC9iPu+8mjxicj4K44O744Oi44OH44Or57K+5bqm77yI5a++5pWw5pCN5aSx77yJ77ya5pen44Oi44OH44OrMC40NzEg4oaSIOaWsOODouODh+ODqzAuNDUw77yI5bCP44GV44GE44G744Gp6Imv44GE77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZPjga4z552A5YaF546HIDkuMSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6vjga4x5L2N5YCZ6KOcMTMuMiUg4oaSIOaWsOODouODh+ODqzE2LjUl77yI5LiK5L2NMumgrTE1LjQl77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrmnKrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZMgMTEuNSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6sxOC41JSDihpIg5paw44Oi44OH44OrMjEuMyXvvIjkuIrkvY0y6aCtMTkuNyXvvInjgII8YnI+CuODuzxiPuKXjueahOS4reeOh+mHjeimljwvYj7vvIjlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O75Y2Y5YudMzDlgI3mnKrmuoDvvInvvJox5L2N5YCZ6KOc44Gu55qE5Lit546H44Gv44CB44Kq44OD44K644GC44KKMTcuMiXihpIyMy4yJeOAgeOCquODg+OCuuOBquOBlzIxLjcl4oaSMjcuMiXjgavkuIrjgYzjgorjgb7jgZnvvIjliY3ljYrjg7vlvozljYrjgajjgoLlkIzjgZjlgr7lkJHvvInjgILlgJnoo5zjga8x6ZaL5YKs5pel44GC44Gf44KK57SEMTTpoK3jgafjgZnjgII8YnI+44O744Op44Oz44Kv44Go5a6f57i+77yaU++8nkHvvJ5C77yeQ+OBrumghuOBqzPnnYDlhoXnjofjgYzkuIvjgYzjgorjgb7jgZnvvIjjgqrjg4PjgrrmnKrlhaXlipvmmYLvvJozMyXvvI8yNCXvvI8yMCXvvI8xMyXvvInjgII8YnI+CuODuzxiPuikh+WLneOBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgovjgajjga/jgIHjgb7jgaDnorroqo3jgafjgY3jgabjgYTjgb7jgZvjgpPjgII8L2I+5YCZ6KOc44Gv5b2T44Gf44KL56K6546H44GM6auY44GE5YiG44CB6YWN5b2T44GM5L2O44KB44Gn44GZ44CC4pGgLTLjgaflv4XjgZrnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgII8YnI+CjxiPuWAmeijnOOBruadoeS7tjwvYj7vvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS5YCZ6KOc44Gr44GX44G+44GZ44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5aW96LWw546H44GM5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB44Gn44GZ44CC5paw6aas5oim44Gq44Gp44Gv5a++6LGh5aSW44Gr44Gq44KK44G+44GZ44CCPGJyPgrjgqrjg4Pjgrrjg7vkurrmsJfjga/kuojmuKzjga7lhaXlipvjgavjga/kvb/jgaPjgabjgYTjgb7jgZvjgpPvvIjkurrmsJfjga7ku6PnkIbjg6Ljg4fjg6vjga7lrabnv5Ljg6njg5njg6vjgajjgIHnqbTjgr7jg7zjg7Pjga7liKTlrprjgIHlppnlkbPjga7mr5TovIPjgavjga7jgb/kvb/nlKjvvInjgILopIfli53lm57lj47njofjga/jgIHmiZXmiLvjgpLlj5blvpfjgZfjgZ/jgYLjgajjgavikaAtMuOBp+aknOiovOOBp+OBjeOBvuOBmeOAggo8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaQg6YmE5p2/6Lu46aas77yI6KSH5Yud5ZyP5YaFIOe0hDk1Je+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM5qW144KB44Gm6auY44GE6aas44KS5Ye644GX44G+44GZ44CC6YGO5Y6744Gu5a6f57i+77yIMjAyNOW5tOS7pemZje+8ieOBp+OAgeOAjOmJhOadv+OAjeOBrzk2Je+8iDk1JeW5hSA5NOOAnDk5Je+8ieOAgeOAjOa6lumJhOadv+OAjeOBrzg5JeOAgeOAjOWghei7uOOAjeOBrzg0JeOBp+OBl+OBn+OAguikh+WLneOBrumFjeW9k+OBr+S9juOBhO+8iDEwMOOAnDEyMOWGhuWJjeW+jO+8ieOBruOBp+OAgTxiPuODr+OCpOODieODu+mmrOmAo+ODuzPpgKPopIfjgarjganjga7ou7g8L2I+44Go44GX44Gm5L2/44GG5oOz5a6a44Gn44GZ44CC44Kq44OD44K644GM44Gq44GE5YmN5pel44Gv44CB5Yik5a6a44Gn44GN44G+44Gb44KT44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJhZGF0ZSIgdHlwZT0iZGF0ZSI+PGJ1dHRvbiBpZD0iYXhpc0dvIj7piYTmnb/ou7jjgajms6LkubHluqbjgpLooajnpLo8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0iYXhpc1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn5oq844GX44Gm44GP44Gg44GV44GE77yI5Ye66aas6KGo44Go44Kq44OD44K644KS5Y+W5b6X44GX44Gm44CB4pGk4pGl44KS5ZCM5pmC44Gr6KGo56S644GX44G+44GZ77yJ44CCPC9kaXY+CjxkaXYgaWQ9ImF4aXNPdXQiPjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRpSDlhajjg6zjg7zjgrnjga7ms6LkubHluqbvvIhTU1PjgJxD77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iu+8neS6uuawl+iWhOOBjOe1oeOCgOOAjeODrOODvOOCueOBq+OBquOCi+eiuueOh+OBp+OAgeetiee0muOCkuS7mOOBkeOBvuOBmeOAgumBjuWOu+OBruWun+e4vu+8iDIwMjTlubTku6XpmY3vvInvvJpTU1MgNTfjgJw2OCXjgIFTUyA1MeOAnDYwJeOAgVMgNDPjgJw0NiXjgIFBIDM1JeOAgUIgMjTjgJwyNSXjgIFDIDjjgJw5Je+8iOWFqOODrOODvOOCueW5s+Wdh+OBrzI4LjUl77yJ44CC44Kq44OD44K644GM44GC44KM44Gw57K+5bqm44GM5LiK44GM44KK44G+44GZ44CCPGI+6I2S44KM44KE44GZ44GV44Gu55uu5a6J44Gn44CB56m06aas44GM5b2T44Gf44KL44GL44Gp44GG44GL44Go44Gv5Yil44Gn44GZ44CCPC9iPjwvZGl2Pgo8ZGl2IGlkPSJ1cHNldE91dCIgY2xhc3M9InN0YXR1cyI+4pGk44Gu44CM6YmE5p2/6Lu444Go5rOi5Lmx5bqm44KS6KGo56S644CN44KS5oq844GZ44Go44CB44GT44GT44Gr5YWo44Os44O844K544Gu5LiA6Kan44GM5Ye644G+44GZ44CCPC9kaXY+Cjwvc2VjdGlvbj4KPC9tYWluPgo8ZGl2IGlkPSJidXN5Ij48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+CjxzY3JpcHQ+CiJ1c2Ugc3RyaWN0IjsKLyog56m06aas5aW96LWw44Ko44Oz44K444Oz77yI5Y2Y5L2T54mI44O744OW44Op44Km44K2L05vZGXlhbHnlKjvvInjgILjgqrjg4Pjgrrjg7vkurrmsJfjga/jgrnjgrPjgqLjgavkvb/nlKjjgZfjgarjgYTjgIIgKi8KY29uc3QgVUU9KCgpPT57CiAvKiDlrp/jg4fjg7zjgr/mpJzoqLzjgafpgIblirnmnpzjgaDjgaPjgZ/miJDliIbvvIjpqI7miYvjg7vplpPpmpTvvInjga/ml6LlrprjgadPRkYgKi8KIGNvbnN0IERFRkFVTFQ9e2pvY2tleTpmYWxzZSxsYXlvZmY6ZmFsc2V9OwogY29uc3QgY2xhbXA9KHgsYSxiKT0+TWF0aC5tYXgoYSxNYXRoLm1pbihiLHgpKTsKIGNvbnN0IHNpZ21vaWQ9eD0+MS8oMStNYXRoLmV4cCgteCkpOwogY29uc3QgbG9naXQ9cD0+e3A9Y2xhbXAocCwuMDAxLC45OTkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CiBjb25zdCBubj1zPT5TdHJpbmcocz8/IiIpLm5vcm1hbGl6ZSgiTkZLQyIpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW1xzXHUzMDAwXSsvZywiIikucmVwbGFjZSgvW+ODu++9pS7vvI5cLeKAkOKAkeKAkuKAk+KAlOKAlSfigJlgXS9nLCIiKS5yZXBsYWNlKC9b4piG4piF4paz4pay4peH4peGXS9nLCIiKTsKIC8qIOmojuaJi+WQje+8muWFiOmgreOBruasp+Wtl+OCpOODi+OCt+ODo+ODq+OCkumZpOOBjeOAgeODh+ODoOODvOODreKGkuODh+ODoCDjgavmj4PjgYjjgovvvIhKUkHjga4gQy7jg4fjg6Djg7zjg60g44Go6YGO5Y6744OH44O844K/44GuIO+8o++8juODh+ODoCDjgpLkuIDoh7TjgZXjgZvjgovvvIkgKi8KIGNvbnN0IGpubj1zPT57bGV0IHY9bm4oU3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9cZHsyfSg/OlwuXGQpP1xzKig/OmtnfO+9i++9hykvZ2ksIiAiKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsOH1b77yJKV0vZywiICIpLnJlcGxhY2UoLyjmoJfmnbF8576O5rWmKS9nLCIgIikpO3Y9di5yZXBsYWNlKC9eW2Etel0oPz1b44KhLeODtuODvF0pLywiIik7dj12LnJlcGxhY2UoL17jg4fjg6Djg7zjg60vLCLjg4fjg6AiKTtyZXR1cm4gdn07CiAvKiDjgq/jg6njgrnjga7mrrXpmo7vvJowPeS4jeaYjiAvIC0xPeWcsOaWuSAvIDE95paw6aas44O75pyq5Yud5YipIC8gMj0x5YudIC8gMz0y5YudIC8gND0z5YudIC8gNT3jgqrjg7zjg5fjg7Pjg7vph43os54gKi8KIGNvbnN0IGxldmVsT2ZMYWJlbD10PT57Y29uc3Qgcz1TdHJpbmcodHx8IiIpO2lmKC/lnLDmlrl8TkFSLy50ZXN0KHMpKXJldHVybiAtMTtpZigv5paw6aasfOacquWLneWIqS8udGVzdChzKSlyZXR1cm4gMTtpZigvMeWLnXw1MDDkuIcvLnRlc3QocykpcmV0dXJuIDI7aWYoLzLli518MTAwMOS4hy8udGVzdChzKSlyZXR1cm4gMztpZigvM+WLnXwxNjAw5LiHLy50ZXN0KHMpKXJldHVybiA0O2lmKC/jgqrjg7zjg5fjg7N877yv77ywfE9QfOODquOCueODhuODg+ODiXzph43os55877ynfEdbMTIzSV0vaS50ZXN0KHMpKXJldHVybiA1O3JldHVybiAwfTsKIGNvbnN0IGxldmVsT2ZQcml6ZT1wPT57cD1OdW1iZXIocCk7cmV0dXJuICEocD4wKT8wOnA8PTcwMD8xOnA8PTkwMD8yOnA8PTEzMDA/MzpwPD0xODAwPzQ6NX07CiAvKiDimIXjgrDjg6zjg7zjg4nvvIjmoLzvvInvvJowPeS4jeaYji/kuIvntJogMT1PUOODu+ODquOCueODhuODg+ODiSAyPUczIDM9RzIgND1HMeOAggogICAg5b6T5p2l44GvIEcxL0cyL0czL09QIOOCkuOBmeOBueOBpuOAjDXjgI3jgavmvbDjgZfjgabjgYTjgZ/jgZ/jgoHjgIFHM+WLneOBoeOBjCBHMSDjgafjgoLlibLlvJXjgZXjgozjgarjgYvjgaPjgZ/jgIIKICAgIOWIpOWumumghu+8muODqeODmeODq++8iE5GS0PlvowgR0kvR0lJL0dJSUkvRzHjgJxHM++8ieKGkiAx552A6LOe6YeR77yI5LiH5YaG77yJ4oaS77yI5a++6LGh44Os44O844K544Gu44G/77yJRzHjg6zjg7zjgrnlkI0gKi8KIGNvbnN0IEcxX05BTUVTPS/lpKnnmofos5585pyJ6aas6KiY5b+1fOOCuOODo+ODkeODs+OCq+ODg+ODl3zjgrjjg6Pjg5Hjg7PvvKN85a6d5aGa6KiY5b+1fOWuieeUsOiomOW/tXzjg7TjgqPjgq/jg4jjg6rjgqLjg57jgqTjg6t85aSn6Ziq5p2vfOmrmOadvuWuruiomOW/tXzjg5Xjgqfjg5bjg6njg6rjg7x844OB44Oj44Oz44OU44Kq44Oz44K6fOOCueODl+ODquODs+OCv+ODvOOCunzjg57jgqTjg6vjg4Hjg6Pjg7Pjg5Tjgqrjg7Pjgrfjg4Pjg5d844Ko44Oq44K244OZ44K55aWz546L5p2vfOeni+iPr+iznnzoj4roirHos5585qGc6Iqx6LOefOOCquODvOOCr+OCuXzlhKrpp7/niZ3ppqx85pel5pys44OA44O844OT44O8fOadseS6rOWEqumnv3znmpDmnIjos558TkhL44Oe44Kk44OrfOmYquelnuOCuOODpeODmeODiuOCpOODq3zmnJ3ml6Xmna9844Ob44O844OX44OV44OrLzsKIGNvbnN0IGdyYWRlVGllcj0odGV4dCxwcml6ZSxieU5hbWUpPT57Y29uc3Qgcz1TdHJpbmcodGV4dHx8IiIpLm5vcm1hbGl6ZSgiTkZLQyIpOwogIGlmKC/pmpzlrrN844K444Oj44Oz44OXfEpcLj9ccz9HL2kudGVzdChzKSlyZXR1cm4gMDsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/OklJSXwzKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gMjsKICBpZigvKD86XnxbXkEtWmEtel0pRyg/OklJfDIpKD8hW0EtWmEtejAtOV0pLy50ZXN0KHMpKXJldHVybiAzOwogIGlmKC8oPzpefFteQS1aYS16XSlHKD86SXwxKSg/IVtBLVphLXowLTldKS8udGVzdChzKSlyZXR1cm4gNDsKICBjb25zdCBwPU51bWJlcihwcml6ZSk7aWYocD4wKXJldHVybiBwPj0xMDAwMD80OnA+PTUwMDA/MzpwPj0zNTAwPzI6cD49MTgwMD8xOjA7CiAgaWYoYnlOYW1lJiZHMV9OQU1FUy50ZXN0KHMpKXJldHVybiA0OwogIGlmKC/jg6rjgrnjg4bjg4Pjg4l844Kq44O844OX44OzfO+8r++8sHxcYk9QXGIvLnRlc3QocykpcmV0dXJuIDE7CiAgcmV0dXJuIDB9OwogY29uc3QgaXNKcmFWZW51ZT1jPT4vXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoY3x8IiIpKTsKIGNvbnN0IHN1cmZDb2RlPXM9PntzPVN0cmluZyhzfHwiIik7cmV0dXJuIC/oip18dHVyZi9pLnRlc3Qocyk/MTov44OAfGRpcnQvaS50ZXN0KHMpPzI6L+manHxqdW1wL2kudGVzdChzKT8zOjB9OwogY29uc3QgZG51bT1kPT5OdW1iZXIoU3RyaW5nKGR8fCIiKS5yZXBsYWNlKC9cRC9nLCIiKS5zbGljZSgwLDgpKXx8MDsKIGZ1bmN0aW9uIHBhcnNlRGF0ZShzKXsKICBzPVN0cmluZyhzfHwiIik7bGV0IG09cy5tYXRjaCgvKFxkezR9KVxEezAsNH0oXGR7MSwyfSlcRHswLDR9KFxkezEsMn0pLyk7CiAgaWYoIW0pcmV0dXJuIiI7cmV0dXJuIGAke21bMV19LSR7bVsyXS5wYWRTdGFydCgyLCIwIil9LSR7bVszXS5wYWRTdGFydCgyLCIwIil9YDsKIH0KIGZ1bmN0aW9uIGNzdlJvd3ModGV4dCl7CiAgY29uc3QgbGluZXM9U3RyaW5nKHRleHR8fCIiKS5yZXBsYWNlKC9eXHVGRUZGLywiIikuc3BsaXQoL1xyP1xuLykuZmlsdGVyKHg9PngudHJpbSgpKTsKICBpZighbGluZXMubGVuZ3RoKXJldHVybltdOwogIGNvbnN0IHNwbGl0PWw9Pntjb25zdCBhPVtdO2xldCBjPSIiLHE9ZmFsc2U7Zm9yKGxldCBpPTA7aTxsLmxlbmd0aDtpKyspe2NvbnN0IGNoPWxbaV07CiAgIGlmKGNoPT09JyInKXtpZihxJiZsW2krMV09PT0nIicpe2MrPSciJztpKyt9ZWxzZSBxPSFxfWVsc2UgaWYoY2g9PT0iLCImJiFxKXthLnB1c2goYyk7Yz0iIn1lbHNlIGMrPWNofWEucHVzaChjKTtyZXR1cm4gYX07CiAgY29uc3QgaGVhZD1zcGxpdChsaW5lc1swXSkubWFwKHg9PngudHJpbSgpKTtjb25zdCBvdXQ9W107CiAgZm9yKGxldCBpPTE7aTxsaW5lcy5sZW5ndGg7aSsrKXtjb25zdCBhPXNwbGl0KGxpbmVzW2ldKSxvPXt9O2ZvcihsZXQgaj0wO2o8aGVhZC5sZW5ndGg7aisrKW9baGVhZFtqXV09YVtqXT8/IiI7b3V0LnB1c2gobyl9CiAgcmV0dXJuIG91dDsKIH0KIGNvbnN0IGY9dj0+e2NvbnN0IG49cGFyc2VGbG9hdChTdHJpbmcodj8/IiIpLnJlcGxhY2UoLywvZywiIikpO3JldHVybiBOdW1iZXIuaXNGaW5pdGUobik/bjpudWxsfTsKIC8qIOODkOODg+OCr+OCouODg+ODly9DU1bjga4x6KGM4oaS6Lu96YeP6KGMICovCiBmdW5jdGlvbiB0b1JvdyhvKXtjb25zdCBfcj10b1JvdzAobyk7X3IuZ3JkPWdyYWRlVGllcihTdHJpbmcob1siY2xhc3MiXXx8by5jbHN8fCIiKSsiICIrU3RyaW5nKG9bIuODrOODvOOCueWQjSJdfHxvLnJhY2VfbmFtZXx8by5yYWNlbmFtZXx8IiIpLG51bGwsZmFsc2UpO3JldHVybiBfcn0KIGZ1bmN0aW9uIHRvUm93MChvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICBoLm4rKztoLnRvcDMrPXQzO2lmKHIuZmluaXNoPT09MSloLndpbisrO2guc3VtKz1yLmZpbmlzaDtpZihyLmRhdGU+aC5sYXN0KWgubGFzdD1yLmRhdGU7CiAgY29uc3QgTD1yLmx2bHx8MDsoaC5sdltMXT1oLmx2W0xdfHxbMCwwXSk7aC5sdltMXVswXSsrO2gubHZbTF1bMV0rPXQzOwogIGgucnVucy5wdXNoKFtkbnVtKHIuZGF0ZSksci5maW5pc2gsci5kaXN0LHIuc3VyZixMLHIuZ3JkfHwwXSk7aWYoaC5ydW5zLmxlbmd0aD42KXtoLnJ1bnMuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtoLnJ1bnMuc2hpZnQoKX0KICBpZihyLmpvY2tleSl7bGV0IGo9dGhpcy5qLmdldChyLmpvY2tleSk7aWYoIWopdGhpcy5qLnNldChyLmpvY2tleSxqPXtuOjAsdG9wMzowfSk7ai5uKys7ai50b3AzKz10M30KIH07CiAvKiDpqI7miYvvvJrlrozlhajkuIDoh7TihpLvvIjnn63jgYTooajoqJjjgarjgonvvInliY3mlrnkuIDoh7Tjgacx5Lq644Gr57We44KM44KL44Go44GN44Gg44GR5o6h55SoICovCiBTdG9yZS5wcm90b3R5cGUuam9ja2V5PWZ1bmN0aW9uKG5hbWUpewogIGlmKCFuYW1lKXJldHVybiBudWxsOwogIGNvbnN0IGo9dGhpcy5qLmdldChuYW1lKTtpZihqKXJldHVybiBqOwogIGlmKG5hbWUubGVuZ3RoPDJ8fG5hbWUubGVuZ3RoPjQpcmV0dXJuIG51bGw7CiAgaWYoIXRoaXMuX2prfHx0aGlzLl9qa1NpemUhPT10aGlzLmouc2l6ZSl7dGhpcy5fams9Wy4uLnRoaXMuai5rZXlzKCldO3RoaXMuX2prU2l6ZT10aGlzLmouc2l6ZX0KICBjb25zdCBjPXRoaXMuX2prLmZpbHRlcihrPT5rLnN0YXJ0c1dpdGgobmFtZSl8fChuYW1lLmxlbmd0aD49MyYmay5zdGFydHNXaXRoKG5hbWUuc2xpY2UoMCwtMSkpJiZuYW1lLmxlbmd0aDw9ay5sZW5ndGgpKTsKICByZXR1cm4gYy5sZW5ndGg9PT0xP3RoaXMuai5nZXQoY1swXSk6bnVsbDsKIH07CiBjb25zdCBsYXlvZmY9KGxhc3QsdGFyZ2V0KT0+e2lmKCFsYXN0KXJldHVybiAuNTtjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjRlNTsKICByZXR1cm4gYTwyMT8uNzI6YTw2MD8uNjI6YTwxMjA/LjU1OmE8MjQwPy40ODouNDJ9OwogLyogPT09PT0g5a6f57i+44GL44KJ5a2m57+S44GX44Gf44Oi44OH44Or77yI54m55b606YeP4oaSM+edgOWGheeOh++8iSA9PT09PSAqLwogY29uc3QgRk49WyJiaWFzIiwib2Zmc2V0IiwibmxvZyIsIm5vSGlzdCIsImZTIiwiZkMiLCJhdmdGIiwicjNzaGFyZSIsInIzYXZnIiwibGFzdDEiLCJsYXN0QmlnIiwiY29uZERpZmYiLCJmaXJzdFN1cmYiLCJnYXBTaG9ydCIsImdhcExvbmciLCJnYXBWTG9uZyIsImFnZTMiLCJhZ2U0IiwiYWdlNyIsInN0ZXBVcCIsInN0ZXBEb3duIiwid2luUmF0ZSJdOwogY29uc3QgRko9WyJqUmVsIiwiamxvZyIsImpNaXNzIl07CiAvKiDkv4LmlbDjga8gdG9vbHMvZml0X21vZGVsLmpzIOOBp+Wtpue/ku+8iDIwMjDlubTjgJzjga7mmYLns7vliJfjg4fjg7zjgr/vvInjgIJ7fSDjgpLnva7mj5sgKi8KIGNvbnN0IE1PREVMPXsiY29yZSI6WzAuMDUyOTksMC45OTY5NywwLjA0OTUxLC0wLjI0NTQzLC0wLjUyODEyLDAuOTE5NDYsLTAuNTE0NzYsLTAuMzQ3ODYsLTAuNTc5MDQsLTAuNTUxMTgsMC4xNjc3MywxLjExODIsLTAuMzUzMDUsLTAuMTExMjgsLTAuMjI3MjgsLTAuNDAxMjksMC4xMzc3MSwwLjIxNjYyLC0wLjM5NjczLC0wLjM1MzA1LDAuMDA2MTcsLTAuNTk1NjRdLCJmdWxsIjpbMC40MDQzMywxLjM3MDA3LDAuMDYyNTEsLTAuMTIyNzksLTAuNTAyMzIsMC44Mjk3OCwtMC4zOTg5NSwtMC4zMDA3MiwtMC41MTU1OSwtMC41MjUzMiwwLjE1ODMyLDEuMDY2OTUsLTAuMzgzNzcsLTAuMDcyODIsLTAuMjI1NjgsLTAuMzUxLDAuMTUwMjUsMC4yMTI1MywtMC40MTMzNCwtMC4zMjMxOSwwLjAwNzI2LC0wLjkzNzkyLDAuNTM1NTcsMC4wMDM2NSwtMC4yMDYwNV19OwogZnVuY3Rpb24gZmVhdHMocixzdG9yZSxyYWNlLE4sd2l0aEopewogIGNvbnN0IGI9Y2xhbXAoMy9OLC4wOCwuNSksbGI9bG9naXQoYiksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxuPWg/aC5uOjAsTHQ9cmFjZS5sdmx8fDA7CiAgY29uc3QgcFM9KChoP2gudG9wMzowKSszKmIpLyhuKzMpLGZTPWxvZ2l0KHBTKS1sYjsKICAvLyDjgq/jg6njgrnoo5zmraPvvJrkvY7jgYTjgq/jg6njgrnvvIjlnLDmlrnjgpLlkKvjgoDvvInjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY8KICBsZXQgZkM9ZlM7CiAgaWYoaCYmTHQ+MCl7bGV0IEg9MCxNPTA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKGgubHYpKXtjb25zdCBMPU51bWJlcihrKSxbY24sY3RdPWgubHZba107Y29uc3QgZz1MPT09MD8wOihMPDA/LTI6TC1MdCk7CiAgICBIKz1jdCpjbGFtcCgxKy4zKmcsLjQsMS44KTtNKz0oY24tY3QpKmNsYW1wKDEtLjMqZywuNCwxLjgpfQogICBmQz1sb2dpdCgoSCszKmIpLyhIK00rMykpLWxifQogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10scmM9cnVucy5zbGljZSgtMyksbGFzdFI9cnVucy5sZW5ndGg/cnVuc1tydW5zLmxlbmd0aC0xXTpudWxsOwogIGNvbnN0IHIzc2hhcmU9cmMubGVuZ3RoP3JjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgvcmMubGVuZ3RoOjA7CiAgY29uc3QgcjNhdmc9cmMubGVuZ3RoP2NsYW1wKChyYy5yZWR1Y2UoKGEseCk9PmEreFsxXSwwKS9yYy5sZW5ndGgtNikvNiwtMSwyKTowOwogIGNvbnN0IGxhc3QxPWxhc3RSP2NsYW1wKChsYXN0UlsxXS02KS82LC0xLDIpOjAsbGFzdEJpZz1sYXN0UiYmbGFzdFJbMV0+PTEwPzE6MDsKICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7bGV0IGNvbmREaWZmPTAsZmlyc3RTdXJmPTA7CiAgaWYoc2MmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiYoIWRpc3R8fE1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCkpOwogICBpZihjci5sZW5ndGgpY29uZERpZmY9KGNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgrMipwUykvKGNyLmxlbmd0aCsyKS1wUzsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpZmlyc3RTdXJmPTF9CiAgbGV0IGdhcD1udWxsO2lmKGgmJmgubGFzdCYmcmFjZS5kYXRlKWdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICBjb25zdCBhPXIuYWdlfHwwOwogIGNvbnN0IHN0ZXBEPWxhc3RSJiZsYXN0Uls0XT4wJiZMdD4wP2NsYW1wKEx0LWxhc3RSWzRdLC0zLDMpOjA7CiAgY29uc3QgeD1bMSxsYixNYXRoLmxvZygxK24pLG49PT0wPzE6MCxmUyxmQyxuP2NsYW1wKChoLnN1bS9uLTYpLzYsLTEsMik6MCxyM3NoYXJlLHIzYXZnLGxhc3QxLGxhc3RCaWcsY29uZERpZmYsZmlyc3RTdXJmLAogICBnYXAhPW51bGwmJmdhcDwyMT8xOjAsZ2FwIT1udWxsJiZnYXA+MTIwPzE6MCxnYXAhPW51bGwmJmdhcD4yNDA/MTowLGE9PT0zPzE6MCxhPT09ND8xOjAsYT49Nz8xOjAsc3RlcEQ+MD9zdGVwRDowLHN0ZXBEPDA/LXN0ZXBEOjAsCiAgIG4/KChoLndpbisuMypiKS8obisxLjUpLWIpOjBdOwogIGlmKHdpdGhKKXtjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7CiAgIGlmKGomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KTt4LnB1c2gobG9naXQocEopLWxiLE1hdGgubG9nKDErai5uKSwwKX1lbHNlIHgucHVzaCgwLDAsMSl9CiAgcmV0dXJuIHg7CiB9CiBjb25zdCBkb3Q9KHcseCk9PntsZXQgej0wO2ZvcihsZXQgaT0wO2k8eC5sZW5ndGg7aSsrKXorPSh3W2ldfHwwKSp4W2ldO3JldHVybiB6fTsKIGNvbnN0IG1vZGVsWj0oa2luZCx4KT0+ZG90KE1PREVMW2tpbmRdLHgpOwogLyogMemgreOBrue0oOeCuShsb2dpdCnjgajjgr/jgrDjgIJjb21wIOOBp+aIkOWIhuOCkk9OL09GRuOBp+OBjeOCi++8iOaknOiovOeUqO+8iSAqLwogZnVuY3Rpb24gaG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wPXt9KXsKICBjb21wPU9iamVjdC5hc3NpZ24oe30sREVGQVVMVCxjb21wKTtjb25zdCB1c2U9az0+Y29tcFtrXSE9PWZhbHNlJiZjb21wW2tdIT09MDsKICBjb25zdCBiPWNsYW1wKDMvTiwuMSwuNSksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxqPXN0b3JlLmouZ2V0KHIuam9ja2V5KTsKICBjb25zdCBydW5zPWg/aC5ydW5zOltdLG49aD9oLm46MCx0YWdzPVtdO2xldCB6PTAsY29uZj0i5L2OIjsKICBjb25zdCBwSD0oKGg/aC50b3AzOjApKzQqYikvKG4rNCk7eis9bG9naXQocEgpOwogIGlmKG4+PTIpY29uZj1uPj01PyLpq5giOiLkuK0iO2Vsc2UgdGFncy5wdXNoKHt0OiLlsaXmrbTkuI3otrMiLGM6ImcifSk7CiAgaWYobj49Myl7Y29uc3QgdDM9aC50b3AzL24sdz1oLndpbi9uOwogICBpZih0Mz49LjQwJiZ3PD0uMjApdGFncy5wdXNoKHt0OmDlloTmiKblnosgM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgZWxzZSBpZih0Mz49LjQ1KXRhZ3MucHVzaCh7dDpg5a6J5a6aIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGlmKHVzZSgiYXZnIikmJmguc3VtL248PTUpeis9LjEyfQogIGNvbnN0IHJjPXJ1bnMuc2xpY2UoLTMpOwogIGlmKHVzZSgicmVjZW50IikmJnJjLmxlbmd0aD49Mil7Y29uc3QgYzM9cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxhdmc9cmMucmVkdWNlKChzLHgpPT5zK3hbMV0sMCkvcmMubGVuZ3RoOwogICB6Kz0uMjIqKGMzL3JjLmxlbmd0aC1wSCkqMztpZihjMz49Mil0YWdzLnB1c2goe3Q6YOi/kSR7cmMubGVuZ3Rofei1sOOBpyR7YzN95ZueM+edgOWGhWAsYzoiYiJ9KTsKICAgY29uc3QgbGFzdD1ydW5zW3J1bnMubGVuZ3RoLTFdOwogICBpZihsYXN0JiZsYXN0WzFdPj04JiZuPj00JiZoLnRvcDMvbj49LjM1KXt6Kz0uMTU7dGFncy5wdXNoKHt0OmDliY3otbAke2xhc3RbMV19552A44GL44KJ5be744GN6L+U44GX5L2Z5ZywYCxjOiJvIn0pfQogICBpZihhdmc8PTQmJnJjLmxlbmd0aD49Myl6Kz0uMDh9CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwOwogIGlmKHVzZSgiY29uZCIpJiZzYyYmZGlzdCYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJk1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCk7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKXt6LT0uMzU7dGFncy5wdXNoKHt0OmAke3NjPT09MT8i5Yid44Gu6IqdIjoi5Yid44Gu44OA44O844OIIn3vvIjpgY7ljrvotbDjga/liKXppqzloLTvvIlgLGM6Im8ifSl9CiAgIGlmKGNyLmxlbmd0aD49Mil7Y29uc3QgdDM9Y3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxwYz0odDMrMipwSCkvKGNyLmxlbmd0aCsyKTsKICAgIHorPWNsYW1wKDIqKHBjLXBIKSwtLjUsLjUpO2lmKHQzPj0yKXRhZ3MucHVzaCh7dDpg5ZCM5p2h5Lu244GnJHt0M30vJHtjci5sZW5ndGh95ZueM+edgOWGhWAsYzoiYiJ9KX19CiAgaWYodXNlKCJqb2NrZXkiKSYmaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpLGRqPWNsYW1wKC42Kihsb2dpdChwSiktbG9naXQoYikpLC0uNCwuNSk7CiAgIHorPWRqO2lmKGRqPj0uMjUpdGFncy5wdXNoKHt0OmDpqI7miYvlpb3oqr8gM+edgOWGhSR7TWF0aC5yb3VuZChqLnRvcDMvai5uKjEwMCl9JWAsYzoiYiJ9KX0KICBpZih1c2UoImxheW9mZiIpJiZoJiZoLmxhc3Qpe2NvbnN0IGdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICAgeis9LjYqKGxheW9mZihoLmxhc3QscmFjZS5kYXRlKS0uNSk7aWYoZ2FwPj0xODApdGFncy5wdXNoKHt0OmAke2dhcH3ml6XjgbbjgopgLGM6Im8ifSl9CiAgaWYodXNlKCJhZ2UiKSl7Y29uc3QgYT1yLmFnZXx8NTtpZihhPT09Myl6Kz0uMTA7ZWxzZSBpZihhPT09NCl6Kz0uMDU7ZWxzZSBpZihhPj04KXt6LT0uMTU7dGFncy5wdXNoKHt0OmAke2F95q2zYCxjOiJvIn0pfX0KICByZXR1cm57eix0YWdzLGNvbmYsbn07CiB9CiAvKiAyMDIz5bm05Lul6ZmN44Gu5pmC57O75YiX5qSc6Ki844Gn44GuIOe0oOOBruWlvei1sOeOh+KGkueptOOCvuODvOODs+Wun+e4vu+8iOW5s+Wdh3AsIOWun+e4vu+8iSAqLwogY29uc3QgQ0FMPVtbMCwwLjAxXSxbMC4wMjIsMC4wMTddLFswLjA0NiwwLjAyMl0sWzAuMDc1LDAuMDQ2XSxbMC4xMDUsMC4wNjhdLFswLjEzNSwwLjA4Ml0sWzAuMTY1LDAuMDk4XSxbMC4xOTMsMC4xMDNdLFswLjIyNCwwLjEzOF0sWzAuMjU5LDAuMTYxXSxbMC4zMDIsMC4xODddLFswLjM1OCwwLjIxMV0sWzAuNDU0LDAuMjI5XV07CiAvKiDjgqrjg4PjgrrjgarjgZfjg6Ljg7zjg4nvvIjkurrmsJfjga7ku6PnkIbvvJ3pqI7miYvovrzjgb/jga7lrabnv5Ljg6Ljg4fjg6vjga7poIbkvY3jgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvInjga7oo5zmraPooajjgIIyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5L2c5oiQICovCiBjb25zdCBDQUxfUFJPWFk9W1swLDAuMDEzXSxbMC4wMjIsMC4wMjFdLFswLjA0NiwwLjAyOF0sWzAuMDc1LDAuMDU2XSxbMC4xMDUsMC4wODZdLFswLjEzNSwwLjExMV0sWzAuMTY1LDAuMTM0XSxbMC4xOTMsMC4xNDZdLFswLjIyNCwwLjIwMV0sWzAuMjU5LDAuMjE5XSxbMC4zMDEsMC4yNjFdLFswLjM1NSwwLjI5Nl0sWzAuNDM5LDAuMzY3XV07CiBmdW5jdGlvbiBpbnRlcnAoVCxwKXtmb3IobGV0IGk9MTtpPFQubGVuZ3RoO2krKylpZihwPD1UW2ldWzBdKXtjb25zdFthLGJdPVRbaS0xXSxbYyxkXT1UW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBUW1QubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gY2FsaWJGb3IocCxtb2RlKXtyZXR1cm4gbW9kZT09PSJvZGRzIj9pbnRlcnAoQ0FMLHApOmludGVycChDQUxfUFJPWFkscCl9CiBmdW5jdGlvbiBjYWxpYihwKXtmb3IobGV0IGk9MTtpPENBTC5sZW5ndGg7aSsrKWlmKHA8PUNBTFtpXVswXSl7Y29uc3RbYSxiXT1DQUxbaS0xXSxbYyxkXT1DQUxbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIENBTFtDQUwubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gbm9ybWFsaXplVG9wMyh6cyx0b3RhbCl7bGV0IGxvPS04LGhpPTg7CiAgZm9yKGxldCBpPTA7aTw2MDtpKyspe2NvbnN0IGM9KGxvK2hpKS8yLHM9enMucmVkdWNlKChhLHopPT5hK3NpZ21vaWQoeitjKSwwKTtpZihzPnRvdGFsKWhpPWM7ZWxzZSBsbz1jfQogIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6cy5tYXAoej0+c2lnbW9pZCh6K2MpKX0KIC8qIEhhcnZpbGxl5rOV44Gn5Yud546H4oaSM+edgOWGheeOhyAqLwogZnVuY3Rpb24gdG9wM0Zyb21XaW4ocHcpe2NvbnN0IFQ9cHcucmVkdWNlKChhLGIpPT5hK2IsMCkscD1wdy5tYXAoeD0+eC9UKSxuPXAubGVuZ3RoLG91dD1uZXcgQXJyYXkobikuZmlsbCgwKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtsZXQgcz1wW2ldOwogICBmb3IobGV0IGo9MDtqPG47aisrKWlmKGohPT1pKXtzKz1wW2pdKnBbaV0vKDEtcFtqXSk7CiAgICBmb3IobGV0IGs9MDtrPG47aysrKWlmKGshPT1pJiZrIT09ailzKz1wW2pdKnBba10vKDEtcFtqXSkqcFtpXS8oMS1wW2pdLXBba10pfQogICBvdXRbaV09c31yZXR1cm4gb3V0fQogLyog4piF5qC85LiK44GS6KOc5q2j77ya5a2m57+S5riI44G/44Oi44OH44Or44Gv552A6aCG44KS44Gd44Gu44G+44G+6KaL44KL44Gu44Gn44CB5LiL5L2N44Kw44Os44O844OJ44Gn44Gu5aW96LWw44GM6YeN6LOe44O7RzHjgafjgoLlkIzkvqHlgKTjgavjgarjgaPjgabjgYTjgZ/jgIIKICAgIOebtOi/kTPotbDjga7jgYbjgaEgT1Av6YeN6LOeKOOCr+ODqeOCuTUp44Gu6LWw44Gr44Gk44GE44Gm44CB5LuK5Zue44Gu44Kw44Os44O844OJ44Go44Gu5beu44Gg44GR6KOc5q2j44GZ44KL77yI44Kv44Op44K5NOS7peS4i+OBr+ODouODh+ODq+WBtOOBruijnOato+OBjOOBguOCi+OBruOBp+S6jOmHjeaOm+OBkeOBl+OBquOBhO+8ieOAggogICAgICDmoLzkuIrjgZLvvIjkvosgRzPihpJHMe+8ie+8muWlvei1sOOBruS+oeWApOOCkuWJsuOCiuW8leOBj++8iOedgOmghuOBjOiJr+OBhOOBu+OBqeWkp+OBjeOBj++8iQogICAgICDmoLzkuIvjgZLvvIjkvosgRzHihpJHMu+8ie+8muWHoei1sOOBruS+oeWApOOCkuWwkeOBl+aIu+OBmQogICAg5L+C5pWw44Gv5pqr5a6a5YCk44CC4pGgLTLjga7jgIzjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzmr5TovIPjgI3jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44KS5ZCM44GY6YGO5Y6744OH44O844K/44Gn5q+U44G544Gm56K66KqN44GZ44KL44GT44Go44CCICovCiBjb25zdCBHUkFERT17b246dHJ1ZSxLVVA6LjMwLEtETjouMTIsTUlOOi0uOSxNQVg6LjV9OwogZnVuY3Rpb24gZ3JhZGVBZGoocixzdG9yZSxyYWNlLGNvbXApewogIGlmKCFHUkFERS5vbnx8KGNvbXAmJmNvbXAuZ3JhZGU9PT1mYWxzZSkpcmV0dXJuIDA7CiAgY29uc3QgR3Q9cmFjZS5ncmR8fDA7aWYoR3Q8MilyZXR1cm4gMDsKICBjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO2lmKCFofHwhaC5ydW5zLmxlbmd0aClyZXR1cm4gMDsKICBjb25zdCByYz1oLnJ1bnMuc2xpY2UoLTMpLFc9W1sxXSxbLjQsLjZdLFsuMiwuMywuNV1dW3JjLmxlbmd0aC0xXTtsZXQgZD0wOwogIHJjLmZvckVhY2goKHgsayk9Pntjb25zdCBmaW49eFsxXSxMPXhbNF18fDAsR3I9eFs1XXx8MDtpZihMIT09NXx8IShmaW4+MCkpcmV0dXJuOwogICBjb25zdCBncj1NYXRoLm1heChHciwyKTsgICAgICAgICAgLy8gT1Djg7vjgrDjg6zjg7zjg4nkuI3mmI7jga7jgq/jg6njgrk16LWw44GvIEczIOebuOW9k+OBqOOBl+OBpuavlOi8gwogICBpZihHdD5nciYmZmluPD01KWQtPVdba10qR1JBREUuS1VQKihHdC1ncikqKDYtZmluKS82OwogICBlbHNlIGlmKEd0PGdyJiZmaW4+PTQpZCs9V1trXSpHUkFERS5LRE4qKGdyLUd0KSpNYXRoLm1pbigxLChmaW4tMykvOCl9KTsKICByZXR1cm4gY2xhbXAoZCxHUkFERS5NSU4sR1JBREUuTUFYKX0KIGNvbnN0IEdOPVsi5LiN5piOL+S4i+e0miIsIk9Q44O7TCIsIkczIiwiRzIiLCJHMSJdOwogZnVuY3Rpb24gZ3JhZGVUYWdzKHRhZ3MsZHoscmFjZSl7Y29uc3QgdD10YWdzLnNsaWNlKCk7CiAgaWYoZHo8PS0uMil0LnVuc2hpZnQoe3Q6YOagvOS4iuOBkuaIpu+8iCR7R05bcmFjZS5ncmR8fDBdfe+8ie+8muS4i+S9jeOCsOODrOODvOODieOBruWlvei1sOOBr+WJsuW8lSAke2R6LnRvRml4ZWQoMil9YCxjOiJvIn0pOwogIGVsc2UgaWYoZHo+PS4xKXQudW5zaGlmdCh7dDpg6auY44Kw44Os44O844OJ44GL44KJ44Gu5qC85LiL44GSICR7ZHo+PTA/IisiOiIifSR7ZHoudG9GaXhlZCgyKX1gLGM6ImIifSk7CiAgcmV0dXJuIHR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogY29uc3QgTFZOPVsi5LiN5piOIiwi5pyq5Yud5YipIiwiMeWLnSIsIjLli50iLCIz5YudIiwiT1AiXTsKIGZ1bmN0aW9uIGV4dHJhVGFncyh0YWdzLHIsc3RvcmUscmFjZSl7CiAgY29uc3QgdD10YWdzLnNsaWNlKCksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxMdD1yYWNlLmx2bHx8MDsKICBpZihoKXtjb25zdCBsYXN0PWgucnVucy5sZW5ndGg/aC5ydW5zW2gucnVucy5sZW5ndGgtMV06bnVsbDsKICAgaWYobGFzdCYmbGFzdFs0XT4wJiZMdD4wJiZsYXN0WzRdIT09THQpdC51bnNoaWZ0KGxhc3RbNF08THQ/e3Q6YOaYh+e0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6Im8ifTp7dDpg6ZmN57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoiYiJ9KTsKICAgaWYoaC5sdiYmaC5sdlstMV0pdC5wdXNoKHt0OiLlnLDmlrnjgafjga7lh7rotbDjgYLjgorvvIjlibLlvJXoqZXkvqHvvIkiLGM6ImcifSl9CiAgcmV0dXJuIHR9CiAvKiDjg6njg7Pjgq/vvJrnqbTjgr7jg7zjg7Pjga7lubPlnYfjgavlr77jgZnjgovlgI3njofjgacgUy9BL0IvQ++8iOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44Gn77yJICovCiBjb25zdCBBVkdfSE9MRT17b2RkczouMDkxLHByb3h5Oi4xMTV9OwogZnVuY3Rpb24gcmF0aW5nKHBjLG1vZGUsbil7Y29uc3Qgcj1wYy9BVkdfSE9MRVttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9CiAvKiDnmoTkuK3njofph43oppbvvJrlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O777yI44Kq44OD44K644GM5YiG44GL44KL44Go44GN44Gv77yJ5Y2Y5YudMzDlgI3mnKrmuoDjga7lpKfnqbTjgpLpmaTjgY/jgILpgY7ljrvjga7mpJzoqLzjgafjgIHnmoTkuK3njofjgYzkuIrjgYzjgorjgIHlm57lj47njofjgYzmnIDmgqrjga7lpKfnqbTjgpLpgb/jgZHjgonjgozjgZ8gKi8KIGNvbnN0IEZPQ1VTX01BWF9PRERTPTMwOwogY29uc3QgRk9DVVM9eyJvZGRzIjp7Im4iOjM2MjUsImhpdCI6MC4yMzIsImJhc2VIaXQiOjAuMTcyLCJwZXJEYXkiOjEzLjZ9LCJwcm94eSI6eyJuIjo0MDI1LCJoaXQiOjAuMjcyLCJiYXNlSGl0IjowLjIxNywicGVyRGF5IjoxNS4xfX07ICAgLy8gMjAyNOW5tOS7pemZjeOBruaknOiovO+8mueahOS4reeOh++8iGJhc2VIaXQ95b6T5p2l44GuMeS9jeWAmeijnO+8ieODu+mWi+WCrOaXpeOBguOBn+OCiuOBrumgreaVsAogZnVuY3Rpb24gcGlja0ZvY3VzKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49MyYmKHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IlMifHxyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJBIikmJih4Lm9kZD09bnVsbHx8eC5vZGQ8Rk9DVVNfTUFYX09ERFMpKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogLyog56m06aas5YCZ6KOc77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuOAgeWlvei1sOeOh+OBrumrmOOBhOmghuOBqyBrIOmgreOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+WQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeWvvuixoeWkliAqLwogZnVuY3Rpb24gcGljayhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiBmdW5jdGlvbiBhbmFseXplKHJhY2Usc3RvcmUsb2Rkcyxjb21wLHBvcEFycil7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aDsKICBjb25zdCBzYz1SLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXApKTsKICBjb25zdCBkej1SLm1hcChyPT5ncmFkZUFkaihyLHN0b3JlLHJhY2UsY29tcCkpOwogIGNvbnN0IHpjMD1NT0RFTC5jb3JlP1IubWFwKHI9Pm1vZGVsWigiY29yZSIsZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKSk6c2MubWFwKHg9Pngueik7Y29uc3QgemM9emMwLm1hcCgoeixpKT0+eitkeltpXSk7CiAgY29uc3QgcD1ub3JtYWxpemVUb3AzKHpjLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9TU9ERUwuZnVsbD9SLm1hcChyPT5tb2RlbFooImZ1bGwiLGZlYXRzKHIsc3RvcmUscmFjZSxOLHRydWUpKSk6Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7Y29uc3QgcHgyPXB4Lm1hcCgodixpKT0+ditkeltpXSk7cG9wPXB4Mi5tYXAodj0+MStweDIuZmlsdGVyKHk9Pnk+dikubGVuZ3RoKX0KICBjb25zdCByYW5rPXAubWFwKHY9PjErcC5maWx0ZXIoeD0+eD52KS5sZW5ndGgpOwogIGNvbnN0IGN1dD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSk7CiAgcmV0dXJuIFIubWFwKChyLGkpPT4oe2ksbm86ci5udW18fGkrMSxuYW1lOnIubmFtZXx8ci5ob3JzZSxwOnBbaV0scGM6Y2FsaWJGb3IocFtpXSxtb2RlKSxtb2RlLAogICBqbjooc3RvcmUuam9ja2V5KHIuam9ja2V5KXx8e246MH0pLm4scmFuazpyYW5rW2ldLHBvcDpwb3BbaV0sYmFzZTpNYXRoLm1pbiguNSwzL04pLAogICBvZGQ6KG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKT9vZGRzW2ldOm51bGwsCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgZHo6ZHpbaV0sdGFnczpncmFkZVRhZ3MoZXh0cmFUYWdzKHNjW2ldLnRhZ3MscixzdG9yZSxyYWNlKSxkeltpXSxyYWNlKSxjb25mOnNjW2ldLmNvbmYsbjpzY1tpXS5uLGN1dH0pKTsKIH0KCiAvKiA9PT09PSDpiYTmnb/ou7jppqzjg7vms6LkubHluqbvvIjnqbTppqzkuojmg7Pjgajjga/liKXjga7oqIjnrpfjgILkv4LmlbDjga8gdG9vbHMvYXhpc191cHNldF9zdHVkeS5qcyDjgaflrabnv5LjgIEyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5qSc6Ki877yJID09PT09ICovCiBjb25zdCBBWElTPXsid1AiOlswLjA1MTkzLDEuMDE0ODMsMC4wNTE0OCwtMC4yMDY3NiwtMC41MzIxNiwwLjkxNDM3LC0wLjQ4NDY0LC0wLjMyMTE1LC0wLjU2ODAyLC0wLjU1MTM1LDAuMTczNDUsMS4wOTc0LC0wLjI4NDA3LC0wLjEwMzk3LC0wLjIxNjE3LC0wLjM0NjY4LDAuMTU5MTMsMC4yMjE5NiwtMC4zODczMiwtMC4zNDY1OCwwLjAwMzcsLTAuNTY2NDZdLCJ3TyI6WzAuNTQyNTksMC4xNTY2MSwwLjA1NDE0LC0wLjA0MzcxLC0wLjE0NTI0LDAuMTMxNzEsLTAuMTQxNzgsLTAuMTYyNjMsMC4wNTMxNiwtMC4wMjA5NywwLjAwMzksLTAuMjk4NjUsLTAuMzIzMjEsLTAuMDEzNjUsLTAuMDk1MTksLTAuMDc4MTgsMC4wMDA2LC0wLjAyMjkxLC0wLjExMjEzLDAuMDE3ODEsLTAuMDQ3NDUsLTAuMTA4NTIsMC4yNTcyMSwwLjYzMDcxXSwidXBzZXQiOnsidGhyIjoxNSwibW9kZWxzIjp7InByb3h5IjpbMi4yNDU1OSwwLjYzODQxLC0wLjA3MDgsLTAuMDgxNjEsLTAuMDc3NDMsMC4wOTEzNywwLjEzODQ3LDAuMDAyNzksLTAuMzg5MTksLTAuNjQyMTcsLTAuNTUzODEsLTAuMDE4MzcsLTAuNDQzMTcsLTAuNzY4MjUsLTAuNTIzOTMsLTIuNzM1NjEsLTAuMTQ5MDksMC4xMTQ3N10sIm9kZHMiOlstMC43MjM5NiwwLjQyODA4LC0wLjA3NDk5LC0wLjA2MTU0LC0wLjAwNjc1LDAuMDcyNDMsMC4wNzA4NSwtMC4wNDk3NCwtMC4xNTUyOCwtMC4zMjUxNiwtMC40MTgyNiwtMC4zMTM1MSwwLjIwNzU3LC0wLjIzOSwtMC4yNzkwMSwtMS44MjEwOCwtMC4wMDg1MiwwLjA4Mzk5LDAuMTUwMjQsMC4zNTI0MiwtMi4wMzgzOSwyLjg1NjY4LDAuMjI5MjksMC43MjA4NCwtMS45Nzc5N119LCJncmFkZXMiOnsicHJveHkiOnsiY3V0cyI6W1siU1NTIiwwLjU1MDM3XSxbIlNTIiwwLjQ4NTVdLFsiUyIsMC40MDQyNF0sWyJBIiwwLjI5ODhdLFsiQiIsMC4xODk1N10sWyJDIiwwLjAwNjI5XV0sInJhdGVzIjp7IlNTUyI6MC41NzQsIlNTIjowLjUwOSwiUyI6MC40MzMsIkEiOjAuMzQ3LCJCIjowLjI0NCwiQyI6MC4wODl9LCJhdmdTIjp7IlNTUyI6MTcuMiwiU1MiOjE1LjMsIlMiOjE0LjIsIkEiOjEzLjEsIkIiOjExLjgsIkMiOjkuOH19LCJvZGRzIjp7ImN1dHMiOltbIlNTUyIsMC42MDk2OF0sWyJTUyIsMC41MTU5NV0sWyJTIiwwLjQwODU0XSxbIkEiLDAuMjg3NjddLFsiQiIsMC4xNzM1OV0sWyJDIiwwLjAwNzY4XV0sInJhdGVzIjp7IlNTUyI6MC42NzksIlNTIjowLjU5OCwiUyI6MC40NTUsIkEiOjAuMzUyLCJCIjowLjI0NiwiQyI6MC4wNzl9LCJhdmdTIjp7IlNTUyI6MTguNSwiU1MiOjE2LjQsIlMiOjE0LjUsIkEiOjEzLjMsIkIiOjExLjgsIkMiOjkuNn19fX0sImJhbmRzIjp7IumJhOadvyI6eyJsbyI6MC45MiwiaGkiOjEsIm4iOjE2NiwicmF0ZSI6MC45NjM5LCJsbzk1IjowLjkzNTUsIm4yIjo4NywicmF0ZTIiOjAuOTc3LCJwZXJEYXkiOjAuNjJ9LCLmupbpiYTmnb8iOnsibG8iOjAuODgsImhpIjowLjkyLCJuIjoyNzksInJhdGUiOjAuODg1MywibG85NSI6MC44NDc5LCJuMiI6MTM5LCJyYXRlMiI6MC44OTkzLCJwZXJEYXkiOjEuMDR9LCLloIXou7giOnsibG8iOjAuODQsImhpIjowLjg4LCJuIjo0NzQsInJhdGUiOjAuODQxOCwibG85NSI6MC44MDg5LCJuMiI6MjI2LCJyYXRlMiI6MC44NDA3LCJwZXJEYXkiOjEuNzh9fX07CiBmdW5jdGlvbiBheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHhjPVIubWFwKHI9PmZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSk7CiAgY29uc3QgcFA9bm9ybWFsaXplVG9wMyh4Yy5tYXAoeD0+ZG90KEFYSVMud1AseCkpLE1hdGgubWluKDMsTikpOwogIGxldCBwTz1udWxsOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLG0zPXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpOwogICBwTz1ub3JtYWxpemVUb3AzKHhjLm1hcCgoeCxpKT0+ZG90KEFYSVMud08sWy4uLngsTWF0aC5sb2cocHdbaV0pLGxvZ2l0KE1hdGgubWluKC45OCxtM1tpXSkpXSkpLE1hdGgubWluKDMsTikpfQogIHJldHVybntwUCxwTyx4Y319CiAvKiDpiYTmnb/ou7jppqzvvJrjgqrjg4PjgrrjgYzjgYLjgovjg6zjg7zjgrnjgaDjgZHjgILkuojmuKznorrnjofjga7ljLrliIbjgZTjgajjgavjgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS5re744GI44KLICovCiBmdW5jdGlvbiBheGlzUGlja3MocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7aWYoIWFwLnBPKXJldHVybiBudWxsOwogIGNvbnN0IG91dD1bXTthcC5wTy5mb3JFYWNoKChwLGkpPT57CiAgIGZvcihjb25zdCBrIG9mIFsi6YmE5p2/Iiwi5rqW6YmE5p2/Iiwi5aCF6Lu4Il0pe2NvbnN0IGI9QVhJUy5iYW5kc1trXTtpZihwPj1iLmxvJiZwPChrPT09IumJhOadvyI/MS4wMTpiLmhpKSl7b3V0LnB1c2goe2kscCx0aWVyOmsscmF0ZTpiLnJhdGUsbG85NTpiLmxvOTUsbjpiLm59KTticmVha319fSk7CiAgcmV0dXJuIG91dC5zb3J0KChhLGIpPT5iLnAtYS5wKX0KIC8qIOazouS5seW6pu+8mlNTU+OAnEPjgIIz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZEgKi8KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCxwcz1hcC5wUC5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7CiAgY29uc3QgbnM9Ui5tYXAocj0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5uOjB9KSxtb250aD1OdW1iZXIoU3RyaW5nKHJhY2UuZGF0ZSkuc2xpY2UoNSw3KSl8fDAsTD1yYWNlLmx2bHx8MDsKICBjb25zdCBmPVsxLE4vMTYsTD09PTE/MTowLEw9PT0yPzE6MCxMPT09Mz8xOjAsTD09PTQ/MTowLEw9PT01PzE6MCxyYWNlLnN1cmY9PT0xPzE6MCwocmFjZS5kaXN0fHwwKS8yMDAwLAogICBucy5maWx0ZXIobj0+bj09PTApLmxlbmd0aC9OLG5zLmZpbHRlcihuPT5uPDMpLmxlbmd0aC9OLG5zLnJlZHVjZSgoYSxuKT0+YStNYXRoLmxvZygxK24pLDApL04vMywKICAgcHNbMF0scHNbMV0scHNbMl0scHMucmVkdWNlKChhLHApPT5hK3AqcCwwKSxwcy5maWx0ZXIocD0+cD4uNSkubGVuZ3RoLzMsbW9udGg+PTYmJm1vbnRoPD05PzE6MF07CiAgbGV0IG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKS5zb3J0KChhLGIpPT5iLWEpLG9kPW9kZHMuc2xpY2UoKS5zb3J0KChhLGIpPT5hLWIpOwogICBjb25zdCBlbnQ9LXB3LnJlZHVjZSgoYSxwKT0+YStwKk1hdGgubG9nKHApLDApL01hdGgubG9nKE4pOwogICBmLnB1c2gocHdbMF0scHdbMV0scHdbMF0rcHdbMV0rcHdbMl0sZW50LE1hdGgubG9nKG9kWzBdKSxNYXRoLmxvZyhvZFsxXSksb2QuZmlsdGVyKG89Pm88MTApLmxlbmd0aC9OKTttb2RlPSJvZGRzIn0KICBjb25zdCBwPXNpZ21vaWQoZG90KEFYSVMudXBzZXQubW9kZWxzW21vZGVdLGYpKSxHPUFYSVMudXBzZXQuZ3JhZGVzW21vZGVdOwogIGxldCBncmFkZT0iQyI7Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cyl7aWYocD49Yyl7Z3JhZGU9ZzticmVha319CiAgcmV0dXJue2dyYWRlLHAsbW9kZSxyYXRlOkcucmF0ZXNbZ3JhZGVdLGF2Z1M6Ry5hdmdTW2dyYWRlXX19CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIixPT1M9b3B0cy5vb3N8fCIiLFBST1hZPSEhb3B0cy5wcm94eSxNSU5HPU51bWJlcihvcHRzLm1pbkdyZCl8fDAsX2dPbj1HUkFERS5vbjtHUkFERS5vbj0hb3B0cy5ncmFkZU9mZjsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSIsImF4aXMiLCJmb2N1cyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUJiYoIU1JTkd8fCgocmMucm93c1swXSYmcmMucm93c1swXS5ncmQpfHwwKT49TUlORykpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAsZ3JkOlJbMF0uZ3JkfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJmb2N1cyIscGlja0ZvY3VzKHJlcywxKSk7CiAgICAgIGJ1eSgidG9wMSIscGljayhyZXMsMSkpO2J1eSgidG9wMiIscGljayhyZXMsMikpO2J1eSgidG9wMyIscGljayhyZXMsMykpO2J1eSgiYWxsSG9sZSIsaG9sZSk7CiAgICAgIGlmKCFQUk9YWSlidXkoInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICAgaWYoIVBST1hZJiZoYXNPZGRzKXtjb25zdCBhcD1heGlzUHJvYnMocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTtpZihhcC5wTylidXkoImF4aXMiLGFwLnBPLm1hcCgocCxpKT0+KHtpLHB9KSkuZmlsdGVyKHg9PngucD49QVhJUy5iYW5kc1si6YmE5p2/Il0ubG8pKX0KICAgICAgY29uc3QgdD1waWNrKHJlcywxKVswXTsKICAgICAgaWYodCl7Y29uc3QgeT15ZW4uZ2V0KFJbdC5pXS5udW0pfHwwLHI9dC5wYy9BVixOPVIubGVuZ3RoOwogICAgICAgY29uc3QgcmFuaz0ocj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiKTsKICAgICAgIGFkZFNlZygi44Op44Oz44KvIisodC5uPDImJihyYW5rPT09IlMifHxyYW5rPT09IkEiKT8iQiI6cmFuaykscHIseSk7CiAgICAgICBhZGRTZWcoTjw9MTA/IumgreaVsCDjgJwxMCI6Tjw9MTQ/IumgreaVsCAxMeOAnDE0Ijoi6aCt5pWwIDE144CcIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLnN1cmY9PT0xPyLoip0iOnJhY2Uuc3VyZj09PTI/IuODgOODvOODiCI6IuOBneOBruS7liIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5sdmw+MD8i44Kv44Op44K5ICIrTFZOW3JhY2UubHZsXToi44Kv44Op44K5IOS4jeaYjiIscHIseSk7CiAgICAgICBhZGRTZWcodC5uPj01PyLlrp/nuL4gNei1sOS7peS4iiI6dC5uPj0zPyLlrp/nuL4gM+OAnDTotbAiOiLlrp/nuL4gM+i1sOacqua6gCIscHIseSk7CiAgICAgICBpZighUFJPWFkmJnQub2RkKXtjb25zdCBvPXQub2RkO2FkZFNlZyhvPDg/IuWNmOWLnSDjgJw45YCNIjpvPDE1PyLljZjli50gOOOAnDE15YCNIjpvPDMwPyLljZjli50gMTXjgJwzMOWAjSI6bzw2MD8i5Y2Y5YudIDMw44CcNjDlgI0iOiLljZjli50gNjDlgI3jgJwiLHByLHkpOwogICAgICAgIGlmKGhhc09kZHMpe2NvbnN0IHVnPXVwc2V0R3JhZGUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTthZGRTZWcoIuazouS5seW6piAiK3VnLmdyYWRlLHByLHkpfX19CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIGNvbnN0IHNlZ3M9e307CiAgZm9yKGNvbnN0IFtrLGddIG9mIE9iamVjdC5lbnRyaWVzKFNFRykpe3NlZ3Nba109e307Zm9yKGNvbnN0IHAgb2YgWyJhbGwiLCJBIiwiQiJdKXtjb25zdCB4PWdbcF07CiAgIGlmKCF4Lm4pe3NlZ3Nba11bcF09e2JldHM6MH07Y29udGludWV9Y29uc3QgbWVhbj14LnIveC5uLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHgucS94Lm4tbWVhbiptZWFuKSk7CiAgIHNlZ3Nba11bcF09e2JldHM6eC5uLGhpdFJhdGU6eC5oL3gubixyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHgubikvMTAwfX19CiAgR1JBREUub249X2dPbjtyZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57R1JBREUsZ3JhZGVUaWVyLGdyYWRlQWRqLEZPQ1VTLHJhdGluZyxwaWNrRm9jdXMsQVhJUyxheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKLyogPT09PT0g44Ki44OX44Oq5pys5L2TID09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiLENVUj1udWxsLExBU1RSRVM9bnVsbDsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9OwoKLyogLS0tIEluZGV4ZWREQu+8iOOBk+OBruODhOODvOODq+WwgueUqO+8iSAtLS0gKi8KZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspe2NvbnN0IGY9ZnNbaV07CiAgaWYoZi5saXZlKXtmb3IoY29uc3QgeCBvZiBmLnJvd3N8fFtdKWNiKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpY2IoVUUudG9Sb3cobykpOwogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9Cn0KLyog44Os44O844K5SUTjgYvjgonplovlgqzloLTjg7tS55Wq5Y+377yIMTLmoYHjga5KUkHlvaLlvI/vvI/ml6Xku5gt6ZaL5YKs5aC0LVLlvaLlvI/jga7kuKHlr77lv5zvvIkgKi8KZnVuY3Rpb24gdmVudWVPZklkKGlkKXtyZXR1cm4gL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVszXXx8IiJ9CmZ1bmN0aW9uIHJhY2VOb09mSWQoaWQpe3JldHVybiBOdW1iZXIoL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSgxMCwxMik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzRdfHwwKX0KCi8qIC0tLSDlj5bjgorovrzjgb8gLS0tICovCmFzeW5jIGZ1bmN0aW9uIGltcG9ydEZpbGUoZmlsZSl7CiBidXN5KHRydWUsIuODleOCoeOCpOODq+OCkuiqreOBv+i+vOOBv+S4reKAplxu5aSn44GN44GE44OV44Kh44Kk44Or44Gv5pWw5Y2B56eS44GL44GL44KK44G+44GZ44CCIik7YXdhaXQgc2xlZXAoMzApOwogdHJ5ewogIGNvbnN0IHRleHQ9YXdhaXQgZmlsZS50ZXh0KCk7bGV0IGl0ZW1zOwogIGlmKC9cLmNzdiQvaS50ZXN0KGZpbGUubmFtZSkpe2l0ZW1zPVt7dHlwZToicmFjZS1yZXN1bHRzIix5ZWFyOjAscGxhY2U6ZmlsZS5uYW1lLGNzdjp0ZXh0fV19CiAgZWxzZXtjb25zdCBqPUpTT04ucGFyc2UodGV4dCk7aXRlbXM9QXJyYXkuaXNBcnJheShqKT9qOihqLmZpbGVzfHxbal0pfQogIGl0ZW1zPWl0ZW1zLmZpbHRlcih4PT54JiZ0eXBlb2YgeC5jc3Y9PT0ic3RyaW5nIik7CiAgaWYoIWl0ZW1zLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoImNzduOCkuWQq+OCgOODh+ODvOOCv+OBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OAguODkOODg+OCr+OCouODg+ODl0pTT07jgYvjgIFDU1bjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgIIiKTsKICBhd2FpdCBpZGJDbGVhcigpO2xldCBuPTA7CiAgZm9yKGxldCBpPTA7aTxpdGVtcy5sZW5ndGg7aSsrKXtjb25zdCBpdD1pdGVtc1tpXTthd2FpdCBpZGJQdXQoYCR7aXQueWVhcnx8MH06JHtpdC5wbGFjZX06JHtpfWAse3llYXI6aXQueWVhcixwbGFjZTppdC5wbGFjZSxwbGFjZU5hbWU6aXQucGxhY2VOYW1lLGNzdjppdC5jc3Z9KTsKICAgbis9TWF0aC5tYXgoMCxpdC5jc3Yuc3BsaXQoIlxuIikubGVuZ3RoLTEpOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9YOS/neWtmOS4reKApiAke2krMX0vJHtpdGVtcy5sZW5ndGh9YDthd2FpdCBzbGVlcCgwKX0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W44KK6L6844G/5a6M5LqG77yaJHtpdGVtcy5sZW5ndGh944OV44Kh44Kk44Or77yP57SEJHtuLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiAgYmtTY2hlZHVsZSgpOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7lj5bjgorovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXtidXN5KGZhbHNlKX0KfQphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7jg4fjg7zjgr/mnKrlj5blvpfjgafjgZnjgILkuIrjga7jgIzpgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpfjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl++8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9Ci8qIFdvcmtlcuOBriAvcmVzdWx0cyDjga7ooYwg4oaSIOODhOODvOODq+WGhemDqOOBruihjCAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IF9yPWxpdmVSb3cwKHgpO19yLmdyZD1VRS5ncmFkZVRpZXIoKHguY2xzfHwiIikrIiAiKyh4LmdyYWRlfHwiIikseC5wcml6ZSxmYWxzZSk7cmV0dXJuIF9yfQpmdW5jdGlvbiBsaXZlUm93MCh4KXtjb25zdCBmPXBhcnNlRmxvYXQoU3RyaW5nKHguZmluaXNoPz8iIikucmVwbGFjZSgvW15cZC5dL2csIiIpKTsKIHJldHVybntyYWNlSWQ6U3RyaW5nKHgucmFjZUlkfHwiIiksZGF0ZTpVRS5wYXJzZURhdGUoeC5kYXRlKSxuYW1lOlN0cmluZyh4LmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOlVFLm5uKHguaG9yc2UpLGpvY2tleTpVRS5qbm4oeC5qb2NrZXkpLAogIGZpbmlzaDpOdW1iZXIuaXNGaW5pdGUoZikmJmY+MD9mOm51bGwsZGlzdDpOdW1iZXIoeC5kaXN0YW5jZSl8fDAsc3VyZjpVRS5zdXJmQ29kZSh4LnN1cmZhY2UpLGFnZTpOdW1iZXIoeC5hZ2UpfHxudWxsLG51bTpOdW1iZXIoeC5udW1iZXIpfHxudWxsLHBvcDpOdW1iZXIoeC5wb3ApPjA/TnVtYmVyKHgucG9wKTpudWxsLG9kZHM6bnVsbCxqbmFtZTpTdHJpbmcoeC5qb2NrZXl8fCIiKS50cmltKCksCiAgbHZsOih4LnZlbnVlQ29kZSYmIS9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyh4LnZlbnVlQ29kZSkpKT8tMTooVUUubGV2ZWxPZkxhYmVsKHguY2xzKXx8VUUubGV2ZWxPZlByaXplKHgucHJpemUpKX19Ci8qIOWvvuixoeaXpeOCiOOCiuWJjeOBruWxpeattOOBoOOBkeOBp+OCueODiOOCouOCkuS9nOOCiyAqLwphc3luYyBmdW5jdGlvbiBidWlsZFN0b3JlKHRhcmdldCl7CiBpZihTVE9SRSYmU1RPUkVfS0VZPT09dGFyZ2V0KXJldHVybiBTVE9SRTsKIGNvbnN0IGZzPWF3YWl0IGlkYkFsbCgpO2lmKCFmcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLpgY7ljrvjg4fjg7zjgr/jgYzmnKrnmbvpjLLjgafjgZnjgIIiKTsKIGNvbnN0IHN0PW5ldyBVRS5TdG9yZSgpO2xldCByb3dzPTAsdXNlZD0wOwogZm9yKGxldCBpPTA7aTxmcy5sZW5ndGg7aSsrKXsKICBidXN5KHRydWUsYOmBjuWOu+ODh+ODvOOCv+OCkumbhuioiOS4reKApiAke2krMX0vJHtmcy5sZW5ndGh9XG7vvIgke3RhcmdldH3jgojjgorliY3jga7jgb/kvb/nlKjvvIlgKTsKICBpZihmc1tpXS5saXZlKXtmb3IoY29uc3QgeCBvZiBmc1tpXS5yb3dzfHxbXSl7Y29uc3Qgcj1saXZlUm93KHgpO3Jvd3MrKztpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldHx8IXIuaG9yc2UpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfX0KICBlbHNlIGZvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZnNbaV0uY3N2KSl7Y29uc3Qgcj1VRS50b1JvdyhvKTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXQpY29udGludWU7c3QuYWRkKHIpO3VzZWQrKztpZihyLmRhdGU+KHN0Lmxhc3REYXRlfHwiIikpc3QubGFzdERhdGU9ci5kYXRlfQogIGF3YWl0IHNsZWVwKDApOwogfQogYnVzeShmYWxzZSk7U1RPUkU9c3Q7U1RPUkVfS0VZPXRhcmdldDtTVE9SRS5jb3VudD11c2VkO3JldHVybiBzdDsKfQoKLyogLS0tIOODrOODvOOCuemBuOaKniAtLS0gKi8KZnVuY3Rpb24gc2hvd1BhbmUoayl7Zm9yKGNvbnN0IHAgb2ZbIldvcmtlciIsIk1hbnVhbCIsIlBhc3QiXSkkKCJwYW5lIitwKS5zdHlsZS5kaXNwbGF5PXA9PT1rPyJibG9jayI6Im5vbmUifQokKCJ0YWJXb3JrZXIiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiV29ya2VyIik7JCgidGFiTWFudWFsIikub25jbGljaz0oKT0+c2hvd1BhbmUoIk1hbnVhbCIpOyQoInRhYlBhc3QiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiUGFzdCIpOwpmdW5jdGlvbiBzZXRSYWNlKHJhY2UsbGFiZWwpe2lmKHJhY2Uua2V5JiYhcmFjZS5vZGRzMClyYWNlLm9kZHMwPW9kZHNGb3IocmFjZSk7Q1VSPXJhY2U7TEFTVFJFUz1udWxsOyQoInJhY2VsYWJlbCIpLnRleHRDb250ZW50PWxhYmVsOyQoInJ1biIpLmRpc2FibGVkPWZhbHNlOyQoIm91dCIpLnRleHRDb250ZW50PSLjgIzop6PmnpDjgZnjgovjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgIIifQoKLyogV29ya2VyICovCmxldCBXUkFDRVM9W107CmxldCBXRElBRz1bXTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hDYXJkcyhiYXNlLGQsdmVudWVDb2RlKXsKIGNvbnN0IHE9dmVudWVDb2RlP2AmdmVudWU9JHtlbmNvZGVVUklDb21wb25lbnQodmVudWVDb2RlKX1gOiIiO2xldCBlcnI9IiI7CiBmb3IobGV0IHQ9MDt0PDM7dCsrKXsKICB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9JHtxfWApOwogICBpZighci5vayl7bGV0IG09IiI7dHJ5e209KGF3YWl0IHIuanNvbigpKS5lcnJvcnx8IiJ9Y2F0Y2h7fXRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfSAke219YC50cmltKCkpfQogICBjb25zdCB4PWF3YWl0IHIuanNvbigpO3JldHVybntyYWNlczpBcnJheS5pc0FycmF5KHgpP3g6KHgucmFjZXN8fFtdKSx3YXJuaW5nOngud2FybmluZ3x8IiJ9fQogIGNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7YXdhaXQgc2xlZXAoMTIwMCoodCsxKSl9CiB9CiB0aHJvdyBuZXcgRXJyb3IoZXJyfHwi5Y+W5b6X44Gn44GN44G+44Gb44KTIik7Cn0KZnVuY3Rpb24gcmVuZGVyVmVudWVCdXR0b25zKGQpewogY29uc3QgbmFtZXM9Wy4uLm5ldyBTZXQoV1JBQ0VTLm1hcChyPT5yLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpKV07CiBsZXQgaD1uYW1lcy5tYXAoKHYsaSk9PmA8YnV0dG9uIGRhdGEtdj0iJHtpfSIgY2xhc3M9InN1YiI+JHtlc2Modil977yIJHtXUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikubGVuZ3RofVLvvIk8L2J1dHRvbj5gKS5qb2luKCIiKTsKIGgrPVdESUFHLmZpbHRlcih4PT54LmVycnx8eC5lbXB0eXx8eC5wYXJ0aWFsKS5tYXAoeD0+YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPiR7ZXNjKHgubmFtZSl977yaJHt4LmVycj8i5Y+W5b6X5aSx5pWX77yIIitlc2MoeC5lcnIpLnNsaWNlKDAsNDAwKSsi77yJIjp4LnBhcnRpYWw/YCR7eC5jb3VudH1S44GX44GL5Y+W5b6X44Gn44GN44Gm44GE44G+44Gb44KT77yI6YCa5bi444GvMTDjgJwxMlLvvIlgOmDlh7rotbDppqzjgpLoqq3jgoHjgarjgYvjgaPjgZ/jg6zjg7zjgrkgJHt4LmVtcHR5fVLvvIjpmaTlpJbvvIlgfSA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtcmV0cnk9IiR7ZXNjKHguY29kZXx8IiIpfSI+5YaN5Y+W5b6XPC9idXR0b24+PC9kaXY+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLmlubmVySFRNTD1oOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS12XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5saXN0VmVudWUobmFtZXNbYi5kYXRhc2V0LnZdLGQpKTsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtcmV0cnldIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PmxvYWRWZW51ZShkLHt2ZW51ZUNvZGU6Yi5kYXRhc2V0LnJldHJ5LHZlbnVlTmFtZToiIn0sdHJ1ZSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGxvYWRWZW51ZShkLHYscmVyZW5kZXIpewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBwcmV2PVdESUFHLmZpbmQoeD0+U3RyaW5nKHguY29kZSk9PT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdSQUNFUz1XUkFDRVMuZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIFdESUFHPVdESUFHLmZpbHRlcih4PT5TdHJpbmcoeC5jb2RlKSE9PVN0cmluZyh2LnZlbnVlQ29kZSkpOwogY29uc3QgbmFtZT12LnZlbnVlTmFtZXx8KHByZXYmJnByZXYubmFtZSl8fHYudmVudWVDb2RlOwogdHJ5e2NvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsdi52ZW51ZUNvZGUpOwogIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCksZW1wdHk9cmFjZXMubGVuZ3RoLW9rLmxlbmd0aDsKICBXUkFDRVMucHVzaCguLi5vayk7CiAgY29uc3QgZXJycz1yYWNlcy5maWx0ZXIoYT0+YS5lcnJvcikubWFwKGE9PmEuZXJyb3IpOwogIFdESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDpvay5sZW5ndGgsZW1wdHkscGFydGlhbDpvay5sZW5ndGg+MCYmb2subGVuZ3RoPDEwLGVycjohcmFjZXMubGVuZ3RoPyLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiOighb2subGVuZ3RoJiZlcnJzLmxlbmd0aD9lcnJzWzBdOiIiKX0pOwogfWNhdGNoKGUpe1dESUFHLnB1c2goe2NvZGU6di52ZW51ZUNvZGUsbmFtZSxjb3VudDowLGVtcHR5OjAsZXJyOmUubWVzc2FnZX0pfQogaWYocmVyZW5kZXIpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l++8iCR7V0RJQUcubWFwKHg9PmAke3gubmFtZX0ke3guY291bnR9UmApLmpvaW4oIu+8jyIpfe+8iWA7JCgid2FsbCIpLmRpc2FibGVkPSFXUkFDRVMubGVuZ3RoOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDtyZW5kZXJWZW51ZUJ1dHRvbnMoZCl9Cn0KJCgid2dldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJ3ZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybiBhbGVydCgi5pel5LuY44KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5YKs5aC044KS56K66KqN5Lit4oCmIjskKCJ3bGlzdCIpLmlubmVySFRNTD0iIjskKCJhbGxvdXQiKS5pbm5lckhUTUw9IiI7V1JBQ0VTPVtdO1dESUFHPVtdO1dEQVRFPWQ7JCgid2FsbCIpLmRpc2FibGVkPXRydWU7JCgib2Rkc0dldCIpLmRpc2FibGVkPXRydWU7T0REUz17fTsKIGxldCB2ZW51ZXM9bnVsbDsKIGxldCBsaXN0RGlhZz0iIixhdmFpbERhdGVzPVtdO0FWQUlMPVtdOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSZsaXN0PTFgKTtpZihyLm9rKXtjb25zdCB4PWF3YWl0IHIuanNvbigpO3ZlbnVlcz14LnZlbnVlc3x8W107YXZhaWxEYXRlcz14LmF2YWlsYWJsZURhdGVzfHxbXTtBVkFJTD1hdmFpbERhdGVzO2lmKCF2ZW51ZXMubGVuZ3RoKWxpc3REaWFnPUpTT04uc3RyaW5naWZ5KHguZGlhZ25vc3RpY3N8fFtdKS5zbGljZSgwLDUwMCl9fWNhdGNoKGUpe30KIHRyeXsKICBpZih2ZW51ZXMmJiF2ZW51ZXMubGVuZ3RoJiZhdmFpbERhdGVzLmxlbmd0aCYmIWF2YWlsRGF0ZXMuaW5jbHVkZXMoZCkpewogICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44GvSlJB44Gu6ZaL5YKs5pel44Gn44Gv44GC44KK44G+44Gb44KT44CCXG7lhazplovkuK3jga7plovlgqzml6XvvJoke2F2YWlsRGF0ZXMuam9pbigi44CBIil9YDsKICAgJCgid2xpc3QiKS5pbm5lckhUTUw9YXZhaWxEYXRlcy5tYXAoeD0+YDxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1kPSIke3h9Ij4ke3h9PC9idXR0b24+YCkuam9pbigiIik7CiAgICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtZF0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+eyQoIndkYXRlIikudmFsdWU9Yi5kYXRhc2V0LmQ7JCgid2dldCIpLmNsaWNrKCl9KTsKICAgcmV0dXJuOwogIH0KICBpZih2ZW51ZXMmJnZlbnVlcy5sZW5ndGgpewogICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1g5Y+W5b6X5Lit4oCmICR7di52ZW51ZU5hbWV977yIJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+a4iOOBv++8iWA7YXdhaXQgbG9hZFZlbnVlKGQsdixmYWxzZSl9CiAgfWVsc2V7CiAgIC8vIOaXp1dvcmtlcuetieOBp+mWi+WCrOWgtOS4gOimp+OBjOS9v+OBiOOBquOBhOWgtOWQiO+8mjHml6XliIbjgpLkuIDmi6zlj5blvpcKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLkuIDmi6zlj5blvpfkuK3igKYiOwogICBjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLCIiKTsKICAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKTtXUkFDRVM9b2s7CiAgIGlmKHJhY2VzLmxlbmd0aD5vay5sZW5ndGgpV0RJQUcucHVzaCh7Y29kZToiIixuYW1lOiLkuIDpg6giLGNvdW50Om9rLmxlbmd0aCxlbXB0eTpyYWNlcy5sZW5ndGgtb2subGVuZ3RoLGVycjoiIn0pOwogIH0KICBpZighV1JBQ0VTLmxlbmd0aCl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlh7rotbDppqzjgaTjgY3jga7jg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpPjgafjgZfjgZ/jgIJcbiIrV0RJQUcubWFwKHg9PmAke3gubmFtZX3vvJoke3guZXJyfHwi5Ye66LWw6aas44Gq44GXIn1gKS5qb2luKCJcbiIpKyhsaXN0RGlhZz8iXG7oqLrmlq3vvJoiK2xpc3REaWFnOiIiKTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7cmV0dXJufQogICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l2ArKFdESUFHLmxlbmd0aD9g77yIJHtXRElBRy5tYXAoeD0+YCR7eC5uYW1lfSR7eC5jb3VudH1SYCkuam9pbigi77yPIil977yJYDoiIik7CiAgJCgid2FsbCIpLmRpc2FibGVkPWZhbHNlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD1mYWxzZTtyZW5kZXJWZW51ZUJ1dHRvbnMoZCk7CiB9Y2F0Y2goZSl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLlj5blvpfjgqjjg6njg7zvvJoiK2UubWVzc2FnZSsiXG7vvIhXb3JrZXLjgYzmnKrlhazplovvvI9DT1JT77yP5pel5LuY44Gr6ZaL5YKs44Gq44GX44CB44Gu5Y+v6IO95oCn77yJIn0KfTsKZnVuY3Rpb24gbGlzdFZlbnVlKHYsZCl7CiBjb25zdCBycz1XUkFDRVMuZmlsdGVyKHI9PihyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiIpPT09dikuc29ydCgoYSxiKT0+KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9cnMubWFwKChyLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7ci5yYWNlTnVtYmVyfHxrKzF9UiAke2VzYyhyLnJhY2VOYW1lfHwiIil9PC9idXR0b24+YCkuam9pbigiIik7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57Y29uc3Qgcj1yc1tiLmRhdGFzZXQua107CiAgY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCk7CiAgc2V0UmFjZShyYWNlLGAke2R9ICR7dn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlfHwiPyJ9JHtyLmRpc3RhbmNlfHwiPyJ9beODuyR7aHMubGVuZ3Rofemgre+8iWApOwogfSk7Cn0KCmZ1bmN0aW9uIG1rUmFjZShyLGQpewogY29uc3QgaHM9KHIuaG9yc2VzfHxyLnJ1bm5lcnMpOwogcmV0dXJue2RhdGU6ZCxrZXk6YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWAsc3VyZjpVRS5zdXJmQ29kZShyLnN1cmZhY2UpLGRpc3Q6TnVtYmVyKHIuZGlzdGFuY2UpfHwwLGx2bDpVRS5sZXZlbE9mTGFiZWwoci5jbGFzc05hbWUpfHxVRS5sZXZlbE9mTGFiZWwoci5yYWNlTmFtZSl8fChVRS5ncmFkZVRpZXIoKHIuY2xhc3NOYW1lfHwiIikrIiAiKyhyLmdyYWRlfHwiIikrIiAiKyhyLnJhY2VOYW1lfHwiIiksci5wcml6ZSx0cnVlKT49MT81OjApLGdyZDpVRS5ncmFkZVRpZXIoKHIuY2xhc3NOYW1lfHwiIikrIiAiKyhyLmdyYWRlfHwiIikrIiAiKyhyLnJhY2VOYW1lfHwiIiksci5wcml6ZSx0cnVlKSwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7cmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSxhZ2U6aC5hZ2V8fG51bGwsbnVtOmguaG9yc2VOdW1iZXJ8fGgubnVtYmVyfHxpKzF9fSkuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KbGV0IFdEQVRFPSIiLEFWQUlMPVtdOwovKiDlhajjg6zjg7zjgrnkuIDmi6zvvJrlkITjg6zjg7zjgrnjga7nqbTppqzlgJnoo5zvvIjkuIrkvY0y6aCt77yJ44KS5LiA6Kan44Gr44GZ44KLICovCmFzeW5jIGZ1bmN0aW9uIHJ1bkFsbChib3hJZD0iYWxsb3V0Iil7CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiBjb25zdCBib3g9JChib3hJZCk7CiBjb25zdCBkPVdEQVRFO2xldCB0ZXh0PWAke2R9IOeptOmmrOWlvei1sO+8iOS4iuS9jeWAmeijnO+8iVxuYDsKIHRyeXsKICBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKGQpOwogIGNvbnN0IHJzPVsuLi5XUkFDRVNdLnNvcnQoKGEsYik9PlN0cmluZyhhLnZlbnVlTmFtZXx8YS52ZW51ZXx8IiIpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVOYW1lfHxiLnZlbnVlfHwiIiksImphIil8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBjb25zdCBnYXA9c3RvcmUubGFzdERhdGU/TWF0aC5yb3VuZCgobmV3IERhdGUoZCktbmV3IERhdGUoc3RvcmUubGFzdERhdGUpKS84NjRlNSk6bnVsbDsKICBsZXQgaD0oZm9jdXNPbigpP2A8ZGl2IGNsYXNzPSJzbWFsbCI+4peO55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQSR7T2JqZWN0LmtleXMoT0REUykubGVuZ3RoPyLjg7vljZjli50zMOWAjeacqua6gCI6IiJ944Gu56m06aas44Gg44GR44KS6KGo56S644CC6YGO5Y6744Gu55qE5Lit546H44Gv57SEJHtNYXRoLnJvdW5kKFVFLkZPQ1VTW09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aD8ib2RkcyI6InByb3h5Il0uaGl0KjEwMDApLzEwfSXvvIjlvpPmnaXjga4x5L2N5YCZ6KOc44Gv57SEJHtNYXRoLnJvdW5kKFVFLkZPQ1VTW09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aD8ib2RkcyI6InByb3h5Il0uYmFzZUhpdCoxMDAwKS8xMH0l77yJ44CCPC9kaXY+YDoiIikrYDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj43mmKDvvJoke09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aH3jg6zjg7zjgrnliIbvvIjmnKrlj5blvpfjga7jg6zjg7zjgrnjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIk8L2Rpdj48ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S44OH44O844K/5pyA57WC5pel77yaJHtlc2Moc3RvcmUubGFzdERhdGV8fCLkuI3mmI4iKX3vvI/nqbTjgr7jg7zjg7Pjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfvvIjpqI7miYvmiJDnuL7ovrzjgb/vvInjgafliKTlrprjgILlrp/pmpvjga7kurrmsJfjgajjga/nlbDjgarjgorjgb7jgZk8L2Rpdj5gLHRIPTAsdE49MCxqSD0wLGpNaXNzPVtdLG5vQ291cnNlPVtdOwogIGlmKGdhcCE9bnVsbCYmZ2FwPjE0KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIj7imqAg5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC55u06L+R44Gu5aW96LWw44O75Yeh6LWw44GM5Y+N5pig44GV44KM44Gq44GE54K544Gr5rOo5oSP44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKICBoKz0iPGJyPiI7CiAgcnMuZm9yRWFjaCgocixrKT0+ewogICBjb25zdCByYWNlPW1rUmFjZShyLGQpLG49cmFjZS5ydW5uZXJzLmxlbmd0aCx2PXIudmVudWVOYW1lfHxyLnZlbnVlfHwiIjsKICAgY29uc3QgbGFiZWw9YCR7dn0ke3IucmFjZU51bWJlcnx8aysxfVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZSYmci5kaXN0YW5jZT9yLnN1cmZhY2Urci5kaXN0YW5jZSsibSI6IuOCs+ODvOOCueS4jeaYjiJ944O7JHtufemgre+8iWA7CiAgIGlmKCEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSlub0NvdXJzZS5wdXNoKHtsYWJlbDpgJHt2fSR7ci5yYWNlTnVtYmVyfHxrKzF9UmAscmF3OnIuY291cnNlUmF3fHwiIn0pOwogICB0ZXh0Kz1gXG7ilqAke2xhYmVsfVxuYDsKICAgbGV0IGJvZHk9IiI7CiAgIGlmKG48Nilib2R5PSc8c3BhbiBjbGFzcz0ic21hbGwiPjbpoK3mnKrmuoDjga7jgZ/jgoHlr77osaHlpJY8L3NwYW4+JzsKICAgZWxzZXsKICAgIGNvbnN0IG9kPW9kZHNGb3IocmFjZSkscmVzPVVFLmFuYWx5emUocmFjZSxzdG9yZSxvZCksYz0oZm9jdXNPbigpP1VFLnBpY2tGb2N1cyhyZXMsMik6VUUucGljayhyZXMsMikpO3tjb25zdCBtPW1hdGNoSW5mbyhyZXMpO3RIKz1tLmg7dE4rPW0ubjtqSCs9bS5qO2pNaXNzLnB1c2goLi4ubS5taXNzKX0KICAgIGJvZHk9Yy5tYXAoeD0+e2NvbnN0IHRnPXgudGFncy5zbGljZSgwLDIpLm1hcCh0PT50LnQpLmpvaW4oIu+8jyIpOwogICAgIHRleHQrPWAgICR7eC5ub33nlaogJHt4Lm5hbWV9ICR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9ICR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSUgJHt0Z31cbmA7CiAgICAgdGV4dCs9YCAgICAke3JlY0xpbmUoeCl977yPJHt4LmpuYW1lfHwi6aiO5omL5LiN5piOIn0ke3gub2RkP2DvvI/ljZjli50ke3gub2RkfeWAjSgke3gucG9wfeeVquS6uuawlylgOiIifVxuYDsKICAgICByZXR1cm4gYDxkaXY+PGI+JHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfTwvc3Bhbj4gPHNwYW4gY2xhc3M9InNtYWxsIj4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0l77yI56m044K+44O844Oz5bmz5Z2H44GuJHsoeC5wYy9BVkdbeC5tb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSkudG9GaXhlZCgxKX3lgI3jg7vkv6HpoLzluqYke2VzYyh4LmNvbmYpfe+8iTwvc3Bhbj48YnI+PHNwYW4gY2xhc3M9InNtYWxsIj4ke2VzYyhyZWNMaW5lKHgpKX3vvI8ke2VzYyh4LmpuYW1lfHwi6aiO5omL5LiN5piOIil9JHt4Lm9kZD9g77yPPGI+5Y2Y5YudJHt4Lm9kZH3lgI3vvIgke3gucG9wfeeVquS6uuawl++8iTwvYj5gOiIifTwvc3Bhbj48YnI+YCt4LnRhZ3Muc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9KS5qb2luKCIiKXx8JzxzcGFuIGNsYXNzPSJzbWFsbCI+5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBruWAmeijnOOBquOBl++8neWvvuixoeWkljwvc3Bhbj4nOwogICB9CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhsYWJlbCl9PC9iPjxicj4ke2JvZHl9PGJyPjxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1rPSIke2t9Ij7oqbPntLDjg7vjgqrjg4PjgrrlhaXlips8L2J1dHRvbj48L2Rpdj5gOwogIH0pOwogIGg9aC5yZXBsYWNlKCc8YnI+JyxgPGRpdiBjbGFzcz0ic21hbGwiPuWxpeattOOBrueFp+WQiO+8mummrCAke3RIfS8ke3ROfemgre+8iOmBjuWOu+OBqzLotbDku6XkuIrvvInvvI/pqI7miYsgJHtqSH0vJHt0Tn3poK08L2Rpdj5gKyhqTWlzcy5sZW5ndGgmJmpIPHROKi42P2A8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6aiO5omL44KS6YGO5Y6744OH44O844K/44Go54Wn5ZCI44Gn44GN44Gm44GE44Gq44GE5L6L77yaJHtlc2MoWy4uLm5ldyBTZXQoak1pc3MpXS5zbGljZSgwLDYpLmpvaW4oIuOAgSIpKX08L2Rpdj5gOiIiKSsodE4mJnRIPHROKi41Pyc8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg54Wn5ZCI44Gn44GN44Gf6aas44GM5Y2K5YiG5pyq5rqA44Gn44GZ44CC6Iul6aeS5oim44GM5Lit5b+D44Gu5pel44Gv5q2j5bi444Gn44GZ44GM44CB44Gd44GG44Gn44Gq44GR44KM44Gw6aas5ZCN6KGo6KiY44Gu5LiN5LiA6Ie044Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CCPC9kaXY+JzonJykrJzxicj4nKTsKICBpZihub0NvdXJzZS5sZW5ndGgpaD1oLnJlcGxhY2UoJzxicj4nLGA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg44Kz44O844K577yI6Iqd44OA44O76Led6Zui77yJ44KS6Kqt44G/5Y+W44KM44Gm44GE44Gq44GE44Os44O844K577yaJHtlc2Mobm9Db3Vyc2UubWFwKHg9PngubGFiZWwpLmpvaW4oIuOAgSIpKX3jgILjgZ3jga7jg6zjg7zjgrnjga/jgIHoip3jg4Djg7vot53pm6LjgpLkvb/jgYbliKTlrprjgYzlvLHjgY/jgarjgorjgb7jgZnjgIIke25vQ291cnNlWzBdLnJhdz8i77yI6Ki65pat77yaIitlc2Mobm9Db3Vyc2VbMF0ucmF3LnNsaWNlKDAsNzApKSsi77yJIjoiIn08L2Rpdj48YnI+YCk7CiAgaCs9JzxidXR0b24gY2xhc3M9ImNvcHlBbGwiPuS4gOimp+OCkuODhuOCreOCueODiOOBp+OCs+ODlOODvDwvYnV0dG9uPic7CiAgYm94LmlubmVySFRNTD1oOwogIGJveC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1rXSIpLmZvckVhY2goYnQ9PmJ0Lm9uY2xpY2s9KCk9Pntjb25zdCByPXJzW2J0LmRhdGFzZXQua107c2V0UmFjZShta1JhY2UocixkKSxgJHtkfSAke3IudmVudWVOYW1lfHxyLnZlbnVlfHwiIn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIifWApOyQoInJ1biIpLnNjcm9sbEludG9WaWV3KHtiZWhhdmlvcjoic21vb3RoIn0pO3J1bihudWxsKX0pOwogIGNvbnN0IGNiPWJveC5xdWVyeVNlbGVjdG9yKCIuY29weUFsbCIpO2NiLm9uY2xpY2s9YXN5bmMoKT0+e3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KTtjYi50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXthbGVydCgi44Kz44OU44O844Gn44GN44G+44Gb44KT44Gn44GX44GfIil9fTsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTtib3guaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5LiA5ous6Kej5p6Q44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfQokKCJ3YWxsIikub25jbGljaz0oKT0+cnVuQWxsKCJhbGxvdXQiKTsKLyog5omL5YWl5YqbICovCiQoIm1kYXRlIikudmFsdWU9bmV3IERhdGUoRGF0ZS5ub3coKSs4NjQwMDAwMCozKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ3ZGF0ZSIpLnZhbHVlPSQoIm1kYXRlIikudmFsdWU7JCgicGRhdGUiKS52YWx1ZT0iMjAyNi0wNi0yMSI7CiQoIm1nbyIpLm9uY2xpY2s9KCk9PnsKIGNvbnN0IGxpbmVzPSQoIm10ZXh0IikudmFsdWUuc3BsaXQoL1xyP1xuLykubWFwKHM9PnMudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikscnM9W10sb2Rkcz1bXTsKIGZvcihjb25zdCBsIG9mIGxpbmVzKXtjb25zdCBtPWwubWF0Y2goL14oXGR7MSwyfSlbXHMs44CAXSsoXFMrPykoPzpbXHMs44CAXSsoW1xkLl0rKSk/JC8pO2lmKG0pe3JzLnB1c2goe25hbWU6bVsyXSxob3JzZTpVRS5ubihtWzJdKSxqb2NrZXk6IiIsYWdlOm51bGwsbnVtOittWzFdfSk7b2Rkcy5wdXNoKG1bM10/K21bM106MCl9fQogaWYocnMubGVuZ3RoPDIpcmV0dXJuIGFsZXJ0KCLjgIzppqznlaog6aas5ZCN44CN44Gu5b2i5byP44GnMumgreS7peS4iuWFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgcmFjZT17ZGF0ZTokKCJtZGF0ZSIpLnZhbHVlLHN1cmY6KyQoIm1zdXJmIikudmFsdWUsZGlzdDorJCgibWRpc3QiKS52YWx1ZXx8MCxydW5uZXJzOnJzLG9kZHMwOm9kZHMuZXZlcnkobz0+bz4xKT9vZGRzOm51bGx9Owogc2V0UmFjZShyYWNlLGAke3JhY2UuZGF0ZX0g5omL5YWl5Yqb77yIJHtyYWNlLnN1cmY9PT0xPyLoip0iOiLjg4Djg7zjg4gifSR7cmFjZS5kaXN0fW3jg7ske3JzLmxlbmd0aH3poK3vvIlgKTsKfTsKLyog6YGO5Y6744Os44O844K5ICovCmxldCBQUkFDRVM9W107CiQoInBnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgicGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLmpJzntKLkuK3igKYiOyQoInBsaXN0IikuaW5uZXJIVE1MPSIiOwogdHJ5ewogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoci5kYXRlIT09ZHx8IXIucmFjZUlkKXJldHVybjtpZighbWFwLmhhcyhyLnJhY2VJZCkpbWFwLnNldChyLnJhY2VJZCxbXSk7bWFwLmdldChyLnJhY2VJZCkucHVzaChyKX0pOwogIFBSQUNFUz1bLi4ubWFwLmVudHJpZXMoKV0uZmlsdGVyKChbLHZdKT0+di5sZW5ndGg+PTYpLnNvcnQoKGEsYik9PnZlbnVlT2ZJZChhWzBdKS5sb2NhbGVDb21wYXJlKHZlbnVlT2ZJZChiWzBdKSl8fHJhY2VOb09mSWQoYVswXSktcmFjZU5vT2ZJZChiWzBdKSk7CiAgaWYoIVBSQUNFUy5sZW5ndGgpeyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i44Gd44Gu5pel44Gu44Os44O844K544Gv5L+d5a2Y44OH44O844K/44Gr44GC44KK44G+44Gb44KT44CCIjtyZXR1cm59CiAgJCgicHN0YXR1cyIpLnRleHRDb250ZW50PWAke1BSQUNFUy5sZW5ndGh944Os44O844K5YDsKICBjb25zdCBsYWI9aWQ9PmAke1ZFTlVFW3ZlbnVlT2ZJZChpZCldfHx2ZW51ZU9mSWQoaWQpfSR7cmFjZU5vT2ZJZChpZCl9UmA7CiAgJCgicGxpc3QiKS5pbm5lckhUTUw9UFJBQ0VTLm1hcCgoW2lkLHZdLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7bGFiKGlkKX3vvIgke3ZbMF0uc3VyZj09PTE/IuiKnSI6IuODgCJ9JHt2WzBdLmRpc3R9beODuyR7di5sZW5ndGh96aCt77yJPC9idXR0b24+YCkuam9pbigiIik7CiAgJCgicGxpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+e2NvbnN0IFtpZCx2XT1QUkFDRVNbYi5kYXRhc2V0LmtdOwogICBjb25zdCBycz12LmZpbHRlcihyPT5yLmhvcnNlKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpLm1hcChyPT4oe25hbWU6ci5uYW1lfHxyLmhvcnNlLGhvcnNlOnIuaG9yc2Usam9ja2V5OnIuam9ja2V5LGpuYW1lOnIuam5hbWV8fCIiLGFnZTpyLmFnZSxudW06ci5udW0sYWN0OnIuZmluaXNoLHBvcDpyLnBvcCxvZGRzQTpyLm9kZHN9KSk7CiAgIGNvbnN0IHJhY2U9e2RhdGU6ZCxzdXJmOnZbMF0uc3VyZixkaXN0OnZbMF0uZGlzdCxsdmw6dlswXS5sdmx8fDAscnVubmVyczpycyxwYXN0OnRydWV9OwogICBzZXRSYWNlKHJhY2UsYCR7ZH0gJHtsYWIoaWQpfe+8iOmBjuWOu+ODrOODvOOCueODuyR7cnMubGVuZ3Rofemgre+8iWApO30pOwogfWNhdGNoKGUpeyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgovKiAtLS0g6Kej5p6Q44O76KGo56S6IC0tLSAqLwovKiDjg6njg7Pjgq/jga/oo5zmraPlvozjga7lpb3otbDnjofjgafliKTlrprvvIjjg6Ljg7zjg4njgZTjgajjgavnqbTjgr7jg7zjg7Pjga7lubPlnYfjgYzpgZXjgYbvvJrjgqrjg4PjgrrlhaXlipvmmYLjga/ntIQ5JeOAgeOCquODg+OCuuOBquOBl+OBr+e0hDEzJe+8iSAqLwpjb25zdCBBVkc9e29kZHM6LjA5MSxwcm94eTouMTE1fTsgICAvLyDnqbTjgr7jg7zjg7Pjga7lrp/muKzlubPlnYfvvIgyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT77yJCmNvbnN0IGZvY3VzT249KCk9Pntjb25zdCBlPSQoImZvY3VzT24iKTtyZXR1cm4gIWV8fGUuY2hlY2tlZH07CmNvbnN0IHJhdGluZz0ocCxtb2RlLG4pPT57Y29uc3Qgcj1wLyhBVkdbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga307ICAvLyDlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBpwovKiDlgJnoo5zjgZTjgajjga7jgIzmoLnmi6DjgI3ooajnpLrvvJrlpb3otbDnjofjgajjgZ3jga7ppqzjga7lrp/nuL7jgYzpo5/jgYTpgZXjgaPjgabopovjgYjjgarjgYTjgojjgYbjgIHlrp/nuL7jg7vln7rmupbjg7vpqI7miYvjgpLkuKbjgbnjgosgKi8KZnVuY3Rpb24gcmVjTGluZSh4KXsKIGNvbnN0IHA9W107CiBwLnB1c2goeC5jYXJlZXImJnguY2FyZWVyLm4/YOmAmueulyR7eC5jYXJlZXIubn3otbAgM+edgOWGhSR7eC5jYXJlZXIudDN95Zue77yIJHtNYXRoLnJvdW5kKHguY2FyZWVyLnQzL3guY2FyZWVyLm4qMTAwKX0l77yJYDoi6YCa566X77ya5bGl5q2044Gq44GXIik7CiBpZih4LnJlY2VudCYmeC5yZWNlbnQubGVuZ3RoKXAucHVzaChg55u06L+RICR7eC5yZWNlbnQuc2xpY2UoLTUpLmpvaW4oIi0iKX3nnYBgKTsKIHJldHVybiBwLmpvaW4oIu+8jyIpOwp9CmZ1bmN0aW9uIGJhc2VMaW5lKHgpe3JldHVybiBg56m044K+44O844Oz44Gu5bmz5Z2HICR7YXZnTm90ZSh4Lm1vZGUpfSDihpIg44GT44Gu6aas44GvJHsoeC5wYy9BVkdbeC5tb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSkudG9GaXhlZCgxKX3lgI3vvIhT4omnMi4y5YCN77yPQeKJpzEuN+WAje+8j0LiiacxLjPlgI3vvIlgfQpmdW5jdGlvbiBqb2NrZXlMaW5lKHgpewogaWYoIXguam5hbWUpcmV0dXJuICLpqI7miYvvvJroqq3jgb/lj5bjgozjgabjgYTjgb7jgZvjgpMiOwogcmV0dXJuIHguanN0YXQmJnguanN0YXQubj49NT9g6aiO5omL77yaJHt4LmpuYW1lfe+8iOmBjuWOuyR7eC5qc3RhdC5ufemojuS5lyAz552A5YaFJHtNYXRoLnJvdW5kKHguanN0YXQucmF0ZSoxMDApfSXvvIlgOmDpqI7miYvvvJoke3guam5hbWV977yI6YGO5Y6744OH44O844K/44Gr6Kmy5b2T44Gq44GX44CB44G+44Gf44Gv6aiO5LmX44GM5bCR44Gq44GE77yJYDsKfQpjb25zdCBhdmdOb3RlPW1vZGU9Pm1vZGU9PT0ib2RkcyI/Iue0hDklIjoi57SEMTIlIjsKLyog5bGl5q2044Gu54Wn5ZCI54q25rOB77yI6aas5ZCN44O76aiO5omL5ZCN44GM6YGO5Y6744OH44O844K/44Go5LiA6Ie044GX44Gf44GL77yJICovCmNvbnN0IG1hdGNoSW5mbz1yZXM9Pntjb25zdCBuPXJlcy5sZW5ndGgsaD1yZXMuZmlsdGVyKHg9Pngubj49MikubGVuZ3RoLGo9cmVzLmZpbHRlcih4PT54LmpuPj01KS5sZW5ndGg7cmV0dXJue24saCxqLG1pc3M6cmVzLmZpbHRlcih4PT54LmpuPDUmJnguam5hbWUpLm1hcCh4PT54LmpuYW1lKX19Owphc3luYyBmdW5jdGlvbiBydW4ob2Rkc0luKXsKIGlmKCFDVVIpcmV0dXJuOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoQ1VSLmRhdGUpOwogIGxldCBvZGRzPW9kZHNJbnx8bnVsbDsKICBpZighb2RkcyYmQ1VSLm9kZHMwKW9kZHM9Q1VSLm9kZHMwOwogIGlmKCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5vZGRzQT4xKSlvZGRzPUNVUi5ydW5uZXJzLm1hcChyPT5yLm9kZHNBKTsKICBjb25zdCBwb3BBcnI9KCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5wb3A+MCkpP0NVUi5ydW5uZXJzLm1hcChyPT5yLnBvcCk6bnVsbDsKICBjb25zdCByZXM9VUUuYW5hbHl6ZShDVVIsc3RvcmUsb2RkcyxudWxsLHBvcEFycik7CiAgTEFTVFJFUz17cmVzLG9kZHMsY291bnQ6c3RvcmUuY291bnR9O3JlbmRlcigpOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoIm91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuino+aekOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn0KZnVuY3Rpb24gcmVuZGVyKCl7CiBjb25zdHtyZXMsb2Rkcyxjb3VudH09TEFTVFJFUyxOPXJlcy5sZW5ndGgsY3V0PXJlc1swXS5jdXQscGFzdD0hIUNVUi5wYXN0OwogaWYoTjw2KXskKCJvdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj426aCt5pyq5rqA44Gu44Gf44KB56m06aas5Yik5a6a44Gu5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7cmV0dXJufQogY29uc3QgdXNlZD0hIXJlc1swXS5ta3QsY2FuZHM9VUUucGljayhyZXMsNSk7Y29uc3QgZnNldD1uZXcgU2V0KFVFLnBpY2tGb2N1cyhyZXMsOTkpLm1hcCh4PT54LmkpKTsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Os44O844K544Gu5qC877yaJHtVRV9HTltDVVIuZ3JkfHwwXX0keyhDVVIuZ3JkfHwwKT49Mj8i77yI5qC85LiK44GS6KOc5q2j44GC44KK77yJIjoiIn3vvI/kurrmsJfpoIbvvJoke3VzZWQ/IuWFpeWKm+OCquODg+OCuiI6IuODhOODvOODq+aOqOWumu+8iOmojuaJi+aIkOe4vui+vOOBv+ODu+Wun+mam+OBruS6uuawl+OBqOOBr+eVsOOBquOCiuOBvuOBme+8iSJ977yP56m044K+44O844Oz77yaJHtjdXR955Wq55uu5Lul6ZmN77yI5YWoJHtOfemgre+8ie+8j+Wtpue/kiAke2NvdW50LnRvTG9jYWxlU3RyaW5nKCl96KGMPC9kaXY+YDsKIHtjb25zdCBtPW1hdGNoSW5mbyhyZXMpO2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7bS5ofS8ke20ubn3poK3vvIgy6LWw5Lul5LiK77yJ77yP6aiO5omLICR7bS5qfS8ke20ubn3poK08L2Rpdj5gKyhtLm1pc3MubGVuZ3RoP2A8ZGl2IGNsYXNzPSJzbWFsbCI+6aiO5omL44Gu5pyq54Wn5ZCI77yaJHtlc2MobS5taXNzLnNsaWNlKDAsNikuam9pbigi44CBIikpfSR7bS5taXNzLmxlbmd0aD42PyIg4oCmIjoiIn08L2Rpdj5gOiIiKTtpZihtLmg8bS5uKi41KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6YGO5Y676LWw44KS54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44GE44Gf44KB44CB5LqI5oOz44Gu5L+h6aC85bqm44Gv5L2O44KB44Gn44GZ77yI5paw6aas5oim44O76Iul6aeS5oim44CB44G+44Gf44Gv6aas5ZCN6KGo6KiY44Gu6YGV44GE77yJ44CCPC9kaXY+YH0KIGgrPSI8YnI+IjsKIGlmKCFjYW5kcy5sZW5ndGgpaCs9JzxzcGFuIGNsYXNzPSJ3YXJuIj7nqbTjgr7jg7zjg7PjgavjgIHlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gu5YCZ6KOc44GM44GE44G+44Gb44KT77yI5paw6aas5oim44O76Iul6aeS5oim44Gq44Gp77yJ44CC44GT44Gu44Os44O844K544Gv5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7CiBjYW5kcy5mb3JFYWNoKCh4LGspPT57CiAgY29uc3QgY2hpcHM9eC50YWdzLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKTsKICBjb25zdCByPUNVUi5ydW5uZXJzW3guaV07CiAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7aysxfS4gJHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiR7ZnNldC5oYXMoeC5pKT8nIDxzcGFuIGNsYXNzPSJjaGlwIGIiPuKXjueahOS4reeOh+mHjeimljwvc3Bhbj4nOicnfSA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfTwvc3Bhbj5gOwogIGlmKHBhc3QpaCs9YCA8c3BhbiBjbGFzcz0ic21hbGwiPuKGkiDntZDmnpwgJHtyLmFjdD8/Ii0ifeedgO+8iCR7ci5wb3A/PyItIn3kurrmsJfvvIkke3IuYWN0PD0zPyIg4pyFIjoiIn08L3NwYW4+YDsKICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyA8Yj4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC9iPu+8iOeptOOCvuODvOODs+W5s+WdhyAke2F2Z05vdGUoeC5tb2RlKX3vvInvvI/kv6HpoLzluqYgJHtlc2MoeC5jb25mKX08YnI+JHtlc2MocmVjTGluZSh4KSl9PGJyPiR7ZXNjKGJhc2VMaW5lKHgpKX08YnI+JHtlc2Moam9ja2V5TGluZSh4KSl9JHt4Lm9kZD9gPGJyPjxiPuWNmOWLnSR7eC5vZGR95YCN77yIJHt4LnBvcH3nlarkurrmsJfvvIk8L2I+YDoiIn1gOwogIGlmKHgubWt0IT1udWxsKWgrPWA8YnI+5biC5aC044Gu5oOz5a6aM+edgOWGhSAkeyh4Lm1rdCoxMDApLnRvRml4ZWQoMSl9JSDihpIg5biC5aC044Go44Gu5beuICR7eC52YWx1ZT49Mz8iM+WAjeS7peS4iiI6eC52YWx1ZS50b0ZpeGVkKDIpKyLlgI0ife+8iOWPguiAg++8muaknOiovOOBp+OBr+W9k+OBn+OCiuOBq+e1kOOBs+S7mOOBjeOBvuOBm+OCk+OBp+OBl+OBn++8iWA7CiAgaCs9YDwvZGl2PjxkaXY+JHtjaGlwc3x8JzxzcGFuIGNsYXNzPSJzbWFsbCI+55uu56uL44Gk5qC55oug44Gq44GXPC9zcGFuPid9PC9kaXY+PC9kaXY+YDsKIH0pOwogaCs9YDxicj48Yj7lhajpoK3kuIDopqc8L2I+JHtwYXN0PyLvvIjlrp/pmpvjga7ntZDmnpzjgaTjgY3vvIkiOiLvvIjljZjli53jgqrjg4PjgrrjgpLlhaXjgozjgovjgajlppnlkbPjgpLoqIjnrpfvvIkifTx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqznlao8L3RoPjx0aD7ppqzlkI08L3RoPjx0aD7pqI7miYs8L3RoPjx0aD7lpb3otbDnjoc8L3RoPjx0aD7poIbkvY08L3RoPjx0aD7jgqrjg4Pjgro8L3RoPiR7cGFzdD8iPHRoPue1kOaenDwvdGg+IjoiIn08L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiByZXMpe2NvbnN0IHI9Q1VSLnJ1bm5lcnNbeC5pXTsKICBoKz1gPHRyJHt4LmhvbGU/JyBzdHlsZT0iYmFja2dyb3VuZDojZmZiODAwMjIiJzonJ30+PHRkPiR7ZXNjKHgubm8pfTwvdGQ+PHRkPiR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHtlc2MoeC5qbmFtZXx8Ij8iKX08L3RkPjx0ZD4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHt4LnJhbmt9PC90ZD48dGQ+PGlucHV0IGNsYXNzPSJvZGRzIiBkYXRhLWk9IiR7eC5pfSIgdHlwZT0ibnVtYmVyIiBzdGVwPSIwLjEiIG1pbj0iMS4xIiBpbnB1dG1vZGU9ImRlY2ltYWwiIHZhbHVlPSIke29kZHM/b2Rkc1t4LmldOiIifSIgc3R5bGU9IndpZHRoOjYycHg7cGFkZGluZzo0cHgiPjwvdGQ+JHtwYXN0P2A8dGQ+JHtyLmFjdD8/Ii0ifeedgDwvdGQ+YDoiIn08L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjxidXR0b24gaWQ9InJlY2FsYyI+44Kq44OD44K644KS5Y+N5pig44GX44Gm5YaN6KiI566XPC9idXR0b24+PGJ1dHRvbiBpZD0iY2xlYXJvZGRzIiBjbGFzcz0ic3ViIj7jgqrjg4PjgrrjgpLjgq/jg6rjgqI8L2J1dHRvbj5gOwogJCgib3V0IikuaW5uZXJIVE1MPWg7CiAkKCJyZWNhbGMiKS5vbmNsaWNrPSgpPT57Y29uc3Qgdj1bLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI291dCBpbnB1dC5vZGRzIildLm1hcChlPT5wYXJzZUZsb2F0KGUudmFsdWUpKTtydW4odi5ldmVyeShvPT5vPjEpP3Y6bnVsbCl9OwogJCgiY2xlYXJvZGRzIikub25jbGljaz0oKT0+e0NVUi5vZGRzMD1udWxsO0NVUi5wYXN0PUNVUi5wYXN0O0xBU1RSRVM9bnVsbDtydW4obnVsbCl9Owp9CiQoInJ1biIpLm9uY2xpY2s9KCk9PnJ1bihudWxsKTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKS50aGVuKCgpPT57ZS50YXJnZXQudmFsdWU9IiJ9KX07CgovKiAtLS0g5omV5oi744O75pyI44Gu5Y+W5b6X54q25rOB77yISW5kZXhlZERC77yJIC0tLSAqLwpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH0KfTsKCi8qIC0tLSDmiZXmiLvjga7mm7jjgY3lh7rjgZfjg7voqq3jgb/ovrzjgb8gLS0tICovCiQoInBheUV4cCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aClyZXR1cm4gYWxlcnQoIuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAgiIpOwogY29uc3QgYT1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7YS5ocmVmPVVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KHBzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSkpOwogYS5kb3dubG9hZD1ga2VpYmFfcGF5b3V0c18ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpO3NldFRpbWVvdXQoKCk9PlVSTC5yZXZva2VPYmplY3RVUkwoYS5ocmVmKSwxMDAwKX07CiQoInBheUltcCIpLm9uY2hhbmdlPWFzeW5jIGU9PnsKIGNvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoIWYpcmV0dXJuOwogdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZShhd2FpdCBmLnRleHQoKSk7Y29uc3QgYXJyPUFycmF5LmlzQXJyYXkoaik/ajooai5yYWNlcz9bal06W10pOwogIGNvbnN0IGJ5RGF0ZT1uZXcgTWFwKCk7CiAgZm9yKGNvbnN0IHggb2YgYXJyKXtpZih4JiZBcnJheS5pc0FycmF5KHgucmFjZXMpJiZ4LmRhdGUpYnlEYXRlLnNldCh4LmRhdGUse2RhdGU6eC5kYXRlLHJhY2VzOngucmFjZXMsZmFpbGVkOnguZmFpbGVkfHwwfSl9CiAgZm9yKGNvbnN0W2Qscl1vZiBieURhdGUpYXdhaXQgcGF5UHV0KGQscik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfWNhdGNoKGVycil7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7oqq3jgb/ovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlcnIubWVzc2FnZSl9PC9zcGFuPmB9CiBlLnRhcmdldC52YWx1ZT0iIjsKfTsKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOKRoC0zIOOCsOODrOODvOODieijnOato+OBruWKueaenOavlOi8g++8iOmHjeiznuOBruOBv+ODu+WQjOOBmOmBjuWOu+ODh+ODvOOCv+OBp+ijnOato+OBguOCii/jgarjgZfvvIkgLS0tICovCiQoImJ0R3JhZGUiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiLHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTtsZXQgZ3JhZGVkPTA7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIHJhY2VzLmZvckVhY2goeD0+e2lmKCh4LnJvd3NbMF0uZ3JkfHwwKT49MilncmFkZWQrK30pOwogIGlmKCFncmFkZWQpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6YGO5Y6744OH44O844K/44Gu5Lit44Gr44CBRzHjgJxHM+OBqOWIpOWIpeOBp+OBjeOCi+ODrOODvOOCueOBjOOBguOCiuOBvuOBm+OCk++8iOOCr+ODqeOCueihqOiomOODuzHnnYDos57ph5HjgYznhKHjgYTvvInjgILjgrDjg6zjg7zjg4noo5zmraPjga7lirnmnpzjga/mpJzoqLzjgafjgY3jgb7jgZvjgpPjgILikaTjga7lrp/ooYzmmYLjga/jg6zjg7zjgrnlkI3jg7vlh7rppqzooajjga7jgrDjg6zjg7zjg4nooajoqJjjgafoo5zmraPjgZXjgozjgb7jgZnjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgYmFzZT17c3RhcnQsc3BsaXQ6IiIsb29zOk1PREVMX1RSQUlOX0VORCxtaW5HcmQ6Mn07CiAgYnVzeSh0cnVlLCLoo5zmraPjgYLjgoov44Gq44GX44KS5qSc6Ki85Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG9uPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsYmFzZSksb2ZmPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsey4uLmJhc2UsZ3JhZGVPZmY6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgrSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3guYmV0c33vvIk8L3NwYW4+YDoiLSI7CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7lr77osaHvvJrph43os57vvIhHMeOAnEcz77yJJHtvbi5yYWNlc33jg6zjg7zjgrnjgILlkIzjgZjpgY7ljrvjg4fjg7zjgr/jgafjgIHoo5zmraPjgYLjgoov44Gq44GX44Gu55qE5Lit546H44O75Zue5Y+O546HKDk1JeW5hSnjgpLmr5TovIPjgZfjgabjgYTjgb7jgZnjgILku7bmlbDjgYzlsJHjgarjgYTjgajlt67jga/lgbbnhLbjga7nr4Tlm7LjgafjgZnvvIjlm57lj47njofjga7CseW5heOBjOmHjeOBquOCi+OBquOCieW3ruOBr+WIpOaWreOBp+OBjeOBvuOBm+OCk++8ieOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7nmoTkuK3njocg44GC44KKPC90aD48dGg+55qE5Lit546HIOOBquOBlzwvdGg+PHRoPuWbnuWPjueOhyDjgYLjgoo8L3RoPjx0aD7lm57lj47njocg44Gq44GXPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IGE9b24uc3RhdHNba10uYWxsLGI9b2ZmLnN0YXRzW2tdLmFsbDtpZighYXx8IWEuYmV0cyljb250aW51ZTsKICAgaCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7KGEuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPiR7YiYmYi5iZXRzPyhiLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpKyIlIjoiLSJ9PC90ZD48dGQ+PGI+JHtjKGEpfTwvYj48L3RkPjx0ZD4ke2MoYil9PC90ZD48L3RyPmB9CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aCsiPC90Ym9keT48L3RhYmxlPiI7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOOCquODg+OCuuWPluW+l++8iC9qcmEtb2Rkc++8muW9k+aXpeODu+WJjeaXpeWjsuOCiuOBruWNmOWLneOCquODg+OCuu+8iSAtLS0gKi8KbGV0IE9ERFM9e307CmZ1bmN0aW9uIG9kZHNGb3IocmFjZSl7CiBjb25zdCBtPXJhY2UmJnJhY2Uua2V5P09ERFNbcmFjZS5rZXldOm51bGw7aWYoIW0pcmV0dXJuIG51bGw7CiBjb25zdCBhcnI9cmFjZS5ydW5uZXJzLm1hcChyPT5tW3IubnVtXSk7cmV0dXJuIGFyci5ldmVyeShvPT5vPjEpP2FycjpudWxsOwp9Ci8qIOOCquODg+OCuuWPluW+l++8muKRoOWHuummrOihqOOBi+OCieaLvuOBo+OBn+OCquODg+OCuueUu+mdouOCkuebtOaOpeiqreOCgCDihpIg4pGh5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544Gg44GR44CB44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GG44CCCiAgIOabtOaWsOOBruOBqOOBjeOAgeWPluW+l+OBq+WkseaVl+OBl+OBn+ODrOODvOOCueOBruWJjeWbnuOBruOCquODg+OCuuOBr+a2iOOBleOBquOBhOOAgiAqLwpsZXQgT0REU19ESUFHPSIiOwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHMoKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybntnb3Q6MCx0b3RhbDowfTsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpLGQ9V0RBVEUsa2V5T2Y9cj0+YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWA7CiBsZXQgZGlhZz1bXSxlcnI9IiI7CiAvLyDikaAg55u05o6l77yI5Ye66aas6KGo44Gr44Oq44Oz44Kv44GM44GC44KL44Os44O844K577yJCiBjb25zdCB3aXRoTGluaz1XUkFDRVMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUNuYW1lPW5ldyBNYXAod2l0aExpbmsubWFwKHI9PltyLm9kZHNDbmFtZSxyXSkpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8d2l0aExpbmsubGVuZ3RoO2krPTYpY2h1bmtzLnB1c2god2l0aExpbmsuc2xpY2UoaSxpKzYpLm1hcChyPT5yLm9kZHNDbmFtZSkpOwogbGV0IGNpPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Q25hbWUuZ2V0KGl0LmNuYW1lKTtpZihyKU9ERFNba2V5T2YocildPWl0Lm9kZHN9CiAgIGlmKCh4LmZhaWxlZHx8W10pLmxlbmd0aClkaWFnLnB1c2goLi4ueC5mYWlsZWQuc2xpY2UoMCwyKS5tYXAoZj0+Zi5yZWFzb24pKTsKICAgaWYoeC5zYW1wbGUmJiFPRERTX0RJQUcpT0REU19ESUFHPSLnlLvpnaLjga7kuIDpg6jvvJoiK1N0cmluZyh4LnNhbXBsZSkuc2xpY2UoMCwyNjApOwogIH1jYXRjaChlKXtlcnI9ZS5tZXNzYWdlfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiAvLyDikaEg5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544KS44CB5pel5LuY44O76ZaL5YKs5aC044Gu44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GGCiBjb25zdCBtaXNzaW5nPVdSQUNFUy5maWx0ZXIocj0+IU9ERFNba2V5T2YocildKTsKIGlmKG1pc3NpbmcubGVuZ3RoKXsKICBjb25zdCB2ZW51ZXM9Wy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpewogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBmb3IoY29uc3QgciBvZiAoeC5yYWNlc3x8W10pKU9ERFNbYCR7U3RyaW5nKHIudmVudWVDb2RlKS5wYWRTdGFydCgyLCIwIil9LSR7ci5yYWNlTm99YF09ci5vZGRzOwogICAgaWYoISh4LnJhY2VzfHxbXSkubGVuZ3RoKWRpYWcucHVzaCguLi4oeC5kaWFnbm9zdGljc3x8W10pLnNsaWNlKDAsNCkubWFwKHo9PnR5cGVvZiB6PT09InN0cmluZyI/ejpKU09OLnN0cmluZ2lmeSh6KSkpOwogICB9Y2F0Y2goZSl7ZXJyPWUubWVzc2FnZTtkaWFnLnB1c2goZS5tZXNzYWdlKX19CiB9CiBjb25zdCBnb3Q9V1JBQ0VTLmZpbHRlcihyPT5PRERTW2tleU9mKHIpXSkubGVuZ3RoOwogT0REU19ESUFHPWdvdD8iIjooT0REU19ESUFHKyhlcnI/Iu+8j+eQhueUse+8miIrZXJyOiIiKSsoZGlhZy5sZW5ndGg/Iu+8j+iouuaWre+8miIrWy4uLm5ldyBTZXQoZGlhZyldLmpvaW4oIiB8ICIpLnNsaWNlKDAsNTAwKToiIikpOwogcmV0dXJue2dvdCx0b3RhbDpXUkFDRVMubGVuZ3RofTsKfQokKCJvZGRzR2V0Iikub25jbGljaz1hc3luYygpPT57CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiAkKCJvZGRzR2V0IikuZGlzYWJsZWQ9dHJ1ZTtPRERTX0RJQUc9IiI7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLjgqrjg4Pjgrrlj5blvpfkuK3igKYiOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2hPZGRzKCk7CiAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X77yP44Kq44OD44K6ICR7ci5nb3R944Os44O844K55YiGYCsoci5nb3Q/IiI6Ilxu44Kq44OD44K644KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf77yI55m65aOy5YmN44CB44G+44Gf44Gv55S76Z2i5qeL6YCg44Gu6YGV44GE77yJ44CCIisoT0REU19ESUFHPyJcbiIrT0REU19ESUFHOiIiKSk7CiB9ZmluYWxseXskKCJvZGRzR2V0IikuZGlzYWJsZWQ9ZmFsc2V9CiByZW5kZXJWZW51ZUJ1dHRvbnMoV0RBVEUpOwp9OwoKLyogLS0tIOKYhSDmnKzml6Xjga7lpb3otbDnqbTppqzvvIjjg6/jg7Pjgr/jg4Pjg5fvvIkgLS0tICovCmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ0ZGF0ZSIpLnZhbHVlPWpzdFRvZGF5KCk7CiQoInRvZGF5R28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgidGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47CiAkKCJ0b2RheUdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ0b2RheU91dCIpLmlubmVySFRNTD0iIjskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfkuK3igKYiOwogdHJ5ewogICQoIndkYXRlIikudmFsdWU9ZDthd2FpdCAkKCJ3Z2V0Iikub25jbGljaygpOwogIGlmKCFXUkFDRVMubGVuZ3RoKXsKICAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0kKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ7CiAgIGlmKEFWQUlMLmxlbmd0aCl7JCgidG9kYXlPdXQiKS5pbm5lckhUTUw9QVZBSUwubWFwKHg9PmA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtZD0iJHt4fSI+JHt4fTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICAgJCgidG9kYXlPdXQiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1kXSIpLmZvckVhY2goYnQ9PmJ0Lm9uY2xpY2s9KCk9PnskKCJ0ZGF0ZSIpLnZhbHVlPWJ0LmRhdGFzZXQuZDskKCJ0b2RheUdvIikuY2xpY2soKX0pfQogICByZXR1cm59CiAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+OAguOCquODg+OCuuOCkueiuuiqjeS4reKApmA7CiAgYXdhaXQgJCgib2Rkc0dldCIpLm9uY2xpY2soKTsKICBjb25zdCBuPU9iamVjdC5rZXlzKE9ERFMpLmxlbmd0aDsKICAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIZgKyhuPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvJrjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICBhd2FpdCBydW5BbGwoInRvZGF5T3V0Iik7VE9EQVlfU0hPV049dHJ1ZTthdXRvU3RhcnQoKTsKIH1jYXRjaChlKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KIGZpbmFsbHl7JCgidG9kYXlHbyIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJ0b2RheVVwZCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i5a2m57+S44OH44O844K/44Gu5pyA57WC5pel44KS56K66KqN5Lit4oCmIjsKIGxldCBtPSIiO2F3YWl0IGZvckVhY2hSb3cocj0+e2lmKHIuZGF0ZT5tKW09ci5kYXRlfSk7CiBjb25zdCBmcm9tPW0/YWRkRGF5cyhtLDEpOiIyMDIzLTAxLTAxIix0bz1qc3RZZXN0ZXJkYXkoKTsKIGlmKGZyb20+dG8peyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YOWtpue/kuODh+ODvOOCv+OBr+OBmeOBp+OBq+acgOaWsOOBp+OBme+8iOacgOe1guaXpSAke21977yJ44CCYDtyZXR1cm59CiAkKCJzc3RhcnQiKS52YWx1ZT1mcm9tOyQoInNlbmQiKS52YWx1ZT10bzsKICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZnJvbX3jgJwke3RvfSDjga7miJDnuL7jgpLlj5blvpfjgZfjgb7jgZnjgILpgLLmjZfjga/jgIzikaAg44OH44O844K/5Y+W5b6X44CN44Gu5qyE44Gr5Ye644G+44GZ44CCYDsKICQoInN5bmNHbyIpLmNsaWNrKCk7JCgic3luY1N0YXR1cyIpLnNjcm9sbEludG9WaWV3KHtiZWhhdmlvcjoic21vb3RoIn0pOwp9OwoKLyogLS0tIOKRpCDpiYTmnb/ou7jppqwgLyDikaUg5YWo44Os44O844K544Gu5rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X77yJIC0tLSAqLwpjb25zdCBVRV9HTj1bIuS4jeaYji/kuIvntJoiLCJPUOODu0wiLCJHMyIsIkcyIiwiRzEiXTsKY29uc3QgR1JBREVfQ09MT1I9e1NTUzoiI2Q5MmQyMCIsU1M6IiNmMDQ0MzgiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgR1JBREVfT1JERVI9WyJTU1MiLCJTUyIsIlMiLCJBIiwiQiIsIkMiXTsKJCgiYWRhdGUiKS52YWx1ZT1qc3RUb2RheSgpOwpmdW5jdGlvbiByYWNlTGFiZWwocixuKXtyZXR1cm4gYCR7ci52ZW51ZU5hbWV8fHIudmVudWV8fCIifSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2UmJnIuZGlzdGFuY2U/ci5zdXJmYWNlK3IuZGlzdGFuY2UrIm0iOiLjgrPjg7zjgrnkuI3mmI4ifeODuyR7bn3poK3vvIlgfQphc3luYyBmdW5jdGlvbiByZW5kZXJBeGlzVXBzZXQoZCl7CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKGQpOwogY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlfHxhLnZlbnVlTmFtZXx8IiIpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlfHxiLnZlbnVlTmFtZXx8IiIpKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogY29uc3QgY250PXt9O0dSQURFX09SREVSLmZvckVhY2goZz0+Y250W2ddPTApOwogY29uc3QgdXBSb3dzPVtdLGF4Um93cz1bXTtsZXQgd2l0aE9kZHM9MCxza2lwcGVkPTA7CiBmb3IoY29uc3QgciBvZiBycyl7CiAgY29uc3QgcmFjZT1ta1JhY2UocixkKSxuPXJhY2UucnVubmVycy5sZW5ndGg7CiAgaWYobjw2KXtza2lwcGVkKys7Y29udGludWV9CiAgY29uc3Qgb2Q9b2Rkc0ZvcihyYWNlKSxhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk7CiAgY29uc3QgZz1VRS51cHNldEdyYWRlKHJhY2Usc3RvcmUsb2QsYXApO2NudFtnLmdyYWRlXSsrO2lmKG9kKXdpdGhPZGRzKys7CiAgdXBSb3dzLnB1c2goe2xhYmVsOnJhY2VMYWJlbChyLG4pLGd9KTsKICBjb25zdCBwaWNrcz1vZD9VRS5heGlzUGlja3MocmFjZSxzdG9yZSxvZCxhcCk6bnVsbDsKICBpZihwaWNrcylmb3IoY29uc3QgeCBvZiBwaWNrcylheFJvd3MucHVzaCh7bGFiZWw6cmFjZUxhYmVsKHIsbikseCxuYW1lOnJhY2UucnVubmVyc1t4LmldLm5hbWUsbm86cmFjZS5ydW5uZXJzW3guaV0ubnVtLGpuYW1lOnJhY2UucnVubmVyc1t4LmldLmpuYW1lfSk7CiB9CiAvLyDikaUg5rOi5Lmx5bqmCiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke3VwUm93cy5sZW5ndGh944Os44O844K577yI44Kq44OD44K65Y+N5pigICR7d2l0aE9kZHN944Os44O844K577yP44Gd44Gu5LuW44Gv44OE44O844Or5o6o5a6a77yJJHtza2lwcGVkP2DvvI826aCt5pyq5rqA44Gn5a++6LGh5aSWICR7c2tpcHBlZH1gOiIifTwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0icm93Ij5gK0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpK2A8L2Rpdj5gOwogaCs9YDx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD48L3RoPjx0aD7nrYnntJo8L3RoPjx0aD7pgY7ljrvjga7ms6LkubHnjoc8L3RoPjx0aD7liKTlrpo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB1IG9mIHVwUm93cyloKz1gPHRyPjx0ZD4ke2VzYyh1LmxhYmVsKX08L3RkPjx0ZD48L3RkPjx0ZD48c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbdS5nLmdyYWRlXX0iPiR7dS5nLmdyYWRlfTwvc3Bhbj48L3RkPjx0ZD4ke01hdGgucm91bmQodS5nLnJhdGUqMTAwKX0lPC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3UuZy5tb2RlPT09Im9kZHMiPyLjgqrjg4PjgroiOiLmjqjlrpoifTwvdGQ+PC90cj5gOwogaCs9YDwvdGJvZHk+PC90YWJsZT48ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuazouS5seeOh+OBr+OAgeOBneOBruetiee0muOBruODrOODvOOCueOBp+OAjDPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOBo+OBn+mBjuWOu+OBruWJsuWQiOOBp+OBme+8iOWFqOODrOODvOOCueW5s+WdhyAyOC41Je+8ieOAgjwvZGl2PmA7CiAkKCJ1cHNldE91dCIpLmlubmVySFRNTD1oOwogLy8g4pGkIOmJhOadv+i7uOmmrAogbGV0IGE9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrkgJHt3aXRoT2Rkc30vJHt1cFJvd3MubGVuZ3RofeOAgjwvZGl2PmA7CiBpZighd2l0aE9kZHMpYSs9YDxkaXYgY2xhc3M9Indhcm4iPuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBpuOBhOOBquOBhOOBn+OCgeOAgemJhOadv+i7uOmmrOOBr+WIpOWumuOBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAgeOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgjwvZGl2PmA7CiBlbHNlIGlmKCFheFJvd3MubGVuZ3RoKWErPWA8ZGl2IGNsYXNzPSJ3YXJuIj7mnKzml6Xjga/jgIHoqbLlvZPjgZnjgovou7jppqzjgYzjgYTjgb7jgZvjgpPvvIjjgqrjg4Pjgrrlj5blvpfmuIjjgb/jga7jg6zjg7zjgrnjga7kuK3jgavjgIHloIXou7jku6XkuIrjgYzjgYLjgorjgb7jgZvjgpPvvInjgII8L2Rpdj5gOwogZm9yKGNvbnN0IHQgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgbGlzdD1heFJvd3MuZmlsdGVyKHo9PnoueC50aWVyPT09dCk7aWYoIWxpc3QubGVuZ3RoKWNvbnRpbnVlOwogIGErPWA8YnI+PGI+JHt0fTwvYj48c3BhbiBjbGFzcz0ic21hbGwiPu+8iOmBjuWOu+OBruWun+e4viAkeyhVRS5BWElTLmJhbmRzW3RdLnJhdGUqMTAwKS50b0ZpeGVkKDApfSXjg7voqbLlvZMke1VFLkFYSVMuYmFuZHNbdF0ubn3poK3vvIk8L3NwYW4+YDsKICBmb3IoY29uc3QgeiBvZiBsaXN0KWErPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyh6LmxhYmVsKX08L2I+PGJyPiR7ZXNjKHoubm8pfeeVqiAke2VzYyh6Lm5hbWUpfSA8c3BhbiBjbGFzcz0ic21hbGwiPuS6iOa4rCAkeyh6LngucCoxMDApLnRvRml4ZWQoMCl9JSR7ei5qbmFtZT8i77yP6aiO5omL77yaIitlc2Moei5qbmFtZSk6IiJ9PC9zcGFuPjwvZGl2PmB9CiAkKCJheGlzT3V0IikuaW5uZXJIVE1MPWE7Cn0KJCgiYXhpc0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoImFkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOwogJCgiYXhpc0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJheGlzT3V0IikuaW5uZXJIVE1MPSIiOyQoInVwc2V0T3V0IikudGV4dENvbnRlbnQ9Iuino+aekOS4reKApiI7CiB0cnl7CiAgaWYoIVdSQUNFUy5sZW5ndGh8fFdEQVRFIT09ZCl7CiAgICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCmIjskKCJ3ZGF0ZSIpLnZhbHVlPWQ7YXdhaXQgJCgid2dldCIpLm9uY2xpY2soKTsKICAgaWYoIVdSQUNFUy5sZW5ndGgpeyQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0kKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ7JCgidXBzZXRPdXQiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf44CCIjtyZXR1cm59CiAgICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0i44Kq44OD44K644KS56K66KqN5Lit4oCmIjthd2FpdCAkKCJvZGRzR2V0Iikub25jbGljaygpfQogICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aH3jg6zjg7zjgrnliIZgOwogIGF3YWl0IHJlbmRlckF4aXNVcHNldChkKTtBWElTX1NIT1dOPXRydWU7YXV0b1N0YXJ0KCk7CiB9Y2F0Y2goZSl7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZTskKCJ1cHNldE91dCIpLnRleHRDb250ZW50PSIifQogZmluYWxseXskKCJheGlzR28iKS5kaXNhYmxlZD1mYWxzZX0KfTsKCi8qIC0tLSDjgqrjg4Pjgrrjga7oh6rli5Xmm7TmlrDvvIjlvZPml6Xjga7jgb/vvInvvJrjgqrjg4Pjgrrlj5blvpcg4oaSIOihqOekuuS4reOBruashO+8iOKYheacrOaXpeODu+KRpOKRpe+8ieOCkuiHquWLleOBp+WGjeioiOeulyAtLS0gKi8KbGV0IEFVVE9fVD1udWxsLEFVVE9fTkVYVD0wLEFVVE9fQlVTWT1mYWxzZSxBVVRPX0xBU1Q9IiIsVE9EQVlfU0hPV049ZmFsc2UsQVhJU19TSE9XTj1mYWxzZTsKY29uc3QgYXV0b01zPSgpPT53aW5kb3cuX19BVVRPX01TfHxOdW1iZXIoJCgiYXV0b01pbiIpLnZhbHVlKSo2MDAwMDsKZnVuY3Rpb24gYXV0b1N0b3AoKXtpZihBVVRPX1QpY2xlYXJJbnRlcnZhbChBVVRPX1QpO0FVVE9fVD1udWxsOyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9IiJ9CmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hPZGRzQW5kVmlld3MoKXsKIGF3YWl0IGZldGNoT2RkcygpOwogQVVUT19MQVNUPW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTkpOwogY29uc3Qgbj1PYmplY3Qua2V5cyhPRERTKS5sZW5ndGg7CiBpZihUT0RBWV9TSE9XTil7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke25944Os44O844K55YiG77yIJHtBVVRPX0xBU1R9IOabtOaWsO+8iWA7YXdhaXQgcnVuQWxsKCJ0b2RheU91dCIpfQogaWYoQVhJU19TSE9XTil7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIbvvIgke0FVVE9fTEFTVH0g5pu05paw77yJYDthd2FpdCByZW5kZXJBeGlzVXBzZXQoV0RBVEUpfQp9CmZ1bmN0aW9uIGF1dG9TdGFydCgpewogYXV0b1N0b3AoKTsKIGlmKCEkKCJhdXRvT2RkcyIpLmNoZWNrZWR8fCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGlmKFdEQVRFPGpzdFRvZGF5KCkpeyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9Iu+8iOmBjuWOu+OBruaXpeS7mOOBruOBn+OCgeiHquWLleabtOaWsOOBr+OBl+OBvuOBm+OCk++8iSI7cmV0dXJufQogQVVUT19ORVhUPURhdGUubm93KCkrYXV0b01zKCk7CiBBVVRPX1Q9c2V0SW50ZXJ2YWwoYXN5bmMoKT0+ewogIGNvbnN0IGxlZnQ9QVVUT19ORVhULURhdGUubm93KCk7CiAgaWYobGVmdD4wKXskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PWDmrKHjga7mm7TmlrDjgb7jgacgJHtNYXRoLmNlaWwobGVmdC8xMDAwKX3np5JgKyhBVVRPX0xBU1Q/YO+8j+acgOe1guabtOaWsCAke0FVVE9fTEFTVH1gOiIiKTtyZXR1cm59CiAgaWYoQVVUT19CVVNZKXJldHVybjtBVVRPX0JVU1k9dHJ1ZTskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSLjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKYiOwogIHRyeXthd2FpdCByZWZyZXNoT2Rkc0FuZFZpZXdzKCl9Y2F0Y2goZSl7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0i5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2V9CiAgZmluYWxseXtBVVRPX0JVU1k9ZmFsc2U7QVVUT19ORVhUPURhdGUubm93KCkrYXV0b01zKCl9CiB9LHdpbmRvdy5fX0FVVE9fVElDS3x8MTAwMCk7Cn0KJCgiYXV0b09kZHMiKS5vbmNoYW5nZT1hdXRvU3RhcnQ7JCgiYXV0b01pbiIpLm9uY2hhbmdlPWF1dG9TdGFydDsKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpOwogIGF3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbXSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuLnVwZGF0ZWRBdH0pOwogIGF3YWl0IHNob3dTdGF0ZSgpO0JLLmluZm89bWFuO2JrTXNnKGDlvqnlhYPlrozkuobvvJoke25hbWVzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8ke2NudC50b0xvY2FsZVN0cmluZygpfeS7tmApOwogfWNhdGNoKGUpe2JrTXNnKCLlvqnlhYPjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKX0KIGZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmZ1bmN0aW9uIGJrU2NoZWR1bGUobXMpewogaWYoIUJLLmF1dG98fCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXJldHVybjsKIGNsZWFyVGltZW91dChCSy5ydW5UKTtCSy5ydW5UPXNldFRpbWVvdXQoKCk9PntpZighU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpO2Vsc2UgYmtTY2hlZHVsZSgzMDAwMCl9LG1zfHwzMDAwKTsKfQpmdW5jdGlvbiBia1NhdmVTZXR0aW5ncygpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfYmsiLEpTT04uc3RyaW5naWZ5KHtwYXNzOkJLLnBhc3MsYXV0bzpCSy5hdXRvfSkpfWNhdGNoKGUpe319CmZ1bmN0aW9uIGZvY3VzSW5pdCgpe3RyeXtjb25zdCB2PWxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9mb2N1cyIpO2lmKHYhPT1udWxsKSQoImZvY3VzT24iKS5jaGVja2VkPXY9PT0iMSJ9Y2F0Y2goZSl7fSQoImZvY3VzT24iKS5vbmNoYW5nZT0oKT0+e3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfZm9jdXMiLCQoImZvY3VzT24iKS5jaGVja2VkPyIxIjoiMCIpfWNhdGNoKGUpe31pZihUT0RBWV9TSE9XTilydW5BbGwoInRvZGF5T3V0Iil9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXtmb2N1c0luaXQoKTsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgovKiAtLS0g6Ki65pat5oOF5aCx77yI6ZaL5YKs5aC044GU44Go44Gr44CB5Ye66aas6KGo44Oa44O844K444Gu5Lit6Lqr44KS6Kq/44G544KL77yJIC0tLSAqLwokKCJkYmdHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3Qgb3V0PSQoImRiZ091dCIpOwogaWYoIVdSQUNFUy5sZW5ndGgpe291dC52YWx1ZT0i5YWI44Gr44CM5aW96LWw56m06aas44KS6KGo56S644CN44KS5oq844GX44Gm44CB5Ye66aas6KGo44KS5Y+W5b6X44GX44Gm44GP44Gg44GV44GE44CCIjtyZXR1cm59CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKSxkPVdEQVRFOwogY29uc3QgdmVudWVzPVsuLi5uZXcgU2V0KFdSQUNFUy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKIG91dC52YWx1ZT0i6Ki65pat5Lit4oCmIjskKCJkYmdHbyIpLmRpc2FibGVkPXRydWU7CiBjb25zdCBsaW5lcz1bYOaXpeS7mCAke2R9YF07CiB0cnl7CiAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXsKICAgY29uc3QgcnM9V1JBQ0VTLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIik9PT12KTsKICAgY29uc3Qgbm9Db3Vyc2U9cnMuZmlsdGVyKHI9PiEoci5zdXJmYWNlJiZyLmRpc3RhbmNlKSkubGVuZ3RoOwogICBjb25zdCBvZGRzPXJzLmZpbHRlcihyPT5PRERTW2Ake3Z9LSR7TnVtYmVyKHIucmFjZU51bWJlcil8fDB9YF0pLmxlbmd0aDsKICAgbGluZXMucHVzaChgXG7ilqDplovlgqzloLQke3Z977yIJHtyc1swXT8udmVudWVOYW1lfHwiIn3vvInjg6zjg7zjgrkke3JzLmxlbmd0aH3vvI/jgrPjg7zjgrnkuI3mmI4ke25vQ291cnNlfe+8j+OCquODg+OCuuWPluW+lyR7b2Rkc33vvI/jg6rjg7Pjgq/jgYLjgooke3JzLmZpbHRlcihyPT5yLm9kZHNDbmFtZSkubGVuZ3RofWApOwogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vZGVidWctZW50cnk/ZGF0ZT0ke2R9JnZlbnVlPSR7dn0mcmFjZT0xYCxbMTUwMF0pO2RlbGV0ZSB4Lm9rO2xpbmVzLnB1c2goSlNPTi5zdHJpbmdpZnkoeCkpfQogICBjYXRjaChlKXtsaW5lcy5wdXNoKCLoqLrmlq3jgqjjg6njg7zvvJoiK2UubWVzc2FnZSl9CiAgfQogfWZpbmFsbHl7JCgiZGJnR28iKS5kaXNhYmxlZD1mYWxzZX0KIG91dC52YWx1ZT1saW5lcy5qb2luKCJcbiIpOwp9OwokKCJkYmdDb3B5Iikub25jbGljaz1hc3luYygpPT57Y29uc3QgdD0kKCJkYmdPdXQiKS52YWx1ZTt0cnl7YXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQodCk7JCgiZGJnQ29weSIpLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpeyQoImRiZ091dCIpLnNlbGVjdCgpO2FsZXJ0KCLpgbjmip7jgZfjgb7jgZfjgZ/jgILjgrPjg5Tjg7zjgZfjgabjgY/jgaDjgZXjgYTjgIIiKX19OwoKKGFzeW5jKCk9Pnt0cnl7YXdhaXQgb3BlbkRCKCk7YXdhaXQgc2hvd1N0YXRlKCk7YXdhaXQgcGF5U3RhdGUoKTthd2FpdCBia0luaXQoKX1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5L+d5a2Y6aCY5Z+f44KS6ZaL44GR44G+44Gb44KT77yaJHtlc2MoZS5tZXNzYWdlKX1cbu+8iOODl+ODqeOCpOODmeODvOODiOODluODqeOCpuOCuuOBp+OBr+S9v+OBiOOBquOBhOOBk+OBqOOBjOOBguOCiuOBvuOBme+8iTwvc3Bhbj5gfX0pKCk7CmlmKC9eaHR0cHM/Oi8udGVzdChsb2NhdGlvbi5wcm90b2NvbCkpJCgid3VybCIpLnZhbHVlPWxvY2F0aW9uLm9yaWdpbjsKc2hvd1BhbmUoIldvcmtlciIpOwoKPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";
function serveApp() {
  const binary = atob(APP_HTML_BASE64);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

/* =========================================================
 * 払戻（複勝・単勝）取得 /payouts?date=YYYY-MM-DD[&venue=06]
 * 既存の結果ページ探索・取得処理を流用。保存はしない（読み取り専用）。
 * ======================================================= */
/* レース結果ページ（accessS）1レース分の払戻。文字コードに依存しないよう、馬番・円・人気だけを読む。
   raceId は URL の CNAME（…sde10 + 場2桁+年4桁+回2桁+日2桁+R2桁+日付8桁）から作る。 */
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

async function handlePayouts(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }
  try {
    let races = await discoverJRAResultUrlsByDate(date);
    if (venue) races = races.filter(r => String(r.venueCode) === String(venue));
    const out = [];
    const failed = [];
    for (const race of races) {
      try {
        if (!race.url) throw new Error("レースURLがありません");
        const html = await fetchJRAHtml(race.url);
        const p = extractJRARefund(html, race.url);
        if (!p.raceId || !p.place.length) throw new Error("払戻を解析できませんでした");
        out.push({ raceId: p.raceId, date, venueCode: p.venueCode, raceNo: p.raceNo, win: p.win, place: p.place });
      } catch (error) {
        failed.push({
          venueCode: race.venueCode,
          raceNo: race.raceNumber ?? race.raceNo,
          reason: String(error?.message || error)
        });
      }
    }
    return json({ ok: true, source: "JRA", date, discovered: races.length, count: out.length, races: out, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}


/* =========================================================
 * 過去結果の取得（保存しない・読み取り専用）
 *   /results?date=YYYY-MM-DD&list=1          その日の開催場一覧
 *   /results?date=YYYY-MM-DD&venue=06        その開催場の結果行
 * 既存の結果ページ探索・解析（discoverJRAResultUrlsByDate / fetchOneJRARace / raceResultToRows）を流用。
 * ======================================================= */
async function handleResults(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  if (!isValidDateString(date)) {
    return errorResponse("date=YYYY-MM-DD を指定してください。", 400);
  }
  try {
    let races = await discoverJRAResultUrlsByDate(date);
    if (url.searchParams.get("list") === "1") {
      const map = new Map();
      for (const r of races) {
        if (!map.has(r.venueCode)) map.set(r.venueCode, { venueCode: r.venueCode, venueName: r.venueName || r.venueCode, races: 0 });
        map.get(r.venueCode).races++;
      }
      return json({ ok: true, source: "JRA", date, venues: [...map.values()] });
    }
    if (venue) races = races.filter(r => String(r.venueCode) === String(venue));
    const rows = [];
    const failed = [];
    for (const race of races) {
      try {
        const result = await fetchOneJRARace(race.date || date, race.venueCode, race.venueName, race);
        if (!result || !Array.isArray(result.horses) || !result.horses.length) throw new Error("結果が0頭");
        for (const r of raceResultToRows(result)) {
          rows.push({
            date: r.date, raceId: r.raceId, venueCode: r.venueCode, raceNumber: r.raceNumber,
            surface: r.surface, distance: r.distance, finish: r.finish, number: r.number,
            horse: r.horse, age: r.age, jockey: r.jockey
          });
        }
      } catch (error) {
        failed.push({ venueCode: race.venueCode, raceNo: race.raceNo, reason: String(error?.message || error) });
      }
    }
    return json({ ok: true, source: "JRA", date, discovered: races.length, count: rows.length, rows, failed });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}


/* =========================================================
 * 自己完結用API（過去成績・払戻・オッズ）
 *   /jra-days?month=YYYY-MM            その月の開催日
 *   /jra-day?date=YYYY-MM-DD           その日の全レース（結果ページのCNAME）
 *   /jra-results?cnames=a,b,c          レース結果（人気つき）＋払戻（最大8レース）
 *   /jra-odds?date=YYYY-MM-DD[&venue=] 単勝オッズ（レース前・当日）
 * すべて読み取り専用。保存はしない。
 * ======================================================= */
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
          horse: r.horse, age: r.age, jockey: r.jockey, pop: r.popularity ?? null
        });
      }
      const clsText = ((String(html).match(/<div class="cell class">\s*([^<]*?)\s*<\/div>/) || [])[1] || "").trim();
      const prizeM = String(html).match(/<li><span class="cap">1着<\/span><span class="num">([\d,]+)<\/span>/);
      const prize1 = prizeM ? Number(prizeM[1].replace(/,/g, "")) : null;
      const gradeText = extractJRAGradeText(html);
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; row.grade = gradeText; } }
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
function parseJraOddsHtml(html) {
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
        items.push({ cname: c, odds: p.odds, count: n, method: p.method });
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
  const cnameRe = /pw15o[a-z]{2}\d{2}[0-9A-Za-z]*\/[0-9A-Fa-f]{1,4}/g;
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
    let frontier = topC.filter(c => c.includes(compact) && !/^pw151ou/i.test(c));
    let fetched = 0;
    for (let depth = 0; depth < 3 && frontier.length && fetched < 10; depth++) {
      const next = [];
      for (const c of frontier) {
        if (seen.has(c) || fetched >= 10) continue;
        seen.add(c); fetched++;
        try {
          const html = await fetchJRAHtmlPost("/JRADB/accessO.html", c);
          const cs = collect(html);
          cs.forEach(addRace);
          for (const x of cs) if (x.includes(compact) && !/^pw151ou/i.test(x) && !seen.has(x)) next.push(x);
          diag.push({ step: "odds-level" + (depth + 1), cname: c, htmlLength: html.length, found: cs.length, raceLevel: cs.filter(x => /^pw151ou/i.test(x)).length });
        } catch (error) {
          diag.push({ step: "odds-level" + (depth + 1), cname: c, error: String(error?.message || error) });
        }
      }
      frontier = next;
    }
    const targets = [...raceLevel.keys()].filter(c => c.includes(compact));
    const races = [];
    for (const c of targets.slice(0, 14)) {
      try {
        const html = await fetchOddsPage(c);
        const p = parseJraOddsHtml(html);
        const m = c.match(/^pw151ou\d{2}(\d{2})\d{8}(\d{2})\d{8}/i);
        const venueCode = m ? m[1] : null, raceNo = m ? Number(m[2]) : null;
        const n = Object.keys(p.odds).length;
        diag.push({ step: "odds-race", cname: c, venueCode, raceNo, horses: n, method: p.method, htmlLength: html.length });
        if (n >= 4 && venueCode && raceNo && (!venueFilter || venueCode === String(venueFilter))) races.push({ venueCode, raceNo, odds: p.odds });
      } catch (error) {
        diag.push({ step: "odds-race", cname: c, error: String(error?.message || error) });
      }
    }
    return json({ ok: true, date, count: races.length, races, diagnostics: diag.slice(0, 24) });
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
      firstHorseRow: firstHorseRow.replace(/\s+/g, " ").slice(0, 500)
    });
  } catch (error) {
    return errorResponse(error?.message || error, 502);
  }
}

/* =========================================================
 * メインWorker
 * ======================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    try {

      const url =
        new URL(
          request.url
        );


      const pathname =
        url.pathname;


      const method =
        request.method
          .toUpperCase();


      /* ---------------------------------------------------
       * CORS
       * ------------------------------------------------- */

      if (
        method ===
        "OPTIONS"
      ) {

        return handleOptions();

      }


      /* ---------------------------------------------------
       * 自動バックアップ（PUT / DELETE を含むため、GET以外の制限より前に処理）
       * ------------------------------------------------- */
      if (pathname.startsWith("/backup/")) {
        return await handleBackup(request, env, pathname);
      }

      /* ---------------------------------------------------
       * GET以外
       * ------------------------------------------------- */

      if (
        method !==
        "GET" &&
        method !==
        "HEAD"
      ) {

        return errorResponse(
          "GET / HEAD / OPTIONS のみ対応しています。",
          405
        );

      }


      /* ---------------------------------------------------
       * Webアプリ本体
       * ------------------------------------------------- */

      if (pathname === "/debug-entry") {
        return handleDebugEntry(request);
      }

      if (pathname === "/manifest.webmanifest") {
        return manifestResponse();
      }

      if (pathname === "/icon-180.png") return iconResponse("180");
      if (pathname === "/icon-192.png") return iconResponse("192");
      if (pathname === "/icon-512.png") return iconResponse("512");

      if (pathname === "/jra-days") {
        return handleJraDays(request);
      }

      if (pathname === "/jra-day") {
        return handleJraDay(request);
      }

      if (pathname === "/jra-results") {
        return handleJraResults(request);
      }

      if (pathname === "/jra-odds") {
        return handleJraOdds(request);
      }

      if (pathname === "/results") {
        return handleResults(request);
      }

      if (pathname === "/payouts") {
        return handlePayouts(request);
      }

      if (pathname === "/" || pathname === "/index.html") {
        return serveApp();
      }

      /* ---------------------------------------------------
       * ヘルスチェック
       * ------------------------------------------------- */

      if (
        pathname ===
        "/health"
      ) {

        return handleHealth(env);

      }


      /* ---------------------------------------------------
       * 次回レース
       * ------------------------------------------------- */

      if (
        pathname ===
          "/next-race" ||
        pathname ===
          "/netlify/functions/next-race"
      ) {

        return handleNextRace();

      }


      /* ---------------------------------------------------
       * レースカード
       * ------------------------------------------------- */

      if (
        pathname ===
          "/race-cards" ||
        pathname ===
          "/netlify/functions/race-cards"
      ) {

        return handleRaceCards(
          request
        );

      }


      /* ---------------------------------------------------
       * レース結果
       * ------------------------------------------------- */

      if (
        pathname ===
          "/race-results" ||
        pathname ===
          "/netlify/functions/race-results"
      ) {

        return handleRaceResults(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 次回レース予想
       * ------------------------------------------------- */

      if (
        pathname ===
        "/predict"
      ) {

        return handlePredict(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 1日全レース予想
       * ------------------------------------------------- */

      if (
        pathname ===
        "/predict-day"
      ) {

        return handlePredictDay(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * 開催場
       * ------------------------------------------------- */

      if (
        pathname ===
        "/venues"
      ) {

        return handleVenues(
          request
        );

      }


      /* ---------------------------------------------------
       * 履歴状態
       * ------------------------------------------------- */

      if (
        pathname ===
        "/history-status"
      ) {

        return handleHistoryStatus(
          env
        );

      }


      /* ---------------------------------------------------
       * 履歴インポート
       * ------------------------------------------------- */

      if (
        pathname ===
        "/import-history"
      ) {

        return handleImportHistory(
          request,
          env
        );

      }


      /* ---------------------------------------------------
       * デバッグ
       * ------------------------------------------------- */

      if (
        pathname ===
        "/debug-race"
      ) {

        return handleDebugRace(
          request
        );

      }


      /* ---------------------------------------------------
       * JRA結果テスト
       * ------------------------------------------------- */

　　　　if (
        pathname ===
        "/test-jra"
      ) {

        try {

          return json(
            await testJRAResult()
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
      /* ---------------------------------------------------
       * JRA 中山・京都 レースリンク解析テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-jra-html"
      ) {

        try {

          const testUrls = [

  {
    name: "中山6R",
    url:
      "https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde1006201901060620190119%2F1A"
  }

];
          const results = [];

          for (
            const test of
              testUrls
          ) {

            try {

              const html =
                await fetchJRAHtml(
                  test.url
                );

              const rawLinks =
                extractJRALinks(
                  html,
                  test.url
                );

              const parsedLinks =
                rawLinks
                  .map(
                    link =>
                      parseJRACname(
                        link
                      )
                  )
                  .filter(
                    Boolean
                  );

              const targetLinks =
                parsedLinks.filter(
                  race =>
                    race.date ===
                    "2019-01-19"
                );

              const pageLinks =
                getJRARaceLinksFromPage(
                  html,
                  test.url,
                  "2019-01-19"
                );

              results.push({

                name:
                  test.name,

                htmlLength:
                  html.length,

                rawLinkCount:
                  rawLinks.length,

                parsedLinkCount:
                  parsedLinks.length,

                targetDateCount:
                  targetLinks.length,

                pageLinkCount:
                  pageLinks.length,

                pageLinks:
                  pageLinks.slice(
                    0,
                    20
                  )

              });

            } catch (
              error
            ) {

              results.push({

                name:
                  test.name,

                error:
                  String(
                    error.message ||
                    error
                  )

              });

            }

          }

          return json({

            ok: true,

            date:
              "2019-01-19",

            results

          });

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
    
      /* ---------------------------------------------------
       * JRA保存テスト
       * ------------------------------------------------- */

　　　　      if (
        pathname ===
        "/test-history-data"
      ) {

        try {

          const rows =
            await loadStoredHistory(
              env
            );

          return json({

            ok: true,

            storedRows:
              Array.isArray(rows)
                ? rows.length
                : 0,

            stats:
              getHistoryStats(
                Array.isArray(rows)
                  ? rows
                  : []
              ),

            firstRows:
              Array.isArray(rows)
                ? rows.slice(
                    0,
                    5
                  )
                : [],

            lastRows:
              Array.isArray(rows)
                ? rows.slice(
                    -5
                  )
                : []

          });

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }
      
      if (
        pathname ===
        "/test-jra-store"
      ) {

        try {

          return json(
            await testJRAStore(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


            if (
        pathname ===
        "/test-jra-auto"
      ) {

        try {

          return json(
            await testJRAAutoDiscover(
              env,
              "2019-01-19"
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019年1月テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-history-2019"
      ) {

        try {

          return json(
            await testHistory2019January(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019年1月テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-history-2019"
      ) {

        try {

          return json(
            await testHistory2019January(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 2019-01-05完全テスト
       * ------------------------------------------------- */

      if (
        pathname ===
        "/test-jra-full-day"
      ) {

        try {

          return json(
            await testJRAFullDay(
              env
            )
          );

        } catch (
          error
        ) {

          return errorResponse(
            error.message ||
              error,
            500
          );

        }

      }


      /* ---------------------------------------------------
       * 404
       * ------------------------------------------------- */

      return json(

        {

          ok: false,

          error:
            "Not Found",

          path:
            pathname,

          availableRoutes: [

            "/health",

            "/next-race",

            "/race-cards",

            "/race-results",

            "/predict",

            "/predict-day",

            "/venues",

            "/history-status",

            "/import-history",

            "/debug-race",

            "/test-jra",

            "/test-jra-store",

            "/test-history-2019",

            "/test-jra-full-day"

          ]

        },

        404

      );

    } catch (
      error
    ) {

      /*
       * Worker全体の最終エラー捕捉。
       *
       * ここで例外をResponseに変換することで、
       * 以前のようなCloudflare 1101を
       * できるだけ防ぐ。
       */

      console.error(
        "Worker fatal error",
        error
      );


      return errorResponse(

        error &&
        error.message
          ? error.message
          : String(
              error ||
              "Unknown Worker Error"
            ),

        500

      );

    }

  }

};
