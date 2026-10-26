'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, Clock, Loader2, Maximize, MonitorUp, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { queryKeys } from '@/lib/query/keys'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import AssignmentStudentActivity from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import ExamSidebar from './ExamSidebar'
import {
  ExamApiError,
  examHeartbeat,
  finishExam,
  getExamStatus,
  sendExamEvent,
  startExam,
  type ExamStatus,
} from '@services/courses/exams'

const HEARTBEAT_MS = 3_000

const fmt = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')

// Keys that open developer tools, print, save, or view the source.
function isBlockedShortcut(e: KeyboardEvent) {
  const k = e.key.toLowerCase()
  const mod = e.ctrlKey || e.metaKey
  if (k === 'f12' || k === 'printscreen') return true
  if (mod && ['p', 's', 'u'].includes(k)) return true
  if (mod && e.shiftKey && ['i', 'j', 'c', 's'].includes(k)) return true
  return false
}

// One id per browser tab, kept across reloads (sessionStorage), so a reload is not mistaken for a second window.
function getClientId(assignmentUuid: string) {
  const key = `exam-client-${assignmentUuid}`
  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.sessionStorage.setItem(key, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

// A tiny SVG tile with the student's name, repeated across the screen.
function watermarkUrl(text: string) {
  const safe = text.replace(/[<>&"']/g, '')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='160'><text x='20' y='90' transform='rotate(-24 160 80)' font-family='sans-serif' font-size='15' fill='rgba(0,0,0,0.13)'>${safe}</text></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

export default function ExamRunner({ assignmentUuid }: { assignmentUuid: string }) {
  const session = useVBSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const user = session?.data?.user
  const qc = useQueryClient()
  const dirty = useAssignmentDirtyTasks()

  const [status, setStatus] = useState<ExamStatus | null>(null)
  const [phase, setPhase] = useState<'loading' | 'lobby' | 'running' | 'submitted' | 'other_window'>('loading')
  const clientId = useRef('')
  useEffect(() => {
    clientId.current = getClientId(assignmentUuid)
  }, [assignmentUuid])
  const [starting, setStarting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const cameraStream = useRef<MediaStream | null>(null)
  const screenStream = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [clockOffset, setClockOffset] = useState(0) // server time minus browser time
  const finishedRef = useRef(false)
  const lastAutoAttempt = useRef(0)
  const [cameraOk, setCameraOk] = useState(false)
  const [screenOk, setScreenOk] = useState(false)
  const [fullscreenOk, setFullscreenOk] = useState(false)

  const settings = status?.settings

  const applyStatus = useCallback((next: ExamStatus) => {
    setClockOffset(new Date(next.server_time).getTime() - Date.now())
    setStatus(next)
    if (next.session_status === 'submitted') setPhase('submitted')
  }, [])

  // First load: where are we? (not started, resuming, or already handed in)
  useEffect(() => {
    if (!token) return
    getExamStatus(assignmentUuid, token)
      .then((s) => {
        applyStatus(s)
        setPhase(s.session_status === 'submitted' ? 'submitted' : 'lobby')
      })
      .catch((e) => setError(e instanceof ExamApiError ? e.message : 'Could not load the exam'))
  }, [assignmentUuid, token, applyStatus])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const secondsLeft = useMemo(() => {
    if (!status?.deadline_at || phase !== 'running') return null
    return (new Date(status.deadline_at).getTime() - (now + clockOffset)) / 1000
  }, [status?.deadline_at, phase, now, clockOffset])

  // ---- camera, screen, fullscreen ------------------------------------------------------------

  const attachVideo = useCallback(() => {
    if (videoRef.current && cameraStream.current) videoRef.current.srcObject = cameraStream.current
  }, [])

  const grabCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      cameraStream.current?.getTracks().forEach((t) => t.stop())
      cameraStream.current = stream
      const track = stream.getVideoTracks()[0]
      track.onended = () => setCameraOk(false)
      track.onmute = () => setCameraOk(false)
      track.onunmute = () => setCameraOk(true)
      setCameraOk(true)
      attachVideo()
      return true
    } catch {
      setCameraOk(false)
      toast.error('Allow the camera in your browser to continue.')
      return false
    }
  }, [attachVideo])

  const grabScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = stream.getVideoTracks()[0]
      const surface = (track.getSettings() as any).displaySurface
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach((t) => t.stop())
        toast.error('Share your entire screen, not just a window or a tab.')
        return false
      }
      screenStream.current?.getTracks().forEach((t) => t.stop())
      screenStream.current = stream
      track.onended = () => setScreenOk(false)
      setScreenOk(true)
      return true
    } catch {
      setScreenOk(false)
      toast.error('Share your entire screen to continue.')
      return false
    }
  }, [])

  const goFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      setFullscreenOk(true)
      return true
    } catch {
      toast.error('Your browser did not allow fullscreen.')
      return false
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreenOk(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const stopMedia = useCallback(() => {
    cameraStream.current?.getTracks().forEach((t) => t.stop())
    screenStream.current?.getTracks().forEach((t) => t.stop())
    cameraStream.current = null
    screenStream.current = null
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
  }, [])
  useEffect(() => stopMedia, [stopMedia])
  const stopMediaRef = useRef(stopMedia)
  useEffect(() => {
    stopMediaRef.current = stopMedia
  }, [stopMedia])

  const readyToStart =
    (!settings?.require_camera || cameraOk) && (!settings?.require_screen_share || screenOk)

  // ---- start / resume ------------------------------------------------------------------------

  const begin = async () => {
    if (starting) return
    setStarting(true)
    setError('')
    try {
      if (settings?.require_fullscreen && !(await goFullscreen())) return
      const next = await startExam(assignmentUuid, token, clientId.current)
      applyStatus(next)
      setPhase(next.session_status === 'submitted' ? 'submitted' : 'running')
      finishedRef.current = false
      qc.invalidateQueries({ queryKey: queryKeys.exams.status(assignmentUuid) })
    } catch (e) {
      setError(e instanceof ExamApiError ? e.message : 'Could not start the exam')
      if (e instanceof ExamApiError && (e.code === 'EXAM_ALREADY_TAKEN' || e.code === 'EXAM_TIME_UP')) setPhase('submitted')
    } finally {
      setStarting(false)
    }
  }

  // ---- heartbeat and supervision events ------------------------------------------------------

  const stateRef = useRef({ cameraOk, screenOk, fullscreenOk })
  useEffect(() => {
    stateRef.current = { cameraOk, screenOk, fullscreenOk }
  }, [cameraOk, screenOk, fullscreenOk])

  const beat = useCallback(async () => {
    try {
      const s = stateRef.current
      const next = await examHeartbeat(assignmentUuid, { camera_on: s.cameraOk, screen_shared: s.screenOk, fullscreen: s.fullscreenOk }, token, clientId.current)
      setOffline(false)
      if (next.superseded) {
        // The exam was opened in another browser or tab. This window closes.
        stopMediaRef.current()
        setPhase('other_window')
        return
      }
      applyStatus(next)
    } catch (e) {
      if (e instanceof ExamApiError && e.status >= 400 && e.status < 500) {
        setError(e.message)
      } else {
        setOffline(true)
      }
    }
  }, [assignmentUuid, token, applyStatus])

  useEffect(() => {
    if (phase !== 'running') return
    beat()
    const id = window.setInterval(beat, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [phase, beat])

  // A change in camera / screen / fullscreen is reported straight away, not on the next tick.
  useEffect(() => {
    if (phase === 'running') beat()
  }, [cameraOk, screenOk, fullscreenOk, phase, beat])

  useEffect(() => {
    if (phase !== 'running') return
    const send = (kind: string, detail?: string) => {
      sendExamEvent(assignmentUuid, kind, detail, token, clientId.current).catch(() => undefined)
    }
    const block = (kind: string) => (e: Event) => {
      e.preventDefault()
      send(kind)
    }
    const onVisibility = () => send(document.hidden ? 'tab_hidden' : 'tab_visible')
    const onBlur = () => send('window_blur')
    const onFocus = () => send('window_focus')
    const onCopy = block('copy_attempt')
    const onCut = block('cut_attempt')
    const onPaste = block('paste_attempt')
    const onContext = block('context_menu')
    const onPrint = () => send('print_attempt')
    const onKey = (e: KeyboardEvent) => {
      if (isBlockedShortcut(e)) {
        e.preventDefault()
        send('key_shortcut_blocked', e.key)
      }
    }
    const onPageHide = () => send('page_closed')

    // Extensions that inject their own panel or button into the page are flagged, not blocked:
    // a page cannot switch another extension off.
    const suspicious = /grammarly|chatgpt|gemini|copilot|claude|monica|merlin|sider|perplexity|lens|compose-ai|harpa|ai-assistant/i
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          const tag = node.tagName.toLowerCase()
          const label = `${tag} ${node.id} ${typeof node.className === 'string' ? node.className : ''}`
          const customElement = tag.includes('-') && !/^(nextjs-portal|vercel|next-)/.test(tag)
          if (customElement || suspicious.test(label)) send('extension_injection', label.trim().slice(0, 120))
        })
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: false })
    observer.observe(document.body, { childList: true, subtree: false })

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    document.addEventListener('contextmenu', onContext)
    window.addEventListener('beforeprint', onPrint)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('contextmenu', onContext)
      window.removeEventListener('beforeprint', onPrint)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [phase, assignmentUuid, token])

  // Attach the camera preview whenever the running view mounts.
  useEffect(() => {
    if (phase === 'running') attachVideo()
  }, [phase, attachVideo])

  // ---- hand in -------------------------------------------------------------------------------

  const handIn = useCallback(
    async (automatic = false) => {
      if (finishing || finishedRef.current) return
      finishedRef.current = true
      setFinishing(true)
      try {
        await dirty.flushAll().catch(() => false)
        const next = await finishExam(assignmentUuid, token, clientId.current)
        applyStatus(next)
        setPhase('submitted')
        stopMedia()
        qc.invalidateQueries({ queryKey: queryKeys.exams.status(assignmentUuid) })
        qc.invalidateQueries({ queryKey: queryKeys.assignments.submission(assignmentUuid) })
        toast.success(automatic ? 'Time is up. Your answers were handed in.' : 'Your exam was handed in.')
      } catch (e) {
        finishedRef.current = false
        const message = e instanceof ExamApiError ? e.message : 'Could not hand in. Check your connection and try again.'
        setError(message)
        toast.error(message)
      } finally {
        setFinishing(false)
      }
    },
    [finishing, dirty, assignmentUuid, token, applyStatus, stopMedia, qc]
  )

  useEffect(() => {
    if (phase !== 'running' || secondsLeft === null || secondsLeft > 0) return
    // Retry a failed automatic hand-in every few seconds, not every tick.
    if (Date.now() - lastAutoAttempt.current < 5000) return
    lastAutoAttempt.current = Date.now()
    handIn(true)
  }, [phase, secondsLeft, handIn])

  // ---- screens -------------------------------------------------------------------------------

  if (!token || phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        {error ? <p className="text-sm text-rose-600">{error}</p> : <Loader2 className="size-6 animate-spin text-neutral-400" />}
      </div>
    )
  }

  if (phase === 'other_window') {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-24 text-center">
        <ShieldAlert className="size-12 text-rose-600" />
        <h2 className="text-xl font-semibold text-neutral-900">This exam is open in another window</h2>
        <p className="text-sm text-neutral-600">
          An exam can only be taken in one browser window at a time, so this one has been closed. Continue in the other window. Your answers
          are safe and your time keeps running. Your instructor can see that a second window was opened.
        </p>
      </div>
    )
  }

  if (phase === 'submitted') {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CheckCircle2 className="size-12 text-emerald-600" />
        <h2 className="text-xl font-semibold text-neutral-900">Exam handed in</h2>
        <p className="text-sm text-neutral-600">
          Your answers have been submitted. Your instructor will share the results when they are ready. You can close this page.
        </p>
      </div>
    )
  }

  if (phase === 'lobby') {
    const resuming = status?.session_status === 'in_progress'
    const closed = status?.window === 'closed' && !resuming
    const notOpen = status?.window === 'not_open' && !resuming
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h2 className="text-2xl font-semibold text-neutral-900">{resuming ? 'Resume your exam' : 'Before you start'}</h2>
        <p className="mt-2 text-sm text-neutral-600">
          This is a timed, supervised exam. You have <strong>{settings?.duration_minutes} minutes</strong> once you start, and the clock never
          pauses. {resuming && <>You have <strong>{fmt(status?.seconds_left ?? 0)}</strong> left.</>}
        </p>
        {settings?.closes_at && <p className="mt-1 text-sm text-neutral-600">It closes at {when(settings.closes_at)}.</p>}
        {notOpen && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This exam opens at {when(settings?.opens_at ?? null)}.</p>}
        {closed && <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-sm text-neutral-700">This exam is closed.</p>}

        {!closed && !notOpen && (
          <>
            <ul className="mt-5 space-y-1.5 text-sm text-neutral-700">
              <li>Stay on this screen. Switching tabs or windows is recorded and your instructor can see it.</li>
              <li>Copying, pasting, printing and developer tools are blocked.</li>
              <li>If your connection drops or you close the page, come back to this page to continue. Your saved answers are kept.</li>
              <li>Camera and screen sharing are only checked to be on. Nothing is recorded or saved.</li>
            </ul>
            <div className="mt-6 space-y-3">
              {settings?.require_camera && (
                <Check ok={cameraOk} icon={<Camera className="size-4" />} label="Camera on" action={cameraOk ? undefined : { text: 'Turn on camera', run: grabCamera }} />
              )}
              {settings?.require_screen_share && (
                <Check ok={screenOk} icon={<MonitorUp className="size-4" />} label="Entire screen shared" action={screenOk ? undefined : { text: 'Share screen', run: grabScreen }} />
              )}
              {settings?.require_fullscreen && (
                <p className="flex items-center gap-2 text-sm text-neutral-600">
                  <Maximize className="size-4" /> The exam opens in fullscreen when you press the button below.
                </p>
              )}
            </div>
            {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
            <button
              type="button"
              onClick={begin}
              disabled={!readyToStart || starting}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-neutral-900 px-6 text-sm font-semibold text-white disabled:opacity-40"
            >
              {starting && <Loader2 className="size-4 animate-spin" />}
              {resuming ? 'Resume exam' : 'Start exam'}
            </button>
          </>
        )}
      </div>
    )
  }

  // running
  const needCamera = !!settings?.require_camera && !cameraOk
  const needScreen = !!settings?.require_screen_share && !screenOk
  const needFullscreen = !!settings?.require_fullscreen && !fullscreenOk
  const blocked = needCamera || needScreen || needFullscreen
  const low = (secondsLeft ?? Infinity) <= 300
  const mark = `${user?.first_name ?? ''} ${user?.last_name ?? ''} · ${user?.email ?? user?.username ?? ''}`.trim()

  // The exam covers the whole window so the course menu and navigation are out of reach.
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-white">
      <div className="sticky top-0 z-[65] flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
        <div className={`inline-flex items-center gap-2 text-lg font-semibold tabular-nums ${low ? 'text-rose-600' : 'text-neutral-900'}`}>
          <Clock className="size-5" /> {secondsLeft === null ? '--:--' : fmt(secondsLeft)}
        </div>
        <div className="flex items-center gap-3">
          {offline && <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Connection lost. Your answers are saved as you work; reconnecting...</span>}
          {settings?.require_camera && <video ref={videoRef} autoPlay muted playsInline className="h-12 w-16 rounded-md bg-neutral-900 object-cover" />}
          <button
            type="button"
            onClick={() => window.confirm('Hand in your exam now? You cannot change your answers afterwards.') && handIn(false)}
            disabled={finishing}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {finishing && <Loader2 className="size-4 animate-spin" />} Hand in
          </button>
        </div>
      </div>

      {error && <p className="px-6 pt-3 text-sm text-rose-600">{error}</p>}

      <div className="select-none">
        <AssignmentSubmissionProvider assignment_uuid={assignmentUuid}>
          <AssignmentProvider assignment_uuid={assignmentUuid}>
            <AssignmentsTaskProvider>
              <div className="mx-auto flex max-w-7xl flex-col gap-4 px-2 pt-4 lg:flex-row lg:px-6">
                <ExamSidebar assignmentUuid={assignmentUuid} />
                <main className="min-w-0 flex-1">
                  <AssignmentStudentActivity />
                </main>
              </div>
            </AssignmentsTaskProvider>
          </AssignmentProvider>
        </AssignmentSubmissionProvider>
      </div>

      {settings?.watermark && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[70]" style={{ backgroundImage: watermarkUrl(mark), backgroundRepeat: 'repeat' }} />
      )}

      {blocked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/95 p-6">
          <div className="max-w-md space-y-4 text-center">
            <ShieldAlert className="mx-auto size-10 text-rose-600" />
            <h3 className="text-lg font-semibold text-neutral-900">Fix this to continue</h3>
            <p className="text-sm text-neutral-600">The clock keeps running. Your instructor can see this.</p>
            {needCamera && <button type="button" onClick={grabCamera} className="mx-auto flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white"><Camera className="size-4" /> Turn the camera back on</button>}
            {needScreen && <button type="button" onClick={grabScreen} className="mx-auto flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white"><MonitorUp className="size-4" /> Share your entire screen again</button>}
            {needFullscreen && <button type="button" onClick={goFullscreen} className="mx-auto flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white"><Maximize className="size-4" /> Return to fullscreen</button>}
          </div>
        </div>
      )}
    </div>
  )
}

function Check({
  ok,
  icon,
  label,
  action,
}: {
  ok: boolean
  icon: React.ReactNode
  label: string
  action?: { text: string; run: () => void }
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-neutral-800">
        {icon} {label}
        {ok && <CheckCircle2 className="size-4 text-emerald-600" />}
      </span>
      {action && (
        <button type="button" onClick={action.run} className="h-9 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white">
          {action.text}
        </button>
      )}
    </div>
  )
}
