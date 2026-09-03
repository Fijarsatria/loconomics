/**
 * DIBUAT OTOMATIS oleh `scripts/potret-kartu.mjs`. Jangan disunting tangan.
 *
 * Angkanya dihitung dari data yang sama yang dipakai menggambar berkas WebP
 * di `public/kartu/`, pada detik yang sama. Untuk menyegarkannya:
 *
 *   cd frontend && node scripts/potret-kartu.mjs
 */

import type { NamaLayer } from '../config'

export interface KartuGerbang {
  berkas: string
  kawasan: string
  layer: NamaLayer
  gelap: boolean
  condong: number
  utama: boolean
  lebar: number
  tinggi: number
  /** Jumlah heksagon kawasan ini pada saat dipotret. */
  n: number
  kuadran: Record<string, number>
  sorotan: { nilai: string; label: string }
}

/** Tanggal potret terakhir, dinyatakan apa adanya di halamannya. */
export const DIPOTRET = '2026-09-03'

export const KARTU_GERBANG: KartuGerbang[] = [
  {
    "berkas": "tanah-abang",
    "kawasan": "Tanah Abang",
    "layer": "opportunity",
    "gelap": false,
    "condong": -0.7,
    "utama": true,
    "lebar": 1120,
    "tinggi": 720,
    "n": 108,
    "kuadran": {
      "HIDDEN_GEM": 18,
      "PEMENANG_JELAS": 73,
      "JEBAKAN_GENGSI": 14,
      "HINDARI": 3
    },
    "sorotan": {
      "nilai": "55",
      "label": "opportunity score median"
    }
  },
  {
    "berkas": "manggarai",
    "kawasan": "Manggarai",
    "layer": "pricelens",
    "gelap": false,
    "condong": 1.2,
    "utama": false,
    "lebar": 620,
    "tinggi": 380,
    "n": 122,
    "kuadran": {
      "PEMENANG_JELAS": 52,
      "HIDDEN_GEM": 38,
      "JEBAKAN_GENGSI": 28,
      "HINDARI": 4
    },
    "sorotan": {
      "nilai": "—",
      "label": "data sewa belum ada"
    }
  },
  {
    "berkas": "dukuh-atas",
    "kawasan": "Dukuh Atas BNI",
    "layer": "hidden_gem",
    "gelap": true,
    "condong": -1.3,
    "utama": false,
    "lebar": 620,
    "tinggi": 380,
    "n": 97,
    "kuadran": {
      "JEBAKAN_GENGSI": 9,
      "HIDDEN_GEM": 23,
      "PEMENANG_JELAS": 65
    },
    "sorotan": {
      "nilai": "11",
      "label": "kandidat Hidden Gem"
    }
  },
  {
    "berkas": "depok-baru",
    "kawasan": "Depok Baru",
    "layer": "zoneguard",
    "gelap": false,
    "condong": 1.5,
    "utama": false,
    "lebar": 620,
    "tinggi": 380,
    "n": 127,
    "kuadran": {
      "HINDARI": 42,
      "JEBAKAN_GENGSI": 46,
      "HIDDEN_GEM": 29,
      "PEMENANG_JELAS": 10
    },
    "sorotan": {
      "nilai": "0",
      "label": "heksagon boleh usaha"
    }
  },
  {
    "berkas": "bekasi",
    "kawasan": "Bekasi",
    "layer": "risk_radar",
    "gelap": false,
    "condong": -1,
    "utama": false,
    "lebar": 620,
    "tinggi": 380,
    "n": 127,
    "kuadran": {
      "JEBAKAN_GENGSI": 24,
      "HINDARI": 75,
      "HIDDEN_GEM": 23,
      "PEMENANG_JELAS": 5
    },
    "sorotan": {
      "nilai": "—",
      "label": "indeks pergantian belum ada"
    }
  },
  {
    "berkas": "harjamukti",
    "kawasan": "Harjamukti",
    "layer": "opportunity",
    "gelap": false,
    "condong": 0.9,
    "utama": false,
    "lebar": 620,
    "tinggi": 380,
    "n": 127,
    "kuadran": {
      "HINDARI": 84,
      "JEBAKAN_GENGSI": 23,
      "HIDDEN_GEM": 15,
      "PEMENANG_JELAS": 5
    },
    "sorotan": {
      "nilai": "37",
      "label": "opportunity score median"
    }
  }
]
