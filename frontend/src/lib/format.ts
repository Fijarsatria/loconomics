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

/** "1,4 km" atau "820 m" - satuan yang dipakai orang, bukan meter selalu.
 *
 *  Dipindahkan ke sini dari `PetaInteraktif.tsx` 9 Sep 2026, saat panel detail
 *  mulai memakainya juga. Dua salinan adalah dua salinan yang suatu saat
 *  berbeda pembulatannya, dan yang berbeda tidak akan pernah menghasilkan
 *  galat - cuma dua angka yang tidak cocok di dua tempat. */
export function jarakSingkat(m: number): string {
  return m >= 1000
    ? `${(m / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
    : `${Math.round(m)} m`
}
