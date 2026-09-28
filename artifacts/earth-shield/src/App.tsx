import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chart, registerables } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetEarthSnapshot, getGetEarthSnapshotQueryKey, type EarthSnapshot, type EarthLayer, type FireDetection } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Activity, AlertTriangle, Check, CloudRain, Compass, Droplets, Flame, Gauge, Globe2, Languages, Layers3, MapPinned, RefreshCw, Satellite, ShieldCheck, Sun, Thermometer, Wind } from 'lucide-react';
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
    errorTitle: 'Observation link interrupted', errorDetail: 'NASA data could not be loaded. The target remains saved; try the link again.',
    retry: 'RETRY LINK', noData: 'No observation packet available', noDataDetail: 'There is no data for this target and observation window yet.',
    selectLayer: 'Select a layer to inspect its status', operational: 'OPERATIONAL', reported: 'REPORTED', unavailable: 'UNAVAILABLE',
    trend: 'POWER TRENDS', chartHint: 'Daily values · NASA POWER', brightness: 'brightness', confidence: 'confidence',
    satellite: 'satellite', acquired: 'acquired', coordinates: 'coordinates', openSource: 'OpenStreetMap contributors',
    targetLabel: 'TARGET', area: 'Tahta, Sohag Governorate', sourceAttribution: 'NASA Earth Observations · POWER / FIRMS',
    language: 'العربية', observation: 'OBSERVATION', noSeries: 'Series unavailable', read: 'READING',
  },
  ar: {
    mission: 'مركز القيادة', live: 'الرصد المباشر', overview: 'نظرة ميدانية', target: 'الموقع المستهدف',
    lastSync: 'آخر مزامنة', refresh: 'تحديث', refreshing: 'جارٍ التحديث', stale: 'قديم · جارٍ التحديث',
    source: 'NASA POWER + FIRMS', period: 'نافذة الرصد', layers: 'طبقات الأرض', fireWatch: 'مراقبة الحرائق',
    detections: 'الرصدات', noFire: 'لا توجد رصدات حرائق نشطة في هذه الفترة', current: 'القراءات الحالية',
    temperature: 'درجة الحرارة', precipitation: 'الهطول', humidity: 'الرطوبة النسبية', windSpeed: 'سرعة الرياح',
    solarRadiation: 'الإشعاع الشمسي', day: 'يوم', days: 'أيام', map: 'الخريطة المدارية', selected: 'الطبقة المحددة',
    all: 'كل الرصدات', loading: 'جاري إنشاء اتصال القمر الصناعي', loadingDetail: 'جارٍ طلب أحدث رصدات NASA لطهطا.',
    errorTitle: 'انقطع اتصال الرصد', errorDetail: 'تعذر تحميل بيانات NASA. الموقع محفوظ؛ حاول الاتصال مرة أخرى.',
    retry: 'إعادة الاتصال', noData: 'لا توجد حزمة رصد', noDataDetail: 'لا توجد بيانات لهذا الموقع والفترة حتى الآن.',
    selectLayer: 'اختر طبقة لفحص حالتها', operational: 'تعمل', reported: 'مرصودة', unavailable: 'غير متاحة',
    trend: 'اتجاهات POWER', chartHint: 'القيم اليومية · NASA POWER', brightness: 'السطوع', confidence: 'الثقة',
    satellite: 'القمر الصناعي', acquired: 'وقت الالتقاط', coordinates: 'الإحداثيات', openSource: 'مساهمو OpenStreetMap',
    targetLabel: 'الهدف', area: 'طهطا، محافظة سوهاج', sourceAttribution: 'رصد الأرض من NASA · POWER / FIRMS',
    language: 'English', observation: 'الرصد', noSeries: 'السلسلة غير متاحة', read: 'القراءة',
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

function ErrorView({ language, onRetry }: { language: Language; onRetry: () => void }) {
  const t = copy[language];
  return <main className="flex min-h-[72dvh] items-center justify-center p-6"><div className="panel max-w-md rounded-xl p-7 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#8a4f4d] bg-[#402b31]"><AlertTriangle className="text-[#e28370]" size={21} /></div><h2 className="mt-5 text-lg font-semibold text-[#edf2f5]">{t.errorTitle}</h2><p className="mt-2 text-sm leading-6 text-[#91a0ad]">{t.errorDetail}</p><button onClick={onRetry} data-testid="button-retry-observations" className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#e3bb65] px-4 py-2.5 text-xs font-bold text-[#131820] transition hover:bg-[#f1cd7c]"><RefreshCw size={14} />{t.retry}</button></div></main>;
}

function EmptyView({ language }: { language: Language }) {
  const t = copy[language];
  return <main className="flex min-h-[72dvh] items-center justify-center p-6"><div className="panel max-w-md rounded-xl p-7 text-center"><Globe2 className="mx-auto text-[#647383]" size={30} /><h2 className="mt-5 text-lg font-semibold text-[#edf2f5]">{t.noData}</h2><p className="mt-2 text-sm leading-6 text-[#91a0ad]">{t.noDataDetail}</p></div></main>;
}

function ShellHeader({ language, setLanguage, isFetching, onRefresh, fetchedAt }: { language: Language; setLanguage: (value: Language) => void; isFetching: boolean; onRefresh: () => void; fetchedAt?: string }) {
  const t = copy[language];
  return <header className="sticky top-0 z-30 border-b border-[#27323e] bg-[#11161f]/95 backdrop-blur"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#8f7747] bg-[#2a271d]"><ShieldCheck size={19} className="text-[#e3bb65]" /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#43c6a0]" /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold tracking-wide text-[#edf2f5]">EARTH SHIELD</span><span className="hidden rounded border border-[#335d54] bg-[#17332f] px-1.5 py-0.5 mono text-[9px] text-[#72d3b5] sm:inline">{t.mission}</span></div><p className="mono mt-0.5 truncate text-[9px] uppercase tracking-wider text-[#738291]">{t.target} · TAHTA / EGYPT</p></div></div><div className="flex items-center gap-2"><div className="hidden text-right sm:block"><div className="panel-heading">{t.lastSync}</div><div className="mono mt-0.5 text-[10px] text-[#a0acb3]">{formatStamp(fetchedAt, language)}</div></div><button onClick={onRefresh} disabled={isFetching} data-testid="button-refresh-observations" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4a57] bg-[#19222d] px-3 text-[10px] font-semibold text-[#d4dde1] transition hover:border-[#e3bb65] hover:text-[#e3bb65] disabled:cursor-wait disabled:opacity-60"><RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> <span className="hidden sm:inline">{isFetching ? t.refreshing : t.refresh}</span></button><button onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} data-testid="button-toggle-language" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#3b4a57] bg-[#19222d] px-3 text-[10px] font-semibold text-[#d4dde1] transition hover:border-[#e3bb65] hover:text-[#e3bb65]"><Languages size={14} />{t.language}</button></div></div></header>;
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
  const params = useMemo(() => ({ latitude: 26.75, longitude: 31.5, days: 30 }), []);
  const query = useGetEarthSnapshot(params, { query: { queryKey: getGetEarthSnapshotQueryKey(params), staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 2 } });
  const data = query.data as EarthSnapshot | undefined;
  return <><ShellHeader language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} fetchedAt={data?.fetchedAt} />{query.isLoading ? <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="dashboard-shell"><LoadingView language={language} /></div> : query.isError ? <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="dashboard-shell"><ErrorView language={language} onRetry={() => query.refetch()} /></div> : !data ? <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="dashboard-shell"><EmptyView language={language} /></div> : <Dashboard snapshot={data} language={language} setLanguage={setLanguage} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}</>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
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
