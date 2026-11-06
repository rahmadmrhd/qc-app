# Pemasangan qc-app di VPS (staging dan production)

Prosedur MANUAL untuk memasang `qc-app` (Bun + Hono) dan `qc-db` (MariaDB 11.8) di VPS bersama, di belakang nginx host dan Cloudflare. Semua langkah yang mengubah VPS dijalankan pemilik atau agen dengan otorisasi pemilik secara terpisah; dokumen ini tidak menjalankan apa pun sendiri. Tiap langkah memuat cara membatalkannya.

**Notasi folder instalasi.** `<INSTALL_DIR>` = folder instalasi di server (berisi `deploy.sh`, `<env>/`, `backup/`, `ci-keys/`). Di VPS pribadi nilainya `/root/apps/qc-app`, dan semua jalur `/root/apps/qc-app` serta `/root/.ssh`, `/root/.docker` di dokumen ini adalah CONTOH untuk VPS itu (pengguna `root`); di server lain, ganti dengan `<INSTALL_DIR>` dan home pengguna deploy. `deploy.sh` menurunkan folder instalasinya dari lokasi skrip sendiri, jadi folder boleh di mana saja (lihat bagian "Pindah ke server/pengguna lain" di bawah).

| | Staging (`staging`) | Production (`production`) |
|---|---|---|
| Hostname | `qc-dev.rhd.my.id` | `qc.rhd.my.id` |
| Folder (contoh VPS pribadi; umumnya `<INSTALL_DIR>/<env>`) | `/root/apps/qc-app/staging` | `/root/apps/qc-app/production` |
| `QC_ENV` / `QC_NAME` | `staging` / `qc-staging` (bawaan) | `production` / `qc-production` (bawaan) |
| `APP_PORT` (127.0.0.1) | 8790 | 8791 |
| `DB_PORT` (127.0.0.1) | 33064 | 33065 |
| `QC_SUBNET` | `10.77.10.0/24` | `10.77.20.0/24` |

Aturan VPS bersama: jangan menyentuh kontainer, blok nginx, firewall, atau pengguna milik aplikasi lain. Port 8787 dilarang. Selalu periksa dulu (baca-saja) sebelum membuat sesuatu, dan jangan mencetak rahasia ke terminal, log, atau chat.

## 0. Hostname dan keputusan jalur

- Staging memakai `qc-dev.rhd.my.id`, BUKAN `qc.dev.rhd.my.id`: Universal SSL Cloudflare hanya mencakup satu tingkat di bawah `rhd.my.id`, hostname dua tingkat tidak tertutup sertifikat tepinya.
- Folder deploy `<INSTALL_DIR>/{staging,production}` (di VPS pribadi `/root/apps/qc-app/...`) menggantikan `/opt/qc/<env>`. Deploy otomatis (T28) masuk sebagai pengguna deploy dengan kunci SSH yang dibatasi `command=` ke satu skrip (lihat langkah 9); di VPS pribadi pengguna itu `root` (DIKONFIRMASI pemilik 2026-11-06, spek §19 butir 8), di server kantor nanti BUKAN root dan folder instalasinya lain (keputusan pemilik 2026-11-07, spek §19 butir 11; lihat bagian "Pindah ke server/pengguna lain").
- Penamaan lingkungan (keputusan pemilik 2026-11-07, spek §19 butir 10): `staging` dan `production` di semua tempat (folder, `QC_ENV`, `--only`, environment GitHub), menggantikan `dev`/`exec`. Instalasi staging yang dibuat dengan nama lama dipindahkan: hentikan stack, `mv /root/apps/qc-app/dev /root/apps/qc-app/staging`, ubah `QC_ENV=staging` dan tambahkan `QC_DB_USER=qc_dev`/`QC_DB_NAME=qc_dev` di `.env`, salin `compose.yml`/`deploy.sh` baru, ganti `--only dev` di `authorized_keys` menjadi `--only staging`, lalu `docker compose up -d` (nama proyek/kontainer `qc-staging` tidak berubah, volume tetap).

