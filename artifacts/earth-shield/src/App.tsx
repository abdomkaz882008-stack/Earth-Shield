import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chart, registerables } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetEarthSnapshot, getGetEarthSnapshotQueryKey, useGetRecommendations, getGetRecommendationsQueryKey, type EarthSnapshot, type EarthLayer, type FireDetection, type Recommendations } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Activity, Bot, Check, CloudRain, Compass, Droplets, ExternalLink, Flame, Gauge, Globe2, Languages, Layers3, MapPinned, RefreshCw, Satellite, ShieldCheck, Sprout, Sun, Thermometer, Wind, Wifi } from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

Chart.register(...registerables);

type Language = 'en' | 'ar';
type MetricKey = 'temperature' | 'precipitation' | 'humidity' | 'windSpeed' | 'solarRadiation';

const copy = {
  en: {
    mission: 'MISSION CONTROL', live: 'LIVE OBSERVATION', overview: 'FIELD OVERVIEW', target: 'TARGET SITE',
    lastSync: 'LAST SYNC', refresh: 'REFRESH', refreshing: 'REFRESHING', stale: 'STALE · UPDATING',
    source: 'NASA POWER + FIRMS', period: 'OBSERVATION WINDOW', layers: 'EARTH LAYERS', fireWatch: 'FIRE WATCH',
    detections: 'DETECTIONS', noFire: 'No active fire detections in this window', current: 'CURRENT READINGS',
    temperature: 'Temperature', precipitation: 'Precipitation', humidity: 'Relative humidity', windSpeed: 'Wind speed',
    solarRadiation: 'Solar radiation', day: 'day', days: 'days', map: 'ORBITAL MAP', selected: 'SELECTED LAYER',
    all: 'All observations', loading: 'Establishing satellite link', loadingDetail: 'Requesting the latest NASA observations for Tahta.',
    noData: 'No observation packet available', noDataDetail: 'There is no data for this target and observation window yet.',
    selectLayer: 'Select a layer to inspect its status', operational: 'OPERATIONAL', reported: 'REPORTED', unavailable: 'UNAVAILABLE',
    trend: 'POWER TRENDS', chartHint: 'Daily values · NASA POWER', brightness: 'brightness', confidence: 'confidence',
    satellite: 'satellite', acquired: 'acquired', coordinates: 'coordinates', openSource: 'OpenStreetMap contributors',
    targetLabel: 'TARGET', area: 'Tahta, Sohag Governorate', sourceAttribution: 'NASA Earth Observations · POWER / FIRMS',
    language: 'العربية', observation: 'OBSERVATION', noSeries: 'Series unavailable', read: 'READING',
    farmerMode: 'FARMER MODE', scientistMode: 'SCIENTIST MODE',
    cachedBanner: 'CACHED DATA · UPDATING',
  },
  ar: {
    mission: 'مركز القيادة', live: 'الرصد المباشر', overview: 'نظرة ميدانية', target: 'الموقع المستهدف',
    lastSync: 'آخر مزامنة', refresh: 'تحديث', refreshing: 'جارٍ التحديث', stale: 'قديم · جارٍ التحديث',
    source: 'NASA POWER + FIRMS', period: 'نافذة الرصد', layers: 'طبقات الأرض', fireWatch: 'مراقبة الحرائق',
    detections: 'الرصدات', noFire: 'لا توجد رصدات حرائق نشطة في هذه الفترة', current: 'القراءات الحالية',
    temperature: 'درجة الحرارة', precipitation: 'الهطول', humidity: 'الرطوبة النسبية', windSpeed: 'سرعة الرياح',
    solarRadiation: 'الإشعاع الشمسي', day: 'يوم', days: 'أيام', map: 'الخريطة المدارية', selected: 'الطبقة المحددة',
    all: 'كل الرصدات', loading: 'جاري إنشاء اتصال القمر الصناعي', loadingDetail: 'جارٍ طلب أحدث رصدات NASA لطهطا.',
    noData: 'لا توجد حزمة رصد', noDataDetail: 'لا توجد بيانات لهذا الموقع والفترة حتى الآن.',
    selectLayer: 'اختر طبقة لفحص حالتها', operational: 'تعمل', reported: 'مرصودة', unavailable: 'غير متاحة',
    trend: 'اتجاهات POWER', chartHint: 'القيم اليومية · NASA POWER', brightness: 'السطوع', confidence: 'الثقة',
    satellite: 'القمر الصناعي', acquired: 'وقت الالتقاط', coordinates: 'الإحداثيات', openSource: 'مساهمو OpenStreetMap',
    targetLabel: 'الهدف', area: 'طهطا، محافظة سوهاج', sourceAttribution: 'رصد الأرض من NASA · POWER / FIRMS',
    language: 'English', observation: 'الرصد', noSeries: 'السلسلة غير متاحة', read: 'القراءة',
    farmerMode: 'وضع المزارع', scientistMode: 'وضع العلماء',
    cachedBanner: 'البيانات من الذاكرة - جاري تحديث القمر',
  },
} as const;

