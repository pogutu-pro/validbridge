'use client'
import { AssignmentWorkspace } from '../../assignments/[assignmentuuid]/_components/AssignmentWorkspace'

// One exam: its questions, settings and live monitor, and results.
export default function ExamPage() {
  return <AssignmentWorkspace variant="exam" />
}