## 1. Stack dev lama (T1) yang masih berjalan di /opt/qc/dev

Sejak T1 ada stack MariaDB dev di `/opt/qc/dev` (proyek compose `qc-dev`, kontainer `qc-dev-db`, jaringan `qc-dev_default` 172.18.0.0/16, `127.0.0.1:33063`). Itu DB yang dipakai pemilik lewat `bun run db:tunnel` (skema `qc_dev` dan `qc_test_*`) dan TIDAK diubah oleh pemasangan ini:

- Staging memakai awalan sendiri `QC_NAME=qc-staging` (proyek `qc-staging`, kontainer `qc-staging-db`/`qc-staging-app`, jaringan `qc-staging_default`, volume `qc-staging_qc-db-data`), sehingga tidak bertabrakan nama dengan `qc-dev`. Konsekuensinya sementara ada dua kontainer MariaDB untuk "dev" (+384 MB RAM batas; periksa `free -m` dulu, lihat T29).
- **Keputusan pemilik 2026-11-06 ("pisahkan saja"): kedua MariaDB dev tetap terpisah** (`qc-dev-db` untuk pengembangan/tes lewat tunnel, `qc-staging-db` untuk staging); tidak ada tindakan terhadap `qc-dev-db`. Menyatukannya (staging memakai `qc-dev-db`) akan mengharuskan membuat ulang `qc-dev-db` dan jaringannya, dan tidak direncanakan.
- Jangan menghapus `/opt/qc/dev` atau volumenya.

## 2. Pemeriksaan baca-saja (aman)

```bash
ssh rhd_vps_ipv4
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
docker network ls; docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
ss -ltn
free -m; df -h /
ls -l /etc/nginx/sites-available /etc/nginx/sites-enabled
grep -R "ssl_certificate" /etc/nginx/sites-enabled | sed 's/^/  /'   # jalur sertifikat yang dipakai situs lain
docker compose version; nginx -v
```

Pastikan 8790/8791 dan 33064/33065 bebas, subnet `10.77.x.0/24` tidak terpakai, dan `free -m` tersedia cukup (jangan lanjut bila < 600 MB). Sertifikat yang ditiru dari situs lain harus mencakup hostname baru; bila tidak, berhenti dan minta pemilik menerbitkan Origin CA untuk `qc-dev.rhd.my.id` dan `qc.rhd.my.id`.

## 3. Direktori

```bash
install -d -m 700 /root/apps/qc-app /root/apps/qc-app/backup /root/apps/qc-app/ci-keys
install -d -m 700 /root/apps/qc-app/staging /root/apps/qc-app/staging/secrets /root/apps/qc-app/staging/mariadb
# production hanya saat production disiapkan:
install -d -m 700 /root/apps/qc-app/production /root/apps/qc-app/production/secrets /root/apps/qc-app/production/mariadb
```

Pembatalan: `rmdir`/`rm -r` direktori baru itu saja (belum berisi data pada tahap ini).

## 4. Berkas dari repositori

Dari mesin pengembang (repo `qc`, working tree bersih di komit yang akan dipasang):

```bash
scp deploy/deploy.sh rhd_vps_ipv4:/root/apps/qc-app/deploy.sh
scp deploy/compose.yml rhd_vps_ipv4:/root/apps/qc-app/staging/compose.yml
scp deploy/mariadb/qc.cnf rhd_vps_ipv4:/root/apps/qc-app/staging/mariadb/qc.cnf
ssh rhd_vps_ipv4 'chmod 700 /root/apps/qc-app/deploy.sh; chmod 600 /root/apps/qc-app/staging/compose.yml /root/apps/qc-app/staging/mariadb/qc.cnf'
```

Ulangi untuk `production` bila perlu. Pembatalan: hapus berkas yang disalin.

## 5. .env per lingkungan (izin 600, rahasia dibangkitkan di VPS)

Salin `deploy/.env.example` menjadi `/root/apps/qc-app/<env>/.env` lalu isi LANGSUNG di VPS. Bangkitkan rahasia di sana tanpa mencetaknya:

