import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  CameraOff,
  CircleAlert,
  CircleCheck,
  Clock,
  Keyboard,
  LoaderCircle,
  SwitchCamera,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp, type ScanOutcome } from '../context/AppContext';
import { playDuplicate, playError, playSuccess, unlockAudio, vibrate } from '../services/audio';
import { clockTime } from '../lib/time';
import { humanize, normalizeId } from '../lib/roster';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';
import { HealthBadges } from './HealthBadges';

const REGION_ID = 'qr-reader';
/** The same code seen again within this gap (ms) is the same "presentation", not a re-scan. */
const SAME_CODE_GAP_MS = 2500;
const CARD_VISIBLE_MS = 4000;

type Facing = 'environment' | 'user';
type Flash = 'ok' | 'dup' | 'err' | null;

// Camera start/stop are async and must never overlap: a stop() still in flight while the
// next start() runs (StrictMode remounts, switching front/rear, quick tab changes) can
// leave the camera light on. Every lifecycle step is queued on this single chain.
let cameraChain: Promise<unknown> = Promise.resolve();
const enqueueCamera = (task: () => Promise<void>) => {
  cameraChain = cameraChain.then(task, task);
};

// html5-qrcode calls video.play() without handling the returned promise. Stopping the camera
// right after starting it (quick tab flips) makes the browser reject that promise with an
// AbortError. Nothing is wrong, so drop just that one case instead of logging an error.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: string; message?: string } | undefined;
  if (reason?.name === 'AbortError' && /play\(\)/i.test(reason.message ?? '')) event.preventDefault();
});

function describeCameraError(err: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Camera access needs HTTPS (or localhost). Open the app from its secure address.';
  }
  const raw = typeof err === 'string' ? err : err instanceof Error ? `${err.name} ${err.message}` : '';
  if (/NotAllowed|Permission|denied/i.test(raw)) {
    return 'Camera permission was denied. Allow camera access for this site in your browser settings, then retry.';
  }
  if (/NotFound|Overconstrained|no camera|requested device not found/i.test(raw)) {
    return 'No camera was found on this device. Use the manual ID box below instead.';
  }
  if (/NotReadable|in use|Could not start video/i.test(raw)) {
    return 'The camera is being used by another app. Close it and retry.';
  }
  return 'The camera could not be started.';
}

const CORNERS = [
  'left-0 top-0 rounded-tl-2xl border-l-4 border-t-4',
  'right-0 top-0 rounded-tr-2xl border-r-4 border-t-4',
  'bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4',
  'bottom-0 right-0 rounded-br-2xl border-b-4 border-r-4',
];

const FLASH_COLOR: Record<Exclude<Flash, null>, string> = {
  ok: 'border-emerald-400',
  dup: 'border-amber-400',
  err: 'border-rose-400',
};

interface QRScannerProps {
  /** True while the scanner tab is showing. The camera only runs while active. */
  active: boolean;
}

