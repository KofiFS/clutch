import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Clapperboard, Info, X } from 'lucide-react'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info' | 'clip'
  title: string
  body?: string
  /** Optional action button, e.g. Undo. */
  action?: { label: string; onClick: () => void }
  ms?: number
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => number
  dismiss: (id: number) => void
}

const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setToasts((list) => [...list.slice(-4), { ...t, id }])
    return id
  }, [])
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss])
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 w-[360px] pointer-events-none" aria-live="polite">
        {toasts.map((t) => <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </Ctx.Provider>
  )
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, toast.ms ?? (toast.action ? 7000 : 4000))
    return () => clearTimeout(id)
  }, [toast, onClose])
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info, clip: Clapperboard }[toast.kind]
  const tone = { success: 'text-ok', error: 'text-bad', info: 'text-ink-2', clip: 'text-live' }[toast.kind]
  return (
    <div role="status" className="pointer-events-auto card-2 px-4 py-3 flex items-start gap-3 shadow-[var(--shadow-pop)] pop-in">
      <Icon size={18} className={`${tone} mt-0.5 shrink-0`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-5">{toast.title}</div>
        {toast.body && <div className="text-xs text-ink-2 mt-0.5 leading-relaxed break-words">{toast.body}</div>}
        {toast.action && (
          <button className="btn-sm mt-2" onClick={() => { toast.action!.onClick(); onClose() }}>{toast.action.label}</button>
        )}
      </div>
      <button className="text-ink-3 hover:text-ink shrink-0 -mr-1 -mt-0.5 p-1" onClick={onClose} aria-label="Dismiss"><X size={14} /></button>
    </div>
  )
}

export function useToast() {
  const api = useContext(Ctx)
  if (!api) throw new Error('ToastProvider missing')
  return api
}
