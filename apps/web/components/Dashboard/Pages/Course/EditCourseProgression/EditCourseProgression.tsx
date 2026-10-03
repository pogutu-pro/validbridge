'use client'
import FormLayout from '@components/Objects/StyledElements/Form/Form'
import { useFormik } from 'formik'
import { AlertTriangle, Info, Lock } from 'lucide-react'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCourseFieldSync } from '@components/Contexts/CourseContext'
import { ProgressionPolicy } from '@services/courses/progression'

type EditCourseProgressionProps = {
  orgslug: string
  course_uuid?: string
}

type ProgressionValues = {
  enabled: boolean
  require_pass: boolean
  never_block: boolean
}

const DEFAULT_VALUES: ProgressionValues = {
  enabled: false,
  require_pass: false,
  never_block: false,
}

/**
 * Sequential progression settings.
 *
 * Deliberately opt-in and off by default: an unset course must behave exactly
 * as it did before this feature existed.
 *
 * The copy leads with the failure mode rather than the mechanism, because the
 * thing an author needs to know is that this can stop a learner moving forward,
 * and that leaving a chapter without a placed assessment is what makes that
 * safe. `never_block` is presented as the escape hatch rather than a preference,
 * for the same reason.
 */
export default function EditCourseProgression(_props: EditCourseProgressionProps) {
  const { t } = useTranslation()
  const { syncChanges } = useCourseFieldSync('EditCourseProgression')
  const previousValuesRef = useRef<ProgressionValues>(DEFAULT_VALUES)

  const formik = useFormik({
    initialValues: DEFAULT_VALUES,
    onSubmit: async () => {
      // Saving is handled by the shared SaveState component.
    },
    enableReinitialize: true,
  })

  useEffect(() => {
    const course: any = (formik.values as any).__course
    if (course) {
      const config: ProgressionPolicy = course.progression_config ?? {}
      formik.setValues({
        enabled: Boolean(config.enabled),
        require_pass: Boolean(config.require_pass),
        never_block: Boolean(config.never_block),
      })
    }
  }, [])

  useEffect(() => {
    const values = formik.values
    const previous = previousValuesRef.current
    if (
      values.enabled === previous.enabled &&
      values.require_pass === previous.require_pass &&
      values.never_block === previous.never_block
    ) {
      return
    }

    // Turning the feature off writes null rather than
    // { enabled: false }: the API treats a null policy as "not configured",
    // which keeps the default inert rather than merely disabled.
    const progression_config: ProgressionPolicy | null = values.enabled
      ? {
          enabled: true,
          require_pass: values.require_pass,
          never_block: values.never_block,
        }
      : null

    syncChanges({ progression_config })
    previousValuesRef.current = { ...values }
  }, [formik.values, syncChanges])

  return (
    <FormLayout onSubmit={(e: any) => e.preventDefault()} className='flex flex-col'>
      <div className='space-y-6'>
        <div>
          <h1 className='text-gray-800 text-lg sm:text-xl'>
            {t('dashboard.courses.progression.sections.title')}
          </h1>
          <h2 className='text-gray-500 text-xs sm:text-sm'>
            {t('dashboard.courses.progression.sections.subtitle')}
          </h2>
        </div>

        <div className='rounded-md bg-gray-50 p-4 ring-1 ring-inset ring-gray-200'>
          <div className='flex items-start gap-3'>
            <Info
              className='mt-0.5 h-4 w-4 shrink-0 text-gray-500'
              aria-hidden='true'
            />
            <p className='text-xs text-gray-600'>
              {t('dashboard.courses.progression.sections.explainer')}
            </p>
          </div>
        </div>

        <div className='space-y-4'>
          <div className='flex items-center space-x-3'>
            <input
              type='checkbox'
              id='progression_enabled'
              name='enabled'
              checked={formik.values.enabled}
              onChange={formik.handleChange}
              className='h-4 w-4 rounded border-gray-300 text-black focus:ring-black'
            />
            <label
              htmlFor='progression_enabled'
              className='text-sm font-medium text-gray-700'
            >
              <span className='inline-flex items-center gap-1.5'>
                <Lock className='h-3.5 w-3.5 text-gray-400' aria-hidden='true' />
                {t('dashboard.courses.progression.form.enabled_label')}
              </span>
            </label>
          </div>
          <p className='text-xs text-gray-400 ms-7'>
            {t('dashboard.courses.progression.form.enabled_hint')}
          </p>
        </div>

        {formik.values.enabled && (
          <div className='space-y-5 border-s-2 border-gray-100 ps-4'>
            <div className='space-y-4'>
              <div className='flex items-center space-x-3'>
                <input
                  type='checkbox'
                  id='progression_require_pass'
                  name='require_pass'
                  checked={formik.values.require_pass}
                  onChange={formik.handleChange}
                  className='h-4 w-4 rounded border-gray-300 text-black focus:ring-black'
                />
                <label
                  htmlFor='progression_require_pass'
                  className='text-sm font-medium text-gray-700'
                >
                  {t(
                    'dashboard.courses.progression.form.require_pass_label'
                  )}
                </label>
              </div>
              <p className='text-xs text-gray-400 ms-7'>
                {t('dashboard.courses.progression.form.require_pass_hint')}
              </p>
            </div>

            <div className='space-y-4'>
              <div className='flex items-center space-x-3'>
                <input
                  type='checkbox'
                  id='progression_never_block'
                  name='never_block'
                  checked={formik.values.never_block}
                  onChange={formik.handleChange}
                  className='h-4 w-4 rounded border-gray-300 text-black focus:ring-black'
                />
                <label
                  htmlFor='progression_never_block'
                  className='text-sm font-medium text-gray-700'
                >
                  {t(
                    'dashboard.courses.progression.form.never_block_label'
                  )}
                </label>
              </div>
              <p className='text-xs text-gray-400 ms-7'>
                {t('dashboard.courses.progression.form.never_block_hint')}
              </p>
            </div>

            {!formik.values.never_block && !formik.values.require_pass && (
              <div className='rounded-md bg-amber-50 p-3 ring-1 ring-inset ring-amber-200'>
                <div className='flex items-start gap-2'>
                  <AlertTriangle
                    className='mt-0.5 h-4 w-4 shrink-0 text-amber-600'
                    aria-hidden='true'
                  />
                  <p className='text-xs text-amber-800'>
                    {t('dashboard.courses.progression.form.combination_warning')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </FormLayout>
  )
}