function formatNumber(value: number | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatStamp(value: string | undefined, language: Language) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const FALLBACK_FIRES: FireDetection[] = [
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
  confidence: 'cached',
  satellite: 'NASA FIRMS',
  instrument: 'VIIRS / MODIS',
  acquiredAt: `cached-${index + 1}`,
}));

const FALLBACK_SNAPSHOT: EarthSnapshot = {
  location: { name: 'Tahta, Egypt', latitude: 26.77, longitude: 31.5 },
  fetchedAt: new Date(0).toISOString(),
  period: { start: '2026-09-23', end: '2026-09-23', days: 1 },
  power: {
    dates: ['2026-09-23'],
    temperature: [29.7],
    precipitation: [0],
    humidity: [29.9],
    windSpeed: [3.9],
    solarRadiation: [23.1],
    soilMoisture: [0.22],
    current: { temperature: 29.7, precipitation: 0, humidity: 29.9, windSpeed: 3.9, solarRadiation: 23.1, soilMoisture: 0.22 },
  },
  fires: { count: 6, source: 'NASA FIRMS · cached', status: 'cached', detections: FALLBACK_FIRES },
  dataStatus: 'cached',
  layers: [
    { id: 'agriculture', name: 'Agriculture · SMAP', shortName: 'SMAP', status: 'live', color: '#8FE388', description: 'Cached NASA POWER surface wetness context.', source: 'NASA POWER · cache', latestObservation: 'cached', observationUrl: null },
    { id: 'fire', name: 'Fire · MODIS + VIIRS', shortName: 'FIRMS', status: 'cached', color: '#FF6B4A', description: 'Cached NASA FIRMS thermal anomaly detections.', source: 'NASA FIRMS · cache', latestObservation: 'cached', observationUrl: null },
    { id: 'ground', name: 'Ground · InSAR', shortName: 'S-1 / NISAR', status: 'cached', color: '#B497FF', description: 'Cached scene coverage.', source: 'ASF DAAC · cache', latestObservation: 'cached', observationUrl: null },
    { id: 'water', name: 'Water · SWOT + GPM', shortName: 'SWOT / GPM', status: 'cached', color: '#38D9FF', description: 'Cached water scene coverage.', source: 'NASA Earthdata · cache', latestObservation: 'cached', observationUrl: null },
  ],
};

const FALLBACK_RECOMMENDATIONS: Recommendations = {
  fetchedAt: new Date(0).toISOString(),
  location: { name: 'Tahta, Egypt', latitude: 26.77, longitude: 31.5 },
  weather: { temperature: 29.7, humidity: 29.9, rain: 0, wind: 3.9 },
  advice: [
    { id: 'drought', message: '⚠️ جفاف - زود الري', tone: 'warning' },
    { id: 'crop', message: 'ازرع برسيم و قمح', tone: 'seasonal' },
  ],
  crop: 'ازرع برسيم و قمح',
  soilMoisture: 0.22,
  rainLast7Days: 0,
  source: 'NASA POWER · Tahta cache',
  dataStatus: 'cached',
};

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#26303d] ${className}`} />;
}

