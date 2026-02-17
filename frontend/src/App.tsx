function App() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">MSEDB</h1>
        <p className="text-lg text-gray-400">Microsoft Email Dashboard</p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-green-900/30 px-4 py-2 text-sm text-green-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
          </span>
          Infrastructure running
        </div>
      </div>
    </div>
  )
}

export default App