```bash
cd /root/apps/qc-app/staging
umask 077
# contoh: tulis nilai acak langsung ke berkas, tidak ke layar
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 24)/" .env
sed -i "s/^SYNC_API_TOKEN=.*/SYNC_API_TOKEN=$(openssl rand -hex 24)/" .env
sed -i "s/^MARIADB_ROOT_PASSWORD=.*/MARIADB_ROOT_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^QC_DB_PASSWORD=.*/QC_DB_PASSWORD=$(openssl rand -hex 24)/" .env
chmod 600 .env
```

Nilai yang diisi pemilik (OAUTH_*, SMTP_*, GOOGLE_ROOT_FOLDER_ID, GOOGLE_SPREADSHEET_ID; kunci service account bukan variabel melainkan berkas `secrets/google-sa.json`, lihat `docs/setup-google.md`) ditulis `ISI_OLEH_PEMILIK` sampai diisi. Pastikan `QC_ENV` sama dengan nama folder, `QC_NAME=qc-staging` (staging), `QC_SUBNET`, `TRUSTED_PROXY` (loopback + `QC_SUBNET`), `APP_PORT`, `DB_PORT`, dan `APP_ORIGIN` (`https://qc-dev.rhd.my.id` atau `https://qc.rhd.my.id`). Kata sandi hanya heksa (aman-URL). Jangan `cat .env`.

Pembatalan: hapus `.env` (rahasia dapat dibangkitkan ulang; belum ada data).

## 6. Kunci service account Google

Pemilik menyalin berkas kunci langsung ke `/root/apps/qc-app/<env>/secrets/google-sa.json` (`scp`, tidak lewat GitHub) lalu `chown 1000:1000` dan `chmod 600`. PEMILIK HARUS uid 1000: kontainer berjalan sebagai pengguna `bun` (uid 1000), dan berkas milik `root` berizin 600 tidak terbaca olehnya (diverifikasi di staging 2026-11-06). Compose memasangnya baca-saja ke `/run/secrets/google-sa.json` dan GAGAL bila berkas tidak ada. Sebelum T30a kode belum membacanya: berkas kosong sementara (`install -m 600 -o 1000 -g 1000 /dev/null .../google-sa.json`) cukup agar kontainer jalan. Pembatalan: hapus berkas.

## 7. Image dan registri

Normal (T28): Actions membangun dan mendorong ke GHCR; di server `docker login ghcr.io -u <pengguna>` dengan PAT `read:packages` milik pemilik, dijalankan SEBAGAI pengguna deploy (tersimpan di `~/.docker/config.json` pengguna itu; VPS pribadi: `/root/.docker/config.json`, izin 600; token tidak pernah di repositori/chat). Sebelum T28 (branch belum di-push), bangun SEKALI di VPS dari arsip komit (tanpa mengubah remote):

```bash
# di mesin pengembang
git archive --format=tar.gz -o /tmp/qc-src.tgz HEAD && scp /tmp/qc-src.tgz rhd_vps_ipv4:/root/apps/qc-app/
# di VPS (rendah prioritas; berhenti bila memori kurang)
free -m   # tersedia harus >= 600 MB
mkdir -p /root/apps/qc-app/build && tar -xzf /root/apps/qc-app/qc-src.tgz -C /root/apps/qc-app/build
nice -n 19 ionice -c3 docker build -t qc-app:local-<sha> /root/apps/qc-app/build
```

