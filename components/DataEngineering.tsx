import React, { useEffect, useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, Copy, RefreshCw } from 'lucide-react';

type PipelineMetrics = {
  recordsReceived: number;
  validRecords: number;
  rejectedRecords: number;
  duplicateRecords: number;
};

type DataEngineeringProps = {
  uid: string;
};

const DataEngineering: React.FC<DataEngineeringProps> = ({ uid }) => {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMetrics = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
  `/api/data-quality?uid=${encodeURIComponent(uid)}`
);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load the pipeline report.');
      setMetrics(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the pipeline report.');
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
  void loadMetrics();
}, [uid]);

  const passedPercent = metrics && metrics.recordsReceived > 0
    ? (metrics.validRecords / metrics.recordsReceived) * 100 : 0;

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold text-neutral">Data Engineering</h2>
        <p className="text-sm text-slate-500 mt-1">A summary of records processed by the TripSync Python ETL pipeline.</p>
      </div>
      <button onClick={() => void loadMetrics()} disabled={loading} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-60">
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Refresh report
      </button>
    </div>

    {loading && <p className="text-sm text-slate-500">Loading data quality report…</p>}
    {!loading && error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex items-center gap-2 font-semibold"><AlertTriangle size={18}/> Report not available</div><p className="mt-1">{error}</p><p className="mt-2">Run the Python ETL command from the <code>data_pipeline</code> folder, then refresh this page.</p></div>}

    {metrics && <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard title="Total records processed" value={metrics.recordsReceived} icon={<Database size={20}/>} detail="Transactions extracted directly from MySQL database"/>
        <MetricCard title="Valid vs. rejected" value={`${metrics.validRecords} / ${metrics.rejectedRecords}`} icon={<CheckCircle2 size={20}/>} detail="Valid records / rejected records"/>
        <MetricCard title="Duplicate transactions" value={metrics.duplicateRecords} icon={<Copy size={20}/>} detail="Repeated transactions excluded from clean output"/>
      </div>
      <section className="bg-white rounded-2xl shadow-md p-5 sm:p-6">
        <h3 className="text-lg font-bold text-neutral">Record validation</h3>
        <div className="flex justify-between text-sm text-slate-600 mt-4 mb-2"><span>Valid records</span><span>{metrics.validRecords} of {metrics.recordsReceived}</span></div>
        <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${passedPercent}%` }}/></div>
        <div className="flex flex-wrap gap-4 mt-4 text-sm"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-primary"/> Valid: {metrics.validRecords}</span><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-rose-400"/> Rejected: {metrics.rejectedRecords}</span></div>
      </section>
    </>}
  </div>;
};

const MetricCard: React.FC<{ title: string; value: number | string; icon: React.ReactNode; detail: string }> = ({ title, value, icon, detail }) => (
  <section className="bg-white rounded-2xl shadow-md p-5">
    <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-500">{title}</span><span className="text-primary bg-sky-50 rounded-lg p-2">{icon}</span></div>
    <p className="text-3xl font-bold text-neutral mt-4">{value}</p>
    <p className="text-xs text-slate-400 mt-2">{detail}</p>
  </section>
);

export default DataEngineering;
