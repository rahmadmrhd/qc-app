#!/usr/bin/env bash
# Skrip deploy qc-app di server. Dipasang di <INSTALL_DIR>/deploy.sh (VPS pribadi: /root/apps/qc-app/deploy.sh) dan dipanggil lewat kunci SSH khusus:
#   restrict,command="<INSTALL_DIR>/deploy.sh [--only staging|production]" ssh-ed25519 AAAA...
# (jalur di `command=` = lokasi mutlak skrip ini yang sebenarnya, di `authorized_keys` milik pengguna deploy; `restrict` sudah
# mencakup no-pty/no-port-forwarding/no-agent-forwarding/no-X11-forwarding/no-user-rc dan menutup fitur baru OpenSSH yang
# kelak aktif bawaan. Bila pengguna deploy = root, periksa juga `PermitRootLogin prohibit-password` atau `forced-commands-only`.)
# Klien (GitHub Actions) menjalankan `ssh ... "deploy <staging|production> <sha-40-heksa>"`; sshd mengisi SSH_ORIGINAL_COMMAND
# dengan teks itu dan HANYA skrip ini yang berjalan. Input itu tak tepercaya: divalidasi ketat (regex), tidak pernah
# di-eval, tidak diekspansi shell, dan tidak pernah dicetak balik. Argumen baris perintah hanya datang dari pemanggil
# lokal/authorized_keys (klien jarak jauh tak bisa menambahkannya).
#
# Alur: validasi -> kunci -> `compose config` (.env/compose.yml valid; bila rusak berhenti tanpa mengubah apa pun) ->
# ganti QC_IMAGE_TAG di .env -> pull -> up -d -> tunggu sehat (dan memakai tag baru) -> uji /api/ping -> bila gagal di
# langkah mana pun sesudah tag diganti, kembali ke tag sebelumnya; bila sukses penuh, image lama dibersihkan
# (`cleanup_images`: simpan QC_KEEP_IMAGES tag terbaru, bawaan 3; kegagalannya tak mengubah kode keluar). Keluaran docker compose TIDAK diteruskan ke
# pemanggil (galat urai compose dapat memuat potongan nilai rahasia dari .env): ditulis ke $DIR/.deploy.log (izin 600,
# ditimpa tiap deploy) dan yang dicetak hanya baris `[deploy] ...`.
#
# Kode keluar: 0 sukses; 1 gagal dan sudah dikembalikan ke tag sebelumnya; 2 input/konfigurasi tidak valid
# (tidak ada yang diubah; termasuk kredensial DB di .env yang tidak cocok dengan database yang berjalan, preflight);
# 3 deploy lain sedang berjalan; 4 gagal dan pengembalian juga gagal/tidak mungkin; 5 versi baru
# sehat dan aktif tetapi nginx host TIDAK TERJANGKAU (masalah infrastruktur, bukan versi: tidak dikembalikan dan image
# lama tidak dibersihkan; periksa nginx). Bila nginx menjawab tetapi bukan 2xx, itu dianggap masalah versi: rollback.
#
# Argumen (hanya pemanggil lokal): --only staging|production (batasi lingkungan yang boleh diminta kunci ini), --dry-run
# (validasi lalu cetak rencana; tidak menyentuh docker/berkas), --root DIR (bawaan: folder skrip ini),
# --wait-seconds N, --poll-seconds N.
set -euo pipefail
umask 077

# Folder instalasi = folder tempat skrip ini berada (jalurnya sudah tertulis mutlak di `command=` authorized_keys), bukan $HOME
# atau nilai lingkungan: tak bergantung pada pengguna dan bisa dipindah. `--root` hanya untuk tes.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
ONLY=''
DRY_RUN=0
WAIT_SECONDS=150
POLL_SECONDS=3

log() { printf '[deploy] %s\n' "$*"; }
die() { # die KODE PESAN
  local code=$1
  shift
  printf '[deploy] GAGAL: %s\n' "$*" >&2
  exit "$code"
}