Untuk image lokal isi `.env`: `QC_IMAGE=qc-app` dan `QC_IMAGE_TAG=local-<sha>`, lalu jalankan `docker compose up -d` langsung (bukan `deploy.sh`: `pull` gagal untuk image lokal, dan `deploy.sh` menolak `QC_IMAGE` yang bukan `ghcr.io/...`). Peralihan dari image lokal ke GHCR (hapus/komentari `QC_IMAGE`, `docker login ghcr.io`, deploy GHCR pertama tanpa target pengembalian): lihat "Urutan uji pertama" di `docs/ci-cd.md`. Bangun memakai pembangun klasik dengan batas sumber daya (BuildKit tidak dapat dibatasi per build dari klien): `DOCKER_BUILDKIT=0 nice -n 19 ionice -c3 docker build --memory 1200m --memory-swap 1200m --cpu-shares 64 --cpu-quota 100000 -t qc-app:local-<sha> .`, dan pantau `MemAvailable` (hentikan bila < 600 MB). Pembatalan: `docker rmi qc-app:local-<sha>`; `rm -r /root/apps/qc-app/build /root/apps/qc-app/qc-src.tgz`.

## 8. Menjalankan stack

`qc-app` menjalankan migrasi saat start, jadi skema dan pengguna DB harus ada SEBELUM `qc-app` dinyalakan (bila tidak, `qc-app` gagal start berulang karena `restart: unless-stopped`). Urutannya: nyalakan `qc-db` saja, tunggu sehat, buat skema/pengguna, baru nyalakan semuanya.

```bash
cd /root/apps/qc-app/staging
docker compose config --quiet            # validasi (baca-saja)
docker compose up -d qc-db               # hanya MariaDB: membuat jaringan qc-staging_default dan qc-staging-db
docker inspect --format '{{.State.Health.Status}}' qc-staging-db   # ulangi sampai: healthy
```

Setelah `qc-staging-db` sehat, pemilik/agen membuat skema dan pengguna di dalam kontainer (root DB dari `.env`; kata sandi tidak dicetak dan tidak lewat argumen proses):

```sql
CREATE DATABASE IF NOT EXISTS `qc_dev` CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;
CREATE USER IF NOT EXISTS 'qc_dev'@'%' IDENTIFIED BY '<QC_DB_PASSWORD>';
GRANT ALL PRIVILEGES ON `qc_dev`.* TO 'qc_dev'@'%';
```

(production: `qc_production`, bawaan `qc_${QC_ENV}`). Pada staging nama `qc_dev` WAJIB diisi eksplisit di `.env` (`QC_DB_USER=qc_dev`, `QC_DB_NAME=qc_dev`): skema itu sudah berisi data dan bawaan `qc_${QC_ENV}` akan menjadi `qc_staging`, yang tidak ada. Lalu nyalakan sisanya:

```bash
docker compose up -d                     # membuat qc-staging-app
docker compose ps; docker inspect --format '{{.State.Health.Status}}' qc-staging-app
```
 Pembatalan: `docker compose down` (TANPA `-v`) menghentikan dan membuang kontainer/jaringan, volume tetap; `docker compose down -v` juga menghapus data (hanya bila memang ingin menghapus staging).

## 9. Kunci SSH deploy (khusus, terbatas)

Buat satu pasang kunci per lingkungan di VPS (kunci privat hanya di `/root/apps/qc-app/ci-keys`, izin 600, tidak dicetak; pemilik memindahkannya ke secret environment GitHub lalu menghapus salinan di VPS bila mau):

```bash
ssh-keygen -t ed25519 -N '' -C 'qc-deploy staging' -f /root/apps/qc-app/ci-keys/qc-deploy-staging
```

Cadangkan dan tambahkan SATU baris ke `authorized_keys` milik PENGGUNA DEPLOY (contoh di bawah: `root`, `/root/.ssh/authorized_keys`; untuk pengguna lain `~pengguna/.ssh/authorized_keys`). Jalur di `command=` HARUS jalur mutlak lokasi `deploy.sh` yang sebenarnya (`<INSTALL_DIR>/deploy.sh`):

```bash
cp -p /root/.ssh/authorized_keys /root/apps/qc-app/backup/authorized_keys.$(date +%Y%m%d%H%M%S)
printf 'restrict,command="/root/apps/qc-app/deploy.sh --only staging" %s\n' "$(cat /root/apps/qc-app/ci-keys/qc-deploy-staging.pub)" >> /root/.ssh/authorized_keys
```

