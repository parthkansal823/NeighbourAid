import L from 'leaflet'
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

/**
 * Tiny dependency-free heatmap layer. Paints each point as a radial
 * gradient onto a canvas overlay, then blends them. Good enough for a
 * few hundred alerts — avoids bringing in leaflet.heat just for this.
 */
function buildCanvasLayer(points) {
  return L.Layer.extend({
    onAdd(map) {
      this._map = map
      const pane = map.getPane('overlayPane')
      const canvas = L.DomUtil.create('canvas', 'leaflet-heat-canvas')
      canvas.style.pointerEvents = 'none'
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      pane.appendChild(canvas)
      this._canvas = canvas
      map.on('moveend zoomend viewreset resize', this._redraw, this)
      this._redraw()
    },
    onRemove(map) {
      map.off('moveend zoomend viewreset resize', this._redraw, this)
      if (this._canvas?.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas)
      }
      this._canvas = null
    },
    setPoints(next) {
      this._points = next
      this._redraw()
    },
    _redraw() {
      if (!this._canvas || !this._map) return
      const map = this._map
      const size = map.getSize()
      const topLeft = map.containerPointToLayerPoint([0, 0])
      L.DomUtil.setPosition(this._canvas, topLeft)
      this._canvas.width = size.x
      this._canvas.height = size.y
      const ctx = this._canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, size.x, size.y)
      const radius = Math.max(18, Math.min(60, map.getZoom() * 4))
      const pts = this._points || points
      for (const [lat, lng, weight] of pts) {
        const p = map.latLngToContainerPoint([lat, lng])
        const w = Math.max(0.1, Math.min(1, weight ?? 0.5))
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        grad.addColorStop(0, `rgba(239, 68, 68, ${0.55 * w})`) // red core
        grad.addColorStop(0.4, `rgba(249, 115, 22, ${0.4 * w})`)
        grad.addColorStop(1, 'rgba(249, 115, 22, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    },
  })
}

export default function HeatLayer({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!map) return undefined
    const Layer = buildCanvasLayer(points)
    const layer = new Layer()
    layer.addTo(map)
    layer.setPoints(points)
    return () => {
      layer.remove()
    }
  }, [map, points])

  return null
}
