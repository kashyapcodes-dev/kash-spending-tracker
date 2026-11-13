import { createHealthResponse } from '@kash/contract';

export default function HealthPage() {
  const health = createHealthResponse('@kash/app-web');
  
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-4">Health Check</h1>
        <div className="space-y-3 text-sm">
          <p><strong>Service:</strong> {health.service}</p>
          <p><strong>Status:</strong> {health.status}</p>
          <p><strong>Timestamp:</strong> {health.timestamp}</p>
        </div>
      </div>
    </div>
  );
}
