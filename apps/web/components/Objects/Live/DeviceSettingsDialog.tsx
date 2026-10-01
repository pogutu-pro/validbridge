'use client'

import { useMediaDeviceSelect } from '@livekit/components-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput'

function DeviceSelect({ kind, labelKey }: { kind: DeviceKind; labelKey: string }) {
  const { t } = useTranslation()
  // requestPermissions=false: never trigger an extra permission prompt just to list devices.
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind, requestPermissions: false })
  const id = `vb-device-${kind}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {t(labelKey)}
      </label>
      <select
        id={id}
        value={activeDeviceId}
        onChange={(e) => void setActiveMediaDevice(e.target.value).catch(() => undefined)}
        disabled={devices.length === 0}
        className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:text-neutral-400"
      >
        {devices.length === 0 && <option value="">{t('live.devices.none_found')}</option>}
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || t('live.devices.unnamed', { n: index + 1 })}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function DeviceSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const canPickSpeaker =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('live.devices.title')}</DialogTitle>
          <DialogDescription>{t('live.devices.description')}</DialogDescription>
        </DialogHeader>
        {open && (
          <div className="space-y-4">
            <DeviceSelect kind="audioinput" labelKey="live.devices.microphone" />
            <DeviceSelect kind="videoinput" labelKey="live.devices.camera" />
            {canPickSpeaker && <DeviceSelect kind="audiooutput" labelKey="live.devices.speaker" />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
