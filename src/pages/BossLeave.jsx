import DashboardShell from '../components/DashboardShell'
import LeaveQueue from '../components/LeaveQueue'

export default function BossLeave() {
  return (
    <DashboardShell title="Leave requests" accent="bg-amber-500">
      <LeaveQueue stage="boss" />
    </DashboardShell>
  )
}
