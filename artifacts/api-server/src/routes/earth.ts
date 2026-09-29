import { Router, type IRouter } from "express";
import {
  GetEarthSnapshotQueryParams,
  GetEarthSnapshotResponse,
  GetRecommendationsQueryParams,
  GetRecommendationsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_LATITUDE = 26.77;
const DEFAULT_LONGITUDE = 31.5;
const DEFAULT_DAYS = 30;
const LOCATION_NAME = "Tahta, Egypt";
const FALLBACK_WEATHER = {
  temperature: 29.7,
  humidity: 29.9,
  precipitation: 0,
  windSpeed: 3.9,
  soilMoisture: 0.22,
  solarRadiation: 23.1,
};

type PowerApiResponse = {
  properties?: {
    parameter?: Record<string, Record<string, number>>;
  };
};

type FireDetection = {
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: string;
  satellite: string;
  instrument: string | null;
  acquiredAt: string;
};

type LayerFeed = {
  status: string;
  source: string;
  latestObservation: string | null;
  observationUrl: string | null;
};

const FALLBACK_FIRE_DETECTIONS: FireDetection[] = [
  [26.65855, 31.32104],
  [26.65559, 31.32088],
  [26.65617, 31.31872],
  [26.96901, 31.15578],
  [26.65847, 31.32015],
  [26.96714, 31.1551],
].map(([latitude, longitude], index) => ({
  latitude,
  longitude,
  brightness: 0,
  confidence: "cached",
  satellite: "NASA FIRMS",
  instrument: "VIIRS / MODIS",
  acquiredAt: `cached-${index + 1}`,
}));

function fallbackPower(start: Date, end: Date): PowerApiResponse {
  const dates: Record<string, number> = {};
  const parameters: Record<string, Record<string, number>> = {
    T2M: dates,
    PRECTOTCORR: {},
    RH2M: {},
    WS10M: {},
    ALLSKY_SFC_SW_DWN: {},
    GWETTOP: {},
    GWETROOT: {},
  };
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = powerDate(cursor);
    parameters.T2M[date] = FALLBACK_WEATHER.temperature;
    parameters.PRECTOTCORR[date] = FALLBACK_WEATHER.precipitation;
    parameters.RH2M[date] = FALLBACK_WEATHER.humidity;
    parameters.WS10M[date] = FALLBACK_WEATHER.windSpeed;
    parameters.ALLSKY_SFC_SW_DWN[date] = FALLBACK_WEATHER.solarRadiation;
    parameters.GWETTOP[date] = FALLBACK_WEATHER.soilMoisture;
    parameters.GWETROOT[date] = FALLBACK_WEATHER.soilMoisture;
  }
  return { properties: { parameter: parameters } };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function powerDate(date: Date): string {
  return isoDate(date).replaceAll("-", "");
}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (const character of line) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }

  fields.push(field.trim());
  return fields;
}

function parseFirmsCsv(csv: string): FireDetection[] {
  const rows = csv.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];

  const headers = csvFields(rows[0]).map((header) => header.toLowerCase());
  const indexOf = (name: string) => headers.indexOf(name);
  const latitudeIndex = indexOf("latitude");
  const longitudeIndex = indexOf("longitude");
  const brightnessIndex = headers.includes("brightness") ? indexOf("brightness") : indexOf("bright_ti4");
  const confidenceIndex = indexOf("confidence");
  const satelliteIndex = indexOf("satellite");
  const instrumentIndex = indexOf("instrument");
  const dateIndex = indexOf("acq_date");
  const timeIndex = indexOf("acq_time");

  return rows.slice(1).flatMap((row) => {
    const values = csvFields(row);
    const latitude = Number(values[latitudeIndex]);
    const longitude = Number(values[longitudeIndex]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const acquiredTime = (values[timeIndex] ?? "").padStart(4, "0");
    const acquiredAt = `${values[dateIndex] ?? ""} ${acquiredTime}`.trim();
    return [{
      latitude,
      longitude,
      brightness: Number(values[brightnessIndex]) || 0,
      confidence: values[confidenceIndex] || "nominal",
      satellite: values[satelliteIndex] || "unknown",
      instrument: values[instrumentIndex] || null,
      acquiredAt,
    }];
  });
}

