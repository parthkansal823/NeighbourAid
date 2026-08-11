import { Component } from 'react'
import { TriangleAlert } from './icons'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  reset = () => {
    this.setState({ error: null })
    // Full reload is the safest recovery — UI state is probably corrupted
    window.location.href = '/'
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-950">
        <div className="max-w-md w-full bg-gray-900 border border-red-800 rounded-2xl p-8 text-center">
          <TriangleAlert className="h-12 w-12 mx-auto mb-4 text-red-400" aria-hidden />
          <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-gray-400 text-sm mb-4">
            NeighbourAid hit an unexpected error. You can go back to the home screen and try again.
          </p>
          {this.state.error?.message && (
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-red-300 text-left overflow-auto max-h-40 mb-4">
              {String(this.state.error.message)}
            </pre>
          )}
          <button
            onClick={this.reset}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl"
          >
            Back to safety
          </button>
        </div>
      </div>
    )
  }
}
