import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  ExternalLink,
  FileCode,
  FileSpreadsheet,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  Phone,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ApiError, pingScript } from '../services/api';
import { useBackHandler } from '../lib/backButton';
import { cn } from '../lib/cn';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

const REPO = 'https://github.com/InukaWijerathna/SRM_Suite';
const CODE_GS_URL = `${REPO}/blob/main/apps-script/Code.gs`;
const REGISTRATION_GS_URL = `${REPO}/blob/main/apps-script/Registration.gs`;
const APPS_SCRIPT_GUIDE_URL = 'https://developers.google.com/apps-script/guides/web';
const BLANK_TEMPLATE_URL = '/templates/srm-suite-blank-template.xlsx';

const SETUP_STEPS = [
  {
    title: 'Get a blank student sheet',
    detail: 'Download the template below, then upload it to Google Drive and open it there.',
  },
  {
    title: 'Convert it to Google Sheets',
    detail: 'In Drive: File → Save as Google Sheets. (It must be a native Sheet, not an uploaded .xlsx file.)',
  },
  {
    title: 'Add the backend script',
    detail: "In the Sheet: Extensions → Apps Script. Paste in Code.gs, save, then run setup once and approve the permissions it asks for.",
  },
  {
    title: 'Publish it as a web app',
    detail: 'Deploy → New deployment → Web app. Execute as "Me", who has access "Anyone". Copy the URL it gives you (ends in /exec).',
  },
  {
    title: 'Connect it here',
    detail: 'Paste that URL below, tap Test connection, then Save.',
  },
];

interface SettingsProps {
  onClose: () => void;
}

/**
 * Where each organization connects its own Google Sheet. Nothing here is built into the app
 * — it's entered once, kept on-device (see services/storage.ts), and can be changed or reset
 * to demo data at any time without a new app build.
 */
