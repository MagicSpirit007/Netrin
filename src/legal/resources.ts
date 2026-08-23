export const legalResources = {
  'zh-CN': {
    title: '服务、隐私与第三方说明',
    subtitle: '当前产品能力与数据边界的静态说明。',
    back: '返回个人页',
    notice: '本页是产品说明，不是社区协议、法律审查结论或用户同意记录。Netrin 当前不提供关注、点赞、收藏、评论、通知和创作者社交主页。',
    sections: {
      service: { title: '服务范围', body: 'Netrin 用于制作、审核、浏览、下载和导览步行、CityWalk 与休闲骑行路线。它不是官方导航、安全保障或紧急救援服务；使用者须自行判断道路、天气、体力与现场风险。' },
      privacy: { title: '本地数据与账号', body: '草稿、下载路线、离线包和偏好优先保存在当前浏览器。游客可浏览、下载和导览；投稿、管理和云端账号能力需要登录。产品不会上传质量遥测。' },
      thirdParty: { title: '第三方服务', body: '在线地图、地点检索与步行规划由高德地图提供；账号、存储和审核数据由自托管 Supabase 提供；AI 路线入口仅按用户主动提交的内容调用所选模型服务。可选道路吸附数据来自 OpenStreetMap。第三方服务可能受其可用性和规则约束。' },
      routeData: { title: '路线与位置数据', body: '业务数据以 WGS-84 GeoJSON 保存，仅在高德地图边界转换坐标。记录与导览需要浏览器位置权限；贴路是可关闭的本地增强，超出路径覆盖时会保留原始定位。道路数据标注为 © OpenStreetMap contributors，并依 ODbL-1.0 单独分发，不受 Netrin 代码许可覆盖。公开投稿在审核通过后可被其他人浏览和下载。' },
      licensing: { title: '软件与数据许可', body: 'Netrin 自有源代码采用 AGPL-3.0-or-later。校园道路数据采用 ODbL-1.0；第三方软件依各自许可分发，详见仓库 THIRD_PARTY_NOTICES.md。' },
      accounts: { title: '公开发布与管理', body: '公共路线分享采用投稿与人工审核模式，不构成社交网络。账号状态、投稿内容和外观包可由管理员按现行产品规则审核或处置；本版本没有社区互动开关和协议同意 RPC。' }
    }
  },
  en: {
    title: 'Service, privacy & third-party notice',
    subtitle: 'A static description of the current product and its data boundaries.',
    back: 'Back to profile',
    notice: 'This page is a product notice, not a community agreement, legal-review conclusion, or consent record. Netrin does not provide follows, likes, bookmarks, comments, notifications, or social creator profiles.',
    sections: {
      service: { title: 'Service scope', body: 'Netrin supports authoring, moderation, browsing, downloading, and guidance for walking, CityWalk, and recreational cycling routes. It is not official navigation, a safety guarantee, or an emergency service. Users remain responsible for road, weather, fitness, and on-site decisions.' },
      privacy: { title: 'Local data and accounts', body: 'Drafts, downloaded routes, offline packages, and preferences are local-first in this browser. Guests can browse, download, and navigate; publishing, administration, and cloud-account features require sign-in. The product does not upload quality telemetry.' },
      thirdParty: { title: 'Third-party services', body: 'AMap supplies online maps, place search, and walking plans. Self-hosted Supabase supplies accounts, storage, and moderation data. The AI route entry calls the user-selected model service only for content the user actively submits. Optional path-snapping data comes from OpenStreetMap. Third-party availability and rules may apply.' },
      routeData: { title: 'Route and location data', body: 'Business data is stored as WGS-84 GeoJSON and coordinates are converted only at the AMap boundary. Recording and guidance require browser location permission. Road snapping is an optional local enhancement and raw positions remain the fallback outside path coverage. Path data is © OpenStreetMap contributors and is distributed separately under ODbL-1.0, not under the Netrin code license. Approved public submissions can be browsed and downloaded by others.' },
      licensing: { title: 'Software and data licenses', body: "Netrin's original source code is licensed under AGPL-3.0-or-later. Campus path data is licensed under ODbL-1.0. Third-party software remains under its own licenses; see THIRD_PARTY_NOTICES.md in the repository." },
      accounts: { title: 'Public publishing and administration', body: 'Public route sharing uses submission and human moderation; it is not a social network. Administrators may review account status, route submissions, and appearance packages under current product rules. This release has no community switch or agreement-consent RPC.' }
    }
  }
} as const
