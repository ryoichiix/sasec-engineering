import { useEffect, useState } from 'react'
import { getSignedUrl } from '../lib/work-updates'

/**
 * Renders a row of attachment chips for a work update or evening report.
 *
 * Props:
 *   attachments — array of work_attachments rows
 *                 { id, storage_path, file_name, mime_type, file_size }
 *
 * Images → inline thumbnail (click to open full-size in new tab).
 * Docs   → paperclip chip with filename + download link.
 *
 * Signed URLs are fetched once on mount per attachment.
 */
export default function AttachmentList({ attachments = [] }) {
  if (!attachments.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} />
      ))}
    </div>
  )
}

function AttachmentChip({ attachment }) {
  const [url, setUrl] = useState(null)
  const isImage = attachment.mime_type?.startsWith('image/')
  const isAudio = attachment.mime_type?.startsWith('audio/')

  useEffect(() => {
    let isMounted = true
    getSignedUrl(attachment.storage_path).then(({ data }) => {
      if (isMounted && data?.signedUrl) setUrl(data.signedUrl)
    })
    return () => { isMounted = false }
  }, [attachment.storage_path])

  if (!url) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 border border-slate-200 rounded px-2 py-1">
        <SpinIcon />
        {isAudio ? 'Voice message' : attachment.file_name}
      </span>
    )
  }

  if (isAudio) {
    return (
      <div className="inline-flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-full pl-2.5 pr-3 py-1 max-w-xs">
        <MicPlayIcon />
        <span className="text-xs font-medium text-sky-700 whitespace-nowrap">Voice</span>
        <audio
          src={url}
          controls
          preload="metadata"
          className="h-7 min-w-0"
          style={{ maxWidth: 200 }}
        />
      </div>
    )
  }

  if (isImage) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={attachment.file_name}
        className="block rounded border border-slate-200 overflow-hidden hover:border-slate-400 transition flex-shrink-0"
      >
        <img
          src={url}
          alt={attachment.file_name}
          className="w-16 h-16 object-cover"
        />
      </a>
    )
  }

  const kb = attachment.file_size < 1024 * 1024
    ? `${Math.round(attachment.file_size / 1024)} KB`
    : `${(attachment.file_size / (1024 * 1024)).toFixed(1)} MB`

  return (
    <a
      href={url}
      download={attachment.file_name}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 transition max-w-[200px]"
      title={`${attachment.file_name} (${kb})`}
    >
      <DocIcon />
      <span className="truncate">{attachment.file_name}</span>
      <span className="text-slate-400 flex-shrink-0">{kb}</span>
    </a>
  )
}

function SpinIcon() {
  return (
    <svg className="w-3 h-3 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
      <path fillRule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Zm2 6a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Z" clipRule="evenodd" />
    </svg>
  )
}

function MicPlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0 text-sky-500">
      <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
      <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
    </svg>
  )
}