is_uint() { [[ $1 =~ ^[0-9]{1,4}$ ]]; }

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --only)
      [ $# -ge 2 ] || die 2 'argumen --only butuh nilai'
      [[ $2 =~ ^(staging|production)$ ]] || die 2 'nilai --only harus staging atau production'
      ONLY=$2
      shift 2
      ;;
    --root)
      [ $# -ge 2 ] || die 2 'argumen --root butuh nilai'
      ROOT=$2
      shift 2
      ;;
    --wait-seconds)
      [ $# -ge 2 ] && is_uint "$2" || die 2 'argumen --wait-seconds harus bilangan bulat'
      WAIT_SECONDS=$2
      shift 2
      ;;
    --poll-seconds)
      [ $# -ge 2 ] && is_uint "$2" || die 2 'argumen --poll-seconds harus bilangan bulat'
      POLL_SECONDS=$2
      shift 2
      ;;
    *)
      die 2 'argumen tidak dikenal'
      ;;
  esac
done

# ---- 1. Validasi input (satu-satunya tempat input klien dibaca) ----
REQUEST=${SSH_ORIGINAL_COMMAND-}
[ -n "$REQUEST" ] || die 2 'perintah kosong (format: deploy <staging|production> <tag>)'
[ "${#REQUEST}" -le 80 ] || die 2 'perintah terlalu panjang'
# Persis: "deploy", satu spasi, nama lingkungan, satu spasi, tag. Tag permintaan = SHA commit penuh (40 heksa huruf
# kecil, kontrak CI: satu tag per commit); tag yang dapat berubah seperti `latest` ditolak. (Tag SEBELUMNYA di .env,
# PREV_TAG, sengaja lebih longgar agar `local-<sha>` lama masih dapat dikembalikan.)
REQUEST_PATTERN='^deploy (staging|production) ([0-9a-f]{40})$'
if [[ ! $REQUEST =~ $REQUEST_PATTERN ]]; then
  die 2 'perintah ditolak (format: deploy <staging|production> <sha commit 40 heksa huruf kecil>)'
fi
ENV_NAME=${BASH_REMATCH[1]}
TAG=${BASH_REMATCH[2]}
if [ -n "$ONLY" ] && [ "$ONLY" != "$ENV_NAME" ]; then
  die 2 'kunci ini tidak diizinkan untuk lingkungan itu'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry-run: lingkungan=$ENV_NAME tag=$TAG root=$ROOT"
  log "rencana: set QC_IMAGE_TAG=$TAG di $ROOT/$ENV_NAME/.env; preflight kredensial DB (hanya bila kontainer DB berjalan: docker exec mariadb SELECT 1 dengan kata sandi lewat env MYSQL_PWD; gagal = kode 2 tanpa mengubah apa pun); docker compose pull qc-app; docker compose up -d; tunggu sehat; curl /api/ping lokal; uji /api/ping lewat nginx dari dalam VPS (https://<host APP_ORIGIN>, --resolve ke 127.0.0.1, -k; dilewati bila APP_ORIGIN bukan https); kembali ke tag sebelumnya bila gagal"
  log "rencana pembersihan (hanya setelah sukses penuh; gagal tak mengubah kode keluar): hapus image repositori QC_IMAGE (bawaan GHCR) bertag SHA/local-<sha> satu per satu dengan docker image rm, kecuali tag terpakai kontainer, tag baru, tag sebelumnya, tag di .env lingkungan lain, dan QC_KEEP_IMAGES (bawaan 3) tag terbaru; tanpa prune"
  exit 0
fi

# ---- 2. Konfigurasi lingkungan (dibaca dari .env TANPA source/eval; hanya nilai yang divalidasi) ----
DIR=$ROOT/$ENV_NAME
[ -d "$DIR" ] || die 2 "folder lingkungan tidak ada: $DIR"
[ -f "$DIR/compose.yml" ] || die 2 'compose.yml tidak ada di folder lingkungan'
[ -f "$DIR/.env" ] || die 2 '.env tidak ada di folder lingkungan'

