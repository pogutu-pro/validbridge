'use client'
import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, Loader2, Maximize, MonitorUp, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { queryKeys } from '@/lib/query/keys'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import {
  ExamApiError,
  getExamMonitor,
  getExamStatus,
  getExamStudentEvents,
  saveExamSettings,
  type ExamRosterRow,
} from '@services/courses/exams'

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fmt = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) return '–'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
const field = 'h-10 rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400'

const STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-neutral-100 text-neutral-600',
  in_progress: 'bg-blue-50 text-blue-700',
  submitted: 'bg-emerald-50 text-emerald-700',
}
const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted' }

const EVENT_LABEL: Record<string, string> = {
  started: 'Started the exam',
  resumed: 'Came back to the exam',
  tab_hidden: 'Switched to another tab',
  tab_visible: 'Returned to the exam tab',
  window_blur: 'Clicked outside the exam window',
  window_focus: 'Returned to the exam window',
  fullscreen_exit: 'Left fullscreen',
  fullscreen_enter: 'Entered fullscreen',
  camera_off: 'Camera was off',
  camera_on: 'Camera back on',
  screen_share_stopped: 'Stopped sharing the screen',
  screen_share_started: 'Started sharing the screen',
  copy_attempt: 'Tried to copy',
  cut_attempt: 'Tried to cut',
  paste_attempt: 'Tried to paste',
  context_menu: 'Opened the right-click menu',
  print_attempt: 'Tried to print',
  key_shortcut_blocked: 'Pressed a blocked shortcut',
  devtools_suspected: 'Developer tools suspected',
  extension_injection: 'A browser extension added something to the page',
  connection_gap: 'Connection gap',
  second_window: 'Opened the exam in another browser or tab',
  page_closed: 'Closed or left the page',
  submitted: 'Handed in',
  auto_submitted: 'Submitted automatically when time ran out',
}

function Flag({ on, icon, label }: { on: boolean | null; icon: React.ReactNode; label: string }) {
  const color = on === null ? 'text-neutral-300' : on ? 'text-emerald-600' : 'text-rose-600'
  return (
    <span className={color} title={`${label}: ${on === null ? 'unknown' : on ? 'on' : 'off'}`}>
      {icon}
    </span>
  )
}

