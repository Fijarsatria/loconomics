/**
 * Pemformat angka. Dipisahkan dari komponen supaya fast refresh tetap bekerja
 * dan supaya aturan penulisan angka hidup di satu tempat.
 *
 * Rupiah disingkat pada jutaan dan miliaran. "Rp3,5 jt" terbaca sekejap;
 * "Rp3.500.000" menuntut mata menghitung digit, dan di panel yang berganti tiap
 * klik itu melelahkan. Nilai persisnya tetap tersedia lewat tooltip.
 */

/**
 * Locale angka mengikuti bahasa antarmuka, dan itu bukan kerapian.
 *
 * "Rp1.827" dibaca orang Indonesia sebagai seribu delapan ratus dan orang
 * Inggris sebagai satu koma delapan - selisih seribu kali, pada angka yang
 * dipakai orang menimbang sewa. Titik dan koma bertukar arti di perbatasan
 * bahasa, jadi angkanya harus ikut berpindah bersamanya. Singkatannya juga:
 * "jt" dan "M" tidak berarti apa pun bagi pembaca Inggris.
 *
 * DIBACA DARI `documentElement.lang`, bukan dari konteks React, dan itu
 * disengaja. Berkas ini bukan komponen: ia dipanggil dari dalam larik, dari
 * fungsi bantu, dan dari skrip potret - tempat-tempat yang tidak boleh
 * memanggil kait. `bahasa.tsx` menulis atribut itu setiap kali bahasanya
 * berganti, dan pergantian itu me-render ulang seluruh pohon, jadi pemformat
 * ini selalu dipanggil lagi sesudahnya.
 */
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

/** "1,4 km" atau "820 m" - satuan yang dipakai orang, bukan meter selalu.
 *
 *  Dipindahkan ke sini dari `PetaInteraktif.tsx` 9 Sep 2026, saat panel detail
 *  mulai memakainya juga. Dua salinan adalah dua salinan yang suatu saat
 *  berbeda pembulatannya, dan yang berbeda tidak akan pernah menghasilkan
 *  galat - cuma dua angka yang tidak cocok di dua tempat. */
export function jarakSingkat(m: number): string {
  return m >= 1000
    ? `${(m / 1000).toLocaleString(loc(), { maximumFractionDigits: 1 })} km`
    : `${Math.round(m)} m`
}
