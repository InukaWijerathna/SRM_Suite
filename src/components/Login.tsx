import { useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, LoaderCircle, LogIn, Settings2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Settings } from './Settings';

/**
 * Shown instead of the app whenever a real Sheet is connected and nobody's signed in on this
 * device yet (see AppContext.requiresLogin). The Settings gear is here too — not just inside
 * the app — since connecting a different sheet, or re-checking the Apps Script URL, is
 * something you may need to do before you can log in at all.
 */
export function Login() {
  const { orgConfig, login, authChecking, authError, retryAuth } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-[env(safe-area-inset-top)]">
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings: connect your Google Sheet"
        className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100"
      >
        <Settings2 className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <img src="/pwa-64x64.png" alt="" className="h-14 w-14 rounded-2xl shadow-sm" />
          <h1 className="mt-3 text-xl font-bold text-slate-900">{orgConfig.orgName || 'SRM Suite'}</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>

        {authChecking && <p role="status" className="mt-4 text-sm text-slate-600">Checking sign-in…</p>}
        {authError && <div className="mt-4 text-sm text-rose-700" role="alert"><p>{authError}</p><button type="button" onClick={retryAuth} className="mt-2 min-h-touch font-semibold underline">Retry connection</button></div>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="username"
              required
              className="mt-1.5 min-h-touch w-full rounded-xl border-0 bg-white px-3.5 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
            />
          </label>
          <div>
            <label htmlFor="login-password" className="block text-sm font-semibold text-slate-700">Password</label>
            <div className="relative mt-1.5">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoCapitalize="off"
                spellCheck={false}
                required
                className="min-h-touch w-full rounded-xl border-0 bg-white pl-3.5 pr-14 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls="login-password"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute inset-y-0 right-0 flex min-h-touch min-w-touch items-center justify-center rounded-r-xl text-slate-500 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-rose-700" role="alert">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || authChecking}
            className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? (
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="h-5 w-5" aria-hidden="true" />
            )}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-500">
          No account yet? An admin can create one from the spreadsheet: Extensions → Apps Script → run{' '}
          <span className="font-mono">setUserPassword</span>, or SRM Suite → Set a user's password if that menu is installed.
        </p>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
