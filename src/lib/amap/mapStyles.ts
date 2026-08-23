import type { MapStyleId } from '../../data/types'

export function getAmapStyleUrl(styleId: MapStyleId) {
  return `amap://styles/${styleId}`
}
