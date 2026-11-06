# Inventaris perilaku Country Lock (aplikasi WPF lama) untuk bahan spek Electron + React

Sumber: repo privat `rahmadmrhd/CountryLock`, branch `master`, dibaca saja (salinan lokal di `...\scratchpad\cl-src`). Semua nomor baris merujuk berkas di bawah `Country Lock/` kecuali disebut lain.

Singkatan berkas: `CL.cs` = `Page/CountryLock.xaml.cs` (mode tunggal); `CLM.cs` = `Page/CountryLockMulti.xaml.cs`; `CLC.cs` = `General/CountryLockClass.cs`; `SIS.cs` = `General/SshInjectSession.cs`; `FC.cs` = `General/FileCRUD.cs`; `DB.cs` = `General/Database.cs`.

PERINGATAN SUMBER: dokumen di repo itu sendiri sebagian usang terhadap kode. Patokan kebenaran adalah kode, bukan dokumen:
- `CLAUDE.md` repo masih menyebut format `.QC` INI, eksekusi inject lewat `plink.exe`, `AutoInject`/`AutoSelect` tersimpan di Settings, dan `OptionCL`. Kode sekarang: `.QC` adalah JSON, inject lewat SSH.NET `ShellStream` (`SIS.cs`), `AutoInject` hanya checkbox sesi (tidak disimpan), editor config = `ConfigEditorForm`.
- `.kiro/specs/ssh-execution-refactor/design.md` menggambarkan `SshClient.CreateCommand()` satu blok. Kode akhir membuangnya (lihat bagian 3). Dokumen kiro itu tetap berguna sebagai konteks topologi.
- `docs/superpowers/specs/2026-07-24-multimode-ui-parity-design.md` murni spek UI Multi-Device (kartu responsif, tombol, badge). Sebagian tidak pernah diterapkan (rotasi kamera di Multi: tidak ada di `CLM.cs`).

Berkas yang TIDAK ada di repo dan karena itu tidak dapat diinventarisasi: skrip inject (`.txt`/`.rsc`/`.npk`/`.bin`, datang dari zip di Google Drive lewat Firebase `Script`), contoh `config.QC` utuh, badan stored procedure `AddDataQC`, `MainWindow.xaml.cs` (dialog bentrok antar-mode). Lihat bagian 9.

---

## 1. Alur mode tunggal (`CL.cs`)

### 1.1 Komponen dan state

| Elemen | Lokasi | Arti |
|---|---|---|
| `pingDeviceWorker` (`Pinger`, `AllowGetData=true`) | `CL.cs:230-242` | Loop ping perangkat target. Pada ping sukses juga menjalankan SSH satu-baris untuk serial. |
| `pingRouterWorker` (`Pinger`, tanpa data) | `CL.cs:244-246` | Loop ping jump-router (`Config.Server`). |
| `devicePingable`, `routerPingable` | `CL.cs:91-92` | Hasil ping terakhir (diset di `PingDeviceChanged`/`PingRouterChanged`). |
| `infoDeviceComplated`, `infoRouterComplated` | `CL.cs:961-962` | Penjaga: pengambilan info SSH sedang berjalan (false) atau selesai (true). Awal true. |
| `runChecking` | `CL.cs:158` | True dari `GetFirmware` (`:858`) sampai `TaskFinished()` (`:974`). Selama true, kegagalan kredensial di `DeviceResult` tidak memunculkan form (`:999-1006`). |
| `isReset` | `CL.cs:159` | True setelah `ResetCondition`; `DeviceResult` langsung keluar bila true (`:992-996`); jadi false pada ping-change pertama (`:1148`). |
| `statusCL` | `CL.cs:93` | Penjaga re-entry inject. |
| `credentialHasBeenRequested` | `CL.cs:160` | Form kredensial manual sedang terbuka. |
| `Config`, `FileConfig`, `PathFile`, `Merk` | `CL.cs:46-74` | Config merk terpilih; `PathFile` = folder tempat `.QC` berada. |
| `Mode` (`Normal`/`OCR`) | `CL.cs:142-157, 1559` | Normal: panel browser Chromium; OCR: panel kamera. |
| `Config.CurrentIndex` | `FC.cs:250` | Indeks interface bridge aktif untuk rotasi. |
| `serial`, `resolvedSshKey` | `CL.cs:94, 98` | Serial perangkat yang sedang diproses; host-key server untuk placeholder `{sshKey}`. |

### 1.2 Urutan dari memilih config sampai siap

1. Konstruktor (`CL.cs:162-266`): `GetFolder(FileName)` dengan `FileName = Global.Settings.PathFileCL` (jalur `.QC` terakhir; `Settings` disimpan di `Documents\QC\Config.user`, `FC.cs:408-491`). Bila jalur kosong, dicoba `Desktop\COUNTRY LOCK\config.QC` (`CL.cs:783-787`).
2. `GetFolder` (`CL.cs:739-793`): `ConfigFile.Read(file, isMultiMode:false)`. Bila `ErrorCount <= 0`: `PathFile = dirname`, simpan jalur ke Settings, isi `folderBox` dengan daftar `[Mikrotik, Ubiquiti]` (hardcoded `ListMerk`, `CL.cs:39-44`). Bila `ErrorCount > 0`: kosongkan `FileName`, matikan kotak, dan (bila halaman loaded) tanya "Tidak dapat membaca file! Unduh file script baru?" yang mengunduh zip skrip (lihat 8.4). `AutoInject=false` di awal tiap `GetFolder` (`:741`).
3. Pilih merk di `folderBox` -> `FolderBox_SelectionChanged` (`:826-847`) -> `GetFirmware(merk)` (`:848-876`) dan `UpdateListTipe(merk)` (`:1229-1256`).
4. `GetFirmware`: `Config = FileConfig.ListConfig[merk]`; isi `currentInterfaceBox` dengan `Config.Interfaces`; `credentialForm.SetConfig(Config)` (mengisi username/password bawaan dari config); `pingDeviceWorker.ConfigDevice = (merk, Config)`; **start** `pingDeviceWorker`; `pingRouterWorker.IPAddress = Config.Server`, **start**; `runChecking = true`; muat halaman web `Config.Web.Replace("{ip}", Config.Target)` ke Chromium; isi `firmwareBox` dari `FirmwareName` dan peta `FileFirmware[code]=name`; bila `CurrentIndex` valid: pilih interface itu dan `await SwitchBridgePort(CurrentIndex)`.
5. `Tipe` berasal dari database (`ListTipe.Instanse.UpdateListTipe`): hanya `IsCountryLock && !Deleted` untuk merk itu (`:1242`). Memilih tipe yang punya kode `Firmware` otomatis memilih firmware cocok lewat `FileFirmware[kode]` dan mengunci `firmwareBox` (`TipeBox_SelectionChanged`, `:877-896`); tipe tanpa kode firmware membiarkan firmware dipilih manual. Tipe bergambar stiker memunculkan `Sticker.Show` setelah dropdown tertutup (`:1399-1418`).

### 1.3 State machine ping

`Pinger` (`CLC.cs:13-190`): `DoWork` (`:107-163`) berjalan di `BackgroundWorker`, diulang oleh `DispatcherTimer`.

- ICMP `Ping.Send(target, 1000 ms)` (`:114`). Target = `ConfigDevice.Item2.Target` bila ada, kalau tidak `IPAddress`.
- Interval berikutnya: sukses 800 ms (`Interval`, `:41,122`); `DestinationHostUnreachable` 500 ms (`:138`); status lain (timeout dsb.) 200 ms (`:141`); exception 500 ms (`:148`).
- Pada ping sukses dan `AllowGetData`, jalankan SSH satu perintah untuk serial (perintah persis di bagian 2.1). Hasil dibersihkan dari `\t\n\r` (`:133`). Bila hasil `"Permission denied!!!"` serial dikosongkan (`:130-132`).
- Event `PingChangedEvent(bool, serial)` dan `PingChangedEvent2(bool)` hanya dipicu bila `pingable` ATAU `serial` berubah dari nilai sebelumnya (`:155-160`). Maka `PingDeviceChanged` hanya terpanggil pada transisi (naik/turun) atau perubahan serial.
- `Start()` saat worker sibuk: set `RestartPingDeviceWorker` dan `CancelAsync` (`:62-73`); `Stop()` hanya menghentikan timer (`:75-78`).
- `IsActive = hasStarted && !isStop` dipakai `IsSessionActive` (`CL.cs:108`) agar mode Multi dapat mendeteksi bentrok.

`PingDeviceChanged(condition, serial)` (`CL.cs:1147-1201`):
- Selalu `isReset = false`. Bila status ping berubah, semua `queues[i].IsFailed` direset ke false (`:1149-1155`), supaya perangkat baru mencoba ulang semua kredensial.
- `condition == true`: `App.ExpandTimeOut()` (memperpanjang timer sesi login app, abaikan di rebuild), refresh browser, ikon perangkat hijau, `this.serial = serial`, lalu **auto-inject bila syarat** (1.4); kemudian `if (infoDeviceComplated) await ReloadInfo(true)` (info penuh perangkat saja).
- `condition == false`: `serial` dikosongkan, `chrome.Stop()`, ikon merah, teks info `"Unknow\n<Target>"`.

`PingRouterChanged(condition)` (`:1206-1228`): sukses -> ikon hijau, `infoRouterComplated=false`, `RouterInfo.Get(MerkTipe.Mikrotik, Server, ServerUsername, ServerPassword, GetRouterResult)`, dan **`Config.CurrentIndex = 0`** dengan interface pertama dipilih (reset rotasi tiap router kembali hidup). Gagal -> `chrome.Stop()`, `resolvedSshKey=""`, teks "Unknow".

### 1.4 Kapan info dibaca, kapan inject