export function QRScanner({ active }: QRScannerProps) {
  const { studentsById, students, recordScan, marks, queue, soundOn, setSoundOn } = useApp();

  const [facing, setFacing] = useState<Facing>('environment');
  const [attempt, setAttempt] = useState(0);
  const [camera, setCamera] = useState<{ state: 'starting' | 'scanning' | 'error'; message?: string }>({
    state: 'starting',
  });
  const [result, setResult] = useState<{ seq: number; outcome: ScanOutcome } | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [manualId, setManualId] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const seq = useRef(0);
  const lastSeen = useRef({ text: '', at: 0 });

  // Shared by camera decodes and manual entry.
  const processId = useCallback(
    (raw: string) => {
      const outcome = recordScan(raw);
      switch (outcome.kind) {
        case 'recorded':
          playSuccess();
          vibrate(80);
          break;
        case 'duplicate':
          playDuplicate();
          vibrate([60, 70, 60]);
          break;
        default:
          playError();
          vibrate(160);
      }
      setFlash(outcome.kind === 'recorded' ? 'ok' : outcome.kind === 'duplicate' ? 'dup' : 'err');
      setResult({ seq: ++seq.current, outcome });
    },
    [recordScan],
  );

  // The camera callback is registered once per camera start; route it through a ref so it
  // always calls the latest handler without restarting the stream.
  const onDecodeRef = useRef((_text: string) => {});
  onDecodeRef.current = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const now = Date.now();
    const seen = lastSeen.current;
    const sameCode = seen.text === text && now - seen.at < SAME_CODE_GAP_MS;
    lastSeen.current = { text, at: now }; // holding a code in view keeps extending the gap
    if (!sameCode) processId(text);
  };

  // ---- camera lifecycle
  // The scanner stays mounted (just hidden) while another tab is open, so its DOM is still
  // there when stop() runs. Unmounting instead would rip the <video> out from under
  // html5-qrcode mid-start and cause "play() request was interrupted" rejections.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let started = false;
    setCamera({ state: 'starting' });

    const scanner = new Html5Qrcode(REGION_ID, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported: true, // native, hardware-accelerated decoding where available
    });

    enqueueCamera(async () => {
      if (!alive) return; // unmounted before our turn in the queue
      try {
        await scanner.start(
          { facingMode: facing },
          { fps: 10, aspectRatio: 1 },
          (text) => onDecodeRef.current(text),
          undefined,
        );
        started = true;
        if (alive) setCamera({ state: 'scanning' });
      } catch (err) {
        if (alive) setCamera({ state: 'error', message: describeCameraError(err) });
      }
    });

    const container = document.getElementById(REGION_ID);
    return () => {
      alive = false;
      enqueueCamera(async () => {
        if (started) {
          try {
            await scanner.stop(); // stops the tracks, which releases the camera
          } catch {
            /* already stopped */
          }
        }
        // Belt and braces: never leave a track running if start() failed half-way.
        container?.querySelectorAll('video').forEach((video) => {
          (video.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
        });
        try {
          scanner.clear();
        } catch {
          /* nothing to clear */
        }
      });
    };
  }, [active, facing, attempt]);

  // Audio may only start after a gesture; opening this tab was one, so unlock right away.
  useEffect(() => {
    if (active) unlockAudio();
  }, [active]);

  // Result card and frame flash clear themselves.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), CARD_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(timer);
  }, [flash, result]);

  // ---- manual fallback
  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    const typed = normalizeId(manualId);
    if (!typed) return;

    let id = typed;
    if (!studentsById.has(typed) && typed.length >= 4) {
      // Allow typing just the tail of the ID (e.g. "0060410") when it identifies one child.
      const matches = students.filter((s) => s.childId.endsWith(typed));
      if (matches.length > 1) {
        setManualError(`${matches.length} students end with "${typed}". Type the full ID.`);
        return;
      }
      if (matches.length === 1) id = matches[0].childId;
    }
    setManualError(null);
    processId(id);
    setManualId('');
  };

  const presentToday = [...marks.values()].filter((m) => m.status === 'Present').length;

  return (
    <section aria-label="QR scanner" hidden={!active} className="mx-auto max-w-md px-4 pb-10 pt-4">
      {/* Camera viewport */}
      <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-3xl bg-slate-900 shadow-lg">
        <div id={REGION_ID} className="h-full w-full" />

        {/* Targeting frame: dims everything outside a centred square */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]">
            {CORNERS.map((c) => (
              <span
                key={c}
                className={cn(
                  'absolute h-9 w-9 border-white transition-colors duration-150',
                  c,
                  flash && FLASH_COLOR[flash],
                )}
              />
            ))}
            {camera.state === 'scanning' && (
              <span className="absolute inset-x-3 h-0.5 animate-scan-line rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.8)]" />
            )}
          </div>
        </div>

        {camera.state === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900 text-slate-200" role="status">
            <LoaderCircle className="h-8 w-8 animate-spin" aria-hidden="true" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}

        {camera.state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900 p-6 text-center text-slate-200">
            <CameraOff className="h-10 w-10 text-slate-400" aria-hidden="true" />
            <p className="text-sm">{camera.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="min-h-touch rounded-xl bg-white px-5 font-semibold text-slate-900 hover:bg-slate-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Slide-up result card */}
        {result && (
          <div
            key={result.seq}
            role="status"
            onClick={() => setResult(null)}
            className="absolute inset-x-3 bottom-3 z-10 animate-slide-up overflow-hidden rounded-2xl bg-white text-left shadow-2xl ring-1 ring-black/10"
          >
            <ResultCard outcome={result.outcome} />
          </div>
        )}
      </div>

      {/* Camera controls + live tally */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
          }}
          className="flex min-h-touch flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
        >
          <SwitchCamera className="h-5 w-5" aria-hidden="true" />
          {facing === 'environment' ? 'Rear camera' : 'Front camera'}
        </button>
        <button
          type="button"
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Mute beeps and vibration' : 'Unmute beeps and vibration'}
          onClick={() => {
            unlockAudio();
            setSoundOn(!soundOn);
          }}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
        >
          {soundOn ? <Volume2 className="h-5 w-5" aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      <p className="mt-3 text-center text-sm text-slate-500" role="status">
        <span className="font-semibold text-emerald-700">{presentToday} present</span> today
        {queue.length > 0 && <> · {queue.length} waiting to sync</>}
      </p>

      {/* Manual fallback */}
      <form onSubmit={submitManual} className="mt-5">
        <label htmlFor="manual-id" className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          QR card damaged or missing? Type the ID
        </label>
        <div className="flex gap-2">
          <input
            id="manual-id"
            value={manualId}
            onChange={(e) => {
              setManualId(e.target.value.toUpperCase());
              setManualError(null);
            }}
            placeholder="LKA0060410"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-h-touch min-w-0 flex-1 rounded-xl border-0 bg-white px-4 font-mono text-base uppercase tracking-wide shadow-sm ring-1 ring-slate-300 placeholder:normal-case placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
          />
          <button
            type="submit"
            disabled={!manualId.trim()}
            className="min-h-touch shrink-0 rounded-xl bg-brand-600 px-5 font-bold text-white transition hover:bg-brand-700 disabled:bg-slate-300 disabled:text-slate-500"
          >
            Mark Present
          </button>
        </div>
        {manualError && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-700" role="alert">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {manualError}
          </p>
        )}
      </form>
    </section>
  );
}

