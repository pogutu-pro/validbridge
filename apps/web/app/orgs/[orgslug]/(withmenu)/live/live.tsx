'use client'

import { Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import MyLiveLessons from '@components/Objects/Live/MyLiveLessons'

export default function LiveLessonsClient({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  return (
    <GeneralWrapperStyled>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-neutral-900">
          <Radio className="size-6 text-primary" aria-hidden /> {t('live.my.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('live.my.subtitle')}</p>
      </div>
      <MyLiveLessons orgslug={orgslug} />
    </GeneralWrapperStyled>
  )
}
