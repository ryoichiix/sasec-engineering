import { useRef, useState } from 'react'
import { validateFile } from '../lib/work-updates'

/**
 * File picker for work updates and evening reports.
 *
 * Props:
 *   files        — File[] currently staged (controlled by parent)
 *   onChange(files: File[]) — called whenever the staged list changes
 *   disabled     — disable all interaction while uploading
 *
 * Accepts images + PDFs + Word docs + plain text. Max 10 MB each.
 * Shows thumbnail preview for images, filename + size for documents.
 */
export default function FileUploader({ files = [], onChange, disabled = false }) {
  const inputRef = useRef(null)
  const [errors, setErrors] = useState([])

  const handleChange = (e) => {
    const selected = Array.from(e.target.files || [])
    const errs = []
    const valid = []
    for (const f of selected) {
      const err = validateFile(f)
      if (err) errs.push(err)
      else valid.push(f)
    }
    setErrors(errs)
    if (valid.length) onChange([...files, ...valid])
    // Reset the input so the same file can be re-selected after removal
    e.target.value = ''
  }

  const remove = (idx) => {
    onChange(files.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      {/* Staged file list */}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <FileChip key={i} file={f} onRemove={() => remove(i)} disabled={disabled} />
          ))}
        </ul>
      )}

      {/* Errors */}
      {errors.map((e, i) => (
        <p key={i} className="text-xs text-rose-600">{e}</p>
      ))}

      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-100 disabled:opacity-50 transition"
      >
        <PaperclipIcon />
        Attach file
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}

function FileChip({ file, onRemove, disabled }) {
  const isImage = file.type.startsWith('image/')
  const [preview] = useState(() => isImage ? URL.createObjectURL(file) : null)
  const kb = file.size < 1024 * 1024
    ? `${Math.round(file.size / 1024)} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`

  return (
    <li className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 overflow-hidden pr-2 max-w-xs">
      {isImage && preview ? (
        <img
          src={preview}
          alt={file.name}
          className="w-10 h-10 object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-10 flex items-center justify-center bg-slate-200 flex-shrink-0">
          <DocIcon />
        </div>
      )}
      <div className="min-w-0 flex-1 py-1">
        <p className="text-xs font-medium text-slate-700 truncate">{file.name}</p>
        <p className="text-xs text-slate-400">{kb}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="text-slate-400 hover:text-rose-600 disabled:opacity-40 transition flex-shrink-0"
        title="Remove"
      >
        <XIcon />
      </button>
    </li>
  )
}

function PaperclipIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.243 0l-7 7a3 3 0 0 0 4.243 4.243l.707-.707-1.414-1.414-.707.707a1 1 0 0 1-1.414-1.414l7-7a1 1 0 0 1 1.414 1.414L10.5 9.914l1.414 1.414 2.121-2.121a3 3 0 0 0 0-4.243Z" clipRule="evenodd" />
      <path fillRule="evenodd" d="M9.5 10.5 8.086 9.086l-2.829 2.828a3 3 0 1 0 4.243 4.243l2.828-2.828-1.414-1.414-2.828 2.828a1 1 0 1 1-1.414-1.414L9.5 10.5Z" clipRule="evenodd" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-500">
      <path fillRule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Zm2 6a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Z" clipRule="evenodd" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}
