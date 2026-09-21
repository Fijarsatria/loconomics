
const ing = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en'

const loc = (): string => (ing() ? 'en-GB' : 'id-ID')

export const rupiah = (n: number | null | undefined): string | null =>
  n === null || n === undefined
    ? null
    : n >= 1_000_000_000
      ? `Rp${(n / 1_000_000_000).toLocaleString(loc(), { maximumFractionDigits: 1 })}${
          ing() ? 'B' : ' M'
        }`
      : n >= 1_000_000
        ? `Rp${(n / 1_000_000).toLocaleString(loc(), { maximumFractionDigits: 1 })}${
            ing() ? 'M' : ' jt'
          }`
        : `Rp${Math.round(n).toLocaleString(loc())}`

export const angka = (n: number | null | undefined, desimal = 0): string | null =>
  n === null || n === undefined
    ? null
    : n.toLocaleString(loc(), { maximumFractionDigits: desimal })

export function jarakSingkat(m: number): string {
  return m >= 1000
    ? `${(m / 1000).toLocaleString(loc(), { maximumFractionDigits: 1 })} km`
    : `${Math.round(m)} m`
}
