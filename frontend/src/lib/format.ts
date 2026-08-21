/**
 * Pemformat angka. Dipisahkan dari komponen supaya fast refresh tetap bekerja
 * dan supaya aturan penulisan angka hidup di satu tempat.
 *
 * Rupiah disingkat pada jutaan dan miliaran. "Rp3,5 jt" terbaca sekejap;
 * "Rp3.500.000" menuntut mata menghitung digit, dan di panel yang berganti tiap
 * klik itu melelahkan. Nilai persisnya tetap tersedia lewat tooltip.
 */

export const rupiah = (n: number | null | undefined): string | null =>
  n === null || n === undefined
    ? null
    : n >= 1_000_000_000
      ? `Rp${(n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
      : n >= 1_000_000
        ? `Rp${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
        : `Rp${Math.round(n).toLocaleString('id-ID')}`

export const angka = (n: number | null | undefined, desimal = 0): string | null =>
  n === null || n === undefined
    ? null
    : n.toLocaleString('id-ID', { maximumFractionDigits: desimal })