`restrict` mematikan sekaligus pty, port/agent/X11 forwarding, `~/.ssh/rc`, dan penerusan tun (serta fitur baru OpenSSH yang kelak aktif bawaan), jadi opsi `no-*` terpisah tidak dipakai. `--only staging` adalah tambahan di atas bentuk dasar `command="/root/apps/qc-app/deploy.sh"`: kunci staging tak dapat men-deploy production. Klien menjalankan `ssh -i <kunci> <pengguna-deploy>@<host> "deploy staging <tag>"`; input divalidasi ketat (`deploy <staging|production> <tag>`, tag permintaan = SHA commit 40 heksa huruf kecil `[0-9a-f]{40}`; hanya tag sebelumnya yang dikembalikan boleh lebih longgar), tidak pernah di-eval, dan perintah lain apa pun ditolak. Uji tanpa efek: `SSH_ORIGINAL_COMMAND='deploy staging <sha-40-heksa>' /root/apps/qc-app/deploy.sh --only staging --dry-run`.

Hanya bila pengguna deploy = `root`: periksa juga di VPS (baca-saja, belum terverifikasi) `sshd -T | grep -i permitrootlogin`, harus `prohibit-password` atau `forced-commands-only`, agar kunci root hanya dapat menjalankan perintah paksa dan tidak membuka shell lewat kata sandi.

Pembatalan: hapus baris itu dari `authorized_keys` (cari komentar `qc-deploy staging`: `grep -v 'qc-deploy staging' /root/.ssh/authorized_keys > /tmp/ak && cat /tmp/ak > /root/.ssh/authorized_keys`), atau pulihkan salinan di `/root/apps/qc-app/backup/`.

## 10. nginx (SATU berkas baru per hostname)

```bash
# tiru situs lain: baca-saja, pilih berkas yang sudah ada sebagai contoh jalur sertifikat dan gaya
sed -n '1,60p' /etc/nginx/sites-available/<situs-lain>
# salin blok STAGING dari deploy/nginx/qc.conf.example ke berkas baru, ganti ISI_JALUR_* dengan jalur sertifikat yang sama
# dengan situs lain (harus mencakup qc-dev.rhd.my.id), simpan sebagai:
#   /etc/nginx/sites-available/qc-dev.rhd.my.id
ln -s /etc/nginx/sites-available/qc-dev.rhd.my.id /etc/nginx/sites-enabled/qc-dev.rhd.my.id
nginx -t && nginx -s reload     # reload HANYA bila nginx -t lulus
```

Bila `nginx -t` gagal: `rm /etc/nginx/sites-enabled/qc-dev.rhd.my.id` dan JANGAN reload. Blok production (`qc.rhd.my.id`) ditulis tetapi TIDAK diaktifkan sebelum cutover. Perbarui daftar `set_real_ip_from` dari https://www.cloudflare.com/ips-v4 dan `/ips-v6`. Pembatalan: hapus symlink, `nginx -t && nginx -s reload`, hapus berkas di `sites-available`.

## 11. DNS Cloudflare dan OAuth (tindakan PEMILIK)

- DNS: rekaman `A` (dan `AAAA` bila ada) `qc-dev` dan `qc` ke IP VPS, status Proxied (awan oranye); mode SSL/TLS = Full (strict). Pembatalan: hapus rekaman.
- Google Cloud Console, klien OAuth yang sama: tambahkan URI redirect `https://qc-dev.rhd.my.id/auth/callback` dan `https://qc.rhd.my.id/auth/callback`. Pembatalan: hapus URI itu.

## 12. Verifikasi

Di VPS (tanpa DNS publik, melewati sertifikat tepi):

```bash
curl -sk --resolve qc-dev.rhd.my.id:443:127.0.0.1 https://qc-dev.rhd.my.id/api/ping -o /dev/null -w '%{http_code}\n'      # 200
curl -sk --resolve qc-dev.rhd.my.id:443:127.0.0.1 https://qc-dev.rhd.my.id/api/v1/me -i | head -15                         # 401 application/problem+json
docker inspect --format '{{.State.Health.Status}} {{.Config.User}}' qc-staging-app                                         # healthy, user non-root
docker exec qc-staging-app id                                                                                              # uid=1000(bun)
docker stats --no-stream; free -h
```