Pembacaan info penuh perangkat (`ReloadInfo`, `CL.cs:935-960`): dipicu oleh (a) ping perangkat naik (`:1185-1186`), (b) tombol reload / F5 (`:591-607, 922-931`), (c) `queues` berubah (`:224-228`, kredensial OCR baru), (d) setelah form kredensial manual (`:1014`), (e) setelah inject (`Cmd_Finished`, `:1371-1373`, `ReloadInfo()` tanpa `deviceOnly`). `deviceOnly=true` hanya perangkat; `false` juga router. Pada mode OCR `AllowGetData` pinger dimatikan selama info diambil (`:937-938`) dan dihidupkan lagi di `DeviceResult` (`:993, 1000, 1035, 1071`).

`DeviceResult(info)` (`:991-1075`):
- `info.Error` terisi (= `"Permission denied!!!"`): tampilkan error. Bila `runChecking`, berhenti diam-diam. Mode Normal: buka `credentialForm.Show(...)` (satu form, `credentialHasBeenRequested=true`); callback mengganti `pingDeviceWorker.ConfigDevice` dengan `ConfigCL{Target, Username, Password}` baru lalu `ReloadInfo(true)`. Mode OCR: tandai `CurrentCredential.IsFailed`, pilih kredensial pertama di antrian yang belum gagal, `CurrentCredential = ...` dan `ReloadInfo(true)` lagi; bila semua gagal, semua `IsFailed` direset (tanpa retry langsung).
- Sukses: `serial = info.SerialNumber`; bila serial ada, `CurrentCredential.IsDone=true`; isi teks `Model\nSerial\nCountry\nTarget`.
- **Auto-inject** (`:1050-1068`): jika `AutoInject` DAN merk dipilih DAN `Config.Folder` tak kosong DAN firmware dipilih DAN serial tak kosong DAN aturan lokasi terpenuhi (`Global.User.Location.Id >= 0` atau (`== -1` dan `LocationBox` terpilih)) -> `MacAddress.AddPendingData(...)`; bila hasil `Success` dan `!statusCL` -> notifikasi dan `StartPutty(file, auto:true)`. Karena `AddPendingData` mengembalikan `Duplicated` untuk serial yang sudah di daftar pending, **auto-inject tidak mengulang perangkat yang serialnya sudah tercatat**.
- Jalur ping (`:1167-1182`) memiliki blok auto-inject yang sama persis memakai serial dari `Pinger`; urutan kedua jalur ini berarti perangkat yang sama tidak diinject dua kali (kedua memakai `AddPendingData` sebagai gerbang idempoten).

Syarat inject manual (`InjectBtn_Click`, `:900-904`): merk dan firmware terpilih, `Config.Folder` tak kosong, `!statusCL`, aturan lokasi sama. Jalur skrip: `PathFile + "\" + Config.Folder + "\" + Config.FirmwareFile[firmwareBox.SelectedIndex]`.

### 1.5 Penjaga re-entry `statusCL`

`StartPutty(file, auto)` (`CL.cs:1263-1367`):
1. `App.ExpandTimeOut()`; `if (statusCL) return;` `if Config.Folder kosong return;`
2. `statusCL = true` SEBELUM operasi asinkron apa pun (`:1270`). UI: tombol inject nonaktif, spinner.
3. Baca isi skrip `File.ReadAllText(file)`; gagal -> dialog "File Error!" dan keluar (finally mereset).
4. Bila `!auto` (manual): ambil info lagi lewat SSH dengan kredensial `credentialForm`; `Error` -> munculkan form kredensial ulang (callback memanggil `StartPutty(file,false)` lagi) + notifikasi "Permission Denied!!!" dan keluar; serial kosong -> notifikasi "Mac Address/Serial Number tidak ditemukan" dan keluar; sukses -> `CurrentCredential.IsDone=true`, `AddPendingData` (Success/Duplicated/Error hanya mengubah notifikasi; **Duplicated tidak menghentikan inject manual**). Bila `auto`, `AddPendingData` sudah dilakukan pemanggil.
5. Susun `ScriptPlaceholders` dan `ScriptTemplate.Render`; `ResolveConnectTarget()` (`:1257-1261`): `ConnectVia==Server` -> (`Config.Server`, `ServerUsername`, `ServerPassword`) selain itu (`Config.Target`, `credentialForm.Username`, `credentialForm.Password`).
6. `pingDeviceWorker.AllowGetData=false`; buka `InjectProgressForm.ShowScript(namaFile, scriptText)` (skrip yang sudah dirender, TERMASUK sandi, dicetak ke kotak log); `await SshInjectSession.Run(...)` (bagian 3).
7. `statusCL = false` dahulu (`:1351`, sengaja sebelum lanjut supaya rantai AutoInject boleh jalan), lalu `await Cmd_Finished(success)`.
8. `catch`: dialog "Proses inject gagal!"; `finally`: `statusCL=false`, UI dipulihkan, `AllowGetData=true`.

### 1.6 Rotasi interface bridge (`CurrentIndex`)

- Daftar: `ConfigCL.Interfaces` = `InterfaceList` dipecah koma, `MyTrim`, dikurangi `InterfaceComp`, `Distinct` (`FC.cs:251-255`). Bawaan `InterfaceList="ether1,ether2,ether3,ether4,ether5"`, `InterfaceComp="ether1"` -> `[ether2..ether5]`.
- `SwitchBridgePort(index)` (`CL.cs:1526-1541`), via SSH ke jump-router (`Extension.AsyncConnectSSH`, timeout 5 s) dengan tiga perintah RouterOS berurutan:
  1. `/interface bridge port remove [find interface!=<InterfaceComp>]`
  2. `/interface bridge port add interface=<Interfaces[index]> bridge=<Config.InterfaceBridge>`
  3. `/ip arp remove [find]`
  Penjaga `switchingBridgePort`: bila sedang berjalan, panggilan baru DIABAIKAN diam-diam (`:1527`), bukan diantrikan.
- Pemicu: `currentInterfaceBox_SelectionChanged` (`:1543-1552`) menyetel `Config.CurrentIndex` lalu `SwitchBridgePort`. Dari `GetFirmware` (pilih indeks awal), `PingRouterChanged(true)` (reset ke 0), dan `Cmd_Finished`.
- `Cmd_Finished(success)` (`:1368-1388`): kosongkan `serial`, reset teks info, `ReloadInfo()` bila kedua info selesai, `RefreshBrowser()`. **Rotasi HANYA bila `injectSuccess`** (`:1379`): `CurrentIndex++`, wrap ke 0 bila melewati jumlah interface, pilih di combo (memicu `SwitchBridgePort`). Gagal/batal: interface tetap, supaya retry mengarah ke perangkat yang sama.

### 1.7 Auto-select

`AutoSelect` hanya sisa di `Settings` (`FC.cs:476`) dan komentar. Konsep lama (banyak folder per merk, pilih otomatis menurut SN server) **sudah dihapus**: sekarang satu `Folder` per merk dan pemilihan merk di `folderBox` murni manual. Pengganti kecil: `resolvedSshKey` dipilih otomatis dari SN server (`GetRouterResult`, `CL.cs:976-990`): `Config.SshKeys[infoRouter.SerialNumber]`, kosong bila tak ada.

### 1.8 Hal lain di halaman

- Reset (`StopAndReset`, `:113-122`; `ResetCondition`, `:672-700`): hentikan kedua pinger, kosongkan combo, `AutoInject=false`, bersihkan info, `moreBtn` disembunyikan.
- `AutoInjectCB_Click` (`:701-710`): konfirmasi hanya saat MENYALAKAN ("Harap berhati-hati saat menggunakan \"Auto Inject\". Pastikan kembali tipe dan firmware cocok dengan perangkat yang akan di Country Lock. Yakin untuk lanjut?"); mematikan tanpa konfirmasi.
- Terminal manual (`:908-921`): menjalankan `PathFile\putty.exe -ssh admin@<Config.Server>` (username HARDCODE `admin`, bukan `ServerUsername`). Di luar lingkup refactor kiro (Req 6.2).
- `MoreBtn_Click` -> `ConfigEditorForm.Show(Merk, Config, FileName, isMultiMode:false, onSaved: () => GetFolder(FileName))` (`:1138-1141`).
- Prasyarat lokasi (`LocationGroup`, `CL.cs:203, 1049`): pengguna dengan `Location.Id < 0` wajib memilih lokasi sebelum inject. Ini bergantung pada model pengguna MySQL dan dibuang/diganti saat rebuild.

---

## 2. Perintah SSH persis per merk

Semua koneksi SSH: SSH.NET `SshClient(host, user, pass)`, host key SELALU dipercaya (`HostKeyReceived => CanTrust = true`), tanpa pengecekan host-key. Timeout: pinger 2 s (`CLC.cs:39`), info/DHCP/bridge 5 s (`:203, 257, 306`), inject 10 s (`SIS.cs:42`). Keepalive: pinger 20 s, info 60 s.

### 2.1 Tabel perintah

| Tujuan | Mikrotik (RouterOS) | Ubiquiti (airOS, BusyBox) |
|---|---|---|
| Serial cepat (`Pinger`, tiap ping sukses; `CLC.cs:123-128`) | `:put [/system routerboard get serial-number]` | `cat /proc/ubnthal/board.info \| grep board.hwaddr` |
| Info penuh (`InfoDevice.AsyncGet`, `CLC.cs:567-634`) | `/system routerboard print` | `cat /proc/ubnthal/board.info` |
| Negara | `:put [/interface wireless get wlan1]` | `cat /tmp/system.cfg \| grep countrycode` |
| Dipakai untuk jump-router (selalu Mikrotik, lihat 8.1) | `/system routerboard print` (serial + model) | tidak berlaku |

