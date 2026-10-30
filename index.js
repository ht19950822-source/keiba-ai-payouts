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

  const result = {

    surface: "",

    distance: null

  };


  const text =
    normalizeText(
      stripHtml(
        html
      )
    );


  /*
   * 例
   *
   * コース：1,800メートル（ダート・右）
   */

  let match =
    text.match(
      /コース[：:]\s*([\d,]+)\s*メートル\s*[（(]\s*([^・）)]+)[・）)]/i
    );


  if (match) {

    result.distance =
      toNumberOrNull(
        match[1]
      );


    const surface =
      normalizeText(
        match[2]
      );


    if (
      surface.includes("芝")
    ) {

      result.surface =
        "芝";

    } else if (
      surface.includes("ダート")
    ) {

      result.surface =
        "ダート";

    } else if (
      surface.includes("障害")
    ) {

      result.surface =
        "障害";

    }

  }


  /*
   * 距離の予備取得
   */

  if (
    !result.distance
  ) {

    match =
      text.match(
        /(\d{3,4})\s*メートル/i
      );


    if (match) {

      result.distance =
        toNumberOrNull(
          match[1]
        );

    }

  }


  /*
   * 馬場種別の予備取得
   */

  if (
    !result.surface
  ) {

    if (
      /ダート/.test(
        text
      )
    ) {

      result.surface =
        "ダート";

    } else if (
      /芝/.test(
        text
      )
    ) {

      result.surface =
        "芝";

    } else if (
      /障害/.test(
        text
      )
    ) {

      result.surface =
        "障害";

    }

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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+CjxsaW5rIHJlbD0ibWFuaWZlc3QiIGhyZWY9Ii9tYW5pZmVzdC53ZWJtYW5pZmVzdCI+CjxsaW5rIHJlbD0iYXBwbGUtdG91Y2gtaWNvbiIgaHJlZj0iL2ljb24tMTgwLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSLnqbTppqxBSSI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXN0YXR1cy1iYXItc3R5bGUiIGNvbnRlbnQ9ImJsYWNrLXRyYW5zbHVjZW50Ij4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMxMDE4MjgiPgo8dGl0bGU+56m06aas5aW96LWw44OE44O844OrPC90aXRsZT4KPHN0eWxlPgo6cm9vdHstLWJnOiNmM2Y1Zjc7LS1jYXJkOiNmZmY7LS10eDojMTcyMDJhOy0tc3ViOiM1ZDY4NzU7LS1sbjojZTVlN2ViOy0taGQ6IzEwMTgyODstLXByOiMxNjY3ZDl9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXs6cm9vdHstLWJnOiMwZjE0MWE7LS1jYXJkOiMxYTIxMjk7LS10eDojZThlY2YxOy0tc3ViOiM5YWE2YjI7LS1sbjojMmIzNDNlOy0taGQ6IzA1MDgwYzstLXByOiM0YjhlZjB9fQpib2R5e21hcmdpbjowO2JhY2tncm91bmQ6dmFyKC0tYmcpO2NvbG9yOnZhcigtLXR4KTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLHNhbnMtc2VyaWZ9CmhlYWRlcntiYWNrZ3JvdW5kOnZhcigtLWhkKTtjb2xvcjojZmZmO3BhZGRpbmc6MTRweCAxNnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTlweH0KbWFpbnttYXgtd2lkdGg6OTAwcHg7bWFyZ2luOmF1dG87cGFkZGluZzoxMHB4fQpzZWN0aW9ue2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MTRweDttYXJnaW46MTBweCAwO2JveC1zaGFkb3c6MCAxcHggNHB4ICMwMDAxfQpoMntmb250LXNpemU6MTZweDttYXJnaW46MCAwIDhweH0KYnV0dG9ue2JvcmRlcjowO2JvcmRlci1yYWRpdXM6OXB4O3BhZGRpbmc6MTFweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tcHIpO2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo0cHggNHB4IDRweCAwO2ZvbnQtc2l6ZToxNHB4fQpidXR0b246ZGlzYWJsZWR7b3BhY2l0eTouNH1idXR0b24uc3Vie2JhY2tncm91bmQ6IzY2NzA4NX0KaW5wdXQsc2VsZWN0LHRleHRhcmVhe3BhZGRpbmc6OXB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6OHB4O2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtc2l6ZToxNXB4O21heC13aWR0aDoxMDAlO2JveC1zaXppbmc6Ym9yZGVyLWJveH0KdGV4dGFyZWF7d2lkdGg6MTAwJTttaW4taGVpZ2h0OjEyMHB4O2ZvbnQtZmFtaWx5OmluaGVyaXR9Ci5zbWFsbHtmb250LXNpemU6MTNweDtjb2xvcjp2YXIoLS1zdWIpfS5zdGF0dXN7cGFkZGluZzo5cHg7YmFja2dyb3VuZDp2YXIoLS1iZyk7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDo4cHg7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5nb29ke2NvbG9yOiMxMzczMzM7Zm9udC13ZWlnaHQ6NzAwfS53YXJue2NvbG9yOiNjMjZhMDA7Zm9udC13ZWlnaHQ6NzAwfQp0YWJsZXt3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTNweH10aCx0ZHtwYWRkaW5nOjZweCAzcHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tbG4pO3RleHQtYWxpZ246cmlnaHR9CnRoOm50aC1jaGlsZCgtbisyKSx0ZDpudGgtY2hpbGQoLW4rMil7dGV4dC1hbGlnbjpsZWZ0fQouY2FuZHtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWxuKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzo5cHg7bWFyZ2luOjhweCAwfQouY2hpcHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXNpemU6MTJweDtib3JkZXItcmFkaXVzOjk5OXB4O3BhZGRpbmc6MnB4IDhweDttYXJnaW46M3B4IDRweCAwIDA7YmFja2dyb3VuZDojZWVmMWY1O2NvbG9yOiMzNDQwNTR9Ci5jaGlwLmJ7YmFja2dyb3VuZDojZTBmMmU2O2NvbG9yOiMxMzczMzN9LmNoaXAub3tiYWNrZ3JvdW5kOiNmZmVmY2Y7Y29sb3I6IzlhNWEwMH0uY2hpcC5ne2JhY2tncm91bmQ6I2U2ZTllZTtjb2xvcjojNWQ2ODc1fQoucnR7ZGlzcGxheTppbmxpbmUtYmxvY2s7Zm9udC13ZWlnaHQ6ODAwO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MCA3cHg7Y29sb3I6I2ZmZjtiYWNrZ3JvdW5kOiM5OGEyYjN9Ci5ydC5yU3tiYWNrZ3JvdW5kOiNkOTJkMjB9LnJ0LnJBe2JhY2tncm91bmQ6I2Y3OTAwOX0ucnQuckJ7YmFja2dyb3VuZDojMTY2N2Q5fQoucm93e2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46NnB4IDB9CiNidXN5e2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6IzAwMDg7ei1pbmRleDoyMDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KI2J1c3k+ZGl2e2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxOHB4O2JvcmRlci1yYWRpdXM6MTJweDttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyO3doaXRlLXNwYWNlOnByZS13cmFwfQo8L3N0eWxlPjwvaGVhZD48Ym9keT4KPGhlYWRlcj7nqbTppqzlpb3otbDjg4Tjg7zjg6sgPHNwYW4gc3R5bGU9ImZvbnQtd2VpZ2h0OjQwMDtmb250LXNpemU6MTNweCI+5Y2Y5L2T54mIIHYxPC9zcGFuPjwvaGVhZGVyPgo8bWFpbj4KPHNlY3Rpb24+CjxoMj7imIUg5pys5pel44Gu5aW96LWw56m06aasPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuODnOOCv+ODszHjgaTjgafjgIzlh7rppqzooajjga7lj5blvpcg4oaSIOOCquODg+OCuu+8iOWPluOCjOOCjOOBsO+8ieKGkiDlhajjg6zjg7zjgrnjga7nqbTppqzlgJnoo5zjgI3jgpLooajnpLrjgZfjgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0ic21hbGwiPuKaoCDpgY7ljrvjga7mpJzoqLzvvIgyMDIz5bm044Cc44CB5omV5oi744Gk44GN77yJ77ya56m06aasMeS9jeWAmeijnOOBrjxiPuikh+WLneWbnuWPjueOh+OBr+e0hDcy44CcNzclPC9iPu+8iDEwMCXmnKrmuoDvvInjgafjgZfjgZ/jgILlvZPjgZ/jgorjgoTjgZnjgZXjga7nm67lronjgajjgZfjgabjgYrkvb/jgYTjgY/jgaDjgZXjgYTjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9InRkYXRlIiB0eXBlPSJkYXRlIj48YnV0dG9uIGlkPSJ0b2RheUdvIj7lpb3otbDnqbTppqzjgpLooajnpLo8L2J1dHRvbj48YnV0dG9uIGlkPSJ0b2RheVVwZCIgY2xhc3M9InN1YiI+5pyA5paw44Gu5oiQ57i+44Gr5pu05pawPC9idXR0b24+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyBzbWFsbCI+PGxhYmVsPjxpbnB1dCBpZD0iZm9jdXNPbiIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOKXjueahOS4reeOh+mHjeimlu+8iOODqeODs+OCr1MvQeOBoOOBkeihqOekuuOAguOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCueOBr+WNmOWLnTMw5YCN5pyq5rqA77yJPC9sYWJlbD48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJhdXRvT2RkcyIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOOCquODg+OCuuOCkuiHquWLleOBp+abtOaWsOOBmeOCizwvbGFiZWw+IDxzZWxlY3QgaWQ9ImF1dG9NaW4iPjxvcHRpb24gdmFsdWU9IjMiPjPliIY8L29wdGlvbj48b3B0aW9uIHZhbHVlPSI1IiBzZWxlY3RlZD415YiGPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEw5YiGPC9vcHRpb24+PC9zZWxlY3Q+IOOBlOOBqCA8c3BhbiBpZD0iYXV0b0luZm8iPjwvc3Bhbj48L2Rpdj4KPGRpdiBpZD0idG9kYXlTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OAjOWlvei1sOeptOmmrOOCkuihqOekuuOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAguaIkOe4vuOBjOWPpOOBhOOBqOOBjeOBr+WFiOOBq+OAjOacgOaWsOOBruaIkOe4vuOBq+abtOaWsOOAjeOCkuaKvOOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGlkPSJ0b2RheU91dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgIOODh+ODvOOCv+WPluW+l++8iOOBk+OBruOCouODl+ODquOBoOOBkeOBp+WujOe1kO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj5KUkHlhazlvI/jgYvjgonjgIHpgY7ljrvjga7miJDnuL7vvIjkurrmsJfjgaTjgY3vvInjgajopIfli53jg7vljZjli53jga7miZXmiLvjgpLlj5blvpfjgZfjgabjgIHjgZPjga7nq6/mnKvjgavkv53lrZjjgZfjgb7jgZnjgILlhYPjga7jgqLjg5fjg6rjgoTjg5Djg4Pjgq/jgqLjg4Pjg5fjga/kuI3opoHjgafjgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mjqXntprlhYggPGlucHV0IGlkPSJ3dXJsIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMjBweCIgdmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2Ij48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7mnJ/plpMgPGlucHV0IGlkPSJzc3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj4g44CcIDxpbnB1dCBpZD0ic2VuZCIgdHlwZT0iZGF0ZSI+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY0dvIj7pgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJzeW5jU3RvcCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YGc5q2iPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InN5bmNTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8ZGl2IGlkPSJkYXRhU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPGRldGFpbHM+PHN1bW1hcnkgY2xhc3M9InNtYWxsIj7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yPQ1NW44GL44KJ6Kqt44G/6L6844KA77yI5Lu75oSP77yJPC9zdW1tYXJ5Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+5YWD44Ki44OX44Oq44Gu44OQ44OD44Kv44Ki44OD44OX44GM44GC44KM44Gw44CB5Y+W5b6X44KS55yB55Wl44Gn44GN44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44Gm5Y+W44KK6L6844G/44G+44Gb44KT77yJ44CCPC9kaXY+CjxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgo8L2RldGFpbHM+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgLTEg6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX77yIQ2xvdWRmbGFyZeOBq+S/neWtmO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfjgZfjgZ/miJDnuL7jg7vmiZXmiLvjgpLjgIHjgYLjgarjgZ/jga5DbG91ZGZsYXJl77yIS1bvvInjgavoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZfjgb7jgZnjgII8Yj7jg4fjg7zjgr/jgYzlpInjgo/jgovjgajjgIHntIQz56eS5b6M44Gr5aSJ44KP44Gj44Gf6YOo5YiG44Gg44GR44KS6YCB44KK44G+44GZ44CCPC9iPuODluODqeOCpuOCtuOBruODh+ODvOOCv+OBjOa2iOOBiOOBpuOCguOAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+W+qeWFg+OBp+OBjeOBvuOBme+8iOWIpeOBruerr+acq+OBq+OCguW+qeWFg+OBp+OBjeOBvuOBme+8ieOAguODkeOCueODleODrOODvOOCuuOBneOBruOCguOBruOBr+mAgeS/oeOBl+OBvuOBm+OCk+OAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYmtQYXNzIiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IuODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvIkiIGF1dG9jb21wbGV0ZT0ib2ZmIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMDBweCI+PGJ1dHRvbiBpZD0iYmtTaG93IiBjbGFzcz0ic3ViIj7ooajnpLo8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJrTm93Ij7ku4rjgZnjgZDjg5Djg4Pjgq/jgqLjg4Pjg5c8L2J1dHRvbj48YnV0dG9uIGlkPSJia1Jlc3RvcmUiIGNsYXNzPSJzdWIiPuODkOODg+OCr+OCouODg+ODl+OBi+OCieW+qeWFgzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrRnVsbCIgY2xhc3M9InN1YiI+44GZ44G544Gm5L+d5a2Y44GX55u044GZPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9ImJrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLw8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu5oiQ57i+44Go5omV5oi744Gn44CB5pmC57O75YiX77yI44Gd44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gg44GR77yJ44Gu44OQ44OD44Kv44OG44K544OI44KS44GX44G+44GZ44CC56m044K+44O844Oz44Gv5a6f6Zqb44Gu5Lq65rCX44Gn5Yik5a6a44GX44CB5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44Go5Luu5a6a44GX44G+44GZ44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0iYnRTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPjxidXR0b24gaWQ9ImJ0UnVuIj7mpJzoqLzjgpLlrp/ooYw8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoSDjg6zjg7zjgrnjgpLpgbjjgbY8L2gyPgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InRhYldvcmtlciIgY2xhc3M9InN1YiI+5Ye66aas6KGo44KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0idGFiTWFudWFsIiBjbGFzcz0ic3ViIj7miYvlhaXlips8L2J1dHRvbj48YnV0dG9uIGlkPSJ0YWJQYXN0IiBjbGFzcz0ic3ViIj7pgY7ljrvjg6zjg7zjgrnjgafoqabjgZk8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0icGFuZVdvcmtlciIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5pei5a2Y44GuV29ya2Vy44GuIC9yYWNlLWNhcmRzIOOCkuiqreOBv+WPluOCi+OBoOOBkeOBp+OBme+8iOWkieabtOOBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9IndkYXRlIiB0eXBlPSJkYXRlIj48L2Rpdj4KIDxidXR0b24gaWQ9IndnZXQiPumWi+WCrOODu+ODrOODvOOCueOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNHZXQiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuOCquODg+OCuuOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9IndhbGwiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWFqOODrOODvOOCueS4gOaLrOino+aekDwvYnV0dG9uPjxkaXYgaWQ9IndzdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWPluW+lzwvZGl2PjxkaXYgaWQ9IndsaXN0Ij48L2Rpdj48ZGl2IGlkPSJhbGxvdXQiPjwvZGl2Pgo8L2Rpdj4KPGRpdiBpZD0icGFuZU1hbnVhbCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+MeihjOOBq+OAjOmmrOeVqiDppqzlkI3jgI3jgILku7vmhI/jgafmnIDlvozjgavljZjli53jgqrjg4PjgrrjgILkvovvvJo8YnI+MSDil4vil4vil4vil4sgMy40PGJyPjIg4paz4paz4paz4pazPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0ibWRhdGUiIHR5cGU9ImRhdGUiPjxzZWxlY3QgaWQ9Im1zdXJmIj48b3B0aW9uIHZhbHVlPSIxIj7oip08L29wdGlvbj48b3B0aW9uIHZhbHVlPSIyIj7jg4Djg7zjg4g8L29wdGlvbj48L3NlbGVjdD48aW5wdXQgaWQ9Im1kaXN0IiB0eXBlPSJudW1iZXIiIHN0ZXA9IjEwMCIgdmFsdWU9IjE2MDAiIHN0eWxlPSJ3aWR0aDo5MHB4Ij5tPC9kaXY+CiA8dGV4dGFyZWEgaWQ9Im10ZXh0IiBwbGFjZWhvbGRlcj0iMSDppqzlkI0mIzEwOzIg6aas5ZCNIj48L3RleHRhcmVhPgogPGJ1dHRvbiBpZD0ibWdvIj7jgZPjga7jg6zjg7zjgrnjgpLkvb/jgYY8L2J1dHRvbj4KPC9kaXY+CjxkaXYgaWQ9InBhbmVQYXN0IiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj7kv53lrZjmuIjjgb/jga7pgY7ljrvjg6zjg7zjgrnjgpLjgIHjgZ3jga7ml6XjgojjgorliY3jga7jg4fjg7zjgr/jgaDjgZHjgafkuojmg7PjgZfjgb7jgZnjgILlrp/pmpvjga7nnYDpoIbjgpLkuKbjgbnjgabnorroqo3jgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJwZGF0ZSIgdHlwZT0iZGF0ZSI+PGJ1dHRvbiBpZD0icGdldCI+44Gd44Gu5pel44Gu44Os44O844K55LiA6KanPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJwc3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7ml6Xku5jjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj48ZGl2IGlkPSJwbGlzdCI+PC9kaXY+CjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoiDnqbTppqzlpb3otbDjgpLop6PmnpA8L2gyPgo8ZGl2IGlkPSJyYWNlbGFiZWwiIGNsYXNzPSJzbWFsbCI+44Os44O844K544KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjxidXR0b24gaWQ9InJ1biIgZGlzYWJsZWQ+6Kej5p6Q44GZ44KLPC9idXR0b24+CjxkaXYgaWQ9Im91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGjIOOBk+OBruODhOODvOODq+OBq+OBpOOBhOOBpjwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj4KPGI+5aW96LWw546HPC9iPu+8nTPnnYDlhoXjgavlhaXjgovnorrnjofjga7mjqjlrprjgILpgY7ljrvjga7lrp/nuL7jg4fjg7zjgr/jgYvjgonph43jgb/jgpLlrabnv5LjgZfjgZ/jg6Ljg4fjg6vjgafoqIjnrpfjgZfjgb7jgZnvvIjpgJrnrpfjga4z552A5YaF546H44O744Kv44Op44K56KOc5q2j44GX44Gf5oiQ57i+44O755u06L+RM+i1sOODu+acgOe1guedgOmghuODu+WQjOadoeS7tuOBruWun+e4vuODu+mWk+malOODu+W5tOm9ouODu+aYh+e0mumZjee0muODu+WIneOBruiKneODgOabv+OCj+OCiu+8ieOAgjxicj4KPGI+44Kv44Op44K5PC9iPu+8muacquWLneWIqe+8jzHli53vvI8y5Yud77yPM+WLne+8j+OCquODvOODl+ODs+OCkuWMuuWIpeOBl+OAgeS9juOBhOOCr+ODqeOCueOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjeOBvuOBmeOAguWcsOaWueOBruODh+ODvOOCv+OBjOWQq+OBvuOCjOOCi+WgtOWQiOOBr+OAgeOBleOCieOBq+WJsuOCiuW8leOBjeOBvuOBme+8iEpSQeOBruWFrOW8j+OCteOCpOODiOOBq+OBr+WcsOaWueOBruaIkOe4vuOBjOOBquOBhOOBn+OCgeOAgeS4reWkruOBruOBv+OBruWxpeattOOBp+OBme+8ieOAgjxicj4KPGI+MuOBpOOBruODouODvOODiTwvYj7vvJo8YnI+CuODu+OCquODg+OCuuacquWFpeWKm++8mueptOOCvuODvOODs+OCkuOAjOODhOODvOODq+aOqOWumuOBruS6uuawl++8iOmojuaJi+aIkOe4vui+vOOBv++8ieOAjeOBp+WIpOWumuOAguWun+mam+OBruS6uuawl+OBqOOBruebuOmWouOBrzAuNzjjgafjgZnjgII8YnI+CuODu+OCquODg+OCuuWFpeWKm++8iOOBvuOBn+OBr+mBjuWOu+ODrOODvOOCueOBruS6uuawl+mghuS9je+8ie+8mueptOOCvuODvOODs+OCkuWun+mam+OBruS6uuawl+OBp+WIpOWumuOBl+OBvuOBmeOAguacrOadpeOBruS9v+OBhOaWueOBp+OBmeOAguW4guWgtOOBqOOBruW3ruOCguWHuuOBl+OBvuOBmeOBjOOAgeaknOiovOOBp+OBr+W9k+OBn+OCiuOBq+e1kOOBs+S7mOOBi+OBquOBi+OBo+OBn+OBn+OCgeWPguiAg+eoi+W6puOBq+OBl+OBpuOBj+OBoOOBleOBhOOAgjxicj4KPGI+6KGo56S644Gu6Kqt44G/5pa5PC9iPu+8muWlvei1sOeOh+OBr+OAgeOBneOBrummrOOBruOAjOeptOOCvuODvOODs+WGheOBp+OBruWun+e4vuODmeODvOOCueOBrueiuueOh+OAjeOBp+OBmeOAguWxpeattOOBruOBquOBhOmmrOOCguOAgemgreaVsOOBjOWkmuOBkeOCjOOBsOe0hDLlibLjgavjgarjgorjgb7jgZnvvIgxNemgreeri+OBpuOBpzPpoK3jgYwz552A5YaF44Gr5YWl44KL44Gf44KB77yJ44CC6KmV5L6h44Op44Oz44Kv44Gv44CB56m044K+44O844Oz44Gu5bmz5Z2H44Gu5L2V5YCN44GL44Gn5rG644KB44Gm44GE44G+44GZ44CCPGJyPgo8Yj7mpJzoqLzvvIgyMDI05bm05Lul6ZmN44O75a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJPC9iPu+8mjxicj4K44O744Oi44OH44Or57K+5bqm77yI5a++5pWw5pCN5aSx77yJ77ya5pen44Oi44OH44OrMC40NzEg4oaSIOaWsOODouODh+ODqzAuNDUw77yI5bCP44GV44GE44G744Gp6Imv44GE77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZPjga4z552A5YaF546HIDkuMSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6vjga4x5L2N5YCZ6KOcMTMuMiUg4oaSIOaWsOODouODh+ODqzE2LjUl77yI5LiK5L2NMumgrTE1LjQl77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrmnKrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZMgMTEuNSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6sxOC41JSDihpIg5paw44Oi44OH44OrMjEuMyXvvIjkuIrkvY0y6aCtMTkuNyXvvInjgII8YnI+CuODuzxiPuKXjueahOS4reeOh+mHjeimljwvYj7vvIjlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O75Y2Y5YudMzDlgI3mnKrmuoDvvInvvJox5L2N5YCZ6KOc44Gu55qE5Lit546H44Gv44CB44Kq44OD44K644GC44KKMTcuMiXihpIyMy4yJeOAgeOCquODg+OCuuOBquOBlzIxLjcl4oaSMjcuMiXjgavkuIrjgYzjgorjgb7jgZnvvIjliY3ljYrjg7vlvozljYrjgajjgoLlkIzjgZjlgr7lkJHvvInjgILlgJnoo5zjga8x6ZaL5YKs5pel44GC44Gf44KK57SEMTTpoK3jgafjgZnjgII8YnI+44O744Op44Oz44Kv44Go5a6f57i+77yaU++8nkHvvJ5C77yeQ+OBrumghuOBqzPnnYDlhoXnjofjgYzkuIvjgYzjgorjgb7jgZnvvIjjgqrjg4PjgrrmnKrlhaXlipvmmYLvvJozMyXvvI8yNCXvvI8yMCXvvI8xMyXvvInjgII8YnI+CuODuzxiPuikh+WLneOBruWbnuWPjueOh+OBjDEwMCXjgpLotoXjgYjjgovjgajjga/jgIHjgb7jgaDnorroqo3jgafjgY3jgabjgYTjgb7jgZvjgpPjgII8L2I+5YCZ6KOc44Gv5b2T44Gf44KL56K6546H44GM6auY44GE5YiG44CB6YWN5b2T44GM5L2O44KB44Gn44GZ44CC4pGgLTLjgaflv4XjgZrnorroqo3jgZfjgabjgY/jgaDjgZXjgYTjgII8YnI+CjxiPuWAmeijnOOBruadoeS7tjwvYj7vvJrlrp/nuL7jga7jgYLjgovppqzvvIgz6LWw5Lul5LiK77yJ44Gg44GR44KS5YCZ6KOc44Gr44GX44G+44GZ44CC5bGl5q2044Gu5LmP44GX44GE6aas44Gv5aW96LWw546H44GM5ZCM54K544Gr44Gq44KK44KE44GZ44GP44CB6aCG5L2N44Gr5oSP5ZGz44GM44Gq44GE44Gf44KB44Gn44GZ44CC5paw6aas5oim44Gq44Gp44Gv5a++6LGh5aSW44Gr44Gq44KK44G+44GZ44CCPGJyPgrjgqrjg4Pjgrrjg7vkurrmsJfjga/kuojmuKzjga7lhaXlipvjgavjga/kvb/jgaPjgabjgYTjgb7jgZvjgpPvvIjkurrmsJfjga7ku6PnkIbjg6Ljg4fjg6vjga7lrabnv5Ljg6njg5njg6vjgajjgIHnqbTjgr7jg7zjg7Pjga7liKTlrprjgIHlppnlkbPjga7mr5TovIPjgavjga7jgb/kvb/nlKjvvInjgILopIfli53lm57lj47njofjga/jgIHmiZXmiLvjgpLlj5blvpfjgZfjgZ/jgYLjgajjgavikaAtMuOBp+aknOiovOOBp+OBjeOBvuOBmeOAggo8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaQg6YmE5p2/6Lu46aas77yI6KSH5Yud5ZyP5YaFIOe0hDk1Je+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrnjgafjgIEz552A5Lul5YaF44Gr5YWl44KL56K6546H44GM5qW144KB44Gm6auY44GE6aas44KS5Ye644GX44G+44GZ44CC6YGO5Y6744Gu5a6f57i+77yIMjAyNOW5tOS7pemZje+8ieOBp+OAgeOAjOmJhOadv+OAjeOBrzk2Je+8iDk1JeW5hSA5NOOAnDk5Je+8ieOAgeOAjOa6lumJhOadv+OAjeOBrzg5JeOAgeOAjOWghei7uOOAjeOBrzg0JeOBp+OBl+OBn+OAguikh+WLneOBrumFjeW9k+OBr+S9juOBhO+8iDEwMOOAnDEyMOWGhuWJjeW+jO+8ieOBruOBp+OAgTxiPuODr+OCpOODieODu+mmrOmAo+ODuzPpgKPopIfjgarjganjga7ou7g8L2I+44Go44GX44Gm5L2/44GG5oOz5a6a44Gn44GZ44CC44Kq44OD44K644GM44Gq44GE5YmN5pel44Gv44CB5Yik5a6a44Gn44GN44G+44Gb44KT44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJhZGF0ZSIgdHlwZT0iZGF0ZSI+PGJ1dHRvbiBpZD0iYXhpc0dvIj7piYTmnb/ou7jjgajms6LkubHluqbjgpLooajnpLo8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0iYXhpc1N0YXR1cyIgY2xhc3M9InN0YXR1cyI+5pel5LuY44KS6YG444KT44Gn5oq844GX44Gm44GP44Gg44GV44GE77yI5Ye66aas6KGo44Go44Kq44OD44K644KS5Y+W5b6X44GX44Gm44CB4pGk4pGl44KS5ZCM5pmC44Gr6KGo56S644GX44G+44GZ77yJ44CCPC9kaXY+CjxkaXYgaWQ9ImF4aXNPdXQiPjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRpSDlhajjg6zjg7zjgrnjga7ms6LkubHluqbvvIhTU1PjgJxD77yJPC9oMj4KPGRpdiBjbGFzcz0ic21hbGwiPuOAjDPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iu+8neS6uuawl+iWhOOBjOe1oeOCgOOAjeODrOODvOOCueOBq+OBquOCi+eiuueOh+OBp+OAgeetiee0muOCkuS7mOOBkeOBvuOBmeOAgumBjuWOu+OBruWun+e4vu+8iDIwMjTlubTku6XpmY3vvInvvJpTU1MgNTfjgJw2OCXjgIFTUyA1MeOAnDYwJeOAgVMgNDPjgJw0NiXjgIFBIDM1JeOAgUIgMjTjgJwyNSXjgIFDIDjjgJw5Je+8iOWFqOODrOODvOOCueW5s+Wdh+OBrzI4LjUl77yJ44CC44Kq44OD44K644GM44GC44KM44Gw57K+5bqm44GM5LiK44GM44KK44G+44GZ44CCPGI+6I2S44KM44KE44GZ44GV44Gu55uu5a6J44Gn44CB56m06aas44GM5b2T44Gf44KL44GL44Gp44GG44GL44Go44Gv5Yil44Gn44GZ44CCPC9iPjwvZGl2Pgo8ZGl2IGlkPSJ1cHNldE91dCIgY2xhc3M9InN0YXR1cyI+4pGk44Gu44CM6YmE5p2/6Lu444Go5rOi5Lmx5bqm44KS6KGo56S644CN44KS5oq844GZ44Go44CB44GT44GT44Gr5YWo44Os44O844K544Gu5LiA6Kan44GM5Ye644G+44GZ44CCPC9kaXY+Cjwvc2VjdGlvbj4KPC9tYWluPgo8ZGl2IGlkPSJidXN5Ij48ZGl2IGlkPSJidXN5VGV4dCI+5Yem55CG5Lit4oCmPC9kaXY+PC9kaXY+CjxzY3JpcHQ+CiJ1c2Ugc3RyaWN0IjsKLyog56m06aas5aW96LWw44Ko44Oz44K444Oz77yI5Y2Y5L2T54mI44O744OW44Op44Km44K2L05vZGXlhbHnlKjvvInjgILjgqrjg4Pjgrrjg7vkurrmsJfjga/jgrnjgrPjgqLjgavkvb/nlKjjgZfjgarjgYTjgIIgKi8KY29uc3QgVUU9KCgpPT57CiAvKiDlrp/jg4fjg7zjgr/mpJzoqLzjgafpgIblirnmnpzjgaDjgaPjgZ/miJDliIbvvIjpqI7miYvjg7vplpPpmpTvvInjga/ml6LlrprjgadPRkYgKi8KIGNvbnN0IERFRkFVTFQ9e2pvY2tleTpmYWxzZSxsYXlvZmY6ZmFsc2V9OwogY29uc3QgY2xhbXA9KHgsYSxiKT0+TWF0aC5tYXgoYSxNYXRoLm1pbihiLHgpKTsKIGNvbnN0IHNpZ21vaWQ9eD0+MS8oMStNYXRoLmV4cCgteCkpOwogY29uc3QgbG9naXQ9cD0+e3A9Y2xhbXAocCwuMDAxLC45OTkpO3JldHVybiBNYXRoLmxvZyhwLygxLXApKX07CiBjb25zdCBubj1zPT5TdHJpbmcocz8/IiIpLm5vcm1hbGl6ZSgiTkZLQyIpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW1xzXHUzMDAwXSsvZywiIikucmVwbGFjZSgvW+ODu++9pS7vvI5cLeKAkOKAkeKAkuKAk+KAlOKAlSfigJlgXS9nLCIiKS5yZXBsYWNlKC9b4piG4piF4paz4pay4peH4peGXS9nLCIiKTsKIC8qIOmojuaJi+WQje+8muWFiOmgreOBruasp+Wtl+OCpOODi+OCt+ODo+ODq+OCkumZpOOBjeOAgeODh+ODoOODvOODreKGkuODh+ODoCDjgavmj4PjgYjjgovvvIhKUkHjga4gQy7jg4fjg6Djg7zjg60g44Go6YGO5Y6744OH44O844K/44GuIO+8o++8juODh+ODoCDjgpLkuIDoh7TjgZXjgZvjgovvvIkgKi8KIGNvbnN0IGpubj1zPT57bGV0IHY9bm4oU3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9cZHsyfSg/OlwuXGQpP1xzKig/OmtnfO+9i++9hykvZ2ksIiAiKS5yZXBsYWNlKC9b77yIKF1bXu+8iSldezAsOH1b77yJKV0vZywiICIpLnJlcGxhY2UoLyjmoJfmnbF8576O5rWmKS9nLCIgIikpO3Y9di5yZXBsYWNlKC9eW2Etel0oPz1b44KhLeODtuODvF0pLywiIik7dj12LnJlcGxhY2UoL17jg4fjg6Djg7zjg60vLCLjg4fjg6AiKTtyZXR1cm4gdn07CiAvKiDjgq/jg6njgrnjga7mrrXpmo7vvJowPeS4jeaYjiAvIC0xPeWcsOaWuSAvIDE95paw6aas44O75pyq5Yud5YipIC8gMj0x5YudIC8gMz0y5YudIC8gND0z5YudIC8gNT3jgqrjg7zjg5fjg7Pjg7vph43os54gKi8KIGNvbnN0IGxldmVsT2ZMYWJlbD10PT57Y29uc3Qgcz1TdHJpbmcodHx8IiIpO2lmKC/lnLDmlrl8TkFSLy50ZXN0KHMpKXJldHVybiAtMTtpZigv5paw6aasfOacquWLneWIqS8udGVzdChzKSlyZXR1cm4gMTtpZigvMeWLnXw1MDDkuIcvLnRlc3QocykpcmV0dXJuIDI7aWYoLzLli518MTAwMOS4hy8udGVzdChzKSlyZXR1cm4gMztpZigvM+WLnXwxNjAw5LiHLy50ZXN0KHMpKXJldHVybiA0O2lmKC/jgqrjg7zjg5fjg7N877yv77ywfE9QfOODquOCueODhuODg+ODiXzph43os55877ynfEdbMTIzSV0vaS50ZXN0KHMpKXJldHVybiA1O3JldHVybiAwfTsKIGNvbnN0IGxldmVsT2ZQcml6ZT1wPT57cD1OdW1iZXIocCk7cmV0dXJuICEocD4wKT8wOnA8PTcwMD8xOnA8PTkwMD8yOnA8PTEzMDA/MzpwPD0xODAwPzQ6NX07CiBjb25zdCBpc0pyYVZlbnVlPWM9Pi9eKDBbMS05XXwxMCkkLy50ZXN0KFN0cmluZyhjfHwiIikpOwogY29uc3Qgc3VyZkNvZGU9cz0+e3M9U3RyaW5nKHN8fCIiKTtyZXR1cm4gL+iKnXx0dXJmL2kudGVzdChzKT8xOi/jg4B8ZGlydC9pLnRlc3Qocyk/Mjov6ZqcfGp1bXAvaS50ZXN0KHMpPzM6MH07CiBjb25zdCBkbnVtPWQ9Pk51bWJlcihTdHJpbmcoZHx8IiIpLnJlcGxhY2UoL1xEL2csIiIpLnNsaWNlKDAsOCkpfHwwOwogZnVuY3Rpb24gcGFyc2VEYXRlKHMpewogIHM9U3RyaW5nKHN8fCIiKTtsZXQgbT1zLm1hdGNoKC8oXGR7NH0pXER7MCw0fShcZHsxLDJ9KVxEezAsNH0oXGR7MSwyfSkvKTsKICBpZighbSlyZXR1cm4iIjtyZXR1cm4gYCR7bVsxXX0tJHttWzJdLnBhZFN0YXJ0KDIsIjAiKX0tJHttWzNdLnBhZFN0YXJ0KDIsIjAiKX1gOwogfQogZnVuY3Rpb24gY3N2Um93cyh0ZXh0KXsKICBjb25zdCBsaW5lcz1TdHJpbmcodGV4dHx8IiIpLnJlcGxhY2UoL15cdUZFRkYvLCIiKS5zcGxpdCgvXHI/XG4vKS5maWx0ZXIoeD0+eC50cmltKCkpOwogIGlmKCFsaW5lcy5sZW5ndGgpcmV0dXJuW107CiAgY29uc3Qgc3BsaXQ9bD0+e2NvbnN0IGE9W107bGV0IGM9IiIscT1mYWxzZTtmb3IobGV0IGk9MDtpPGwubGVuZ3RoO2krKyl7Y29uc3QgY2g9bFtpXTsKICAgaWYoY2g9PT0nIicpe2lmKHEmJmxbaSsxXT09PSciJyl7Yys9JyInO2krK31lbHNlIHE9IXF9ZWxzZSBpZihjaD09PSIsIiYmIXEpe2EucHVzaChjKTtjPSIifWVsc2UgYys9Y2h9YS5wdXNoKGMpO3JldHVybiBhfTsKICBjb25zdCBoZWFkPXNwbGl0KGxpbmVzWzBdKS5tYXAoeD0+eC50cmltKCkpO2NvbnN0IG91dD1bXTsKICBmb3IobGV0IGk9MTtpPGxpbmVzLmxlbmd0aDtpKyspe2NvbnN0IGE9c3BsaXQobGluZXNbaV0pLG89e307Zm9yKGxldCBqPTA7ajxoZWFkLmxlbmd0aDtqKyspb1toZWFkW2pdXT1hW2pdPz8iIjtvdXQucHVzaChvKX0KICByZXR1cm4gb3V0OwogfQogY29uc3QgZj12PT57Y29uc3Qgbj1wYXJzZUZsb2F0KFN0cmluZyh2Pz8iIikucmVwbGFjZSgvLC9nLCIiKSk7cmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKT9uOm51bGx9OwogLyog44OQ44OD44Kv44Ki44OD44OXL0NTVuOBrjHooYzihpLou73ph4/ooYwgKi8KIGZ1bmN0aW9uIHRvUm93KG8pewogIGNvbnN0IHNhPVN0cmluZyhvWyLmgKfpvaIiXXx8IiIpO2NvbnN0IGFtPXNhLm1hdGNoKC8oXGQrKS8pOwogIHJldHVybntyYWNlSWQ6U3RyaW5nKG9bIiJdPz9vLnJhY2VfaWQ/P29bIlVubmFtZWQ6IDAiXT8/IiIpLGRhdGU6cGFyc2VEYXRlKG8uZGF0ZXx8b1si5pel5LuYIl0pLAogICBuYW1lOlN0cmluZyhvWyLppqzlkI0iXXx8by5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpubihvWyLppqzlkI0iXXx8by5ob3JzZSksam9ja2V5OmpubihvWyLpqI7miYsiXXx8by5qb2NrZXkpLGpuYW1lOlN0cmluZyhvWyLpqI7miYsiXXx8by5qb2NrZXl8fCIiKS50cmltKCksZmluaXNoOmYob1si552A6aCGIl0/P28uZmluaXNoKSwKICAgZGlzdDpmKG8uY291cnNlX2xlbj8/b1si6Led6ZuiIl0/P28uZGlzdGFuY2UpfHwwLHN1cmY6c3VyZkNvZGUoby5yYWNlX3R5cGV8fG9bIuiKneODgCJdfHxvLnN1cmZhY2UpLAogICBhZ2U6YW0/TnVtYmVyKGFtWzFdKTpudWxsLG51bTpmKG9bIummrOeVqiJdKSxwb3A6ZihvWyLkurrmsJciXSksb2RkczpmKG9bIuWNmOWLnSJdKSwKICAgbHZsOigoKT0+e2NvbnN0IGlkPVN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz8iIik7aWYoL15cZHsxMn0kLy50ZXN0KGlkKSYmIWlzSnJhVmVudWUoaWQuc2xpY2UoNCw2KSkpcmV0dXJuIC0xO3JldHVybiBsZXZlbE9mTGFiZWwob1siY2xhc3MiXXx8by5jbHMpfSkoKX07CiB9CiAvKiDmiJDnuL7jgrnjg4jjgqLvvIjml6Xku5jmmIfpoIbjgasgYWRkIOOBmeOCi++8iSAqLwogZnVuY3Rpb24gU3RvcmUoKXt0aGlzLmg9bmV3IE1hcCgpO3RoaXMuaj1uZXcgTWFwKCl9CiBTdG9yZS5wcm90b3R5cGUuYWRkPWZ1bmN0aW9uKHIpewogIGlmKHIuZmluaXNoPT1udWxsfHwhci5ob3JzZSlyZXR1cm47CiAgY29uc3QgdDM9ci5maW5pc2g+PTEmJnIuZmluaXNoPD0zPzE6MDsKICBsZXQgaD10aGlzLmguZ2V0KHIuaG9yc2UpO2lmKCFoKXRoaXMuaC5zZXQoci5ob3JzZSxoPXtuOjAsdG9wMzowLHdpbjowLHN1bTowLGxhc3Q6IiIscnVuczpbXSxsdjp7fX0pOwogIGgubisrO2gudG9wMys9dDM7aWYoci5maW5pc2g9PT0xKWgud2luKys7aC5zdW0rPXIuZmluaXNoO2lmKHIuZGF0ZT5oLmxhc3QpaC5sYXN0PXIuZGF0ZTsKICBjb25zdCBMPXIubHZsfHwwOyhoLmx2W0xdPWgubHZbTF18fFswLDBdKTtoLmx2W0xdWzBdKys7aC5sdltMXVsxXSs9dDM7CiAgaC5ydW5zLnB1c2goW2RudW0oci5kYXRlKSxyLmZpbmlzaCxyLmRpc3Qsci5zdXJmLExdKTtpZihoLnJ1bnMubGVuZ3RoPjYpe2gucnVucy5zb3J0KChhLGIpPT5hWzBdLWJbMF0pO2gucnVucy5zaGlmdCgpfQogIGlmKHIuam9ja2V5KXtsZXQgaj10aGlzLmouZ2V0KHIuam9ja2V5KTtpZighail0aGlzLmouc2V0KHIuam9ja2V5LGo9e246MCx0b3AzOjB9KTtqLm4rKztqLnRvcDMrPXQzfQogfTsKIC8qIOmojuaJi++8muWujOWFqOS4gOiHtOKGku+8iOefreOBhOihqOiomOOBquOCie+8ieWJjeaWueS4gOiHtOOBpzHkurrjgavntZ7jgozjgovjgajjgY3jgaDjgZHmjqHnlKggKi8KIFN0b3JlLnByb3RvdHlwZS5qb2NrZXk9ZnVuY3Rpb24obmFtZSl7CiAgaWYoIW5hbWUpcmV0dXJuIG51bGw7CiAgY29uc3Qgaj10aGlzLmouZ2V0KG5hbWUpO2lmKGopcmV0dXJuIGo7CiAgaWYobmFtZS5sZW5ndGg8Mnx8bmFtZS5sZW5ndGg+NClyZXR1cm4gbnVsbDsKICBpZighdGhpcy5famt8fHRoaXMuX2prU2l6ZSE9PXRoaXMuai5zaXplKXt0aGlzLl9qaz1bLi4udGhpcy5qLmtleXMoKV07dGhpcy5famtTaXplPXRoaXMuai5zaXplfQogIGNvbnN0IGM9dGhpcy5famsuZmlsdGVyKGs9Pmsuc3RhcnRzV2l0aChuYW1lKXx8KG5hbWUubGVuZ3RoPj0zJiZrLnN0YXJ0c1dpdGgobmFtZS5zbGljZSgwLC0xKSkmJm5hbWUubGVuZ3RoPD1rLmxlbmd0aCkpOwogIHJldHVybiBjLmxlbmd0aD09PTE/dGhpcy5qLmdldChjWzBdKTpudWxsOwogfTsKIGNvbnN0IGxheW9mZj0obGFzdCx0YXJnZXQpPT57aWYoIWxhc3QpcmV0dXJuIC41O2NvbnN0IGE9KG5ldyBEYXRlKHRhcmdldCktbmV3IERhdGUobGFzdCkpLzg2NGU1OwogIHJldHVybiBhPDIxPy43MjphPDYwPy42MjphPDEyMD8uNTU6YTwyNDA/LjQ4Oi40Mn07CiAvKiA9PT09PSDlrp/nuL7jgYvjgonlrabnv5LjgZfjgZ/jg6Ljg4fjg6vvvIjnibnlvrTph4/ihpIz552A5YaF546H77yJID09PT09ICovCiBjb25zdCBGTj1bImJpYXMiLCJvZmZzZXQiLCJubG9nIiwibm9IaXN0IiwiZlMiLCJmQyIsImF2Z0YiLCJyM3NoYXJlIiwicjNhdmciLCJsYXN0MSIsImxhc3RCaWciLCJjb25kRGlmZiIsImZpcnN0U3VyZiIsImdhcFNob3J0IiwiZ2FwTG9uZyIsImdhcFZMb25nIiwiYWdlMyIsImFnZTQiLCJhZ2U3Iiwic3RlcFVwIiwic3RlcERvd24iLCJ3aW5SYXRlIl07CiBjb25zdCBGSj1bImpSZWwiLCJqbG9nIiwiak1pc3MiXTsKIC8qIOS/guaVsOOBryB0b29scy9maXRfbW9kZWwuanMg44Gn5a2m57+S77yIMjAyMOW5tOOAnOOBruaZguezu+WIl+ODh+ODvOOCv++8ieOAgnt9IOOCkue9ruaPmyAqLwogY29uc3QgTU9ERUw9eyJjb3JlIjpbMC4wNTI5OSwwLjk5Njk3LDAuMDQ5NTEsLTAuMjQ1NDMsLTAuNTI4MTIsMC45MTk0NiwtMC41MTQ3NiwtMC4zNDc4NiwtMC41NzkwNCwtMC41NTExOCwwLjE2NzczLDEuMTE4MiwtMC4zNTMwNSwtMC4xMTEyOCwtMC4yMjcyOCwtMC40MDEyOSwwLjEzNzcxLDAuMjE2NjIsLTAuMzk2NzMsLTAuMzUzMDUsMC4wMDYxNywtMC41OTU2NF0sImZ1bGwiOlswLjQwNDMzLDEuMzcwMDcsMC4wNjI1MSwtMC4xMjI3OSwtMC41MDIzMiwwLjgyOTc4LC0wLjM5ODk1LC0wLjMwMDcyLC0wLjUxNTU5LC0wLjUyNTMyLDAuMTU4MzIsMS4wNjY5NSwtMC4zODM3NywtMC4wNzI4MiwtMC4yMjU2OCwtMC4zNTEsMC4xNTAyNSwwLjIxMjUzLC0wLjQxMzM0LC0wLjMyMzE5LDAuMDA3MjYsLTAuOTM3OTIsMC41MzU1NywwLjAwMzY1LC0wLjIwNjA1XX07CiBmdW5jdGlvbiBmZWF0cyhyLHN0b3JlLHJhY2UsTix3aXRoSil7CiAgY29uc3QgYj1jbGFtcCgzL04sLjA4LC41KSxsYj1sb2dpdChiKSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLG49aD9oLm46MCxMdD1yYWNlLmx2bHx8MDsKICBjb25zdCBwUz0oKGg/aC50b3AzOjApKzMqYikvKG4rMyksZlM9bG9naXQocFMpLWxiOwogIC8vIOOCr+ODqeOCueijnOato++8muS9juOBhOOCr+ODqeOCue+8iOWcsOaWueOCkuWQq+OCgO+8ieOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjwogIGxldCBmQz1mUzsKICBpZihoJiZMdD4wKXtsZXQgSD0wLE09MDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoaC5sdikpe2NvbnN0IEw9TnVtYmVyKGspLFtjbixjdF09aC5sdltrXTtjb25zdCBnPUw9PT0wPzA6KEw8MD8tMjpMLUx0KTsKICAgIEgrPWN0KmNsYW1wKDErLjMqZywuNCwxLjgpO00rPShjbi1jdCkqY2xhbXAoMS0uMypnLC40LDEuOCl9CiAgIGZDPWxvZ2l0KChIKzMqYikvKEgrTSszKSktbGJ9CiAgY29uc3QgcnVucz1oP2gucnVuczpbXSxyYz1ydW5zLnNsaWNlKC0zKSxsYXN0Uj1ydW5zLmxlbmd0aD9ydW5zW3J1bnMubGVuZ3RoLTFdOm51bGw7CiAgY29uc3QgcjNzaGFyZT1yYy5sZW5ndGg/cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aC9yYy5sZW5ndGg6MDsKICBjb25zdCByM2F2Zz1yYy5sZW5ndGg/Y2xhbXAoKHJjLnJlZHVjZSgoYSx4KT0+YSt4WzFdLDApL3JjLmxlbmd0aC02KS82LC0xLDIpOjA7CiAgY29uc3QgbGFzdDE9bGFzdFI/Y2xhbXAoKGxhc3RSWzFdLTYpLzYsLTEsMik6MCxsYXN0QmlnPWxhc3RSJiZsYXN0UlsxXT49MTA/MTowOwogIGNvbnN0IHNjPXJhY2Uuc3VyZixkaXN0PXJhY2UuZGlzdHx8MDtsZXQgY29uZERpZmY9MCxmaXJzdFN1cmY9MDsKICBpZihzYyYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJighZGlzdHx8TWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKSk7CiAgIGlmKGNyLmxlbmd0aCljb25kRGlmZj0oY3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCsyKnBTKS8oY3IubGVuZ3RoKzIpLXBTOwogICBpZihydW5zLmxlbmd0aD49MyYmIXJ1bnMuc29tZSh4PT54WzNdPT09c2MpJiZydW5zLnNvbWUoeD0+eFszXSYmeFszXSE9PXNjKSlmaXJzdFN1cmY9MX0KICBsZXQgZ2FwPW51bGw7aWYoaCYmaC5sYXN0JiZyYWNlLmRhdGUpZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogIGNvbnN0IGE9ci5hZ2V8fDA7CiAgY29uc3Qgc3RlcEQ9bGFzdFImJmxhc3RSWzRdPjAmJkx0PjA/Y2xhbXAoTHQtbGFzdFJbNF0sLTMsMyk6MDsKICBjb25zdCB4PVsxLGxiLE1hdGgubG9nKDErbiksbj09PTA/MTowLGZTLGZDLG4/Y2xhbXAoKGguc3VtL24tNikvNiwtMSwyKTowLHIzc2hhcmUscjNhdmcsbGFzdDEsbGFzdEJpZyxjb25kRGlmZixmaXJzdFN1cmYsCiAgIGdhcCE9bnVsbCYmZ2FwPDIxPzE6MCxnYXAhPW51bGwmJmdhcD4xMjA/MTowLGdhcCE9bnVsbCYmZ2FwPjI0MD8xOjAsYT09PTM/MTowLGE9PT00PzE6MCxhPj03PzE6MCxzdGVwRD4wP3N0ZXBEOjAsc3RlcEQ8MD8tc3RlcEQ6MCwKICAgbj8oKGgud2luKy4zKmIpLyhuKzEuNSktYik6MF07CiAgaWYod2l0aEope2NvbnN0IGo9c3RvcmUuam9ja2V5KHIuam9ja2V5KTsKICAgaWYoaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpO3gucHVzaChsb2dpdChwSiktbGIsTWF0aC5sb2coMStqLm4pLDApfWVsc2UgeC5wdXNoKDAsMCwxKX0KICByZXR1cm4geDsKIH0KIGNvbnN0IGRvdD0odyx4KT0+e2xldCB6PTA7Zm9yKGxldCBpPTA7aTx4Lmxlbmd0aDtpKyspeis9KHdbaV18fDApKnhbaV07cmV0dXJuIHp9OwogY29uc3QgbW9kZWxaPShraW5kLHgpPT5kb3QoTU9ERUxba2luZF0seCk7CiAvKiAx6aCt44Gu57Sg54K5KGxvZ2l0KeOBqOOCv+OCsOOAgmNvbXAg44Gn5oiQ5YiG44KST04vT0ZG44Gn44GN44KL77yI5qSc6Ki855So77yJICovCiBmdW5jdGlvbiBob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXA9e30pewogIGNvbXA9T2JqZWN0LmFzc2lnbih7fSxERUZBVUxULGNvbXApO2NvbnN0IHVzZT1rPT5jb21wW2tdIT09ZmFsc2UmJmNvbXBba10hPT0wOwogIGNvbnN0IGI9Y2xhbXAoMy9OLC4xLC41KSxoPXN0b3JlLmguZ2V0KHIuaG9yc2UpLGo9c3RvcmUuai5nZXQoci5qb2NrZXkpOwogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10sbj1oP2gubjowLHRhZ3M9W107bGV0IHo9MCxjb25mPSLkvY4iOwogIGNvbnN0IHBIPSgoaD9oLnRvcDM6MCkrNCpiKS8obis0KTt6Kz1sb2dpdChwSCk7CiAgaWYobj49Miljb25mPW4+PTU/IumrmCI6IuS4rSI7ZWxzZSB0YWdzLnB1c2goe3Q6IuWxpeattOS4jei2syIsYzoiZyJ9KTsKICBpZihuPj0zKXtjb25zdCB0Mz1oLnRvcDMvbix3PWgud2luL247CiAgIGlmKHQzPj0uNDAmJnc8PS4yMCl0YWdzLnB1c2goe3Q6YOWWhOaIpuWeiyAz552A5YaFJHtNYXRoLnJvdW5kKHQzKjEwMCl9JS8ke2596LWwYCxjOiJiIn0pOwogICBlbHNlIGlmKHQzPj0uNDUpdGFncy5wdXNoKHt0OmDlronlrpogM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgaWYodXNlKCJhdmciKSYmaC5zdW0vbjw9NSl6Kz0uMTJ9CiAgY29uc3QgcmM9cnVucy5zbGljZSgtMyk7CiAgaWYodXNlKCJyZWNlbnQiKSYmcmMubGVuZ3RoPj0yKXtjb25zdCBjMz1yYy5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLGF2Zz1yYy5yZWR1Y2UoKHMseCk9PnMreFsxXSwwKS9yYy5sZW5ndGg7CiAgIHorPS4yMiooYzMvcmMubGVuZ3RoLXBIKSozO2lmKGMzPj0yKXRhZ3MucHVzaCh7dDpg6L+RJHtyYy5sZW5ndGh96LWw44GnJHtjM33lm54z552A5YaFYCxjOiJiIn0pOwogICBjb25zdCBsYXN0PXJ1bnNbcnVucy5sZW5ndGgtMV07CiAgIGlmKGxhc3QmJmxhc3RbMV0+PTgmJm4+PTQmJmgudG9wMy9uPj0uMzUpe3orPS4xNTt0YWdzLnB1c2goe3Q6YOWJjei1sCR7bGFzdFsxXX3nnYDjgYvjgonlt7vjgY3ov5TjgZfkvZnlnLBgLGM6Im8ifSl9CiAgIGlmKGF2Zzw9NCYmcmMubGVuZ3RoPj0zKXorPS4wOH0KICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7CiAgaWYodXNlKCJjb25kIikmJnNjJiZkaXN0JiZydW5zLmxlbmd0aCl7CiAgIGNvbnN0IGNyPXJ1bnMuZmlsdGVyKHg9PnhbM109PT1zYyYmTWF0aC5hYnMoeFsyXS1kaXN0KTw9MjAwKTsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpe3otPS4zNTt0YWdzLnB1c2goe3Q6YCR7c2M9PT0xPyLliJ3jga7oip0iOiLliJ3jga7jg4Djg7zjg4gife+8iOmBjuWOu+i1sOOBr+WIpemmrOWgtO+8iWAsYzoibyJ9KX0KICAgaWYoY3IubGVuZ3RoPj0yKXtjb25zdCB0Mz1jci5maWx0ZXIoeD0+eFsxXTw9MykubGVuZ3RoLHBjPSh0MysyKnBIKS8oY3IubGVuZ3RoKzIpOwogICAgeis9Y2xhbXAoMioocGMtcEgpLC0uNSwuNSk7aWYodDM+PTIpdGFncy5wdXNoKHt0OmDlkIzmnaHku7bjgacke3QzfS8ke2NyLmxlbmd0aH3lm54z552A5YaFYCxjOiJiIn0pfX0KICBpZih1c2UoImpvY2tleSIpJiZqJiZqLm4+PTUpe2NvbnN0IHBKPShqLnRvcDMrMTUqYikvKGoubisxNSksZGo9Y2xhbXAoLjYqKGxvZ2l0KHBKKS1sb2dpdChiKSksLS40LC41KTsKICAgeis9ZGo7aWYoZGo+PS4yNSl0YWdzLnB1c2goe3Q6YOmojuaJi+WlveiqvyAz552A5YaFJHtNYXRoLnJvdW5kKGoudG9wMy9qLm4qMTAwKX0lYCxjOiJiIn0pfQogIGlmKHVzZSgibGF5b2ZmIikmJmgmJmgubGFzdCl7Y29uc3QgZ2FwPU1hdGgucm91bmQoKG5ldyBEYXRlKHJhY2UuZGF0ZSktbmV3IERhdGUoaC5sYXN0KSkvODY0ZTUpOwogICB6Kz0uNioobGF5b2ZmKGgubGFzdCxyYWNlLmRhdGUpLS41KTtpZihnYXA+PTE4MCl0YWdzLnB1c2goe3Q6YCR7Z2FwfeaXpeOBtuOCimAsYzoibyJ9KX0KICBpZih1c2UoImFnZSIpKXtjb25zdCBhPXIuYWdlfHw1O2lmKGE9PT0zKXorPS4xMDtlbHNlIGlmKGE9PT00KXorPS4wNTtlbHNlIGlmKGE+PTgpe3otPS4xNTt0YWdzLnB1c2goe3Q6YCR7YX3mrbNgLGM6Im8ifSl9fQogIHJldHVybnt6LHRhZ3MsY29uZixufTsKIH0KIC8qIDIwMjPlubTku6XpmY3jga7mmYLns7vliJfmpJzoqLzjgafjga4g57Sg44Gu5aW96LWw546H4oaS56m044K+44O844Oz5a6f57i+77yI5bmz5Z2HcCwg5a6f57i+77yJICovCiBjb25zdCBDQUw9W1swLDAuMDFdLFswLjAyMiwwLjAxN10sWzAuMDQ2LDAuMDIyXSxbMC4wNzUsMC4wNDZdLFswLjEwNSwwLjA2OF0sWzAuMTM1LDAuMDgyXSxbMC4xNjUsMC4wOThdLFswLjE5MywwLjEwM10sWzAuMjI0LDAuMTM4XSxbMC4yNTksMC4xNjFdLFswLjMwMiwwLjE4N10sWzAuMzU4LDAuMjExXSxbMC40NTQsMC4yMjldXTsKIC8qIOOCquODg+OCuuOBquOBl+ODouODvOODie+8iOS6uuawl+OBruS7o+eQhu+8nemojuaJi+i+vOOBv+OBruWtpue/kuODouODh+ODq+OBrumghuS9jeOBp+eptOOCvuODvOODs+OCkuWIpOWumu+8ieOBruijnOato+ihqOOAgjIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPjgafkvZzmiJAgKi8KIGNvbnN0IENBTF9QUk9YWT1bWzAsMC4wMTNdLFswLjAyMiwwLjAyMV0sWzAuMDQ2LDAuMDI4XSxbMC4wNzUsMC4wNTZdLFswLjEwNSwwLjA4Nl0sWzAuMTM1LDAuMTExXSxbMC4xNjUsMC4xMzRdLFswLjE5MywwLjE0Nl0sWzAuMjI0LDAuMjAxXSxbMC4yNTksMC4yMTldLFswLjMwMSwwLjI2MV0sWzAuMzU1LDAuMjk2XSxbMC40MzksMC4zNjddXTsKIGZ1bmN0aW9uIGludGVycChULHApe2ZvcihsZXQgaT0xO2k8VC5sZW5ndGg7aSsrKWlmKHA8PVRbaV1bMF0pe2NvbnN0W2EsYl09VFtpLTFdLFtjLGRdPVRbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIFRbVC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBjYWxpYkZvcihwLG1vZGUpe3JldHVybiBtb2RlPT09Im9kZHMiP2ludGVycChDQUwscCk6aW50ZXJwKENBTF9QUk9YWSxwKX0KIGZ1bmN0aW9uIGNhbGliKHApe2ZvcihsZXQgaT0xO2k8Q0FMLmxlbmd0aDtpKyspaWYocDw9Q0FMW2ldWzBdKXtjb25zdFthLGJdPUNBTFtpLTFdLFtjLGRdPUNBTFtpXTtyZXR1cm4gYisoZC1iKSoocC1hKS8oYy1hKX1yZXR1cm4gQ0FMW0NBTC5sZW5ndGgtMV1bMV19CiBmdW5jdGlvbiBub3JtYWxpemVUb3AzKHpzLHRvdGFsKXtsZXQgbG89LTgsaGk9ODsKICBmb3IobGV0IGk9MDtpPDYwO2krKyl7Y29uc3QgYz0obG8raGkpLzIscz16cy5yZWR1Y2UoKGEseik9PmErc2lnbW9pZCh6K2MpLDApO2lmKHM+dG90YWwpaGk9YztlbHNlIGxvPWN9CiAgY29uc3QgYz0obG8raGkpLzI7cmV0dXJuIHpzLm1hcCh6PT5zaWdtb2lkKHorYykpfQogLyogSGFydmlsbGXms5Xjgafli53njofihpIz552A5YaF546HICovCiBmdW5jdGlvbiB0b3AzRnJvbVdpbihwdyl7Y29uc3QgVD1wdy5yZWR1Y2UoKGEsYik9PmErYiwwKSxwPXB3Lm1hcCh4PT54L1QpLG49cC5sZW5ndGgsb3V0PW5ldyBBcnJheShuKS5maWxsKDApOwogIGZvcihsZXQgaT0wO2k8bjtpKyspe2xldCBzPXBbaV07CiAgIGZvcihsZXQgaj0wO2o8bjtqKyspaWYoaiE9PWkpe3MrPXBbal0qcFtpXS8oMS1wW2pdKTsKICAgIGZvcihsZXQgaz0wO2s8bjtrKyspaWYoayE9PWkmJmshPT1qKXMrPXBbal0qcFtrXS8oMS1wW2pdKSpwW2ldLygxLXBbal0tcFtrXSl9CiAgIG91dFtpXT1zfXJldHVybiBvdXR9CiAvKiDjg6zjg7zjgrnop6PmnpDjgIJvZGRzIOOBr+S7u+aEj++8iOWFqOmgreWIhu+8ieOAgiAqLwogY29uc3QgTFZOPVsi5LiN5piOIiwi5pyq5Yud5YipIiwiMeWLnSIsIjLli50iLCIz5YudIiwiT1AiXTsKIGZ1bmN0aW9uIGV4dHJhVGFncyh0YWdzLHIsc3RvcmUscmFjZSl7CiAgY29uc3QgdD10YWdzLnNsaWNlKCksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxMdD1yYWNlLmx2bHx8MDsKICBpZihoKXtjb25zdCBsYXN0PWgucnVucy5sZW5ndGg/aC5ydW5zW2gucnVucy5sZW5ndGgtMV06bnVsbDsKICAgaWYobGFzdCYmbGFzdFs0XT4wJiZMdD4wJiZsYXN0WzRdIT09THQpdC51bnNoaWZ0KGxhc3RbNF08THQ/e3Q6YOaYh+e0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6Im8ifTp7dDpg6ZmN57Sa77yIJHtMVk5bbGFzdFs0XV194oaSJHtMVk5bTHRdfe+8iWAsYzoiYiJ9KTsKICAgaWYoaC5sdiYmaC5sdlstMV0pdC5wdXNoKHt0OiLlnLDmlrnjgafjga7lh7rotbDjgYLjgorvvIjlibLlvJXoqZXkvqHvvIkiLGM6ImcifSl9CiAgcmV0dXJuIHR9CiAvKiDjg6njg7Pjgq/vvJrnqbTjgr7jg7zjg7Pjga7lubPlnYfjgavlr77jgZnjgovlgI3njofjgacgUy9BL0IvQ++8iOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44Gn77yJICovCiBjb25zdCBBVkdfSE9MRT17b2RkczouMDkxLHByb3h5Oi4xMTV9OwogZnVuY3Rpb24gcmF0aW5nKHBjLG1vZGUsbil7Y29uc3Qgcj1wYy9BVkdfSE9MRVttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXTtsZXQgaz1yPj0yLjI/IlMiOnI+PTEuNz8iQSI6cj49MS4zPyJCIjoiQyI7aWYobjwyJiYoaz09PSJTInx8az09PSJBIikpaz0iQiI7cmV0dXJuIGt9CiAvKiDnmoTkuK3njofph43oppbvvJrlrp/nuL4z6LWw5Lul5LiK44O744Op44Oz44KvUy9B44O777yI44Kq44OD44K644GM5YiG44GL44KL44Go44GN44Gv77yJ5Y2Y5YudMzDlgI3mnKrmuoDjga7lpKfnqbTjgpLpmaTjgY/jgILpgY7ljrvjga7mpJzoqLzjgafjgIHnmoTkuK3njofjgYzkuIrjgYzjgorjgIHlm57lj47njofjgYzmnIDmgqrjga7lpKfnqbTjgpLpgb/jgZHjgonjgozjgZ8gKi8KIGNvbnN0IEZPQ1VTX01BWF9PRERTPTMwOwogY29uc3QgRk9DVVM9eyJvZGRzIjp7Im4iOjM2MjUsImhpdCI6MC4yMzIsImJhc2VIaXQiOjAuMTcyLCJwZXJEYXkiOjEzLjZ9LCJwcm94eSI6eyJuIjo0MDI1LCJoaXQiOjAuMjcyLCJiYXNlSGl0IjowLjIxNywicGVyRGF5IjoxNS4xfX07ICAgLy8gMjAyNOW5tOS7pemZjeOBruaknOiovO+8mueahOS4reeOh++8iGJhc2VIaXQ95b6T5p2l44GuMeS9jeWAmeijnO+8ieODu+mWi+WCrOaXpeOBguOBn+OCiuOBrumgreaVsAogZnVuY3Rpb24gcGlja0ZvY3VzKHJlcyxrKXtyZXR1cm4gcmVzLmZpbHRlcih4PT54LmhvbGUmJngubj49MyYmKHJhdGluZyh4LnBjLHgubW9kZSx4Lm4pPT09IlMifHxyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKT09PSJBIikmJih4Lm9kZD09bnVsbHx8eC5vZGQ8Rk9DVVNfTUFYX09ERFMpKS5zb3J0KChhLGIpPT5iLnAtYS5wKS5zbGljZSgwLGspfQogLyog56m06aas5YCZ6KOc77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuOAgeWlvei1sOeOh+OBrumrmOOBhOmghuOBqyBrIOmgreOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+WQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeWvvuixoeWkliAqLwogZnVuY3Rpb24gcGljayhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiBmdW5jdGlvbiBhbmFseXplKHJhY2Usc3RvcmUsb2Rkcyxjb21wLHBvcEFycil7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aDsKICBjb25zdCBzYz1SLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXApKTsKICBjb25zdCB6Yz1NT0RFTC5jb3JlP1IubWFwKHI9Pm1vZGVsWigiY29yZSIsZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKSk6c2MubWFwKHg9Pngueik7CiAgY29uc3QgcD1ub3JtYWxpemVUb3AzKHpjLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9TU9ERUwuZnVsbD9SLm1hcChyPT5tb2RlbFooImZ1bGwiLGZlYXRzKHIsc3RvcmUscmFjZSxOLHRydWUpKSk6Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7cG9wPXB4Lm1hcCh2PT4xK3B4LmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgb2RkOihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSk/b2Rkc1tpXTpudWxsLAogICBjYXJlZXI6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD97bjpoLm4sdDM6aC50b3AzLHdpbjpoLndpbn06bnVsbH0pKCksCiAgIHJlY2VudDooKCk9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gucnVucy5tYXAoeD0+eFsxXSk6W119KSgpLAogICBqbmFtZTpyLmpuYW1lfHwiIixqc3RhdDooKCk9Pntjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7cmV0dXJuIGomJmoubj49MT97bjpqLm4scmF0ZTpqLnRvcDMvai5ufTpudWxsfSkoKSwKICAgaG9sZTpOPj02JiZwb3BbaV0+PWN1dCxta3Q6bWt0P21rdFtpXTpudWxsLHZhbHVlOm1rdD9jYWxpYkZvcihwW2ldLCJvZGRzIikvbWt0W2ldOm51bGwsCiAgIHRhZ3M6ZXh0cmFUYWdzKHNjW2ldLnRhZ3MscixzdG9yZSxyYWNlKSxjb25mOnNjW2ldLmNvbmYsbjpzY1tpXS5uLGN1dH0pKTsKIH0KCiAvKiA9PT09PSDpiYTmnb/ou7jppqzjg7vms6LkubHluqbvvIjnqbTppqzkuojmg7Pjgajjga/liKXjga7oqIjnrpfjgILkv4LmlbDjga8gdG9vbHMvYXhpc191cHNldF9zdHVkeS5qcyDjgaflrabnv5LjgIEyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5qSc6Ki877yJID09PT09ICovCiBjb25zdCBBWElTPXsid1AiOlswLjA1MTkzLDEuMDE0ODMsMC4wNTE0OCwtMC4yMDY3NiwtMC41MzIxNiwwLjkxNDM3LC0wLjQ4NDY0LC0wLjMyMTE1LC0wLjU2ODAyLC0wLjU1MTM1LDAuMTczNDUsMS4wOTc0LC0wLjI4NDA3LC0wLjEwMzk3LC0wLjIxNjE3LC0wLjM0NjY4LDAuMTU5MTMsMC4yMjE5NiwtMC4zODczMiwtMC4zNDY1OCwwLjAwMzcsLTAuNTY2NDZdLCJ3TyI6WzAuNTQyNTksMC4xNTY2MSwwLjA1NDE0LC0wLjA0MzcxLC0wLjE0NTI0LDAuMTMxNzEsLTAuMTQxNzgsLTAuMTYyNjMsMC4wNTMxNiwtMC4wMjA5NywwLjAwMzksLTAuMjk4NjUsLTAuMzIzMjEsLTAuMDEzNjUsLTAuMDk1MTksLTAuMDc4MTgsMC4wMDA2LC0wLjAyMjkxLC0wLjExMjEzLDAuMDE3ODEsLTAuMDQ3NDUsLTAuMTA4NTIsMC4yNTcyMSwwLjYzMDcxXSwidXBzZXQiOnsidGhyIjoxNSwibW9kZWxzIjp7InByb3h5IjpbMi4yNDU1OSwwLjYzODQxLC0wLjA3MDgsLTAuMDgxNjEsLTAuMDc3NDMsMC4wOTEzNywwLjEzODQ3LDAuMDAyNzksLTAuMzg5MTksLTAuNjQyMTcsLTAuNTUzODEsLTAuMDE4MzcsLTAuNDQzMTcsLTAuNzY4MjUsLTAuNTIzOTMsLTIuNzM1NjEsLTAuMTQ5MDksMC4xMTQ3N10sIm9kZHMiOlstMC43MjM5NiwwLjQyODA4LC0wLjA3NDk5LC0wLjA2MTU0LC0wLjAwNjc1LDAuMDcyNDMsMC4wNzA4NSwtMC4wNDk3NCwtMC4xNTUyOCwtMC4zMjUxNiwtMC40MTgyNiwtMC4zMTM1MSwwLjIwNzU3LC0wLjIzOSwtMC4yNzkwMSwtMS44MjEwOCwtMC4wMDg1MiwwLjA4Mzk5LDAuMTUwMjQsMC4zNTI0MiwtMi4wMzgzOSwyLjg1NjY4LDAuMjI5MjksMC43MjA4NCwtMS45Nzc5N119LCJncmFkZXMiOnsicHJveHkiOnsiY3V0cyI6W1siU1NTIiwwLjU1MDM3XSxbIlNTIiwwLjQ4NTVdLFsiUyIsMC40MDQyNF0sWyJBIiwwLjI5ODhdLFsiQiIsMC4xODk1N10sWyJDIiwwLjAwNjI5XV0sInJhdGVzIjp7IlNTUyI6MC41NzQsIlNTIjowLjUwOSwiUyI6MC40MzMsIkEiOjAuMzQ3LCJCIjowLjI0NCwiQyI6MC4wODl9LCJhdmdTIjp7IlNTUyI6MTcuMiwiU1MiOjE1LjMsIlMiOjE0LjIsIkEiOjEzLjEsIkIiOjExLjgsIkMiOjkuOH19LCJvZGRzIjp7ImN1dHMiOltbIlNTUyIsMC42MDk2OF0sWyJTUyIsMC41MTU5NV0sWyJTIiwwLjQwODU0XSxbIkEiLDAuMjg3NjddLFsiQiIsMC4xNzM1OV0sWyJDIiwwLjAwNzY4XV0sInJhdGVzIjp7IlNTUyI6MC42NzksIlNTIjowLjU5OCwiUyI6MC40NTUsIkEiOjAuMzUyLCJCIjowLjI0NiwiQyI6MC4wNzl9LCJhdmdTIjp7IlNTUyI6MTguNSwiU1MiOjE2LjQsIlMiOjE0LjUsIkEiOjEzLjMsIkIiOjExLjgsIkMiOjkuNn19fX0sImJhbmRzIjp7IumJhOadvyI6eyJsbyI6MC45MiwiaGkiOjEsIm4iOjE2NiwicmF0ZSI6MC45NjM5LCJsbzk1IjowLjkzNTUsIm4yIjo4NywicmF0ZTIiOjAuOTc3LCJwZXJEYXkiOjAuNjJ9LCLmupbpiYTmnb8iOnsibG8iOjAuODgsImhpIjowLjkyLCJuIjoyNzksInJhdGUiOjAuODg1MywibG85NSI6MC44NDc5LCJuMiI6MTM5LCJyYXRlMiI6MC44OTkzLCJwZXJEYXkiOjEuMDR9LCLloIXou7giOnsibG8iOjAuODQsImhpIjowLjg4LCJuIjo0NzQsInJhdGUiOjAuODQxOCwibG85NSI6MC44MDg5LCJuMiI6MjI2LCJyYXRlMiI6MC44NDA3LCJwZXJEYXkiOjEuNzh9fX07CiBmdW5jdGlvbiBheGlzUHJvYnMocmFjZSxzdG9yZSxvZGRzKXsKICBjb25zdCBSPXJhY2UucnVubmVycyxOPVIubGVuZ3RoLHhjPVIubWFwKHI9PmZlYXRzKHIsc3RvcmUscmFjZSxOLGZhbHNlKSk7CiAgY29uc3QgcFA9bm9ybWFsaXplVG9wMyh4Yy5tYXAoeD0+ZG90KEFYSVMud1AseCkpLE1hdGgubWluKDMsTikpOwogIGxldCBwTz1udWxsOwogIGlmKG9kZHMmJm9kZHMubGVuZ3RoPT09TiYmb2Rkcy5ldmVyeShvPT5vPjEpKXsKICAgY29uc3QgaW52PW9kZHMubWFwKG89PjEvbyksVD1pbnYucmVkdWNlKChhLGIpPT5hK2IsMCkscHc9aW52Lm1hcCh2PT52L1QpLG0zPXRvcDNGcm9tV2luKG9kZHMubWFwKG89PjEvbykpOwogICBwTz1ub3JtYWxpemVUb3AzKHhjLm1hcCgoeCxpKT0+ZG90KEFYSVMud08sWy4uLngsTWF0aC5sb2cocHdbaV0pLGxvZ2l0KE1hdGgubWluKC45OCxtM1tpXSkpXSkpLE1hdGgubWluKDMsTikpfQogIHJldHVybntwUCxwTyx4Y319CiAvKiDpiYTmnb/ou7jppqzvvJrjgqrjg4PjgrrjgYzjgYLjgovjg6zjg7zjgrnjgaDjgZHjgILkuojmuKznorrnjofjga7ljLrliIbjgZTjgajjgavjgIHpgY7ljrvjga7lrp/pmpvjga4z552A5YaF546H44KS5re744GI44KLICovCiBmdW5jdGlvbiBheGlzUGlja3MocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7aWYoIWFwLnBPKXJldHVybiBudWxsOwogIGNvbnN0IG91dD1bXTthcC5wTy5mb3JFYWNoKChwLGkpPT57CiAgIGZvcihjb25zdCBrIG9mIFsi6YmE5p2/Iiwi5rqW6YmE5p2/Iiwi5aCF6Lu4Il0pe2NvbnN0IGI9QVhJUy5iYW5kc1trXTtpZihwPj1iLmxvJiZwPChrPT09IumJhOadvyI/MS4wMTpiLmhpKSl7b3V0LnB1c2goe2kscCx0aWVyOmsscmF0ZTpiLnJhdGUsbG85NTpiLmxvOTUsbjpiLm59KTticmVha319fSk7CiAgcmV0dXJuIG91dC5zb3J0KChhLGIpPT5iLnAtYS5wKX0KIC8qIOazouS5seW6pu+8mlNTU+OAnEPjgIIz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrjgavjgarjgovnorrnjofjgafnrYnntJrjgaXjgZEgKi8KIGZ1bmN0aW9uIHVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZGRzLGFwKXsKICBhcD1hcHx8YXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyk7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCxwcz1hcC5wUC5zbGljZSgpLnNvcnQoKGEsYik9PmItYSk7CiAgY29uc3QgbnM9Ui5tYXAocj0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/aC5uOjB9KSxtb250aD1OdW1iZXIoU3RyaW5nKHJhY2UuZGF0ZSkuc2xpY2UoNSw3KSl8fDAsTD1yYWNlLmx2bHx8MDsKICBjb25zdCBmPVsxLE4vMTYsTD09PTE/MTowLEw9PT0yPzE6MCxMPT09Mz8xOjAsTD09PTQ/MTowLEw9PT01PzE6MCxyYWNlLnN1cmY9PT0xPzE6MCwocmFjZS5kaXN0fHwwKS8yMDAwLAogICBucy5maWx0ZXIobj0+bj09PTApLmxlbmd0aC9OLG5zLmZpbHRlcihuPT5uPDMpLmxlbmd0aC9OLG5zLnJlZHVjZSgoYSxuKT0+YStNYXRoLmxvZygxK24pLDApL04vMywKICAgcHNbMF0scHNbMV0scHNbMl0scHMucmVkdWNlKChhLHApPT5hK3AqcCwwKSxwcy5maWx0ZXIocD0+cD4uNSkubGVuZ3RoLzMsbW9udGg+PTYmJm1vbnRoPD05PzE6MF07CiAgbGV0IG1vZGU9InByb3h5IjsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKS5zb3J0KChhLGIpPT5iLWEpLG9kPW9kZHMuc2xpY2UoKS5zb3J0KChhLGIpPT5hLWIpOwogICBjb25zdCBlbnQ9LXB3LnJlZHVjZSgoYSxwKT0+YStwKk1hdGgubG9nKHApLDApL01hdGgubG9nKE4pOwogICBmLnB1c2gocHdbMF0scHdbMV0scHdbMF0rcHdbMV0rcHdbMl0sZW50LE1hdGgubG9nKG9kWzBdKSxNYXRoLmxvZyhvZFsxXSksb2QuZmlsdGVyKG89Pm88MTApLmxlbmd0aC9OKTttb2RlPSJvZGRzIn0KICBjb25zdCBwPXNpZ21vaWQoZG90KEFYSVMudXBzZXQubW9kZWxzW21vZGVdLGYpKSxHPUFYSVMudXBzZXQuZ3JhZGVzW21vZGVdOwogIGxldCBncmFkZT0iQyI7Zm9yKGNvbnN0IFtnLGNdIG9mIEcuY3V0cyl7aWYocD49Yyl7Z3JhZGU9ZzticmVha319CiAgcmV0dXJue2dyYWRlLHAsbW9kZSxyYXRlOkcucmF0ZXNbZ3JhZGVdLGF2Z1M6Ry5hdmdTW2dyYWRlXX19CgogLyog5omV5oi744Gk44GN5pmC57O75YiX44OQ44OD44Kv44OG44K544OI44CCcmFjZXMg44Gv5pel5LuY5piH6aCGIFt7aWQsZGF0ZSxyb3dzfV3jgIFwYXlCeUlkIOOBryB7cmFjZUlkOntwbGFjZTpbe251bWJlcix5ZW59XX1944CCCiAgICDnqbTjgr7jg7zjg7Pjga/lrp/jgqrjg4PjgrrpoIbkvY3jgaflrprnvqnvvIjjg4Tjg7zjg6vjga7jgqrjg4PjgrrlhaXlipvjg6Ljg7zjg4njgajlkIzjgZjnirbms4HvvInjgILlkITjg6zjg7zjgrkxMDDlhobjgZrjgaTos7zlhaXjgIIgKi8KIGZ1bmN0aW9uIGJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQsb3B0cyl7CiAgb3B0cz1vcHRzfHx7fTtjb25zdCBTVEFSVD1vcHRzLnN0YXJ0fHwiIixTUExJVD1vcHRzLnNwbGl0fHwiIixPT1M9b3B0cy5vb3N8fCIiLFBST1hZPSEhb3B0cy5wcm94eTsKICBjb25zdCBuYW1lcz1bInRvcDEiLCJ0b3AyIiwidG9wMyIsImFsbEhvbGUiLCJ2YWx1ZSIsImF4aXMiLCJmb2N1cyJdLHBlcj1bImFsbCIsIkEiLCJCIiwiQyJdOwogIGNvbnN0IFM9e307Zm9yKGNvbnN0IG4gb2YgbmFtZXMpe1Nbbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKVNbbl1bcF09e2JldHM6MCxoaXRzOjAscmV0OjAsc3E6MH19CiAgY29uc3QgU0VHPXt9OyAgIC8vIDHkvY3lgJnoo5zjga7mnaHku7bliKXvvIjlhajmnJ/plpPvvI/liY3ljYrvvI/lvozljYrvvIkKICBjb25zdCBzdG9yZT1uZXcgU3RvcmUoKTtsZXQgdXNlZD0wOwogIGNvbnN0IGFkZD0obixwLGhpdCx5ZW4pPT57Y29uc3QgeD1TW25dW3BdO3guYmV0cysrO2lmKGhpdCl4LmhpdHMrKzt4LnJldCs9eWVuO3guc3ErPXllbip5ZW59OwogIGNvbnN0IGFkZFNlZz0obGFiZWwscCx5ZW4pPT57Y29uc3QgZz1TRUdbbGFiZWxdPVNFR1tsYWJlbF18fHthbGw6e246MCxoOjAscjowLHE6MH0sQTp7bjowLGg6MCxyOjAscTowfSxCOntuOjAsaDowLHI6MCxxOjB9fTtmb3IoY29uc3QgayBvZiBbImFsbCIscF0pe2NvbnN0IHg9Z1trXTt4Lm4rKztpZih5ZW4+MCl4LmgrKzt4LnIrPXllbjt4LnErPXllbip5ZW59fTsKICBjb25zdCBBVj1QUk9YWT8uMTE1Oi4wOTE7CiAgZm9yKGNvbnN0IHJjIG9mIHJhY2VzKXsKICAgLy8g5omV5oi744GuSUTjga/jgIzml6Xku5gt6ZaL5YKs5aC0LVLnlarlj7fjgI3jgILjg5Djg4Pjgq/jgqLjg4Pjg5fjga4xMuahgUlE44Go44KC44CB5ZCM44GY5b2i5byP44GuSUTjgajjgoLntZDjgbPku5jjgZHjgosKICAgY29uc3Qgdk9mPS9eXGR7MTJ9JC8udGVzdChyYy5pZCk/cmMuaWQuc2xpY2UoNCw2KTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbM118fCIiLHJPZj1OdW1iZXIoL15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSgxMCwxMik6U3RyaW5nKHJjLmlkKS5zcGxpdCgiLSIpWzRdfHwwKTsKICAgY29uc3QgcGF5PXBheUJ5SWRbcmMuaWRdfHxwYXlCeUlkW2Ake3JjLmRhdGV9LSR7dk9mfS0ke1N0cmluZyhyT2YpLnBhZFN0YXJ0KDIsIjAiKX1gXTsKICAgaWYocGF5JiZwYXkucGxhY2UmJnBheS5wbGFjZS5sZW5ndGgmJnJjLmRhdGU+PVNUQVJUKXsKICAgIC8vIOWHuui1sOihqOOBqOWQjOOBmOmmrOeVqumghuOBq+S4puOBueOCi++8iOWQjOeCueOBruOBqOOBjeOBruS4puOBs+OBp+edgOmghuOBjOa8j+OCjOOBquOBhOOCiOOBhuOBq++8iQogICAgY29uc3QgUj1yYy5yb3dzLmZpbHRlcihyPT5yLmhvcnNlJiZyLmZpbmlzaCE9bnVsbCkuc29ydCgoYSxiKT0+KGEubnVtfHwwKS0oYi5udW18fDApKTsKICAgIGNvbnN0IGhhc09kZHM9Ui5sZW5ndGg+PTYmJlIuZXZlcnkocj0+ci5vZGRzPjEpLGhhc1BvcD1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLnBvcD4wKTsKICAgIGlmKFBST1hZP1IubGVuZ3RoPj02OihoYXNPZGRzfHxoYXNQb3ApKXsKICAgICBjb25zdCByYWNlPXtkYXRlOnJjLmRhdGUsc3VyZjpSWzBdLnN1cmYsZGlzdDpSWzBdLmRpc3QsbHZsOlJbMF0ubHZsfHwwLHJ1bm5lcnM6Un07CiAgICAgY29uc3QgcmVzPVBST1hZP2FuYWx5emUocmFjZSxzdG9yZSxudWxsKTooaGFzT2Rkcz9hbmFseXplKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk6YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwsbnVsbCxSLm1hcChyPT5yLnBvcCkpKTsKICAgICBjb25zdCB5ZW49bmV3IE1hcChwYXkucGxhY2UubWFwKHg9Plt4Lm51bWJlcix4Lnllbl0pKTsKICAgICBjb25zdCBob2xlPXJlcy5maWx0ZXIoeD0+eC5ob2xlKS5zb3J0KChhLGIpPT5iLnAtYS5wKTsKICAgICBpZihob2xlLmxlbmd0aCl7CiAgICAgIHVzZWQrKztjb25zdCBwcj1TUExJVD8ocmMuZGF0ZTxTUExJVD8iQSI6IkIiKToiQSI7CiAgICAgIGNvbnN0IGJ1eT0obixsaXN0KT0+e2Zvcihjb25zdCB4IG9mIGxpc3Qpe2NvbnN0IHk9eWVuLmdldChSW3guaV0ubnVtKXx8MDthZGQobiwiYWxsIix5PjAseSk7YWRkKG4scHIseT4wLHkpO2lmKE9PUyYmcmMuZGF0ZT49T09TKWFkZChuLCJDIix5PjAseSl9fTsKICAgICAgYnV5KCJmb2N1cyIscGlja0ZvY3VzKHJlcywxKSk7CiAgICAgIGJ1eSgidG9wMSIscGljayhyZXMsMSkpO2J1eSgidG9wMiIscGljayhyZXMsMikpO2J1eSgidG9wMyIscGljayhyZXMsMykpO2J1eSgiYWxsSG9sZSIsaG9sZSk7CiAgICAgIGlmKCFQUk9YWSlidXkoInZhbHVlIixob2xlLmZpbHRlcih4PT54LnZhbHVlPj0xLjMpKTsKICAgICAgaWYoIVBST1hZJiZoYXNPZGRzKXtjb25zdCBhcD1heGlzUHJvYnMocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTtpZihhcC5wTylidXkoImF4aXMiLGFwLnBPLm1hcCgocCxpKT0+KHtpLHB9KSkuZmlsdGVyKHg9PngucD49QVhJUy5iYW5kc1si6YmE5p2/Il0ubG8pKX0KICAgICAgY29uc3QgdD1waWNrKHJlcywxKVswXTsKICAgICAgaWYodCl7Y29uc3QgeT15ZW4uZ2V0KFJbdC5pXS5udW0pfHwwLHI9dC5wYy9BVixOPVIubGVuZ3RoOwogICAgICAgY29uc3QgcmFuaz0ocj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiKTsKICAgICAgIGFkZFNlZygi44Op44Oz44KvIisodC5uPDImJihyYW5rPT09IlMifHxyYW5rPT09IkEiKT8iQiI6cmFuaykscHIseSk7CiAgICAgICBhZGRTZWcoTjw9MTA/IumgreaVsCDjgJwxMCI6Tjw9MTQ/IumgreaVsCAxMeOAnDE0Ijoi6aCt5pWwIDE144CcIixwcix5KTsKICAgICAgIGFkZFNlZyhyYWNlLnN1cmY9PT0xPyLoip0iOnJhY2Uuc3VyZj09PTI/IuODgOODvOODiCI6IuOBneOBruS7liIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5sdmw+MD8i44Kv44Op44K5ICIrTFZOW3JhY2UubHZsXToi44Kv44Op44K5IOS4jeaYjiIscHIseSk7CiAgICAgICBhZGRTZWcodC5uPj01PyLlrp/nuL4gNei1sOS7peS4iiI6dC5uPj0zPyLlrp/nuL4gM+OAnDTotbAiOiLlrp/nuL4gM+i1sOacqua6gCIscHIseSk7CiAgICAgICBpZighUFJPWFkmJnQub2RkKXtjb25zdCBvPXQub2RkO2FkZFNlZyhvPDg/IuWNmOWLnSDjgJw45YCNIjpvPDE1PyLljZjli50gOOOAnDE15YCNIjpvPDMwPyLljZjli50gMTXjgJwzMOWAjSI6bzw2MD8i5Y2Y5YudIDMw44CcNjDlgI0iOiLljZjli50gNjDlgI3jgJwiLHByLHkpOwogICAgICAgIGlmKGhhc09kZHMpe2NvbnN0IHVnPXVwc2V0R3JhZGUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTthZGRTZWcoIuazouS5seW6piAiK3VnLmdyYWRlLHByLHkpfX19CiAgICAgfQogICAgfQogICB9CiAgIGZvcihjb25zdCByIG9mIHJjLnJvd3Mpc3RvcmUuYWRkKHIpOwogIH0KICBjb25zdCBmaW49e307CiAgZm9yKGNvbnN0IG4gb2YgbmFtZXMpe2ZpbltuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpe2NvbnN0IHg9U1tuXVtwXTsKICAgaWYoIXguYmV0cyl7ZmluW25dW3BdPXtiZXRzOjB9O2NvbnRpbnVlfQogICBjb25zdCBtZWFuPXgucmV0L3guYmV0cyxzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnNxL3guYmV0cy1tZWFuKm1lYW4pKTsKICAgZmluW25dW3BdPXtiZXRzOnguYmV0cyxoaXRSYXRlOnguaGl0cy94LmJldHMscm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4LmJldHMpLzEwMH19fQogIGNvbnN0IHNlZ3M9e307CiAgZm9yKGNvbnN0IFtrLGddIG9mIE9iamVjdC5lbnRyaWVzKFNFRykpe3NlZ3Nba109e307Zm9yKGNvbnN0IHAgb2YgWyJhbGwiLCJBIiwiQiJdKXtjb25zdCB4PWdbcF07CiAgIGlmKCF4Lm4pe3NlZ3Nba11bcF09e2JldHM6MH07Y29udGludWV9Y29uc3QgbWVhbj14LnIveC5uLHNkPU1hdGguc3FydChNYXRoLm1heCgwLHgucS94Lm4tbWVhbiptZWFuKSk7CiAgIHNlZ3Nba11bcF09e2JldHM6eC5uLGhpdFJhdGU6eC5oL3gubixyb2k6bWVhbi8xMDAsc2U6c2QvTWF0aC5zcXJ0KHgubikvMTAwfX19CiAgcmV0dXJue3JhY2VzOnVzZWQsc3RhdHM6ZmluLHNlZ3N9OwogfQogcmV0dXJue0ZPQ1VTLHJhdGluZyxwaWNrRm9jdXMsQVhJUyxheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUscGljayxmZWF0cyxNT0RFTCxGTixGSixsZXZlbE9mTGFiZWwsbGV2ZWxPZlByaXplLGJhY2t0ZXN0LGNhbGliLGNhbGliRm9yLGpubixubix0b1Jvdyxjc3ZSb3dzLFN0b3JlLGFuYWx5emUsaG9yc2VTY29yZSxub3JtYWxpemVUb3AzLHRvcDNGcm9tV2luLHN1cmZDb2RlLHBhcnNlRGF0ZX07Cn0pKCk7CgoKLyogPT09PT0g44Ki44OX44Oq5pys5L2TID09PT09ICovCmNvbnN0ICQ9aWQ9PmRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKY29uc3QgZXNjPXM9PlN0cmluZyhzPz8iIikucmVwbGFjZSgvWyY8PiInXS9nLG09Pih7IiYiOiImYW1wOyIsIjwiOiImbHQ7IiwiPiI6IiZndDsiLCciJzoiJnF1b3Q7IiwiJyI6IiYjMzk7In1bbV0pKTsKY29uc3Qgc2xlZXA9KG1zPTApPT5uZXcgUHJvbWlzZShyPT5zZXRUaW1lb3V0KHIsbXMpKTsKZnVuY3Rpb24gYnVzeShvbixtc2c9IuWHpueQhuS4reKApiIpeyQoImJ1c3kiKS5zdHlsZS5kaXNwbGF5PW9uPyJmbGV4Ijoibm9uZSI7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1tc2d9CmxldCBEQj1udWxsLFNUT1JFPW51bGwsU1RPUkVfS0VZPSIiLENVUj1udWxsLExBU1RSRVM9bnVsbDsKY29uc3QgVkVOVUU9eyIwMSI6IuacreW5jCIsIjAyIjoi5Ye96aSoIiwiMDMiOiLnpo/ls7YiLCIwNCI6IuaWsOa9nyIsIjA1Ijoi5p2x5LqsIiwiMDYiOiLkuK3lsbEiLCIwNyI6IuS4reS6rCIsIjA4Ijoi5Lqs6YO9IiwiMDkiOiLpmKrnpZ4iLCIxMCI6IuWwj+WAiSJ9OwoKLyogLS0tIEluZGV4ZWREQu+8iOOBk+OBruODhOODvOODq+WwgueUqO+8iSAtLS0gKi8KZnVuY3Rpb24gb3BlbkRCKCl7cmV0dXJuIG5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCByPWluZGV4ZWREQi5vcGVuKCJ1cHNldF90b29sX2RiIiwyKTsKIHIub251cGdyYWRlbmVlZGVkPWU9Pntjb25zdCBkPWUudGFyZ2V0LnJlc3VsdDtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJmaWxlcyIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoImZpbGVzIik7aWYoIWQub2JqZWN0U3RvcmVOYW1lcy5jb250YWlucygibWV0YSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoIm1ldGEiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJwYXkiKSlkLmNyZWF0ZU9iamVjdFN0b3JlKCJwYXkiKX07CiByLm9uc3VjY2Vzcz0oKT0+e0RCPXIucmVzdWx0O29rKCl9O3Iub25lcnJvcj0oKT0+bmcoci5lcnJvcik7ci5vbmJsb2NrZWQ9KCk9Pm5nKG5ldyBFcnJvcigi5LuW44Gu44K/44OW44Gn5L2/55So5Lit44Gn44GZIikpfSl9CmNvbnN0IGlkYkFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oImZpbGVzIikub2JqZWN0U3RvcmUoImZpbGVzIikuZ2V0QWxsKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpjb25zdCBpZGJQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJmaWxlcyIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoImZpbGVzIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJmaWxlcyIsayk7b2soKX07dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJDbGVhcj0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIiksc3Q9dC5vYmplY3RTdG9yZSgiZmlsZXMiKTtzdC5vcGVuQ3Vyc29yKCkub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtpZighU3RyaW5nKGMua2V5KS5zdGFydHNXaXRoKCJsaXZlOiIpKXttYXJrRGlydHkoImZpbGVzIixjLmtleSk7Yy5kZWxldGUoKX1jLmNvbnRpbnVlKCl9fTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwoKLyog5Y+W44KK6L6844G/5riI44G/44Gu5YWo6KGM77yI44OQ44OD44Kv44Ki44OD44OXQ1NW77yL5Y+W5b6X5riI44G/44Gu5oiQ57i+77yJ44KS6aCG44Gr5rih44GZICovCmFzeW5jIGZ1bmN0aW9uIGZvckVhY2hSb3coY2IpewogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspe2NvbnN0IGY9ZnNbaV07CiAgaWYoZi5saXZlKXtmb3IoY29uc3QgeCBvZiBmLnJvd3N8fFtdKWNiKGxpdmVSb3coeCkpfQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmLmNzdikpY2IoVUUudG9Sb3cobykpOwogIGlmKGklMz09PTIpYXdhaXQgc2xlZXAoMCl9Cn0KLyog44Os44O844K5SUTjgYvjgonplovlgqzloLTjg7tS55Wq5Y+377yIMTLmoYHjga5KUkHlvaLlvI/vvI/ml6Xku5gt6ZaL5YKs5aC0LVLlvaLlvI/jga7kuKHlr77lv5zvvIkgKi8KZnVuY3Rpb24gdmVudWVPZklkKGlkKXtyZXR1cm4gL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSg0LDYpOlN0cmluZyhpZCkuc3BsaXQoIi0iKVszXXx8IiJ9CmZ1bmN0aW9uIHJhY2VOb09mSWQoaWQpe3JldHVybiBOdW1iZXIoL15cZHsxMn0kLy50ZXN0KGlkKT9pZC5zbGljZSgxMCwxMik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzRdfHwwKX0KCi8qIC0tLSDlj5bjgorovrzjgb8gLS0tICovCmFzeW5jIGZ1bmN0aW9uIGltcG9ydEZpbGUoZmlsZSl7CiBidXN5KHRydWUsIuODleOCoeOCpOODq+OCkuiqreOBv+i+vOOBv+S4reKAplxu5aSn44GN44GE44OV44Kh44Kk44Or44Gv5pWw5Y2B56eS44GL44GL44KK44G+44GZ44CCIik7YXdhaXQgc2xlZXAoMzApOwogdHJ5ewogIGNvbnN0IHRleHQ9YXdhaXQgZmlsZS50ZXh0KCk7bGV0IGl0ZW1zOwogIGlmKC9cLmNzdiQvaS50ZXN0KGZpbGUubmFtZSkpe2l0ZW1zPVt7dHlwZToicmFjZS1yZXN1bHRzIix5ZWFyOjAscGxhY2U6ZmlsZS5uYW1lLGNzdjp0ZXh0fV19CiAgZWxzZXtjb25zdCBqPUpTT04ucGFyc2UodGV4dCk7aXRlbXM9QXJyYXkuaXNBcnJheShqKT9qOihqLmZpbGVzfHxbal0pfQogIGl0ZW1zPWl0ZW1zLmZpbHRlcih4PT54JiZ0eXBlb2YgeC5jc3Y9PT0ic3RyaW5nIik7CiAgaWYoIWl0ZW1zLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoImNzduOCkuWQq+OCgOODh+ODvOOCv+OBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OAguODkOODg+OCr+OCouODg+ODl0pTT07jgYvjgIFDU1bjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgIIiKTsKICBhd2FpdCBpZGJDbGVhcigpO2xldCBuPTA7CiAgZm9yKGxldCBpPTA7aTxpdGVtcy5sZW5ndGg7aSsrKXtjb25zdCBpdD1pdGVtc1tpXTthd2FpdCBpZGJQdXQoYCR7aXQueWVhcnx8MH06JHtpdC5wbGFjZX06JHtpfWAse3llYXI6aXQueWVhcixwbGFjZTppdC5wbGFjZSxwbGFjZU5hbWU6aXQucGxhY2VOYW1lLGNzdjppdC5jc3Z9KTsKICAgbis9TWF0aC5tYXgoMCxpdC5jc3Yuc3BsaXQoIlxuIikubGVuZ3RoLTEpOyQoImJ1c3lUZXh0IikudGV4dENvbnRlbnQ9YOS/neWtmOS4reKApiAke2krMX0vJHtpdGVtcy5sZW5ndGh9YDthd2FpdCBzbGVlcCgwKX0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0iZ29vZCI+5Y+W44KK6L6844G/5a6M5LqG77yaJHtpdGVtcy5sZW5ndGh944OV44Kh44Kk44Or77yP57SEJHtuLnRvTG9jYWxlU3RyaW5nKCl96KGMPC9zcGFuPmA7CiAgYmtTY2hlZHVsZSgpOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7lj5bjgorovrzjgb/jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQogZmluYWxseXtidXN5KGZhbHNlKX0KfQphc3luYyBmdW5jdGlvbiBzaG93U3RhdGUoKXsKIHRyeXtjb25zdCBmcz1hd2FpdCBpZGJBbGwoKSxwcz1hd2FpdCBwYXlBbGwoKTsKICBjb25zdCBiYXNlPWZzLmZpbHRlcihmPT4hZi5saXZlKSxsaXZlPWZzLmZpbHRlcihmPT5mLmxpdmUmJihmLnJvd3N8fFtdKS5sZW5ndGgpOwogIGlmKCFmcy5sZW5ndGgmJiFwcy5sZW5ndGgpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7jg4fjg7zjgr/mnKrlj5blvpfjgafjgZnjgILkuIrjga7jgIzpgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpfjgI3jgpLmirzjgZfjgabjgY/jgaDjgZXjgYTjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3QgbGQ9bGl2ZS5tYXAoZj0+Zi5kYXRlKS5zb3J0KCksblJhY2VzPWxpdmUucmVkdWNlKChzLGYpPT5zK25ldyBTZXQoZi5yb3dzLm1hcChyPT5yLnJhY2VJZCkpLnNpemUsMCk7CiAgbGV0IGg9IiI7CiAgaWYobGl2ZS5sZW5ndGgpaCs9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5blvpfmuIjjgb/jga7miJDnuL7vvJoke2xpdmUubGVuZ3RofeaXpe+8jyR7blJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yIJHtsZFswXX3jgJwke2xkW2xkLmxlbmd0aC0xXX3vvIk8L3NwYW4+YDsKICBpZihiYXNlLmxlbmd0aCl7Y29uc3QgeXM9Wy4uLm5ldyBTZXQoYmFzZS5tYXAoZj0+Zi55ZWFyKSldLnNvcnQoKTtoKz0oaD8iXG4iOiIiKStgPHNwYW4gY2xhc3M9Imdvb2QiPuODkOODg+OCr+OCouODg+ODl++8miR7YmFzZS5sZW5ndGh944OV44Kh44Kk44Or77yIJHt5c1swXXx8Ii0ifeOAnCR7eXNbeXMubGVuZ3RoLTFdfHwiLSJ95bm077yJPC9zcGFuPmB9CiAgY29uc3QgcHI9cHMucmVkdWNlKChzLHApPT5zKyhwLnJhY2VzfHxbXSkubGVuZ3RoLDApOwogIGgrPShoPyJcbiI6IiIpKyhwcy5sZW5ndGg/YDxzcGFuIGNsYXNzPSJnb29kIj7miZXmiLvvvJoke3BzLmxlbmd0aH3ml6XvvI8ke3ByLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K5PC9zcGFuPmA6JzxzcGFuIGNsYXNzPSJ3YXJuIj7miZXmiLvvvJrmnKrlj5blvpc8L3NwYW4+Jyk7CiAgJCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7norroqo3jgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2UpfTwvc3Bhbj5gfQp9Ci8qIFdvcmtlcuOBriAvcmVzdWx0cyDjga7ooYwg4oaSIOODhOODvOODq+WGhemDqOOBruihjCAqLwpmdW5jdGlvbiBsaXZlUm93KHgpe2NvbnN0IGY9cGFyc2VGbG9hdChTdHJpbmcoeC5maW5pc2g/PyIiKS5yZXBsYWNlKC9bXlxkLl0vZywiIikpOwogcmV0dXJue3JhY2VJZDpTdHJpbmcoeC5yYWNlSWR8fCIiKSxkYXRlOlVFLnBhcnNlRGF0ZSh4LmRhdGUpLG5hbWU6U3RyaW5nKHguaG9yc2V8fCIiKS50cmltKCksaG9yc2U6VUUubm4oeC5ob3JzZSksam9ja2V5OlVFLmpubih4LmpvY2tleSksCiAgZmluaXNoOk51bWJlci5pc0Zpbml0ZShmKSYmZj4wP2Y6bnVsbCxkaXN0Ok51bWJlcih4LmRpc3RhbmNlKXx8MCxzdXJmOlVFLnN1cmZDb2RlKHguc3VyZmFjZSksYWdlOk51bWJlcih4LmFnZSl8fG51bGwsbnVtOk51bWJlcih4Lm51bWJlcil8fG51bGwscG9wOk51bWJlcih4LnBvcCk+MD9OdW1iZXIoeC5wb3ApOm51bGwsb2RkczpudWxsLGpuYW1lOlN0cmluZyh4LmpvY2tleXx8IiIpLnRyaW0oKSwKICBsdmw6KHgudmVudWVDb2RlJiYhL14oMFsxLTldfDEwKSQvLnRlc3QoU3RyaW5nKHgudmVudWVDb2RlKSkpPy0xOihVRS5sZXZlbE9mTGFiZWwoeC5jbHMpfHxVRS5sZXZlbE9mUHJpemUoeC5wcml6ZSkpfX0KLyog5a++6LGh5pel44KI44KK5YmN44Gu5bGl5q2044Gg44GR44Gn44K544OI44Ki44KS5L2c44KLICovCmFzeW5jIGZ1bmN0aW9uIGJ1aWxkU3RvcmUodGFyZ2V0KXsKIGlmKFNUT1JFJiZTVE9SRV9LRVk9PT10YXJnZXQpcmV0dXJuIFNUT1JFOwogY29uc3QgZnM9YXdhaXQgaWRiQWxsKCk7aWYoIWZzLmxlbmd0aCl0aHJvdyBuZXcgRXJyb3IoIumBjuWOu+ODh+ODvOOCv+OBjOacqueZu+mMsuOBp+OBmeOAgiIpOwogY29uc3Qgc3Q9bmV3IFVFLlN0b3JlKCk7bGV0IHJvd3M9MCx1c2VkPTA7CiBmb3IobGV0IGk9MDtpPGZzLmxlbmd0aDtpKyspewogIGJ1c3kodHJ1ZSxg6YGO5Y6744OH44O844K/44KS6ZuG6KiI5Lit4oCmICR7aSsxfS8ke2ZzLmxlbmd0aH1cbu+8iCR7dGFyZ2V0feOCiOOCiuWJjeOBruOBv+S9v+eUqO+8iWApOwogIGlmKGZzW2ldLmxpdmUpe2Zvcihjb25zdCB4IG9mIGZzW2ldLnJvd3N8fFtdKXtjb25zdCByPWxpdmVSb3coeCk7cm93cysrO2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0fHwhci5ob3JzZSljb250aW51ZTtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGV9fQogIGVsc2UgZm9yKGNvbnN0IG8gb2YgVUUuY3N2Um93cyhmc1tpXS5jc3YpKXtjb25zdCByPVVFLnRvUm93KG8pO3Jvd3MrKztpZighci5kYXRlfHxyLmRhdGU+PXRhcmdldCljb250aW51ZTtzdC5hZGQocik7dXNlZCsrO2lmKHIuZGF0ZT4oc3QubGFzdERhdGV8fCIiKSlzdC5sYXN0RGF0ZT1yLmRhdGV9CiAgYXdhaXQgc2xlZXAoMCk7CiB9CiBidXN5KGZhbHNlKTtTVE9SRT1zdDtTVE9SRV9LRVk9dGFyZ2V0O1NUT1JFLmNvdW50PXVzZWQ7cmV0dXJuIHN0Owp9CgovKiAtLS0g44Os44O844K56YG45oqeIC0tLSAqLwpmdW5jdGlvbiBzaG93UGFuZShrKXtmb3IoY29uc3QgcCBvZlsiV29ya2VyIiwiTWFudWFsIiwiUGFzdCJdKSQoInBhbmUiK3ApLnN0eWxlLmRpc3BsYXk9cD09PWs/ImJsb2NrIjoibm9uZSJ9CiQoInRhYldvcmtlciIpLm9uY2xpY2s9KCk9PnNob3dQYW5lKCJXb3JrZXIiKTskKCJ0YWJNYW51YWwiKS5vbmNsaWNrPSgpPT5zaG93UGFuZSgiTWFudWFsIik7JCgidGFiUGFzdCIpLm9uY2xpY2s9KCk9PnNob3dQYW5lKCJQYXN0Iik7CmZ1bmN0aW9uIHNldFJhY2UocmFjZSxsYWJlbCl7aWYocmFjZS5rZXkmJiFyYWNlLm9kZHMwKXJhY2Uub2RkczA9b2Rkc0ZvcihyYWNlKTtDVVI9cmFjZTtMQVNUUkVTPW51bGw7JCgicmFjZWxhYmVsIikudGV4dENvbnRlbnQ9bGFiZWw7JCgicnVuIikuZGlzYWJsZWQ9ZmFsc2U7JCgib3V0IikudGV4dENvbnRlbnQ9IuOAjOino+aekOOBmeOCi+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgiJ9CgovKiBXb3JrZXIgKi8KbGV0IFdSQUNFUz1bXTsKbGV0IFdESUFHPVtdOwphc3luYyBmdW5jdGlvbiBmZXRjaENhcmRzKGJhc2UsZCx2ZW51ZUNvZGUpewogY29uc3QgcT12ZW51ZUNvZGU/YCZ2ZW51ZT0ke2VuY29kZVVSSUNvbXBvbmVudCh2ZW51ZUNvZGUpfWA6IiI7bGV0IGVycj0iIjsKIGZvcihsZXQgdD0wO3Q8Mzt0KyspewogIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0ke3F9YCk7CiAgIGlmKCFyLm9rKXtsZXQgbT0iIjt0cnl7bT0oYXdhaXQgci5qc29uKCkpLmVycm9yfHwiIn1jYXRjaHt9dGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9ICR7bX1gLnRyaW0oKSl9CiAgIGNvbnN0IHg9YXdhaXQgci5qc29uKCk7cmV0dXJue3JhY2VzOkFycmF5LmlzQXJyYXkoeCk/eDooeC5yYWNlc3x8W10pLHdhcm5pbmc6eC53YXJuaW5nfHwiIn19CiAgY2F0Y2goZSl7ZXJyPWUubWVzc2FnZTthd2FpdCBzbGVlcCgxMjAwKih0KzEpKX0KIH0KIHRocm93IG5ldyBFcnJvcihlcnJ8fCLlj5blvpfjgafjgY3jgb7jgZvjgpMiKTsKfQpmdW5jdGlvbiByZW5kZXJWZW51ZUJ1dHRvbnMoZCl7CiBjb25zdCBuYW1lcz1bLi4ubmV3IFNldChXUkFDRVMubWFwKHI9PnIudmVudWVOYW1lfHxyLnZlbnVlfHwiIikpXTsKIGxldCBoPW5hbWVzLm1hcCgodixpKT0+YDxidXR0b24gZGF0YS12PSIke2l9IiBjbGFzcz0ic3ViIj4ke2VzYyh2KX3vvIgke1dSQUNFUy5maWx0ZXIocj0+KHIudmVudWVOYW1lfHxyLnZlbnVlfHwiIik9PT12KS5sZW5ndGh9Uu+8iTwvYnV0dG9uPmApLmpvaW4oIiIpOwogaCs9V0RJQUcuZmlsdGVyKHg9PnguZXJyfHx4LmVtcHR5fHx4LnBhcnRpYWwpLm1hcCh4PT5gPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+JHtlc2MoeC5uYW1lKX3vvJoke3guZXJyPyLlj5blvpflpLHmlZfvvIgiK2VzYyh4LmVycikuc2xpY2UoMCw0MDApKyLvvIkiOngucGFydGlhbD9gJHt4LmNvdW50fVLjgZfjgYvlj5blvpfjgafjgY3jgabjgYTjgb7jgZvjgpPvvIjpgJrluLjjga8xMOOAnDEyUu+8iWA6YOWHuui1sOmmrOOCkuiqreOCgeOBquOBi+OBo+OBn+ODrOODvOOCuSAke3guZW1wdHl9Uu+8iOmZpOWklu+8iWB9IDxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1yZXRyeT0iJHtlc2MoeC5jb2RlfHwiIil9Ij7lho3lj5blvpc8L2J1dHRvbj48L2Rpdj5gKS5qb2luKCIiKTsKICQoIndsaXN0IikuaW5uZXJIVE1MPWg7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXZdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9Pmxpc3RWZW51ZShuYW1lc1tiLmRhdGFzZXQudl0sZCkpOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1yZXRyeV0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+bG9hZFZlbnVlKGQse3ZlbnVlQ29kZTpiLmRhdGFzZXQucmV0cnksdmVudWVOYW1lOiIifSx0cnVlKSk7Cn0KYXN5bmMgZnVuY3Rpb24gbG9hZFZlbnVlKGQsdixyZXJlbmRlcil7CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKTsKIGNvbnN0IHByZXY9V0RJQUcuZmluZCh4PT5TdHJpbmcoeC5jb2RlKT09PVN0cmluZyh2LnZlbnVlQ29kZSkpOwogV1JBQ0VTPVdSQUNFUy5maWx0ZXIocj0+U3RyaW5nKHIudmVudWVDb2RlKSE9PVN0cmluZyh2LnZlbnVlQ29kZSkpOwogV0RJQUc9V0RJQUcuZmlsdGVyKHg9PlN0cmluZyh4LmNvZGUpIT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBjb25zdCBuYW1lPXYudmVudWVOYW1lfHwocHJldiYmcHJldi5uYW1lKXx8di52ZW51ZUNvZGU7CiB0cnl7Y29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCx2LnZlbnVlQ29kZSk7CiAgY29uc3Qgb2s9cmFjZXMuZmlsdGVyKGE9PihhLmhvcnNlc3x8YS5ydW5uZXJzfHxbXSkubGVuZ3RoKSxlbXB0eT1yYWNlcy5sZW5ndGgtb2subGVuZ3RoOwogIFdSQUNFUy5wdXNoKC4uLm9rKTsKICBjb25zdCBlcnJzPXJhY2VzLmZpbHRlcihhPT5hLmVycm9yKS5tYXAoYT0+YS5lcnJvcik7CiAgV0RJQUcucHVzaCh7Y29kZTp2LnZlbnVlQ29kZSxuYW1lLGNvdW50Om9rLmxlbmd0aCxlbXB0eSxwYXJ0aWFsOm9rLmxlbmd0aD4wJiZvay5sZW5ndGg8MTAsZXJyOiFyYWNlcy5sZW5ndGg/IuODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCkyI6KCFvay5sZW5ndGgmJmVycnMubGVuZ3RoP2VycnNbMF06IiIpfSk7CiB9Y2F0Y2goZSl7V0RJQUcucHVzaCh7Y29kZTp2LnZlbnVlQ29kZSxuYW1lLGNvdW50OjAsZW1wdHk6MCxlcnI6ZS5tZXNzYWdlfSl9CiBpZihyZXJlbmRlcil7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X77yIJHtXRElBRy5tYXAoeD0+YCR7eC5uYW1lfSR7eC5jb3VudH1SYCkuam9pbigi77yPIil977yJYDskKCJ3YWxsIikuZGlzYWJsZWQ9IVdSQUNFUy5sZW5ndGg7JCgib2Rkc0dldCIpLmRpc2FibGVkPSFXUkFDRVMubGVuZ3RoO3JlbmRlclZlbnVlQnV0dG9ucyhkKX0KfQokKCJ3Z2V0Iikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoIndkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuIGFsZXJ0KCLml6Xku5jjgpLpgbjmip7jgZfjgabjgY/jgaDjgZXjgYTjgIIiKTsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogJCgid3N0YXR1cyIpLnRleHRDb250ZW50PSLplovlgqzloLTjgpLnorroqo3kuK3igKYiOyQoIndsaXN0IikuaW5uZXJIVE1MPSIiOyQoImFsbG91dCIpLmlubmVySFRNTD0iIjtXUkFDRVM9W107V0RJQUc9W107V0RBVEU9ZDskKCJ3YWxsIikuZGlzYWJsZWQ9dHJ1ZTskKCJvZGRzR2V0IikuZGlzYWJsZWQ9dHJ1ZTtPRERTPXt9OwogbGV0IHZlbnVlcz1udWxsOwogbGV0IGxpc3REaWFnPSIiLGF2YWlsRGF0ZXM9W107QVZBSUw9W107CiB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaChgJHtiYXNlfS9yYWNlLWNhcmRzP2RhdGU9JHtlbmNvZGVVUklDb21wb25lbnQoZCl9Jmxpc3Q9MWApO2lmKHIub2spe2NvbnN0IHg9YXdhaXQgci5qc29uKCk7dmVudWVzPXgudmVudWVzfHxbXTthdmFpbERhdGVzPXguYXZhaWxhYmxlRGF0ZXN8fFtdO0FWQUlMPWF2YWlsRGF0ZXM7aWYoIXZlbnVlcy5sZW5ndGgpbGlzdERpYWc9SlNPTi5zdHJpbmdpZnkoeC5kaWFnbm9zdGljc3x8W10pLnNsaWNlKDAsNTAwKX19Y2F0Y2goZSl7fQogdHJ5ewogIGlmKHZlbnVlcyYmIXZlbnVlcy5sZW5ndGgmJmF2YWlsRGF0ZXMubGVuZ3RoJiYhYXZhaWxEYXRlcy5pbmNsdWRlcyhkKSl7CiAgICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjga9KUkHjga7plovlgqzml6Xjgafjga/jgYLjgorjgb7jgZvjgpPjgIJcbuWFrOmWi+S4reOBrumWi+WCrOaXpe+8miR7YXZhaWxEYXRlcy5qb2luKCLjgIEiKX1gOwogICAkKCJ3bGlzdCIpLmlubmVySFRNTD1hdmFpbERhdGVzLm1hcCh4PT5gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWQ9IiR7eH0iPiR7eH08L2J1dHRvbj5gKS5qb2luKCIiKTsKICAgJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1kXSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57JCgid2RhdGUiKS52YWx1ZT1iLmRhdGFzZXQuZDskKCJ3Z2V0IikuY2xpY2soKX0pOwogICByZXR1cm47CiAgfQogIGlmKHZlbnVlcyYmdmVudWVzLmxlbmd0aCl7CiAgIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7JCgid3N0YXR1cyIpLnRleHRDb250ZW50PWDlj5blvpfkuK3igKYgJHt2LnZlbnVlTmFtZX3vvIgke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X5riI44G/77yJYDthd2FpdCBsb2FkVmVudWUoZCx2LGZhbHNlKX0KICB9ZWxzZXsKICAgLy8g5penV29ya2Vy562J44Gn6ZaL5YKs5aC05LiA6Kan44GM5L2/44GI44Gq44GE5aC05ZCI77yaMeaXpeWIhuOCkuS4gOaLrOWPluW+lwogICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuS4gOaLrOWPluW+l+S4reKApiI7CiAgIGNvbnN0IHtyYWNlc309YXdhaXQgZmV0Y2hDYXJkcyhiYXNlLGQsIiIpOwogICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpO1dSQUNFUz1vazsKICAgaWYocmFjZXMubGVuZ3RoPm9rLmxlbmd0aClXRElBRy5wdXNoKHtjb2RlOiIiLG5hbWU6IuS4gOmDqCIsY291bnQ6b2subGVuZ3RoLGVtcHR5OnJhY2VzLmxlbmd0aC1vay5sZW5ndGgsZXJyOiIifSk7CiAgfQogIGlmKCFXUkFDRVMubGVuZ3RoKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuWHuui1sOmmrOOBpOOBjeOBruODrOODvOOCueOBjOimi+OBpOOBi+OCiuOBvuOBm+OCk+OBp+OBl+OBn+OAglxuIitXRElBRy5tYXAoeD0+YCR7eC5uYW1lfe+8miR7eC5lcnJ8fCLlh7rotbDppqzjgarjgZcifWApLmpvaW4oIlxuIikrKGxpc3REaWFnPyJcbuiouuaWre+8miIrbGlzdERpYWc6IiIpO3JlbmRlclZlbnVlQnV0dG9ucyhkKTtyZXR1cm59CiAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6XYCsoV0RJQUcubGVuZ3RoP2DvvIgke1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV9JHt4LmNvdW50fVJgKS5qb2luKCLvvI8iKX3vvIlgOiIiKTsKICAkKCJ3YWxsIikuZGlzYWJsZWQ9ZmFsc2U7JCgib2Rkc0dldCIpLmRpc2FibGVkPWZhbHNlO3JlbmRlclZlbnVlQnV0dG9ucyhkKTsKIH1jYXRjaChlKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuWPluW+l+OCqOODqeODvO+8miIrZS5tZXNzYWdlKyJcbu+8iFdvcmtlcuOBjOacquWFrOmWi++8j0NPUlPvvI/ml6Xku5jjgavplovlgqzjgarjgZfjgIHjga7lj6/og73mgKfvvIkifQp9OwpmdW5jdGlvbiBsaXN0VmVudWUodixkKXsKIGNvbnN0IHJzPVdSQUNFUy5maWx0ZXIocj0+KHIudmVudWVOYW1lfHxyLnZlbnVlfHwiIik9PT12KS5zb3J0KChhLGIpPT4oYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiAkKCJ3bGlzdCIpLmlubmVySFRNTD1ycy5tYXAoKHIsayk9PmA8YnV0dG9uIGRhdGEtaz0iJHtrfSI+JHtyLnJhY2VOdW1iZXJ8fGsrMX1SICR7ZXNjKHIucmFjZU5hbWV8fCIiKX08L2J1dHRvbj5gKS5qb2luKCIiKTsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9Pntjb25zdCByPXJzW2IuZGF0YXNldC5rXTsKICBjb25zdCBocz0oci5ob3JzZXN8fHIucnVubmVycyk7CiAgY29uc3QgcmFjZT1ta1JhY2UocixkKTsKICBzZXRSYWNlKHJhY2UsYCR7ZH0gJHt2fSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2V8fCI/In0ke3IuZGlzdGFuY2V8fCI/In1t44O7JHtocy5sZW5ndGh96aCt77yJYCk7CiB9KTsKfQoKZnVuY3Rpb24gbWtSYWNlKHIsZCl7CiBjb25zdCBocz0oci5ob3JzZXN8fHIucnVubmVycyk7CiByZXR1cm57ZGF0ZTpkLGtleTpgJHtTdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKHIucmFjZU51bWJlcil8fDB9YCxzdXJmOlVFLnN1cmZDb2RlKHIuc3VyZmFjZSksZGlzdDpOdW1iZXIoci5kaXN0YW5jZSl8fDAsbHZsOlVFLmxldmVsT2ZMYWJlbChyLmNsYXNzTmFtZSl8fFVFLmxldmVsT2ZMYWJlbChyLnJhY2VOYW1lKSwKICBydW5uZXJzOmhzLm1hcCgoaCxpKT0+e2NvbnN0IG5hbWU9aC5ob3JzZU5hbWV8fGguaG9yc2V8fGgubmFtZXx8IiI7cmV0dXJue25hbWUsaG9yc2U6VUUubm4obmFtZSksam9ja2V5OlVFLmpubihoLmpvY2tleXx8IiIpLGpuYW1lOlN0cmluZyhoLmpvY2tleXx8IiIpLnRyaW0oKSxhZ2U6aC5hZ2V8fG51bGwsbnVtOmguaG9yc2VOdW1iZXJ8fGgubnVtYmVyfHxpKzF9fSkuc29ydCgoeCx5KT0+KHgubnVtfHwwKS0oeS5udW18fDApKX07Cn0KbGV0IFdEQVRFPSIiLEFWQUlMPVtdOwovKiDlhajjg6zjg7zjgrnkuIDmi6zvvJrlkITjg6zjg7zjgrnjga7nqbTppqzlgJnoo5zvvIjkuIrkvY0y6aCt77yJ44KS5LiA6Kan44Gr44GZ44KLICovCmFzeW5jIGZ1bmN0aW9uIHJ1bkFsbChib3hJZD0iYWxsb3V0Iil7CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm47CiBjb25zdCBib3g9JChib3hJZCk7CiBjb25zdCBkPVdEQVRFO2xldCB0ZXh0PWAke2R9IOeptOmmrOWlvei1sO+8iOS4iuS9jeWAmeijnO+8iVxuYDsKIHRyeXsKICBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKGQpOwogIGNvbnN0IHJzPVsuLi5XUkFDRVNdLnNvcnQoKGEsYik9PlN0cmluZyhhLnZlbnVlTmFtZXx8YS52ZW51ZXx8IiIpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVOYW1lfHxiLnZlbnVlfHwiIiksImphIil8fChhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICBjb25zdCBnYXA9c3RvcmUubGFzdERhdGU/TWF0aC5yb3VuZCgobmV3IERhdGUoZCktbmV3IERhdGUoc3RvcmUubGFzdERhdGUpKS84NjRlNSk6bnVsbDsKICBsZXQgaD0oZm9jdXNPbigpP2A8ZGl2IGNsYXNzPSJzbWFsbCI+4peO55qE5Lit546H6YeN6KaW77ya5a6f57i+M+i1sOS7peS4iuODu+ODqeODs+OCr1MvQSR7T2JqZWN0LmtleXMoT0REUykubGVuZ3RoPyLjg7vljZjli50zMOWAjeacqua6gCI6IiJ944Gu56m06aas44Gg44GR44KS6KGo56S644CC6YGO5Y6744Gu55qE5Lit546H44Gv57SEJHtNYXRoLnJvdW5kKFVFLkZPQ1VTW09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aD8ib2RkcyI6InByb3h5Il0uaGl0KjEwMDApLzEwfSXvvIjlvpPmnaXjga4x5L2N5YCZ6KOc44Gv57SEJHtNYXRoLnJvdW5kKFVFLkZPQ1VTW09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aD8ib2RkcyI6InByb3h5Il0uYmFzZUhpdCoxMDAwKS8xMH0l77yJ44CCPC9kaXY+YDoiIikrYDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4Pjgrrlj43mmKDvvJoke09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aH3jg6zjg7zjgrnliIbvvIjmnKrlj5blvpfjga7jg6zjg7zjgrnjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIk8L2Rpdj48ZGl2IGNsYXNzPSJzbWFsbCI+5a2m57+S44OH44O844K/5pyA57WC5pel77yaJHtlc2Moc3RvcmUubGFzdERhdGV8fCLkuI3mmI4iKX3vvI/nqbTjgr7jg7zjg7Pjga/jg4Tjg7zjg6vmjqjlrprjga7kurrmsJfvvIjpqI7miYvmiJDnuL7ovrzjgb/vvInjgafliKTlrprjgILlrp/pmpvjga7kurrmsJfjgajjga/nlbDjgarjgorjgb7jgZk8L2Rpdj5gLHRIPTAsdE49MCxqSD0wLGpNaXNzPVtdOwogIGlmKGdhcCE9bnVsbCYmZ2FwPjE0KWgrPWA8ZGl2IGNsYXNzPSJ3YXJuIj7imqAg5pyA5paw44Gu5oiQ57i+44GMJHtnYXB95pel5YiG5YWl44Gj44Gm44GE44G+44Gb44KT44CC55u06L+R44Gu5aW96LWw44O75Yeh6LWw44GM5Y+N5pig44GV44KM44Gq44GE54K544Gr5rOo5oSP44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+YDsKICBoKz0iPGJyPiI7CiAgcnMuZm9yRWFjaCgocixrKT0+ewogICBjb25zdCByYWNlPW1rUmFjZShyLGQpLG49cmFjZS5ydW5uZXJzLmxlbmd0aCx2PXIudmVudWVOYW1lfHxyLnZlbnVlfHwiIjsKICAgY29uc3QgbGFiZWw9YCR7dn0ke3IucmFjZU51bWJlcnx8aysxfVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZXx8Ij8ifSR7ci5kaXN0YW5jZXx8Ij8ifW3jg7ske2596aCt77yJYDsKICAgdGV4dCs9YFxu4pagJHtsYWJlbH1cbmA7CiAgIGxldCBib2R5PSIiOwogICBpZihuPDYpYm9keT0nPHNwYW4gY2xhc3M9InNtYWxsIj426aCt5pyq5rqA44Gu44Gf44KB5a++6LGh5aSWPC9zcGFuPic7CiAgIGVsc2V7CiAgICBjb25zdCBvZD1vZGRzRm9yKHJhY2UpLHJlcz1VRS5hbmFseXplKHJhY2Usc3RvcmUsb2QpLGM9KGZvY3VzT24oKT9VRS5waWNrRm9jdXMocmVzLDIpOlVFLnBpY2socmVzLDIpKTt7Y29uc3QgbT1tYXRjaEluZm8ocmVzKTt0SCs9bS5oO3ROKz1tLm47akgrPW0uajtqTWlzcy5wdXNoKC4uLm0ubWlzcyl9CiAgICBib2R5PWMubWFwKHg9Pntjb25zdCB0Zz14LnRhZ3Muc2xpY2UoMCwyKS5tYXAodD0+dC50KS5qb2luKCLvvI8iKTsKICAgICB0ZXh0Kz1gICAke3gubm9955WqICR7eC5uYW1lfSAke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfSAkeyh4LnBjKjEwMCkudG9GaXhlZCgxKX0lICR7dGd9XG5gOwogICAgIHRleHQrPWAgICAgJHtyZWNMaW5lKHgpfe+8jyR7eC5qbmFtZXx8IumojuaJi+S4jeaYjiJ9XG5gOwogICAgIHJldHVybiBgPGRpdj48Yj4ke2VzYyh4Lm5vKX3nlaogJHtlc2MoeC5uYW1lKX08L2I+IDxzcGFuIGNsYXNzPSJydCByJHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX0iPiR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9PC9zcGFuPiA8c3BhbiBjbGFzcz0ic21hbGwiPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSXvvIjnqbTjgr7jg7zjg7PlubPlnYfjga4keyh4LnBjL0FWR1t4Lm1vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKS50b0ZpeGVkKDEpfeWAjeODu+S/oemgvOW6piR7ZXNjKHguY29uZil977yJPC9zcGFuPjxicj48c3BhbiBjbGFzcz0ic21hbGwiPiR7ZXNjKHJlY0xpbmUoeCkpfe+8jyR7ZXNjKHguam5hbWV8fCLpqI7miYvkuI3mmI4iKX08L3NwYW4+PGJyPmAreC50YWdzLnNsaWNlKDAsMykubWFwKHQ9PmA8c3BhbiBjbGFzcz0iY2hpcCAke3QuY30iPiR7ZXNjKHQudCl9PC9zcGFuPmApLmpvaW4oIiIpK2A8L2Rpdj5gfSkuam9pbigiIil8fCc8c3BhbiBjbGFzcz0ic21hbGwiPuWun+e4vuOBruOBguOCi+mmrO+8iDPotbDku6XkuIrvvInjga7lgJnoo5zjgarjgZfvvJ3lr77osaHlpJY8L3NwYW4+JzsKICAgfQogICBoKz1gPGRpdiBjbGFzcz0iY2FuZCI+PGI+JHtlc2MobGFiZWwpfTwvYj48YnI+JHtib2R5fTxicj48YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtaz0iJHtrfSI+6Kmz57Sw44O744Kq44OD44K65YWl5YqbPC9idXR0b24+PC9kaXY+YDsKICB9KTsKICBoPWgucmVwbGFjZSgnPGJyPicsYDxkaXYgY2xhc3M9InNtYWxsIj7lsaXmrbTjga7nhaflkIjvvJrppqwgJHt0SH0vJHt0Tn3poK3vvIjpgY7ljrvjgasy6LWw5Lul5LiK77yJ77yP6aiO5omLICR7akh9LyR7dE596aCtPC9kaXY+YCsoak1pc3MubGVuZ3RoJiZqSDx0TiouNj9gPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOmojuaJi+OCkumBjuWOu+ODh+ODvOOCv+OBqOeFp+WQiOOBp+OBjeOBpuOBhOOBquOBhOS+i++8miR7ZXNjKFsuLi5uZXcgU2V0KGpNaXNzKV0uc2xpY2UoMCw2KS5qb2luKCLjgIEiKSl9PC9kaXY+YDoiIikrKHROJiZ0SDx0TiouNT8nPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOeFp+WQiOOBp+OBjeOBn+mmrOOBjOWNiuWIhuacqua6gOOBp+OBmeOAguiLpemnkuaIpuOBjOS4reW/g+OBruaXpeOBr+ato+W4uOOBp+OBmeOBjOOAgeOBneOBhuOBp+OBquOBkeOCjOOBsOmmrOWQjeihqOiomOOBruS4jeS4gOiHtOOBruWPr+iDveaAp+OBjOOBguOCiuOBvuOBmeOAgjwvZGl2Pic6JycpKyc8YnI+Jyk7CiAgaCs9JzxidXR0b24gY2xhc3M9ImNvcHlBbGwiPuS4gOimp+OCkuODhuOCreOCueODiOOBp+OCs+ODlOODvDwvYnV0dG9uPic7CiAgYm94LmlubmVySFRNTD1oOwogIGJveC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b25bZGF0YS1rXSIpLmZvckVhY2goYnQ9PmJ0Lm9uY2xpY2s9KCk9Pntjb25zdCByPXJzW2J0LmRhdGFzZXQua107c2V0UmFjZShta1JhY2UocixkKSxgJHtkfSAke3IudmVudWVOYW1lfHxyLnZlbnVlfHwiIn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIifWApOyQoInJ1biIpLnNjcm9sbEludG9WaWV3KHtiZWhhdmlvcjoic21vb3RoIn0pO3J1bihudWxsKX0pOwogIGNvbnN0IGNiPWJveC5xdWVyeVNlbGVjdG9yKCIuY29weUFsbCIpO2NiLm9uY2xpY2s9YXN5bmMoKT0+e3RyeXthd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KTtjYi50ZXh0Q29udGVudD0i44Kz44OU44O844GX44G+44GX44GfIn1jYXRjaChlKXthbGVydCgi44Kz44OU44O844Gn44GN44G+44Gb44KT44Gn44GX44GfIil9fTsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTtib3guaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5LiA5ous6Kej5p6Q44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfQokKCJ3YWxsIikub25jbGljaz0oKT0+cnVuQWxsKCJhbGxvdXQiKTsKLyog5omL5YWl5YqbICovCiQoIm1kYXRlIikudmFsdWU9bmV3IERhdGUoRGF0ZS5ub3coKSs4NjQwMDAwMCozKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwokKCJ3ZGF0ZSIpLnZhbHVlPSQoIm1kYXRlIikudmFsdWU7JCgicGRhdGUiKS52YWx1ZT0iMjAyNi0wNi0yMSI7CiQoIm1nbyIpLm9uY2xpY2s9KCk9PnsKIGNvbnN0IGxpbmVzPSQoIm10ZXh0IikudmFsdWUuc3BsaXQoL1xyP1xuLykubWFwKHM9PnMudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikscnM9W10sb2Rkcz1bXTsKIGZvcihjb25zdCBsIG9mIGxpbmVzKXtjb25zdCBtPWwubWF0Y2goL14oXGR7MSwyfSlbXHMs44CAXSsoXFMrPykoPzpbXHMs44CAXSsoW1xkLl0rKSk/JC8pO2lmKG0pe3JzLnB1c2goe25hbWU6bVsyXSxob3JzZTpVRS5ubihtWzJdKSxqb2NrZXk6IiIsYWdlOm51bGwsbnVtOittWzFdfSk7b2Rkcy5wdXNoKG1bM10/K21bM106MCl9fQogaWYocnMubGVuZ3RoPDIpcmV0dXJuIGFsZXJ0KCLjgIzppqznlaog6aas5ZCN44CN44Gu5b2i5byP44GnMumgreS7peS4iuWFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgcmFjZT17ZGF0ZTokKCJtZGF0ZSIpLnZhbHVlLHN1cmY6KyQoIm1zdXJmIikudmFsdWUsZGlzdDorJCgibWRpc3QiKS52YWx1ZXx8MCxydW5uZXJzOnJzLG9kZHMwOm9kZHMuZXZlcnkobz0+bz4xKT9vZGRzOm51bGx9Owogc2V0UmFjZShyYWNlLGAke3JhY2UuZGF0ZX0g5omL5YWl5Yqb77yIJHtyYWNlLnN1cmY9PT0xPyLoip0iOiLjg4Djg7zjg4gifSR7cmFjZS5kaXN0fW3jg7ske3JzLmxlbmd0aH3poK3vvIlgKTsKfTsKLyog6YGO5Y6744Os44O844K5ICovCmxldCBQUkFDRVM9W107CiQoInBnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgicGRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLmpJzntKLkuK3igKYiOyQoInBsaXN0IikuaW5uZXJIVE1MPSIiOwogdHJ5ewogIGNvbnN0IG1hcD1uZXcgTWFwKCk7CiAgYXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoci5kYXRlIT09ZHx8IXIucmFjZUlkKXJldHVybjtpZighbWFwLmhhcyhyLnJhY2VJZCkpbWFwLnNldChyLnJhY2VJZCxbXSk7bWFwLmdldChyLnJhY2VJZCkucHVzaChyKX0pOwogIFBSQUNFUz1bLi4ubWFwLmVudHJpZXMoKV0uZmlsdGVyKChbLHZdKT0+di5sZW5ndGg+PTYpLnNvcnQoKGEsYik9PnZlbnVlT2ZJZChhWzBdKS5sb2NhbGVDb21wYXJlKHZlbnVlT2ZJZChiWzBdKSl8fHJhY2VOb09mSWQoYVswXSktcmFjZU5vT2ZJZChiWzBdKSk7CiAgaWYoIVBSQUNFUy5sZW5ndGgpeyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i44Gd44Gu5pel44Gu44Os44O844K544Gv5L+d5a2Y44OH44O844K/44Gr44GC44KK44G+44Gb44KT44CCIjtyZXR1cm59CiAgJCgicHN0YXR1cyIpLnRleHRDb250ZW50PWAke1BSQUNFUy5sZW5ndGh944Os44O844K5YDsKICBjb25zdCBsYWI9aWQ9PmAke1ZFTlVFW3ZlbnVlT2ZJZChpZCldfHx2ZW51ZU9mSWQoaWQpfSR7cmFjZU5vT2ZJZChpZCl9UmA7CiAgJCgicGxpc3QiKS5pbm5lckhUTUw9UFJBQ0VTLm1hcCgoW2lkLHZdLGspPT5gPGJ1dHRvbiBkYXRhLWs9IiR7a30iPiR7bGFiKGlkKX3vvIgke3ZbMF0uc3VyZj09PTE/IuiKnSI6IuODgCJ9JHt2WzBdLmRpc3R9beODuyR7di5sZW5ndGh96aCt77yJPC9idXR0b24+YCkuam9pbigiIik7CiAgJCgicGxpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+e2NvbnN0IFtpZCx2XT1QUkFDRVNbYi5kYXRhc2V0LmtdOwogICBjb25zdCBycz12LmZpbHRlcihyPT5yLmhvcnNlKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpLm1hcChyPT4oe25hbWU6ci5uYW1lfHxyLmhvcnNlLGhvcnNlOnIuaG9yc2Usam9ja2V5OnIuam9ja2V5LGpuYW1lOnIuam5hbWV8fCIiLGFnZTpyLmFnZSxudW06ci5udW0sYWN0OnIuZmluaXNoLHBvcDpyLnBvcCxvZGRzQTpyLm9kZHN9KSk7CiAgIGNvbnN0IHJhY2U9e2RhdGU6ZCxzdXJmOnZbMF0uc3VyZixkaXN0OnZbMF0uZGlzdCxsdmw6dlswXS5sdmx8fDAscnVubmVyczpycyxwYXN0OnRydWV9OwogICBzZXRSYWNlKHJhY2UsYCR7ZH0gJHtsYWIoaWQpfe+8iOmBjuWOu+ODrOODvOOCueODuyR7cnMubGVuZ3Rofemgre+8iWApO30pOwogfWNhdGNoKGUpeyQoInBzdGF0dXMiKS50ZXh0Q29udGVudD0i44Ko44Op44O877yaIitlLm1lc3NhZ2V9Cn07CgovKiAtLS0g6Kej5p6Q44O76KGo56S6IC0tLSAqLwovKiDjg6njg7Pjgq/jga/oo5zmraPlvozjga7lpb3otbDnjofjgafliKTlrprvvIjjg6Ljg7zjg4njgZTjgajjgavnqbTjgr7jg7zjg7Pjga7lubPlnYfjgYzpgZXjgYbvvJrjgqrjg4PjgrrlhaXlipvmmYLjga/ntIQ5JeOAgeOCquODg+OCuuOBquOBl+OBr+e0hDEzJe+8iSAqLwpjb25zdCBBVkc9e29kZHM6LjA5MSxwcm94eTouMTE1fTsgICAvLyDnqbTjgr7jg7zjg7Pjga7lrp/muKzlubPlnYfvvIgyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT77yJCmNvbnN0IGZvY3VzT249KCk9Pntjb25zdCBlPSQoImZvY3VzT24iKTtyZXR1cm4gIWV8fGUuY2hlY2tlZH07CmNvbnN0IHJhdGluZz0ocCxtb2RlLG4pPT57Y29uc3Qgcj1wLyhBVkdbbW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pO2xldCBrPXI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIjtpZihuPDImJihrPT09IlMifHxrPT09IkEiKSlrPSJCIjtyZXR1cm4ga307ICAvLyDlsaXmrbTjgYwx6LWw5Lul5LiL44GvQuOBvuOBpwovKiDlgJnoo5zjgZTjgajjga7jgIzmoLnmi6DjgI3ooajnpLrvvJrlpb3otbDnjofjgajjgZ3jga7ppqzjga7lrp/nuL7jgYzpo5/jgYTpgZXjgaPjgabopovjgYjjgarjgYTjgojjgYbjgIHlrp/nuL7jg7vln7rmupbjg7vpqI7miYvjgpLkuKbjgbnjgosgKi8KZnVuY3Rpb24gcmVjTGluZSh4KXsKIGNvbnN0IHA9W107CiBwLnB1c2goeC5jYXJlZXImJnguY2FyZWVyLm4/YOmAmueulyR7eC5jYXJlZXIubn3otbAgM+edgOWGhSR7eC5jYXJlZXIudDN95Zue77yIJHtNYXRoLnJvdW5kKHguY2FyZWVyLnQzL3guY2FyZWVyLm4qMTAwKX0l77yJYDoi6YCa566X77ya5bGl5q2044Gq44GXIik7CiBpZih4LnJlY2VudCYmeC5yZWNlbnQubGVuZ3RoKXAucHVzaChg55u06L+RICR7eC5yZWNlbnQuc2xpY2UoLTUpLmpvaW4oIi0iKX3nnYBgKTsKIHJldHVybiBwLmpvaW4oIu+8jyIpOwp9CmZ1bmN0aW9uIGJhc2VMaW5lKHgpe3JldHVybiBg56m044K+44O844Oz44Gu5bmz5Z2HICR7YXZnTm90ZSh4Lm1vZGUpfSDihpIg44GT44Gu6aas44GvJHsoeC5wYy9BVkdbeC5tb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSkudG9GaXhlZCgxKX3lgI3vvIhT4omnMi4y5YCN77yPQeKJpzEuN+WAje+8j0LiiacxLjPlgI3vvIlgfQpmdW5jdGlvbiBqb2NrZXlMaW5lKHgpewogaWYoIXguam5hbWUpcmV0dXJuICLpqI7miYvvvJroqq3jgb/lj5bjgozjgabjgYTjgb7jgZvjgpMiOwogcmV0dXJuIHguanN0YXQmJnguanN0YXQubj49NT9g6aiO5omL77yaJHt4LmpuYW1lfe+8iOmBjuWOuyR7eC5qc3RhdC5ufemojuS5lyAz552A5YaFJHtNYXRoLnJvdW5kKHguanN0YXQucmF0ZSoxMDApfSXvvIlgOmDpqI7miYvvvJoke3guam5hbWV977yI6YGO5Y6744OH44O844K/44Gr6Kmy5b2T44Gq44GX44CB44G+44Gf44Gv6aiO5LmX44GM5bCR44Gq44GE77yJYDsKfQpjb25zdCBhdmdOb3RlPW1vZGU9Pm1vZGU9PT0ib2RkcyI/Iue0hDklIjoi57SEMTIlIjsKLyog5bGl5q2044Gu54Wn5ZCI54q25rOB77yI6aas5ZCN44O76aiO5omL5ZCN44GM6YGO5Y6744OH44O844K/44Go5LiA6Ie044GX44Gf44GL77yJICovCmNvbnN0IG1hdGNoSW5mbz1yZXM9Pntjb25zdCBuPXJlcy5sZW5ndGgsaD1yZXMuZmlsdGVyKHg9Pngubj49MikubGVuZ3RoLGo9cmVzLmZpbHRlcih4PT54LmpuPj01KS5sZW5ndGg7cmV0dXJue24saCxqLG1pc3M6cmVzLmZpbHRlcih4PT54LmpuPDUmJnguam5hbWUpLm1hcCh4PT54LmpuYW1lKX19Owphc3luYyBmdW5jdGlvbiBydW4ob2Rkc0luKXsKIGlmKCFDVVIpcmV0dXJuOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoQ1VSLmRhdGUpOwogIGxldCBvZGRzPW9kZHNJbnx8bnVsbDsKICBpZighb2RkcyYmQ1VSLm9kZHMwKW9kZHM9Q1VSLm9kZHMwOwogIGlmKCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5vZGRzQT4xKSlvZGRzPUNVUi5ydW5uZXJzLm1hcChyPT5yLm9kZHNBKTsKICBjb25zdCBwb3BBcnI9KCFvZGRzJiZDVVIucGFzdCYmQ1VSLnJ1bm5lcnMuZXZlcnkocj0+ci5wb3A+MCkpP0NVUi5ydW5uZXJzLm1hcChyPT5yLnBvcCk6bnVsbDsKICBjb25zdCByZXM9VUUuYW5hbHl6ZShDVVIsc3RvcmUsb2RkcyxudWxsLHBvcEFycik7CiAgTEFTVFJFUz17cmVzLG9kZHMsY291bnQ6c3RvcmUuY291bnR9O3JlbmRlcigpOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoIm91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuino+aekOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn0KZnVuY3Rpb24gcmVuZGVyKCl7CiBjb25zdHtyZXMsb2Rkcyxjb3VudH09TEFTVFJFUyxOPXJlcy5sZW5ndGgsY3V0PXJlc1swXS5jdXQscGFzdD0hIUNVUi5wYXN0OwogaWYoTjw2KXskKCJvdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj426aCt5pyq5rqA44Gu44Gf44KB56m06aas5Yik5a6a44Gu5a++6LGh5aSW44Gn44GZ44CCPC9zcGFuPic7cmV0dXJufQogY29uc3QgdXNlZD0hIXJlc1swXS5ta3QsY2FuZHM9VUUucGljayhyZXMsNSk7Y29uc3QgZnNldD1uZXcgU2V0KFVFLnBpY2tGb2N1cyhyZXMsOTkpLm1hcCh4PT54LmkpKTsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lq65rCX6aCG77yaJHt1c2VkPyLlhaXlipvjgqrjg4PjgroiOiLjg4Tjg7zjg6vmjqjlrprvvIjpqI7miYvmiJDnuL7ovrzjgb/jg7vlrp/pmpvjga7kurrmsJfjgajjga/nlbDjgarjgorjgb7jgZnvvIkife+8j+eptOOCvuODvOODs++8miR7Y3V0feeVquebruS7pemZje+8iOWFqCR7Tn3poK3vvInvvI/lrabnv5IgJHtjb3VudC50b0xvY2FsZVN0cmluZygpfeihjDwvZGl2PmA7CiB7Y29uc3QgbT1tYXRjaEluZm8ocmVzKTtoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWxpeattOOBrueFp+WQiO+8mummrCAke20uaH0vJHttLm596aCt77yIMui1sOS7peS4iu+8ie+8j+mojuaJiyAke20uan0vJHttLm596aCtPC9kaXY+YCsobS5taXNzLmxlbmd0aD9gPGRpdiBjbGFzcz0ic21hbGwiPumojuaJi+OBruacqueFp+WQiO+8miR7ZXNjKG0ubWlzcy5zbGljZSgwLDYpLmpvaW4oIuOAgSIpKX0ke20ubWlzcy5sZW5ndGg+Nj8iIOKApiI6IiJ9PC9kaXY+YDoiIik7aWYobS5oPG0ubiouNSloKz1gPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOmBjuWOu+i1sOOCkueFp+WQiOOBp+OBjeOBn+mmrOOBjOWwkeOBquOBhOOBn+OCgeOAgeS6iOaDs+OBruS/oemgvOW6puOBr+S9juOCgeOBp+OBme+8iOaWsOmmrOaIpuODu+iLpemnkuaIpuOAgeOBvuOBn+OBr+mmrOWQjeihqOiomOOBrumBleOBhO+8ieOAgjwvZGl2PmB9CiBoKz0iPGJyPiI7CiBpZighY2FuZHMubGVuZ3RoKWgrPSc8c3BhbiBjbGFzcz0id2FybiI+56m044K+44O844Oz44Gr44CB5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBruWAmeijnOOBjOOBhOOBvuOBm+OCk++8iOaWsOmmrOaIpuODu+iLpemnkuaIpuOBquOBqe+8ieOAguOBk+OBruODrOODvOOCueOBr+WvvuixoeWkluOBp+OBmeOAgjwvc3Bhbj4nOwogY2FuZHMuZm9yRWFjaCgoeCxrKT0+ewogIGNvbnN0IGNoaXBzPXgudGFncy5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIik7CiAgY29uc3Qgcj1DVVIucnVubmVyc1t4LmldOwogIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2srMX0uICR7ZXNjKHgubm8pfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4ke2ZzZXQuaGFzKHguaSk/JyA8c3BhbiBjbGFzcz0iY2hpcCBiIj7il47nmoTkuK3njofph43oppY8L3NwYW4+JzonJ30gPHNwYW4gY2xhc3M9InJ0IHIke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfSI+JHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX08L3NwYW4+YDsKICBpZihwYXN0KWgrPWAgPHNwYW4gY2xhc3M9InNtYWxsIj7ihpIg57WQ5p6cICR7ci5hY3Q/PyItIn3nnYDvvIgke3IucG9wPz8iLSJ95Lq65rCX77yJJHtyLmFjdDw9Mz8iIOKchSI6IiJ9PC9zcGFuPmA7CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjocgPGI+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JTwvYj7vvIjnqbTjgr7jg7zjg7PlubPlnYcgJHthdmdOb3RlKHgubW9kZSl977yJ77yP5L+h6aC85bqmICR7ZXNjKHguY29uZil9PGJyPiR7ZXNjKHJlY0xpbmUoeCkpfTxicj4ke2VzYyhiYXNlTGluZSh4KSl9PGJyPiR7ZXNjKGpvY2tleUxpbmUoeCkpfWA7CiAgaWYoeC5ta3QhPW51bGwpaCs9YDxicj7luILloLTjga7mg7Plrpoz552A5YaFICR7KHgubWt0KjEwMCkudG9GaXhlZCgxKX0lIOKGkiDluILloLTjgajjga7lt64gJHt4LnZhbHVlPj0zPyIz5YCN5Lul5LiKIjp4LnZhbHVlLnRvRml4ZWQoMikrIuWAjSJ977yI5Y+C6ICD77ya5qSc6Ki844Gn44Gv5b2T44Gf44KK44Gr57WQ44Gz5LuY44GN44G+44Gb44KT44Gn44GX44Gf77yJYDsKICBoKz1gPC9kaXY+PGRpdj4ke2NoaXBzfHwnPHNwYW4gY2xhc3M9InNtYWxsIj7nm67nq4vjgaTmoLnmi6DjgarjgZc8L3NwYW4+J308L2Rpdj48L2Rpdj5gOwogfSk7CiBoKz1gPGJyPjxiPuWFqOmgreS4gOimpzwvYj4ke3Bhc3Q/Iu+8iOWun+mam+OBrue1kOaenOOBpOOBje+8iSI6Iu+8iOWNmOWLneOCquODg+OCuuOCkuWFpeOCjOOCi+OBqOWmmeWRs+OCkuioiOeul++8iSJ9PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrOeVqjwvdGg+PHRoPummrOWQjTwvdGg+PHRoPumojuaJizwvdGg+PHRoPuWlvei1sOeOhzwvdGg+PHRoPumghuS9jTwvdGg+PHRoPuOCquODg+OCujwvdGg+JHtwYXN0PyI8dGg+57WQ5p6cPC90aD4iOiIifTwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIHJlcyl7Y29uc3Qgcj1DVVIucnVubmVyc1t4LmldOwogIGgrPWA8dHIke3guaG9sZT8nIHN0eWxlPSJiYWNrZ3JvdW5kOiNmZmI4MDAyMiInOicnfT48dGQ+JHtlc2MoeC5ubyl9PC90ZD48dGQ+JHtlc2MoeC5uYW1lKX08L3RkPjx0ZD4ke2VzYyh4LmpuYW1lfHwiPyIpfTwvdGQ+PHRkPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD4ke3gucmFua308L3RkPjx0ZD48aW5wdXQgY2xhc3M9Im9kZHMiIGRhdGEtaT0iJHt4Lml9IiB0eXBlPSJudW1iZXIiIHN0ZXA9IjAuMSIgbWluPSIxLjEiIGlucHV0bW9kZT0iZGVjaW1hbCIgdmFsdWU9IiR7b2Rkcz9vZGRzW3guaV06IiJ9IiBzdHlsZT0id2lkdGg6NjJweDtwYWRkaW5nOjRweCI+PC90ZD4ke3Bhc3Q/YDx0ZD4ke3IuYWN0Pz8iLSJ9552APC90ZD5gOiIifTwvdHI+YH0KIGgrPWA8L3Rib2R5PjwvdGFibGU+PGJ1dHRvbiBpZD0icmVjYWxjIj7jgqrjg4PjgrrjgpLlj43mmKDjgZfjgablho3oqIjnrpc8L2J1dHRvbj48YnV0dG9uIGlkPSJjbGVhcm9kZHMiIGNsYXNzPSJzdWIiPuOCquODg+OCuuOCkuOCr+ODquOCojwvYnV0dG9uPmA7CiAkKCJvdXQiKS5pbm5lckhUTUw9aDsKICQoInJlY2FsYyIpLm9uY2xpY2s9KCk9Pntjb25zdCB2PVsuLi5kb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjb3V0IGlucHV0Lm9kZHMiKV0ubWFwKGU9PnBhcnNlRmxvYXQoZS52YWx1ZSkpO3J1bih2LmV2ZXJ5KG89Pm8+MSk/djpudWxsKX07CiAkKCJjbGVhcm9kZHMiKS5vbmNsaWNrPSgpPT57Q1VSLm9kZHMwPW51bGw7Q1VSLnBhc3Q9Q1VSLnBhc3Q7TEFTVFJFUz1udWxsO3J1bihudWxsKX07Cn0KJCgicnVuIikub25jbGljaz0oKT0+cnVuKG51bGwpOwokKCJmaWxlIikub25jaGFuZ2U9ZT0+e2NvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoZilpbXBvcnRGaWxlKGYpLnRoZW4oKCk9PntlLnRhcmdldC52YWx1ZT0iIn0pfTsKCi8qIC0tLSDmiZXmiLvjg7vmnIjjga7lj5blvpfnirbms4HvvIhJbmRleGVkRELvvIkgLS0tICovCmNvbnN0IHBheUFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oInBheSIpLm9iamVjdFN0b3JlKCJwYXkiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IHBheVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oInBheSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoInBheSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgicGF5IixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IG1ldGFHZXQ9az0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oIm1ldGEiKS5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHQpO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgbWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJtZXRhIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCx3YWl0c0FyZyl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdhaXRzQXJnfHx3aW5kb3cuX19XQUlUU3x8WzQwMDAsMTIwMDAsMzAwMDAsNjAwMDBdOwogZm9yKGxldCB0PTA7dDw9d2FpdHMubGVuZ3RoO3QrKyl7CiAgdHJ5ewogICBjb25zdCByPWF3YWl0IGZldGNoKHVybCk7Y29uc3QgdHh0PWF3YWl0IHIudGV4dCgpO2xldCB4PXt9O3RyeXt4PUpTT04ucGFyc2UodHh0KX1jYXRjaChlKXt9CiAgIGlmKCFyLm9rfHx4Lm9rPT09ZmFsc2Upe2NvbnN0IGU9bmV3IEVycm9yKHguZXJyb3J8fGBIVFRQICR7ci5zdGF0dXN9YCsodHh0JiYheC5lcnJvcj9g77yIJHt0eHQucmVwbGFjZSgvXHMrL2csIiAiKS5zbGljZSgwLDUwKX3vvIlgOiIiKSk7ZS5zdGF0dXM9ci5zdGF0dXM7dGhyb3cgZX0KICAgcmV0dXJuIHg7CiAgfWNhdGNoKGUpewogICBlcnI9ZS5tZXNzYWdlO2NvbnN0IHJldHJ5PSFlLnN0YXR1c3x8ZS5zdGF0dXM+PTUwMHx8ZS5zdGF0dXM9PT00Mjk7CiAgIGlmKCFyZXRyeXx8dD09PXdhaXRzLmxlbmd0aClicmVhazsKICAgaWYoU1lOQ0lORykkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YOa3t+mbkeOBruOBn+OCgSR7TWF0aC5yb3VuZCh3YWl0c1t0XS8xMDAwKX3np5LlvoXjgaPjgablho3oqabooYzjgZfjgb7jgZnigKbvvIgke2Vycn3vvIlgOwogICBhd2FpdCBzbGVlcCh3YWl0c1t0XSk7CiAgfQogfQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QgTU9ERUxfVFJBSU5fRU5EPSIyMDI2LTA2LTIyIjsgICAvLyDnj77lnKjjga7jg6Ljg4fjg6vjga/jgIHjgZPjga7ml6XjgojjgorliY3jga7miJDnuL7jgaflrabnv5IKY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgovKiAtLS0g4pGgIOODh+ODvOOCv+WPluW+l++8mumBjuWOu+aIkOe4vu+8iOS6uuawl+OBpOOBje+8ie+8i+aJleaIu+OCkuOAgemWi+WCrOaXpeOBlOOBqOOBq+WPluW+l+OBl+OBpuS/neWtmCAtLS0gKi8KY29uc3QgU1lOQ19CQVRDSD00LFNZTkNfUEFSQUxMRUw9MjsKbGV0IFNTVE9QPWZhbHNlLEJBQ0tVUF9EQVRFUz1udWxsOwokKCJzeW5jU3RvcCIpLm9uY2xpY2s9KCk9PntTU1RPUD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZX07CiQoInNlbmQiKS52YWx1ZT1qc3RZZXN0ZXJkYXkoKTsKYXN5bmMgZnVuY3Rpb24gYmFja3VwRGF0ZXMoKXsKIGlmKEJBQ0tVUF9EQVRFUylyZXR1cm4gQkFDS1VQX0RBVEVTOwogY29uc3Qgcz1uZXcgU2V0KCksZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IoY29uc3QgZiBvZiBmcyl7aWYoZi5saXZlKWNvbnRpbnVlO2Zvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCBkPVVFLnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKTtpZihkKXMuYWRkKGQpfWF3YWl0IHNsZWVwKDApfQogcmV0dXJuIEJBQ0tVUF9EQVRFUz1zOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoRGF5KGJhc2UsZCl7CiBjb25zdCBkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXk/ZGF0ZT0ke2R9YCk7CiBjb25zdCByYWNlcz1kYXkucmFjZXN8fFtdO2lmKCFyYWNlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKz1TWU5DX0JBVENIKWNodW5rcy5wdXNoKHJhY2VzLnNsaWNlKGksaStTWU5DX0JBVENIKS5tYXAoeD0+eC5jbmFtZSkpOwogY29uc3Qgcm93cz1bXSxwYXlvdXRzPVtdO2xldCBpZHg9MCxmYWlsZWROPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGlkeDxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWlkeCsrOwogIGNvbnN0IHJlcz1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLXJlc3VsdHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gKTsKICByb3dzLnB1c2goLi4uKHJlcy5yb3dzfHxbXSkpO3BheW91dHMucHVzaCguLi4ocmVzLnBheW91dHN8fFtdKSk7ZmFpbGVkTis9KHJlcy5mYWlsZWR8fFtdKS5sZW5ndGh9fTsKIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oe2xlbmd0aDpNYXRoLm1pbihTWU5DX1BBUkFMTEVMLGNodW5rcy5sZW5ndGgpfSx3b3JrZXIpKTsKIGNvbnN0IGdvdD1uZXcgU2V0KHJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZTsKIGZhaWxlZE49TWF0aC5tYXgoZmFpbGVkTixyYWNlcy5sZW5ndGgtZ290KTsKIHJldHVybntyb3dzLHBheW91dHMsZmFpbGVkTixyYWNlczpyYWNlcy5sZW5ndGh9Owp9CiQoInN5bmNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBhPSQoInNzdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCk7bGV0IGI9JCgic2VuZCIpLnZhbHVlfHx5ZDtpZihiPnlkKWI9eWQ7CiBpZihhPmIpeyQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5aeL5pel44GM57WC5LqG5pel44KI44KK5b6M44Gn44GZ44CCIjtyZXR1cm59CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgic3luY0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLHNraXBwZWQ6MCxmYWlsOltdLHQwOkRhdGUubm93KCl9O2xldCBjb25zZWM9MDsKIHRyeXsKICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IuS/neWtmOa4iOOBv+ODh+ODvOOCv+OCkueiuuiqjeS4reKApiI7CiAgY29uc3QgZmlsZXM9YXdhaXQgaWRiQWxsKCksaGF2ZUxpdmU9bmV3IFNldChmaWxlcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5tYXAoZj0+Zi5kYXRlKSk7CiAgY29uc3QgaGF2ZVBheT1uZXcgU2V0KChhd2FpdCBwYXlBbGwoKSkuZmlsdGVyKHA9PiFwLmZhaWxlZCkubWFwKHA9PnAuZGF0ZSkpOwogIGNvbnN0IGJrPWF3YWl0IGJhY2t1cERhdGVzKCk7CiAgY29uc3QgbW9udGhzPW1vbnRoc0JldHdlZW4oYSxiKSxjdXJNb250aD15ZC5zbGljZSgwLDcpOwogIGZvcihsZXQgbWk9MDttaTxtb250aHMubGVuZ3RoO21pKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBtb250aD1tb250aHNbbWldOwogICBpZihtb250aDxjdXJNb250aCYmYXdhaXQgbWV0YUdldCgibW9udGg6Iittb250aCkpe2NvbnRpbnVlfQogICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7bW9udGh977yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJ6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIOWPluW+l+a4iOOBvyR7c3QuZGF5c33ml6VgOwogICBsZXQgZGF5czt0cnl7ZGF5cz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXlzP21vbnRoPSR7bW9udGh9YCkpLmRheXN8fFtdO2NvbnNlYz0wfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHttb250aH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgIGRheXM9ZGF5cy5maWx0ZXIoZD0+ZD49YSYmZDw9Yik7bGV0IG1vbnRoT2s9dHJ1ZTsKICAgZm9yKGNvbnN0IGQgb2YgZGF5cyl7CiAgICBpZihTU1RPUCl7bW9udGhPaz1mYWxzZTticmVha30KICAgIGNvbnN0IG5lZWRSb3dzPSFoYXZlTGl2ZS5oYXMoZCkmJiFiay5oYXMoZCksbmVlZFBheT0haGF2ZVBheS5oYXMoZCk7CiAgICBpZighbmVlZFJvd3MmJiFuZWVkUGF5KXtzdC5za2lwcGVkKys7Y29udGludWV9CiAgICBjb25zdCBlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjgpLlj5blvpfkuK3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvIlcbuWPluW+lyR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYDsKICAgIHRyeXsKICAgICBjb25zdCByPWF3YWl0IGZldGNoRGF5KGJhc2UsZCk7CiAgICAgaWYoci5mYWlsZWROKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICAgaWYobmVlZFJvd3Mpe2F3YWl0IGlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pO2hhdmVMaXZlLmFkZChkKX0KICAgICBhd2FpdCBwYXlQdXQoZCx7ZGF0ZTpkLHJhY2VzOnIucGF5b3V0cyxmYWlsZWQ6MH0pO2hhdmVQYXkuYWRkKGQpOwogICAgIHN0LmRheXMrKztzdC5yYWNlcys9ci5yYWNlcztjb25zZWM9MDsKICAgIH1jYXRjaChlKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgICBhd2FpdCBzbGVlcCg0MDApOwogICB9CiAgIGlmKG1vbnRoT2smJm1vbnRoPGN1ck1vbnRoKWF3YWl0IG1ldGFQdXQoIm1vbnRoOiIrbW9udGgsdHJ1ZSk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgic3luY0dvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogICQoInN5bmNTdGF0dXMiKS5pbm5lckhUTUw9YCR7c3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf77yIQ2xvdWRmbGFyZeWBtOOBrua3t+mbkeODu+WItumZkOOBruWPr+iDveaAp++8ieOAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjoiIn0ke1NTVE9QJiYhc3Quc3RvcHBlZD8i5YGc5q2i44GX44G+44GX44Gf44CCIjooc3Quc3RvcHBlZD8iIjoi5a6M5LqG44CCIil95LuK5Zue44Gu5Y+W5b6X77yaJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iWArKHN0LmZhaWwubGVuZ3RoP2BcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ9XG7vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHlpLHmlZfjgZfjgZ/ml6XjgaDjgZHjgoTjgornm7TjgZfjgb7jgZnvvIk8L3NwYW4+YDoiIik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfQp9OwoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTsKICBidXN5KHRydWUsIuOCquODg+OCuuacquWFpeWKm+OBruWgtOWQiOOCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXRQPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkQscHJveHk6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgre+8iOWfuua6lu+8iSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu477yIMC45MuS7peS4iuODu+OCquODg+OCuuaZgu+8iSIsZm9jdXM6IuKXjueahOS4reeOh+mHjeimluOBrjHkvY0ifTsKICBjb25zdCBwY3Q9eD0+KHgqMTAwKS50b0ZpeGVkKDApKyIlIixjPXg9PngmJnguYmV0cz9gJHtwY3QoeC5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh4LnNlKjE5NikudG9GaXhlZCgwKX08L3NwYW4+YDoiLSI7CiAgY29uc3QgdGJsPShvLHRpdGxlKT0+ewogICBsZXQgdD1gPGI+JHt0aXRsZX08L2I+PGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke28ucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L2Rpdj48dGFibGU+PHRoZWFkPjx0cj48dGg+6LK344GE5pa5PC90aD48dGg+PC90aD48dGg+6LO85YWl5pWwPC90aD48dGg+55qE5Lit546HPC90aD48dGg+5Zue5Y+O546HKDk1JeW5hSk8L3RoPjx0aD7liY3ljYo8L3RoPjx0aD7lvozljYo8L3RoPjx0aD7lrabnv5Llvow8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKICAgZm9yKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMoTCkpe2NvbnN0IHY9by5zdGF0c1trXTtpZighdi5hbGwuYmV0cyljb250aW51ZTsKICAgIHQrPWA8dHI+PHRkPiR7TFtrXX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjx0ZD4ke3YuQy5iZXRzP2Ake3BjdCh2LkMucm9pKX08c3BhbiBjbGFzcz0ic21hbGwiPsKxJHsodi5DLnNlKjE5NikudG9GaXhlZCgwKX3vvIgke3YuQy5iZXRzLnRvTG9jYWxlU3RyaW5nKCl977yJPC9zcGFuPmA6Ii0ifTwvdGQ+PC90cj5gfQogICByZXR1cm4gdCsiPC90Ym9keT48L3RhYmxlPiJ9OwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+JHtzdGFydH3jgJzvvI/liY3ljYrvvJ0ke3NwbGl0feOCiOOCiuWJjeOAgeW+jOWNiu+8neS7pemZje+8j+WQhDEwMOWGhjwvZGl2Pjxicj5gK3RibChvdXQsIuKRoCDjgqrjg4PjgrrlhaXlipvmmYLvvIjlrp/pmpvjga7kurrmsJfjgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvIkiKSsiPGJyPiIrdGJsKG91dFAsIuKRoSDjgqrjg4PjgrrmnKrlhaXlipvmmYLvvIjjg4Tjg7zjg6vmjqjlrprjga7kurrmsJfjgafliKTlrprvvIkiKTsKICAvLyDmnaHku7bliKXvvIjjg4Tjg7zjg6sx5L2N44Gu5Zue5Y+O546H77yJCiAgY29uc3Qgc2VnUm93cz1PYmplY3QuZW50cmllcyhvdXQuc2VncykuZmlsdGVyKChbLHZdKT0+di5hbGwuYmV0cz49MzAwKS5zb3J0KChhLGIpPT5hWzBdPGJbMF0/LTE6MSk7CiAgaWYoc2VnUm93cy5sZW5ndGgpe2grPWA8YnI+PGI+4pGiIOODhOODvOODqzHkvY3jga7mnaHku7bliKXvvIjikaDjga7loLTlkIjvvIk8L2I+PGRpdiBjbGFzcz0ic21hbGwiPuizvOWFpTMwMOWbnuS7peS4iuOBruadoeS7tuOBruOBv+OAguWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBi+OCkuimi+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7mnaHku7Y8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgW2ssdl0gb2Ygc2VnUm93cyloKz1gPHRyPjx0ZD4ke2VzYyhrKX08L3RkPjx0ZD48L3RkPjx0ZD4ke3YuYWxsLmJldHMudG9Mb2NhbGVTdHJpbmcoKX08L3RkPjx0ZD4keyh2LmFsbC5oaXRSYXRlKjEwMCkudG9GaXhlZCgxKX0lPC90ZD48dGQ+PGI+JHtjKHYuYWxsKX08L2I+PC90ZD48dGQ+JHt2LkEuYmV0cz9wY3Qodi5BLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5CLmJldHM/cGN0KHYuQi5yb2kpOiItIn08L3RkPjwvdHI+YDsKICAgaCs9IjwvdGJvZHk+PC90YWJsZT4ifQogIGgrPWA8ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuimi+aWue+8muOAjOWtpue/kuW+jOOAjeOBr+OAgeODouODh+ODq+OBruWtpue/kuOBq+S9v+OBo+OBpuOBhOOBquOBhOacn+mWk++8iCR7TU9ERUxfVFJBSU5fRU5EfeS7pemZje+8ieOBp+OAgeacgOOCguS/oemgvOOBp+OBjeOCi+WIl+OBp+OBmeOAguOBneOCjOS7peWJjeOBruacn+mWk+OBr+OAgeODouODh+ODq+OBjOetlOOBiOOCkuimi+OBpuOBhOOCi+OBn+OCgeOAgeOChOOChOiJr+OBj+WHuuOBvuOBmeOAguWbnuWPjueOh+OBruOAjMKx44CN44GvOTUl44Gu6Kqk5beu44Gu5bmF44Gn44CBMTAwJeOCkuS4i+WbnuOCi+S4i+mZkOOBquOCieWIqeebiuOBqOOBr+iogOOBiOOBvuOBm+OCk+OAguadoeS7tuWIpeOBr+OAgeaOouOBmeOBu+OBqeWBtueEtuOBrumrmOOBhOadoeS7tuOCkuaLvuOBhOOChOOBmeOBhOOBruOBp+OAgeWJjeWNiuODu+W+jOWNiuOBruS4oeaWueOBp+WQjOOBmOWQkeOBjeOBruOCguOBruOBoOOBkeOCkuWPguiAg+OBq+OBl+OBpuOBj+OBoOOBleOBhOOAguWmmeWRs++8iOW4guWgtOOBqOOBruW3ru+8ieOBr+OAgeaknOiovOOBp+Wfuua6luOCiOOCiuaCquOBi+OBo+OBn+OBn+OCgeOAgeWIpOaWreOBq+OBr+S9v+OCj+OBquOBhOOBp+OBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgJCgiYnRPdXQiKS5pbm5lckhUTUw9aDsKIH1jYXRjaChlKXtidXN5KGZhbHNlKTskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuaknOiovOOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9Cn07CgovKiAtLS0g44Kq44OD44K65Y+W5b6X77yIL2pyYS1vZGRz77ya5b2T5pel44O75YmN5pel5aOy44KK44Gu5Y2Y5Yud44Kq44OD44K677yJIC0tLSAqLwpsZXQgT0REUz17fTsKZnVuY3Rpb24gb2Rkc0ZvcihyYWNlKXsKIGNvbnN0IG09cmFjZSYmcmFjZS5rZXk/T0REU1tyYWNlLmtleV06bnVsbDtpZighbSlyZXR1cm4gbnVsbDsKIGNvbnN0IGFycj1yYWNlLnJ1bm5lcnMubWFwKHI9Pm1bci5udW1dKTtyZXR1cm4gYXJyLmV2ZXJ5KG89Pm8+MSk/YXJyOm51bGw7Cn0KLyog44Kq44OD44K65Y+W5b6X77ya4pGg5Ye66aas6KGo44GL44KJ5ou+44Gj44Gf44Kq44OD44K655S76Z2i44KS55u05o6l6Kqt44KAIOKGkiDikaHlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjgaDjgZHjgIHjg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYbjgIIKICAg5pu05paw44Gu44Go44GN44CB5Y+W5b6X44Gr5aSx5pWX44GX44Gf44Os44O844K544Gu5YmN5Zue44Gu44Kq44OD44K644Gv5raI44GV44Gq44GE44CCICovCmxldCBPRERTX0RJQUc9IiI7CmFzeW5jIGZ1bmN0aW9uIGZldGNoT2RkcygpewogaWYoIVdSQUNFUy5sZW5ndGgpcmV0dXJue2dvdDowLHRvdGFsOjB9OwogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIiksZD1XREFURSxrZXlPZj1yPT5gJHtTdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIil9LSR7TnVtYmVyKHIucmFjZU51bWJlcil8fDB9YDsKIGxldCBkaWFnPVtdLGVycj0iIjsKIC8vIOKRoCDnm7TmjqXvvIjlh7rppqzooajjgavjg6rjg7Pjgq/jgYzjgYLjgovjg6zjg7zjgrnvvIkKIGNvbnN0IHdpdGhMaW5rPVdSQUNFUy5maWx0ZXIocj0+ci5vZGRzQ25hbWUpLGJ5Q25hbWU9bmV3IE1hcCh3aXRoTGluay5tYXAocj0+W3Iub2Rkc0NuYW1lLHJdKSk7CiBjb25zdCBjaHVua3M9W107Zm9yKGxldCBpPTA7aTx3aXRoTGluay5sZW5ndGg7aSs9NiljaHVua3MucHVzaCh3aXRoTGluay5zbGljZShpLGkrNikubWFwKHI9PnIub2Rkc0NuYW1lKSk7CiBsZXQgY2k9MDsKIGNvbnN0IHdvcmtlcj1hc3luYygpPT57d2hpbGUoY2k8Y2h1bmtzLmxlbmd0aCl7Y29uc3Qgaz1jaSsrOwogIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9jbmFtZXM9JHtjaHVua3Nba10ubWFwKGVuY29kZVVSSUNvbXBvbmVudCkuam9pbigiLCIpfWAsWzE1MDBdKTsKICAgZm9yKGNvbnN0IGl0IG9mICh4Lml0ZW1zfHxbXSkpe2NvbnN0IHI9YnlDbmFtZS5nZXQoaXQuY25hbWUpO2lmKHIpT0REU1trZXlPZihyKV09aXQub2Rkc30KICAgaWYoKHguZmFpbGVkfHxbXSkubGVuZ3RoKWRpYWcucHVzaCguLi54LmZhaWxlZC5zbGljZSgwLDIpLm1hcChmPT5mLnJlYXNvbikpOwogICBpZih4LnNhbXBsZSYmIU9ERFNfRElBRylPRERTX0RJQUc9IueUu+mdouOBruS4gOmDqO+8miIrU3RyaW5nKHguc2FtcGxlKS5zbGljZSgwLDI2MCk7CiAgfWNhdGNoKGUpe2Vycj1lLm1lc3NhZ2V9fX07CiBhd2FpdCBQcm9taXNlLmFsbChbd29ya2VyKCksd29ya2VyKCldKTsKIC8vIOKRoSDlj5bjgozjgarjgYvjgaPjgZ/jg6zjg7zjgrnjgpLjgIHml6Xku5jjg7vplovlgqzloLTjga7jg6Hjg4vjg6Xjg7zntYznlLHjgafoo5zjgYYKIGNvbnN0IG1pc3Npbmc9V1JBQ0VTLmZpbHRlcihyPT4hT0REU1trZXlPZihyKV0pOwogaWYobWlzc2luZy5sZW5ndGgpewogIGNvbnN0IHZlbnVlcz1bLi4ubmV3IFNldChtaXNzaW5nLm1hcChyPT5TdHJpbmcoci52ZW51ZUNvZGV8fCIiKS5wYWRTdGFydCgyLCIwIikpKV0uZmlsdGVyKEJvb2xlYW4pOwogIGZvcihjb25zdCB2IG9mIHZlbnVlcyl7CiAgIHRyeXtjb25zdCB4PWF3YWl0IGZldGNoSlNPTihgJHtiYXNlfS9qcmEtb2Rkcz9kYXRlPSR7ZH0mdmVudWU9JHt2fWAsWzE1MDBdKTsKICAgIGZvcihjb25zdCByIG9mICh4LnJhY2VzfHxbXSkpT0REU1tgJHtTdHJpbmcoci52ZW51ZUNvZGUpLnBhZFN0YXJ0KDIsIjAiKX0tJHtyLnJhY2VOb31gXT1yLm9kZHM7CiAgICBpZighKHgucmFjZXN8fFtdKS5sZW5ndGgpZGlhZy5wdXNoKC4uLih4LmRpYWdub3N0aWNzfHxbXSkuc2xpY2UoMCw0KS5tYXAoej0+dHlwZW9mIHo9PT0ic3RyaW5nIj96OkpTT04uc3RyaW5naWZ5KHopKSk7CiAgIH1jYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2RpYWcucHVzaChlLm1lc3NhZ2UpfX0KIH0KIGNvbnN0IGdvdD1XUkFDRVMuZmlsdGVyKHI9Pk9ERFNba2V5T2YocildKS5sZW5ndGg7CiBPRERTX0RJQUc9Z290PyIiOihPRERTX0RJQUcrKGVycj8i77yP55CG55Sx77yaIitlcnI6IiIpKyhkaWFnLmxlbmd0aD8i77yP6Ki65pat77yaIitbLi4ubmV3IFNldChkaWFnKV0uam9pbigiIHwgIikuc2xpY2UoMCw1MDApOiIiKSk7CiByZXR1cm57Z290LHRvdGFsOldSQUNFUy5sZW5ndGh9Owp9CiQoIm9kZHNHZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKICQoIm9kZHNHZXQiKS5kaXNhYmxlZD10cnVlO09ERFNfRElBRz0iIjskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IuOCquODg+OCuuWPluW+l+S4reKApiI7CiB0cnl7Y29uc3Qgcj1hd2FpdCBmZXRjaE9kZHMoKTsKICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvI/jgqrjg4PjgrogJHtyLmdvdH3jg6zjg7zjgrnliIZgKyhyLmdvdD8iIjoiXG7jgqrjg4PjgrrjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/vvIjnmbrlo7LliY3jgIHjgb7jgZ/jga/nlLvpnaLmp4vpgKDjga7pgZXjgYTvvInjgIIiKyhPRERTX0RJQUc/IlxuIitPRERTX0RJQUc6IiIpKTsKIH1maW5hbGx5eyQoIm9kZHNHZXQiKS5kaXNhYmxlZD1mYWxzZX0KIHJlbmRlclZlbnVlQnV0dG9ucyhXREFURSk7Cn07CgovKiAtLS0g4piFIOacrOaXpeOBruWlvei1sOeptOmmrO+8iOODr+ODs+OCv+ODg+ODl++8iSAtLS0gKi8KY29uc3QganN0VG9kYXk9KCk9Pm5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CiQoInRkYXRlIikudmFsdWU9anN0VG9kYXkoKTsKJCgidG9kYXlHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJ0ZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybjsKICQoInRvZGF5R28iKS5kaXNhYmxlZD10cnVlOyQoInRvZGF5T3V0IikuaW5uZXJIVE1MPSIiOyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9IuWHuummrOihqOOCkuWPluW+l+S4reKApiI7CiB0cnl7CiAgJCgid2RhdGUiKS52YWx1ZT1kO2F3YWl0ICQoIndnZXQiKS5vbmNsaWNrKCk7CiAgaWYoIVdSQUNFUy5sZW5ndGgpewogICAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSQoIndzdGF0dXMiKS50ZXh0Q29udGVudDsKICAgaWYoQVZBSUwubGVuZ3RoKXskKCJ0b2RheU91dCIpLmlubmVySFRNTD1BVkFJTC5tYXAoeD0+YDxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1kPSIke3h9Ij4ke3h9PC9idXR0b24+YCkuam9pbigiIik7CiAgICAkKCJ0b2RheU91dCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLWRdIikuZm9yRWFjaChidD0+YnQub25jbGljaz0oKT0+eyQoInRkYXRlIikudmFsdWU9YnQuZGF0YXNldC5kOyQoInRvZGF5R28iKS5jbGljaygpfSl9CiAgIHJldHVybn0KICAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K55Y+W5b6X44CC44Kq44OD44K644KS56K66KqN5Lit4oCmYDsKICBhd2FpdCAkKCJvZGRzR2V0Iikub25jbGljaygpOwogIGNvbnN0IG49T2JqZWN0LmtleXMoT0REUykubGVuZ3RoOwogICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtufeODrOODvOOCueWIhmArKG4/IiI6Iu+8iOOCquODg+OCuuacquWPluW+l++8muODhOODvOODq+aOqOWumuOBruS6uuawl+OBp+WIpOWumu+8iSIpOwogIGF3YWl0IHJ1bkFsbCgidG9kYXlPdXQiKTtUT0RBWV9TSE9XTj10cnVlO2F1dG9TdGFydCgpOwogfWNhdGNoKGUpeyQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlfQogZmluYWxseXskKCJ0b2RheUdvIikuZGlzYWJsZWQ9ZmFsc2V9Cn07CiQoInRvZGF5VXBkIikub25jbGljaz1hc3luYygpPT57CiAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PSLlrabnv5Ljg4fjg7zjgr/jga7mnIDntYLml6XjgpLnorroqo3kuK3igKYiOwogbGV0IG09IiI7YXdhaXQgZm9yRWFjaFJvdyhyPT57aWYoci5kYXRlPm0pbT1yLmRhdGV9KTsKIGNvbnN0IGZyb209bT9hZGREYXlzKG0sMSk6IjIwMjMtMDEtMDEiLHRvPWpzdFllc3RlcmRheSgpOwogaWYoZnJvbT50byl7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1g5a2m57+S44OH44O844K/44Gv44GZ44Gn44Gr5pyA5paw44Gn44GZ77yI5pyA57WC5pelICR7bX3vvInjgIJgO3JldHVybn0KICQoInNzdGFydCIpLnZhbHVlPWZyb207JCgic2VuZCIpLnZhbHVlPXRvOwogJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtmcm9tfeOAnCR7dG99IOOBruaIkOe4vuOCkuWPluW+l+OBl+OBvuOBmeOAgumAsuaNl+OBr+OAjOKRoCDjg4fjg7zjgr/lj5blvpfjgI3jga7mrITjgavlh7rjgb7jgZnjgIJgOwogJCgic3luY0dvIikuY2xpY2soKTskKCJzeW5jU3RhdHVzIikuc2Nyb2xsSW50b1ZpZXcoe2JlaGF2aW9yOiJzbW9vdGgifSk7Cn07CgovKiAtLS0g4pGkIOmJhOadv+i7uOmmrCAvIOKRpSDlhajjg6zjg7zjgrnjga7ms6LkubHluqbvvIjnqbTppqzkuojmg7Pjgajjga/liKXjga7oqIjnrpfvvIkgLS0tICovCmNvbnN0IEdSQURFX0NPTE9SPXtTU1M6IiNkOTJkMjAiLFNTOiIjZjA0NDM4IixTOiIjZjc5MDA5IixBOiIjMTY2N2Q5IixCOiIjNjY3MDg1IixDOiIjOThhMmIzIn07CmNvbnN0IEdSQURFX09SREVSPVsiU1NTIiwiU1MiLCJTIiwiQSIsIkIiLCJDIl07CiQoImFkYXRlIikudmFsdWU9anN0VG9kYXkoKTsKZnVuY3Rpb24gcmFjZUxhYmVsKHIsbil7cmV0dXJuIGAke3IudmVudWVOYW1lfHxyLnZlbnVlfHwiIn0ke3IucmFjZU51bWJlcnx8IiJ9UiAke3IucmFjZU5hbWV8fCIife+8iCR7ci5zdXJmYWNlfHwiPyJ9JHtyLmRpc3RhbmNlfHwiPyJ9beODuyR7bn3poK3vvIlgfQphc3luYyBmdW5jdGlvbiByZW5kZXJBeGlzVXBzZXQoZCl7CiBjb25zdCBzdG9yZT1hd2FpdCBidWlsZFN0b3JlKGQpOwogY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVDb2RlfHxhLnZlbnVlTmFtZXx8IiIpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudmVudWVDb2RlfHxiLnZlbnVlTmFtZXx8IiIpKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogY29uc3QgY250PXt9O0dSQURFX09SREVSLmZvckVhY2goZz0+Y250W2ddPTApOwogY29uc3QgdXBSb3dzPVtdLGF4Um93cz1bXTtsZXQgd2l0aE9kZHM9MCxza2lwcGVkPTA7CiBmb3IoY29uc3QgciBvZiBycyl7CiAgY29uc3QgcmFjZT1ta1JhY2UocixkKSxuPXJhY2UucnVubmVycy5sZW5ndGg7CiAgaWYobjw2KXtza2lwcGVkKys7Y29udGludWV9CiAgY29uc3Qgb2Q9b2Rkc0ZvcihyYWNlKSxhcD1VRS5heGlzUHJvYnMocmFjZSxzdG9yZSxvZCk7CiAgY29uc3QgZz1VRS51cHNldEdyYWRlKHJhY2Usc3RvcmUsb2QsYXApO2NudFtnLmdyYWRlXSsrO2lmKG9kKXdpdGhPZGRzKys7CiAgdXBSb3dzLnB1c2goe2xhYmVsOnJhY2VMYWJlbChyLG4pLGd9KTsKICBjb25zdCBwaWNrcz1vZD9VRS5heGlzUGlja3MocmFjZSxzdG9yZSxvZCxhcCk6bnVsbDsKICBpZihwaWNrcylmb3IoY29uc3QgeCBvZiBwaWNrcylheFJvd3MucHVzaCh7bGFiZWw6cmFjZUxhYmVsKHIsbikseCxuYW1lOnJhY2UucnVubmVyc1t4LmldLm5hbWUsbm86cmFjZS5ydW5uZXJzW3guaV0ubnVtLGpuYW1lOnJhY2UucnVubmVyc1t4LmldLmpuYW1lfSk7CiB9CiAvLyDikaUg5rOi5Lmx5bqmCiBsZXQgaD1gPGRpdiBjbGFzcz0ic21hbGwiPuWvvuixoSAke3VwUm93cy5sZW5ndGh944Os44O844K577yI44Kq44OD44K65Y+N5pigICR7d2l0aE9kZHN944Os44O844K577yP44Gd44Gu5LuW44Gv44OE44O844Or5o6o5a6a77yJJHtza2lwcGVkP2DvvI826aCt5pyq5rqA44Gn5a++6LGh5aSWICR7c2tpcHBlZH1gOiIifTwvZGl2PmA7CiBoKz1gPGRpdiBjbGFzcz0icm93Ij5gK0dSQURFX09SREVSLm1hcChnPT5gPHNwYW4gY2xhc3M9InJ0IiBzdHlsZT0iYmFja2dyb3VuZDoke0dSQURFX0NPTE9SW2ddfSI+JHtnfSAke2NudFtnXX08L3NwYW4+YCkuam9pbigiICIpK2A8L2Rpdj5gOwogaCs9YDx0YWJsZT48dGhlYWQ+PHRyPjx0aD7jg6zjg7zjgrk8L3RoPjx0aD48L3RoPjx0aD7nrYnntJo8L3RoPjx0aD7pgY7ljrvjga7ms6LkubHnjoc8L3RoPjx0aD7liKTlrpo8L3RoPjwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB1IG9mIHVwUm93cyloKz1gPHRyPjx0ZD4ke2VzYyh1LmxhYmVsKX08L3RkPjx0ZD48L3RkPjx0ZD48c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbdS5nLmdyYWRlXX0iPiR7dS5nLmdyYWRlfTwvc3Bhbj48L3RkPjx0ZD4ke01hdGgucm91bmQodS5nLnJhdGUqMTAwKX0lPC90ZD48dGQgY2xhc3M9InNtYWxsIj4ke3UuZy5tb2RlPT09Im9kZHMiPyLjgqrjg4PjgroiOiLmjqjlrpoifTwvdGQ+PC90cj5gOwogaCs9YDwvdGJvZHk+PC90YWJsZT48ZGl2IGNsYXNzPSJzbWFsbCI+PGJyPuazouS5seeOh+OBr+OAgeOBneOBruetiee0muOBruODrOODvOOCueOBp+OAjDPnnYDlhoXjga7kurrmsJfjga7lkIjoqIjjgYwxNeS7peS4iuOAjeOBq+OBquOBo+OBn+mBjuWOu+OBruWJsuWQiOOBp+OBme+8iOWFqOODrOODvOOCueW5s+WdhyAyOC41Je+8ieOAgjwvZGl2PmA7CiAkKCJ1cHNldE91dCIpLmlubmVySFRNTD1oOwogLy8g4pGkIOmJhOadv+i7uOmmrAogbGV0IGE9YDxkaXYgY2xhc3M9InNtYWxsIj7jgqrjg4PjgrrjgYzlj5bjgozjgZ/jg6zjg7zjgrkgJHt3aXRoT2Rkc30vJHt1cFJvd3MubGVuZ3RofeOAgjwvZGl2PmA7CiBpZighd2l0aE9kZHMpYSs9YDxkaXYgY2xhc3M9Indhcm4iPuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBpuOBhOOBquOBhOOBn+OCgeOAgemJhOadv+i7uOmmrOOBr+WIpOWumuOBp+OBjeOBvuOBm+OCk++8iOeZuuWjsumWi+Wni+W+jOOBq+OAgeOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhO+8ieOAgjwvZGl2PmA7CiBlbHNlIGlmKCFheFJvd3MubGVuZ3RoKWErPWA8ZGl2IGNsYXNzPSJ3YXJuIj7mnKzml6Xjga/jgIHoqbLlvZPjgZnjgovou7jppqzjgYzjgYTjgb7jgZvjgpPvvIjjgqrjg4Pjgrrlj5blvpfmuIjjgb/jga7jg6zjg7zjgrnjga7kuK3jgavjgIHloIXou7jku6XkuIrjgYzjgYLjgorjgb7jgZvjgpPvvInjgII8L2Rpdj5gOwogZm9yKGNvbnN0IHQgb2YgWyLpiYTmnb8iLCLmupbpiYTmnb8iLCLloIXou7giXSl7Y29uc3QgbGlzdD1heFJvd3MuZmlsdGVyKHo9PnoueC50aWVyPT09dCk7aWYoIWxpc3QubGVuZ3RoKWNvbnRpbnVlOwogIGErPWA8YnI+PGI+JHt0fTwvYj48c3BhbiBjbGFzcz0ic21hbGwiPu+8iOmBjuWOu+OBruWun+e4viAkeyhVRS5BWElTLmJhbmRzW3RdLnJhdGUqMTAwKS50b0ZpeGVkKDApfSXjg7voqbLlvZMke1VFLkFYSVMuYmFuZHNbdF0ubn3poK3vvIk8L3NwYW4+YDsKICBmb3IoY29uc3QgeiBvZiBsaXN0KWErPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyh6LmxhYmVsKX08L2I+PGJyPiR7ZXNjKHoubm8pfeeVqiAke2VzYyh6Lm5hbWUpfSA8c3BhbiBjbGFzcz0ic21hbGwiPuS6iOa4rCAkeyh6LngucCoxMDApLnRvRml4ZWQoMCl9JSR7ei5qbmFtZT8i77yP6aiO5omL77yaIitlc2Moei5qbmFtZSk6IiJ9PC9zcGFuPjwvZGl2PmB9CiAkKCJheGlzT3V0IikuaW5uZXJIVE1MPWE7Cn0KJCgiYXhpc0dvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoImFkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOwogJCgiYXhpc0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJheGlzT3V0IikuaW5uZXJIVE1MPSIiOyQoInVwc2V0T3V0IikudGV4dENvbnRlbnQ9Iuino+aekOS4reKApiI7CiB0cnl7CiAgaWYoIVdSQUNFUy5sZW5ndGh8fFdEQVRFIT09ZCl7CiAgICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCmIjskKCJ3ZGF0ZSIpLnZhbHVlPWQ7YXdhaXQgJCgid2dldCIpLm9uY2xpY2soKTsKICAgaWYoIVdSQUNFUy5sZW5ndGgpeyQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0kKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ7JCgidXBzZXRPdXQiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X44Gn44GN44G+44Gb44KT44Gn44GX44Gf44CCIjtyZXR1cm59CiAgICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD0i44Kq44OD44K644KS56K66KqN5Lit4oCmIjthd2FpdCAkKCJvZGRzR2V0Iikub25jbGljaygpfQogICQoImF4aXNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke09iamVjdC5rZXlzKE9ERFMpLmxlbmd0aH3jg6zjg7zjgrnliIZgOwogIGF3YWl0IHJlbmRlckF4aXNVcHNldChkKTtBWElTX1NIT1dOPXRydWU7YXV0b1N0YXJ0KCk7CiB9Y2F0Y2goZSl7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZTskKCJ1cHNldE91dCIpLnRleHRDb250ZW50PSIifQogZmluYWxseXskKCJheGlzR28iKS5kaXNhYmxlZD1mYWxzZX0KfTsKCi8qIC0tLSDjgqrjg4Pjgrrjga7oh6rli5Xmm7TmlrDvvIjlvZPml6Xjga7jgb/vvInvvJrjgqrjg4Pjgrrlj5blvpcg4oaSIOihqOekuuS4reOBruashO+8iOKYheacrOaXpeODu+KRpOKRpe+8ieOCkuiHquWLleOBp+WGjeioiOeulyAtLS0gKi8KbGV0IEFVVE9fVD1udWxsLEFVVE9fTkVYVD0wLEFVVE9fQlVTWT1mYWxzZSxBVVRPX0xBU1Q9IiIsVE9EQVlfU0hPV049ZmFsc2UsQVhJU19TSE9XTj1mYWxzZTsKY29uc3QgYXV0b01zPSgpPT53aW5kb3cuX19BVVRPX01TfHxOdW1iZXIoJCgiYXV0b01pbiIpLnZhbHVlKSo2MDAwMDsKZnVuY3Rpb24gYXV0b1N0b3AoKXtpZihBVVRPX1QpY2xlYXJJbnRlcnZhbChBVVRPX1QpO0FVVE9fVD1udWxsOyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9IiJ9CmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hPZGRzQW5kVmlld3MoKXsKIGF3YWl0IGZldGNoT2RkcygpOwogQVVUT19MQVNUPW5ldyBEYXRlKERhdGUubm93KCkrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsMTkpOwogY29uc3Qgbj1PYmplY3Qua2V5cyhPRERTKS5sZW5ndGg7CiBpZihUT0RBWV9TSE9XTil7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke25944Os44O844K55YiG77yIJHtBVVRPX0xBU1R9IOabtOaWsO+8iWA7YXdhaXQgcnVuQWxsKCJ0b2RheU91dCIpfQogaWYoQVhJU19TSE9XTil7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIbvvIgke0FVVE9fTEFTVH0g5pu05paw77yJYDthd2FpdCByZW5kZXJBeGlzVXBzZXQoV0RBVEUpfQp9CmZ1bmN0aW9uIGF1dG9TdGFydCgpewogYXV0b1N0b3AoKTsKIGlmKCEkKCJhdXRvT2RkcyIpLmNoZWNrZWR8fCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGlmKFdEQVRFPGpzdFRvZGF5KCkpeyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9Iu+8iOmBjuWOu+OBruaXpeS7mOOBruOBn+OCgeiHquWLleabtOaWsOOBr+OBl+OBvuOBm+OCk++8iSI7cmV0dXJufQogQVVUT19ORVhUPURhdGUubm93KCkrYXV0b01zKCk7CiBBVVRPX1Q9c2V0SW50ZXJ2YWwoYXN5bmMoKT0+ewogIGNvbnN0IGxlZnQ9QVVUT19ORVhULURhdGUubm93KCk7CiAgaWYobGVmdD4wKXskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PWDmrKHjga7mm7TmlrDjgb7jgacgJHtNYXRoLmNlaWwobGVmdC8xMDAwKX3np5JgKyhBVVRPX0xBU1Q/YO+8j+acgOe1guabtOaWsCAke0FVVE9fTEFTVH1gOiIiKTtyZXR1cm59CiAgaWYoQVVUT19CVVNZKXJldHVybjtBVVRPX0JVU1k9dHJ1ZTskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSLjgqrjg4PjgrrjgpLmm7TmlrDkuK3igKYiOwogIHRyeXthd2FpdCByZWZyZXNoT2Rkc0FuZFZpZXdzKCl9Y2F0Y2goZSl7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0i5pu05paw44Ko44Op44O877yaIitlLm1lc3NhZ2V9CiAgZmluYWxseXtBVVRPX0JVU1k9ZmFsc2U7QVVUT19ORVhUPURhdGUubm93KCkrYXV0b01zKCl9CiB9LHdpbmRvdy5fX0FVVE9fVElDS3x8MTAwMCk7Cn0KJCgiYXV0b09kZHMiKS5vbmNoYW5nZT1hdXRvU3RhcnQ7JCgiYXV0b01pbiIpLm9uY2hhbmdlPWF1dG9TdGFydDsKCi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQogKiDoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fvvIhDbG91ZGZsYXJlIEtW77yJCiAqIOODu+ODh+ODvOOCv+OBjOWkieOCj+OBo+OBn+OCsOODq+ODvOODl++8iGNzdi3lubTvvI9saXZlLeW5tOaciO+8j3BheS3lubTmnIjvvI9tZXRh77yJ44Gg44GR44KS44CBZ3ppcOOBl+OBpumAgeOCiwogKiDjg7vkv53lrZjlhYjjga7orZjliKXjga/jgIHjg5Hjgrnjg5Xjg6zjg7zjgrrjga5TSEEtMjU277yI44OR44K544OV44Os44O844K644Gd44Gu44KC44Gu44Gv6YCB44KJ44Gq44GE77yJCiAqIOODu+W+qeWFg+OBr+OAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+OAguWQjOOBmOOCreODvOOBruODh+ODvOOCv+OBr+S4iuabuOOBjeOBleOCjOOCiwogKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovCmNvbnN0IEJLPXtwYXNzOiIiLGF1dG86dHJ1ZSxkaXJ0eTpuZXcgU2V0KCksYnVzeTpmYWxzZSxpZDoiIixzYXZlVDpudWxsLHJ1blQ6bnVsbCxpbmZvOm51bGwsbXNnOiIiLGVycjpmYWxzZX07CmNvbnN0IHJhd01ldGFQdXQ9KGssdik9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCB0PURCLnRyYW5zYWN0aW9uKCJtZXRhIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgibWV0YSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IHJhd1B1dE1hbnk9cmVjcz0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHN0PVsuLi5uZXcgU2V0KHJlY3MubWFwKHI9PnIucykpXTtpZighc3QubGVuZ3RoKXJldHVybiBvaygpO2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oc3QsInJlYWR3cml0ZSIpO2Zvcihjb25zdCByIG9mIHJlY3MpdC5vYmplY3RTdG9yZShyLnMpLnB1dChyLnYsci5rKTt0Lm9uY29tcGxldGU9b2s7dC5vbmVycm9yPSgpPT5uZyh0LmVycm9yKX0pOwpjb25zdCBpZGJSYW5nZT0oc3RvcmUscmFuZ2UpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgb3V0PVtdO2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5vcGVuQ3Vyc29yKHJhbmdlKTtxLm9uc3VjY2Vzcz1lPT57Y29uc3QgYz1lLnRhcmdldC5yZXN1bHQ7aWYoYyl7b3V0LnB1c2goe3M6c3RvcmUsazpjLmtleSx2OmMudmFsdWV9KTtjLmNvbnRpbnVlKCl9ZWxzZSBvayhvdXQpfTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYktleXM9c3RvcmU9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBxPURCLnRyYW5zYWN0aW9uKHN0b3JlKS5vYmplY3RTdG9yZShzdG9yZSkuZ2V0QWxsS2V5cygpO3Eub25zdWNjZXNzPSgpPT5vayhxLnJlc3VsdHx8W10pO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKZnVuY3Rpb24gZ3JvdXBPZihzdG9yZSxrZXkpewoga2V5PVN0cmluZyhrZXkpOwogaWYoc3RvcmU9PT0iZmlsZXMiKXtpZihrZXkuc3RhcnRzV2l0aCgibGl2ZToiKSlyZXR1cm4gImxpdmUtIitrZXkuc2xpY2UoNSwxMik7Y29uc3QgeT1rZXkuc3BsaXQoIjoiKVswXTtyZXR1cm4gL14oMHwyMFxkXGQpJC8udGVzdCh5KT8iY3N2LSIreToiY3N2LTAifQogaWYoc3RvcmU9PT0icGF5IilyZXR1cm4gInBheS0iK2tleS5zbGljZSgwLDcpOwogcmV0dXJuICJtZXRhIjsKfQpmdW5jdGlvbiBtYXJrRGlydHkoc3RvcmUsa2V5KXsKIGlmKHN0b3JlPT09Im1ldGEiJiYoa2V5PT09ImRpcnR5Inx8a2V5PT09ImJhY2t1cCIpKXJldHVybjsKIEJLLmRpcnR5LmFkZChncm91cE9mKHN0b3JlLGtleSkpOwogY2xlYXJUaW1lb3V0KEJLLnNhdmVUKTtCSy5zYXZlVD1zZXRUaW1lb3V0KCgpPT57cmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pLmNhdGNoKCgpPT57fSk7YmtSZW5kZXIoKX0sODAwKTsKfQphc3luYyBmdW5jdGlvbiByZWFkR3JvdXAobmFtZSl7CiBsZXQgbTsKIGlmKG5hbWU9PT0ibWV0YSIpcmV0dXJuKGF3YWl0IGlkYlJhbmdlKCJtZXRhIikpLmZpbHRlcihyPT5yLmshPT0iZGlydHkiJiZyLmshPT0iYmFja3VwIik7CiBpZihtPW5hbWUubWF0Y2goL15jc3YtKFxkKykkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYCR7bVsxXX06YCxgJHttWzFdfTtgKSk7CiBpZihtPW5hbWUubWF0Y2goL15saXZlLShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJmaWxlcyIsSURCS2V5UmFuZ2UuYm91bmQoYGxpdmU6JHttWzFdfS0wMGAsYGxpdmU6JHttWzFdfS05OWApKTsKIGlmKG09bmFtZS5tYXRjaCgvXnBheS0oXGR7NH0tXGR7Mn0pJC8pKXJldHVybiBpZGJSYW5nZSgicGF5IixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfS0wMGAsYCR7bVsxXX0tOTlgKSk7CiByZXR1cm5bXTsKfQphc3luYyBmdW5jdGlvbiBhbGxHcm91cHMoKXsKIGNvbnN0IGc9bmV3IFNldCgpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygiZmlsZXMiKSlnLmFkZChncm91cE9mKCJmaWxlcyIsaykpOwogZm9yKGNvbnN0IGsgb2YgYXdhaXQgaWRiS2V5cygicGF5IikpZy5hZGQoZ3JvdXBPZigicGF5IixrKSk7CiBpZigoYXdhaXQgaWRiS2V5cygibWV0YSIpKS5zb21lKGs9PmshPT0iZGlydHkiJiZrIT09ImJhY2t1cCIpKWcuYWRkKCJtZXRhIik7CiByZXR1cm5bLi4uZ107Cn0KYXN5bmMgZnVuY3Rpb24gZ3ooc3RyKXsKIGNvbnN0IHJhdz1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc3RyKTsKIGlmKHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbT09PSJ1bmRlZmluZWQiKXJldHVybntidWY6cmF3LGVuYzoicmF3In07CiBjb25zdCBjcz1uZXcgQ29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWNzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUocmF3KTt3LmNsb3NlKCk7CiByZXR1cm57YnVmOm5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShjcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSksZW5jOiJnemlwIn07Cn0KYXN5bmMgZnVuY3Rpb24gZ3VuemlwKGJ1ZixlbmMpewogaWYoZW5jPT09InJhdyIpcmV0dXJuIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShidWYpOwogY29uc3QgZHM9bmV3IERlY29tcHJlc3Npb25TdHJlYW0oImd6aXAiKSx3PWRzLndyaXRhYmxlLmdldFdyaXRlcigpO3cud3JpdGUoYnVmKTt3LmNsb3NlKCk7CiByZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGF3YWl0IG5ldyBSZXNwb25zZShkcy5yZWFkYWJsZSkuYXJyYXlCdWZmZXIoKSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtNYWtlSWQoKXsKIGlmKCEod2luZG93LmNyeXB0byYmY3J5cHRvLnN1YnRsZSkpdGhyb3cgbmV3IEVycm9yKCLjgZPjga7nkrDlooPjgafjga/kvb/jgYjjgb7jgZvjgpPvvIhodHRwcyDjgafplovjgY/lv4XopoHjgYzjgYLjgorjgb7jgZnvvIkiKTsKIGNvbnN0IGQ9YXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSgia2VpYmEtdXBzZXQtYmFja3VwOnYxOiIrQksucGFzcykpOwogcmV0dXJuWy4uLm5ldyBVaW50OEFycmF5KGQpXS5tYXAoYj0+Yi50b1N0cmluZygxNikucGFkU3RhcnQoMiwiMCIpKS5qb2luKCIiKTsKfQphc3luYyBmdW5jdGlvbiBia0ZldGNoKHBhdGgsb3B0KXsKIGlmKCFCSy5pZClCSy5pZD1hd2FpdCBia01ha2VJZCgpOwogcmV0dXJuIGZldGNoKCQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKStwYXRoLE9iamVjdC5hc3NpZ24oe30sb3B0LHtoZWFkZXJzOk9iamVjdC5hc3NpZ24oeyJ4LWJhY2t1cC1pZCI6QksuaWR9LChvcHQmJm9wdC5oZWFkZXJzKXx8e30pfSkpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrSlNPTihwYXRoLG9wdCl7CiBjb25zdCByPWF3YWl0IGJrRmV0Y2gocGF0aCxvcHQpLHQ9YXdhaXQgci50ZXh0KCk7bGV0IGo9e307dHJ5e2o9SlNPTi5wYXJzZSh0KX1jYXRjaChlKXt9CiBpZighci5va3x8ai5vaz09PWZhbHNlKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwoIkhUVFAgIityLnN0YXR1cykpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGJrTXNnKHQsaXNFcnIpe0JLLm1zZz10fHwiIjtCSy5lcnI9ISFpc0Vycjtia1JlbmRlcigpfQpmdW5jdGlvbiBia1JlbmRlcigpewogY29uc3QgZWw9JCgiYmtTdGF0dXMiKTtpZighZWwpcmV0dXJuOwogY29uc3QgbT1CSy5pbmZvLGpzdD1tcz0+bmV3IERhdGUobXMrOSozNjAwZTMpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgiVCIsIiAiKS5zbGljZSgwLDE2KTsKIGxldCBzdW09IiI7CiBpZighQksucGFzcylzdW09IuODkeOCueODleODrOODvOOCuuOCkuioreWumuOBmeOCi+OBqOOAgeiHquWLleODkOODg+OCr+OCouODg+ODl+OBjOacieWKueOBq+OBquOCiuOBvuOBmeOAgiI7CiBlbHNlIGlmKG0mJm0uZXhpc3RzKXtjb25zdCBjcz1PYmplY3QudmFsdWVzKG0uY2h1bmtzfHx7fSk7c3VtPWDmnIDntYLjg5Djg4Pjgq/jgqLjg4Pjg5fvvJoke2pzdChtLnVwZGF0ZWRBdCl977yIJHtjcy5sZW5ndGh944Kw44Or44O844OX77yPJHsoY3MucmVkdWNlKChzLGMpPT5zK2Muc2l6ZSwwKS8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYH0KIGVsc2Ugc3VtPSLjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgb7jgaDjgYLjgorjgb7jgZvjgpPjgIIiOwogaWYoQksucGFzcylzdW0rPWDvvI/mnKrpgIHkv6Hjga7lpInmm7TvvJoke0JLLmRpcnR5LnNpemV944Kw44Or44O844OXJHtCSy5hdXRvPyLvvIjoh6rli5XjgafpgIHjgorjgb7jgZnvvIkiOiLvvIjoh6rli5Xjg5Djg4Pjgq/jgqLjg4Pjg5fjga/jgqrjg5XvvIkifWA7CiBlbC5pbm5lckhUTUw9KEJLLm1zZz9gPHNwYW4gY2xhc3M9IiR7QksuZXJyPyJ3YXJuIjoiZ29vZCJ9Ij4ke2VzYyhCSy5tc2cpfTwvc3Bhbj5cbmA6IiIpK2VzYyhzdW0pOwp9CmZ1bmN0aW9uIGJrTmVlZFBhc3MoKXtpZighQksucGFzc3x8QksucGFzcy5sZW5ndGg8OCl7YmtNc2coIuODkeOCueODleODrOODvOOCuuOCkjjmloflrZfku6XkuIrjgaflhaXlipvjgZfjgabjgY/jgaDjgZXjgYTjgIIiLHRydWUpO3JldHVybiB0cnVlfXJldHVybiBmYWxzZX0KYXN5bmMgZnVuY3Rpb24gYmtSZWZyZXNoKG1hbil7CiB0cnl7QksuaW5mbz1tYW58fGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpfWNhdGNoKGUpe0JLLmluZm89bnVsbDtpZighQksubXNnKWJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3jgafjgY3jgb7jgZvjgpPvvJoiK2UubWVzc2FnZSx0cnVlKX0KIGJrUmVuZGVyKCk7Cn0KYXN5bmMgZnVuY3Rpb24gcnVuQmFja3VwKGZ1bGwpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTtjb25zdCBpbmZsaWdodD1uZXcgU2V0KEJLLmRpcnR5KTtCSy5kaXJ0eS5jbGVhcigpOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5flhYjjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0IiksaGF2ZT1tYW4uZXhpc3RzPyhtYW4uY2h1bmtzfHx7fSk6e307CiAgY29uc3QgbmFtZXM9KGZ1bGx8fCFtYW4uZXhpc3RzKT9hd2FpdCBhbGxHcm91cHMoKTpbLi4uaW5mbGlnaHRdOwogIGlmKCFuYW1lcy5sZW5ndGgpe2JrTXNnKCLlpInmm7Tjga/jgYLjgorjgb7jgZvjgpPjgIIiKTthd2FpdCBia1JlZnJlc2gobWFuKTtyZXR1cm59CiAgY29uc3QgY2h1bmtzPU9iamVjdC5hc3NpZ24oe30saGF2ZSk7bGV0IHNlbnQ9MCxieXRlcz0wOwogIGZvcihsZXQgaT0wO2k8bmFtZXMubGVuZ3RoO2krKyl7CiAgIGNvbnN0IG5hbWU9bmFtZXNbaV07YmtNc2coYOODkOODg+OCr+OCouODg+ODl+S4reKApiAke2krMX0vJHtuYW1lcy5sZW5ndGh977yIJHtuYW1lfe+8iWApOwogICBjb25zdCByZWNzPWF3YWl0IHJlYWRHcm91cChuYW1lKTsKICAgaWYoIXJlY3MubGVuZ3RoKXtpZihjaHVua3NbbmFtZV0pe2F3YWl0IGJrRmV0Y2goYC9iYWNrdXAvY2h1bms/bmFtZT0ke2VuY29kZVVSSUNvbXBvbmVudChuYW1lKX1gLHttZXRob2Q6IkRFTEVURSJ9KTtkZWxldGUgY2h1bmtzW25hbWVdfWNvbnRpbnVlfQogICBjb25zdCByYXc9SlNPTi5zdHJpbmdpZnkoe2c6bmFtZSxyZWNzfSkse2J1ZixlbmN9PWF3YWl0IGd6KHJhdyk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiUFVUIixib2R5OmJ1Zn0pOwogICBpZighci5vayl7bGV0IGU9IiI7dHJ5e2U9KGF3YWl0IHIuanNvbigpKS5lcnJvcn1jYXRjaChfKXt9dGhyb3cgbmV3IEVycm9yKGV8fCgiSFRUUCAiK3Iuc3RhdHVzKSl9CiAgIGNodW5rc1tuYW1lXT17c2l6ZTpidWYuYnl0ZUxlbmd0aCxyYXdTaXplOnJhdy5sZW5ndGgsbjpyZWNzLmxlbmd0aCxlbmMsYXQ6RGF0ZS5ub3coKX07c2VudCsrO2J5dGVzKz1idWYuYnl0ZUxlbmd0aDsKICB9CiAgaWYoZnVsbHx8IW1hbi5leGlzdHMpe2Zvcihjb25zdCBuIG9mIE9iamVjdC5rZXlzKGhhdmUpKWlmKCFuYW1lcy5pbmNsdWRlcyhuKSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG4pfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3Nbbl19fQogIGNvbnN0IG1hbmlmZXN0PXt2OjEsdXBkYXRlZEF0OkRhdGUubm93KCksY2h1bmtzfTsKICBhd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiLHttZXRob2Q6IlBVVCIsYm9keTpKU09OLnN0cmluZ2lmeShtYW5pZmVzdCksaGVhZGVyczp7ImNvbnRlbnQtdHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifX0pOwogIG1hbmlmZXN0LmV4aXN0cz10cnVlO2F3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW5pZmVzdC51cGRhdGVkQXR9KTsKICBCSy5pbmZvPW1hbmlmZXN0O2JrTXNnKGDjg5Djg4Pjgq/jgqLjg4Pjg5flrozkuobvvJoke3NlbnR944Kw44Or44O844OX44KS6YCB5L+h77yIJHsoYnl0ZXMvMTA0ODU3NikudG9GaXhlZCgxKX1NQu+8iWApOwogfWNhdGNoKGUpewogIGZvcihjb25zdCBuIG9mIGluZmxpZ2h0KUJLLmRpcnR5LmFkZChuKTtyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44Gr5aSx5pWX44GX44G+44GX44Gf77yaIitlLm1lc3NhZ2UsdHJ1ZSk7CiB9ZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KYXN5bmMgZnVuY3Rpb24gcnVuUmVzdG9yZSgpewogaWYoQksuYnVzeXx8YmtOZWVkUGFzcygpKXJldHVybjsKIEJLLmJ1c3k9dHJ1ZTsKIHRyeXsKICBia01zZygi44OQ44OD44Kv44Ki44OD44OX44KS56K66KqN5Lit4oCmIik7CiAgY29uc3QgbWFuPWF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIpOwogIGlmKCFtYW4uZXhpc3RzKXtia01zZygi44GT44Gu44OR44K544OV44Os44O844K644Gu44OQ44OD44Kv44Ki44OD44OX44Gv6KaL44Gk44GL44KK44G+44Gb44KT77yI44OR44K544OV44Os44O844K644KS56K66KqN44GX44Gm44GP44Gg44GV44GE77yJ44CCIix0cnVlKTtyZXR1cm59CiAgY29uc3QgbmFtZXM9T2JqZWN0LmtleXMobWFuLmNodW5rc3x8e30pO2xldCBuPTAsY250PTA7CiAgZm9yKGNvbnN0IG5hbWUgb2YgbmFtZXMpewogICBia01zZyhg5b6p5YWD5Lit4oCmICR7KytufS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWApOwogICBpZighci5vayl0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0g44KS5Y+W5b6X44Gn44GN44G+44Gb44KT77yISFRUUCAke3Iuc3RhdHVzfe+8iWApOwogICBjb25zdCBvPUpTT04ucGFyc2UoYXdhaXQgZ3VuemlwKG5ldyBVaW50OEFycmF5KGF3YWl0IHIuYXJyYXlCdWZmZXIoKSksbWFuLmNodW5rc1tuYW1lXS5lbmN8fCJnemlwIikpOwogICBhd2FpdCByYXdQdXRNYW55KG8ucmVjcyk7Y250Kz1vLnJlY3MubGVuZ3RoOwogIH0KICBTVE9SRT1udWxsO1NUT1JFX0tFWT0iIjtCQUNLVVBfREFURVM9bnVsbDtCSy5kaXJ0eS5jbGVhcigpOwogIGF3YWl0IHJhd01ldGFQdXQoImRpcnR5IixbXSk7YXdhaXQgcmF3TWV0YVB1dCgiYmFja3VwIix7YXQ6bWFuLnVwZGF0ZWRBdH0pOwogIGF3YWl0IHNob3dTdGF0ZSgpO0JLLmluZm89bWFuO2JrTXNnKGDlvqnlhYPlrozkuobvvJoke25hbWVzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8ke2NudC50b0xvY2FsZVN0cmluZygpfeS7tmApOwogfWNhdGNoKGUpe2JrTXNnKCLlvqnlhYPjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKX0KIGZpbmFsbHl7QksuYnVzeT1mYWxzZTtia1JlbmRlcigpfQp9CmZ1bmN0aW9uIGJrU2NoZWR1bGUobXMpewogaWYoIUJLLmF1dG98fCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXJldHVybjsKIGNsZWFyVGltZW91dChCSy5ydW5UKTtCSy5ydW5UPXNldFRpbWVvdXQoKCk9PntpZighU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpO2Vsc2UgYmtTY2hlZHVsZSgzMDAwMCl9LG1zfHwzMDAwKTsKfQpmdW5jdGlvbiBia1NhdmVTZXR0aW5ncygpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfYmsiLEpTT04uc3RyaW5naWZ5KHtwYXNzOkJLLnBhc3MsYXV0bzpCSy5hdXRvfSkpfWNhdGNoKGUpe319CmZ1bmN0aW9uIGZvY3VzSW5pdCgpe3RyeXtjb25zdCB2PWxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9mb2N1cyIpO2lmKHYhPT1udWxsKSQoImZvY3VzT24iKS5jaGVja2VkPXY9PT0iMSJ9Y2F0Y2goZSl7fSQoImZvY3VzT24iKS5vbmNoYW5nZT0oKT0+e3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgidXBzZXRfZm9jdXMiLCQoImZvY3VzT24iKS5jaGVja2VkPyIxIjoiMCIpfWNhdGNoKGUpe31pZihUT0RBWV9TSE9XTilydW5BbGwoInRvZGF5T3V0Iil9fQphc3luYyBmdW5jdGlvbiBia0luaXQoKXtmb2N1c0luaXQoKTsKIHRyeXtjb25zdCBvPUpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oInVwc2V0X2JrIil8fCJ7fSIpO0JLLnBhc3M9by5wYXNzfHwiIjtCSy5hdXRvPW8uYXV0byE9PWZhbHNlfWNhdGNoKGUpe30KICQoImJrUGFzcyIpLnZhbHVlPUJLLnBhc3M7JCgiYmtBdXRvIikuY2hlY2tlZD1CSy5hdXRvOwogJCgiYmtQYXNzIikub25jaGFuZ2U9KCk9PntCSy5wYXNzPSQoImJrUGFzcyIpLnZhbHVlLnRyaW0oKTtCSy5pZD0iIjtCSy5pbmZvPW51bGw7QksubXNnPSIiO2JrU2F2ZVNldHRpbmdzKCk7aWYoQksucGFzcy5sZW5ndGg+PTgpYmtSZWZyZXNoKCk7ZWxzZSBia1JlbmRlcigpfTsKICQoImJrU2hvdyIpLm9uY2xpY2s9KCk9Pntjb25zdCBwPSQoImJrUGFzcyIpO3AudHlwZT1wLnR5cGU9PT0icGFzc3dvcmQiPyJ0ZXh0IjoicGFzc3dvcmQiOyQoImJrU2hvdyIpLnRleHRDb250ZW50PXAudHlwZT09PSJwYXNzd29yZCI/IuihqOekuiI6IumaoOOBmSJ9OwogJCgiYmtBdXRvIikub25jaGFuZ2U9KCk9PntCSy5hdXRvPSQoImJrQXV0byIpLmNoZWNrZWQ7YmtTYXZlU2V0dGluZ3MoKTtia1JlbmRlcigpO2lmKEJLLmF1dG8pYmtTY2hlZHVsZSgyMDAwKX07CiAkKCJia05vdyIpLm9uY2xpY2s9KCk9PnJ1bkJhY2t1cChmYWxzZSk7CiAkKCJia0Z1bGwiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GZ44G544Gm44Gu44OH44O844K/44KS44CB44GC44KJ44Gf44KB44Gm5L+d5a2Y44GX55u044GX44G+44GZ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuQmFja3VwKHRydWUpfTsKICQoImJrUmVzdG9yZSIpLm9uY2xpY2s9KCk9PntpZihjb25maXJtKCLjgZPjga7nq6/mnKvjga7jg4fjg7zjgr/jgpLjgIHjg5Djg4Pjgq/jgqLjg4Pjg5fjga7lhoXlrrnjgafkuIrmm7jjgY3jgZfjgb7jgZnvvIjjg5Djg4Pjgq/jgqLjg4Pjg5fjgavjgYLjgovjg4fjg7zjgr/jgaDjgZHjgYzlr77osaHjgafjgZnvvInjgILjgojjgo3jgZfjgYTjgafjgZnjgYvvvJ8iKSlydW5SZXN0b3JlKCl9OwogdHJ5e2NvbnN0IGQ9YXdhaXQgbWV0YUdldCgiZGlydHkiKTtpZihBcnJheS5pc0FycmF5KGQpKWQuZm9yRWFjaCh4PT5CSy5kaXJ0eS5hZGQoeCkpfWNhdGNoKGUpe30KIHRyeXtpZihuYXZpZ2F0b3Iuc3RvcmFnZSYmbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCluYXZpZ2F0b3Iuc3RvcmFnZS5wZXJzaXN0KCkuY2F0Y2goKCk9Pnt9KX1jYXRjaChlKXt9CiBia1JlbmRlcigpOwogaWYoQksucGFzcy5sZW5ndGg+PTgpe2F3YWl0IGJrUmVmcmVzaCgpO2lmKEJLLmRpcnR5LnNpemUpYmtTY2hlZHVsZSg1MDAwKX0KIHNldEludGVydmFsKCgpPT57aWYoQksuYXV0byYmQksucGFzcy5sZW5ndGg+PTgmJkJLLmRpcnR5LnNpemUmJiFCSy5idXN5JiYhU1lOQ0lORylydW5CYWNrdXAoZmFsc2UpfSx3aW5kb3cuX19CS19USUNLfHw5MDAwMDApOwp9CgooYXN5bmMoKT0+e3RyeXthd2FpdCBvcGVuREIoKTthd2FpdCBzaG93U3RhdGUoKTthd2FpdCBwYXlTdGF0ZSgpO2F3YWl0IGJrSW5pdCgpfWNhdGNoKGUpeyQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kv53lrZjpoJjln5/jgpLplovjgZHjgb7jgZvjgpPvvJoke2VzYyhlLm1lc3NhZ2UpfVxu77yI44OX44Op44Kk44OZ44O844OI44OW44Op44Km44K644Gn44Gv5L2/44GI44Gq44GE44GT44Go44GM44GC44KK44G+44GZ77yJPC9zcGFuPmB9fSkoKTsKaWYoL15odHRwcz86Ly50ZXN0KGxvY2F0aW9uLnByb3RvY29sKSkkKCJ3dXJsIikudmFsdWU9bG9jYXRpb24ub3JpZ2luOwpzaG93UGFuZSgiV29ya2VyIik7Cgo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";
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