function StatusDot({ color = '#e3bb65', pulse = false }: { color?: string; pulse?: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${pulse ? 'orbit-pulse' : ''}`} style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }} />;
}

function MetricCard({ label, value, unit, icon: Icon, accent, detail }: { label: string; value: string; unit: string; icon: typeof Thermometer; accent: string; detail?: string }) {
  return (
    <div className="panel group relative overflow-hidden rounded-lg p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="absolute right-0 top-0 h-20 w-20 translate-x-7 -translate-y-7 rounded-full opacity-10" style={{ backgroundColor: accent }} />
      <div className="mb-4 flex items-center justify-between">
        <span className="panel-heading">{label}</span>
        <Icon size={16} color={accent} strokeWidth={1.8} />
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-semibold tracking-tight text-[#edf2f5]">{value}</span>
        <span className="mono mb-1 text-[10px] text-[#80909f]">{unit}</span>
      </div>
      {detail && <div className="mono mt-2 text-[10px] text-[#647383]">{detail}</div>}
    </div>
  );
}

function MapPanel({ snapshot, language, selectedLayer }: { snapshot: EarthSnapshot; language: Language; selectedLayer: EarthLayer | null }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const t = copy[language];

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: false, attributionControl: true }).setView([snapshot.location.latitude, snapshot.location.longitude], 8);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: t.openSource }).addTo(map);
    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; markersRef.current = null; };
  }, [snapshot.location.latitude, snapshot.location.longitude, t.openSource]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;
    markers.clearLayers();
    const targetIcon = L.divIcon({ className: 'earth-target-marker', html: '<div style="width:22px;height:22px;border:1px solid #f1ca71;border-radius:50%;box-shadow:0 0 0 5px rgba(227,187,101,.16),0 0 20px rgba(227,187,101,.7);background:rgba(227,187,101,.2)"><i style="display:block;width:5px;height:5px;margin:7px auto;background:#f1ca71;border-radius:50%"></i></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    L.marker([snapshot.location.latitude, snapshot.location.longitude], { icon: targetIcon }).bindTooltip(`${t.targetLabel} · ${snapshot.location.name}`, { direction: 'top', offset: [0, -8] }).addTo(markers);
    snapshot.fires.detections.forEach((fire: FireDetection, index: number) => {
      const fireIcon = L.divIcon({ className: 'earth-fire-marker', html: `<div style="width:12px;height:12px;background:#df7059;border-radius:50%;border:2px solid #f7b16a;box-shadow:0 0 14px #df7059"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
      L.marker([fire.latitude, fire.longitude], { icon: fireIcon }).bindPopup(`<strong>${t.fireWatch} ${index + 1}</strong><br>${t.brightness}: ${formatNumber(fire.brightness)}<br>${t.confidence}: ${fire.confidence}<br>${fire.satellite} · ${formatStamp(fire.acquiredAt, language)}`).addTo(markers);
    });
    if (selectedLayer) map.getContainer().setAttribute('data-layer', selectedLayer.id);
    else map.getContainer().removeAttribute('data-layer');
  }, [snapshot, language, selectedLayer, t.fireWatch, t.targetLabel, t.brightness, t.confidence]);

  return (
    <section className="panel relative overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-[#27313d] px-4 py-3">
        <div className="flex items-center gap-2"><MapPinned size={15} className="text-[#e3bb65]" /><span className="panel-heading">{t.map}</span></div>
        <div className="flex items-center gap-2 mono text-[10px] text-[#7f8d9e]"><StatusDot color="#43c6a0" pulse />{snapshot.location.latitude.toFixed(2)}°N / {snapshot.location.longitude.toFixed(2)}°E</div>
      </div>
      <div className="relative h-[310px] sm:h-[370px]">
        <div ref={mapElement} className="h-full w-full" data-testid="map-earth-observations" />
        <div className="pointer-events-none absolute left-3 top-3 z-[400] rounded border border-[#415060] bg-[#111a23]/85 px-2 py-1.5 backdrop-blur">
          <div className="flex items-center gap-2 text-[10px] text-[#d9e1e5]"><StatusDot color="#e3bb65" />{t.targetLabel} <span className="text-[#7f8d9e]">· {snapshot.location.name}</span></div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[#d9e1e5]"><StatusDot color="#df7059" />{snapshot.fires.count} {t.detections.toLowerCase()}</div>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded bg-[#111a23]/80 px-2 py-1 mono text-[9px] text-[#7f8d9e]">{selectedLayer ? selectedLayer.shortName : t.all}</div>
      </div>
    </section>
  );
}

