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
const APP_HTML_BASE64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImphIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+Cjx0aXRsZT7nqbTppqzlpb3otbDjg4Tjg7zjg6s8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2YzZjVmNzstLWNhcmQ6I2ZmZjstLXR4OiMxNzIwMmE7LS1zdWI6IzVkNjg3NTstLWxuOiNlNWU3ZWI7LS1oZDojMTAxODI4Oy0tcHI6IzE2NjdkOX0KQG1lZGlhKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzBmMTQxYTstLWNhcmQ6IzFhMjEyOTstLXR4OiNlOGVjZjE7LS1zdWI6IzlhYTZiMjstLWxuOiMyYjM0M2U7LS1oZDojMDUwODBjOy0tcHI6IzRiOGVmMH19CmJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0tdHgpO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KaGVhZGVye2JhY2tncm91bmQ6dmFyKC0taGQpO2NvbG9yOiNmZmY7cGFkZGluZzoxNHB4IDE2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxOXB4fQptYWlue21heC13aWR0aDo5MDBweDttYXJnaW46YXV0bztwYWRkaW5nOjEwcHh9CnNlY3Rpb257YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNHB4O21hcmdpbjoxMHB4IDA7Ym94LXNoYWRvdzowIDFweCA0cHggIzAwMDF9Cmgye2ZvbnQtc2l6ZToxNnB4O21hcmdpbjowIDAgOHB4fQpidXR0b257Ym9yZGVyOjA7Ym9yZGVyLXJhZGl1czo5cHg7cGFkZGluZzoxMXB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1wcik7Y29sb3I6I2ZmZjtmb250LXdlaWdodDo3MDA7bWFyZ2luOjRweCA0cHggNHB4IDA7Zm9udC1zaXplOjE0cHh9CmJ1dHRvbjpkaXNhYmxlZHtvcGFjaXR5Oi40fWJ1dHRvbi5zdWJ7YmFja2dyb3VuZDojNjY3MDg1fQppbnB1dCxzZWxlY3QsdGV4dGFyZWF7cGFkZGluZzo5cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1sbik7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtjb2xvcjp2YXIoLS10eCk7Zm9udC1zaXplOjE1cHg7bWF4LXdpZHRoOjEwMCU7Ym94LXNpemluZzpib3JkZXItYm94fQp0ZXh0YXJlYXt3aWR0aDoxMDAlO21pbi1oZWlnaHQ6MTIwcHg7Zm9udC1mYW1pbHk6aW5oZXJpdH0KLnNtYWxse2ZvbnQtc2l6ZToxM3B4O2NvbG9yOnZhcigtLXN1Yil9LnN0YXR1c3twYWRkaW5nOjlweDtiYWNrZ3JvdW5kOnZhcigtLWJnKTtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjhweDt3aGl0ZS1zcGFjZTpwcmUtd3JhcH0KLmdvb2R7Y29sb3I6IzEzNzMzMztmb250LXdlaWdodDo3MDB9Lndhcm57Y29sb3I6I2MyNmEwMDtmb250LXdlaWdodDo3MDB9CnRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxM3B4fXRoLHRke3BhZGRpbmc6NnB4IDNweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1sbik7dGV4dC1hbGlnbjpyaWdodH0KdGg6bnRoLWNoaWxkKC1uKzIpLHRkOm50aC1jaGlsZCgtbisyKXt0ZXh0LWFsaWduOmxlZnR9Ci5jYW5ke2JvcmRlcjoxcHggc29saWQgdmFyKC0tbG4pO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjlweDttYXJnaW46OHB4IDB9Ci5jaGlwe2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1yYWRpdXM6OTk5cHg7cGFkZGluZzoycHggOHB4O21hcmdpbjozcHggNHB4IDAgMDtiYWNrZ3JvdW5kOiNlZWYxZjU7Y29sb3I6IzM0NDA1NH0KLmNoaXAuYntiYWNrZ3JvdW5kOiNlMGYyZTY7Y29sb3I6IzEzNzMzM30uY2hpcC5ve2JhY2tncm91bmQ6I2ZmZWZjZjtjb2xvcjojOWE1YTAwfS5jaGlwLmd7YmFja2dyb3VuZDojZTZlOWVlO2NvbG9yOiM1ZDY4NzV9Ci5ydHtkaXNwbGF5OmlubGluZS1ibG9jaztmb250LXdlaWdodDo4MDA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzowIDdweDtjb2xvcjojZmZmO2JhY2tncm91bmQ6Izk4YTJiM30KLnJ0LnJTe2JhY2tncm91bmQ6I2Q5MmQyMH0ucnQuckF7YmFja2dyb3VuZDojZjc5MDA5fS5ydC5yQntiYWNrZ3JvdW5kOiMxNjY3ZDl9Ci5yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbjo2cHggMH0KI2J1c3l7ZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDojMDAwODt6LWluZGV4OjIwO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQojYnVzeT5kaXZ7YmFja2dyb3VuZDp2YXIoLS1oZCk7Y29sb3I6I2ZmZjtwYWRkaW5nOjE4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O21heC13aWR0aDo4MCU7dGV4dC1hbGlnbjpjZW50ZXI7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Cjwvc3R5bGU+PC9oZWFkPjxib2R5Pgo8aGVhZGVyPueptOmmrOWlvei1sOODhOODvOODqyA8c3BhbiBzdHlsZT0iZm9udC13ZWlnaHQ6NDAwO2ZvbnQtc2l6ZToxM3B4Ij7ljZjkvZPniYggdjE8L3NwYW4+PC9oZWFkZXI+CjxtYWluPgo8c2VjdGlvbj4KPGgyPuKYhSDmnKzml6Xjga7lpb3otbDnqbTppqw8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44Oc44K/44OzMeOBpOOBp+OAjOWHuummrOihqOOBruWPluW+lyDihpIg44Kq44OD44K677yI5Y+W44KM44KM44Gw77yJ4oaSIOWFqOODrOODvOOCueOBrueptOmmrOWAmeijnOOAjeOCkuihqOekuuOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+4pqgIOmBjuWOu+OBruaknOiovO+8iDIwMjPlubTjgJzjgIHmiZXmiLvjgaTjgY3vvInvvJrnqbTppqwx5L2N5YCZ6KOc44GuPGI+6KSH5Yud5Zue5Y+O546H44Gv57SENzLjgJw3NyU8L2I+77yIMTAwJeacqua6gO+8ieOBp+OBl+OBn+OAguW9k+OBn+OCiuOChOOBmeOBleOBruebruWuieOBqOOBl+OBpuOBiuS9v+OBhOOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0idGRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9InRvZGF5R28iPuWlvei1sOeptOmmrOOCkuihqOekujwvYnV0dG9uPjxidXR0b24gaWQ9InRvZGF5VXBkIiBjbGFzcz0ic3ViIj7mnIDmlrDjga7miJDnuL7jgavmm7TmlrA8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJhdXRvT2RkcyIgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ+IOOCquODg+OCuuOCkuiHquWLleOBp+abtOaWsOOBmeOCizwvbGFiZWw+IDxzZWxlY3QgaWQ9ImF1dG9NaW4iPjxvcHRpb24gdmFsdWU9IjMiPjPliIY8L29wdGlvbj48b3B0aW9uIHZhbHVlPSI1IiBzZWxlY3RlZD415YiGPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEw5YiGPC9vcHRpb24+PC9zZWxlY3Q+IOOBlOOBqCA8c3BhbiBpZD0iYXV0b0luZm8iPjwvc3Bhbj48L2Rpdj4KPGRpdiBpZD0idG9kYXlTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+OAjOWlvei1sOeptOmmrOOCkuihqOekuuOAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAguaIkOe4vuOBjOWPpOOBhOOBqOOBjeOBr+WFiOOBq+OAjOacgOaWsOOBruaIkOe4vuOBq+abtOaWsOOAjeOCkuaKvOOBl+OBvuOBmeOAgjwvZGl2Pgo8ZGl2IGlkPSJ0b2RheU91dCI+PC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgIOODh+ODvOOCv+WPluW+l++8iOOBk+OBruOCouODl+ODquOBoOOBkeOBp+WujOe1kO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj5KUkHlhazlvI/jgYvjgonjgIHpgY7ljrvjga7miJDnuL7vvIjkurrmsJfjgaTjgY3vvInjgajopIfli53jg7vljZjli53jga7miZXmiLvjgpLlj5blvpfjgZfjgabjgIHjgZPjga7nq6/mnKvjgavkv53lrZjjgZfjgb7jgZnjgILlhYPjga7jgqLjg5fjg6rjgoTjg5Djg4Pjgq/jgqLjg4Pjg5fjga/kuI3opoHjgafjgZnjgILmraLjgoHjgabjgoLntprjgY3jgYvjgonlho3plovjgafjgY3jgb7jgZnjgII8L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj7mjqXntprlhYggPGlucHV0IGlkPSJ3dXJsIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMjBweCIgdmFsdWU9Imh0dHBzOi8va2VpYmEtYWktcGF5b3V0cy5odDE5OTUwODIyLndvcmtlcnMuZGV2Ij48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij7mnJ/plpMgPGlucHV0IGlkPSJzc3RhcnQiIHR5cGU9ImRhdGUiIHZhbHVlPSIyMDIzLTAxLTAxIj4g44CcIDxpbnB1dCBpZD0ic2VuZCIgdHlwZT0iZGF0ZSI+PC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+PGJ1dHRvbiBpZD0ic3luY0dvIj7pgY7ljrvmiJDnuL7jgajmiZXmiLvjgpLlj5blvpc8L2J1dHRvbj48YnV0dG9uIGlkPSJzeW5jU3RvcCIgY2xhc3M9InN1YiIgZGlzYWJsZWQ+5YGc5q2iPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9InN5bmNTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWun+ihjDwvZGl2Pgo8ZGl2IGlkPSJkYXRhU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPGRldGFpbHM+PHN1bW1hcnkgY2xhc3M9InNtYWxsIj7jg5Djg4Pjgq/jgqLjg4Pjg5dKU09O77yPQ1NW44GL44KJ6Kqt44G/6L6844KA77yI5Lu75oSP77yJPC9zdW1tYXJ5Pgo8ZGl2IGNsYXNzPSJzbWFsbCI+5YWD44Ki44OX44Oq44Gu44OQ44OD44Kv44Ki44OD44OX44GM44GC44KM44Gw44CB5Y+W5b6X44KS55yB55Wl44Gn44GN44G+44GZ77yI5ZCM44GY5pel44Gv6YeN6KSH44GX44Gm5Y+W44KK6L6844G/44G+44Gb44KT77yJ44CCPC9kaXY+CjxpbnB1dCBpZD0iZmlsZSIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiwuY3N2LGFwcGxpY2F0aW9uL2pzb24sdGV4dC9jc3YiPgo8L2RldGFpbHM+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGgLTEg6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX77yIQ2xvdWRmbGFyZeOBq+S/neWtmO+8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7lj5blvpfjgZfjgZ/miJDnuL7jg7vmiZXmiLvjgpLjgIHjgYLjgarjgZ/jga5DbG91ZGZsYXJl77yIS1bvvInjgavoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZfjgb7jgZnjgII8Yj7jg4fjg7zjgr/jgYzlpInjgo/jgovjgajjgIHntIQz56eS5b6M44Gr5aSJ44KP44Gj44Gf6YOo5YiG44Gg44GR44KS6YCB44KK44G+44GZ44CCPC9iPuODluODqeOCpuOCtuOBruODh+ODvOOCv+OBjOa2iOOBiOOBpuOCguOAgeWQjOOBmOODkeOCueODleODrOODvOOCuuOBp+W+qeWFg+OBp+OBjeOBvuOBme+8iOWIpeOBruerr+acq+OBq+OCguW+qeWFg+OBp+OBjeOBvuOBme+8ieOAguODkeOCueODleODrOODvOOCuuOBneOBruOCguOBruOBr+mAgeS/oeOBl+OBvuOBm+OCk+OAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYmtQYXNzIiB0eXBlPSJwYXNzd29yZCIgcGxhY2Vob2xkZXI9IuODkeOCueODleODrOODvOOCuu+8iDjmloflrZfku6XkuIrvvIkiIGF1dG9jb21wbGV0ZT0ib2ZmIiBzdHlsZT0iZmxleDoxO21pbi13aWR0aDoyMDBweCI+PGJ1dHRvbiBpZD0iYmtTaG93IiBjbGFzcz0ic3ViIj7ooajnpLo8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93IHNtYWxsIj48bGFiZWw+PGlucHV0IGlkPSJia0F1dG8iIHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPiDlpInmm7TjgYzjgYLjgozjgbDoh6rli5Xjgafjg5Djg4Pjgq/jgqLjg4Pjg5fjgZnjgos8L2xhYmVsPjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9ImJrTm93Ij7ku4rjgZnjgZDjg5Djg4Pjgq/jgqLjg4Pjg5c8L2J1dHRvbj48YnV0dG9uIGlkPSJia1Jlc3RvcmUiIGNsYXNzPSJzdWIiPuODkOODg+OCr+OCouODg+ODl+OBi+OCieW+qeWFgzwvYnV0dG9uPjxidXR0b24gaWQ9ImJrRnVsbCIgY2xhc3M9InN1YiI+44GZ44G544Gm5L+d5a2Y44GX55u044GZPC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9ImJrU3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7norroqo3kuK3igKY8L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaAtMiDopIfli53lm57lj47njofjga7mpJzoqLw8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+5Y+W5b6X5riI44G/44Gu5oiQ57i+44Go5omV5oi744Gn44CB5pmC57O75YiX77yI44Gd44Gu5pel44KI44KK5YmN44Gu5oiQ57i+44Gg44GR77yJ44Gu44OQ44OD44Kv44OG44K544OI44KS44GX44G+44GZ44CC56m044K+44O844Oz44Gv5a6f6Zqb44Gu5Lq65rCX44Gn5Yik5a6a44GX44CB5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44Go5Luu5a6a44GX44G+44GZ44CCPC9kaXY+CjxkaXYgY2xhc3M9InJvdyI+6ZaL5aeL5pelIDxpbnB1dCBpZD0iYnRTdGFydCIgdHlwZT0iZGF0ZSIgdmFsdWU9IjIwMjMtMDEtMDEiPjxidXR0b24gaWQ9ImJ0UnVuIj7mpJzoqLzjgpLlrp/ooYw8L2J1dHRvbj48L2Rpdj4KPGRpdiBjbGFzcz0icm93Ij48YnV0dG9uIGlkPSJwYXlFeHAiIGNsYXNzPSJzdWIiPuaJleaIu+OCkuabuOOBjeWHuuOBlzwvYnV0dG9uPjxsYWJlbCBjbGFzcz0ic21hbGwiPuiqreOBv+i+vOOBvyA8aW5wdXQgaWQ9InBheUltcCIgdHlwZT0iZmlsZSIgYWNjZXB0PSIuanNvbiI+PC9sYWJlbD48L2Rpdj4KPGRpdiBpZD0iYnRPdXQiIGNsYXNzPSJzdGF0dXMiPuODh+ODvOOCv+WPluW+l+OBruOBguOBqOOBp+Wun+ihjOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoSDjg6zjg7zjgrnjgpLpgbjjgbY8L2gyPgo8ZGl2IGNsYXNzPSJyb3ciPjxidXR0b24gaWQ9InRhYldvcmtlciIgY2xhc3M9InN1YiI+5Ye66aas6KGo44KS5Y+W5b6XPC9idXR0b24+PGJ1dHRvbiBpZD0idGFiTWFudWFsIiBjbGFzcz0ic3ViIj7miYvlhaXlips8L2J1dHRvbj48YnV0dG9uIGlkPSJ0YWJQYXN0IiBjbGFzcz0ic3ViIj7pgY7ljrvjg6zjg7zjgrnjgafoqabjgZk8L2J1dHRvbj48L2Rpdj4KPGRpdiBpZD0icGFuZVdvcmtlciIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+5pei5a2Y44GuV29ya2Vy44GuIC9yYWNlLWNhcmRzIOOCkuiqreOBv+WPluOCi+OBoOOBkeOBp+OBme+8iOWkieabtOOBl+OBvuOBm+OCk++8ieOAgjwvZGl2PgogPGRpdiBjbGFzcz0icm93Ij48aW5wdXQgaWQ9IndkYXRlIiB0eXBlPSJkYXRlIj48L2Rpdj4KIDxidXR0b24gaWQ9IndnZXQiPumWi+WCrOODu+ODrOODvOOCueOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9Im9kZHNHZXQiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuOCquODg+OCuuOCkuWPluW+lzwvYnV0dG9uPjxidXR0b24gaWQ9IndhbGwiIGNsYXNzPSJzdWIiIGRpc2FibGVkPuWFqOODrOODvOOCueS4gOaLrOino+aekDwvYnV0dG9uPjxkaXYgaWQ9IndzdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuacquWPluW+lzwvZGl2PjxkaXYgaWQ9IndsaXN0Ij48L2Rpdj48ZGl2IGlkPSJhbGxvdXQiPjwvZGl2Pgo8L2Rpdj4KPGRpdiBpZD0icGFuZU1hbnVhbCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiA8ZGl2IGNsYXNzPSJzbWFsbCI+MeihjOOBq+OAjOmmrOeVqiDppqzlkI3jgI3jgILku7vmhI/jgafmnIDlvozjgavljZjli53jgqrjg4PjgrrjgILkvovvvJo8YnI+MSDil4vil4vil4vil4sgMy40PGJyPjIg4paz4paz4paz4pazPC9kaXY+CiA8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0ibWRhdGUiIHR5cGU9ImRhdGUiPjxzZWxlY3QgaWQ9Im1zdXJmIj48b3B0aW9uIHZhbHVlPSIxIj7oip08L29wdGlvbj48b3B0aW9uIHZhbHVlPSIyIj7jg4Djg7zjg4g8L29wdGlvbj48L3NlbGVjdD48aW5wdXQgaWQ9Im1kaXN0IiB0eXBlPSJudW1iZXIiIHN0ZXA9IjEwMCIgdmFsdWU9IjE2MDAiIHN0eWxlPSJ3aWR0aDo5MHB4Ij5tPC9kaXY+CiA8dGV4dGFyZWEgaWQ9Im10ZXh0IiBwbGFjZWhvbGRlcj0iMSDppqzlkI0mIzEwOzIg6aas5ZCNIj48L3RleHRhcmVhPgogPGJ1dHRvbiBpZD0ibWdvIj7jgZPjga7jg6zjg7zjgrnjgpLkvb/jgYY8L2J1dHRvbj4KPC9kaXY+CjxkaXYgaWQ9InBhbmVQYXN0IiBzdHlsZT0iZGlzcGxheTpub25lIj4KIDxkaXYgY2xhc3M9InNtYWxsIj7kv53lrZjmuIjjgb/jga7pgY7ljrvjg6zjg7zjgrnjgpLjgIHjgZ3jga7ml6XjgojjgorliY3jga7jg4fjg7zjgr/jgaDjgZHjgafkuojmg7PjgZfjgb7jgZnjgILlrp/pmpvjga7nnYDpoIbjgpLkuKbjgbnjgabnorroqo3jgafjgY3jgb7jgZnjgII8L2Rpdj4KIDxkaXYgY2xhc3M9InJvdyI+PGlucHV0IGlkPSJwZGF0ZSIgdHlwZT0iZGF0ZSI+PGJ1dHRvbiBpZD0icGdldCI+44Gd44Gu5pel44Gu44Os44O844K55LiA6KanPC9idXR0b24+PC9kaXY+CiA8ZGl2IGlkPSJwc3RhdHVzIiBjbGFzcz0ic3RhdHVzIj7ml6Xku5jjgpLpgbjjgpPjgafjgY/jgaDjgZXjgYTjgII8L2Rpdj48ZGl2IGlkPSJwbGlzdCI+PC9kaXY+CjwvZGl2Pgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KPGgyPuKRoiDnqbTppqzlpb3otbDjgpLop6PmnpA8L2gyPgo8ZGl2IGlkPSJyYWNlbGFiZWwiIGNsYXNzPSJzbWFsbCI+44Os44O844K544KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCPC9kaXY+CjxidXR0b24gaWQ9InJ1biIgZGlzYWJsZWQ+6Kej5p6Q44GZ44KLPC9idXR0b24+CjxkaXYgaWQ9Im91dCIgY2xhc3M9InN0YXR1cyI+5pyq5a6f6KGMPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGjIOOBk+OBruODhOODvOODq+OBq+OBpOOBhOOBpjwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj4KPGI+5aW96LWw546HPC9iPu+8nTPnnYDlhoXjgavlhaXjgovnorrnjofjga7mjqjlrprjgILpgY7ljrvjga7lrp/nuL7jg4fjg7zjgr/jgYvjgonph43jgb/jgpLlrabnv5LjgZfjgZ/jg6Ljg4fjg6vjgafoqIjnrpfjgZfjgb7jgZnvvIjpgJrnrpfjga4z552A5YaF546H44O744Kv44Op44K56KOc5q2j44GX44Gf5oiQ57i+44O755u06L+RM+i1sOODu+acgOe1guedgOmghuODu+WQjOadoeS7tuOBruWun+e4vuODu+mWk+malOODu+W5tOm9ouODu+aYh+e0mumZjee0muODu+WIneOBruiKneODgOabv+OCj+OCiu+8ieOAgjxicj4KPGI+44Kv44Op44K5PC9iPu+8muacquWLneWIqe+8jzHli53vvI8y5Yud77yPM+WLne+8j+OCquODvOODl+ODs+OCkuWMuuWIpeOBl+OAgeS9juOBhOOCr+ODqeOCueOBp+OBruWlvei1sOOBr+WJsuOCiuW8leOBjeOAgemrmOOBhOOCr+ODqeOCueOBp+OBruWHoei1sOOBr+WJsuOCiuW8leOBjeOBvuOBmeOAguWcsOaWueOBruODh+ODvOOCv+OBjOWQq+OBvuOCjOOCi+WgtOWQiOOBr+OAgeOBleOCieOBq+WJsuOCiuW8leOBjeOBvuOBme+8iEpSQeOBruWFrOW8j+OCteOCpOODiOOBq+OBr+WcsOaWueOBruaIkOe4vuOBjOOBquOBhOOBn+OCgeOAgeS4reWkruOBruOBv+OBruWxpeattOOBp+OBme+8ieOAgjxicj4KPGI+MuOBpOOBruODouODvOODiTwvYj7vvJo8YnI+CuODu+OCquODg+OCuuacquWFpeWKm++8mueptOOCvuODvOODs+OCkuOAjOODhOODvOODq+aOqOWumuOBruS6uuawl++8iOmojuaJi+aIkOe4vui+vOOBv++8ieOAjeOBp+WIpOWumuOAguWun+mam+OBruS6uuawl+OBqOOBruebuOmWouOBrzAuNzjjgafjgZnjgII8YnI+CuODu+OCquODg+OCuuWFpeWKm++8iOOBvuOBn+OBr+mBjuWOu+ODrOODvOOCueOBruS6uuawl+mghuS9je+8ie+8mueptOOCvuODvOODs+OCkuWun+mam+OBruS6uuawl+OBp+WIpOWumuOBl+OBvuOBmeOAguacrOadpeOBruS9v+OBhOaWueOBp+OBmeOAguW4guWgtOOBqOOBruW3ruOCguWHuuOBl+OBvuOBmeOBjOOAgeaknOiovOOBp+OBr+W9k+OBn+OCiuOBq+e1kOOBs+S7mOOBi+OBquOBi+OBo+OBn+OBn+OCgeWPguiAg+eoi+W6puOBq+OBl+OBpuOBj+OBoOOBleOBhOOAgjxicj4KPGI+6KGo56S644Gu6Kqt44G/5pa5PC9iPu+8muWlvei1sOeOh+OBr+OAgeOBneOBrummrOOBruOAjOeptOOCvuODvOODs+WGheOBp+OBruWun+e4vuODmeODvOOCueOBrueiuueOh+OAjeOBp+OBmeOAguWxpeattOOBruOBquOBhOmmrOOCguOAgemgreaVsOOBjOWkmuOBkeOCjOOBsOe0hDLlibLjgavjgarjgorjgb7jgZnvvIgxNemgreeri+OBpuOBpzPpoK3jgYwz552A5YaF44Gr5YWl44KL44Gf44KB77yJ44CC6KmV5L6h44Op44Oz44Kv44Gv44CB56m044K+44O844Oz44Gu5bmz5Z2H44Gu5L2V5YCN44GL44Gn5rG644KB44Gm44GE44G+44GZ44CCPGJyPgo8Yj7mpJzoqLzvvIgyMDI05bm05Lul6ZmN44O75a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yJPC9iPu+8mjxicj4K44O744Oi44OH44Or57K+5bqm77yI5a++5pWw5pCN5aSx77yJ77ya5pen44Oi44OH44OrMC40NzEg4oaSIOaWsOODouODh+ODqzAuNDUw77yI5bCP44GV44GE44G744Gp6Imv44GE77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZPjga4z552A5YaF546HIDkuMSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6vjga4x5L2N5YCZ6KOcMTMuMiUg4oaSIOaWsOODouODh+ODqzE2LjUl77yI5LiK5L2NMumgrTE1LjQl77yJ44CCPGJyPgrjg7vjgqrjg4PjgrrmnKrlhaXlipvmmYLvvJrnqbTjgr7jg7zjg7PlhajkvZMgMTEuNSXjgavlr77jgZfjgIHml6fjg6Ljg4fjg6sxOC41JSDihpIg5paw44Oi44OH44OrMjEuMyXvvIjkuIrkvY0y6aCtMTkuNyXvvInjgII8YnI+CuODu+ODqeODs+OCr+OBqOWun+e4vu+8mlPvvJ5B77yeQu+8nkPjga7poIbjgasz552A5YaF546H44GM5LiL44GM44KK44G+44GZ77yI44Kq44OD44K65pyq5YWl5Yqb5pmC77yaMzMl77yPMjQl77yPMjAl77yPMTMl77yJ44CCPGJyPgrjg7s8Yj7opIfli53jga7lm57lj47njofjgYwxMDAl44KS6LaF44GI44KL44Go44Gv44CB44G+44Gg56K66KqN44Gn44GN44Gm44GE44G+44Gb44KT44CCPC9iPuWAmeijnOOBr+W9k+OBn+OCi+eiuueOh+OBjOmrmOOBhOWIhuOAgemFjeW9k+OBjOS9juOCgeOBp+OBmeOAguKRoC0y44Gn5b+F44Ga56K66KqN44GX44Gm44GP44Gg44GV44GE44CCPGJyPgo8Yj7lgJnoo5zjga7mnaHku7Y8L2I+77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuWAmeijnOOBq+OBl+OBvuOBmeOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+Wlvei1sOeOh+OBjOWQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeOBp+OBmeOAguaWsOmmrOaIpuOBquOBqeOBr+WvvuixoeWkluOBq+OBquOCiuOBvuOBmeOAgjxicj4K44Kq44OD44K644O75Lq65rCX44Gv5LqI5ris44Gu5YWl5Yqb44Gr44Gv5L2/44Gj44Gm44GE44G+44Gb44KT77yI5Lq65rCX44Gu5Luj55CG44Oi44OH44Or44Gu5a2m57+S44Op44OZ44Or44Go44CB56m044K+44O844Oz44Gu5Yik5a6a44CB5aaZ5ZGz44Gu5q+U6LyD44Gr44Gu44G/5L2/55So77yJ44CC6KSH5Yud5Zue5Y+O546H44Gv44CB5omV5oi744KS5Y+W5b6X44GX44Gf44GC44Go44Gr4pGgLTLjgafmpJzoqLzjgafjgY3jgb7jgZnjgIIKPC9kaXY+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgo8aDI+4pGkIOmJhOadv+i7uOmmrO+8iOikh+WLneWcj+WGhSDntIQ5NSXvvIk8L2gyPgo8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K644GM5Y+W44KM44Gf44Os44O844K544Gn44CBM+edgOS7peWGheOBq+WFpeOCi+eiuueOh+OBjOalteOCgeOBpumrmOOBhOmmrOOCkuWHuuOBl+OBvuOBmeOAgumBjuWOu+OBruWun+e4vu+8iDIwMjTlubTku6XpmY3vvInjgafjgIHjgIzpiYTmnb/jgI3jga85NiXvvIg5NSXluYUgOTTjgJw5OSXvvInjgIHjgIzmupbpiYTmnb/jgI3jga84OSXjgIHjgIzloIXou7jjgI3jga84NCXjgafjgZfjgZ/jgILopIfli53jga7phY3lvZPjga/kvY7jgYTvvIgxMDDjgJwxMjDlhobliY3lvozvvInjga7jgafjgIE8Yj7jg6/jgqTjg4njg7vppqzpgKPjg7sz6YCj6KSH44Gq44Gp44Gu6Lu4PC9iPuOBqOOBl+OBpuS9v+OBhuaDs+WumuOBp+OBmeOAguOCquODg+OCuuOBjOOBquOBhOWJjeaXpeOBr+OAgeWIpOWumuOBp+OBjeOBvuOBm+OCk+OAgjwvZGl2Pgo8ZGl2IGNsYXNzPSJyb3ciPjxpbnB1dCBpZD0iYWRhdGUiIHR5cGU9ImRhdGUiPjxidXR0b24gaWQ9ImF4aXNHbyI+6YmE5p2/6Lu444Go5rOi5Lmx5bqm44KS6KGo56S6PC9idXR0b24+PC9kaXY+CjxkaXYgaWQ9ImF4aXNTdGF0dXMiIGNsYXNzPSJzdGF0dXMiPuaXpeS7mOOCkumBuOOCk+OBp+aKvOOBl+OBpuOBj+OBoOOBleOBhO+8iOWHuummrOihqOOBqOOCquODg+OCuuOCkuWPluW+l+OBl+OBpuOAgeKRpOKRpeOCkuWQjOaZguOBq+ihqOekuuOBl+OBvuOBme+8ieOAgjwvZGl2Pgo8ZGl2IGlkPSJheGlzT3V0Ij48L2Rpdj4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CjxoMj7ikaUg5YWo44Os44O844K544Gu5rOi5Lmx5bqm77yIU1NT44CcQ++8iTwvaDI+CjxkaXYgY2xhc3M9InNtYWxsIj7jgIwz552A5YaF44Gu5Lq65rCX44Gu5ZCI6KiI44GMMTXku6XkuIrvvJ3kurrmsJfoloTjgYzntaHjgoDjgI3jg6zjg7zjgrnjgavjgarjgovnorrnjofjgafjgIHnrYnntJrjgpLku5jjgZHjgb7jgZnjgILpgY7ljrvjga7lrp/nuL7vvIgyMDI05bm05Lul6ZmN77yJ77yaU1NTIDU344CcNjgl44CBU1MgNTHjgJw2MCXjgIFTIDQz44CcNDYl44CBQSAzNSXjgIFCIDI044CcMjUl44CBQyA444CcOSXvvIjlhajjg6zjg7zjgrnlubPlnYfjga8yOC41Je+8ieOAguOCquODg+OCuuOBjOOBguOCjOOBsOeyvuW6puOBjOS4iuOBjOOCiuOBvuOBmeOAgjxiPuiNkuOCjOOChOOBmeOBleOBruebruWuieOBp+OAgeeptOmmrOOBjOW9k+OBn+OCi+OBi+OBqeOBhuOBi+OBqOOBr+WIpeOBp+OBmeOAgjwvYj48L2Rpdj4KPGRpdiBpZD0idXBzZXRPdXQiIGNsYXNzPSJzdGF0dXMiPuKRpOOBruOAjOmJhOadv+i7uOOBqOazouS5seW6puOCkuihqOekuuOAjeOCkuaKvOOBmeOBqOOAgeOBk+OBk+OBq+WFqOODrOODvOOCueOBruS4gOimp+OBjOWHuuOBvuOBmeOAgjwvZGl2Pgo8L3NlY3Rpb24+CjwvbWFpbj4KPGRpdiBpZD0iYnVzeSI+PGRpdiBpZD0iYnVzeVRleHQiPuWHpueQhuS4reKApjwvZGl2PjwvZGl2Pgo8c2NyaXB0PgoidXNlIHN0cmljdCI7Ci8qIOeptOmmrOWlvei1sOOCqOODs+OCuOODs++8iOWNmOS9k+eJiOODu+ODluODqeOCpuOCti9Ob2Rl5YWx55So77yJ44CC44Kq44OD44K644O75Lq65rCX44Gv44K544Kz44Ki44Gr5L2/55So44GX44Gq44GE44CCICovCmNvbnN0IFVFPSgoKT0+ewogLyog5a6f44OH44O844K/5qSc6Ki844Gn6YCG5Yq55p6c44Gg44Gj44Gf5oiQ5YiG77yI6aiO5omL44O76ZaT6ZqU77yJ44Gv5pei5a6a44GnT0ZGICovCiBjb25zdCBERUZBVUxUPXtqb2NrZXk6ZmFsc2UsbGF5b2ZmOmZhbHNlfTsKIGNvbnN0IGNsYW1wPSh4LGEsYik9Pk1hdGgubWF4KGEsTWF0aC5taW4oYix4KSk7CiBjb25zdCBzaWdtb2lkPXg9PjEvKDErTWF0aC5leHAoLXgpKTsKIGNvbnN0IGxvZ2l0PXA9PntwPWNsYW1wKHAsLjAwMSwuOTk5KTtyZXR1cm4gTWF0aC5sb2cocC8oMS1wKSl9OwogY29uc3Qgbm49cz0+U3RyaW5nKHM/PyIiKS5ub3JtYWxpemUoIk5GS0MiKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1tcc1x1MzAwMF0rL2csIiIpLnJlcGxhY2UoL1vjg7vvvaUu77yOXC3igJDigJHigJLigJPigJTigJUn4oCZYF0vZywiIikucmVwbGFjZSgvW+KYhuKYheKWs+KWsuKXh+KXhl0vZywiIik7CiAvKiDpqI7miYvlkI3vvJrlhYjpoK3jga7mrKflrZfjgqTjg4vjgrfjg6Pjg6vjgpLpmaTjgY3jgIHjg4fjg6Djg7zjg63ihpLjg4fjg6Ag44Gr5o+D44GI44KL77yISlJB44GuIEMu44OH44Og44O844OtIOOBqOmBjuWOu+ODh+ODvOOCv+OBriDvvKPvvI7jg4fjg6Ag44KS5LiA6Ie044GV44Gb44KL77yJICovCiBjb25zdCBqbm49cz0+e2xldCB2PW5uKFN0cmluZyhzPz8iIikucmVwbGFjZSgvXGR7Mn0oPzpcLlxkKT9ccyooPzprZ3zvvYvvvYcpL2dpLCIgIikucmVwbGFjZSgvW++8iChdW17vvIkpXXswLDh9W++8iSldL2csIiAiKS5yZXBsYWNlKC8o5qCX5p2xfOe+jua1pikvZywiICIpKTt2PXYucmVwbGFjZSgvXlthLXpdKD89W+OCoS3jg7bjg7xdKS8sIiIpO3Y9di5yZXBsYWNlKC9e44OH44Og44O844OtLywi44OH44OgIik7cmV0dXJuIHZ9OwogLyog44Kv44Op44K544Gu5q616ZqO77yaMD3kuI3mmI4gLyAtMT3lnLDmlrkgLyAxPeaWsOmmrOODu+acquWLneWIqSAvIDI9MeWLnSAvIDM9MuWLnSAvIDQ9M+WLnSAvIDU944Kq44O844OX44Oz44O76YeN6LOeICovCiBjb25zdCBsZXZlbE9mTGFiZWw9dD0+e2NvbnN0IHM9U3RyaW5nKHR8fCIiKTtpZigv5Zyw5pa5fE5BUi8udGVzdChzKSlyZXR1cm4gLTE7aWYoL+aWsOmmrHzmnKrli53liKkvLnRlc3QocykpcmV0dXJuIDE7aWYoLzHli518NTAw5LiHLy50ZXN0KHMpKXJldHVybiAyO2lmKC8y5YudfDEwMDDkuIcvLnRlc3QocykpcmV0dXJuIDM7aWYoLzPli518MTYwMOS4hy8udGVzdChzKSlyZXR1cm4gNDtpZigv44Kq44O844OX44OzfO+8r++8sHxPUHzjg6rjgrnjg4bjg4Pjg4l86YeN6LOefO+8p3xHWzEyM0ldL2kudGVzdChzKSlyZXR1cm4gNTtyZXR1cm4gMH07CiBjb25zdCBsZXZlbE9mUHJpemU9cD0+e3A9TnVtYmVyKHApO3JldHVybiAhKHA+MCk/MDpwPD03MDA/MTpwPD05MDA/MjpwPD0xMzAwPzM6cDw9MTgwMD80OjV9OwogY29uc3QgaXNKcmFWZW51ZT1jPT4vXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoY3x8IiIpKTsKIGNvbnN0IHN1cmZDb2RlPXM9PntzPVN0cmluZyhzfHwiIik7cmV0dXJuIC/oip18dHVyZi9pLnRlc3Qocyk/MTov44OAfGRpcnQvaS50ZXN0KHMpPzI6L+manHxqdW1wL2kudGVzdChzKT8zOjB9OwogY29uc3QgZG51bT1kPT5OdW1iZXIoU3RyaW5nKGR8fCIiKS5yZXBsYWNlKC9cRC9nLCIiKS5zbGljZSgwLDgpKXx8MDsKIGZ1bmN0aW9uIHBhcnNlRGF0ZShzKXsKICBzPVN0cmluZyhzfHwiIik7bGV0IG09cy5tYXRjaCgvKFxkezR9KVxEezAsNH0oXGR7MSwyfSlcRHswLDR9KFxkezEsMn0pLyk7CiAgaWYoIW0pcmV0dXJuIiI7cmV0dXJuIGAke21bMV19LSR7bVsyXS5wYWRTdGFydCgyLCIwIil9LSR7bVszXS5wYWRTdGFydCgyLCIwIil9YDsKIH0KIGZ1bmN0aW9uIGNzdlJvd3ModGV4dCl7CiAgY29uc3QgbGluZXM9U3RyaW5nKHRleHR8fCIiKS5yZXBsYWNlKC9eXHVGRUZGLywiIikuc3BsaXQoL1xyP1xuLykuZmlsdGVyKHg9PngudHJpbSgpKTsKICBpZighbGluZXMubGVuZ3RoKXJldHVybltdOwogIGNvbnN0IHNwbGl0PWw9Pntjb25zdCBhPVtdO2xldCBjPSIiLHE9ZmFsc2U7Zm9yKGxldCBpPTA7aTxsLmxlbmd0aDtpKyspe2NvbnN0IGNoPWxbaV07CiAgIGlmKGNoPT09JyInKXtpZihxJiZsW2krMV09PT0nIicpe2MrPSciJztpKyt9ZWxzZSBxPSFxfWVsc2UgaWYoY2g9PT0iLCImJiFxKXthLnB1c2goYyk7Yz0iIn1lbHNlIGMrPWNofWEucHVzaChjKTtyZXR1cm4gYX07CiAgY29uc3QgaGVhZD1zcGxpdChsaW5lc1swXSkubWFwKHg9PngudHJpbSgpKTtjb25zdCBvdXQ9W107CiAgZm9yKGxldCBpPTE7aTxsaW5lcy5sZW5ndGg7aSsrKXtjb25zdCBhPXNwbGl0KGxpbmVzW2ldKSxvPXt9O2ZvcihsZXQgaj0wO2o8aGVhZC5sZW5ndGg7aisrKW9baGVhZFtqXV09YVtqXT8/IiI7b3V0LnB1c2gobyl9CiAgcmV0dXJuIG91dDsKIH0KIGNvbnN0IGY9dj0+e2NvbnN0IG49cGFyc2VGbG9hdChTdHJpbmcodj8/IiIpLnJlcGxhY2UoLywvZywiIikpO3JldHVybiBOdW1iZXIuaXNGaW5pdGUobik/bjpudWxsfTsKIC8qIOODkOODg+OCr+OCouODg+ODly9DU1bjga4x6KGM4oaS6Lu96YeP6KGMICovCiBmdW5jdGlvbiB0b1JvdyhvKXsKICBjb25zdCBzYT1TdHJpbmcob1si5oCn6b2iIl18fCIiKTtjb25zdCBhbT1zYS5tYXRjaCgvKFxkKykvKTsKICByZXR1cm57cmFjZUlkOlN0cmluZyhvWyIiXT8/by5yYWNlX2lkPz9vWyJVbm5hbWVkOiAwIl0/PyIiKSxkYXRlOnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKSwKICAgbmFtZTpTdHJpbmcob1si6aas5ZCNIl18fG8uaG9yc2V8fCIiKS50cmltKCksaG9yc2U6bm4ob1si6aas5ZCNIl18fG8uaG9yc2UpLGpvY2tleTpqbm4ob1si6aiO5omLIl18fG8uam9ja2V5KSxqbmFtZTpTdHJpbmcob1si6aiO5omLIl18fG8uam9ja2V5fHwiIikudHJpbSgpLGZpbmlzaDpmKG9bIuedgOmghiJdPz9vLmZpbmlzaCksCiAgIGRpc3Q6ZihvLmNvdXJzZV9sZW4/P29bIui3nemboiJdPz9vLmRpc3RhbmNlKXx8MCxzdXJmOnN1cmZDb2RlKG8ucmFjZV90eXBlfHxvWyLoip3jg4AiXXx8by5zdXJmYWNlKSwKICAgYWdlOmFtP051bWJlcihhbVsxXSk6bnVsbCxudW06ZihvWyLppqznlaoiXSkscG9wOmYob1si5Lq65rCXIl0pLG9kZHM6ZihvWyLljZjli50iXSksCiAgIGx2bDooKCk9Pntjb25zdCBpZD1TdHJpbmcob1siIl0/P28ucmFjZV9pZD8/IiIpO2lmKC9eXGR7MTJ9JC8udGVzdChpZCkmJiFpc0pyYVZlbnVlKGlkLnNsaWNlKDQsNikpKXJldHVybiAtMTtyZXR1cm4gbGV2ZWxPZkxhYmVsKG9bImNsYXNzIl18fG8uY2xzKX0pKCl9OwogfQogLyog5oiQ57i+44K544OI44Ki77yI5pel5LuY5piH6aCG44GrIGFkZCDjgZnjgovvvIkgKi8KIGZ1bmN0aW9uIFN0b3JlKCl7dGhpcy5oPW5ldyBNYXAoKTt0aGlzLmo9bmV3IE1hcCgpfQogU3RvcmUucHJvdG90eXBlLmFkZD1mdW5jdGlvbihyKXsKICBpZihyLmZpbmlzaD09bnVsbHx8IXIuaG9yc2UpcmV0dXJuOwogIGNvbnN0IHQzPXIuZmluaXNoPj0xJiZyLmZpbmlzaDw9Mz8xOjA7CiAgbGV0IGg9dGhpcy5oLmdldChyLmhvcnNlKTtpZighaCl0aGlzLmguc2V0KHIuaG9yc2UsaD17bjowLHRvcDM6MCx3aW46MCxzdW06MCxsYXN0OiIiLHJ1bnM6W10sbHY6e319KTsKICBoLm4rKztoLnRvcDMrPXQzO2lmKHIuZmluaXNoPT09MSloLndpbisrO2guc3VtKz1yLmZpbmlzaDtpZihyLmRhdGU+aC5sYXN0KWgubGFzdD1yLmRhdGU7CiAgY29uc3QgTD1yLmx2bHx8MDsoaC5sdltMXT1oLmx2W0xdfHxbMCwwXSk7aC5sdltMXVswXSsrO2gubHZbTF1bMV0rPXQzOwogIGgucnVucy5wdXNoKFtkbnVtKHIuZGF0ZSksci5maW5pc2gsci5kaXN0LHIuc3VyZixMXSk7aWYoaC5ydW5zLmxlbmd0aD42KXtoLnJ1bnMuc29ydCgoYSxiKT0+YVswXS1iWzBdKTtoLnJ1bnMuc2hpZnQoKX0KICBpZihyLmpvY2tleSl7bGV0IGo9dGhpcy5qLmdldChyLmpvY2tleSk7aWYoIWopdGhpcy5qLnNldChyLmpvY2tleSxqPXtuOjAsdG9wMzowfSk7ai5uKys7ai50b3AzKz10M30KIH07CiAvKiDpqI7miYvvvJrlrozlhajkuIDoh7TihpLvvIjnn63jgYTooajoqJjjgarjgonvvInliY3mlrnkuIDoh7Tjgacx5Lq644Gr57We44KM44KL44Go44GN44Gg44GR5o6h55SoICovCiBTdG9yZS5wcm90b3R5cGUuam9ja2V5PWZ1bmN0aW9uKG5hbWUpewogIGlmKCFuYW1lKXJldHVybiBudWxsOwogIGNvbnN0IGo9dGhpcy5qLmdldChuYW1lKTtpZihqKXJldHVybiBqOwogIGlmKG5hbWUubGVuZ3RoPDJ8fG5hbWUubGVuZ3RoPjQpcmV0dXJuIG51bGw7CiAgaWYoIXRoaXMuX2prfHx0aGlzLl9qa1NpemUhPT10aGlzLmouc2l6ZSl7dGhpcy5fams9Wy4uLnRoaXMuai5rZXlzKCldO3RoaXMuX2prU2l6ZT10aGlzLmouc2l6ZX0KICBjb25zdCBjPXRoaXMuX2prLmZpbHRlcihrPT5rLnN0YXJ0c1dpdGgobmFtZSl8fChuYW1lLmxlbmd0aD49MyYmay5zdGFydHNXaXRoKG5hbWUuc2xpY2UoMCwtMSkpJiZuYW1lLmxlbmd0aDw9ay5sZW5ndGgpKTsKICByZXR1cm4gYy5sZW5ndGg9PT0xP3RoaXMuai5nZXQoY1swXSk6bnVsbDsKIH07CiBjb25zdCBsYXlvZmY9KGxhc3QsdGFyZ2V0KT0+e2lmKCFsYXN0KXJldHVybiAuNTtjb25zdCBhPShuZXcgRGF0ZSh0YXJnZXQpLW5ldyBEYXRlKGxhc3QpKS84NjRlNTsKICByZXR1cm4gYTwyMT8uNzI6YTw2MD8uNjI6YTwxMjA/LjU1OmE8MjQwPy40ODouNDJ9OwogLyogPT09PT0g5a6f57i+44GL44KJ5a2m57+S44GX44Gf44Oi44OH44Or77yI54m55b606YeP4oaSM+edgOWGheeOh++8iSA9PT09PSAqLwogY29uc3QgRk49WyJiaWFzIiwib2Zmc2V0IiwibmxvZyIsIm5vSGlzdCIsImZTIiwiZkMiLCJhdmdGIiwicjNzaGFyZSIsInIzYXZnIiwibGFzdDEiLCJsYXN0QmlnIiwiY29uZERpZmYiLCJmaXJzdFN1cmYiLCJnYXBTaG9ydCIsImdhcExvbmciLCJnYXBWTG9uZyIsImFnZTMiLCJhZ2U0IiwiYWdlNyIsInN0ZXBVcCIsInN0ZXBEb3duIiwid2luUmF0ZSJdOwogY29uc3QgRko9WyJqUmVsIiwiamxvZyIsImpNaXNzIl07CiAvKiDkv4LmlbDjga8gdG9vbHMvZml0X21vZGVsLmpzIOOBp+Wtpue/ku+8iDIwMjDlubTjgJzjga7mmYLns7vliJfjg4fjg7zjgr/vvInjgIJ7fSDjgpLnva7mj5sgKi8KIGNvbnN0IE1PREVMPXsiY29yZSI6WzAuMDUyOTksMC45OTY5NywwLjA0OTUxLC0wLjI0NTQzLC0wLjUyODEyLDAuOTE5NDYsLTAuNTE0NzYsLTAuMzQ3ODYsLTAuNTc5MDQsLTAuNTUxMTgsMC4xNjc3MywxLjExODIsLTAuMzUzMDUsLTAuMTExMjgsLTAuMjI3MjgsLTAuNDAxMjksMC4xMzc3MSwwLjIxNjYyLC0wLjM5NjczLC0wLjM1MzA1LDAuMDA2MTcsLTAuNTk1NjRdLCJmdWxsIjpbMC40MDQzMywxLjM3MDA3LDAuMDYyNTEsLTAuMTIyNzksLTAuNTAyMzIsMC44Mjk3OCwtMC4zOTg5NSwtMC4zMDA3MiwtMC41MTU1OSwtMC41MjUzMiwwLjE1ODMyLDEuMDY2OTUsLTAuMzgzNzcsLTAuMDcyODIsLTAuMjI1NjgsLTAuMzUxLDAuMTUwMjUsMC4yMTI1MywtMC40MTMzNCwtMC4zMjMxOSwwLjAwNzI2LC0wLjkzNzkyLDAuNTM1NTcsMC4wMDM2NSwtMC4yMDYwNV19OwogZnVuY3Rpb24gZmVhdHMocixzdG9yZSxyYWNlLE4sd2l0aEopewogIGNvbnN0IGI9Y2xhbXAoMy9OLC4wOCwuNSksbGI9bG9naXQoYiksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxuPWg/aC5uOjAsTHQ9cmFjZS5sdmx8fDA7CiAgY29uc3QgcFM9KChoP2gudG9wMzowKSszKmIpLyhuKzMpLGZTPWxvZ2l0KHBTKS1sYjsKICAvLyDjgq/jg6njgrnoo5zmraPvvJrkvY7jgYTjgq/jg6njgrnvvIjlnLDmlrnjgpLlkKvjgoDvvInjgafjga7lpb3otbDjga/libLjgorlvJXjgY3jgIHpq5jjgYTjgq/jg6njgrnjgafjga7lh6HotbDjga/libLjgorlvJXjgY8KICBsZXQgZkM9ZlM7CiAgaWYoaCYmTHQ+MCl7bGV0IEg9MCxNPTA7CiAgIGZvcihjb25zdCBrIG9mIE9iamVjdC5rZXlzKGgubHYpKXtjb25zdCBMPU51bWJlcihrKSxbY24sY3RdPWgubHZba107Y29uc3QgZz1MPT09MD8wOihMPDA/LTI6TC1MdCk7CiAgICBIKz1jdCpjbGFtcCgxKy4zKmcsLjQsMS44KTtNKz0oY24tY3QpKmNsYW1wKDEtLjMqZywuNCwxLjgpfQogICBmQz1sb2dpdCgoSCszKmIpLyhIK00rMykpLWxifQogIGNvbnN0IHJ1bnM9aD9oLnJ1bnM6W10scmM9cnVucy5zbGljZSgtMyksbGFzdFI9cnVucy5sZW5ndGg/cnVuc1tydW5zLmxlbmd0aC0xXTpudWxsOwogIGNvbnN0IHIzc2hhcmU9cmMubGVuZ3RoP3JjLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgvcmMubGVuZ3RoOjA7CiAgY29uc3QgcjNhdmc9cmMubGVuZ3RoP2NsYW1wKChyYy5yZWR1Y2UoKGEseCk9PmEreFsxXSwwKS9yYy5sZW5ndGgtNikvNiwtMSwyKTowOwogIGNvbnN0IGxhc3QxPWxhc3RSP2NsYW1wKChsYXN0UlsxXS02KS82LC0xLDIpOjAsbGFzdEJpZz1sYXN0UiYmbGFzdFJbMV0+PTEwPzE6MDsKICBjb25zdCBzYz1yYWNlLnN1cmYsZGlzdD1yYWNlLmRpc3R8fDA7bGV0IGNvbmREaWZmPTAsZmlyc3RTdXJmPTA7CiAgaWYoc2MmJnJ1bnMubGVuZ3RoKXsKICAgY29uc3QgY3I9cnVucy5maWx0ZXIoeD0+eFszXT09PXNjJiYoIWRpc3R8fE1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCkpOwogICBpZihjci5sZW5ndGgpY29uZERpZmY9KGNyLmZpbHRlcih4PT54WzFdPD0zKS5sZW5ndGgrMipwUykvKGNyLmxlbmd0aCsyKS1wUzsKICAgaWYocnVucy5sZW5ndGg+PTMmJiFydW5zLnNvbWUoeD0+eFszXT09PXNjKSYmcnVucy5zb21lKHg9PnhbM10mJnhbM10hPT1zYykpZmlyc3RTdXJmPTF9CiAgbGV0IGdhcD1udWxsO2lmKGgmJmgubGFzdCYmcmFjZS5kYXRlKWdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICBjb25zdCBhPXIuYWdlfHwwOwogIGNvbnN0IHN0ZXBEPWxhc3RSJiZsYXN0Uls0XT4wJiZMdD4wP2NsYW1wKEx0LWxhc3RSWzRdLC0zLDMpOjA7CiAgY29uc3QgeD1bMSxsYixNYXRoLmxvZygxK24pLG49PT0wPzE6MCxmUyxmQyxuP2NsYW1wKChoLnN1bS9uLTYpLzYsLTEsMik6MCxyM3NoYXJlLHIzYXZnLGxhc3QxLGxhc3RCaWcsY29uZERpZmYsZmlyc3RTdXJmLAogICBnYXAhPW51bGwmJmdhcDwyMT8xOjAsZ2FwIT1udWxsJiZnYXA+MTIwPzE6MCxnYXAhPW51bGwmJmdhcD4yNDA/MTowLGE9PT0zPzE6MCxhPT09ND8xOjAsYT49Nz8xOjAsc3RlcEQ+MD9zdGVwRDowLHN0ZXBEPDA/LXN0ZXBEOjAsCiAgIG4/KChoLndpbisuMypiKS8obisxLjUpLWIpOjBdOwogIGlmKHdpdGhKKXtjb25zdCBqPXN0b3JlLmpvY2tleShyLmpvY2tleSk7CiAgIGlmKGomJmoubj49NSl7Y29uc3QgcEo9KGoudG9wMysxNSpiKS8oai5uKzE1KTt4LnB1c2gobG9naXQocEopLWxiLE1hdGgubG9nKDErai5uKSwwKX1lbHNlIHgucHVzaCgwLDAsMSl9CiAgcmV0dXJuIHg7CiB9CiBjb25zdCBkb3Q9KHcseCk9PntsZXQgej0wO2ZvcihsZXQgaT0wO2k8eC5sZW5ndGg7aSsrKXorPSh3W2ldfHwwKSp4W2ldO3JldHVybiB6fTsKIGNvbnN0IG1vZGVsWj0oa2luZCx4KT0+ZG90KE1PREVMW2tpbmRdLHgpOwogLyogMemgreOBrue0oOeCuShsb2dpdCnjgajjgr/jgrDjgIJjb21wIOOBp+aIkOWIhuOCkk9OL09GRuOBp+OBjeOCi++8iOaknOiovOeUqO+8iSAqLwogZnVuY3Rpb24gaG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTixjb21wPXt9KXsKICBjb21wPU9iamVjdC5hc3NpZ24oe30sREVGQVVMVCxjb21wKTtjb25zdCB1c2U9az0+Y29tcFtrXSE9PWZhbHNlJiZjb21wW2tdIT09MDsKICBjb25zdCBiPWNsYW1wKDMvTiwuMSwuNSksaD1zdG9yZS5oLmdldChyLmhvcnNlKSxqPXN0b3JlLmouZ2V0KHIuam9ja2V5KTsKICBjb25zdCBydW5zPWg/aC5ydW5zOltdLG49aD9oLm46MCx0YWdzPVtdO2xldCB6PTAsY29uZj0i5L2OIjsKICBjb25zdCBwSD0oKGg/aC50b3AzOjApKzQqYikvKG4rNCk7eis9bG9naXQocEgpOwogIGlmKG4+PTIpY29uZj1uPj01PyLpq5giOiLkuK0iO2Vsc2UgdGFncy5wdXNoKHt0OiLlsaXmrbTkuI3otrMiLGM6ImcifSk7CiAgaWYobj49Myl7Y29uc3QgdDM9aC50b3AzL24sdz1oLndpbi9uOwogICBpZih0Mz49LjQwJiZ3PD0uMjApdGFncy5wdXNoKHt0OmDlloTmiKblnosgM+edgOWGhSR7TWF0aC5yb3VuZCh0MyoxMDApfSUvJHtufei1sGAsYzoiYiJ9KTsKICAgZWxzZSBpZih0Mz49LjQ1KXRhZ3MucHVzaCh7dDpg5a6J5a6aIDPnnYDlhoUke01hdGgucm91bmQodDMqMTAwKX0lLyR7bn3otbBgLGM6ImIifSk7CiAgIGlmKHVzZSgiYXZnIikmJmguc3VtL248PTUpeis9LjEyfQogIGNvbnN0IHJjPXJ1bnMuc2xpY2UoLTMpOwogIGlmKHVzZSgicmVjZW50IikmJnJjLmxlbmd0aD49Mil7Y29uc3QgYzM9cmMuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxhdmc9cmMucmVkdWNlKChzLHgpPT5zK3hbMV0sMCkvcmMubGVuZ3RoOwogICB6Kz0uMjIqKGMzL3JjLmxlbmd0aC1wSCkqMztpZihjMz49Mil0YWdzLnB1c2goe3Q6YOi/kSR7cmMubGVuZ3Rofei1sOOBpyR7YzN95ZueM+edgOWGhWAsYzoiYiJ9KTsKICAgY29uc3QgbGFzdD1ydW5zW3J1bnMubGVuZ3RoLTFdOwogICBpZihsYXN0JiZsYXN0WzFdPj04JiZuPj00JiZoLnRvcDMvbj49LjM1KXt6Kz0uMTU7dGFncy5wdXNoKHt0OmDliY3otbAke2xhc3RbMV19552A44GL44KJ5be744GN6L+U44GX5L2Z5ZywYCxjOiJvIn0pfQogICBpZihhdmc8PTQmJnJjLmxlbmd0aD49Myl6Kz0uMDh9CiAgY29uc3Qgc2M9cmFjZS5zdXJmLGRpc3Q9cmFjZS5kaXN0fHwwOwogIGlmKHVzZSgiY29uZCIpJiZzYyYmZGlzdCYmcnVucy5sZW5ndGgpewogICBjb25zdCBjcj1ydW5zLmZpbHRlcih4PT54WzNdPT09c2MmJk1hdGguYWJzKHhbMl0tZGlzdCk8PTIwMCk7CiAgIGlmKHJ1bnMubGVuZ3RoPj0zJiYhcnVucy5zb21lKHg9PnhbM109PT1zYykmJnJ1bnMuc29tZSh4PT54WzNdJiZ4WzNdIT09c2MpKXt6LT0uMzU7dGFncy5wdXNoKHt0OmAke3NjPT09MT8i5Yid44Gu6IqdIjoi5Yid44Gu44OA44O844OIIn3vvIjpgY7ljrvotbDjga/liKXppqzloLTvvIlgLGM6Im8ifSl9CiAgIGlmKGNyLmxlbmd0aD49Mil7Y29uc3QgdDM9Y3IuZmlsdGVyKHg9PnhbMV08PTMpLmxlbmd0aCxwYz0odDMrMipwSCkvKGNyLmxlbmd0aCsyKTsKICAgIHorPWNsYW1wKDIqKHBjLXBIKSwtLjUsLjUpO2lmKHQzPj0yKXRhZ3MucHVzaCh7dDpg5ZCM5p2h5Lu244GnJHt0M30vJHtjci5sZW5ndGh95ZueM+edgOWGhWAsYzoiYiJ9KX19CiAgaWYodXNlKCJqb2NrZXkiKSYmaiYmai5uPj01KXtjb25zdCBwSj0oai50b3AzKzE1KmIpLyhqLm4rMTUpLGRqPWNsYW1wKC42Kihsb2dpdChwSiktbG9naXQoYikpLC0uNCwuNSk7CiAgIHorPWRqO2lmKGRqPj0uMjUpdGFncy5wdXNoKHt0OmDpqI7miYvlpb3oqr8gM+edgOWGhSR7TWF0aC5yb3VuZChqLnRvcDMvai5uKjEwMCl9JWAsYzoiYiJ9KX0KICBpZih1c2UoImxheW9mZiIpJiZoJiZoLmxhc3Qpe2NvbnN0IGdhcD1NYXRoLnJvdW5kKChuZXcgRGF0ZShyYWNlLmRhdGUpLW5ldyBEYXRlKGgubGFzdCkpLzg2NGU1KTsKICAgeis9LjYqKGxheW9mZihoLmxhc3QscmFjZS5kYXRlKS0uNSk7aWYoZ2FwPj0xODApdGFncy5wdXNoKHt0OmAke2dhcH3ml6XjgbbjgopgLGM6Im8ifSl9CiAgaWYodXNlKCJhZ2UiKSl7Y29uc3QgYT1yLmFnZXx8NTtpZihhPT09Myl6Kz0uMTA7ZWxzZSBpZihhPT09NCl6Kz0uMDU7ZWxzZSBpZihhPj04KXt6LT0uMTU7dGFncy5wdXNoKHt0OmAke2F95q2zYCxjOiJvIn0pfX0KICByZXR1cm57eix0YWdzLGNvbmYsbn07CiB9CiAvKiAyMDIz5bm05Lul6ZmN44Gu5pmC57O75YiX5qSc6Ki844Gn44GuIOe0oOOBruWlvei1sOeOh+KGkueptOOCvuODvOODs+Wun+e4vu+8iOW5s+Wdh3AsIOWun+e4vu+8iSAqLwogY29uc3QgQ0FMPVtbMCwwLjAxXSxbMC4wMjIsMC4wMTddLFswLjA0NiwwLjAyMl0sWzAuMDc1LDAuMDQ2XSxbMC4xMDUsMC4wNjhdLFswLjEzNSwwLjA4Ml0sWzAuMTY1LDAuMDk4XSxbMC4xOTMsMC4xMDNdLFswLjIyNCwwLjEzOF0sWzAuMjU5LDAuMTYxXSxbMC4zMDIsMC4xODddLFswLjM1OCwwLjIxMV0sWzAuNDU0LDAuMjI5XV07CiAvKiDjgqrjg4PjgrrjgarjgZfjg6Ljg7zjg4nvvIjkurrmsJfjga7ku6PnkIbvvJ3pqI7miYvovrzjgb/jga7lrabnv5Ljg6Ljg4fjg6vjga7poIbkvY3jgafnqbTjgr7jg7zjg7PjgpLliKTlrprvvInjga7oo5zmraPooajjgIIyMDI05bm05Lul6ZmN44Gu5pyq5a2m57+S5pyf6ZaT44Gn5L2c5oiQICovCiBjb25zdCBDQUxfUFJPWFk9W1swLDAuMDEzXSxbMC4wMjIsMC4wMjFdLFswLjA0NiwwLjAyOF0sWzAuMDc1LDAuMDU2XSxbMC4xMDUsMC4wODZdLFswLjEzNSwwLjExMV0sWzAuMTY1LDAuMTM0XSxbMC4xOTMsMC4xNDZdLFswLjIyNCwwLjIwMV0sWzAuMjU5LDAuMjE5XSxbMC4zMDEsMC4yNjFdLFswLjM1NSwwLjI5Nl0sWzAuNDM5LDAuMzY3XV07CiBmdW5jdGlvbiBpbnRlcnAoVCxwKXtmb3IobGV0IGk9MTtpPFQubGVuZ3RoO2krKylpZihwPD1UW2ldWzBdKXtjb25zdFthLGJdPVRbaS0xXSxbYyxkXT1UW2ldO3JldHVybiBiKyhkLWIpKihwLWEpLyhjLWEpfXJldHVybiBUW1QubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gY2FsaWJGb3IocCxtb2RlKXtyZXR1cm4gbW9kZT09PSJvZGRzIj9pbnRlcnAoQ0FMLHApOmludGVycChDQUxfUFJPWFkscCl9CiBmdW5jdGlvbiBjYWxpYihwKXtmb3IobGV0IGk9MTtpPENBTC5sZW5ndGg7aSsrKWlmKHA8PUNBTFtpXVswXSl7Y29uc3RbYSxiXT1DQUxbaS0xXSxbYyxkXT1DQUxbaV07cmV0dXJuIGIrKGQtYikqKHAtYSkvKGMtYSl9cmV0dXJuIENBTFtDQUwubGVuZ3RoLTFdWzFdfQogZnVuY3Rpb24gbm9ybWFsaXplVG9wMyh6cyx0b3RhbCl7bGV0IGxvPS04LGhpPTg7CiAgZm9yKGxldCBpPTA7aTw2MDtpKyspe2NvbnN0IGM9KGxvK2hpKS8yLHM9enMucmVkdWNlKChhLHopPT5hK3NpZ21vaWQoeitjKSwwKTtpZihzPnRvdGFsKWhpPWM7ZWxzZSBsbz1jfQogIGNvbnN0IGM9KGxvK2hpKS8yO3JldHVybiB6cy5tYXAoej0+c2lnbW9pZCh6K2MpKX0KIC8qIEhhcnZpbGxl5rOV44Gn5Yud546H4oaSM+edgOWGheeOhyAqLwogZnVuY3Rpb24gdG9wM0Zyb21XaW4ocHcpe2NvbnN0IFQ9cHcucmVkdWNlKChhLGIpPT5hK2IsMCkscD1wdy5tYXAoeD0+eC9UKSxuPXAubGVuZ3RoLG91dD1uZXcgQXJyYXkobikuZmlsbCgwKTsKICBmb3IobGV0IGk9MDtpPG47aSsrKXtsZXQgcz1wW2ldOwogICBmb3IobGV0IGo9MDtqPG47aisrKWlmKGohPT1pKXtzKz1wW2pdKnBbaV0vKDEtcFtqXSk7CiAgICBmb3IobGV0IGs9MDtrPG47aysrKWlmKGshPT1pJiZrIT09ailzKz1wW2pdKnBba10vKDEtcFtqXSkqcFtpXS8oMS1wW2pdLXBba10pfQogICBvdXRbaV09c31yZXR1cm4gb3V0fQogLyog44Os44O844K56Kej5p6Q44CCb2RkcyDjga/ku7vmhI/vvIjlhajpoK3liIbvvInjgIIgKi8KIGNvbnN0IExWTj1bIuS4jeaYjiIsIuacquWLneWIqSIsIjHli50iLCIy5YudIiwiM+WLnSIsIk9QIl07CiBmdW5jdGlvbiBleHRyYVRhZ3ModGFncyxyLHN0b3JlLHJhY2UpewogIGNvbnN0IHQ9dGFncy5zbGljZSgpLGg9c3RvcmUuaC5nZXQoci5ob3JzZSksTHQ9cmFjZS5sdmx8fDA7CiAgaWYoaCl7Y29uc3QgbGFzdD1oLnJ1bnMubGVuZ3RoP2gucnVuc1toLnJ1bnMubGVuZ3RoLTFdOm51bGw7CiAgIGlmKGxhc3QmJmxhc3RbNF0+MCYmTHQ+MCYmbGFzdFs0XSE9PUx0KXQudW5zaGlmdChsYXN0WzRdPEx0P3t0OmDmmIfntJrvvIgke0xWTltsYXN0WzRdXX3ihpIke0xWTltMdF1977yJYCxjOiJvIn06e3Q6YOmZjee0mu+8iCR7TFZOW2xhc3RbNF1dfeKGkiR7TFZOW0x0XX3vvIlgLGM6ImIifSk7CiAgIGlmKGgubHYmJmgubHZbLTFdKXQucHVzaCh7dDoi5Zyw5pa544Gn44Gu5Ye66LWw44GC44KK77yI5Ymy5byV6KmV5L6h77yJIixjOiJnIn0pfQogIHJldHVybiB0fQogLyog56m06aas5YCZ6KOc77ya5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBoOOBkeOCkuOAgeWlvei1sOeOh+OBrumrmOOBhOmghuOBqyBrIOmgreOAguWxpeattOOBruS5j+OBl+OBhOmmrOOBr+WQjOeCueOBq+OBquOCiuOChOOBmeOBj+OAgemghuS9jeOBq+aEj+WRs+OBjOOBquOBhOOBn+OCgeWvvuixoeWkliAqLwogZnVuY3Rpb24gcGljayhyZXMsayl7cmV0dXJuIHJlcy5maWx0ZXIoeD0+eC5ob2xlJiZ4Lm4+PTMpLnNvcnQoKGEsYik9PmIucC1hLnApLnNsaWNlKDAsayl9CiBmdW5jdGlvbiBhbmFseXplKHJhY2Usc3RvcmUsb2Rkcyxjb21wLHBvcEFycil7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aDsKICBjb25zdCBzYz1SLm1hcChyPT5ob3JzZVNjb3JlKHIsc3RvcmUscmFjZSxOLGNvbXApKTsKICBjb25zdCB6Yz1NT0RFTC5jb3JlP1IubWFwKHI9Pm1vZGVsWigiY29yZSIsZmVhdHMocixzdG9yZSxyYWNlLE4sZmFsc2UpKSk6c2MubWFwKHg9Pngueik7CiAgY29uc3QgcD1ub3JtYWxpemVUb3AzKHpjLE1hdGgubWluKDMsTikpOwogIGxldCBta3Q9bnVsbCxwb3A9bnVsbCxtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpe21rdD10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTtwb3A9b2Rkcy5tYXAobz0+MStvZGRzLmZpbHRlcih4PT54PG8pLmxlbmd0aCk7bW9kZT0ib2RkcyJ9CiAgZWxzZSBpZihwb3BBcnImJnBvcEFyci5sZW5ndGg9PT1OJiZwb3BBcnIuZXZlcnkoeD0+eD4wKSl7cG9wPXBvcEFyci5zbGljZSgpO21vZGU9Im9kZHMifSAvLyDlrp/pmpvjga7kurrmsJfpoIbkvY3jgaDjgZHliIbjgYvjgovjgajjgY3vvIjntZDmnpzjg5rjg7zjgrjnlLHmnaXvvIkKICBlbHNleyAvLyDjgqrjg4PjgrrjgoLkurrmsJfjgoLjgarjgYTjgajjgY3vvJrpqI7miYvmiJDnuL7jgb7jgaflkKvjgoHjgZ/jgrnjgrPjgqLjga7poIbkvY3jgpLjgIzkurrmsJfjga7ku6PnkIbjgI3jgavjgZnjgovvvIjlrp/pmpvjga7kurrmsJfjgajjga7nm7jplqIgMC41NeKGkjAuNjfvvIkKICAgY29uc3QgcHg9TU9ERUwuZnVsbD9SLm1hcChyPT5tb2RlbFooImZ1bGwiLGZlYXRzKHIsc3RvcmUscmFjZSxOLHRydWUpKSk6Ui5tYXAocj0+aG9yc2VTY29yZShyLHN0b3JlLHJhY2UsTix7am9ja2V5OnRydWUsbGF5b2ZmOmZhbHNlfSkueik7cG9wPXB4Lm1hcCh2PT4xK3B4LmZpbHRlcih5PT55PnYpLmxlbmd0aCl9CiAgY29uc3QgcmFuaz1wLm1hcCh2PT4xK3AuZmlsdGVyKHg9Png+dikubGVuZ3RoKTsKICBjb25zdCBjdXQ9TWF0aC5tYXgoNSxNYXRoLmNlaWwoTiouNCkpOwogIHJldHVybiBSLm1hcCgocixpKT0+KHtpLG5vOnIubnVtfHxpKzEsbmFtZTpyLm5hbWV8fHIuaG9yc2UscDpwW2ldLHBjOmNhbGliRm9yKHBbaV0sbW9kZSksbW9kZSwKICAgam46KHN0b3JlLmpvY2tleShyLmpvY2tleSl8fHtuOjB9KS5uLHJhbms6cmFua1tpXSxwb3A6cG9wW2ldLGJhc2U6TWF0aC5taW4oLjUsMy9OKSwKICAgY2FyZWVyOigoKT0+e2NvbnN0IGg9c3RvcmUuaC5nZXQoci5ob3JzZSk7cmV0dXJuIGg/e246aC5uLHQzOmgudG9wMyx3aW46aC53aW59Om51bGx9KSgpLAogICByZWNlbnQ6KCgpPT57Y29uc3QgaD1zdG9yZS5oLmdldChyLmhvcnNlKTtyZXR1cm4gaD9oLnJ1bnMubWFwKHg9PnhbMV0pOltdfSkoKSwKICAgam5hbWU6ci5qbmFtZXx8IiIsanN0YXQ6KCgpPT57Y29uc3Qgaj1zdG9yZS5qb2NrZXkoci5qb2NrZXkpO3JldHVybiBqJiZqLm4+PTE/e246ai5uLHJhdGU6ai50b3AzL2oubn06bnVsbH0pKCksCiAgIGhvbGU6Tj49NiYmcG9wW2ldPj1jdXQsbWt0Om1rdD9ta3RbaV06bnVsbCx2YWx1ZTpta3Q/Y2FsaWJGb3IocFtpXSwib2RkcyIpL21rdFtpXTpudWxsLAogICB0YWdzOmV4dHJhVGFncyhzY1tpXS50YWdzLHIsc3RvcmUscmFjZSksY29uZjpzY1tpXS5jb25mLG46c2NbaV0ubixjdXR9KSk7CiB9CgogLyogPT09PT0g6YmE5p2/6Lu46aas44O75rOi5Lmx5bqm77yI56m06aas5LqI5oOz44Go44Gv5Yil44Gu6KiI566X44CC5L+C5pWw44GvIHRvb2xzL2F4aXNfdXBzZXRfc3R1ZHkuanMg44Gn5a2m57+S44CBMjAyNOW5tOS7pemZjeOBruacquWtpue/kuacn+mWk+OBp+aknOiovO+8iSA9PT09PSAqLwogY29uc3QgQVhJUz17IndQIjpbMC4wNTE5MywxLjAxNDgzLDAuMDUxNDgsLTAuMjA2NzYsLTAuNTMyMTYsMC45MTQzNywtMC40ODQ2NCwtMC4zMjExNSwtMC41NjgwMiwtMC41NTEzNSwwLjE3MzQ1LDEuMDk3NCwtMC4yODQwNywtMC4xMDM5NywtMC4yMTYxNywtMC4zNDY2OCwwLjE1OTEzLDAuMjIxOTYsLTAuMzg3MzIsLTAuMzQ2NTgsMC4wMDM3LC0wLjU2NjQ2XSwid08iOlswLjU0MjU5LDAuMTU2NjEsMC4wNTQxNCwtMC4wNDM3MSwtMC4xNDUyNCwwLjEzMTcxLC0wLjE0MTc4LC0wLjE2MjYzLDAuMDUzMTYsLTAuMDIwOTcsMC4wMDM5LC0wLjI5ODY1LC0wLjMyMzIxLC0wLjAxMzY1LC0wLjA5NTE5LC0wLjA3ODE4LDAuMDAwNiwtMC4wMjI5MSwtMC4xMTIxMywwLjAxNzgxLC0wLjA0NzQ1LC0wLjEwODUyLDAuMjU3MjEsMC42MzA3MV0sInVwc2V0Ijp7InRociI6MTUsIm1vZGVscyI6eyJwcm94eSI6WzIuMjQ1NTksMC42Mzg0MSwtMC4wNzA4LC0wLjA4MTYxLC0wLjA3NzQzLDAuMDkxMzcsMC4xMzg0NywwLjAwMjc5LC0wLjM4OTE5LC0wLjY0MjE3LC0wLjU1MzgxLC0wLjAxODM3LC0wLjQ0MzE3LC0wLjc2ODI1LC0wLjUyMzkzLC0yLjczNTYxLC0wLjE0OTA5LDAuMTE0NzddLCJvZGRzIjpbLTAuNzIzOTYsMC40MjgwOCwtMC4wNzQ5OSwtMC4wNjE1NCwtMC4wMDY3NSwwLjA3MjQzLDAuMDcwODUsLTAuMDQ5NzQsLTAuMTU1MjgsLTAuMzI1MTYsLTAuNDE4MjYsLTAuMzEzNTEsMC4yMDc1NywtMC4yMzksLTAuMjc5MDEsLTEuODIxMDgsLTAuMDA4NTIsMC4wODM5OSwwLjE1MDI0LDAuMzUyNDIsLTIuMDM4MzksMi44NTY2OCwwLjIyOTI5LDAuNzIwODQsLTEuOTc3OTddfSwiZ3JhZGVzIjp7InByb3h5Ijp7ImN1dHMiOltbIlNTUyIsMC41NTAzN10sWyJTUyIsMC40ODU1XSxbIlMiLDAuNDA0MjRdLFsiQSIsMC4yOTg4XSxbIkIiLDAuMTg5NTddLFsiQyIsMC4wMDYyOV1dLCJyYXRlcyI6eyJTU1MiOjAuNTc0LCJTUyI6MC41MDksIlMiOjAuNDMzLCJBIjowLjM0NywiQiI6MC4yNDQsIkMiOjAuMDg5fSwiYXZnUyI6eyJTU1MiOjE3LjIsIlNTIjoxNS4zLCJTIjoxNC4yLCJBIjoxMy4xLCJCIjoxMS44LCJDIjo5Ljh9fSwib2RkcyI6eyJjdXRzIjpbWyJTU1MiLDAuNjA5NjhdLFsiU1MiLDAuNTE1OTVdLFsiUyIsMC40MDg1NF0sWyJBIiwwLjI4NzY3XSxbIkIiLDAuMTczNTldLFsiQyIsMC4wMDc2OF1dLCJyYXRlcyI6eyJTU1MiOjAuNjc5LCJTUyI6MC41OTgsIlMiOjAuNDU1LCJBIjowLjM1MiwiQiI6MC4yNDYsIkMiOjAuMDc5fSwiYXZnUyI6eyJTU1MiOjE4LjUsIlNTIjoxNi40LCJTIjoxNC41LCJBIjoxMy4zLCJCIjoxMS44LCJDIjo5LjZ9fX19LCJiYW5kcyI6eyLpiYTmnb8iOnsibG8iOjAuOTIsImhpIjoxLCJuIjoxNjYsInJhdGUiOjAuOTYzOSwibG85NSI6MC45MzU1LCJuMiI6ODcsInJhdGUyIjowLjk3NywicGVyRGF5IjowLjYyfSwi5rqW6YmE5p2/Ijp7ImxvIjowLjg4LCJoaSI6MC45MiwibiI6Mjc5LCJyYXRlIjowLjg4NTMsImxvOTUiOjAuODQ3OSwibjIiOjEzOSwicmF0ZTIiOjAuODk5MywicGVyRGF5IjoxLjA0fSwi5aCF6Lu4Ijp7ImxvIjowLjg0LCJoaSI6MC44OCwibiI6NDc0LCJyYXRlIjowLjg0MTgsImxvOTUiOjAuODA4OSwibjIiOjIyNiwicmF0ZTIiOjAuODQwNywicGVyRGF5IjoxLjc4fX19OwogZnVuY3Rpb24gYXhpc1Byb2JzKHJhY2Usc3RvcmUsb2Rkcyl7CiAgY29uc3QgUj1yYWNlLnJ1bm5lcnMsTj1SLmxlbmd0aCx4Yz1SLm1hcChyPT5mZWF0cyhyLHN0b3JlLHJhY2UsTixmYWxzZSkpOwogIGNvbnN0IHBQPW5vcm1hbGl6ZVRvcDMoeGMubWFwKHg9PmRvdChBWElTLndQLHgpKSxNYXRoLm1pbigzLE4pKTsKICBsZXQgcE89bnVsbDsKICBpZihvZGRzJiZvZGRzLmxlbmd0aD09PU4mJm9kZHMuZXZlcnkobz0+bz4xKSl7CiAgIGNvbnN0IGludj1vZGRzLm1hcChvPT4xL28pLFQ9aW52LnJlZHVjZSgoYSxiKT0+YStiLDApLHB3PWludi5tYXAodj0+di9UKSxtMz10b3AzRnJvbVdpbihvZGRzLm1hcChvPT4xL28pKTsKICAgcE89bm9ybWFsaXplVG9wMyh4Yy5tYXAoKHgsaSk9PmRvdChBWElTLndPLFsuLi54LE1hdGgubG9nKHB3W2ldKSxsb2dpdChNYXRoLm1pbiguOTgsbTNbaV0pKV0pKSxNYXRoLm1pbigzLE4pKX0KICByZXR1cm57cFAscE8seGN9fQogLyog6YmE5p2/6Lu46aas77ya44Kq44OD44K644GM44GC44KL44Os44O844K544Gg44GR44CC5LqI5ris56K6546H44Gu5Yy65YiG44GU44Go44Gr44CB6YGO5Y6744Gu5a6f6Zqb44GuM+edgOWGheeOh+OCkua3u+OBiOOCiyAqLwogZnVuY3Rpb24gYXhpc1BpY2tzKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpO2lmKCFhcC5wTylyZXR1cm4gbnVsbDsKICBjb25zdCBvdXQ9W107YXAucE8uZm9yRWFjaCgocCxpKT0+ewogICBmb3IoY29uc3QgayBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBiPUFYSVMuYmFuZHNba107aWYocD49Yi5sbyYmcDwoaz09PSLpiYTmnb8iPzEuMDE6Yi5oaSkpe291dC5wdXNoKHtpLHAsdGllcjprLHJhdGU6Yi5yYXRlLGxvOTU6Yi5sbzk1LG46Yi5ufSk7YnJlYWt9fX0pOwogIHJldHVybiBvdXQuc29ydCgoYSxiKT0+Yi5wLWEucCl9CiAvKiDms6LkubHluqbvvJpTU1PjgJxD44CCM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44Gr44Gq44KL56K6546H44Gn562J57Sa44Gl44GRICovCiBmdW5jdGlvbiB1cHNldEdyYWRlKHJhY2Usc3RvcmUsb2RkcyxhcCl7CiAgYXA9YXB8fGF4aXNQcm9icyhyYWNlLHN0b3JlLG9kZHMpOwogIGNvbnN0IFI9cmFjZS5ydW5uZXJzLE49Ui5sZW5ndGgscHM9YXAucFAuc2xpY2UoKS5zb3J0KChhLGIpPT5iLWEpOwogIGNvbnN0IG5zPVIubWFwKHI9Pntjb25zdCBoPXN0b3JlLmguZ2V0KHIuaG9yc2UpO3JldHVybiBoP2gubjowfSksbW9udGg9TnVtYmVyKFN0cmluZyhyYWNlLmRhdGUpLnNsaWNlKDUsNykpfHwwLEw9cmFjZS5sdmx8fDA7CiAgY29uc3QgZj1bMSxOLzE2LEw9PT0xPzE6MCxMPT09Mj8xOjAsTD09PTM/MTowLEw9PT00PzE6MCxMPT09NT8xOjAscmFjZS5zdXJmPT09MT8xOjAsKHJhY2UuZGlzdHx8MCkvMjAwMCwKICAgbnMuZmlsdGVyKG49Pm49PT0wKS5sZW5ndGgvTixucy5maWx0ZXIobj0+bjwzKS5sZW5ndGgvTixucy5yZWR1Y2UoKGEsbik9PmErTWF0aC5sb2coMStuKSwwKS9OLzMsCiAgIHBzWzBdLHBzWzFdLHBzWzJdLHBzLnJlZHVjZSgoYSxwKT0+YStwKnAsMCkscHMuZmlsdGVyKHA9PnA+LjUpLmxlbmd0aC8zLG1vbnRoPj02JiZtb250aDw9OT8xOjBdOwogIGxldCBtb2RlPSJwcm94eSI7CiAgaWYob2RkcyYmb2Rkcy5sZW5ndGg9PT1OJiZvZGRzLmV2ZXJ5KG89Pm8+MSkpewogICBjb25zdCBpbnY9b2Rkcy5tYXAobz0+MS9vKSxUPWludi5yZWR1Y2UoKGEsYik9PmErYiwwKSxwdz1pbnYubWFwKHY9PnYvVCkuc29ydCgoYSxiKT0+Yi1hKSxvZD1vZGRzLnNsaWNlKCkuc29ydCgoYSxiKT0+YS1iKTsKICAgY29uc3QgZW50PS1wdy5yZWR1Y2UoKGEscCk9PmErcCpNYXRoLmxvZyhwKSwwKS9NYXRoLmxvZyhOKTsKICAgZi5wdXNoKHB3WzBdLHB3WzFdLHB3WzBdK3B3WzFdK3B3WzJdLGVudCxNYXRoLmxvZyhvZFswXSksTWF0aC5sb2cob2RbMV0pLG9kLmZpbHRlcihvPT5vPDEwKS5sZW5ndGgvTik7bW9kZT0ib2RkcyJ9CiAgY29uc3QgcD1zaWdtb2lkKGRvdChBWElTLnVwc2V0Lm1vZGVsc1ttb2RlXSxmKSksRz1BWElTLnVwc2V0LmdyYWRlc1ttb2RlXTsKICBsZXQgZ3JhZGU9IkMiO2Zvcihjb25zdCBbZyxjXSBvZiBHLmN1dHMpe2lmKHA+PWMpe2dyYWRlPWc7YnJlYWt9fQogIHJldHVybntncmFkZSxwLG1vZGUscmF0ZTpHLnJhdGVzW2dyYWRlXSxhdmdTOkcuYXZnU1tncmFkZV19fQoKIC8qIOaJleaIu+OBpOOBjeaZguezu+WIl+ODkOODg+OCr+ODhuOCueODiOOAgnJhY2VzIOOBr+aXpeS7mOaYh+mghiBbe2lkLGRhdGUscm93c31d44CBcGF5QnlJZCDjga8ge3JhY2VJZDp7cGxhY2U6W3tudW1iZXIseWVufV19feOAggogICAg56m044K+44O844Oz44Gv5a6f44Kq44OD44K66aCG5L2N44Gn5a6a576p77yI44OE44O844Or44Gu44Kq44OD44K65YWl5Yqb44Oi44O844OJ44Go5ZCM44GY54q25rOB77yJ44CC5ZCE44Os44O844K5MTAw5YaG44Ga44Gk6LO85YWl44CCICovCiBmdW5jdGlvbiBiYWNrdGVzdChyYWNlcyxwYXlCeUlkLG9wdHMpewogIG9wdHM9b3B0c3x8e307Y29uc3QgU1RBUlQ9b3B0cy5zdGFydHx8IiIsU1BMSVQ9b3B0cy5zcGxpdHx8IiIsT09TPW9wdHMub29zfHwiIixQUk9YWT0hIW9wdHMucHJveHk7CiAgY29uc3QgbmFtZXM9WyJ0b3AxIiwidG9wMiIsInRvcDMiLCJhbGxIb2xlIiwidmFsdWUiLCJheGlzIl0scGVyPVsiYWxsIiwiQSIsIkIiLCJDIl07CiAgY29uc3QgUz17fTtmb3IoY29uc3QgbiBvZiBuYW1lcyl7U1tuXT17fTtmb3IoY29uc3QgcCBvZiBwZXIpU1tuXVtwXT17YmV0czowLGhpdHM6MCxyZXQ6MCxzcTowfX0KICBjb25zdCBTRUc9e307ICAgLy8gMeS9jeWAmeijnOOBruadoeS7tuWIpe+8iOWFqOacn+mWk++8j+WJjeWNiu+8j+W+jOWNiu+8iQogIGNvbnN0IHN0b3JlPW5ldyBTdG9yZSgpO2xldCB1c2VkPTA7CiAgY29uc3QgYWRkPShuLHAsaGl0LHllbik9Pntjb25zdCB4PVNbbl1bcF07eC5iZXRzKys7aWYoaGl0KXguaGl0cysrO3gucmV0Kz15ZW47eC5zcSs9eWVuKnllbn07CiAgY29uc3QgYWRkU2VnPShsYWJlbCxwLHllbik9Pntjb25zdCBnPVNFR1tsYWJlbF09U0VHW2xhYmVsXXx8e2FsbDp7bjowLGg6MCxyOjAscTowfSxBOntuOjAsaDowLHI6MCxxOjB9LEI6e246MCxoOjAscjowLHE6MH19O2Zvcihjb25zdCBrIG9mIFsiYWxsIixwXSl7Y29uc3QgeD1nW2tdO3gubisrO2lmKHllbj4wKXguaCsrO3gucis9eWVuO3gucSs9eWVuKnllbn19OwogIGNvbnN0IEFWPVBST1hZPy4xMTU6LjA5MTsKICBmb3IoY29uc3QgcmMgb2YgcmFjZXMpewogICAvLyDmiZXmiLvjga5JROOBr+OAjOaXpeS7mC3plovlgqzloLQtUueVquWPt+OAjeOAguODkOODg+OCr+OCouODg+ODl+OBrjEy5qGBSUTjgajjgoLjgIHlkIzjgZjlvaLlvI/jga5JROOBqOOCgue1kOOBs+S7mOOBkeOCiwogICBjb25zdCB2T2Y9L15cZHsxMn0kLy50ZXN0KHJjLmlkKT9yYy5pZC5zbGljZSg0LDYpOlN0cmluZyhyYy5pZCkuc3BsaXQoIi0iKVszXXx8IiIsck9mPU51bWJlcigvXlxkezEyfSQvLnRlc3QocmMuaWQpP3JjLmlkLnNsaWNlKDEwLDEyKTpTdHJpbmcocmMuaWQpLnNwbGl0KCItIilbNF18fDApOwogICBjb25zdCBwYXk9cGF5QnlJZFtyYy5pZF18fHBheUJ5SWRbYCR7cmMuZGF0ZX0tJHt2T2Z9LSR7U3RyaW5nKHJPZikucGFkU3RhcnQoMiwiMCIpfWBdOwogICBpZihwYXkmJnBheS5wbGFjZSYmcGF5LnBsYWNlLmxlbmd0aCYmcmMuZGF0ZT49U1RBUlQpewogICAgLy8g5Ye66LWw6KGo44Go5ZCM44GY6aas55Wq6aCG44Gr5Lim44G544KL77yI5ZCM54K544Gu44Go44GN44Gu5Lim44Gz44Gn552A6aCG44GM5ryP44KM44Gq44GE44KI44GG44Gr77yJCiAgICBjb25zdCBSPXJjLnJvd3MuZmlsdGVyKHI9PnIuaG9yc2UmJnIuZmluaXNoIT1udWxsKS5zb3J0KChhLGIpPT4oYS5udW18fDApLShiLm51bXx8MCkpOwogICAgY29uc3QgaGFzT2Rkcz1SLmxlbmd0aD49NiYmUi5ldmVyeShyPT5yLm9kZHM+MSksaGFzUG9wPVIubGVuZ3RoPj02JiZSLmV2ZXJ5KHI9PnIucG9wPjApOwogICAgaWYoUFJPWFk/Ui5sZW5ndGg+PTY6KGhhc09kZHN8fGhhc1BvcCkpewogICAgIGNvbnN0IHJhY2U9e2RhdGU6cmMuZGF0ZSxzdXJmOlJbMF0uc3VyZixkaXN0OlJbMF0uZGlzdCxsdmw6UlswXS5sdmx8fDAscnVubmVyczpSfTsKICAgICBjb25zdCByZXM9UFJPWFk/YW5hbHl6ZShyYWNlLHN0b3JlLG51bGwpOihoYXNPZGRzP2FuYWx5emUocmFjZSxzdG9yZSxSLm1hcChyPT5yLm9kZHMpKTphbmFseXplKHJhY2Usc3RvcmUsbnVsbCxudWxsLFIubWFwKHI9PnIucG9wKSkpOwogICAgIGNvbnN0IHllbj1uZXcgTWFwKHBheS5wbGFjZS5tYXAoeD0+W3gubnVtYmVyLHgueWVuXSkpOwogICAgIGNvbnN0IGhvbGU9cmVzLmZpbHRlcih4PT54LmhvbGUpLnNvcnQoKGEsYik9PmIucC1hLnApOwogICAgIGlmKGhvbGUubGVuZ3RoKXsKICAgICAgdXNlZCsrO2NvbnN0IHByPVNQTElUPyhyYy5kYXRlPFNQTElUPyJBIjoiQiIpOiJBIjsKICAgICAgY29uc3QgYnV5PShuLGxpc3QpPT57Zm9yKGNvbnN0IHggb2YgbGlzdCl7Y29uc3QgeT15ZW4uZ2V0KFJbeC5pXS5udW0pfHwwO2FkZChuLCJhbGwiLHk+MCx5KTthZGQobixwcix5PjAseSk7aWYoT09TJiZyYy5kYXRlPj1PT1MpYWRkKG4sIkMiLHk+MCx5KX19OwogICAgICBidXkoInRvcDEiLHBpY2socmVzLDEpKTtidXkoInRvcDIiLHBpY2socmVzLDIpKTtidXkoInRvcDMiLHBpY2socmVzLDMpKTtidXkoImFsbEhvbGUiLGhvbGUpOwogICAgICBpZighUFJPWFkpYnV5KCJ2YWx1ZSIsaG9sZS5maWx0ZXIoeD0+eC52YWx1ZT49MS4zKSk7CiAgICAgIGlmKCFQUk9YWSYmaGFzT2Rkcyl7Y29uc3QgYXA9YXhpc1Byb2JzKHJhY2Usc3RvcmUsUi5tYXAocj0+ci5vZGRzKSk7aWYoYXAucE8pYnV5KCJheGlzIixhcC5wTy5tYXAoKHAsaSk9Pih7aSxwfSkpLmZpbHRlcih4PT54LnA+PUFYSVMuYmFuZHNbIumJhOadvyJdLmxvKSl9CiAgICAgIGNvbnN0IHQ9cGljayhyZXMsMSlbMF07CiAgICAgIGlmKHQpe2NvbnN0IHk9eWVuLmdldChSW3QuaV0ubnVtKXx8MCxyPXQucGMvQVYsTj1SLmxlbmd0aDsKICAgICAgIGNvbnN0IHJhbms9KHI+PTIuMj8iUyI6cj49MS43PyJBIjpyPj0xLjM/IkIiOiJDIik7CiAgICAgICBhZGRTZWcoIuODqeODs+OCryIrKHQubjwyJiYocmFuaz09PSJTInx8cmFuaz09PSJBIik/IkIiOnJhbmspLHByLHkpOwogICAgICAgYWRkU2VnKE48PTEwPyLpoK3mlbAg44CcMTAiOk48PTE0PyLpoK3mlbAgMTHjgJwxNCI6IumgreaVsCAxNeOAnCIscHIseSk7CiAgICAgICBhZGRTZWcocmFjZS5zdXJmPT09MT8i6IqdIjpyYWNlLnN1cmY9PT0yPyLjg4Djg7zjg4giOiLjgZ3jga7ku5YiLHByLHkpOwogICAgICAgYWRkU2VnKHJhY2UubHZsPjA/IuOCr+ODqeOCuSAiK0xWTltyYWNlLmx2bF06IuOCr+ODqeOCuSDkuI3mmI4iLHByLHkpOwogICAgICAgYWRkU2VnKHQubj49NT8i5a6f57i+IDXotbDku6XkuIoiOnQubj49Mz8i5a6f57i+IDPjgJw06LWwIjoi5a6f57i+IDPotbDmnKrmuoAiLHByLHkpfQogICAgIH0KICAgIH0KICAgfQogICBmb3IoY29uc3QgciBvZiByYy5yb3dzKXN0b3JlLmFkZChyKTsKICB9CiAgY29uc3QgZmluPXt9OwogIGZvcihjb25zdCBuIG9mIG5hbWVzKXtmaW5bbl09e307Zm9yKGNvbnN0IHAgb2YgcGVyKXtjb25zdCB4PVNbbl1bcF07CiAgIGlmKCF4LmJldHMpe2ZpbltuXVtwXT17YmV0czowfTtjb250aW51ZX0KICAgY29uc3QgbWVhbj14LnJldC94LmJldHMsc2Q9TWF0aC5zcXJ0KE1hdGgubWF4KDAseC5zcS94LmJldHMtbWVhbiptZWFuKSk7CiAgIGZpbltuXVtwXT17YmV0czp4LmJldHMsaGl0UmF0ZTp4LmhpdHMveC5iZXRzLHJvaTptZWFuLzEwMCxzZTpzZC9NYXRoLnNxcnQoeC5iZXRzKS8xMDB9fX0KICBjb25zdCBzZWdzPXt9OwogIGZvcihjb25zdCBbayxnXSBvZiBPYmplY3QuZW50cmllcyhTRUcpKXtzZWdzW2tdPXt9O2Zvcihjb25zdCBwIG9mIFsiYWxsIiwiQSIsIkIiXSl7Y29uc3QgeD1nW3BdOwogICBpZigheC5uKXtzZWdzW2tdW3BdPXtiZXRzOjB9O2NvbnRpbnVlfWNvbnN0IG1lYW49eC5yL3gubixzZD1NYXRoLnNxcnQoTWF0aC5tYXgoMCx4LnEveC5uLW1lYW4qbWVhbikpOwogICBzZWdzW2tdW3BdPXtiZXRzOngubixoaXRSYXRlOnguaC94Lm4scm9pOm1lYW4vMTAwLHNlOnNkL01hdGguc3FydCh4Lm4pLzEwMH19fQogIHJldHVybntyYWNlczp1c2VkLHN0YXRzOmZpbixzZWdzfTsKIH0KIHJldHVybntheGlzUHJvYnMsYXhpc1BpY2tzLHVwc2V0R3JhZGUsQVhJUyxwaWNrLGZlYXRzLE1PREVMLEZOLEZKLGxldmVsT2ZMYWJlbCxsZXZlbE9mUHJpemUsYmFja3Rlc3QsY2FsaWIsY2FsaWJGb3Isam5uLG5uLHRvUm93LGNzdlJvd3MsU3RvcmUsYW5hbHl6ZSxob3JzZVNjb3JlLG5vcm1hbGl6ZVRvcDMsdG9wM0Zyb21XaW4sc3VyZkNvZGUscGFyc2VEYXRlfTsKfSkoKTsKCgovKiA9PT09PSDjgqLjg5fjg6rmnKzkvZMgPT09PT0gKi8KY29uc3QgJD1pZD0+ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpOwpjb25zdCBlc2M9cz0+U3RyaW5nKHM/PyIiKS5yZXBsYWNlKC9bJjw+IiddL2csbT0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsiLCInIjoiJiMzOTsifVttXSkpOwpjb25zdCBzbGVlcD0obXM9MCk9Pm5ldyBQcm9taXNlKHI9PnNldFRpbWVvdXQocixtcykpOwpmdW5jdGlvbiBidXN5KG9uLG1zZz0i5Yem55CG5Lit4oCmIil7JCgiYnVzeSIpLnN0eWxlLmRpc3BsYXk9b24/ImZsZXgiOiJub25lIjskKCJidXN5VGV4dCIpLnRleHRDb250ZW50PW1zZ30KbGV0IERCPW51bGwsU1RPUkU9bnVsbCxTVE9SRV9LRVk9IiIsQ1VSPW51bGwsTEFTVFJFUz1udWxsOwpjb25zdCBWRU5VRT17IjAxIjoi5pyt5bmMIiwiMDIiOiLlh73ppKgiLCIwMyI6Iuemj+WztiIsIjA0Ijoi5paw5r2fIiwiMDUiOiLmnbHkuqwiLCIwNiI6IuS4reWxsSIsIjA3Ijoi5Lit5LqsIiwiMDgiOiLkuqzpg70iLCIwOSI6IumYquelniIsIjEwIjoi5bCP5YCJIn07CgovKiAtLS0gSW5kZXhlZERC77yI44GT44Gu44OE44O844Or5bCC55So77yJIC0tLSAqLwpmdW5jdGlvbiBvcGVuREIoKXtyZXR1cm4gbmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHI9aW5kZXhlZERCLm9wZW4oInVwc2V0X3Rvb2xfZGIiLDIpOwogci5vbnVwZ3JhZGVuZWVkZWQ9ZT0+e2NvbnN0IGQ9ZS50YXJnZXQucmVzdWx0O2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoImZpbGVzIikpZC5jcmVhdGVPYmplY3RTdG9yZSgiZmlsZXMiKTtpZighZC5vYmplY3RTdG9yZU5hbWVzLmNvbnRhaW5zKCJtZXRhIikpZC5jcmVhdGVPYmplY3RTdG9yZSgibWV0YSIpO2lmKCFkLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoInBheSIpKWQuY3JlYXRlT2JqZWN0U3RvcmUoInBheSIpfTsKIHIub25zdWNjZXNzPSgpPT57REI9ci5yZXN1bHQ7b2soKX07ci5vbmVycm9yPSgpPT5uZyhyLmVycm9yKTtyLm9uYmxvY2tlZD0oKT0+bmcobmV3IEVycm9yKCLku5bjga7jgr/jg5bjgafkvb/nlKjkuK3jgafjgZkiKSl9KX0KY29uc3QgaWRiQWxsPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgcT1EQi50cmFuc2FjdGlvbigiZmlsZXMiKS5vYmplY3RTdG9yZSgiZmlsZXMiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IGlkYlB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oImZpbGVzIiwicmVhZHdyaXRlIik7dC5vYmplY3RTdG9yZSgiZmlsZXMiKS5wdXQodixrKTt0Lm9uY29tcGxldGU9KCk9PnttYXJrRGlydHkoImZpbGVzIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYkNsZWFyPSgpPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3QgdD1EQi50cmFuc2FjdGlvbigiZmlsZXMiLCJyZWFkd3JpdGUiKSxzdD10Lm9iamVjdFN0b3JlKCJmaWxlcyIpO3N0Lm9wZW5DdXJzb3IoKS5vbnN1Y2Nlc3M9ZT0+e2NvbnN0IGM9ZS50YXJnZXQucmVzdWx0O2lmKGMpe2lmKCFTdHJpbmcoYy5rZXkpLnN0YXJ0c1dpdGgoImxpdmU6Iikpe21hcmtEaXJ0eSgiZmlsZXMiLGMua2V5KTtjLmRlbGV0ZSgpfWMuY29udGludWUoKX19O3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CgovKiDlj5bjgorovrzjgb/muIjjgb/jga7lhajooYzvvIjjg5Djg4Pjgq/jgqLjg4Pjg5dDU1bvvIvlj5blvpfmuIjjgb/jga7miJDnuL7vvInjgpLpoIbjgavmuKHjgZkgKi8KYXN5bmMgZnVuY3Rpb24gZm9yRWFjaFJvdyhjYil7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7Y29uc3QgZj1mc1tpXTsKICBpZihmLmxpdmUpe2Zvcihjb25zdCB4IG9mIGYucm93c3x8W10pY2IobGl2ZVJvdyh4KSl9CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGYuY3N2KSljYihVRS50b1JvdyhvKSk7CiAgaWYoaSUzPT09Milhd2FpdCBzbGVlcCgwKX0KfQovKiDjg6zjg7zjgrlJROOBi+OCiemWi+WCrOWgtOODu1Lnlarlj7fvvIgxMuahgeOBrkpSQeW9ouW8j++8j+aXpeS7mC3plovlgqzloLQtUuW9ouW8j+OBruS4oeWvvuW/nO+8iSAqLwpmdW5jdGlvbiB2ZW51ZU9mSWQoaWQpe3JldHVybiAvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDQsNik6U3RyaW5nKGlkKS5zcGxpdCgiLSIpWzNdfHwiIn0KZnVuY3Rpb24gcmFjZU5vT2ZJZChpZCl7cmV0dXJuIE51bWJlcigvXlxkezEyfSQvLnRlc3QoaWQpP2lkLnNsaWNlKDEwLDEyKTpTdHJpbmcoaWQpLnNwbGl0KCItIilbNF18fDApfQoKLyogLS0tIOWPluOCiui+vOOBvyAtLS0gKi8KYXN5bmMgZnVuY3Rpb24gaW1wb3J0RmlsZShmaWxlKXsKIGJ1c3kodHJ1ZSwi44OV44Kh44Kk44Or44KS6Kqt44G/6L6844G/5Lit4oCmXG7lpKfjgY3jgYTjg5XjgqHjgqTjg6vjga/mlbDljYHnp5LjgYvjgYvjgorjgb7jgZnjgIIiKTthd2FpdCBzbGVlcCgzMCk7CiB0cnl7CiAgY29uc3QgdGV4dD1hd2FpdCBmaWxlLnRleHQoKTtsZXQgaXRlbXM7CiAgaWYoL1wuY3N2JC9pLnRlc3QoZmlsZS5uYW1lKSl7aXRlbXM9W3t0eXBlOiJyYWNlLXJlc3VsdHMiLHllYXI6MCxwbGFjZTpmaWxlLm5hbWUsY3N2OnRleHR9XX0KICBlbHNle2NvbnN0IGo9SlNPTi5wYXJzZSh0ZXh0KTtpdGVtcz1BcnJheS5pc0FycmF5KGopP2o6KGouZmlsZXN8fFtqXSl9CiAgaXRlbXM9aXRlbXMuZmlsdGVyKHg9PngmJnR5cGVvZiB4LmNzdj09PSJzdHJpbmciKTsKICBpZighaXRlbXMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigiY3N244KS5ZCr44KA44OH44O844K/44GM6KaL44Gk44GL44KK44G+44Gb44KT44CC44OQ44OD44Kv44Ki44OD44OXSlNPTuOBi+OAgUNTVuOCkumBuOOCk+OBp+OBj+OBoOOBleOBhOOAgiIpOwogIGF3YWl0IGlkYkNsZWFyKCk7bGV0IG49MDsKICBmb3IobGV0IGk9MDtpPGl0ZW1zLmxlbmd0aDtpKyspe2NvbnN0IGl0PWl0ZW1zW2ldO2F3YWl0IGlkYlB1dChgJHtpdC55ZWFyfHwwfToke2l0LnBsYWNlfToke2l9YCx7eWVhcjppdC55ZWFyLHBsYWNlOml0LnBsYWNlLHBsYWNlTmFtZTppdC5wbGFjZU5hbWUsY3N2Oml0LmNzdn0pOwogICBuKz1NYXRoLm1heCgwLGl0LmNzdi5zcGxpdCgiXG4iKS5sZW5ndGgtMSk7JCgiYnVzeVRleHQiKS50ZXh0Q29udGVudD1g5L+d5a2Y5Lit4oCmICR7aSsxfS8ke2l0ZW1zLmxlbmd0aH1gO2F3YWl0IHNsZWVwKDApfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiOwogICQoImRhdGFTdGF0dXMiKS5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJnb29kIj7lj5bjgorovrzjgb/lrozkuobvvJoke2l0ZW1zLmxlbmd0aH3jg5XjgqHjgqTjg6vvvI/ntIQke24udG9Mb2NhbGVTdHJpbmcoKX3ooYw8L3NwYW4+YDsKICBia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuWPluOCiui+vOOBv+OCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZXx8ZSl9PC9zcGFuPmB9CiBmaW5hbGx5e2J1c3koZmFsc2UpfQp9CmFzeW5jIGZ1bmN0aW9uIHNob3dTdGF0ZSgpewogdHJ5e2NvbnN0IGZzPWF3YWl0IGlkYkFsbCgpLHBzPWF3YWl0IHBheUFsbCgpOwogIGNvbnN0IGJhc2U9ZnMuZmlsdGVyKGY9PiFmLmxpdmUpLGxpdmU9ZnMuZmlsdGVyKGY9PmYubGl2ZSYmKGYucm93c3x8W10pLmxlbmd0aCk7CiAgaWYoIWZzLmxlbmd0aCYmIXBzLmxlbmd0aCl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuODh+ODvOOCv+acquWPluW+l+OBp+OBmeOAguS4iuOBruOAjOmBjuWOu+aIkOe4vuOBqOaJleaIu+OCkuWPluW+l+OAjeOCkuaKvOOBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBsZD1saXZlLm1hcChmPT5mLmRhdGUpLnNvcnQoKSxuUmFjZXM9bGl2ZS5yZWR1Y2UoKHMsZik9PnMrbmV3IFNldChmLnJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZSwwKTsKICBsZXQgaD0iIjsKICBpZihsaXZlLmxlbmd0aCloKz1gPHNwYW4gY2xhc3M9Imdvb2QiPuWPluW+l+a4iOOBv+OBruaIkOe4vu+8miR7bGl2ZS5sZW5ndGh95pel77yPJHtuUmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIgke2xkWzBdfeOAnCR7bGRbbGQubGVuZ3RoLTFdfe+8iTwvc3Bhbj5gOwogIGlmKGJhc2UubGVuZ3RoKXtjb25zdCB5cz1bLi4ubmV3IFNldChiYXNlLm1hcChmPT5mLnllYXIpKV0uc29ydCgpO2grPShoPyJcbiI6IiIpK2A8c3BhbiBjbGFzcz0iZ29vZCI+44OQ44OD44Kv44Ki44OD44OX77yaJHtiYXNlLmxlbmd0aH3jg5XjgqHjgqTjg6vvvIgke3lzWzBdfHwiLSJ944CcJHt5c1t5cy5sZW5ndGgtMV18fCItIn3lubTvvIk8L3NwYW4+YH0KICBjb25zdCBwcj1wcy5yZWR1Y2UoKHMscCk9PnMrKHAucmFjZXN8fFtdKS5sZW5ndGgsMCk7CiAgaCs9KGg/IlxuIjoiIikrKHBzLmxlbmd0aD9gPHNwYW4gY2xhc3M9Imdvb2QiPuaJleaIu++8miR7cHMubGVuZ3RofeaXpe+8jyR7cHIudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrk8L3NwYW4+YDonPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu++8muacquWPluW+lzwvc3Bhbj4nKTsKICAkKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWg7CiB9Y2F0Y2goZSl7JCgiZGF0YVN0YXR1cyIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPueiuuiqjeOCqOODqeODvO+8miR7ZXNjKGUubWVzc2FnZSl9PC9zcGFuPmB9Cn0KLyogV29ya2Vy44GuIC9yZXN1bHRzIOOBruihjCDihpIg44OE44O844Or5YaF6YOo44Gu6KGMICovCmZ1bmN0aW9uIGxpdmVSb3coeCl7Y29uc3QgZj1wYXJzZUZsb2F0KFN0cmluZyh4LmZpbmlzaD8/IiIpLnJlcGxhY2UoL1teXGQuXS9nLCIiKSk7CiByZXR1cm57cmFjZUlkOlN0cmluZyh4LnJhY2VJZHx8IiIpLGRhdGU6VUUucGFyc2VEYXRlKHguZGF0ZSksbmFtZTpTdHJpbmcoeC5ob3JzZXx8IiIpLnRyaW0oKSxob3JzZTpVRS5ubih4LmhvcnNlKSxqb2NrZXk6VUUuam5uKHguam9ja2V5KSwKICBmaW5pc2g6TnVtYmVyLmlzRmluaXRlKGYpJiZmPjA/ZjpudWxsLGRpc3Q6TnVtYmVyKHguZGlzdGFuY2UpfHwwLHN1cmY6VUUuc3VyZkNvZGUoeC5zdXJmYWNlKSxhZ2U6TnVtYmVyKHguYWdlKXx8bnVsbCxudW06TnVtYmVyKHgubnVtYmVyKXx8bnVsbCxwb3A6TnVtYmVyKHgucG9wKT4wP051bWJlcih4LnBvcCk6bnVsbCxvZGRzOm51bGwsam5hbWU6U3RyaW5nKHguam9ja2V5fHwiIikudHJpbSgpLAogIGx2bDooeC52ZW51ZUNvZGUmJiEvXigwWzEtOV18MTApJC8udGVzdChTdHJpbmcoeC52ZW51ZUNvZGUpKSk/LTE6KFVFLmxldmVsT2ZMYWJlbCh4LmNscyl8fFVFLmxldmVsT2ZQcml6ZSh4LnByaXplKSl9fQovKiDlr77osaHml6XjgojjgorliY3jga7lsaXmrbTjgaDjgZHjgafjgrnjg4jjgqLjgpLkvZzjgosgKi8KYXN5bmMgZnVuY3Rpb24gYnVpbGRTdG9yZSh0YXJnZXQpewogaWYoU1RPUkUmJlNUT1JFX0tFWT09PXRhcmdldClyZXR1cm4gU1RPUkU7CiBjb25zdCBmcz1hd2FpdCBpZGJBbGwoKTtpZighZnMubGVuZ3RoKXRocm93IG5ldyBFcnJvcigi6YGO5Y6744OH44O844K/44GM5pyq55m76Yyy44Gn44GZ44CCIik7CiBjb25zdCBzdD1uZXcgVUUuU3RvcmUoKTtsZXQgcm93cz0wLHVzZWQ9MDsKIGZvcihsZXQgaT0wO2k8ZnMubGVuZ3RoO2krKyl7CiAgYnVzeSh0cnVlLGDpgY7ljrvjg4fjg7zjgr/jgpLpm4boqIjkuK3igKYgJHtpKzF9LyR7ZnMubGVuZ3RofVxu77yIJHt0YXJnZXR944KI44KK5YmN44Gu44G/5L2/55So77yJYCk7CiAgaWYoZnNbaV0ubGl2ZSl7Zm9yKGNvbnN0IHggb2YgZnNbaV0ucm93c3x8W10pe2NvbnN0IHI9bGl2ZVJvdyh4KTtyb3dzKys7aWYoIXIuZGF0ZXx8ci5kYXRlPj10YXJnZXR8fCFyLmhvcnNlKWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX19CiAgZWxzZSBmb3IoY29uc3QgbyBvZiBVRS5jc3ZSb3dzKGZzW2ldLmNzdikpe2NvbnN0IHI9VUUudG9Sb3cobyk7cm93cysrO2lmKCFyLmRhdGV8fHIuZGF0ZT49dGFyZ2V0KWNvbnRpbnVlO3N0LmFkZChyKTt1c2VkKys7aWYoci5kYXRlPihzdC5sYXN0RGF0ZXx8IiIpKXN0Lmxhc3REYXRlPXIuZGF0ZX0KICBhd2FpdCBzbGVlcCgwKTsKIH0KIGJ1c3koZmFsc2UpO1NUT1JFPXN0O1NUT1JFX0tFWT10YXJnZXQ7U1RPUkUuY291bnQ9dXNlZDtyZXR1cm4gc3Q7Cn0KCi8qIC0tLSDjg6zjg7zjgrnpgbjmip4gLS0tICovCmZ1bmN0aW9uIHNob3dQYW5lKGspe2Zvcihjb25zdCBwIG9mWyJXb3JrZXIiLCJNYW51YWwiLCJQYXN0Il0pJCgicGFuZSIrcCkuc3R5bGUuZGlzcGxheT1wPT09az8iYmxvY2siOiJub25lIn0KJCgidGFiV29ya2VyIikub25jbGljaz0oKT0+c2hvd1BhbmUoIldvcmtlciIpOyQoInRhYk1hbnVhbCIpLm9uY2xpY2s9KCk9PnNob3dQYW5lKCJNYW51YWwiKTskKCJ0YWJQYXN0Iikub25jbGljaz0oKT0+c2hvd1BhbmUoIlBhc3QiKTsKZnVuY3Rpb24gc2V0UmFjZShyYWNlLGxhYmVsKXtpZihyYWNlLmtleSYmIXJhY2Uub2RkczApcmFjZS5vZGRzMD1vZGRzRm9yKHJhY2UpO0NVUj1yYWNlO0xBU1RSRVM9bnVsbDskKCJyYWNlbGFiZWwiKS50ZXh0Q29udGVudD1sYWJlbDskKCJydW4iKS5kaXNhYmxlZD1mYWxzZTskKCJvdXQiKS50ZXh0Q29udGVudD0i44CM6Kej5p6Q44GZ44KL44CN44KS5oq844GX44Gm44GP44Gg44GV44GE44CCIn0KCi8qIFdvcmtlciAqLwpsZXQgV1JBQ0VTPVtdOwpsZXQgV0RJQUc9W107CmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2FyZHMoYmFzZSxkLHZlbnVlQ29kZSl7CiBjb25zdCBxPXZlbnVlQ29kZT9gJnZlbnVlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHZlbnVlQ29kZSl9YDoiIjtsZXQgZXJyPSIiOwogZm9yKGxldCB0PTA7dDwzO3QrKyl7CiAgdHJ5e2NvbnN0IHI9YXdhaXQgZmV0Y2goYCR7YmFzZX0vcmFjZS1jYXJkcz9kYXRlPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGQpfSR7cX1gKTsKICAgaWYoIXIub2spe2xldCBtPSIiO3RyeXttPShhd2FpdCByLmpzb24oKSkuZXJyb3J8fCIifWNhdGNoe310aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c30gJHttfWAudHJpbSgpKX0KICAgY29uc3QgeD1hd2FpdCByLmpzb24oKTtyZXR1cm57cmFjZXM6QXJyYXkuaXNBcnJheSh4KT94Oih4LnJhY2VzfHxbXSksd2FybmluZzp4Lndhcm5pbmd8fCIifX0KICBjYXRjaChlKXtlcnI9ZS5tZXNzYWdlO2F3YWl0IHNsZWVwKDEyMDAqKHQrMSkpfQogfQogdGhyb3cgbmV3IEVycm9yKGVycnx8IuWPluW+l+OBp+OBjeOBvuOBm+OCkyIpOwp9CmZ1bmN0aW9uIHJlbmRlclZlbnVlQnV0dG9ucyhkKXsKIGNvbnN0IG5hbWVzPVsuLi5uZXcgU2V0KFdSQUNFUy5tYXAocj0+ci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKSldOwogbGV0IGg9bmFtZXMubWFwKCh2LGkpPT5gPGJ1dHRvbiBkYXRhLXY9IiR7aX0iIGNsYXNzPSJzdWIiPiR7ZXNjKHYpfe+8iCR7V1JBQ0VTLmZpbHRlcihyPT4oci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKT09PXYpLmxlbmd0aH1S77yJPC9idXR0b24+YCkuam9pbigiIik7CiBoKz1XRElBRy5maWx0ZXIoeD0+eC5lcnJ8fHguZW1wdHl8fHgucGFydGlhbCkubWFwKHg9PmA8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj4ke2VzYyh4Lm5hbWUpfe+8miR7eC5lcnI/IuWPluW+l+WkseaVl++8iCIrZXNjKHguZXJyKS5zbGljZSgwLDQwMCkrIu+8iSI6eC5wYXJ0aWFsP2Ake3guY291bnR9UuOBl+OBi+WPluW+l+OBp+OBjeOBpuOBhOOBvuOBm+OCk++8iOmAmuW4uOOBrzEw44CcMTJS77yJYDpg5Ye66LWw6aas44KS6Kqt44KB44Gq44GL44Gj44Gf44Os44O844K5ICR7eC5lbXB0eX1S77yI6Zmk5aSW77yJYH0gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLXJldHJ5PSIke2VzYyh4LmNvZGV8fCIiKX0iPuWGjeWPluW+lzwvYnV0dG9uPjwvZGl2PmApLmpvaW4oIiIpOwogJCgid2xpc3QiKS5pbm5lckhUTUw9aDsKICQoIndsaXN0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtdl0iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+bGlzdFZlbnVlKG5hbWVzW2IuZGF0YXNldC52XSxkKSk7CiAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLXJldHJ5XSIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT5sb2FkVmVudWUoZCx7dmVudWVDb2RlOmIuZGF0YXNldC5yZXRyeSx2ZW51ZU5hbWU6IiJ9LHRydWUpKTsKfQphc3luYyBmdW5jdGlvbiBsb2FkVmVudWUoZCx2LHJlcmVuZGVyKXsKIGNvbnN0IGJhc2U9JCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpOwogY29uc3QgcHJldj1XRElBRy5maW5kKHg9PlN0cmluZyh4LmNvZGUpPT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXUkFDRVM9V1JBQ0VTLmZpbHRlcihyPT5TdHJpbmcoci52ZW51ZUNvZGUpIT09U3RyaW5nKHYudmVudWVDb2RlKSk7CiBXRElBRz1XRElBRy5maWx0ZXIoeD0+U3RyaW5nKHguY29kZSkhPT1TdHJpbmcodi52ZW51ZUNvZGUpKTsKIGNvbnN0IG5hbWU9di52ZW51ZU5hbWV8fChwcmV2JiZwcmV2Lm5hbWUpfHx2LnZlbnVlQ29kZTsKIHRyeXtjb25zdCB7cmFjZXN9PWF3YWl0IGZldGNoQ2FyZHMoYmFzZSxkLHYudmVudWVDb2RlKTsKICBjb25zdCBvaz1yYWNlcy5maWx0ZXIoYT0+KGEuaG9yc2VzfHxhLnJ1bm5lcnN8fFtdKS5sZW5ndGgpLGVtcHR5PXJhY2VzLmxlbmd0aC1vay5sZW5ndGg7CiAgV1JBQ0VTLnB1c2goLi4ub2spOwogIGNvbnN0IGVycnM9cmFjZXMuZmlsdGVyKGE9PmEuZXJyb3IpLm1hcChhPT5hLmVycm9yKTsKICBXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6b2subGVuZ3RoLGVtcHR5LHBhcnRpYWw6b2subGVuZ3RoPjAmJm9rLmxlbmd0aDwxMCxlcnI6IXJhY2VzLmxlbmd0aD8i44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KTIjooIW9rLmxlbmd0aCYmZXJycy5sZW5ndGg/ZXJyc1swXToiIil9KTsKIH1jYXRjaChlKXtXRElBRy5wdXNoKHtjb2RlOnYudmVudWVDb2RlLG5hbWUsY291bnQ6MCxlbXB0eTowLGVycjplLm1lc3NhZ2V9KX0KIGlmKHJlcmVuZGVyKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfvvIgke1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV9JHt4LmNvdW50fVJgKS5qb2luKCLvvI8iKX3vvIlgOyQoIndhbGwiKS5kaXNhYmxlZD0hV1JBQ0VTLmxlbmd0aDskKCJvZGRzR2V0IikuZGlzYWJsZWQ9IVdSQUNFUy5sZW5ndGg7cmVuZGVyVmVudWVCdXR0b25zKGQpfQp9CiQoIndnZXQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgid2RhdGUiKS52YWx1ZTtpZighZClyZXR1cm4gYWxlcnQoIuaXpeS7mOOCkumBuOaKnuOBl+OBpuOBj+OBoOOBleOBhOOAgiIpOwogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9IumWi+WCrOWgtOOCkueiuuiqjeS4reKApiI7JCgid2xpc3QiKS5pbm5lckhUTUw9IiI7JCgiYWxsb3V0IikuaW5uZXJIVE1MPSIiO1dSQUNFUz1bXTtXRElBRz1bXTtXREFURT1kOyQoIndhbGwiKS5kaXNhYmxlZD10cnVlOyQoIm9kZHNHZXQiKS5kaXNhYmxlZD10cnVlO09ERFM9e307CiBsZXQgdmVudWVzPW51bGw7CiBsZXQgbGlzdERpYWc9IiIsYXZhaWxEYXRlcz1bXTtBVkFJTD1bXTsKIHRyeXtjb25zdCByPWF3YWl0IGZldGNoKGAke2Jhc2V9L3JhY2UtY2FyZHM/ZGF0ZT0ke2VuY29kZVVSSUNvbXBvbmVudChkKX0mbGlzdD0xYCk7aWYoci5vayl7Y29uc3QgeD1hd2FpdCByLmpzb24oKTt2ZW51ZXM9eC52ZW51ZXN8fFtdO2F2YWlsRGF0ZXM9eC5hdmFpbGFibGVEYXRlc3x8W107QVZBSUw9YXZhaWxEYXRlcztpZighdmVudWVzLmxlbmd0aClsaXN0RGlhZz1KU09OLnN0cmluZ2lmeSh4LmRpYWdub3N0aWNzfHxbXSkuc2xpY2UoMCw1MDApfX1jYXRjaChlKXt9CiB0cnl7CiAgaWYodmVudWVzJiYhdmVudWVzLmxlbmd0aCYmYXZhaWxEYXRlcy5sZW5ndGgmJiFhdmFpbERhdGVzLmluY2x1ZGVzKGQpKXsKICAgJCgid3N0YXR1cyIpLnRleHRDb250ZW50PWAke2R9IOOBr0pSQeOBrumWi+WCrOaXpeOBp+OBr+OBguOCiuOBvuOBm+OCk+OAglxu5YWs6ZaL5Lit44Gu6ZaL5YKs5pel77yaJHthdmFpbERhdGVzLmpvaW4oIuOAgSIpfWA7CiAgICQoIndsaXN0IikuaW5uZXJIVE1MPWF2YWlsRGF0ZXMubWFwKHg9PmA8YnV0dG9uIGNsYXNzPSJzdWIiIGRhdGEtZD0iJHt4fSI+JHt4fTwvYnV0dG9uPmApLmpvaW4oIiIpOwogICAkKCJ3bGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLWRdIikuZm9yRWFjaChiPT5iLm9uY2xpY2s9KCk9PnskKCJ3ZGF0ZSIpLnZhbHVlPWIuZGF0YXNldC5kOyQoIndnZXQiKS5jbGljaygpfSk7CiAgIHJldHVybjsKICB9CiAgaWYodmVudWVzJiZ2ZW51ZXMubGVuZ3RoKXsKICAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXskKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YOWPluW+l+S4reKApiAke3YudmVudWVOYW1lfe+8iCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfmuIjjgb/vvIlgO2F3YWl0IGxvYWRWZW51ZShkLHYsZmFsc2UpfQogIH1lbHNlewogICAvLyDml6dXb3JrZXLnrYnjgafplovlgqzloLTkuIDopqfjgYzkvb/jgYjjgarjgYTloLTlkIjvvJox5pel5YiG44KS5LiA5ous5Y+W5b6XCiAgICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5LiA5ous5Y+W5b6X5Lit4oCmIjsKICAgY29uc3Qge3JhY2VzfT1hd2FpdCBmZXRjaENhcmRzKGJhc2UsZCwiIik7CiAgIGNvbnN0IG9rPXJhY2VzLmZpbHRlcihhPT4oYS5ob3JzZXN8fGEucnVubmVyc3x8W10pLmxlbmd0aCk7V1JBQ0VTPW9rOwogICBpZihyYWNlcy5sZW5ndGg+b2subGVuZ3RoKVdESUFHLnB1c2goe2NvZGU6IiIsbmFtZToi5LiA6YOoIixjb3VudDpvay5sZW5ndGgsZW1wdHk6cmFjZXMubGVuZ3RoLW9rLmxlbmd0aCxlcnI6IiJ9KTsKICB9CiAgaWYoIVdSQUNFUy5sZW5ndGgpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66LWw6aas44Gk44GN44Gu44Os44O844K544GM6KaL44Gk44GL44KK44G+44Gb44KT44Gn44GX44Gf44CCXG4iK1dESUFHLm1hcCh4PT5gJHt4Lm5hbWV977yaJHt4LmVycnx8IuWHuui1sOmmrOOBquOBlyJ9YCkuam9pbigiXG4iKSsobGlzdERpYWc/Ilxu6Ki65pat77yaIitsaXN0RGlhZzoiIik7cmVuZGVyVmVudWVCdXR0b25zKGQpO3JldHVybn0KICAkKCJ3c3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpdgKyhXRElBRy5sZW5ndGg/YO+8iCR7V0RJQUcubWFwKHg9PmAke3gubmFtZX0ke3guY291bnR9UmApLmpvaW4oIu+8jyIpfe+8iWA6IiIpOwogICQoIndhbGwiKS5kaXNhYmxlZD1mYWxzZTskKCJvZGRzR2V0IikuZGlzYWJsZWQ9ZmFsc2U7cmVuZGVyVmVudWVCdXR0b25zKGQpOwogfWNhdGNoKGUpeyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i5Y+W5b6X44Ko44Op44O877yaIitlLm1lc3NhZ2UrIlxu77yIV29ya2Vy44GM5pyq5YWs6ZaL77yPQ09SU++8j+aXpeS7mOOBq+mWi+WCrOOBquOBl+OAgeOBruWPr+iDveaAp++8iSJ9Cn07CmZ1bmN0aW9uIGxpc3RWZW51ZSh2LGQpewogY29uc3QgcnM9V1JBQ0VTLmZpbHRlcihyPT4oci52ZW51ZU5hbWV8fHIudmVudWV8fCIiKT09PXYpLnNvcnQoKGEsYik9PihhLnJhY2VOdW1iZXJ8fDApLShiLnJhY2VOdW1iZXJ8fDApKTsKICQoIndsaXN0IikuaW5uZXJIVE1MPXJzLm1hcCgocixrKT0+YDxidXR0b24gZGF0YS1rPSIke2t9Ij4ke3IucmFjZU51bWJlcnx8aysxfVIgJHtlc2Moci5yYWNlTmFtZXx8IiIpfTwvYnV0dG9uPmApLmpvaW4oIiIpOwogJCgid2xpc3QiKS5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24iKS5mb3JFYWNoKGI9PmIub25jbGljaz0oKT0+e2NvbnN0IHI9cnNbYi5kYXRhc2V0LmtdOwogIGNvbnN0IGhzPShyLmhvcnNlc3x8ci5ydW5uZXJzKTsKICBjb25zdCByYWNlPW1rUmFjZShyLGQpOwogIHNldFJhY2UocmFjZSxgJHtkfSAke3Z9JHtyLnJhY2VOdW1iZXJ8fCIifVIgJHtyLnJhY2VOYW1lfHwiIn3vvIgke3Iuc3VyZmFjZXx8Ij8ifSR7ci5kaXN0YW5jZXx8Ij8ifW3jg7ske2hzLmxlbmd0aH3poK3vvIlgKTsKIH0pOwp9CgpmdW5jdGlvbiBta1JhY2UocixkKXsKIGNvbnN0IGhzPShyLmhvcnNlc3x8ci5ydW5uZXJzKTsKIHJldHVybntkYXRlOmQsa2V5OmAke1N0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoci5yYWNlTnVtYmVyKXx8MH1gLHN1cmY6VUUuc3VyZkNvZGUoci5zdXJmYWNlKSxkaXN0Ok51bWJlcihyLmRpc3RhbmNlKXx8MCxsdmw6VUUubGV2ZWxPZkxhYmVsKHIuY2xhc3NOYW1lKXx8VUUubGV2ZWxPZkxhYmVsKHIucmFjZU5hbWUpLAogIHJ1bm5lcnM6aHMubWFwKChoLGkpPT57Y29uc3QgbmFtZT1oLmhvcnNlTmFtZXx8aC5ob3JzZXx8aC5uYW1lfHwiIjtyZXR1cm57bmFtZSxob3JzZTpVRS5ubihuYW1lKSxqb2NrZXk6VUUuam5uKGguam9ja2V5fHwiIiksam5hbWU6U3RyaW5nKGguam9ja2V5fHwiIikudHJpbSgpLGFnZTpoLmFnZXx8bnVsbCxudW06aC5ob3JzZU51bWJlcnx8aC5udW1iZXJ8fGkrMX19KS5zb3J0KCh4LHkpPT4oeC5udW18fDApLSh5Lm51bXx8MCkpfTsKfQpsZXQgV0RBVEU9IiIsQVZBSUw9W107Ci8qIOWFqOODrOODvOOCueS4gOaLrO+8muWQhOODrOODvOOCueOBrueptOmmrOWAmeijnO+8iOS4iuS9jTLpoK3vvInjgpLkuIDopqfjgavjgZnjgosgKi8KYXN5bmMgZnVuY3Rpb24gcnVuQWxsKGJveElkPSJhbGxvdXQiKXsKIGlmKCFXUkFDRVMubGVuZ3RoKXJldHVybjsKIGNvbnN0IGJveD0kKGJveElkKTsKIGNvbnN0IGQ9V0RBVEU7bGV0IHRleHQ9YCR7ZH0g56m06aas5aW96LWw77yI5LiK5L2N5YCZ6KOc77yJXG5gOwogdHJ5ewogIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiAgY29uc3QgcnM9Wy4uLldSQUNFU10uc29ydCgoYSxiKT0+U3RyaW5nKGEudmVudWVOYW1lfHxhLnZlbnVlfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZU5hbWV8fGIudmVudWV8fCIiKSwiamEiKXx8KGEucmFjZU51bWJlcnx8MCktKGIucmFjZU51bWJlcnx8MCkpOwogIGNvbnN0IGdhcD1zdG9yZS5sYXN0RGF0ZT9NYXRoLnJvdW5kKChuZXcgRGF0ZShkKS1uZXcgRGF0ZShzdG9yZS5sYXN0RGF0ZSkpLzg2NGU1KTpudWxsOwogIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+44Kq44OD44K65Y+N5pig77yaJHtPYmplY3Qua2V5cyhPRERTKS5sZW5ndGh944Os44O844K55YiG77yI5pyq5Y+W5b6X44Gu44Os44O844K544Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJPC9kaXY+PGRpdiBjbGFzcz0ic21hbGwiPuWtpue/kuODh+ODvOOCv+acgOe1guaXpe+8miR7ZXNjKHN0b3JlLmxhc3REYXRlfHwi5LiN5piOIil977yP56m044K+44O844Oz44Gv44OE44O844Or5o6o5a6a44Gu5Lq65rCX77yI6aiO5omL5oiQ57i+6L6844G/77yJ44Gn5Yik5a6a44CC5a6f6Zqb44Gu5Lq65rCX44Go44Gv55Ww44Gq44KK44G+44GZPC9kaXY+YCx0SD0wLHROPTAsakg9MCxqTWlzcz1bXTsKICBpZihnYXAhPW51bGwmJmdhcD4xNCloKz1gPGRpdiBjbGFzcz0id2FybiI+4pqgIOacgOaWsOOBruaIkOe4vuOBjCR7Z2FwfeaXpeWIhuWFpeOBo+OBpuOBhOOBvuOBm+OCk+OAguebtOi/keOBruWlvei1sOODu+WHoei1sOOBjOWPjeaYoOOBleOCjOOBquOBhOeCueOBq+azqOaEj+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvZGl2PmA7CiAgaCs9Ijxicj4iOwogIHJzLmZvckVhY2goKHIsayk9PnsKICAgY29uc3QgcmFjZT1ta1JhY2UocixkKSxuPXJhY2UucnVubmVycy5sZW5ndGgsdj1yLnZlbnVlTmFtZXx8ci52ZW51ZXx8IiI7CiAgIGNvbnN0IGxhYmVsPWAke3Z9JHtyLnJhY2VOdW1iZXJ8fGsrMX1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2V8fCI/In0ke3IuZGlzdGFuY2V8fCI/In1t44O7JHtufemgre+8iWA7CiAgIHRleHQrPWBcbuKWoCR7bGFiZWx9XG5gOwogICBsZXQgYm9keT0iIjsKICAgaWYobjw2KWJvZHk9JzxzcGFuIGNsYXNzPSJzbWFsbCI+Numgreacqua6gOOBruOBn+OCgeWvvuixoeWkljwvc3Bhbj4nOwogICBlbHNlewogICAgY29uc3Qgb2Q9b2Rkc0ZvcihyYWNlKSxyZXM9VUUuYW5hbHl6ZShyYWNlLHN0b3JlLG9kKSxjPVVFLnBpY2socmVzLDIpO3tjb25zdCBtPW1hdGNoSW5mbyhyZXMpO3RIKz1tLmg7dE4rPW0ubjtqSCs9bS5qO2pNaXNzLnB1c2goLi4ubS5taXNzKX0KICAgIGJvZHk9Yy5tYXAoeD0+e2NvbnN0IHRnPXgudGFncy5zbGljZSgwLDIpLm1hcCh0PT50LnQpLmpvaW4oIu+8jyIpOwogICAgIHRleHQrPWAgICR7eC5ub33nlaogJHt4Lm5hbWV9ICR7cmF0aW5nKHgucGMseC5tb2RlLHgubil9ICR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSUgJHt0Z31cbmA7CiAgICAgdGV4dCs9YCAgICAke3JlY0xpbmUoeCl977yPJHt4LmpuYW1lfHwi6aiO5omL5LiN5piOIn1cbmA7CiAgICAgcmV0dXJuIGA8ZGl2PjxiPiR7ZXNjKHgubm8pfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfSI+JHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX08L3NwYW4+IDxzcGFuIGNsYXNzPSJzbWFsbCI+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9Je+8iOeptOOCvuODvOODs+W5s+Wdh+OBriR7KHgucGMvQVZHW3gubW9kZT09PSJvZGRzIj8ib2RkcyI6InByb3h5Il0pLnRvRml4ZWQoMSl95YCN44O75L+h6aC85bqmJHtlc2MoeC5jb25mKX3vvIk8L3NwYW4+PGJyPjxzcGFuIGNsYXNzPSJzbWFsbCI+JHtlc2MocmVjTGluZSh4KSl977yPJHtlc2MoeC5qbmFtZXx8IumojuaJi+S4jeaYjiIpfTwvc3Bhbj48YnI+YCt4LnRhZ3Muc2xpY2UoMCwzKS5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIikrYDwvZGl2PmB9KS5qb2luKCIiKXx8JzxzcGFuIGNsYXNzPSJzbWFsbCI+5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBruWAmeijnOOBquOBl++8neWvvuixoeWkljwvc3Bhbj4nOwogICB9CiAgIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2VzYyhsYWJlbCl9PC9iPjxicj4ke2JvZHl9PGJyPjxidXR0b24gY2xhc3M9InN1YiIgZGF0YS1rPSIke2t9Ij7oqbPntLDjg7vjgqrjg4PjgrrlhaXlips8L2J1dHRvbj48L2Rpdj5gOwogIH0pOwogIGg9aC5yZXBsYWNlKCc8YnI+JyxgPGRpdiBjbGFzcz0ic21hbGwiPuWxpeattOOBrueFp+WQiO+8mummrCAke3RIfS8ke3ROfemgre+8iOmBjuWOu+OBqzLotbDku6XkuIrvvInvvI/pqI7miYsgJHtqSH0vJHt0Tn3poK08L2Rpdj5gKyhqTWlzcy5sZW5ndGgmJmpIPHROKi42P2A8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg6aiO5omL44KS6YGO5Y6744OH44O844K/44Go54Wn5ZCI44Gn44GN44Gm44GE44Gq44GE5L6L77yaJHtlc2MoWy4uLm5ldyBTZXQoak1pc3MpXS5zbGljZSgwLDYpLmpvaW4oIuOAgSIpKX08L2Rpdj5gOiIiKSsodE4mJnRIPHROKi41Pyc8ZGl2IGNsYXNzPSJ3YXJuIHNtYWxsIj7imqAg54Wn5ZCI44Gn44GN44Gf6aas44GM5Y2K5YiG5pyq5rqA44Gn44GZ44CC6Iul6aeS5oim44GM5Lit5b+D44Gu5pel44Gv5q2j5bi444Gn44GZ44GM44CB44Gd44GG44Gn44Gq44GR44KM44Gw6aas5ZCN6KGo6KiY44Gu5LiN5LiA6Ie044Gu5Y+v6IO95oCn44GM44GC44KK44G+44GZ44CCPC9kaXY+JzonJykrJzxicj4nKTsKICBoKz0nPGJ1dHRvbiBjbGFzcz0iY29weUFsbCI+5LiA6Kan44KS44OG44Kt44K544OI44Gn44Kz44OU44O8PC9idXR0b24+JzsKICBib3guaW5uZXJIVE1MPWg7CiAgYm94LnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbltkYXRhLWtdIikuZm9yRWFjaChidD0+YnQub25jbGljaz0oKT0+e2NvbnN0IHI9cnNbYnQuZGF0YXNldC5rXTtzZXRSYWNlKG1rUmFjZShyLGQpLGAke2R9ICR7ci52ZW51ZU5hbWV8fHIudmVudWV8fCIifSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ9YCk7JCgicnVuIikuc2Nyb2xsSW50b1ZpZXcoe2JlaGF2aW9yOiJzbW9vdGgifSk7cnVuKG51bGwpfSk7CiAgY29uc3QgY2I9Ym94LnF1ZXJ5U2VsZWN0b3IoIi5jb3B5QWxsIik7Y2Iub25jbGljaz1hc3luYygpPT57dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHRleHQpO2NiLnRleHRDb250ZW50PSLjgrPjg5Tjg7zjgZfjgb7jgZfjgZ8ifWNhdGNoKGUpe2FsZXJ0KCLjgrPjg5Tjg7zjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ8iKX19OwogfWNhdGNoKGUpe2J1c3koZmFsc2UpO2JveC5pbm5lckhUTUw9YDxzcGFuIGNsYXNzPSJ3YXJuIj7kuIDmi6zop6PmnpDjgqjjg6njg7zvvJoke2VzYyhlLm1lc3NhZ2V8fGUpfTwvc3Bhbj5gfQp9CiQoIndhbGwiKS5vbmNsaWNrPSgpPT5ydW5BbGwoImFsbG91dCIpOwovKiDmiYvlhaXlipsgKi8KJCgibWRhdGUiKS52YWx1ZT1uZXcgRGF0ZShEYXRlLm5vdygpKzg2NDAwMDAwKjMpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CiQoIndkYXRlIikudmFsdWU9JCgibWRhdGUiKS52YWx1ZTskKCJwZGF0ZSIpLnZhbHVlPSIyMDI2LTA2LTIxIjsKJCgibWdvIikub25jbGljaz0oKT0+ewogY29uc3QgbGluZXM9JCgibXRleHQiKS52YWx1ZS5zcGxpdCgvXHI/XG4vKS5tYXAocz0+cy50cmltKCkpLmZpbHRlcihCb29sZWFuKSxycz1bXSxvZGRzPVtdOwogZm9yKGNvbnN0IGwgb2YgbGluZXMpe2NvbnN0IG09bC5tYXRjaCgvXihcZHsxLDJ9KVtccyzjgIBdKyhcUys/KSg/OltccyzjgIBdKyhbXGQuXSspKT8kLyk7aWYobSl7cnMucHVzaCh7bmFtZTptWzJdLGhvcnNlOlVFLm5uKG1bMl0pLGpvY2tleToiIixhZ2U6bnVsbCxudW06K21bMV19KTtvZGRzLnB1c2gobVszXT8rbVszXTowKX19CiBpZihycy5sZW5ndGg8MilyZXR1cm4gYWxlcnQoIuOAjOmmrOeVqiDppqzlkI3jgI3jga7lvaLlvI/jgacy6aCt5Lul5LiK5YWl5Yqb44GX44Gm44GP44Gg44GV44GE44CCIik7CiBjb25zdCByYWNlPXtkYXRlOiQoIm1kYXRlIikudmFsdWUsc3VyZjorJCgibXN1cmYiKS52YWx1ZSxkaXN0OiskKCJtZGlzdCIpLnZhbHVlfHwwLHJ1bm5lcnM6cnMsb2RkczA6b2Rkcy5ldmVyeShvPT5vPjEpP29kZHM6bnVsbH07CiBzZXRSYWNlKHJhY2UsYCR7cmFjZS5kYXRlfSDmiYvlhaXlipvvvIgke3JhY2Uuc3VyZj09PTE/IuiKnSI6IuODgOODvOODiCJ9JHtyYWNlLmRpc3R9beODuyR7cnMubGVuZ3Rofemgre+8iWApOwp9OwovKiDpgY7ljrvjg6zjg7zjgrkgKi8KbGV0IFBSQUNFUz1bXTsKJCgicGdldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgZD0kKCJwZGF0ZSIpLnZhbHVlO2lmKCFkKXJldHVybjskKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9IuaknOe0ouS4reKApiI7JCgicGxpc3QiKS5pbm5lckhUTUw9IiI7CiB0cnl7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZihyLmRhdGUhPT1kfHwhci5yYWNlSWQpcmV0dXJuO2lmKCFtYXAuaGFzKHIucmFjZUlkKSltYXAuc2V0KHIucmFjZUlkLFtdKTttYXAuZ2V0KHIucmFjZUlkKS5wdXNoKHIpfSk7CiAgUFJBQ0VTPVsuLi5tYXAuZW50cmllcygpXS5maWx0ZXIoKFssdl0pPT52Lmxlbmd0aD49Nikuc29ydCgoYSxiKT0+dmVudWVPZklkKGFbMF0pLmxvY2FsZUNvbXBhcmUodmVudWVPZklkKGJbMF0pKXx8cmFjZU5vT2ZJZChhWzBdKS1yYWNlTm9PZklkKGJbMF0pKTsKICBpZighUFJBQ0VTLmxlbmd0aCl7JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLjgZ3jga7ml6Xjga7jg6zjg7zjgrnjga/kv53lrZjjg4fjg7zjgr/jgavjgYLjgorjgb7jgZvjgpPjgIIiO3JldHVybn0KICAkKCJwc3RhdHVzIikudGV4dENvbnRlbnQ9YCR7UFJBQ0VTLmxlbmd0aH3jg6zjg7zjgrlgOwogIGNvbnN0IGxhYj1pZD0+YCR7VkVOVUVbdmVudWVPZklkKGlkKV18fHZlbnVlT2ZJZChpZCl9JHtyYWNlTm9PZklkKGlkKX1SYDsKICAkKCJwbGlzdCIpLmlubmVySFRNTD1QUkFDRVMubWFwKChbaWQsdl0sayk9PmA8YnV0dG9uIGRhdGEtaz0iJHtrfSI+JHtsYWIoaWQpfe+8iCR7dlswXS5zdXJmPT09MT8i6IqdIjoi44OAIn0ke3ZbMF0uZGlzdH1t44O7JHt2Lmxlbmd0aH3poK3vvIk8L2J1dHRvbj5gKS5qb2luKCIiKTsKICAkKCJwbGlzdCIpLnF1ZXJ5U2VsZWN0b3JBbGwoImJ1dHRvbiIpLmZvckVhY2goYj0+Yi5vbmNsaWNrPSgpPT57Y29uc3QgW2lkLHZdPVBSQUNFU1tiLmRhdGFzZXQua107CiAgIGNvbnN0IHJzPXYuZmlsdGVyKHI9PnIuaG9yc2UpLnNvcnQoKGEsYik9PihhLm51bXx8MCktKGIubnVtfHwwKSkubWFwKHI9Pih7bmFtZTpyLm5hbWV8fHIuaG9yc2UsaG9yc2U6ci5ob3JzZSxqb2NrZXk6ci5qb2NrZXksam5hbWU6ci5qbmFtZXx8IiIsYWdlOnIuYWdlLG51bTpyLm51bSxhY3Q6ci5maW5pc2gscG9wOnIucG9wLG9kZHNBOnIub2Rkc30pKTsKICAgY29uc3QgcmFjZT17ZGF0ZTpkLHN1cmY6dlswXS5zdXJmLGRpc3Q6dlswXS5kaXN0LGx2bDp2WzBdLmx2bHx8MCxydW5uZXJzOnJzLHBhc3Q6dHJ1ZX07CiAgIHNldFJhY2UocmFjZSxgJHtkfSAke2xhYihpZCl977yI6YGO5Y6744Os44O844K544O7JHtycy5sZW5ndGh96aCt77yJYCk7fSk7CiB9Y2F0Y2goZSl7JCgicHN0YXR1cyIpLnRleHRDb250ZW50PSLjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KfTsKCi8qIC0tLSDop6PmnpDjg7vooajnpLogLS0tICovCi8qIOODqeODs+OCr+OBr+ijnOato+W+jOOBruWlvei1sOeOh+OBp+WIpOWumu+8iOODouODvOODieOBlOOBqOOBq+eptOOCvuODvOODs+OBruW5s+Wdh+OBjOmBleOBhu+8muOCquODg+OCuuWFpeWKm+aZguOBr+e0hDkl44CB44Kq44OD44K644Gq44GX44Gv57SEMTMl77yJICovCmNvbnN0IEFWRz17b2RkczouMDkxLHByb3h5Oi4xMTV9OyAgIC8vIOeptOOCvuODvOODs+OBruWun+a4rOW5s+Wdh++8iDIwMjTlubTku6XpmY3jga7mnKrlrabnv5LmnJ/plpPvvIkKY29uc3QgcmF0aW5nPShwLG1vZGUsbik9Pntjb25zdCByPXAvKEFWR1ttb2RlPT09Im9kZHMiPyJvZGRzIjoicHJveHkiXSk7bGV0IGs9cj49Mi4yPyJTIjpyPj0xLjc/IkEiOnI+PTEuMz8iQiI6IkMiO2lmKG48MiYmKGs9PT0iUyJ8fGs9PT0iQSIpKWs9IkIiO3JldHVybiBrfTsgIC8vIOWxpeattOOBjDHotbDku6XkuIvjga9C44G+44GnCi8qIOWAmeijnOOBlOOBqOOBruOAjOagueaLoOOAjeihqOekuu+8muWlvei1sOeOh+OBqOOBneOBrummrOOBruWun+e4vuOBjOmjn+OBhOmBleOBo+OBpuimi+OBiOOBquOBhOOCiOOBhuOAgeWun+e4vuODu+Wfuua6luODu+mojuaJi+OCkuS4puOBueOCiyAqLwpmdW5jdGlvbiByZWNMaW5lKHgpewogY29uc3QgcD1bXTsKIHAucHVzaCh4LmNhcmVlciYmeC5jYXJlZXIubj9g6YCa566XJHt4LmNhcmVlci5ufei1sCAz552A5YaFJHt4LmNhcmVlci50M33lm57vvIgke01hdGgucm91bmQoeC5jYXJlZXIudDMveC5jYXJlZXIubioxMDApfSXvvIlgOiLpgJrnrpfvvJrlsaXmrbTjgarjgZciKTsKIGlmKHgucmVjZW50JiZ4LnJlY2VudC5sZW5ndGgpcC5wdXNoKGDnm7Tov5EgJHt4LnJlY2VudC5zbGljZSgtNSkuam9pbigiLSIpfeedgGApOwogcmV0dXJuIHAuam9pbigi77yPIik7Cn0KZnVuY3Rpb24gYmFzZUxpbmUoeCl7cmV0dXJuIGDnqbTjgr7jg7zjg7Pjga7lubPlnYcgJHthdmdOb3RlKHgubW9kZSl9IOKGkiDjgZPjga7ppqzjga8keyh4LnBjL0FWR1t4Lm1vZGU9PT0ib2RkcyI/Im9kZHMiOiJwcm94eSJdKS50b0ZpeGVkKDEpfeWAje+8iFPiiacyLjLlgI3vvI9B4omnMS435YCN77yPQuKJpzEuM+WAje+8iWB9CmZ1bmN0aW9uIGpvY2tleUxpbmUoeCl7CiBpZigheC5qbmFtZSlyZXR1cm4gIumojuaJi++8muiqreOBv+WPluOCjOOBpuOBhOOBvuOBm+OCkyI7CiByZXR1cm4geC5qc3RhdCYmeC5qc3RhdC5uPj01P2DpqI7miYvvvJoke3guam5hbWV977yI6YGO5Y67JHt4LmpzdGF0Lm596aiO5LmXIDPnnYDlhoUke01hdGgucm91bmQoeC5qc3RhdC5yYXRlKjEwMCl9Je+8iWA6YOmojuaJi++8miR7eC5qbmFtZX3vvIjpgY7ljrvjg4fjg7zjgr/jgavoqbLlvZPjgarjgZfjgIHjgb7jgZ/jga/pqI7kuZfjgYzlsJHjgarjgYTvvIlgOwp9CmNvbnN0IGF2Z05vdGU9bW9kZT0+bW9kZT09PSJvZGRzIj8i57SEOSUiOiLntIQxMiUiOwovKiDlsaXmrbTjga7nhaflkIjnirbms4HvvIjppqzlkI3jg7vpqI7miYvlkI3jgYzpgY7ljrvjg4fjg7zjgr/jgajkuIDoh7TjgZfjgZ/jgYvvvIkgKi8KY29uc3QgbWF0Y2hJbmZvPXJlcz0+e2NvbnN0IG49cmVzLmxlbmd0aCxoPXJlcy5maWx0ZXIoeD0+eC5uPj0yKS5sZW5ndGgsaj1yZXMuZmlsdGVyKHg9Pnguam4+PTUpLmxlbmd0aDtyZXR1cm57bixoLGosbWlzczpyZXMuZmlsdGVyKHg9Pnguam48NSYmeC5qbmFtZSkubWFwKHg9Pnguam5hbWUpfX07CmFzeW5jIGZ1bmN0aW9uIHJ1bihvZGRzSW4pewogaWYoIUNVUilyZXR1cm47CiB0cnl7CiAgY29uc3Qgc3RvcmU9YXdhaXQgYnVpbGRTdG9yZShDVVIuZGF0ZSk7CiAgbGV0IG9kZHM9b2Rkc0lufHxudWxsOwogIGlmKCFvZGRzJiZDVVIub2RkczApb2Rkcz1DVVIub2RkczA7CiAgaWYoIW9kZHMmJkNVUi5wYXN0JiZDVVIucnVubmVycy5ldmVyeShyPT5yLm9kZHNBPjEpKW9kZHM9Q1VSLnJ1bm5lcnMubWFwKHI9PnIub2Rkc0EpOwogIGNvbnN0IHBvcEFycj0oIW9kZHMmJkNVUi5wYXN0JiZDVVIucnVubmVycy5ldmVyeShyPT5yLnBvcD4wKSk/Q1VSLnJ1bm5lcnMubWFwKHI9PnIucG9wKTpudWxsOwogIGNvbnN0IHJlcz1VRS5hbmFseXplKENVUixzdG9yZSxvZGRzLG51bGwscG9wQXJyKTsKICBMQVNUUkVTPXtyZXMsb2Rkcyxjb3VudDpzdG9yZS5jb3VudH07cmVuZGVyKCk7CiB9Y2F0Y2goZSl7YnVzeShmYWxzZSk7JCgib3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+6Kej5p6Q44Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfQpmdW5jdGlvbiByZW5kZXIoKXsKIGNvbnN0e3JlcyxvZGRzLGNvdW50fT1MQVNUUkVTLE49cmVzLmxlbmd0aCxjdXQ9cmVzWzBdLmN1dCxwYXN0PSEhQ1VSLnBhc3Q7CiBpZihOPDYpeyQoIm91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPjbpoK3mnKrmuoDjga7jgZ/jgoHnqbTppqzliKTlrprjga7lr77osaHlpJbjgafjgZnjgII8L3NwYW4+JztyZXR1cm59CiBjb25zdCB1c2VkPSEhcmVzWzBdLm1rdCxjYW5kcz1VRS5waWNrKHJlcyw1KTsKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5Lq65rCX6aCG77yaJHt1c2VkPyLlhaXlipvjgqrjg4PjgroiOiLjg4Tjg7zjg6vmjqjlrprvvIjpqI7miYvmiJDnuL7ovrzjgb/jg7vlrp/pmpvjga7kurrmsJfjgajjga/nlbDjgarjgorjgb7jgZnvvIkife+8j+eptOOCvuODvOODs++8miR7Y3V0feeVquebruS7pemZje+8iOWFqCR7Tn3poK3vvInvvI/lrabnv5IgJHtjb3VudC50b0xvY2FsZVN0cmluZygpfeihjDwvZGl2PmA7CiB7Y29uc3QgbT1tYXRjaEluZm8ocmVzKTtoKz1gPGRpdiBjbGFzcz0ic21hbGwiPuWxpeattOOBrueFp+WQiO+8mummrCAke20uaH0vJHttLm596aCt77yIMui1sOS7peS4iu+8ie+8j+mojuaJiyAke20uan0vJHttLm596aCtPC9kaXY+YCsobS5taXNzLmxlbmd0aD9gPGRpdiBjbGFzcz0ic21hbGwiPumojuaJi+OBruacqueFp+WQiO+8miR7ZXNjKG0ubWlzcy5zbGljZSgwLDYpLmpvaW4oIuOAgSIpKX0ke20ubWlzcy5sZW5ndGg+Nj8iIOKApiI6IiJ9PC9kaXY+YDoiIik7aWYobS5oPG0ubiouNSloKz1gPGRpdiBjbGFzcz0id2FybiBzbWFsbCI+4pqgIOmBjuWOu+i1sOOCkueFp+WQiOOBp+OBjeOBn+mmrOOBjOWwkeOBquOBhOOBn+OCgeOAgeS6iOaDs+OBruS/oemgvOW6puOBr+S9juOCgeOBp+OBme+8iOaWsOmmrOaIpuODu+iLpemnkuaIpuOAgeOBvuOBn+OBr+mmrOWQjeihqOiomOOBrumBleOBhO+8ieOAgjwvZGl2PmB9CiBoKz0iPGJyPiI7CiBpZighY2FuZHMubGVuZ3RoKWgrPSc8c3BhbiBjbGFzcz0id2FybiI+56m044K+44O844Oz44Gr44CB5a6f57i+44Gu44GC44KL6aas77yIM+i1sOS7peS4iu+8ieOBruWAmeijnOOBjOOBhOOBvuOBm+OCk++8iOaWsOmmrOaIpuODu+iLpemnkuaIpuOBquOBqe+8ieOAguOBk+OBruODrOODvOOCueOBr+WvvuixoeWkluOBp+OBmeOAgjwvc3Bhbj4nOwogY2FuZHMuZm9yRWFjaCgoeCxrKT0+ewogIGNvbnN0IGNoaXBzPXgudGFncy5tYXAodD0+YDxzcGFuIGNsYXNzPSJjaGlwICR7dC5jfSI+JHtlc2ModC50KX08L3NwYW4+YCkuam9pbigiIik7CiAgY29uc3Qgcj1DVVIucnVubmVyc1t4LmldOwogIGgrPWA8ZGl2IGNsYXNzPSJjYW5kIj48Yj4ke2srMX0uICR7ZXNjKHgubm8pfeeVqiAke2VzYyh4Lm5hbWUpfTwvYj4gPHNwYW4gY2xhc3M9InJ0IHIke3JhdGluZyh4LnBjLHgubW9kZSx4Lm4pfSI+JHtyYXRpbmcoeC5wYyx4Lm1vZGUseC5uKX08L3NwYW4+YDsKICBpZihwYXN0KWgrPWAgPHNwYW4gY2xhc3M9InNtYWxsIj7ihpIg57WQ5p6cICR7ci5hY3Q/PyItIn3nnYDvvIgke3IucG9wPz8iLSJ95Lq65rCX77yJJHtyLmFjdDw9Mz8iIOKchSI6IiJ9PC9zcGFuPmA7CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj7lpb3otbDnjocgPGI+JHsoeC5wYyoxMDApLnRvRml4ZWQoMSl9JTwvYj7vvIjnqbTjgr7jg7zjg7PlubPlnYcgJHthdmdOb3RlKHgubW9kZSl977yJ77yP5L+h6aC85bqmICR7ZXNjKHguY29uZil9PGJyPiR7ZXNjKHJlY0xpbmUoeCkpfTxicj4ke2VzYyhiYXNlTGluZSh4KSl9PGJyPiR7ZXNjKGpvY2tleUxpbmUoeCkpfWA7CiAgaWYoeC5ta3QhPW51bGwpaCs9YDxicj7luILloLTjga7mg7Plrpoz552A5YaFICR7KHgubWt0KjEwMCkudG9GaXhlZCgxKX0lIOKGkiDluILloLTjgajjga7lt64gJHt4LnZhbHVlPj0zPyIz5YCN5Lul5LiKIjp4LnZhbHVlLnRvRml4ZWQoMikrIuWAjSJ977yI5Y+C6ICD77ya5qSc6Ki844Gn44Gv5b2T44Gf44KK44Gr57WQ44Gz5LuY44GN44G+44Gb44KT44Gn44GX44Gf77yJYDsKICBoKz1gPC9kaXY+PGRpdj4ke2NoaXBzfHwnPHNwYW4gY2xhc3M9InNtYWxsIj7nm67nq4vjgaTmoLnmi6DjgarjgZc8L3NwYW4+J308L2Rpdj48L2Rpdj5gOwogfSk7CiBoKz1gPGJyPjxiPuWFqOmgreS4gOimpzwvYj4ke3Bhc3Q/Iu+8iOWun+mam+OBrue1kOaenOOBpOOBje+8iSI6Iu+8iOWNmOWLneOCquODg+OCuuOCkuWFpeOCjOOCi+OBqOWmmeWRs+OCkuioiOeul++8iSJ9PHRhYmxlPjx0aGVhZD48dHI+PHRoPummrOeVqjwvdGg+PHRoPummrOWQjTwvdGg+PHRoPumojuaJizwvdGg+PHRoPuWlvei1sOeOhzwvdGg+PHRoPumghuS9jTwvdGg+PHRoPuOCquODg+OCujwvdGg+JHtwYXN0PyI8dGg+57WQ5p6cPC90aD4iOiIifTwvdHI+PC90aGVhZD48dGJvZHk+YDsKIGZvcihjb25zdCB4IG9mIHJlcyl7Y29uc3Qgcj1DVVIucnVubmVyc1t4LmldOwogIGgrPWA8dHIke3guaG9sZT8nIHN0eWxlPSJiYWNrZ3JvdW5kOiNmZmI4MDAyMiInOicnfT48dGQ+JHtlc2MoeC5ubyl9PC90ZD48dGQ+JHtlc2MoeC5uYW1lKX08L3RkPjx0ZD4ke2VzYyh4LmpuYW1lfHwiPyIpfTwvdGQ+PHRkPiR7KHgucGMqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD4ke3gucmFua308L3RkPjx0ZD48aW5wdXQgY2xhc3M9Im9kZHMiIGRhdGEtaT0iJHt4Lml9IiB0eXBlPSJudW1iZXIiIHN0ZXA9IjAuMSIgbWluPSIxLjEiIGlucHV0bW9kZT0iZGVjaW1hbCIgdmFsdWU9IiR7b2Rkcz9vZGRzW3guaV06IiJ9IiBzdHlsZT0id2lkdGg6NjJweDtwYWRkaW5nOjRweCI+PC90ZD4ke3Bhc3Q/YDx0ZD4ke3IuYWN0Pz8iLSJ9552APC90ZD5gOiIifTwvdHI+YH0KIGgrPWA8L3Rib2R5PjwvdGFibGU+PGJ1dHRvbiBpZD0icmVjYWxjIj7jgqrjg4PjgrrjgpLlj43mmKDjgZfjgablho3oqIjnrpc8L2J1dHRvbj48YnV0dG9uIGlkPSJjbGVhcm9kZHMiIGNsYXNzPSJzdWIiPuOCquODg+OCuuOCkuOCr+ODquOCojwvYnV0dG9uPmA7CiAkKCJvdXQiKS5pbm5lckhUTUw9aDsKICQoInJlY2FsYyIpLm9uY2xpY2s9KCk9Pntjb25zdCB2PVsuLi5kb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIjb3V0IGlucHV0Lm9kZHMiKV0ubWFwKGU9PnBhcnNlRmxvYXQoZS52YWx1ZSkpO3J1bih2LmV2ZXJ5KG89Pm8+MSk/djpudWxsKX07CiAkKCJjbGVhcm9kZHMiKS5vbmNsaWNrPSgpPT57Q1VSLm9kZHMwPW51bGw7Q1VSLnBhc3Q9Q1VSLnBhc3Q7TEFTVFJFUz1udWxsO3J1bihudWxsKX07Cn0KJCgicnVuIikub25jbGljaz0oKT0+cnVuKG51bGwpOwokKCJmaWxlIikub25jaGFuZ2U9ZT0+e2NvbnN0IGY9ZS50YXJnZXQuZmlsZXNbMF07aWYoZilpbXBvcnRGaWxlKGYpLnRoZW4oKCk9PntlLnRhcmdldC52YWx1ZT0iIn0pfTsKCi8qIC0tLSDmiZXmiLvjg7vmnIjjga7lj5blvpfnirbms4HvvIhJbmRleGVkRELvvIkgLS0tICovCmNvbnN0IHBheUFsbD0oKT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oInBheSIpLm9iamVjdFN0b3JlKCJwYXkiKS5nZXRBbGwoKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHR8fFtdKTtxLm9uZXJyb3I9KCk9Pm5nKHEuZXJyb3IpfSk7CmNvbnN0IHBheVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oInBheSIsInJlYWR3cml0ZSIpO3Qub2JqZWN0U3RvcmUoInBheSIpLnB1dCh2LGspO3Qub25jb21wbGV0ZT0oKT0+e21hcmtEaXJ0eSgicGF5IixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IG1ldGFHZXQ9az0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oIm1ldGEiKS5vYmplY3RTdG9yZSgibWV0YSIpLmdldChrKTtxLm9uc3VjY2Vzcz0oKT0+b2socS5yZXN1bHQpO3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgbWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPSgpPT57bWFya0RpcnR5KCJtZXRhIixrKTtvaygpfTt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmFzeW5jIGZ1bmN0aW9uIHBheVN0YXRlKCl7YXdhaXQgc2hvd1N0YXRlKCl9CgovKiAtLS0g5YWx6YCa44Gu5Y+W5b6X77yI5YaN6Kmm6KGM44Gk44GN77yJIC0tLSAqLwpsZXQgU1lOQ0lORz1mYWxzZTsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hKU09OKHVybCx3YWl0c0FyZyl7CiBsZXQgZXJyPSIiO2NvbnN0IHdhaXRzPXdhaXRzQXJnfHx3aW5kb3cuX19XQUlUU3x8WzQwMDAsMTIwMDAsMzAwMDAsNjAwMDBdOwogZm9yKGxldCB0PTA7dDw9d2FpdHMubGVuZ3RoO3QrKyl7CiAgdHJ5ewogICBjb25zdCByPWF3YWl0IGZldGNoKHVybCk7Y29uc3QgdHh0PWF3YWl0IHIudGV4dCgpO2xldCB4PXt9O3RyeXt4PUpTT04ucGFyc2UodHh0KX1jYXRjaChlKXt9CiAgIGlmKCFyLm9rfHx4Lm9rPT09ZmFsc2Upe2NvbnN0IGU9bmV3IEVycm9yKHguZXJyb3J8fGBIVFRQICR7ci5zdGF0dXN9YCsodHh0JiYheC5lcnJvcj9g77yIJHt0eHQucmVwbGFjZSgvXHMrL2csIiAiKS5zbGljZSgwLDUwKX3vvIlgOiIiKSk7ZS5zdGF0dXM9ci5zdGF0dXM7dGhyb3cgZX0KICAgcmV0dXJuIHg7CiAgfWNhdGNoKGUpewogICBlcnI9ZS5tZXNzYWdlO2NvbnN0IHJldHJ5PSFlLnN0YXR1c3x8ZS5zdGF0dXM+PTUwMHx8ZS5zdGF0dXM9PT00Mjk7CiAgIGlmKCFyZXRyeXx8dD09PXdhaXRzLmxlbmd0aClicmVhazsKICAgaWYoU1lOQ0lORykkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YOa3t+mbkeOBruOBn+OCgSR7TWF0aC5yb3VuZCh3YWl0c1t0XS8xMDAwKX3np5LlvoXjgaPjgablho3oqabooYzjgZfjgb7jgZnigKbvvIgke2Vycn3vvIlgOwogICBhd2FpdCBzbGVlcCh3YWl0c1t0XSk7CiAgfQogfQogdGhyb3cgbmV3IEVycm9yKGVycik7Cn0KY29uc3QgTU9ERUxfVFJBSU5fRU5EPSIyMDI2LTA2LTIyIjsgICAvLyDnj77lnKjjga7jg6Ljg4fjg6vjga/jgIHjgZPjga7ml6XjgojjgorliY3jga7miJDnuL7jgaflrabnv5IKY29uc3QganN0WWVzdGVyZGF5PSgpPT5uZXcgRGF0ZShEYXRlLm5vdygpKzkqMzYwMGUzLTg2NGU1KS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOwpjb25zdCBhZGREYXlzPShkLG4pPT5uZXcgRGF0ZShuZXcgRGF0ZShkKyJUMDA6MDA6MDBaIikuZ2V0VGltZSgpK24qODY0ZTUpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7CmZ1bmN0aW9uIG1vbnRoc0JldHdlZW4oYSxiKXtjb25zdCBvdXQ9W107bGV0W3ksbV09YS5zbGljZSgwLDcpLnNwbGl0KCItIikubWFwKE51bWJlcik7Y29uc3RbeTIsbTJdPWIuc2xpY2UoMCw3KS5zcGxpdCgiLSIpLm1hcChOdW1iZXIpOwogd2hpbGUoeTx5Mnx8KHk9PT15MiYmbTw9bTIpKXtvdXQucHVzaChgJHt5fS0ke1N0cmluZyhtKS5wYWRTdGFydCgyLCIwIil9YCk7bSsrO2lmKG0+MTIpe209MTt5Kyt9fXJldHVybiBvdXR9CgovKiAtLS0g4pGgIOODh+ODvOOCv+WPluW+l++8mumBjuWOu+aIkOe4vu+8iOS6uuawl+OBpOOBje+8ie+8i+aJleaIu+OCkuOAgemWi+WCrOaXpeOBlOOBqOOBq+WPluW+l+OBl+OBpuS/neWtmCAtLS0gKi8KY29uc3QgU1lOQ19CQVRDSD00LFNZTkNfUEFSQUxMRUw9MjsKbGV0IFNTVE9QPWZhbHNlLEJBQ0tVUF9EQVRFUz1udWxsOwokKCJzeW5jU3RvcCIpLm9uY2xpY2s9KCk9PntTU1RPUD10cnVlOyQoInN5bmNTdG9wIikuZGlzYWJsZWQ9dHJ1ZX07CiQoInNlbmQiKS52YWx1ZT1qc3RZZXN0ZXJkYXkoKTsKYXN5bmMgZnVuY3Rpb24gYmFja3VwRGF0ZXMoKXsKIGlmKEJBQ0tVUF9EQVRFUylyZXR1cm4gQkFDS1VQX0RBVEVTOwogY29uc3Qgcz1uZXcgU2V0KCksZnM9YXdhaXQgaWRiQWxsKCk7CiBmb3IoY29uc3QgZiBvZiBmcyl7aWYoZi5saXZlKWNvbnRpbnVlO2Zvcihjb25zdCBvIG9mIFVFLmNzdlJvd3MoZi5jc3YpKXtjb25zdCBkPVVFLnBhcnNlRGF0ZShvLmRhdGV8fG9bIuaXpeS7mCJdKTtpZihkKXMuYWRkKGQpfWF3YWl0IHNsZWVwKDApfQogcmV0dXJuIEJBQ0tVUF9EQVRFUz1zOwp9CmFzeW5jIGZ1bmN0aW9uIGZldGNoRGF5KGJhc2UsZCl7CiBjb25zdCBkYXk9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXk/ZGF0ZT0ke2R9YCk7CiBjb25zdCByYWNlcz1kYXkucmFjZXN8fFtdO2lmKCFyYWNlcy5sZW5ndGgpdGhyb3cgbmV3IEVycm9yKCLjg6zjg7zjgrnjgYzopovjgaTjgYvjgorjgb7jgZvjgpMiKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHJhY2VzLmxlbmd0aDtpKz1TWU5DX0JBVENIKWNodW5rcy5wdXNoKHJhY2VzLnNsaWNlKGksaStTWU5DX0JBVENIKS5tYXAoeD0+eC5jbmFtZSkpOwogY29uc3Qgcm93cz1bXSxwYXlvdXRzPVtdO2xldCBpZHg9MCxmYWlsZWROPTA7CiBjb25zdCB3b3JrZXI9YXN5bmMoKT0+e3doaWxlKGlkeDxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWlkeCsrOwogIGNvbnN0IHJlcz1hd2FpdCBmZXRjaEpTT04oYCR7YmFzZX0vanJhLXJlc3VsdHM/Y25hbWVzPSR7Y2h1bmtzW2tdLm1hcChlbmNvZGVVUklDb21wb25lbnQpLmpvaW4oIiwiKX1gKTsKICByb3dzLnB1c2goLi4uKHJlcy5yb3dzfHxbXSkpO3BheW91dHMucHVzaCguLi4ocmVzLnBheW91dHN8fFtdKSk7ZmFpbGVkTis9KHJlcy5mYWlsZWR8fFtdKS5sZW5ndGh9fTsKIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oe2xlbmd0aDpNYXRoLm1pbihTWU5DX1BBUkFMTEVMLGNodW5rcy5sZW5ndGgpfSx3b3JrZXIpKTsKIGNvbnN0IGdvdD1uZXcgU2V0KHJvd3MubWFwKHI9PnIucmFjZUlkKSkuc2l6ZTsKIGZhaWxlZE49TWF0aC5tYXgoZmFpbGVkTixyYWNlcy5sZW5ndGgtZ290KTsKIHJldHVybntyb3dzLHBheW91dHMsZmFpbGVkTixyYWNlczpyYWNlcy5sZW5ndGh9Owp9CiQoInN5bmNHbyIpLm9uY2xpY2s9YXN5bmMoKT0+ewogY29uc3QgYmFzZT0kKCJ3dXJsIikudmFsdWUucmVwbGFjZSgvXC8kLywiIik7CiBjb25zdCBhPSQoInNzdGFydCIpLnZhbHVlfHwiMjAyMy0wMS0wMSIseWQ9anN0WWVzdGVyZGF5KCk7bGV0IGI9JCgic2VuZCIpLnZhbHVlfHx5ZDtpZihiPnlkKWI9eWQ7CiBpZihhPmIpeyQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD0i6ZaL5aeL5pel44GM57WC5LqG5pel44KI44KK5b6M44Gn44GZ44CCIjtyZXR1cm59CiBTU1RPUD1mYWxzZTtTWU5DSU5HPXRydWU7JCgic3luY0dvIikuZGlzYWJsZWQ9dHJ1ZTskKCJzeW5jU3RvcCIpLmRpc2FibGVkPWZhbHNlOwogY29uc3Qgc3Q9e2RheXM6MCxyYWNlczowLHNraXBwZWQ6MCxmYWlsOltdLHQwOkRhdGUubm93KCl9O2xldCBjb25zZWM9MDsKIHRyeXsKICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9IuS/neWtmOa4iOOBv+ODh+ODvOOCv+OCkueiuuiqjeS4reKApiI7CiAgY29uc3QgZmlsZXM9YXdhaXQgaWRiQWxsKCksaGF2ZUxpdmU9bmV3IFNldChmaWxlcy5maWx0ZXIoZj0+Zi5saXZlJiYoZi5yb3dzfHxbXSkubGVuZ3RoKS5tYXAoZj0+Zi5kYXRlKSk7CiAgY29uc3QgaGF2ZVBheT1uZXcgU2V0KChhd2FpdCBwYXlBbGwoKSkuZmlsdGVyKHA9PiFwLmZhaWxlZCkubWFwKHA9PnAuZGF0ZSkpOwogIGNvbnN0IGJrPWF3YWl0IGJhY2t1cERhdGVzKCk7CiAgY29uc3QgbW9udGhzPW1vbnRoc0JldHdlZW4oYSxiKSxjdXJNb250aD15ZC5zbGljZSgwLDcpOwogIGZvcihsZXQgbWk9MDttaTxtb250aHMubGVuZ3RoO21pKyspewogICBpZihTU1RPUClicmVhaztjb25zdCBtb250aD1tb250aHNbbWldOwogICBpZihtb250aDxjdXJNb250aCYmYXdhaXQgbWV0YUdldCgibW9udGg6Iittb250aCkpe2NvbnRpbnVlfQogICAkKCJzeW5jU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7bW9udGh977yIJHttaSsxfS8ke21vbnRocy5sZW5ndGh95pyI77yJ6ZaL5YKs5pel44KS56K66KqN5Lit4oCmIOWPluW+l+a4iOOBvyR7c3QuZGF5c33ml6VgOwogICBsZXQgZGF5czt0cnl7ZGF5cz0oYXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1kYXlzP21vbnRoPSR7bW9udGh9YCkpLmRheXN8fFtdO2NvbnNlYz0wfWNhdGNoKGUpe3N0LmZhaWwucHVzaChgJHttb250aH3vvJoke2UubWVzc2FnZX1gKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgIGRheXM9ZGF5cy5maWx0ZXIoZD0+ZD49YSYmZDw9Yik7bGV0IG1vbnRoT2s9dHJ1ZTsKICAgZm9yKGNvbnN0IGQgb2YgZGF5cyl7CiAgICBpZihTU1RPUCl7bW9udGhPaz1mYWxzZTticmVha30KICAgIGNvbnN0IG5lZWRSb3dzPSFoYXZlTGl2ZS5oYXMoZCkmJiFiay5oYXMoZCksbmVlZFBheT0haGF2ZVBheS5oYXMoZCk7CiAgICBpZighbmVlZFJvd3MmJiFuZWVkUGF5KXtzdC5za2lwcGVkKys7Y29udGludWV9CiAgICBjb25zdCBlbD1NYXRoLnJvdW5kKChEYXRlLm5vdygpLXN0LnQwKS8xMDAwKTsKICAgICQoInN5bmNTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtkfSDjgpLlj5blvpfkuK3vvIgke21pKzF9LyR7bW9udGhzLmxlbmd0aH3mnIjvvIlcbuWPluW+lyR7c3QuZGF5c33ml6XvvI8ke3N0LnJhY2VzLnRvTG9jYWxlU3RyaW5nKCl944Os44O844K577yP5aSx5pWXJHtzdC5mYWlsLmxlbmd0aH3vvI/ntYzpgY4ke01hdGguZmxvb3IoZWwvNjApfeWIhiR7ZWwlNjB956eSYDsKICAgIHRyeXsKICAgICBjb25zdCByPWF3YWl0IGZldGNoRGF5KGJhc2UsZCk7CiAgICAgaWYoci5mYWlsZWROKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8iCR7ci5mYWlsZWROfVLlpLHmlZfvvIlgKTtpZigrK2NvbnNlYz49Myl7c3Quc3RvcHBlZD10cnVlO1NTVE9QPXRydWV9Y29udGludWV9CiAgICAgaWYobmVlZFJvd3Mpe2F3YWl0IGlkYlB1dChgbGl2ZToke2R9YCx7bGl2ZTp0cnVlLGRhdGU6ZCxyb3dzOnIucm93c30pO2hhdmVMaXZlLmFkZChkKX0KICAgICBhd2FpdCBwYXlQdXQoZCx7ZGF0ZTpkLHJhY2VzOnIucGF5b3V0cyxmYWlsZWQ6MH0pO2hhdmVQYXkuYWRkKGQpOwogICAgIHN0LmRheXMrKztzdC5yYWNlcys9ci5yYWNlcztjb25zZWM9MDsKICAgIH1jYXRjaChlKXttb250aE9rPWZhbHNlO3N0LmZhaWwucHVzaChgJHtkfe+8miR7ZS5tZXNzYWdlfWApO2lmKCsrY29uc2VjPj0zKXtzdC5zdG9wcGVkPXRydWU7U1NUT1A9dHJ1ZX19CiAgICBhd2FpdCBzbGVlcCg0MDApOwogICB9CiAgIGlmKG1vbnRoT2smJm1vbnRoPGN1ck1vbnRoKWF3YWl0IG1ldGFQdXQoIm1vbnRoOiIrbW9udGgsdHJ1ZSk7CiAgfQogfWNhdGNoKGUpe3N0LmZhaWwucHVzaChTdHJpbmcoZS5tZXNzYWdlfHxlKSl9CiBmaW5hbGx5ewogIFNZTkNJTkc9ZmFsc2U7U1RPUkU9bnVsbDtTVE9SRV9LRVk9IiI7JCgic3luY0dvIikuZGlzYWJsZWQ9ZmFsc2U7JCgic3luY1N0b3AiKS5kaXNhYmxlZD10cnVlOwogICQoInN5bmNTdGF0dXMiKS5pbm5lckhUTUw9YCR7c3Quc3RvcHBlZD8i6YCj57aa44GX44Gm5aSx5pWX44GX44Gf44Gf44KB5Lit5pat44GX44G+44GX44Gf77yIQ2xvdWRmbGFyZeWBtOOBrua3t+mbkeODu+WItumZkOOBruWPr+iDveaAp++8ieOAguWwkeOBl+aZgumWk+OCkuOBiuOBhOOBpuOCguOBhuS4gOW6puaKvOOBl+OBpuOBj+OBoOOBleOBhOOAglxuIjoiIn0ke1NTVE9QJiYhc3Quc3RvcHBlZD8i5YGc5q2i44GX44G+44GX44Gf44CCIjooc3Quc3RvcHBlZD8iIjoi5a6M5LqG44CCIil95LuK5Zue44Gu5Y+W5b6X77yaJHtzdC5kYXlzfeaXpe+8jyR7c3QucmFjZXMudG9Mb2NhbGVTdHJpbmcoKX3jg6zjg7zjgrnvvIjkv53lrZjmuIjjgb/jgafjgrnjgq3jg4Pjg5cgJHtzdC5za2lwcGVkfeaXpe+8iWArKHN0LmZhaWwubGVuZ3RoP2BcbjxzcGFuIGNsYXNzPSJ3YXJuIj7lpLHmlZcgJHtzdC5mYWlsLmxlbmd0aH3ku7bvvJoke2VzYyhzdC5mYWlsLnNsaWNlKDAsNCkuam9pbigi44CBIikpfSR7c3QuZmFpbC5sZW5ndGg+ND8iIOKApiI6IiJ9XG7vvIjjgoLjgYbkuIDluqbmirzjgZnjgajjgIHlpLHmlZfjgZfjgZ/ml6XjgaDjgZHjgoTjgornm7TjgZfjgb7jgZnvvIk8L3NwYW4+YDoiIik7CiAgYXdhaXQgc2hvd1N0YXRlKCk7YmtTY2hlZHVsZSgpOwogfQp9OwoKLyogLS0tIOaJleaIu+OBruabuOOBjeWHuuOBl+ODu+iqreOBv+i+vOOBvyAtLS0gKi8KJCgicGF5RXhwIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXJldHVybiBhbGVydCgi5omV5oi744OH44O844K/44GM44GC44KK44G+44Gb44KT44CCIik7CiBjb25zdCBhPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTthLmhyZWY9VVJMLmNyZWF0ZU9iamVjdFVSTChuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocHMpXSx7dHlwZToiYXBwbGljYXRpb24vanNvbiJ9KSk7CiBhLmRvd25sb2FkPWBrZWliYV9wYXlvdXRzXyR7bmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApfS5qc29uYDthLmNsaWNrKCk7c2V0VGltZW91dCgoKT0+VVJMLnJldm9rZU9iamVjdFVSTChhLmhyZWYpLDEwMDApfTsKJCgicGF5SW1wIikub25jaGFuZ2U9YXN5bmMgZT0+ewogY29uc3QgZj1lLnRhcmdldC5maWxlc1swXTtpZighZilyZXR1cm47CiB0cnl7Y29uc3Qgaj1KU09OLnBhcnNlKGF3YWl0IGYudGV4dCgpKTtjb25zdCBhcnI9QXJyYXkuaXNBcnJheShqKT9qOihqLnJhY2VzP1tqXTpbXSk7CiAgY29uc3QgYnlEYXRlPW5ldyBNYXAoKTsKICBmb3IoY29uc3QgeCBvZiBhcnIpe2lmKHgmJkFycmF5LmlzQXJyYXkoeC5yYWNlcykmJnguZGF0ZSlieURhdGUuc2V0KHguZGF0ZSx7ZGF0ZTp4LmRhdGUscmFjZXM6eC5yYWNlcyxmYWlsZWQ6eC5mYWlsZWR8fDB9KX0KICBmb3IoY29uc3RbZCxyXW9mIGJ5RGF0ZSlhd2FpdCBwYXlQdXQoZCxyKTsKICBhd2FpdCBzaG93U3RhdGUoKTtia1NjaGVkdWxlKCk7CiB9Y2F0Y2goZXJyKXskKCJidE91dCIpLmlubmVySFRNTD1gPHNwYW4gY2xhc3M9Indhcm4iPuiqreOBv+i+vOOBv+OCqOODqeODvO+8miR7ZXNjKGVyci5tZXNzYWdlKX08L3NwYW4+YH0KIGUudGFyZ2V0LnZhbHVlPSIiOwp9OwoKLyogLS0tIOKRoC0yIOikh+WLneWbnuWPjueOh+OBruaknOiovCAtLS0gKi8KJCgiYnRSdW4iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIHRyeXsKICBjb25zdCBwcz1hd2FpdCBwYXlBbGwoKTtpZighcHMubGVuZ3RoKXskKCJidE91dCIpLmlubmVySFRNTD0nPHNwYW4gY2xhc3M9Indhcm4iPuaJleaIu+ODh+ODvOOCv+OBjOOBguOCiuOBvuOBm+OCk+OAguWFiOOBq+KRoOOBp+WPluW+l+OBl+OBpuOBj+OBoOOBleOBhOOAgjwvc3Bhbj4nO3JldHVybn0KICBjb25zdCBwYXlCeUlkPXt9O3BzLmZvckVhY2gocD0+KHAucmFjZXN8fFtdKS5mb3JFYWNoKHg9PntwYXlCeUlkW3gucmFjZUlkXT14fSkpOwogIGNvbnN0IHN0YXJ0PSQoImJ0U3RhcnQiKS52YWx1ZXx8IjIwMTktMDEtMDEiOwogIGNvbnN0IHBkYXRlcz1wcy5tYXAocD0+cC5kYXRlKS5maWx0ZXIoZD0+ZD49c3RhcnQpLnNvcnQoKTsKICBpZighcGRhdGVzLmxlbmd0aCl7JCgiYnRPdXQiKS5pbm5lckhUTUw9JzxzcGFuIGNsYXNzPSJ3YXJuIj7plovlp4vml6Xku6XpmY3jga7miZXmiLvjgYzjgYLjgorjgb7jgZvjgpPjgII8L3NwYW4+JztyZXR1cm59CiAgY29uc3Qgc3BsaXQ9cGRhdGVzW01hdGguZmxvb3IocGRhdGVzLmxlbmd0aC8yKV07CiAgYnVzeSh0cnVlLCLmiJDnuL7jgpLoqq3jgb/ovrzjgb/kuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3QgbWFwPW5ldyBNYXAoKTsKICBhd2FpdCBmb3JFYWNoUm93KHI9PntpZighci5kYXRlfHwhci5yYWNlSWQpcmV0dXJuO2NvbnN0IGs9ci5kYXRlKyJ8IityLnJhY2VJZDtsZXQgeD1tYXAuZ2V0KGspO2lmKCF4KW1hcC5zZXQoayx4PXtpZDpyLnJhY2VJZCxkYXRlOnIuZGF0ZSxyb3dzOltdfSk7eC5yb3dzLnB1c2gocil9KTsKICBjb25zdCByYWNlcz1bLi4ubWFwLnZhbHVlcygpXS5zb3J0KChhLGIpPT5hLmRhdGU8Yi5kYXRlPy0xOmEuZGF0ZT5iLmRhdGU/MTphLmlkPGIuaWQ/LTE6MSk7CiAgYnVzeSh0cnVlLCLjg5Djg4Pjgq/jg4bjgrnjg4jkuK3igKYiKTthd2FpdCBzbGVlcCgzMCk7CiAgY29uc3Qgb3V0PVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkR9KTsKICBidXN5KHRydWUsIuOCquODg+OCuuacquWFpeWKm+OBruWgtOWQiOOCkuaknOiovOS4reKApiIpO2F3YWl0IHNsZWVwKDMwKTsKICBjb25zdCBvdXRQPVVFLmJhY2t0ZXN0KHJhY2VzLHBheUJ5SWQse3N0YXJ0LHNwbGl0LG9vczpNT0RFTF9UUkFJTl9FTkQscHJveHk6dHJ1ZX0pO2J1c3koZmFsc2UpOwogIGNvbnN0IEw9e3RvcDE6IuODhOODvOODqzHkvY0iLHRvcDI6IuS4iuS9jTLpoK0iLHRvcDM6IuS4iuS9jTPpoK0iLGFsbEhvbGU6IueptOOCvuODvOODs+WFqOmgre+8iOWfuua6lu+8iSIsdmFsdWU6IuWmmeWRszEuM+WAjeS7peS4iiIsYXhpczoi6YmE5p2/6Lu477yIMC45MuS7peS4iuODu+OCquODg+OCuuaZgu+8iSJ9OwogIGNvbnN0IHBjdD14PT4oeCoxMDApLnRvRml4ZWQoMCkrIiUiLGM9eD0+eCYmeC5iZXRzP2Ake3BjdCh4LnJvaSl9PHNwYW4gY2xhc3M9InNtYWxsIj7CsSR7KHguc2UqMTk2KS50b0ZpeGVkKDApfTwvc3Bhbj5gOiItIjsKICBjb25zdCB0Ymw9KG8sdGl0bGUpPT57CiAgIGxldCB0PWA8Yj4ke3RpdGxlfTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGhICR7by5yYWNlcy50b0xvY2FsZVN0cmluZygpfeODrOODvOOCuTwvZGl2Pjx0YWJsZT48dGhlYWQ+PHRyPjx0aD7osrfjgYTmlrk8L3RoPjx0aD48L3RoPjx0aD7os7zlhaXmlbA8L3RoPjx0aD7nmoTkuK3njoc8L3RoPjx0aD7lm57lj47njocoOTUl5bmFKTwvdGg+PHRoPuWJjeWNijwvdGg+PHRoPuW+jOWNijwvdGg+PHRoPuWtpue/kuW+jDwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogICBmb3IoY29uc3QgayBvZiBPYmplY3Qua2V5cyhMKSl7Y29uc3Qgdj1vLnN0YXRzW2tdO2lmKCF2LmFsbC5iZXRzKWNvbnRpbnVlOwogICAgdCs9YDx0cj48dGQ+JHtMW2tdfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PHRkPiR7di5DLmJldHM/YCR7cGN0KHYuQy5yb2kpfTxzcGFuIGNsYXNzPSJzbWFsbCI+wrEkeyh2LkMuc2UqMTk2KS50b0ZpeGVkKDApfe+8iCR7di5DLmJldHMudG9Mb2NhbGVTdHJpbmcoKX3vvIk8L3NwYW4+YDoiLSJ9PC90ZD48L3RyPmB9CiAgIHJldHVybiB0KyI8L3Rib2R5PjwvdGFibGU+In07CiAgbGV0IGg9YDxkaXYgY2xhc3M9InNtYWxsIj4ke3N0YXJ0feOAnO+8j+WJjeWNiu+8nSR7c3BsaXR944KI44KK5YmN44CB5b6M5Y2K77yd5Lul6ZmN77yP5ZCEMTAw5YaGPC9kaXY+PGJyPmArdGJsKG91dCwi4pGgIOOCquODg+OCuuWFpeWKm+aZgu+8iOWun+mam+OBruS6uuawl+OBp+eptOOCvuODvOODs+OCkuWIpOWumu+8iSIpKyI8YnI+Iit0Ymwob3V0UCwi4pGhIOOCquODg+OCuuacquWFpeWKm+aZgu+8iOODhOODvOODq+aOqOWumuOBruS6uuawl+OBp+WIpOWumu+8iSIpOwogIC8vIOadoeS7tuWIpe+8iOODhOODvOODqzHkvY3jga7lm57lj47njofvvIkKICBjb25zdCBzZWdSb3dzPU9iamVjdC5lbnRyaWVzKG91dC5zZWdzKS5maWx0ZXIoKFssdl0pPT52LmFsbC5iZXRzPj0zMDApLnNvcnQoKGEsYik9PmFbMF08YlswXT8tMToxKTsKICBpZihzZWdSb3dzLmxlbmd0aCl7aCs9YDxicj48Yj7ikaIg44OE44O844OrMeS9jeOBruadoeS7tuWIpe+8iOKRoOOBruWgtOWQiO+8iTwvYj48ZGl2IGNsYXNzPSJzbWFsbCI+6LO85YWlMzAw5Zue5Lul5LiK44Gu5p2h5Lu244Gu44G/44CC5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44GL44KS6KaL44Gm44GP44Gg44GV44GE44CCPC9kaXY+PHRhYmxlPjx0aGVhZD48dHI+PHRoPuadoeS7tjwvdGg+PHRoPjwvdGg+PHRoPuizvOWFpeaVsDwvdGg+PHRoPueahOS4reeOhzwvdGg+PHRoPuWbnuWPjueOhyg5NSXluYUpPC90aD48dGg+5YmN5Y2KPC90aD48dGg+5b6M5Y2KPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5PmA7CiAgIGZvcihjb25zdCBbayx2XSBvZiBzZWdSb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKGspfTwvdGQ+PHRkPjwvdGQ+PHRkPiR7di5hbGwuYmV0cy50b0xvY2FsZVN0cmluZygpfTwvdGQ+PHRkPiR7KHYuYWxsLmhpdFJhdGUqMTAwKS50b0ZpeGVkKDEpfSU8L3RkPjx0ZD48Yj4ke2Modi5hbGwpfTwvYj48L3RkPjx0ZD4ke3YuQS5iZXRzP3BjdCh2LkEucm9pKToiLSJ9PC90ZD48dGQ+JHt2LkIuYmV0cz9wY3Qodi5CLnJvaSk6Ii0ifTwvdGQ+PC90cj5gOwogICBoKz0iPC90Ym9keT48L3RhYmxlPiJ9CiAgaCs9YDxkaXYgY2xhc3M9InNtYWxsIj48YnI+6KaL5pa577ya44CM5a2m57+S5b6M44CN44Gv44CB44Oi44OH44Or44Gu5a2m57+S44Gr5L2/44Gj44Gm44GE44Gq44GE5pyf6ZaT77yIJHtNT0RFTF9UUkFJTl9FTkR95Lul6ZmN77yJ44Gn44CB5pyA44KC5L+h6aC844Gn44GN44KL5YiX44Gn44GZ44CC44Gd44KM5Lul5YmN44Gu5pyf6ZaT44Gv44CB44Oi44OH44Or44GM562U44GI44KS6KaL44Gm44GE44KL44Gf44KB44CB44KE44KE6Imv44GP5Ye644G+44GZ44CC5Zue5Y+O546H44Gu44CMwrHjgI3jga85NSXjga7oqqTlt67jga7luYXjgafjgIExMDAl44KS5LiL5Zue44KL5LiL6ZmQ44Gq44KJ5Yip55uK44Go44Gv6KiA44GI44G+44Gb44KT44CC5p2h5Lu25Yil44Gv44CB5o6i44GZ44G744Gp5YG254S244Gu6auY44GE5p2h5Lu244KS5ou+44GE44KE44GZ44GE44Gu44Gn44CB5YmN5Y2K44O75b6M5Y2K44Gu5Lih5pa544Gn5ZCM44GY5ZCR44GN44Gu44KC44Gu44Gg44GR44KS5Y+C6ICD44Gr44GX44Gm44GP44Gg44GV44GE44CC5aaZ5ZGz77yI5biC5aC044Go44Gu5beu77yJ44Gv44CB5qSc6Ki844Gn5Z+65rqW44KI44KK5oKq44GL44Gj44Gf44Gf44KB44CB5Yik5pat44Gr44Gv5L2/44KP44Gq44GE44Gn44GP44Gg44GV44GE44CCPC9kaXY+YDsKICAkKCJidE91dCIpLmlubmVySFRNTD1oOwogfWNhdGNoKGUpe2J1c3koZmFsc2UpOyQoImJ0T3V0IikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5qSc6Ki844Ko44Op44O877yaJHtlc2MoZS5tZXNzYWdlfHxlKX08L3NwYW4+YH0KfTsKCi8qIC0tLSDjgqrjg4Pjgrrlj5blvpfvvIgvanJhLW9kZHPvvJrlvZPml6Xjg7vliY3ml6Xlo7Ljgorjga7ljZjli53jgqrjg4PjgrrvvIkgLS0tICovCmxldCBPRERTPXt9OwpmdW5jdGlvbiBvZGRzRm9yKHJhY2UpewogY29uc3QgbT1yYWNlJiZyYWNlLmtleT9PRERTW3JhY2Uua2V5XTpudWxsO2lmKCFtKXJldHVybiBudWxsOwogY29uc3QgYXJyPXJhY2UucnVubmVycy5tYXAocj0+bVtyLm51bV0pO3JldHVybiBhcnIuZXZlcnkobz0+bz4xKT9hcnI6bnVsbDsKfQovKiDjgqrjg4Pjgrrlj5blvpfvvJrikaDlh7rppqzooajjgYvjgonmi77jgaPjgZ/jgqrjg4PjgrrnlLvpnaLjgpLnm7TmjqXoqq3jgoAg4oaSIOKRoeWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOBoOOBkeOAgeODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhuOAggogICDmm7TmlrDjga7jgajjgY3jgIHlj5blvpfjgavlpLHmlZfjgZfjgZ/jg6zjg7zjgrnjga7liY3lm57jga7jgqrjg4Pjgrrjga/mtojjgZXjgarjgYTjgIIgKi8KbGV0IE9ERFNfRElBRz0iIjsKYXN5bmMgZnVuY3Rpb24gZmV0Y2hPZGRzKCl7CiBpZighV1JBQ0VTLmxlbmd0aClyZXR1cm57Z290OjAsdG90YWw6MH07CiBjb25zdCBiYXNlPSQoInd1cmwiKS52YWx1ZS5yZXBsYWNlKC9cLyQvLCIiKSxkPVdEQVRFLGtleU9mPXI9PmAke1N0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKX0tJHtOdW1iZXIoci5yYWNlTnVtYmVyKXx8MH1gOwogbGV0IGRpYWc9W10sZXJyPSIiOwogLy8g4pGgIOebtOaOpe+8iOWHuummrOihqOOBq+ODquODs+OCr+OBjOOBguOCi+ODrOODvOOCue+8iQogY29uc3Qgd2l0aExpbms9V1JBQ0VTLmZpbHRlcihyPT5yLm9kZHNDbmFtZSksYnlDbmFtZT1uZXcgTWFwKHdpdGhMaW5rLm1hcChyPT5bci5vZGRzQ25hbWUscl0pKTsKIGNvbnN0IGNodW5rcz1bXTtmb3IobGV0IGk9MDtpPHdpdGhMaW5rLmxlbmd0aDtpKz02KWNodW5rcy5wdXNoKHdpdGhMaW5rLnNsaWNlKGksaSs2KS5tYXAocj0+ci5vZGRzQ25hbWUpKTsKIGxldCBjaT0wOwogY29uc3Qgd29ya2VyPWFzeW5jKCk9Pnt3aGlsZShjaTxjaHVua3MubGVuZ3RoKXtjb25zdCBrPWNpKys7CiAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2NuYW1lcz0ke2NodW5rc1trXS5tYXAoZW5jb2RlVVJJQ29tcG9uZW50KS5qb2luKCIsIil9YCxbMTUwMF0pOwogICBmb3IoY29uc3QgaXQgb2YgKHguaXRlbXN8fFtdKSl7Y29uc3Qgcj1ieUNuYW1lLmdldChpdC5jbmFtZSk7aWYocilPRERTW2tleU9mKHIpXT1pdC5vZGRzfQogICBpZigoeC5mYWlsZWR8fFtdKS5sZW5ndGgpZGlhZy5wdXNoKC4uLnguZmFpbGVkLnNsaWNlKDAsMikubWFwKGY9PmYucmVhc29uKSk7CiAgIGlmKHguc2FtcGxlJiYhT0REU19ESUFHKU9ERFNfRElBRz0i55S76Z2i44Gu5LiA6YOo77yaIitTdHJpbmcoeC5zYW1wbGUpLnNsaWNlKDAsMjYwKTsKICB9Y2F0Y2goZSl7ZXJyPWUubWVzc2FnZX19fTsKIGF3YWl0IFByb21pc2UuYWxsKFt3b3JrZXIoKSx3b3JrZXIoKV0pOwogLy8g4pGhIOWPluOCjOOBquOBi+OBo+OBn+ODrOODvOOCueOCkuOAgeaXpeS7mOODu+mWi+WCrOWgtOOBruODoeODi+ODpeODvOe1jOeUseOBp+ijnOOBhgogY29uc3QgbWlzc2luZz1XUkFDRVMuZmlsdGVyKHI9PiFPRERTW2tleU9mKHIpXSk7CiBpZihtaXNzaW5nLmxlbmd0aCl7CiAgY29uc3QgdmVudWVzPVsuLi5uZXcgU2V0KG1pc3NpbmcubWFwKHI9PlN0cmluZyhyLnZlbnVlQ29kZXx8IiIpLnBhZFN0YXJ0KDIsIjAiKSkpXS5maWx0ZXIoQm9vbGVhbik7CiAgZm9yKGNvbnN0IHYgb2YgdmVudWVzKXsKICAgdHJ5e2NvbnN0IHg9YXdhaXQgZmV0Y2hKU09OKGAke2Jhc2V9L2pyYS1vZGRzP2RhdGU9JHtkfSZ2ZW51ZT0ke3Z9YCxbMTUwMF0pOwogICAgZm9yKGNvbnN0IHIgb2YgKHgucmFjZXN8fFtdKSlPRERTW2Ake1N0cmluZyhyLnZlbnVlQ29kZSkucGFkU3RhcnQoMiwiMCIpfS0ke3IucmFjZU5vfWBdPXIub2RkczsKICAgIGlmKCEoeC5yYWNlc3x8W10pLmxlbmd0aClkaWFnLnB1c2goLi4uKHguZGlhZ25vc3RpY3N8fFtdKS5zbGljZSgwLDQpLm1hcCh6PT50eXBlb2Ygej09PSJzdHJpbmciP3o6SlNPTi5zdHJpbmdpZnkoeikpKTsKICAgfWNhdGNoKGUpe2Vycj1lLm1lc3NhZ2U7ZGlhZy5wdXNoKGUubWVzc2FnZSl9fQogfQogY29uc3QgZ290PVdSQUNFUy5maWx0ZXIocj0+T0REU1trZXlPZihyKV0pLmxlbmd0aDsKIE9ERFNfRElBRz1nb3Q/IiI6KE9ERFNfRElBRysoZXJyPyLvvI/nkIbnlLHvvJoiK2VycjoiIikrKGRpYWcubGVuZ3RoPyLvvI/oqLrmlq3vvJoiK1suLi5uZXcgU2V0KGRpYWcpXS5qb2luKCIgfCAiKS5zbGljZSgwLDUwMCk6IiIpKTsKIHJldHVybntnb3QsdG90YWw6V1JBQ0VTLmxlbmd0aH07Cn0KJCgib2Rkc0dldCIpLm9uY2xpY2s9YXN5bmMoKT0+ewogaWYoIVdSQUNFUy5sZW5ndGgpcmV0dXJuOwogJCgib2Rkc0dldCIpLmRpc2FibGVkPXRydWU7T0REU19ESUFHPSIiOyQoIndzdGF0dXMiKS50ZXh0Q29udGVudD0i44Kq44OD44K65Y+W5b6X5Lit4oCmIjsKIHRyeXtjb25zdCByPWF3YWl0IGZldGNoT2RkcygpOwogICQoIndzdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCueWPluW+l++8j+OCquODg+OCuiAke3IuZ290feODrOODvOOCueWIhmArKHIuZ290PyIiOiJcbuOCquODg+OCuuOCkuWPluW+l+OBp+OBjeOBvuOBm+OCk+OBp+OBl+OBn++8iOeZuuWjsuWJjeOAgeOBvuOBn+OBr+eUu+mdouani+mAoOOBrumBleOBhO+8ieOAgiIrKE9ERFNfRElBRz8iXG4iK09ERFNfRElBRzoiIikpOwogfWZpbmFsbHl7JCgib2Rkc0dldCIpLmRpc2FibGVkPWZhbHNlfQogcmVuZGVyVmVudWVCdXR0b25zKFdEQVRFKTsKfTsKCi8qIC0tLSDimIUg5pys5pel44Gu5aW96LWw56m06aas77yI44Ov44Oz44K/44OD44OX77yJIC0tLSAqLwpjb25zdCBqc3RUb2RheT0oKT0+bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsKJCgidGRhdGUiKS52YWx1ZT1qc3RUb2RheSgpOwokKCJ0b2RheUdvIikub25jbGljaz1hc3luYygpPT57CiBjb25zdCBkPSQoInRkYXRlIikudmFsdWU7aWYoIWQpcmV0dXJuOwogJCgidG9kYXlHbyIpLmRpc2FibGVkPXRydWU7JCgidG9kYXlPdXQiKS5pbm5lckhUTUw9IiI7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i5Ye66aas6KGo44KS5Y+W5b6X5Lit4oCmIjsKIHRyeXsKICAkKCJ3ZGF0ZSIpLnZhbHVlPWQ7YXdhaXQgJCgid2dldCIpLm9uY2xpY2soKTsKICBpZighV1JBQ0VTLmxlbmd0aCl7CiAgICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9JCgid3N0YXR1cyIpLnRleHRDb250ZW50OwogICBpZihBVkFJTC5sZW5ndGgpeyQoInRvZGF5T3V0IikuaW5uZXJIVE1MPUFWQUlMLm1hcCh4PT5gPGJ1dHRvbiBjbGFzcz0ic3ViIiBkYXRhLWQ9IiR7eH0iPiR7eH08L2J1dHRvbj5gKS5qb2luKCIiKTsKICAgICQoInRvZGF5T3V0IikucXVlcnlTZWxlY3RvckFsbCgiYnV0dG9uW2RhdGEtZF0iKS5mb3JFYWNoKGJ0PT5idC5vbmNsaWNrPSgpPT57JCgidGRhdGUiKS52YWx1ZT1idC5kYXRhc2V0LmQ7JCgidG9kYXlHbyIpLmNsaWNrKCl9KX0KICAgcmV0dXJufQogICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnlj5blvpfjgILjgqrjg4PjgrrjgpLnorroqo3kuK3igKZgOwogIGF3YWl0ICQoIm9kZHNHZXQiKS5vbmNsaWNrKCk7CiAgY29uc3Qgbj1PYmplY3Qua2V5cyhPRERTKS5sZW5ndGg7CiAgJCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD1gJHtXUkFDRVMubGVuZ3RofeODrOODvOOCue+8j+OCquODg+OCuiAke25944Os44O844K55YiGYCsobj8iIjoi77yI44Kq44OD44K65pyq5Y+W5b6X77ya44OE44O844Or5o6o5a6a44Gu5Lq65rCX44Gn5Yik5a6a77yJIik7CiAgYXdhaXQgcnVuQWxsKCJ0b2RheU91dCIpO1RPREFZX1NIT1dOPXRydWU7YXV0b1N0YXJ0KCk7CiB9Y2F0Y2goZSl7JCgidG9kYXlTdGF0dXMiKS50ZXh0Q29udGVudD0i44Ko44Op44O877yaIitlLm1lc3NhZ2V9CiBmaW5hbGx5eyQoInRvZGF5R28iKS5kaXNhYmxlZD1mYWxzZX0KfTsKJCgidG9kYXlVcGQiKS5vbmNsaWNrPWFzeW5jKCk9PnsKICQoInRvZGF5U3RhdHVzIikudGV4dENvbnRlbnQ9IuWtpue/kuODh+ODvOOCv+OBruacgOe1guaXpeOCkueiuuiqjeS4reKApiI7CiBsZXQgbT0iIjthd2FpdCBmb3JFYWNoUm93KHI9PntpZihyLmRhdGU+bSltPXIuZGF0ZX0pOwogY29uc3QgZnJvbT1tP2FkZERheXMobSwxKToiMjAyMy0wMS0wMSIsdG89anN0WWVzdGVyZGF5KCk7CiBpZihmcm9tPnRvKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWDlrabnv5Ljg4fjg7zjgr/jga/jgZnjgafjgavmnIDmlrDjgafjgZnvvIjmnIDntYLml6UgJHttfe+8ieOAgmA7cmV0dXJufQogJCgic3N0YXJ0IikudmFsdWU9ZnJvbTskKCJzZW5kIikudmFsdWU9dG87CiAkKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke2Zyb21944CcJHt0b30g44Gu5oiQ57i+44KS5Y+W5b6X44GX44G+44GZ44CC6YCy5o2X44Gv44CM4pGgIOODh+ODvOOCv+WPluW+l+OAjeOBruashOOBq+WHuuOBvuOBmeOAgmA7CiAkKCJzeW5jR28iKS5jbGljaygpOyQoInN5bmNTdGF0dXMiKS5zY3JvbGxJbnRvVmlldyh7YmVoYXZpb3I6InNtb290aCJ9KTsKfTsKCi8qIC0tLSDikaQg6YmE5p2/6Lu46aasIC8g4pGlIOWFqOODrOODvOOCueOBruazouS5seW6pu+8iOeptOmmrOS6iOaDs+OBqOOBr+WIpeOBruioiOeul++8iSAtLS0gKi8KY29uc3QgR1JBREVfQ09MT1I9e1NTUzoiI2Q5MmQyMCIsU1M6IiNmMDQ0MzgiLFM6IiNmNzkwMDkiLEE6IiMxNjY3ZDkiLEI6IiM2NjcwODUiLEM6IiM5OGEyYjMifTsKY29uc3QgR1JBREVfT1JERVI9WyJTU1MiLCJTUyIsIlMiLCJBIiwiQiIsIkMiXTsKJCgiYWRhdGUiKS52YWx1ZT1qc3RUb2RheSgpOwpmdW5jdGlvbiByYWNlTGFiZWwocixuKXtyZXR1cm4gYCR7ci52ZW51ZU5hbWV8fHIudmVudWV8fCIifSR7ci5yYWNlTnVtYmVyfHwiIn1SICR7ci5yYWNlTmFtZXx8IiJ977yIJHtyLnN1cmZhY2V8fCI/In0ke3IuZGlzdGFuY2V8fCI/In1t44O7JHtufemgre+8iWB9CmFzeW5jIGZ1bmN0aW9uIHJlbmRlckF4aXNVcHNldChkKXsKIGNvbnN0IHN0b3JlPWF3YWl0IGJ1aWxkU3RvcmUoZCk7CiBjb25zdCBycz1bLi4uV1JBQ0VTXS5zb3J0KChhLGIpPT5TdHJpbmcoYS52ZW51ZUNvZGV8fGEudmVudWVOYW1lfHwiIikubG9jYWxlQ29tcGFyZShTdHJpbmcoYi52ZW51ZUNvZGV8fGIudmVudWVOYW1lfHwiIikpfHwoYS5yYWNlTnVtYmVyfHwwKS0oYi5yYWNlTnVtYmVyfHwwKSk7CiBjb25zdCBjbnQ9e307R1JBREVfT1JERVIuZm9yRWFjaChnPT5jbnRbZ109MCk7CiBjb25zdCB1cFJvd3M9W10sYXhSb3dzPVtdO2xldCB3aXRoT2Rkcz0wLHNraXBwZWQ9MDsKIGZvcihjb25zdCByIG9mIHJzKXsKICBjb25zdCByYWNlPW1rUmFjZShyLGQpLG49cmFjZS5ydW5uZXJzLmxlbmd0aDsKICBpZihuPDYpe3NraXBwZWQrKztjb250aW51ZX0KICBjb25zdCBvZD1vZGRzRm9yKHJhY2UpLGFwPVVFLmF4aXNQcm9icyhyYWNlLHN0b3JlLG9kKTsKICBjb25zdCBnPVVFLnVwc2V0R3JhZGUocmFjZSxzdG9yZSxvZCxhcCk7Y250W2cuZ3JhZGVdKys7aWYob2Qpd2l0aE9kZHMrKzsKICB1cFJvd3MucHVzaCh7bGFiZWw6cmFjZUxhYmVsKHIsbiksZ30pOwogIGNvbnN0IHBpY2tzPW9kP1VFLmF4aXNQaWNrcyhyYWNlLHN0b3JlLG9kLGFwKTpudWxsOwogIGlmKHBpY2tzKWZvcihjb25zdCB4IG9mIHBpY2tzKWF4Um93cy5wdXNoKHtsYWJlbDpyYWNlTGFiZWwocixuKSx4LG5hbWU6cmFjZS5ydW5uZXJzW3guaV0ubmFtZSxubzpyYWNlLnJ1bm5lcnNbeC5pXS5udW0sam5hbWU6cmFjZS5ydW5uZXJzW3guaV0uam5hbWV9KTsKIH0KIC8vIOKRpSDms6LkubHluqYKIGxldCBoPWA8ZGl2IGNsYXNzPSJzbWFsbCI+5a++6LGhICR7dXBSb3dzLmxlbmd0aH3jg6zjg7zjgrnvvIjjgqrjg4Pjgrrlj43mmKAgJHt3aXRoT2Rkc33jg6zjg7zjgrnvvI/jgZ3jga7ku5bjga/jg4Tjg7zjg6vmjqjlrprvvIkke3NraXBwZWQ/YO+8jzbpoK3mnKrmuoDjgaflr77osaHlpJYgJHtza2lwcGVkfWA6IiJ9PC9kaXY+YDsKIGgrPWA8ZGl2IGNsYXNzPSJyb3ciPmArR1JBREVfT1JERVIubWFwKGc9PmA8c3BhbiBjbGFzcz0icnQiIHN0eWxlPSJiYWNrZ3JvdW5kOiR7R1JBREVfQ09MT1JbZ119Ij4ke2d9ICR7Y250W2ddfTwvc3Bhbj5gKS5qb2luKCIgIikrYDwvZGl2PmA7CiBoKz1gPHRhYmxlPjx0aGVhZD48dHI+PHRoPuODrOODvOOCuTwvdGg+PHRoPjwvdGg+PHRoPuetiee0mjwvdGg+PHRoPumBjuWOu+OBruazouS5seeOhzwvdGg+PHRoPuWIpOWumjwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT5gOwogZm9yKGNvbnN0IHUgb2YgdXBSb3dzKWgrPWA8dHI+PHRkPiR7ZXNjKHUubGFiZWwpfTwvdGQ+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPSJydCIgc3R5bGU9ImJhY2tncm91bmQ6JHtHUkFERV9DT0xPUlt1LmcuZ3JhZGVdfSI+JHt1LmcuZ3JhZGV9PC9zcGFuPjwvdGQ+PHRkPiR7TWF0aC5yb3VuZCh1LmcucmF0ZSoxMDApfSU8L3RkPjx0ZCBjbGFzcz0ic21hbGwiPiR7dS5nLm1vZGU9PT0ib2RkcyI/IuOCquODg+OCuiI6IuaOqOWumiJ9PC90ZD48L3RyPmA7CiBoKz1gPC90Ym9keT48L3RhYmxlPjxkaXYgY2xhc3M9InNtYWxsIj48YnI+5rOi5Lmx546H44Gv44CB44Gd44Gu562J57Sa44Gu44Os44O844K544Gn44CMM+edgOWGheOBruS6uuawl+OBruWQiOioiOOBjDE15Lul5LiK44CN44Gr44Gq44Gj44Gf6YGO5Y6744Gu5Ymy5ZCI44Gn44GZ77yI5YWo44Os44O844K55bmz5Z2HIDI4LjUl77yJ44CCPC9kaXY+YDsKICQoInVwc2V0T3V0IikuaW5uZXJIVE1MPWg7CiAvLyDikaQg6YmE5p2/6Lu46aasCiBsZXQgYT1gPGRpdiBjbGFzcz0ic21hbGwiPuOCquODg+OCuuOBjOWPluOCjOOBn+ODrOODvOOCuSAke3dpdGhPZGRzfS8ke3VwUm93cy5sZW5ndGh944CCPC9kaXY+YDsKIGlmKCF3aXRoT2RkcylhKz1gPGRpdiBjbGFzcz0id2FybiI+44Kq44OD44K644KS5Y+W5b6X44Gn44GN44Gm44GE44Gq44GE44Gf44KB44CB6YmE5p2/6Lu46aas44Gv5Yik5a6a44Gn44GN44G+44Gb44KT77yI55m65aOy6ZaL5aeL5b6M44Gr44CB44KC44GG5LiA5bqm5oq844GX44Gm44GP44Gg44GV44GE77yJ44CCPC9kaXY+YDsKIGVsc2UgaWYoIWF4Um93cy5sZW5ndGgpYSs9YDxkaXYgY2xhc3M9Indhcm4iPuacrOaXpeOBr+OAgeipsuW9k+OBmeOCi+i7uOmmrOOBjOOBhOOBvuOBm+OCk++8iOOCquODg+OCuuWPluW+l+a4iOOBv+OBruODrOODvOOCueOBruS4reOBq+OAgeWghei7uOS7peS4iuOBjOOBguOCiuOBvuOBm+OCk++8ieOAgjwvZGl2PmA7CiBmb3IoY29uc3QgdCBvZiBbIumJhOadvyIsIua6lumJhOadvyIsIuWghei7uCJdKXtjb25zdCBsaXN0PWF4Um93cy5maWx0ZXIoej0+ei54LnRpZXI9PT10KTtpZighbGlzdC5sZW5ndGgpY29udGludWU7CiAgYSs9YDxicj48Yj4ke3R9PC9iPjxzcGFuIGNsYXNzPSJzbWFsbCI+77yI6YGO5Y6744Gu5a6f57i+ICR7KFVFLkFYSVMuYmFuZHNbdF0ucmF0ZSoxMDApLnRvRml4ZWQoMCl9JeODu+ipsuW9kyR7VUUuQVhJUy5iYW5kc1t0XS5ufemgre+8iTwvc3Bhbj5gOwogIGZvcihjb25zdCB6IG9mIGxpc3QpYSs9YDxkaXYgY2xhc3M9ImNhbmQiPjxiPiR7ZXNjKHoubGFiZWwpfTwvYj48YnI+JHtlc2Moei5ubyl955WqICR7ZXNjKHoubmFtZSl9IDxzcGFuIGNsYXNzPSJzbWFsbCI+5LqI5risICR7KHoueC5wKjEwMCkudG9GaXhlZCgwKX0lJHt6LmpuYW1lPyLvvI/pqI7miYvvvJoiK2VzYyh6LmpuYW1lKToiIn08L3NwYW4+PC9kaXY+YH0KICQoImF4aXNPdXQiKS5pbm5lckhUTUw9YTsKfQokKCJheGlzR28iKS5vbmNsaWNrPWFzeW5jKCk9PnsKIGNvbnN0IGQ9JCgiYWRhdGUiKS52YWx1ZTtpZighZClyZXR1cm47CiAkKCJheGlzR28iKS5kaXNhYmxlZD10cnVlOyQoImF4aXNPdXQiKS5pbm5lckhUTUw9IiI7JCgidXBzZXRPdXQiKS50ZXh0Q29udGVudD0i6Kej5p6Q5Lit4oCmIjsKIHRyeXsKICBpZighV1JBQ0VTLmxlbmd0aHx8V0RBVEUhPT1kKXsKICAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfkuK3igKYiOyQoIndkYXRlIikudmFsdWU9ZDthd2FpdCAkKCJ3Z2V0Iikub25jbGljaygpOwogICBpZighV1JBQ0VTLmxlbmd0aCl7JCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSQoIndzdGF0dXMiKS50ZXh0Q29udGVudDskKCJ1cHNldE91dCIpLnRleHRDb250ZW50PSLlh7rppqzooajjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgIIiO3JldHVybn0KICAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PSLjgqrjg4PjgrrjgpLnorroqo3kuK3igKYiO2F3YWl0ICQoIm9kZHNHZXQiKS5vbmNsaWNrKCl9CiAgJCgiYXhpc1N0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7T2JqZWN0LmtleXMoT0REUykubGVuZ3RofeODrOODvOOCueWIhmA7CiAgYXdhaXQgcmVuZGVyQXhpc1Vwc2V0KGQpO0FYSVNfU0hPV049dHJ1ZTthdXRvU3RhcnQoKTsKIH1jYXRjaChlKXskKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9IuOCqOODqeODvO+8miIrZS5tZXNzYWdlOyQoInVwc2V0T3V0IikudGV4dENvbnRlbnQ9IiJ9CiBmaW5hbGx5eyQoImF4aXNHbyIpLmRpc2FibGVkPWZhbHNlfQp9OwoKLyogLS0tIOOCquODg+OCuuOBruiHquWLleabtOaWsO+8iOW9k+aXpeOBruOBv++8ie+8muOCquODg+OCuuWPluW+lyDihpIg6KGo56S65Lit44Gu5qyE77yI4piF5pys5pel44O74pGk4pGl77yJ44KS6Ieq5YuV44Gn5YaN6KiI566XIC0tLSAqLwpsZXQgQVVUT19UPW51bGwsQVVUT19ORVhUPTAsQVVUT19CVVNZPWZhbHNlLEFVVE9fTEFTVD0iIixUT0RBWV9TSE9XTj1mYWxzZSxBWElTX1NIT1dOPWZhbHNlOwpjb25zdCBhdXRvTXM9KCk9PndpbmRvdy5fX0FVVE9fTVN8fE51bWJlcigkKCJhdXRvTWluIikudmFsdWUpKjYwMDAwOwpmdW5jdGlvbiBhdXRvU3RvcCgpe2lmKEFVVE9fVCljbGVhckludGVydmFsKEFVVE9fVCk7QVVUT19UPW51bGw7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0iIn0KYXN5bmMgZnVuY3Rpb24gcmVmcmVzaE9kZHNBbmRWaWV3cygpewogYXdhaXQgZmV0Y2hPZGRzKCk7CiBBVVRPX0xBU1Q9bmV3IERhdGUoRGF0ZS5ub3coKSs5KjM2MDBlMykudG9JU09TdHJpbmcoKS5zbGljZSgxMSwxOSk7CiBjb25zdCBuPU9iamVjdC5rZXlzKE9ERFMpLmxlbmd0aDsKIGlmKFRPREFZX1NIT1dOKXskKCJ0b2RheVN0YXR1cyIpLnRleHRDb250ZW50PWAke1dSQUNFUy5sZW5ndGh944Os44O844K577yP44Kq44OD44K6ICR7bn3jg6zjg7zjgrnliIbvvIgke0FVVE9fTEFTVH0g5pu05paw77yJYDthd2FpdCBydW5BbGwoInRvZGF5T3V0Iil9CiBpZihBWElTX1NIT1dOKXskKCJheGlzU3RhdHVzIikudGV4dENvbnRlbnQ9YCR7V1JBQ0VTLmxlbmd0aH3jg6zjg7zjgrnvvI/jgqrjg4PjgrogJHtufeODrOODvOOCueWIhu+8iCR7QVVUT19MQVNUfSDmm7TmlrDvvIlgO2F3YWl0IHJlbmRlckF4aXNVcHNldChXREFURSl9Cn0KZnVuY3Rpb24gYXV0b1N0YXJ0KCl7CiBhdXRvU3RvcCgpOwogaWYoISQoImF1dG9PZGRzIikuY2hlY2tlZHx8IVdSQUNFUy5sZW5ndGgpcmV0dXJuOwogaWYoV0RBVEU8anN0VG9kYXkoKSl7JCgiYXV0b0luZm8iKS50ZXh0Q29udGVudD0i77yI6YGO5Y6744Gu5pel5LuY44Gu44Gf44KB6Ieq5YuV5pu05paw44Gv44GX44G+44Gb44KT77yJIjtyZXR1cm59CiBBVVRPX05FWFQ9RGF0ZS5ub3coKSthdXRvTXMoKTsKIEFVVE9fVD1zZXRJbnRlcnZhbChhc3luYygpPT57CiAgY29uc3QgbGVmdD1BVVRPX05FWFQtRGF0ZS5ub3coKTsKICBpZihsZWZ0PjApeyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9YOasoeOBruabtOaWsOOBvuOBpyAke01hdGguY2VpbChsZWZ0LzEwMDApfeenkmArKEFVVE9fTEFTVD9g77yP5pyA57WC5pu05pawICR7QVVUT19MQVNUfWA6IiIpO3JldHVybn0KICBpZihBVVRPX0JVU1kpcmV0dXJuO0FVVE9fQlVTWT10cnVlOyQoImF1dG9JbmZvIikudGV4dENvbnRlbnQ9IuOCquODg+OCuuOCkuabtOaWsOS4reKApiI7CiAgdHJ5e2F3YWl0IHJlZnJlc2hPZGRzQW5kVmlld3MoKX1jYXRjaChlKXskKCJhdXRvSW5mbyIpLnRleHRDb250ZW50PSLmm7TmlrDjgqjjg6njg7zvvJoiK2UubWVzc2FnZX0KICBmaW5hbGx5e0FVVE9fQlVTWT1mYWxzZTtBVVRPX05FWFQ9RGF0ZS5ub3coKSthdXRvTXMoKX0KIH0sd2luZG93Ll9fQVVUT19USUNLfHwxMDAwKTsKfQokKCJhdXRvT2RkcyIpLm9uY2hhbmdlPWF1dG9TdGFydDskKCJhdXRvTWluIikub25jaGFuZ2U9YXV0b1N0YXJ0OwoKLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09CiAqIOiHquWLleODkOODg+OCr+OCouODg+ODl++8iENsb3VkZmxhcmUgS1bvvIkKICog44O744OH44O844K/44GM5aSJ44KP44Gj44Gf44Kw44Or44O844OX77yIY3N2LeW5tO+8j2xpdmUt5bm05pyI77yPcGF5LeW5tOaciO+8j21ldGHvvInjgaDjgZHjgpLjgIFnemlw44GX44Gm6YCB44KLCiAqIOODu+S/neWtmOWFiOOBruitmOWIpeOBr+OAgeODkeOCueODleODrOODvOOCuuOBrlNIQS0yNTbvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgZ3jga7jgoLjga7jga/pgIHjgonjgarjgYTvvIkKICog44O75b6p5YWD44Gv44CB5ZCM44GY44OR44K544OV44Os44O844K644Gn44CC5ZCM44GY44Kt44O844Gu44OH44O844K/44Gv5LiK5pu444GN44GV44KM44KLCiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi8KY29uc3QgQks9e3Bhc3M6IiIsYXV0bzp0cnVlLGRpcnR5Om5ldyBTZXQoKSxidXN5OmZhbHNlLGlkOiIiLHNhdmVUOm51bGwscnVuVDpudWxsLGluZm86bnVsbCxtc2c6IiIsZXJyOmZhbHNlfTsKY29uc3QgcmF3TWV0YVB1dD0oayx2KT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHQ9REIudHJhbnNhY3Rpb24oIm1ldGEiLCJyZWFkd3JpdGUiKTt0Lm9iamVjdFN0b3JlKCJtZXRhIikucHV0KHYsayk7dC5vbmNvbXBsZXRlPW9rO3Qub25lcnJvcj0oKT0+bmcodC5lcnJvcil9KTsKY29uc3QgcmF3UHV0TWFueT1yZWNzPT5uZXcgUHJvbWlzZSgob2ssbmcpPT57Y29uc3Qgc3Q9Wy4uLm5ldyBTZXQocmVjcy5tYXAocj0+ci5zKSldO2lmKCFzdC5sZW5ndGgpcmV0dXJuIG9rKCk7Y29uc3QgdD1EQi50cmFuc2FjdGlvbihzdCwicmVhZHdyaXRlIik7Zm9yKGNvbnN0IHIgb2YgcmVjcyl0Lm9iamVjdFN0b3JlKHIucykucHV0KHIudixyLmspO3Qub25jb21wbGV0ZT1vazt0Lm9uZXJyb3I9KCk9Pm5nKHQuZXJyb3IpfSk7CmNvbnN0IGlkYlJhbmdlPShzdG9yZSxyYW5nZSk9Pm5ldyBQcm9taXNlKChvayxuZyk9Pntjb25zdCBvdXQ9W107Y29uc3QgcT1EQi50cmFuc2FjdGlvbihzdG9yZSkub2JqZWN0U3RvcmUoc3RvcmUpLm9wZW5DdXJzb3IocmFuZ2UpO3Eub25zdWNjZXNzPWU9Pntjb25zdCBjPWUudGFyZ2V0LnJlc3VsdDtpZihjKXtvdXQucHVzaCh7czpzdG9yZSxrOmMua2V5LHY6Yy52YWx1ZX0pO2MuY29udGludWUoKX1lbHNlIG9rKG91dCl9O3Eub25lcnJvcj0oKT0+bmcocS5lcnJvcil9KTsKY29uc3QgaWRiS2V5cz1zdG9yZT0+bmV3IFByb21pc2UoKG9rLG5nKT0+e2NvbnN0IHE9REIudHJhbnNhY3Rpb24oc3RvcmUpLm9iamVjdFN0b3JlKHN0b3JlKS5nZXRBbGxLZXlzKCk7cS5vbnN1Y2Nlc3M9KCk9Pm9rKHEucmVzdWx0fHxbXSk7cS5vbmVycm9yPSgpPT5uZyhxLmVycm9yKX0pOwpmdW5jdGlvbiBncm91cE9mKHN0b3JlLGtleSl7CiBrZXk9U3RyaW5nKGtleSk7CiBpZihzdG9yZT09PSJmaWxlcyIpe2lmKGtleS5zdGFydHNXaXRoKCJsaXZlOiIpKXJldHVybiAibGl2ZS0iK2tleS5zbGljZSg1LDEyKTtjb25zdCB5PWtleS5zcGxpdCgiOiIpWzBdO3JldHVybiAvXigwfDIwXGRcZCkkLy50ZXN0KHkpPyJjc3YtIit5OiJjc3YtMCJ9CiBpZihzdG9yZT09PSJwYXkiKXJldHVybiAicGF5LSIra2V5LnNsaWNlKDAsNyk7CiByZXR1cm4gIm1ldGEiOwp9CmZ1bmN0aW9uIG1hcmtEaXJ0eShzdG9yZSxrZXkpewogaWYoc3RvcmU9PT0ibWV0YSImJihrZXk9PT0iZGlydHkifHxrZXk9PT0iYmFja3VwIikpcmV0dXJuOwogQksuZGlydHkuYWRkKGdyb3VwT2Yoc3RvcmUsa2V5KSk7CiBjbGVhclRpbWVvdXQoQksuc2F2ZVQpO0JLLnNhdmVUPXNldFRpbWVvdXQoKCk9PntyYXdNZXRhUHV0KCJkaXJ0eSIsWy4uLkJLLmRpcnR5XSkuY2F0Y2goKCk9Pnt9KTtia1JlbmRlcigpfSw4MDApOwp9CmFzeW5jIGZ1bmN0aW9uIHJlYWRHcm91cChuYW1lKXsKIGxldCBtOwogaWYobmFtZT09PSJtZXRhIilyZXR1cm4oYXdhaXQgaWRiUmFuZ2UoIm1ldGEiKSkuZmlsdGVyKHI9PnIuayE9PSJkaXJ0eSImJnIuayE9PSJiYWNrdXAiKTsKIGlmKG09bmFtZS5tYXRjaCgvXmNzdi0oXGQrKSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgJHttWzFdfTpgLGAke21bMV19O2ApKTsKIGlmKG09bmFtZS5tYXRjaCgvXmxpdmUtKFxkezR9LVxkezJ9KSQvKSlyZXR1cm4gaWRiUmFuZ2UoImZpbGVzIixJREJLZXlSYW5nZS5ib3VuZChgbGl2ZToke21bMV19LTAwYCxgbGl2ZToke21bMV19LTk5YCkpOwogaWYobT1uYW1lLm1hdGNoKC9ecGF5LShcZHs0fS1cZHsyfSkkLykpcmV0dXJuIGlkYlJhbmdlKCJwYXkiLElEQktleVJhbmdlLmJvdW5kKGAke21bMV19LTAwYCxgJHttWzFdfS05OWApKTsKIHJldHVybltdOwp9CmFzeW5jIGZ1bmN0aW9uIGFsbEdyb3VwcygpewogY29uc3QgZz1uZXcgU2V0KCk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJmaWxlcyIpKWcuYWRkKGdyb3VwT2YoImZpbGVzIixrKSk7CiBmb3IoY29uc3QgayBvZiBhd2FpdCBpZGJLZXlzKCJwYXkiKSlnLmFkZChncm91cE9mKCJwYXkiLGspKTsKIGlmKChhd2FpdCBpZGJLZXlzKCJtZXRhIikpLnNvbWUoaz0+ayE9PSJkaXJ0eSImJmshPT0iYmFja3VwIikpZy5hZGQoIm1ldGEiKTsKIHJldHVyblsuLi5nXTsKfQphc3luYyBmdW5jdGlvbiBneihzdHIpewogY29uc3QgcmF3PW5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpOwogaWYodHlwZW9mIENvbXByZXNzaW9uU3RyZWFtPT09InVuZGVmaW5lZCIpcmV0dXJue2J1ZjpyYXcsZW5jOiJyYXcifTsKIGNvbnN0IGNzPW5ldyBDb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9Y3Mud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShyYXcpO3cuY2xvc2UoKTsKIHJldHVybntidWY6bmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKGNzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKSxlbmM6Imd6aXAifTsKfQphc3luYyBmdW5jdGlvbiBndW56aXAoYnVmLGVuYyl7CiBpZihlbmM9PT0icmF3IilyZXR1cm4gbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ1Zik7CiBjb25zdCBkcz1uZXcgRGVjb21wcmVzc2lvblN0cmVhbSgiZ3ppcCIpLHc9ZHMud3JpdGFibGUuZ2V0V3JpdGVyKCk7dy53cml0ZShidWYpO3cuY2xvc2UoKTsKIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYXdhaXQgbmV3IFJlc3BvbnNlKGRzLnJlYWRhYmxlKS5hcnJheUJ1ZmZlcigpKTsKfQphc3luYyBmdW5jdGlvbiBia01ha2VJZCgpewogaWYoISh3aW5kb3cuY3J5cHRvJiZjcnlwdG8uc3VidGxlKSl0aHJvdyBuZXcgRXJyb3IoIuOBk+OBrueSsOWig+OBp+OBr+S9v+OBiOOBvuOBm+OCk++8iGh0dHBzIOOBp+mWi+OBj+W/heimgeOBjOOBguOCiuOBvuOBme+8iSIpOwogY29uc3QgZD1hd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgiU0hBLTI1NiIsbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKCJrZWliYS11cHNldC1iYWNrdXA6djE6IitCSy5wYXNzKSk7CiByZXR1cm5bLi4ubmV3IFVpbnQ4QXJyYXkoZCldLm1hcChiPT5iLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCIwIikpLmpvaW4oIiIpOwp9CmFzeW5jIGZ1bmN0aW9uIGJrRmV0Y2gocGF0aCxvcHQpewogaWYoIUJLLmlkKUJLLmlkPWF3YWl0IGJrTWFrZUlkKCk7CiByZXR1cm4gZmV0Y2goJCgid3VybCIpLnZhbHVlLnJlcGxhY2UoL1wvJC8sIiIpK3BhdGgsT2JqZWN0LmFzc2lnbih7fSxvcHQse2hlYWRlcnM6T2JqZWN0LmFzc2lnbih7IngtYmFja3VwLWlkIjpCSy5pZH0sKG9wdCYmb3B0LmhlYWRlcnMpfHx7fSl9KSk7Cn0KYXN5bmMgZnVuY3Rpb24gYmtKU09OKHBhdGgsb3B0KXsKIGNvbnN0IHI9YXdhaXQgYmtGZXRjaChwYXRoLG9wdCksdD1hd2FpdCByLnRleHQoKTtsZXQgaj17fTt0cnl7aj1KU09OLnBhcnNlKHQpfWNhdGNoKGUpe30KIGlmKCFyLm9rfHxqLm9rPT09ZmFsc2UpdGhyb3cgbmV3IEVycm9yKGouZXJyb3J8fCgiSFRUUCAiK3Iuc3RhdHVzKSk7cmV0dXJuIGo7Cn0KZnVuY3Rpb24gYmtNc2codCxpc0Vycil7QksubXNnPXR8fCIiO0JLLmVycj0hIWlzRXJyO2JrUmVuZGVyKCl9CmZ1bmN0aW9uIGJrUmVuZGVyKCl7CiBjb25zdCBlbD0kKCJia1N0YXR1cyIpO2lmKCFlbClyZXR1cm47CiBjb25zdCBtPUJLLmluZm8sanN0PW1zPT5uZXcgRGF0ZShtcys5KjM2MDBlMykudG9JU09TdHJpbmcoKS5yZXBsYWNlKCJUIiwiICIpLnNsaWNlKDAsMTYpOwogbGV0IHN1bT0iIjsKIGlmKCFCSy5wYXNzKXN1bT0i44OR44K544OV44Os44O844K644KS6Kit5a6a44GZ44KL44Go44CB6Ieq5YuV44OQ44OD44Kv44Ki44OD44OX44GM5pyJ5Yq544Gr44Gq44KK44G+44GZ44CCIjsKIGVsc2UgaWYobSYmbS5leGlzdHMpe2NvbnN0IGNzPU9iamVjdC52YWx1ZXMobS5jaHVua3N8fHt9KTtzdW09YOacgOe1guODkOODg+OCr+OCouODg+ODl++8miR7anN0KG0udXBkYXRlZEF0KX3vvIgke2NzLmxlbmd0aH3jgrDjg6vjg7zjg5fvvI8keyhjcy5yZWR1Y2UoKHMsYyk9PnMrYy5zaXplLDApLzEwNDg1NzYpLnRvRml4ZWQoMSl9TULvvIlgfQogZWxzZSBzdW09IuODkOODg+OCr+OCouODg+ODl+OBr+OBvuOBoOOBguOCiuOBvuOBm+OCk+OAgiI7CiBpZihCSy5wYXNzKXN1bSs9YO+8j+acqumAgeS/oeOBruWkieabtO+8miR7QksuZGlydHkuc2l6ZX3jgrDjg6vjg7zjg5cke0JLLmF1dG8/Iu+8iOiHquWLleOBp+mAgeOCiuOBvuOBme+8iSI6Iu+8iOiHquWLleODkOODg+OCr+OCouODg+ODl+OBr+OCquODle+8iSJ9YDsKIGVsLmlubmVySFRNTD0oQksubXNnP2A8c3BhbiBjbGFzcz0iJHtCSy5lcnI/Indhcm4iOiJnb29kIn0iPiR7ZXNjKEJLLm1zZyl9PC9zcGFuPlxuYDoiIikrZXNjKHN1bSk7Cn0KZnVuY3Rpb24gYmtOZWVkUGFzcygpe2lmKCFCSy5wYXNzfHxCSy5wYXNzLmxlbmd0aDw4KXtia01zZygi44OR44K544OV44Os44O844K644KSOOaWh+Wtl+S7peS4iuOBp+WFpeWKm+OBl+OBpuOBj+OBoOOBleOBhOOAgiIsdHJ1ZSk7cmV0dXJuIHRydWV9cmV0dXJuIGZhbHNlfQphc3luYyBmdW5jdGlvbiBia1JlZnJlc2gobWFuKXsKIHRyeXtCSy5pbmZvPW1hbnx8YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iil9Y2F0Y2goZSl7QksuaW5mbz1udWxsO2lmKCFCSy5tc2cpYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeOBp+OBjeOBvuOBm+OCk++8miIrZS5tZXNzYWdlLHRydWUpfQogYmtSZW5kZXIoKTsKfQphc3luYyBmdW5jdGlvbiBydW5CYWNrdXAoZnVsbCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlO2NvbnN0IGluZmxpZ2h0PW5ldyBTZXQoQksuZGlydHkpO0JLLmRpcnR5LmNsZWFyKCk7CiB0cnl7CiAgYmtNc2coIuODkOODg+OCr+OCouODg+ODl+WFiOOCkueiuuiqjeS4reKApiIpOwogIGNvbnN0IG1hbj1hd2FpdCBia0pTT04oIi9iYWNrdXAvbWFuaWZlc3QiKSxoYXZlPW1hbi5leGlzdHM/KG1hbi5jaHVua3N8fHt9KTp7fTsKICBjb25zdCBuYW1lcz0oZnVsbHx8IW1hbi5leGlzdHMpP2F3YWl0IGFsbEdyb3VwcygpOlsuLi5pbmZsaWdodF07CiAgaWYoIW5hbWVzLmxlbmd0aCl7YmtNc2coIuWkieabtOOBr+OBguOCiuOBvuOBm+OCk+OAgiIpO2F3YWl0IGJrUmVmcmVzaChtYW4pO3JldHVybn0KICBjb25zdCBjaHVua3M9T2JqZWN0LmFzc2lnbih7fSxoYXZlKTtsZXQgc2VudD0wLGJ5dGVzPTA7CiAgZm9yKGxldCBpPTA7aTxuYW1lcy5sZW5ndGg7aSsrKXsKICAgY29uc3QgbmFtZT1uYW1lc1tpXTtia01zZyhg44OQ44OD44Kv44Ki44OD44OX5Lit4oCmICR7aSsxfS8ke25hbWVzLmxlbmd0aH3vvIgke25hbWV977yJYCk7CiAgIGNvbnN0IHJlY3M9YXdhaXQgcmVhZEdyb3VwKG5hbWUpOwogICBpZighcmVjcy5sZW5ndGgpe2lmKGNodW5rc1tuYW1lXSl7YXdhaXQgYmtGZXRjaChgL2JhY2t1cC9jaHVuaz9uYW1lPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG5hbWUpfWAse21ldGhvZDoiREVMRVRFIn0pO2RlbGV0ZSBjaHVua3NbbmFtZV19Y29udGludWV9CiAgIGNvbnN0IHJhdz1KU09OLnN0cmluZ2lmeSh7ZzpuYW1lLHJlY3N9KSx7YnVmLGVuY309YXdhaXQgZ3oocmF3KTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCx7bWV0aG9kOiJQVVQiLGJvZHk6YnVmfSk7CiAgIGlmKCFyLm9rKXtsZXQgZT0iIjt0cnl7ZT0oYXdhaXQgci5qc29uKCkpLmVycm9yfWNhdGNoKF8pe310aHJvdyBuZXcgRXJyb3IoZXx8KCJIVFRQICIrci5zdGF0dXMpKX0KICAgY2h1bmtzW25hbWVdPXtzaXplOmJ1Zi5ieXRlTGVuZ3RoLHJhd1NpemU6cmF3Lmxlbmd0aCxuOnJlY3MubGVuZ3RoLGVuYyxhdDpEYXRlLm5vdygpfTtzZW50Kys7Ynl0ZXMrPWJ1Zi5ieXRlTGVuZ3RoOwogIH0KICBpZihmdWxsfHwhbWFuLmV4aXN0cyl7Zm9yKGNvbnN0IG4gb2YgT2JqZWN0LmtleXMoaGF2ZSkpaWYoIW5hbWVzLmluY2x1ZGVzKG4pKXthd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobil9YCx7bWV0aG9kOiJERUxFVEUifSk7ZGVsZXRlIGNodW5rc1tuXX19CiAgY29uc3QgbWFuaWZlc3Q9e3Y6MSx1cGRhdGVkQXQ6RGF0ZS5ub3coKSxjaHVua3N9OwogIGF3YWl0IGJrSlNPTigiL2JhY2t1cC9tYW5pZmVzdCIse21ldGhvZDoiUFVUIixib2R5OkpTT04uc3RyaW5naWZ5KG1hbmlmZXN0KSxoZWFkZXJzOnsiY29udGVudC10eXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgbWFuaWZlc3QuZXhpc3RzPXRydWU7YXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFsuLi5CSy5kaXJ0eV0pO2F3YWl0IHJhd01ldGFQdXQoImJhY2t1cCIse2F0Om1hbmlmZXN0LnVwZGF0ZWRBdH0pOwogIEJLLmluZm89bWFuaWZlc3Q7YmtNc2coYOODkOODg+OCr+OCouODg+ODl+WujOS6hu+8miR7c2VudH3jgrDjg6vjg7zjg5fjgpLpgIHkv6HvvIgkeyhieXRlcy8xMDQ4NTc2KS50b0ZpeGVkKDEpfU1C77yJYCk7CiB9Y2F0Y2goZSl7CiAgZm9yKGNvbnN0IG4gb2YgaW5mbGlnaHQpQksuZGlydHkuYWRkKG4pO3Jhd01ldGFQdXQoImRpcnR5IixbLi4uQksuZGlydHldKS5jYXRjaCgoKT0+e30pOwogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgavlpLHmlZfjgZfjgb7jgZfjgZ/vvJoiK2UubWVzc2FnZSx0cnVlKTsKIH1maW5hbGx5e0JLLmJ1c3k9ZmFsc2U7YmtSZW5kZXIoKX0KfQphc3luYyBmdW5jdGlvbiBydW5SZXN0b3JlKCl7CiBpZihCSy5idXN5fHxia05lZWRQYXNzKCkpcmV0dXJuOwogQksuYnVzeT10cnVlOwogdHJ5ewogIGJrTXNnKCLjg5Djg4Pjgq/jgqLjg4Pjg5fjgpLnorroqo3kuK3igKYiKTsKICBjb25zdCBtYW49YXdhaXQgYmtKU09OKCIvYmFja3VwL21hbmlmZXN0Iik7CiAgaWYoIW1hbi5leGlzdHMpe2JrTXNnKCLjgZPjga7jg5Hjgrnjg5Xjg6zjg7zjgrrjga7jg5Djg4Pjgq/jgqLjg4Pjg5fjga/opovjgaTjgYvjgorjgb7jgZvjgpPvvIjjg5Hjgrnjg5Xjg6zjg7zjgrrjgpLnorroqo3jgZfjgabjgY/jgaDjgZXjgYTvvInjgIIiLHRydWUpO3JldHVybn0KICBjb25zdCBuYW1lcz1PYmplY3Qua2V5cyhtYW4uY2h1bmtzfHx7fSk7bGV0IG49MCxjbnQ9MDsKICBmb3IoY29uc3QgbmFtZSBvZiBuYW1lcyl7CiAgIGJrTXNnKGDlvqnlhYPkuK3igKYgJHsrK259LyR7bmFtZXMubGVuZ3Rofe+8iCR7bmFtZX3vvIlgKTsKICAgY29uc3Qgcj1hd2FpdCBia0ZldGNoKGAvYmFja3VwL2NodW5rP25hbWU9JHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9YCk7CiAgIGlmKCFyLm9rKXRocm93IG5ldyBFcnJvcihgJHtuYW1lfSDjgpLlj5blvpfjgafjgY3jgb7jgZvjgpPvvIhIVFRQICR7ci5zdGF0dXN977yJYCk7CiAgIGNvbnN0IG89SlNPTi5wYXJzZShhd2FpdCBndW56aXAobmV3IFVpbnQ4QXJyYXkoYXdhaXQgci5hcnJheUJ1ZmZlcigpKSxtYW4uY2h1bmtzW25hbWVdLmVuY3x8Imd6aXAiKSk7CiAgIGF3YWl0IHJhd1B1dE1hbnkoby5yZWNzKTtjbnQrPW8ucmVjcy5sZW5ndGg7CiAgfQogIFNUT1JFPW51bGw7U1RPUkVfS0VZPSIiO0JBQ0tVUF9EQVRFUz1udWxsO0JLLmRpcnR5LmNsZWFyKCk7CiAgYXdhaXQgcmF3TWV0YVB1dCgiZGlydHkiLFtdKTthd2FpdCByYXdNZXRhUHV0KCJiYWNrdXAiLHthdDptYW4udXBkYXRlZEF0fSk7CiAgYXdhaXQgc2hvd1N0YXRlKCk7QksuaW5mbz1tYW47YmtNc2coYOW+qeWFg+WujOS6hu+8miR7bmFtZXMubGVuZ3RofeOCsOODq+ODvOODl++8jyR7Y250LnRvTG9jYWxlU3RyaW5nKCl95Lu2YCk7CiB9Y2F0Y2goZSl7YmtNc2coIuW+qeWFg+OBq+WkseaVl+OBl+OBvuOBl+OBn++8miIrZS5tZXNzYWdlLHRydWUpfQogZmluYWxseXtCSy5idXN5PWZhbHNlO2JrUmVuZGVyKCl9Cn0KZnVuY3Rpb24gYmtTY2hlZHVsZShtcyl7CiBpZighQksuYXV0b3x8IUJLLnBhc3N8fEJLLnBhc3MubGVuZ3RoPDgpcmV0dXJuOwogY2xlYXJUaW1lb3V0KEJLLnJ1blQpO0JLLnJ1blQ9c2V0VGltZW91dCgoKT0+e2lmKCFTWU5DSU5HKXJ1bkJhY2t1cChmYWxzZSk7ZWxzZSBia1NjaGVkdWxlKDMwMDAwKX0sbXN8fDMwMDApOwp9CmZ1bmN0aW9uIGJrU2F2ZVNldHRpbmdzKCl7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKCJ1cHNldF9iayIsSlNPTi5zdHJpbmdpZnkoe3Bhc3M6QksucGFzcyxhdXRvOkJLLmF1dG99KSl9Y2F0Y2goZSl7fX0KYXN5bmMgZnVuY3Rpb24gYmtJbml0KCl7CiB0cnl7Y29uc3Qgbz1KU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKCJ1cHNldF9iayIpfHwie30iKTtCSy5wYXNzPW8ucGFzc3x8IiI7QksuYXV0bz1vLmF1dG8hPT1mYWxzZX1jYXRjaChlKXt9CiAkKCJia1Bhc3MiKS52YWx1ZT1CSy5wYXNzOyQoImJrQXV0byIpLmNoZWNrZWQ9QksuYXV0bzsKICQoImJrUGFzcyIpLm9uY2hhbmdlPSgpPT57QksucGFzcz0kKCJia1Bhc3MiKS52YWx1ZS50cmltKCk7QksuaWQ9IiI7QksuaW5mbz1udWxsO0JLLm1zZz0iIjtia1NhdmVTZXR0aW5ncygpO2lmKEJLLnBhc3MubGVuZ3RoPj04KWJrUmVmcmVzaCgpO2Vsc2UgYmtSZW5kZXIoKX07CiAkKCJia1Nob3ciKS5vbmNsaWNrPSgpPT57Y29uc3QgcD0kKCJia1Bhc3MiKTtwLnR5cGU9cC50eXBlPT09InBhc3N3b3JkIj8idGV4dCI6InBhc3N3b3JkIjskKCJia1Nob3ciKS50ZXh0Q29udGVudD1wLnR5cGU9PT0icGFzc3dvcmQiPyLooajnpLoiOiLpmqDjgZkifTsKICQoImJrQXV0byIpLm9uY2hhbmdlPSgpPT57QksuYXV0bz0kKCJia0F1dG8iKS5jaGVja2VkO2JrU2F2ZVNldHRpbmdzKCk7YmtSZW5kZXIoKTtpZihCSy5hdXRvKWJrU2NoZWR1bGUoMjAwMCl9OwogJCgiYmtOb3ciKS5vbmNsaWNrPSgpPT5ydW5CYWNrdXAoZmFsc2UpOwogJCgiYmtGdWxsIikub25jbGljaz0oKT0+e2lmKGNvbmZpcm0oIuOBmeOBueOBpuOBruODh+ODvOOCv+OCkuOAgeOBguOCieOBn+OCgeOBpuS/neWtmOOBl+ebtOOBl+OBvuOBmeOAguOCiOOCjeOBl+OBhOOBp+OBmeOBi++8nyIpKXJ1bkJhY2t1cCh0cnVlKX07CiAkKCJia1Jlc3RvcmUiKS5vbmNsaWNrPSgpPT57aWYoY29uZmlybSgi44GT44Gu56uv5pyr44Gu44OH44O844K/44KS44CB44OQ44OD44Kv44Ki44OD44OX44Gu5YaF5a6544Gn5LiK5pu444GN44GX44G+44GZ77yI44OQ44OD44Kv44Ki44OD44OX44Gr44GC44KL44OH44O844K/44Gg44GR44GM5a++6LGh44Gn44GZ77yJ44CC44KI44KN44GX44GE44Gn44GZ44GL77yfIikpcnVuUmVzdG9yZSgpfTsKIHRyeXtjb25zdCBkPWF3YWl0IG1ldGFHZXQoImRpcnR5Iik7aWYoQXJyYXkuaXNBcnJheShkKSlkLmZvckVhY2goeD0+QksuZGlydHkuYWRkKHgpKX1jYXRjaChlKXt9CiB0cnl7aWYobmF2aWdhdG9yLnN0b3JhZ2UmJm5hdmlnYXRvci5zdG9yYWdlLnBlcnNpc3QpbmF2aWdhdG9yLnN0b3JhZ2UucGVyc2lzdCgpLmNhdGNoKCgpPT57fSl9Y2F0Y2goZSl7fQogYmtSZW5kZXIoKTsKIGlmKEJLLnBhc3MubGVuZ3RoPj04KXthd2FpdCBia1JlZnJlc2goKTtpZihCSy5kaXJ0eS5zaXplKWJrU2NoZWR1bGUoNTAwMCl9CiBzZXRJbnRlcnZhbCgoKT0+e2lmKEJLLmF1dG8mJkJLLnBhc3MubGVuZ3RoPj04JiZCSy5kaXJ0eS5zaXplJiYhQksuYnVzeSYmIVNZTkNJTkcpcnVuQmFja3VwKGZhbHNlKX0sd2luZG93Ll9fQktfVElDS3x8OTAwMDAwKTsKfQoKKGFzeW5jKCk9Pnt0cnl7YXdhaXQgb3BlbkRCKCk7YXdhaXQgc2hvd1N0YXRlKCk7YXdhaXQgcGF5U3RhdGUoKTthd2FpdCBia0luaXQoKX1jYXRjaChlKXskKCJkYXRhU3RhdHVzIikuaW5uZXJIVE1MPWA8c3BhbiBjbGFzcz0id2FybiI+5L+d5a2Y6aCY5Z+f44KS6ZaL44GR44G+44Gb44KT77yaJHtlc2MoZS5tZXNzYWdlKX1cbu+8iOODl+ODqeOCpOODmeODvOODiOODluODqeOCpuOCuuOBp+OBr+S9v+OBiOOBquOBhOOBk+OBqOOBjOOBguOCiuOBvuOBme+8iTwvc3Bhbj5gfX0pKCk7CmlmKC9eaHR0cHM/Oi8udGVzdChsb2NhdGlvbi5wcm90b2NvbCkpJCgid3VybCIpLnZhbHVlPWxvY2F0aW9uLm9yaWdpbjsKc2hvd1BhbmUoIldvcmtlciIpOwoKPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";
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
