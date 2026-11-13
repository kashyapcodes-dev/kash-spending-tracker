export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Kash Spending Tracker</h1>
        <p className="text-gray-700 mb-8">
          Track your spending habits and manage your finances.
        </p>
        <nav className="space-y-4">
          <a href="/health" className="block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Health Endpoint
          </a>
          <a href="/transactions" className="block px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
            Transactions
          </a>
          <a href="/budget" className="block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
            Budget
          </a>
        </nav>
      </div>
    </main>
  );
}