env_value() { # env_value NAMA [BERKAS] -> nilai terakhir NAMA= di .env (tanpa CR; satu pasang kutip yang cocok dibuang, seperti compose)
  local line dq='"' sq="'"
  line=$(grep -E "^$1=" "${2:-$DIR/.env}" 2>/dev/null | tail -n1 || true)
  line=${line#*=}
  line=${line%$'\r'}
  if [[ $line =~ ^${dq}(.*)${dq}$ ]] || [[ $line =~ ^${sq}(.*)${sq}$ ]]; then
    line=${BASH_REMATCH[1]}
  fi
  printf '%s' "$line"
}

QC_ENV_VALUE=$(env_value QC_ENV)
[ "$QC_ENV_VALUE" = "$ENV_NAME" ] || die 2 'QC_ENV di .env tidak sama dengan nama folder lingkungan'
APP_PORT=$(env_value APP_PORT)
[[ $APP_PORT =~ ^[0-9]{2,5}$ ]] || die 2 'APP_PORT di .env tidak valid'
NAME=$(env_value QC_NAME)
[ -n "$NAME" ] || NAME="qc-$ENV_NAME"
[[ $NAME =~ ^[a-z0-9][a-z0-9_-]{1,40}$ ]] || die 2 'QC_NAME di .env tidak valid'
PREV_TAG=$(env_value QC_IMAGE_TAG)
if [ -n "$PREV_TAG" ] && [[ ! $PREV_TAG =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$ ]]; then
  PREV_TAG=''
fi
CONTAINER="$NAME-app"
# Skrip ini hanya dapat men-deploy image dari GHCR (`compose pull`): image lokal (QC_IMAGE=qc-app) tak pernah dapat
# ditarik. Tolak lebih awal dengan pesan jelas, sebelum apa pun diubah. QC_IMAGE kosong/tidak ada = bawaan compose (GHCR).
IMAGE_NAME=$(env_value QC_IMAGE)
if [ -n "$IMAGE_NAME" ] && [[ ! $IMAGE_NAME =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*$ ]]; then
  die 2 'QC_IMAGE di .env bukan ghcr.io/...: hapus/komentari QC_IMAGE (bawaan compose = GHCR); image lokal tidak dapat di-deploy lewat skrip ini (docs/ci-cd.md)'
fi

# ---- 3. Kunci: satu deploy per lingkungan (mkdir atomik; hapus manual bila proses mati mendadak) ----
LOCK=$DIR/.deploy.lock
mkdir "$LOCK" 2>/dev/null || die 3 "deploy lain sedang berjalan (atau kunci basi: rmdir $LOCK)"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# Log keluaran docker compose: hanya dapat dibaca pengguna deploy (umask 077), ditimpa tiap deploy. Tidak pernah diteruskan ke pemanggil.
DEPLOY_LOG=$DIR/.deploy.log
: >"$DEPLOY_LOG"
chmod 600 "$DEPLOY_LOG" 2>/dev/null || true
LOG_HINT="detail di VPS: $DEPLOY_LOG"

# stdout/stderr compose ke log, bukan ke pemanggil (galat urai .env dapat memuat potongan nilai rahasia).
compose() { docker compose --project-directory "$DIR" -f "$DIR/compose.yml" "$@" >>"$DEPLOY_LOG" 2>&1; }

set_tag() { # set_tag TAG: tulis ulang .env secara atomik (izin 600), mengganti/menambah QC_IMAGE_TAG
  local tmp
  tmp=$(mktemp "$DIR/.env.XXXXXX")
  if grep -q '^QC_IMAGE_TAG=' "$DIR/.env"; then
    sed "s/^QC_IMAGE_TAG=.*/QC_IMAGE_TAG=$1/" "$DIR/.env" >"$tmp"
  else
    { cat "$DIR/.env"; printf '\nQC_IMAGE_TAG=%s\n' "$1"; } >"$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$DIR/.env"
  [ "$(env_value QC_IMAGE_TAG)" = "$1" ] || return 1
}

wait_healthy() { # wait_healthy TAG: kontainer memakai tag itu DAN healthcheck sehat sebelum batas waktu
  local waited=0 status image
  while [ "$waited" -le "$WAIT_SECONDS" ]; do
    image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || true)
    if [ "${image##*:}" = "$1" ]; then
      case $status in
        healthy) return 0 ;;
        unhealthy) return 1 ;;
      esac
    fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS + 1))
  done
  return 1
}

