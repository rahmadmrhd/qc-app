#!/usr/bin/env bash
# Skrip deploy qc-app di VPS. Dipasang di /root/apps/qc-app/deploy.sh dan dipanggil lewat kunci SSH khusus:
#   restrict,command="/root/apps/qc-app/deploy.sh [--only staging|production]" ssh-ed25519 AAAA...
# (`restrict` sudah mencakup no-pty/no-port-forwarding/no-agent-forwarding/no-X11-forwarding/no-user-rc dan menutup
# fitur baru OpenSSH yang kelak aktif bawaan; periksa juga `PermitRootLogin prohibit-password` atau
# `forced-commands-only` di sshd_config VPS.)
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
# (tidak ada yang diubah); 3 deploy lain sedang berjalan; 4 gagal dan pengembalian juga gagal/tidak mungkin.
#
# Argumen (hanya pemanggil lokal): --only staging|production (batasi lingkungan yang boleh diminta kunci ini), --dry-run
# (validasi lalu cetak rencana; tidak menyentuh docker/berkas), --root DIR (bawaan /root/apps/qc-app),
# --wait-seconds N, --poll-seconds N.
set -euo pipefail
umask 077

ROOT=/root/apps/qc-app
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
  log "rencana: set QC_IMAGE_TAG=$TAG di $ROOT/$ENV_NAME/.env; docker compose pull qc-app; docker compose up -d; tunggu sehat; curl /api/ping; kembali ke tag sebelumnya bila gagal"
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

# Log keluaran docker compose: khusus root di VPS, ditimpa tiap deploy. Tidak pernah diteruskan ke pemanggil.
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

# ---- 4. Deploy ----
log "lingkungan=$ENV_NAME tag=$TAG (sebelumnya: ${PREV_TAG:-tidak ada})"
# .env/compose.yml yang rusak (kutip tak tertutup, variabel wajib kosong) berhenti DI SINI tanpa mengubah apa pun dan
# tanpa mencetak pesan docker (dapat memuat potongan rahasia). QC_IMAGE_TAG diberikan lewat lingkungan proses (yang
# didahulukan compose atas .env) agar deploy pertama tanpa tag di .env tidak ditolak oleh `${QC_IMAGE_TAG:?}`.
if ! QC_IMAGE_TAG="$TAG" docker compose --project-directory "$DIR" -f "$DIR/compose.yml" config --quiet >/dev/null 2>&1; then
  die 2 ".env/compose.yml tidak valid; periksa di VPS: cd $DIR && docker compose config --quiet"
fi
set_tag "$TAG" || die 2 'gagal menulis QC_IMAGE_TAG ke .env'

if ! compose pull qc-app; then
  # kontainer yang berjalan tidak tersentuh: cukup pulihkan .env
  if [ -n "$PREV_TAG" ]; then set_tag "$PREV_TAG" || true; fi
  die 1 "pull image gagal; tag di .env dikembalikan (${PREV_TAG:-tanpa tag}; $LOG_HINT)"
fi
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

cleanup_images || log 'pembersihan image dilewati (galat tak terduga; tidak memengaruhi hasil deploy)'

log "selesai: lingkungan=$ENV_NAME tag=$TAG"
echo "DEPLOY_OK env=$ENV_NAME tag=$TAG"