Ada empat salinan hampir identik logika info: `InfoDevice.GetInfo` (statis, `:308-384`), `Get` (BackgroundWorker, `:466-565`), `AsyncGet` (`:567-634`, yang dipakai halaman), plus `GetMikrotikFromServer/Device` (`:637-763`, tak terpakai). Rebuild cukup satu implementasi mengikuti `AsyncGet`.

### 2.2 Parsing keluaran

Helper `Getbetween(text, awal, akhir)` (`Helper.cs:410-424`): ambil teks setelah `awal`, sampai kemunculan pertama `akhir`, di-`Trim`; bila `akhir` tak ada, kembalikan sisa teks; bila `awal` tak ada, kembalikan string kosong. `MyTrim` (`Helper.cs:552-562`): Trim lalu kerutkan spasi berurutan menjadi satu.

**Mikrotik** (`AsyncGet`):
- Serial: keluaran `/system routerboard print` diganti `\t\n\r` -> spasi, `MyTrim`; `Getbetween("serial-number: ", " ")` lalu `ToUpper`. (Pinger tidak meng-uppercase, hanya membuang `\t\n\r`.)
- Model: `Getbetween("model: ", " ")` (terpotong di spasi pertama, tidak di-upper).
- Negara: keluaran `:put [/interface wireless get wlan1]`; buang `\t\n\r` DAN semua spasi; `Getbetween("country=", ";")`. Perangkat tanpa `wlan1` menghasilkan Country kosong.

**Ubiquiti**:
- Serial: `Getbetween("board.hwaddr=", "\n")` -> `ToUpper` -> buang `\t\n\r`. Pinger: hapus awalan `board.hwaddr=` dari hasil `grep`, buang `\t\n\r`.
- Model: bila tidak ada `board.model=`, pakai `board.name=`; ganti `-` menjadi spasi; buang `\t\n\r`.
- Negara: `Getbetween("countrycode=", "\n")` -> `Convert.ToInt32` -> cari di `Global.CountryListUBNT` (di bawah), tak ada -> `"Unknown"`. Bila teks bukan angka atau kosong, `Convert.ToInt32` melempar `FormatException`; di `AsyncGet` pengecualian itu ditelan (hanya pesan mengandung "Permission denied"/"username" yang menjadi `Error`), jadi Serial dan Model sudah terisi tetapi Country kosong (bukan "Unknown").

**Klasifikasi galat** (`CLC.cs:524-528, 557-561, 595-599, 625-629`, `SIS.cs:109-112`, `CLC.cs:182-186`): pengecualian dengan pesan mengandung `Permission denied` ATAU `username` (tak peka huruf) -> `Error = "Permission denied!!!"` (tepat tiga tanda seru). Galat lain (timeout, tak terjangkau) -> `Error` kosong dan hasil kosong; pemanggil memperlakukannya sebagai "info tidak tersedia", bukan galat kredensial.

### 2.3 Peta kode negara Ubiquiti (`Global.CountryListUBNT`, `Global.cs:289-`)

Kode = nomor ISO 3166-1 numerik (kecuali 511). Nilai tepat dari kode (tanpa 0):

32 Argentina; 51 Armenia; 533 Aruba; 36 Australia; 40 Austria; 31 Azerbaijan; 48 Bahrain; 52 Barbados; 112 Belarus; 56 Belgium; 84 Belize; 68 Bolivia; 70 Bosnia and Herzegovina; 76 Brazil; 96 Brunei Darussalam; 100 Bulgaria; 116 Cambodia; 124 Canada; 152 Chile; 156 China; 170 Colombia; 511 Compliance Test; 188 Costa Rica; 191 Croatia; 196 Cyprus; 203 Czech Republic; 208 Denmark; 214 Dominican Republic; 218 Ecuador; 818 Egypt; 222 El Salvador; 233 Estonia; 246 Finland; 250 France; 268 Georgia; 276 Germany; 300 Greece; 304 Greenland; 308 Grenada; 316 Guam; 320 Guatemala; 332 Haiti; 340 Honduras; 344 Hong Kong; 348 Hungary; 352 Iceland; 356 India; **360 Indonesia**; 368 Iraq; 372 Ireland; 376 Israel; 380 Italy; 388 Jamaica; 400 Jordan; 404 Kenya; 410 Korea Republic; 414 Kuwait; 428 Latvia; 422 Lebanon; 438 Liechtenstein; 440 Lithuania; 442 Luxembourg; 446 Macau; 807 Macedonia; 458 Malaysia; 470 Malta; 484 Mexico; 492 Monaco; 504 Morocco; 524 Nepal; 528 Netherlands; 530 Netherlands Antilles; 554 New Zealand; 566 Nigeria; 578 Norway; 512 Oman; 586 Pakistan; 591 Panama; 598 Papua New Guinea; 604 Peru; 608 Philippines; 616 Poland; 620 Portugal; 630 Puerto Rico (U.S. territory); 634 Qatar; 642 Romania; 643 Russia; 646 Rwanda; 652 Saint Barthelemy; 682 Saudi Arabia; 891 Serbia and Montenegro; 702 Singapore; 703 Slovakia; 705 Slovenia; 710 South Africa; 724 Spain; 144 Sri Lanka; 752 Sweden; 756 Switzerland; 158 Taiwan; 764 Thailand; 780 Trinidad and Tobago; 788 Tunisia; 792 Turkey; 804 Ukraine; 784 United Arab Emirates; 826 United Kingdom; 840 United States; 858 Uruguay; 860 Uzbekistan; 862 Venezuela; 704 Viet Nam.

Mikrotik tidak memakai peta: nilai `country=` mentah dari RouterOS (mis. `indonesia`, `no_country_set`) ditampilkan apa adanya setelah spasi dibuang.

### 2.4 "Kunci ke Indonesia" di tiap merk

**Tidak ada kode di aplikasi yang menulis negara.** Aplikasi hanya (a) MEMBACA negara untuk ditampilkan (2.2) dan (b) MENGIRIM SKRIP yang berada di disk. Kunci negara itu sendiri terjadi di dalam skrip dan berkas pendampingnya, yang tidak ada di repo (lihat 9).

Asal skrip: zip dari Google Drive, diunduh lewat Firebase node `Script` (kunci `V<n>`, nilai `{FileId, Url}`; `CL.cs:795-824, 1427-1511, 1555-1558`). Versi lokal = field `version` di `.QC`; bila `< n` terbesar di Firebase, tombol "Update" muncul. Zip diekstrak ke folder `.QC` (`config.qc` + folder per merk). Jalur skrip saat inject = `<folder .QC>\<mikrotik|ubiquiti folder>\<file firmware>`.

Dari spek kiro (`requirements.md` baris 18-46, contoh nyata `mikrotik-2 - Copy.txt` dan `WA.txt`):

- **Mikrotik**: skrip dijalankan DI SERVER (jump-host Mikrotik), yang meng-`ssh-exec` ke target dan meng-`/tool fetch mode=ftp upload=yes` berkas dari folder lokal server ke target: `/system ssh-exec address=<target> user=admin command="/ip arp remove [find]"`, dua `/tool fetch ... src-path=/temp/customblock-2.npk dst-path=/customblock.npk` dan `src-path=/temp/script.rsc dst-path=/script.rsc`, lalu `/system ssh-exec ... command="/import script.rsc"`, `... "/file remove script.rsc"`, `... "/system script run reboot"`, ditutup `ip arp remove`. Indikasi kuat (tidak dikonfirmasi eksplisit di repo): `customblock-*.npk` adalah paket RouterOS kustom yang mengunci region dan `script.rsc` menyetel negara; reboot memberlakukannya. Karena itu config Mikrotik umumnya memakai `connectVia = Server`.
- **Ubiquiti**: dijalankan LANGSUNG di perangkat (`connectVia = Target`, bawaan). Contoh `WA.txt`: buat `/var/etc/persistent/.ssh/known_hosts`, `echo <server-key> >> known_hosts` (kini placeholder `{sshKey}`), `scp admin@<server>:/temp/WA.bin /tmp/fwupdate.bin`, `scp admin@<server>:/temp/system.cfg /tmp/`, `cfgmtd -w -p /tmp/ && /sbin/fwupdate -m`. Indikasi kuat: `system.cfg` menyimpan `countrycode=360` dan `WA.bin` adalah firmware yang sudah disiapkan; `fwupdate -m` memflash lalu perangkat reboot (inilah sebab koneksi putus pada bagian 3).

### 2.5 `ScriptTemplate` (`General/ScriptTemplate.cs`)

`Render(rawScript, values)`: bila `rawScript` null/kosong kembalikan apa adanya; selain itu `string.Replace` literal berurutan (tanpa regex, tanpa escape, semua kemunculan, peka huruf besar/kecil) atas 7 kunci:

| Placeholder | Sumber (mode tunggal, `CL.cs:1330-1338`) | Sumber (Multi, `CLM.cs:814-822`) |
|---|---|---|
| `{ipTarget}` | `Config.Target` | `device.IpAddress` |
| `{usernameTarget}` | `credentialForm.Username` | `device.Username` |
| `{passwordTarget}` | `credentialForm.Password` | `device.Password` |
| `{ipServer}` | `Config.IpServer` (bukan `Config.Server`) | `Config.IpServer` |
| `{usernameServer}` | `Config.ServerUsername` | `Config.ServerUsername` |
| `{passwordServer}` | `Config.ServerPassword` | `Config.ServerPassword` |
| `{sshKey}` | `resolvedSshKey` | `resolvedSshKey` |

Nilai null menjadi string kosong; placeholder tak dikenal dibiarkan literal; skrip tanpa placeholder dikirim tak berubah (kompatibilitas mundur, kiro Req 2.3). Nilai disisipkan mentah: sandi berisi tanda kutip, `$`, atau `"` merusak skrip tanpa peringatan.

Catatan: `{ipServer}` (alamat router seperti terlihat DARI perangkat, bisa beda karena NAT) sengaja dipisah dari `Config.Server` (alamat SSH PC ke router) (`FC.cs:226-231`, tooltip editor).