export function Settings({ onClose }: SettingsProps) {
  const { orgConfig, setOrgConfig, isLive, username, logout } = useApp();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useBackHandler(onClose);

  const [orgName, setOrgName] = useState(orgConfig.orgName);
  const [scriptUrl, setScriptUrl] = useState(orgConfig.scriptUrl);
  const [apiKey, setApiKey] = useState(orgConfig.apiKey);
  const [countryCode, setCountryCode] = useState(orgConfig.countryCode);
  const [nationalLength, setNationalLength] = useState(String(orgConfig.nationalLength));

  const [testState, setTestState] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({
    state: 'idle',
  });
  const [saved, setSaved] = useState(false);
  // Open by default until connected — once an org is live, collapse it out of the way.
  const [instructionsOpen, setInstructionsOpen] = useState(!isLive);

  // Focus trap + Esc-to-close, matching the student detail modal.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  const [templateError, setTemplateError] = useState<string | null>(null);

  // The <a download> attribute works in a browser, but Capacitor's Android WebView has no
  // download manager wired up for it and silently does nothing. On native, fetch the bundled
  // asset ourselves and hand it to the OS share sheet instead, so the user can save it to
  // Drive, Files, or anywhere else — that's the closest native equivalent of "download" here.
  const handleDownloadTemplate = async () => {
    if (!Capacitor.isNativePlatform()) return; // let the plain <a download> handle it on web
    setTemplateError(null);
    try {
      const res = await fetch(BLANK_TEMPLATE_URL);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const written = await Filesystem.writeFile({
        path: 'srm-suite-blank-template.xlsx',
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({ title: 'SRM Suite blank student sheet', url: written.uri });
    } catch {
      setTemplateError('Could not open the share sheet — try again, or download it from a browser instead.');
    }
  };

  const describeError = (err: unknown) =>
    err instanceof ApiError ? err.message : 'Could not reach that URL.';

  const handleTest = async () => {
    setTestState({ state: 'testing' });
    try {
      await pingScript(scriptUrl.trim(), apiKey.trim());
      setTestState({ state: 'ok', message: 'Connected successfully.' });
    } catch (err) {
      setTestState({ state: 'error', message: describeError(err) });
    }
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const length = Math.max(4, Math.min(15, Number(nationalLength) || 9));
    setOrgConfig({
      orgName: orgName.trim(),
      scriptUrl: scriptUrl.trim(),
      apiKey: apiKey.trim(),
      countryCode: countryCode.replace(/\D/g, '') || '94',
      nationalLength: length,
    });
    setSaved(true);
    setTimeout(onClose, 650);
  };

  const handleUseDemo = () => {
    setOrgName('');
    setScriptUrl('');
    setApiKey('');
    setOrgConfig({ orgName: '', scriptUrl: '', apiKey: '', countryCode: '94', nationalLength: 9 });
    setSaved(true);
    setTimeout(onClose, 650);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative flex max-h-[92dvh] w-full max-w-lg animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="settings-title" className="text-lg font-bold text-slate-900">
              Connect your Google Sheet
            </h2>
            <p className="text-sm text-slate-500">
              {isLive ? 'Connected' : 'Currently showing demo data'} — this device only, nothing is built into the app.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain">
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
            <button
              type="button"
              onClick={() => setInstructionsOpen((v) => !v)}
              aria-expanded={instructionsOpen}
              className="flex w-full items-center gap-2 text-left text-sm font-bold text-slate-800"
            >
              <ListChecks className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
              First time setting this up?
              <span className="ml-auto text-xs font-medium text-brand-700 underline underline-offset-2">
                {instructionsOpen ? 'Hide steps' : 'Show steps'}
              </span>
            </button>

            {instructionsOpen && (
              <div className="mt-3">
                <a
                  href={BLANK_TEMPLATE_URL}
                  download="srm-suite-blank-template.xlsx"
                  onClick={(e) => {
                    if (!Capacitor.isNativePlatform()) return;
                    e.preventDefault();
                    void handleDownloadTemplate();
                  }}
                  className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                >
                  <Download className="h-5 w-5" aria-hidden="true" />
                  Download blank student sheet (.xlsx)
                </a>
                {templateError && (
                  <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-rose-700" role="alert">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {templateError}
                  </p>
                )}

                <ol className="mt-4 space-y-3">
                  {SETUP_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                        <p className="text-sm text-slate-500">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={CODE_GS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-touch items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                  >
                    <FileCode className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    Code.gs <ExternalLink className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </a>
                  <a
                    href={REGISTRATION_GS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-touch items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                  >
                    <FileCode className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    Registration.gs (optional) <ExternalLink className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </a>
                  <a
                    href={APPS_SCRIPT_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-touch items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    Apps Script guide <ExternalLink className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </a>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Registration.gs adds a Google Form that registers a student, generates their QR code and adds them
                  to the sheet automatically. Optional — you can add students by editing the sheet directly instead.
                </p>
              </div>
            )}
          </div>

          <form onSubmit={handleSave} className="px-5 py-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Organization name</span>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Elpitiya Divisional Office"
                className="mt-1.5 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
              />
              <span className="mt-1 block text-xs text-slate-500">Shown in the app header.</span>
            </label>

            <label className="mt-4 block">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Database className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Apps Script web app URL
              </span>
              <input
                type="url"
                value={scriptUrl}
                onChange={(e) => {
                  setScriptUrl(e.target.value);
                  setTestState({ state: 'idle' });
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1.5 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 font-mono text-sm shadow-sm ring-1 ring-slate-300 placeholder:font-sans placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
              />
              <span className="mt-1 block text-xs text-slate-500">
                From Deploy → New deployment → Web app in your sheet's Apps Script editor (see the steps above).
              </span>
            </label>

            <label className="mt-4 block">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
                API key <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <input
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestState({ state: 'idle' });
                }}
                placeholder="Only if your deployment set one"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1.5 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 font-mono text-sm shadow-sm ring-1 ring-slate-300 placeholder:font-sans placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
              />
            </label>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={!scriptUrl.trim() || testState.state === 'testing'}
                className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
              >
                {testState.state === 'testing' ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Database className="h-4 w-4" aria-hidden="true" />
                )}
                Test connection
              </button>
              {testState.state === 'ok' && (
                <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700" role="status">
                  <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {testState.message}
                </p>
              )}
              {testState.state === 'error' && (
                <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-rose-700" role="alert">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {testState.message}
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Phone className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Phone number format
              </span>
              <div className="mt-1.5 flex gap-2">
                <label className="flex-1">
                  <span className="text-xs text-slate-500">Country dialing code</span>
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="94"
                    inputMode="numeric"
                    className="mt-1 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
                  />
                </label>
                <label className="w-28">
                  <span className="text-xs text-slate-500">Digits (no code)</span>
                  <input
                    value={nationalLength}
                    onChange={(e) => setNationalLength(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="9"
                    inputMode="numeric"
                    className="mt-1 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
                  />
                </label>
              </div>
              <span className="mt-1 block text-xs text-slate-500">
                Used for tel: and WhatsApp links. Default is Sri Lanka (94, 9 digits) — change for your country.
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="submit"
                className={cn(
                  'flex min-h-touch items-center justify-center gap-2 rounded-xl px-5 font-bold text-white shadow-sm transition active:scale-[0.98]',
                  saved ? 'bg-emerald-600' : 'bg-brand-600 hover:bg-brand-700',
                )}
              >
                {saved ? <CircleCheck className="h-5 w-5" aria-hidden="true" /> : null}
                {saved ? 'Saved' : 'Save'}
              </button>
              {isLive && (
                <button
                  type="button"
                  onClick={handleUseDemo}
                  className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Disconnect &amp; use demo data instead
                </button>
              )}
              {username && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <span className="text-sm text-slate-600">
                    Signed in as <span className="font-semibold text-slate-900">{username}</span>
                  </span>
                  <button
                    type="button"
                    onClick={logout}
                    className="flex min-h-touch items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