Lewat Cloudflare (setelah DNS): `curl -s https://qc-dev.rhd.my.id/api/ping`. Perhatikan memori (`docker stats`, `free -h`) terhadap batas di rencana (T29).

## 13. Ringkasan pembatalan

| Langkah | Pembatalan |
|---|---|
| 3 direktori | hapus direktori baru |
| 4 berkas | hapus berkas yang disalin |
| 5 .env | hapus `.env` |
| 6 kunci Google | hapus berkas kunci |
| 7 image | `docker rmi`, hapus `build/` |
| 8 stack | `docker compose down` (tanpa `-v`); `-v` hanya untuk menghapus data staging |
| 9 kunci SSH | hapus baris `authorized_keys` (cadangan di `backup/`), hapus kunci di `ci-keys` |
| 10 nginx | hapus symlink, `nginx -t && nginx -s reload`, hapus berkas |
| 11 DNS/OAuth | hapus rekaman/URI (pemilik) |

## 14. Pindah ke server/pengguna lain

Checklist (bukan implementasi; server kantor dibangun nanti). Tidak ada kode yang terikat ke `root` atau `/root/apps/qc-app`: `deploy.sh` menurunkan folder instalasinya dari lokasi skrip, dan bawaan `QC_SECRETS_DIR` adalah `./secrets` (relatif terhadap folder compose). Keputusan pemilik 2026-11-07 (spek §19 butir 11).

- [ ] **Folder instalasi** `<INSTALL_DIR>` bebas (mis. `/srv/qc-app` atau `~deploy/qc-app`), dimiliki pengguna deploy; salin `deploy.sh` ke `<INSTALL_DIR>/deploy.sh` dan `compose.yml`, `mariadb/qc.cnf`, `.env` ke `<INSTALL_DIR>/<env>/` seperti langkah 3-5 (ganti awalan jalurnya).
- [ ] **Pengguna deploy** non-root: masuk ke grup `docker` (setara akses root atas host; karena itu kuncinya TETAP `restrict,command=` dan hanya menjalankan `deploy.sh`), `docker login ghcr.io` DENGAN pengguna itu (kredensial di `~/.docker/config.json`-nya, bukan `/root/.docker`).
- [ ] **`authorized_keys` milik pengguna deploy** (`~pengguna/.ssh/authorized_keys`): tulis ulang `command="<INSTALL_DIR>/deploy.sh --only <env>"` dengan jalur mutlak baru; kunci lama di server lama dicabut. `PermitRootLogin` tak relevan lagi bila root tidak dipakai; pastikan `PasswordAuthentication no` bagi pengguna itu.
- [ ] **Secret GitHub** per environment: `DEPLOY_USER` (pengguna baru), `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_HOST_KEY` (kunci host server baru; verifikasi sidik jarinya lewat jalur lain sebelum disimpan), dan `DEPLOY_SSH_KEY` (pasangan baru). Validasi `DEPLOY_USER` di workflow sudah umum (`^[a-z_][a-z0-9_-]{0,31}$`).
- [ ] **`.env`** di `<INSTALL_DIR>/<env>/`: `QC_SECRETS_DIR` biarkan bawaan (`./secrets`) atau isi jalur mutlak/relatif yang benar; berkas `google-sa.json` berpemilik uid 1000 seperti langkah 6.
- [ ] **nginx/DNS/OAuth**: contoh `deploy/nginx/qc.conf.example` tidak memuat jalur instalasi; yang berubah hanya host/port dan sertifikat origin bila server baru. Daftarkan URI redirect OAuth untuk hostname baru.
- [ ] **Uji**: `SSH_ORIGINAL_COMMAND='deploy staging <sha>' <INSTALL_DIR>/deploy.sh --dry-run` (melaporkan `root=<INSTALL_DIR>`), lalu satu deploy nyata dari Actions.