async function fetchPower(
  latitude: number,
  longitude: number,
  start: Date,
  end: Date,
): Promise<PowerApiResponse> {
  const params = new URLSearchParams({
    parameters: "T2M,PRECTOTCORR,RH2M,WS10M,ALLSKY_SFC_SW_DWN,GWETTOP,GWETROOT",
    community: "AG",
    longitude: longitude.toString(),
    latitude: latitude.toString(),
    start: powerDate(start),
    end: powerDate(end),
    format: "JSON",
  });
  const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`NASA POWER returned ${response.status}`);
  }
  return response.json() as Promise<PowerApiResponse>;
}

async function fetchFirms(
  latitude: number,
  longitude: number,
  days: number,
): Promise<FireDetection[]> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) throw new Error("NASA FIRMS map key is not configured");

  const padding = 0.45;
  const west = (longitude - padding).toFixed(3);
  const south = (latitude - padding).toFixed(3);
  const east = (longitude + padding).toFixed(3);
  const north = (latitude + padding).toFixed(3);
  const area = `${west},${south},${east},${north}`;
  const fetchSource = async (source: string) => {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/${source}/${area}/${Math.min(days, 5)}`;
    const response = await fetch(url);
    const body = await response.text();
    if (!response.ok) throw new Error(`NASA FIRMS ${source} returned ${response.status}: ${body.slice(0, 160)}`);
    return parseFirmsCsv(body);
  };
  const results = await Promise.allSettled([
    fetchSource("VIIRS_SNPP_NRT"),
    fetchSource("MODIS_NRT"),
  ]);
  const detections = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (detections.length > 0 || results.some((result) => result.status === "fulfilled")) return detections;
  const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  throw firstFailure?.reason ?? new Error("NASA FIRMS returned no data");
}

async function fetchSentinelFeed(latitude: number, longitude: number): Promise<LayerFeed> {
  const params = new URLSearchParams({
    platform: "Sentinel-1",
    intersectsWith: `POINT(${longitude} ${latitude})`,
    output: "geojson",
    processingLevel: "GRD_HD",
    maxResults: "1",
  });
  const response = await fetch(`https://api.daac.asf.alaska.edu/services/search/param?${params.toString()}`);
  if (!response.ok) throw new Error(`ASF Sentinel-1 returned ${response.status}`);
  const body = await response.json() as { features?: Array<{ properties?: { startTime?: string; sceneName?: string; url?: string } }> };
  const properties = body.features?.[0]?.properties;
  if (!properties) {
    return { status: "unavailable", source: "ASF DAAC · Sentinel-1", latestObservation: null, observationUrl: null };
  }
  return {
    status: "live",
    source: "ASF DAAC · Sentinel-1 GRD",
    latestObservation: properties.startTime ?? null,
    observationUrl: properties.url ?? null,
  };
}

async function fetchWaterFeed(): Promise<LayerFeed> {
  const datasets = ["SWOT_L2_HR_RIVERSP_2.0", "GPM_3IMERGDF"];
  const results = await Promise.all(datasets.map(async (shortName) => {
    const params = new URLSearchParams({ short_name: shortName, page_size: "1", sort_key: "-start_date" });
    const response = await fetch(`https://cmr.earthdata.nasa.gov/search/granules.json?${params.toString()}`);
    if (!response.ok) throw new Error(`NASA CMR ${shortName} returned ${response.status}`);
    const body = await response.json() as { feed?: { entry?: Array<{ title?: string; time_start?: string; links?: Array<{ rel?: string; href?: string }> }> } };
    const entry = body.feed?.entry?.[0];
    if (!entry) return null;
    const dataLink = entry.links?.find((link) => link.rel?.includes("data#"))?.href ?? null;
    return {
      source: shortName.startsWith("SWOT") ? "NASA Earthdata · SWOT" : "NASA Earthdata · GPM IMERG",
      latestObservation: entry.time_start ?? entry.title ?? null,
      observationUrl: dataLink,
    };
  }));
  const selected = results.find((result) => result !== null);
  if (!selected) {
    return { status: "unavailable", source: "NASA Earthdata · SWOT / GPM", latestObservation: null, observationUrl: null };
  }
  return { status: "live", ...selected };
}