---

## 3. Eksekusi inject: `SshInjectSession` (`SIS.cs`)

### 3.1 Tahap dan urutan

`Run(host, user, pass, scriptText, onProgress, cancellationToken)` -> `bool`. Tahap (`InjectStage`): `Connecting`, `Sending`, `Running`, `Completed`, `Failed`, `Cancelled`.

1. `Connecting` ("Menghubungkan ke <host>..."). `SshClient`, `Timeout=10 s`, host key dipercaya, `Connect()`.
2. Cek pembatalan; `Sending` ("Mengirim script...").
3. `client.CreateShellStream("qc-inject", 200, 50, 800, 600, 8192)`: pseudo-terminal 200 kolom x 50 baris, buffer 8192.
4. `scriptText` dinormalisasi `\r\n -> \n`, dipecah per baris. Baris kosong/spasi dilewati. Untuk SETIAP baris:
   - buat sentinel unik `__QC_INJECT_<8 hex acak>__`;
   - `shell.WriteLine(baris)` lalu `shell.WriteLine("echo <sentinel>")`;
   - `WaitForSentinelTwice(...)` blok sampai sentinel muncul DUA kali; baru lanjut ke baris berikutnya.
5. Semua baris selesai -> `Completed` "Selesai." -> `true`.

### 3.2 Sentinel dua kali (`SIS.cs:127-187`)

Pty meng-echo ketikan sebelum perintah dieksekusi. Maka kemunculan 1 = echo ketikan `echo <sentinel>` (segera), kemunculan 2 = keluaran eksekusi `echo` sungguhan (menandakan baris sebelumnya tuntas). Mengirim semua baris sekaligus membuat sentinel terakhir muncul jauh sebelum `scp`/`fwupdate` selesai ("Selesai" palsu), makanya dikirim satu per satu.

Pembacaan: polling `shell.DataAvailable` tiap 100 ms; byte dibaca `(char)buffer[i]`, baris dipotong pada `\n` atau `\r`; baris yang mengandung sentinel menaikkan `sentinelHits` dan TIDAK diteruskan; baris lain diteruskan sebagai log `Running`. Baris yang belum berakhir newline tetapi sudah memuat sentinel (prompt tanpa newline) juga dihitung (`:168-172`). Tidak ada penghapusan escape ANSI dan tidak ada dekode UTF-8.

### 3.3 Timeout

- Per baris `PerLineTimeout = 2 menit` (`:44`); total `OverallTimeout = 5 menit` dihitung SEKALI sebelum loop baris (`:67`); batas efektif per baris = yang lebih awal. Habis -> `Failed` "Gagal: timeout menunggu penyelesaian baris script." -> `false`. Skrip yang total > 5 menit pasti gagal.
- `ConnectTimeout = 10 s`, `IdleReadInterval = 100 ms`.

### 3.4 Pembatalan

`CancellationToken` diperiksa sebelum tiap baris dan tiap iterasi baca. `OperationCanceledException` -> `Cancelled` "Dibatalkan." -> `false`. Token SENGAJA tidak diteruskan ke `Task.Run` (`:117-124`): bila diteruskan, `OperationCanceledException` bisa lolos dari `async void StartPutty` dan menutup seluruh aplikasi (tak ada handler global). Tidak ada rollback perangkat; perintah jarak jauh yang sedang jalan bisa terputus di tengah (risiko yang diterima di kiro design).

### 3.5 Reboot / koneksi terputus (`SIS.cs:93-106`)

`ObjectDisposedException` atau `SshConnectionException` saat membaca: bila SUDAH ada byte keluaran apa pun (`receivedAnyOutput`) -> `Completed` "Selesai (koneksi terputus - kemungkinan perangkat reboot)." dan `true`; bila belum ada output sama sekali -> `Failed` dengan `ex.Message`. Sebab: perintah di skrip (`reboot`, `fwupdate -m`) memutus sesi. `receivedAnyOutput` terisi oleh echo sekalipun, jadi putus segera setelah baris pertama ditulis pun dianggap sukses.

Galat lain: pesan mengandung "Permission denied"/"username" menjadi `"Permission denied!!!"`; selain itu pesan asli. Hasil `false`.

### 3.6 Pelajaran perangkat nyata (komentar kode `SIS.cs:23-40` + kiro)

