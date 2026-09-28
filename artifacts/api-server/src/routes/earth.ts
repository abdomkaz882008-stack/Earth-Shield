import { Router, type IRouter } from "express";
import { GetEarthSnapshotQueryParams, GetEarthSnapshotResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_LATITUDE = 26.75;
const DEFAULT_LONGITUDE = 31.5;
const DEFAULT_DAYS = 30;
const LOCATION_NAME = "Tahta, Egypt";

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
    parameters: "T2M,PRECTOTCORR,RH2M,WS10M,ALLSKY_SFC_SW_DWN",
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
  if (!mapKey) return [];

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

router.get("/earth/snapshot", async (req, res): Promise<void> => {
  const parsed = GetEarthSnapshotQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const latitude = parsed.data.latitude ?? DEFAULT_LATITUDE;
  const longitude = parsed.data.longitude ?? DEFAULT_LONGITUDE;
  const days = parsed.data.days ?? DEFAULT_DAYS;
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);

  try {
    const [powerResult, firmsResult] = await Promise.allSettled([
      fetchPower(latitude, longitude, start, end),
      fetchFirms(latitude, longitude, days),
    ]);

    if (powerResult.status === "rejected") {
      req.log.error({ err: powerResult.reason }, "NASA POWER request failed");
      res.status(502).json({ error: "NASA POWER is temporarily unavailable." });
      return;
    }

    const power = powerResult.value;
    const parameters = power.properties?.parameter ?? {};
    const candidateDates = Object.keys(parameters.T2M ?? {}).sort();
    const parameterKeys = ["T2M", "PRECTOTCORR", "RH2M", "WS10M", "ALLSKY_SFC_SW_DWN"];
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
    const last = (series: number[]) => series.at(-1) ?? 0;

    const firms = firmsResult.status === "fulfilled" ? firmsResult.value : [];
    if (firmsResult.status === "rejected") {
      req.log.warn({ err: firmsResult.reason }, "NASA FIRMS request failed");
    }

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
        current: {
          temperature: last(temperature),
          precipitation: last(precipitation),
          humidity: last(humidity),
          windSpeed: last(windSpeed),
          solarRadiation: last(solarRadiation),
        },
      },
      fires: {
        count: firms.length,
          source: process.env.FIRMS_MAP_KEY ? "NASA FIRMS · VIIRS SNPP + MODIS" : "NASA FIRMS key not configured",
        detections: firms,
      },
      layers: [
        {
          id: "agriculture",
          name: "Agriculture · SMAP",
          shortName: "SMAP",
          status: "live",
          color: "#8FE388",
          description: "NASA POWER soil and climate context for crop stress monitoring.",
        },
        {
          id: "fire",
          name: "Fire · MODIS + VIIRS",
          shortName: "FIRMS",
          status: firmsResult.status === "fulfilled" ? "live" : "degraded",
          color: "#FF6B4A",
          description: "Near-real-time NASA FIRMS thermal anomaly detections.",
        },
        {
          id: "ground",
          name: "Ground · InSAR",
          shortName: "S-1 / NISAR",
          status: "preview",
          color: "#B497FF",
          description: "Sentinel-1 and NISAR displacement stream reserved for local scene ingestion.",
        },
        {
          id: "water",
          name: "Water · SWOT + GPM",
          shortName: "SWOT / GPM",
          status: "proxy",
          color: "#38D9FF",
          description: "NASA POWER precipitation proxy until SWOT/GPM scene data is connected.",
        },
      ],
    };

    res.json(GetEarthSnapshotResponse.parse(snapshot));
  } catch (error) {
    req.log.error({ err: error }, "Earth snapshot request failed");
    res.status(502).json({ error: "NASA Earth observation feeds are temporarily unavailable." });
  }
});

export default router;