function powerWindow(days = DEFAULT_DAYS): { start: Date; end: Date } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start, end };
}

function latestPowerPayload(power: PowerApiResponse, status: "live" | "cached") {
  const parameters = power.properties?.parameter ?? {};
  const keys = ["T2M", "PRECTOTCORR", "RH2M", "WS10M", "GWETTOP"];
  const date = Object.keys(parameters.T2M ?? {}).sort().reverse().find((candidate) =>
    keys.every((key) => {
      const value = parameters[key]?.[candidate];
      return typeof value === "number" && Number.isFinite(value) && value > -900;
    }),
  );
  if (!date) throw new Error("NASA POWER returned no complete observations");
  const value = (key: string) => Number(parameters[key]?.[date] ?? 0);
  return {
    temp: value("T2M"),
    humidity: value("RH2M"),
    precip: value("PRECTOTCORR"),
    wind: value("WS10M"),
    soil_moisture: value("GWETTOP"),
    last_updated: status === "cached" ? "cached" : isoDate(new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)),
      ),
    )),
    status,
  };
}

function cachedPowerPayload() {
  return {
    temp: FALLBACK_WEATHER.temperature,
    humidity: FALLBACK_WEATHER.humidity,
    precip: FALLBACK_WEATHER.precipitation,
    wind: FALLBACK_WEATHER.windSpeed,
    soil_moisture: FALLBACK_WEATHER.soilMoisture,
    last_updated: "cached",
    status: "cached" as const,
  };
}

router.get("/power", async (req, res): Promise<void> => {
  const latitude = Number(req.query.latitude ?? DEFAULT_LATITUDE);
  const longitude = Number(req.query.longitude ?? DEFAULT_LONGITUDE);
  const requestedDays = Number(req.query.days ?? DEFAULT_DAYS);
  const days = Number.isFinite(requestedDays) ? Math.max(7, Math.min(90, Math.floor(requestedDays))) : DEFAULT_DAYS;
  const { start, end } = powerWindow(days);

  try {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Invalid POWER coordinates");
    }
    const power = await fetchPower(latitude, longitude, start, end);
    res.status(200).json(latestPowerPayload(power, "live"));
  } catch (error) {
    req.log.error({ err: error }, "NASA POWER compatibility request failed; using Tahta cache");
    res.status(200).json(cachedPowerPayload());
  }
});