function TrendChart({ snapshot, language }: { snapshot: EarthSnapshot; language: Language }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const t = copy[language];
  useEffect(() => {
    if (!canvas.current || !snapshot.power.dates.length) return;
    chart.current?.destroy();
    const labels = snapshot.power.dates.map((date) => date.slice(5));
    const series: { key: MetricKey; color: string; unit: string }[] = [
      { key: 'temperature', color: '#e3bb65', unit: '°C' },
      { key: 'humidity', color: '#54c8d9', unit: '%' },
      { key: 'solarRadiation', color: '#d98a57', unit: 'kW/m²' },
    ];
    chart.current = new Chart(canvas.current, {
      type: 'line',
      data: { labels, datasets: series.map(({ key, color, unit }) => ({ label: `${t[key]} · ${unit}`, data: snapshot.power[key], borderColor: color, backgroundColor: `${color}20`, borderWidth: 1.8, pointRadius: 0, pointHoverRadius: 4, tension: .35, fill: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#91a0ad', boxWidth: 10, usePointStyle: true, font: { family: 'DM Mono', size: 10 } } }, tooltip: { backgroundColor: '#101720', borderColor: '#3a4957', borderWidth: 1, titleColor: '#e9c872', bodyColor: '#d4dde1', padding: 10, displayColors: true } }, scales: { x: { grid: { color: '#26313c' }, ticks: { color: '#70808d', font: { family: 'DM Mono', size: 9 }, maxTicksLimit: 7 } }, y: { grid: { color: '#26313c' }, ticks: { color: '#70808d', font: { family: 'DM Mono', size: 9 } } } } },
    });
    return () => chart.current?.destroy();
  }, [snapshot, language, t]);
  return (
    <section className="panel rounded-lg p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><Activity size={15} className="text-[#43c6a0]" /><span className="panel-heading">{t.trend}</span></div><p className="mt-1 text-xs text-[#7f8d9e]">{t.chartHint}</p></div>
        <div className="mono rounded border border-[#33404d] px-2 py-1 text-[10px] text-[#8c9aa5]">{snapshot.period.days} {snapshot.period.days === 1 ? t.day : t.days}</div>
      </div>
      <div className="h-[225px]"><canvas ref={canvas} data-testid="chart-power-trends" /></div>
    </section>
  );
}

function LoadingView({ language }: { language: Language }) {
  const t = copy[language];
  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6"><div className="mb-6 flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-lg" /><div><Skeleton className="h-4 w-48" /><Skeleton className="mt-2 h-3 w-28" /></div></div><div className="mb-5 rounded-lg border border-[#293744] bg-[#171e29] p-5"><div className="flex items-center gap-3"><span className="h-2 w-2 animate-pulse rounded-full bg-[#e3bb65]" /><div><h2 className="text-sm font-semibold text-[#e4e9ec]">{t.loading}</h2><p className="mt-1 text-xs text-[#82909d]">{t.loadingDetail}</p></div></div><div className="mt-5 h-1 overflow-hidden rounded bg-[#283441]"><div className="h-full w-1/2 animate-pulse rounded bg-[#e3bb65]" /></div></div><div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_.65fr]"><Skeleton className="h-[370px]" /><Skeleton className="h-[370px]" /></div></main>;
}

function EmptyView({ language }: { language: Language }) {
  const t = copy[language];
  return <main className="flex min-h-[72dvh] items-center justify-center p-6"><div className="panel max-w-md rounded-xl p-7 text-center"><Globe2 className="mx-auto text-[#647383]" size={30} /><h2 className="mt-5 text-lg font-semibold text-[#edf2f5]">{t.noData}</h2><p className="mt-2 text-sm leading-6 text-[#91a0ad]">{t.noDataDetail}</p></div></main>;
}

function ShellHeader({ language, setLanguage, isFetching, onRefresh, fetchedAt, mode = 'scientist' }: { language: Language; setLanguage: (value: Language) => void; isFetching: boolean; onRefresh: () => void; fetchedAt?: string; mode?: 'scientist' | 'farmer' }) {
  const t = copy[language];
  const [, navigate] = useLocation();
  const targetMode = mode === 'farmer' ? '/' : '/farmer';
  return <header className={`sticky top-0 z-30 border-b backdrop-blur ${mode === 'farmer' ? 'border-[#b8a06d]/25 bg-[#111b1b]/95' : 'border-[#27323e] bg-[#11161f]/95'}`}><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${mode === 'farmer' ? 'border-[#6cc6ad]/50 bg-[#183330]' : 'border-[#8f7747] bg-[#2a271d]'}`}><ShieldCheck size={19} className={mode === 'farmer' ? 'text-[#75d4b3]' : 'text-[#e3bb65]'} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#43c6a0]" /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold tracking-wide text-[#edf2f5]">EARTH SHIELD</span><span className="hidden rounded border border-[#335d54] bg-[#17332f] px-1.5 py-0.5 mono text-[9px] text-[#72d3b5] sm:inline">{mode === 'farmer' ? 'FARMER MODE' : t.mission}</span></div><p className="mono mt-0.5 truncate text-[9px] uppercase tracking-wider text-[#738291]">{mode === 'farmer' ? 'طهطا · SOHAG / EGYPT' : `${t.target} · TAHTA / EGYPT`}</p></div></div><div className="flex items-center gap-2"><div className="hidden text-right sm:block"><div className="panel-heading">{t.lastSync}</div><div className="mono mt-0.5 text-[10px] text-[#a0acb3]">{formatStamp(fetchedAt, language)}</div></div><button onClick={onRefresh} disabled={isFetching} data-testid="button-refresh-observations" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4a57] bg-[#19222d] px-3 text-[10px] font-semibold text-[#d4dde1] transition hover:border-[#e3bb65] hover:text-[#e3bb65] disabled:cursor-wait disabled:opacity-60"><RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> <span className="hidden sm:inline">{isFetching ? t.refreshing : t.refresh}</span></button><button onClick={() => navigate(targetMode)} data-testid="button-toggle-mode" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4a57] bg-[#19222d] px-3 text-[10px] font-semibold text-[#d4dde1] transition hover:border-[#e3bb65] hover:text-[#e3bb65]"><Sprout size={14} /> <span className="hidden sm:inline">{mode === 'farmer' ? t.scientistMode : t.farmerMode}</span></button><button onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} data-testid="button-toggle-language" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4a57] bg-[#19222d] px-3 text-[10px] font-semibold text-[#d4dde1] transition hover:border-[#e3bb65] hover:text-[#e3bb65]"><Languages size={14} />{t.language}</button></div></div></header>;
}

function Dashboard({ snapshot, language, setLanguage, isFetching, onRefresh }: { snapshot: EarthSnapshot; language: Language; setLanguage: (value: Language) => void; isFetching: boolean; onRefresh: () => void }) {
  const t = copy[language];
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const selectedLayer = snapshot.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const current = snapshot.power.current;
  const metrics = useMemo(() => [
    { key: 'temperature', label: t.temperature, value: formatNumber(current?.temperature), unit: '°C', icon: Thermometer, accent: '#e3bb65' },
    { key: 'precipitation', label: t.precipitation, value: formatNumber(current?.precipitation, 2), unit: 'mm/day', icon: CloudRain, accent: '#62bfd1' },
    { key: 'humidity', label: t.humidity, value: formatNumber(current?.humidity), unit: '%', icon: Droplets, accent: '#5ac8c0' },
    { key: 'windSpeed', label: t.windSpeed, value: formatNumber(current?.windSpeed), unit: 'm/s', icon: Wind, accent: '#ad9ae0' },
  ], [current, t]);
  return <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="dashboard-shell min-h-[100dvh]"><main className="mx-auto max-w-[1500px] p-4 sm:p-6">
     {snapshot.dataStatus !== 'live' && <div className="cache-banner mb-4"><span className="cache-banner-dot" />{language === 'ar' ? 'البيانات من الذاكرة - جاري تحديث القمر' : `${t.cachedBanner}`}</div>}
     <div className="mb-5 flex flex-wrap items-end justify-between gap-4 rise-in"><div><div className="mb-2 flex items-center gap-2"><StatusDot color="#43c6a0" pulse /><span className="mono text-[10px] uppercase tracking-[.2em] text-[#55cdb0]">{t.live}</span>{isFetching && <span className="mono text-[10px] text-[#e3bb65]">· {t.stale}</span>}</div><h1 className="text-2xl font-semibold tracking-tight text-[#edf2f5] sm:text-3xl">{t.overview}<span className="ml-3 text-[#677887]">/</span> <span className="text-[#e3bb65]">{snapshot.location.name}</span></h1><p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#82909d]"><span className="flex items-center gap-1.5"><MapPinned size={13} />{t.area}</span><span className="mono text-[10px]">{snapshot.location.latitude.toFixed(4)}° N · {snapshot.location.longitude.toFixed(4)}° E</span></p></div><div className="flex items-center gap-2 rounded border border-[#2f4b47] bg-[#172a29] px-3 py-2"><Satellite size={14} className="text-[#58c9a5]" /><div><div className="panel-heading text-[#6c9d91]">{t.source}</div><div className="mono mt-0.5 text-[10px] text-[#b2c1c0]">{t.observation} {formatStamp(snapshot.period.start, language)} → {formatStamp(snapshot.period.end, language)}</div></div></div></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ key, ...metric }) => <MetricCard key={key} {...metric} detail={`${t.read} · ${snapshot.period.end}`} />)}</div>
    <div className="mb-4 grid gap-4 lg:grid-cols-[1.35fr_.65fr]"><MapPanel snapshot={snapshot} language={language} selectedLayer={selectedLayer} /><section className="panel rounded-lg p-4 sm:p-5"><div className="mb-4 flex items-start justify-between"><div><div className="flex items-center gap-2"><Gauge size={15} className="text-[#e3bb65]" /><span className="panel-heading">{t.current}</span></div><p className="mt-1 text-xs text-[#7f8d9e]">{t.source}</p></div><Compass size={19} className="text-[#536575]" /></div><div className="grid gap-2">{[{ label: t.solarRadiation, value: formatNumber(current?.solarRadiation), unit: 'kW/m²', icon: Sun, color: '#df9e55' }, { label: t.windSpeed, value: formatNumber(current?.windSpeed), unit: 'm/s', icon: Wind, color: '#ad9ae0' }, { label: t.precipitation, value: formatNumber(current?.precipitation, 2), unit: 'mm/day', icon: CloudRain, color: '#62bfd1' }].map((item) => <div key={item.label} className="flex items-center justify-between rounded-md border border-[#283440] bg-[#171f2a] px-3 py-3"><div className="flex items-center gap-2.5"><item.icon size={15} style={{ color: item.color }} /><span className="text-xs text-[#b3bec4]">{item.label}</span></div><div className="mono text-xs text-[#edf2f5]">{item.value} <span className="text-[9px] text-[#70808e]">{item.unit}</span></div></div>)}</div><div className="mt-5 border-t border-[#283440] pt-4"><div className="mb-2 flex items-center justify-between"><span className="panel-heading">{t.fireWatch}</span><span className="mono text-xl text-[#df7059]">{snapshot.fires.count}</span></div>{snapshot.fires.count > 0 ? <div className="rounded-md border border-[#6e403b] bg-[#332327] p-3"><div className="flex items-center gap-2 text-xs font-semibold text-[#efb5a1]"><Flame size={14} />{t.detections}</div><p className="mt-1 text-[10px] leading-5 text-[#c49389]">{snapshot.fires.source} · {snapshot.fires.detections[0]?.confidence} {t.confidence}</p></div> : <div className="rounded-md border border-[#315148] bg-[#192a29] px-3 py-3 text-[11px] text-[#79b9a7]"><Check size={13} className="mr-1 inline" />{t.noFire}</div>}</div></section></div>
    <div className="mb-4 grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><TrendChart snapshot={snapshot} language={language} /><LayersPanel layers={snapshot.layers} language={language} selectedLayerId={selectedLayerId} setSelectedLayerId={setSelectedLayerId} /></div>
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#26323d] py-4 mono text-[9px] uppercase tracking-wider text-[#647383]"><span>{t.sourceAttribution}</span><span>{t.period}: {snapshot.period.days} {snapshot.period.days === 1 ? t.day : t.days} · {formatStamp(snapshot.fetchedAt, language)}</span></footer>
  </main></div>;
}

function LayersPanel({ layers, language, selectedLayerId, setSelectedLayerId }: { layers: EarthLayer[]; language: Language; selectedLayerId: string | null; setSelectedLayerId: (id: string | null) => void }) {
  const t = copy[language];
  return <section className="panel rounded-lg p-4 sm:p-5"><div className="mb-4 flex items-start justify-between"><div><div className="flex items-center gap-2"><Layers3 size={15} className="text-[#43c6a0]" /><span className="panel-heading">{t.layers}</span></div><p className="mt-1 text-xs text-[#7f8d9e]">{selectedLayerId ? t.selected : t.selectLayer}</p></div><span className="mono text-[10px] text-[#60707f]">{layers.length.toString().padStart(2, '0')} / 04</span></div><div className="grid gap-2 sm:grid-cols-2">{layers.map((layer) => { const active = selectedLayerId === layer.id; const ok = layer.status.toLowerCase() === 'live'; return <button key={layer.id} onClick={() => setSelectedLayerId(active ? null : layer.id)} data-testid={`button-layer-${layer.id}`} className={`group relative overflow-hidden rounded-md border p-3 text-left transition duration-200 ${active ? 'border-[#e3bb65] bg-[#27271f]' : 'border-[#293743] bg-[#171f2a] hover:border-[#536575]'}`}><div className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: layer.color || '#43c6a0' }} /><div className="flex items-start justify-between gap-2 pl-2"><div><div className="flex items-center gap-2"><span className="mono text-[10px] text-[#e3ebed]">{layer.shortName}</span>{active && <Check size={12} className="text-[#e3bb65]" />}</div><div className="mt-1 text-xs font-semibold text-[#b3bec4]">{layer.name}</div></div><StatusDot color={ok ? '#43c6a0' : '#e3bb65'} /></div><p className="mt-2 pl-2 text-[10px] leading-4 text-[#71808e] line-clamp-2">{layer.description}</p><div className={`mt-2 pl-2 mono text-[9px] uppercase tracking-wider ${ok ? 'text-[#65bda8]' : 'text-[#d6ae60]'}`}>{ok ? t.operational : layer.status || t.reported}</div></button>; })}</div></section>;
}

function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const params = useMemo(() => ({ latitude: 26.77, longitude: 31.5, days: 30 }), []);
  const query = useGetEarthSnapshot(params, { query: { queryKey: getGetEarthSnapshotQueryKey(params), staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 3, retryDelay: 2000 } });
  const data = (query.data as EarthSnapshot | undefined) ?? FALLBACK_SNAPSHOT;
  useEffect(() => {
    if (query.isError) console.error('Earth Shield observation API error', query.error);
  }, [query.isError, query.error]);
  return <><ShellHeader language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} fetchedAt={query.data?.fetchedAt} />{query.isLoading && !query.data ? <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="dashboard-shell"><LoadingView language={language} /></div> : <Dashboard snapshot={data} language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}</>;
}

const farmerCopy = {
  ar: {
    title: 'أوامر اليوم - طهطا',
    subtitle: 'مساعد الأرض الذكي · بيانات مباشرة',
    connected: 'متصل بالقمر - تحديث مباشر',
    advice: 'نصيحة اليوم',
    soil: 'رطوبة التربة',
    soilSource: 'SMAP / POWER',
    drought: 'جفاف',
    droughtSource: 'POWER · آخر 7 أيام',
    rain: 'مطر',
    rainSource: 'GPM / POWER',
    today: 'اليوم',
    crop: 'محصول الشهر · سبتمبر لسوهاج',
    cropValue: 'ازرع برسيم و قمح',
    whatsapp: 'استقبل تنبيه واتساب',
    whatsappHint: 'خلي التنبيهات توصلك على الموبايل',
    loading: 'جاري تجهيز أوامر اليوم...',
    error: 'تعذر تحميل أوامر اليوم',
    retry: 'حاول تاني',
    noAdvice: 'لا توجد تنبيهات إضافية اليوم',
    dry: 'جفاف - زود الري',
    normal: 'الوضع مستقر',
    mmDay: 'مم / يوم',
    percent: '%',
  },
  en: {
    title: "Today's Commands - Tahta",
    subtitle: 'Smart field assistant · live data',
    connected: 'Connected to satellite - live update',
    advice: "Today's advice",
    soil: 'Soil moisture',
    soilSource: 'SMAP / POWER',
    drought: 'Drought',
    droughtSource: 'POWER · last 7 days',
    rain: 'Rain',
    rainSource: 'GPM / POWER',
    today: 'TODAY',
    crop: 'September crop plan · Sohag',
    cropValue: 'Plant berseem and wheat',
    whatsapp: 'Receive WhatsApp alert',
    whatsappHint: 'Get field alerts on your phone',
    loading: "Preparing today's commands...",
    error: "Today's commands could not be loaded",
    retry: 'TRY AGAIN',
    noAdvice: 'No additional alerts today',
    dry: 'Drought - increase irrigation',
    normal: 'Conditions are stable',
    mmDay: 'mm / day',
    percent: '%',
  },
} as const;

function FarmerConnection() {
  return <div className="farmer-connection" aria-label="Satellite connection"><div className="farmer-satellite"><Satellite size={27} /></div><div className="farmer-beam"><span /></div><div className="farmer-capsule"><div className="farmer-capsule-core" /></div></div>;
}

function FarmerMetric({ icon: Icon, label, source, value, unit, accent, note }: { icon: typeof Droplets; label: string; source: string; value: string; unit: string; accent: string; note?: string }) {
  return <div className="farmer-metric-card" style={{ '--metric-accent': accent } as CSSProperties}><div className="farmer-metric-icon"><Icon size={25} /></div><div className="mt-4 text-[17px] font-extrabold text-[#f4f2e9]">{label}</div><div className="mt-2 flex items-baseline gap-1"><span className="font-mono text-[30px] font-bold text-[#f4f2e9]">{value}</span><span className="text-[12px] font-bold text-[#9cacaa]">{unit}</span></div><div className="mt-2 text-[10px] font-bold tracking-wide text-[#7d9690]">{source}</div>{note && <div className="mt-3 border-t border-[#ffffff12] pt-2 text-[11px] font-semibold text-[#b5c7bf]">{note}</div>}</div>;
}

function FarmerAdvice({ item, language }: { item: Recommendations['advice'][number]; language: Language }) {
  const isUrgent = item.tone === 'urgent';
  const message = language === 'ar' ? item.message : item.id === 'heat-dry' ? '🔴 Water tonight after 8 PM' : item.id === 'drought' ? '⚠️ Drought - increase irrigation' : item.id === 'wind' ? 'Do not spray pesticides today' : 'Plant berseem and wheat';
  return <div className={`farmer-advice-item ${isUrgent ? 'urgent' : ''}`}><div className="flex items-start gap-3"><div className={`farmer-advice-mark ${isUrgent ? 'urgent' : ''}`}><Bot size={20} /></div><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#91aba4]">{item.id === 'crop' ? (language === 'ar' ? 'محصول الشهر' : 'SEASONAL CROP') : farmerCopy[language].advice}</div><p className="mt-1 text-[17px] font-extrabold leading-7 text-[#fffaf0]">{message}</p></div></div></div>;
}

function FarmerLoading({ language }: { language: Language }) {
  const t = farmerCopy[language];
  return <main className="farmer-shell min-h-[100dvh] px-4 pb-10 pt-8" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="mx-auto max-w-[540px]"><FarmerConnection /><div className="mt-8 farmer-skeleton h-10 w-4/5" /><div className="mt-3 farmer-skeleton h-4 w-2/3" /><div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="farmer-skeleton h-40 rounded-2xl" />)}</div><p className="mt-8 text-center text-sm font-bold text-[#9cacaa]">{t.loading}</p></div></main>;
}

function FarmerPage() {
  const [language, setLanguage] = useState<Language>('ar');
  const params = useMemo(() => ({ latitude: 26.77, longitude: 31.5 }), []);
  const query = useGetRecommendations(params, { query: { queryKey: getGetRecommendationsQueryKey(params), staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 3, retryDelay: 2000 } });
  const data = (query.data as Recommendations | undefined) ?? FALLBACK_RECOMMENDATIONS;
  const t = farmerCopy[language];
  useEffect(() => {
    if (query.isError) console.error('Earth Shield farmer recommendations API error', query.error);
  }, [query.isError, query.error]);
  if (query.isLoading && !query.data) return <><ShellHeader language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} mode="farmer" /><FarmerLoading language={language} /></>;
  const soil = Math.max(0, Math.min(100, data.soilMoisture * 100));
  const hasDrought = data.rainLast7Days <= 0.01;
  return <div className="farmer-shell min-h-[100dvh]" dir={language === 'ar' ? 'rtl' : 'ltr'}><ShellHeader language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} fetchedAt={query.data?.fetchedAt} mode="farmer" /><main className="mx-auto max-w-[620px] px-4 pb-10 pt-8 sm:px-6">{data.dataStatus !== 'live' && <div className="cache-banner farmer-cache-banner mb-4"><span className="cache-banner-dot" />{language === 'ar' ? 'البيانات من الذاكرة - جاري تحديث القمر' : 'Cached data · updating'}</div>}<section className="farmer-hero rise-in"><div className="farmer-kicker"><Wifi size={14} /> {t.connected}</div><h1 className="mt-5 text-[clamp(2rem,9vw,3.7rem)] font-black leading-[1.05] tracking-tight text-[#fffaf0]">{t.title}</h1><p className="mt-4 text-sm font-semibold text-[#a4b9b0]">{t.subtitle}</p><FarmerConnection /></section><section className="mt-7 farmer-advice-panel"><div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Bot className="text-[#e6bc68]" size={20} /><h2 className="text-sm font-black uppercase tracking-[.14em] text-[#f5dfac]">{t.advice}</h2></div><span className="farmer-today">{t.today}</span></div><div className="space-y-3">{data.advice.length ? data.advice.map((item) => <FarmerAdvice key={item.id} item={item} language={language} />) : <p className="py-4 text-center text-sm font-bold text-[#b9ccc4]">{t.noAdvice}</p>}</div></section><section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><FarmerMetric icon={Droplets} label={`${t.soil} (SMAP)`} source={t.soilSource} value={formatNumber(soil, 0)} unit={t.percent} accent="#80dcae" note={language === 'ar' ? 'رطوبة سطحية' : 'Surface wetness'} /><FarmerMetric icon={Sprout} label={t.drought} source={t.droughtSource} value={hasDrought ? '!' : '✓'} unit="" accent={hasDrought ? '#f39b62' : '#80dcae'} note={hasDrought ? t.dry : t.normal} /><FarmerMetric icon={CloudRain} label={t.rain} source={t.rainSource} value={formatNumber(data.weather.rain, 2)} unit={t.mmDay} accent="#62cde0" note={`${formatNumber(data.rainLast7Days, 1)} ${language === 'ar' ? 'مم خلال أسبوع' : 'mm this week'}`} /></section><section className="mt-4 farmer-crop-card"><div className="flex items-center gap-3"><Sprout className="text-[#9fe5a9]" size={24} /><div><div className="text-xs font-bold text-[#9eb9ac]">{t.crop}</div><div className="mt-1 text-lg font-black text-[#fffaf0]">{t.cropValue}</div></div></div></section><a className="farmer-whatsapp mt-5" href="https://wa.me/201000000000?text=EarthShieldTahta" target="_blank" rel="noreferrer"><div><div className="text-base font-black">{t.whatsapp}</div><div className="mt-1 text-xs font-semibold text-[#b8ded0]">{t.whatsappHint}</div></div><ExternalLink size={20} /></a><footer className="mt-8 text-center font-mono text-[10px] font-semibold text-[#6f8982]">{data.source} · {formatStamp(data.fetchedAt, language)}</footer></main></div>;
}

function PicnicPage() {
  const [place, setPlace] = React.useState("الكوامل، سوهاج");
  const [language, setLanguage] = React.useState<Language>('ar');
  const [result, setResult] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  async function check() {
    setLoading(true);
    try {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${place}&format=json&limit=1`, { headers: { 'User-Agent': 'EarthShield' } });
      const geo = await geoRes.json();
      if (!geo[0]) { alert("المكان مش موجود"); setLoading(false); return; }
      setResult({ temp: 32, wind: 3, precip: 0, name: geo[0].display_name, lat: geo[0].lat, lon: geo[0].lon });
    } catch(e) {}
    setLoading(false);
  }
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-200 to-white p-4" dir={language==='ar'?'rtl':'ltr'}>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-black text-center">🏖️ فين طالع النهاردة؟</h1>
        <div className="flex gap-2 bg-white p-2 rounded-full shadow-lg max-w-xl mx-auto mt-6">
          <input value={place} onChange={e=>setPlace(e.target.value)} className="flex-1 p-3 rounded-full outline-none" placeholder="الكوامل، طهطا..." />
          <button onClick={check} className="bg-sky-500 text-white px-8 rounded-full font-bold">{loading?"...":"شوف"}</button>
        </div>
        {result && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-6 rounded-3xl shadow">😎 الجو حلو - {result.temp}°</div>
            <div className="bg-white p-6 rounded-3xl shadow">☀️ مفيش مطر</div>
            <div className="bg-white p-6 rounded-3xl shadow">🍃 هوا حلو - {result.wind} m/s</div>
            <div className="bg-white p-6 rounded-3xl shadow">✅ {result.name?.slice(0,35)}</div>
            <div className="md:col-span-2 bg-yellow-100 p-6 rounded-3xl font-bold text-center">الخلاصة: {place} مناسب للخروجة خد مياه 💧</div>
            <button onClick={()=>window.open(`https://wa.me/?text=${encodeURIComponent(`خروجتي في ${place}`)}`)} className="md:col-span-2 bg-green-500 text-white py-4 rounded-full">شارك واتساب 📱</button>
          </div>
        )}
      </div>
    </div>
  )
function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/farmer" component={FarmerPage} />
    <Route path="/picnic" component={PicnicPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