smoke_test() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$APP_PORT/api/ping"; then return 0; fi
    sleep "$POLL_SECONDS"
  done
  return 1
}

nginx_smoke_test() { # nginx_smoke_test: uji /api/ping lewat nginx host, dari DALAM VPS (keputusan pemilik 2026-11-07)
  # Runner GitHub tak dapat menguji URL publik (Cloudflare memblokir IP datacenter dan origin hanya menerima IP Cloudflare),
  # jadi nginx diuji di sini: host dari APP_ORIGIN diarahkan ke 127.0.0.1:443. Origin bukan https://<host> polos
  # (mis. dev lokal) = tak ada nginx TLS yang diuji: dilewati dan dianggap lulus. Keluaran curl ke log, bukan ke pemanggil.
  local origin host attempt
  origin=$(env_value APP_ORIGIN)
  if [[ ! $origin =~ ^https://([A-Za-z0-9.-]+)$ ]]; then
    log 'uji lewat nginx dilewati: APP_ORIGIN bukan https://<host> (tanpa jalur/port)'
    return 0
  fi
  host=${BASH_REMATCH[1]}
  local rc=1
  for attempt in 1 2 3 4 5; do
    # -k hanya untuk uji ini: sertifikat origin Cloudflare bukan CA publik. Yang diuji adalah "nginx menjawab";
    # verifikasi sertifikat dilakukan Cloudflare (mode SSL Full strict).
    rc=0
    curl -fsS -k --max-time 5 --resolve "$host:443:127.0.0.1" -o /dev/null "https://$host/api/ping" >>"$DEPLOY_LOG" 2>&1 || rc=$?
    [ "$rc" -eq 0 ] && return 0
    sleep "$POLL_SECONDS"
  done
  # Kode curl 22 = nginx MENJAWAB tetapi bukan 2xx (mis. 502/503/404: dapat terkait versi) -> 1 (rollback).
  # Selain itu (7 ditolak, 28 timeout, 35/52/56 putus sebelum respons HTTP, dst.) = nginx tak terjangkau -> 2.
  if [ "$rc" -eq 22 ]; then return 1; fi
  return 2
}

rollback() { # rollback: kembali ke PREV_TAG dan pastikan sehat; kode keluar 1 (berhasil) atau 4
  if [ -z "$PREV_TAG" ] || [ "$PREV_TAG" = "$TAG" ]; then
    die 4 'tidak ada tag sebelumnya yang berbeda untuk dikembalikan; periksa kontainer secara manual'
  fi
  log "mengembalikan ke tag sebelumnya: $PREV_TAG"
  if set_tag "$PREV_TAG" && compose up -d && wait_healthy "$PREV_TAG" && smoke_test; then
    die 1 "deploy $TAG gagal; dikembalikan ke $PREV_TAG ($LOG_HINT)"
  fi
  die 4 "deploy $TAG gagal DAN pengembalian ke $PREV_TAG gagal; periksa kontainer secara manual ($LOG_HINT)"
}

cleanup_images() { # Pembersihan image lama; dipanggil HANYA setelah deploy sukses penuh. Tidak pernah gagal keras.
  # Hanya repositori image stack ini (dari QC_IMAGE, atau bawaan yang tertulis di compose.yml) dan hanya tag SHA/local-<sha>.
  # Dipertahankan: tag yang dipakai kontainer ini, tag baru, PREV_TAG, tag di .env lingkungan LAIN (satu repositori dipakai
  # bersama), dan KEEP tag terbaru. Tanpa -f: image yang masih dipakai gagal dihapus dengan aman. Tidak pernah prune.
  local repo keep keep_n=3 override tags tag f other rank=0 removed=0 failed=0 current
  override=$(env_value QC_KEEP_IMAGES)
  if [[ $override =~ ^[1-9][0-9]?$ ]]; then keep_n=$override; fi
  repo=$IMAGE_NAME
  if [ -z "$repo" ]; then
    repo=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\${QC_IMAGE:-\([^}]*\)}:.*/\1/p' "$DIR/compose.yml" | head -n1)
    [ -n "$repo" ] || repo=ghcr.io/rahmadmrhd/qc-app
  fi
  if [[ ! $repo =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*$ ]]; then
    log 'pembersihan image dilewati: repositori image tidak valid'
    return 0
  fi
  keep=$'\n'"$TAG"$'\n'
  [ -z "$PREV_TAG" ] || keep+="$PREV_TAG"$'\n'
  current=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)
  [ -z "$current" ] || keep+="${current##*:}"$'\n'
  for f in "$ROOT"/*/.env; do
    [ -f "$f" ] || continue
    other=$(env_value QC_IMAGE_TAG "$f")
    [ -z "$other" ] || keep+="$other"$'\n'
  done
  if ! tags=$(docker image ls "$repo" --format '{{.Tag}}' 2>>"$DEPLOY_LOG"); then
    log 'pembersihan image dilewati: daftar image gagal dibaca'
    return 0
  fi
  while IFS= read -r tag; do
    tag=${tag%$'\r'}
    if [[ ! $tag =~ ^([0-9a-f]{40}|local-[0-9a-f]{7,40})$ ]]; then continue; fi
    rank=$((rank + 1)) # daftar docker terurut dari yang terbaru dibuat
    if [ "$rank" -le "$keep_n" ]; then continue; fi
    case $keep in *$'\n'"$tag"$'\n'*) continue ;; esac
    if docker image rm "$repo:$tag" >>"$DEPLOY_LOG" 2>&1; then
      removed=$((removed + 1))
    else
      failed=$((failed + 1))
    fi
  done <<<"$tags"
  log "pembersihan image: dihapus=$removed gagal/dilewati=$failed (simpan terbaru=$keep_n)"
  return 0
}

db_preflight() { # Preflight kredensial DB (keputusan pemilik 2026-11-07): sebelum apa pun diubah.
  # Kata sandi DB di .env hanya dipakai MariaDB saat inisialisasi volume; .env yang berubah (tak sengaja, atau rotasi dengan
  # urutan terbalik) membuat aplikasi baru gagal login dan rollback (hanya mengganti tag) tak menolong. Uji hanya bila
  # kontainer DB SEDANG berjalan (deploy pertama: dilewati). Kata sandi hanya lewat lingkungan (MYSQL_PWD), tak pernah argv/log.
  local db_container=$NAME-db user db password running
  running=$(docker inspect --format '{{.State.Running}}' "$db_container" 2>/dev/null || true)
  if [ "$running" != true ]; then
    log "preflight kredensial DB dilewati: kontainer $db_container tidak berjalan (deploy pertama?)"
    return 0
  fi
  user=$(env_value QC_DB_USER)
  [ -n "$user" ] || user=qc_$ENV_NAME
  db=$(env_value QC_DB_NAME)
  [ -n "$db" ] || db=qc_$ENV_NAME
  password=$(env_value QC_DB_PASSWORD)
  [[ $user =~ ^[A-Za-z0-9_]{1,64}$ ]] || die 2 'QC_DB_USER di .env tidak valid'
  [[ $db =~ ^[A-Za-z0-9_]{1,64}$ ]] || die 2 'QC_DB_NAME di .env tidak valid'
  if ! MYSQL_PWD=$password docker exec -e MYSQL_PWD "$db_container" mariadb -h 127.0.0.1 "-u$user" "$db" -e 'SELECT 1' >>"$DEPLOY_LOG" 2>&1; then
    die 2 "kredensial DB di .env tidak cocok dengan database yang berjalan; tidak ada yang diubah (rotasi: ubah di database dulu, baru .env; lihat docs/deploy-vps.md; $LOG_HINT)"
  fi
  log 'preflight kredensial DB lulus'
}

# ---- 4. Deploy ----
log "lingkungan=$ENV_NAME tag=$TAG (sebelumnya: ${PREV_TAG:-tidak ada})"
# .env/compose.yml yang rusak (kutip tak tertutup, variabel wajib kosong) berhenti DI SINI tanpa mengubah apa pun dan
# tanpa mencetak pesan docker (dapat memuat potongan rahasia). QC_IMAGE_TAG diberikan lewat lingkungan proses (yang
# didahulukan compose atas .env) agar deploy pertama tanpa tag di .env tidak ditolak oleh `${QC_IMAGE_TAG:?}`.
if ! QC_IMAGE_TAG="$TAG" docker compose --project-directory "$DIR" -f "$DIR/compose.yml" config --quiet >/dev/null 2>&1; then
  die 2 ".env/compose.yml tidak valid; periksa di VPS: cd $DIR && docker compose config --quiet"
fi
db_preflight
# Salinan .env sementara (izin 600) agar pull yang gagal memulihkan .env APA ADANYA, termasuk saat belum ada tag
# sebelumnya (instalasi pertama); dihapus begitu pull berhasil.
ENV_BACKUP=$(mktemp "$DIR/.env.bak.XXXXXX") || die 2 'gagal membuat salinan sementara .env'
if ! { cp -p "$DIR/.env" "$ENV_BACKUP" && chmod 600 "$ENV_BACKUP"; }; then
  rm -f "$ENV_BACKUP"
  die 2 'gagal menyalin .env'
fi
restore_env() { mv -f "$ENV_BACKUP" "$DIR/.env" || log 'PERINGATAN: .env tidak dapat dipulihkan dari salinan sementara'; }
set_tag "$TAG" || { restore_env; die 2 'gagal menulis QC_IMAGE_TAG ke .env'; }

if ! compose pull qc-app; then
  # kontainer yang berjalan tidak tersentuh: pulihkan .env persis seperti semula
  restore_env
  die 1 "pull image gagal; .env dipulihkan apa adanya (tag sebelumnya: ${PREV_TAG:-tidak ada}; $LOG_HINT)"
fi
rm -f "$ENV_BACKUP"
if ! compose up -d; then
  log 'up -d gagal'
  rollback
fi
if ! wait_healthy "$TAG"; then
  log "kontainer tidak sehat atau tidak memakai tag $TAG dalam batas waktu"
  rollback
fi
if ! smoke_test; then
  log '/api/ping gagal'
  rollback
fi

nginx_rc=0
nginx_smoke_test || nginx_rc=$?
if [ "$nginx_rc" -eq 1 ]; then
  log 'uji lewat nginx gagal: nginx menjawab tetapi bukan 2xx'
  rollback
elif [ "$nginx_rc" -ne 0 ]; then
  die 5 "versi baru $TAG sehat dan aktif, tetapi nginx tidak terjangkau (periksa systemctl status nginx dan konfigurasinya); tidak dikembalikan ($LOG_HINT)"
fi

cleanup_images || log 'pembersihan image dilewati (galat tak terduga; tidak memengaruhi hasil deploy)'

log "selesai: lingkungan=$ENV_NAME tag=$TAG"
echo "DEPLOY_OK env=$ENV_NAME tag=$TAG"
