# AMap Development Knowledge

Generated from `catalog.json`. Reviewed: 2026-07-13.

| Capability | API | Coordinate boundary | Project use | Official source |
| --- | --- | --- | --- | --- |
| User geolocation | `AMap.Geolocation.getCurrentPosition` | GCJ-02 at the provider boundary; convert to WGS-84 immediately | src/lib/amap/geolocation.ts; src/components/domain/AmapNetrinMap.tsx | [AMap JavaScript API (2024-03-25)](https://lbs.amap.com/api/javascript-api-v2/guide/services/geolocation) |
| Map lifecycle, markers and polylines | `AMap.Map, AMap.Marker, AMap.Polyline` | GCJ-02 inside AMap objects only | src/components/domain/AmapNetrinMap.tsx | [AMap JavaScript API](https://lbs.amap.com/api/javascript-api-v2/documentation) |
| Security-key deployment | `window._AMapSecurityConfig.serviceHost` | Not applicable | src/lib/amap/loadAmap.ts; Nginx /_AMapService configuration | [AMap JavaScript API (2025-06-18)](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode) |
| Walking route planning | `AMap.Walking.search` | GCJ-02 input and output; Netrin converts persistent WGS-84 at the adapter boundary | src/lib/amap/routePlanning.ts; src/screens/HomeScreen.tsx | [AMap JavaScript API](https://lbs.amap.com/api/javascript-api-v2/tutorails/car-dir) |
| Open AMap navigation | `https://uri.amap.com/navigation` | Declare the coordinate system required by the URI parameters | Optional future action; not the primary embedded navigation engine | [AMap URI API (2025-02-03)](https://lbs.amap.com/api/uri-api/guide/travel/route) |
| Server-side walking route planning | `GET /v5/direction/walking` | Provider coordinates; use at most six decimal places as documented | Knowledge-only for v1; current runtime uses AMap.Walking | [AMap Web Service (2026-06-17)](https://lbs.amap.com/api/webservice/guide/api/newroute) |

## Operating rules

- Persist only WGS-84 point content; convert at the AMap adapter boundary.
- Treat walking paths, instructions, distance and duration as in-memory provider output.
- Use the production serviceHost proxy and keep security codes outside the frontend repository.
- Pause navigation and offer retry when AMap routing is unavailable; do not present a straight line as navigation.