router.get("/earth/snapshot", async (req, res): Promise<void> => {
  const parsed = GetEarthSnapshotQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const latitude = parsed.data.latitude ?? DEFAULT_LATITUDE;
  const longitude = parsed.data.longitude ?? DEFAULT_LONGITUDE;
  const days = parsed.data.days ?? DEFAULT_DAYS;
  const { start, end } = powerWindow(days);

  try {
    const [powerResult, firmsResult, sentinelResult, waterResult] = await Promise.allSettled([
      fetchPower(latitude, longitude, start, end),
      fetchFirms(latitude, longitude, days),
      fetchSentinelFeed(latitude, longitude),
      fetchWaterFeed(),
    ]);

    const powerCached = powerResult.status === "rejected";
    if (powerCached) {
      req.log.error({ err: powerResult.reason }, "NASA POWER request failed; using Tahta cache");
    }
    const power = powerCached ? fallbackPower(start, end) : powerResult.value;
    const parameters = power.properties?.parameter ?? {};
    const candidateDates = Object.keys(parameters.T2M ?? {}).sort();
    const parameterKeys = ["T2M", "PRECTOTCORR", "RH2M", "WS10M", "ALLSKY_SFC_SW_DWN", "GWETTOP"];
    const dates = candidateDates.filter((date) =>
      parameterKeys.every((key) => {
        const value = parameters[key]?.[date];
        return typeof value === "number" && Number.isFinite(value) && value > -900;
      }),
    );
    const values = (key: string) => dates.map((date) => Number(parameters[key]?.[date] ?? 0));
    const temperature = values("T2M");
    const precipitation = values("PRECTOTCORR");
    const humidity = values("RH2M");
    const windSpeed = values("WS10M");
    const solarRadiation = values("ALLSKY_SFC_SW_DWN");
    const soilMoisture = values("GWETTOP");
    const last = (series: number[]) => series.at(-1) ?? 0;

    const firmsCached = firmsResult.status === "rejected";
    const firms = firmsCached ? FALLBACK_FIRE_DETECTIONS : firmsResult.value;
    if (firmsCached) {
      req.log.error({ err: firmsResult.reason }, "NASA FIRMS request failed; using Tahta cache");
    }
    const sentinel: LayerFeed = sentinelResult.status === "fulfilled"
      ? sentinelResult.value
      : { status: "unavailable", source: "ASF DAAC · Sentinel-1", latestObservation: null, observationUrl: null };
    const water: LayerFeed = waterResult.status === "fulfilled"
      ? waterResult.value
      : { status: "unavailable", source: "NASA Earthdata · SWOT / GPM", latestObservation: null, observationUrl: null };
    const dataStatus = powerCached || firmsCached
      ? "cached"
      : sentinelResult.status === "rejected" || waterResult.status === "rejected" ? "partial" : "live";

    const snapshot = {
      location: { name: LOCATION_NAME, latitude, longitude },
      fetchedAt: new Date().toISOString(),
      period: {
        start: dates[0] ? `${dates[0].slice(0, 4)}-${dates[0].slice(4, 6)}-${dates[0].slice(6, 8)}` : isoDate(start),
        end: dates.at(-1) ? `${dates.at(-1)!.slice(0, 4)}-${dates.at(-1)!.slice(4, 6)}-${dates.at(-1)!.slice(6, 8)}` : isoDate(end),
        days: dates.length,
      },
      power: {
        dates: dates.map((date) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`),
        temperature,
        precipitation,
        humidity,
        windSpeed,
        solarRadiation,
        soilMoisture,
        current: {
          temperature: last(temperature),
          precipitation: last(precipitation),
          humidity: last(humidity),
          windSpeed: last(windSpeed),
          solarRadiation: last(solarRadiation),
          soilMoisture: last(soilMoisture),
        },
      },
      fires: {
        count: firms.length,
        source: firmsCached ? "NASA FIRMS · cached" : process.env.FIRMS_MAP_KEY ? "NASA FIRMS · VIIRS SNPP + MODIS" : "NASA FIRMS key not configured",
        status: firmsCached ? "cached" : "live",
        detections: firms,
      },
      dataStatus,
      layers: [
        {
          id: "agriculture",
          name: "Agriculture · SMAP",
          shortName: "SMAP",
          status: "live",
          color: "#8FE388",
          description: "Live NASA POWER surface wetness and climate context for crop stress monitoring.",
          source: "NASA POWER · GWETTOP",
          latestObservation: dates.at(-1) ? `${dates.at(-1)!.slice(0, 4)}-${dates.at(-1)!.slice(4, 6)}-${dates.at(-1)!.slice(6, 8)}` : null,
          observationUrl: null,
        },
        {
          id: "fire",
          name: "Fire · MODIS + VIIRS",
          shortName: "FIRMS",
          status: firmsCached ? "cached" : "live",
          color: "#FF6B4A",
          description: "Near-real-time NASA FIRMS thermal anomaly detections.",
          source: firmsCached ? "NASA FIRMS · cached" : "NASA FIRMS · VIIRS SNPP + MODIS",
          latestObservation: firms.at(-1)?.acquiredAt ?? null,
          observationUrl: null,
        },
        {
          id: "ground",
          name: "Ground · InSAR",
          shortName: "S-1 / NISAR",
          status: sentinel.status,
          color: "#B497FF",
          description: sentinel.status === "live" ? "Latest Sentinel-1 GRD scene coverage is live; interferometric displacement requires paired scenes." : "Sentinel-1 scene coverage is temporarily unavailable.",
          source: sentinel.source,
          latestObservation: sentinel.latestObservation,
          observationUrl: sentinel.observationUrl,
        },
        {
          id: "water",
          name: "Water · SWOT + GPM",
          shortName: "SWOT / GPM",
          status: water.status,
          color: "#38D9FF",
          description: water.status === "live" ? `${water.source} scene coverage with NASA POWER precipitation context.` : "SWOT / GPM scene catalog is temporarily unavailable.",
          source: water.source,
          latestObservation: water.latestObservation,
          observationUrl: water.observationUrl,
        },
      ],
    };

    res.json(GetEarthSnapshotResponse.parse(snapshot));
  } catch (error) {
    req.log.error({ err: error }, "Earth snapshot request failed");
    res.status(502).json({ error: "NASA Earth observation feeds are temporarily unavailable." });
  }
});

router.get("/recommendations", async (req, res): Promise<void> => {
  const parsed = GetRecommendationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const latitude = parsed.data.latitude ?? DEFAULT_LATITUDE;
  const longitude = parsed.data.longitude ?? DEFAULT_LONGITUDE;
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);

  try {
    let powerCached = false;
    let power: PowerApiResponse;
    try {
      power = await fetchPower(latitude, longitude, start, end);
    } catch (error) {
      powerCached = true;
      req.log.error({ err: error }, "NASA POWER recommendations request failed; using Tahta cache");
      power = fallbackPower(start, end);
    }
    const parameters = power.properties?.parameter ?? {};
    const keys = ["T2M", "PRECTOTCORR", "RH2M", "WS10M", "GWETTOP"];
    const dates = Object.keys(parameters.T2M ?? {}).sort().filter((date) =>
      keys.every((key) => {
        const value = parameters[key]?.[date];
        return typeof value === "number" && Number.isFinite(value) && value > -900;
      }),
    );
    const series = (key: string) => dates.map((date) => Number(parameters[key]?.[date] ?? 0));
    const temperature = series("T2M");
    const precipitation = series("PRECTOTCORR");
    const humidity = series("RH2M");
    const wind = series("WS10M");
    const soilMoisture = series("GWETTOP");
    const last = (values: number[]) => values.at(-1) ?? 0;
    const rainLast7 = precipitation.slice(-7);
    const advice: { id: string; message: string; tone: string }[] = [];
    const currentTemperature = last(temperature);
    const currentHumidity = last(humidity);
    const currentRain = last(precipitation);
    const currentWind = last(wind);

    if (currentTemperature > 30 && currentHumidity < 35) {
      advice.push({ id: "heat-dry", message: "🔴 اسقي النهارده بالليل بعد 8 مساء", tone: "urgent" });
    }
    if (rainLast7.length === 7 && rainLast7.every((value) => value <= 0.01)) {
      advice.push({ id: "drought", message: "⚠️ جفاف - زود الري", tone: "warning" });
    }
    if (currentWind > 5) {
      advice.push({ id: "wind", message: "ما ترشش مبيد النهارده", tone: "warning" });
    }
    advice.push({ id: "crop", message: "ازرع برسيم و قمح", tone: "seasonal" });

    const snapshot = {
      fetchedAt: new Date().toISOString(),
      location: { name: LOCATION_NAME, latitude, longitude },
      weather: {
        temperature: currentTemperature,
        humidity: currentHumidity,
        rain: currentRain,
        wind: currentWind,
      },
      advice,
      crop: "ازرع برسيم و قمح",
      soilMoisture: last(soilMoisture),
      rainLast7Days: rainLast7.reduce((total, value) => total + value, 0),
      source: powerCached ? "NASA POWER · Tahta cache" : "NASA POWER · Tahta / Sohag",
      dataStatus: powerCached ? "cached" : "live",
    };

    res.json(GetRecommendationsResponse.parse(snapshot));
  } catch (error) {
    req.log.error({ err: error }, "Farmer recommendations request failed");
    res.json(GetRecommendationsResponse.parse({
      fetchedAt: new Date().toISOString(),
      location: { name: LOCATION_NAME, latitude, longitude },
      weather: {
        temperature: FALLBACK_WEATHER.temperature,
        humidity: FALLBACK_WEATHER.humidity,
        rain: FALLBACK_WEATHER.precipitation,
        wind: FALLBACK_WEATHER.windSpeed,
      },
      advice: [
        { id: "drought", message: "⚠️ جفاف - زود الري", tone: "warning" },
        { id: "crop", message: "ازرع برسيم و قمح", tone: "seasonal" },
      ],
      crop: "ازرع برسيم و قمح",
      soilMoisture: FALLBACK_WEATHER.soilMoisture,
      rainLast7Days: 0,
      source: "NASA POWER · Tahta cache",
      dataStatus: "cached",
    }));
  }
});

export default router;