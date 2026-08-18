const GATES = [
  { feature: 'community', match: path => path.startsWith('/api/articles') || path.startsWith('/api/feed') },
  {
    feature: 'community',
    match: path => /^\/api\/users\/[^/]+\/(articles|follow|follow-status)(\/|$)/.test(path)
  },
  {
    feature: 'community',
    match: path => /^\/api\/collab\/works\/[^/]+\/like(\/|$)/.test(path)
  },
  {
    feature: 'creatorFinance',
    match: path => path.startsWith('/api/earnings') ||
      path.startsWith('/api/creator/settlement') ||
      path.startsWith('/api/admin/settlement') ||
      path.startsWith('/api/admin/revenue')
  },
  {
    feature: 'bullSystem',
    match: path => path.startsWith('/api/creator/bull') ||
      path.startsWith('/api/admin/bull') ||
      path.startsWith('/api/creator/links') ||
      path.startsWith('/api/admin/links')
  },
  { feature: 'mockCertification', match: path => path.startsWith('/api/certify') },
  {
    feature: 'creatorCollabSelfService',
    match: path => path.startsWith('/api/collab/my-works') ||
      path.startsWith('/api/collab/apply') ||
      path.startsWith('/api/creator/collab')
  }
]

export function requiredFeatureForRequest(url) {
  const path = String(url || '').split('?')[0]
  return GATES.find(gate => gate.match(path))?.feature || null
}

export function publicFeatureFlags(config) {
  return {
    community: config.features.community,
    creatorFinance: config.features.creatorFinance,
    bullSystem: config.features.bullSystem,
    mockCertification: config.features.mockCertification,
    creatorCollabSelfService: config.features.creatorCollabSelfService,
    passwordLogin: config.features.passwordLogin
  }
}