function ResultCard({ outcome }: { outcome: ScanOutcome }) {
  if (outcome.kind === 'unknown') {
    return (
      <div className="flex items-center gap-3 bg-rose-50 p-4">
        <CircleAlert className="h-8 w-8 shrink-0 text-rose-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-bold text-rose-900">Not recognised</p>
          <p className="truncate text-sm text-rose-800">
            &ldquo;{outcome.id || '?'}&rdquo; isn&apos;t in the student list.
          </p>
        </div>
      </div>
    );
  }

  const { child } = outcome;
  return (
    <div>
      {outcome.kind === 'duplicate' && (
        <p className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Already scanned at {clockTime(outcome.timestamp)}
        </p>
      )}
      {outcome.kind === 'inactive' && (
        <p className="flex items-center gap-2 bg-rose-100 px-4 py-2 text-sm font-bold text-rose-900">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Inactive student, not recorded
        </p>
      )}
      {outcome.kind === 'recorded' && (
        <p className="flex items-center gap-2 bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-900">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Marked Present · {clockTime(outcome.timestamp)}
        </p>
      )}
      <div className="flex items-center gap-3 p-3">
        <Avatar child={child} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-slate-900">{child.fullName}</p>
          <p className="truncate text-xs text-slate-500">
            <span className="font-mono">{child.childId}</span>
            {' · '}
            {[humanize(child.schoolGrade), child.gnDivision].filter(Boolean).join(' · ')}
          </p>
          <HealthBadges child={child} className="mt-1" />
        </div>
      </div>
    </div>
  );
}
