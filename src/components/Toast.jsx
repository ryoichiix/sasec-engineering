import { useEffect } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

/**
 * Lightweight toast. Controlled by the parent via a `toast` state object
 * ({ message, type }) — render <Toast toast={toast} onClose={() => setToast(null)} />.
 * Auto-dismisses after `duration` ms.
 */
export default function Toast({ toast, onClose, duration = 3000 }) {
  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(onClose, duration)
    return () => clearTimeout(id)
  }, [toast, onClose, duration])

  if (!toast) return null
  const isError = toast.type === 'error'

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto z-[60] flex justify-center md:justify-end pointer-events-none">
      <div
        className={`pointer-events-auto flex items-start gap-2.5 max-w-sm w-full md:w-auto rounded-xl px-4 py-3 shadow-lg animate-toast-in ${
          isError
            ? 'bg-white border border-[#FECACA]'
            : 'bg-white border border-[#BBF7D0]'
        }`}
      >
        {isError
          ? <AlertCircle className="h-5 w-5 text-[#EF4444] flex-shrink-0 mt-px" strokeWidth={2} />
          : <CheckCircle2 className="h-5 w-5 text-[#16A34A] flex-shrink-0 mt-px" strokeWidth={2} />}
        <p className="text-sm font-medium text-[#0F172A] flex-1">{toast.message}</p>
        <button
          onClick={onClose}
          className="text-[#94A3B8] hover:text-[#0F172A] transition flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
