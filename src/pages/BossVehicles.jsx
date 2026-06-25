import { useEffect, useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { fetchVehicles, getExpiryStatus, VEHICLE_DOC_FIELDS } from '../lib/vehicles'

function ExpiryBadge({ date }) {
  if (!date) return <span className="text-xs text-slate-300">—</span>
  const status = getExpiryStatus(date)
  const formatted = new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  return (
    <span
      className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded-full border ${
        status === 'expired'
          ? 'bg-red-50 text-red-700 border-red-200'
          : status === 'expiring'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-green-50 text-green-700 border-green-200'
      }`}
    >
      {formatted}
    </span>
  )
}

export default function BossVehicles() {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    fetchVehicles().then((data) => {
      if (!isMounted) return
      setVehicles(data)
      setLoading(false)
    })
    return () => { isMounted = false }
  }, [])

  // Count expired / expiring documents across all vehicles for the summary.
  const { expiredCount, expiringCount } = useMemo(() => {
    let expired = 0, expiring = 0
    for (const v of vehicles) {
      for (const doc of VEHICLE_DOC_FIELDS) {
        const status = getExpiryStatus(v[doc.key])
        if (status === 'expired') expired++
        else if (status === 'expiring') expiring++
      }
    }
    return { expiredCount: expired, expiringCount: expiring }
  }, [vehicles])

  return (
    <DashboardShell title="Vehicles">
      {/* Summary + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          {!loading && (expiredCount > 0 || expiringCount > 0) ? (
            <>
              {expiredCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  {expiredCount} expired
                </span>
              )}
              {expiringCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  {expiringCount} expiring within 30 days
                </span>
              )}
            </>
          ) : !loading ? (
            <span className="text-sm text-slate-500">All documents valid.</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Expired</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> ≤ 30 days</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Valid</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Fleet documents</h3>
          <span className="text-xs text-slate-400">
            {loading ? '' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : vehicles.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No vehicles found"
            description="Once vehicles are added to the database they'll appear here with document-expiry status."
          />
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)]">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 shadow-sm">
                <tr>
                  <th className="px-4 py-3 bg-slate-50 whitespace-nowrap">Vehicle</th>
                  <th className="px-4 py-3 bg-slate-50 whitespace-nowrap">Driver</th>
                  {VEHICLE_DOC_FIELDS.map((doc) => (
                    <th key={doc.key} className="px-4 py-3 bg-slate-50 whitespace-nowrap">{doc.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 whitespace-nowrap">{v.vehicle_no}</p>
                      <p className="text-xs text-slate-500">{v.vehicle_type}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {v.driver_name || <span className="text-slate-300">—</span>}
                    </td>
                    {VEHICLE_DOC_FIELDS.map((doc) => (
                      <td key={doc.key} className="px-4 py-3">
                        <ExpiryBadge date={v[doc.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
