import { requestUrl } from 'obsidian'

/** A cover to choose from in the approval pop-up. */
export interface CoverChoice {
  url: string
  thumb: string
  /** Where it's from, shown under the thumbnail. */
  label: string
}

/** Portrait (600×900) covers for a Steam game from SteamGridDB, which needs a (free) API key. */
export async function steamGridCovers(apiKey: string, appId: number, limit = 8): Promise<CoverChoice[]> {
  const res = await requestUrl({
    url: `https://www.steamgriddb.com/api/v2/grids/steam/${appId}?dimensions=600x900&types=static`,
    headers: { Authorization: `Bearer ${apiKey}` },
    throw: false,
  })
  if (res.status === 401 || res.status === 403) throw new Error('SteamGridDB refused the API key')
  if (res.status >= 400) return []
  const body = res.json as { success?: boolean, data?: { url?: string, thumb?: string }[] } | null
  return (body?.data ?? [])
    .filter((g): g is { url: string, thumb?: string } => Boolean(g.url))
    .slice(0, limit)
    .map((g, i) => ({ url: g.url, thumb: g.thumb ?? g.url, label: `SteamGridDB ${i + 1}` }))
}