1. **`CreateCommand()` (exec-channel) GAGAL mempertahankan state antar baris** pada Mikrotik (device-mode memblokir `:import`) maupun Ubiquiti (BusyBox/dropbear: file yang dibuat baris sebelumnya tak terlihat baris berikutnya). Diuji pada perangkat nyata; karena itu dipakai `ShellStream` seperti `plink -m` dahulu. `design.md` kiro (CreateCommand + `OutputStream`) sudah usang.
2. Pty mengecho: karena itu satu baris per kiriman + sentinel dua kali, bukan blok sekaligus.
3. Kiro design memperingatkan RouterOS SSH tidak mendukung pseudo-tty/multiline via exec; direkomendasikan `ssh-exec`. Task 5 kiro (`[VALIDASI HARDWARE]` Mikrotik) tidak dicentang di `tasks.md` (belum ada catatan hasil). Komentar `SIS.cs` mengklaim diuji pada Mikrotik; lihat ketidakpastian 9.
4. Koneksi putus saat reboot/fwupdate = sukses (3.5).
5. Token pembatalan tidak boleh masuk `Task.Run` (3.4).
6. Eksekusi inject mengikuti pola yang sama untuk kedua merk; perbedaan hanya di target koneksi dan skrip (kiro design, "brand-agnostic"). Tidak ada cabang `if (merk)` di `SIS.cs`.
7. `plink.exe` dipertahankan di `Resources/` tetapi tidak dipakai inject; terminal manual memakai `putty.exe` terpisah (keputusan final kiro #1).

### 3.7 UI progres (`PopUp/InjectProgress`)

`InjectProgressForm.xaml.cs`: judul tahap (`StageText`), `ProgressBar` indeterminate, `LogBox` (Consolas, baca-saja, auto-scroll), tombol `ActionBtn` "Cancel" (merah) saat berjalan -> `Cts.Cancel()`, berubah menjadi "Close" (abu) saat selesai. `ReportProgress` dipanggil dari thread latar dan di-marshal lewat `Dispatcher.BeginInvoke`. Teks tahap: "Menghubungkan...", "Menjalankan..." (tahap `Sending` tidak mengubah teks), "Selesai.", "Gagal.", "Dibatalkan.". `Finish`: bar 100% hijau (sukses) atau merah; **auto-tutup 1 detik untuk `Completed`/`Cancelled`; `Failed` dibiarkan terbuka** agar pesan galat terbaca. Lebar dialog = max(420, 0,8 x lebar jendela).

---

## 4. Mode Multi-Device (`CLM.cs`, `CountryLockMulti.xaml`)

### 4.1 Perbedaan dengan mode tunggal

| Aspek | Tunggal (`CL.cs`) | Multi (`CLM.cs`) |
|---|---|---|
| Merk | Mikrotik atau Ubiquiti | HANYA Ubiquiti (`ListMerk`, `CLM.cs:59`) |
| Perangkat | satu, `Config.Target` tetap dari `.QC` | banyak, alamat dinamis dari DHCP lease; `Config.Target` tak pernah dibaca (`FC.cs:86-94`) |
| Pergantian perangkat | rotasi 1 interface bridge (`CurrentIndex`) | semua interface dimasukkan ke SATU bridge sekaligus (`BridgePortSetup`) |
| Ping | 2 `Pinger` (device+router) | 1 `Pinger` untuk server + loop ping independen per perangkat |
| Kredensial | satu `credentialForm`, prompt manual (mode Normal) atau antrian OCR | default dari config per merk; antrian OCR dicoba per perangkat |
| Inject | satu, form progres modal | paralel hingga N, progres + log per baris tabel |
| Catat data pending | SEBELUM inject | SESUDAH inject sukses |
| `ConnectVia` | dipakai (`ResolveConnectTarget`) | DIABAIKAN: inject selalu ke `device.IpAddress` (`CLM.cs:825`) |
| Browser | panel tetap | overlay satu perangkat per waktu, `BuildDeviceUrl` |
| Rotasi kamera OCR | ada (`CL.cs:454-460, 309-338`) | tidak ada (spek 2026-07-24 butir 8 tak pernah diterapkan) |
| Lokasi | wajib bagi pengguna `Location.Id=-1` | `IdLocation = Location.Id>=0 ? Id : 0` (`CLM.cs:868`) |

### 4.2 Alur startup Multi

- `LoadConfigFile` (`:199-221`): `ConfigFile.Read(file, isMultiMode:true)`; gagal -> dialog "Tidak dapat membaca file config!". Simpan jalur ke Settings (jalur `.QC` dibagi dengan mode tunggal). Dimuat otomatis sekali pada `UserControl_Loaded` (`:170-174`), tertunda dari konstruktor karena `ListTipe.Instanse` baru ada setelah semua halaman dibuat.
- `ApplyMerk` (`:237-266`): isi firmware; `pingServerWorker.IPAddress = Config.Server` dan start; `ReloadServerInfo()`; **`pollTimer.Start()` hanya setelah config valid** (supaya `IsSessionActive` tidak true palsu); `UpdateListTipe`; `await BridgePortSetup.EnsureAllPorts(...)`.
- `BridgePortSetup.EnsureAllPorts` (`CLC.cs:256-298`, hanya bila `InterfaceBridge` tak kosong) lewat SSH ke router:
  1. `/interface bridge port remove [find interface!=<InterfaceComp>]`
  2. untuk setiap interface di `Interfaces`: `/interface bridge port add bridge=<InterfaceBridge> interface=<iface>` (RouterOS menolak bila sudah ada: idempoten alami; galat diabaikan).
  Semua galat ditelan (best-effort).
- `InterfaceBridge` untuk Multi diturunkan lewat `ReadModeField` (`FC.cs:20-30`): `mode.multi.interfaceBridge` bila terisi, selain itu `mode.single.interfaceBridge`; bila keduanya kosong, `server.interfaceBridge`, lalu `"bridge1"` (`FC.cs:108-109`).
- Peringatan bentrok antar-mode: `IsSessionActive` pada kedua kelas + `StopAndReset()` publik (`CLM.cs:284-311`, `CL.cs:113-122`) dipakai dialog "lanjut atau tidak" yang dibuat di `MainWindow` (tidak dibaca; tidak ditemukan di berkas yang diminta).

### 4.3 Penemuan perangkat (scan) dan antrian

- `pollTimer` (`CLM.cs:127-128`) memanggil `ScanLeases()` dengan penjaga `isScanning`. Interval adaptif (`AdjustScanInterval`, `:534-544`): tak ada perangkat 1 s; ada perangkat tetapi tak ada yang `Injecting` 3 s; ada yang `Injecting` 5 s.
- `DhcpLeaseReader.Read` (`CLC.cs:213-248`): satu perintah RouterOS pada router, `/ip dhcp-server lease print terse proplist=address,mac-address,status where status=bound`. Baris contoh: `0 D address=192.168.88.1 mac-address=58:D6:1F:0E:4E:FE status=bound`. Parsing: baris yang memuat `address=`; `ip = Getbetween("address=", " ")`, `mac = Getbetween("mac-address=", " ")`, `status = Getbetween("status=", "\n")` (status di akhir baris, tanpa spasi penutup). Baris tanpa IP dibuang. Galat apa pun -> daftar kosong (diam).
- Penyaringan (`CLM.cs:428-431`): buang entri tanpa MAC dan IP sama dengan `Config.ExcludeIp` (IP PC operator).
- Identitas perangkat = **MAC**, bukan IP (`:434-445`). MAC baru -> `DeviceSession` baru (`Status=Waiting`, kredensial default `Config.Username/Password`, `CredentialSource="Default"`, `LoopCts` baru) dan `DeviceLoop` dimulai. MAC sama IP berbeda -> hanya IP diperbarui; bila status `Disconnected` atau (IP berubah dan bukan `Injecting`) status kembali `Waiting`, kredensial direset ke default, `NextCredentialIndex=0`.
- IP diambil alih MAC lain (`:487-496`): perangkat lama (bukan `Injecting`/`Disconnected`) menjadi `Disconnected` "Terputus (IP diambil alih perangkat lain)".
- MAC hilang dari scan (`:503-521`): `Disconnected` "Terputus" (kecuali sedang `Injecting`); dibuang dari daftar (loop dibatalkan) setelah `DeviceRemovalGracePeriod = 1 menit` tak terlihat (`LastSeenAt`).
- Tombol scan manual `ScanBtn_Click` (`:390-403`): `ScanLeases(showEmptyWarning:true)` + `ReloadServerInfo()` paralel (`Task.WhenAll`); bila nol lease muncul dialog "Tidak ada DHCP lease terbaca dari server ...".

### 4.4 Loop per perangkat (`DeviceLoop`, `:571-615`)

Berjalan terus sampai `LoopCts` dibatalkan, tidak bergantung `pollTimer`:
- Bila status `Pinging/FetchingInfo/Queued/Injecting`: tunggu 500 ms dan cek lagi (loop tidak ikut campur).
- Selain itu `PingOnce(ip)` (ICMP 1000 ms). Gagal: status stabil (`ReadyToInject/Success/Failed`) turun ke `Waiting` "Tidak merespon ping" (`CanInject=false`), tunda 500 ms (`DeviceLoopFastInterval`). `device.IsPingable` terpisah dari `Status` (titik hijau/merah tabel).
- Sukses & `Success`: `RefreshDeviceInfo` (baca info tanpa mengubah status; tidak pernah inject ulang), tunda 800 ms (`DeviceLoopStableInterval`).
- Sukses & `ReadyToInject`/`Failed`: tidak ada aksi, tunda 800 ms.
- Sukses & `Waiting`: `ProcessDevice`, tunda 500 ms.

`ProcessDevice` (`:636-696`): `Pinging` -> `FetchingInfo` (`InfoDevice.AsyncGet(MerkTipe.Ubiquiti, ip, device.Username, device.Password)`) -> bila `Error` (Permission denied): ambil kredensial berikutnya dari `queues[NextCredentialIndex]`, naikkan indeks, set `CredentialSource="Antrian #N"` dan REKURSI; antrian habis -> `Waiting` dengan pesan `info.Error` ("Permission denied!!!"). Sukses: isi `Model` ("Unknown" bila kosong), `SerialNumber`, `Country`; info tak lengkap (serial atau model kosong) -> `Waiting` "Info perangkat tidak lengkap"; selain itu `AlreadyRegistered = serial ada di FileMac.PendingListMac`, status `ReadyToInject` ("Siap inject (SN sudah terdaftar)" atau "Siap inject"), `CanInject=true`, dan **auto-inject** bila `AutoInjectCB` dicentang DAN `!AlreadyRegistered` (`:694-695`).

Status (`DeviceSessionStatus`, `DeviceSession.cs:7-17`): `Waiting, Pinging, FetchingInfo, ReadyToInject, Queued, Injecting, Success, Failed, Disconnected`. Label: Menunggu, Ping..., Cek Info..., Siap, Antri, Inject..., Selesai, Gagal, Terputus. Tombol aksi baris dua fungsi: "Inject"/"Retry" (hijau) atau "Cancel" (merah) saat `Queued/Injecting`.

### 4.5 Antrian inject dan paralelisme

- `QueueInject` (`:742-779`): abaikan bila sudah `Injecting/Queued`; bila `queueStopped` -> pesan "Antrian sedang dihentikan operator"; bila `Config==null` atau firmware belum dipilih -> "Tipe/Firmware belum dipilih" (perhatikan: Tipe tidak benar-benar disyaratkan, hanya firmware). Selain itu status `Queued`, `Cts = new CancellationTokenSource()`, `await injectGate.WaitAsync(Cts.Token)`. Dibatalkan saat menunggu slot -> kembali `ReadyToInject` "Dibatalkan (masih antri)".
- `injectGate = SemaphoreSlim(4,4)` bawaan; kotak `Concurrent` hanya digit, dijepit 1..32 saat kehilangan fokus (`:942-959`), mengganti instance semafor.
- `InjectDevice` (`:781-857`): `Injecting`, log penanda `=== Mulai inject (ip) ===`; validasi indeks firmware dan folder; jalur skrip `dirname(PathFileCL)\<Folder>\<FirmwareFile[i]>`; baca skrip ("File script tidak ditemukan" -> `Failed`); render placeholder (tabel 2.5); `SshInjectSession.Run(device.IpAddress, device.Username, device.Password, ...)`; tiap `Message` progres -> `StatusMessage` + `AppendLog` berstempel jam.
- Hasil: dibatalkan (`Cts` batal) -> `Failed` "Dibatalkan" + log "=== Dibatalkan oleh operator ==="; sukses -> `RecordPendingData` lalu `Success` "Selesai" (`CanInject=false`); gagal -> `Failed`, `CanInject=true` (pesan terakhir tetap pesan galat dari sesi).
- Aksi massal: `Inject All` (menyapu perangkat `ReadyToInject` satu kali; menjalankan `queueStopped=false`), `Stop Antrian` (`queueStopped=true`, batalkan yang `Queued`, yang `Injecting` dibiarkan selesai), `Cancel All` (`queueStopped=true`, batalkan `Queued` dan `Injecting`). `queueStopped` baru dicabut oleh `Inject All` atau menyalakan Auto Inject (tak ada tombol "resume").
- `RecordPendingData` dilindungi `PendingDataGate = SemaphoreSlim(1,1)` karena `FileMac.PendingListMac` statik tanpa kunci (`:864-881`). Tipe yang dicatat = pilihan `tipeBox` atau `device.Model`; Merk = Ubiquiti.
- Inject manual untuk SN yang `AlreadyRegistered` tetap diizinkan dengan toast peringatan (`:725-726, 915-916`); Auto Inject melewatinya.
- Ringkasan: lencana klik-untuk-filter (Menunggu = Waiting+Pinging+FetchingInfo+ReadyToInject, Antri, Inject, Selesai, Gagal), teks "N perangkat (M aktif)" (`:968-984`).

### 4.6 Kredensial manual di Multi

Tidak ada form prompt. Kredensial manual dimasukkan lewat tombol hijau `+` di panel Antrian (`AddQueueBtn_Click`, `:1046-1054` -> `CredentialForm.Show(newItem, ...)` mode "Save"), tanpa duplikat (cocok username+password). Selain itu: kredensial OCR (bagian 5). Satu `queues` dibagi semua perangkat; tiap perangkat mencoba mulai dari `NextCredentialIndex` miliknya.

### 4.7 Field konfigurasi khusus Multi

- Di `.QC`: `<merk>.mode.multi.{ipServer, connectVia, interfaceBridge}` (dengan fallback ke `mode.single`), `server.{interfaceList, interfaceBridge, interfaceComp}`. `mode.multi.ip` tidak pernah dibaca atau ditulis.
- Di UI: `Concurrent` (default 4), `Exclude IP` (editor, lihat peringatan: tidak tersimpan), `Server Interface Bridge` (`server.interfaceBridge`), `InterfaceList`.
- `Config.Web`: di Multi dipakai hanya untuk menentukan skema URL browser per perangkat (lihat 9).

---

## 5. OCR kredensial dari stiker (kedua mode)

### 5.1 Sumber, siklus, pustaka

- **Kamera**: AForge.NET `FilterInfoCollection(FilterCategory.VideoInputDevice)` (DirectShow, `CL.cs:275-285`, `CLM.cs:1140-1148`); perangkat pertama dipilih otomatis; tidak ada kamera -> dialog "No video sources found" / "Tidak ada perangkat kamera ditemukan". `VideoCaptureDevice(MonikerString)`; `Start()`/`SignalToStop()`. Mengganti sumber menghentikan kamera (`CurrentSource` setter). Tombol Start, Stop, serta (tunggal) putar kiri/kanan 90 derajat (`angle -= 90` / `+= 90`, `CL.cs:454-460`).
- **Siklus frame**: `Video_NewFrame` (`CL.cs:309-357`): `isProccess` mencegah pemrosesan bertumpuk (frame lain dibuang saat sibuk). Klon bitmap; bila `angle != 0` gambar ulang dengan `TranslateTransform/RotateTransform` (GDI+); tampilkan di `Image`; jalankan OCR; kirim hasil teks ke UI thread -> `AddToRecomendation`. Galat -> dialog dan `StopCamera`.
- **OCR**: paket `TesseractOCR` (BUKAN `Tesseract.Net.SDK`); `Engine("./tessdata", Language.English, EngineMode.Default)` dibuat BARU untuk SETIAP frame, bitmap disimpan JPEG ke memori, `engine.Process(img).Text` (`CL.cs:415-435`). Data bahasa: `tessdata/eng.traineddata` (+ `osd`, `equ` di repo). Kode lama `Patagames.Ocr` ada sebagai komentar.
- Panel OCR hanya tampil bila `OcrCB` dicentang; di mode tunggal menggantikan browser (`Mode`), di Multi panel terpisah 620 px dengan splitter dan kamera/daftar perangkat baru diinisialisasi saat pertama dinyalakan (`CLM.cs:1119-1138`).

### 5.2 Pola `{key}` (pola Username dan Password, `CL.cs:366-413`, `CLM.cs:1220-1262`)

Dua kotak teks bebas, kosong secara bawaan: `usernameBox`, `passwordBox`. Algoritma untuk masing-masing:
1. Cari placeholder pertama dengan regex `\{[\w]+\}` (opsi IgnoreCase, IgnorePatternWhitespace, Singleline).
2. Bila ada: `key` = nama tanpa kurung. Regex pencarian pada teks OCR: `key:\s+(?<key>[\w]+)` (IgnoreCase, Singleline). Placeholder diganti dengan nilai tertangkap (kosong bila tak cocok). Teks di luar `{...}` tetap literal, sehingga pola `admin` (tanpa placeholder) = username literal.
3. Gerbang: abaikan (dan jalankan `_timerOCR`) bila (username dan password sama-sama kosong/spasi) ATAU (pola username tak punya placeholder DAN password kosong). Nilai tertangkap hanya `\w+` (huruf/angka/underscore; sandi berisi simbol terpotong).
4. `_timerOCR` (`System.Timers.Timer(5000)`): bila 5 detik berlalu tanpa kandidat sah, daftar Rekomendasi di-`Clear()`. Kandidat sah menghentikan timer.

### 5.3 Rekomendasi -> Antrian

- Kandidat sah dibandingkan dengan `recomendations` (username+password sama): `Count++`; bila **`Count > 5`** (kemunculan ke-7 sejak item dibuat dengan `Count=0`) -> tambahkan ke `queues` bila belum ada (cocok username+password), `IsDone=false` (tunggal) lalu `recomendations.Clear()`. Item baru: `new CredentialItem(username, password)`, `Count=0`.
- Manual: klik dua kali pada Rekomendasi (atau Enter/Spasi, tunggal) langsung menambah ke Antrian dan mengosongkan Rekomendasi (Multi: hanya menghapus item itu).
- Tombol "Clear" untuk Rekomendasi dan Antrian; tombol `+` hijau menambah kredensial manual; menu konteks Edit/Delete di Antrian (tunggal). Daftar Rekomendasi diurut `Count` menurun; Antrian diurut `IsDone` naik (tunggal).
- `CredentialItem` (`General/CredentialItem.cs`): `Username`, `Password`, `UsernameDraft`, `PasswordDraft`, `Count`, `IsDone`, `IsFailed`.

### 5.4 Mencoba kredensial berurutan lewat SSH

- **Tunggal**: `queues.CollectionChanged` memicu `ReloadInfo(true)` bila info selesai (`CL.cs:224-228`). `DeviceResult` pada galat kredensial mengikuti 1.4: `IsFailed` pada kredensial aktif, ambil kredensial pertama yang tak `IsFailed`, `CurrentCredential = ...` (menyalin ke `credentialForm` dan `pingDeviceWorker.ConfigDevice` lewat event `CredentialChanged`, `CL.cs:167-173, 493-500`), ulangi. Semua gagal -> reset semua `IsFailed` dan berhenti. Sukses -> `IsDone=true`. Klik dua kali item Antrian memilihnya sebagai kredensial aktif dan memuat ulang info.
- **Multi**: bagian 4.4/4.6. `AddToQueue` juga memicu ulang `ProcessDevice` untuk perangkat `Waiting` dengan `StatusMessage == "Permission denied!!!"` (`CLM.cs:1267-1274`).
- Prompt kredensial manual hanya di mode tunggal Normal (`CredentialForm.Show(Action<string,string>)`: judul "Connect To : <IP>", tombol Connect; Enter = Connect).

---

## 6. Skema `.QC` (JSON murni)

Format INI lama TIDAK lagi dibaca (`FC.cs:17-19`). Pembaca: `ConfigFile.Read` -> `ReadMerk` (`FC.cs:32-153`) dengan Newtonsoft `JObject`. Nama kunci peka huruf besar/kecil: `mikrotik`, `ubiquiti`, `server`, `version`, `mode`, `single`, `multi`.

### 6.1 Contoh JSON utuh (nilai ilustrasi; bentuk dan kunci faktual dari pembaca/penulis)

```json
{
  "version": 12,
  "server": {
    "ip": "192.168.88.2",
    "username": "admin",
    "password": "",
    "interfaceComp": "ether1",
    "interfaceList": ["ether1", "ether2", "ether3", "ether4", "ether5"],
    "interfaceBridge": "bridge1"
  },
  "mikrotik": {
    "merk": "Mikrotik",
    "folder": "mikrotik",
    "username": "admin",
    "password": "",
    "web": "http://{ip}/webfig/",
    "firmware": {
      "AC": { "label": "AC", "file": "mikrotik-AC.txt" }
    },
    "sshKeys": { "<SN server>": "<host-key>" },
    "mode": {
      "single": { "ip": "192.168.88.1", "ipServer": "192.168.88.2", "connectVia": "Server", "interfaceBridge": "bridge1" },
      "multi":  { "ipServer": "192.168.88.2", "connectVia": "Server", "interfaceBridge": "BridgeAll" }
    }
  },
  "ubiquiti": {
    "merk": "Ubiquiti",
    "folder": "ubiquiti",
    "username": "ubnt",
    "password": "ubnt",
    "web": "https://{ip}/",
    "firmware": {
      "WA": { "label": "WA", "file": "WA.txt" }
    },
    "sshKeys": { "<SN server>": "<host-key>" },
    "mode": {
      "single": { "ip": "192.168.1.20", "ipServer": "192.168.1.1", "connectVia": "Target", "interfaceBridge": "bridge1" },
      "multi":  { "ipServer": "192.168.1.1", "connectVia": "Target", "interfaceBridge": "BridgeAll" }
    }
  }
}
```

### 6.2 Tabel field

| Jalur JSON | Tipe | Bawaan bila hilang/kosong | Dibaca | Ditulis oleh `ConfigFile.Write` | Catatan |
|---|---|---|---|---|---|
| `version` | integer | 0 | ya (`ConfigFile.Version`) | tidak (dipertahankan) | dibandingkan dengan versi `Script` terbesar di Firebase |
| `server.ip` | string | "" (+1 galat) | ya -> `Config.Server` (alamat SSH PC ke router) | ya | wajib |
| `server.username`, `.password` | string | "" | ya | ya | kredensial router |
| `server.interfaceComp` | string | `"ether1"` | ya | ya | port PC operator, dikecualikan dari rotasi/bridge |
| `server.interfaceList` | array string | `"ether1,ether2,ether3,ether4,ether5"` (di model) | ya, digabung koma | ya (dari teks koma di editor, di-trim, kosong dibuang) | bentuk model: string dipisah koma |
| `server.interfaceBridge` | string | "" (nilai mentah); sebagai fallback "bridge1" | ya -> `ServerInterfaceBridge` | ya | bersama kedua merk |
| `<merk>.merk` | string | label bawaan "Mikrotik"/"Ubiquiti" | ya | ya | |
| `<merk>.folder` | string | "" (+1 galat) | ya | ya | subfolder skrip di sebelah `.QC` |
| `<merk>.username` | string | "" (+1 galat) | ya | ya | kredensial bawaan perangkat |
| `<merk>.password` | string | "" | ya | ya | |
| `<merk>.web` | string | "" (+1 galat) | ya | ya | boleh memuat `{ip}` (diganti `Config.Target` di tunggal) |
| `<merk>.firmware` | objek kode -> `{label, file}` | kosong (+1 galat) | ya (3 daftar sejajar: kode, label, file) | TIDAK (dipertahankan) | `label` bawaan = kode; `file` bawaan "" |
| `<merk>.sshKeys` | objek SN server -> host-key | kosong | ya | TIDAK (dipertahankan) | isi `{sshKey}` |
| `<merk>.mode.single.ip` | string | "" (+1 galat, hanya tunggal) | ya (hanya tunggal) | ya (hanya tunggal) | `Config.Target` |
| `<merk>.mode.<single\|multi>.ipServer` | string | `server.ip` | ya | ya | `{ipServer}`; selalu ditulis (lihat 8.6) |
| `<merk>.mode.<single\|multi>.connectVia` | `"Target"`\|`"Server"` (tak peka huruf) | `Target` | ya | ya | diabaikan di Multi |
| `<merk>.mode.<single\|multi>.interfaceBridge` | string | `server.interfaceBridge` lalu `"bridge1"` | ya | ya | |
| (tidak ada di JSON) `ExcludeIp` | - | "" | TIDAK | TIDAK | lihat 8.6 |

Aturan baca `mode` (`ReadModeField`, `FC.cs:20-30`): bila `mode` tak ada, semua field mode "" . Mode Multi: `mode.multi.<f>` bila tak kosong, selain itu `mode.single.<f>`. Mode tunggal: hanya `mode.single.<f>`.

`ErrorCount` bertambah untuk: node merk tak ada; `folder`, `username`, `web` kosong; `firmware` kosong; `server.ip` kosong; `mode.single.ip` kosong (tunggal, per merk). Hitungan GANDA (per merk) karena kedua node merk selalu diurai; **node `mikrotik` yang hilang menggagalkan pemuatan di Multi walau Multi hanya memakai Ubiquiti**. Pengecualian pada parse -> `ErrorCount++` dan `ListConfig` tetap diisi `ConfigCL` kosong. `ErrorCount > 0` berarti "tidak dapat dimuat".

### 6.3 `ConfigFile.Write` (`FC.cs:167-216`)

Merge, bukan regenerasi: baca ulang berkas sebagai `JObject`, timpa hanya node relevan, simpan `root.ToString()` (Indented) lewat `File.WriteAllText`. Menulis: `<merk>.{merk, folder, username, password, web}`; `<merk>.mode.{single|multi}.{ip (hanya tunggal), ipServer, connectVia, interfaceBridge}` (sub-objek mode lawan tidak tersentuh); `server.{ip, username, password, interfaceComp, interfaceList(array), interfaceBridge}`. Kunci tak dikenal, `firmware`, `sshKeys`, `version`, urutan kunci, dan node merk lain dipertahankan. Node yang belum ada dibuat. `merk` bukan Mikrotik/Ubiquiti -> `false`. Pengecualian -> `false`. Editor lalu memanggil `onSaved` yang memuat ulang config dari disk.

### 6.4 Editor config (`PopUp/ConfigEditor`)

Dua kelompok: "Device Configuration" (IP Address, Ip Server [tooltip: nilai placeholder `{ipServer}`, kosong = IP router], Username, Password, Web Url, Interface Bridge [tooltip: rotasi mode Single], Connect Via [Target/Server]) dan "Router Server Configuration" (IP Address, Username, Password, Interface Comp, Interface List, Interface Bridge [tooltip: `server.interfaceBridge`, filter ARP Multi, mis. BridgeAll], Exclude IP [tooltip: IP PC operator, dikecualikan dari scan Multi]). Tombol Cancel (merah), Apply (hijau). Lebar maksimum 0,8 x jendela.

---

## 7. Data hasil yang disimpan lokal (daftar pending)

- **Model**: `MacAddress` ber-atribut `[Serializable]` (`DB.cs:1787-2046`), daftar `List<MacAddress>` di `FileMac.PendingListMac` (`FC.cs:271-404`). Field yang bermakna untuk Country Lock: `Date` (hari ini, tanpa jam), `Merk` (enum `MerkTipe`: All -1, None 0, Ubiquiti 1, Mikrotik 2, Voltech 3, Alta 4, VSOL 5; di mode tunggal merk diambil dari `TipeItem.Merk` bila tipe terpilih, selain itu `None`), `Tipe` (nama tipe atau kosong), `Mac` (serial/MAC, SELALU huruf besar via setter), `Sample` (false), `Note` (""), `IdLocation`, `Username` (`Global.User.Username`), `Timestamp` (`DateTime.Now`). Sisanya (`Index`, `Checklist`, `Id`, `IdTipe`, `No`, `Action`, kolom status UI) ikut terserialisasi tetapi tidak relevan.
- **Kapan ditambahkan**: tunggal, SEBELUM inject (auto: di `PingDeviceChanged`/`DeviceResult`; manual: di `StartPutty`); Multi, SESUDAH inject sukses (`RecordPendingData`).
- **Duplikat** (`MacAddress.AddPendingData`, `DB.cs:1968-2000`): cocokkan `Mac` (huruf besar). Bila sudah ada: **memperbarui `Tipe` dan `Date` pada entri lama sebagai efek samping filter**, mengembalikan `Duplicated`, tidak menambah. Selalu `FileMac.Write` sesudahnya. Hasil enum `StatusData`: `None 0, Success 1, Duplicated 2, Error 3`.
- **Format berkas**: `Documents\QC\File\list.listqc` (`FC.cs:276-277`, `Global.PathDocuments = MyDocuments\QC\`): `BinaryFormatterHelper.Write` = BinaryFormatter .NET Framework -> Base64 -> `File.WriteAllText`. Baca gagal/korup -> daftar kosong (`new T()`). Impor/ekspor manual memakai ekstensi `.listqc` (`FC.cs:272, 372-403`). Format ini spesifik .NET dan tidak dapat dibaca tanpa runtime .NET; rebuild memerlukan format baru (mis. JSON), atau penerjemah sekali-jalan bila data lama harus dipertahankan.
- **Unggah ke server**: TIDAK otomatis. Tombol "Lihat Data" (`tambahBtn`, tooltip "Lihat/kelola data draft lokal (belum masuk database)") membuka `AddMacForm` (mode Add). Simpan (`AddMacForm.xaml.cs:582-720`): wajib login (bila tidak, tawarkan ekspor `.listqc`); baris tanpa lokasi: pengguna dengan lokasi tetap diisi otomatis, pengguna `Location.Id == -1` harus mengisi ("Kolom 'Location' tidak boleh kosong!"). `AddData` mengulang tiap baris -> `Database.AddMacList` (`DB.cs:1041-1074`) -> `CALL AddDataQC(date, idTipe, mac, sample, note, idLocation, timestamp, username)` ke MySQL (SQL dirakit dengan interpolasi string; `Note` rentan injeksi). IdTipe dicari dari daftar tipe berdasarkan nama tipe. Galat "Duplicate entry" -> status baris Duplikat; "unable to connect" -> tak ada koneksi; lainnya -> gagal. Baris sukses dihapus dari daftar dan berkas ditulis ulang; bila ada kegagalan dialog "Gagal menyimpan, Coba lagi?".
- **Penghitung**: `InfoData` menampilkan "N Pending" dari `FileMac.ReadComplate/WriteComplate` (kedua halaman memanggil `FileMac.Read()` sendiri di konstruktor).

---

## 8. Aturan, kasus tepi, dan keanehan yang HARUS dipertahankan

### 8.1 Perilaku fungsional yang wajib sama
1. **Jump-router selalu diperlakukan sebagai Mikrotik** apa pun merk perangkat: `RouterInfo.Get(MerkTipe.Mikrotik, ...)` (`CL.cs:953, 1213`) dan `ReloadServerInfo` (`CLM.cs:361`); `SwitchBridgePort`, `DhcpLeaseReader`, `BridgePortSetup` memakai sintaks RouterOS. Perangkat bisa Ubiquiti sementara router Mikrotik.
2. Serial/MAC = kunci identitas perangkat dan kunci idempotensi inject. `AddPendingData` adalah gerbang: serial yang sudah di daftar tidak di-auto-inject lagi (tunggal dan Multi). Inject manual tetap boleh (hanya peringatan di Multi).
3. Mode tunggal mencatat pending SEBELUM inject (data tetap tersimpan walau inject gagal/batal, tidak di-rollback); Multi mencatat SESUDAH sukses. Perbedaan ini disengaja dalam kode, putuskan eksplisit di spek rebuild.
4. Rotasi interface hanya setelah inject SUKSES; reset ke indeks 0 setiap router kembali terjangkau; `SwitchBridgePort` tidak diantrikan bila sedang berjalan.
5. `statusCL`: klaim sebelum pekerjaan async apa pun; reset di setiap jalur (`finally`); dilepas SEBELUM `Cmd_Finished` supaya auto-inject berantai.
6. Koneksi inject putus setelah ada output = dianggap sukses (reboot); putus tanpa output = gagal.
7. Pelaporan galat kredensial: pesan mengandung "Permission denied" ATAU "username" -> `"Permission denied!!!"`; galat jaringan lain tidak memunculkan prompt kredensial.
8. Ping: ICMP 1 s; interval 800/500/200 ms sesuai status (1.3); perubahan dipicu hanya saat transisi atau serial berubah.
9. Antrian OCR: ambang `Count > 5`, timer bersih 5 s, semua `IsFailed` direset tiap transisi ping perangkat.
10. Penyisipan placeholder: tujuh kunci persis (`{ipTarget} {usernameTarget} {passwordTarget} {ipServer} {usernameServer} {passwordServer} {sshKey}`), `{ipServer}` dari `IpServer` (fallback `server.ip`), skrip lama tanpa placeholder tidak berubah.
11. `.QC` dibaca dengan aturan fallback `mode.multi -> mode.single` dan `Write` yang merge (tidak menghapus `firmware`, `sshKeys`, `version`, kunci tak dikenal).
12. Firmware terkunci otomatis bila tipe terpilih punya kode firmware.
13. Perangkat browser web: sertifikat tidak valid SELALU diterima (`ExampleRequestHandler.OnCertificateError`, `callback.Continue(true)`, `Helper.cs:614-`); alamat `Config.Web` dengan `{ip}`. Browser hanya viewer manual (tidak ada otomatisasi DOM).
14. Multi: identitas MAC, grace period 1 menit, deteksi IP diambil alih, pembatasan konkurensi 1..32 (bawaan 4), perangkat `Success` tak pernah di-inject ulang oleh otomatis.

### 8.2 Hal yang bergantung pada komponen yang akan dibuang
- **MySQL** (`Global.DatabaseConnectionString`, `Database.*`, stored proc `AddDataQC`, `GetHistoryDataQC`, pengguna/izin/lokasi): daftar tipe (`ListTipe.Instanse`), pengguna dan lokasi (`Global.User.Location.Id` menentukan wajib-lokasi dan `IdLocation`), unggah pending.
- **Firebase** (`Firebase.Read<..>("Script")` untuk versi skrip, session-timeout, versi aplikasi). Pengganti diperlukan untuk distribusi skrip + `.QC`.
- **Google Drive/Sheets** (unduh zip skrip `DownloaderForm` dengan kredensial service-account tertanam di Updater; lampiran tipe).
- **CefSharp** (hanya viewer web manual + sertifikat tanpa verifikasi). Pengganti Electron: `BrowserView`/`webview` dengan `ignore-certificate-errors` terbatas pada host perangkat.
- **plink.exe/putty.exe**: plink tak dipakai inject; `putty.exe` dipakai tombol Terminal (`-ssh admin@<Server>`).
- **AForge/TesseractOCR/GDI+**: pengganti web (getUserMedia + Tesseract.js atau native).
- **WPF-spesifik**: `BinaryFormatter` (`list.listqc`, `Config.user`), `DispatcherTimer`, `BackgroundWorker`, popup `PopUpForm`.

### 8.3 Bahaya keamanan di kode lama (jangan disalin)
Kredensial produksi DB/Firebase dan kunci service-account di sumber (dicatat `CLAUDE.md` repo); SQL dengan interpolasi string; host key SSH selalu dipercaya; sandi perangkat/server disisipkan mentah ke skrip lalu DICETAK ke kotak log inject (`InjectProgressForm.ShowScript`) dan disimpan di `DeviceSession` log (Multi) tanpa penyamaran; kredensial di `.QC` teks biasa.

### 8.4 Pembaruan skrip menimpa lokal
`Update` (`CL.cs:1427-1511`): unduh zip, `EmptyFolder(PathFile)` MENGHAPUS SEMUA ISI folder `.QC` (termasuk suntingan operator lewat editor config) lalu ekstrak, dan memuat `PathFile\config.qc` (huruf kecil). Rebuild perlu memutuskan strategi merge, bukan menimpa.

### 8.5 Penyimpanan sesi
`Global.Settings.PathFileCL` (jalur `.QC` terakhir) dibagi mode tunggal dan Multi; `Settings` di `Documents\QC\Config.user` (BinaryFormatter). Posisi/ukuran jendela, `DateFormat`, `SessionTimeout` ikut di sana (tak relevan untuk fitur).

### 8.6 Keanehan konfigurasi
- `ExcludeIp` ada di model dan editor tetapi TIDAK dibaca dari dan TIDAK ditulis ke `.QC`: nilai yang diisi di editor hilang setelah simpan karena config dimuat ulang dari disk (`onSaved`). Fitur "exclude IP PC operator" praktis tidak berfungsi.
- `Write` selalu menulis `ipServer` dan `interfaceBridge` ke node `mode.*` dengan nilai hasil fallback; setelah simpan pertama, perubahan `server.ip` tidak lagi terbawa ke `{ipServer}`.
- Hanya `server.*` yang dibagi kedua merk; `connectVia`, `ipServer` per merk dan per mode.

---

## 9. Yang tidak pasti, tampak mati, atau tidak ditemukan

**Tidak ditemukan di repo (perlu dari pemilik atau perangkat):**
1. Isi skrip inject Mikrotik/Ubiquiti asli, berkas `.npk/.rsc/.bin/system.cfg`, dan isi `config.QC` nyata (hanya contoh potongan di kiro `requirements.md`). Jadi "kunci ke Indonesia" per merk hanya bisa dipastikan sebagai inferensi (2.4); kode `countrycode=360` di `system.cfg` Ubiquiti dan nama negara di `script.rsc` Mikrotik tidak terlihat.
2. Badan stored procedure `AddDataQC` dan skema tabel data QC.
3. `MainWindow.xaml.cs` (dialog bentrok antar-mode, `ShowPopUp`), `App.ExpandTimeOut`, `Extension` lain.
4. Hasil validasi perangkat Mikrotik pada `tasks.md` (task 5 `[VALIDASI HARDWARE]` tidak dicentang; tak ada catatan hasil).

**Keraguan teknis:**
1. **Sentinel `echo` pada RouterOS**: `SIS.cs` memakai `echo <sentinel>` untuk semua merk. RouterOS tidak punya perintah `echo` (galat "bad command name"); sentinel kedua hanya muncul bila echo terminal/pencetakan galat memuatnya. Komentar kode mengaku sudah diuji pada Mikrotik, tetapi cara persisnya (apakah via redraw baris terminal RouterOS, atau Mikrotik hanya diuji lewat jalur lain) tidak terdokumentasi. Bila rebuild mempertahankan sentinel dua kali, uji pada RouterOS nyata; `:put` adalah padanan RouterOS yang benar.
2. Skrip dengan konstruksi multi-baris (kondisi, heredoc, lanjutan baris `\`) akan rusak karena dikirim baris-per-baris dengan sentinel di antaranya.
3. `Pinger.OnErrorCredential` mati: syarat `msg == "Permission Denied!!!"` (D kapital) tak pernah benar karena `msg` selalu berawalan "Replay from ..." (`CLC.cs:101-103, 135`). Pemicu praktis kredensial adalah `ReloadInfo`, bukan event itu.
4. **`Merk` mode tunggal tidak pernah di-assign** (`CL.cs:66-74`; satu-satunya `Merk =` ada di setter): `FolderBox_SelectionChanged` memanggil `GetFirmware((MerkTipe)valueFolder)` tetapi tidak menyetel `Merk`, sehingga `Merk` tetap `MerkTipe.None`. Akibatnya `DeviceInfo.AsyncGet(Merk, ...)` (`:946, 954, 1285`) tidak masuk cabang apa pun dan mengembalikan info kosong; `UpdateListTipe(Merk)` keluar dini; `ConfigEditorForm.Show(Merk, ...)` -> `ConfigFile.Write` mengembalikan false untuk `None`; pembaruan kredensial form berhenti karena `Merk == None`. Pinger tetap bekerja karena `GetFirmware(merk)` meneruskan merk lewat parameter. Kemungkinan regresi dari refactor folder ke merk (Multi men-set `Merk` eksplisit). Jangan menyalin; spek rebuild: `Merk` = nilai `folderBox` terpilih.
5. **Semafor Multi**: `ConcurrentBox_LostFocus` mengganti instance `injectGate` (`CLM.cs:958`); `QueueInject` memakai field langsung pada `WaitAsync` dan `Release` (`:760, 777`) tanpa menyimpan referensi lokal (komentar mengklaim sebaliknya). Mengubah angka saat ada inject berjalan dapat memanggil `Release` pada semafor baru yang sudah penuh -> `SemaphoreFullException`.
6. **Retry tanpa henti di Multi**: setelah antrian kredensial habis, perangkat `Waiting` + "Permission denied!!!" dipicu ulang `ProcessDevice` oleh `DeviceLoop` tiap ~500 ms dengan kredensial terakhir yang sama (indeks `NextCredentialIndex` tak pernah direset kecuali reconnect). Risiko kunci akun/spam log pada perangkat; rebuild sebaiknya menambah batas atau jeda.
7. `AddToQueue` dapat memicu `ProcessDevice` paralel dengan yang dijalankan `DeviceLoop` pada perangkat yang sama (tanpa kunci selain `Status`).
8. `BuildDeviceUrl` (Multi): bila `Config.Web` URI absolut hanya skema yang dipakai (`scheme://ip`, tanpa path/port); `Web` berisi `{ip}` mungkin tidak lolos `Uri.TryCreate` sehingga jatuh ke `https://<ip>`. Tidak diverifikasi.
9. Arti `ConnectVia` di Multi: dibaca/diedit tetapi tidak berpengaruh (inject ke perangkat langsung).
10. `ReadMerk`: node `mikrotik` wajib ada walau Multi hanya Ubiquiti (menggagalkan muat).
11. ANSI escape dan encoding keluaran shell tidak ditangani (log bisa berisi urutan kontrol); tidak diketahui bagaimana terminal RouterOS/BusyBox merespons pada lebar 200 kolom untuk baris panjang.
12. Tidak diketahui apakah proses jarak jauh dihentikan saat pembatalan (shell ditutup).
13. `Pinger.Interval` yang diatur setelah konstruksi tidak mengubah timer (timer diinisialisasi sekali di konstruktor, dan diubah hanya di `DoWork`).
14. Pemakaian `ExpandTimeOut` pada inject/ping berkaitan timeout sesi login aplikasi; tak relevan bila login tak dibawa.

**Kode mati/usang:** `InfoDevice.GetInfo` statis, `InfoDevice.Get` (BackgroundWorker), `GetMikrotikFromServer`/`GetMikrotikFromDevice`, blok komentar besar `GetDeviceResult` di `CL.cs`, `Settings.AutoSelect`, `ConfigCL.SN`, `Resources/plink.exe` (tak dipakai inject), referensi `OptionCL` di dokumen kiro dan spek 2026-07-24 (digantikan `ConfigEditorForm`), `CL.cs:1202-1205 GetMikrotik` (komentar), `Pinger(Action<IPStatus>)` konstruktor kedua (tak dipakai halaman).

**Tidak dapat dibaca:** tidak ada berkas dari daftar permintaan yang gagal diambil. Berkas pendukung yang ikut dibaca di luar daftar: `General/Helper.cs`, `General/BinnaryFormatter.cs`, `PopUp/MacForm/AddMacForm.xaml.cs`, `.kiro/specs/ssh-execution-refactor/tasks.md`.
