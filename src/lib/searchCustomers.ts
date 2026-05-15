export function searchCustomers(
  customers: CustomerRow[],
  query: string,
  limit = 20,
): CustomerRow[] {
  if (!query.trim()) return []
  const q = query.toLowerCase().trim()

  type Scored = { customer: CustomerRow; score: number }

  return customers
    .map((c): Scored | null => {
      const name = (c.name ?? '').toLowerCase()
      const code = (c.code ?? '').toLowerCase()
      let score = 0

      if (name === q || code === q) score = 100
      else if (name.startsWith(q)) score = 80
      else if (code.startsWith(q)) score = 70
      else if (name.split(' ').some(w => w.startsWith(q))) score = 60
      else if (name.includes(q)) score = 40
      else if (code.includes(q)) score = 30
      else return null

      return { customer: c, score }
    })
    .filter((x): x is Scored => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.customer)
}
