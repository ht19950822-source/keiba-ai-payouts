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
  "2026-10-11-cpu-fix-1";

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

function extractJRAEntryInfo(html) {
  const result = {
    oddsCname: findOddsCname(html),
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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnqbTppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56m06aas5aW96LWw44OE44O844OrPC90aXRsZT4KPHN0eWxlPgo6cm9vdHstLWJnOiNmM2Y1Zjc7LS1jYXJkOiNmZmY7LS10eDojMTcyMDJhOy0tc3ViOiM1ZDY4NzU7LS1sbjojZTVlN2ViOy0taGQ6IzEwMTgyODstLXByOiMxNjY3ZDl9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXs6cm9vdHstLWJnOiMwZjE0MWE7LS1jYXJkOiMxYTIxMjk7LS10eDojZThlY2YxOy0tc3ViOiM5YWE2YjI7LS1sbjojMmIzNDNlOy0taGQ6IzA1MDgwYzstLXByOiM0YjhlZjB9fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWZ9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6MTRweCAxNnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTlweH0KbWFpbnttYXgtd2lkdGg6OTAwcHg7bWFyZ2luOmF1dG87cGFkZGluZzoxMHB4fQpzZWN0aW9ue2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MTRweDttYXJnaW46MTBweCAwO2JveC1zaGFkb3c6MCAxcHggNHB4ICMwMDAxfQpoMntmb250LXNpemU6MTZweDttYXJnaW46MCAwIDhweH0KYnV0dG9ue2JvcmRlcjowO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTFweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tcHIpO2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo0cHggNHB4IDRweCAwO2ZvbnQtc2l6ZToxNHB4fQpidXR0b246ZGlzYWJsZWR7b3BhY2l0eTouNH1idXR0b24uc3Vie2JhY2tncm91bmQ6IzY2NzA4NX0KaW5wdXQsc2VsZWN0LHRleHRhcmVhe3BhZGRpbmc6OXB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6OHB4O2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtc2l6ZToxNXB4O21heC13aWR0aDoxMDAlO2JveC1zaXppbmc6Ym9yZGVyLWJveH0KdGV4dGFyZWF7d2lkdGg6MTAwJTttaW4taGVpZ2h0OjEyMHB4O2ZvbnQtZmFtaWx5OmluaGVyaXR9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5nb29ke2NvbG9yOiMxMzczMzM7Zm9udC13ZWlnaHQ6NzAwfS53YXJue2NvbG9yOiNjMjZhMDA7Zm9udC13ZWlnaHQ6NzAwfQp0YWJsZXt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTNweH10aCx0ZHtwYWRkaW5nOjZweCAzcHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbG4pO3RleHQtYWxpZ246cmlnaHR9CnRoOm50aC1jaGlsZCgtbisyKSx0ZDpudGgtY2hpbGQoLW4rMil7dGV4dC1hbGlnbjpsZWZ0fQouY2FuZHtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxuKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzo5cHg7bWFyZ2luOjhweCAwfQouY2hpcHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXNpemU6MTJweDtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6MnB4IDhweDttYXJnaW46M3B4IDRweCAwIDA7YmFja2dyb3VuZDojZWVmMWY1O2NvbG9yOiMzNDQwNTR9Ci5jaGlwLmJ7YmFja2dyb3VuZDojZTBmMmU2O2NvbG9yOiMxMzczMzN9LmNoaXAub3tiYWNrZ3JvdW5kOiNmZmVmY2Y7Y29sb3I6IzlhNWEwMH0uY2hpcC5ne2JhY2tncm91bmQ6I2U2ZTllZTtjb2xvcjojNWQ2ODc1fQoucnR7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC13ZWlnaHQ6ODAwO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MCA3cHg7Y29sb3I6I2ZmZjtiYWNrZ3JvdW5kOiM5OGEyYjN9Ci5ydC5yU3tiYWNrZ3JvdW5kOiNkOTJkMjB9LnJ0LnJBe2JhY2tncm91bmQ6I2Y3OTAwOX0ucnQuckJ7YmFja2dyb3VuZDojMTY2N2Q5fQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nqbTppqzlpb3otbDjg4Tjg7zjg6sgPHNwYW4gc3R5bGU9ImZvbnQtd2VpZ2h0OjQwMDtmb250LXNpemU6MTNweCI+5Y2Y5L2T54mIIHYxPC9zcGFuPjwvaGVhZGVyPgo8bWFpbj4KPHNlY3Rpb24+CjxoMj7imIUg5pys5pel44Gu5aW96LWw56m06aasPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuODnOOCv+ODszHjgaTjgafjgIzlh7rppqzooajjga7lj5blvpcg4oaSIOOCquODg+OCuu+8iOWPluOCjOOCjOOBsO+8ieKGkiDlhajjg6zjg7zjgrnjga7nqbTppqzlgJnoo5zjgI3jgpLooajnpLrjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0ic21hbGwiPuKaoCDpgY7ljrvjga7mpJzoqLzvvIgyMDIz5bm044Cc44CB5omV5oi744Gk44GN77yJ77ya56m06aasMeS9jeWAmeijnOOBrjxiPuikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzclPC9iPu+8iDEwMCXmnKrmuoDvvInjgafjgZfjgZ/jgILlvZPjgZ/jgorjgoTjgZnjgZXjga7nm67lronjgajjgZfjgabjgYrkvb/jgYTjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9InRkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJ0b2RheUdvIj7lpb3otbDnqbTppqzjgpLooajnpLo8L2J1dHRvbj48YnV0dG9uIGlkPSJ0b2RheVVwZCIgY2xhc3M9InN1YiI+5pyA5paw44Gu5oiQ57i+44Gr5pu05pawPC9idXR0b24+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iZm9jdXNPbiIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOKXjueahOS4reeOh+mHjeimlu+8iOODqeODs+OCr1MvQeOBoOOBkeihqOekuuOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+WNmOWLnTMw5YCN5pyq5rqA77yJPC9sYWJlbD48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJhdXRvT2RkcyIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOOCquODg+OCuuOCkuiHquWLleOBp+abtOaWsOOBmeOCizwvbGFiZWw+IDxzZWxlY3QgaWQ9ImF1dG9NaW4iPjxvcHRpb24gdmFsdWU9IjMiPjPliIY8L29wdGlvbj48b3B0aW9uIHZhbHVlPSI1IiBzZWxlY3RlZD415YiGPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEw5YiGPC9vcHRpb24+PC9zZWxlY3Q+IOOBlOOBqCA8c3BhbiBpZD0iYXV0b0luZm8iPjwvc3Bhbj48L2Rpdj4KPGRldGFpbHMgY2xhc3M9InNtYWxsIj48c3VtbWFyeT7oqq3jgb/lj5bjgozjgarjgYTjg6zjg7zjgrnjgYzjgYLjgovjgajjgY3vvIjoqLrmlq3mg4XloLHvvIk8L3N1bW1hcnk+CjxkaXYgY2xhc3M9InNtYWxsIj7jgIzjgrPjg7zjgrnkuI3mmI7jgI3jgoTjgIHjgqrjg4PjgrrjgYzlj5bjgozjgarjgYTplovlgqzloLTjgYzjgYLjgovjgajjgY3jgavmirzjgZfjgabjgY/jgaDjgZXjgYTjgILlkITplovlgqzloLTjga4xUuOBruODmuODvOOCuOOBruS4rei6q+OCkuiqv+OBueOBpuOAgeS4i+OBruashOOBq+WHuuOBl+OBvuOBmeOAguOCs+ODlOODvOOBl+OBpuOAgeOBneOBruOBvuOBvumAgeOBo+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImRiZ0dvIiBjbGFzcz0ic3ViIj7oqLrmlq3mg4XloLHjgpLkvZzjgos8L2J1dHRvbj48YnV0dG9uIGlkPSJkYmdDb3B5IiBjbGFzcz0ic3ViIj7jgrPjg5Tjg7w8L2J1dHRvbj48L2Rpdj4KPHRleHRhcmVhIGlkPSJkYmdPdXQiIHJlYWRvbmx5IHN0eWxlPSJ3aWR0aDoxMDAlO2hlaWdodDoxNTBweDtmb250LXNpemU6MTJweCI+PC90ZXh0YXJlYT4KPC9kZXRhaWxzPgo8ZGl2IGlkPSJ0b2RheVN0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn44CM5aW96LWw56m06aas44KS6KGo56S644CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CC5oiQ57i+44GM5Y+k44GE44Go44GN44Gv5YWI44Gr44CM5pyA5paw44Gu5oiQ57i+44Gr5pu05paw44CN44KS5oq844GX44G+44GZ44CCPC9kaXY+CjxkaXYgaWQ9InRvZGF5T3V0Ij48L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAg44OH44O844K/5Y+W5b6X77yI44GT44Gu44Ki44OX44Oq44Gg44GR44Gn5a6M57WQ77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPkpSQeWFrOW8j+OBi+OCieOAgemBjuWOu+OBruaIkOe4vu+8iOS6uuawl+OBpOOBje+8ieOBqOikh+WLneODu+WNmOWLneOBruaJleaIu+OCkuWPluW+l+OBl+OBpuOAgeOBk+OBruerr+acq+OBq+S/neWtmOOBl+OBvuOBmeOAguWFg+OBruOCouODl+ODquOChOODkOODg+OCr+OCouODg+ODl+OBr+S4jeimgeOBp+OBmeOAguatouOCgeOBpuOCgue2muOBjeOBi+OCieWGjemWi+OBp+OBjeOBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPuaOpee2muWFiCA8aW5wdXQgaWQ9Ind1cmwiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIyMHB4IiB2YWx1ZT0iaHR0cHM6Ly9rZWliYS1haS1wYXlvdXRzLmh0MTk5NTA4MjIud29ya2Vycy5kZXYiPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPuacn+mWkyA8aW5wdXQgaWQ9InNzdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPiDjgJwgPGlucHV0IGlkPSJzZW5kIiB0eXBlPSJkYXRlIj48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJzeW5jR28iPumBjuWOu+aIkOe4vuOBqOaJleaIu+OCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9InN5bmNTdG9wIiBjbGFzcz0ic3ViIiBkaXNhYmxlZD7lgZzmraI8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0ic3luY1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+CjxkaXYgaWQ9ImRhdGFTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8ZGV0YWlscz48c3VtbWFyeSBjbGFzcz0ic21hbGwiPuODkOODg+OCr+OCouODg+ODl0pTT07vvI9DU1bjgYvjgonoqq3jgb/ovrzjgoDvvIjku7vmhI/vvIk8L3N1bW1hcnk+CjxkaXYgY2xhc3M9InNtYWxsIj7lhYPjgqLjg5fjg6rjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjgYzjgYLjgozjgbDjgIHlj5blvpfjgpLnnIHnlaXjgafjgY3jgb7jgZnvvIjlkIzjgZjml6Xjga/ph43opIfjgZfjgablj5bjgorovrzjgb/jgb7jgZvjgpPvvInjgII8L2Rpdj4KPGlucHV0IGlkPSJmaWxlIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uLC5jc3YsYXBwbGljYXRpb24vanNvbix0ZXh0L2NzdiI+CjwvZGV0YWlscz4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAtMSDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJl44Gr5L+d5a2Y77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuWPluW+l+OBl+OBn+aIkOe4vuODu+aJleaIu+OCkuOAgeOBguOBquOBn+OBrkNsb3VkZmxhcmXvvIhLVu+8ieOBq+iHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBl+OBvuOBmeOAgjxiPuODh+ODvOOCv+OBjOWkieOCj+OCi+OBqOOAgee0hDPnp5LlvozjgavlpInjgo/jgaPjgZ/pg6jliIbjgaDjgZHjgpLpgIHjgorjgb7jgZnjgII8L2I+44OW44Op44Km44K244Gu44OH44O844K/44GM5raI44GI44Gm44KC44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn5b6p5YWD44Gn44GN44G+44GZ77yI5Yil44Gu56uv5pyr44Gr44KC5b6p5YWD44Gn44GN44G+44GZ77yJ44CC44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB5L+h44GX44G+44Gb44KT44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJia1Bhc3MiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i44OR44K544OV44Os44O844K677yIOOaWh+Wtl+S7peS4iu+8iSIgYXV0b2NvbXBsZXRlPSJvZmYiIHN0eWxlPSJmbGV4OjE7bWluLXdpZHRoOjIwMHB4Ij48YnV0dG9uIGlkPSJia1Nob3ciIGNsYXNzPSJzdWIiPuihqOekujwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3cgc21hbGwiPjxsYWJlbD48aW5wdXQgaWQ9ImJrQXV0byIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOWkieabtOOBjOOBguOCjOOBsOiHquWLleOBp+ODkOODg+OCr+OCouODg+ODl+OBmeOCizwvbGFiZWw+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0iYmtOb3ciPuS7iuOBmeOBkOODkOODg+OCr+OCouODg+ODlzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrUmVzdG9yZSIgY2xhc3M9InN1YiI+44OQ44OD44Kv44Ki44OD44OX44GL44KJ5b6p5YWDPC9idXR0b24+PGJ1dHRvbiBpZD0iYmtGdWxsIiBjbGFzcz0ic3ViIj7jgZnjgbnjgabkv53lrZjjgZfnm7TjgZk8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0iYmtTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPueiuuiqjeS4reKApjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovDwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfmuIjjgb/jga7miJDnuL7jgajmiZXmiLvjgafjgIHmmYLns7vliJfvvIjjgZ3jga7ml6XjgojjgorliY3jga7miJDnuL7jgaDjgZHvvInjga7jg5Djg4Pjgq/jg4bjgrnjg4jjgpLjgZfjgb7jgZnjgILnqbTjgr7jg7zjg7Pjga/lrp/pmpvjga7kurrmsJfjgafliKTlrprjgZfjgIHlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgajku67lrprjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7plovlp4vml6UgPGlucHV0IGlkPSJidFN0YXJ0IiB0eXBlPSJkYXRlIiB2YWx1ZT0iMjAyMy0wMS0wMSI+PGJ1dHRvbiBpZD0iYnRSdW4iPuaknOiovOOCkuWun+ihjDwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InBheUV4cCIgY2xhc3M9InN1YiI+5omV5oi744KS5pu444GN5Ye644GXPC9idXR0b24+PGxhYmVsIGNsYXNzPSJzbWFsbCI+6Kqt44G/6L6844G/IDxpbnB1dCBpZD0icGF5SW1wIiB0eXBlPSJmaWxlIiBhY2NlcHQ9Ii5qc29uIj48L2xhYmVsPjwvZGl2Pgo8ZGl2IGlkPSJidE91dCIgY2xhc3M9InN0YXR1cyI+44OH44O844K/5Y+W5b6X44Gu44GC44Go44Gn5a6f6KGM44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGhIOODrOODvOOCueOCkumBuOOBtjwvaDI+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0idGFiV29ya2VyIiBjbGFzcz0ic3ViIj7lh7rppqzooajjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJ0YWJNYW51YWwiIGNsYXNzPSJzdWIiPuaJi+WFpeWKmzwvYnV0dG9uPjxidXR0b24gaWQ9InRhYlBhc3QiIGNsYXNzPSJzdWIiPumBjuWOu+ODrOODvOOCueOBp+ippuOBmTwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGlkPSJwYW5lV29ya2VyIiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj7ml6LlrZjjga5Xb3JrZXLjga4gL3JhY2UtY2FyZHMg44KS6Kqt44G/5Y+W44KL44Gg44GR44Gn44GZ77yI5aSJ5pu044GX44G+44Gb44KT77yJ44CCPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0id2RhdGUiIHR5cGU9ImRhdGUiPjwvZGl2PgogPGJ1dHRvbiBpZD0id2dldCI+6ZaL5YKs44O744Os44O844K544KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0ib2Rkc0dldCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+44Kq44OD44K644KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0id2FsbCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YWo44Os44O844K55LiA5ous6Kej5p6QPC9idXR0b24+PGRpdiBpZD0id3N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pyq5Y+W5b6XPC9kaXY+PGRpdiBpZD0id2xpc3QiPjwvZGl2PjxkaXYgaWQ9ImFsbG91dCI+PC9kaXY+CjwvZGl2Pgo8ZGl2IGlkPSJwYW5lTWFudWFsIiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj4x6KGM44Gr44CM6aas55WqIOmmrOWQjeOAjeOAguS7u+aEj+OBp+acgOW+jOOBq+WNmOWLneOCquODg+OCuuOAguS+i++8mjxicj4xIOKXi+KXi+KXi+KXiyAzLjQ8YnI+MiDilrPilrPilrPilrM8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJtZGF0ZSIgdHlwZT0iZGF0ZSI+PHNlbGVjdCBpZD0ibXN1cmYiPjxvcHRpb24gdmFsdWU9IjEiPuiKnTwvb3B0aW9uPjxvcHRpb24gdmFsdWU9IjIiPuODgOODvOODiDwvb3B0aW9uPjwvc2VsZWN0PjxpbnB1dCBpZD0ibWRpc3QiIHR5cGU9Im51bWJlciIgc3RlcD0iMTAwIiB2YWx1ZT0iMTYwMCIgc3R5bGU9IndpZHRoOjkwcHgiPm08L2Rpdj4KIDx0ZXh0YXJlYSBpZD0ibXRleHQiIHBsYWNlaG9sZGVyPSIxIOmmrOWQjSYjMTA7MiDppqzlkI0iPjwvdGV4dGFyZWE+CiA8YnV0dG9uIGlkPSJtZ28iPuOBk+OBruODrOODvOOCueOCkuS9v+OBhjwvYnV0dG9uPgo8L2Rpdj4KPGRpdiBpZD0icGFuZVBhc3QiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPgogPGRpdiBjbGFzcz0ic21hbGwiPuS/neWtmOa4iOOBv+OBrumBjuWOu+ODrOODvOOCueOCkuOAgeOBneOBruaXpeOCiOOCiuWJjeOBruODh+ODvOOCv+OBoOOBkeOBp+S6iOaDs+OBl+OBvuOBmeOAguWun+mam+OBruedgOmghuOCkuS4puOBueOBpueiuuiqjeOBp+OBjeOBvuOBmeOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9InBkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJwZ2V0Ij7jgZ3jga7ml6Xjga7jg6zjg7zjgrnkuIDopqc8L2J1dHRvbj48L2Rpdj4KIDxkaXYgaWQ9InBzdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgjwvZGl2PjxkaXYgaWQ9InBsaXN0Ij48L2Rpdj4KPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGiIOeptOmmrOWlvei1sOOCkuino+aekDwvaDI+CjxkaXYgaWQ9InJhY2VsYWJlbCIgY2xhc3M9InNtYWxsIj7jg6zjg7zjgrnjgpLpgbjmip7jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPGJ1dHRvbiBpZD0icnVuIiBkaXNhYmxlZD7op6PmnpDjgZnjgos8L2J1dHRvbj4KPGRpdiBpZD0ib3V0IiBjbGFzcz0ic3RhdHVzIj7mnKrlrp/ooYw8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaMg44GT44Gu44OE44O844Or44Gr44Gk44GE44GmPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPgo8Yj7lpb3otbDnjoc8L2I+77ydM+edgOWGheOBq+WFpeOCi+eiuueOh+OBruaOqOWumuOAgumBjuWOu+OBruWun+e4vuODh+ODvOOCv+OBi+OCiemHjeOBv+OCkuWtpue/kuOBl+OBn+ODouODh+ODq+OBp+ioiOeul+OBl+OBvuOBme+8iOmAmueul+OBrjPnnYDlhoXnjofjg7vjgq/jg6njgrnoo5zmraPjgZfjgZ/miJDnuL7jg7vnm7Tov5Ez6LWw44O75pyA57WC552A6aCG44O75ZCM5p2h5Lu244Gu5a6f57i+44O76ZaT6ZqU44O75bm06b2i44O75piH57Sa6ZmN57Sa44O75Yid44Gu6Iqd44OA5pu/44KP44KK77yJ44CCPGJyPgo8Yj7jgq/jg6njgrk8L2I+77ya5pyq5Yud5Yip77yPMeWLne+8jzLli53vvI8z5Yud77yP44Kq44O844OX44Oz44KS5Yy65Yil44GX44CB5L2O44GE44Kv44Op44K544Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GN44G+44GZ44CC5Zyw5pa544Gu44OH44O844K/44GM5ZCr44G+44KM44KL5aC05ZCI44Gv44CB44GV44KJ44Gr5Ymy44KK5byV44GN44G+44GZ77yISlJB44Gu5YWs5byP44K144Kk44OI44Gr44Gv5Zyw5pa544Gu5oiQ57i+44GM44Gq44GE44Gf44KB44CB5Lit5aSu44Gu44G/44Gu5bGl5q2044Gn44GZ77yJ44CCPGJyPgo8Yj4y44Gk44Gu44Oi44O844OJPC9iPu+8mjxicj4K44O744Kq44OD44K65pyq5YWl5Yqb77ya56m044K+44O844Oz44KS44CM44OE44O844Or5o6o5a6a44Gu5Lq65rCX77yI6aiO5omL5oiQ57i+6L6844G/77yJ44CN44Gn5Yik5a6a44CC5a6f6Zqb44Gu5Lq65rCX44Go44Gu55u46Zai44GvMC43OOOBp+OBmeOAgjxicj4K44O744Kq44OD44K65YWl5Yqb77yI44G+44Gf44Gv6YGO5Y6744Os44O844K544Gu5Lq65rCX6aCG5L2N77yJ77ya56m044K+44O844Oz44KS5a6f6Zqb44Gu5Lq65rCX44Gn5Yik5a6a44GX44G+44GZ44CC5pys5p2l44Gu5L2/44GE5pa544Gn44GZ44CC5biC5aC044Go44Gu5beu44KC5Ye644GX44G+44GZ44GM44CB5qSc6Ki844Gn44Gv5b2T44Gf44KK44Gr57WQ44Gz5LuY44GL44Gq44GL44Gj44Gf44Gf44KB5Y+C6ICD56iL5bqm44Gr44GX44Gm44GP44Gg44GV44GE44CCPGJyPgo8Yj7ooajnpLrjga7oqq3jgb/mlrk8L2I+77ya5aW96LWw546H44Gv44CB44Gd44Gu6aas44Gu44CM56m044K+44O844Oz5YaF44Gn44Gu5a6f57i+44OZ44O844K544Gu56K6546H44CN44Gn44GZ44CC5bGl5q2044Gu44Gq44GE6aas44KC44CB6aCt5pWw44GM5aSa44GR44KM44Gw57SEMuWJsuOBq+OBquOCiuOBvuOBme+8iDE16aCt56uL44Gm44GnM+mgreOBjDPnnYDlhoXjgavlhaXjgovjgZ/jgoHvvInjgILoqZXkvqHjg6njg7Pjgq/jga/jgIHnqbTjgr7jg7zjg7Pjga7lubPlnYfjga7kvZXlgI3jgYvjgafmsbrjgoHjgabjgYTjgb7jgZnjgII8YnI+CjxiPuaknOiovO+8iDIwMjTlubTku6XpmY3jg7vlrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIk8L2I+77yaPGJyPgrjg7vjg6Ljg4fjg6vnsr7luqbvvIjlr77mlbDmkI3lpLHvvInvvJrml6fjg6Ljg4fjg6swLjQ3MSDihpIg5paw44Oi44OH44OrMC40NTDvvIjlsI/jgZXjgYTjgbvjganoia/jgYTvvInjgII8YnI+CuODu+OCquODg+OCuuWFpeWKm+aZgu+8mueptOOCvuODvOODs+WFqOS9k+OBrjPnnYDlhoXnjocgOS4xJeOBq+WvvuOBl+OAgeaXp+ODouODh+ODq+OBrjHkvY3lgJnoo5wxMy4yJSDihpIg5paw44Oi44OH44OrMTYuNSXvvIjkuIrkvY0y6aCtMTUuNCXvvInjgII8YnI+CuODu+OCquODg+OCuuacquWFpeWKm+aZgu+8mueptOOCvuODvOODs+WFqOS9kyAxMS41JeOBq+WvvuOBl+OAgeaXp+ODouODh+ODqzE4LjUlIOKGkiDmlrDjg6Ljg4fjg6syMS4zJe+8iOS4iuS9jTLpoK0xOS43Je+8ieOAgjxicj4K44O7PGI+4peO55qE5Lit546H6YeN6KaWPC9iPu+8iOWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vljZjli50zMOWAjeacqua6gO+8ie+8mjHkvY3lgJnoo5zjga7nmoTkuK3njofjga/jgIHjgqrjg4PjgrrjgYLjgooxNy4yJeKGkjIzLjIl44CB44Kq44OD44K644Gq44GXMjEuNyXihpIyNy4yJeOBq+S4iuOBjOOCiuOBvuOBme+8iOWJjeWNiuODu+W+jOWNiuOBqOOCguWQjOOBmOWCvuWQke+8ieOAguWAmeijnOOBrzHplovlgqzml6XjgYLjgZ/jgorntIQxNOmgreOBp+OBmeOAgjxicj7jg7vjg6njg7Pjgq/jgajlrp/nuL7vvJpT77yeQe+8nkLvvJ5D44Gu6aCG44GrM+edgOWGheeOh+OBjOS4i+OBjOOCiuOBvuOBme+8iOOCquODg+OCuuacquWFpeWKm+aZgu+8mjMzJe+8jzI0Je+8jzIwJe+8jzEzJe+8ieOAgjxicj4K44O7PGI+6KSH5Yud44Gu5Zue5Y+O546H44GMMTAwJeOCkui2heOBiOOCi+OBqOOBr+OAgeOBvuOBoOeiuuiqjeOBp+OBjeOBpuOBhOOBvuOBm+OCk+OAgjwvYj7lgJnoo5zjga/lvZPjgZ/jgovnorrnjofjgYzpq5jjgYTliIbjgIHphY3lvZPjgYzkvY7jgoHjgafjgZnjgILikaAtMuOBp+W/heOBmueiuuiqjeOBl+OBpuOBj+OBoOOBleOBhOOAgjxicj4KPGI+5YCZ6KOc44Gu5p2h5Lu2PC9iPu+8muWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjgaDjgZHjgpLlgJnoo5zjgavjgZfjgb7jgZnjgILlsaXmrbTjga7kuY/jgZfjgYTppqzjga/lpb3otbDnjofjgYzlkIzngrnjgavjgarjgorjgoTjgZnjgY/jgIHpoIbkvY3jgavmhI/lkbPjgYzjgarjgYTjgZ/jgoHjgafjgZnjgILmlrDppqzmiKbjgarjganjga/lr77osaHlpJbjgavjgarjgorjgb7jgZnjgII8YnI+CuOCquODg+OCuuODu+S6uuawl+OBr+S6iOa4rOOBruWFpeWKm+OBq+OBr+S9v+OBo+OBpuOBhOOBvuOBm+OCk++8iOS6uuawl+OBruS7o+eQhuODouODh+ODq+OBruWtpue/kuODqeODmeODq+OBqOOAgeeptOOCvuODvOODs+OBruWIpOWumuOAgeWmmeWRs+OBruavlOi8g+OBq+OBruOBv+S9v+eUqO+8ieOAguikh+WLneWbnuWPjueOh+OBr+OAgeaJleaIu+OCkuWPluW+l+OBl+OBn+OBguOBqOOBq+KRoC0y44Gn5qSc6Ki844Gn44GN44G+44GZ44CCCjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRpCDpiYTmnb/ou7jppqzvvIjopIfli53lnI/lhoUg57SEOTUl77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBp+OAgTPnnYDku6XlhoXjgavlhaXjgovnorrnjofjgYzmpbXjgoHjgabpq5jjgYTppqzjgpLlh7rjgZfjgb7jgZnjgILpgY7ljrvjga7lrp/nuL7vvIgyMDI05bm05Lul6ZmN77yJ44Gn44CB44CM6YmE5p2/44CN44GvOTYl77yIOTUl5bmFIDk044CcOTkl77yJ44CB44CM5rqW6YmE5p2/44CN44GvODkl44CB44CM5aCF6Lu444CN44GvODQl44Gn44GX44Gf44CC6KSH5Yud44Gu6YWN5b2T44Gv5L2O44GE77yIMTAw44CcMTIw5YaG5YmN5b6M77yJ44Gu44Gn44CBPGI+44Ov44Kk44OJ44O76aas6YCj44O7M+mAo+ikh+OBquOBqeOBrui7uDwvYj7jgajjgZfjgabkvb/jgYbmg7PlrprjgafjgZnjgILjgqrjg4PjgrrjgYzjgarjgYTliY3ml6Xjga/jgIHliKTlrprjgafjgY3jgb7jgZvjgpPjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9ImFkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJheGlzR28iPumJhOadv+i7uOOBqOazouS5seW6puOCkuihqOekujwvYnV0dG9uPjwvZGl2Pgo8ZGl2IGlkPSJheGlzU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7ml6Xku5jjgpLpgbjjgpPjgafmirzjgZfjgabjgY/jgaDjgZXjgYTvvIjlh7rppqzooajjgajjgqrjg4PjgrrjgpLlj5blvpfjgZfjgabjgIHikaTikaXjgpLlkIzmmYLjgavooajnpLrjgZfjgb7jgZnvvInjgII8L2Rpdj4KPGRpdiBpZD0iYXhpc091dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGlIOWFqOODrOODvOOCueOBruazouS5seW6pu+8iFNTU+OAnEPvvIk8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44CMM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK77yd5Lq65rCX6JaE44GM57Wh44KA44CN44Os44O844K544Gr44Gq44KL56K6546H44Gn44CB562J57Sa44KS5LuY44GR44G+44GZ44CC6YGO5Y6744Gu5a6f57i+77yIMjAyNOW5tOS7pemZje+8ie+8mlNTUyA1N+OAnDY4JeOAgVNTIDUx44CcNjAl44CBUyA0M+OAnDQ2JeOAgUEgMzUl44CBQiAyNOOAnDI1JeOAgUMgOOOAnDkl77yI5YWo44Os44O844K55bmz5Z2H44GvMjguNSXvvInjgILjgqrjg4PjgrrjgYzjgYLjgozjgbDnsr7luqbjgYzkuIrjgYzjgorjgb7jgZnjgII8Yj7ojZLjgozjgoTjgZnjgZXjga7nm67lronjgafjgIHnqbTppqzjgYzlvZPjgZ/jgovjgYvjganjgYbjgYvjgajjga/liKXjgafjgZnjgII8L2I+PC9kaXY+CjxkaXYgaWQ9InVwc2V0T3V0IiBjbGFzcz0ic3RhdHVzIj7ikaTjga7jgIzpiYTmnb/ou7jjgajms6LkubHluqbjgpLooajnpLrjgI3jgpLmirzjgZnjgajjgIHjgZPjgZPjgavlhajjg6zjg7zjgrnjga7kuIDopqfjgYzlh7rjgb7jgZnjgII8L2Rpdj4KPC9zZWN0aW9uPgo8L21haW4+CjxkaXYgaWQ9ImJ1c3kiPjxkaXYgaWQ9ImJ1c3lUZXh0Ij7lh6bnkIbkuK3igKY8L2Rpdj48L2Rpdj4KPHNjcmlwdD4KInVzZSBzdHJpY3QiOwovKiDnqbTppqzlpb3otbDjgqjjg7Pjgrjjg7PvvIjljZjkvZPniYjjg7vjg5bjg6njgqbjgrYvTm9kZeWFseeUqO+8ieOAguOCquODg+OCuuODu+S6uuawl+OBr+OCueOCs+OCouOBq+S9v+eUqOOBl+OBquOBhOOAgiAqLwpjb25zdCBVRT0oKCk9PnsKIC8qIOWun+ODh+ODvOOCv+aknOiovOOBp+mAhuWKueaenOOBoOOBo+OBn+aIkOWIhu+8iOmojuaJi+ODu+mWk+malO+8ieOBr+aXouWumuOBp09GRiAqLwogY29uc3QgREVGQVVMVD17am9ja2V5OmZhbHNlLGxheW9mZjpmYWxzZX07CiBjb25zdCBjbGFtcD0oeCxhLGIpPT5NYXRoLm1heChhLE1hdGgubWluKGIseCkpOwogY29uc3Qgc2lnbW9pZD14PT4xLygxK01hdGguZXhwKC14KSk7CiBjb25zdCBsb2dpdD1wPT57cD1jbGFtcChwLC4wMDEsLjk5OSk7cmV0dXJuIE1hdGgubG9nKHAvKDEtcCkpfTsKIGNvbnN0IG5uPXM9PlN0cmluZyhzPz8iIikubm9ybWFsaXplKCJORktDIikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXHNcdTMwMDBdKy9nLCIiKS5yZXBsYWNlKC9b44O7772lLu+8jlwt4oCQ4oCR4oCS4oCT4oCU4oCVJ+KAmWBdL2csIiIpLnJlcGxhY2UoL1vimIbimIXilrPilrLil4fil4ZdL2csIiIpOwogLyog6aiO5omL5ZCN77ya5YWI6aCt44Gu5qyn5a2X44Kk44OL44K344Oj44Or44KS6Zmk44GN44CB44OH44Og44O844Ot4oaS44OH44OgIOOBq+aPg+OBiOOCi++8iEpSQeOBriBDLuODh+ODoOODvOODrSDjgajpgY7ljrvjg4fjg7zjgr/jga4g77yj77yO44OH44OgIOOCkuS4gOiHtOOBleOBm+OCi++8iSAqLwogY29uc3Qgam5uPXM9PntsZXQgdj1ubihTdHJpbmcocz8/IiIpLnJlcGxhY2UoL1xkezJ9KD86XC5cZCk/XHMqKD86a2d8772L772HKS9naSwiICIpLnJlcGxhY2UoL1vvvIgoXVte77yJKV17MCw4fVvvvIkpXS9nLCIgIikucmVwbGFjZSgvKOagl+adsXznvo7mtaYpL2csIiAiKSk7dj12LnJlcGxhY2UoL15bYS16XSg/PVvjgqEt44O244O8XSkvLCIiKTt2PXYucmVwbGFjZSgvXuODh+ODoOODvOODrS8sIuODh+ODoCIpO3JldHVybiB2fTsKIC8qIOOCr+ODqeOCueOBruautemaju+8mjA95LiN5piOIC8gLTE95Zyw5pa5IC8gMT3mlrDppqzjg7vmnKrli53liKkgLyAyPTHli50gLyAzPTLli50gLyA0PTPli50gLyA1PeOCquODvOODl+ODs+ODu+mHjeizniAqLwogY29uc3QgbGV2ZWxPZkxhYmVsPXQ9Pntjb25zdCBzPVN0cmluZyh0fHwiIik7aWYoL+WcsOaWuXxOQVIvLnRlc3QocykpcmV0dXJuIC0xO2lmKC/mlrDppqx85pyq5Yud5YipLy50ZXN0KHMpKXJldHVybiAxO2lmKC8x5YudfDUwMOS4hy8udGVzdChzKSlyZXR1cm4gMjtpZigvMuWLnXwxMDAw5LiHLy50ZXN0KHMpKXJldHVybiAzO2lmKC8z5YudfDE2MDDkuIcvLnRlc3QocykpcmV0dXJuIDQ7aWYoL+OCquODvOODl+ODs3zvvK/vvLB8T1B844Oq44K544OG44OD44OJfOmHjeiznnzvvKd8R1sxMjNJXS9pLnRlc3QocykpcmV0dXJuIDU7cmV0dXJuIDB9OwogY29uc3QgbGV2ZWxPZlByaXplPXA9PntwPU51bWJlcihwKTtyZXR1cm4gIShwPjApPzA6cDw9NzAwPzE6cDw9OTAwPzI6cDw9MTMwMD8zOnA8PTE4MDA/NDo1fTsKIGNvbnN0IGlzSnJhVmVudWU9Yz0+L14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKGN8fCIiKSk7CiBjb25zdCBzdXJmQ29kZT1zPT57cz1TdHJpbmcoc3x8IiIpO3JldHVybiAv6IqdfHR1cmYvaS50ZXN0KHMpPzE6L+ODgHxkaXJ0L2kudGVzdChzKT8yOi/pmpx8anVtcC9pLnRlc3Qocyk/MzowfTsKIGNvbnN0IGRudW09ZD0+TnVtYmVyKFN0cmluZyhkfHwiIikucmVwbGFjZSgvXEQvZywiIikuc2xpY2UoMCw4KSl8fDA7CiBmdW5jdGlvbiBwYXJzZURhdGUocyl7CiAgcz1TdHJpbmcoc3x8IiIpO2xldCBtPXMubWF0Y2goLyhcZHs0fSlcRHswLDR9KFxkezEsMn0pXER7MCw0fShcZHsxLDJ9KS8pOwogIGlmKCFtKXJldHVybiIiO3JldHVybiBgJHttWzFdfS0ke21bMl0ucGFkU3RhcnQoMiwiMCIpfS0ke21bM10ucGFkU3RhcnQoMiwiMCIpfWA7CiB9CiBmdW5jdGlvbiBjc3ZSb3dzKHRleHQpewogIGNvbnN0IGxpbmVzPVN0cmluZyh0ZXh0fHwiIikucmVwbGFjZSgvXlx1RkVGRi8sIiIpLnNwbGl0KC9ccj9cbi8pLmZpbHRlcih4PT54LnRyaW0oKSk7CiAgaWYoIWxpbmVzLmxlbmd0aClyZXR1cm5bXTsKICBjb25zdCBzcGxpdD1sPT57Y29uc3QgYT1bXTtsZXQgYz0iIixxPWZhbHNlO2ZvcihsZXQgaT0wO2k8bC5sZW5ndGg7aSsrKXtjb25zdCBjaD1sW2ldOwogICBpZihjaD09PSciJyl7aWYocSYmbFtpKzFdPT09JyInKXtjKz0nIic7aSsrfWVsc2UgcT0hcX1lbHNlIGlmKGNoPT09IiwiJiYhcSl7YS5wdXNoKGMpO2M9IiJ9ZWxzZSBjKz1jaH1hLnB1c2goYyk7cmV0dXJuIGF9OwogIGNvbnN0IGhlYWQ9c3BsaXQobGluZXNbMF0pLm1hcCh4PT54LnRyaW0oKSk7Y29uc3Qgb3V0PVtdOwogIGZvcihsZXQgaT0xO2k8bGluZXMubGVuZ3RoO2krKyl7Y29uc3QgYT1zcGxpdChsaW5lc1tpXSksbz17fTtmb3IobGV0IGo9MDtqPGhlYWQubGVuZ3RoO2orKylvW2hlYWRbal1dPWFbal0/PyIiO291dC5wdXNoKG8pfQogIHJldHVybiBvdXQ7CiB9CiBjb25zdCBmPXY9Pntjb25zdCBuPXBhcnNlRmxvYXQoU3RyaW5nKHY/PyIiKS5yZXBsYWNlKC8sL2csIiIpKTtyZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pP246bnVsbH07CiAvKiDjg5Djg4Pjgq/jgqLjg4Pjg5cvQ1NW44GuMeihjOKGkui7vemHj+ihjCAqLwogZnVuY3Rpb24gdG9Sb3cobyl7CiAgY29uc3Qgc2E9U3RyaW5nKG9bIuaAp+m9oiJdfHwiIik7Y29uc3QgYW09c2EubWF0Y2goLyhcZCspLyk7CiAgcmV0dXJue3JhY2VJZDpTdHJpbmcob1siIl0/P28ucmFjZV9pZD8/b1siVW5uYW1lZDogMCJdPz8iIiksZGF0ZTpwYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSksCiAgIG5hbWU6U3RyaW5nKG9bIummrOWQjSJdfHxvLmhvcnNlfHwiIikudHJpbSgpLGhvcnNlOm5uKG9bIummrOWQjSJdfHxvLmhvcnNlKSxqb2NrZXk6am5uKG9bIumojuaJiyJdfHxvLmpvY2tleSksam5hbWU6U3RyaW5nKG9bIumojuaJiyJdfHxvLmpvY2tleXx8IiIpLnRyaW0oKSxmaW5pc2g6ZihvWyLnnYDpoIYiXT8/by5maW5pc2gpLAogICBkaXN0OmYoby5jb3Vyc2VfbGVuPz9vWyLot53pm6IiXT8/by5kaXN0YW5jZSl8fDAsc3VyZjpzdXJmQ29kZShvLnJhY2VfdHlwZXx8b1si6Iqd44OAIl18fG8uc3VyZmFjZSksCiAgIGFnZTphbT9OdW1iZXIoYW1bMV0pOm51bGwsbnVtOmYob1si6aas55WqIl0pLHBvcDpmKG9bIuS6uuawlyJdKSxvZGRzOmYob1si5Y2Y5YudIl0pLAogICBsdmw6KCgpPT57Y29uc3QgaWQ9U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/PyIiKTtpZigvXlxkezEyfSQvLnRlc3QoaWQpJiYhaXNKcmFWZW51ZShpZC5zbGljZSg0LDYpKSlyZXR1cm4gLTE7cmV0dXJuIGxldmVsT2ZMYWJlbChvWyJjbGFzcyJdfHxvLmNscyl9KSgpfTsKIH0KIC8qIOaIkOe4vuOCueODiOOCou+8iOaXpeS7mOaYh+mghuOBqyBhZGQg44GZ44KL77yJICovCiBmdW5jdGlvbiBTdG9yZSgpe3RoaXMuaD1uZXcgTWFwKCk7dGhpcy5qPW5ldyBNYXAoKX0KIFN0b3JlLnByb3RvdHlwZS5hZGQ9ZnVuY3Rpb24ocil7CiAgaWYoci5maW5pc2g9PW51bGx8fCFyLmhvcnNlKXJldHVybjsKICBjb25zdCB0Mz1yLmZpbmlzaD49MSYmci5maW5pc2g8PTM/MTowOwogIGxldCBoPXRoaXMuaC5nZXQoci5ob3JzZSk7aWYoIWgpdGhpcy5oLnNldChyLmhvcnNlLGg9e246MCx0b3AzOjAsd2luOjAsc3VtOjAsbGFzdDoiIixydW5zOltdLGx2Ont9fSk7CiAgaC5uKys7aC50b3AzKz10MztpZihyLmZpbmlzaD09PTEpaC53aW4rKztoLnN1bSs9ci5maW5pc2g7aWYoci5kYXRlPmgubGFzdCloLmxhc3Q9ci5kYXRlOwogIGNvbnN0IEw9ci5sdmx8fDA7KGgubHZbTF09aC5sdltMXXx8WzAsMF0pO2gubHZbTF1bMF0rKztoLmx2W0xdWzFdKz10MzsKICBoLnJ1bnMucHVzaChbZG51bShyLmRhdGUpLHIuZmluaXNoLHIuZGlzdCxyLnN1cmYsTF0pO2lmKGgucnVucy5sZW5ndGg+Nil7aC5ydW5zLnNvcnQoKGEsYik9PmFbMF0tYlswXSk7aC5ydW5zLnNoaWZ0KCl9CiAgaWYoci5qb2NrZXkpe2xldCBqPXRoaXMuai5nZXQoci5qb2NrZXkpO2lmKCFqKXRoaXMuai5zZXQoci5qb2NrZXksaj17bjowLHRvcDM6MH0pO2oubisrO2oudG9wMys9dDN9CiB9OwogLyog6aiO5omL77ya5a6M5YWo5LiA6Ie04oaS77yI55+t44GE6KGo6KiY44Gq44KJ77yJ5YmN5pa55LiA6Ie044GnMeS6uuOBq+e1nuOCjOOCi+OBqOOBjeOBoOOBkeaOoeeUqCAqLwogU3RvcmUucHJvdG90eXBlLmpvY2tleT1mdW5jdGlvbihuYW1lKXsKICBpZighbmFtZSlyZXR1cm4gbnVsbDsKICBjb25zdCBqPXRoaXMuai5nZXQobmFtZSk7aWYoailyZXR1cm4gajsKICBpZihuYW1lLmxlbmd0aDwyfHxuYW1lLmxlbmd0aD40KXJldHVybiBudWxsOwogIGlmKCF0aGlzLl9qa3x8dGhpcy5famtTaXplIT09dGhpcy5qLnNpemUpe3RoaXMuX2prPVsuLi50aGlzLmoua2V5cygpXTt0aGlzLl9qa1NpemU9dGhpcy5qLnNpemV9CiAgY29uc3QgYz10aGlzLl9qay5maWx0ZXIoaz0+ay5zdGFydHNXaXRoKG5hbWUpfHwobmFtZS5sZW5ndGg+PTMmJmsuc3RhcnRzV2l0aChuYW1lLnNsaWNlKDAsLTEpKSYmbmFtZS5sZW5ndGg8PWsubGVuZ3RoKSk7CiAgcmV0dXJuIGMubGVuZ3RoPT09MT90aGlzLmouZ2V0KGNbMF0pOm51bGw7CiB9OwogY29uc3QgbGF5b2ZmPShsYXN0LHRhcmdldCk9PntpZighbGFzdClyZXR1cm4gLjU7Y29uc3QgYT0obmV3IERhdGUodGFyZ2V0KS1uZXcgRGF0ZShsYXN0KSkvODY0ZTU7CiAgcmV0dXJuIGE8MjE/LjcyOmE8NjA/LjYyOmE8MTIwPy41NTphPDI0MD8uNDg6LjQyfTsKIC8qID09PT09IOWun+e4vuOBi+OCieWtpue/kuOBl+OBn+ODouODh+ODq++8iOeJueW+tOmHj+KGkjPnnYDlhoXnjofvvIkgPT09PT0gKi8KIGNvbnN0IEZOPVsiYmlhcyIsIm9mZnNldCIsIm5sb2ciLCJub0hpc3QiLCJmUyIsImZDIiwiYXZnRiIsInIzc2hhcmUiLCJyM2F2ZyIsImxhc3QxIiwibGFzdEJpZyIsImNvbmREaWZmIiwiZmlyc3RTdXJmIiwiZ2FwU2hvcnQiLCJnYXBMb25nIiwiZ2FwVkxvbmciLCJhZ2UzIiwiYWdlNCIsImFnZTciLCJzdGVwVXAiLCJzdGVwRG93biIsIndpblJhdGUiXTsKIGNvbnN0IEZKPVsialJlbCIsImpsb2ciLCJqTWlzcyJdOwogLyog5L+C5pWw44GvIHRvb2xzL2ZpdF9tb2RlbC5qcyDjgaflrabnv5LvvIgyMDIw5bm044Cc44Gu5pmC57O75YiX44OH44O844K/77yJ44CCe30g44KS572u5o+bICovCiBjb25zdCBNT0RFTD17ImNvcmUiOlswLjA1Mjk5LDAuOTk2OTcsMC4wNDk1MSwtMC4yNDU0MywtMC41MjgxMiwwLjkxOTQ2LC0wLjUxNDc2LC0wLjM0Nzg2LC0wLjU3OTA0LC0wLjU1MTE4LDAuMTY3NzMsMS4xMTgyLC0wLjM1MzA1LC0wLjExMTI4LC0wLjIyNzI4LC0wLjQwMTI5LDAuMTM3NzEsMC4yMTY2MiwtMC4zOTY3MywtMC4zNTMwNSwwLjAwNjE3LC0wLjU5NTY0XSwiZnVsbCI6WzAuNDA0MzMsMS4zNzAwNywwLjA2MjUxLC0wLjEyMjc5LC0wLjUwMjMyLDAuODI5NzgsLTAuMzk4OTUsLTAuMzAwNzIsLTAuNTE1NTksLTAuNTI1MzIsMC4xNTgzMiwxLjA2Njk1LC0wLjM4Mzc3LC0wLjA3MjgyLC0wLjIyNTY4LC0wLjM1MSwwLjE1MDI1LDAuMjEyNTMsLTAuNDEzMzQsLTAuMzIzMTksMC4wMDcyNiwtMC45Mzc5MiwwLjUzNTU3LDAuMDAzNjUsLTAuMjA2MDVdfTsKIGZ1bmN0aW9uIGZlYXRzKHIsc3RvcmUscmFjZSxOLHdpdGhKKXsKICBjb25zdCBiPWNsYW1wKDMvTiwuMDgsLjUpLGxiPWxvZ2l0KGIpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksbj1oP2gubjowLEx0PXJhY2UubHZsfHwwOwogIGNvbnN0IHBTPSgoaD9oLnRvcDM6MCkrMypiKS8obiszKSxmUz1sb2dpdChwUyktbGI7CiAgLy8g44Kv44Op44K56KOc5q2j77ya5L2O44GE44Kv44Op44K577yI5Zyw5pa544KS5ZCr44KA77yJ44Gn44Gu5aW96LWw44Gv5Ymy44KK5byV44GN44CB6auY44GE44Kv44Op44K544Gn44Gu5Yeh6LWw44Gv5Ymy44KK5byV44GPCiAgbGV0IGZDPWZTOwogIGlmKGgmJkx0PjApe2xldCBIPTAsTT0wOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhoLmx2KSl7Y29uc3QgTD1OdW1iZXIoayksW2NuLGN0XT1oLmx2W2tdO2NvbnN0IGc9TD09PTA/MDooTDwwPy0yOkwtTHQpOwogICAgSCs9Y3QqY2xhbXAoMSsuMypnLC40LDEuOCk7TSs9KGNuLWN0KSpjbGFtcCgxLS4zKmcsLjQsMS44KX0KICAgZkM9bG9naXQoKEgrMypiKS8oSCtNKzMpKS1sYn0KICBjb25zdCBydW5zPWg/aC5ydW5zOltdLHJjPXJ1bnMuc2xpY2UoLTMpLGxhc3RSPXJ1bnMubGVuZ3RoP3J1bnNbcnVucy5sZW5ndGgtMV06bnVsbDsKICBjb25zdCByM3NoYXJlPXJjLmxlbmd0aD9yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoL3JjLmxlbmd0aDowOwogIGNvbnN0IHIzYXZnPXJjLmxlbmd0aD9jbGFtcCgocmMucmVkdWNlKChhLHgpPT5hK3hbMV0sMCkvcmMubGVuZ3RoLTYpLzYsLTEsMik6MDsKICBjb25zdCBsYXN0MT1sYXN0Uj9jbGFtcCgobGFzdFJbMV0tNikvNiwtMSwyKTowLGxhc3RCaWc9bGFzdFImJmxhc3RSWzFdPj0xMD8xOjA7CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwO2xldCBjb25kRGlmZj0wLGZpcnN0U3VyZj0wOwogIGlmKHNjJiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmKCFkaXN0fHxNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApKTsKICAgaWYoY3IubGVuZ3RoKWNvbmREaWZmPShjci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoKzIqcFMpLyhjci5sZW5ndGgrMiktcFM7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKWZpcnN0U3VyZj0xfQogIGxldCBnYXA9bnVsbDtpZihoJiZoLmxhc3QmJnJhY2UuZGF0ZSlnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgY29uc3QgYT1yLmFnZXx8MDsKICBjb25zdCBzdGVwRD1sYXN0UiYmbGFzdFJbNF0+MCYmTHQ+MD9jbGFtcChMdC1sYXN0Uls0XSwtMywzKTowOwogIGNvbnN0IHg9WzEsbGIsTWF0aC5sb2coMStuKSxuPT09MD8xOjAsZlMsZkMsbj9jbGFtcCgoaC5zdW0vbi02KS82LC0xLDIpOjAscjNzaGFyZSxyM2F2ZyxsYXN0MSxsYXN0QmlnLGNvbmREaWZmLGZpcnN0U3VyZiwKICAgZ2FwIT1udWxsJiZnYXA8MjE/MTowLGdhcCE9bnVsbCYmZ2FwPjEyMD8xOjAsZ2FwIT1udWxsJiZnYXA+MjQwPzE6MCxhPT09Mz8xOjAsYT09PTQ/MTowLGE+PTc/MTowLHN0ZXBEPjA/c3RlcEQ6MCxzdGVwRDwwPy1zdGVwRDowLAogICBuPygoaC53aW4rLjMqYikvKG4rMS41KS1iKTowXTsKICBpZih3aXRoSil7Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpOwogICBpZihqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSk7eC5wdXNoKGxvZ2l0KHBKKS1sYixNYXRoLmxvZygxK2oubiksMCl9ZWxzZSB4LnB1c2goMCwwLDEpfQogIHJldHVybiB4OwogfQogY29uc3QgZG90PSh3LHgpPT57bGV0IHo9MDtmb3IobGV0IGk9MDtpPHgubGVuZ3RoO2krKyl6Kz0od1tpXXx8MCkqeFtpXTtyZXR1cm4gen07CiBjb25zdCBtb2RlbFo9KGtpbmQseCk9PmRvdChNT0RFTFtraW5kXSx4KTsKIC8qIDHpoK3jga7ntKDngrkobG9naXQp44Go44K/44Kw44CCY29tcCDjgafmiJDliIbjgpJPTi9PRkbjgafjgY3jgovvvIjmpJzoqLznlKjvvIkgKi8KIGZ1bmN0aW9uIGhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcD17fSl7CiAgY29tcD1PYmplY3QuYXNzaWduKHt9LERFRkFVTFQsY29tcCk7Y29uc3QgdXNlPWs9PmNvbXBba10hPT1mYWxzZSYmY29tcFtrXSE9PTA7CiAgY29uc3QgYj1jbGFtcCgzL04sLjEsLjUpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksaj1zdG9yZS5qLmdldChyLmpvY2tleSk7CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxuPWg/aC5uOjAsdGFncz1bXTtsZXQgej0wLGNvbmY9IuS9jiI7CiAgY29uc3QgcEg9KChoP2gudG9wMzowKSs0KmIpLyhuKzQpO3orPWxvZ2l0KHBIKTsKICBpZihuPj0yKWNvbmY9bj49NT8i6auYIjoi5LitIjtlbHNlIHRhZ3MucHVzaCh7dDoi5bGl5q205LiN6LazIixjOiJnIn0pOwogIGlmKG4+PTMpe2NvbnN0IHQzPWgudG9wMy9uLHc9aC53aW4vbjsKICAgaWYodDM+PS40MCYmdzw9LjIwKXRhZ3MucHVzaCh7dDpg5ZaE5oim5Z6LIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGVsc2UgaWYodDM+PS40NSl0YWdzLnB1c2goe3Q6YOWuieWumiAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBpZih1c2UoImF2ZyIpJiZoLnN1bS9uPD01KXorPS4xMn0KICBjb25zdCByYz1ydW5zLnNsaWNlKC0zKTsKICBpZih1c2UoInJlY2VudCIpJiZyYy5sZW5ndGg+PTIpe2NvbnN0IGMzPXJjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgsYXZnPXJjLnJlZHVjZSgocyx4KT0+cyt4WzFdLDApL3JjLmxlbmd0aDsKICAgeis9LjIyKihjMy9yYy5sZW5ndGgtcEgpKjM7aWYoYzM+PTIpdGFncy5wdXNoKHt0OmDov5Eke3JjLmxlbmd0aH3otbDjgacke2MzfeWbnjPnnYDlhoVgLGM6ImIifSk7CiAgIGNvbnN0IGxhc3Q9cnVuc1tydW5zLmxlbmd0aC0xXTsKICAgaWYobGFzdCYmbGFzdFsxXT49OCYmbj49NCYmaC50b3AzL24+PS4zNSl7eis9LjE1O3RhZ3MucHVzaCh7dDpg5YmN6LWwJHtsYXN0WzFdfeedgOOBi+OCieW3u+OBjei/lOOBl+S9meWcsGAsYzoibyJ9KX0KICAgaWYoYXZnPD00JiZyYy5sZW5ndGg+PTMpeis9LjA4fQogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDsKICBpZih1c2UoImNvbmQiKSYmc2MmJmRpc3QmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiZNYXRoLmFicyh4WzJdLWRpc3QpPD0yMDApOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSl7ei09LjM1O3RhZ3MucHVzaCh7dDpgJHtzYz09PTE/IuWIneOBruiKnSI6IuWIneOBruODgOODvOODiCJ977yI6YGO5Y676LWw44Gv5Yil6aas5aC077yJYCxjOiJvIn0pfQogICBpZihjci5sZW5ndGg+PTIpe2NvbnN0IHQzPWNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgscGM9KHQzKzIqcEgpLyhjci5sZW5ndGgrMik7CiAgICB6Kz1jbGFtcCgyKihwYy1wSCksLS41LC41KTtpZih0Mz49Mil0YWdzLnB1c2goe3Q6YOWQjOadoeS7tuOBpyR7dDN9LyR7Y3IubGVuZ3RofeWbnjPnnYDlhoVgLGM6ImIifSl9fQogIGlmKHVzZSgiam9ja2V5IikmJmomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KSxkaj1jbGFtcCguNioobG9naXQocEopLWxvZ2l0KGIpKSwtLjQsLjUpOwogICB6Kz1kajtpZihkaj49LjI1KXRhZ3MucHVzaCh7dDpg6aiO5omL5aW96Kq/IDPnnYDlhoUke01hdGgucm91bmQoai50b3AzL2oubioxMDApfSVgLGM6ImIifSl9CiAgaWYodXNlKCJsYXlvZmYiKSYmaCYmaC5sYXN0KXtjb25zdCBnYXA9TWF0aC5yb3VuZCgobmV3IERhdGUocmFjZS5kYXRlKS1uZXcgRGF0ZShoLmxhc3QpKS84NjRlNSk7CiAgIHorPS42KihsYXlvZmYoaC5sYXN0LHJhY2UuZGF0ZSktLjUpO2lmKGdhcD49MTgwKXRhZ3MucHVzaCh7dDpgJHtnYXB95pel44G244KKYCxjOiJvIn0pfQogIGlmKHVzZSgiYWdlIikpe2NvbnN0IGE9ci5hZ2V8fDU7aWYoYT09PTMpeis9LjEwO2Vsc2UgaWYoYT09PTQpeis9LjA1O2Vsc2UgaWYoYT49OCl7ei09LjE1O3RhZ3MucHVzaCh7dDpgJHthfeats2AsYzoibyJ9KX19CiAgcmV0dXJue3osdGFncyxjb25mLG59OwogfQogLyogMjAyM+W5tOS7pemZjeOBruaZguezu+WIl+aknOiovOOBp+OBriDntKDjga7lpb3otbDnjofihpLnqbTjgr7jg7zjg7Plrp/nuL7vvIjlubPlnYdwLCDlrp/nuL7vvIkgKi8KIGNvbnN0IENBTD1bWzAsMC4wMV0sWzAuMDIyLDAuMDE3XSxbMC4wNDYsMC4wMjJdLFswLjA3NSwwLjA0Nl0sWzAuMTA1LDAuMDY4XSxbMC4xMzUsMC4wODJdLFswLjE2NSwwLjA5OF0sWzAuMTkzLDAuMTAzXSxbMC4yMjQsMC4xMzhdLFswLjI1OSwwLjE2MV0sWzAuMzAyLDAuMTg3XSxbMC4zNTgsMC4yMTFdLFswLjQ1NCwwLjIyOV1dOwogLyog44Kq44OD44K644Gq44GX44Oi44O844OJ77yI5Lq65rCX44Gu5Luj55CG77yd6aiO5omL6L6844G/44Gu5a2m57+S44Oi44OH44Or44Gu6aCG5L2N44Gn56m044K+44O844Oz44KS5Yik5a6a77yJ44Gu6KOc5q2j6KGo44CCMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+S9nOaIkCAqLwogY29uc3QgQ0FMX1BST1hZPVtbMCwwLjAxM10sWzAuMDIyLDAuMDIxXSxbMC4wNDYsMC4wMjhdLFswLjA3NSwwLjA1Nl0sWzAuMTA1LDAuMDg2XSxbMC4xMzUsMC4xMTFdLFswLjE2NSwwLjEzNF0sWzAuMTkzLDAuMTQ2XSxbMC4yMjQsMC4yMDFdLFswLjI1OSwwLjIxOV0sWzAuMzAxLDAuMjYxXSxbMC4zNTUsMC4yOTZdLFswLjQzOSwwLjM2N11dOwogZnVuY3Rpb24gaW50ZXJwKFQscCl7Zm9yKGxldCBpPTE7aTxULmxlbmd0aDtpKyspaWYocDw9VFtpXVswXSl7Y29uc3RbYSxiXT1UW2ktMV0sW2MsZF09VFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gVFtULmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIGNhbGliRm9yKHAsbW9kZSl7cmV0dXJuIG1vZGU9PT0ib2RkcyI/aW50ZXJwKENBTCxwKTppbnRlcnAoQ0FMX1BST1hZLHApfQogZnVuY3Rpb24gY2FsaWIocCl7Zm9yKGxldCBpPTE7aTxDQUwubGVuZ3RoO2krKylpZihwPD1DQUxbaV1bMF0pe2NvbnN0W2EsYl09Q0FMW2ktMV0sW2MsZF09Q0FMW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBDQUxbQ0FMLmxlbmd0aC0xXVsxXX0KIGZ1bmN0aW9uIG5vcm1hbGl6ZVRvcDMoenMsdG90YWwpe2xldCBsbz0tOCxoaT04OwogIGZvcihsZXQgaT0wO2k8NjA7aSsrKXtjb25zdCBjPShsbytoaSkvMixzPXpzLnJlZHVjZSgoYSx6KT0+YStzaWdtb2lkKHorYyksMCk7aWYocz50b3RhbCloaT1jO2Vsc2UgbG89Y30KICBjb25zdCBjPShsbytoaSkvMjtyZXR1cm4genMubWFwKHo9PnNpZ21vaWQoeitjKSl9CiAvKiBIYXJ2aWxsZeazleOBp+WLneeOh+KGkjPnnYDlhoXnjocgKi8KIGZ1bmN0aW9uIHRvcDNGcm9tV2luKHB3KXtjb25zdCBUPXB3LnJlZHVjZSgoYSxiKT0+YStiLDApLHA9cHcubWFwKHg9PngvVCksbj1wLmxlbmd0aCxvdXQ9bmV3IEFycmF5KG4pLmZpbGwoMCk7CiAgZm9yKGxldCBpPTA7aTxuO2krKyl7bGV0IHM9cFtpXTsKICAgZm9yKGxldCBqPTA7ajxuO2orKylpZihqIT09aSl7cys9cFtqXSpwW2ldLygxLXBbal0pOwogICAgZm9yKGxldCBrPTA7azxuO2srKylpZihrIT09aSYmayE9PWopcys9cFtqXSpwW2tdLygxLXBbal0pKnBbaV0vKDEtcFtqXS1wW2tdKX0KICAgb3V0W2ldPXN9cmV0dXJuIG91dH0KIC8qIOODrOODvOOCueino+aekOOAgm9kZHMg44Gv5Lu75oSP77yI5YWo6aCt5YiG77yJ44CCICovCiBjb25zdCBMVk49WyLkuI3mmI4iLCLmnKrli53liKkiLCIx5YudIiwiMuWLnSIsIjPli50iLCJPUCJdOwogZnVuY3Rpb24gZXh0cmFUYWdzKHRhZ3MscixzdG9yZSxyYWNlKXsKICBjb25zdCB0PXRhZ3Muc2xpY2UoKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLEx0PXJhY2UubHZsfHwwOwogIGlmKGgpe2NvbnN0IGxhc3Q9aC5ydW5zLmxlbmd0aD9oLnJ1bnNbaC5ydW5zLmxlbmd0aC0xXTpudWxsOwogICBpZihsYXN0JiZsYXN0WzRdPjAmJkx0PjAmJmxhc3RbNF0hPT1MdCl0LnVuc2hpZnQobGFzdFs0XTxMdD97dDpg5piH57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoibyJ9Ont0OmDpmY3ntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJiIn0pOwogICBpZihoLmx2JiZoLmx2Wy0xXSl0LnB1c2goe3Q6IuWcsOaWueOBp+OBruWHuui1sOOBguOCiu+8iOWJsuW8leipleS+oe+8iSIsYzoiZyJ9KX0KICByZXR1cm4gdH0KIC8qIOODqeODs+OCr++8mueptOOCvuODvOODs+OBruW5s+Wdh+OBq+WvvuOBmeOCi+WAjeeOh+OBpyBTL0EvQi9D77yI5bGl5q2044GMMei1sOS7peS4i+OBr0Ljgb7jgafvvIkgKi8KIGNvbnN0IEFWR19IT0xFPXtvZGRzOi4wOTEscHJveHk6LjExNX07CiBmdW5jdGlvbiByYXRpbmcocGMsbW9kZSxuKXtjb25zdCByPXBjL0FWR19IT0xFW21vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga30KIC8qIOeahOS4reeOh+mHjeimlu+8muWun+e4vjPotbDku6XkuIrjg7vjg6njg7Pjgq9TL0Hjg7vvvIjjgqrjg4PjgrrjgYzliIbjgYvjgovjgajjgY3jga/vvInljZjli50zMOWAjeacqua6gOOBruWkp+eptOOCkumZpOOBj+OAgumBjuWOu+OBruaknOiovOOBp+OAgeeahOS4reeOh+OBjOS4iuOBjOOCiuOAgeWbnuWPjueOh+OBjOacgOaCquOBruWkp+eptOOCkumBv+OBkeOCieOCjOOBnyAqLwogY29uc3QgRk9DVVNfTUFYX09ERFM9MzA7CiBjb25zdCBGT0NVUz17Im9kZHMiOnsibiI6MzYyNSwiaGl0IjowLjIzMiwiYmFzZUhpdCI6MC4xNzIsInBlckRheSI6MTMuNn0sInByb3h5Ijp7Im4iOjQwMjUsImhpdCI6MC4yNzIsImJhc2VIaXQiOjAuMjE3LCJwZXJEYXkiOjE1LjF9fTsgICAvLyAyMDI05bm05Lul6ZmN44Gu5qSc6Ki877ya55qE5Lit546H77yIYmFzZUhpdD3lvpPmnaXjga4x5L2N5YCZ6KOc77yJ44O76ZaL5YKs5pel44GC44Gf44KK44Gu6aCt5pWwCiBmdW5jdGlvbiBwaWNrRm9jdXMocmVzLGspe3JldHVybiByZXMuZmlsdGVyKHg9PnguaG9sZSYmeC5uPj0zJiYocmF0aW5nKHgucGMseC5tb2RlLHgubik9PT0iUyJ8fHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IkEiKSYmKHgub2RkPT1udWxsfHx4Lm9kZDxGT0NVU19NQVhfT0REUykpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiAvKiDnqbTppqzlgJnoo5zvvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS44CB5aW96LWw546H44Gu6auY44GE6aCG44GrIGsg6aCt44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB5a++6LGh5aSWICovCiBmdW5jdGlvbiBwaWNrKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49Mykuc29ydCgoYSxiKT0+Yi5wLWEucCkuc2xpY2UoMCxrKX0KIGZ1bmN0aW9uIGFuYWx5emUocmFjZSxzdG9yZSxvZGRzLGNvbXAscG9wQXJyKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoOwogIGNvbnN0IHNjPVIubWFwKHI9PmhvcnNlU2NvcmUocixzdG9yZSxyYWNlLE4sY29tcCkpOwogIGNvbnN0IHpjPU1PREVMLmNvcmU/Ui5tYXAocj0+bW9kZWxaKCJjb3JlIixmZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpKTpzYy5tYXAoeD0+eC56KTsKICBjb25zdCBwPW5vcm1hbGl6ZVRvcDMoemMsTWF0aC5taW4oMyxOKSk7CiAgbGV0IG1rdD1udWxsLHBvcD1udWxsLG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7bWt0PXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpO3BvcD1vZGRzLm1hcChvPT4xK29kZHMuZmlsdGVyKHg9Png8bykubGVuZ3RoKTttb2RlPSJvZGRzIn0KICBlbHNlIGlmKHBvcEFyciYmcG9wQXJyLmxlbmd0aD09PU4mJnBvcEFyci5ldmVyeSh4PT54PjApKXtwb3A9cG9wQXJyLnNsaWNlKCk7bW9kZT0ib2RkcyJ9IC8vIOWun+mam+OBruS6uuawl+mghuS9jeOBoOOBkeWIhuOBi+OCi+OBqOOBje+8iOe1kOaenOODmuODvOOCuOeUseadpe+8iQogIGVsc2V7IC8vIOOCquODg+OCuuOCguS6uuawl+OCguOBquOBhOOBqOOBje+8mumojuaJi+aIkOe4vuOBvuOBp+WQq+OCgeOBn+OCueOCs+OCouOBrumghuS9jeOCkuOAjOS6uuawl+OBruS7o+eQhuOAjeOBq+OBmeOCi++8iOWun+mam+OBruS6uuawl+OBqOOBruebuOmWoiAwLjU14oaSMC42N++8iQogICBjb25zdCBweD1NT0RFTC5mdWxsP1IubWFwKHI9Pm1vZGVsWigiZnVsbCIsZmVhdHMocixzdG9yZSxyYWNlLE4sdHJ1ZSkpKTpSLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLHtqb2NrZXk6dHJ1ZSxsYXlvZmY6ZmFsc2V9KS56KTtwb3A9cHgubWFwKHY9PjErcHguZmlsdGVyKHk9Pnk+dikubGVuZ3RoKX0KICBjb25zdCByYW5rPXAubWFwKHY9PjErcC5maWx0ZXIoeD0+eD52KS5sZW5ndGgpOwogIGNvbnN0IGN1dD1NYXRoLm1heCg1LE1hdGguY2VpbChOKi40KSk7CiAgcmV0dXJuIFIubWFwKChyLGkpPT4oe2ksbm86ci5udW18fGkrMSxuYW1lOnIubmFtZXx8ci5ob3JzZSxwOnBbaV0scGM6Y2FsaWJGb3IocFtpXSxtb2RlKSxtb2RlLAogICBqbjooc3RvcmUuam9ja2V5KHIuam9ja2V5KXx8e246MH0pLm4scmFuazpyYW5rW2ldLHBvcDpwb3BbaV0sYmFzZTpNYXRoLm1pbiguNSwzL04pLAogICBvZGQ6KG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKT9vZGRzW2ldOm51bGwsCiAgIGNhcmVlcjooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP3tuOmgubix0MzpoLnRvcDMsd2luOmgud2lufTpudWxsfSkoKSwKICAgcmVjZW50OigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5ydW5zLm1hcCh4PT54WzFdKTpbXX0pKCksCiAgIGpuYW1lOnIuam5hbWV8fCIiLGpzdGF0OigoKT0+e2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTtyZXR1cm4gaiYmai5uPj0xP3tuOmoubixyYXRlOmoudG9wMy9qLm59Om51bGx9KSgpLAogICBob2xlOk4+PTYmJnBvcFtpXT49Y3V0LG1rdDpta3Q/bWt0W2ldOm51bGwsdmFsdWU6bWt0P2NhbGliRm9yKHBbaV0sIm9kZHMiKS9ta3RbaV06bnVsbCwKICAgdGFnczpleHRyYVRhZ3Moc2NbaV0udGFncyxyLHN0b3JlLHJhY2UpLGNvbmY6c2NbaV0uY29uZixuOnNjW2ldLm4sY3V0fSkpOwogfQoKIC8qID09PT09IOmJhOadv+i7uOmmrOODu+azouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul+OAguS/guaVsOOBryB0b29scy9heGlzX3Vwc2V0X3N0dWR5LmpzIOOBp+Wtpue/kuOAgTIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafmpJzoqLzvvIkgPT09PT0gKi8KIGNvbnN0IEFYSVM9eyJ3UCI6WzAuMDUxOTMsMS4wMTQ4MywwLjA1MTQ4LC0wLjIwNjc2LC0wLjUzMjE2LDAuOTE0MzcsLTAuNDg0NjQsLTAuMzIxMTUsLTAuNTY4MDIsLTAuNTUxMzUsMC4xNzM0NSwxLjA5NzQsLTAuMjg0MDcsLTAuMTAzOTcsLTAuMjE2MTcsLTAuMzQ2NjgsMC4xNTkxMywwLjIyMTk2LC0wLjM4NzMyLC0wLjM0NjU4LDAuMDAzNywtMC41NjY0Nl0sIndPIjpbMC41NDI1OSwwLjE1NjYxLDAuMDU0MTQsLTAuMDQzNzEsLTAuMTQ1MjQsMC4xMzE3MSwtMC4xNDE3OCwtMC4xNjI2MywwLjA1MzE2LC0wLjAyMDk3LDAuMDAzOSwtMC4yOTg2NSwtMC4zMjMyMSwtMC4wMTM2NSwtMC4wOTUxOSwtMC4wNzgxOCwwLjAwMDYsLTAuMDIyOTEsLTAuMTEyMTMsMC4wMTc4MSwtMC4wNDc0NSwtMC4xMDg1MiwwLjI1NzIxLDAuNjMwNzFdLCJ1cHNldCI6eyJ0aHIiOjE1LCJtb2RlbHMiOnsicHJveHkiOlsyLjI0NTU5LDAuNjM4NDEsLTAuMDcwOCwtMC4wODE2MSwtMC4wNzc0MywwLjA5MTM3LDAuMTM4NDcsMC4wMDI3OSwtMC4zODkxOSwtMC42NDIxNywtMC41NTM4MSwtMC4wMTgzNywtMC40NDMxNywtMC43NjgyNSwtMC41MjM5MywtMi43MzU2MSwtMC4xNDkwOSwwLjExNDc3XSwib2RkcyI6Wy0wLjcyMzk2LDAuNDI4MDgsLTAuMDc0OTksLTAuMDYxNTQsLTAuMDA2NzUsMC4wNzI0MywwLjA3MDg1LC0wLjA0OTc0LC0wLjE1NTI4LC0wLjMyNTE2LC0wLjQxODI2LC0wLjMxMzUxLDAuMjA3NTcsLTAuMjM5LC0wLjI3OTAxLC0xLjgyMTA4LC0wLjAwODUyLDAuMDgzOTksMC4xNTAyNCwwLjM1MjQyLC0yLjAzODM5LDIuODU2NjgsMC4yMjkyOSwwLjcyMDg0LC0xLjk3Nzk3XX0sImdyYWRlcyI6eyJwcm94eSI6eyJjdXRzIjpbWyJTU1MiLDAuNTUwMzddLFsiU1MiLDAuNDg1NV0sWyJTIiwwLjQwNDI0XSxbIkEiLDAuMjk4OF0sWyJCIiwwLjE4OTU3XSxbIkMiLDAuMDA2MjldXSwicmF0ZXMiOnsiU1NTIjowLjU3NCwiU1MiOjAuNTA5LCJTIjowLjQzMywiQSI6MC4zNDcsIkIiOjAuMjQ0LCJDIjowLjA4OX0sImF2Z1MiOnsiU1NTIjoxNy4yLCJTUyI6MTUuMywiUyI6MTQuMiwiQSI6MTMuMSwiQiI6MTEuOCwiQyI6OS44fX0sIm9kZHMiOnsiY3V0cyI6W1siU1NTIiwwLjYwOTY4XSxbIlNTIiwwLjUxNTk1XSxbIlMiLDAuNDA4NTRdLFsiQSIsMC4yODc2N10sWyJCIiwwLjE3MzU5XSxbIkMiLDAuMDA3NjhdXSwicmF0ZXMiOnsiU1NTIjowLjY3OSwiU1MiOjAuNTk4LCJTIjowLjQ1NSwiQSI6MC4zNTIsIkIiOjAuMjQ2LCJDIjowLjA3OX0sImF2Z1MiOnsiU1NTIjoxOC41LCJTUyI6MTYuNCwiUyI6MTQuNSwiQSI6MTMuMywiQiI6MTEuOCwiQyI6OS42fX19fSwiYmFuZHMiOnsi6YmE5p2/Ijp7ImxvIjowLjkyLCJoaSI6MSwibiI6MTY2LCJyYXRlIjowLjk2MzksImxvOTUiOjAuOTM1NSwibjIiOjg3LCJyYXRlMiI6MC45NzcsInBlckRheSI6MC42Mn0sIua6lumJhOadvyI6eyJsbyI6MC44OCwiaGkiOjAuOTIsIm4iOjI3OSwicmF0ZSI6MC44ODUzLCJsbzk1IjowLjg0NzksIm4yIjoxMzksInJhdGUyIjowLjg5OTMsInBlckRheSI6MS4wNH0sIuWghei7uCI6eyJsbyI6MC44NCwiaGkiOjAuODgsIm4iOjQ3NCwicmF0ZSI6MC44NDE4LCJsbzk1IjowLjgwODksIm4yIjoyMjYsInJhdGUyIjowLjg0MDcsInBlckRheSI6MS43OH19fTsKIGZ1bmN0aW9uIGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpewogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgseGM9Ui5tYXAocj0+ZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKTsKICBjb25zdCBwUD1ub3JtYWxpemVUb3AzKHhjLm1hcCh4PT5kb3QoQVhJUy53UCx4KSksTWF0aC5taW4oMyxOKSk7CiAgbGV0IHBPPW51bGw7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCksbTM9dG9wM0Zyb21XaW4ob2Rkcy5tYXAobz0+MS9vKSk7CiAgIHBPPW5vcm1hbGl6ZVRvcDMoeGMubWFwKCh4LGkpPT5kb3QoQVhJUy53TyxbLi4ueCxNYXRoLmxvZyhwd1tpXSksbG9naXQoTWF0aC5taW4oLjk4LG0zW2ldKSldKSksTWF0aC5taW4oMyxOKSl9CiAgcmV0dXJue3BQLHBPLHhjfX0KIC8qIOmJhOadv+i7uOmmrO+8muOCquODg+OCuuOBjOOBguOCi+ODrOODvOOCueOBoOOBkeOAguS6iOa4rOeiuueOh+OBruWMuuWIhuOBlOOBqOOBq+OAgemBjuWOu+OBruWun+mam+OBrjPnnYDlhoXnjofjgpLmt7vjgYjjgosgKi8KIGZ1bmN0aW9uIGF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTtpZighYXAucE8pcmV0dXJuIG51bGw7CiAgY29uc3Qgb3V0PVtdO2FwLnBPLmZvckVhY2goKHAsaSk9PnsKICAgZm9yKGNvbnN0IGsgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgYj1BWElTLmJhbmRzW2tdO2lmKHA+PWIubG8mJnA8KGs9PT0i6YmE5p2/Ij8xLjAxOmIuaGkpKXtvdXQucHVzaCh7aSxwLHRpZXI6ayxyYXRlOmIucmF0ZSxsbzk1OmIubG85NSxuOmIubn0pO2JyZWFrfX19KTsKICByZXR1cm4gb3V0LnNvcnQoKGEsYik9PmIucC1hLnApfQogLyog5rOi5Lmx5bqm77yaU1NT44CcQ+OAgjPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOBq+OBquOCi+eiuueOh+OBp+etiee0muOBpeOBkSAqLwogZnVuY3Rpb24gdXBzZXRHcmFkZShyYWNlLHN0b3JlLG9kZHMsYXApewogIGFwPWFwfHxheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKTsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHBzPWFwLnBQLnNsaWNlKCkuc29ydCgoYSxiKT0+Yi1hKTsKICBjb25zdCBucz1SLm1hcChyPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLm46MH0pLG1vbnRoPU51bWJlcihTdHJpbmcocmFjZS5kYXRlKS5zbGljZSg1LDcpKXx8MCxMPXJhY2UubHZsfHwwOwogIGNvbnN0IGY9WzEsTi8xNixMPT09MT8xOjAsTD09PTI/MTowLEw9PT0zPzE6MCxMPT09ND8xOjAsTD09PTU/MTowLHJhY2Uuc3VyZj09PTE/MTowLChyYWNlLmRpc3R8fDApLzIwMDAsCiAgIG5zLmZpbHRlcihuPT5uPT09MCkubGVuZ3RoL04sbnMuZmlsdGVyKG49Pm48MykubGVuZ3RoL04sbnMucmVkdWNlKChhLG4pPT5hK01hdGgubG9nKDErbiksMCkvTi8zLAogICBwc1swXSxwc1sxXSxwc1syXSxwcy5yZWR1Y2UoKGEscCk9PmErcCpwLDApLHBzLmZpbHRlcihwPT5wPi41KS5sZW5ndGgvMyxtb250aD49NiYmbW9udGg8PTk/MTowXTsKICBsZXQgbW9kZT0icHJveHkiOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLnNvcnQoKGEsYik9PmItYSksb2Q9b2Rkcy5zbGljZSgpLnNvcnQoKGEsYik9PmEtYik7CiAgIGNvbnN0IGVudD0tcHcucmVkdWNlKChhLHApPT5hK3AqTWF0aC5sb2cocCksMCkvTWF0aC5sb2coTik7CiAgIGYucHVzaChwd1swXSxwd1sxXSxwd1swXStwd1sxXStwd1syXSxlbnQsTWF0aC5sb2cob2RbMF0pLE1hdGgubG9nKG9kWzFdKSxvZC5maWx0ZXIobz0+bzwxMCkubGVuZ3RoL04pO21vZGU9Im9kZHMifQogIGNvbnN0IHA9c2lnbW9pZChkb3QoQVhJUy51cHNldC5tb2RlbHNbbW9kZV0sZikpLEc9QVhJUy51cHNldC5ncmFkZXNbbW9kZV07CiAgbGV0IGdyYWRlPSJDIjtmb3IoY29uc3QgW2csY10gb2YgRy5jdXRzKXtpZihwPj1jKXtncmFkZT1nO2JyZWFrfX0KICByZXR1cm57Z3JhZGUscCxtb2RlLHJhdGU6Ry5yYXRlc1tncmFkZV0sYXZnUzpHLmF2Z1NbZ3JhZGVdfX0KCiAvKiDmiZXmiLvjgaTjgY3mmYLns7vliJfjg5Djg4Pjgq/jg4bjgrnjg4jjgIJyYWNlcyDjga/ml6Xku5jmmIfpoIYgW3tpZCxkYXRlLHJvd3N9XeOAgXBheUJ5SWQg44GvIHtyYWNlSWQ6e3BsYWNlOlt7bnVtYmVyLHllbn1dfX3jgIIKICAgIOeptOOCvuODvOODs+OBr+Wun+OCquODg+OCuumghuS9jeOBp+Wumue+qe+8iOODhOODvOODq+OBruOCquODg+OCuuWFpeWKm+ODouODvOODieOBqOWQjOOBmOeKtuazge+8ieOAguWQhOODrOODvOOCuTEwMOWGhuOBmuOBpOizvOWFpeOAgiAqLwogZnVuY3Rpb24gYmFja3Rlc3QocmFjZXMscGF5QnlJZCxvcHRzKXsKICBvcHRzPW9wdHN8fHt9O2NvbnN0IFNUQVJUPW9wdHMuc3RhcnR8fCIiLFNQTElUPW9wdHMuc3BsaXR8fCIiLE9PUz1vcHRzLm9vc3x8IiIsUFJPWFk9ISFvcHRzLnByb3h5OwogIGNvbnN0IG5hbWVzPVsidG9wMSIsInRvcDIiLCJ0b3AzIiwiYWxsSG9sZSIsInZhbHVlIiwiYXhpcyIsImZvY3VzIl0scGVyPVsiYWxsIiwiQSIsIkIiLCJDIl07CiAgY29uc3QgUz17fTtmb3IoY29uc3QgbiBvZiBuYW1lcyl7U1tuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpU1tuXVtwXT17YmV0czowLGhpdHM6MCxyZXQ6MCxzcTowfX0KICBjb25zdCBTRUc9e307ICAgLy8gMeS9jeWAmeijnOOBruadoeS7tuWIpe+8iOWFqOacn+mWk++8j+WJjeWNiu+8j+W+jOWNiu+8iQogIGNvbnN0IHN0b3JlPW5ldyBTdG9yZSgpO2xldCB1c2VkPTA7CiAgY29uc3QgYWRkPShuLHAsaGl0LHllbik9Pntjb25zdCB4PVNbbl1bcF07eC5iZXRzKys7aWYoaGl0KXguaGl0cysrO3gucmV0Kz15ZW47eC5zcSs9eWVuKnllbn07CiAgY29uc3QgYWRkU2VnPShsYWJlbCxwLHllbik9Pntjb25zdCBnPVNFR1tsYWJlbF09U0VHW2xhYmVsXXx8e2FsbDp7bjowLGg6MCxyOjAscTowfSxBOntuOjAsaDowLHI6MCxxOjB9LEI6e246MCxoOjAscjowLHE6MH19O2Zvcihjb25zdCBrIG9mIFsiYWxsIixwXSl7Y29uc3QgeD1nW2tdO3gubisrO2lmKHllbj4wKXguaCsrO3gucis9eWVuO3gucSs9eWVuKnllbn19OwogIGNvbnN0IEFWPVBST1hZPy4xMTU6LjA5MTsKICBmb3IoY29uc3QgcmMgb2YgcmFjZXMpewogICAvLyDmiZXmiLvjga5JROOBr+OAjOaXpeS7mC3plovlgqzloLQtUueVquWPt+OAjeOAguODkOODg+OCr+OCouODg+ODl+OBrjEy5qGBSUTjgajjgoLjgIHlkIzjgZjlvaLlvI/jga5JROOBqOOCgue1kOOBs+S7mOOBkeOCiwogICBjb25zdCB2T2Y9L15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSg0LDYpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVszXXx8IiIsck9mPU51bWJlcigvXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDEwLDEyKTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbNF18fDApOwogICBjb25zdCBwYXk9cGF5QnlJZFtyYy5pZF18fHBheUJ5SWRbYCR7cmMuZGF0ZX0tJHt2T2Z9LSR7U3RyaW5nKHJPZikucGFkU3RhcnQoMiwiMCIpfWBdOwogICBpZihwYXkmJnBheS5wbGFjZSYmcGF5LnBsYWNlLmxlbmd0aCYmcmMuZGF0ZT49U1RBUlQpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAscnVubmVyczpSfTsKICAgICBjb25zdCByZXM9UFJPWFk/YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwpOihoYXNPZGRzP2FuYWx5emUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTphbmFseXplKHJhY2Usc3RvcmUsbnVsbCxudWxsLFIubWFwKHI9PnIucG9wKSkpOwogICAgIGNvbnN0IHllbj1uZXcgTWFwKHBheS5wbGFjZS5tYXAoeD0+W3gubnVtYmVyLHgueWVuXSkpOwogICAgIGNvbnN0IGhvbGU9cmVzLmZpbHRlcih4PT54LmhvbGUpLnNvcnQoKGEsYik9PmIucC1hLnApOwogICAgIGlmKGhvbGUubGVuZ3RoKXsKICAgICAgdXNlZCsrO2NvbnN0IHByPVNQTElUPyhyYy5kYXRlPFNQTElUPyJBIjoiQiIpOiJBIjsKICAgICAgY29uc3QgYnV5PShuLGxpc3QpPT57Zm9yKGNvbnN0IHggb2YgbGlzdCl7Y29uc3QgeT15ZW4uZ2V0KFJbeC5pXS5udW0pfHwwO2FkZChuLCJhbGwiLHk+MCx5KTthZGQobixwcix5PjAseSk7aWYoT09TJiZyYy5kYXRlPj1PT1MpYWRkKG4sIkMiLHk+MCx5KX19OwogICAgICBidXkoImZvY3VzIixwaWNrRm9jdXMocmVzLDEpKTsKICAgICAgYnV5KCJ0b3AxIixwaWNrKHJlcywxKSk7YnV5KCJ0b3AyIixwaWNrKHJlcywyKSk7YnV5KCJ0b3AzIixwaWNrKHJlcywzKSk7YnV5KCJhbGxIb2xlIixob2xlKTsKICAgICAgaWYoIVBST1hZKWJ1eSgidmFsdWUiLGhvbGUuZmlsdGVyKHg9PngudmFsdWU+PTEuMykpOwogICAgICBpZighUFJPWFkmJmhhc09kZHMpe2NvbnN0IGFwPWF4aXNQcm9icyhyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2lmKGFwLnBPKWJ1eSgiYXhpcyIsYXAucE8ubWFwKChwLGkpPT4oe2kscH0pKS5maWx0ZXIoeD0+eC5wPj1BWElTLmJhbmRzWyLpiYTmnb8iXS5sbykpfQogICAgICBjb25zdCB0PXBpY2socmVzLDEpWzBdOwogICAgICBpZih0KXtjb25zdCB5PXllbi5nZXQoUlt0LmldLm51bSl8fDAscj10LnBjL0FWLE49Ui5sZW5ndGg7CiAgICAgICBjb25zdCByYW5rPShyPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyIpOwogICAgICAgYWRkU2VnKCLjg6njg7Pjgq8iKyh0Lm48MiYmKHJhbms9PT0iUyJ8fHJhbms9PT0iQSIpPyJCIjpyYW5rKSxwcix5KTsKICAgICAgIGFkZFNlZyhOPD0xMD8i6aCt5pWwIOOAnDEwIjpOPD0xND8i6aCt5pWwIDEx44CcMTQiOiLpoK3mlbAgMTXjgJwiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2Uuc3VyZj09PTE/IuiKnSI6cmFjZS5zdXJmPT09Mj8i44OA44O844OIIjoi44Gd44Gu5LuWIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLmx2bD4wPyLjgq/jg6njgrkgIitMVk5bcmFjZS5sdmxdOiLjgq/jg6njgrkg5LiN5piOIixwcix5KTsKICAgICAgIGFkZFNlZyh0Lm4+PTU/IuWun+e4viA16LWw5Lul5LiKIjp0Lm4+PTM/IuWun+e4viAz44CcNOi1sCI6IuWun+e4viAz6LWw5pyq5rqAIixwcix5KTsKICAgICAgIGlmKCFQUk9YWSYmdC5vZGQpe2NvbnN0IG89dC5vZGQ7YWRkU2VnKG88OD8i5Y2Y5YudIOOAnDjlgI0iOm88MTU/IuWNmOWLnSA444CcMTXlgI0iOm88MzA/IuWNmOWLnSAxNeOAnDMw5YCNIjpvPDYwPyLljZjli50gMzDjgJw2MOWAjSI6IuWNmOWLnSA2MOWAjeOAnCIscHIseSk7CiAgICAgICAgaWYoaGFzT2Rkcyl7Y29uc3QgdWc9dXBzZXRHcmFkZShyYWNlLHN0b3JlLFIubWFwKHI9PnIub2RkcykpO2FkZFNlZygi5rOi5Lmx5bqmICIrdWcuZ3JhZGUscHIseSl9fX0KICAgICB9CiAgICB9CiAgIH0KICAgZm9yKGNvbnN0IHIgb2YgcmMucm93cylzdG9yZS5hZGQocik7CiAgfQogIGNvbnN0IGZpbj17fTsKICBmb3IoY29uc3QgbiBvZiBuYW1lcyl7ZmluW25dPXt9O2Zvcihjb25zdCBwIG9mIHBlcil7Y29uc3QgeD1TW25dW3BdOwogICBpZigheC5iZXRzKXtmaW5bbl1bcF09e2JldHM6MH07Y29udGludWV9CiAgIGNvbnN0IG1lYW49eC5yZXQveC5iZXRzLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHguc3EveC5iZXRzLW1lYW4qbWVhbikpOwogICBmaW5bbl1bcF09e2JldHM6eC5iZXRzLGhpdFJhdGU6eC5oaXRzL3guYmV0cyxyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHguYmV0cykvMTAwfX19CiAgY29uc3Qgc2Vncz17fTsKICBmb3IoY29uc3QgW2ssZ10gb2YgT2JqZWN0LmVudHJpZXMoU0VHKSl7c2Vnc1trXT17fTtmb3IoY29uc3QgcCBvZiBbImFsbCIsIkEiLCJCIl0pe2NvbnN0IHg9Z1twXTsKICAgaWYoIXgubil7c2Vnc1trXVtwXT17YmV0czowfTtjb250aW51ZX1jb25zdCBtZWFuPXguci94Lm4sc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5xL3gubi1tZWFuKm1lYW4pKTsKICAgc2Vnc1trXVtwXT17YmV0czp4Lm4saGl0UmF0ZTp4LmgveC5uLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5uKS8xMDB9fX0KICByZXR1cm57cmFjZXM6dXNlZCxzdGF0czpmaW4sc2Vnc307CiB9CiByZXR1cm57Rk9DVVMscmF0aW5nLHBpY2tGb2N1cyxBWElTLGF4aXNQcm9icyxheGlzUGlja3MsdXBzZXRHcmFkZSxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgovKiA9PT09PSDjgqLjg5fjg6rmnKzkvZMgPT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiIsQ1VSPW51bGwsTEFTVFJFUz1udWxsOwpjb25zdCBWRU5VRT17IjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLCIwNiI6IuS4reWxsSIsIjA3Ijoi5Lit5LqsIiwiMDgiOiLkuqzpg70iLCIwOSI6IumYquelniIsIjEwIjoi5bCP5YCJIn07CgovKiAtLS0gSW5kZXhlZERC77yI44GT44Gu44OE44O844Or5bCC55So77yJIC0tLSAqLwpmdW5jdGlvbiBvcGVuREIoKXtyZXR1cm4gbmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHI9aW5kZXhlZERCLm9wZW4oInVwc2V0X3Rvb2xfZGIiLDIpOwogci5vbnVwZ3JhZGVuZWVkZWQ9ZT0+e2NvbnN0IGQ9ZS50YXJnZXQucmVzdWx0O2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoImZpbGVzIikpZC5jcmVhdGVPYmplY3RTdG9yZSgiZmlsZXMiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpZC5jcmVhdGVPYmplY3RTdG9yZSgibWV0YSIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoInBheSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoInBheSIpfTsKIHIub25zdWNjZXNzPSgpPT57REI9ci5yZXN1bHQ7b2soKX07ci5vbmVycm9yPSgpPT5uZyhyLmVycm9yKTtyLm9uYmxvY2tlZD0oKT0+bmcobmV3IEVycm9yKCLku5bjga7jgr/jg5bjgafkvb/nlKjkuK3jgafjgZkiKSl9KX0KY29uc3QgaWRiQWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigiZmlsZXMiKS5vYmplY3RTdG9yZSgiZmlsZXMiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYlB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgiZmlsZXMiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoImZpbGVzIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6Iikpe21hcmtEaXJ0eSgiZmlsZXMiLGMua2V5KTtjLmRlbGV0ZSgpfWMuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9CmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuODh+ODvOOCv+acquWPluW+l+OBp+OBmeOAguS4iuOBruOAjOmBjuWOu+aIkOe4vuOBqOaJleaIu+OCkuWPluW+l+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBsZD1saXZlLm1hcChmPT5mLmRhdGUpLnNvcnQoKSxuUmFjZXM9bGl2ZS5yZWR1Y2UoKHMsZik9PnMrbmV3IFNldChmLnJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZSwwKTsKICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OX77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KLyogV29ya2Vy44GuIC9yZXN1bHRzIOOBruihjCDihpIg44OE44O844Or5YaF6YOo44Gu6KGMICovCmZ1bmN0aW9uIGxpdmVSb3coeCl7Y29uc3QgZj1wYXJzZUZsb2F0KFN0cmluZyh4LmZpbmlzaD8/IiIpLnJlcGxhY2UoL1teXGQuXS9nLCIiKSk7CiByZXR1cm57cmFjZUlkOlN0cmluZyh4LnJhY2VJZHx8IiIpLGRhdGU6VUUucGFyc2VEYXRlKHguZGF0ZSksbmFtZTpTdHJpbmcoeC5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpVRS5ubih4LmhvcnNlKSxqb2NrZXk6VUUuam5uKHguam9ja2V5KSwKICBmaW5pc2g6TnVtYmVyLmlzRmluaXRlKGYpJiZmPjA/ZjpudWxsLGRpc3Q6TnVtYmVyKHguZGlzdGFuY2UpfHwwLHN1cmY6VUUuc3VyZkNvZGUoeC5zdXJmYWNlKSxhZ2U6TnVtYmVyKHguYWdlKXx8bnVsbCxudW06TnVtYmVyKHgubnVtYmVyKXx8bnVsbCxwb3A6TnVtYmVyKHgucG9wKT4wP051bWJlcih4LnBvcCk6bnVsbCxvZGRzOm51bGwsam5hbWU6U3RyaW5nKHguam9ja2V5fHwiIikudHJpbSgpLAogIGx2bDooeC52ZW51ZUNvZGUmJiEvXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoeC52ZW51ZUNvZGUpKSk/LTE6KFVFLmxldmVsT2ZMYWJlbCh4LmNscyl8fFVFLmxldmVsT2ZQcml6ZSh4LnByaXplKSl9fQovKiDlr77osaHml6XjgojjgorliY3jga7lsaXmrbTjgaDjgZHjgafjgrnjg4jjgqLjgpLkvZzjgosgKi8KYXN5bmMgZnVuY3Rpb24gYnVpbGRTdG9yZSh0YXJnZXQpewogaWYoU1RPUkUmJlNUT1JFX0tFWT09PXRhcmdldClyZXR1cm4gU1RPUkU7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtsZXQgcm93cz0wLHVzZWQ9MDsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZnNbaV0ucm93c3x8W10pe2NvbnN0IHI9bGl2ZVJvdyh4KTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX19CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGZzW2ldLmNzdikpe2NvbnN0IHI9VUUudG9Sb3cobyk7cm93cysrO2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0KWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX0KICBhd2FpdCBzbGVlcCgwKTsKIH0KIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7U1RPUkUuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIC0tLSDjg6zjg7zjgrnpgbjmip4gLS0tICovCmZ1bmN0aW9uIHNob3dQYW5lKGspe2Zvcihjb25zdCBwIG9mWyJXb3JrZXIiLCJNYW51YWwiLCJQYXN0Il0pJCgicGFuZSIrcCkuc3R5bGUuZGlzcGxheT1wPT09az8iYmxvY2siOiJub25lIn0KJCgidGFiV29ya2VyIikub25jbGljaz0oKT0+c2hvd1BhbmUoIldvcmtlciIpOyQoInRhYk1hbnVhbCIpLm9uY2xpY2s9KCk9PnNob3dQYW5lKCJNYW51YWwiKTskKCJ0YWJQYXN0Iikub25jbGljaz0oKT0+c2hvd1BhbmUoIlBhc3QiKTsKZnVuY3Rpb24gc2V0UmFjZShyYWNlLGxhYmVsKXtpZihyYWNlLmtleSYmIXJhY2Uub2RkczApcmFjZS5vZGRzMD1vZGRzRm9yKHJhY2UpO0NVUj1yYWNlO0xBU1RSRVM9bnVsbDskKCJyYWNlbGFiZWwiKS50ZXh0Q29udGVudD1sYWJlbDskKCJydW4iKS5kaXNhYmxlZD1mYWxzZTskKCJvdXQiKS50ZXh0Q29udGVudD0i44CM6Kej5p6Q44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIn0KCi8qIFdvcmtlciAqLwpsZXQgV1JBQ0VTPVtdOwpsZXQgV0RJQUc9W107CmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSksd2FybmluZzp4Lndhcm5pbmd8fCIifX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CmZ1bmN0aW9uIHJlbmRlclZlbnVlQnV0dG9ucyhkKXsKIGNvbnN0IG5hbWVzPVsuLi5uZXcgU2V0KFdSQUNFUy5tYXAocj0+ci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKSldOwogbGV0IGg9bmFtZXMubWFwKCh2LGkpPT5gPGJ1dHRvbiBkYXRhLXY9IiR7aX0iIGNsYXNzPSJzdWIiPiR7ZXNjKHYpfe+8iCR7V1JBQ0VTLmZpbHRlcihyPT4oci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKT09PXYpLmxlbmd0aH1S77yJPC9idXR0b24+YCkuam9pbigiIik7CiBoKz1XRElBRy5maWx0ZXIoeD0+eC5lcnJ8fHguZW1wdHl8fHgucGFydGlhbCkubWFwKHg9PmA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj4ke2VzYyh4Lm5hbWUpfe+8miR7eC5lcnI/IuWPluW+l+WkseaVl++8iCIrZXNjKHguZXJyKS5zbGljZSgwLDQwMCkrIu+8iSI6eC5wYXJ0aWFsP2Ake3guY291bnR9UuOBl+OBi+WPluW+l+OBp+OBjeOBpuOBhOOBvuOBm+OCk++8iOmAmuW4uOOBrzEw44CcMTJS77yJYDpg5Ye66LWw6aas44KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5ICR7eC5lbXB0eX1S77yI6Zmk5aSW77yJYH0gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLXJldHJ5PSIke2VzYyh4LmNvZGV8fCIiKX0iPuWGjeWPluW+lzwvYnV0dG9uPjwvZGl2PmApLmpvaW4oIiIpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9aDsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtdl0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+bGlzdFZlbnVlKG5hbWVzW2IuZGF0YXNldC52XSxkKSk7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXJldHJ5XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5sb2FkVmVudWUoZCx7dmVudWVDb2RlOmIuZGF0YXNldC5yZXRyeSx2ZW51ZU5hbWU6IiJ9LHRydWUpKTsKfQphc3luYyBmdW5jdGlvbiBsb2FkVmVudWUoZCx2LHJlcmVuZGVyKXsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgcHJldj1XRElBRy5maW5kKHg9PlN0cmluZyh4LmNvZGUpPT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXUkFDRVM9V1JBQ0VTLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGUpIT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXRElBRz1XRElBRy5maWx0ZXIoeD0+U3RyaW5nKHguY29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIGNvbnN0IG5hbWU9di52ZW51ZU5hbWV8fChwcmV2JiZwcmV2Lm5hbWUpfHx2LnZlbnVlQ29kZTsKIHRyeXtjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLHYudmVudWVDb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGVtcHR5PXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV1JBQ0VTLnB1c2goLi4ub2spOwogIGNvbnN0IGVycnM9cmFjZXMuZmlsdGVyKGE9PmEuZXJyb3IpLm1hcChhPT5hLmVycm9yKTsKICBXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6b2subGVuZ3RoLGVtcHR5LHBhcnRpYWw6b2subGVuZ3RoPjAmJm9rLmxlbmd0aDwxMCxlcnI6IXJhY2VzLmxlbmd0aD8i44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIjooIW9rLmxlbmd0aCYmZXJycy5sZW5ndGg/ZXJyc1swXToiIil9KTsKIH1jYXRjaChlKXtXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6MCxlbXB0eTowLGVycjplLm1lc3NhZ2V9KX0KIGlmKHJlcmVuZGVyKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvIgke1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV9JHt4LmNvdW50fVJgKS5qb2luKCLvvI8iKX3vvIlgOyQoIndhbGwiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDskKCJvZGRzR2V0IikuZGlzYWJsZWQ9IVdSQUNFUy5sZW5ndGg7cmVuZGVyVmVudWVCdXR0b25zKGQpfQp9CiQoIndnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgid2RhdGUiKS52YWx1ZTtpZighZClyZXR1cm4gYWxlcnQoIuaXpeS7mOOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+WCrOWgtOOCkueiuuiqjeS4reKApiI7JCgid2xpc3QiKS5pbm5lckhUTUw9IiI7JCgiYWxsb3V0IikuaW5uZXJIVE1MPSIiO1dSQUNFUz1bXTtXRElBRz1bXTtXREFURT1kOyQoIndhbGwiKS5kaXNhYmxlZD10cnVlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD10cnVlO09ERFM9e307CiBsZXQgdmVudWVzPW51bGw7CiBsZXQgbGlzdERpYWc9IiIsYXZhaWxEYXRlcz1bXTtBVkFJTD1bXTsKIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0mbGlzdD0xYCk7aWYoci5vayl7Y29uc3QgeD1hd2FpdCByLmpzb24oKTt2ZW51ZXM9eC52ZW51ZXN8fFtdO2F2YWlsRGF0ZXM9eC5hdmFpbGFibGVEYXRlc3x8W107QVZBSUw9YXZhaWxEYXRlcztpZighdmVudWVzLmxlbmd0aClsaXN0RGlhZz1KU09OLnN0cmluZ2lmeSh4LmRpYWdub3N0aWNzfHxbXSkuc2xpY2UoMCw1MDApfX1jYXRjaChlKXt9CiB0cnl7CiAgaWYodmVudWVzJiYhdmVudWVzLmxlbmd0aCYmYXZhaWxEYXRlcy5sZW5ndGgmJiFhdmFpbERhdGVzLmluY2x1ZGVzKGQpKXsKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOBr0pSQeOBrumWi+WCrOaXpeOBp+OBr+OBguOCiuOBvuOBm+OCk+OAglxu5YWs6ZaL5Lit44Gu6ZaL5YKs5pel77yaJHthdmFpbERhdGVzLmpvaW4oIuOAgSIpfWA7CiAgICQoIndsaXN0IikuaW5uZXJIVE1MPWF2YWlsRGF0ZXMubWFwKHg9PmA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtZD0iJHt4fSI+JHt4fTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLWRdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnskKCJ3ZGF0ZSIpLnZhbHVlPWIuZGF0YXNldC5kOyQoIndnZXQiKS5jbGljaygpfSk7CiAgIHJldHVybjsKICB9CiAgaWYodmVudWVzJiZ2ZW51ZXMubGVuZ3RoKXsKICAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YOWPluW+l+S4reKApiAke3YudmVudWVOYW1lfe+8iCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfmuIjjgb/vvIlgO2F3YWl0IGxvYWRWZW51ZShkLHYsZmFsc2UpfQogIH1lbHNlewogICAvLyDml6dXb3JrZXLnrYnjgafplovlgqzloLTkuIDopqfjgYzkvb/jgYjjgarjgYTloLTlkIjvvJox5pel5YiG44KS5LiA5ous5Y+W5b6XCiAgICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5LiA5ous5Y+W5b6X5Lit4oCmIjsKICAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCwiIik7CiAgIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCk7V1JBQ0VTPW9rOwogICBpZihyYWNlcy5sZW5ndGg+b2subGVuZ3RoKVdESUFHLnB1c2goe2NvZGU6IiIsbmFtZToi5LiA6YOoIixjb3VudDpvay5sZW5ndGgsZW1wdHk6cmFjZXMubGVuZ3RoLW9rLmxlbmd0aCxlcnI6IiJ9KTsKICB9CiAgaWYoIVdSQUNFUy5sZW5ndGgpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66LWw6aas44Gk44GN44Gu44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KT44Gn44GX44Gf44CCXG4iK1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV977yaJHt4LmVycnx8IuWHuui1sOmmrOOBquOBlyJ9YCkuam9pbigiXG4iKSsobGlzdERpYWc/Ilxu6Ki65pat77yaIitsaXN0RGlhZzoiIik7cmVuZGVyVmVudWVCdXR0b25zKGQpO3JldHVybn0KICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpdgKyhXRElBRy5sZW5ndGg/YO+8iCR7V0RJQUcubWFwKHg9PmAke3gubmFtZX0ke3guY291bnR9UmApLmpvaW4oIu+8jyIpfe+8iWA6IiIpOwogICQoIndhbGwiKS5kaXNhYmxlZD1mYWxzZTskKCJvZGRzR2V0IikuZGlzYWJsZWQ9ZmFsc2U7cmVuZGVyVmVudWVCdXR0b25zKGQpOwogfWNhdGNoKGUpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UrIlxu77yIV29ya2Vy44GM5pyq5YWs6ZaL77yPQ09SU++8j+aXpeS7mOOBq+mWi+WCrOOBquOBl+OAgeOBruWPr+iDveaAp++8iSJ9Cn07CmZ1bmN0aW9uIGxpc3RWZW51ZSh2LGQpewogY29uc3QgcnM9V1JBQ0VTLmZpbHRlcihyPT4oci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKT09PXYpLnNvcnQoKGEsYik9PihhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICQoIndsaXN0IikuaW5uZXJIVE1MPXJzLm1hcCgocixrKT0+YDxidXR0b24gZGF0YS1rPSIke2t9Ij4ke3IucmFjZU51bWJlcnx8aysxfVIgJHtlc2Moci5yYWNlTmFtZXx8IiIpfTwvYnV0dG9uPmApLmpvaW4oIiIpOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+e2NvbnN0IHI9cnNbYi5kYXRhc2V0LmtdOwogIGNvbnN0IGhzPShyLmhvcnNlc3x8ci5ydW5uZXJzKTsKICBjb25zdCByYWNlPW1rUmFjZShyLGQpOwogIHNldFJhY2UocmFjZSxgJHtkfSAke3Z9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZXx8Ij8ifSR7ci5kaXN0YW5jZXx8Ij8ifW3jg7ske2hzLmxlbmd0aH3poK3vvIlgKTsKIH0pOwp9CgpmdW5jdGlvbiBta1JhY2UocixkKXsKIGNvbnN0IGhzPShyLmhvcnNlc3x8ci5ydW5uZXJzKTsKIHJldHVybntkYXRlOmQsa2V5OmAke1N0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoci5yYWNlTnVtYmVyKXx8MH1gLHN1cmY6VUUuc3VyZkNvZGUoci5zdXJmYWNlKSxkaXN0Ok51bWJlcihyLmRpc3RhbmNlKXx8MCxsdmw6VUUubGV2ZWxPZkxhYmVsKHIuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKHIucmFjZU5hbWUpLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjtyZXR1cm57bmFtZSxob3JzZTpVRS5ubihuYW1lKSxqb2NrZXk6VUUuam5uKGguam9ja2V5fHwiIiksam5hbWU6U3RyaW5nKGguam9ja2V5fHwiIikudHJpbSgpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KS5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQpsZXQgV0RBVEU9IiIsQVZBSUw9W107Ci8qIOWFqOODrOODvOOCueS4gOaLrO+8muWQhOODrOODvOOCueOBrueptOmmrOWAmeijnO+8iOS4iuS9jTLpoK3vvInjgpLkuIDopqfjgavjgZnjgosgKi8KYXN5bmMgZnVuY3Rpb24gcnVuQWxsKGJveElkPSJhbGxvdXQiKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGNvbnN0IGJveD0kKGJveElkKTsKIGNvbnN0IGQ9V0RBVEU7bGV0IHRleHQ9YCR7ZH0g56m06aas5aW96LWw77yI5LiK5L2N5YCZ6KOc77yJXG5gOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiAgY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVOYW1lfHxhLnZlbnVlfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZU5hbWV8fGIudmVudWV8fCIiKSwiamEiKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogIGNvbnN0IGdhcD1zdG9yZS5sYXN0RGF0ZT9NYXRoLnJvdW5kKChuZXcgRGF0ZShkKS1uZXcgRGF0ZShzdG9yZS5sYXN0RGF0ZSkpLzg2NGU1KTpudWxsOwogIGxldCBoPShmb2N1c09uKCk/YDxkaXYgY2xhc3M9InNtYWxsIj7il47nmoTkuK3njofph43oppbvvJrlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9BJHtPYmplY3Qua2V5cyhPRERTKS5sZW5ndGg/IuODu+WNmOWLnTMw5YCN5pyq5rqAIjoiIn3jga7nqbTppqzjgaDjgZHjgpLooajnpLrjgILpgY7ljrvjga7nmoTkuK3njofjga/ntIQke01hdGgucm91bmQoVUUuRk9DVVNbT2JqZWN0LmtleXMoT0REUykubGVuZ3RoPyJvZGRzIjoicHJveHkiXS5oaXQqMTAwMCkvMTB9Je+8iOW+k+adpeOBrjHkvY3lgJnoo5zjga/ntIQke01hdGgucm91bmQoVUUuRk9DVVNbT2JqZWN0LmtleXMoT0REUykubGVuZ3RoPyJvZGRzIjoicHJveHkiXS5iYXNlSGl0KjEwMDApLzEwfSXvvInjgII8L2Rpdj5gOiIiKStgPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuWPjeaYoO+8miR7T2JqZWN0LmtleXMoT0REUykubGVuZ3RofeODrOODvOOCueWIhu+8iOacquWPluW+l+OBruODrOODvOOCueOBr+ODhOODvOODq+aOqOWumuOBruS6uuawl+OBp+WIpOWumu+8iTwvZGl2PjxkaXYgY2xhc3M9InNtYWxsIj7lrabnv5Ljg4fjg7zjgr/mnIDntYLml6XvvJoke2VzYyhzdG9yZS5sYXN0RGF0ZXx8IuS4jeaYjiIpfe+8j+eptOOCvuODvOODs+OBr+ODhOODvOODq+aOqOWumuOBruS6uuawl++8iOmojuaJi+aIkOe4vui+vOOBv++8ieOBp+WIpOWumuOAguWun+mam+OBruS6uuawl+OBqOOBr+eVsOOBquOCiuOBvuOBmTwvZGl2PmAsdEg9MCx0Tj0wLGpIPTAsak1pc3M9W10sbm9Db3Vyc2U9W107CiAgaWYoZ2FwIT1udWxsJiZnYXA+MTQpaCs9YDxkaXYgY2xhc3M9Indhcm4iPuKaoCDmnIDmlrDjga7miJDnuL7jgYwke2dhcH3ml6XliIblhaXjgaPjgabjgYTjgb7jgZvjgpPjgILnm7Tov5Hjga7lpb3otbDjg7vlh6HotbDjgYzlj43mmKDjgZXjgozjgarjgYTngrnjgavms6jmhI/jgZfjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogIGgrPSI8YnI+IjsKICBycy5mb3JFYWNoKChyLGspPT57CiAgIGNvbnN0IHJhY2U9bWtSYWNlKHIsZCksbj1yYWNlLnJ1bm5lcnMubGVuZ3RoLHY9ci52ZW51ZU5hbWV8fHIudmVudWV8fCIiOwogICBjb25zdCBsYWJlbD1gJHt2fSR7ci5yYWNlTnVtYmVyfHxrKzF9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlJiZyLmRpc3RhbmNlP3Iuc3VyZmFjZStyLmRpc3RhbmNlKyJtIjoi44Kz44O844K55LiN5piOIn3jg7ske2596aCt77yJYDsKICAgaWYoIShyLnN1cmZhY2UmJnIuZGlzdGFuY2UpKW5vQ291cnNlLnB1c2goe2xhYmVsOmAke3Z9JHtyLnJhY2VOdW1iZXJ8fGsrMX1SYCxyYXc6ci5jb3Vyc2VSYXd8fCIifSk7CiAgIHRleHQrPWBcbuKWoCR7bGFiZWx9XG5gOwogICBsZXQgYm9keT0iIjsKICAgaWYobjw2KWJvZHk9JzxzcGFuIGNsYXNzPSJzbWFsbCI+Numgreacqua6gOOBruOBn+OCgeWvvuixoeWkljwvc3Bhbj4nOwogICBlbHNlewogICAgY29uc3Qgb2Q9b2Rkc0ZvcihyYWNlKSxyZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxjPShmb2N1c09uKCk/VUUucGlja0ZvY3VzKHJlcywyKTpVRS5waWNrKHJlcywyKSk7e2NvbnN0IG09bWF0Y2hJbmZvKHJlcyk7dEgrPW0uaDt0Tis9bS5uO2pIKz1tLmo7ak1pc3MucHVzaCguLi5tLm1pc3MpfQogICAgYm9keT1jLm1hcCh4PT57Y29uc3QgdGc9eC50YWdzLnNsaWNlKDAsMikubWFwKHQ9PnQudCkuam9pbigi77yPIik7CiAgICAgdGV4dCs9YCAgJHt4Lm5vfeeVqiAke3gubmFtZX0gJHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX0gJHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JSAke3RnfVxuYDsKICAgICB0ZXh0Kz1gICAgICR7cmVjTGluZSh4KX3vvI8ke3guam5hbWV8fCLpqI7miYvkuI3mmI4ifSR7eC5vZGQ/YO+8j+WNmOWLnSR7eC5vZGR95YCNKCR7eC5wb3B955Wq5Lq65rCXKWA6IiJ9XG5gOwogICAgIHJldHVybiBgPGRpdj48Yj4ke2VzYyh4Lm5vKX3nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByJHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX0iPiR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSXvvIjnqbTjgr7jg7zjg7PlubPlnYfjga4keyh4LnBjL0FWR1t4Lm1vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKS50b0ZpeGVkKDEpfeWAjeODu+S/oemgvOW6piR7ZXNjKHguY29uZil977yJPC9zcGFuPjxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHJlY0xpbmUoeCkpfe+8jyR7ZXNjKHguam5hbWV8fCLpqI7miYvkuI3mmI4iKX0ke3gub2RkP2DvvI88Yj7ljZjli50ke3gub2RkfeWAje+8iCR7eC5wb3B955Wq5Lq65rCX77yJPC9iPmA6IiJ9PC9zcGFuPjxicj5gK3gudGFncy5zbGljZSgwLDMpLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKStgPC9kaXY+YH0pLmpvaW4oIiIpfHwnPHNwYW4gY2xhc3M9InNtYWxsIj7lrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gu5YCZ6KOc44Gq44GX77yd5a++6LGh5aSWPC9zcGFuPic7CiAgIH0KICAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKGxhYmVsKX08L2I+PGJyPiR7Ym9keX08YnI+PGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWs9IiR7a30iPuips+e0sOODu+OCquODg+OCuuWFpeWKmzwvYnV0dG9uPjwvZGl2PmA7CiAgfSk7CiAgaD1oLnJlcGxhY2UoJzxicj4nLGA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7dEh9LyR7dE596aCt77yI6YGO5Y6744GrMui1sOS7peS4iu+8ie+8j+mojuaJiyAke2pIfS8ke3ROfemgrTwvZGl2PmArKGpNaXNzLmxlbmd0aCYmakg8dE4qLjY/YDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDpqI7miYvjgpLpgY7ljrvjg4fjg7zjgr/jgajnhaflkIjjgafjgY3jgabjgYTjgarjgYTkvovvvJoke2VzYyhbLi4ubmV3IFNldChqTWlzcyldLnNsaWNlKDAsNikuam9pbigi44CBIikpfTwvZGl2PmA6IiIpKyh0TiYmdEg8dE4qLjU/JzxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDnhaflkIjjgafjgY3jgZ/ppqzjgYzljYrliIbmnKrmuoDjgafjgZnjgILoi6Xpp5LmiKbjgYzkuK3lv4Pjga7ml6Xjga/mraPluLjjgafjgZnjgYzjgIHjgZ3jgYbjgafjgarjgZHjgozjgbDppqzlkI3ooajoqJjjga7kuI3kuIDoh7Tjga7lj6/og73mgKfjgYzjgYLjgorjgb7jgZnjgII8L2Rpdj4nOicnKSsnPGJyPicpOwogIGlmKG5vQ291cnNlLmxlbmd0aCloPWgucmVwbGFjZSgnPGJyPicsYDxkaXYgY2xhc3M9Indhcm4gc21hbGwiPuKaoCDjgrPjg7zjgrnvvIjoip3jg4Djg7vot53pm6LvvInjgpLoqq3jgb/lj5bjgozjgabjgYTjgarjgYTjg6zjg7zjgrnvvJoke2VzYyhub0NvdXJzZS5tYXAoeD0+eC5sYWJlbCkuam9pbigi44CBIikpfeOAguOBneOBruODrOODvOOCueOBr+OAgeiKneODgOODu+i3nembouOCkuS9v+OBhuWIpOWumuOBjOW8seOBj+OBquOCiuOBvuOBmeOAgiR7bm9Db3Vyc2VbMF0ucmF3PyLvvIjoqLrmlq3vvJoiK2VzYyhub0NvdXJzZVswXS5yYXcuc2xpY2UoMCw3MCkpKyLvvIkiOiIifTwvZGl2Pjxicj5gKTsKICBoKz0nPGJ1dHRvbiBjbGFzcz0iY29weUFsbCI+5LiA6Kan44KS44OG44Kt44K544OI44Gn44Kz44OU44O8PC9idXR0b24+JzsKICBib3guaW5uZXJIVE1MPWg7CiAgYm94LnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLWtdIikuZm9yRWFjaChidD0+YnQub25jbGljaz0oKT0+e2NvbnN0IHI9cnNbYnQuZGF0YXNldC5rXTtzZXRSYWNlKG1rUmFjZShyLGQpLGAke2R9ICR7ci52ZW51ZU5hbWV8fHIudmVudWV8fCIifSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ9YCk7JCgicnVuIikuc2Nyb2xsSW50b1ZpZXcoe2JlaGF2aW9yOiJzbW9vdGgifSk7cnVuKG51bGwpfSk7CiAgY29uc3QgY2I9Ym94LnF1ZXJ5U2VsZWN0b3IoIi5jb3B5QWxsIik7Y2Iub25jbGljaz1hc3luYygpPT57dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHRleHQpO2NiLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpe2FsZXJ0KCLjgrPjg5Tjg7zjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ8iKX19OwogfWNhdGNoKGUpe2J1c3koZmFsc2UpO2JveC5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kuIDmi6zop6PmnpDjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9CiQoIndhbGwiKS5vbmNsaWNrPSgpPT5ydW5BbGwoImFsbG91dCIpOwovKiDmiYvlhaXlipsgKi8KJCgibWRhdGUiKS52YWx1ZT1uZXcgRGF0ZShEYXRlLm5vdygpKzg2NDAwMDAwKjMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CiQoIndkYXRlIikudmFsdWU9JCgibWRhdGUiKS52YWx1ZTskKCJwZGF0ZSIpLnZhbHVlPSIyMDI2LTA2LTIxIjsKJCgibWdvIikub25jbGljaz0oKT0+ewogY29uc3QgbGluZXM9JCgibXRleHQiKS52YWx1ZS5zcGxpdCgvXHI/XG4vKS5tYXAocz0+cy50cmltKCkpLmZpbHRlcihCb29sZWFuKSxycz1bXSxvZGRzPVtdOwogZm9yKGNvbnN0IGwgb2YgbGluZXMpe2NvbnN0IG09bC5tYXRjaCgvXihcZHsxLDJ9KVtccyzjgIBdKyhcUys/KSg/OltccyzjgIBdKyhbXGQuXSspKT8kLyk7aWYobSl7cnMucHVzaCh7bmFtZTptWzJdLGhvcnNlOlVFLm5uKG1bMl0pLGpvY2tleToiIixhZ2U6bnVsbCxudW06K21bMV19KTtvZGRzLnB1c2gobVszXT8rbVszXTowKX19CiBpZihycy5sZW5ndGg8MilyZXR1cm4gYWxlcnQoIuOAjOmmrOeVqiDppqzlkI3jgI3jga7lvaLlvI/jgacy6aCt5Lul5LiK5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCByYWNlPXtkYXRlOiQoIm1kYXRlIikudmFsdWUsc3VyZjorJCgibXN1cmYiKS52YWx1ZSxkaXN0OiskKCJtZGlzdCIpLnZhbHVlfHwwLHJ1bm5lcnM6cnMsb2RkczA6b2Rkcy5ldmVyeShvPT5vPjEpP29kZHM6bnVsbH07CiBzZXRSYWNlKHJhY2UsYCR7cmFjZS5kYXRlfSDmiYvlhaXlipvvvIgke3JhY2Uuc3VyZj09PTE/IuiKnSI6IuODgOODvOODiCJ9JHtyYWNlLmRpc3R9beODuyR7cnMubGVuZ3Rofemgre+8iWApOwp9OwovKiDpgY7ljrvjg6zjg7zjgrkgKi8KbGV0IFBSQUNFUz1bXTsKJCgicGdldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJwZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybjskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuaknOe0ouS4reKApiI7JCgicGxpc3QiKS5pbm5lckhUTUw9IiI7CiB0cnl7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZihyLmRhdGUhPT1kfHwhci5yYWNlSWQpcmV0dXJuO2lmKCFtYXAuaGFzKHIucmFjZUlkKSltYXAuc2V0KHIucmFjZUlkLFtdKTttYXAuZ2V0KHIucmFjZUlkKS5wdXNoKHIpfSk7CiAgUFJBQ0VTPVsuLi5tYXAuZW50cmllcygpXS5maWx0ZXIoKFssdl0pPT52Lmxlbmd0aD49Nikuc29ydCgoYSxiKT0+dmVudWVPZklkKGFbMF0pLmxvY2FsZUNvbXBhcmUodmVudWVPZklkKGJbMF0pKXx8cmFjZU5vT2ZJZChhWzBdKS1yYWNlTm9PZklkKGJbMF0pKTsKICBpZighUFJBQ0VTLmxlbmd0aCl7JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLjgZ3jga7ml6Xjga7jg6zjg7zjgrnjga/kv53lrZjjg4fjg7zjgr/jgavjgYLjgorjgb7jgZvjgpPjgIIiO3JldHVybn0KICAkKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9YCR7UFJBQ0VTLmxlbmd0aH3jg6zjg7zjgrlgOwogIGNvbnN0IGxhYj1pZD0+YCR7VkVOVUVbdmVudWVPZklkKGlkKV18fHZlbnVlT2ZJZChpZCl9JHtyYWNlTm9PZklkKGlkKX1SYDsKICAkKCJwbGlzdCIpLmlubmVySFRNTD1QUkFDRVMubWFwKChbaWQsdl0sayk9PmA8YnV0dG9uIGRhdGEtaz0iJHtrfSI+JHtsYWIoaWQpfe+8iCR7dlswXS5zdXJmPT09MT8i6IqdIjoi44OAIn0ke3ZbMF0uZGlzdH1t44O7JHt2Lmxlbmd0aH3poK3vvIk8L2J1dHRvbj5gKS5qb2luKCIiKTsKICAkKCJwbGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57Y29uc3QgW2lkLHZdPVBSQUNFU1tiLmRhdGFzZXQua107CiAgIGNvbnN0IHJzPXYuZmlsdGVyKHI9PnIuaG9yc2UpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSkubWFwKHI9Pih7bmFtZTpyLm5hbWV8fHIuaG9yc2UsaG9yc2U6ci5ob3JzZSxqb2NrZXk6ci5qb2NrZXksam5hbWU6ci5qbmFtZXx8IiIsYWdlOnIuYWdlLG51bTpyLm51bSxhY3Q6ci5maW5pc2gscG9wOnIucG9wLG9kZHNBOnIub2Rkc30pKTsKICAgY29uc3QgcmFjZT17ZGF0ZTpkLHN1cmY6dlswXS5zdXJmLGRpc3Q6dlswXS5kaXN0LGx2bDp2WzBdLmx2bHx8MCxydW5uZXJzOnJzLHBhc3Q6dHJ1ZX07CiAgIHNldFJhY2UocmFjZSxgJHtkfSAke2xhYihpZCl977yI6YGO5Y6744Os44O844K544O7JHtycy5sZW5ndGh96aCt77yJYCk7fSk7CiB9Y2F0Y2goZSl7JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KfTsKCi8qIC0tLSDop6PmnpDjg7vooajnpLogLS0tICovCi8qIOODqeODs+OCr+OBr+ijnOato+W+jOOBruWlvei1sOeOh+OBp+WIpOWumu+8iOODouODvOODieOBlOOBqOOBq+eptOOCvuODvOODs+OBruW5s+Wdh+OBjOmBleOBhu+8muOCquODg+OCuuWFpeWKm+aZguOBr+e0hDkl44CB44Kq44OD44K644Gq44GX44Gv57SEMTMl77yJICovCmNvbnN0IEFWRz17b2RkczouMDkxLHByb3h5Oi4xMTV9OyAgIC8vIOeptOOCvuODvOODs+OBruWun+a4rOW5s+Wdh++8iDIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPvvIkKY29uc3QgZm9jdXNPbj0oKT0+e2NvbnN0IGU9JCgiZm9jdXNPbiIpO3JldHVybiAhZXx8ZS5jaGVja2VkfTsKY29uc3QgcmF0aW5nPShwLG1vZGUsbik9Pntjb25zdCByPXAvKEFWR1ttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSk7bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfTsgIC8vIOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44GnCi8qIOWAmeijnOOBlOOBqOOBruOAjOagueaLoOOAjeihqOekuu+8muWlvei1sOeOh+OBqOOBneOBrummrOOBruWun+e4vuOBjOmjn+OBhOmBleOBo+OBpuimi+OBiOOBquOBhOOCiOOBhuOAgeWun+e4vuODu+Wfuua6luODu+mojuaJi+OCkuS4puOBueOCiyAqLwpmdW5jdGlvbiByZWNMaW5lKHgpewogY29uc3QgcD1bXTsKIHAucHVzaCh4LmNhcmVlciYmeC5jYXJlZXIubj9g6YCa566XJHt4LmNhcmVlci5ufei1sCAz552A5YaFJHt4LmNhcmVlci50M33lm57vvIgke01hdGgucm91bmQoeC5jYXJlZXIudDMveC5jYXJlZXIubioxMDApfSXvvIlgOiLpgJrnrpfvvJrlsaXmrbTjgarjgZciKTsKIGlmKHgucmVjZW50JiZ4LnJlY2VudC5sZW5ndGgpcC5wdXNoKGDnm7Tov5EgJHt4LnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGApOwogcmV0dXJuIHAuam9pbigi77yPIik7Cn0KZnVuY3Rpb24gYmFzZUxpbmUoeCl7cmV0dXJuIGDnqbTjgr7jg7zjg7Pjga7lubPlnYcgJHthdmdOb3RlKHgubW9kZSl9IOKGkiDjgZPjga7ppqzjga8keyh4LnBjL0FWR1t4Lm1vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKS50b0ZpeGVkKDEpfeWAje+8iFPiiacyLjLlgI3vvI9B4omnMS435YCN77yPQuKJpzEuM+WAje+8iWB9CmZ1bmN0aW9uIGpvY2tleUxpbmUoeCl7CiBpZigheC5qbmFtZSlyZXR1cm4gIumojuaJi++8muiqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCkyI7CiByZXR1cm4geC5qc3RhdCYmeC5qc3RhdC5uPj01P2DpqI7miYvvvJoke3guam5hbWV977yI6YGO5Y67JHt4LmpzdGF0Lm596aiO5LmXIDPnnYDlhoUke01hdGgucm91bmQoeC5qc3RhdC5yYXRlKjEwMCl9Je+8iWA6YOmojuaJi++8miR7eC5qbmFtZX3vvIjpgY7ljrvjg4fjg7zjgr/jgavoqbLlvZPjgarjgZfjgIHjgb7jgZ/jga/pqI7kuZfjgYzlsJHjgarjgYTvvIlgOwp9CmNvbnN0IGF2Z05vdGU9bW9kZT0+bW9kZT09PSJvZGRzIj8i57SEOSUiOiLntIQxMiUiOwovKiDlsaXmrbTjga7nhaflkIjnirbms4HvvIjppqzlkI3jg7vpqI7miYvlkI3jgYzpgY7ljrvjg4fjg7zjgr/jgajkuIDoh7TjgZfjgZ/jgYvvvIkgKi8KY29uc3QgbWF0Y2hJbmZvPXJlcz0+e2NvbnN0IG49cmVzLmxlbmd0aCxoPXJlcy5maWx0ZXIoeD0+eC5uPj0yKS5sZW5ndGgsaj1yZXMuZmlsdGVyKHg9Pnguam4+PTUpLmxlbmd0aDtyZXR1cm57bixoLGosbWlzczpyZXMuZmlsdGVyKHg9Pnguam48NSYmeC5qbmFtZSkubWFwKHg9Pnguam5hbWUpfX07CmFzeW5jIGZ1bmN0aW9uIHJ1bihvZGRzSW4pewogaWYoIUNVUilyZXR1cm47CiB0cnl7CiAgY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShDVVIuZGF0ZSk7CiAgbGV0IG9kZHM9b2Rkc0lufHxudWxsOwogIGlmKCFvZGRzJiZDVVIub2RkczApb2Rkcz1DVVIub2RkczA7CiAgaWYoIW9kZHMmJkNVUi5wYXN0JiZDVVIucnVubmVycy5ldmVyeShyPT5yLm9kZHNBPjEpKW9kZHM9Q1VSLnJ1bm5lcnMubWFwKHI9PnIub2Rkc0EpOwogIGNvbnN0IHBvcEFycj0oIW9kZHMmJkNVUi5wYXN0JiZDVVIucnVubmVycy5ldmVyeShyPT5yLnBvcD4wKSk/Q1VSLnJ1bm5lcnMubWFwKHI9PnIucG9wKTpudWxsOwogIGNvbnN0IHJlcz1VRS5hbmFseXplKENVUixzdG9yZSxvZGRzLG51bGwscG9wQXJyKTsKICBMQVNUUkVTPXtyZXMsb2Rkcyxjb3VudDpzdG9yZS5jb3VudH07cmVuZGVyKCk7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgib3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kej5p6Q44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfQpmdW5jdGlvbiByZW5kZXIoKXsKIGNvbnN0e3JlcyxvZGRzLGNvdW50fT1MQVNUUkVTLE49cmVzLmxlbmd0aCxjdXQ9cmVzWzBdLmN1dCxwYXN0PSEhQ1VSLnBhc3Q7CiBpZihOPDYpeyQoIm91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPjbpoK3mnKrmuoDjga7jgZ/jgoHnqbTppqzliKTlrprjga7lr77osaHlpJbjgafjgZnjgII8L3NwYW4+JztyZXR1cm59CiBjb25zdCB1c2VkPSEhcmVzWzBdLm1rdCxjYW5kcz1VRS5waWNrKHJlcyw1KTtjb25zdCBmc2V0PW5ldyBTZXQoVUUucGlja0ZvY3VzKHJlcyw5OSkubWFwKHg9PnguaSkpOwogbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj7kurrmsJfpoIbvvJoke3VzZWQ/IuWFpeWKm+OCquODg+OCuiI6IuODhOODvOODq+aOqOWumu+8iOmojuaJi+aIkOe4vui+vOOBv+ODu+Wun+mam+OBruS6uuawl+OBqOOBr+eVsOOBquOCiuOBvuOBme+8iSJ977yP56m044K+44O844Oz77yaJHtjdXR955Wq55uu5Lul6ZmN77yI5YWoJHtOfemgre+8ie+8j+Wtpue/kiAke2NvdW50LnRvTG9jYWxlU3RyaW5nKCl96KGMPC9kaXY+YDsKIHtjb25zdCBtPW1hdGNoSW5mbyhyZXMpO2grPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5bGl5q2044Gu54Wn5ZCI77ya6aasICR7bS5ofS8ke20ubn3poK3vvIgy6LWw5Lul5LiK77yJ77yP6aiO5omLICR7bS5qfS8ke20ubn3poK08L2Rpdj5gKyhtLm1pc3MubGVuZ3RoP2A8ZGl2IGNsYXNzPSJzbWFsbCI+6aiO5omL44Gu5pyq54Wn5ZCI77yaJHtlc2MobS5taXNzLnNsaWNlKDAsNikuam9pbigi44CBIikpfSR7bS5taXNzLmxlbmd0aD42PyIg4oCmIjoiIn08L2Rpdj5gOiIiKTtpZihtLmg8bS5uKi41KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6YGO5Y676LWw44KS54Wn5ZCI44Gn44GN44Gf6aas44GM5bCR44Gq44GE44Gf44KB44CB5LqI5oOz44Gu5L+h6aC85bqm44Gv5L2O44KB44Gn44GZ77yI5paw6aas5oim44O76Iul6aeS5oim44CB44G+44Gf44Gv6aas5ZCN6KGo6KiY44Gu6YGV44GE77yJ44CCPC9kaXY+YH0KIGgrPSI8YnI+IjsKIGlmKCFjYW5kcy5sZW5ndGgpaCs9JzxzcGFuIGNsYXNzPSJ3YXJuIj7nqbTjgr7jg7zjg7PjgavjgIHlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gu5YCZ6KOc44GM44GE44G+44Gb44KT77yI5paw6aas5oim44O76Iul6aeS5oim44Gq44Gp77yJ44CC44GT44Gu44Os44O844K544Gv5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7CiBjYW5kcy5mb3JFYWNoKCh4LGspPT57CiAgY29uc3QgY2hpcHM9eC50YWdzLm1hcCh0PT5gPHNwYW4gY2xhc3M9ImNoaXAgJHt0LmN9Ij4ke2VzYyh0LnQpfTwvc3Bhbj5gKS5qb2luKCIiKTsKICBjb25zdCByPUNVUi5ydW5uZXJzW3guaV07CiAgaCs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7aysxfS4gJHtlc2MoeC5ubyl955WqICR7ZXNjKHgubmFtZSl9PC9iPiR7ZnNldC5oYXMoeC5pKT8nIDxzcGFuIGNsYXNzPSJjaGlwIGIiPuKXjueahOS4reeOh+mHjeimljwvc3Bhbj4nOicnfSA8c3BhbiBjbGFzcz0icnQgciR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9Ij4ke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfTwvc3Bhbj5gOwogIGlmKHBhc3QpaCs9YCA8c3BhbiBjbGFzcz0ic21hbGwiPuKGkiDntZDmnpwgJHtyLmFjdD8/Ii0ifeedgO+8iCR7ci5wb3A/PyItIn3kurrmsJfvvIkke3IuYWN0PD0zPyIg4pyFIjoiIn08L3NwYW4+YDsKICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWlvei1sOeOhyA8Yj4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC9iPu+8iOeptOOCvuODvOODs+W5s+WdhyAke2F2Z05vdGUoeC5tb2RlKX3vvInvvI/kv6HpoLzluqYgJHtlc2MoeC5jb25mKX08YnI+JHtlc2MocmVjTGluZSh4KSl9PGJyPiR7ZXNjKGJhc2VMaW5lKHgpKX08YnI+JHtlc2Moam9ja2V5TGluZSh4KSl9JHt4Lm9kZD9gPGJyPjxiPuWNmOWLnSR7eC5vZGR95YCN77yIJHt4LnBvcH3nlarkurrmsJfvvIk8L2I+YDoiIn1gOwogIGlmKHgubWt0IT1udWxsKWgrPWA8YnI+5biC5aC044Gu5oOz5a6aM+edgOWGhSAkeyh4Lm1rdCoxMDApLnRvRml4ZWQoMSl9JSDihpIg5biC5aC044Go44Gu5beuICR7eC52YWx1ZT49Mz8iM+WAjeS7peS4iiI6eC52YWx1ZS50b0ZpeGVkKDIpKyLlgI0ife+8iOWPguiAg++8muaknOiovOOBp+OBr+W9k+OBn+OCiuOBq+e1kOOBs+S7mOOBjeOBvuOBm+OCk+OBp+OBl+OBn++8iWA7CiAgaCs9YDwvZGl2PjxkaXY+JHtjaGlwc3x8JzxzcGFuIGNsYXNzPSJzbWFsbCI+55uu56uL44Gk5qC55oug44Gq44GXPC9zcGFuPid9PC9kaXY+PC9kaXY+YDsKIH0pOwogaCs9YDxicj48Yj7lhajpoK3kuIDopqc8L2I+JHtwYXN0PyLvvIjlrp/pmpvjga7ntZDmnpzjgaTjgY3vvIkiOiLvvIjljZjli53jgqrjg4PjgrrjgpLlhaXjgozjgovjgajlppnlkbPjgpLoqIjnrpfvvIkifTx0YWJsZT48dGhlYWQ+PHRyPjx0aD7ppqznlao8L3RoPjx0aD7ppqzlkI08L3RoPjx0aD7pqI7miYs8L3RoPjx0aD7lpb3otbDnjoc8L3RoPjx0aD7poIbkvY08L3RoPjx0aD7jgqrjg4Pjgro8L3RoPiR7cGFzdD8iPHRoPue1kOaenDwvdGg+IjoiIn08L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiBmb3IoY29uc3QgeCBvZiByZXMpe2NvbnN0IHI9Q1VSLnJ1bm5lcnNbeC5pXTsKICBoKz1gPHRyJHt4LmhvbGU/JyBzdHlsZT0iYmFja2dyb3VuZDojZmZiODAwMjIiJzonJ30+PHRkPiR7ZXNjKHgubm8pfTwvdGQ+PHRkPiR7ZXNjKHgubmFtZSl9PC90ZD48dGQ+JHtlc2MoeC5qbmFtZXx8Ij8iKX08L3RkPjx0ZD4keyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+JHt4LnJhbmt9PC90ZD48dGQ+PGlucHV0IGNsYXNzPSJvZGRzIiBkYXRhLWk9IiR7eC5pfSIgdHlwZT0ibnVtYmVyIiBzdGVwPSIwLjEiIG1pbj0iMS4xIiBpbnB1dG1vZGU9ImRlY2ltYWwiIHZhbHVlPSIke29kZHM/b2Rkc1t4LmldOiIifSIgc3R5bGU9IndpZHRoOjYycHg7cGFkZGluZzo0cHgiPjwvdGQ+JHtwYXN0P2A8dGQ+JHtyLmFjdD8/Ii0ifeedgDwvdGQ+YDoiIn08L3RyPmB9CiBoKz1gPC90Ym9keT48L3RhYmxlPjxidXR0b24gaWQ9InJlY2FsYyI+44Kq44OD44K644KS5Y+N5pig44GX44Gm5YaN6KiI566XPC9idXR0b24+PGJ1dHRvbiBpZD0iY2xlYXJvZGRzIiBjbGFzcz0ic3ViIj7jgqrjg4PjgrrjgpLjgq/jg6rjgqI8L2J1dHRvbj5gOwogJCgib3V0IikuaW5uZXJIVE1MPWg7CiAkKCJyZWNhbGMiKS5vbmNsaWNrPSgpPT57Y29uc3Qgdj1bLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiI291dCBpbnB1dC5vZGRzIildLm1hcChlPT5wYXJzZUZsb2F0KGUudmFsdWUpKTtydW4odi5ldmVyeShvPT5vPjEpP3Y6bnVsbCl9OwogJCgiY2xlYXJvZGRzIikub25jbGljaz0oKT0+e0NVUi5vZGRzMD1udWxsO0NVUi5wYXN0PUNVUi5wYXN0O0xBU1RSRVM9bnVsbDtydW4obnVsbCl9Owp9CiQoInJ1biIpLm9uY2xpY2s9KCk9PnJ1bihudWxsKTsKJCgiZmlsZSIpLm9uY2hhbmdlPWU9Pntjb25zdCBmPWUudGFyZ2V0LmZpbGVzWzBdO2lmKGYpaW1wb3J0RmlsZShmKS50aGVuKCgpPT57ZS50YXJnZXQudmFsdWU9IiJ9KX07CgovKiAtLS0g5omV5oi744O75pyI44Gu5Y+W5b6X54q25rOB77yISW5kZXhlZERC77yJIC0tLSAqLwpjb25zdCBwYXlBbGw9KCk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJwYXkiKS5vYmplY3RTdG9yZSgicGF5IikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBwYXlQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJwYXkiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJwYXkiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoInBheSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBtZXRhR2V0PWs9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKCJtZXRhIikub2JqZWN0U3RvcmUoIm1ldGEiKS5nZXQoayk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0KTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IG1ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgibWV0YSIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwphc3luYyBmdW5jdGlvbiBwYXlTdGF0ZSgpe2F3YWl0IHNob3dTdGF0ZSgpfQoKLyogLS0tIOWFsemAmuOBruWPluW+l++8iOWGjeippuihjOOBpOOBje+8iSAtLS0gKi8KbGV0IFNZTkNJTkc9ZmFsc2U7CmFzeW5jIGZ1bmN0aW9uIGZldGNoSlNPTih1cmwsd2FpdHNBcmcpewogbGV0IGVycj0iIjtjb25zdCB3YWl0cz13YWl0c0FyZ3x8d2luZG93Ll9fV0FJVFN8fFs0MDAwLDEyMDAwLDMwMDAwLDYwMDAwXTsKIGZvcihsZXQgdD0wO3Q8PXdhaXRzLmxlbmd0aDt0KyspewogIHRyeXsKICAgY29uc3Qgcj1hd2FpdCBmZXRjaCh1cmwpO2NvbnN0IHR4dD1hd2FpdCByLnRleHQoKTtsZXQgeD17fTt0cnl7eD1KU09OLnBhcnNlKHR4dCl9Y2F0Y2goZSl7fQogICBpZighci5va3x8eC5vaz09PWZhbHNlKXtjb25zdCBlPW5ldyBFcnJvcih4LmVycm9yfHxgSFRUUCAke3Iuc3RhdHVzfWArKHR4dCYmIXguZXJyb3I/YO+8iCR7dHh0LnJlcGxhY2UoL1xzKy9nLCIgIikuc2xpY2UoMCw1MCl977yJYDoiIikpO2Uuc3RhdHVzPXIuc3RhdHVzO3Rocm93IGV9CiAgIHJldHVybiB4OwogIH1jYXRjaChlKXsKICAgZXJyPWUubWVzc2FnZTtjb25zdCByZXRyeT0hZS5zdGF0dXN8fGUuc3RhdHVzPj01MDB8fGUuc3RhdHVzPT09NDI5OwogICBpZighcmV0cnl8fHQ9PT13YWl0cy5sZW5ndGgpYnJlYWs7CiAgIGlmKFNZTkNJTkcpJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWDmt7fpm5Hjga7jgZ/jgoEke01hdGgucm91bmQod2FpdHNbdF0vMTAwMCl956eS5b6F44Gj44Gm5YaN6Kmm6KGM44GX44G+44GZ4oCm77yIJHtlcnJ977yJYDsKICAgYXdhaXQgc2xlZXAod2FpdHNbdF0pOwogIH0KIH0KIHRocm93IG5ldyBFcnJvcihlcnIpOwp9CmNvbnN0IE1PREVMX1RSQUlOX0VORD0iMjAyNi0wNi0yMiI7ICAgLy8g54++5Zyo44Gu44Oi44OH44Or44Gv44CB44GT44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gn5a2m57+SCmNvbnN0IGpzdFllc3RlcmRheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMy04NjRlNSkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKY29uc3QgYWRkRGF5cz0oZCxuKT0+bmV3IERhdGUobmV3IERhdGUoZCsiVDAwOjAwOjAwWiIpLmdldFRpbWUoKStuKjg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpmdW5jdGlvbiBtb250aHNCZXR3ZWVuKGEsYil7Y29uc3Qgb3V0PVtdO2xldFt5LG1dPWEuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpO2NvbnN0W3kyLG0yXT1iLnNsaWNlKDAsNykuc3BsaXQoIi0iKS5tYXAoTnVtYmVyKTsKIHdoaWxlKHk8eTJ8fCh5PT09eTImJm08PW0yKSl7b3V0LnB1c2goYCR7eX0tJHtTdHJpbmcobSkucGFkU3RhcnQoMiwiMCIpfWApO20rKztpZihtPjEyKXttPTE7eSsrfX1yZXR1cm4gb3V0fQoKLyogLS0tIOKRoCDjg4fjg7zjgr/lj5blvpfvvJrpgY7ljrvmiJDnuL7vvIjkurrmsJfjgaTjgY3vvInvvIvmiZXmiLvjgpLjgIHplovlgqzml6XjgZTjgajjgavlj5blvpfjgZfjgabkv53lrZggLS0tICovCmNvbnN0IFNZTkNfQkFUQ0g9NCxTWU5DX1BBUkFMTEVMPTI7CmxldCBTU1RPUD1mYWxzZSxCQUNLVVBfREFURVM9bnVsbDsKJCgic3luY1N0b3AiKS5vbmNsaWNrPSgpPT57U1NUT1A9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPXRydWV9OwokKCJzZW5kIikudmFsdWU9anN0WWVzdGVyZGF5KCk7CmFzeW5jIGZ1bmN0aW9uIGJhY2t1cERhdGVzKCl7CiBpZihCQUNLVVBfREFURVMpcmV0dXJuIEJBQ0tVUF9EQVRFUzsKIGNvbnN0IHM9bmV3IFNldCgpLGZzPWF3YWl0IGlkYkFsbCgpOwogZm9yKGNvbnN0IGYgb2YgZnMpe2lmKGYubGl2ZSljb250aW51ZTtmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSl7Y29uc3QgZD1VRS5wYXJzZURhdGUoby5kYXRlfHxvWyLml6Xku5giXSk7aWYoZClzLmFkZChkKX1hd2FpdCBzbGVlcCgwKX0KIHJldHVybiBCQUNLVVBfREFURVM9czsKfQphc3luYyBmdW5jdGlvbiBmZXRjaERheShiYXNlLGQpewogY29uc3QgZGF5PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5P2RhdGU9JHtkfWApOwogY29uc3QgcmFjZXM9ZGF5LnJhY2VzfHxbXTtpZighcmFjZXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIik7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTxyYWNlcy5sZW5ndGg7aSs9U1lOQ19CQVRDSCljaHVua3MucHVzaChyYWNlcy5zbGljZShpLGkrU1lOQ19CQVRDSCkubWFwKHg9PnguY25hbWUpKTsKIGNvbnN0IHJvd3M9W10scGF5b3V0cz1bXTtsZXQgaWR4PTAsZmFpbGVkTj0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShpZHg8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1pZHgrKzsKICBjb25zdCByZXM9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1yZXN1bHRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCk7CiAgcm93cy5wdXNoKC4uLihyZXMucm93c3x8W10pKTtwYXlvdXRzLnB1c2goLi4uKHJlcy5wYXlvdXRzfHxbXSkpO2ZhaWxlZE4rPShyZXMuZmFpbGVkfHxbXSkubGVuZ3RofX07CiBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHtsZW5ndGg6TWF0aC5taW4oU1lOQ19QQVJBTExFTCxjaHVua3MubGVuZ3RoKX0sd29ya2VyKSk7CiBjb25zdCBnb3Q9bmV3IFNldChyb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemU7CiBmYWlsZWROPU1hdGgubWF4KGZhaWxlZE4scmFjZXMubGVuZ3RoLWdvdCk7CiByZXR1cm57cm93cyxwYXlvdXRzLGZhaWxlZE4scmFjZXM6cmFjZXMubGVuZ3RofTsKfQokKCJzeW5jR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgYT0kKCJzc3RhcnQiKS52YWx1ZXx8IjIwMjMtMDEtMDEiLHlkPWpzdFllc3RlcmRheSgpO2xldCBiPSQoInNlbmQiKS52YWx1ZXx8eWQ7aWYoYj55ZCliPXlkOwogaWYoYT5iKXskKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+Wni+aXpeOBjOe1guS6huaXpeOCiOOCiuW+jOOBp+OBmeOAgiI7cmV0dXJufQogU1NUT1A9ZmFsc2U7U1lOQ0lORz10cnVlOyQoInN5bmNHbyIpLmRpc2FibGVkPXRydWU7JCgic3luY1N0b3AiKS5kaXNhYmxlZD1mYWxzZTsKIGNvbnN0IHN0PXtkYXlzOjAscmFjZXM6MCxza2lwcGVkOjAsZmFpbDpbXSx0MDpEYXRlLm5vdygpfTtsZXQgY29uc2VjPTA7CiB0cnl7CiAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PSLkv53lrZjmuIjjgb/jg4fjg7zjgr/jgpLnorroqo3kuK3igKYiOwogIGNvbnN0IGZpbGVzPWF3YWl0IGlkYkFsbCgpLGhhdmVMaXZlPW5ldyBTZXQoZmlsZXMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCkubWFwKGY9PmYuZGF0ZSkpOwogIGNvbnN0IGhhdmVQYXk9bmV3IFNldCgoYXdhaXQgcGF5QWxsKCkpLmZpbHRlcihwPT4hcC5mYWlsZWQpLm1hcChwPT5wLmRhdGUpKTsKICBjb25zdCBiaz1hd2FpdCBiYWNrdXBEYXRlcygpOwogIGNvbnN0IG1vbnRocz1tb250aHNCZXR3ZWVuKGEsYiksY3VyTW9udGg9eWQuc2xpY2UoMCw3KTsKICBmb3IobGV0IG1pPTA7bWk8bW9udGhzLmxlbmd0aDttaSsrKXsKICAgaWYoU1NUT1ApYnJlYWs7Y29uc3QgbW9udGg9bW9udGhzW21pXTsKICAgaWYobW9udGg8Y3VyTW9udGgmJmF3YWl0IG1ldGFHZXQoIm1vbnRoOiIrbW9udGgpKXtjb250aW51ZX0KICAgJCgic3luY1N0YXR1cyIpLnRleHRDb250ZW50PWAke21vbnRofe+8iCR7bWkrMX0vJHttb250aHMubGVuZ3RofeaciO+8iemWi+WCrOaXpeOCkueiuuiqjeS4reKApiDlj5blvpfmuIjjgb8ke3N0LmRheXN95pelYDsKICAgbGV0IGRheXM7dHJ5e2RheXM9KGF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtZGF5cz9tb250aD0ke21vbnRofWApKS5kYXlzfHxbXTtjb25zZWM9MH1jYXRjaChlKXtzdC5mYWlsLnB1c2goYCR7bW9udGh977yaJHtlLm1lc3NhZ2V9YCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICBkYXlzPWRheXMuZmlsdGVyKGQ9PmQ+PWEmJmQ8PWIpO2xldCBtb250aE9rPXRydWU7CiAgIGZvcihjb25zdCBkIG9mIGRheXMpewogICAgaWYoU1NUT1Ape21vbnRoT2s9ZmFsc2U7YnJlYWt9CiAgICBjb25zdCBuZWVkUm93cz0haGF2ZUxpdmUuaGFzKGQpJiYhYmsuaGFzKGQpLG5lZWRQYXk9IWhhdmVQYXkuaGFzKGQpOwogICAgaWYoIW5lZWRSb3dzJiYhbmVlZFBheSl7c3Quc2tpcHBlZCsrO2NvbnRpbnVlfQogICAgY29uc3QgZWw9TWF0aC5yb3VuZCgoRGF0ZS5ub3coKS1zdC50MCkvMTAwMCk7CiAgICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZH0g44KS5Y+W5b6X5Lit77yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJXG7lj5blvpcke3N0LmRheXN95pel77yPJHtzdC5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCue+8j+WkseaVlyR7c3QuZmFpbC5sZW5ndGh977yP57WM6YGOJHtNYXRoLmZsb29yKGVsLzYwKX3liIYke2VsJTYwfeenkmA7CiAgICB0cnl7CiAgICAgY29uc3Qgcj1hd2FpdCBmZXRjaERheShiYXNlLGQpOwogICAgIGlmKHIuZmFpbGVkTil7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvIgke3IuZmFpbGVkTn1S5aSx5pWX77yJYCk7aWYoKytjb25zZWM+PTMpe3N0LnN0b3BwZWQ9dHJ1ZTtTU1RPUD10cnVlfWNvbnRpbnVlfQogICAgIGlmKG5lZWRSb3dzKXthd2FpdCBpZGJQdXQoYGxpdmU6JHtkfWAse2xpdmU6dHJ1ZSxkYXRlOmQscm93czpyLnJvd3N9KTtoYXZlTGl2ZS5hZGQoZCl9CiAgICAgYXdhaXQgcGF5UHV0KGQse2RhdGU6ZCxyYWNlczpyLnBheW91dHMsZmFpbGVkOjB9KTtoYXZlUGF5LmFkZChkKTsKICAgICBzdC5kYXlzKys7c3QucmFjZXMrPXIucmFjZXM7Y29uc2VjPTA7CiAgICB9Y2F0Y2goZSl7bW9udGhPaz1mYWxzZTtzdC5mYWlsLnB1c2goYCR7ZH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9fQogICAgYXdhaXQgc2xlZXAoNDAwKTsKICAgfQogICBpZihtb250aE9rJiZtb250aDxjdXJNb250aClhd2FpdCBtZXRhUHV0KCJtb250aDoiK21vbnRoLHRydWUpOwogIH0KIH1jYXRjaChlKXtzdC5mYWlsLnB1c2goU3RyaW5nKGUubWVzc2FnZXx8ZSkpfQogZmluYWxseXsKICBTWU5DSU5HPWZhbHNlO1NUT1JFPW51bGw7U1RPUkVfS0VZPSIiOyQoInN5bmNHbyIpLmRpc2FibGVkPWZhbHNlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZTsKICAkKCJzeW5jU3RhdHVzIikuaW5uZXJIVE1MPWAke3N0LnN0b3BwZWQ/IumAo+e2muOBl+OBpuWkseaVl+OBl+OBn+OBn+OCgeS4reaWreOBl+OBvuOBl+OBn++8iENsb3VkZmxhcmXlgbTjga7mt7fpm5Hjg7vliLbpmZDjga7lj6/og73mgKfvvInjgILlsJHjgZfmmYLplpPjgpLjgYrjgYTjgabjgoLjgYbkuIDluqbmirzjgZfjgabjgY/jgaDjgZXjgYTjgIJcbiI6IiJ9JHtTU1RPUCYmIXN0LnN0b3BwZWQ/IuWBnOatouOBl+OBvuOBl+OBn+OAgiI6KHN0LnN0b3BwZWQ/IiI6IuWujOS6huOAgiIpfeS7iuWbnuOBruWPluW+l++8miR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yI5L+d5a2Y5riI44G/44Gn44K544Kt44OD44OXICR7c3Quc2tpcHBlZH3ml6XvvIlgKyhzdC5mYWlsLmxlbmd0aD9gXG48c3BhbiBjbGFzcz0id2FybiI+5aSx5pWXICR7c3QuZmFpbC5sZW5ndGh95Lu277yaJHtlc2Moc3QuZmFpbC5zbGljZSgwLDQpLmpvaW4oIuOAgSIpKX0ke3N0LmZhaWwubGVuZ3RoPjQ/IiDigKYiOiIifVxu77yI44KC44GG5LiA5bqm5oq844GZ44Go44CB5aSx5pWX44GX44Gf5pel44Gg44GR44KE44KK55u044GX44G+44GZ77yJPC9zcGFuPmA6IiIpOwogIGF3YWl0IHNob3dTdGF0ZSgpO2JrU2NoZWR1bGUoKTsKIH0KfTsKCi8qIC0tLSDmiZXmiLvjga7mm7jjgY3lh7rjgZfjg7voqq3jgb/ovrzjgb8gLS0tICovCiQoInBheUV4cCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aClyZXR1cm4gYWxlcnQoIuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAgiIpOwogY29uc3QgYT1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7YS5ocmVmPVVSTC5jcmVhdGVPYmplY3RVUkwobmV3IEJsb2IoW0pTT04uc3RyaW5naWZ5KHBzKV0se3R5cGU6ImFwcGxpY2F0aW9uL2pzb24ifSkpOwogYS5kb3dubG9hZD1ga2VpYmFfcGF5b3V0c18ke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKX0uanNvbmA7YS5jbGljaygpO3NldFRpbWVvdXQoKCk9PlVSTC5yZXZva2VPYmplY3RVUkwoYS5ocmVmKSwxMDAwKX07CiQoInBheUltcCIpLm9uY2hhbmdlPWFzeW5jIGU9PnsKIGNvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoIWYpcmV0dXJuOwogdHJ5e2NvbnN0IGo9SlNPTi5wYXJzZShhd2FpdCBmLnRleHQoKSk7Y29uc3QgYXJyPUFycmF5LmlzQXJyYXkoaik/ajooai5yYWNlcz9bal06W10pOwogIGNvbnN0IGJ5RGF0ZT1uZXcgTWFwKCk7CiAgZm9yKGNvbnN0IHggb2YgYXJyKXtpZih4JiZBcnJheS5pc0FycmF5KHgucmFjZXMpJiZ4LmRhdGUpYnlEYXRlLnNldCh4LmRhdGUse2RhdGU6eC5kYXRlLHJhY2VzOngucmFjZXMsZmFpbGVkOnguZmFpbGVkfHwwfSl9CiAgZm9yKGNvbnN0W2Qscl1vZiBieURhdGUpYXdhaXQgcGF5UHV0KGQscik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfWNhdGNoKGVycil7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7oqq3jgb/ovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlcnIubWVzc2FnZSl9PC9zcGFuPmB9CiBlLnRhcmdldC52YWx1ZT0iIjsKfTsKCi8qIC0tLSDikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLwgLS0tICovCiQoImJ0UnVuIikub25jbGljaz1hc3luYygpPT57CiB0cnl7CiAgY29uc3QgcHM9YXdhaXQgcGF5QWxsKCk7aWYoIXBzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvjg4fjg7zjgr/jgYzjgYLjgorjgb7jgZvjgpPjgILlhYjjgavikaDjgaflj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgcGF5QnlJZD17fTtwcy5mb3JFYWNoKHA9PihwLnJhY2VzfHxbXSkuZm9yRWFjaCh4PT57cGF5QnlJZFt4LnJhY2VJZF09eH0pKTsKICBjb25zdCBzdGFydD0kKCJidFN0YXJ0IikudmFsdWV8fCIyMDE5LTAxLTAxIjsKICBjb25zdCBwZGF0ZXM9cHMubWFwKHA9PnAuZGF0ZSkuZmlsdGVyKGQ9PmQ+PXN0YXJ0KS5zb3J0KCk7CiAgaWYoIXBkYXRlcy5sZW5ndGgpeyQoImJ0T3V0IikuaW5uZXJIVE1MPSc8c3BhbiBjbGFzcz0id2FybiI+6ZaL5aeL5pel5Lul6ZmN44Gu5omV5oi744GM44GC44KK44G+44Gb44KT44CCPC9zcGFuPic7cmV0dXJufQogIGNvbnN0IHNwbGl0PXBkYXRlc1tNYXRoLmZsb29yKHBkYXRlcy5sZW5ndGgvMildOwogIGJ1c3kodHJ1ZSwi5oiQ57i+44KS6Kqt44G/6L6844G/5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoIXIuZGF0ZXx8IXIucmFjZUlkKXJldHVybjtjb25zdCBrPXIuZGF0ZSsifCIrci5yYWNlSWQ7bGV0IHg9bWFwLmdldChrKTtpZigheCltYXAuc2V0KGsseD17aWQ6ci5yYWNlSWQsZGF0ZTpyLmRhdGUscm93czpbXX0pO3gucm93cy5wdXNoKHIpfSk7CiAgY29uc3QgcmFjZXM9Wy4uLm1hcC52YWx1ZXMoKV0uc29ydCgoYSxiKT0+YS5kYXRlPGIuZGF0ZT8tMTphLmRhdGU+Yi5kYXRlPzE6YS5pZDxiLmlkPy0xOjEpOwogIGJ1c3kodHJ1ZSwi44OQ44OD44Kv44OG44K544OI5Lit4oCmIik7YXdhaXQgc2xlZXAoMzApOwogIGNvbnN0IG91dD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5EfSk7CiAgYnVzeSh0cnVlLCLjgqrjg4PjgrrmnKrlhaXlipvjga7loLTlkIjjgpLmpJzoqLzkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0UD1VRS5iYWNrdGVzdChyYWNlcyxwYXlCeUlkLHtzdGFydCxzcGxpdCxvb3M6TU9ERUxfVFJBSU5fRU5ELHByb3h5OnRydWV9KTtidXN5KGZhbHNlKTsKICBjb25zdCBMPXt0b3AxOiLjg4Tjg7zjg6sx5L2NIix0b3AyOiLkuIrkvY0y6aCtIix0b3AzOiLkuIrkvY0z6aCtIixhbGxIb2xlOiLnqbTjgr7jg7zjg7PlhajpoK3vvIjln7rmupbvvIkiLHZhbHVlOiLlppnlkbMxLjPlgI3ku6XkuIoiLGF4aXM6IumJhOadv+i7uO+8iDAuOTLku6XkuIrjg7vjgqrjg4PjgrrmmYLvvIkiLGZvY3VzOiLil47nmoTkuK3njofph43oppbjga4x5L2NIn07CiAgY29uc3QgcGN0PXg9Pih4KjEwMCkudG9GaXhlZCgwKSsiJSIsYz14PT54JiZ4LmJldHM/YCR7cGN0KHgucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsoeC5zZSoxOTYpLnRvRml4ZWQoMCl9PC9zcGFuPmA6Ii0iOwogIGNvbnN0IHRibD0obyx0aXRsZSk9PnsKICAgbGV0IHQ9YDxiPiR7dGl0bGV9PC9iPjxkaXYgY2xhc3M9InNtYWxsIj7lr77osaEgJHtvLnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuiyt+OBhOaWuTwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48dGg+5a2m57+S5b6MPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKEwpKXtjb25zdCB2PW8uc3RhdHNba107aWYoIXYuYWxsLmJldHMpY29udGludWU7CiAgICB0Kz1gPHRyPjx0ZD4ke0xba119PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkMuYmV0cz9gJHtwY3Qodi5DLnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHYuQy5zZSoxOTYpLnRvRml4ZWQoMCl977yIJHt2LkMuYmV0cy50b0xvY2FsZVN0cmluZygpfe+8iTwvc3Bhbj5gOiItIn08L3RkPjwvdHI+YH0KICAgcmV0dXJuIHQrIjwvdGJvZHk+PC90YWJsZT4ifTsKICBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPiR7c3RhcnR944Cc77yP5YmN5Y2K77ydJHtzcGxpdH3jgojjgorliY3jgIHlvozljYrvvJ3ku6XpmY3vvI/lkIQxMDDlhoY8L2Rpdj48YnI+YCt0Ymwob3V0LCLikaAg44Kq44OD44K65YWl5Yqb5pmC77yI5a6f6Zqb44Gu5Lq65rCX44Gn56m044K+44O844Oz44KS5Yik5a6a77yJIikrIjxicj4iK3RibChvdXRQLCLikaEg44Kq44OD44K65pyq5YWl5Yqb5pmC77yI44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgLy8g5p2h5Lu25Yil77yI44OE44O844OrMeS9jeOBruWbnuWPjueOh++8iQogIGNvbnN0IHNlZ1Jvd3M9T2JqZWN0LmVudHJpZXMob3V0LnNlZ3MpLmZpbHRlcigoWyx2XSk9PnYuYWxsLmJldHM+PTMwMCkuc29ydCgoYSxiKT0+YVswXTxiWzBdPy0xOjEpOwogIGlmKHNlZ1Jvd3MubGVuZ3RoKXtoKz1gPGJyPjxiPuKRoiDjg4Tjg7zjg6sx5L2N44Gu5p2h5Lu25Yil77yI4pGg44Gu5aC05ZCI77yJPC9iPjxkaXYgY2xhc3M9InNtYWxsIj7os7zlhaUzMDDlm57ku6XkuIrjga7mnaHku7bjga7jgb/jgILliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jgYvjgpLopovjgabjgY/jgaDjgZXjgYTjgII8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+5p2h5Lu2PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IFtrLHZdIG9mIHNlZ1Jvd3MpaCs9YDx0cj48dGQ+JHtlc2Moayl9PC90ZD48dGQ+PC90ZD48dGQ+JHt2LmFsbC5iZXRzLnRvTG9jYWxlU3RyaW5nKCl9PC90ZD48dGQ+JHsodi5hbGwuaGl0UmF0ZSoxMDApLnRvRml4ZWQoMSl9JTwvdGQ+PHRkPjxiPiR7Yyh2LmFsbCl9PC9iPjwvdGQ+PHRkPiR7di5BLmJldHM/cGN0KHYuQS5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQi5iZXRzP3BjdCh2LkIucm9pKToiLSJ9PC90ZD48L3RyPmA7CiAgIGgrPSI8L3Rib2R5PjwvdGFibGU+In0KICBoKz1gPGRpdiBjbGFzcz0ic21hbGwiPjxicj7opovmlrnvvJrjgIzlrabnv5LlvozjgI3jga/jgIHjg6Ljg4fjg6vjga7lrabnv5Ljgavkvb/jgaPjgabjgYTjgarjgYTmnJ/plpPvvIgke01PREVMX1RSQUlOX0VORH3ku6XpmY3vvInjgafjgIHmnIDjgoLkv6HpoLzjgafjgY3jgovliJfjgafjgZnjgILjgZ3jgozku6XliY3jga7mnJ/plpPjga/jgIHjg6Ljg4fjg6vjgYznrZTjgYjjgpLopovjgabjgYTjgovjgZ/jgoHjgIHjgoTjgoToia/jgY/lh7rjgb7jgZnjgILlm57lj47njofjga7jgIzCseOAjeOBrzk1JeOBruiqpOW3ruOBruW5heOBp+OAgTEwMCXjgpLkuIvlm57jgovkuIvpmZDjgarjgonliKnnm4rjgajjga/oqIDjgYjjgb7jgZvjgpPjgILmnaHku7bliKXjga/jgIHmjqLjgZnjgbvjganlgbbnhLbjga7pq5jjgYTmnaHku7bjgpLmi77jgYTjgoTjgZnjgYTjga7jgafjgIHliY3ljYrjg7vlvozljYrjga7kuKHmlrnjgaflkIzjgZjlkJHjgY3jga7jgoLjga7jgaDjgZHjgpLlj4LogIPjgavjgZfjgabjgY/jgaDjgZXjgYTjgILlppnlkbPvvIjluILloLTjgajjga7lt67vvInjga/jgIHmpJzoqLzjgafln7rmupbjgojjgormgqrjgYvjgaPjgZ/jgZ/jgoHjgIHliKTmlq3jgavjga/kvb/jgo/jgarjgYTjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj5gOwogICQoImJ0T3V0IikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgiYnRPdXQiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7mpJzoqLzjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9OwoKLyogLS0tIOOCquODg+OCuuWPluW+l++8iC9qcmEtb2Rkc++8muW9k+aXpeODu+WJjeaXpeWjsuOCiuOBruWNmOWLneOCquODg+OCuu+8iSAtLS0gKi8KbGV0IE9ERFM9e307CmZ1bmN0aW9uIG9kZHNGb3IocmFjZSl7CiBjb25zdCBtPXJhY2UmJnJhY2Uua2V5P09ERFNbcmFjZS5rZXldOm51bGw7aWYoIW0pcmV0dXJuIG51bGw7CiBjb25zdCBhcnI9cmFjZS5ydW5uZXJzLm1hcChyPT5tW3IubnVtXSk7cmV0dXJuIGFyci5ldmVyeShvPT5vPjEpP2FycjpudWxsOwp9Ci8qIOOCquODg+OCuuWPluW+l++8muKRoOWHuummrOihqOOBi+OCieaLvuOBo+OBn+OCquODg+OCuueUu+mdouOCkuebtOaOpeiqreOCgCDihpIg4pGh5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544Gg44GR44CB44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GG44CCCiAgIOabtOaWsOOBruOBqOOBjeOAgeWPluW+l+OBq+WkseaVl+OBl+OBn+ODrOODvOOCueOBruWJjeWbnuOBruOCquODg+OCuuOBr+a2iOOBleOBquOBhOOAgiAqLwpsZXQgT0REU19ESUFHPSIiOwphc3luYyBmdW5jdGlvbiBmZXRjaE9kZHMoKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybntnb3Q6MCx0b3RhbDowfTsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpLGQ9V0RBVEUsa2V5T2Y9cj0+YCR7U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpfS0ke051bWJlcihyLnJhY2VOdW1iZXIpfHwwfWA7CiBsZXQgZGlhZz1bXSxlcnI9IiI7CiAvLyDikaAg55u05o6l77yI5Ye66aas6KGo44Gr44Oq44Oz44Kv44GM44GC44KL44Os44O844K577yJCiBjb25zdCB3aXRoTGluaz1XUkFDRVMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKSxieUNuYW1lPW5ldyBNYXAod2l0aExpbmsubWFwKHI9PltyLm9kZHNDbmFtZSxyXSkpOwogY29uc3QgY2h1bmtzPVtdO2ZvcihsZXQgaT0wO2k8d2l0aExpbmsubGVuZ3RoO2krPTYpY2h1bmtzLnB1c2god2l0aExpbmsuc2xpY2UoaSxpKzYpLm1hcChyPT5yLm9kZHNDbmFtZSkpOwogbGV0IGNpPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGNpPGNodW5rcy5sZW5ndGgpe2NvbnN0IGs9Y2krKzsKICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gLFsxNTAwXSk7CiAgIGZvcihjb25zdCBpdCBvZiAoeC5pdGVtc3x8W10pKXtjb25zdCByPWJ5Q25hbWUuZ2V0KGl0LmNuYW1lKTtpZihyKU9ERFNba2V5T2YocildPWl0Lm9kZHN9CiAgIGlmKCh4LmZhaWxlZHx8W10pLmxlbmd0aClkaWFnLnB1c2goLi4ueC5mYWlsZWQuc2xpY2UoMCwyKS5tYXAoZj0+Zi5yZWFzb24pKTsKICAgaWYoeC5zYW1wbGUmJiFPRERTX0RJQUcpT0REU19ESUFHPSLnlLvpnaLjga7kuIDpg6jvvJoiK1N0cmluZyh4LnNhbXBsZSkuc2xpY2UoMCwyNjApOwogIH1jYXRjaChlKXtlcnI9ZS5tZXNzYWdlfX19OwogYXdhaXQgUHJvbWlzZS5hbGwoW3dvcmtlcigpLHdvcmtlcigpXSk7CiAvLyDikaEg5Y+W44KM44Gq44GL44Gj44Gf44Os44O844K544KS44CB5pel5LuY44O76ZaL5YKs5aC044Gu44Oh44OL44Ol44O857WM55Sx44Gn6KOc44GGCiBjb25zdCBtaXNzaW5nPVdSQUNFUy5maWx0ZXIocj0+IU9ERFNba2V5T2YocildKTsKIGlmKG1pc3NpbmcubGVuZ3RoKXsKICBjb25zdCB2ZW51ZXM9Wy4uLm5ldyBTZXQobWlzc2luZy5tYXAocj0+U3RyaW5nKHIudmVudWVDb2RlfHwiIikucGFkU3RhcnQoMiwiMCIpKSldLmZpbHRlcihCb29sZWFuKTsKICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpewogICB0cnl7Y29uc3QgeD1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLW9kZHM/ZGF0ZT0ke2R9JnZlbnVlPSR7dn1gLFsxNTAwXSk7CiAgICBmb3IoY29uc3QgciBvZiAoeC5yYWNlc3x8W10pKU9ERFNbYCR7U3RyaW5nKHIudmVudWVDb2RlKS5wYWRTdGFydCgyLCIwIil9LSR7ci5yYWNlTm99YF09ci5vZGRzOwogICAgaWYoISh4LnJhY2VzfHxbXSkubGVuZ3RoKWRpYWcucHVzaCguLi4oeC5kaWFnbm9zdGljc3x8W10pLnNsaWNlKDAsNCkubWFwKHo9PnR5cGVvZiB6PT09InN0cmluZyI/ejpKU09OLnN0cmluZ2lmeSh6KSkpOwogICB9Y2F0Y2goZSl7ZXJyPWUubWVzc2FnZTtkaWFnLnB1c2goZS5tZXNzYWdlKX19CiB9CiBjb25zdCBnb3Q9V1JBQ0VTLmZpbHRlcihyPT5PRERTW2tleU9mKHIpXSkubGVuZ3RoOwogT0REU19ESUFHPWdvdD8iIjooT0REU19ESUFHKyhlcnI/Iu+8j+eQhueUse+8miIrZXJyOiIiKSsoZGlhZy5sZW5ndGg/Iu+8j+iouuaWre+8miIrWy4uLm5ldyBTZXQoZGlhZyldLmpvaW4oIiB8ICIpLnNsaWNlKDAsNTAwKToiIikpOwogcmV0dXJue2dvdCx0b3RhbDpXUkFDRVMubGVuZ3RofTsKfQokKCJvZGRzR2V0Iikub25jbGljaz1hc3luYygpPT57CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiAkKCJvZGRzR2V0IikuZGlzYWJsZWQ9dHJ1ZTtPRERTX0RJQUc9IiI7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLjgqrjg4Pjgrrlj5blvpfkuK3igKYiOwogdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2hPZGRzKCk7CiAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X77yP44Kq44OD44K6ICR7ci5nb3R944Os44O844K55YiGYCsoci5nb3Q/IiI6Ilxu44Kq44OD44K644KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf77yI55m65aOy5YmN44CB44G+44Gf44Gv55S76Z2i5qeL6YCg44Gu6YGV44GE77yJ44CCIisoT0REU19ESUFHPyJcbiIrT0REU19ESUFHOiIiKSk7CiB9ZmluYWxseXskKCJvZGRzR2V0IikuZGlzYWJsZWQ9ZmFsc2V9CiByZW5kZXJWZW51ZUJ1dHRvbnMoV0RBVEUpOwp9OwoKLyogLS0tIOKYhSDmnKzml6Xjga7lpb3otbDnqbTppqzvvIjjg6/jg7Pjgr/jg4Pjg5fvvIkgLS0tICovCmNvbnN0IGpzdFRvZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ0ZGF0ZSIpLnZhbHVlPWpzdFRvZGF5KCk7CiQoInRvZGF5R28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgidGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47CiAkKCJ0b2RheUdvIikuZGlzYWJsZWQ9dHJ1ZTskKCJ0b2RheU91dCIpLmlubmVySFRNTD0iIjskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfkuK3igKYiOwogdHJ5ewogICQoIndkYXRlIikudmFsdWU9ZDthd2FpdCAkKCJ3Z2V0Iikub25jbGljaygpOwogIGlmKCFXUkFDRVMubGVuZ3RoKXsKICAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0kKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ7CiAgIGlmKEFWQUlMLmxlbmd0aCl7JCgidG9kYXlPdXQiKS5pbm5lckhUTUw9QVZBSUwubWFwKHg9PmA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtZD0iJHt4fSI+JHt4fTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICAgJCgidG9kYXlPdXQiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1kXSIpLmZvckVhY2goYnQ9PmJ0Lm9uY2xpY2s9KCk9PnskKCJ0ZGF0ZSIpLnZhbHVlPWJ0LmRhdGFzZXQuZDskKCJ0b2RheUdvIikuY2xpY2soKX0pfQogICByZXR1cm59CiAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l+OAguOCquODg+OCuuOCkueiuuiqjeS4reKApmA7CiAgYXdhaXQgJCgib2Rkc0dldCIpLm9uY2xpY2soKTsKICBjb25zdCBuPU9iamVjdC5rZXlzKE9ERFMpLmxlbmd0aDsKICAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIZgKyhuPyIiOiLvvIjjgqrjg4PjgrrmnKrlj5blvpfvvJrjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICBhd2FpdCBydW5BbGwoInRvZGF5T3V0Iik7VE9EQVlfU0hPV049dHJ1ZTthdXRvU3RhcnQoKTsKIH1jYXRjaChlKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KIGZpbmFsbHl7JCgidG9kYXlHbyIpLmRpc2FibGVkPWZhbHNlfQp9OwokKCJ0b2RheVVwZCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i5a2m57+S44OH44O844K/44Gu5pyA57WC5pel44KS56K66KqN5Lit4oCmIjsKIGxldCBtPSIiO2F3YWl0IGZvckVhY2hSb3cocj0+e2lmKHIuZGF0ZT5tKW09ci5kYXRlfSk7CiBjb25zdCBmcm9tPW0/YWRkRGF5cyhtLDEpOiIyMDIzLTAxLTAxIix0bz1qc3RZZXN0ZXJkYXkoKTsKIGlmKGZyb20+dG8peyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YOWtpue/kuODh+ODvOOCv+OBr+OBmeOBp+OBq+acgOaWsOOBp+OBme+8iOacgOe1guaXpSAke21977yJ44CCYDtyZXR1cm59CiAkKCJzc3RhcnQiKS52YWx1ZT1mcm9tOyQoInNlbmQiKS52YWx1ZT10bzsKICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7ZnJvbX3jgJwke3RvfSDjga7miJDnuL7jgpLlj5blvpfjgZfjgb7jgZnjgILpgLLmjZfjga/jgIzikaAg44OH44O844K/5Y+W5b6X44CN44Gu5qyE44Gr5Ye644G+44GZ44CCYDsKICQoInN5bmNHbyIpLmNsaWNrKCk7JCgic3luY1N0YXR1cyIpLnNjcm9sbEludG9WaWV3KHtiZWhhdmlvcjoic21vb3RoIn0pOwp9OwoKLyogLS0tIOKRpCDpiYTmnb/ou7jppqwgLyDikaUg5YWo44Os44O844K544Gu5rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X77yJIC0tLSAqLwpjb25zdCBHUkFERV9DT0xPUj17U1NTOiIjZDkyZDIwIixTUzoiI2YwNDQzOCIsUzoiI2Y3OTAwOSIsQToiIzE2NjdkOSIsQjoiIzY2NzA4NSIsQzoiIzk4YTJiMyJ9Owpjb25zdCBHUkFERV9PUkRFUj1bIlNTUyIsIlNTIiwiUyIsIkEiLCJCIiwiQyJdOwokKCJhZGF0ZSIpLnZhbHVlPWpzdFRvZGF5KCk7CmZ1bmN0aW9uIHJhY2VMYWJlbChyLG4pe3JldHVybiBgJHtyLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiJ9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZSYmci5kaXN0YW5jZT9yLnN1cmZhY2Urci5kaXN0YW5jZSsibSI6IuOCs+ODvOOCueS4jeaYjiJ944O7JHtufemgre+8iWB9CmFzeW5jIGZ1bmN0aW9uIHJlbmRlckF4aXNVcHNldChkKXsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiBjb25zdCBycz1bLi4uV1JBQ0VTXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGV8fGEudmVudWVOYW1lfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZUNvZGV8fGIudmVudWVOYW1lfHwiIikpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiBjb25zdCBjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7CiBjb25zdCB1cFJvd3M9W10sYXhSb3dzPVtdO2xldCB3aXRoT2Rkcz0wLHNraXBwZWQ9MDsKIGZvcihjb25zdCByIG9mIHJzKXsKICBjb25zdCByYWNlPW1rUmFjZShyLGQpLG49cmFjZS5ydW5uZXJzLmxlbmd0aDsKICBpZihuPDYpe3NraXBwZWQrKztjb250aW51ZX0KICBjb25zdCBvZD1vZGRzRm9yKHJhY2UpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTsKICBjb25zdCBnPVVFLnVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZCxhcCk7Y250W2cuZ3JhZGVdKys7aWYob2Qpd2l0aE9kZHMrKzsKICB1cFJvd3MucHVzaCh7bGFiZWw6cmFjZUxhYmVsKHIsbiksZ30pOwogIGNvbnN0IHBpY2tzPW9kP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogIGlmKHBpY2tzKWZvcihjb25zdCB4IG9mIHBpY2tzKWF4Um93cy5wdXNoKHtsYWJlbDpyYWNlTGFiZWwocixuKSx4LG5hbWU6cmFjZS5ydW5uZXJzW3guaV0ubmFtZSxubzpyYWNlLnJ1bm5lcnNbeC5pXS5udW0sam5hbWU6cmFjZS5ydW5uZXJzW3guaV0uam5hbWV9KTsKIH0KIC8vIOKRpSDms6LkubHluqYKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGhICR7dXBSb3dzLmxlbmd0aH3jg6zjg7zjgrnvvIjjgqrjg4Pjgrrlj43mmKAgJHt3aXRoT2Rkc33jg6zjg7zjgrnvvI/jgZ3jga7ku5bjga/jg4Tjg7zjg6vmjqjlrprvvIkke3NraXBwZWQ/YO+8jzbpoK3mnKrmuoDjgaflr77osaHlpJYgJHtza2lwcGVkfWA6IiJ9PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJyb3ciPmArR1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIikrYDwvZGl2PmA7CiBoKz1gPHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPjwvdGg+PHRoPuetiee0mjwvdGg+PHRoPumBjuWOu+OBruazouS5seeOhzwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHUgb2YgdXBSb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKHUubGFiZWwpfTwvdGQ+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUlt1LmcuZ3JhZGVdfSI+JHt1LmcuZ3JhZGV9PC9zcGFuPjwvdGQ+PHRkPiR7TWF0aC5yb3VuZCh1LmcucmF0ZSoxMDApfSU8L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7dS5nLm1vZGU9PT0ib2RkcyI/IuOCquODg+OCuiI6IuaOqOWumiJ9PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjxkaXYgY2xhc3M9InNtYWxsIj48YnI+5rOi5Lmx546H44Gv44CB44Gd44Gu562J57Sa44Gu44Os44O844K544Gn44CMM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44CN44Gr44Gq44Gj44Gf6YGO5Y6744Gu5Ymy5ZCI44Gn44GZ77yI5YWo44Os44O844K55bmz5Z2HIDI4LjUl77yJ44CCPC9kaXY+YDsKICQoInVwc2V0T3V0IikuaW5uZXJIVE1MPWg7CiAvLyDikaQg6YmE5p2/6Lu46aasCiBsZXQgYT1gPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCuSAke3dpdGhPZGRzfS8ke3VwUm93cy5sZW5ndGh944CCPC9kaXY+YDsKIGlmKCF3aXRoT2RkcylhKz1gPGRpdiBjbGFzcz0id2FybiI+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gm44GE44Gq44GE44Gf44KB44CB6YmE5p2/6Lu46aas44Gv5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+YDsKIGVsc2UgaWYoIWF4Um93cy5sZW5ndGgpYSs9YDxkaXYgY2xhc3M9Indhcm4iPuacrOaXpeOBr+OAgeipsuW9k+OBmeOCi+i7uOmmrOOBjOOBhOOBvuOBm+OCk++8iOOCquODg+OCuuWPluW+l+a4iOOBv+OBruODrOODvOOCueOBruS4reOBq+OAgeWghei7uOS7peS4iuOBjOOBguOCiuOBvuOBm+OCk++8ieOAgjwvZGl2PmA7CiBmb3IoY29uc3QgdCBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBsaXN0PWF4Um93cy5maWx0ZXIoej0+ei54LnRpZXI9PT10KTtpZighbGlzdC5sZW5ndGgpY29udGludWU7CiAgYSs9YDxicj48Yj4ke3R9PC9iPjxzcGFuIGNsYXNzPSJzbWFsbCI+77yI6YGO5Y6744Gu5a6f57i+ICR7KFVFLkFYSVMuYmFuZHNbdF0ucmF0ZSoxMDApLnRvRml4ZWQoMCl9JeODu+ipsuW9kyR7VUUuQVhJUy5iYW5kc1t0XS5ufemgre+8iTwvc3Bhbj5gOwogIGZvcihjb25zdCB6IG9mIGxpc3QpYSs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHoubGFiZWwpfTwvYj48YnI+JHtlc2Moei5ubyl955WqICR7ZXNjKHoubmFtZSl9IDxzcGFuIGNsYXNzPSJzbWFsbCI+5LqI5risICR7KHoueC5wKjEwMCkudG9GaXhlZCgwKX0lJHt6LmpuYW1lPyLvvI/pqI7miYvvvJoiK2VzYyh6LmpuYW1lKToiIn08L3NwYW4+PC9kaXY+YH0KICQoImF4aXNPdXQiKS5pbm5lckhUTUw9YTsKfQokKCJheGlzR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgiYWRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47CiAkKCJheGlzR28iKS5kaXNhYmxlZD10cnVlOyQoImF4aXNPdXQiKS5pbm5lckhUTUw9IiI7JCgidXBzZXRPdXQiKS50ZXh0Q29udGVudD0i6Kej5p6Q5Lit4oCmIjsKIHRyeXsKICBpZighV1JBQ0VTLmxlbmd0aHx8V0RBVEUhPT1kKXsKICAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfkuK3igKYiOyQoIndkYXRlIikudmFsdWU9ZDthd2FpdCAkKCJ3Z2V0Iikub25jbGljaygpOwogICBpZighV1JBQ0VTLmxlbmd0aCl7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSQoIndzdGF0dXMiKS50ZXh0Q29udGVudDskKCJ1cHNldE91dCIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgIIiO3JldHVybn0KICAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLjgqrjg4PjgrrjgpLnorroqo3kuK3igKYiO2F3YWl0ICQoIm9kZHNHZXQiKS5vbmNsaWNrKCl9CiAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7T2JqZWN0LmtleXMoT0REUykubGVuZ3RofeODrOODvOOCueWIhmA7CiAgYXdhaXQgcmVuZGVyQXhpc1Vwc2V0KGQpO0FYSVNfU0hPV049dHJ1ZTthdXRvU3RhcnQoKTsKIH1jYXRjaChlKXskKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlOyQoInVwc2V0T3V0IikudGV4dENvbnRlbnQ9IiJ9CiBmaW5hbGx5eyQoImF4aXNHbyIpLmRpc2FibGVkPWZhbHNlfQp9OwoKLyogLS0tIOOCquODg+OCuuOBruiHquWLleabtOaWsO+8iOW9k+aXpeOBruOBv++8ie+8muOCquODg+OCuuWPluW+lyDihpIg6KGo56S65Lit44Gu5qyE77yI4piF5pys5pel44O74pGk4pGl77yJ44KS6Ieq5YuV44Gn5YaN6KiI566XIC0tLSAqLwpsZXQgQVVUT19UPW51bGwsQVVUT19ORVhUPTAsQVVUT19CVVNZPWZhbHNlLEFVVE9fTEFTVD0iIixUT0RBWV9TSE9XTj1mYWxzZSxBWElTX1NIT1dOPWZhbHNlOwpjb25zdCBhdXRvTXM9KCk9PndpbmRvdy5fX0FVVE9fTVN8fE51bWJlcigkKCJhdXRvTWluIikudmFsdWUpKjYwMDAwOwpmdW5jdGlvbiBhdXRvU3RvcCgpe2lmKEFVVE9fVCljbGVhckludGVydmFsKEFVVE9fVCk7QVVUT19UPW51bGw7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0iIn0KYXN5bmMgZnVuY3Rpb24gcmVmcmVzaE9kZHNBbmRWaWV3cygpewogYXdhaXQgZmV0Y2hPZGRzKCk7CiBBVVRPX0xBU1Q9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxOSk7CiBjb25zdCBuPU9iamVjdC5rZXlzKE9ERFMpLmxlbmd0aDsKIGlmKFRPREFZX1NIT1dOKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIbvvIgke0FVVE9fTEFTVH0g5pu05paw77yJYDthd2FpdCBydW5BbGwoInRvZGF5T3V0Iil9CiBpZihBWElTX1NIT1dOKXskKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtufeODrOODvOOCueWIhu+8iCR7QVVUT19MQVNUfSDmm7TmlrDvvIlgO2F3YWl0IHJlbmRlckF4aXNVcHNldChXREFURSl9Cn0KZnVuY3Rpb24gYXV0b1N0YXJ0KCl7CiBhdXRvU3RvcCgpOwogaWYoISQoImF1dG9PZGRzIikuY2hlY2tlZHx8IVdSQUNFUy5sZW5ndGgpcmV0dXJuOwogaWYoV0RBVEU8anN0VG9kYXkoKSl7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0i77yI6YGO5Y6744Gu5pel5LuY44Gu44Gf44KB6Ieq5YuV5pu05paw44Gv44GX44G+44Gb44KT77yJIjtyZXR1cm59CiBBVVRPX05FWFQ9RGF0ZS5ub3coKSthdXRvTXMoKTsKIEFVVE9fVD1zZXRJbnRlcnZhbChhc3luYygpPT57CiAgY29uc3QgbGVmdD1BVVRPX05FWFQtRGF0ZS5ub3coKTsKICBpZihsZWZ0PjApeyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9YOasoeOBruabtOaWsOOBvuOBpyAke01hdGguY2VpbChsZWZ0LzEwMDApfeenkmArKEFVVE9fTEFTVD9g77yP5pyA57WC5pu05pawICR7QVVUT19MQVNUfWA6IiIpO3JldHVybn0KICBpZihBVVRPX0JVU1kpcmV0dXJuO0FVVE9fQlVTWT10cnVlOyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9IuOCquODg+OCuuOCkuabtOaWsOS4reKApiI7CiAgdHJ5e2F3YWl0IHJlZnJlc2hPZGRzQW5kVmlld3MoKX1jYXRjaChlKXskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSLmm7TmlrDjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KICBmaW5hbGx5e0FVVE9fQlVTWT1mYWxzZTtBVVRPX05FWFQ9RGF0ZS5ub3coKSthdXRvTXMoKX0KIH0sd2luZG93Ll9fQVVUT19USUNLfHwxMDAwKTsKfQokKCJhdXRvT2RkcyIpLm9uY2hhbmdlPWF1dG9TdGFydDskKCJhdXRvTWluIikub25jaGFuZ2U9YXV0b1N0YXJ0OwoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOiHquWLleODkOODg+OCr+OCouODg+ODl++8iENsb3VkZmxhcmUgS1bvvIkKICog44O744OH44O844K/44GM5aSJ44KP44Gj44Gf44Kw44Or44O844OX77yIY3N2LeW5tO+8j2xpdmUt5bm05pyI77yPcGF5LeW5tOaciO+8j21ldGHvvInjgaDjgZHjgpLjgIFnemlw44GX44Gm6YCB44KLCiAqIOODu+S/neWtmOWFiOOBruitmOWIpeOBr+OAgeODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgZ3jga7jgoLjga7jga/pgIHjgonjgarjgYTvvIkKICog44O75b6p5YWD44Gv44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn44CC5ZCM44GY44Kt44O844Gu44OH44O844K/44Gv5LiK5pu444GN44GV44KM44KLCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgQks9e3Bhc3M6IiIsYXV0bzp0cnVlLGRpcnR5Om5ldyBTZXQoKSxidXN5OmZhbHNlLGlkOiIiLHNhdmVUOm51bGwscnVuVDpudWxsLGluZm86bnVsbCxtc2c6IiIsZXJyOmZhbHNlfTsKY29uc3QgcmF3TWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgcmF3UHV0TWFueT1yZWNzPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgc3Q9Wy4uLm5ldyBTZXQocmVjcy5tYXAocj0+ci5zKSldO2lmKCFzdC5sZW5ndGgpcmV0dXJuIG9rKCk7Y29uc3QgdD1EQi50cmFuc2FjdGlvbihzdCwicmVhZHdyaXRlIik7Zm9yKGNvbnN0IHIgb2YgcmVjcyl0Lm9iamVjdFN0b3JlKHIucykucHV0KHIudixyLmspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYlJhbmdlPShzdG9yZSxyYW5nZSk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBvdXQ9W107Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLm9wZW5DdXJzb3IocmFuZ2UpO3Eub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtvdXQucHVzaCh7czpzdG9yZSxrOmMua2V5LHY6Yy52YWx1ZX0pO2MuY29udGludWUoKX1lbHNlIG9rKG91dCl9O3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiS2V5cz1zdG9yZT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGxLZXlzKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpmdW5jdGlvbiBncm91cE9mKHN0b3JlLGtleSl7CiBrZXk9U3RyaW5nKGtleSk7CiBpZihzdG9yZT09PSJmaWxlcyIpe2lmKGtleS5zdGFydHNXaXRoKCJsaXZlOiIpKXJldHVybiAibGl2ZS0iK2tleS5zbGljZSg1LDEyKTtjb25zdCB5PWtleS5zcGxpdCgiOiIpWzBdO3JldHVybiAvXigwfDIwXGRcZCkkLy50ZXN0KHkpPyJjc3YtIit5OiJjc3YtMCJ9CiBpZihzdG9yZT09PSJwYXkiKXJldHVybiAicGF5LSIra2V5LnNsaWNlKDAsNyk7CiByZXR1cm4gIm1ldGEiOwp9CmZ1bmN0aW9uIG1hcmtEaXJ0eShzdG9yZSxrZXkpewogaWYoc3RvcmU9PT0ibWV0YSImJihrZXk9PT0iZGlydHkifHxrZXk9PT0iYmFja3VwIikpcmV0dXJuOwogQksuZGlydHkuYWRkKGdyb3VwT2Yoc3RvcmUsa2V5KSk7CiBjbGVhclRpbWVvdXQoQksuc2F2ZVQpO0JLLnNhdmVUPXNldFRpbWVvdXQoKCk9PntyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTtia1JlbmRlcigpfSw4MDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlYWRHcm91cChuYW1lKXsKIGxldCBtOwogaWYobmFtZT09PSJtZXRhIilyZXR1cm4oYXdhaXQgaWRiUmFuZ2UoIm1ldGEiKSkuZmlsdGVyKHI9PnIuayE9PSJkaXJ0eSImJnIuayE9PSJiYWNrdXAiKTsKIGlmKG09bmFtZS5tYXRjaCgvXmNzdi0oXGQrKSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfTpgLGAke21bMV19O2ApKTsKIGlmKG09bmFtZS5tYXRjaCgvXmxpdmUtKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgbGl2ZToke21bMV19LTAwYCxgbGl2ZToke21bMV19LTk5YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ecGF5LShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJwYXkiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19LTAwYCxgJHttWzFdfS05OWApKTsKIHJldHVybltdOwp9CmFzeW5jIGZ1bmN0aW9uIGFsbEdyb3VwcygpewogY29uc3QgZz1uZXcgU2V0KCk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJmaWxlcyIpKWcuYWRkKGdyb3VwT2YoImZpbGVzIixrKSk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJwYXkiKSlnLmFkZChncm91cE9mKCJwYXkiLGspKTsKIGlmKChhd2FpdCBpZGJLZXlzKCJtZXRhIikpLnNvbWUoaz0+ayE9PSJkaXJ0eSImJmshPT0iYmFja3VwIikpZy5hZGQoIm1ldGEiKTsKIHJldHVyblsuLi5nXTsKfQphc3luYyBmdW5jdGlvbiBneihzdHIpewogY29uc3QgcmF3PW5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpOwogaWYodHlwZW9mIENvbXByZXNzaW9uU3RyZWFtPT09InVuZGVmaW5lZCIpcmV0dXJue2J1ZjpyYXcsZW5jOiJyYXcifTsKIGNvbnN0IGNzPW5ldyBDb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9Y3Mud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShyYXcpO3cuY2xvc2UoKTsKIHJldHVybntidWY6bmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKSxlbmM6Imd6aXAifTsKfQphc3luYyBmdW5jdGlvbiBndW56aXAoYnVmLGVuYyl7CiBpZihlbmM9PT0icmF3IilyZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zik7CiBjb25zdCBkcz1uZXcgRGVjb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9ZHMud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShidWYpO3cuY2xvc2UoKTsKIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYXdhaXQgbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKTsKfQphc3luYyBmdW5jdGlvbiBia01ha2VJZCgpewogaWYoISh3aW5kb3cuY3J5cHRvJiZjcnlwdG8uc3VidGxlKSl0aHJvdyBuZXcgRXJyb3IoIuOBk+OBrueSsOWig+OBp+OBr+S9v+OBiOOBvuOBm+OCk++8iGh0dHBzIOOBp+mWi+OBj+W/heimgeOBjOOBguOCiuOBvuOBme+8iSIpOwogY29uc3QgZD1hd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgiU0hBLTI1NiIsbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKCJrZWliYS11cHNldC1iYWNrdXA6djE6IitCSy5wYXNzKSk7CiByZXR1cm5bLi4ubmV3IFVpbnQ4QXJyYXkoZCldLm1hcChiPT5iLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCIwIikpLmpvaW4oIiIpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrRmV0Y2gocGF0aCxvcHQpewogaWYoIUJLLmlkKUJLLmlkPWF3YWl0IGJrTWFrZUlkKCk7CiByZXR1cm4gZmV0Y2goJCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpK3BhdGgsT2JqZWN0LmFzc2lnbih7fSxvcHQse2hlYWRlcnM6T2JqZWN0LmFzc2lnbih7IngtYmFja3VwLWlkIjpCSy5pZH0sKG9wdCYmb3B0LmhlYWRlcnMpfHx7fSl9KSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtKU09OKHBhdGgsb3B0KXsKIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChwYXRoLG9wdCksdD1hd2FpdCByLnRleHQoKTtsZXQgaj17fTt0cnl7aj1KU09OLnBhcnNlKHQpfWNhdGNoKGUpe30KIGlmKCFyLm9rfHxqLm9rPT09ZmFsc2UpdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fCgiSFRUUCAiK3Iuc3RhdHVzKSk7cmV0dXJuIGo7Cn0KZnVuY3Rpb24gYmtNc2codCxpc0Vycil7QksubXNnPXR8fCIiO0JLLmVycj0hIWlzRXJyO2JrUmVuZGVyKCl9CmZ1bmN0aW9uIGJrUmVuZGVyKCl7CiBjb25zdCBlbD0kKCJia1N0YXR1cyIpO2lmKCFlbClyZXR1cm47CiBjb25zdCBtPUJLLmluZm8sanN0PW1zPT5uZXcgRGF0ZShtcys5KjM2MDBlMykudG9JU09TdHJpbmcoKS5yZXBsYWNlKCJUIiwiICIpLnNsaWNlKDAsMTYpOwogbGV0IHN1bT0iIjsKIGlmKCFCSy5wYXNzKXN1bT0i44OR44K544OV44Os44O844K644KS6Kit5a6a44GZ44KL44Go44CB6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44GM5pyJ5Yq544Gr44Gq44KK44G+44GZ44CCIjsKIGVsc2UgaWYobSYmbS5leGlzdHMpe2NvbnN0IGNzPU9iamVjdC52YWx1ZXMobS5jaHVua3N8fHt9KTtzdW09YOacgOe1guODkOODg+OCr+OCouODg+ODl++8miR7anN0KG0udXBkYXRlZEF0KX3vvIgke2NzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8keyhjcy5yZWR1Y2UoKHMsYyk9PnMrYy5zaXplLDApLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgfQogZWxzZSBzdW09IuODkOODg+OCr+OCouODg+ODl+OBr+OBvuOBoOOBguOCiuOBvuOBm+OCk+OAgiI7CiBpZihCSy5wYXNzKXN1bSs9YO+8j+acqumAgeS/oeOBruWkieabtO+8miR7QksuZGlydHkuc2l6ZX3jgrDjg6vjg7zjg5cke0JLLmF1dG8/Iu+8iOiHquWLleOBp+mAgeOCiuOBvuOBme+8iSI6Iu+8iOiHquWLleODkOODg+OCr+OCouODg+ODl+OBr+OCquODle+8iSJ9YDsKIGVsLmlubmVySFRNTD0oQksubXNnP2A8c3BhbiBjbGFzcz0iJHtCSy5lcnI/Indhcm4iOiJnb29kIn0iPiR7ZXNjKEJLLm1zZyl9PC9zcGFuPlxuYDoiIikrZXNjKHN1bSk7Cn0KZnVuY3Rpb24gYmtOZWVkUGFzcygpe2lmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644KSOOaWh+Wtl+S7peS4iuOBp+WFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQphc3luYyBmdW5jdGlvbiBia1JlZnJlc2gobWFuKXsKIHRyeXtCSy5pbmZvPW1hbnx8YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iil9Y2F0Y2goZSl7QksuaW5mbz1udWxsO2lmKCFCSy5tc2cpYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeOBp+OBjeOBvuOBm+OCk++8miIrZS5tZXNzYWdlLHRydWUpfQogYmtSZW5kZXIoKTsKfQphc3luYyBmdW5jdGlvbiBydW5CYWNrdXAoZnVsbCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlO2NvbnN0IGluZmxpZ2h0PW5ldyBTZXQoQksuZGlydHkpO0JLLmRpcnR5LmNsZWFyKCk7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKSxoYXZlPW1hbi5leGlzdHM/KG1hbi5jaHVua3N8fHt9KTp7fTsKICBjb25zdCBuYW1lcz0oZnVsbHx8IW1hbi5leGlzdHMpP2F3YWl0IGFsbEdyb3VwcygpOlsuLi5pbmZsaWdodF07CiAgaWYoIW5hbWVzLmxlbmd0aCl7YmtNc2coIuWkieabtOOBr+OBguOCiuOBvuOBm+OCk+OAgiIpO2F3YWl0IGJrUmVmcmVzaChtYW4pO3JldHVybn0KICBjb25zdCBjaHVua3M9T2JqZWN0LmFzc2lnbih7fSxoYXZlKTtsZXQgc2VudD0wLGJ5dGVzPTA7CiAgZm9yKGxldCBpPTA7aTxuYW1lcy5sZW5ndGg7aSsrKXsKICAgY29uc3QgbmFtZT1uYW1lc1tpXTtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5Lit4oCmICR7aSsxfS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHJlY3M9YXdhaXQgcmVhZEdyb3VwKG5hbWUpOwogICBpZighcmVjcy5sZW5ndGgpe2lmKGNodW5rc1tuYW1lXSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3NbbmFtZV19Y29udGludWV9CiAgIGNvbnN0IHJhdz1KU09OLnN0cmluZ2lmeSh7ZzpuYW1lLHJlY3N9KSx7YnVmLGVuY309YXdhaXQgZ3oocmF3KTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJQVVQiLGJvZHk6YnVmfSk7CiAgIGlmKCFyLm9rKXtsZXQgZT0iIjt0cnl7ZT0oYXdhaXQgci5qc29uKCkpLmVycm9yfWNhdGNoKF8pe310aHJvdyBuZXcgRXJyb3IoZXx8KCJIVFRQICIrci5zdGF0dXMpKX0KICAgY2h1bmtzW25hbWVdPXtzaXplOmJ1Zi5ieXRlTGVuZ3RoLHJhd1NpemU6cmF3Lmxlbmd0aCxuOnJlY3MubGVuZ3RoLGVuYyxhdDpEYXRlLm5vdygpfTtzZW50Kys7Ynl0ZXMrPWJ1Zi5ieXRlTGVuZ3RoOwogIH0KICBpZihmdWxsfHwhbWFuLmV4aXN0cyl7Zm9yKGNvbnN0IG4gb2YgT2JqZWN0LmtleXMoaGF2ZSkpaWYoIW5hbWVzLmluY2x1ZGVzKG4pKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobil9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuXX19CiAgY29uc3QgbWFuaWZlc3Q9e3Y6MSx1cGRhdGVkQXQ6RGF0ZS5ub3coKSxjaHVua3N9OwogIGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIse21ldGhvZDoiUFVUIixib2R5OkpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxoZWFkZXJzOnsiY29udGVudC10eXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgbWFuaWZlc3QuZXhpc3RzPXRydWU7YXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbmlmZXN0LnVwZGF0ZWRBdH0pOwogIEJLLmluZm89bWFuaWZlc3Q7YmtNc2coYOODkOODg+OCr+OCouODg+ODl+WujOS6hu+8miR7c2VudH3jgrDjg6vjg7zjg5fjgpLpgIHkv6HvvIgkeyhieXRlcy8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYCk7CiB9Y2F0Y2goZSl7CiAgZm9yKGNvbnN0IG4gb2YgaW5mbGlnaHQpQksuZGlydHkuYWRkKG4pO3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pOwogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKTsKIH1maW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQphc3luYyBmdW5jdGlvbiBydW5SZXN0b3JlKCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iik7CiAgaWYoIW1hbi5leGlzdHMpe2JrTXNnKCLjgZPjga7jg5Hjgrnjg5Xjg6zjg7zjgrrjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjga/opovjgaTjgYvjgorjgb7jgZvjgpPvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTvvInjgIIiLHRydWUpO3JldHVybn0KICBjb25zdCBuYW1lcz1PYmplY3Qua2V5cyhtYW4uY2h1bmtzfHx7fSk7bGV0IG49MCxjbnQ9MDsKICBmb3IoY29uc3QgbmFtZSBvZiBuYW1lcyl7CiAgIGJrTXNnKGDlvqnlhYPkuK3igKYgJHsrK259LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCk7CiAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgJHtuYW1lfSDjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPvvIhIVFRQICR7ci5zdGF0dXN977yJYCk7CiAgIGNvbnN0IG89SlNPTi5wYXJzZShhd2FpdCBndW56aXAobmV3IFVpbnQ4QXJyYXkoYXdhaXQgci5hcnJheUJ1ZmZlcigpKSxtYW4uY2h1bmtzW25hbWVdLmVuY3x8Imd6aXAiKSk7CiAgIGF3YWl0IHJhd1B1dE1hbnkoby5yZWNzKTtjbnQrPW8ucmVjcy5sZW5ndGg7CiAgfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiO0JBQ0tVUF9EQVRFUz1udWxsO0JLLmRpcnR5LmNsZWFyKCk7CiAgYXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFtdKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW4udXBkYXRlZEF0fSk7CiAgYXdhaXQgc2hvd1N0YXRlKCk7QksuaW5mbz1tYW47YmtNc2coYOW+qeWFg+WujOS6hu+8miR7bmFtZXMubGVuZ3RofeOCsOODq+ODvOODl++8jyR7Y250LnRvTG9jYWxlU3RyaW5nKCl95Lu2YCk7CiB9Y2F0Y2goZSl7YmtNc2coIuW+qeWFg+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpfQogZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KZnVuY3Rpb24gYmtTY2hlZHVsZShtcyl7CiBpZighQksuYXV0b3x8IUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpcmV0dXJuOwogY2xlYXJUaW1lb3V0KEJLLnJ1blQpO0JLLnJ1blQ9c2V0VGltZW91dCgoKT0+e2lmKCFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSk7ZWxzZSBia1NjaGVkdWxlKDMwMDAwKX0sbXN8fDMwMDApOwp9CmZ1bmN0aW9uIGJrU2F2ZVNldHRpbmdzKCl7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9iayIsSlNPTi5zdHJpbmdpZnkoe3Bhc3M6QksucGFzcyxhdXRvOkJLLmF1dG99KSl9Y2F0Y2goZSl7fX0KZnVuY3Rpb24gZm9jdXNJbml0KCl7dHJ5e2NvbnN0IHY9bG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2ZvY3VzIik7aWYodiE9PW51bGwpJCgiZm9jdXNPbiIpLmNoZWNrZWQ9dj09PSIxIn1jYXRjaChlKXt9JCgiZm9jdXNPbiIpLm9uY2hhbmdlPSgpPT57dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9mb2N1cyIsJCgiZm9jdXNPbiIpLmNoZWNrZWQ/IjEiOiIwIil9Y2F0Y2goZSl7fWlmKFRPREFZX1NIT1dOKXJ1bkFsbCgidG9kYXlPdXQiKX19CmFzeW5jIGZ1bmN0aW9uIGJrSW5pdCgpe2ZvY3VzSW5pdCgpOwogdHJ5e2NvbnN0IG89SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgidXBzZXRfYmsiKXx8Int9Iik7QksucGFzcz1vLnBhc3N8fCIiO0JLLmF1dG89by5hdXRvIT09ZmFsc2V9Y2F0Y2goZSl7fQogJCgiYmtQYXNzIikudmFsdWU9QksucGFzczskKCJia0F1dG8iKS5jaGVja2VkPUJLLmF1dG87CiAkKCJia1Bhc3MiKS5vbmNoYW5nZT0oKT0+e0JLLnBhc3M9JCgiYmtQYXNzIikudmFsdWUudHJpbSgpO0JLLmlkPSIiO0JLLmluZm89bnVsbDtCSy5tc2c9IiI7YmtTYXZlU2V0dGluZ3MoKTtpZihCSy5wYXNzLmxlbmd0aD49OClia1JlZnJlc2goKTtlbHNlIGJrUmVuZGVyKCl9OwogJCgiYmtTaG93Iikub25jbGljaz0oKT0+e2NvbnN0IHA9JCgiYmtQYXNzIik7cC50eXBlPXAudHlwZT09PSJwYXNzd29yZCI/InRleHQiOiJwYXNzd29yZCI7JCgiYmtTaG93IikudGV4dENvbnRlbnQ9cC50eXBlPT09InBhc3N3b3JkIj8i6KGo56S6Ijoi6Zqg44GZIn07CiAkKCJia0F1dG8iKS5vbmNoYW5nZT0oKT0+e0JLLmF1dG89JCgiYmtBdXRvIikuY2hlY2tlZDtia1NhdmVTZXR0aW5ncygpO2JrUmVuZGVyKCk7aWYoQksuYXV0bylia1NjaGVkdWxlKDIwMDApfTsKICQoImJrTm93Iikub25jbGljaz0oKT0+cnVuQmFja3VwKGZhbHNlKTsKICQoImJrRnVsbCIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZnjgbnjgabjga7jg4fjg7zjgr/jgpLjgIHjgYLjgonjgZ/jgoHjgabkv53lrZjjgZfnm7TjgZfjgb7jgZnjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5CYWNrdXAodHJ1ZSl9OwogJCgiYmtSZXN0b3JlIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBk+OBruerr+acq+OBruODh+ODvOOCv+OCkuOAgeODkOODg+OCr+OCouODg+ODl+OBruWGheWuueOBp+S4iuabuOOBjeOBl+OBvuOBme+8iOODkOODg+OCr+OCouODg+ODl+OBq+OBguOCi+ODh+ODvOOCv+OBoOOBkeOBjOWvvuixoeOBp+OBme+8ieOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1blJlc3RvcmUoKX07CiB0cnl7Y29uc3QgZD1hd2FpdCBtZXRhR2V0KCJkaXJ0eSIpO2lmKEFycmF5LmlzQXJyYXkoZCkpZC5mb3JFYWNoKHg9PkJLLmRpcnR5LmFkZCh4KSl9Y2F0Y2goZSl7fQogdHJ5e2lmKG5hdmlnYXRvci5zdG9yYWdlJiZuYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KW5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QoKS5jYXRjaCgoKT0+e30pfWNhdGNoKGUpe30KIGJrUmVuZGVyKCk7CiBpZihCSy5wYXNzLmxlbmd0aD49OCl7YXdhaXQgYmtSZWZyZXNoKCk7aWYoQksuZGlydHkuc2l6ZSlia1NjaGVkdWxlKDUwMDApfQogc2V0SW50ZXJ2YWwoKCk9PntpZihCSy5hdXRvJiZCSy5wYXNzLmxlbmd0aD49OCYmQksuZGlydHkuc2l6ZSYmIUJLLmJ1c3kmJiFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSl9LHdpbmRvdy5fX0JLX1RJQ0t8fDkwMDAwMCk7Cn0KCi8qIC0tLSDoqLrmlq3mg4XloLHvvIjplovlgqzloLTjgZTjgajjgavjgIHlh7rppqzooajjg5rjg7zjgrjjga7kuK3ouqvjgpLoqr/jgbnjgovvvIkgLS0tICovCiQoImRiZ0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBvdXQ9JCgiZGJnT3V0Iik7CiBpZighV1JBQ0VTLmxlbmd0aCl7b3V0LnZhbHVlPSLlhYjjgavjgIzlpb3otbDnqbTppqzjgpLooajnpLrjgI3jgpLmirzjgZfjgabjgIHlh7rppqzooajjgpLlj5blvpfjgZfjgabjgY/jgaDjgZXjgYTjgIIiO3JldHVybn0KIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpLGQ9V0RBVEU7CiBjb25zdCB2ZW51ZXM9Wy4uLm5ldyBTZXQoV1JBQ0VTLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogb3V0LnZhbHVlPSLoqLrmlq3kuK3igKYiOyQoImRiZ0dvIikuZGlzYWJsZWQ9dHJ1ZTsKIGNvbnN0IGxpbmVzPVtg5pel5LuYICR7ZH1gXTsKIHRyeXsKICBmb3IoY29uc3QgdiBvZiB2ZW51ZXMpewogICBjb25zdCBycz1XUkFDRVMuZmlsdGVyKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKT09PXYpOwogICBjb25zdCBub0NvdXJzZT1ycy5maWx0ZXIocj0+IShyLnN1cmZhY2UmJnIuZGlzdGFuY2UpKS5sZW5ndGg7CiAgIGNvbnN0IG9kZHM9cnMuZmlsdGVyKHI9Pk9ERFNbYCR7dn0tJHtOdW1iZXIoci5yYWNlTnVtYmVyKXx8MH1gXSkubGVuZ3RoOwogICBsaW5lcy5wdXNoKGBcbuKWoOmWi+WCrOWgtCR7dn3vvIgke3JzWzBdPy52ZW51ZU5hbWV8fCIife+8ieODrOODvOOCuSR7cnMubGVuZ3Rofe+8j+OCs+ODvOOCueS4jeaYjiR7bm9Db3Vyc2V977yP44Kq44OD44K65Y+W5b6XJHtvZGRzfe+8j+ODquODs+OCr+OBguOCiiR7cnMuZmlsdGVyKHI9PnIub2Rkc0NuYW1lKS5sZW5ndGh9YCk7CiAgIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9kZWJ1Zy1lbnRyeT9kYXRlPSR7ZH0mdmVudWU9JHt2fSZyYWNlPTFgLFsxNTAwXSk7ZGVsZXRlIHgub2s7bGluZXMucHVzaChKU09OLnN0cmluZ2lmeSh4KSl9CiAgIGNhdGNoKGUpe2xpbmVzLnB1c2goIuiouuaWreOCqOODqeODvO+8miIrZS5tZXNzYWdlKX0KICB9CiB9ZmluYWxseXskKCJkYmdHbyIpLmRpc2FibGVkPWZhbHNlfQogb3V0LnZhbHVlPWxpbmVzLmpvaW4oIlxuIik7Cn07CiQoImRiZ0NvcHkiKS5vbmNsaWNrPWFzeW5jKCk9Pntjb25zdCB0PSQoImRiZ091dCIpLnZhbHVlO3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0KTskKCJkYmdDb3B5IikudGV4dENvbnRlbnQ9IuOCs+ODlOODvOOBl+OBvuOBl+OBnyJ9Y2F0Y2goZSl7JCgiZGJnT3V0Iikuc2VsZWN0KCk7YWxlcnQoIumBuOaKnuOBl+OBvuOBl+OBn+OAguOCs+ODlOODvOOBl+OBpuOBj+OBoOOBleOBhOOAgiIpfX07CgooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBwYXlTdGF0ZSgpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luOwpzaG93UGFuZSgiV29ya2VyIik7Cgo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
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
      for (const row of rows) { if (row.raceId === makeRaceId(race.date, race.venueCode, race.raceNo)) { row.cls = clsText; row.prize = prize1; } }
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