export default function AssignmentExamSubPage({ assignment_uuid }: { assignment_uuid: string }) {
  const uuid = 'assignment_' + assignment_uuid
  const session = useVBSession() as any
  const token = session?.data?.tokens?.access_token
  const qc = useQueryClient()

  const status = useQuery({
    queryKey: queryKeys.exams.status(uuid),
    queryFn: () => getExamStatus(uuid, token),
    enabled: !!token,
  })
  const settings = status.data?.settings
  const [form, setForm] = useState({
    enabled: true,
    duration_minutes: 60,
    opens_at: '',
    closes_at: '',
    require_camera: true,
    require_screen_share: true,
    require_fullscreen: true,
    watermark: true,
  })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ExamRosterRow | null>(null)

  useEffect(() => {
    if (!settings) return
    setForm({
      enabled: settings.enabled,
      duration_minutes: settings.duration_minutes,
      opens_at: toLocalInput(settings.opens_at),
      closes_at: toLocalInput(settings.closes_at),
      require_camera: settings.require_camera,
      require_screen_share: settings.require_screen_share,
      require_fullscreen: settings.require_fullscreen,
      watermark: settings.watermark,
    })
  }, [settings])

  const save = async () => {
    setSaving(true)
    try {
      await saveExamSettings(
        uuid,
        {
          ...form,
          duration_minutes: Number(form.duration_minutes),
          opens_at: form.opens_at ? new Date(form.opens_at).toISOString() : null,
          closes_at: form.closes_at ? new Date(form.closes_at).toISOString() : null,
        },
        token
      )
      toast.success('Exam settings saved')
      qc.invalidateQueries({ queryKey: queryKeys.exams.status(uuid) })
      qc.invalidateQueries({ queryKey: queryKeys.exams.monitor(uuid) })
    } catch (e) {
      toast.error(e instanceof ExamApiError ? e.message : 'Could not save the exam settings')
    } finally {
      setSaving(false)
    }
  }

  const monitorOn = !!settings?.enabled
  const monitor = useQuery({
    queryKey: queryKeys.exams.monitor(uuid),
    queryFn: () => getExamMonitor(uuid, token),
    enabled: !!token && monitorOn,
    refetchInterval: 3000,
  })
  const events = useQuery({
    queryKey: queryKeys.exams.events(uuid, selected?.user_uuid || ''),
    queryFn: () => getExamStudentEvents(uuid, selected!.user_uuid, token),
    enabled: !!token && !!selected && selected.status !== 'not_started',
    refetchInterval: 3000,
  })

  const check = (key: 'require_camera' | 'require_screen_share' | 'require_fullscreen' | 'watermark', label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm text-neutral-800">
      <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="mt-0.5 size-4" />
      <span>
        {label}
        <span className="block text-xs text-neutral-500">{hint}</span>
      </span>
    </label>
  )

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-y-auto p-8">
      <section className="max-w-3xl rounded-xl border border-neutral-200 bg-white p-5">
        <h3 className="text-base font-semibold text-neutral-900">Exam mode</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Turn an assessment into a live, timed, supervised exam (a CAT or a final). Students sit it in a locked exam screen. Take-home
          assignments stay as they are.
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 text-sm font-medium text-neutral-900">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="size-4" />
            This assessment is an exam
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm text-neutral-700">
              Time allowed (minutes)
              <input type="number" min={1} max={600} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} className={`${field} mt-1 w-full`} />
            </label>
            <label className="text-sm text-neutral-700">
              Opens (optional)
              <input type="datetime-local" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} className={`${field} mt-1 w-full`} />
            </label>
            <label className="text-sm text-neutral-700">
              Closes (optional)
              <input type="datetime-local" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} className={`${field} mt-1 w-full`} />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Each student's own clock starts when they press Start. Everyone is finished by the closing time. Time-outs are submitted automatically.
          </p>
          <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
            {check('require_camera', 'Camera must be on', 'Checked only to be running. Nothing is recorded or saved.')}
            {check('require_screen_share', 'Entire screen must be shared', 'Checked only to be running. Nothing is recorded or saved.')}
            {check('require_fullscreen', 'Fullscreen required', 'Leaving fullscreen is flagged and covers the questions until they return.')}
            {check('watermark', "Show the student's name across the exam", 'Makes a photo or screenshot of the questions traceable.')}
          </div>
          <p className="text-xs text-neutral-500">
            The exam screen cannot stop a second device or switch off a browser extension. It records and flags tab switches, copy and paste,
            leaving fullscreen, and the camera or screen share stopping, so you can see what happened.
          </p>
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {saving && <Loader2 className="size-4 animate-spin" />} Save exam settings
          </button>
        </div>
      </section>

      {monitorOn && (
        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-900">Live monitor</h3>
            <span className="text-xs text-neutral-500">Updates every 3 seconds</span>
          </div>
          {monitor.isLoading && <p className="mt-4 text-sm text-neutral-500">Loading...</p>}
          {monitor.isError && <p className="mt-4 text-sm text-rose-600">Could not load the monitor.</p>}
          {monitor.data && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ['Not started', monitor.data.counts.not_started],
                  ['In progress', monitor.data.counts.in_progress],
                  ['Submitted', monitor.data.counts.submitted],
                  ['Disconnected', monitor.data.counts.disconnected],
                  ['Flagged', monitor.data.counts.flagged],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg bg-neutral-50 px-4 py-3">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="text-xl font-semibold text-neutral-900 tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-start text-xs uppercase tracking-wide text-neutral-500">
                        <th className="py-2 pe-3">Student</th>
                        <th className="py-2 pe-3">Status</th>
                        <th className="py-2 pe-3">Time left</th>
                        <th className="py-2 pe-3">Checks</th>
                        <th className="py-2 pe-3 text-end">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitor.data.students.map((s) => (
                        <tr key={s.user_uuid} onClick={() => setSelected(s)} className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 ${selected?.user_uuid === s.user_uuid ? 'bg-neutral-50' : ''}`}>
                          <td className="py-2 pe-3">
                            <p className="font-medium text-neutral-900">{s.name}</p>
                            <p className="text-xs text-neutral-500">@{s.username}</p>
                          </td>
                          <td className="py-2 pe-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                            {s.auto_submitted && <span className="ms-1 text-[11px] text-amber-700">timed out</span>}
                          </td>
                          <td className="py-2 pe-3 tabular-nums">{fmt(s.seconds_left)}</td>
                          <td className="py-2 pe-3">
                            {s.status === 'in_progress' ? (
                              <span className="inline-flex items-center gap-2">
                                {s.connected ? <Wifi className="size-4 text-emerald-600" /> : <WifiOff className="size-4 text-rose-600" />}
                                <Flag on={s.camera_on} icon={<Camera className="size-4" />} label="Camera" />
                                <Flag on={s.screen_shared} icon={<MonitorUp className="size-4" />} label="Screen share" />
                                <Flag on={s.fullscreen} icon={<Maximize className="size-4" />} label="Fullscreen" />
                              </span>
                            ) : (
                              <span className="text-neutral-300">–</span>
                            )}
                          </td>
                          <td className="py-2 pe-3 text-end">
                            {s.violation_count > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"><ShieldAlert className="size-3" />{s.violation_count}</span>
                            ) : (
                              <span className="text-neutral-300">0</span>
                            )}
                            {s.resume_count > 0 && <span className="ms-2 text-[11px] text-neutral-500">{s.resume_count} return(s)</span>}
                          </td>
                        </tr>
                      ))}
                      {monitor.data.students.length === 0 && (
                        <tr><td colSpan={5} className="py-8 text-center text-neutral-500">No students are enrolled in this course yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <aside className="rounded-lg border border-neutral-200 p-3">
                  {!selected ? (
                    <p className="text-sm text-neutral-500">Select a student to see what happened during their exam.</p>
                  ) : selected.status === 'not_started' ? (
                    <p className="text-sm text-neutral-500">{selected.name} has not started.</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-neutral-900">{selected.name}</p>
                      <ul className="mt-2 max-h-[420px] space-y-2 overflow-y-auto">
                        {(events.data ?? []).map((e, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            {e.is_violation ? <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-rose-600" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-neutral-300" />}
                            <span>
                              <span className={e.is_violation ? 'font-medium text-rose-700' : 'text-neutral-700'}>{EVENT_LABEL[e.kind] ?? e.kind}</span>
                              {e.detail && <span className="block text-neutral-400">{e.detail}</span>}
                              <span className="block text-neutral-400">{new Date(e.created_at).toLocaleTimeString()}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </aside>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
